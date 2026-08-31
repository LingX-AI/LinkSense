import {
  imageUnderstandingDescriptionSchema,
  type ImageUnderstandingDescription,
  type ImageUnderstandingSnapshot,
} from "@linksense/shared"
import pLimit from "p-limit"
import { z } from "zod"

import {
  createAssetReferenceId,
  normalizeAssetUri,
} from "./asset-processor.js"
import {
  assertDoclingDocumentContract,
  doclingImageBearingCollections,
} from "./docling-document-contract.js"
import {
  DOCLING_HYBRID_IMAGE_PLACEHOLDER,
  type HybridChunk,
  type HybridChunkResult,
} from "./docling-hybrid.js"
import { KnowledgeProcessingError } from "./errors.js"
import type { ImageUnderstandingClient } from "./image-understanding-client.js"
import type { ResolvedImageUnderstandingRuntime } from "../system/image-understanding-settings.js"
import { cl100kTokenEstimator } from "./token-estimator.js"

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u)
const assetReferenceSchema = z.string().uuid()

const projectedImageSchema = z.strictObject({
  selfRef: z.string().min(1),
  sourceUri: z.string().min(1),
  assetReferenceId: assetReferenceSchema,
  pageNumber: z.number().int().positive().nullable(),
  headings: z.array(z.string()),
  captions: z.array(z.string()),
  childChunkIndex: z.number().int().nonnegative(),
  description: imageUnderstandingDescriptionSchema.nullable(),
})

const projectedChunkSchema = z.strictObject({
  chunkIndex: z.number().int().nonnegative(),
  text: z.string().min(1),
  rawText: z.string().min(1),
  numTokens: z.number().int().positive(),
  headings: z.array(z.string()),
  captions: z.array(z.string()),
  docItems: z.array(z.string().min(1)).min(1),
  pageNumbers: z.array(z.number().int().positive()),
  metadata: z.record(z.string(), z.unknown()),
})

export const imageProjectionSchema = z
  .strictObject({
    filename: z.string().min(1),
    configDigest: sha256Schema,
    images: z.array(projectedImageSchema),
    chunks: z.array(projectedChunkSchema).min(1),
  })
  .superRefine((projection, context) => {
    for (const [index, chunk] of projection.chunks.entries()) {
      if (chunk.chunkIndex !== index) {
        context.addIssue({
          code: "custom",
          path: ["chunks", index, "chunkIndex"],
          message: "invalid projected chunk order",
        })
      }
    }
    const selfRefs = projection.images.map((image) => image.selfRef)
    if (new Set(selfRefs).size !== selfRefs.length) {
      context.addIssue({
        code: "custom",
        path: ["images"],
        message: "image self refs must be unique",
      })
    }
  })

export type ImageProjection = z.infer<typeof imageProjectionSchema>

export type ImageProjectionAsset = {
  assetReferenceId: string
  safeSha256: string
  bytes: Buffer
}

export async function buildImageProjection(input: {
  filename: string
  doclingJson: unknown
  originalSha256: string
  hybrid: HybridChunkResult
  assets: readonly ImageProjectionAsset[]
  snapshot: ImageUnderstandingSnapshot
  runtime: ResolvedImageUnderstandingRuntime | null
  client: ImageUnderstandingClient
  concurrency: number
  projectionMaximumTokens: number
  signal?: AbortSignal
  onProgress?: (completed: number, total: number) => Promise<void> | void
}): Promise<ImageProjection> {
  assertDoclingDocumentContract(input.doclingJson)
  const collected = collectImageContexts(
    input.doclingJson,
    input.hybrid.chunks,
  )
  const contexts = collected.contexts
  const inventory = mapAssets(
    input.originalSha256,
    collected.candidates,
    input.assets,
  )
  const descriptions = new Map<string, ImageUnderstandingDescription>()

  if (input.snapshot.enabled && contexts.length > 0) {
    if (input.runtime === null) {
      throw new KnowledgeProcessingError(
        "KNOWLEDGE_IMAGE_MODEL_CONFIGURATION_CHANGED",
      )
    }
    const limit = pLimit(assertConcurrency(input.concurrency))
    const failed = new AbortController()
    const signal = input.signal
      ? AbortSignal.any([input.signal, failed.signal])
      : failed.signal
    let completed = 0
    const tasks = contexts.map((context) =>
      limit(async () => {
        try {
          assertNotAborted(signal)
          const asset = inventory.get(context.selfRef)
          if (!asset) throw invalidPosition()
          const description = await input.client.describe(
            {
              image: asset.bytes,
              pageNumber: context.pageNumber,
              headings: context.headings,
              captions: context.captions,
              nearbyText: nearbyText(
                input.hybrid.chunks[context.childChunkIndex]!,
              ),
            },
            input.runtime!,
            signal,
          )
          descriptions.set(
            context.selfRef,
            imageUnderstandingDescriptionSchema.parse(description),
          )
          completed += 1
          await input.onProgress?.(completed, contexts.length)
        } catch (error) {
          failed.abort()
          throw error
        }
      }),
    )
    try {
      await Promise.all(tasks)
    } catch (error) {
      failed.abort()
      await Promise.allSettled(tasks)
      throw error
    }
  }

  const byChunk = new Map<number, ImageContext[]>()
  for (const context of contexts) {
    const items = byChunk.get(context.childChunkIndex) ?? []
    items.push(context)
    byChunk.set(context.childChunkIndex, items)
  }

  const chunks = input.hybrid.chunks.map((chunk) =>
    projectChunk(
      chunk,
      byChunk.get(chunk.chunkIndex) ?? [],
      inventory,
      descriptions,
      input.projectionMaximumTokens,
    ),
  )
  return imageProjectionSchema.parse({
    filename: input.filename,
    configDigest: input.snapshot.config_digest,
    images: contexts.map((context) => ({
      selfRef: context.selfRef,
      sourceUri: context.sourceUri,
      assetReferenceId: inventory.get(context.selfRef)!.assetReferenceId,
      pageNumber: context.pageNumber,
      headings: context.headings,
      captions: context.captions,
      childChunkIndex: context.childChunkIndex,
      description: descriptions.get(context.selfRef) ?? null,
    })),
    chunks,
  })
}

type ImageContext = {
  selfRef: string
  sourceUri: string
  pageNumber: number | null
  headings: string[]
  captions: string[]
  childChunkIndex: number
}

type ImageCandidate = Pick<
  ImageContext,
  "selfRef" | "sourceUri" | "pageNumber"
> & {
  contentLayer: string
}

type CollectedImageContexts = {
  candidates: ImageCandidate[]
  contexts: ImageContext[]
}

function collectImageContexts(
  document: Record<string, unknown>,
  chunks: readonly HybridChunk[],
): CollectedImageContexts {
  const candidates: ImageCandidate[] = []
  for (const collection of doclingImageBearingCollections()) {
    const value = Reflect.get(document, collection.propertyName)
    if (value === undefined) continue
    let entries: Array<[string, unknown]>
    if (collection.containerKind === "array" && Array.isArray(value)) {
      entries = value.map((entry, index) => [String(index), entry])
    } else if (collection.containerKind === "record" && isRecord(value)) {
      entries = Object.entries(value)
    } else {
      throw invalidPosition()
    }
    for (const [location, rawItem] of entries) {
      if (!isRecord(rawItem)) throw invalidPosition()
      const image = Reflect.get(rawItem, "image")
      if (image === undefined || image === null) continue
      if (!isRecord(image) || typeof image.uri !== "string") {
        throw invalidPosition()
      }
      const fallback = `#/${escapePointer(collection.propertyName)}/${escapePointer(location)}`
      const rawSelfRef = Reflect.get(rawItem, "self_ref")
      if (rawSelfRef !== undefined && typeof rawSelfRef !== "string") {
        throw invalidPosition()
      }
      const rawContentLayer = Reflect.get(rawItem, "content_layer")
      if (
        rawContentLayer !== undefined &&
        typeof rawContentLayer !== "string"
      ) {
        throw invalidPosition()
      }
      candidates.push({
        selfRef: rawSelfRef ?? fallback,
        sourceUri: normalizeAssetUri(image.uri),
        pageNumber: extractPageNumber(rawItem),
        contentLayer: rawContentLayer ?? "body",
      })
    }
  }

  const seen = new Set<string>()
  const contexts: ImageContext[] = []
  for (const candidate of candidates) {
    if (seen.has(candidate.selfRef)) throw invalidPosition()
    seen.add(candidate.selfRef)
    const matches = chunks.filter((chunk) =>
      chunk.docItems.includes(candidate.selfRef),
    )
    if (matches.length === 0 && candidate.contentLayer !== "body") {
      continue
    }
    if (matches.length !== 1) throw invalidPosition()
    const chunk = matches[0]!
    contexts.push({
      selfRef: candidate.selfRef,
      sourceUri: candidate.sourceUri,
      pageNumber: candidate.pageNumber ?? chunk.pageNumbers[0] ?? null,
      headings: [...chunk.headings],
      captions: [...chunk.captions],
      childChunkIndex: chunk.chunkIndex,
    })
  }
  return { candidates, contexts }
}

function mapAssets(
  originalSha256: string,
  candidates: readonly ImageCandidate[],
  assets: readonly ImageProjectionAsset[],
): Map<string, ImageProjectionAsset> {
  const byReference = new Map(
    assets.map((asset) => [
      assetReferenceSchema.parse(asset.assetReferenceId),
      {
        ...asset,
        safeSha256: sha256Schema.parse(asset.safeSha256),
      },
    ]),
  )
  if (byReference.size !== assets.length) throw invalidPosition()
  const used = new Set<string>()
  const result = new Map<string, ImageProjectionAsset>()
  for (const candidate of candidates) {
    const matches = assets.filter(
      (asset) =>
        createAssetReferenceId({
          originalSha256,
          sourceUri: candidate.sourceUri,
          safeSha256: asset.safeSha256,
        }) === asset.assetReferenceId,
    )
    if (matches.length !== 1) throw invalidPosition()
    const match = matches[0]!
    result.set(candidate.selfRef, match)
    used.add(match.assetReferenceId)
  }
  if (used.size !== assets.length) throw invalidPosition()
  return result
}

function projectChunk(
  chunk: HybridChunk,
  contexts: readonly ImageContext[],
  inventory: ReadonlyMap<string, ImageProjectionAsset>,
  descriptions: ReadonlyMap<string, ImageUnderstandingDescription>,
  maximumTokens: number,
): HybridChunk {
  if (contexts.length === 0) return { ...chunk }
  const imageSelfRefs = chunk.docItems.filter((selfRef) =>
    contexts.some((context) => context.selfRef === selfRef),
  )
  if (
    imageSelfRefs.length !== contexts.length ||
    countPlaceholders(chunk.rawText) !== contexts.length ||
    countPlaceholders(chunk.text) !== contexts.length
  ) {
    throw invalidPosition()
  }
  const ordered = imageSelfRefs.map((selfRef) => {
    const context = contexts.find((item) => item.selfRef === selfRef)
    const asset = inventory.get(selfRef)
    if (!context || !asset) throw invalidPosition()
    return createMarkdown(context, asset, descriptions.get(selfRef) ?? null)
  })
  const rawText = replacePlaceholders(chunk.rawText, ordered)
  const text = replacePlaceholders(chunk.text, ordered)
  const tokens = cl100kTokenEstimator.count(text)
  if (tokens > maximumTokens) {
    throw new KnowledgeProcessingError(
      "KNOWLEDGE_DOCUMENT_STRUCTURE_INVALID",
    )
  }
  return {
    ...chunk,
    rawText,
    text,
    numTokens: Math.max(1, tokens),
  }
}

function createMarkdown(
  context: ImageContext,
  asset: ImageProjectionAsset,
  description: ImageUnderstandingDescription | null,
): string {
  const page = context.pageNumber === null ? null : `第 ${context.pageNumber} 页`
  const caption = context.captions.map(cleanInline).filter(Boolean).join("；")
  const alt = cleanAlt(
    description?.description ||
      caption ||
      (page === null ? "文档图片" : `文档图片（${page}）`),
  )
  return `![${alt}](kb-asset://${asset.assetReferenceId})`
}

function extractPageNumber(item: Record<string, unknown>): number | null {
  const provenance = Reflect.get(item, "prov")
  if (!Array.isArray(provenance) || provenance.length === 0) return null
  const pages = provenance
    .map((entry) =>
      isRecord(entry) && Number.isSafeInteger(entry.page_no)
        ? Number(entry.page_no)
        : null,
    )
    .filter((page): page is number => page !== null && page > 0)
  const unique = [...new Set(pages)]
  if (unique.length > 1) throw invalidPosition()
  return unique[0] ?? null
}

function nearbyText(chunk: HybridChunk): string {
  return chunk.rawText
    .replaceAll(DOCLING_HYBRID_IMAGE_PLACEHOLDER, "")
    .trim()
    .slice(0, 4_000)
}

function countPlaceholders(value: string): number {
  return value.split(DOCLING_HYBRID_IMAGE_PLACEHOLDER).length - 1
}

function replacePlaceholders(value: string, replacements: readonly string[]): string {
  let index = 0
  const result = value.replaceAll(
    DOCLING_HYBRID_IMAGE_PLACEHOLDER,
    () => replacements[index++] ?? "",
  )
  if (index !== replacements.length) throw invalidPosition()
  return result
}

function cleanAlt(value: string): string {
  return cleanInline(value).replaceAll("[", "\\[").replaceAll("]", "\\]")
}

function cleanInline(value: string): string {
  return value.replace(/\s+/gu, " ").trim().slice(0, 500)
}

function escapePointer(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1")
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function assertConcurrency(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 16) {
    throw invalidPosition()
  }
  return value
}

function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new KnowledgeProcessingError("KNOWLEDGE_PROCESSING_CANCELLED")
  }
}

function invalidPosition(): KnowledgeProcessingError {
  return new KnowledgeProcessingError("KNOWLEDGE_IMAGE_POSITION_INVALID")
}
