import { createHash, randomUUID } from "node:crypto"
import { createReadStream, createWriteStream } from "node:fs"
import { mkdtemp, open, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, join } from "node:path"
import { Readable, Transform } from "node:stream"
import { pipeline } from "node:stream/promises"

import { detectCfbf } from "@file-type/cfbf"
import { FileTypeParser, type FileTypeResult } from "file-type"
import { SaxesParser } from "saxes"
import sharp from "sharp"
import { Open, type File as ZipEntry } from "unzipper"

import { AppError } from "../../lib/errors.js"
import type {
  KnowledgeDocumentIngestionAdapter,
  KnowledgeDocumentIngestionResult,
  RegisteredKnowledgeObject,
} from "./types.js"
import {
  buildKnowledgeObjectKey,
  type KnowledgeObjectIdentity,
} from "../knowledge-processing/object-store.js"

const MAX_FILENAME_CODE_POINTS = 260
const MAX_ZIP_ENTRIES = 10_000
const MAX_ZIP_ENTRY_BYTES = 256 * 1024 * 1024
const MAX_ZIP_EXPANDED_BYTES = 1024 * 1024 * 1024
const MAX_ZIP_COMPRESSION_RATIO = 200
const MAX_XML_INSPECTION_BYTES = 2 * 1024 * 1024
const MAX_ODF_XML_ENTRY_INSPECTION_BYTES = 256 * 1024 * 1024
const MAX_ODF_XML_TOTAL_INSPECTION_BYTES = 256 * 1024 * 1024
const MAX_ODF_XML_TOKEN_CODE_UNITS = 256 * 1024
const ODF_XML_PARSE_CHUNK_CODE_UNITS = 64 * 1024
const PDF_TRAILER_INSPECTION_BYTES = 4 * 1024 * 1024
const STORAGE_RESERVATION_HEARTBEAT_MS = 3_000
const CFBF_SIGNATURE = Buffer.from("d0cf11e0a1b11ae1", "hex")
const ODF_OFFICE_NAMESPACE =
  "urn:oasis:names:tc:opendocument:xmlns:office:1.0"
const ODF_SCRIPT_NAMESPACE =
  "urn:oasis:names:tc:opendocument:xmlns:script:1.0"
const ODF_FORM_NAMESPACE =
  "urn:oasis:names:tc:opendocument:xmlns:form:1.0"
const ODF_DRAW_NAMESPACE =
  "urn:oasis:names:tc:opendocument:xmlns:drawing:1.0"
const ODF_PRESENTATION_NAMESPACE =
  "urn:oasis:names:tc:opendocument:xmlns:presentation:1.0"
const ODF_TEXT_NAMESPACE =
  "urn:oasis:names:tc:opendocument:xmlns:text:1.0"
const ODF_TABLE_NAMESPACE =
  "urn:oasis:names:tc:opendocument:xmlns:table:1.0"
const ODF_MANIFEST_NAMESPACE =
  "urn:oasis:names:tc:opendocument:xmlns:manifest:1.0"
const ODF_ACTIVE_PATH_SEGMENTS = new Set(["basic", "scripts"])
const ODF_ACTIVE_FILE_EXTENSIONS = new Set([
  "bat",
  "class",
  "cmd",
  "dll",
  "exe",
  "jar",
  "js",
  "mjs",
  "ps1",
  "py",
  "sh",
  "so",
  "vbs",
  "wasm",
])

type SupportedFormat = {
  canonicalMimeType: string
  declaredMimeTypes: readonly string[]
  kind: "binary" | "convertible" | "ooxml" | "odf" | "text"
  detectedExtensions?: readonly string[]
}

const SUPPORTED_FORMATS = {
  pdf: binary("application/pdf", ["pdf"]),
  docx: ooxml(
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ),
  xlsx: ooxml(
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ),
  pptx: ooxml(
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ),
  doc: convertible("application/msword", ["application/vnd.ms-word"]),
  xls: convertible("application/vnd.ms-excel"),
  ppt: convertible("application/vnd.ms-powerpoint"),
  vsdx: convertible("application/vnd.ms-visio.drawing", [
    "application/visio",
    "application/vnd.visio",
    "application/x-visio",
  ]),
  odt: odf("application/vnd.oasis.opendocument.text"),
  ods: odf("application/vnd.oasis.opendocument.spreadsheet"),
  odp: odf("application/vnd.oasis.opendocument.presentation"),
  txt: text("text/plain"),
  md: text("text/markdown", ["text/plain", "text/x-markdown"]),
  html: text("text/html", ["application/xhtml+xml"]),
  htm: text("text/html", ["application/xhtml+xml"]),
  csv: text("text/csv", ["application/csv", "text/plain"]),
  png: binary("image/png", ["png"]),
  jpg: binary("image/jpeg", ["jpg", "jpeg"]),
  jpeg: binary("image/jpeg", ["jpg", "jpeg"]),
  tif: binary("image/tiff", ["tif", "tiff"]),
  tiff: binary("image/tiff", ["tif", "tiff"]),
  bmp: binary("image/bmp", ["bmp"]),
  webp: binary("image/webp", ["webp"]),
} as const satisfies Record<string, SupportedFormat>

type SupportedExtension = keyof typeof SUPPORTED_FORMATS

export interface KnowledgeUploadObjectStore {
  putImmutable(input: {
    identity: KnowledgeObjectIdentity
    stream: Readable
    size: number
    contentType: string
  }): Promise<{ key: string; sha256: string; size: number }>
  remove(key: string): Promise<void>
}

/**
 * Spools an untrusted multipart stream to a private temporary file so format
 * validation can finish before the immutable MinIO object becomes durable.
 * Neither the upload nor the second MinIO pass buffers the whole document.
 */
export class MinioKnowledgeDocumentIngestionAdapter
  implements KnowledgeDocumentIngestionAdapter
{
  constructor(
    private readonly objectStore: KnowledgeUploadObjectStore,
    private readonly temporaryRoot: string = tmpdir(),
    private readonly createId: () => string = randomUUID,
  ) {}

  async registerUpload(input: {
    knowledgeBaseId: string
    documentId: string
    documentVersionId: string
    processingGeneration: string
    filename: string
    declaredMimeType: string
    stream: Readable
    maxSizeBytes: number
    reserveStorage(input: {
      sizeBytes: bigint
      objectKeys: readonly string[]
    }): Promise<void>
    heartbeatStorageReservation(): Promise<void>
    releaseStorageReservation(sizeBytes: bigint): Promise<void>
  }): Promise<KnowledgeDocumentIngestionResult> {
    let filename: string
    let extension: SupportedExtension
    let format: SupportedFormat
    try {
      filename = sanitizeKnowledgeFilename(input.filename)
      extension = extensionOf(filename)
      format = SUPPORTED_FORMATS[extension]
      assertDeclaredMimeType(input.declaredMimeType, format)
    } catch (error) {
      input.stream.resume()
      throw error
    }

    const directory = await mkdtemp(join(this.temporaryRoot, "linksense-kb-upload-"))
    const stagedPath = join(directory, "upload.bin")
    let storedKey: string | null = null
    let reservedBytes = 0n
    let reservedObjectKey: string | null = null
    try {
      const staged = await spoolUpload(input.stream, stagedPath, input.maxSizeBytes)
      const detected =
        format.kind === "convertible"
          ? undefined
          : await detectStagedFileType(stagedPath)
      await validateStagedDocument(stagedPath, extension, format, detected)

      const objectId = this.createId()
      reservedObjectKey = buildKnowledgeObjectKey({
        knowledgeBaseId: input.knowledgeBaseId,
        documentId: input.documentId,
        versionId: input.documentVersionId,
        objectType: "original",
        objectId,
        extension,
      })
      reservedBytes = BigInt(staged.size)
      await input.reserveStorage({
        sizeBytes: reservedBytes,
        objectKeys: [reservedObjectKey],
      })

      const stored = await withStorageReservationHeartbeat(
        input.heartbeatStorageReservation,
        () =>
          this.objectStore.putImmutable({
            identity: {
              knowledgeBaseId: input.knowledgeBaseId,
              documentId: input.documentId,
              versionId: input.documentVersionId,
              objectType: "original",
              objectId,
              extension,
            },
            stream: createReadStream(stagedPath),
            size: staged.size,
            contentType: format.canonicalMimeType,
          }),
      )
      storedKey = stored.key
      if (
        stored.key !== reservedObjectKey ||
        stored.size !== staged.size ||
        stored.sha256 !== staged.sha256
      ) {
        throw new AppError("KNOWLEDGE_DOCUMENT_INVALID")
      }
      const storedObject: RegisteredKnowledgeObject = {
        id: objectId,
        objectKey: stored.key,
        mimeType: format.canonicalMimeType,
        sizeBytes: BigInt(stored.size),
        checksumSha256: stored.sha256,
      }
      // The caller now owns this exact reservation and consumes it atomically
      // when the object manifest row and document version are registered.
      reservedBytes = 0n
      reservedObjectKey = null
      return {
        original: storedObject,
        originalFilename: filename,
        displayName: filename,
        normalizedDisplayName: normalizeDisplayName(filename),
        canonicalExtension: extension,
        canonicalMimeType: format.canonicalMimeType,
      }
    } catch (error) {
      let reservationObjectsRemoved = reservedObjectKey === null
      if (reservedObjectKey !== null) {
        reservationObjectsRemoved = await this.objectStore
          .remove(reservedObjectKey)
          .then(() => true)
          .catch(() => false)
      }
      if (storedKey !== null && storedKey !== reservedObjectKey) {
        reservationObjectsRemoved =
          (await this.objectStore
            .remove(storedKey)
            .then(() => true)
            .catch(() => false)) && reservationObjectsRemoved
      }
      if (reservedBytes > 0n && reservationObjectsRemoved) {
        await input.releaseStorageReservation(reservedBytes).catch(() => undefined)
      }
      if (error instanceof AppError) throw error
      throw new AppError("KNOWLEDGE_DOCUMENT_INVALID")
    } finally {
      await rm(directory, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  async discardRegisteredUpload(input: {
    knowledgeBaseId: string
    object: RegisteredKnowledgeObject
  }): Promise<void> {
    assertObjectBelongsToKnowledgeBase(input.object.objectKey, input.knowledgeBaseId)
    await this.objectStore.remove(input.object.objectKey)
  }
}

async function withStorageReservationHeartbeat<T>(
  heartbeatStorageReservation: () => Promise<void>,
  operation: () => Promise<T>,
): Promise<T> {
  await heartbeatStorageReservation()
  let heartbeat = Promise.resolve()
  let heartbeatError: unknown = null
  const timer = setInterval(() => {
    heartbeat = heartbeat
      .then(heartbeatStorageReservation)
      .catch((error: unknown) => {
        heartbeatError = error
      })
  }, STORAGE_RESERVATION_HEARTBEAT_MS)
  timer.unref()
  try {
    const result = await operation()
    await heartbeat
    if (heartbeatError !== null) throw heartbeatError
    await heartbeatStorageReservation()
    return result
  } finally {
    clearInterval(timer)
  }
}

function binary(
  canonicalMimeType: string,
  detectedExtensions: readonly string[],
): SupportedFormat {
  return {
    canonicalMimeType,
    declaredMimeTypes: [canonicalMimeType],
    kind: "binary",
    detectedExtensions,
  }
}

function ooxml(canonicalMimeType: string): SupportedFormat {
  return {
    canonicalMimeType,
    declaredMimeTypes: [canonicalMimeType],
    kind: "ooxml",
  }
}

function convertible(
  canonicalMimeType: string,
  aliases: readonly string[] = [],
): SupportedFormat {
  return {
    canonicalMimeType,
    declaredMimeTypes: [canonicalMimeType, ...aliases],
    kind: "convertible",
  }
}

function odf(canonicalMimeType: string): SupportedFormat {
  return {
    canonicalMimeType,
    declaredMimeTypes: [canonicalMimeType],
    kind: "odf",
  }
}

function text(
  canonicalMimeType: string,
  aliases: readonly string[] = [],
): SupportedFormat {
  return {
    canonicalMimeType,
    declaredMimeTypes: [canonicalMimeType, ...aliases],
    kind: "text",
  }
}

function sanitizeKnowledgeFilename(input: string): string {
  const withoutWindowsSeparators = input.replaceAll("\\", "/")
  const value = Array.from(basename(withoutWindowsSeparators).normalize("NFKC"))
    .map((character) => {
      const codePoint = character.codePointAt(0) ?? 0
      return codePoint < 32 || codePoint === 127 ? "_" : character
    })
    .join("")
    .trim()
  if (
    value.length === 0 ||
    value === "." ||
    value === ".." ||
    Array.from(value).length > MAX_FILENAME_CODE_POINTS
  ) {
    throw new AppError("KNOWLEDGE_DOCUMENT_INVALID")
  }
  return value
}

function extensionOf(filename: string): SupportedExtension {
  const separator = filename.lastIndexOf(".")
  if (separator <= 0 || separator === filename.length - 1) {
    throw new AppError("KNOWLEDGE_DOCUMENT_TYPE_UNSUPPORTED")
  }
  const extension = filename.slice(separator + 1).toLocaleLowerCase("en-US")
  if (!Object.hasOwn(SUPPORTED_FORMATS, extension)) {
    throw new AppError("KNOWLEDGE_DOCUMENT_TYPE_UNSUPPORTED")
  }
  return extension as SupportedExtension
}

function normalizeDisplayName(filename: string): string {
  return filename.normalize("NFKC").trim().toLocaleLowerCase("und")
}

function normalizeMimeType(value: string): string {
  return value.split(";", 1)[0]?.trim().toLocaleLowerCase("en-US") ?? ""
}

function assertDeclaredMimeType(
  declaredMimeType: string,
  format: SupportedFormat,
): void {
  // Browser and operating-system MIME databases disagree on legacy Office and
  // VSDX files (VSDX is commonly surfaced as a generic ZIP). Their extension
  // selects the isolated LibreOffice import path; import failure is reported by
  // the asynchronous conversion job instead of rejecting the upload here.
  if (format.kind === "convertible") return
  const normalized = normalizeMimeType(declaredMimeType)
  if (
    normalized !== "" &&
    normalized !== "application/octet-stream" &&
    !format.declaredMimeTypes.includes(normalized)
  ) {
    throw new AppError("KNOWLEDGE_DOCUMENT_INVALID")
  }
}

async function spoolUpload(
  stream: Readable,
  destination: string,
  maxSizeBytes: number,
): Promise<{ size: number; sha256: string }> {
  const hash = createHash("sha256")
  let size = 0
  const limiter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      size += chunk.byteLength
      if (size > maxSizeBytes) {
        callback(new AppError("KNOWLEDGE_DOCUMENT_TOO_LARGE"))
        return
      }
      hash.update(chunk)
      callback(null, chunk)
    },
  })
  await pipeline(
    stream,
    limiter,
    createWriteStream(destination, { flags: "wx", mode: 0o600 }),
  )
  if (size === 0) throw new AppError("KNOWLEDGE_DOCUMENT_INVALID")
  return { size, sha256: hash.digest("hex") }
}

async function detectStagedFileType(path: string): Promise<FileTypeResult | undefined> {
  return new FileTypeParser({ customDetectors: [detectCfbf] }).fromFile(path)
}

async function validateStagedDocument(
  path: string,
  extension: SupportedExtension,
  format: SupportedFormat,
  detected: FileTypeResult | undefined,
): Promise<void> {
  if (format.kind === "text") {
    if (detected !== undefined) throw new AppError("KNOWLEDGE_DOCUMENT_INVALID")
    await assertUtf8Text(path)
    return
  }

  // Legacy Office and Visio compatibility is delegated to the isolated,
  // headless LibreOffice conversion boundary. A failed import is reported by
  // the asynchronous processing job instead of blocking the upload request.
  if (format.kind === "convertible") return

  if (format.kind === "ooxml") {
    if (await hasCfbfSignature(path)) {
      throw new AppError("KNOWLEDGE_DOCUMENT_ENCRYPTED")
    }
    if (detected !== undefined && detected.ext !== extension && detected.ext !== "zip") {
      throw new AppError("KNOWLEDGE_DOCUMENT_INVALID")
    }
    await inspectOfficeZip(path, extension, format)
    return
  }

  if (format.kind === "odf") {
    if (detected !== undefined && detected.ext !== extension && detected.ext !== "zip") {
      throw new AppError("KNOWLEDGE_DOCUMENT_INVALID")
    }
    await inspectOdfZip(path, format)
    return
  }

  if (
    detected === undefined ||
    format.detectedExtensions === undefined ||
    !format.detectedExtensions.includes(detected.ext)
  ) {
    throw new AppError("KNOWLEDGE_DOCUMENT_INVALID")
  }
  if (extension === "pdf") {
    await inspectPdfTrailer(path)
  }
  if (format.canonicalMimeType.startsWith("image/")) {
    await assertImageMetadataReadable(path)
  }
}

async function assertUtf8Text(path: string): Promise<void> {
  const decoder = new TextDecoder("utf-8", { fatal: true })
  try {
    for await (const rawChunk of createReadStream(path)) {
      const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk)
      if (chunk.includes(0)) throw new AppError("KNOWLEDGE_DOCUMENT_INVALID")
      decoder.decode(chunk, { stream: true })
    }
    decoder.decode()
  } catch (error) {
    if (error instanceof AppError) throw error
    throw new AppError("KNOWLEDGE_DOCUMENT_INVALID")
  }
}

async function hasCfbfSignature(path: string): Promise<boolean> {
  const handle = await open(path, "r")
  try {
    const buffer = Buffer.alloc(CFBF_SIGNATURE.byteLength)
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
    return bytesRead === buffer.length && buffer.equals(CFBF_SIGNATURE)
  } finally {
    await handle.close()
  }
}

async function inspectPdfTrailer(path: string): Promise<void> {
  const handle = await open(path, "r")
  try {
    const stat = await handle.stat()
    const size = Math.min(stat.size, PDF_TRAILER_INSPECTION_BYTES)
    const buffer = Buffer.alloc(size)
    await handle.read(buffer, 0, size, stat.size - size)
    const trailer = buffer.toString("latin1")
    if (/\/Encrypt\b/u.test(trailer)) {
      throw new AppError("KNOWLEDGE_DOCUMENT_ENCRYPTED")
    }
    if (!/%%EOF(?:\s|\0)*$/u.test(trailer)) {
      throw new AppError("KNOWLEDGE_DOCUMENT_INVALID")
    }
  } finally {
    await handle.close()
  }
}

async function assertImageMetadataReadable(path: string): Promise<void> {
  try {
    const metadata = await sharp(path, { failOn: "error" }).metadata()
    if (
      metadata.width === undefined ||
      metadata.width <= 0 ||
      metadata.height === undefined ||
      metadata.height <= 0
    ) {
      throw new AppError("KNOWLEDGE_DOCUMENT_INVALID")
    }
  } catch (error) {
    if (error instanceof AppError) throw error
    throw new AppError("KNOWLEDGE_DOCUMENT_INVALID")
  }
}

async function inspectOfficeZip(
  path: string,
  extension: SupportedExtension,
  format: SupportedFormat,
): Promise<void> {
  const entries = await openAndValidateZip(path)
  const names = new Set(entries.map((entry) => normalizedZipPath(entry.path)))
  const mainPath = ({
    docx: "word/document.xml",
    xlsx: "xl/workbook.xml",
    pptx: "ppt/presentation.xml",
  } as Partial<Record<SupportedExtension, string>>)[extension]
  if (
    mainPath === undefined ||
    !names.has("[content_types].xml") ||
    !names.has("_rels/.rels") ||
    !names.has(mainPath)
  ) {
    throw new AppError("KNOWLEDGE_DOCUMENT_INVALID")
  }
  if (
    [...names].some(
      (name) =>
        name.endsWith("vbaproject.bin") ||
        name.endsWith("vbadata.xml") ||
        name.includes("/activex/"),
    )
  ) {
    throw new AppError("KNOWLEDGE_DOCUMENT_TYPE_UNSUPPORTED")
  }
  const contentTypes = await readSmallZipEntry(
    entries,
    "[content_types].xml",
  )
  const text = contentTypes.toString("utf8")
  if (
    /macroenabled|vnd\.ms-office\.vbaproject/iu.test(text) ||
    !text.toLocaleLowerCase("en-US").includes(format.canonicalMimeType)
  ) {
    throw new AppError(
      /macroenabled|vnd\.ms-office\.vbaproject/iu.test(text)
        ? "KNOWLEDGE_DOCUMENT_TYPE_UNSUPPORTED"
        : "KNOWLEDGE_DOCUMENT_INVALID",
    )
  }
}

async function inspectOdfZip(
  path: string,
  format: SupportedFormat,
): Promise<void> {
  const entries = await openAndValidateZip(path)
  const names = new Set(entries.map((entry) => normalizedZipPath(entry.path)))
  if (
    !names.has("mimetype") ||
    !names.has("content.xml") ||
    !names.has("meta-inf/manifest.xml")
  ) {
    throw new AppError("KNOWLEDGE_DOCUMENT_INVALID")
  }
  const mimetype = (
    await readSmallZipEntry(entries, "mimetype")
  ).toString("utf8")
  if (mimetype !== format.canonicalMimeType) {
    throw new AppError("KNOWLEDGE_DOCUMENT_INVALID")
  }
  const manifest = (
    await readSmallZipEntry(entries, "meta-inf/manifest.xml")
  ).toString("utf8")
  if (/manifest:encryption-data|<encryption-data\b/iu.test(manifest)) {
    throw new AppError("KNOWLEDGE_DOCUMENT_ENCRYPTED")
  }
  if ([...names].some(isOdfActivePackagePath)) {
    throw new AppError("KNOWLEDGE_DOCUMENT_TYPE_UNSUPPORTED")
  }
  inspectOdfManifestXml(manifest)
  let inspectedXmlBytes = 0
  for (const entry of entries) {
    const normalizedPath = normalizedZipPath(entry.path)
    if (
      entry.type === "File" &&
      normalizedPath.endsWith(".xml") &&
      normalizedPath !== "meta-inf/manifest.xml"
    ) {
      inspectedXmlBytes = nextOdfXmlInspectionBytes(
        inspectedXmlBytes,
        entry.uncompressedSize,
      )
      await inspectOdfDocumentXml(entry)
    }
  }
}

function isOdfActivePackagePath(path: string): boolean {
  const segments = path.split("/")
  if (segments.some((segment) => ODF_ACTIVE_PATH_SEGMENTS.has(segment))) {
    return true
  }
  const filename = segments.at(-1) ?? ""
  const extension = filename.includes(".")
    ? filename.slice(filename.lastIndexOf(".") + 1)
    : ""
  return ODF_ACTIVE_FILE_EXTENSIONS.has(extension)
}

function inspectOdfManifestXml(xml: string): void {
  const parser = createOdfXmlSecurityParser("manifest")
  try {
    parser.write(xml).close()
  } catch (error) {
    if (error instanceof AppError) throw error
    throw new AppError("KNOWLEDGE_DOCUMENT_INVALID")
  }
}

async function inspectOdfDocumentXml(entry: ZipEntry): Promise<void> {
  const parser = createOdfXmlSecurityParser("document")
  const decoder = new TextDecoder("utf-8", { fatal: true })
  const stream = entry.stream()
  try {
    for await (const rawChunk of stream) {
      const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk)
      writeOdfXmlChunk(parser, decoder.decode(chunk, { stream: true }))
    }
    writeOdfXmlChunk(parser, decoder.decode())
    parser.close()
  } catch (error) {
    stream.destroy()
    if (error instanceof AppError) throw error
    throw new AppError("KNOWLEDGE_DOCUMENT_INVALID")
  }
}

function writeOdfXmlChunk(
  parser: SaxesParser<{ xmlns: true }>,
  value: string,
): void {
  for (
    let offset = 0;
    offset < value.length;
    offset += ODF_XML_PARSE_CHUNK_CODE_UNITS
  ) {
    parser.write(value.slice(offset, offset + ODF_XML_PARSE_CHUNK_CODE_UNITS))
    assertOdfXmlParserBufferBudget(parser)
  }
}

function assertOdfXmlParserBufferBudget(
  parser: SaxesParser<{ xmlns: true }>,
): void {
  const buffers = parser as unknown as {
    text: string
    name: string
    piTarget: string
    entity: string
  }
  if (
    buffers.text.length > MAX_ODF_XML_TOKEN_CODE_UNITS ||
    buffers.name.length > MAX_ODF_XML_TOKEN_CODE_UNITS ||
    buffers.piTarget.length > MAX_ODF_XML_TOKEN_CODE_UNITS ||
    buffers.entity.length > MAX_ODF_XML_TOKEN_CODE_UNITS
  ) {
    throw new AppError("KNOWLEDGE_DOCUMENT_INVALID")
  }
}

function nextOdfXmlInspectionBytes(
  inspectedBytes: number,
  entryBytes: number,
): number {
  const next = inspectedBytes + entryBytes
  if (
    entryBytes > MAX_ODF_XML_ENTRY_INSPECTION_BYTES ||
    next > MAX_ODF_XML_TOTAL_INSPECTION_BYTES
  ) {
    throw new AppError("KNOWLEDGE_DOCUMENT_INVALID")
  }
  return next
}

function createOdfXmlSecurityParser(mode: "manifest" | "document") {
  const parser = new SaxesParser({ xmlns: true })
  let attributeCodeUnits = 0
  parser.on("opentagstart", () => {
    attributeCodeUnits = 0
  })
  parser.on("attribute", (attribute) => {
    attributeCodeUnits += attribute.name.length + attribute.value.length
    if (attributeCodeUnits > MAX_ODF_XML_TOKEN_CODE_UNITS) {
      throw new AppError("KNOWLEDGE_DOCUMENT_INVALID")
    }
  })
  parser.on("doctype", () => {
    throw new AppError("KNOWLEDGE_DOCUMENT_INVALID")
  })
  parser.on("opentag", (tag) => {
    const attributes = Object.values(tag.attributes)
    if (mode === "manifest") {
      if (
        tag.uri === ODF_MANIFEST_NAMESPACE &&
        tag.local === "encryption-data"
      ) {
        throw new AppError("KNOWLEDGE_DOCUMENT_ENCRYPTED")
      }
      if (
        tag.uri === ODF_MANIFEST_NAMESPACE &&
        tag.local === "file-entry"
      ) {
        const mediaType = attributes.find(
          (attribute) =>
            attribute.uri === ODF_MANIFEST_NAMESPACE &&
            attribute.local === "media-type",
        )?.value
        const fullPath = attributes.find(
          (attribute) =>
            attribute.uri === ODF_MANIFEST_NAMESPACE &&
            attribute.local === "full-path",
        )?.value
        if (
          (mediaType && isOdfActiveMediaType(mediaType)) ||
          (fullPath &&
            fullPath !== "/" &&
            isOdfActivePackagePath(normalizedZipPath(fullPath)))
        ) {
          throw new AppError("KNOWLEDGE_DOCUMENT_TYPE_UNSUPPORTED")
        }
      }
      return
    }

    if (
      (tag.uri === ODF_OFFICE_NAMESPACE &&
        (tag.local === "scripts" || tag.local === "forms")) ||
      tag.uri === ODF_SCRIPT_NAMESPACE ||
      tag.uri === ODF_FORM_NAMESPACE ||
      (tag.uri === ODF_TEXT_NAMESPACE &&
        (tag.local === "script" || tag.local === "execute-macro")) ||
      (tag.uri === ODF_TABLE_NAMESPACE && tag.local === "error-macro") ||
      (tag.uri === ODF_DRAW_NAMESPACE &&
        (tag.local === "applet" ||
          tag.local === "plugin" ||
          tag.local === "object-ole" ||
          tag.local === "floating-frame")) ||
      (tag.uri === ODF_PRESENTATION_NAMESPACE &&
        tag.local === "event-listener") ||
      attributes.some(
        (attribute) =>
          attribute.uri === ODF_SCRIPT_NAMESPACE ||
          (attribute.uri === ODF_DRAW_NAMESPACE &&
            attribute.local === "may-script") ||
          /^(?:javascript|macro|vnd\.sun\.star\.script):/iu.test(
            attribute.value.trim(),
          ),
      )
    ) {
      throw new AppError("KNOWLEDGE_DOCUMENT_TYPE_UNSUPPORTED")
    }
  })
  return parser
}

function isOdfActiveMediaType(value: string): boolean {
  return /(?:^|[.+/-])(?:basic|ecmascript|java|javascript|python|script)(?:[.+/-]|$)/iu.test(
    value.trim(),
  )
}

async function openAndValidateZip(path: string): Promise<ZipEntry[]> {
  let archive: Awaited<ReturnType<typeof Open.file>>
  try {
    archive = await Open.file(path)
  } catch {
    throw new AppError("KNOWLEDGE_DOCUMENT_INVALID")
  }
  if (archive.files.length === 0 || archive.files.length > MAX_ZIP_ENTRIES) {
    throw new AppError("KNOWLEDGE_DOCUMENT_INVALID")
  }
  let expandedBytes = 0
  const paths = new Set<string>()
  for (const entry of archive.files) {
    const normalizedPath = normalizedZipPath(entry.path)
    if (paths.has(normalizedPath) || isZipSymlink(entry.externalFileAttributes)) {
      throw new AppError("KNOWLEDGE_DOCUMENT_INVALID")
    }
    paths.add(normalizedPath)
    if ((entry.flags & 0x1) !== 0) {
      throw new AppError("KNOWLEDGE_DOCUMENT_ENCRYPTED")
    }
    if (entry.uncompressedSize > MAX_ZIP_ENTRY_BYTES) {
      throw new AppError("KNOWLEDGE_DOCUMENT_INVALID")
    }
    if (
      entry.uncompressedSize > 0 &&
      (entry.compressedSize === 0 ||
        entry.uncompressedSize / entry.compressedSize > MAX_ZIP_COMPRESSION_RATIO)
    ) {
      throw new AppError("KNOWLEDGE_DOCUMENT_INVALID")
    }
    expandedBytes += entry.uncompressedSize
    if (expandedBytes > MAX_ZIP_EXPANDED_BYTES) {
      throw new AppError("KNOWLEDGE_DOCUMENT_INVALID")
    }
  }
  return archive.files
}

function normalizedZipPath(path: string): string {
  const raw = path.replaceAll("\\", "/").normalize("NFC")
  const normalized = raw.endsWith("/") ? raw.slice(0, -1) : raw
  if (
    normalized.length === 0 ||
    normalized.startsWith("/") ||
    /^[a-z]:\//iu.test(normalized) ||
    normalized.includes("\0") ||
    normalized.split("/").some((segment) => segment === ".." || segment === "")
  ) {
    throw new AppError("KNOWLEDGE_DOCUMENT_INVALID")
  }
  return normalized.toLocaleLowerCase("en-US")
}

function isZipSymlink(externalAttributes: number): boolean {
  return ((externalAttributes >>> 16) & 0o170000) === 0o120000
}

async function readSmallZipEntry(
  entries: ZipEntry[],
  normalizedPath: string,
): Promise<Buffer> {
  const entry = entries.find(
    (candidate) => normalizedZipPath(candidate.path) === normalizedPath,
  )
  if (
    entry === undefined ||
    entry.type !== "File" ||
    entry.uncompressedSize > MAX_XML_INSPECTION_BYTES
  ) {
    throw new AppError("KNOWLEDGE_DOCUMENT_INVALID")
  }
  try {
    const value = await entry.buffer()
    if (value.byteLength !== entry.uncompressedSize) {
      throw new AppError("KNOWLEDGE_DOCUMENT_INVALID")
    }
    return value
  } catch (error) {
    if (error instanceof AppError) throw error
    throw new AppError("KNOWLEDGE_DOCUMENT_INVALID")
  }
}

function assertObjectBelongsToKnowledgeBase(
  objectKey: string,
  knowledgeBaseId: string,
): void {
  if (!objectKey.startsWith(`knowledge-bases/${knowledgeBaseId}/documents/`)) {
    throw new AppError("KNOWLEDGE_DOCUMENT_INVALID")
  }
}

export const knowledgeIngestionTesting = {
  sanitizeKnowledgeFilename,
  normalizeDisplayName,
  extensionOf,
  normalizedZipPath,
  nextOdfXmlInspectionBytes,
}
