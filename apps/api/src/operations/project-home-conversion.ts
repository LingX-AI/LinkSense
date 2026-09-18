import { createHash } from "node:crypto";
import { constants, createReadStream, type Stats } from "node:fs";
import { chmod, copyFile, cp, lstat, mkdir, readFile, readdir, readlink, symlink, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { z } from "zod";
import { projectWorkspaceRelativePath, serviceWorkspaceRelativePath } from "../lib/user-runtime-paths.js";
import { mergeNativeDatabases, rewriteNativeRolloutPaths } from "./native-home-merge.js";
import { nativeHomeTemporaryEntries, prepareNativeHomeFiles } from "./native-home-files.js";

export const conversionTaskSchema = z.strictObject({
  id: z.uuid(), ownerId: z.uuid(), projectId: z.uuid().nullable(),
  applicationId: z.uuid().nullable(), workspaceRelPath: z.string(),
  nativeThreadIds: z.array(z.string().min(1)),
});
export type ConversionTask = z.infer<typeof conversionTaskSchema>;
export type ConvertedTask = { id: string; ownerId: string; oldWorkspace: string; workspace: string; importedDirectory: string };
const generated = new Set([".agents", "node_modules"]);

/** Build a new storage tree; all inputs remain untouched until the coordinator commits it. */
export async function stageProjectHomes(input: {
  sourceRoot: string; stagingRoot: string; tasks: ConversionTask[]; nativeUserHome?: string;
}): Promise<ConvertedTask[]> {
  const sourceRoot = resolve(input.sourceRoot), stagingRoot = resolve(input.stagingRoot);
  if (!isAbsolute(input.sourceRoot) || !isAbsolute(input.stagingRoot) || stagingRoot === sourceRoot || stagingRoot.startsWith(sourceRoot + sep)) throw new Error("MIGRATION_ROOT_INVALID");
  const tasks = z.array(conversionTaskSchema).parse(input.tasks);
  const converted: ConvertedTask[] = [];
  await mkdir(stagingRoot, { recursive: true, mode: 0o700 });
  for (const ownerId of new Set(tasks.map(task => task.ownerId).concat((await readdir(sourceRoot)).filter(name => z.uuid().safeParse(name).success)))) {
    const owner = join(sourceRoot, ownerId), stagedOwner = join(stagingRoot, ownerId);
    if (!await info(owner)) throw new Error("MIGRATION_USER_HOME_MISSING");
    await assertDirectory(owner);
    await mkdir(join(stagedOwner, "home"), { recursive: true, mode: 0o770 });
    const commonHome = join(owner, "home");
    if (await info(commonHome)) await mergeTree(commonHome, join(stagedOwner, "home"), commonHome, new Set(["task-homes", "workspaces", ".agents", "node_modules"]));
    // Supervisor state cannot be exposed through the user's HOME. Old materialized
    // capability generations are rebuilt; their source packages remain in the store.
    for (const domain of await readdir(owner)) {
      if (["home", "managed", "control", "services"].includes(domain)) continue;
      await mergeTree(join(owner, domain), join(stagedOwner, domain), owner);
    }
    if (await info(join(owner, "control"))) await mergeTree(join(owner, "control"), join(stagedOwner, "control"), join(owner, "control"), new Set(["capabilities", "workspaces", "task-home-migration-backup"]));
    const personalNative = join(stagedOwner, "home", ".codex");
    const nativeHomes = new Set([personalNative]);
    for (const task of tasks.filter(task => task.ownerId === ownerId)) {
      const expectedOld = `${ownerId}/home/workspaces/${task.id}`;
      if (task.workspaceRelPath !== expectedOld) throw new Error("MIGRATION_WORKSPACE_LAYOUT_CONFLICT");
      const workspace = task.applicationId ? serviceWorkspaceRelativePath(ownerId, task.id) : projectWorkspaceRelativePath(ownerId, task.projectId);
      const home = task.applicationId ? join(stagingRoot, ownerId, "services", task.id, "home") : join(stagedOwner, "home");
      const importedDirectory = `imports/${task.id}`;
      const originalWorkspace = join(sourceRoot, expectedOld);
      const taskHome = join(commonHome, "task-homes", task.id);
      await mkdir(join(stagingRoot, workspace, importedDirectory), { recursive: true, mode: 0o770 });
      if (await info(originalWorkspace)) {
        await assertDirectory(originalWorkspace);
        await mergeTree(originalWorkspace, join(stagingRoot, workspace, importedDirectory), originalWorkspace, generated);
      }
      if (await info(taskHome)) {
        await assertDirectory(taskHome);
        await mergeTree(taskHome, home, taskHome, new Set([".agents", "node_modules", "workspaces", "workspace", "task-homes"]));
      }
      const native = join(home, ".codex");
      const found = new Set<string>();
      for (const domain of ["sessions", "archived_sessions"]) {
        for (const path of await files(join(native, domain))) {
          if (!path.endsWith(".jsonl")) continue;
          const first = (await readFile(path, "utf8")).split("\n", 1)[0]!;
          const meta = z.object({ type: z.literal("session_meta"), payload: z.object({ id: z.string() }) }).parse(JSON.parse(first));
          found.add(meta.payload.id);
        }
      }
      if (task.nativeThreadIds.some(id => !found.has(id))) throw new Error("MIGRATION_NATIVE_THREAD_MISSING");
      nativeHomes.add(native);
      const taskControl = join(home, "..", "control", "workspaces", task.id);
      const previousControl = join(owner, "control", "workspaces", task.id);
      if (await info(previousControl)) await mergeTree(previousControl, taskControl, previousControl, new Set(["workspace.json", "capabilities"]));
      await mkdir(taskControl, { recursive: true, mode: 0o700 });
      await writeFile(join(taskControl, "workspace.json"), JSON.stringify(task.applicationId ? "workspace" : task.projectId ? `projects/${task.projectId}` : "workspace"), { mode: 0o600 });
      converted.push({ id: task.id, ownerId, oldWorkspace: expectedOld, workspace, importedDirectory });
    }
    for (const domain of ["workspaces", "task-homes"]) {
      const oldRoot = join(commonHome, domain);
      if (!await info(oldRoot)) continue;
      await assertDirectory(oldRoot);
      for (const id of await readdir(oldRoot)) {
        if (tasks.some(task => task.id === id && task.ownerId === ownerId)) continue;
        if (!z.uuid().safeParse(id).success) throw new Error("MIGRATION_UNBOUND_DIRECTORY");
        if (domain === "workspaces") await mergeTree(join(oldRoot, id), join(stagedOwner, "home", "workspace", "imports", id), join(oldRoot, id), generated);
        // An unbound HOME may belong to a deleted application task. Preserve it
        // outside the active user environment instead of activating its credentials.
        else {
          const original = join(oldRoot, id);
          await assertDirectory(original);
          await cp(original, join(stagedOwner, "control", "recovered-task-homes", id), {
            recursive: true, dereference: false, verbatimSymlinks: true,
            errorOnExist: true, force: false, mode: constants.COPYFILE_FICLONE,
            filter: path => {
              const [root, child] = relative(original, path).split(sep);
              return ![".agents", "node_modules", "workspaces", "workspace", "task-homes"].includes(root!) &&
                !(root === ".codex" && child !== undefined && nativeHomeTemporaryEntries.has(child));
            },
          });
        }
      }
    }
    for (const native of nativeHomes) if (await info(native)) rewriteNativeRolloutPaths(native, input.nativeUserHome ?? "/home/linksense", !!await info(join(native, "state_5.sqlite")));
  }
  return converted;
}

export async function mergeTree(source: string, target: string, sourceRoot: string, excluded = new Set<string>(), child = ""): Promise<void> {
  if (excluded.has(child)) return;
  const entry = await lstat(source), existing = await info(target);
  if (entry.isSymbolicLink()) {
    const link = await readlink(source);
    const destination = resolve(source, "..", link);
    // Managed Node dependency links may occur inside generated project folders,
    // not only at the root. Their fixed runtime HOME destination stays valid
    // when a workspace is imported into the application environment.
    if (source.endsWith(`${sep}node_modules`) && link === "/home/linksense/.local/share/linksense/node/node_modules") {
      if (existing) { if (!existing.isSymbolicLink() || await readlink(target) !== link) throw new Error("MIGRATION_FILE_CONFLICT"); }
      else { await mkdir(resolve(target, ".."), { recursive: true }); await symlink(link, target); }
      return;
    }
    const legacyWorkspace = /[/\\]home[/\\]workspaces[/\\]([0-9a-f-]{36})$/u.exec(sourceRoot);
    if (legacyWorkspace && relative(sourceRoot, source) === "skills" &&
      (link === "../../.agents/skills" || link === `../../task-homes/${legacyWorkspace[1]}/.agents/skills`)) return;
    if (legacyWorkspace && [
      `/home/linksense/workspaces/${legacyWorkspace[1]}/node_modules`,
      "/home/linksense/.local/share/linksense/node/node_modules",
    ].includes(link)) {
      const modules = join(sourceRoot, "node_modules");
      const runtimeModules = "/home/linksense/.local/share/linksense/node/node_modules";
      if ((await info(modules))?.isSymbolicLink() && await readlink(modules) === runtimeModules) {
        if (existing) { if (!existing.isSymbolicLink() || await readlink(target) !== runtimeModules) throw new Error("MIGRATION_FILE_CONFLICT"); }
        else { await mkdir(resolve(target, ".."), { recursive: true }); await symlink(runtimeModules, target); }
        return;
      }
    }
    if (relative(sourceRoot, source).startsWith(".local/share/linksense/python/") &&
      /^\/usr\/local\/bin\/python(?:3(?:\.12)?)?$/u.test(link)) {
      if (existing) { if (!existing.isSymbolicLink() || await readlink(target) !== link) throw new Error("MIGRATION_FILE_CONFLICT"); }
      else { await mkdir(resolve(target, ".."), { recursive: true }); await symlink(link, target); }
      return;
    }
    // uv stores absolute cache links in the container's HOME. Rebase only
    // links inside this same HOME; other absolute paths remain conflicts.
    if (isAbsolute(link) && /[/\\]home$/u.test(sourceRoot) && link.startsWith("/home/linksense/")) {
      const runtimeRelative = relative("/home/linksense", resolve(link));
      if (!runtimeRelative.startsWith("..") && !isAbsolute(runtimeRelative) &&
        !["task-homes", "workspaces"].includes(runtimeRelative.split(sep)[0]!)) {
        const rebased = relative(resolve(source, ".."), join(sourceRoot, runtimeRelative));
        if (existing) { if (!existing.isSymbolicLink() || await readlink(target) !== rebased) throw new Error("MIGRATION_FILE_CONFLICT"); }
        else { await mkdir(resolve(target, ".."), { recursive: true }); await symlink(rebased, target); }
        return;
      }
    }
    // Relative links inside the migrated tree remain valid. Host or managed links
    // must be regenerated or explicitly resolved before conversion.
    if (isAbsolute(link) || relative(sourceRoot, destination).split(sep).includes("..")) throw new Error("MIGRATION_SYMLINK_CONFLICT", { cause: { source, link } });
    if (existing) { if (!existing.isSymbolicLink() || await readlink(target) !== link) throw new Error("MIGRATION_FILE_CONFLICT"); }
    else { await mkdir(resolve(target, ".."), { recursive: true }); await symlink(link, target); }
    return;
  }
  if (existing?.isSymbolicLink()) throw new Error("MIGRATION_PATH_INVALID");
  if (entry.isDirectory()) {
    if (existing && !existing.isDirectory()) throw new Error("MIGRATION_FILE_CONFLICT");
    await mkdir(target, { recursive: true, mode: entry.mode & 0o777 });
    const codex = source === join(sourceRoot, ".codex");
    const nativeExcluded = codex ? await prepareNativeHomeFiles(source, target) : new Set<string>();
    if (codex) await mergeNativeDatabases(source, target, { sourceIsTaskHome: /[/\\]home[/\\]task-homes[/\\][0-9a-f-]{36}$/u.test(sourceRoot) });
    for (const name of (await readdir(source)).sort()) {
      if (nativeExcluded.has(name)) continue;
      if (codex && (/\.sqlite(?:-wal|-shm)?$/u.test(name) || ["tmp", ".linksense"].includes(name))) continue;
      await mergeTree(join(source, name), join(target, name), sourceRoot, excluded, child ? `${child}/${name}` : name);
    }
    return;
  }
  if (!entry.isFile() || (entry.mode & 0o7000)) throw new Error("MIGRATION_FILE_TYPE_INVALID");
  if (existing) {
    if (!existing.isFile()) throw new Error("MIGRATION_FILE_CONFLICT", { cause: { source, target } });
    if (await digest(source) !== await digest(target)) {
      if (relative(sourceRoot, source).split(sep).join("/") === ".codex/AGENTS.md") {
        const sourceText = await readFile(source, "utf8"), targetText = await readFile(target, "utf8");
        const revisionHeader = /^<!-- linksense-personalization:v1 revision:[0-9a-f-]{36} -->\r?\n/u;
        if (revisionHeader.test(sourceText) && revisionHeader.test(targetText) && sourceText.replace(revisionHeader, "") === targetText.replace(revisionHeader, "")) return;
      }
      // Task isolation originally copied the shared rollout, then appended new
      // events. Preserve the longer history only when the shorter is its exact prefix.
      if (/^\.codex\/(?:sessions|archived_sessions)\/.+\.jsonl$/u.test(relative(sourceRoot, source).split(sep).join("/"))) {
        if (entry.size > existing.size && existing.size > 0 && await digest(source, existing.size) === await digest(target)) {
          await copyFile(source, target, constants.COPYFILE_FICLONE);
          if (await digest(source) !== await digest(target)) throw new Error("MIGRATION_SOURCE_CHANGED");
          return;
        }
        if (existing.size > entry.size && entry.size > 0 && await digest(target, entry.size) === await digest(source)) return;
      }
      throw new Error("MIGRATION_FILE_CONFLICT", { cause: { source, target } });
    }
    return;
  }
  await copyFile(source, target, constants.COPYFILE_EXCL | constants.COPYFILE_FICLONE);
  await chmod(target, entry.mode & 0o777);
  if (await digest(source) !== await digest(target)) throw new Error("MIGRATION_SOURCE_CHANGED");
}

export async function info(target: string): Promise<Stats | null> {
  try { return await lstat(target); } catch (error) { if (error instanceof Error && "code" in error && error.code === "ENOENT") return null; throw error; }
}
async function assertDirectory(path: string): Promise<void> { const entry = await lstat(path); if (!entry.isDirectory() || entry.isSymbolicLink()) throw new Error("MIGRATION_PATH_INVALID"); }
async function files(root: string): Promise<string[]> {
  if (!await info(root)) return [];
  await assertDirectory(root);
  const result: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error("MIGRATION_PATH_INVALID");
    if (entry.isDirectory()) result.push(...await files(join(root, entry.name)));
    else if (entry.isFile()) result.push(join(root, entry.name));
  }
  return result;
}
async function digest(path: string, length?: number): Promise<string> { const hash = createHash("sha256"); for await (const chunk of createReadStream(path, length === undefined ? undefined : { start: 0, end: length - 1 })) hash.update(chunk); return hash.digest("hex"); }
