import { createHash } from "node:crypto"

import type { FullAppConfig } from "../../config.js"

export const doclingRuntimeVersions = {
  serve: "1.36.0",
  core: "2.99.0",
  jobkit: "3.8.1",
  documentSchema: "1.10.0",
} as const

const parserContract = {
  doclingServe: doclingRuntimeVersions.serve,
  doclingCore: doclingRuntimeVersions.core,
  doclingJobkit: doclingRuntimeVersions.jobkit,
  doclingDocumentSchema: doclingRuntimeVersions.documentSchema,
  outputs: ["md", "json"],
  target: "zip",
  imageExportMode: "referenced",
  tableMode: "accurate",
  officeConversion: {
    runtime: "unoserver",
    version: "3.7",
    doc: "docx",
    xls: "xlsx",
    ppt: "pptx",
    vsdx: "pdf",
  },
} as const

/**
 * Processing-specific view of the application configuration.
 *
 * Environment parsing and validation intentionally stay in the root AppConfig;
 * this projection only adapts names to the processing-domain contracts.
 */
export function projectKnowledgeProcessingConfig(config: FullAppConfig) {
  const chunking = {
    tokenizer: config.knowledge.chunks.tokenizer,
    childMaxTokens: config.knowledge.chunks.childMaxTokens,
    parentMaxTokens: config.knowledge.chunks.parentMaxTokens,
    embeddingMaxInputTokens: config.knowledge.embedding.maxInputTokens,
  }
  return {
    docling: {
      baseUrl: config.knowledge.docling.url,
      apiKey: config.knowledge.docling.apiKey,
      tenantId: config.knowledge.docling.tenantId,
      documentTimeoutSeconds:
        config.knowledge.docling.documentTimeoutSeconds,
    },
    parserConfigDigest: hashCanonical(parserContract),
    chunking,
    chunkingConfigDigest: createChunkingConfigDigest(chunking),
    embedding: {
      dimensions: config.knowledge.embedding.dimensions,
      maximumInputTokens: config.knowledge.embedding.maxInputTokens,
    },
    elasticsearch: config.knowledge.elasticsearch,
    concurrency: {
      parsing: config.knowledge.concurrency.parsing,
      chunking: config.knowledge.concurrency.chunking,
      image_understanding: config.knowledge.concurrency.parenting,
      parenting: config.knowledge.concurrency.parenting,
      embedding: config.knowledge.concurrency.embedding,
      indexing: config.knowledge.concurrency.indexing,
      activating: config.knowledge.concurrency.activation,
    },
    knowledgeBucket: config.minio.knowledgeBucket,
  }
}

export type KnowledgeProcessingConfig = ReturnType<
  typeof projectKnowledgeProcessingConfig
>

export type ChunkingConfigSnapshot = {
  tokenizer: string
  childMaxTokens: number
  parentMaxTokens: number
  embeddingMaxInputTokens: number
}

export function createChunkingConfigDigest(
  chunking: ChunkingConfigSnapshot,
): string {
  return hashCanonical({
    ...chunking,
    chunker: "docling-hybrid",
    chunkSerializer: "triplet-table",
    includeRawText: true,
    mergePeers: false,
    useMarkdownImages: false,
    useMarkdownTables: false,
    parentBuilder: "continuous-heading-page-budget",
  })
}

export function hashCanonical(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex")
}
