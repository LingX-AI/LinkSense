import { createHash, randomUUID } from "node:crypto"
import { constants } from "node:fs"
import { chmod, chown, copyFile, lstat, mkdir, mkdtemp, open, readdir, rename, rm } from "node:fs/promises"
import path from "node:path"
import { tmpdir } from "node:os"
import { stageTaskNativeState } from "./task-native-state-migration.js"
import { z } from "zod"

const taskSchema = z.strictObject({
  ownerId: z.uuid(),
  conversationId: z.uuid(),
  nativeThreadIds: z.array(z.string().min(1).max(240)),
})
const sessionSchema = z.object({
  type: z.literal("session_meta"),
  payload: z.object({ id: z.string().min(1), cwd: z.string().optional() }),
})
export type TaskHomeMigrationTask = z.infer<typeof taskSchema>
export type TaskHomeMigrationResult = { tasks: number; files: number; copied: number; unchanged: number; retired: number; dryRun: boolean }

/** Offline, explicit migration only. The runner never searches legacy homes. */
export async function migrateTaskCodexHomes(input: {
  userDataRoot: string
  tasks: TaskHomeMigrationTask[]
  dryRun: boolean
  ownership?: { uid: number; gid: number }
  controlOwnership?: { uid: number; gid: number }
}): Promise<TaskHomeMigrationResult> {
  if (!path.isAbsolute(input.userDataRoot)) throw new Error("MIGRATION_ROOT_INVALID")
  const root = path.resolve(input.userDataRoot)
  const tasks = z.array(taskSchema).parse(input.tasks)
  const bindings = new Map<string, TaskHomeMigrationTask>()
  for (const task of tasks) {
    for (const threadId of task.nativeThreadIds) {
      const key = `${task.ownerId}/${threadId}`
      const previous = bindings.get(key)
      if (previous && previous.conversationId !== task.conversationId) throw new Error("MIGRATION_THREAD_BINDING_CONFLICT")
      bindings.set(key, task)
    }
  }
  // Retire ambient discovery paths even for owners with no remaining tasks.
  const ownerIds = new Set(tasks.map((task) => task.ownerId))
  await assertExistingDirectoryChain(root, root)
  if (await inspect(root)) {
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (z.uuid().safeParse(entry.name).success) ownerIds.add(entry.name)
    }
  }
  const retiredPlans: Array<{ source: string; target: string; control: string }> = []
  for (const ownerId of ownerIds) {
    const owner = path.join(root, ownerId)
    const control = path.join(owner, "control")
    const backup = path.join(control, "task-home-migration-backup")
    for (const [relative, name] of [
      ["managed/agents/skills", "skills"],
      ["managed/agents/plugin-sources", "plugin-sources"],
      ["managed/agents/plugins", "plugins"],
      ["home/.codex/skills", "codex-skills"],
      ["control/capabilities", "capabilities"],
    ]) {
      const source = path.join(owner, relative!)
      await assertExistingDirectoryChain(root, source)
      if (!await inspect(source)) continue
      const target = path.join(backup, name!)
      await assertExistingDirectoryChain(root, path.dirname(target))
      if (await inspect(target)) throw new Error("MIGRATION_BACKUP_CONFLICT")
      retiredPlans.push({ source, target, control })
    }
  }
  const plans: Array<{ source: string; target: string; home: string; digest: string }> = []
  const found = new Set<string>()
  const retainedByTask = new Map(tasks.map((task) => [task.conversationId, new Set(task.nativeThreadIds)]))
  for (const ownerId of new Set(tasks.map((task) => task.ownerId))) {
    const ownerHome = path.join(root, ownerId, "home")
    await assertExistingDirectoryChain(root, ownerHome)
    const sourceHome = path.join(ownerHome, ".codex")
    for (const domain of ["sessions", "archived_sessions"]) {
      for (const source of await rolloutFiles(root, path.join(sourceHome, domain))) {
        const metadata = await sessionMetadata(source)
        const byId = bindings.get(`${ownerId}/${metadata.id}`)
        const byWorkspace = tasks.find((task) => task.ownerId === ownerId && [
          path.join(ownerHome, "workspaces", task.conversationId),
          path.posix.join("/home/linksense/workspaces", task.conversationId),
        ].includes(metadata.cwd ?? ""))
        const task = byId ?? byWorkspace
        if (!task) continue
        const home = path.join(ownerHome, "task-homes", task.conversationId)
        const target = path.join(home, ".codex", path.relative(sourceHome, source))
        retainedByTask.get(task.conversationId)?.add(metadata.id)
        plans.push({ source, target, home, digest: await fileDigest(source) })
        found.add(`${ownerId}/${metadata.id}`)
      }
    }
  }
  // Validate the complete plan before writing anything. Previously migrated
  // tasks and newly created tasks can already have their native files here.
  for (const task of tasks) {
    const missing = task.nativeThreadIds.filter((id) => !found.has(`${task.ownerId}/${id}`))
    if (!missing.length) continue
    const home = path.join(root, task.ownerId, "home", "task-homes", task.conversationId, ".codex")
    const present = new Set<string>()
    for (const domain of ["sessions", "archived_sessions"]) {
      for (const file of await rolloutFiles(root, path.join(home, domain))) present.add((await sessionMetadata(file)).id)
    }
    if (missing.some((id) => !present.has(id))) throw new Error("MIGRATION_NATIVE_THREAD_MISSING")
  }
  const scratch = await mkdtemp(path.join(tmpdir(), "linksense-native-migration-"))
  try {
    for (const task of tasks) {
      const stagingRoot = path.join(scratch, task.conversationId)
      await mkdir(stagingRoot, { mode: 0o700 })
      const home = path.join(root, task.ownerId, "home", "task-homes", task.conversationId)
      const sourceHome = path.join(root, task.ownerId, "home", ".codex")
      await assertExistingDirectoryChain(root, sourceHome)
      const files = await stageTaskNativeState({
        sourceHome, stagingRoot,
        threadIds: [...retainedByTask.get(task.conversationId) ?? []],
        nativeCodexHome: path.posix.join("/home/linksense/task-homes", task.conversationId, ".codex"),
      })
      for (const file of files) plans.push({ source: file.source, target: path.join(home, ".codex", file.name), home, digest: await fileDigest(file.source) })
    }
  for (const plan of plans) {
    await assertExistingDirectoryChain(root, path.dirname(plan.target))
    const existing = await inspect(plan.target)
    if (existing && (!existing.isFile() || existing.isSymbolicLink() || await fileDigest(plan.target) !== plan.digest)) {
      throw new Error("MIGRATION_TARGET_CONFLICT")
    }
  }
  const result: TaskHomeMigrationResult = { tasks: tasks.length, files: plans.length, copied: 0, unchanged: 0, retired: 0, dryRun: input.dryRun }
  if (input.dryRun) return result
  for (const plan of plans) {
    if (await fileDigest(plan.source) !== plan.digest) throw new Error("MIGRATION_SOURCE_CHANGED")
    if (await inspect(plan.target)) {
      // An interrupted/manual copy may have correct bytes but a root-owned
      // 0600 file. Repair only verified task history, never the legacy source.
      await ensureOwnedDirectories(root, plan.home, path.dirname(plan.target), input.ownership)
      await chmod(plan.target, 0o600)
      if (input.ownership) await chown(plan.target, input.ownership.uid, input.ownership.gid)
      result.unchanged += 1
      continue
    }
    await ensureOwnedDirectories(root, plan.home, path.dirname(plan.target), input.ownership)
    const staging = path.join(path.dirname(plan.target), `.migration-${randomUUID()}`)
    try {
      await copyFile(plan.source, staging, constants.COPYFILE_EXCL)
      await chmod(staging, 0o600)
      if (input.ownership) await chown(staging, input.ownership.uid, input.ownership.gid)
      if (await fileDigest(staging) !== plan.digest || await fileDigest(plan.source) !== plan.digest) throw new Error("MIGRATION_SOURCE_CHANGED")
      const handle = await open(staging, "r")
      try { await handle.sync() } finally { await handle.close() }
      // The command requires stopped workers. Never replace an existing file.
      if (await inspect(plan.target)) throw new Error("MIGRATION_TARGET_CONFLICT")
      await rename(staging, plan.target)
      const directory = await open(path.dirname(plan.target), "r")
      try { await directory.sync() } finally { await directory.close() }
      result.copied += 1
    } finally {
      await rm(staging, { force: true })
    }
  }
  // No legacy capability directory remains in native discovery paths. Backups
  // stay in supervisor-only control storage and are never a runtime fallback.
  for (const plan of retiredPlans) {
    for (const directory of [plan.control, path.dirname(plan.target)]) {
      await mkdir(directory, { recursive: true, mode: 0o700 })
      await chmod(directory, 0o700)
      if (input.controlOwnership) await chown(directory, input.controlOwnership.uid, input.controlOwnership.gid)
    }
    await rename(plan.source, plan.target)
    for (const parent of [path.dirname(plan.source), path.dirname(plan.target)]) {
      const directory = await open(parent, "r")
      try { await directory.sync() } finally { await directory.close() }
    }
    result.retired += 1
  }
  return result
  } finally { await rm(scratch, { recursive: true, force: true }) }
}

async function inspect(target: string) {
  try { return await lstat(target) } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null
    throw error
  }
}

async function assertExistingDirectoryChain(root: string, target: string): Promise<void> {
  const relative = path.relative(root, target)
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error("MIGRATION_PATH_INVALID")
  for (const directory of [root, ...relative.split(path.sep).filter(Boolean).map((_, index, parts) => path.join(root, ...parts.slice(0, index + 1)))]) {
    const info = await inspect(directory)
    if (!info) return
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("MIGRATION_PATH_INVALID")
  }
}

async function rolloutFiles(root: string, directory: string): Promise<string[]> {
  await assertExistingDirectoryChain(root, directory)
  if (!await inspect(directory)) return []
  const files: string[] = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error("MIGRATION_PATH_INVALID")
    const child = path.join(directory, entry.name)
    if (entry.isDirectory()) files.push(...await rolloutFiles(root, child))
    else if (entry.isFile() && entry.name.endsWith(".jsonl")) files.push(child)
  }
  return files
}

async function sessionMetadata(file: string): Promise<z.infer<typeof sessionSchema>["payload"]> {
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const buffer = Buffer.alloc(128_000)
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
    const end = buffer.subarray(0, bytesRead).indexOf(10)
    if (end < 0) throw new Error("MIGRATION_SESSION_METADATA_INVALID")
    return sessionSchema.parse(JSON.parse(buffer.subarray(0, end).toString("utf8"))).payload
  } finally { await handle.close() }
}

async function fileDigest(file: string): Promise<string> {
  const hash = createHash("sha256")
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    for await (const data of handle.createReadStream({ autoClose: false })) hash.update(data)
    return hash.digest("hex")
  } finally { await handle.close() }
}

async function ensureOwnedDirectories(root: string, home: string, target: string, identity?: { uid: number; gid: number }): Promise<void> {
  await assertExistingDirectoryChain(root, target)
  await mkdir(path.dirname(home), { recursive: true, mode: 0o770 })
  await chmod(path.dirname(home), 0o770)
  if (identity) await chown(path.dirname(home), identity.uid, identity.gid)
  const suffix = path.relative(home, target).split(path.sep).filter(Boolean)
  for (const directory of [home, ...suffix.map((_, index) => path.join(home, ...suffix.slice(0, index + 1)))]) {
    await mkdir(directory, { recursive: true, mode: 0o770 })
    await chmod(directory, 0o770)
    if (identity) await chown(directory, identity.uid, identity.gid)
  }
}
