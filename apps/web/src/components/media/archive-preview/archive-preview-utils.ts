import {
  getConversationFileExtension,
  getConversationFilePreviewKind,
  isKnownNonTextPreviewExtension,
  type ConversationFilePreviewKind,
} from "@/features/conversations/conversation-file-preview"

export const ARCHIVE_PREVIEW_LIMITS = {
  maxArchiveBytes: 50 * 1024 * 1024,
  maxEntries: 1_000,
  maxDepth: 32,
  maxPathLength: 1_024,
  maxEntryUncompressedBytes: 50 * 1024 * 1024,
  maxTotalUncompressedBytes: 200 * 1024 * 1024,
  maxCompressionRatio: 100,
} as const

export type ArchivePreviewItemKind = "directory" | "file"

export type ArchivePreviewSourceEntry = Readonly<{
  filename: string
  directory: boolean
  encrypted: boolean
  compressedSize: number
  uncompressedSize: number
  modifiedAt: string | null
  externalFileAttributes: number
}>

export type ArchivePreviewItem = Readonly<{
  id: string
  path: string
  parentPath: string
  name: string
  kind: ArchivePreviewItemKind
  encrypted: boolean
  compressedSize: number
  uncompressedSize: number
  modifiedAt: string | null
}>

export type ArchiveEntryPreviewKind = Extract<
  ConversationFilePreviewKind,
  "pdf" | "code" | "text" | "markdown" | "csv" | "image" | "audio" | "video"
>

export type ArchivePreviewManifest = Readonly<{
  entries: readonly ArchivePreviewItem[]
  totalFiles: number
  totalFolders: number
  totalCompressedSize: number
  totalUncompressedSize: number
  encryptedFileCount: number
  skippedEntryCount: number
}>

export type ArchivePreviewErrorCode = "invalid_archive" | "limit_exceeded"

export class ArchivePreviewError extends Error {
  readonly code: ArchivePreviewErrorCode

  constructor(code: ArchivePreviewErrorCode) {
    super(code)
    this.name = "ArchivePreviewError"
    this.code = code
  }
}

function compareArchiveItems(left: ArchivePreviewItem, right: ArchivePreviewItem) {
  if (left.kind !== right.kind) return left.kind === "directory" ? -1 : 1
  return left.name.localeCompare(right.name, "en", {
    numeric: true,
    sensitivity: "base",
  })
}

function normalizeArchivePath(
  filename: string,
  directory: boolean
): string | null {
  const normalized = filename.trim()
  if (
    !normalized ||
    normalized.includes("\0") ||
    normalized.includes("\\") ||
    normalized.includes("//") ||
    normalized.startsWith("/") ||
    /^[a-z]:/i.test(normalized)
  ) {
    return null
  }

  const withoutDirectorySuffix = directory
    ? normalized.replace(/\/+$/, "")
    : normalized
  if (!withoutDirectorySuffix) {
    return null
  }

  const segments = withoutDirectorySuffix.split("/")
  if (
    segments.length > ARCHIVE_PREVIEW_LIMITS.maxDepth ||
    withoutDirectorySuffix.length > ARCHIVE_PREVIEW_LIMITS.maxPathLength ||
    segments.some((segment) => !segment || segment === "." || segment === "..")
  ) {
    return null
  }
  return segments.join("/")
}

function isUnsupportedUnixFileType(entry: ArchivePreviewSourceEntry) {
  if (entry.directory) return false
  const unixFileType = (entry.externalFileAttributes >>> 16) & 0o170000
  // A zero type is common in ZIPs created on Windows or by tools that do not
  // persist Unix mode bits. When a Unix type is present, only regular files
  // may be previewed; links, devices, FIFOs, and sockets are excluded.
  return unixFileType !== 0 && unixFileType !== 0o100000
}

function isSafeSize(value: number) {
  return Number.isFinite(value) && value >= 0
}

function createDirectory(path: string): ArchivePreviewItem {
  const parts = path.split("/")
  return {
    id: `directory:${path}`,
    path,
    parentPath: parts.slice(0, -1).join("/"),
    name: parts.at(-1) ?? path,
    kind: "directory",
    encrypted: false,
    compressedSize: 0,
    uncompressedSize: 0,
    modifiedAt: null,
  }
}

function getParentPaths(path: string) {
  const parts = path.split("/")
  return parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join("/"))
}

/**
 * Builds a safe, metadata-only archive manifest. No entry data is read here.
 */
export function buildArchivePreviewManifest(
  sourceEntries: readonly ArchivePreviewSourceEntry[]
): ArchivePreviewManifest {
  if (sourceEntries.length > ARCHIVE_PREVIEW_LIMITS.maxEntries) {
    throw new ArchivePreviewError("limit_exceeded")
  }

  const items = new Map<string, ArchivePreviewItem>()
  let skippedEntryCount = 0
  let totalCompressedSize = 0
  let totalUncompressedSize = 0
  let encryptedFileCount = 0

  const candidates = sourceEntries
    .map((source) => ({
      source,
      path: normalizeArchivePath(source.filename, source.directory),
    }))
    .sort((left, right) => {
      const leftDepth = left.path?.split("/").length ?? Number.MAX_SAFE_INTEGER
      const rightDepth = right.path?.split("/").length ?? Number.MAX_SAFE_INTEGER
      return leftDepth - rightDepth
    })

  for (const candidate of candidates) {
    const { source, path } = candidate
    const existingItem = path ? items.get(path) : undefined
    if (
      !path ||
      isUnsupportedUnixFileType(source) ||
      !isSafeSize(source.compressedSize) ||
      !isSafeSize(source.uncompressedSize)
    ) {
      skippedEntryCount += 1
      continue
    }

    // A file can create an implicit parent directory before an explicit
    // directory entry for it appears. It is a normal ZIP layout, not a
    // duplicate or unsafe path.
    if (existingItem) {
      if (source.directory && existingItem.kind === "directory") continue
      skippedEntryCount += 1
      continue
    }

    const parentPaths = getParentPaths(path)
    if (parentPaths.some((parentPath) => items.get(parentPath)?.kind === "file")) {
      skippedEntryCount += 1
      continue
    }

    if (!source.directory) {
      if (
        source.uncompressedSize > ARCHIVE_PREVIEW_LIMITS.maxEntryUncompressedBytes ||
        totalUncompressedSize + source.uncompressedSize >
          ARCHIVE_PREVIEW_LIMITS.maxTotalUncompressedBytes ||
        (source.uncompressedSize > 0 &&
          source.uncompressedSize /
            Math.max(1, source.compressedSize) >
            ARCHIVE_PREVIEW_LIMITS.maxCompressionRatio)
      ) {
        throw new ArchivePreviewError("limit_exceeded")
      }
    }

    for (const parentPath of parentPaths) {
      if (!items.has(parentPath)) {
        items.set(parentPath, createDirectory(parentPath))
      }
    }

    const parts = path.split("/")
    const item: ArchivePreviewItem = {
      id: `${source.directory ? "directory" : "file"}:${path}`,
      path,
      parentPath: parts.slice(0, -1).join("/"),
      name: parts.at(-1) ?? path,
      kind: source.directory ? "directory" : "file",
      encrypted: !source.directory && source.encrypted,
      compressedSize: source.directory ? 0 : source.compressedSize,
      uncompressedSize: source.directory ? 0 : source.uncompressedSize,
      modifiedAt: source.modifiedAt,
    }
    items.set(path, item)

    if (!source.directory) {
      totalCompressedSize += source.compressedSize
      totalUncompressedSize += source.uncompressedSize
      if (source.encrypted) encryptedFileCount += 1
    }
  }

  const entries = [...items.values()].sort(compareArchiveItems)
  return {
    entries,
    totalFiles: entries.filter((item) => item.kind === "file").length,
    totalFolders: entries.filter((item) => item.kind === "directory").length,
    totalCompressedSize,
    totalUncompressedSize,
    encryptedFileCount,
    skippedEntryCount,
  }
}

export function getArchivePreviewChildren(
  manifest: ArchivePreviewManifest,
  parentPath: string
) {
  return manifest.entries
    .filter((item) => item.parentPath === parentPath)
    .sort(compareArchiveItems)
}

export function getArchiveBreadcrumbPaths(path: string) {
  if (!path) return []
  const parts = path.split("/")
  return parts.map((name, index) => ({
    name,
    path: parts.slice(0, index + 1).join("/"),
  }))
}

export function getArchivePreviewFileType(name: string) {
  const extension = name.split(".").at(-1)
  return extension && extension !== name ? extension.toUpperCase() : null
}

const archiveEntryMimeTypes: Readonly<Record<string, string>> = {
  aac: "audio/aac",
  avif: "image/avif",
  csv: "text/csv",
  flac: "audio/flac",
  gif: "image/gif",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  m4a: "audio/mp4",
  m4v: "video/mp4",
  md: "text/markdown",
  mov: "video/quicktime",
  mp3: "audio/mpeg",
  mp4: "video/mp4",
  oga: "audio/ogg",
  ogg: "audio/ogg",
  ogv: "video/ogg",
  opus: "audio/opus",
  pdf: "application/pdf",
  png: "image/png",
  tsv: "text/tab-separated-values",
  wav: "audio/wav",
  webm: "video/webm",
  webp: "image/webp",
}

/**
 * Returns a shell-less, read-only renderer for every safe text candidate.
 * HTML is always rendered as source code rather than executed. Unknown file
 * names are treated as text candidates unless their extension is a known
 * binary container, executable, font, Office document, or media format.
 * Decoding then provides the final binary-content safeguard for unknown
 * formats that can only be classified from their bytes.
 */
export function getArchiveEntryPreviewKind(
  item: ArchivePreviewItem
): ArchiveEntryPreviewKind | null {
  if (item.kind !== "file" || item.encrypted) return null

  const kind = getConversationFilePreviewKind({
    name: item.name,
    mime_type: null,
  })
  switch (kind) {
    case "html":
      return "code"
    case "pdf":
    case "code":
    case "text":
    case "markdown":
    case "csv":
    case "image":
    case "audio":
    case "video":
      return kind
    case "presentation":
    case "word":
    case "spreadsheet":
    case "archive":
      return null
    default:
      return isKnownNonTextPreviewExtension(getConversationFileExtension(item.name))
        ? null
        : "text"
  }
}

export function getArchiveEntryPreviewMimeType(item: ArchivePreviewItem) {
  const extension = getConversationFileExtension(item.name)
  return archiveEntryMimeTypes[extension] ?? "text/plain; charset=utf-8"
}
