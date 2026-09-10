import { randomUUID } from "node:crypto"
import type { Stats } from "node:fs"
import { chmod, lstat, mkdir, open, readFile, readdir, readlink, rename, rm } from "node:fs/promises"
import path from "node:path"
import { lock } from "proper-lockfile"
import {
  capabilitySnapshotDirectory,
  capabilitySnapshotIdSchema,
  capabilitySnapshotManifest,
  capabilitySnapshotSchema,
  type CapabilitySnapshot,
} from "@linksense/shared"

/** Only API-owned immutable files live here; never task state or credentials. */
export class CapabilitySnapshotStore {
  readonly root: string
  private readonly control: string
  private readonly tasks: string

  constructor(ownerRoot: string) {
    this.root = path.join(ownerRoot, "managed", "agents", capabilitySnapshotDirectory)
    this.tasks = path.join(ownerRoot, "managed", "agents", "tasks")
    this.control = path.join(ownerRoot, "control", "capability-snapshots")
  }

  async initialize(): Promise<void> {
    await ensureDirectory(this.root, 0o750)
    await ensureDirectory(this.control, 0o700)
  }

  async withBuildLock<T>(key: string, action: () => Promise<T>): Promise<T> {
    if (!/^[a-f0-9]{64}$/u.test(key)) throw new Error("invalid snapshot key")
    await this.initialize()
    return this.withLock(`build-${key}`, action)
  }

  async withCatalogLock<T>(action: () => Promise<T>): Promise<T> {
    await this.initialize()
    return this.withLock("catalog", action)
  }

  private async withLock<T>(name: string, action: () => Promise<T>): Promise<T> {
    const release = await lock(path.join(this.control, name), {
      realpath: false,
      lockfilePath: path.join(this.control, `${name}.lock`),
      stale: 120_000,
      update: 10_000,
      retries: { retries: 240, factor: 1.2, minTimeout: 10, maxTimeout: 250 },
    })
    try { return await action() } finally { await release() }
  }

  snapshotPath(snapshot: CapabilitySnapshot): string {
    return path.join(this.root, capabilitySnapshotIdSchema.parse(snapshot.id))
  }

  async read(key: string): Promise<CapabilitySnapshot | null> {
    if (!/^[a-f0-9]{64}$/u.test(key)) throw new Error("invalid snapshot key")
    const index = path.join(this.control, `${key}.json`)
    const info = await maybeStat(index)
    if (!info) return null
    assertRegularFile(info, 0o600)
    if (info.size > 64 * 1024) throw new Error("snapshot index is too large")
    const snapshot = capabilitySnapshotSchema.parse(JSON.parse(await readFile(index, "utf8")))
    const root = this.snapshotPath(snapshot)
    const rootInfo = await maybeStat(root)
    // Unreferenced snapshots are bounded; an evicted cache entry is a miss.
    if (!rootInfo) return null
    assertDirectory(rootInfo, 0o750)
    const manifest = path.join(root, capabilitySnapshotManifest)
    const manifestInfo = await lstat(manifest)
    assertRegularFile(manifestInfo, 0o640)
    if (manifestInfo.size > 64 * 1024) throw new Error("snapshot manifest is too large")
    const published = capabilitySnapshotSchema.parse(JSON.parse(await readFile(manifest, "utf8")))
    if (JSON.stringify(snapshot) !== JSON.stringify(published)) throw new Error("snapshot manifest mismatch")
    return snapshot
  }

  /** Caller holds catalog lock until this snapshot is bound to its task. */
  async install(key: string, snapshot: CapabilitySnapshot, stagedRoot: string): Promise<void> {
    await rename(stagedRoot, this.snapshotPath(snapshot))
    await syncDirectory(this.root)
    await writeSnapshotFile(path.join(this.control, `${key}.json`), snapshot, 0o600)
  }

  /** Publication and cleanup serialize only metadata, never a full build. */
  async prune(): Promise<void> {
    const referenced = new Set<string>()
    for (const task of await readdir(this.tasks, { withFileTypes: true })) {
      if (!task.isSymbolicLink()) continue
      const target = await readlink(path.join(this.tasks, task.name))
      const id = path.basename(target)
      if (target === `../${capabilitySnapshotDirectory}/${id}` && capabilitySnapshotIdSchema.safeParse(id).success) referenced.add(id)
    }
    const candidates: Array<{ id: string; time: number }> = []
    for (const entry of await readdir(this.root, { withFileTypes: true })) {
      if (!capabilitySnapshotIdSchema.safeParse(entry.name).success) continue
      if (!entry.isDirectory() || entry.isSymbolicLink()) throw new Error("snapshot cleanup boundary is invalid")
      if (!referenced.has(entry.name)) candidates.push({ id: entry.name, time: (await lstat(path.join(this.root, entry.name))).mtimeMs })
    }
    // Keep a small warm cache after task deletion; referenced history is never evicted.
    const removed = new Set<string>()
    for (const candidate of candidates.sort((a, b) => b.time - a.time).slice(2)) {
      await rm(path.join(this.root, candidate.id), { recursive: true })
      removed.add(candidate.id)
    }
    if (removed.size === 0) return
    for (const entry of await readdir(this.control, { withFileTypes: true })) {
      if (!/^[a-f0-9]{64}\.json$/u.test(entry.name)) continue
      const index = path.join(this.control, entry.name)
      const info = await lstat(index)
      assertRegularFile(info, 0o600)
      if (info.size > 64 * 1024) throw new Error("snapshot index is too large")
      const snapshot = capabilitySnapshotSchema.parse(JSON.parse(await readFile(index, "utf8")))
      if (removed.has(snapshot.id)) await rm(index)
    }
    await syncDirectory(this.root)
    await syncDirectory(this.control)
  }
}

export async function writeSnapshotFile(target: string, value: CapabilitySnapshot, mode: number): Promise<void> {
  const temporary = `${target}.${randomUUID()}.tmp`
  try {
    const file = await open(temporary, "wx", mode)
    try {
      await file.chmod(mode)
      await file.writeFile(JSON.stringify(capabilitySnapshotSchema.parse(value)))
      await file.sync()
    } finally { await file.close() }
    await rename(temporary, target)
    await syncDirectory(path.dirname(target))
  } finally { await rm(temporary, { force: true }) }
}

async function ensureDirectory(target: string, mode: number): Promise<void> {
  let created = true
  await mkdir(target, { mode }).catch((error: unknown) => {
    if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error
    created = false
  })
  if (created) await chmod(target, mode)
  assertDirectory(await lstat(target), mode)
}

function assertDirectory(info: Stats, mode: number): void {
  if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== process.getuid?.() || info.gid !== process.getgid?.() || (info.mode & 0o7777) !== mode) throw new Error("snapshot directory boundary is invalid")
}

function assertRegularFile(info: Stats, mode: number): void {
  if (!info.isFile() || info.isSymbolicLink() || info.uid !== process.getuid?.() || info.gid !== process.getgid?.() || (info.mode & 0o7777) !== mode) throw new Error("snapshot file boundary is invalid")
}

async function maybeStat(target: string): Promise<Stats | null> {
  return lstat(target).catch((error: unknown) => {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null
    throw error
  })
}

async function syncDirectory(target: string): Promise<void> {
  const file = await open(target, "r")
  try { await file.sync() } finally { await file.close() }
}
