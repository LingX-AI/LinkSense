import { createHash } from "node:crypto"
import type { BigIntStats } from "node:fs"
import { lstat, readdir } from "node:fs/promises"
import path from "node:path"
import { buffer } from "node:stream/consumers"

import {
  webBundleArchiveMaxBytes, webBundleLimits, webBundlePathSchema, webBundleResourcePathSchema,
} from "@linksense/shared"
import JSZip from "jszip"

import {
  DESKTOP_ARTIFACT_CHUNK_BYTES, DesktopArtifactSourceError, openDesktopArtifactSource,
  type DesktopArtifactSource,
} from "./artifact-source.js"
import { verifyDirectory } from "./attachments.js"

export async function openDesktopWebsiteArtifactSource(input: {
  workspaceRoot: string
  workspaceRelativePath: string
  webRootRelativePath: string
  signal: AbortSignal
  checkWorkspace?: () => Promise<void>
}): Promise<{ source: DesktopArtifactSource; entryPath: string }> {
  const { workspaceRoot, signal } = input
  signal.throwIfAborted()
  const entry = webBundlePathSchema.safeParse(input.workspaceRelativePath)
  const root = webBundlePathSchema.safeParse(input.webRootRelativePath)
  if (!entry.success || !root.success) throw invalidArtifact()
  const prefix = `${root.data}/`
  if (!entry.data.startsWith(prefix)) throw invalidArtifact()
  const entryPath = entry.data.slice(prefix.length)
  if (!/\.html?$/iu.test(entryPath)) throw invalidArtifact()

  const siteRoot = path.join(workspaceRoot, ...root.data.split("/"))
  const { path: verifiedRoot, check } = await verifyDirectory(workspaceRoot, siteRoot, { requirePrivate: false }).catch(() => {
    throw invalidArtifact()
  })
  await input.checkWorkspace?.().catch(() => { throw forbiddenArtifact() })

  const zip = new JSZip()
  const stats = new Map<string, BigIntStats>()
  let files = 0
  let entries = 0
  let totalBytes = 0
  const listStat = async (target: string) => lstat(target, { bigint: true }).catch(() => { throw busyArtifact() })
  const visit = async (directory: string, relative: string, depth: number): Promise<void> => {
    signal.throwIfAborted()
    if (depth > webBundleLimits.depth) throw limitExceeded()
    await check().catch(() => { throw busyArtifact() })
    const directoryStat = await listStat(directory)
    if (!directoryStat.isDirectory()) throw forbiddenArtifact()
    stats.set(directory, directoryStat)
    const listing = await readdir(directory, { withFileTypes: true }).catch(() => { throw invalidArtifact() })
    for (const item of listing) {
      signal.throwIfAborted()
      if (++entries > webBundleLimits.entries) throw limitExceeded()
      const absolute = path.join(directory, item.name)
      const relativePath = relative ? `${relative}/${item.name}` : item.name
      if (!webBundlePathSchema.safeParse(relativePath).success) throw invalidArtifact()
      const info = await listStat(absolute)
      if (info.isSymbolicLink()) throw forbiddenArtifact()
      if (info.isDirectory()) {
        await visit(absolute, relativePath, depth + 1)
        continue
      }
      if (!info.isFile() || info.nlink !== 1n) throw forbiddenArtifact()
      if (!webBundleResourcePathSchema.safeParse(relativePath).success) throw invalidArtifact()
      if (++files > webBundleLimits.files) throw limitExceeded()
      const file = await openDesktopArtifactSource(
        workspaceRoot, `${prefix}${relativePath}`, Math.min(webBundleLimits.fileBytes, webBundleLimits.totalBytes - totalBytes),
        signal, input.checkWorkspace,
      )
      try {
        if (BigInt(file.sizeBytes) !== info.size) throw busyArtifact()
        const bytes = await buffer(file.read(signal))
        totalBytes += bytes.length
        zip.file(relativePath, bytes, { createFolders: false })
        stats.set(absolute, info)
      } finally {
        await file.close()
      }
    }
  }
  await visit(verifiedRoot, "", 0)
  if (!zip.file(entryPath)) throw invalidArtifact()
  // Recheck the whole tree so a concurrent edit cannot mix different saves.
  for (const [target, before] of stats) {
    signal.throwIfAborted()
    const after = await listStat(target)
    if (after.dev !== before.dev || after.ino !== before.ino || after.size !== before.size ||
        after.mtimeNs !== before.mtimeNs || after.ctimeNs !== before.ctimeNs) throw busyArtifact()
  }
  await input.checkWorkspace?.().catch(() => { throw forbiddenArtifact() })
  await check().catch(() => { throw busyArtifact() })
  const archive = await zip.generateAsync({ type: "nodebuffer", compression: "STORE" })
  if (archive.length === 0 || archive.length > webBundleArchiveMaxBytes) throw limitExceeded()
  signal.throwIfAborted()
  await check().catch(() => { throw busyArtifact() })
  return { entryPath, source: archiveArtifactSource(archive) }
}

function archiveArtifactSource(archive: Buffer): DesktopArtifactSource {
  const sha256 = createHash("sha256").update(archive).digest("hex")
  let closed = false
  return {
    sizeBytes: archive.length,
    sha256,
    async *read(signal: AbortSignal): AsyncGenerator<Buffer> {
      if (closed) throw invalidArtifact()
      for (let offset = 0; offset < archive.length; offset += DESKTOP_ARTIFACT_CHUNK_BYTES) {
        signal.throwIfAborted()
        yield archive.subarray(offset, Math.min(offset + DESKTOP_ARTIFACT_CHUNK_BYTES, archive.length))
      }
      signal.throwIfAborted()
    },
    async close() { closed = true },
  }
}

function invalidArtifact(): DesktopArtifactSourceError {
  return new DesktopArtifactSourceError("ARTIFACT_REGISTRATION_INVALID")
}

function limitExceeded(): DesktopArtifactSourceError {
  return new DesktopArtifactSourceError("FILE_LIMIT_EXCEEDED")
}

function forbiddenArtifact(): DesktopArtifactSourceError {
  return new DesktopArtifactSourceError("FILE_SERVICE_FORBIDDEN")
}

function busyArtifact(): DesktopArtifactSourceError {
  return new DesktopArtifactSourceError("ARTIFACT_REGISTRATION_BUSY")
}
