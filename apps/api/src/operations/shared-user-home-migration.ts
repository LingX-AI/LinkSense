import { createHash } from "node:crypto"
import { createReadStream } from "node:fs"
import { chmod, chown, cp, lstat, mkdir, mkdtemp, open, readdir, rename, rm } from "node:fs/promises"
import path from "node:path"
import { z } from "zod"

const taskSchema = z.strictObject({ ownerId: z.uuid(), conversationId: z.uuid() })
type Identity = { uid: number; gid: number }
type Conflict = { ownerId: string; relativePath: string; reason: "different_state" }
export type ToolHomeConsolidationResult = { units: number; copied: number; unchanged: number; dryRun: boolean; conflicts: Conflict[] }

// These are platform storage domains, not a list of credential locations.
const managedPaths = new Set([".codex", ".agents", "node_modules", "task-homes", "workspaces", ".local/share/linksense"])
const namespacePaths = new Set(["", ".config", ".cache", ".local", ".local/share", ".local/state"])

/** Explicit offline file consolidation. Runtime never reads old tool homes. */
export async function consolidateUserToolHomes(input: {
  userDataRoot: string
  tasks: Array<z.infer<typeof taskSchema>>
  dryRun: boolean
  ownership?: Identity
}): Promise<ToolHomeConsolidationResult> {
  if (!path.isAbsolute(input.userDataRoot)) throw new Error("MIGRATION_ROOT_INVALID")
  const root = path.resolve(input.userDataRoot)
  const tasks = z.array(taskSchema).parse(input.tasks)
  const plans = new Map<string, { source: string; home: string; relativePath: string; digest: string; exists: boolean }>()
  const conflicts = new Map<string, Conflict>()
  let units = 0
  for (const task of tasks) {
    const home = path.join(root, task.ownerId, "home")
    const taskHome = path.join(home, "task-homes", task.conversationId)
    await assertDirectoryChain(root, taskHome)
    if (!(await inspect(taskHome))) continue
    for (const relativePath of await toolUnits(taskHome)) {
      units++
      const source = path.join(taskHome, relativePath)
      const target = path.join(home, relativePath)
      await assertDirectoryChain(root, path.dirname(target))
      const digest = await treeDigest(source)
      const prior = plans.get(target)
      const exists = prior?.exists ?? !!(await inspect(target))
      if ((prior && prior.digest !== digest) || (!prior && exists && await treeDigest(target) !== digest)) {
        conflicts.set(target, { ownerId: task.ownerId, relativePath, reason: "different_state" })
      }
      if (!prior) plans.set(target, { source, home, relativePath, digest, exists })
    }
  }
  const result: ToolHomeConsolidationResult = { units, copied: 0, unchanged: [...plans].filter(([target, p]) => p.exists && !conflicts.has(target)).length, dryRun: input.dryRun, conflicts: [...conflicts.values()] }
  if (input.dryRun) return result
  // Validate every task before copying anything. Never choose between accounts.
  if (conflicts.size) throw new Error("MIGRATION_TOOL_STATE_CONFLICT")
  for (const [target, plan] of plans) {
    if (plan.exists) continue
    await assertDirectoryChain(root, path.dirname(target))
    await ensureParents(plan.home, path.dirname(target), input.ownership)
    // Stage beside the destination for an atomic same-filesystem publication.
    const staging = await mkdtemp(path.join(path.dirname(target), ".linksense-tool-home-"))
    try {
      await chmod(staging, 0o700)
      const staged = path.join(staging, "state")
      await cp(plan.source, staged, { recursive: true, force: false, errorOnExist: true, preserveTimestamps: true })
      if (await treeDigest(staged) !== plan.digest || await treeDigest(plan.source) !== plan.digest) throw new Error("MIGRATION_TOOL_SOURCE_CHANGED")
      await normalizeOwnership(staged, input.ownership)
      await syncTree(staged)
      if (await inspect(target)) throw new Error("MIGRATION_TOOL_TARGET_CHANGED")
      await rename(staged, target)
      await syncPath(path.dirname(target))
      result.copied++
    } finally { await rm(staging, { recursive: true, force: true }) }
  }
  return result
}

async function toolUnits(home: string, relative = ""): Promise<string[]> {
  const units: string[] = []
  for (const entry of await readdir(path.join(home, relative), { withFileTypes: true })) {
    const child = path.join(relative, entry.name)
    if (managedPaths.has(child)) continue
    if (namespacePaths.has(child) && entry.isDirectory()) units.push(...await toolUnits(home, child))
    else units.push(child)
  }
  return units
}

async function treeDigest(target: string): Promise<string> {
  const hash = createHash("sha256")
  async function visit(file: string, relative: string): Promise<void> {
    const info = await lstat(file)
    if (info.isSymbolicLink() || (!info.isDirectory() && !info.isFile()) || (info.mode & 0o7000) !== 0) throw new Error("MIGRATION_TOOL_PATH_INVALID")
    // Compare full trees and permissions: do not combine two account profiles.
    hash.update(JSON.stringify([relative, info.isDirectory() ? "directory" : "file", info.mode & 0o777, info.isFile() ? info.size : 0]))
    if (info.isDirectory()) {
      for (const name of (await readdir(file)).sort()) await visit(path.join(file, name), path.join(relative, name))
    } else {
      for await (const data of createReadStream(file)) hash.update(data)
    }
  }
  await visit(target, "")
  return hash.digest("hex")
}

async function inspect(target: string): Promise<Awaited<ReturnType<typeof lstat>> | null> {
  try { return await lstat(target) }
  catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null
    throw error
  }
}

async function assertDirectoryChain(root: string, target: string): Promise<void> {
  const relative = path.relative(root, target)
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error("MIGRATION_TOOL_PATH_INVALID")
  let current = root
  for (const part of ["", ...relative.split(path.sep)]) {
    current = path.join(current, part)
    const info = await inspect(current)
    if (!info) return
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("MIGRATION_TOOL_PATH_INVALID")
  }
}

async function ensureParents(home: string, target: string, identity: Identity | undefined): Promise<void> {
  let current = home
  for (const part of path.relative(home, target).split(path.sep).filter(Boolean)) {
    current = path.join(current, part)
    if (await inspect(current)) continue
    await mkdir(current, { mode: 0o700 })
    if (identity) await chown(current, identity.uid, identity.gid)
  }
}

async function normalizeOwnership(target: string, identity: Identity | undefined): Promise<void> {
  if (!identity) return
  const info = await lstat(target)
  if (info.isDirectory()) for (const name of await readdir(target)) await normalizeOwnership(path.join(target, name), identity)
  await chown(target, identity.uid, identity.gid)
}

async function syncPath(target: string): Promise<void> {
  const handle = await open(target, "r")
  try { await handle.sync() } finally { await handle.close() }
}

async function syncTree(target: string): Promise<void> {
  if ((await lstat(target)).isDirectory()) for (const name of await readdir(target)) await syncTree(path.join(target, name))
  await syncPath(target)
}
