import { randomUUID } from "node:crypto"
import { chmod, copyFile, lstat, mkdir, mkdtemp, readFile, readdir, readlink, rename, rm, rmdir, symlink } from "node:fs/promises"
import path from "node:path"
import { capabilitySnapshotDirectory, capabilitySnapshotIdSchema, capabilitySnapshotManifest, capabilitySnapshotSchema } from "@linksense/shared"
import { isNodeError } from "../controller/worker-provider-utils.js"
import type { WorkerOwnerPaths } from "../controller/worker-provider.js"
import { writeSharedRegularFileAtomically } from "../workspace/filesystem.js"

/** Install the same built-in-only snapshot produced by the server's publisher. */
export async function initializeDesktopCapabilities(runtimeRoot: string, paths: WorkerOwnerPaths): Promise<string> {
  const source = path.join(runtimeRoot, "capabilities")
  const manifest = capabilitySnapshotSchema.parse(JSON.parse(await readFile(path.join(source, capabilitySnapshotManifest), "utf8")))
  if (manifest.pluginNames.length !== 0) throw new Error("desktop bundle contains unexpected plugins")
  const snapshots = path.join(paths.managedAgents, capabilitySnapshotDirectory)
  const control = path.join(paths.control, "capabilities")
  const snapshot = path.join(snapshots, manifest.id)
  const current = path.join(paths.managedAgents, "current")
  const target = `${capabilitySnapshotDirectory}/${manifest.id}`
  const currentInfo = await statIfPresent(current)
  if (currentInfo) {
    if (!currentInfo.isSymbolicLink()) throw new Error("invalid desktop capability binding")
    const previous = await readlink(current)
    const id = path.basename(previous)
    if (previous !== `${capabilitySnapshotDirectory}/${id}` || !capabilitySnapshotIdSchema.safeParse(id).success) {
      throw new Error("invalid desktop capability binding")
    }
  }
  await ensureDirectory(snapshots, 0o750)
  await ensureDirectory(control, 0o700)
  if (!await statIfPresent(snapshot)) {
    const staging = await mkdtemp(path.join(snapshots, ".install-"))
    try {
      await copyDirectory(source, staging)
      await rename(staging, snapshot)
    } finally {
      await rm(staging, { force: true, recursive: true })
    }
  }
  for (const entry of ["skills", "plugins", "plugin-sources"]) {
    const destination = path.join(paths.managedAgents, entry)
    const link = `current/${entry}`
    const info = await statIfPresent(destination)
    if (info?.isSymbolicLink()) {
      if (await readlink(destination) !== link) throw new Error("invalid desktop capability link")
      continue
    }
    // The pre-execution runtime created these three empty directories.
    if (info) await rmdir(destination)
    await symlink(link, destination)
  }
  await writeSharedRegularFileAtomically(path.join(control, "capability-content-sha256"), `${manifest.contentDigest}\n`, 0o600)
  await writeSharedRegularFileAtomically(path.join(control, "capability-source-sha256"), `${manifest.sourceDigest}\n`, 0o600)
  await writeSharedRegularFileAtomically(path.join(control, "capability-generation"), `${manifest.generation}\n`, 0o600)
  const projection = path.join(paths.managedAgents, `.current-${randomUUID()}`)
  try {
    await symlink(target, projection)
    await rename(projection, current)
  } finally { await rm(projection, { force: true }) }
  return manifest.generation
}

async function statIfPresent(target: string) {
  return lstat(target).catch((error: unknown) => { if (isNodeError(error, "ENOENT")) return null; throw error })
}

async function ensureDirectory(target: string, mode: number): Promise<void> {
  await mkdir(target, { mode }).catch((error: unknown) => { if (!isNodeError(error, "EEXIST")) throw error })
  const info = await lstat(target)
  if (!info.isDirectory() || info.uid !== process.geteuid?.() || (info.mode & 0o022) !== 0) {
    throw new Error("invalid desktop capability directory")
  }
  await chmod(target, mode)
}

async function copyDirectory(source: string, destination: string): Promise<void> {
  await chmod(destination, 0o750)
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name), to = path.join(destination, entry.name)
    if (entry.isDirectory()) {
      await mkdir(to, { mode: 0o750 })
      await copyDirectory(from, to)
    } else if (entry.isFile()) {
      await copyFile(from, to)
      await chmod(to, (await lstat(from)).mode & 0o111 ? 0o750 : 0o640)
    } else throw new Error("invalid desktop capability bundle entry")
  }
}
