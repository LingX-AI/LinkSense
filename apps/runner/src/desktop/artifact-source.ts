import { createHash } from "node:crypto"
import { constants } from "node:fs"
import type { BigIntStats } from "node:fs"
import { lstat, open, realpath, type FileHandle } from "node:fs/promises"
import path from "node:path"

import { isNodeError } from "../controller/worker-provider-utils.js"
import { FileServiceRequestError } from "../file-service-error.js"

/**
 * Fixed snapshot size for both the digest pass and streamed upload chunks.
 * Memory stays bounded to one chunk regardless of the artifact size.
 */
export const DESKTOP_ARTIFACT_CHUNK_BYTES = 1024 * 1024

/** Darwin `O_NOFOLLOW_ANY` from sys/fcntl.h; Node's constants do not expose it. */
const DARWIN_O_NOFOLLOW_ANY = 0x20000000

// Darwin rejects combining O_NOFOLLOW_ANY with O_NOFOLLOW.
const OPEN_FLAGS =
  constants.O_RDONLY |
  constants.O_NONBLOCK |
  (process.platform === "darwin" ? DARWIN_O_NOFOLLOW_ANY : constants.O_NOFOLLOW)

export type DesktopArtifactSourceErrorCode =
  | "ARTIFACT_NOT_FOUND"
  | "ARTIFACT_REGISTRATION_BUSY"
  | "ARTIFACT_REGISTRATION_INVALID"
  | "ARTIFACT_REGISTRATION_UNAVAILABLE"
  | "FILE_LIMIT_EXCEEDED"
  | "FILE_SERVICE_FORBIDDEN"

const ERROR_DETAILS: Record<
  DesktopArtifactSourceErrorCode,
  { retryable: boolean; statusCode: number }
> = {
  ARTIFACT_NOT_FOUND: { retryable: false, statusCode: 404 },
  ARTIFACT_REGISTRATION_BUSY: { retryable: true, statusCode: 409 },
  ARTIFACT_REGISTRATION_INVALID: { retryable: false, statusCode: 400 },
  ARTIFACT_REGISTRATION_UNAVAILABLE: { retryable: true, statusCode: 503 },
  FILE_LIMIT_EXCEEDED: { retryable: false, statusCode: 413 },
  FILE_SERVICE_FORBIDDEN: { retryable: false, statusCode: 403 },
}

/**
 * Stable failure for local artifact snapshots. The message is the error code
 * alone so workspace-relative or absolute user paths never reach diagnostics.
 */
export class DesktopArtifactSourceError extends FileServiceRequestError {
  constructor(code: DesktopArtifactSourceErrorCode) {
    const details = ERROR_DETAILS[code]
    super(code, details.retryable, details.statusCode)
    this.name = "DesktopArtifactSourceError"
  }
}

export interface DesktopArtifactSource {
  readonly sizeBytes: number
  readonly sha256: string
  read(signal: AbortSignal): AsyncGenerator<Buffer>
  close(): Promise<void>
}

interface PinnedArtifactFile {
  readonly handle: FileHandle
  readonly root: string
  readonly segments: readonly string[]
  readonly sizeBytes: number
  readonly dev: bigint
  readonly ino: bigint
  readonly mtimeNs: bigint
  readonly ctimeNs: bigint
  readonly rootDev: bigint
  readonly rootIno: bigint
  readonly checkWorkspace?: () => Promise<void>
  closed: boolean
}

/**
 * Opens a bounded snapshot of a regular file that is a strict descendant of
 * the canonical workspace root. Dot components, backslashes and absolute
 * paths are refused before resolution; symlinks in any workspace-relative
 * component, hardlinks, devices and FIFOs are refused at the filesystem. The
 * descriptor is pinned with Darwin O_NOFOLLOW_ANY (O_NOFOLLOW elsewhere) and the root
 * and file identities are verified before, during and after both the digest
 * pass and each streamed upload. Callers must close() the source, including
 * after a failed read; a generator must be drained for the final count/digest
 * verification to run.
 */
export async function openDesktopArtifactSource(
  workspaceRoot: string,
  workspaceRelativePath: string,
  maximumBytes: number,
  signal: AbortSignal,
  checkWorkspace?: () => Promise<void>,
): Promise<DesktopArtifactSource> {
  signal.throwIfAborted()
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 0) {
    throw artifactError("ARTIFACT_REGISTRATION_INVALID")
  }
  const segments = validatedSegments(workspaceRelativePath)
  await checkWorkspace?.().catch(() => { throw artifactError("FILE_SERVICE_FORBIDDEN") })
  const root = await canonicalWorkspaceRoot(workspaceRoot, checkWorkspace !== undefined)
  const target = path.join(root.path, ...segments)
  if (!isStrictDescendant(root.path, target)) {
    throw artifactError("ARTIFACT_REGISTRATION_INVALID")
  }

  const listed = await inspectSafePath(root.path, segments, "ARTIFACT_NOT_FOUND")
  if (listed.size > BigInt(maximumBytes)) {
    throw artifactError("FILE_LIMIT_EXCEEDED")
  }
  signal.throwIfAborted()

  const handle = await guarded(() => open(target, OPEN_FLAGS), "ARTIFACT_NOT_FOUND")
  try {
    const opened = await guarded(
      () => handle.stat({ bigint: true }),
      "ARTIFACT_REGISTRATION_INVALID",
    )
    if (!opened.isFile() || opened.nlink !== 1n) {
      throw artifactError("FILE_SERVICE_FORBIDDEN")
    }
    if (opened.dev !== listed.dev || opened.ino !== listed.ino) {
      throw artifactError("ARTIFACT_REGISTRATION_BUSY")
    }
    if (opened.size > BigInt(maximumBytes)) {
      throw artifactError("FILE_LIMIT_EXCEEDED")
    }

    const state: PinnedArtifactFile = {
      handle,
      root: root.path,
      segments,
      sizeBytes: Number(opened.size),
      dev: opened.dev,
      ino: opened.ino,
      mtimeNs: opened.mtimeNs,
      ctimeNs: opened.ctimeNs,
      rootDev: root.dev,
      rootIno: root.ino,
      ...(checkWorkspace && { checkWorkspace }),
      closed: false,
    }
    const sha256 = await hashPinnedFile(state, signal)
    signal.throwIfAborted()
    return {
      sizeBytes: state.sizeBytes,
      sha256,
      read: (readSignal) => streamPinned(state, readSignal, sha256),
      close: async () => {
        if (state.closed) return
        state.closed = true
        await state.handle.close()
      },
    }
  } catch (error) {
    await closeQuietly(handle)
    if (signal.aborted) throw signal.reason
    throw error instanceof DesktopArtifactSourceError
      ? error
      : mapFsError(error, "ARTIFACT_REGISTRATION_INVALID")
  }
}

/** Digest pass: fully drain the shared verified stream and take its digest. */
async function hashPinnedFile(
  state: PinnedArtifactFile,
  signal: AbortSignal,
): Promise<string> {
  const iterator = streamPinned(state, signal, null)
  for (;;) {
    const next = await iterator.next()
    if (next.done) return next.value
  }
}

/**
 * The single verified read path. It serves both the pre-upload digest pass
 * (expectedSha256 null) and each upload read, checking cancellation and the
 * pinned descriptor per chunk and the pinned path before and after the pass.
 */
async function* streamPinned(
  state: PinnedArtifactFile,
  signal: AbortSignal,
  expectedSha256: string | null,
): AsyncGenerator<Buffer, string> {
  assertReadable(state)
  signal.throwIfAborted()
  await verifyPinnedDescriptor(state)
  await verifyPinnedPath(state)
  signal.throwIfAborted()

  const digest = createHash("sha256")
  let offset = 0
  while (offset < state.sizeBytes) {
    assertReadable(state)
    signal.throwIfAborted()
    const length = Math.min(
      DESKTOP_ARTIFACT_CHUNK_BYTES,
      state.sizeBytes - offset,
    )
    const chunk = Buffer.allocUnsafe(length)
    const bytesRead = await readAt(state, chunk, length, offset, signal)
    if (bytesRead === 0 || offset + bytesRead > state.sizeBytes) {
      throw artifactError("ARTIFACT_REGISTRATION_BUSY")
    }
    await verifyPinnedDescriptor(state)
    const data = chunk.subarray(0, bytesRead)
    digest.update(data)
    offset += bytesRead
    signal.throwIfAborted()
    yield data
  }

  signal.throwIfAborted()
  await verifyPinnedDescriptor(state)
  await verifyPinnedPath(state)
  signal.throwIfAborted()

  const actual = digest.digest("hex")
  if (
    offset !== state.sizeBytes ||
    (expectedSha256 !== null && actual !== expectedSha256)
  ) {
    throw artifactError("ARTIFACT_REGISTRATION_BUSY")
  }
  return actual
}

async function readAt(
  state: PinnedArtifactFile,
  buffer: Buffer,
  length: number,
  offset: number,
  signal: AbortSignal,
): Promise<number> {
  try {
    return (await state.handle.read(buffer, 0, length, offset)).bytesRead
  } catch (error) {
    if (signal.aborted) throw signal.reason
    throw mapFsError(error, "ARTIFACT_REGISTRATION_INVALID")
  }
}

async function verifyPinnedDescriptor(
  state: PinnedArtifactFile,
): Promise<void> {
  const current = await guarded(
    () => state.handle.stat({ bigint: true }),
    "ARTIFACT_REGISTRATION_INVALID",
  )
  if (!sameAsPinned(current, state)) {
    throw artifactError("ARTIFACT_REGISTRATION_BUSY")
  }
}

async function verifyPinnedPath(state: PinnedArtifactFile): Promise<void> {
  await state.checkWorkspace?.().catch(() => { throw artifactError("FILE_SERVICE_FORBIDDEN") })
  const root = await guarded(
    () => lstat(state.root, { bigint: true }),
    "ARTIFACT_REGISTRATION_BUSY",
  )
  if (
    !root.isDirectory() ||
    root.dev !== state.rootDev ||
    root.ino !== state.rootIno
  ) {
    throw artifactError("ARTIFACT_REGISTRATION_BUSY")
  }
  const current = await inspectSafePath(
    state.root,
    state.segments,
    "ARTIFACT_REGISTRATION_BUSY",
  )
  if (!sameAsPinned(current, state)) {
    throw artifactError("ARTIFACT_REGISTRATION_BUSY")
  }
}

function sameAsPinned(
  current: BigIntStats,
  state: PinnedArtifactFile,
): boolean {
  return (
    current.isFile() &&
    current.nlink === 1n &&
    current.dev === state.dev &&
    current.ino === state.ino &&
    current.size === BigInt(state.sizeBytes) &&
    current.mtimeNs === state.mtimeNs &&
    current.ctimeNs === state.ctimeNs
  )
}

async function inspectSafePath(
  root: string,
  segments: readonly string[],
  missing: DesktopArtifactSourceErrorCode,
): Promise<BigIntStats> {
  let current = root
  for (const segment of segments.slice(0, -1)) {
    current = path.join(current, segment)
    const info = await guarded(() => lstat(current, { bigint: true }), missing)
    if (info.isSymbolicLink()) {
      throw artifactError("FILE_SERVICE_FORBIDDEN")
    }
    if (!info.isDirectory()) {
      throw artifactError(missing)
    }
  }

  const finalPath = path.join(root, ...segments)
  const final = await guarded(() => lstat(finalPath, { bigint: true }), missing)
  if (final.isSymbolicLink() || !final.isFile() || final.nlink !== 1n) {
    throw artifactError("FILE_SERVICE_FORBIDDEN")
  }
  const canonical = await guarded(() => realpath(finalPath), missing)
  if (!isStrictDescendant(root, canonical)) {
    throw artifactError("FILE_SERVICE_FORBIDDEN")
  }
  return final
}

async function canonicalWorkspaceRoot(
  workspaceRoot: string,
  admitted: boolean,
): Promise<{ path: string; dev: bigint; ino: bigint }> {
  if (
    typeof workspaceRoot !== "string" ||
    workspaceRoot.length === 0 ||
    workspaceRoot.includes("\0")
  ) {
    throw artifactError("ARTIFACT_REGISTRATION_INVALID")
  }
  // An admitted path is already canonical; never follow a replacement alias.
  const root = admitted ? workspaceRoot : await guarded(
    () => realpath(workspaceRoot),
    "ARTIFACT_NOT_FOUND",
  )
  const info = await guarded(
    () => lstat(root, { bigint: true }),
    "ARTIFACT_NOT_FOUND",
  )
  if (info.isSymbolicLink()) throw artifactError("FILE_SERVICE_FORBIDDEN")
  if (!info.isDirectory()) {
    throw artifactError("ARTIFACT_REGISTRATION_INVALID")
  }
  return { path: root, dev: info.dev, ino: info.ino }
}

/**
 * Rejects dot components, empty components, NUL, backslashes and absolute
 * paths before any resolution, so no input can normalize onto a trusted path.
 */
function validatedSegments(value: string): string[] {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.includes("\0") ||
    value.includes("\\") ||
    path.isAbsolute(value) ||
    path.win32.isAbsolute(value)
  ) {
    throw artifactError("ARTIFACT_REGISTRATION_INVALID")
  }
  const segments = value.split("/")
  if (
    segments.some(
      (segment) => segment.length === 0 || segment === "." || segment === "..",
    )
  ) {
    throw artifactError("ARTIFACT_REGISTRATION_INVALID")
  }
  return segments
}

function isStrictDescendant(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate)
  return (
    relative.length > 0 &&
    relative !== ".." &&
    !path.isAbsolute(relative) &&
    !relative.startsWith(`..${path.sep}`)
  )
}

async function guarded<T>(
  operation: () => Promise<T>,
  missing: DesktopArtifactSourceErrorCode,
): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    throw mapFsError(error, missing)
  }
}

/** Single redacted mapping for every filesystem failure. */
function mapFsError(
  error: unknown,
  missing: DesktopArtifactSourceErrorCode,
): DesktopArtifactSourceError {
  if (
    isNodeError(error, "ENOENT") ||
    isNodeError(error, "ENOTDIR") ||
    isNodeError(error, "ESTALE")
  ) {
    return artifactError(missing)
  }
  if (
    isNodeError(error, "ELOOP") ||
    isNodeError(error, "EACCES") ||
    isNodeError(error, "EPERM") ||
    isNodeError(error, "EISDIR")
  ) {
    return artifactError("FILE_SERVICE_FORBIDDEN")
  }
  if (
    isNodeError(error, "ENAMETOOLONG") ||
    isNodeError(error, "EINVAL") ||
    isNodeError(error, "EBADF")
  ) {
    return artifactError("ARTIFACT_REGISTRATION_INVALID")
  }
  return artifactError("ARTIFACT_REGISTRATION_UNAVAILABLE")
}

function assertReadable(state: PinnedArtifactFile): void {
  if (state.closed) {
    throw artifactError("ARTIFACT_REGISTRATION_INVALID")
  }
}

async function closeQuietly(handle: FileHandle): Promise<void> {
  // Cleanup must not mask the original failure.
  await handle.close().catch(() => undefined)
}

function artifactError(
  code: DesktopArtifactSourceErrorCode,
): DesktopArtifactSourceError {
  return new DesktopArtifactSourceError(code)
}
