import {
  chown,
  chmod,
  lstat,
  open,
  readFile,
  readdir,
  rename,
  rm,
} from "node:fs/promises"
import path from "node:path"
import { randomUUID } from "node:crypto"

import {
  linksenseRuntimeIdentity,
  workspacePermissionPolicy,
} from "@linksense/shared"

export const workspacePermissionLayoutVersion = 1
export const workspacePermissionMarkerName =
  `.workspace-permissions-v${workspacePermissionLayoutVersion}`

export type WorkspacePermissionRepairSummary = {
  directories: number
  files: number
  normalizedOwners: number
  skippedLinks: number
  skippedSpecialEntries: number
}

type RuntimeIdentities = {
  apiUid: number
  taskUid: number
  sharedGid: number
}

type RepairOnceInput = {
  workspacesRoot: string
  markerPath: string
  identities?: RuntimeIdentities
}

export class WorkspacePermissionRepairError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "WorkspacePermissionRepairError"
  }
}

export async function repairWorkspacePermissionsOnce(
  input: RepairOnceInput,
): Promise<{
  applied: boolean
  summary: WorkspacePermissionRepairSummary
}> {
  const identities = input.identities ?? linksenseRuntimeIdentity
  if (await hasValidMarker(input.markerPath, identities)) {
    return { applied: false, summary: emptySummary() }
  }

  const summary = emptySummary()
  await repairEntry(input.workspacesRoot, identities, summary, true)
  await writeMarker(input.markerPath, identities)
  return { applied: true, summary }
}

export async function repairTaskOwnedRegularFileIfExists(
  target: string,
  identities: RuntimeIdentities = linksenseRuntimeIdentity,
  mode: number = workspacePermissionPolicy.sharedWritableFile,
  dependencies: {
    lstat: typeof lstat
    chown: typeof chown
    chmod: typeof chmod
  } = { lstat, chown, chmod },
): Promise<boolean> {
  let info
  try {
    info = await dependencies.lstat(target)
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return false
    throw error
  }
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new WorkspacePermissionRepairError(
      "managed task file boundary is invalid",
    )
  }
  if (info.uid !== identities.taskUid || info.gid !== identities.sharedGid) {
    await dependencies.chown(target, identities.taskUid, identities.sharedGid)
  }
  if ((info.mode & 0o7777) !== mode) await dependencies.chmod(target, mode)
  return true
}

async function repairEntry(
  target: string,
  identities: RuntimeIdentities,
  summary: WorkspacePermissionRepairSummary,
  root: boolean,
): Promise<void> {
  let info
  try {
    info = await lstat(target)
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return
    throw error
  }
  if (info.isSymbolicLink()) {
    summary.skippedLinks += 1
    return
  }
  if (info.isDirectory()) {
    const ownerUid = root
      ? identities.taskUid
      : normalizedOwner(info.uid, identities)
    if (info.uid !== ownerUid || info.gid !== identities.sharedGid) {
      await chown(target, ownerUid, identities.sharedGid)
      summary.normalizedOwners += 1
    }
    if ((info.mode & 0o7777) !== workspacePermissionPolicy.sharedDirectory) {
      await chmod(target, workspacePermissionPolicy.sharedDirectory)
    }
    summary.directories += 1
    let entries
    try {
      entries = await readdir(target, { withFileTypes: true })
    } catch (error) {
      if (isNodeError(error, "ENOENT")) return
      throw error
    }
    for (const entry of entries) {
      await repairEntry(
        path.join(target, entry.name),
        identities,
        summary,
        false,
      )
    }
    return
  }
  if (info.isFile()) {
    const ownerUid = normalizedOwner(info.uid, identities)
    if (info.uid !== ownerUid || info.gid !== identities.sharedGid) {
      await chown(target, ownerUid, identities.sharedGid)
      summary.normalizedOwners += 1
    }
    const mode =
      (info.mode & 0o111) !== 0
        ? workspacePermissionPolicy.sharedExecutableFile
        : workspacePermissionPolicy.sharedReadableFile
    if ((info.mode & 0o7777) !== mode) await chmod(target, mode)
    summary.files += 1
    return
  }
  summary.skippedSpecialEntries += 1
}

async function hasValidMarker(
  markerPath: string,
  identities: RuntimeIdentities,
): Promise<boolean> {
  let info
  try {
    info = await lstat(markerPath)
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return false
    throw error
  }
  if (info.isDirectory()) {
    throw new WorkspacePermissionRepairError(
      "workspace permission marker boundary is invalid",
    )
  }
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    info.uid !== identities.apiUid ||
    info.gid !== identities.sharedGid ||
    (info.mode & 0o777) !== workspacePermissionPolicy.supervisorPrivateFile ||
    info.size > 64
  ) {
    return false
  }
  const content = await readFile(markerPath, "utf8")
  return content === `${workspacePermissionLayoutVersion}\n`
}

async function writeMarker(
  markerPath: string,
  identities: RuntimeIdentities,
): Promise<void> {
  const temporaryPath = path.join(
    path.dirname(markerPath),
    `.${path.basename(markerPath)}.${randomUUID()}.tmp`,
  )
  const handle = await open(
    temporaryPath,
    "wx",
    workspacePermissionPolicy.supervisorPrivateFile,
  )
  try {
    await handle.writeFile(`${workspacePermissionLayoutVersion}\n`, "utf8")
    await handle.sync()
  } finally {
    await handle.close()
  }
  try {
    // Docker Desktop bind mounts do not reliably persist FileHandle.chown().
    // Normalizing by path after close keeps local and Linux production mounts
    // on the same ownership contract.
    await chown(temporaryPath, identities.apiUid, identities.sharedGid)
    await chmod(
      temporaryPath,
      workspacePermissionPolicy.supervisorPrivateFile,
    )
    await rename(temporaryPath, markerPath)
    await syncDirectory(path.dirname(markerPath))
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined)
    throw error
  }
}

function normalizedOwner(
  currentUid: number,
  identities: RuntimeIdentities,
): number {
  return currentUid === identities.apiUid || currentUid === identities.taskUid
    ? currentUid
    : identities.taskUid
}

function emptySummary(): WorkspacePermissionRepairSummary {
  return {
    directories: 0,
    files: 0,
    normalizedOwners: 0,
    skippedLinks: 0,
    skippedSpecialEntries: 0,
  }
}

async function syncDirectory(directory: string): Promise<void> {
  const handle = await open(directory, "r")
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}

function isNodeError(
  error: unknown,
  code: string,
): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code
}
