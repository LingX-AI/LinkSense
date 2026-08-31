import { createHash } from "node:crypto"
import { readFile, stat } from "node:fs/promises"
import { basename, posix } from "node:path"

import pLimit from "p-limit"
import sharp from "sharp"
import { v5 as uuidv5 } from "uuid"
import { z } from "zod"

import {
  assertDoclingDocumentContract,
  doclingImageBearingCollections,
  type DoclingImageBearingCollection,
} from "./docling-document-contract.js"
import { KnowledgeProcessingError } from "./errors.js"

const assetReferenceNamespace = "f45bdb40-82a4-5ec8-a519-d97610916f93"
const managedInlineAssetDirectory = "artifacts/linksense-inline"
const assetProcessingConcurrency = 4
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u)

export type SafeKnowledgeAsset = {
  selfRef: string
  sourceUri: string
  assetReferenceId: string
  safeSha256: string
  bytes: Buffer
  contentType: "image/png"
}

export type KnowledgeAssetLimits = {
  maximumInputBytes: number
  maximumOutputBytes: number
  maximumPixels: number
}

export type ProcessedDoclingAssets = {
  doclingJson: Record<string, unknown>
  doclingJsonBytes: Buffer
  assets: SafeKnowledgeAsset[]
}

const defaultLimits: KnowledgeAssetLimits = {
  maximumInputBytes: 64 * 1024 * 1024,
  maximumOutputBytes: 128 * 1024 * 1024,
  maximumPixels: 40_000_000,
}

const acceptedImageFormatsByMimeType = new Map<
  string,
  ReadonlySet<string>
>([
  ["image/png", new Set(["png"])],
  ["image/jpeg", new Set(["jpeg"])],
  ["image/webp", new Set(["webp"])],
  ["image/tiff", new Set(["tiff"])],
  ["image/gif", new Set(["gif"])],
  ["image/heif", new Set(["heif"])],
  ["image/heic", new Set(["heif"])],
])

/**
 * Fully decodes and deterministically re-encodes Docling assets before storage.
 * Docling can occasionally retain a raster image as a data URI even when the
 * requested export mode is `referenced`. Those images are promoted into the
 * same managed asset model and their cloned JSON references are normalized.
 */
export async function processDoclingAssets(input: {
  doclingJson: unknown
  assetPaths: readonly string[]
  originalSha256: string
  limits?: KnowledgeAssetLimits
}): Promise<ProcessedDoclingAssets> {
  const limits = input.limits ?? defaultLimits
  validateLimits(limits)

  const doclingJson = cloneDoclingDocument(input.doclingJson)
  const candidates = collectImageAssetCandidates(doclingJson)
  const paths = indexAssetPaths(input.assetPaths)
  const sources = new Map<string, AssetSource>()
  for (const candidate of candidates) {
    if (candidate.imageUri === undefined) continue
    if (candidate.imageUri.startsWith("data:")) {
      const inline = decodeInlineImage(candidate.imageUri, limits)
      if (inline.mimeType !== candidate.mimeType) throw invalidAssetError()
      const key = `inline:${candidate.imageUri}`
      const previous = sources.get(key)
      if (previous) {
        if (
          previous.kind !== "inline" ||
          previous.mimeType !== inline.mimeType ||
          !previous.bytes.equals(inline.bytes)
        ) {
          throw invalidAssetError()
        }
        previous.candidates.push(candidate)
      } else {
        sources.set(key, {
          kind: "inline",
          selfRef: candidate.selfRef,
          mimeType: inline.mimeType,
          bytes: inline.bytes,
          candidates: [candidate],
        })
      }
      continue
    }

    const normalizedUri = normalizeAssetUri(candidate.imageUri)
    if (isManagedInlineAssetUri(normalizedUri)) throw invalidAssetError()
    const path = resolveJsonImageAsset(normalizedUri, paths)
    const key = `referenced:${normalizedUri}`
    const previous = sources.get(key)
    if (previous) {
      if (
        previous.kind !== "referenced" ||
        previous.path !== path ||
        previous.mimeType !== candidate.mimeType
      ) {
        throw invalidAssetError()
      }
      previous.candidates.push(candidate)
    } else {
      sources.set(key, {
        kind: "referenced",
        selfRef: candidate.selfRef,
        sourceUri: normalizedUri,
        path,
        mimeType: candidate.mimeType,
        candidates: [candidate],
      })
    }
  }

  const usedPaths = new Set(
    [...sources.values()]
      .filter((source): source is ReferencedAssetSource =>
        source.kind === "referenced",
      )
      .map(({ path }) => path),
  )
  if (
    usedPaths.size !== input.assetPaths.length ||
    input.assetPaths.some((path) => !usedPaths.has(path))
  ) {
    throw invalidAssetError()
  }

  const concurrency = pLimit(assetProcessingConcurrency)
  const processed = await Promise.all(
    [...sources.values()].map((source) =>
      concurrency(async () => {
        const safe =
          source.kind === "referenced"
            ? await safelyReencodeAsset(
                source.path,
                source.mimeType,
                limits,
              )
            : await safelyReencodeBytes(
                source.bytes,
                source.mimeType,
                limits,
              )
        const sourceUri =
          source.kind === "referenced"
            ? source.sourceUri
            : `${managedInlineAssetDirectory}/${safe.sha256}.png`
        for (const candidate of source.candidates) {
          Reflect.set(candidate.image, "uri", sourceUri)
        }
        return {
          selfRef: source.selfRef,
          sourceUri,
          assetReferenceId: createAssetReferenceId({
            originalSha256: input.originalSha256,
            sourceUri,
            safeSha256: safe.sha256,
          }),
          safeSha256: safe.sha256,
          bytes: safe.bytes,
          contentType: "image/png" as const,
        }
      }),
    ),
  )

  const bySourceUri = new Map<string, SafeKnowledgeAsset>()
  for (const asset of processed) {
    const previous = bySourceUri.get(asset.sourceUri)
    if (previous) {
      if (
        previous.safeSha256 !== asset.safeSha256 ||
        previous.assetReferenceId !== asset.assetReferenceId ||
        !previous.bytes.equals(asset.bytes)
      ) {
        throw invalidAssetError()
      }
      continue
    }
    bySourceUri.set(asset.sourceUri, asset)
  }

  assertDoclingDocumentContract(doclingJson)
  const doclingJsonBytes = serializeDoclingDocument(doclingJson)
  return {
    doclingJson,
    doclingJsonBytes,
    assets: [...bySourceUri.values()].sort((left, right) =>
      left.sourceUri.localeCompare(right.sourceUri),
    ),
  }
}

type ImageAssetReferenceCandidate = {
  selfRef: string
  image: Record<string, unknown>
  imageUri: string
  mimeType: string
}

type ImageAssetCandidate =
  | {
      selfRef: string
      image?: undefined
      imageUri?: undefined
      mimeType?: undefined
    }
  | ImageAssetReferenceCandidate

type ReferencedAssetSource = {
  kind: "referenced"
  selfRef: string
  sourceUri: string
  path: string
  mimeType: string
  candidates: ImageAssetReferenceCandidate[]
}

type InlineAssetSource = {
  kind: "inline"
  selfRef: string
  mimeType: string
  bytes: Buffer
  candidates: ImageAssetReferenceCandidate[]
}

type AssetSource = ReferencedAssetSource | InlineAssetSource

function cloneDoclingDocument(input: unknown): Record<string, unknown> {
  assertDoclingDocumentContract(input)
  try {
    const cloned: unknown = structuredClone(input)
    assertDoclingDocumentContract(cloned)
    return cloned
  } catch (error) {
    if (error instanceof KnowledgeProcessingError) throw error
    throw invalidAssetError(error)
  }
}

function collectImageAssetCandidates(input: unknown): ImageAssetCandidate[] {
  assertDoclingDocumentContract(input)
  return doclingImageBearingCollections().flatMap((collection) =>
    collectCollectionImageCandidates(input, collection),
  )
}

function collectCollectionImageCandidates(
  document: Record<string, unknown>,
  collection: DoclingImageBearingCollection,
): ImageAssetCandidate[] {
  const value = Reflect.get(document, collection.propertyName)
  if (value === undefined) return []

  const entries: ReadonlyArray<readonly [string, unknown]> =
    collection.containerKind === "array"
      ? Array.isArray(value)
        ? value.map((item, index) => [String(index), item] as const)
        : invalidAssetCollection()
      : isRecord(value)
        ? Object.entries(value)
        : invalidAssetCollection()

  return entries.map(([location, item]) =>
    imageAssetCandidate(
      item,
      `#/${escapeJsonPointerToken(collection.propertyName)}/${escapeJsonPointerToken(location)}`,
    ),
  )
}

function imageAssetCandidate(
  item: unknown,
  fallbackSelfRef: string,
): ImageAssetCandidate {
  if (!isRecord(item)) throw invalidAssetError()
  const rawSelfRef = Reflect.get(item, "self_ref")
  if (rawSelfRef !== undefined && typeof rawSelfRef !== "string") {
    throw invalidAssetError()
  }

  const image = Reflect.get(item, "image")
  if (image === undefined || image === null) {
    return {
      selfRef: rawSelfRef ?? fallbackSelfRef,
    }
  }
  if (!isRecord(image)) throw invalidAssetError()

  const uri = Reflect.get(image, "uri")
  const mimeType = Reflect.get(image, "mimetype")
  if (typeof uri !== "string" || typeof mimeType !== "string") {
    throw invalidAssetError()
  }
  return {
    selfRef: rawSelfRef ?? fallbackSelfRef,
    image,
    imageUri: uri,
    mimeType: normalizeImageMimeType(mimeType),
  }
}

function invalidAssetCollection(): never {
  throw invalidAssetError()
}

function escapeJsonPointerToken(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1")
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function resolveJsonImageAsset(
  rawUrl: string,
  paths: ReadonlyMap<string, string>,
): string {
  const normalized = rawUrl.replace(/^\.\//u, "")
  if (!normalized.startsWith("artifacts/")) throw invalidAssetError()
  return resolveReferencedAsset(rawUrl, paths)
}

export function normalizeAssetUri(rawUrl: string): string {
  if (
    rawUrl.includes("\\") ||
    rawUrl.includes("\0") ||
    rawUrl.includes("?") ||
    rawUrl.includes("#")
  ) {
    throw invalidAssetError()
  }
  let decoded: string
  try {
    decoded = decodeURIComponent(rawUrl)
  } catch {
    throw invalidAssetError()
  }
  const withoutPrefix = decoded.replace(/^\.\//u, "")
  const normalized = posix.normalize(withoutPrefix)
  if (
    normalized !== withoutPrefix ||
    normalized.startsWith("../") ||
    posix.isAbsolute(normalized) ||
    !normalized.startsWith("artifacts/")
  ) {
    throw invalidAssetError()
  }
  return normalized
}

function isManagedInlineAssetUri(uri: string): boolean {
  return (
    uri === managedInlineAssetDirectory ||
    uri.startsWith(`${managedInlineAssetDirectory}/`)
  )
}

function decodeInlineImage(
  uri: string,
  limits: KnowledgeAssetLimits,
): { mimeType: string; bytes: Buffer } {
  const separator = uri.indexOf(",")
  if (
    separator <= "data:".length ||
    separator !== uri.lastIndexOf(",")
  ) {
    throw invalidAssetError()
  }
  const metadata = uri.slice("data:".length, separator)
  const parts = metadata.split(";")
  if (parts.length !== 2 || parts[1] !== "base64") {
    throw invalidAssetError()
  }
  const mimeType = normalizeImageMimeType(parts[0]!)
  const encoded = uri.slice(separator + 1)
  const bytes = decodeCanonicalBase64(encoded, limits.maximumInputBytes)
  return { mimeType, bytes }
}

function decodeCanonicalBase64(value: string, maximumBytes: number): Buffer {
  if (
    value.length === 0 ||
    value.length % 4 !== 0 ||
    value.length > Math.ceil(maximumBytes / 3) * 4
  ) {
    throw invalidAssetError()
  }

  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0
  const contentLength = value.length - padding
  for (let index = 0; index < contentLength; index += 1) {
    if (base64Value(value.charCodeAt(index)) < 0) throw invalidAssetError()
  }
  for (let index = contentLength; index < value.length; index += 1) {
    if (value.charCodeAt(index) !== 0x3d) throw invalidAssetError()
  }

  if (
    (padding === 2 &&
      (base64Value(value.charCodeAt(contentLength - 1)) & 0x0f) !== 0) ||
    (padding === 1 &&
      (base64Value(value.charCodeAt(contentLength - 1)) & 0x03) !== 0)
  ) {
    throw invalidAssetError()
  }

  const decodedLength = (value.length / 4) * 3 - padding
  if (decodedLength <= 0 || decodedLength > maximumBytes) {
    throw invalidAssetError()
  }
  const bytes = Buffer.from(value, "base64")
  if (bytes.length !== decodedLength) throw invalidAssetError()
  return bytes
}

function base64Value(character: number): number {
  if (character >= 0x41 && character <= 0x5a) return character - 0x41
  if (character >= 0x61 && character <= 0x7a) return character - 0x61 + 26
  if (character >= 0x30 && character <= 0x39) return character - 0x30 + 52
  if (character === 0x2b) return 62
  if (character === 0x2f) return 63
  return -1
}

function normalizeImageMimeType(value: string): string {
  if (value.trim() !== value) throw invalidAssetError()
  const normalized = value.toLowerCase()
  if (!acceptedImageFormatsByMimeType.has(normalized)) {
    throw invalidAssetError()
  }
  return normalized
}

function serializeDoclingDocument(document: Record<string, unknown>): Buffer {
  try {
    return Buffer.from(JSON.stringify(document), "utf8")
  } catch (error) {
    throw invalidAssetError(error)
  }
}

function indexAssetPaths(assetPaths: readonly string[]): Map<string, string> {
  const index = new Map<string, string>()
  for (const path of assetPaths) {
    const normalized = path.replaceAll("\\", "/")
    const artifactOffset = normalized.lastIndexOf("/artifacts/")
    const key =
      artifactOffset >= 0
        ? normalized.slice(artifactOffset + 1)
        : `artifacts/${basename(normalized)}`
    if (index.has(key)) throw invalidAssetError()
    index.set(key, path)
  }
  return index
}

function resolveReferencedAsset(
  rawUrl: string,
  paths: ReadonlyMap<string, string>,
): string {
  if (
    rawUrl.includes("\\") ||
    rawUrl.includes("\0") ||
    rawUrl.includes("?") ||
    rawUrl.includes("#")
  ) {
    throw invalidAssetError()
  }
  let decoded: string
  try {
    decoded = decodeURIComponent(rawUrl)
  } catch {
    throw invalidAssetError()
  }
  const normalized = posix.normalize(decoded.replace(/^\.\//u, ""))
  if (
    normalized !== decoded.replace(/^\.\//u, "") ||
    normalized.startsWith("../") ||
    posix.isAbsolute(normalized) ||
    !normalized.startsWith("artifacts/")
  ) {
    throw invalidAssetError()
  }
  const path = paths.get(normalized)
  if (!path) throw invalidAssetError()
  return path
}

export function createAssetReferenceId(input: {
  originalSha256: string
  sourceUri: string
  safeSha256: string
}): string {
  const originalSha256 = sha256Schema.parse(input.originalSha256)
  const safeSha256 = sha256Schema.parse(input.safeSha256)
  return uuidv5(
    [
      "linksense-kb-asset",
      originalSha256,
      input.sourceUri,
      safeSha256,
    ].join(":"),
    assetReferenceNamespace,
  )
}

async function safelyReencodeAsset(
  path: string,
  mimeType: string,
  limits: KnowledgeAssetLimits,
): Promise<{ bytes: Buffer; sha256: string }> {
  try {
    const file = await stat(path)
    if (!file.isFile() || file.size <= 0 || file.size > limits.maximumInputBytes) {
      throw invalidAssetError()
    }
    const bytes = await readFile(path)
    if (bytes.length !== file.size) throw invalidAssetError()
    return await safelyReencodeBytes(bytes, mimeType, limits)
  } catch (error) {
    if (error instanceof KnowledgeProcessingError) throw error
    throw invalidAssetError(error)
  }
}

async function safelyReencodeBytes(
  input: Buffer,
  mimeType: string,
  limits: KnowledgeAssetLimits,
): Promise<{ bytes: Buffer; sha256: string }> {
  try {
    if (input.length <= 0 || input.length > limits.maximumInputBytes) {
      throw invalidAssetError()
    }
    const pipeline = sharp(input, {
      animated: false,
      failOn: "error",
      limitInputPixels: limits.maximumPixels,
      sequentialRead: true,
    })
    const metadata = await pipeline.metadata()
    const acceptedFormats = acceptedImageFormatsByMimeType.get(mimeType)
    if (
      !acceptedFormats ||
      !metadata.format ||
      !acceptedFormats.has(metadata.format) ||
      !metadata.width ||
      !metadata.height ||
      metadata.width * metadata.height > limits.maximumPixels ||
      (metadata.pages ?? 1) !== 1
    ) {
      throw invalidAssetError()
    }
    // A fresh PNG encode strips EXIF, ICC, XMP and active payload metadata.
    const bytes = await sharp(input, {
      animated: false,
      failOn: "error",
      limitInputPixels: limits.maximumPixels,
    })
      .rotate()
      .png({
        adaptiveFiltering: false,
        compressionLevel: 9,
        palette: false,
      })
      .toBuffer()
    if (bytes.length === 0 || bytes.length > limits.maximumOutputBytes) {
      throw invalidAssetError()
    }
    return {
      bytes,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    }
  } catch (error) {
    if (error instanceof KnowledgeProcessingError) throw error
    throw invalidAssetError(error)
  }
}

function validateLimits(limits: KnowledgeAssetLimits): void {
  if (
    !Number.isSafeInteger(limits.maximumInputBytes) ||
    !Number.isSafeInteger(limits.maximumOutputBytes) ||
    !Number.isSafeInteger(limits.maximumPixels) ||
    limits.maximumInputBytes <= 0 ||
    limits.maximumOutputBytes <= 0 ||
    limits.maximumPixels <= 0
  ) {
    throw invalidAssetError()
  }
}

function invalidAssetError(cause?: unknown): KnowledgeProcessingError {
  return new KnowledgeProcessingError("KNOWLEDGE_DOCLING_RESULT_UNSAFE", {
    cause,
  })
}
