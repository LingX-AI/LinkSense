import {
  Uint8ArrayReader,
  Uint8ArrayWriter,
  ZipReader,
  ZipWriter,
  type Entry,
  type FileEntry,
  type ZipWriterAddDataOptions,
} from "@zip.js/zip.js"

const xlsxPreviewMaxArchiveBytes = 25 * 1024 * 1024
const xlsxPreviewMaxEntries = 10_000
const xlsxPreviewMaxRelationshipEntries = 512
const xlsxPreviewMaxRelationshipBytes = 1024 * 1024
const xlsxPreviewMaxTotalRelationshipBytes = 4 * 1024 * 1024

const utf8Decoder = new TextDecoder("utf-8", { fatal: true })
const utf8Encoder = new TextEncoder()

type RelationshipPayload = Readonly<{
  bytes: Uint8Array<ArrayBuffer>
  changed: boolean
}>

function copyBytes(input: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(input.byteLength)
  copy.set(input)
  return copy
}

export function isZipXlsxPreviewCandidate(content: Uint8Array) {
  return (
    content.byteLength >= 4 &&
    content[0] === 0x50 &&
    content[1] === 0x4b &&
    content[2] === 0x03 &&
    content[3] === 0x04
  )
}

function normalizedArchivePath(path: string) {
  return path.replace(/\\/gu, "/").replace(/^\/+|\/+$/gu, "")
}

function relationshipOwnerDirectory(relationshipPath: string) {
  const normalizedPath = normalizedArchivePath(relationshipPath)
  if (normalizedPath === "_rels/.rels") return []

  const marker = "/_rels/"
  const markerIndex = normalizedPath.lastIndexOf(marker)
  if (markerIndex < 0 || !normalizedPath.endsWith(".rels")) return null

  const ownerPrefix = normalizedPath.slice(0, markerIndex)
  const relationshipName = normalizedPath.slice(markerIndex + marker.length)
  const ownerName = relationshipName.slice(0, -".rels".length)
  if (!ownerName) return null

  const ownerPath = `${ownerPrefix}/${ownerName}`
  return ownerPath.split("/").filter(Boolean).slice(0, -1)
}

function normalizedAbsoluteSpreadsheetPart(target: string) {
  const normalizedTarget = target.replace(/\\/gu, "/")
  if (!normalizedTarget.startsWith("/")) return null

  const segments: string[] = []
  for (const segment of normalizedTarget.split("/")) {
    if (!segment || segment === ".") continue
    if (segment === "..") {
      if (segments.length === 0) return null
      segments.pop()
      continue
    }
    segments.push(segment)
  }

  return segments[0] === "xl" ? segments : null
}

function relativeRelationshipTarget(relationshipPath: string, target: string) {
  const ownerDirectory = relationshipOwnerDirectory(relationshipPath)
  const targetSegments = normalizedAbsoluteSpreadsheetPart(target)
  if (!ownerDirectory || !targetSegments || targetSegments.length === 0) {
    return null
  }

  let commonSegmentCount = 0
  while (
    commonSegmentCount < ownerDirectory.length &&
    commonSegmentCount < targetSegments.length &&
    ownerDirectory[commonSegmentCount] === targetSegments[commonSegmentCount]
  ) {
    commonSegmentCount += 1
  }

  const relativeSegments = [
    ...Array.from(
      { length: ownerDirectory.length - commonSegmentCount },
      () => ".."
    ),
    ...targetSegments.slice(commonSegmentCount),
  ]
  return relativeSegments.length > 0 ? relativeSegments.join("/") : null
}

function hasXmlParserError(document: Document) {
  return Array.from(document.getElementsByTagName("*")).some(
    (element) => element.localName === "parsererror"
  )
}

function normalizeRelationshipXml(
  relationshipPath: string,
  content: Uint8Array<ArrayBuffer>
): RelationshipPayload {
  const source = utf8Decoder.decode(content)
  const document = new DOMParser().parseFromString(source, "application/xml")
  if (document.doctype || hasXmlParserError(document)) {
    throw new Error("invalid_xlsx_relationship_xml")
  }

  let changed = false
  for (const element of Array.from(document.getElementsByTagName("*"))) {
    if (element.localName !== "Relationship") continue
    if (element.getAttribute("TargetMode")?.toLowerCase() === "external") {
      continue
    }

    const target = element.getAttribute("Target")
    if (!target) continue
    const normalizedTarget = relativeRelationshipTarget(
      relationshipPath,
      target
    )
    if (!normalizedTarget || normalizedTarget === target) continue

    element.setAttribute("Target", normalizedTarget)
    changed = true
  }

  return {
    bytes: changed
      ? copyBytes(
          utf8Encoder.encode(new XMLSerializer().serializeToString(document))
        )
      : content,
    changed,
  }
}

function isRelationshipEntry(entry: Entry): entry is FileEntry {
  if (entry.directory) return false
  const path = normalizedArchivePath(entry.filename)
  return (
    path === "_rels/.rels" ||
    (path.includes("/_rels/") && path.endsWith(".rels"))
  )
}

function entryWriterOptions(entry: Entry): ZipWriterAddDataOptions {
  return {
    comment: entry.comment,
    directory: entry.directory,
    externalFileAttributes: entry.externalFileAttributes,
    internalFileAttributes: entry.internalFileAttributes,
    lastModDate: entry.lastModDate,
    useUnicodeFileNames: entry.filenameUTF8,
    useWebWorkers: false,
    version: entry.version,
    versionMadeBy: entry.versionMadeBy,
    zip64: entry.zip64,
  }
}

async function collectEntries(reader: ZipReader<Uint8Array>) {
  const entries: Entry[] = []
  const filenames = new Set<string>()

  for await (const entry of reader.getEntriesGenerator({
    maxAppendedDataSize: 0,
    strictness: "strict",
  })) {
    if (entries.length >= xlsxPreviewMaxEntries) {
      throw new Error("xlsx_preview_entry_limit_exceeded")
    }
    if (filenames.has(entry.filename)) {
      throw new Error("xlsx_preview_duplicate_entry")
    }
    filenames.add(entry.filename)
    entries.push(entry)
  }

  return entries
}

async function readRelationshipPayloads(entries: readonly Entry[]) {
  const payloads = new Map<string, RelationshipPayload>()
  let relationshipCount = 0
  let totalRelationshipBytes = 0

  for (const entry of entries) {
    if (!isRelationshipEntry(entry)) continue
    relationshipCount += 1
    totalRelationshipBytes += entry.uncompressedSize
    if (
      relationshipCount > xlsxPreviewMaxRelationshipEntries ||
      entry.uncompressedSize > xlsxPreviewMaxRelationshipBytes ||
      totalRelationshipBytes > xlsxPreviewMaxTotalRelationshipBytes
    ) {
      throw new Error("xlsx_preview_relationship_limit_exceeded")
    }
    if (entry.encrypted) {
      throw new Error("xlsx_preview_encrypted_entry")
    }

    const content = await entry.getData(new Uint8ArrayWriter(), {
      checkAmbiguity: true,
      checkOverlappingEntry: true,
      checkSignature: true,
      strictness: "strict",
      useWebWorkers: false,
    })
    payloads.set(
      entry.filename,
      normalizeRelationshipXml(entry.filename, content)
    )
  }

  return payloads
}

async function copyEntry(
  writer: ZipWriter<Uint8Array<ArrayBuffer>>,
  entry: Entry,
  relationshipPayload?: RelationshipPayload
) {
  const commonOptions = entryWriterOptions(entry)
  if (entry.directory) {
    await writer.add(entry.filename, undefined, commonOptions)
    return
  }
  if (entry.encrypted) {
    throw new Error("xlsx_preview_encrypted_entry")
  }
  if (relationshipPayload) {
    await writer.add(
      entry.filename,
      new Uint8ArrayReader(relationshipPayload.bytes),
      {
        ...commonOptions,
        level: entry.compressionMethod === 0 ? 0 : 6,
      }
    )
    return
  }

  const compressedContent = await entry.getData(new Uint8ArrayWriter(), {
    checkAmbiguity: true,
    checkOverlappingEntry: true,
    passThrough: true,
    strictness: "strict",
    useWebWorkers: false,
  })
  await writer.add(entry.filename, new Uint8ArrayReader(compressedContent), {
    ...commonOptions,
    compressionMethod: entry.compressionMethod,
    encrypted: false,
    passThrough: true,
    signature: entry.signature,
    uncompressedSize: entry.uncompressedSize,
  })
}

export async function normalizeXlsxRelationshipTargetsForPreview(
  content: Uint8Array
): Promise<ArrayBuffer> {
  const original = copyBytes(content)
  if (
    !isZipXlsxPreviewCandidate(original) ||
    original.byteLength > xlsxPreviewMaxArchiveBytes
  ) {
    return original.buffer
  }

  const reader = new ZipReader(new Uint8ArrayReader(original), {
    maxAppendedDataSize: 0,
    strictness: "strict",
    useWebWorkers: false,
  })

  try {
    const entries = await collectEntries(reader)
    const relationshipPayloads = await readRelationshipPayloads(entries)
    if (
      ![...relationshipPayloads.values()].some((payload) => payload.changed)
    ) {
      return original.buffer
    }

    const writer = new ZipWriter(new Uint8ArrayWriter(), {
      keepOrder: true,
      useWebWorkers: false,
    })
    for (const entry of entries) {
      await copyEntry(writer, entry, relationshipPayloads.get(entry.filename))
    }
    return (await writer.close(reader.comment)).buffer
  } finally {
    await reader.close().catch(() => undefined)
  }
}

/**
 * Relationship normalization is a best-effort preview compatibility step.
 * Invalid or unusual archives still reach the existing viewer unchanged so
 * this helper cannot turn a previously previewable workbook into a hard error.
 */
export async function prepareXlsxPreviewBuffer(content: Uint8Array) {
  if (!isZipXlsxPreviewCandidate(content)) return copyBytes(content).buffer

  try {
    return await normalizeXlsxRelationshipTargetsForPreview(content)
  } catch {
    return copyBytes(content).buffer
  }
}
