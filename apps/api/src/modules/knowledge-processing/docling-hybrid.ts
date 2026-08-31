import { basename, extname } from "node:path"
import { Readable } from "node:stream"

import { z } from "zod"

import { containsControlCharacter } from "../../lib/text.js"
import { assertDoclingDocumentContract } from "./docling-document-contract.js"
import { KnowledgeProcessingError } from "./errors.js"

export const DOCLING_HYBRID_MAX_TOKENS = 768
export const DOCLING_HYBRID_IMAGE_PLACEHOLDER = "![IMAGE]"

const maximumDoclingJsonBytes = 256 * 1024 * 1024
const maximumChunkCount = 100_000
const maximumChunkTextLength = 2 * 1024 * 1024
const maximumMetadataNodes = 2_000
const maximumMetadataDepth = 12
const maximumMetadataStringLength = 64 * 1024

const conversionStatusSchema = z.enum([
  "success",
  "failure",
  "partial_success",
  "skipped",
])

const resultErrorSchema = z.strictObject({
  component_type: z.string(),
  module_name: z.string(),
  error_message: z.string(),
  category: z
    .enum([
      "policy",
      "capacity",
      "source_unavailable",
      "target_unavailable",
      "timeout",
      "internal",
      "backend_failure",
      "inference_failure",
      "unknown",
    ])
    .default("unknown"),
  page_no: z.number().int().nullable().optional(),
})

const exportContentSchema = z.strictObject({
  filename: z.string().trim().min(1).max(1_024),
  md_content: z.string().nullable().optional(),
  json_content: z.record(z.string(), z.unknown()).nullable().optional(),
  html_content: z.string().nullable().optional(),
  text_content: z.string().nullable().optional(),
  doctags_content: z.string().nullable().optional(),
  doclang_content: z.string().nullable().optional(),
})

const documentResultSchema = z.strictObject({
  kind: z.literal("ExportResult").optional(),
  content: exportContentSchema,
  status: conversionStatusSchema,
  errors: z.array(resultErrorSchema).default([]),
  timings: z.record(z.string(), z.unknown()).default({}),
  confidence: z.record(z.string(), z.unknown()).nullable().optional(),
})

const hybridChunkWireSchema = z.strictObject({
  filename: z.string().trim().min(1).max(1_024),
  chunk_index: z.number().int().nonnegative(),
  text: z.string().min(1).max(maximumChunkTextLength),
  raw_text: z.string().min(1).max(maximumChunkTextLength),
  num_tokens: z.number().int().positive(),
  headings: z.array(z.string().max(maximumChunkTextLength)).nullable().optional(),
  captions: z.array(z.string().max(maximumChunkTextLength)).nullable().optional(),
  doc_items: z
    .array(
      z
        .string()
        .regex(/^#\/[\w-]+\/\d+$/u)
        .max(1_024),
    )
    .min(1),
  page_numbers: z
    .array(z.number().int().positive().max(10_000_000))
    .nullable()
    .optional(),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
})

const hybridChunkResponseSchema = z.strictObject({
  chunks: z.array(hybridChunkWireSchema).max(maximumChunkCount),
  documents: z.array(documentResultSchema).length(1),
  processing_time: z.number().finite().nonnegative(),
})

export type DoclingHybridChunkOptions = {
  tokenizer: string
  maxTokens: number
  mergePeers: false
  includeRawText: true
}

export type DoclingHybridChunkInput = {
  filename: string
  json: Buffer
  options: DoclingHybridChunkOptions
}

export type HybridChunk = {
  chunkIndex: number
  text: string
  rawText: string
  numTokens: number
  headings: string[]
  captions: string[]
  docItems: string[]
  pageNumbers: number[]
  metadata: Record<string, unknown>
}

export type HybridChunkResult = {
  filename: string
  chunks: HybridChunk[]
}

export const requiredHybridMultipartFields = [
  "files",
  "convert_from_formats",
  "chunking_use_markdown_tables",
  "chunking_use_markdown_images",
  "chunking_image_placeholder",
  "chunking_include_raw_text",
  "chunking_tokenizer",
  "chunking_max_tokens",
  "chunking_merge_peers",
  "include_converted_doc",
  "target_type",
] as const

export function validateHybridChunkOptions(
  options: DoclingHybridChunkOptions,
): void {
  if (
    options.mergePeers !== false ||
    options.includeRawText !== true ||
    typeof options.tokenizer !== "string" ||
    options.tokenizer.trim() !== options.tokenizer ||
    options.tokenizer.length === 0 ||
    options.tokenizer.length > 1_024 ||
    containsControlCharacter(options.tokenizer) ||
    !Number.isSafeInteger(options.maxTokens) ||
    options.maxTokens <= 0 ||
    options.maxTokens > 8_192
  ) {
    throw new KnowledgeProcessingError(
      "KNOWLEDGE_DOCLING_CONTRACT_INCOMPATIBLE",
    )
  }
}

export function validateDoclingJsonBytes(bytes: Buffer): unknown {
  if (bytes.length === 0 || bytes.length > maximumDoclingJsonBytes) {
    throw new KnowledgeProcessingError("KNOWLEDGE_DOCLING_RESULT_INVALID")
  }
  try {
    const jsonText = new TextDecoder("utf-8", { fatal: true }).decode(bytes)
    const document: unknown = JSON.parse(jsonText)
    assertDoclingDocumentContract(document)
    return document
  } catch (error) {
    if (error instanceof KnowledgeProcessingError) throw error
    throw new KnowledgeProcessingError("KNOWLEDGE_DOCLING_RESULT_INVALID", {
      cause: error,
    })
  }
}

export function createHybridChunkMultipartStream(input: {
  boundary: string
  request: DoclingHybridChunkInput
}): Readable {
  validateHybridChunkOptions(input.request.options)
  validateDoclingJsonBytes(input.request.json)

  const fields: Array<[string, string]> = [
    ["convert_from_formats", "json_docling"],
    ["chunking_use_markdown_tables", "true"],
    ["chunking_use_markdown_images", "true"],
    ["chunking_image_placeholder", DOCLING_HYBRID_IMAGE_PLACEHOLDER],
    ["chunking_include_raw_text", "true"],
    ["chunking_tokenizer", input.request.options.tokenizer],
    ["chunking_max_tokens", String(input.request.options.maxTokens)],
    ["chunking_merge_peers", "false"],
    ["include_converted_doc", "false"],
    ["target_type", "inbody"],
  ]
  const filename = safeJsonFilename(input.request.filename)

  async function* generate() {
    for (const [name, value] of fields) {
      yield Buffer.from(
        `--${input.boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
      )
    }
    yield Buffer.from(
      `--${input.boundary}\r\nContent-Disposition: form-data; name="files"; filename="${filename}"\r\nContent-Type: application/json\r\n\r\n`,
    )
    yield input.request.json
    yield Buffer.from(`\r\n--${input.boundary}--\r\n`)
  }

  return Readable.from(generate())
}

export function parseHybridChunkResponse(
  input: unknown,
  options: Pick<DoclingHybridChunkOptions, "maxTokens">,
): HybridChunkResult {
  if (
    !Number.isSafeInteger(options.maxTokens) ||
    options.maxTokens <= 0 ||
    options.maxTokens > 8_192
  ) {
    throw new KnowledgeProcessingError(
      "KNOWLEDGE_DOCLING_CONTRACT_INCOMPATIBLE",
    )
  }
  const parsed = hybridChunkResponseSchema.safeParse(input)
  if (!parsed.success) throw invalidHybridResult(parsed.error)

  const document = parsed.data.documents[0]!
  if (document.status !== "success" || document.errors.length !== 0) {
    throw invalidHybridResult()
  }
  if (parsed.data.chunks.length === 0) {
    // docling-jobkit 2.1.0 catches HybridChunker exceptions without changing
    // the task/document success status or exposing an error item. An empty
    // chunk list is therefore the only reliable signal that the configured
    // tokenizer/chunker is unavailable for a non-empty LinkSense document.
    throw new KnowledgeProcessingError(
      "KNOWLEDGE_DOCLING_CHUNKER_UNAVAILABLE",
      { retryable: true },
    )
  }

  const filename = parsed.data.chunks[0]!.filename
  if (
    document.content.filename !== filename ||
    parsed.data.chunks.some((chunk) => chunk.filename !== filename)
  ) {
    throw invalidHybridResult()
  }

  const chunks: HybridChunk[] = parsed.data.chunks.map((chunk, index) => {
    if (
      chunk.chunk_index !== index ||
      chunk.text.trim() === "" ||
      chunk.raw_text.trim() === "" ||
      chunk.num_tokens > options.maxTokens ||
      hasDuplicates(chunk.doc_items)
    ) {
      throw invalidHybridResult()
    }
    const pageNumbers = chunk.page_numbers ?? []
    if (!isSortedUnique(pageNumbers)) throw invalidHybridResult()
    if (chunk.metadata) assertMetadataBudget(chunk.metadata)

    return {
      chunkIndex: chunk.chunk_index,
      text: chunk.text,
      rawText: chunk.raw_text,
      numTokens: chunk.num_tokens,
      headings: chunk.headings ?? [],
      captions: chunk.captions ?? [],
      docItems: chunk.doc_items,
      pageNumbers,
      metadata: chunk.metadata ?? {},
    }
  })

  return { filename, chunks }
}

function safeJsonFilename(value: string): string {
  const clean = [...basename(value)]
    .filter((character) => {
      const codePoint = character.codePointAt(0)!
      return codePoint >= 0x20 && codePoint !== 0x7f && character !== '"'
    })
    .join("")
    .slice(0, 240)
  const withoutExtension =
    extname(clean) === "" ? clean : clean.slice(0, -extname(clean).length)
  const filename = `${withoutExtension || "document"}.json`
  return filename.slice(0, 255)
}

function hasDuplicates(values: readonly string[]): boolean {
  return new Set(values).size !== values.length
}

function isSortedUnique(values: readonly number[]): boolean {
  return values.every(
    (value, index) => index === 0 || value > values[index - 1]!,
  )
}

function assertMetadataBudget(value: unknown): void {
  let nodes = 0
  const visit = (current: unknown, depth: number): void => {
    nodes += 1
    if (nodes > maximumMetadataNodes || depth > maximumMetadataDepth) {
      throw invalidHybridResult()
    }
    if (typeof current === "string") {
      if (current.length > maximumMetadataStringLength) {
        throw invalidHybridResult()
      }
      return
    }
    if (Array.isArray(current)) {
      for (const entry of current) visit(entry, depth + 1)
      return
    }
    if (typeof current === "object" && current !== null) {
      for (const [key, entry] of Object.entries(current)) {
        if (key.length > 1_024) throw invalidHybridResult()
        visit(entry, depth + 1)
      }
    }
  }
  visit(value, 0)
}

function invalidHybridResult(cause?: unknown): KnowledgeProcessingError {
  return new KnowledgeProcessingError("KNOWLEDGE_DOCLING_RESULT_INVALID", {
    cause,
  })
}
