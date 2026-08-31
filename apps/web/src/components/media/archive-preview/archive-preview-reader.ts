import {
  BlobReader,
  ZipReader,
  type Entry,
  type FileEntry,
} from "@zip.js/zip.js"

import {
  ARCHIVE_PREVIEW_LIMITS,
  ArchivePreviewError,
  buildArchivePreviewManifest,
  type ArchivePreviewItem,
  type ArchivePreviewManifest,
  type ArchivePreviewSourceEntry,
} from "@/components/media/archive-preview/archive-preview-utils"

const utf8FilenameDecoder = new TextDecoder("utf-8", {
  fatal: true,
  ignoreBOM: true,
})

function decodeUnflaggedUtf8Text(
  value: Uint8Array,
  encoding: string
): string | undefined {
  if (encoding.trim().toLowerCase() !== "cp437") return undefined

  try {
    return utf8FilenameDecoder.decode(value)
  } catch {
    // Keep zip.js' CP437 fallback for genuinely legacy archives.
    return undefined
  }
}

export type ArchivePreviewEntryErrorCode =
  | "entry_encrypted"
  | "entry_not_found"

export class ArchivePreviewEntryError extends Error {
  readonly code: ArchivePreviewEntryErrorCode

  constructor(code: ArchivePreviewEntryErrorCode) {
    super(code)
    this.name = "ArchivePreviewEntryError"
    this.code = code
  }
}

function createAbortError() {
  return new DOMException("Archive preview was cancelled", "AbortError")
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw createAbortError()
}

function assertArchiveSize(archive: Blob) {
  if (
    archive.size <= 0 ||
    archive.size > ARCHIVE_PREVIEW_LIMITS.maxArchiveBytes
  ) {
    throw new ArchivePreviewError("invalid_archive")
  }
}

function createArchiveReader(archive: Blob, strict = false) {
  return new ZipReader(new BlobReader(archive), {
    decodeText: decodeUnflaggedUtf8Text,
    useWebWorkers: false,
    ...(strict ? { checkAmbiguity: true, strictness: "strict" as const } : {}),
  })
}

function toSourceEntry(entry: Entry): ArchivePreviewSourceEntry {
  const modifiedAt = entry.lastModDate
  return {
    filename: entry.filename,
    directory: entry.directory,
    encrypted: entry.encrypted,
    compressedSize: entry.compressedSize,
    uncompressedSize: entry.uncompressedSize,
    modifiedAt:
      modifiedAt instanceof Date && Number.isFinite(modifiedAt.getTime())
        ? modifiedAt.toISOString()
        : null,
    externalFileAttributes: entry.externalFileAttributes,
  }
}

async function readArchiveEntries(
  reader: ZipReader<Blob>,
  signal?: AbortSignal
): Promise<Entry[]> {
  const entries: Entry[] = []
  for await (const entry of reader.getEntriesGenerator()) {
    throwIfAborted(signal)
    if (entries.length >= ARCHIVE_PREVIEW_LIMITS.maxEntries) {
      throw new ArchivePreviewError("limit_exceeded")
    }
    entries.push(entry)
  }
  throwIfAborted(signal)
  return entries
}

function buildManifest(entries: readonly Entry[]): ArchivePreviewManifest {
  return buildArchivePreviewManifest(entries.map(toSourceEntry))
}

function matchesArchivePreviewItem(
  actual: ArchivePreviewItem,
  requested: ArchivePreviewItem
) {
  return (
    actual.id === requested.id &&
    actual.path === requested.path &&
    actual.parentPath === requested.parentPath &&
    actual.name === requested.name &&
    actual.kind === requested.kind &&
    actual.encrypted === requested.encrypted &&
    actual.compressedSize === requested.compressedSize &&
    actual.uncompressedSize === requested.uncompressedSize &&
    actual.modifiedAt === requested.modifiedAt
  )
}

function resolveManifestFile(
  manifest: ArchivePreviewManifest,
  requested: ArchivePreviewItem
): ArchivePreviewItem {
  const entry = manifest.entries.find(
    (candidate) =>
      candidate.id === requested.id && candidate.path === requested.path
  )
  if (!entry || entry.kind !== "file") {
    throw new ArchivePreviewEntryError("entry_not_found")
  }
  if (entry.encrypted) {
    throw new ArchivePreviewEntryError("entry_encrypted")
  }
  if (!matchesArchivePreviewItem(entry, requested)) {
    throw new ArchivePreviewEntryError("entry_not_found")
  }
  return entry
}

function findZipFileEntry(
  entries: readonly Entry[],
  target: ArchivePreviewItem
): FileEntry | undefined {
  for (const entry of entries) {
    if (entry.directory || entry.encrypted) continue

    const candidate = buildArchivePreviewManifest([toSourceEntry(entry)]).entries.find(
      (item) => item.kind === "file" && item.path === target.path
    )
    if (candidate && matchesArchivePreviewItem(candidate, target)) {
      return entry
    }
  }
  return undefined
}

function createBoundedEntryWriter(signal?: AbortSignal): {
  writable: WritableStream<Uint8Array>
  getData: () => Uint8Array<ArrayBuffer>
} {
  const chunks: Uint8Array<ArrayBuffer>[] = []
  let byteLength = 0

  const writable = new WritableStream<Uint8Array>({
    write(chunk) {
      throwIfAborted(signal)
      if (
        chunk.byteLength >
        ARCHIVE_PREVIEW_LIMITS.maxEntryUncompressedBytes - byteLength
      ) {
        throw new ArchivePreviewError("limit_exceeded")
      }

      const copy = new Uint8Array(chunk.byteLength)
      copy.set(chunk)
      chunks.push(copy)
      byteLength += copy.byteLength
    },
  })

  return {
    writable,
    getData() {
      const content = new Uint8Array(byteLength)
      let offset = 0
      for (const chunk of chunks) {
        content.set(chunk, offset)
        offset += chunk.byteLength
      }
      return content
    },
  }
}

/**
 * Reads only the ZIP central-directory metadata. Entry contents are never
 * decompressed or loaded into memory.
 */
export async function readArchivePreviewManifest(
  archive: Blob
): Promise<ArchivePreviewManifest> {
  assertArchiveSize(archive)
  const reader = createArchiveReader(archive)

  try {
    return buildManifest(await readArchiveEntries(reader))
  } finally {
    await reader.close().catch(() => undefined)
  }
}

/**
 * Extracts one manifest-backed, unencrypted file entry. The central directory
 * is rebuilt for every request so entry, path, and expansion limits cannot be
 * bypassed by a forged UI item.
 */
export async function readArchivePreviewEntry(
  archive: Blob,
  requested: ArchivePreviewItem,
  signal?: AbortSignal
): Promise<Uint8Array<ArrayBuffer>> {
  throwIfAborted(signal)
  assertArchiveSize(archive)
  const reader = createArchiveReader(archive, true)

  try {
    const entries = await readArchiveEntries(reader, signal)
    const target = resolveManifestFile(buildManifest(entries), requested)
    const zipEntry = findZipFileEntry(entries, target)
    if (!zipEntry) {
      throw new ArchivePreviewEntryError("entry_not_found")
    }

    const writer = createBoundedEntryWriter(signal)
    await zipEntry.getData(writer.writable, {
      checkAmbiguity: true,
      checkOverlappingEntry: true,
      checkSignature: true,
      signal,
      strictness: "strict",
      useWebWorkers: false,
    })
    throwIfAborted(signal)

    const content = writer.getData()
    if (
      content.byteLength !== target.uncompressedSize ||
      content.byteLength > ARCHIVE_PREVIEW_LIMITS.maxEntryUncompressedBytes
    ) {
      throw new ArchivePreviewError("invalid_archive")
    }
    return content
  } finally {
    await reader.close().catch(() => undefined)
  }
}
