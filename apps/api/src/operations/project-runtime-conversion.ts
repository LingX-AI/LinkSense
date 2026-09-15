import { chmod, chown, lstat, mkdir, open, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { interactiveApplicationManifestSchema, linksenseRuntimeIdentity } from "@linksense/shared";
import { z } from "zod";
import { type PrismaClient, type Prisma } from "../generated/prisma/client.js";
import { ApplicationPublicationService } from "../modules/applications/publication-service.js";
import { publishedApplicationDefinitionSchema } from "../modules/applications/published-definition.js";
import { interactiveApplicationBaseInstructions, interactiveApplicationRuntimeInstructions } from "../modules/applications/service.js";
import { info, stageProjectHomes, type ConvertedTask, type ConversionTask } from "./project-home-conversion.js";

const journalSchema = z.strictObject({
  phase: z.enum(["staging", "prepared", "swapping", "committed"]),
  sourceRoot: z.string(), backupRoot: z.string(), tasks: z.array(z.object({ id: z.uuid(), oldWorkspace: z.string(), workspace: z.string(), importedDirectory: z.string(), ownerId: z.uuid() })),
  swapped: z.array(z.uuid()), owners: z.array(z.uuid()),
});
type Journal = z.infer<typeof journalSchema>;

/** One-time maintenance operation. A full pre-migration database backup is required
 * by the CLI; this directory additionally retains every replaced original file. */
export async function convertProjectRuntime(input: {
  prisma: PrismaClient; userDataRoot: string; capabilityRoot: string; backupRoot: string;
  apply: boolean; nativeUserHome?: string;
}): Promise<{ tasks: number; owners: number; publications: number; applied: boolean }> {
  const { prisma } = input;
  const root = resolve(input.userDataRoot), backup = resolve(input.backupRoot);
  if (!isAbsolute(input.backupRoot) || backup === root || backup.startsWith(root + sep) || root.startsWith(backup + sep)) throw new Error("MIGRATION_ROOT_INVALID");
  if (await info(backup)) throw new Error("MIGRATION_BACKUP_ALREADY_EXISTS");
  const rootInfo = await lstat(root), parentInfo = await lstat(resolve(backup, ".."));
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink() || !parentInfo.isDirectory() || parentInfo.isSymbolicLink() || rootInfo.dev !== parentInfo.dev) throw new Error("MIGRATION_ROOT_INVALID");
  const [runningTurns, startingTurns] = await Promise.all([
    prisma.conversationTurn.count({ where: { status: "running" } }),
    prisma.conversationTurnStartIntent.count(),
  ]);
  // Native start-operation fingerprints contain the old runtime paths and
  // generations. Let the old version settle these operations before switching;
  // never discard or replay a partly accepted input during conversion.
  if (runningTurns || startingTurns) throw new Error("MIGRATION_ACTIVE_TASKS");
  const rows = await prisma.conversation.findMany({ orderBy: { id: "asc" } });
  const turns = await prisma.conversationTurn.findMany({ select: { conversationId: true, codexThreadId: true }, distinct: ["conversationId", "codexThreadId"] });
  const tasks: ConversionTask[] = rows.map(row => ({ id: row.id, ownerId: row.ownerId, projectId: row.projectId,
    applicationId: row.applicationId, workspaceRelPath: row.workspaceRelPath,
    nativeThreadIds: [...new Set([...(row.codexThreadId ? [row.codexThreadId] : []), ...turns.filter(turn => turn.conversationId === row.id).map(turn => turn.codexThreadId)])],
  }));
  const versions = await prisma.applicationVersion.findMany({ where: { assetsReady: false } });
  await mkdir(backup, { mode: 0o700 });
  const stage = join(backup, "staged-users"), originals = join(backup, "original-users");
  const journalPath = join(backup, "journal.json");
  const journal: Journal = { phase: "staging", sourceRoot: root, backupRoot: backup, tasks: [], swapped: [], owners: [] };
  const save = async () => { await writeFile(journalPath + ".tmp", JSON.stringify(journal), { mode: 0o600 }); await syncPath(journalPath + ".tmp"); await rename(journalPath + ".tmp", journalPath); await syncPath(backup); };
  await save();
  journal.tasks = await stageProjectHomes({ sourceRoot: root, stagingRoot: stage, tasks, ...(input.nativeUserHome ? { nativeUserHome: input.nativeUserHome } : {}) });
  const owners = (await readdir(stage)).filter(name => z.uuid().safeParse(name).success);
  journal.owners = owners;
  journal.phase = "prepared";
  await save();
  if (!input.apply) { await rm(stage, { recursive: true, force: true }); return { tasks: tasks.length, owners: owners.length, publications: versions.length, applied: false }; }
  await writeFile(join(root, ".runtime-conversion.json"), JSON.stringify({ backup, status: "in_progress" }), { mode: 0o600 });
  await syncPath(join(root, ".runtime-conversion.json")); await syncPath(root);
  const publications = new ApplicationPublicationService(prisma, input.capabilityRoot);
  for (const version of versions) {
    const application = await prisma.application.findUniqueOrThrow({ where: { id: version.applicationId } });
    let instructions = application.instructions;
    if (application.kind === "interactive" && application.interactivePackageId) {
      const package_ = await prisma.interactiveApplicationPackage.findUniqueOrThrow({ where: { id: application.interactivePackageId } });
      const manifest = interactiveApplicationManifestSchema.parse(package_.manifestJson);
      instructions = interactiveApplicationRuntimeInstructions(manifest.instructions ?? interactiveApplicationBaseInstructions(manifest.name), manifest);
    }
    await publications.publish(application.ownerId, application.id, { allow_copy: application.allowCopy, usage_instructions: application.usageInstructions }, instructions, version.id);
  }
  await mkdir(originals, { mode: 0o700 });
  if (process.platform === "linux" && process.geteuid?.() === 0) {
    for (const owner of owners) await restoreRuntimeOwnership(join(stage, owner));
  }
  await syncTree(stage);
  journal.phase = "swapping";
  await save();
  try {
    await prisma.$transaction(async tx => {
      const historicalPages = new Map<string, string>();
      for (const task of journal.tasks) {
        const row = rows.find(row => row.id === task.id)!;
        await rewriteTaskStorage(tx, task);
        // Historical interactive tasks already pinned their page package before
        // publications existed. Preserve that page and its instructions in a
        // normal immutable version, without changing the app's current release.
        if (row.applicationId && row.applicationVersionId && row.interactiveApplicationPackageId) {
          const key = `${row.applicationVersionId}:${row.interactiveApplicationPackageId}`;
          let versionId = historicalPages.get(key);
          if (!versionId) {
            const base = await tx.applicationVersion.findFirstOrThrow({ where: { id: row.applicationVersionId, applicationId: row.applicationId, assetsReady: true } });
            const definition = publishedApplicationDefinitionSchema.parse(base.definitionJson);
            versionId = base.id;
            if (definition.interactivePackageId !== row.interactiveApplicationPackageId) {
              const page = await tx.interactiveApplicationPackage.findFirstOrThrow({ where: { id: row.interactiveApplicationPackageId, applicationId: row.applicationId } });
              const manifest = interactiveApplicationManifestSchema.parse(page.manifestJson);
              const latest = await tx.applicationVersion.findFirstOrThrow({ where: { applicationId: row.applicationId }, orderBy: { versionNumber: "desc" } });
              versionId = randomUUID();
              await tx.applicationVersion.create({ data: {
                id: versionId, applicationId: row.applicationId, versionNumber: latest.versionNumber + 1, createdBy: base.createdBy, assetsReady: true,
                definitionJson: { ...definition, interactivePackageId: page.id, instructions: interactiveApplicationRuntimeInstructions(manifest.instructions ?? interactiveApplicationBaseInstructions(manifest.name), manifest) },
              } });
            }
            historicalPages.set(key, versionId);
          }
          if (versionId !== row.applicationVersionId) await tx.conversation.update({ where: { id: task.id }, data: { applicationVersionId: versionId } });
        }
      }
      for (const owner of owners) {
        // Record intent before each rename; recovery checks both sides of an interrupted swap.
        journal.swapped.push(owner); await save();
        await rename(join(root, owner), join(originals, owner));
        await rename(join(stage, owner), join(root, owner));
        await Promise.all([syncPath(root), syncPath(stage), syncPath(originals)]);
      }
    }, { timeout: 120_000 });
  } catch (error) {
    for (const owner of [...journal.swapped].reverse()) {
      if (await info(join(originals, owner))) {
        if (await info(join(root, owner))) await rename(join(root, owner), join(stage, owner));
        await rename(join(originals, owner), join(root, owner));
      }
    }
    journal.swapped = []; journal.phase = "prepared"; await save();
    throw error;
  }
  journal.phase = "committed"; await save();
  await rm(join(root, ".runtime-conversion.json"));
  await syncPath(root);
  return { tasks: tasks.length, owners: owners.length, publications: versions.length, applied: true };
}

async function rewriteTaskStorage(tx: Prisma.TransactionClient, task: ConvertedTask): Promise<void> {
  const updated = await tx.conversation.updateMany({ where: { id: task.id, ownerId: task.ownerId, workspaceRelPath: task.oldWorkspace }, data: { workspaceRelPath: task.workspace } });
  if (updated.count !== 1) throw new Error("MIGRATION_SOURCE_CHANGED");
  const files = await tx.conversationFile.findMany({ where: { conversationId: task.id, storageBackend: "workspace" } });
  for (const file of files) {
    if (file.workspaceRootRelPath !== task.oldWorkspace || !file.workspaceRelativePath || file.workspaceRelativePath.split("/").includes("..")) throw new Error("MIGRATION_FILE_REFERENCE_CONFLICT");
    await tx.conversationFile.update({ where: { id: file.id }, data: { workspaceRootRelPath: task.workspace, workspaceRelativePath: `${task.importedDirectory}/${file.workspaceRelativePath}` } });
  }
}

/** Recover a process crash before or after the PostgreSQL commit. This does not
 * roll back a completed conversion or any later user changes. */
export async function recoverProjectConversion(prisma: PrismaClient, backup: string): Promise<void> {
  const journal = journalSchema.parse(JSON.parse(await readFile(join(backup, "journal.json"), "utf8")));
  if (resolve(backup) !== journal.backupRoot || journal.sourceRoot === journal.backupRoot) throw new Error("MIGRATION_ROOT_INVALID");
  if (journal.phase === "committed") {
    await rm(join(journal.sourceRoot, ".runtime-conversion.json"), { force: true }); return;
  }
  const current = await prisma.conversation.findMany({ where: { id: { in: journal.tasks.map(task => task.id) } }, select: { id: true, workspaceRelPath: true } });
  if (current.length !== journal.tasks.length) throw new Error("MIGRATION_RECOVERY_CONFLICT");
  const directoryCommit = (await Promise.all(journal.owners.map(async owner => !!await info(join(backup, "original-users", owner)) && !!await info(join(journal.sourceRoot, owner)) && !await info(join(backup, "staged-users", owner))))).every(Boolean);
  const committed = journal.tasks.length === 0 ? journal.phase === "swapping" && directoryCommit : current.every(row => journal.tasks.some(task => task.id === row.id && task.workspace === row.workspaceRelPath));
  const unchanged = current.every(row => journal.tasks.some(task => task.id === row.id && task.oldWorkspace === row.workspaceRelPath));
  if (!committed && !unchanged) throw new Error("MIGRATION_RECOVERY_CONFLICT");
  if (!committed) {
    for (const owner of [...journal.swapped].reverse()) {
      const original = join(backup, "original-users", owner), active = join(journal.sourceRoot, owner), staged = join(backup, "staged-users", owner);
      if (!await info(original)) continue;
      if (await info(active)) { if (await info(staged)) throw new Error("MIGRATION_RECOVERY_CONFLICT"); await rename(active, staged); }
      await rename(original, active);
      await Promise.all([syncPath(journal.sourceRoot), syncPath(join(backup, "staged-users")), syncPath(join(backup, "original-users"))]);
    }
  }
  journal.phase = committed ? "committed" : "prepared"; journal.swapped = committed ? journal.swapped : [];
  const journalPath = join(backup, "journal.json");
  await writeFile(journalPath + ".tmp", JSON.stringify(journal), { mode: 0o600 });
  await syncPath(journalPath + ".tmp");
  await rename(journalPath + ".tmp", journalPath); await syncPath(backup);
  if (committed) {
    await rm(join(journal.sourceRoot, ".runtime-conversion.json"), { force: true });
    await syncPath(journal.sourceRoot);
  }
}

async function restoreRuntimeOwnership(owner: string): Promise<void> {
  async function visit(path: string, control: boolean): Promise<void> {
    const entry = await lstat(path);
    if (entry.isSymbolicLink()) return;
    if (entry.isDirectory()) for (const name of await readdir(path)) await visit(join(path, name), control || name === "control");
    await chown(path, control ? linksenseRuntimeIdentity.apiUid : linksenseRuntimeIdentity.taskUid, linksenseRuntimeIdentity.sharedGid);
    if (entry.isDirectory() && control) await chmod(path, 0o700);
  }
  await visit(owner, false);
}

async function syncPath(path: string): Promise<void> {
  const handle = await open(path, "r"); try { await handle.sync(); } finally { await handle.close(); }
}
async function syncTree(path: string): Promise<void> {
  const entry = await lstat(path);
  if (entry.isSymbolicLink()) return;
  if (entry.isDirectory()) for (const name of await readdir(path)) await syncTree(join(path, name));
  await syncPath(path);
}
