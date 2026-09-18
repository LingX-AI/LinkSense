import { lstat, mkdir, open, readFile, readdir, readlink, rename, rm, symlink, writeFile, chown, chmod } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { z } from "zod";
import { linksenseRuntimeIdentity, workspacePermissionPolicy } from "@linksense/shared";
import type { PrismaClient } from "../generated/prisma/client.js";
import { runtimePlacementForWorkspace, serviceWorkspaceRelativePath } from "../lib/user-runtime-paths.js";
import { info, mergeTree } from "./project-home-conversion.js";
import { rewriteNativeRolloutPaths } from "./native-home-merge.js";
import { applicationEnvironmentConversionMarker } from "./runtime-layout-readiness.js";

const taskSchema = z.object({ id: z.uuid(), ownerId: z.uuid(), applicationId: z.uuid().nullable(), workspaceRelPath: z.string() });
type Task = z.infer<typeof taskSchema>;
const groupSchema = z.strictObject({ ownerId: z.uuid(), applicationId: z.uuid(), tasks: z.array(taskSchema).min(1) });
type Group = z.infer<typeof groupSchema>;
export type NativeHomeNormalizer = (sourceHome: string) => Promise<string>;
const journalSchema = z.strictObject({
  version: z.literal(1), root: z.string(), outputRoot: z.string(),
  phase: z.enum(["prepared", "swapping", "committed"]), groups: z.array(groupSchema),
});
type Journal = z.infer<typeof journalSchema>;

export function planApplicationEnvironments(rows: Task[]): Group[] {
  const groups = new Map<string, Group>();
  const ownersByEnvironment = new Map<string, string>();
  for (const task of z.array(taskSchema).parse(rows)) {
    const placement = runtimePlacementForWorkspace(task.ownerId, task.workspaceRelPath);
    if (!task.applicationId) {
      if (placement.serviceSessionId) throw new Error("MIGRATION_APPLICATION_REFERENCE_INVALID");
      continue;
    }
    const key = `${task.ownerId}/${task.applicationId}`;
    const prior = ownersByEnvironment.get(task.workspaceRelPath);
    if (placement.serviceSessionId && prior && prior !== key) throw new Error("MIGRATION_APPLICATION_REFERENCE_CONFLICT");
    if (placement.serviceSessionId) ownersByEnvironment.set(task.workspaceRelPath, key);
    const group = groups.get(key) ?? { ownerId: task.ownerId, applicationId: task.applicationId, tasks: [] };
    group.tasks.push(task);
    groups.set(key, group);
  }
  for (const [key, group] of groups) {
    const existingOwner = ownersByEnvironment.get(serviceWorkspaceRelativePath(group.ownerId, group.applicationId));
    if (existingOwner && existingOwner !== key) throw new Error("MIGRATION_APPLICATION_REFERENCE_CONFLICT");
    group.tasks.sort((left, right) => left.id.localeCompare(right.id));
  }
  return [...groups.values()].filter(group => group.tasks.some(task => task.workspaceRelPath !== serviceWorkspaceRelativePath(group.ownerId, group.applicationId)))
    .sort((left, right) => `${left.ownerId}/${left.applicationId}`.localeCompare(`${right.ownerId}/${right.applicationId}`));
}

/** Stages a complete app HOME without changing any source. Differing credentials,
 * user packages and native records are conflicts, never last-writer-wins merges. */
export async function stageApplicationEnvironment(root: string, target: string, group: Group, nativeHome = "/home/linksense", normalizeNativeHome?: NativeHomeNormalizer): Promise<void> {
  groupSchema.parse(group);
  if (group.tasks.some(task => task.ownerId !== group.ownerId || task.applicationId !== group.applicationId)) throw new Error("MIGRATION_APPLICATION_REFERENCE_INVALID");
  for (const parent of [root, join(root, group.ownerId)]) await assertDirectory(parent);
  if (await info(join(root, group.ownerId, "services"))) await assertDirectory(join(root, group.ownerId, "services"));
  const canonical = environmentPath(root, group, group.applicationId);
  const sources = sourceIds(group);
  if (await info(canonical) && !sources.includes(group.applicationId)) throw new Error("MIGRATION_ENVIRONMENT_TARGET_UNREFERENCED");
  sources.sort((left, right) => Number(right === group.applicationId) - Number(left === group.applicationId) || left.localeCompare(right));
  await mkdir(target, { recursive: true, mode: 0o770 });
  await mkdir(join(target, "home"), { mode: 0o770 });
  const personalTasks = group.tasks.filter(task => !runtimePlacementForWorkspace(group.ownerId, task.workspaceRelPath).serviceSessionId);
  for (const sourceId of [...sources, ...(personalTasks.length ? ["personal"] : [])]) {
    const source = sourceId === "personal" ? join(root, group.ownerId) : environmentPath(root, group, sourceId);
    await assertDirectory(source);
    const sourceHome = join(source, "home");
    await assertDirectory(sourceHome);
    const nativeSource = join(sourceHome, ".codex");
    if (await info(nativeSource)) await assertDirectory(nativeSource);
    const normalized = normalizeNativeHome && await info(nativeSource) ? await normalizeNativeHome(nativeSource) : null;
    await mergeTree(sourceHome, join(target, "home"), sourceHome, new Set(["workspace", "projects", ".agents", ...(normalized ? [".codex"] : [])]));
    if (normalized) await mergeTree(normalized, join(target, "home/.codex"), resolve(normalized, ".."));
    const workspaces = sourceId === "personal" ? [...new Set(personalTasks.map(task => runtimePlacementForWorkspace(group.ownerId, task.workspaceRelPath).workspacePath))] : ["workspace"];
    for (const oldPath of workspaces) {
    const sourceWorkspace = join(sourceHome, oldPath);
    const imported = sourceId === group.applicationId ? "" : sourceId === "personal" ? `imports/personal/${oldPath}` : `imports/${sourceId}`;
    if (await info(sourceWorkspace)) {
      const destination = join(target, "home/workspace", imported);
      const modules = join(sourceWorkspace, "node_modules");
      const nodeModulesRelativePath = ".local/share/linksense/node/node_modules";
      const link = (await info(modules))?.isSymbolicLink() ? await readlink(modules) : null;
      const managedModules = link !== null && (link === `/home/linksense/${nodeModulesRelativePath}` || resolve(sourceWorkspace, link) === join(sourceHome, nodeModulesRelativePath));
      // The managed dependency link points to HOME, so importing the workspace
      // changes its relative depth. Real project node_modules remain ordinary data.
      await mergeTree(sourceWorkspace, destination, sourceWorkspace, managedModules ? new Set(["node_modules"]) : new Set());
      if (managedModules) await symlink(relative(destination, join(target, "home", nodeModulesRelativePath)), join(destination, "node_modules"));
    }
    }
    const control = join(source, "control");
    if (await info(control)) {
      await mergeTree(control, join(target, "control"), control, new Set(["capabilities", "capability-snapshots", "native-home-imports"]));
      // Preserve earlier conversion archives separately from the archive of the
      // current HOME. They can share a source-path hash but have different dates.
      const archived = join(control, "native-home-imports");
      if (await info(archived)) await mergeTree(archived, join(target, "control/previous-native-home-imports", sourceId), archived);
    }
    const unknown = (await readdir(source)).filter(name => !["home", "control", "managed"].includes(name));
    if (sourceId !== "personal" && unknown.length > 0) throw new Error("MIGRATION_ENVIRONMENT_ENTRY_UNKNOWN");
  }
  const native = join(target, "home/.codex");
  rewriteNativeRolloutPaths(native, nativeHome, !!await info(join(native, "state_5.sqlite")));
  // The worker supervisor checks both roots before starting the task process.
  // Imported modes and the deployment umask must not remove its group access.
  for (const directory of [join(target, "home/workspace"), native]) {
    await mkdir(directory, { recursive: true, mode: workspacePermissionPolicy.sharedDirectory });
    await assertDirectory(directory);
    await chmod(directory, workspacePermissionPolicy.sharedDirectory);
  }
}

/** Operator-controlled, offline conversion. No schema change and no deletion of
 * originals. A dry run verifies all merges, then removes only its own staging. */
export async function convertApplicationEnvironments(input: {
  prisma: PrismaClient; userDataRoot: string; outputRoot: string; apply: boolean; normalizeNativeHome?: NativeHomeNormalizer;
}): Promise<{ applications: number; tasks: number; applied: boolean }> {
  const root = resolve(input.userDataRoot), outputRoot = resolve(input.outputRoot);
  assertRoots(root, outputRoot);
  await assertIdle(input.prisma);
  if (await info(join(root, applicationEnvironmentConversionMarker))) throw new Error("MIGRATION_RECOVERY_REQUIRED");
  const rows = await input.prisma.conversation.findMany({ select: { id: true, ownerId: true, applicationId: true, workspaceRelPath: true } });
  const groups = planApplicationEnvironments(rows);
  const result = { applications: groups.length, tasks: groups.reduce((count, group) => count + group.tasks.length, 0), applied: false };
  if (groups.length === 0) return result;
  await mkdir(outputRoot, { mode: 0o700 });
  const journal: Journal = { version: 1, root, outputRoot, groups, phase: "prepared" };
  await saveJournal(journal);
  try {
    for (const group of groups) await stageApplicationEnvironment(root, stagedPath(journal, group), group, "/home/linksense", input.normalizeNativeHome);
    if (!input.apply) return result;
    await assertIdle(input.prisma);
    for (const group of groups) {
      await mkdir(join(root, group.ownerId, "services"), { recursive: true, mode: 0o770 });
      await prepareOwnership(stagedPath(journal, group));
    }
    await syncTree(join(outputRoot, "staged"));
    await writeFile(join(root, applicationEnvironmentConversionMarker), JSON.stringify({ outputRoot }), { mode: 0o600, flag: "wx" });
    await syncFile(join(root, applicationEnvironmentConversionMarker));
    await syncFile(root);
    journal.phase = "swapping";
    await saveJournal(journal);
    try {
      await input.prisma.$transaction(async tx => {
        await assertIdle(tx);
        const current = planApplicationEnvironments(await tx.conversation.findMany({ select: { id: true, ownerId: true, applicationId: true, workspaceRelPath: true } }));
        if (JSON.stringify(current) !== JSON.stringify(groups)) throw new Error("MIGRATION_SOURCE_CHANGED");
        for (const group of groups) {
          const workspace = serviceWorkspaceRelativePath(group.ownerId, group.applicationId);
          for (const task of group.tasks) {
            if (task.workspaceRelPath === workspace) continue;
            const updated = await tx.conversation.updateMany({ where: { id: task.id, ownerId: task.ownerId, workspaceRelPath: task.workspaceRelPath }, data: { workspaceRelPath: workspace } });
            if (updated.count !== 1) throw new Error("MIGRATION_SOURCE_CHANGED");
          }
          for (const oldWorkspace of new Set(group.tasks.map(task => task.workspaceRelPath))) {
            if (oldWorkspace === workspace) continue;
            const placement = runtimePlacementForWorkspace(group.ownerId, oldWorkspace);
            const sourceId = placement.serviceSessionId;
            const imported = sourceId ? `imports/${sourceId}` : `imports/personal/${placement.workspacePath}`;
            const files = await tx.conversationFile.findMany({ where: { workspaceRootRelPath: oldWorkspace, conversationId: { in: group.tasks.map(task => task.id) } } });
            for (const file of files) {
              const relativePath = file.workspaceRelativePath;
              if (!relativePath || isAbsolute(relativePath) || relativePath.includes("\\") || relativePath.split("/").includes("..")) throw new Error("MIGRATION_FILE_REFERENCE_CONFLICT");
              await tx.conversationFile.update({ where: { id: file.id }, data: { workspaceRootRelPath: workspace, workspaceRelativePath: `${imported}/${relativePath}` } });
            }
            if (sourceId) await tx.runtimeCleanupOutbox.updateMany({ where: { ownerId: group.ownerId, serviceSessionId: sourceId }, data: { serviceSessionId: group.applicationId } });
          }
          for (const sourceId of sourceIds(group)) {
            const source = environmentPath(root, group, sourceId);
            if (!await info(source)) continue;
            const backup = environmentPath(join(outputRoot, "originals"), group, sourceId);
            await mkdir(resolve(backup, ".."), { recursive: true, mode: 0o700 });
            await rename(source, backup);
            await syncFile(resolve(source, ".."));
            await syncFile(resolve(backup, ".."));
          }
          await rename(stagedPath(journal, group), environmentPath(root, group, group.applicationId));
          await syncFile(join(root, group.ownerId, "services"));
          await syncFile(resolve(stagedPath(journal, group), ".."));
        }
      }, { timeout: 120_000 });
    } catch (error) {
      // A lost commit acknowledgement is not proof of rollback. Inspect the
      // durable rows before restoring directories; leave the marker on doubt.
      await recoverApplicationEnvironments(input.prisma, outputRoot);
      throw error;
    }
    journal.phase = "committed";
    await saveJournal(journal);
    await rm(join(root, applicationEnvironmentConversionMarker));
    await syncFile(root);
    return { ...result, applied: true };
  } finally {
    if (!input.apply) await rm(join(outputRoot, "staged"), { recursive: true, force: true });
  }
}

export async function recoverApplicationEnvironments(prisma: PrismaClient, outputRoot: string): Promise<void> {
  const journal = journalSchema.parse(JSON.parse(await readFile(join(outputRoot, "journal.json"), "utf8")));
  if (journal.outputRoot !== resolve(outputRoot)) throw new Error("MIGRATION_ROOT_INVALID");
  assertRoots(journal.root, journal.outputRoot);
  await assertIdle(prisma);
  const marker = join(journal.root, applicationEnvironmentConversionMarker);
  if (await info(marker)) {
    const value = z.strictObject({ outputRoot: z.string() }).parse(JSON.parse(await readFile(marker, "utf8")));
    if (value.outputRoot !== journal.outputRoot) throw new Error("MIGRATION_RECOVERY_CONFLICT");
  }
  if (JSON.stringify(planApplicationEnvironments(journal.groups.flatMap(group => group.tasks))) !== JSON.stringify(journal.groups)) throw new Error("MIGRATION_RECOVERY_CONFLICT");
  for (const group of journal.groups) for (const parent of [journal.root, join(journal.root, group.ownerId), join(journal.root, group.ownerId, "services")]) await assertDirectory(parent);
  const tasks = journal.groups.flatMap(group => group.tasks.filter(task => task.workspaceRelPath !== serviceWorkspaceRelativePath(group.ownerId, group.applicationId)));
  const current = await prisma.conversation.findMany({ where: { id: { in: tasks.map(task => task.id) } }, select: { id: true, workspaceRelPath: true } });
  if (current.length !== tasks.length) throw new Error("MIGRATION_RECOVERY_CONFLICT");
  const committed = current.every(task => {
    const original = tasks.find(row => row.id === task.id)!;
    return task.workspaceRelPath === serviceWorkspaceRelativePath(original.ownerId, original.applicationId!);
  });
  if (!committed && !current.every(task => task.workspaceRelPath === tasks.find(row => row.id === task.id)?.workspaceRelPath)) throw new Error("MIGRATION_RECOVERY_CONFLICT");
  if (committed) {
    for (const group of journal.groups) {
      const target = environmentPath(journal.root, group, group.applicationId);
      if (!await info(target) || await info(stagedPath(journal, group))) throw new Error("MIGRATION_RECOVERY_CONFLICT");
      await assertDirectory(target);
      await assertDirectory(join(target, "home"));
      for (const sourceId of sourceIds(group)) await assertDirectory(environmentPath(join(outputRoot, "originals"), group, sourceId));
    }
  } else if (journal.phase === "prepared") {
    for (const group of journal.groups) for (const sourceId of sourceIds(group)) await assertDirectory(environmentPath(journal.root, group, sourceId));
  } else {
    for (const group of [...journal.groups].reverse()) {
      const staged = stagedPath(journal, group), target = environmentPath(journal.root, group, group.applicationId);
      if (!await info(staged) && await info(target)) {
        await assertDirectory(target);
        await rename(target, staged);
        await syncFile(resolve(staged, ".."));
      }
      for (const sourceId of sourceIds(group)) {
        const backup = environmentPath(join(outputRoot, "originals"), group, sourceId), original = environmentPath(journal.root, group, sourceId);
        if (!await info(backup)) continue;
        await assertDirectory(backup);
        if (await info(original)) throw new Error("MIGRATION_RECOVERY_CONFLICT");
        await rename(backup, original);
        await syncFile(resolve(backup, ".."));
      }
      for (const sourceId of sourceIds(group)) await assertDirectory(environmentPath(journal.root, group, sourceId));
      await syncFile(join(journal.root, group.ownerId, "services"));
    }
  }
  journal.phase = committed ? "committed" : "prepared";
  await saveJournal(journal);
  await rm(join(journal.root, applicationEnvironmentConversionMarker), { force: true });
  await syncFile(journal.root);
}

function environmentPath(root: string, group: Group, id: string): string { return join(root, group.ownerId, "services", id); }
function stagedPath(journal: Journal, group: Group): string { return environmentPath(join(journal.outputRoot, "staged"), group, group.applicationId); }
function sourceIds(group: Group): string[] {
  return [...new Set(group.tasks.flatMap(task => {
    const id = runtimePlacementForWorkspace(group.ownerId, task.workspaceRelPath).serviceSessionId;
    return id ? [id] : [];
  }))];
}
function assertRoots(root: string, output: string): void {
  if (!isAbsolute(root) || !isAbsolute(output) || root === output || output.startsWith(root + sep) || root.startsWith(output + sep)) throw new Error("MIGRATION_ROOT_INVALID");
}
async function assertDirectory(target: string): Promise<void> {
  const entry = await lstat(target);
  if (!entry.isDirectory() || entry.isSymbolicLink()) throw new Error("MIGRATION_PATH_INVALID");
}
async function assertIdle(prisma: Pick<PrismaClient, "conversationTurn" | "conversationTurnStartIntent">): Promise<void> {
  const [running, starting] = await Promise.all([prisma.conversationTurn.count({ where: { status: "running" } }), prisma.conversationTurnStartIntent.count()]);
  if (running || starting) throw new Error("MIGRATION_ACTIVE_TASKS");
}
async function saveJournal(journal: Journal): Promise<void> {
  const file = join(journal.outputRoot, "journal.json"), temporary = file + ".tmp";
  await writeFile(temporary, JSON.stringify(journalSchema.parse(journal)), { mode: 0o600 });
  await syncFile(temporary);
  await rename(temporary, file);
  await syncFile(journal.outputRoot);
}
async function syncFile(target: string): Promise<void> { const file = await open(target, "r"); try { await file.sync(); } finally { await file.close(); } }
async function syncTree(target: string): Promise<void> {
  const entry = await lstat(target);
  if (entry.isSymbolicLink()) return;
  if (entry.isDirectory()) for (const child of await readdir(target)) await syncTree(join(target, child));
  await syncFile(target);
}
async function prepareOwnership(target: string, domain: "root" | "home" | "control" = "root"): Promise<void> {
  if (process.platform !== "linux") return;
  if (process.geteuid?.() !== 0) throw new Error("MIGRATION_REQUIRES_ROOT");
  const entry = await lstat(target);
  if (entry.isSymbolicLink()) return;
  if (entry.isDirectory()) for (const child of await readdir(target)) await prepareOwnership(join(target, child), domain === "root" && child === "home" ? "home" : domain === "root" && child === "control" ? "control" : domain);
  await chown(target, domain === "home" ? linksenseRuntimeIdentity.taskUid : linksenseRuntimeIdentity.apiUid, linksenseRuntimeIdentity.sharedGid);
  if (domain === "control" && entry.isDirectory()) await chmod(target, 0o700);
}
