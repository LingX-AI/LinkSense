import { describe, expect, it, vi } from "vitest"

import type { KnowledgeProcessingCommand } from "../src/modules/knowledge/types.js"
import type { KnowledgeProcessingConfig } from "../src/modules/knowledge-processing/config.js"
import { projectKnowledgeProcessingConfig } from "../src/modules/knowledge-processing/config.js"
import { requireFullAppConfig } from "../src/config.js"
import { testConfig } from "./test-config.js"
import {
  PrismaKnowledgePipelineStateStore,
  PrismaKnowledgeProcessingJobFactory,
} from "../src/modules/knowledge-processing/prisma-state.js"
import type { KnowledgeProcessingJob } from "../src/modules/knowledge-processing/pipeline.js"
import { createImageUnderstandingSnapshot } from "../src/modules/system/image-understanding-settings.js"

const DOCUMENT_ID = "20000000-0000-4000-8000-000000000001"
const VERSION_ID = "30000000-0000-4000-8000-000000000001"
const GENERATION = "40000000-0000-4000-8000-000000000001"
const REQUESTED_BY = "50000000-0000-4000-8000-000000000001"
const SHA256 = "a".repeat(64)

describe("PrismaKnowledgePipelineStateStore external tasks", () => {
  it("rejects a task submitted after the document was deleted", async () => {
    const createAttempt = vi.fn()
    const transaction = {
      $queryRawUnsafe: vi.fn(async () => []),
      knowledgeBaseDocument: {
        findUnique: vi.fn(async () => ({
          activeProcessingVersionId: null,
          status: "deleted",
        })),
      },
      knowledgeBaseDocumentVersion: {
        findFirst: vi.fn(async () => ({
          cancelRequestedAt: null,
          operationType: "upload",
          versionStatus: "deleted",
        })),
      },
      knowledgeBaseProcessingAttempt: {
        findUnique: vi.fn(async () => null),
        create: createAttempt,
      },
    }
    const state = stateStore(transaction)

    await expect(
      state.recordExternalTask(job(), "convert", "late-task")
    ).rejects.toMatchObject({ code: "KNOWLEDGE_PROCESSING_CANCELLED" })
    expect(createAttempt).not.toHaveBeenCalled()
  })

  it("allocates a new attempt and discards the old active task atomically", async () => {
    const updateMany = vi.fn(async () => ({ count: 1 }))
    const create = vi.fn(async () => ({}))
    const updateVersion = vi.fn(async () => ({}))
    const transaction = activeTransaction({
      processingAttempt: {
        findUnique: vi.fn(async () => null),
        aggregate: vi.fn(async () => ({ _max: { attemptNo: 2 } })),
        updateMany,
        create,
      },
      updateVersion,
    })
    const state = stateStore(transaction)

    await expect(
      state.recordExternalTask(job(), "hybrid_chunk", "chunk-task-3")
    ).resolves.toEqual({ taskId: "chunk-task-3", attemptNo: 3 })
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        documentVersionId: VERSION_ID,
        processingGeneration: GENERATION,
        taskKind: "hybrid_chunk",
        status: "active",
      },
      data: {
        status: "discarded",
        discardedAt: expect.any(Date),
      },
    })
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        documentVersionId: VERSION_ID,
        processingGeneration: GENERATION,
        taskKind: "hybrid_chunk",
        processingStage: "chunking",
        attemptNo: 3,
        taskId: "chunk-task-3",
        status: "active",
      }),
    })
    expect(updateVersion).toHaveBeenCalledWith({
      where: { id: VERSION_ID },
      data: { processingRevision: { increment: 1 } },
    })
  })

  it("treats recording the same active task as idempotent", async () => {
    const updateMany = vi.fn()
    const create = vi.fn()
    const transaction = activeTransaction({
      processingAttempt: {
        findUnique: vi.fn(async () => ({
          documentVersionId: VERSION_ID,
          processingGeneration: GENERATION,
          attemptNo: 4,
          status: "active",
        })),
        aggregate: vi.fn(),
        updateMany,
        create,
      },
    })
    const state = stateStore(transaction)

    await expect(
      state.recordExternalTask(job(), "convert", "convert-task-4")
    ).resolves.toEqual({ taskId: "convert-task-4", attemptNo: 4 })
    expect(updateMany).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
  })

  it.each([
    {
      action: "discard",
      expectedStatus: "discarded",
      expectedTimestamp: "discardedAt",
    },
    {
      action: "complete",
      expectedStatus: "completed",
      expectedTimestamp: "completedAt",
    },
  ] as const)(
    "$action updates only the matching active attempt",
    async ({ action, expectedStatus, expectedTimestamp }) => {
      const updateMany = vi.fn(async () => ({ count: 1 }))
      const updateVersion = vi.fn(async () => ({}))
      const transaction = activeTransaction({
        processingAttempt: { updateMany },
        updateVersion,
      })
      const state = stateStore(transaction)
      const result =
        action === "discard"
          ? await state.discardExternalTask(job(), "convert", "convert-task")
          : await state.completeExternalTask(job(), "convert", "convert-task")

      expect(result).toBe(true)
      expect(updateMany).toHaveBeenCalledWith({
        where: {
          documentVersionId: VERSION_ID,
          processingGeneration: GENERATION,
          taskKind: "convert",
          taskId: "convert-task",
          status: "active",
        },
        data: {
          status: expectedStatus,
          [expectedTimestamp]: expect.any(Date),
        },
      })
      expect(updateVersion).toHaveBeenCalledOnce()
    }
  )

  it("returns the current generation's active task only", async () => {
    const findFirst = vi.fn(async () => ({
      taskId: "current-task",
      attemptNo: 2,
    }))
    const state = new PrismaKnowledgePipelineStateStore({
      knowledgeBaseProcessingAttempt: { findFirst },
    } as never)

    await expect(
      state.getActiveExternalTask(job(), "convert")
    ).resolves.toEqual({ taskId: "current-task", attemptNo: 2 })
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        documentVersionId: VERSION_ID,
        processingGeneration: GENERATION,
        taskKind: "convert",
        status: "active",
      },
      orderBy: { attemptNo: "desc" },
      select: { taskId: true, attemptNo: true },
    })
  })

  it("discards all active external tasks when cancellation is requested", async () => {
    const updateAttempts = vi.fn(async () => ({ count: 2 }))
    const updateVersion = vi.fn(async () => ({}))
    const transaction = {
      $queryRawUnsafe: vi.fn(async () => []),
      knowledgeBaseDocument: {
        findUnique: vi.fn(async () => ({ status: "processing" })),
      },
      knowledgeBaseDocumentVersion: {
        findFirst: vi.fn(async () => ({
          cancelRequestedAt: null,
          processingStage: "chunking",
          progressPercent: 55,
          versionStatus: "processing",
        })),
        update: updateVersion,
      },
      knowledgeBaseProcessingAttempt: { updateMany: updateAttempts },
      knowledgeSourceItem: { findFirst: vi.fn(async () => null) },
      knowledgeBaseEntry: { findFirst: vi.fn(async () => null) },
    }
    const state = stateStore(transaction)

    await state.requestCancellation(job())

    expect(updateVersion).toHaveBeenCalledWith({
      where: { id: VERSION_ID },
      data: expect.objectContaining({
        cancelRequestedAt: expect.any(Date),
        cancelRequestedBy: REQUESTED_BY,
        cancelReason: "user_requested",
      }),
    })
    expect(updateAttempts).toHaveBeenCalledWith({
      where: {
        documentVersionId: VERSION_ID,
        processingGeneration: GENERATION,
        status: "active",
      },
      data: {
        status: "discarded",
        discardedAt: expect.any(Date),
      },
    })
  })
})

describe("PrismaKnowledgePipelineStateStore lifecycle", () => {
  it("does not let a late failure mutate a stale generation", async () => {
    const updateVersion = vi.fn()
    const updateDocument = vi.fn()
    const updateAttempts = vi.fn()
    const transaction = {
      $queryRawUnsafe: vi.fn(async () => []),
      knowledgeBaseDocument: {
        findUnique: vi.fn(async () => ({
          currentVersionId: VERSION_ID,
          activeProcessingVersionId: null,
          status: "ready",
        })),
        update: updateDocument,
      },
      knowledgeBaseDocumentVersion: {
        findFirst: vi.fn(async () => ({
          cancelRequestedAt: null,
          operationType: "upload",
          processingStage: "embedding",
          versionStatus: "processing",
        })),
        update: updateVersion,
      },
      knowledgeBaseProcessingAttempt: { updateMany: updateAttempts },
      knowledgeSourceItem: { findFirst: vi.fn(async () => null) },
      knowledgeBaseEntry: { findFirst: vi.fn(async () => null) },
    }
    const state = stateStore(transaction)

    await state.markFailed({
      job: job(),
      stage: "embedding",
      errorCode: "KNOWLEDGE_EXTERNAL_SERVICE_UNAVAILABLE",
    })

    expect(updateVersion).not.toHaveBeenCalled()
    expect(updateDocument).not.toHaveBeenCalled()
    expect(updateAttempts).not.toHaveBeenCalled()
  })

  it("records the failed stage and fails active external attempts", async () => {
    const updateVersion = vi.fn(async () => ({}))
    const updateDocument = vi.fn(async () => ({}))
    const updateAttempts = vi.fn(async () => ({ count: 1 }))
    const transaction = {
      $queryRawUnsafe: vi.fn(async () => []),
      knowledgeBaseDocument: {
        findUnique: vi.fn(async () => ({
          currentVersionId: null,
          activeProcessingVersionId: VERSION_ID,
          status: "processing",
        })),
        update: updateDocument,
      },
      knowledgeBaseDocumentVersion: {
        findFirst: vi.fn(async () => ({
          cancelRequestedAt: null,
          operationType: "upload",
          processingStage: "chunking",
          versionStatus: "processing",
        })),
        update: updateVersion,
      },
      knowledgeBaseProcessingAttempt: { updateMany: updateAttempts },
      knowledgeSourceItem: { findFirst: vi.fn(async () => null) },
      knowledgeBaseEntry: { findFirst: vi.fn(async () => null) },
    }
    const state = stateStore(transaction)

    await state.markFailed({
      job: job(),
      stage: "chunking",
      errorCode: "KNOWLEDGE_DOCLING_TASK_NOT_FOUND",
    })

    expect(updateVersion).toHaveBeenCalledWith({
      where: { id: VERSION_ID },
      data: expect.objectContaining({
        versionStatus: "failed",
        processingStage: "failed",
        failedStage: "chunking",
        stableErrorCode: "KNOWLEDGE_DOCLING_TASK_NOT_FOUND",
      }),
    })
    expect(updateAttempts).toHaveBeenCalledWith({
      where: {
        documentVersionId: VERSION_ID,
        processingGeneration: GENERATION,
        status: "active",
      },
      data: {
        status: "failed",
        stableErrorCode: "KNOWLEDGE_DOCLING_TASK_NOT_FOUND",
        failedAt: expect.any(Date),
      },
    })
  })
})

describe("PrismaKnowledgeProcessingJobFactory", () => {
  it("starts a new upload at parsing and projects the pinned parser/chunker configuration", async () => {
    const fixture = factoryFixture({ operation: "upload" })
    const factory = new PrismaKnowledgeProcessingJobFactory(
      fixture.prisma as never,
      processingConfig(),
      fixture.objectStore,
      imageUnderstandingSettingsReader(),
      knowledgeModelSettingsReader()
    )

    await expect(factory.create(fixture.command)).resolves.toMatchObject({
      startStage: "parsing",
      parserConfigDigest: SHA256,
      chunking: {
        tokenizer: "/models/tokenizers/Qwen3-Embedding-4B",
        childMaxTokens: 768,
        parentMaxTokens: 3000,
        embeddingMaxInputTokens: 8192,
        configDigest: SHA256,
      },
    })
    expect(fixture.prisma.knowledgeBaseObject.findFirst).not.toHaveBeenCalled()
  })

  it("pins the current image model snapshot for a fresh reprocess", async () => {
    const fixture = factoryFixture({ operation: "reprocess" })
    const previousImageUnderstanding =
      fixture.version.processingConfigJson.image_understanding
    const currentImageUnderstanding = {
      ...previousImageUnderstanding,
      revision: previousImageUnderstanding.revision + 1,
      config_digest: "b".repeat(64),
    }
    const imageSettings = {
      getSnapshot: vi.fn(async () => currentImageUnderstanding),
      resolveRuntime: vi.fn(async () => null),
    }
    const factory = new PrismaKnowledgeProcessingJobFactory(
      fixture.prisma as never,
      processingConfig(),
      fixture.objectStore,
      imageSettings,
      knowledgeModelSettingsReader()
    )

    await expect(factory.create(fixture.command)).resolves.toMatchObject({
      operation: "reprocess",
      startStage: "parsing",
      imageUnderstanding: currentImageUnderstanding,
    })
    expect(imageSettings.getSnapshot).toHaveBeenCalledOnce()
    expect(
      fixture.prisma.knowledgeBaseDocumentVersion.updateMany
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          processingConfigJson: expect.objectContaining({
            image_understanding: currentImageUnderstanding,
          }),
        }),
      })
    )
  })

  it("resumes retry embedding only after every immutable artifact is verified", async () => {
    const fixture = factoryFixture({
      operation: "retry",
      failedStage: "indexing",
    })
    const factory = new PrismaKnowledgeProcessingJobFactory(
      fixture.prisma as never,
      processingConfig(),
      fixture.objectStore,
      imageUnderstandingSettingsReader(),
      knowledgeModelSettingsReader()
    )

    await expect(factory.create(fixture.command)).resolves.toMatchObject({
      startStage: "embedding",
    })
    expect(fixture.objectStore.verifyIntegrity).toHaveBeenCalledTimes(6)
  })

  it("resumes parenting when the retrieval manifest is missing", async () => {
    const fixture = factoryFixture({
      operation: "retry",
      failedStage: "embedding",
      missingObjectType: "retrieval_manifest",
    })
    const factory = new PrismaKnowledgeProcessingJobFactory(
      fixture.prisma as never,
      processingConfig(),
      fixture.objectStore,
      imageUnderstandingSettingsReader(),
      knowledgeModelSettingsReader()
    )

    await expect(factory.create(fixture.command)).resolves.toMatchObject({
      startStage: "parenting",
    })
  })

  it("rebuilds vectors against immutable manifest provenance after runtime settings change", async () => {
    const fixture = factoryFixture({ operation: "rebuild_index" })
    const persistedImageUnderstanding =
      fixture.version.processingConfigJson.image_understanding
    fixture.version.imageUnderstandingConfigDigest = "d".repeat(64)
    const currentImageUnderstanding = {
      ...persistedImageUnderstanding,
      revision: persistedImageUnderstanding.revision + 1,
      config_digest: "b".repeat(64),
    }
    const changedConfig = processingConfig()
    changedConfig.chunkingConfigDigest = "c".repeat(64)
    const imageSettings = {
      getSnapshot: vi.fn(async () => currentImageUnderstanding),
      resolveRuntime: vi.fn(async () => null),
    }
    const factory = new PrismaKnowledgeProcessingJobFactory(
      fixture.prisma as never,
      changedConfig,
      fixture.objectStore,
      imageSettings,
      knowledgeModelSettingsReader()
    )

    await expect(factory.create(fixture.command)).resolves.toMatchObject({
      startStage: "embedding",
      imageUnderstanding: persistedImageUnderstanding,
      chunking: { configDigest: SHA256 },
    })
    expect(imageSettings.getSnapshot).not.toHaveBeenCalled()
    expect(
      fixture.prisma.knowledgeBaseDocumentVersion.updateMany
    ).not.toHaveBeenCalled()
    expect(fixture.objectStore.verifyIntegrity).not.toHaveBeenCalled()
  })

  it("restarts parsing when parser configuration or parse artifacts changed", async () => {
    const fixture = factoryFixture({
      operation: "retry",
      failedStage: "chunking",
      parserConfigDigest: "c".repeat(64),
    })
    const factory = new PrismaKnowledgeProcessingJobFactory(
      fixture.prisma as never,
      processingConfig(),
      fixture.objectStore,
      imageUnderstandingSettingsReader(),
      knowledgeModelSettingsReader()
    )

    await expect(factory.create(fixture.command)).resolves.toMatchObject({
      startStage: "parsing",
    })
    expect(fixture.prisma.knowledgeBaseObject.findFirst).not.toHaveBeenCalled()
  })

  it.each(["retry", "rebuild_index"] as const)("preserves v0.3.5 document provenance during %s after the Docling runtime upgrade", async operation => {
    // Actual parser contract digest from v0.3.5 (Serve 1.27 / Core 2.87.1).
    const previousParserDigest = "2af73350c7c22d76db968c278924b46004353a353ca375a623ee5ab5e9990ae7"
    const config = projectKnowledgeProcessingConfig(requireFullAppConfig(testConfig({ LINKSENSE_EDITION: "full" })))
    expect(config.parserConfigDigest).not.toBe(previousParserDigest)
    const fixture = factoryFixture({ operation, failedStage: "embedding", parserConfigDigest: previousParserDigest })
    fixture.version.chunkingConfigDigest = config.chunkingConfigDigest
    const factory = new PrismaKnowledgeProcessingJobFactory(
      fixture.prisma as never, config, fixture.objectStore,
      imageUnderstandingSettingsReader(), knowledgeModelSettingsReader(),
    )

    await expect(factory.create(fixture.command)).resolves.toMatchObject({
      startStage: operation === "retry" ? "parsing" : "embedding",
      chunking: { configDigest: config.chunkingConfigDigest },
    })
    expect(fixture.version.parserConfigDigest).toBe(previousParserDigest)
    expect(fixture.prisma.knowledgeBaseDocumentVersion.updateMany).not.toHaveBeenCalled()
  })

  it("restarts parsing when zero-asset retry artifacts belong to an older processing generation", async () => {
    const fixture = factoryFixture({
      operation: "retry",
      failedStage: "chunking",
      objectProcessingGeneration: "20000000-0000-4000-8000-000000000099",
    })
    const factory = new PrismaKnowledgeProcessingJobFactory(
      fixture.prisma as never,
      processingConfig(),
      fixture.objectStore,
      imageUnderstandingSettingsReader(),
      knowledgeModelSettingsReader()
    )

    await expect(factory.create(fixture.command)).resolves.toMatchObject({
      startStage: "parsing",
    })
    expect(fixture.objectStore.verifyIntegrity).not.toHaveBeenCalled()
  })
})

function activeTransaction(input: {
  processingAttempt: Record<string, unknown>
  updateVersion?: ReturnType<typeof vi.fn>
}) {
  return {
    $queryRawUnsafe: vi.fn(async () => []),
    knowledgeBaseDocument: {
      findUnique: vi.fn(async () => ({
        activeProcessingVersionId: VERSION_ID,
        status: "processing",
      })),
    },
    knowledgeBaseDocumentVersion: {
      findFirst: vi.fn(async () => ({
        cancelRequestedAt: null,
        operationType: "upload",
        versionStatus: "processing",
      })),
      update: input.updateVersion ?? vi.fn(async () => ({})),
    },
    knowledgeBaseProcessingAttempt: input.processingAttempt,
  }
}

function stateStore(transaction: unknown) {
  return new PrismaKnowledgePipelineStateStore({
    $transaction: vi.fn(async (work: (tx: never) => Promise<unknown>) =>
      work(transaction as never)
    ),
  } as never)
}

function job(): KnowledgeProcessingJob {
  return {
    operation: "upload",
    knowledgeBaseId: "10000000-0000-4000-8000-000000000001",
    documentId: DOCUMENT_ID,
    documentVersionId: VERSION_ID,
    processingGeneration: GENERATION,
    requestedBy: REQUESTED_BY,
    sourceFormat: "pdf",
    ocrEnabled: false,
    startStage: "parsing",
    parserConfigDigest: SHA256,
    chunking: {
      tokenizer: "/models/tokenizers/Qwen3-Embedding-4B",
      childMaxTokens: 768,
      parentMaxTokens: 3000,
      embeddingMaxInputTokens: 8192,
      configDigest: SHA256,
    },
    imageUnderstanding: createImageUnderstandingSnapshot(null),
    embeddingProfileHash: SHA256,
  } as KnowledgeProcessingJob
}

function factoryFixture(options: {
  operation: KnowledgeProcessingCommand["operation"]
  failedStage?: string
  missingObjectType?: string
  parserConfigDigest?: string
  objectProcessingGeneration?: string
}) {
  const imageUnderstanding = createImageUnderstandingSnapshot(null)
  const command: KnowledgeProcessingCommand = {
    operation: options.operation,
    knowledgeBaseId: "10000000-0000-4000-8000-000000000001",
    documentId: DOCUMENT_ID,
    documentVersionId: VERSION_ID,
    processingGeneration: GENERATION,
    requestedBy: REQUESTED_BY,
  }
  const ids = {
    docling_bundle: "60000000-0000-4000-8000-000000000001",
    display_markdown: "60000000-0000-4000-8000-000000000002",
    docling_json: "60000000-0000-4000-8000-000000000003",
    hybrid_chunks: "60000000-0000-4000-8000-000000000004",
    image_projection: "60000000-0000-4000-8000-000000000005",
    retrieval_manifest: "60000000-0000-4000-8000-000000000006",
  } as const
  const version = {
    canonicalExtension: "pdf",
    processingStage: options.failedStage ? "failed" : "queued",
    failedStage: options.failedStage ?? null,
    processingConfigJson: {
      ocr_enabled: false,
      image_understanding: imageUnderstanding,
    },
    doclingBundleObjectId: ids.docling_bundle,
    doclingBundleSha256: SHA256,
    displayMarkdownObjectId: ids.display_markdown,
    displayMarkdownSha256: SHA256,
    doclingJsonObjectId: ids.docling_json,
    doclingJsonSha256: SHA256,
    parsedAssetCount: 0,
    hybridChunksObjectId: ids.hybrid_chunks,
    hybridChunksSha256: SHA256,
    imageProjectionObjectId: ids.image_projection,
    imageProjectionSha256: SHA256,
    imageUnderstandingConfigDigest: imageUnderstanding.config_digest,
    retrievalManifestObjectId: ids.retrieval_manifest,
    retrievalManifestSha256: SHA256,
    parserConfigDigest: options.parserConfigDigest ?? SHA256,
    chunkingConfigDigest: SHA256,
  }
  const findObject = vi.fn(
    async (query: {
      where: {
        objectType: keyof typeof ids
        processingGeneration: string
      }
    }) => {
      if (
        query.where.processingGeneration !==
        (options.objectProcessingGeneration ?? GENERATION)
      ) {
        return null
      }
      if (query.where.objectType === options.missingObjectType) return null
      return {
        objectKey: `knowledge/${query.where.objectType}`,
        checksumSha256: SHA256,
        sizeBytes: 100n,
      }
    }
  )
  return {
    command,
    version,
    prisma: {
      knowledgeBaseDocumentVersion: {
        findFirst: vi.fn(async () => version),
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
      knowledgeBaseObject: {
        findFirst: findObject,
        findMany: vi.fn(async () => []),
      },
    },
    objectStore: {
      verifyIntegrity: vi.fn(async () => true),
    },
  }
}

function processingConfig(): KnowledgeProcessingConfig {
  return {
    parserConfigDigest: SHA256,
    chunkingConfigDigest: SHA256,
    chunking: {
      tokenizer: "/models/tokenizers/Qwen3-Embedding-4B",
      childMaxTokens: 768,
      parentMaxTokens: 3000,
      embeddingMaxInputTokens: 8192,
    },
    embedding: {
      dimensions: 2,
      maximumInputTokens: 8192,
    },
  } as KnowledgeProcessingConfig
}

function imageUnderstandingSettingsReader() {
  return {
    getSnapshot: vi.fn(async () => createImageUnderstandingSnapshot(null)),
    resolveRuntime: vi.fn(async () => null),
  }
}

function knowledgeModelSettingsReader() {
  return {
    resolveRuntime: vi.fn(async () => ({
      revision: 1,
      embedding: {
        baseUrl: "https://embedding.example.test",
        model: "fixture",
        dimensions: 2,
        maximumInputTokens: 8192,
        profileHash: SHA256,
        pricing: {
          input_price_per_million: "0",
          cached_input_price_per_million: "0",
          output_price_per_million: "0",
        },
      },
      rerank: null,
    })),
  }
}
