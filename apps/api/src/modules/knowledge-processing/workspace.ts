import { createHash, randomUUID } from "node:crypto"
import { createReadStream } from "node:fs"
import { stat } from "node:fs/promises"
import { Readable } from "node:stream"

import type { Prisma, PrismaClient } from "../../generated/prisma/client.js"
import { v5 as uuidv5 } from "uuid"
import { z } from "zod"

import { resolveOriginalSource } from "../knowledge/original-source.js"
import { completeKnowledgeSourceDocumentProcessing } from "../knowledge-sources/progress.js"
import {
  lockKnowledgeVersionRows,
  SUPERSEDED_VERSION_RETENTION_MS,
} from "../knowledge/retention.js"
import type { IngestedDoclingArchive } from "./docling-ingestion.js"
import type { HybridChunkResult } from "./docling-hybrid.js"
import {
  imageProjectionSchema,
  type ImageProjection,
  type ImageProjectionAsset,
} from "./image-projection.js"
import {
  indexIntegrityDigest,
  type IndexedParentDocument,
} from "./elasticsearch.js"
import { KnowledgeProcessingError } from "./errors.js"
import {
  buildKnowledgeObjectKey,
  KnowledgeObjectStore,
  type KnowledgeObjectType,
} from "./object-store.js"
import type { BuiltKnowledgeParent } from "./parent-builder.js"
import type {
  KnowledgePipelineCheckpoint,
  KnowledgePipelineWorkspace,
  KnowledgeProcessingJob,
} from "./pipeline.js"

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u)
const STORAGE_OBJECT_NAMESPACE = "48dbd36f-f00a-4d39-97d7-cf71d9d8d109"
const STORAGE_RESERVATION_LEASE_MS = 60_000
const STORAGE_RESERVATION_HEARTBEAT_MS = 20_000
const STORAGE_RESERVATION_RETENTION_MS = 24 * 60 * 60_000
const CHUNKER_VERSION = "docling-serve-1.27.0-hybrid"

const hybridChunkSchema = z.strictObject({
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

const hybridResultSchema = z
  .strictObject({
    filename: z.string().min(1),
    chunks: z.array(hybridChunkSchema).min(1),
  })
  .superRefine((result, context) => {
    for (const [index, chunk] of result.chunks.entries()) {
      if (
        chunk.chunkIndex !== index ||
        !isSortedUnique(chunk.pageNumbers) ||
        new Set(chunk.docItems).size !== chunk.docItems.length
      ) {
        context.addIssue({
          code: "custom",
          path: ["chunks", index],
          message: "invalid hybrid chunk ordering or provenance",
        })
      }
    }
  })

const builtChildSchema = z.strictObject({
  chunkIndex: z.number().int().nonnegative(),
  text: z.string().min(1),
  rawText: z.string().min(1),
  numTokens: z.number().int().positive(),
  headings: z.array(z.string()),
  captions: z.array(z.string()),
  docItems: z.array(z.string().min(1)).min(1),
  pageNumbers: z.array(z.number().int().positive()),
  hardBoundaryKey: z.string().min(1).nullable().optional(),
  childId: z.string().min(1).max(160),
  contentHash: sha256Schema,
})

const builtParentSchema = z
  .strictObject({
    parentId: z.string().uuid(),
    parentOrder: z.number().int().nonnegative(),
    titlePath: z.array(z.string()),
    pageNumbers: z.array(z.number().int().positive()),
    parentText: z.string().min(1),
    contentHash: sha256Schema,
    childIds: z.array(z.string().min(1).max(160)).min(1),
    childCount: z.number().int().positive(),
    estimatedTokens: z.number().int().positive(),
    children: z.array(builtChildSchema).min(1),
  })
  .superRefine((parent, context) => {
    if (
      parent.childCount !== parent.children.length ||
      parent.childIds.length !== parent.children.length ||
      parent.childIds.some(
        (childId, index) => childId !== parent.children[index]?.childId,
      ) ||
      !isSortedUnique(parent.pageNumbers)
    ) {
      context.addIssue({
        code: "custom",
        message: "invalid retrieval parent manifest",
      })
    }
  })

const retrievalManifestSchema = z
  .array(builtParentSchema)
  .min(1)
  .superRefine((parents, context) => {
    for (const [index, parent] of parents.entries()) {
      if (parent.parentOrder !== index) {
        context.addIssue({
          code: "custom",
          path: [index, "parentOrder"],
          message: "invalid parent ordering",
        })
      }
    }
  })

type PlannedUpload = {
  id: string
  type: Exclude<KnowledgeObjectType, "original">
  key: string
  extension: string
  mimeType: string
  size: number
  source: { kind: "buffer"; bytes: Buffer } | { kind: "file"; path: string }
  assetReferenceId: string | null
}

type StoredUpload = Omit<PlannedUpload, "source" | "extension"> & {
  sha256: string
}

type VersionArtifact = {
  objectId: string | null
  sha256: string | null
  objectType: KnowledgeObjectType
}

export class PrismaMinioKnowledgePipelineWorkspace
  implements KnowledgePipelineWorkspace
{
  constructor(
    private readonly prisma: PrismaClient,
    private readonly objectStore: KnowledgeObjectStore,
    private readonly storageQuotaBytes: bigint,
  ) {
    if (storageQuotaBytes <= 0n) {
      throw new Error("knowledge storage quota must be positive")
    }
  }

  async openOriginalSource(
    job: KnowledgeProcessingJob,
  ): Promise<{
    filename: string
    contentType: string
    openStream: () => Promise<Readable>
  }> {
    const source = await this.findOriginalSource(job)
    return {
      filename: source.filename,
      contentType: source.mimeType,
      openStream: () => this.objectStore.getStream(source.objectKey),
    }
  }

  async openDoclingSource(job: KnowledgeProcessingJob) {
    return this.openOriginalSource(job)
  }

  async getOriginalSha256(job: KnowledgeProcessingJob): Promise<string> {
    const version = await this.prisma.knowledgeBaseDocumentVersion.findFirst({
      where: {
        id: job.documentVersionId,
        documentId: job.documentId,
        processingGeneration: job.processingGeneration,
      },
      select: { originalSha256: true },
    })
    if (!version) throw invalidArtifact()
    return sha256Schema.parse(version.originalSha256)
  }

  async hasParsedArtifacts(job: KnowledgeProcessingJob): Promise<boolean> {
    const version = await this.prisma.knowledgeBaseDocumentVersion.findFirst({
      where: versionScope(job),
      select: {
        parserConfigDigest: true,
        parsedAssetCount: true,
        doclingBundleObjectId: true,
        doclingBundleSha256: true,
        displayMarkdownObjectId: true,
        displayMarkdownSha256: true,
        doclingJsonObjectId: true,
        doclingJsonSha256: true,
      },
    })
    return Boolean(
      version &&
        version.parserConfigDigest === job.parserConfigDigest &&
        version.parsedAssetCount !== null &&
        (await this.verifyArtifacts(job, [
          {
            objectId: version.doclingBundleObjectId,
            sha256: version.doclingBundleSha256,
            objectType: "docling_bundle",
          },
          {
            objectId: version.displayMarkdownObjectId,
            sha256: version.displayMarkdownSha256,
            objectType: "display_markdown",
          },
          {
            objectId: version.doclingJsonObjectId,
            sha256: version.doclingJsonSha256,
            objectType: "docling_json",
          },
        ])) &&
        (await this.verifyParsedAssets(job, version.parsedAssetCount)),
    )
  }

  async saveParsedArtifacts(input: {
    job: KnowledgeProcessingJob
    result: IngestedDoclingArchive
  }): Promise<KnowledgePipelineCheckpoint> {
    if (await this.hasParsedArtifacts(input.job)) {
      return checkpoint(sha256(input.result.doclingJsonBytes), input.job.parserConfigDigest)
    }
    const doclingVersion = z
      .string()
      .trim()
      .min(1)
      .max(120)
      .parse(input.result.doclingJson.version)
    const archiveFile = await stat(input.result.archivePath)
    if (!archiveFile.isFile() || archiveFile.size <= 0) throw invalidArtifact()
    const uploads = [
      planFile(
        input.job,
        "parsed:bundle",
        "docling_bundle",
        "zip",
        "application/zip",
        input.result.archivePath,
        archiveFile.size,
      ),
      planBuffer(
        input.job,
        "parsed:display-markdown",
        "display_markdown",
        "md",
        "text/markdown; charset=utf-8",
        Buffer.from(input.result.safeMarkdown, "utf8"),
      ),
      planBuffer(
        input.job,
        "parsed:docling-json",
        "docling_json",
        "json",
        "application/json; charset=utf-8",
        input.result.doclingJsonBytes,
      ),
      ...input.result.assets.map((asset) =>
        planBuffer(
          input.job,
          `parsed:asset:${asset.assetReferenceId}`,
          "asset",
          "png",
          asset.contentType,
          asset.bytes,
          asset.assetReferenceId,
        ),
      ),
    ]
    await this.persistUploads(
      input.job,
      "parsed",
      uploads,
      async (transaction, stored) => {
        const [bundle, markdown, json] = [
          requiredStored(stored, "docling_bundle"),
          requiredStored(stored, "display_markdown"),
          requiredStored(stored, "docling_json"),
        ]
        await transaction.knowledgeBaseDocumentVersion.update({
          where: { id: input.job.documentVersionId },
          data: {
            doclingBundleObjectId: bundle.id,
            doclingBundleSha256: bundle.sha256,
            displayMarkdownObjectId: markdown.id,
            displayMarkdownSha256: markdown.sha256,
            doclingJsonObjectId: json.id,
            doclingJsonSha256: json.sha256,
            doclingVersion,
            parsedAssetCount: input.result.assets.length,
            parserConfigDigest: input.job.parserConfigDigest,
            chunkingConfigDigest: input.job.chunking.configDigest,
            embeddingProfileHash: input.job.embeddingProfileHash,
            hybridChunksObjectId: null,
            hybridChunksSha256: null,
            imageProjectionObjectId: null,
            imageProjectionSha256: null,
            imageUnderstandingConfigDigest: null,
            retrievalManifestObjectId: null,
            retrievalManifestSha256: null,
            indexIntegrityDigest: null,
            parentCount: null,
            childCount: null,
            indexReady: false,
            processingRevision: { increment: 1 },
          },
        })
      },
    )
    return checkpoint(
      sha256(input.result.doclingJsonBytes),
      input.job.parserConfigDigest,
    )
  }

  async loadDoclingJson(job: KnowledgeProcessingJob): Promise<{
    filename: string
    jsonBytes: Buffer
  }> {
    const version = await this.prisma.knowledgeBaseDocumentVersion.findFirst({
      where: versionScope(job),
      select: {
        originalFilename: true,
        parserConfigDigest: true,
        doclingJsonObjectId: true,
        doclingJsonSha256: true,
      },
    })
    if (!version || version.parserConfigDigest !== job.parserConfigDigest) {
      throw invalidArtifact()
    }
    return {
      filename: version.originalFilename,
      jsonBytes: await this.readArtifact(job, {
        objectId: version.doclingJsonObjectId,
        sha256: version.doclingJsonSha256,
        objectType: "docling_json",
      }),
    }
  }

  async hasHybridChunks(job: KnowledgeProcessingJob): Promise<boolean> {
    const version = await this.prisma.knowledgeBaseDocumentVersion.findFirst({
      where: versionScope(job),
      select: {
        chunkingConfigDigest: true,
        hybridChunksObjectId: true,
        hybridChunksSha256: true,
      },
    })
    return Boolean(
      version &&
        version.chunkingConfigDigest === job.chunking.configDigest &&
        (await this.verifyArtifacts(job, [
          {
            objectId: version.hybridChunksObjectId,
            sha256: version.hybridChunksSha256,
            objectType: "hybrid_chunks",
          },
        ])),
    )
  }

  async saveHybridChunks(
    job: KnowledgeProcessingJob,
    result: HybridChunkResult,
  ): Promise<KnowledgePipelineCheckpoint> {
    const parsed = hybridResultSchema.parse(result)
    const bytes = Buffer.from(JSON.stringify(parsed), "utf8")
    if (await this.hasHybridChunks(job)) {
      return checkpoint(sha256(bytes), job.chunking.configDigest)
    }
    const upload = planBuffer(
      job,
      "chunking:hybrid",
      "hybrid_chunks",
      "json",
      "application/json; charset=utf-8",
      bytes,
    )
    await this.persistUploads(
      job,
      "hybrid-chunks",
      [upload],
      async (transaction, stored) => {
        const hybrid = requiredStored(stored, "hybrid_chunks")
        await transaction.knowledgeBaseDocumentVersion.update({
          where: { id: job.documentVersionId },
          data: {
            hybridChunksObjectId: hybrid.id,
            hybridChunksSha256: hybrid.sha256,
            chunkerVersion: CHUNKER_VERSION,
            chunkingConfigDigest: job.chunking.configDigest,
            imageProjectionObjectId: null,
            imageProjectionSha256: null,
            imageUnderstandingConfigDigest: null,
            retrievalManifestObjectId: null,
            retrievalManifestSha256: null,
            indexIntegrityDigest: null,
            parentCount: null,
            childCount: parsed.chunks.length,
            indexReady: false,
            processingRevision: { increment: 1 },
          },
        })
      },
    )
    return checkpoint(sha256(bytes), job.chunking.configDigest)
  }

  async loadHybridChunks(job: KnowledgeProcessingJob): Promise<HybridChunkResult> {
    const version = await this.prisma.knowledgeBaseDocumentVersion.findFirst({
      where: versionScope(job),
      select: {
        chunkingConfigDigest: true,
        hybridChunksObjectId: true,
        hybridChunksSha256: true,
      },
    })
    if (!version || version.chunkingConfigDigest !== job.chunking.configDigest) {
      throw invalidArtifact()
    }
    return parseJsonArtifact(
      await this.readArtifact(job, {
        objectId: version.hybridChunksObjectId,
        sha256: version.hybridChunksSha256,
        objectType: "hybrid_chunks",
      }),
      hybridResultSchema,
    )
  }

  async hasImageProjection(job: KnowledgeProcessingJob): Promise<boolean> {
    const version = await this.prisma.knowledgeBaseDocumentVersion.findFirst({
      where: versionScope(job),
      select: {
        imageUnderstandingConfigDigest: true,
        imageProjectionObjectId: true,
        imageProjectionSha256: true,
      },
    })
    return Boolean(
      version &&
        version.imageUnderstandingConfigDigest ===
          job.imageUnderstanding.config_digest &&
        (await this.verifyArtifacts(job, [
          {
            objectId: version.imageProjectionObjectId,
            sha256: version.imageProjectionSha256,
            objectType: "image_projection",
          },
        ])),
    )
  }

  async loadImageAssets(
    job: KnowledgeProcessingJob,
  ): Promise<ImageProjectionAsset[]> {
    const objects = await this.prisma.knowledgeBaseObject.findMany({
      where: {
        knowledgeBaseId: job.knowledgeBaseId,
        documentId: job.documentId,
        documentVersionId: job.documentVersionId,
        processingGeneration: job.processingGeneration,
        objectType: "asset",
        lifecycleStatus: "active",
      },
      orderBy: { assetReferenceId: "asc" },
      select: {
        id: true,
        assetReferenceId: true,
        checksumSha256: true,
      },
    })
    return Promise.all(
      objects.map(async (object) => {
        if (object.assetReferenceId === null) throw invalidArtifact()
        return {
          assetReferenceId: object.assetReferenceId,
          safeSha256: sha256Schema.parse(object.checksumSha256),
          bytes: await this.readArtifact(job, {
            objectId: object.id,
            sha256: object.checksumSha256,
            objectType: "asset",
          }),
        }
      }),
    )
  }

  async saveImageProjection(
    job: KnowledgeProcessingJob,
    projection: ImageProjection,
  ): Promise<KnowledgePipelineCheckpoint> {
    const parsed = imageProjectionSchema.parse(projection)
    if (parsed.configDigest !== job.imageUnderstanding.config_digest) {
      throw invalidArtifact()
    }
    const bytes = Buffer.from(JSON.stringify(parsed), "utf8")
    if (await this.hasImageProjection(job)) {
      return checkpoint(sha256(bytes), parsed.configDigest)
    }
    const upload = planBuffer(
      job,
      "image-understanding:projection",
      "image_projection",
      "json",
      "application/json; charset=utf-8",
      bytes,
    )
    await this.persistUploads(
      job,
      "image-projection",
      [upload],
      async (transaction, stored) => {
        const imageProjection = requiredStored(stored, "image_projection")
        await transaction.knowledgeBaseDocumentVersion.update({
          where: { id: job.documentVersionId },
          data: {
            imageProjectionObjectId: imageProjection.id,
            imageProjectionSha256: imageProjection.sha256,
            imageUnderstandingConfigDigest:
              job.imageUnderstanding.config_digest,
            retrievalManifestObjectId: null,
            retrievalManifestSha256: null,
            indexIntegrityDigest: null,
            parentCount: null,
            indexReady: false,
            processingRevision: { increment: 1 },
          },
        })
      },
    )
    return checkpoint(sha256(bytes), parsed.configDigest)
  }

  async loadImageProjection(
    job: KnowledgeProcessingJob,
  ): Promise<ImageProjection> {
    const version = await this.prisma.knowledgeBaseDocumentVersion.findFirst({
      where: versionScope(job),
      select: {
        imageUnderstandingConfigDigest: true,
        imageProjectionObjectId: true,
        imageProjectionSha256: true,
      },
    })
    if (
      !version ||
      version.imageUnderstandingConfigDigest !==
        job.imageUnderstanding.config_digest
    ) {
      throw invalidArtifact()
    }
    return parseJsonArtifact(
      await this.readArtifact(job, {
        objectId: version.imageProjectionObjectId,
        sha256: version.imageProjectionSha256,
        objectType: "image_projection",
      }),
      imageProjectionSchema,
    )
  }

  async hasRetrievalManifest(job: KnowledgeProcessingJob): Promise<boolean> {
    const version = await this.prisma.knowledgeBaseDocumentVersion.findFirst({
      where: versionScope(job),
      select: {
        chunkingConfigDigest: true,
        imageUnderstandingConfigDigest: true,
        retrievalManifestObjectId: true,
        retrievalManifestSha256: true,
      },
    })
    return Boolean(
      version &&
        version.chunkingConfigDigest === job.chunking.configDigest &&
        version.imageUnderstandingConfigDigest ===
          job.imageUnderstanding.config_digest &&
        (await this.verifyArtifacts(job, [
          {
            objectId: version.retrievalManifestObjectId,
            sha256: version.retrievalManifestSha256,
            objectType: "retrieval_manifest",
          },
        ])),
    )
  }

  async saveRetrievalManifest(
    job: KnowledgeProcessingJob,
    parents: readonly BuiltKnowledgeParent[],
  ): Promise<KnowledgePipelineCheckpoint> {
    const parsed = retrievalManifestSchema.parse(parents)
    const bytes = Buffer.from(JSON.stringify(parsed), "utf8")
    if (await this.hasRetrievalManifest(job)) {
      return checkpoint(sha256(bytes), job.chunking.configDigest)
    }
    const upload = planBuffer(
      job,
      "parenting:retrieval-manifest",
      "retrieval_manifest",
      "json",
      "application/json; charset=utf-8",
      bytes,
    )
    const childCount = parsed.reduce(
      (total, parent) => total + parent.childCount,
      0,
    )
    await this.persistUploads(
      job,
      "retrieval-manifest",
      [upload],
      async (transaction, stored) => {
        const manifest = requiredStored(stored, "retrieval_manifest")
        await transaction.knowledgeBaseDocumentVersion.update({
          where: { id: job.documentVersionId },
          data: {
            retrievalManifestObjectId: manifest.id,
            retrievalManifestSha256: manifest.sha256,
            chunkingConfigDigest: job.chunking.configDigest,
            imageUnderstandingConfigDigest:
              job.imageUnderstanding.config_digest,
            parentCount: parsed.length,
            childCount,
            indexIntegrityDigest: null,
            indexReady: false,
            processingRevision: { increment: 1 },
          },
        })
      },
    )
    return checkpoint(sha256(bytes), job.chunking.configDigest)
  }

  async loadRetrievalManifest(
    job: KnowledgeProcessingJob,
  ): Promise<BuiltKnowledgeParent[]> {
    const version = await this.prisma.knowledgeBaseDocumentVersion.findFirst({
      where: versionScope(job),
      select: {
        chunkingConfigDigest: true,
        imageUnderstandingConfigDigest: true,
        retrievalManifestObjectId: true,
        retrievalManifestSha256: true,
      },
    })
    if (
      !version ||
      version.chunkingConfigDigest !== job.chunking.configDigest ||
      (job.operation !== "rebuild_index" &&
        version.imageUnderstandingConfigDigest !==
          job.imageUnderstanding.config_digest)
    ) {
      throw invalidArtifact()
    }
    return parseJsonArtifact(
      await this.readArtifact(job, {
        objectId: version.retrievalManifestObjectId,
        sha256: version.retrievalManifestSha256,
        objectType: "retrieval_manifest",
      }),
      retrievalManifestSchema,
    )
  }

  async saveEmbeddedIndexCheckpoint(
    job: KnowledgeProcessingJob,
    parents: readonly IndexedParentDocument[],
  ): Promise<KnowledgePipelineCheckpoint> {
    const parentCount = parents.length
    const childCount = parents.reduce(
      (total, parent) => total + parent.childCount,
      0,
    )
    if (parentCount <= 0 || childCount <= 0) throw invalidArtifact()
    const integrityDigest = indexIntegrityDigest(parents)
    await this.prisma.$transaction(async (transaction) => {
      await lockDocumentRow(transaction, job.documentId)
      await assertActiveGeneration(transaction, job)
      const version =
        await transaction.knowledgeBaseDocumentVersion.findUnique({
          where: { id: job.documentVersionId },
          select: {
            retrievalManifestObjectId: true,
            retrievalManifestSha256: true,
            chunkingConfigDigest: true,
            imageProjectionObjectId: true,
            imageProjectionSha256: true,
            imageUnderstandingConfigDigest: true,
            parentCount: true,
            childCount: true,
          },
        })
      if (
        !version ||
        version.retrievalManifestObjectId === null ||
        version.retrievalManifestSha256 === null ||
        version.chunkingConfigDigest !== job.chunking.configDigest ||
        version.imageProjectionObjectId === null ||
        version.imageProjectionSha256 === null ||
        !hasCompatibleImageUnderstandingCheckpoint(
          job,
          version.imageUnderstandingConfigDigest,
        ) ||
        version.parentCount !== parentCount ||
        version.childCount !== childCount
      ) {
        throw invalidArtifact()
      }
      await transaction.knowledgeBaseDocumentVersion.update({
        where: { id: job.documentVersionId },
        data: {
          embeddingProfileHash: job.embeddingProfileHash,
          indexIntegrityDigest: integrityDigest,
          indexReady: false,
          processingRevision: { increment: 1 },
        },
      })
    })
    return checkpoint(integrityDigest, job.embeddingProfileHash)
  }

  async readCandidateIndexCheckpoint(job: KnowledgeProcessingJob): Promise<{
    parentCount: number
    childCount: number
    embeddingProfileHash: string
    indexIntegrityDigest: string
  }> {
    const version = await this.prisma.knowledgeBaseDocumentVersion.findFirst({
      where: versionScope(job),
      select: {
        parentCount: true,
        childCount: true,
        embeddingProfileHash: true,
        indexIntegrityDigest: true,
        retrievalManifestObjectId: true,
        retrievalManifestSha256: true,
        chunkingConfigDigest: true,
        imageProjectionObjectId: true,
        imageProjectionSha256: true,
        imageUnderstandingConfigDigest: true,
      },
    })
    if (
      !version ||
      version.parentCount === null ||
      version.parentCount <= 0 ||
      version.childCount === null ||
      version.childCount <= 0 ||
      version.embeddingProfileHash !== job.embeddingProfileHash ||
      version.indexIntegrityDigest === null ||
      version.retrievalManifestObjectId === null ||
      version.retrievalManifestSha256 === null ||
      version.chunkingConfigDigest !== job.chunking.configDigest ||
      version.imageProjectionObjectId === null ||
      version.imageProjectionSha256 === null ||
      !hasCompatibleImageUnderstandingCheckpoint(
        job,
        version.imageUnderstandingConfigDigest,
      )
    ) {
      throw invalidArtifact()
    }
    return {
      parentCount: version.parentCount,
      childCount: version.childCount,
      embeddingProfileHash: version.embeddingProfileHash,
      indexIntegrityDigest: version.indexIntegrityDigest,
    }
  }

  async prepareActivation(job: KnowledgeProcessingJob): Promise<{
    parentCount: number
    childCount: number
    embeddingProfileHash: string
    indexIntegrityDigest: string
  }> {
    return this.prisma.$transaction(async (transaction) => {
      await lockDocumentRow(transaction, job.documentId)
      const document = await transaction.knowledgeBaseDocument.findUnique({
        where: { id: job.documentId },
      })
      if (!document) {
        throw new KnowledgeProcessingError("KNOWLEDGE_PROCESSING_CANCELLED")
      }
      await lockKnowledgeVersionRows(transaction, [job.documentVersionId])
      const version =
        await transaction.knowledgeBaseDocumentVersion.findUnique({
          where: { id: job.documentVersionId },
        })
      if (
        !version ||
        document.status === "deleted" ||
        document.activeProcessingVersionId !== job.documentVersionId ||
        version.processingGeneration !== job.processingGeneration ||
        version.processingStage !== "activating" ||
        version.progressPercent !== 98 ||
        version.cancelRequestedAt !== null ||
        version.parentCount === null ||
        version.parentCount <= 0 ||
        version.childCount === null ||
        version.childCount <= 0 ||
        version.embeddingProfileHash !== job.embeddingProfileHash ||
        version.indexIntegrityDigest === null ||
        version.retrievalManifestSha256 === null ||
        version.chunkingConfigDigest !== job.chunking.configDigest ||
        version.imageProjectionObjectId === null ||
        version.imageProjectionSha256 === null ||
        !hasCompatibleImageUnderstandingCheckpoint(
          job,
          version.imageUnderstandingConfigDigest,
        )
      ) {
        throw new KnowledgeProcessingError("KNOWLEDGE_PROCESSING_CANCELLED")
      }
      const previousCurrentVersionId =
        version.activationPreviousCurrentVersionId ?? document.currentVersionId
      if (
        version.activationPreviousCurrentVersionId !== null &&
        version.activationPreviousCurrentVersionId !== document.currentVersionId
      ) {
        throw invalidArtifact()
      }
      await transaction.knowledgeBaseDocumentVersion.update({
        where: { id: job.documentVersionId },
        data: {
          activationPreviousCurrentVersionId: previousCurrentVersionId,
          indexReady: false,
          processingRevision: { increment: 1 },
        },
      })
      return {
        parentCount: version.parentCount,
        childCount: version.childCount,
        embeddingProfileHash: version.embeddingProfileHash,
        indexIntegrityDigest: version.indexIntegrityDigest,
      }
    })
  }

  async finalizeActivation(job: KnowledgeProcessingJob): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      await lockDocumentRow(transaction, job.documentId)
      const document = await transaction.knowledgeBaseDocument.findUnique({
        where: { id: job.documentId },
      })
      if (!document) {
        throw new KnowledgeProcessingError("KNOWLEDGE_PROCESSING_CANCELLED")
      }
      await lockKnowledgeVersionRows(transaction, [
        job.documentVersionId,
        ...(document.currentVersionId ? [document.currentVersionId] : []),
      ])
      const version =
        await transaction.knowledgeBaseDocumentVersion.findUnique({
          where: { id: job.documentVersionId },
        })
      if (!version) {
        throw new KnowledgeProcessingError("KNOWLEDGE_PROCESSING_CANCELLED")
      }
      const previousCurrentVersionId =
        version.activationPreviousCurrentVersionId
      const expectedDocumentStatus =
        previousCurrentVersionId === null ||
        previousCurrentVersionId === job.documentVersionId
          ? "processing"
          : "ready"
      if (
        document.status !== expectedDocumentStatus ||
        document.currentVersionId !== previousCurrentVersionId ||
        document.activeProcessingVersionId !== job.documentVersionId ||
        version.processingGeneration !== job.processingGeneration ||
        version.processingStage !== "activating" ||
        version.progressPercent !== 98 ||
        version.cancelRequestedAt !== null ||
        version.parentCount === null ||
        version.parentCount <= 0 ||
        version.childCount === null ||
        version.childCount <= 0 ||
        version.embeddingProfileHash !== job.embeddingProfileHash ||
        version.indexIntegrityDigest === null ||
        version.retrievalManifestSha256 === null ||
        version.chunkingConfigDigest !== job.chunking.configDigest ||
        version.imageProjectionObjectId === null ||
        version.imageProjectionSha256 === null ||
        !hasCompatibleImageUnderstandingCheckpoint(
          job,
          version.imageUnderstandingConfigDigest,
        )
      ) {
        throw new KnowledgeProcessingError("KNOWLEDGE_PROCESSING_CANCELLED")
      }
      if (
        previousCurrentVersionId &&
        previousCurrentVersionId !== job.documentVersionId
      ) {
        await lockKnowledgeVersionRows(transaction, [previousCurrentVersionId])
        const switchedAt = new Date()
        const citationCount =
          await transaction.conversationMessageKnowledgeCitation.count({
            where: { documentVersionId: previousCurrentVersionId },
          })
        await transaction.knowledgeBaseDocumentVersion.updateMany({
          where: { id: previousCurrentVersionId, versionStatus: "ready" },
          data: {
            versionStatus: "superseded",
            supersededAt: switchedAt,
            cleanupEligibleAt:
              citationCount > 0
                ? null
                : new Date(
                    switchedAt.getTime() + SUPERSEDED_VERSION_RETENTION_MS,
                  ),
          },
        })
      }
      await transaction.knowledgeBaseDocumentVersion.update({
        where: { id: job.documentVersionId },
        data: {
          versionStatus: "ready",
          processingStage: "completed",
          progressPercent: 100,
          processingRevision: { increment: 1 },
          retryAt: null,
          stableErrorCode: null,
          failedStage: null,
          indexReady: true,
          completedAt: new Date(),
          cleanupEligibleAt: null,
        },
      })
      await transaction.knowledgeBaseDocument.update({
        where: { id: job.documentId },
        data: {
          status: "ready",
          canonicalExtension: version.canonicalExtension,
          mimeType: version.mimeType,
          sizeBytes: version.sizeBytes,
          originalSha256: version.originalSha256,
          currentVersionId: job.documentVersionId,
          candidateVersionId: null,
          activeProcessingVersionId: null,
          embeddingProfileHash: version.embeddingProfileHash,
          chunkingConfigDigest: version.chunkingConfigDigest,
          retrievalManifestSha256: version.retrievalManifestSha256,
          indexIntegrityDigest: version.indexIntegrityDigest,
          stableErrorCode: null,
        },
      })
      await completeKnowledgeSourceDocumentProcessing(
        transaction,
        job.documentId,
        new Date(),
      )
    })
  }

  private async verifyArtifacts(
    job: KnowledgeProcessingJob,
    artifacts: readonly VersionArtifact[],
  ): Promise<boolean> {
    for (const artifact of artifacts) {
      if (artifact.objectId === null || artifact.sha256 === null) return false
      const object = await this.prisma.knowledgeBaseObject.findFirst({
        where: {
          id: artifact.objectId,
          ...objectScope(job),
          objectType: artifact.objectType,
          lifecycleStatus: "active",
          checksumSha256: artifact.sha256,
        },
        select: {
          objectKey: true,
          checksumSha256: true,
          sizeBytes: true,
        },
      })
      if (
        !object ||
        !(await this.objectStore.verifyIntegrity({
          key: object.objectKey,
          expectedSha256: object.checksumSha256,
          expectedSizeBytes: object.sizeBytes,
        }))
      ) {
        return false
      }
    }
    return true
  }

  private async verifyParsedAssets(
    job: KnowledgeProcessingJob,
    expectedCount: number,
  ): Promise<boolean> {
    if (!Number.isSafeInteger(expectedCount) || expectedCount < 0) return false
    const assets = await this.prisma.knowledgeBaseObject.findMany({
      where: {
        ...objectScope(job),
        objectType: "asset",
        lifecycleStatus: "active",
      },
      select: {
        assetReferenceId: true,
        objectKey: true,
        checksumSha256: true,
        sizeBytes: true,
      },
    })
    if (
      assets.length !== expectedCount ||
      assets.some((asset) => asset.assetReferenceId === null) ||
      new Set(assets.map((asset) => asset.assetReferenceId)).size !==
        expectedCount
    ) {
      return false
    }
    for (const asset of assets) {
      if (
        !(await this.objectStore.verifyIntegrity({
          key: asset.objectKey,
          expectedSha256: asset.checksumSha256,
          expectedSizeBytes: asset.sizeBytes,
        }))
      ) {
        return false
      }
    }
    return true
  }

  private async readArtifact(
    job: KnowledgeProcessingJob,
    artifact: VersionArtifact,
  ): Promise<Buffer> {
    if (artifact.objectId === null || artifact.sha256 === null) {
      throw invalidArtifact()
    }
    const object = await this.prisma.knowledgeBaseObject.findFirst({
      where: {
        id: artifact.objectId,
        // Retry and in-place rebuild commands advance the version generation,
        // while their verified immutable checkpoints intentionally retain the
        // generation in which they were created.
        knowledgeBaseId: job.knowledgeBaseId,
        documentId: job.documentId,
        documentVersionId: job.documentVersionId,
        objectType: artifact.objectType,
        lifecycleStatus: "active",
        checksumSha256: artifact.sha256,
      },
    })
    if (
      !object ||
      object.sizeBytes < 0n ||
      object.sizeBytes > BigInt(Number.MAX_SAFE_INTEGER)
    ) {
      throw invalidArtifact()
    }
    const bytes = await readStreamLimited(
      await this.objectStore.getStream(object.objectKey),
      Number(object.sizeBytes),
    )
    if (sha256(bytes) !== object.checksumSha256) throw invalidArtifact()
    return bytes
  }

  private async persistUploads(
    job: KnowledgeProcessingJob,
    label: string,
    planned: readonly PlannedUpload[],
    adopt: (
      transaction: Prisma.TransactionClient,
      stored: readonly StoredUpload[],
    ) => Promise<void>,
  ): Promise<void> {
    if (
      planned.length === 0 ||
      new Set(planned.map((upload) => upload.key)).size !== planned.length ||
      planned.some((upload) => !Number.isSafeInteger(upload.size) || upload.size < 0)
    ) {
      throw invalidArtifact()
    }
    const reservationId = stableStorageId(job, `${label}:reservation`)
    const leaseToken = randomUUID()
    const totalSize = planned.reduce(
      (total, upload) => total + BigInt(upload.size),
      0n,
    )
    const objectKeys = planned.map((upload) => upload.key)
    await this.reserveStorage(
      job,
      reservationId,
      leaseToken,
      totalSize,
      objectKeys,
    )
    let reservationOutstanding = true
    try {
      const stored = await this.withStorageReservationLease(
        job.knowledgeBaseId,
        reservationId,
        leaseToken,
        () => mapWithConcurrency(planned, 4, (upload) => this.upload(job, upload)),
      )
      await this.prisma.$transaction(async (transaction) => {
        await lockKnowledgeBaseRow(transaction, job.knowledgeBaseId)
        await lockDocumentRow(transaction, job.documentId)
        await assertActiveGeneration(transaction, job)
        await transaction.knowledgeBaseObject.createMany({
          data: stored.map((upload) => ({
            id: upload.id,
            knowledgeBaseId: job.knowledgeBaseId,
            documentId: job.documentId,
            documentVersionId: job.documentVersionId,
            processingGeneration: job.processingGeneration,
            objectType: upload.type,
            objectKey: upload.key,
            assetReferenceId: upload.assetReferenceId,
            mimeType: upload.mimeType,
            sizeBytes: upload.size,
            checksumSha256: upload.sha256,
            lifecycleStatus: "active",
            cleanupStatus: "completed",
          })),
        })
        await adopt(transaction, stored)
        await consumeStorageReservationLocked(
          transaction,
          job.knowledgeBaseId,
          reservationId,
          leaseToken,
          totalSize,
          objectKeys,
        )
      })
      reservationOutstanding = false
    } catch (error) {
      if (reservationOutstanding) {
        await this.cleanupUnconsumedReservation(
          job.knowledgeBaseId,
          reservationId,
          leaseToken,
          totalSize,
          objectKeys,
        )
      }
      throw error
    }
  }

  private async upload(
    job: KnowledgeProcessingJob,
    upload: PlannedUpload,
  ): Promise<StoredUpload> {
    const stored = await this.objectStore.putImmutable({
      identity: {
        knowledgeBaseId: job.knowledgeBaseId,
        documentId: job.documentId,
        versionId: job.documentVersionId,
        objectType: upload.type,
        objectId: upload.id,
        extension: upload.extension,
      },
      stream:
        upload.source.kind === "buffer"
          ? Readable.from(upload.source.bytes)
          : createReadStream(upload.source.path),
      size: upload.size,
      contentType: upload.mimeType,
    })
    if (stored.key !== upload.key || stored.size !== upload.size) {
      throw invalidArtifact()
    }
    return {
      id: upload.id,
      type: upload.type,
      key: stored.key,
      mimeType: upload.mimeType,
      size: stored.size,
      assetReferenceId: upload.assetReferenceId,
      sha256: stored.sha256,
    }
  }

  private async reserveStorage(
    job: KnowledgeProcessingJob,
    reservationId: string,
    leaseToken: string,
    sizeBytes: bigint,
    objectKeys: readonly string[],
  ): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      const now = new Date()
      await lockKnowledgeBaseRow(transaction, job.knowledgeBaseId)
      const base = await transaction.knowledgeBase.findUnique({
        where: { id: job.knowledgeBaseId },
        select: {
          lifecycleStatus: true,
          availabilityStatus: true,
          storageUsedBytes: true,
          storageReservedBytes: true,
        },
      })
      if (
        !base ||
        base.lifecycleStatus !== "active" ||
        base.availabilityStatus !== "enabled"
      ) {
        throw new KnowledgeProcessingError("KNOWLEDGE_PROCESSING_CANCELLED")
      }
      await lockDocumentRow(transaction, job.documentId)
      await assertActiveGeneration(transaction, job)
      const existing =
        await transaction.knowledgeBaseStorageReservation.findUnique({
          where: { id: reservationId },
        })
      if (existing) {
        if (
          existing.knowledgeBaseId !== job.knowledgeBaseId ||
          existing.documentId !== job.documentId ||
          existing.documentVersionId !== job.documentVersionId ||
          existing.sizeBytes !== sizeBytes ||
          !hasExactObjectKeys(existing.objectKeysJson, objectKeys)
        ) {
          throw invalidArtifact()
        }
        if (
          existing.cleanupStartedAt !== null ||
          (existing.leaseToken !== leaseToken && existing.leaseExpiresAt > now)
        ) {
          throw new KnowledgeProcessingError("KNOWLEDGE_DOCUMENT_BUSY", {
            retryable: true,
          })
        }
        await transaction.knowledgeBaseStorageReservation.update({
          where: { id: reservationId },
          data: {
            leaseToken,
            leaseExpiresAt: new Date(now.getTime() + STORAGE_RESERVATION_LEASE_MS),
            expiresAt: new Date(
              now.getTime() + STORAGE_RESERVATION_RETENTION_MS,
            ),
          },
        })
        return
      }
      if (
        base.storageUsedBytes + base.storageReservedBytes + sizeBytes >
        this.storageQuotaBytes
      ) {
        throw new KnowledgeProcessingError(
          "KNOWLEDGE_STORAGE_QUOTA_EXCEEDED",
        )
      }
      await transaction.knowledgeBaseStorageReservation.create({
        data: {
          id: reservationId,
          knowledgeBaseId: job.knowledgeBaseId,
          documentId: job.documentId,
          documentVersionId: job.documentVersionId,
          sizeBytes,
          objectKeysJson: [...objectKeys] as Prisma.InputJsonValue,
          leaseToken,
          leaseExpiresAt: new Date(now.getTime() + STORAGE_RESERVATION_LEASE_MS),
          expiresAt: new Date(
            now.getTime() + STORAGE_RESERVATION_RETENTION_MS,
          ),
        },
      })
      if (sizeBytes > 0n) {
        await transaction.knowledgeBase.update({
          where: { id: job.knowledgeBaseId },
          data: { storageReservedBytes: { increment: sizeBytes } },
        })
      }
    })
  }

  private async refreshStorageReservationLease(
    knowledgeBaseId: string,
    reservationId: string,
    leaseToken: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      await lockKnowledgeBaseRow(transaction, knowledgeBaseId)
      const now = new Date()
      const refreshed =
        await transaction.knowledgeBaseStorageReservation.updateMany({
          where: {
            id: reservationId,
            knowledgeBaseId,
            leaseToken,
            cleanupStartedAt: null,
            leaseExpiresAt: { gt: now },
          },
          data: {
            leaseExpiresAt: new Date(
              now.getTime() + STORAGE_RESERVATION_LEASE_MS,
            ),
            expiresAt: new Date(
              now.getTime() + STORAGE_RESERVATION_RETENTION_MS,
            ),
          },
        })
      if (refreshed.count !== 1) {
        throw new KnowledgeProcessingError("KNOWLEDGE_DOCUMENT_BUSY", {
          retryable: true,
        })
      }
    })
  }

  private async withStorageReservationLease<T>(
    knowledgeBaseId: string,
    reservationId: string,
    leaseToken: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    let heartbeat = Promise.resolve()
    let leaseError: unknown = null
    const timer = setInterval(() => {
      heartbeat = heartbeat
        .then(() =>
          this.refreshStorageReservationLease(
            knowledgeBaseId,
            reservationId,
            leaseToken,
          ),
        )
        .catch((error: unknown) => {
          leaseError = error
        })
    }, STORAGE_RESERVATION_HEARTBEAT_MS)
    timer.unref()
    try {
      const value = await operation()
      await heartbeat
      if (leaseError !== null) throw leaseError
      await this.refreshStorageReservationLease(
        knowledgeBaseId,
        reservationId,
        leaseToken,
      )
      return value
    } finally {
      clearInterval(timer)
    }
  }

  private async cleanupUnconsumedReservation(
    knowledgeBaseId: string,
    reservationId: string,
    leaseToken: string,
    sizeBytes: bigint,
    objectKeys: readonly string[],
  ): Promise<boolean> {
    try {
      const inspection = await this.prisma.$transaction(async (transaction) => {
        await lockKnowledgeBaseRow(transaction, knowledgeBaseId)
        const reservation =
          await transaction.knowledgeBaseStorageReservation.findUnique({
            where: { id: reservationId },
          })
        if (
          !reservation ||
          reservation.knowledgeBaseId !== knowledgeBaseId ||
          reservation.leaseToken !== leaseToken
        ) {
          return "not_owner" as const
        }
        if (
          reservation.sizeBytes !== sizeBytes ||
          !hasExactObjectKeys(reservation.objectKeysJson, objectKeys)
        ) {
          throw invalidArtifact()
        }
        const registeredCount = await transaction.knowledgeBaseObject.count({
          where: { objectKey: { in: [...objectKeys] } },
        })
        if (registeredCount === objectKeys.length) {
          await releaseStorageReservationLocked(
            transaction,
            knowledgeBaseId,
            reservationId,
            leaseToken,
            sizeBytes,
          )
          return "released" as const
        }
        if (registeredCount > 0) return "partial" as const
        return "remove" as const
      })
      if (inspection === "released") return true
      if (inspection !== "remove") return false
      const removals = await Promise.allSettled(
        objectKeys.map((objectKey) => this.objectStore.remove(objectKey)),
      )
      if (removals.some((result) => result.status === "rejected")) return false
      await this.prisma.$transaction(async (transaction) => {
        await lockKnowledgeBaseRow(transaction, knowledgeBaseId)
        await releaseStorageReservationLocked(
          transaction,
          knowledgeBaseId,
          reservationId,
          leaseToken,
          sizeBytes,
        )
      })
      return true
    } catch {
      return false
    }
  }

  private async findOriginalSource(job: KnowledgeProcessingJob) {
    const version = await this.prisma.knowledgeBaseDocumentVersion.findUnique({
      where: { id: job.documentVersionId },
      select: {
        id: true,
        sourceVersionId: true,
        originalFilename: true,
        mimeType: true,
      },
    })
    if (!version) throw invalidArtifact()
    const source = await resolveOriginalSource(this.prisma, {
      knowledgeBaseId: job.knowledgeBaseId,
      documentId: job.documentId,
      startVersion: version,
    })
    if (!source) throw invalidArtifact()
    return {
      filename: version.originalFilename,
      mimeType: version.mimeType,
      objectKey: source.object.objectKey,
    }
  }
}

function planBuffer(
  job: KnowledgeProcessingJob,
  label: string,
  type: PlannedUpload["type"],
  extension: string,
  mimeType: string,
  bytes: Buffer,
  assetReferenceId: string | null = null,
): PlannedUpload {
  return planUpload(job, label, type, extension, mimeType, bytes.length, {
    kind: "buffer",
    bytes,
  }, assetReferenceId)
}

function planFile(
  job: KnowledgeProcessingJob,
  label: string,
  type: PlannedUpload["type"],
  extension: string,
  mimeType: string,
  path: string,
  size: number,
): PlannedUpload {
  return planUpload(job, label, type, extension, mimeType, size, {
    kind: "file",
    path,
  }, null)
}

function planUpload(
  job: KnowledgeProcessingJob,
  label: string,
  type: PlannedUpload["type"],
  extension: string,
  mimeType: string,
  size: number,
  source: PlannedUpload["source"],
  assetReferenceId: string | null,
): PlannedUpload {
  const id = stableStorageId(job, `${label}:object`)
  return {
    id,
    type,
    key: buildKnowledgeObjectKey({
      knowledgeBaseId: job.knowledgeBaseId,
      documentId: job.documentId,
      versionId: job.documentVersionId,
      objectType: type,
      objectId: id,
      extension,
    }),
    extension,
    mimeType,
    size,
    source,
    assetReferenceId,
  }
}

function requiredStored(
  uploads: readonly StoredUpload[],
  type: StoredUpload["type"],
): StoredUpload {
  const matches = uploads.filter((upload) => upload.type === type)
  if (matches.length !== 1) throw invalidArtifact()
  return matches[0]!
}

function stableStorageId(job: KnowledgeProcessingJob, label: string): string {
  return uuidv5(
    [
      job.knowledgeBaseId,
      job.documentId,
      job.documentVersionId,
      job.processingGeneration,
      label,
    ].join(":"),
    STORAGE_OBJECT_NAMESPACE,
  )
}

function versionScope(job: KnowledgeProcessingJob) {
  return {
    id: job.documentVersionId,
    knowledgeBaseId: job.knowledgeBaseId,
    documentId: job.documentId,
    processingGeneration: job.processingGeneration,
  }
}

function objectScope(job: KnowledgeProcessingJob) {
  return {
    knowledgeBaseId: job.knowledgeBaseId,
    documentId: job.documentId,
    documentVersionId: job.documentVersionId,
    processingGeneration: job.processingGeneration,
  }
}

async function assertActiveGeneration(
  transaction: Prisma.TransactionClient,
  job: KnowledgeProcessingJob,
): Promise<void> {
  const [document, version] = await Promise.all([
    transaction.knowledgeBaseDocument.findUnique({
      where: { id: job.documentId },
      select: { activeProcessingVersionId: true, status: true },
    }),
    transaction.knowledgeBaseDocumentVersion.findUnique({
      where: { id: job.documentVersionId },
      select: {
        processingGeneration: true,
        cancelRequestedAt: true,
        versionStatus: true,
        operationType: true,
      },
    }),
  ])
  if (
    !document ||
    !version ||
    document.status === "deleted" ||
    document.activeProcessingVersionId !== job.documentVersionId ||
    version.processingGeneration !== job.processingGeneration ||
    version.cancelRequestedAt !== null ||
    !(
      version.versionStatus === "processing" ||
      (version.versionStatus === "ready" &&
        version.operationType === "rebuild_index")
    )
  ) {
    throw new KnowledgeProcessingError("KNOWLEDGE_PROCESSING_CANCELLED")
  }
}

async function lockDocumentRow(
  transaction: Prisma.TransactionClient,
  documentId: string,
): Promise<void> {
  await transaction.$queryRawUnsafe(
    'SELECT "id" FROM "knowledge_base_documents" WHERE "id" = $1::uuid FOR UPDATE',
    documentId,
  )
}

async function lockKnowledgeBaseRow(
  transaction: Prisma.TransactionClient,
  knowledgeBaseId: string,
): Promise<void> {
  await transaction.$queryRawUnsafe(
    'SELECT "id" FROM "knowledge_bases" WHERE "id" = $1::uuid FOR UPDATE',
    knowledgeBaseId,
  )
}

async function releaseStorageReservationLocked(
  transaction: Prisma.TransactionClient,
  knowledgeBaseId: string,
  reservationId: string,
  leaseToken: string,
  sizeBytes: bigint,
): Promise<void> {
  const reservation =
    await transaction.knowledgeBaseStorageReservation.findUnique({
      where: { id: reservationId },
    })
  if (!reservation) return
  if (
    reservation.knowledgeBaseId !== knowledgeBaseId ||
    reservation.sizeBytes !== sizeBytes ||
    reservation.leaseToken !== leaseToken ||
    reservation.cleanupStartedAt !== null ||
    reservation.leaseExpiresAt <= new Date()
  ) {
    throw invalidArtifact()
  }
  if (sizeBytes > 0n) {
    const released = await transaction.knowledgeBase.updateMany({
      where: {
        id: knowledgeBaseId,
        storageReservedBytes: { gte: sizeBytes },
      },
      data: { storageReservedBytes: { decrement: sizeBytes } },
    })
    if (released.count !== 1) throw invalidArtifact()
  }
  await transaction.knowledgeBaseStorageReservation.delete({
    where: { id: reservationId },
  })
}

async function consumeStorageReservationLocked(
  transaction: Prisma.TransactionClient,
  knowledgeBaseId: string,
  reservationId: string,
  leaseToken: string,
  sizeBytes: bigint,
  objectKeys: readonly string[],
): Promise<void> {
  const reservation =
    await transaction.knowledgeBaseStorageReservation.findUnique({
      where: { id: reservationId },
    })
  if (
    !reservation ||
    reservation.knowledgeBaseId !== knowledgeBaseId ||
    reservation.sizeBytes !== sizeBytes ||
    reservation.leaseToken !== leaseToken ||
    reservation.cleanupStartedAt !== null ||
    reservation.leaseExpiresAt <= new Date() ||
    !hasExactObjectKeys(reservation.objectKeysJson, objectKeys)
  ) {
    throw invalidArtifact()
  }
  if (sizeBytes > 0n) {
    const consumed = await transaction.knowledgeBase.updateMany({
      where: {
        id: knowledgeBaseId,
        storageReservedBytes: { gte: sizeBytes },
      },
      data: {
        storageReservedBytes: { decrement: sizeBytes },
        storageUsedBytes: { increment: sizeBytes },
      },
    })
    if (consumed.count !== 1) throw invalidArtifact()
  }
  await transaction.knowledgeBaseStorageReservation.delete({
    where: { id: reservationId },
  })
}

function hasExactObjectKeys(
  value: unknown,
  expectedObjectKeys: readonly string[],
): boolean {
  if (
    !Array.isArray(value) ||
    value.length !== expectedObjectKeys.length ||
    value.some((item) => typeof item !== "string")
  ) {
    return false
  }
  const actual = [...value].sort()
  const expected = [...expectedObjectKeys].sort()
  return actual.every((objectKey, index) => objectKey === expected[index])
}

async function readStreamLimited(
  stream: Readable,
  expectedSize: number,
): Promise<Buffer> {
  if (!Number.isSafeInteger(expectedSize) || expectedSize < 0) {
    throw invalidArtifact()
  }
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of stream) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += bytes.length
    if (size > expectedSize) throw invalidArtifact()
    chunks.push(bytes)
  }
  if (size !== expectedSize) throw invalidArtifact()
  return Buffer.concat(chunks, size)
}

function parseJsonArtifact<T>(
  bytes: Buffer,
  schema: z.ZodType<T>,
): T {
  try {
    return schema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)))
  } catch (error) {
    throw invalidArtifact(error)
  }
}

function isSortedUnique(values: readonly number[]): boolean {
  return values.every(
    (value, index) => index === 0 || value > values[index - 1]!,
  )
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex")
}

function checkpoint(
  outputHash: string,
  configDigest: string,
): KnowledgePipelineCheckpoint {
  return { configDigest, outputHash, completedAt: new Date() }
}

function invalidArtifact(cause?: unknown): KnowledgeProcessingError {
  return new KnowledgeProcessingError("KNOWLEDGE_DOCUMENT_STRUCTURE_INVALID", {
    cause,
  })
}

function hasCompatibleImageUnderstandingCheckpoint(
  job: KnowledgeProcessingJob,
  configDigest: string | null,
): boolean {
  return (
    configDigest !== null &&
    (job.operation === "rebuild_index" ||
      configDigest === job.imageUnderstanding.config_digest)
  )
}

async function mapWithConcurrency<T, U>(
  values: readonly T[],
  concurrency: number,
  operation: (value: T) => Promise<U>,
): Promise<U[]> {
  const result = new Array<U>(values.length)
  let nextIndex = 0
  let failure: unknown = null
  const workers = Array.from(
    { length: Math.min(concurrency, values.length) },
    async () => {
      for (;;) {
        if (failure !== null) return
        const index = nextIndex
        nextIndex += 1
        if (index >= values.length) return
        try {
          result[index] = await operation(values[index]!)
        } catch (error) {
          failure = error
          return
        }
      }
    },
  )
  await Promise.all(workers)
  if (failure !== null) throw failure
  return result
}
