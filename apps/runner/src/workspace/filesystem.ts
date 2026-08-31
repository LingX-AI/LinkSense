import { execFile } from "node:child_process"
import { randomUUID } from "node:crypto"
import type { Stats } from "node:fs"
import {
  chmod,
  lstat,
  open,
  readdir,
  rename,
  rm,
} from "node:fs/promises"
import path from "node:path"
import { promisify } from "node:util"

import {
  isolatedChildInvocation,
  type ProcessIdentity,
} from "../child-process-isolation.js"

export type DirectoryCleanupIdentity = ProcessIdentity

type ChmodDependencies = {
  chmodPath?: typeof chmod
  chmodAsIdentityPath?: typeof chmodAsIdentity
}

type IdentityOwnedFileInfo = Pick<
  Stats,
  "gid" | "isFile" | "isSymbolicLink" | "uid"
>

type IdentityOwnedFileDependencies = {
  effectiveUid?: number
  lstatPath?: (target: string) => Promise<IdentityOwnedFileInfo>
  removePath?: (target: string) => Promise<void>
  writeAsIdentityPath?: typeof writeRegularFileAsIdentity
}

const execFileAsync = promisify(execFile)
const maximumIdentityOwnedFileBytes = 256_000

export async function writeSharedRegularFileAtomically(
  target: string,
  contents: string,
  mode: number,
): Promise<void> {
  if (Buffer.byteLength(contents) > maximumIdentityOwnedFileBytes) {
    throw new IdentityOwnedFileBoundaryError("managed file is too large")
  }
  try {
    const current = await lstat(target)
    if (!current.isFile() || current.isSymbolicLink()) {
      throw new IdentityOwnedFileBoundaryError(
        "managed file boundary is invalid",
      )
    }
  } catch (error) {
    if (!isMissingPathError(error)) throw error
  }
  const directory = path.dirname(target)
  const directoryInfo = await lstat(directory)
  if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink()) {
    throw new IdentityOwnedFileBoundaryError(
      "managed file directory boundary is invalid",
    )
  }
  const temporaryPath = path.join(
    directory,
    `.${path.basename(target)}.${randomUUID()}.tmp`,
  )
  const handle = await open(temporaryPath, "wx", mode)
  try {
    await handle.writeFile(contents, "utf8")
    await handle.sync()
    await handle.chmod(mode)
  } finally {
    await handle.close()
  }
  try {
    await rename(temporaryPath, target)
    await syncDirectory(directory)
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined)
  }
}

export async function makeDirectoryTreeRemovable(
  root: string,
  fallbackIdentity?: DirectoryCleanupIdentity,
): Promise<void> {
  let info
  try {
    info = await lstat(root)
  } catch (error) {
    if (isMissingPathError(error)) return
    throw error
  }
  if (!info.isDirectory() || info.isSymbolicLink()) return

  try {
    await chmod(root, (info.mode & 0o7777) | 0o700)
  } catch (error) {
    if (!isPermissionError(error)) {
      throw error
    }
    if (hasSharedGroupRemovalAccess(info, process.getegid?.())) {
      // The supervisor can already traverse and remove this directory through
      // the shared task group, even though it does not own the inode.
    } else if (canWidenDirectoryAsIdentity(info, fallbackIdentity)) {
      await widenDirectoryForSharedGroup(root, info.mode, fallbackIdentity)
    } else {
      throw error
    }
  }
  const entries = await readdir(root, { withFileTypes: true })
  await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
      .map((entry) =>
        makeDirectoryTreeRemovable(
          path.join(root, entry.name),
          fallbackIdentity,
        ),
      ),
  )
}

export function hasSharedGroupRemovalAccess(
  info: Pick<Stats, "gid" | "mode">,
  effectiveGid: number | undefined,
): boolean {
  return (
    effectiveGid !== undefined &&
    info.gid === effectiveGid &&
    (info.mode & 0o070) === 0o070
  )
}

export function canWidenDirectoryAsIdentity(
  info: Pick<Stats, "gid" | "uid">,
  identity: DirectoryCleanupIdentity | undefined,
): identity is DirectoryCleanupIdentity {
  return (
    identity !== undefined &&
    info.uid === identity.uid &&
    info.gid === identity.gid
  )
}

export async function widenDirectoryForSharedGroup(
  directory: string,
  currentMode: number,
  identity: DirectoryCleanupIdentity,
): Promise<void> {
  const mode = (currentMode & 0o7777) | 0o770
  await chmodAsIdentity(directory, mode, identity)
}

export async function chmodWithFallbackIdentity(
  target: string,
  mode: number,
  info: Pick<Stats, "gid" | "uid">,
  fallbackIdentity: DirectoryCleanupIdentity | undefined,
  dependencies: ChmodDependencies = {},
): Promise<void> {
  const chmodPath = dependencies.chmodPath ?? chmod
  try {
    await chmodPath(target, mode)
    return
  } catch (error) {
    if (
      !isPermissionError(error) ||
      !canWidenDirectoryAsIdentity(info, fallbackIdentity)
    ) {
      throw error
    }
  }
  await (dependencies.chmodAsIdentityPath ?? chmodAsIdentity)(
    target,
    mode,
    fallbackIdentity,
  )
}

export class IdentityOwnedFileBoundaryError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "IdentityOwnedFileBoundaryError"
  }
}

export async function writeFileOwnedByIdentity(
  target: string,
  contents: string,
  mode: number,
  identity: DirectoryCleanupIdentity,
  dependencies: IdentityOwnedFileDependencies = {},
): Promise<void> {
  if (Buffer.byteLength(contents) > maximumIdentityOwnedFileBytes) {
    throw new IdentityOwnedFileBoundaryError("managed file is too large")
  }
  const lstatPath = dependencies.lstatPath ?? lstat
  let operation: "create" | "write" = "create"
  try {
    const info = await lstatPath(target)
    if (!info.isFile() || info.isSymbolicLink()) {
      throw new IdentityOwnedFileBoundaryError(
        "managed file boundary is invalid",
      )
    }
    if (canWidenDirectoryAsIdentity(info, identity)) {
      operation = "write"
    } else {
      const effectiveUid =
        dependencies.effectiveUid ??
        (typeof process.geteuid === "function"
          ? process.geteuid()
          : undefined)
      if (effectiveUid === undefined || info.uid !== effectiveUid) {
        throw new IdentityOwnedFileBoundaryError(
          "managed file owner is invalid",
        )
      }
      await (dependencies.removePath ??
        ((candidate) => rm(candidate, { force: true })))(target)
    }
  } catch (error) {
    if (!isMissingPathError(error)) throw error
  }
  await (dependencies.writeAsIdentityPath ?? writeRegularFileAsIdentity)(
    target,
    contents,
    mode,
    identity,
    operation,
  )
}

async function chmodAsIdentity(
  target: string,
  mode: number,
  identity: DirectoryCleanupIdentity,
): Promise<void> {
  const invocation = isolatedChildInvocation(
    process.execPath,
    [
      "-e",
      "require('node:fs').chmodSync(process.argv[1], Number(process.argv[2]))",
      target,
      String(mode),
    ],
    identity,
  )
  await execFileAsync(
    invocation.command,
    invocation.args,
    {
      timeout: 10_000,
      env: isolatedIdentityCommandEnvironment(),
    },
  )
}

async function writeRegularFileAsIdentity(
  target: string,
  contents: string,
  mode: number,
  identity: DirectoryCleanupIdentity,
  operation: "create" | "write",
): Promise<void> {
  const invocation = isolatedChildInvocation(
    process.execPath,
    [
      "-e",
      [
        "const fs = require('node:fs')",
        "const target = process.argv[1]",
        "const mode = Number(process.argv[2])",
        "const operation = process.argv[3]",
        "const contents = Buffer.from(process.argv[4], 'base64')",
        "if (operation === 'write') {",
        "  const info = fs.lstatSync(target)",
        "  if (!info.isFile() || info.isSymbolicLink()) throw new Error('invalid managed file')",
        "}",
        "fs.writeFileSync(target, contents, {",
        "  flag: operation === 'create' ? 'wx' : 'w',",
        "  mode,",
        "})",
        "fs.chmodSync(target, mode)",
      ].join("\n"),
      target,
      String(mode),
      operation,
      Buffer.from(contents).toString("base64"),
    ],
    identity,
  )
  await execFileAsync(
    invocation.command,
    invocation.args,
    {
      timeout: 10_000,
      env: isolatedIdentityCommandEnvironment(),
    },
  )
}

export function isolatedIdentityCommandEnvironment(): NodeJS.ProcessEnv {
  return {}
}

async function syncDirectory(directory: string): Promise<void> {
  const handle = await open(directory, "r")
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}

function isMissingPathError(error: unknown): error is NodeJS.ErrnoException {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  )
}

function isPermissionError(error: unknown): error is NodeJS.ErrnoException {
  return (
    error instanceof Error &&
    "code" in error &&
    ((error as NodeJS.ErrnoException).code === "EACCES" ||
      (error as NodeJS.ErrnoException).code === "EPERM")
  )
}
