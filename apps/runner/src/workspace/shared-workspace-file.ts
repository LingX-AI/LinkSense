import { randomUUID } from "node:crypto"
import {
  chmod,
  link,
  lstat,
  mkdir,
  open,
  realpath,
  rm,
} from "node:fs/promises"
import path from "node:path"

import { workspacePermissionPolicy } from "@linksense/shared"

export class SharedWorkspaceBoundaryError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "SharedWorkspaceBoundaryError"
  }
}

export async function ensureSharedWorkspaceDirectory(
  workspaceRoot: string,
  directory: string,
): Promise<void> {
  const relative = path.relative(workspaceRoot, directory)
  if (
    relative === "" ||
    relative.startsWith("..") ||
    path.isAbsolute(relative) ||
    relative.split(path.sep).some((segment) => segment === "..")
  ) {
    throw new SharedWorkspaceBoundaryError(
      "shared directory must be inside the workspace",
    )
  }

  let created = false
  try {
    await mkdir(directory, {
      mode: workspacePermissionPolicy.sharedDirectory,
    })
    created = true
  } catch (error) {
    if (!isNodeError(error, "EEXIST")) throw error
  }

  const [rootInfo, directoryInfo] = await Promise.all([
    lstat(workspaceRoot),
    lstat(directory),
  ])
  if (
    !rootInfo.isDirectory() ||
    rootInfo.isSymbolicLink() ||
    !directoryInfo.isDirectory() ||
    directoryInfo.isSymbolicLink()
  ) {
    throw new SharedWorkspaceBoundaryError(
      "shared workspace boundary is invalid",
    )
  }
  const [canonicalRoot, canonicalDirectory] = await Promise.all([
    realpath(workspaceRoot),
    realpath(directory),
  ])
  if (!canonicalDirectory.startsWith(`${canonicalRoot}${path.sep}`)) {
    throw new SharedWorkspaceBoundaryError(
      "shared directory resolves outside the workspace",
    )
  }
  if (created) {
    await chmod(directory, workspacePermissionPolicy.sharedDirectory)
  }
}

export async function writeSharedWorkspaceFile(
  workspaceRoot: string,
  target: string,
  contents: Uint8Array,
): Promise<void> {
  const directory = path.dirname(target)
  await ensureSharedWorkspaceDirectory(workspaceRoot, directory)
  const temporaryPath = path.join(
    directory,
    `.${path.basename(target)}.${randomUUID()}.tmp`,
  )
  const handle = await open(
    temporaryPath,
    "wx",
    workspacePermissionPolicy.sharedReadableFile,
  )
  try {
    await handle.writeFile(contents)
    await handle.sync()
    await handle.chmod(workspacePermissionPolicy.sharedReadableFile)
  } finally {
    await handle.close()
  }
  try {
    await link(temporaryPath, target)
    await syncDirectory(directory)
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined)
  }
}

export async function removeSharedWorkspaceFile(
  workspaceRoot: string,
  target: string,
): Promise<void> {
  const relative = path.relative(workspaceRoot, target)
  if (
    relative.startsWith("..") ||
    path.isAbsolute(relative) ||
    relative.split(path.sep).some((segment) => segment === "..")
  ) {
    throw new SharedWorkspaceBoundaryError(
      "shared file must be inside the workspace",
    )
  }
  await rm(target, { force: true })
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
