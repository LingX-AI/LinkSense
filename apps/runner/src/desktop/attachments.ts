import { createHash } from "node:crypto"
import { lstat, mkdir, mkdtemp, open, readFile, readdir, realpath, rename, rm } from "node:fs/promises"
import path from "node:path"
import {
  DESKTOP_ATTACHMENT_GRANT_HEADER, desktopAttachmentDownloadPath, desktopServerOriginSchema,
  type DesktopAttachment, type DesktopExecutionCommand,
} from "@linksense/shared"
import { z } from "zod"
import { isNodeError } from "../controller/worker-provider-utils.js"
import type { WorkerOwnerPaths } from "../controller/worker-provider.js"
import type { TurnContextInput } from "../context.js"
import { CorruptStartOperationError, isSealedStartOperation, StartOperationStore } from "../start-operation.js"
import { writeSharedRegularFileAtomically } from "../workspace/filesystem.js"
import { WorkspaceManager } from "../workspace/workspace-manager.js"

type StartCommand = Extract<DesktopExecutionCommand, { operation: "turn.start" }>
type PreparedAttachments = {
  entries: TurnContextInput["attachments"]; discard: () => Promise<void>; forget: () => Promise<void>
}

export class DesktopAttachmentError extends Error {}

const stagingPrefix = "attachments-"
const stagedDirectory = /^attachments-([0-9a-f-]{36})-[a-z0-9]{6}$/iu
const publicationPrefix = "published-"
const publicationSchema = z.strictObject({ device: z.number().int(), inode: z.number().int() })
const attachmentParent = (paths: WorkerOwnerPaths) => path.join(paths.home, "workspace", "attachments")

// Called by the single desktop supervisor before starting workers.
export async function pruneDesktopAttachments(paths: WorkerOwnerPaths, ownerId: string, conversationId: string): Promise<void> {
  const check = await verifyOptionalDirectory(paths.root, paths.control)
  if (!check) return
  const parent = attachmentParent(paths)
  const workspace = new WorkspaceManager(paths.root, undefined, {
    fixedOwnerId: ownerId, fixedHomeRoot: paths.home, fixedControlRoot: paths.control,
  })
  const store = new StartOperationStore(workspace)
  for (const name of await readdir(paths.control)) {
    if (stagedDirectory.test(name)) {
      await check()
      await rm(path.join(paths.control, name), { recursive: true, force: true })
      continue
    }
    if (!name.startsWith(publicationPrefix)) continue
    const directory = name.slice(publicationPrefix.length)
    const turnId = z.uuid().safeParse(stagedDirectory.exec(directory)?.[1])
    if (!turnId.success) continue
    await check()
    const marker = path.join(paths.control, name)
    const info = await lstat(marker)
    if (!info.isFile() || info.size > 256) continue
    const publication = publicationSchema.safeParse(await readFile(marker, "utf8").then(readPublicationJson))
    if (!publication.success) continue
    // Retain files when durable native correlation makes delivery ambiguous.
    const journal = await store.read(conversationId, turnId.data).catch((error: unknown) => {
      if (error instanceof CorruptStartOperationError) return undefined
      throw error
    })
    if (journal === undefined) continue
    if (journal && (journal.ownerId !== ownerId ||
        (journal.runtimeGeneration !== undefined &&
          !await workspace.readRuntimeGeneration(conversationId, journal.runtimeGeneration)))) continue
    if (!journal || isSealedStartOperation(journal) || (!journal.correlation && journal.status !== "succeeded")) {
      const destination = path.join(parent, directory)
      const checkParent = await verifyOptionalDirectory(paths.root, parent)
      if (checkParent) {
        await checkParent()
        const published = await lstat(destination).catch((error: unknown) => {
          if (isNodeError(error, "ENOENT")) return null
          throw error
        })
        if (published?.isDirectory() &&
            published.dev === publication.data.device && published.ino === publication.data.inode) {
          await rm(destination, { recursive: true })
        }
      }
    }
    await check()
    await rm(marker)
  }
}

/** This runs in the supervisor before a worker or native turn can access the files. */
export async function prepareDesktopAttachments(
  paths: WorkerOwnerPaths, origin: string, command: StartCommand, signal: AbortSignal,
): Promise<PreparedAttachments> {
  let staged: string | undefined
  let pendingMarker: string | undefined
  let checkControl: (() => Promise<void>) | undefined
  try {
    const parent = attachmentParent(paths)
    // The supervisor is the sole writer during preparation. Strict Codex
    // permissions deny access to control; the workspace worker is not alive.
    const { check: controlDirectory } = await verifyDirectory(paths.root, paths.control)
    checkControl = controlDirectory
    const { check: checkWorkspace } = await verifyDirectory(paths.root, path.dirname(parent))
    await checkWorkspace()
    await mkdir(parent, { mode: 0o700 }).catch((error: unknown) => {
      if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error
    })
    const { check: checkParent } = await verifyDirectory(paths.root, parent)
    const base = desktopServerOriginSchema.parse(origin)
    await checkControl()
    const temporary = await mkdtemp(path.join(paths.control, `${stagingPrefix}${command.turn_id}-`))
    staged = temporary
    const { check: checkStage } = await verifyDirectory(paths.root, temporary)
    const directory = path.basename(temporary)
    const destination = path.join(parent, directory)
    const entries: PreparedAttachments["entries"] = []
    for (const file of command.body.attachments ?? []) {
      signal.throwIfAborted()
      await checkStage()
      await mkdir(path.join(temporary, file.id), { mode: 0o700 })
      await downloadFile(base, command, file, path.join(temporary, file.id, file.filename), signal)
      entries.push({ filename: file.filename, homeRelativePath: `workspace/attachments/${directory}/${file.id}/${file.filename}` })
    }
    await checkStage()
    await checkParent()
    const expected = await lstat(temporary)
    const marker = path.join(paths.control, `${publicationPrefix}${directory}`)
    pendingMarker = marker
    await checkControl()
    await writeSharedRegularFileAtomically(marker, JSON.stringify({ device: expected.dev, inode: expected.ino }), 0o600)
    await checkStage()
    await checkParent()
    signal.throwIfAborted()
    await rename(temporary, destination)
    staged = undefined
    pendingMarker = undefined
    const forget = async () => {
      await controlDirectory()
      await rm(marker, { force: true })
    }
    return {
      entries, forget,
      discard: async () => {
        await checkParent()
        const current = await lstat(destination)
        if (current.dev !== expected.dev || current.ino !== expected.ino || !current.isDirectory()) {
          throw new DesktopAttachmentError()
        }
        await rm(destination, { recursive: true })
        await forget()
      },
    }
  } catch {
    throw new DesktopAttachmentError()
  } finally {
    if (checkControl && (staged || pendingMarker)) {
      await checkControl()
      if (staged) await rm(staged, { recursive: true, force: true })
      if (pendingMarker) await rm(pendingMarker, { force: true })
    }
  }
}

function readPublicationJson(text: string): unknown {
  try { return JSON.parse(text) } catch { return undefined }
}

async function verifyOptionalDirectory(root: string, directory: string): Promise<(() => Promise<void>) | null> {
  return verifyDirectory(root, directory).then(({ check }) => check).catch((error: unknown) => {
    if (isNodeError(error, "ENOENT") || error instanceof DesktopAttachmentError) return null
    throw error
  })
}

export async function verifyDirectory(
  root: string, directory: string, { requirePrivate = true }: { requirePrivate?: boolean } = {},
): Promise<{ path: string; check: () => Promise<void> }> {
  const canonicalRoot = await realpath(root)
  const relative = path.relative(root, directory)
  if (!relative || relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative)) {
    throw new DesktopAttachmentError()
  }
  const canonical = path.resolve(canonicalRoot, relative)
  const read = async () => {
    const info = await lstat(directory)
    if (!info.isDirectory() || await realpath(directory) !== canonical || (requirePrivate && (info.mode & 0o007) !== 0)) {
      throw new DesktopAttachmentError()
    }
    return info
  }
  const initial = await read()
  const check = async () => {
    const info = await read()
    if (initial.dev !== info.dev || initial.ino !== info.ino) throw new DesktopAttachmentError()
  }
  return { path: canonical, check }
}

async function downloadFile(
  origin: string, command: StartCommand, file: DesktopAttachment, destination: string, signal: AbortSignal,
): Promise<void> {
  const url = new URL(`${desktopAttachmentDownloadPath}/${command.turn_id}/${file.id}`, origin)
  const response = await fetch(url, {
    redirect: "error", signal, cache: "no-store",
    headers: {
      authorization: `Bearer ${command.body.credentials.run_token}`,
      [DESKTOP_ATTACHMENT_GRANT_HEADER]: file.download_grant,
      "accept-encoding": "identity",
    },
  })
  if (response.status !== 200 || response.headers.get("content-type") !== "application/octet-stream" ||
      response.headers.get("content-length") !== String(file.size_bytes) ||
      response.headers.has("content-encoding") || !response.body) {
    await response.body?.cancel()
    throw new DesktopAttachmentError()
  }
  const reader = response.body.getReader()
  try {
    const handle = await open(destination, "wx", 0o600)
    try {
      const hash = createHash("sha256")
      let count = 0
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        signal.throwIfAborted()
        count += value.byteLength
        if (count > file.size_bytes) throw new DesktopAttachmentError()
        hash.update(value)
        await handle.writeFile(value)
      }
      if (count !== file.size_bytes || hash.digest("hex") !== file.sha256) throw new DesktopAttachmentError()
    } finally { await handle.close() }
  } finally {
    await reader.cancel().catch(() => undefined)
  }
}
