import { readFile } from "node:fs/promises"
import { Readable } from "node:stream"

import { describe, expect, it, vi } from "vitest"

import { DoclingServeClient } from "../src/modules/knowledge-processing/docling.js"
import type { HybridChunkResult } from "../src/modules/knowledge-processing/docling-hybrid.js"
import {
  ElasticsearchKnowledgeAdapter,
  type IndexedParentDocument,
} from "../src/modules/knowledge-processing/elasticsearch.js"
import { indexIntegrityDigest } from "../src/modules/knowledge-processing/elasticsearch.js"
import { EmbeddingClient } from "../src/modules/knowledge-processing/embedding.js"
import { KnowledgeProcessingError } from "../src/modules/knowledge-processing/errors.js"
import type { KnowledgeOfficeDocumentConverter } from "../src/modules/knowledge-processing/office-converter.js"
import {
  convergeOuterWorkerFailure,
  KnowledgePipelineProcessor,
  knowledgeProcessingStageSchema,
  nextStage,
  quarantineInvalidPersistedJob,
  validateKnowledgeProcessingJob,
  type KnowledgeDocumentLock,
  type KnowledgeExternalTaskKind,
  type KnowledgePipelineStateStore,
  type KnowledgePipelineWorkspace,
  type KnowledgeProcessingJob,
  type KnowledgeProcessingStage,
} from "../src/modules/knowledge-processing/pipeline.js"
import type { BuiltKnowledgeParent } from "../src/modules/knowledge-processing/parent-builder.js"
import {
  KnowledgeIndexActivationReconciler,
  PrismaKnowledgeIndexReconciliationSource,
  type KnowledgeIndexReconciliationCoordinator,
} from "../src/modules/knowledge-processing/reconciliation.js"
import { createImageUnderstandingSnapshot } from "../src/modules/system/image-understanding-settings.js"
import {
  modelUsageCaptureSchema,
  type ModelUsageCapture,
  type ModelUsageRecorder,
} from "../src/modules/usage/model-usage.js"

const ids = {
  knowledgeBase: "00000000-0000-4000-8000-000000000001",
  document: "00000000-0000-4000-8000-000000000002",
  version: "00000000-0000-4000-8000-000000000003",
  generation: "00000000-0000-4000-8000-000000000004",
  actor: "00000000-0000-4000-8000-000000000005",
}

const hybridChunks: HybridChunkResult = {
  filename: "policy.pdf",
  chunks: [
    {
      chunkIndex: 0,
      text: "Policy\n\nFirst requirement.",
      rawText: "First requirement.",
      numTokens: 20,
      headings: ["Policy"],
      captions: [],
      docItems: ["#/texts/0"],
      pageNumbers: [1],
      metadata: {},
    },
    {
      chunkIndex: 1,
      text: "Policy\n\nSecond requirement.",
      rawText: "Second requirement.",
      numTokens: 18,
      headings: ["Policy"],
      captions: [],
      docItems: ["#/texts/1"],
      pageNumbers: [1],
      metadata: {},
    },
  ],
}

describe("knowledge processing pipeline", () => {
  it("uses the parsing-to-activation stage order", () => {
    const stages = [
      "parsing",
      "chunking",
      "image_understanding",
      "parenting",
      "embedding",
      "indexing",
      "activating",
    ] satisfies KnowledgeProcessingStage[]

    expect(knowledgeProcessingStageSchema.options).toEqual(stages)
    expect(stages.map((stage) => nextStage(stage))).toEqual([
      "chunking",
      "image_understanding",
      "parenting",
      "embedding",
      "indexing",
      "activating",
      null,
    ])
  })

  it("validates the child, parent, and embedding token budgets", () => {
    expect(validateKnowledgeProcessingJob(job())).toEqual(job())
    expect(
      validateKnowledgeProcessingJob(
        job({
          chunking: {
            ...job().chunking,
            childMaxTokens: 8_192,
            embeddingMaxInputTokens: 8_192,
          },
        })
      )
    ).toBeNull()
    expect(
      validateKnowledgeProcessingJob(
        job({
          chunking: {
            ...job().chunking,
            childMaxTokens: 3_001,
            parentMaxTokens: 3_000,
          },
        })
      )
    ).toBeNull()
    expect(
      validateKnowledgeProcessingJob({
        ...job(),
        chunking: {
          ...job().chunking,
          tokenizer: "bad\r\nvalue",
        },
      } as never)
    ).toBeNull()
    expect(
      validateKnowledgeProcessingJob({
        ...job(),
        processingGeneration: 1,
      })
    ).toBeNull()
  })

  it("quarantines a legacy persisted job without restoring removed fields", async () => {
    const current = job()
    const legacyJob = {
      ...current,
      chunking: {
        childMaxTokens: current.chunking.childMaxTokens,
        parentMaxTokens: current.chunking.parentMaxTokens,
        embeddingMaxInputTokens: current.chunking.embeddingMaxInputTokens,
        configDigest: current.chunking.configDigest,
      },
    }
    const markFailed = vi.fn(async () => undefined)

    await expect(
      quarantineInvalidPersistedJob({
        state: { markFailed },
        stage: "chunking",
        jobData: legacyJob,
      })
    ).resolves.toBe(true)
    expect(markFailed).toHaveBeenCalledWith({
      job: {
        knowledgeBaseId: ids.knowledgeBase,
        documentId: ids.document,
        documentVersionId: ids.version,
        processingGeneration: ids.generation,
      },
      stage: "chunking",
      errorCode: "KNOWLEDGE_EXTERNAL_SERVICE_UNAVAILABLE",
    })
    expect(validateKnowledgeProcessingJob(legacyJob)).toBeNull()
  })

  it("isolates an unidentifiable persisted job without failing recovery", async () => {
    const markFailed = vi.fn(async () => undefined)

    await expect(
      quarantineInvalidPersistedJob({
        state: { markFailed },
        stage: "parsing",
        jobData: { malformed: true },
      })
    ).resolves.toBe(true)
    expect(markFailed).not.toHaveBeenCalled()
  })

  it("does not let a legacy outer-worker failure abort API startup recovery", async () => {
    const current = job()
    const markFailed = vi.fn(async () => undefined)

    await expect(
      convergeOuterWorkerFailure({
        state: { markFailed },
        stage: "chunking",
        jobData: {
          ...current,
          chunking: {
            childMaxTokens: current.chunking.childMaxTokens,
            parentMaxTokens: current.chunking.parentMaxTokens,
            embeddingMaxInputTokens: current.chunking.embeddingMaxInputTokens,
            configDigest: current.chunking.configDigest,
          },
        },
        failedReason: "job started more than allowable limit",
      })
    ).resolves.toBe(true)
    expect(markFailed).toHaveBeenCalledOnce()
  })

  it.each([
    ["parsing", "convert"],
    ["chunking", "hybrid_chunk"],
  ] as const)(
    "invalidates only the missing %s task and resubmits it on the next attempt",
    async (stage, kind) => {
      const fixture = externalTaskRecoveryFixture(kind)

      await expect(
        fixture.processor.process(job(), stage)
      ).rejects.toMatchObject({
        code: "KNOWLEDGE_DOCLING_TASK_NOT_FOUND",
        retryable: true,
      })
      expect(fixture.activeTask(kind)).toBeNull()
      expect(fixture.state.discardExternalTask).toHaveBeenCalledWith(
        job(),
        kind,
        `expired-${kind}`
      )
      expect(fixture.submit).not.toHaveBeenCalled()

      await expect(
        fixture.processor.process(job(), stage)
      ).rejects.toMatchObject({
        code: "KNOWLEDGE_DOCLING_TASK_NOT_FOUND",
        retryable: true,
      })
      expect(fixture.submit).toHaveBeenCalledOnce()
      expect(fixture.state.recordExternalTask).toHaveBeenCalledWith(
        job(),
        kind,
        `replacement-${kind}`
      )
      expect(fixture.state.discardExternalTask).toHaveBeenLastCalledWith(
        job(),
        kind,
        `replacement-${kind}`
      )
      if (kind === "convert") {
        expect(fixture.workspace.openDoclingSource).toHaveBeenCalledOnce()
        expect(fixture.workspace.loadDoclingJson).not.toHaveBeenCalled()
      } else {
        expect(fixture.workspace.loadDoclingJson).toHaveBeenCalledOnce()
        expect(fixture.workspace.openDoclingSource).not.toHaveBeenCalled()
      }
    }
  )

  it("keeps a non-missing external task active for a retry", async () => {
    const fixture = externalTaskRecoveryFixture("convert", {
      waitError: new KnowledgeProcessingError(
        "KNOWLEDGE_EXTERNAL_SERVICE_UNAVAILABLE",
        { retryable: true }
      ),
    })

    await expect(
      fixture.processor.process(job(), "parsing")
    ).rejects.toMatchObject({
      code: "KNOWLEDGE_EXTERNAL_SERVICE_UNAVAILABLE",
      retryable: true,
    })

    expect(fixture.activeTask("convert")).toMatchObject({
      taskId: "expired-convert",
    })
    expect(fixture.state.discardExternalTask).not.toHaveBeenCalled()
  })

  it("submits a converted legacy Office source and always disposes it", async () => {
    const state = stateStore()
    const workspace = memoryWorkspace()
    const docling = doclingClient()
    const dispose = vi.fn(async () => undefined)
    const officeConverter: KnowledgeOfficeDocumentConverter = {
      start: vi.fn(async () => undefined),
      health: vi.fn(async () => undefined),
      prepare: vi.fn(async () => ({
        filename: "policy.docx",
        contentType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        openStream: async () => Readable.from("converted"),
        dispose,
      })),
      close: vi.fn(async () => undefined),
    }
    const submitConversion = vi
      .spyOn(docling, "submitConversion")
      .mockResolvedValue(taskStatus("converted-task", "convert"))
    vi.spyOn(docling, "waitForSuccess").mockRejectedValue(
      new KnowledgeProcessingError("KNOWLEDGE_EXTERNAL_SERVICE_UNAVAILABLE", {
        retryable: true,
      }),
    )
    const pipeline = processor({
      state,
      workspace,
      docling,
      officeConverter,
    })

    await expect(
      pipeline.process(job({ sourceFormat: "doc" }), "parsing"),
    ).rejects.toMatchObject({
      code: "KNOWLEDGE_EXTERNAL_SERVICE_UNAVAILABLE",
    })

    expect(officeConverter.prepare).toHaveBeenCalledWith(
      expect.objectContaining({ sourceFormat: "doc" }),
    )
    expect(submitConversion).toHaveBeenCalledWith(
      expect.objectContaining({
        filename: "policy.docx",
        contentType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      }),
      expect.any(Object),
      expect.any(AbortSignal),
    )
    expect(dispose).toHaveBeenCalledOnce()
  })

  it("discards Docling's false-success Hybrid task before retrying", async () => {
    const state = stateStore({
      activeTasks: new Map([
        ["hybrid_chunk", { taskId: "empty-hybrid-task", attemptNo: 1 }],
      ]),
    })
    const docling = doclingClient()
    vi.spyOn(docling, "waitForSuccess").mockResolvedValue(
      taskStatus("empty-hybrid-task", "chunk")
    )
    vi.spyOn(docling, "getHybridChunkResult").mockRejectedValue(
      new KnowledgeProcessingError("KNOWLEDGE_DOCLING_CHUNKER_UNAVAILABLE", {
        retryable: true,
      })
    )
    const pipeline = processor({
      state,
      workspace: memoryWorkspace({ parsed: true }),
      docling,
    })

    await expect(pipeline.process(job(), "chunking")).rejects.toMatchObject({
      code: "KNOWLEDGE_DOCLING_CHUNKER_UNAVAILABLE",
      retryable: true,
    })
    expect(state.discardExternalTask).toHaveBeenCalledWith(
      job(),
      "hybrid_chunk",
      "empty-hybrid-task"
    )
    expect(state.activeTasks.get("hybrid_chunk")).toBeUndefined()
  })

  it("skips Docling when immutable parsed artifacts already exist", async () => {
    const state = stateStore({
      activeTasks: new Map([
        ["convert", { taskId: "checkpointed-convert", attemptNo: 1 }],
      ]),
    })
    const workspace = memoryWorkspace({ parsed: true })
    const docling = doclingClient()
    const submitConversion = vi.spyOn(docling, "submitConversion")
    const waitForSuccess = vi.spyOn(docling, "waitForSuccess")
    const getConversionResult = vi.spyOn(docling, "getConversionResult")
    const pipeline = processor({ state, workspace, docling })

    await expect(pipeline.process(job(), "parsing")).resolves.toBeUndefined()

    expect(workspace.hasParsedArtifacts).toHaveBeenCalledOnce()
    expect(workspace.openDoclingSource).not.toHaveBeenCalled()
    expect(submitConversion).not.toHaveBeenCalled()
    expect(waitForSuccess).not.toHaveBeenCalled()
    expect(getConversionResult).not.toHaveBeenCalled()
    expect(state.completeExternalTask).toHaveBeenCalledWith(
      job(),
      "convert",
      "checkpointed-convert"
    )
    expect(state.activeTasks.get("convert")).toBeUndefined()
    expect(state.transition).toHaveBeenNthCalledWith(1, {
      job: job(),
      stage: "parsing",
      progress: 25,
    })
    expect(state.transition).toHaveBeenNthCalledWith(2, {
      job: job(),
      stage: "parsing",
      progress: 50,
    })
  })

  it("runs Hybrid children through parenting, embedding, and candidate verification", async () => {
    const state = stateStore()
    const workspace = memoryWorkspace({ parsed: true })
    const docling = doclingClient()
    vi.spyOn(docling, "submitHybridChunk").mockResolvedValue(
      taskStatus("hybrid-task", "chunk")
    )
    vi.spyOn(docling, "waitForSuccess").mockResolvedValue(
      taskStatus("hybrid-task", "chunk")
    )
    vi.spyOn(docling, "getHybridChunkResult").mockResolvedValue(hybridChunks)

    const embedding = embeddingClient()
    let embedInvocation = 0
    const embed = vi.spyOn(embedding, "embed").mockImplementation(async () => {
      embedInvocation += 1
      return {
        requestId: `10000000-0000-4000-8000-00000000000${embedInvocation}`,
        model: "fixture",
        pricing: {
          input_price_per_million: "0",
          cached_input_price_per_million: "0",
          output_price_per_million: "0",
        },
        usage: {
          totalTokens: 20,
          inputTokens: 20,
          cachedInputTokens: 0,
          outputTokens: 0,
          reasoningOutputTokens: 0,
          measurementMethod: "estimated" as const,
        },
        vector: [0.6, 0.8],
        fullInputTokens: 20,
        configuredMaximumTokens: 8_192,
        attemptedPercentage: 90 as const,
        actualInputTokens: 20,
        truncated: false,
        attempt: 1,
        truncationStrategy: "context-head70-tail30-v1" as const,
      }
    })
    const usageRecorder = {
      recordModelUsage: vi.fn(async (capture: ModelUsageCapture) => {
        modelUsageCaptureSchema.parse(capture)
        return { recorded: true }
      }),
    }
    const elasticsearch = elasticsearchAdapter()
    const replaceDocumentVersion = vi
      .spyOn(elasticsearch, "replaceDocumentVersion")
      .mockResolvedValue(undefined)
    const verifyDocumentVersionCandidate = vi
      .spyOn(elasticsearch, "verifyDocumentVersionCandidate")
      .mockResolvedValue(undefined)
    const pipeline = processor({
      state,
      workspace,
      docling,
      embedding,
      elasticsearch,
      usageRecorder,
    })

    await expect(pipeline.process(job(), "chunking")).resolves.toBeUndefined()
    await expect(
      pipeline.process(job(), "image_understanding")
    ).resolves.toBeUndefined()
    await expect(pipeline.process(job(), "parenting")).resolves.toBeUndefined()
    await expect(pipeline.process(job(), "embedding")).resolves.toBeUndefined()
    await expect(pipeline.process(job(), "indexing")).resolves.toBeUndefined()

    expect(workspace.saveHybridChunks).toHaveBeenCalledWith(job(), hybridChunks)
    expect(workspace.saveRetrievalManifest).toHaveBeenCalledOnce()
    const manifest = vi.mocked(workspace.saveRetrievalManifest).mock
      .calls[0]![1]
    expect(manifest).toHaveLength(1)
    expect(manifest[0]).toMatchObject({
      titlePath: ["Policy"],
      pageNumbers: [1],
      childCount: 2,
      parentText: "# Policy\n\nFirst requirement.\n\nSecond requirement.",
    })
    expect(embed).toHaveBeenCalledTimes(2)
    expect(usageRecorder.recordModelUsage).toHaveBeenCalledTimes(2)
    expect(usageRecorder.recordModelUsage).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        ownerId: ids.actor,
        knowledgeBaseId: ids.knowledgeBase,
        documentId: ids.document,
        documentVersionId: ids.version,
        processingGeneration: ids.generation,
        operation: "upload",
        workload: "document_embedding",
        modelKind: "embedding",
        model: "fixture",
        measurementMethod: "estimated",
      })
    )
    const documentUsageCalls = usageRecorder.recordModelUsage.mock.calls.map(
      ([capture]) => capture
    )
    expect(
      documentUsageCalls.every(
        (capture) => modelUsageCaptureSchema.safeParse(capture).success
      )
    ).toBe(true)
    expect(documentUsageCalls[0]?.tokenUsage).toEqual({
      totalTokens: 20,
      inputTokens: 20,
      cachedInputTokens: 0,
      outputTokens: 0,
      reasoningOutputTokens: 0,
    })
    expect(documentUsageCalls[0]?.tokenUsage).not.toHaveProperty(
      "measurementMethod"
    )
    expect(embed).toHaveBeenNthCalledWith(
      1,
      { context: "", body: hybridChunks.chunks[0]!.text },
      undefined,
      8_192
    )
    expect(replaceDocumentVersion).toHaveBeenCalledOnce()
    const indexedParents = replaceDocumentVersion.mock.calls[0]![0].parents
    expect(indexedParents).toHaveLength(1)
    expect(indexedParents[0]).toMatchObject({
      childCount: 2,
      pageNumbers: [1],
      children: [
        expect.objectContaining({ order: 0, pageNumbers: [1] }),
        expect.objectContaining({ order: 1, pageNumbers: [1] }),
      ],
    })
    expect(verifyDocumentVersionCandidate).toHaveBeenCalledTimes(2)
    expect(verifyDocumentVersionCandidate).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        expectedParentCount: 1,
        expectedChildCount: 2,
      })
    )
    expect(verifyDocumentVersionCandidate).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        expectedParentCount: 1,
        expectedChildCount: 2,
      })
    )
  })

  it("keeps every BullMQ queue name free of a pipeline version suffix", async () => {
    const source = await readFile(
      new URL(
        "../src/modules/knowledge-processing/pipeline.ts",
        import.meta.url
      ),
      "utf8"
    )

    expect(source).toContain("return `linksense-knowledge-${stage}`")
    expect(source).not.toMatch(/linksense-knowledge-\$\{stage\}-v\d+/u)
  })

  it("enforces one active external task per generation and task kind", async () => {
    const migration = await readFile(
      new URL(
        "../../../prisma/migrations/20260724190000_rebuild_knowledge_processing/migration.sql",
        import.meta.url
      ),
      "utf8"
    )

    expect(migration).toMatch(
      /CREATE UNIQUE INDEX "kb_processing_attempts_one_active_key"[\s\S]+?"document_version_id", "processing_generation", "task_kind"[\s\S]+?WHERE "status" = 'active'/u
    )
  })
})

describe("knowledge index reconciliation", () => {
  it.each([1, 2])("cancels a scan of %i documents without advancing past cancelled work", async (documentCount) => {
    const coordinator = memoryReconciliationCoordinator()
    const close = vi.spyOn(coordinator, "close")
    const setCursor = vi.spyOn(coordinator, "setCursor")
    const reconcileActiveDocumentVersion = vi.fn<ElasticsearchKnowledgeAdapter["reconcileActiveDocumentVersion"]>(
      async (input) => new Promise<void>((resolve) => {
        input.signal?.addEventListener("abort", () => resolve(), { once: true })
      }),
    )
    const reconciler = new KnowledgeIndexActivationReconciler({
      source: {
        listDocumentIds: vi.fn(async () => ({ documentIds: [ids.document, "00000000-0000-4000-8000-000000000006"].slice(0, documentCount), exhausted: true })),
        resolveActiveVersion: vi.fn(async () => ({
          knowledgeBaseId: ids.knowledgeBase, documentId: ids.document,
          documentVersionId: ids.version, expectedParentCount: 1,
          expectedChildCount: 2, expectedEmbeddingProfileHash: "d".repeat(64),
          expectedIndexIntegrityDigest: "e".repeat(64),
        })),
      },
      coordinator, documentLock: immediateDocumentLock(),
      elasticsearch: { reconcileActiveDocumentVersion },
    })
    await reconciler.start()
    await vi.waitFor(() => expect(reconcileActiveDocumentVersion).toHaveBeenCalledOnce())
    const closing = reconciler.close()
    expect(reconcileActiveDocumentVersion.mock.calls[0]?.[0].signal?.aborted).toBe(true)
    await closing
    expect(reconcileActiveDocumentVersion).toHaveBeenCalledOnce()
    expect(close).toHaveBeenCalledOnce()
    expect(setCursor).not.toHaveBeenCalled()
  })

  it("starts without waiting for a sweep, coalesces ticks and drains work before closing", async () => {
    vi.useFakeTimers()
    let resolvePage: (value: { documentIds: string[]; exhausted: boolean }) => void = () => {}
    const page = {
      promise: new Promise<{ documentIds: string[]; exhausted: boolean }>((resolve) => { resolvePage = resolve }),
      resolve: (value: { documentIds: string[]; exhausted: boolean }) => resolvePage(value),
    }
    const coordinator = memoryReconciliationCoordinator()
    const close = vi.spyOn(coordinator, "close")
    const listDocumentIds = vi.fn(() => page.promise)
    const reconciler = new KnowledgeIndexActivationReconciler({
      source: { listDocumentIds, resolveActiveVersion: vi.fn(async () => null) },
      coordinator,
      documentLock: immediateDocumentLock(),
      elasticsearch: { reconcileActiveDocumentVersion: vi.fn(async () => undefined) },
    }, { intervalMs: 100 })
    try {
      let started = false
      void reconciler.start().then(() => { started = true })
      await vi.advanceTimersByTimeAsync(0)
      expect(started).toBe(true)
      await reconciler.start()
      await vi.advanceTimersByTimeAsync(300)
      expect(listDocumentIds).toHaveBeenCalledTimes(1)
      const closing = reconciler.close()
      expect(close).not.toHaveBeenCalled()
      page.resolve({ documentIds: [], exhausted: true })
      await closing
      expect(close).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(300)
      await reconciler.start()
      expect(listDocumentIds).toHaveBeenCalledTimes(1)
    } finally {
      page.resolve({ documentIds: [], exhausted: true })
      await reconciler.close()
      vi.useRealTimers()
    }
  })

  it("retries a failed background sweep on the next interval", async () => {
    vi.useFakeTimers()
    const listDocumentIds = vi.fn()
      .mockRejectedValueOnce(new Error("temporarily unavailable"))
      .mockResolvedValue({ documentIds: [], exhausted: true })
    const reconciler = new KnowledgeIndexActivationReconciler({
      source: { listDocumentIds, resolveActiveVersion: vi.fn(async () => null) },
      coordinator: memoryReconciliationCoordinator(),
      documentLock: immediateDocumentLock(),
      elasticsearch: { reconcileActiveDocumentVersion: vi.fn(async () => undefined) },
    }, { intervalMs: 100 })
    try {
      await reconciler.start()
      await vi.advanceTimersByTimeAsync(100)
      expect(listDocumentIds).toHaveBeenCalledTimes(2)
    } finally {
      await reconciler.close()
      vi.useRealTimers()
    }
  })

  it("loads the complete persisted candidate integrity contract", async () => {
    const findVersion = vi
      .fn()
      .mockResolvedValueOnce({
        id: ids.version,
        parentCount: 1,
        childCount: 2,
        embeddingProfileHash: "d".repeat(64),
        indexIntegrityDigest: "e".repeat(64),
      })
      .mockResolvedValueOnce({
        id: ids.version,
        parentCount: 1,
        childCount: null,
        embeddingProfileHash: "d".repeat(64),
        indexIntegrityDigest: "e".repeat(64),
      })
    const source = new PrismaKnowledgeIndexReconciliationSource({
      knowledgeBaseDocument: {
        findFirst: vi.fn(async () => ({
          id: ids.document,
          knowledgeBaseId: ids.knowledgeBase,
          currentVersionId: ids.version,
        })),
      },
      knowledgeBaseDocumentVersion: {
        findFirst: findVersion,
      },
    } as never)

    await expect(source.resolveActiveVersion(ids.document)).resolves.toEqual({
      knowledgeBaseId: ids.knowledgeBase,
      documentId: ids.document,
      documentVersionId: ids.version,
      expectedParentCount: 1,
      expectedChildCount: 2,
      expectedEmbeddingProfileHash: "d".repeat(64),
      expectedIndexIntegrityDigest: "e".repeat(64),
    })
    await expect(source.resolveActiveVersion(ids.document)).resolves.toBeNull()
  })

  it("reconciles searchable parents only after verifying child integrity", async () => {
    const coordinator = memoryReconciliationCoordinator()
    const reconcileActiveDocumentVersion = vi.fn(async () => undefined)
    const reconciler = new KnowledgeIndexActivationReconciler({
      source: {
        listDocumentIds: vi.fn(async () => ({
          documentIds: [ids.document],
          exhausted: true,
        })),
        resolveActiveVersion: vi.fn(async () => ({
          knowledgeBaseId: ids.knowledgeBase,
          documentId: ids.document,
          documentVersionId: ids.version,
          expectedParentCount: 1,
          expectedChildCount: 2,
          expectedEmbeddingProfileHash: "d".repeat(64),
          expectedIndexIntegrityDigest: "e".repeat(64),
        })),
      },
      coordinator,
      documentLock: immediateDocumentLock(),
      elasticsearch: { reconcileActiveDocumentVersion },
    })

    await expect(reconciler.runOnce()).resolves.toEqual({
      acquired: true,
      scanned: 1,
      reconciled: 1,
      failed: 0,
    })
    expect(reconcileActiveDocumentVersion).toHaveBeenCalledWith({
      knowledgeBaseId: ids.knowledgeBase,
      documentId: ids.document,
      activeDocumentVersionId: ids.version,
      expectedParentCount: 1,
      expectedChildCount: 2,
      expectedEmbeddingProfileHash: "d".repeat(64),
      expectedIndexIntegrityDigest: "e".repeat(64),
      signal: expect.any(AbortSignal),
    })
  })
})

function job(
  overrides: Partial<KnowledgeProcessingJob> = {}
): KnowledgeProcessingJob {
  return {
    operation: "upload",
    knowledgeBaseId: ids.knowledgeBase,
    documentId: ids.document,
    documentVersionId: ids.version,
    processingGeneration: ids.generation,
    requestedBy: ids.actor,
    sourceFormat: "pdf",
    ocrEnabled: false,
    startStage: "parsing",
    parserConfigDigest: "a".repeat(64),
    chunking: {
      tokenizer: "/models/tokenizers/Qwen3-Embedding-4B",
      childMaxTokens: 768,
      parentMaxTokens: 3_000,
      embeddingMaxInputTokens: 8_192,
      configDigest: "c".repeat(64),
    },
    imageUnderstanding: createImageUnderstandingSnapshot(null),
    embeddingProfileHash: "d".repeat(64),
    ...overrides,
  }
}

function externalTaskRecoveryFixture(
  kind: KnowledgeExternalTaskKind,
  options: {
    waitError?: KnowledgeProcessingError
  } = {}
) {
  const state = stateStore({
    activeTasks: new Map([
      [
        kind,
        {
          taskId: `expired-${kind}`,
          attemptNo: 1,
        },
      ],
    ]),
  })
  const workspace = memoryWorkspace()
  const docling = doclingClient()
  const submit =
    kind === "convert"
      ? vi
          .spyOn(docling, "submitConversion")
          .mockResolvedValue(taskStatus(`replacement-${kind}`, "convert"))
      : vi
          .spyOn(docling, "submitHybridChunk")
          .mockResolvedValue(taskStatus(`replacement-${kind}`, "chunk"))
  vi.spyOn(docling, "waitForSuccess").mockRejectedValue(
    options.waitError ??
      new KnowledgeProcessingError("KNOWLEDGE_DOCLING_TASK_NOT_FOUND")
  )

  return {
    processor: processor({ state, workspace, docling }),
    state,
    workspace,
    submit,
    activeTask: (taskKind: KnowledgeExternalTaskKind) =>
      state.activeTasks.get(taskKind) ?? null,
  }
}

function stateStore(
  options: {
    activeTasks?: Map<
      KnowledgeExternalTaskKind,
      { taskId: string; attemptNo: number }
    >
  } = {}
): KnowledgePipelineStateStore & {
  activeTasks: Map<
    KnowledgeExternalTaskKind,
    { taskId: string; attemptNo: number }
  >
} {
  const activeTasks = options.activeTasks ?? new Map()
  const nextAttempt = new Map<KnowledgeExternalTaskKind, number>()
  for (const [kind, task] of activeTasks) {
    nextAttempt.set(kind, task.attemptNo + 1)
  }

  return {
    activeTasks,
    isCurrentGeneration: vi.fn(async () => true),
    isCancellationRequested: vi.fn(async () => false),
    requestCancellation: vi.fn(async () => undefined),
    transition: vi.fn(async () => undefined),
    getActiveExternalTask: vi.fn(async (_job, kind) => {
      return activeTasks.get(kind) ?? null
    }),
    recordExternalTask: vi.fn(async (_job, kind, taskId) => {
      const task = {
        taskId,
        attemptNo: nextAttempt.get(kind) ?? 1,
      }
      activeTasks.set(kind, task)
      nextAttempt.set(kind, task.attemptNo + 1)
      return task
    }),
    discardExternalTask: vi.fn(async (_job, kind, taskId) => {
      if (activeTasks.get(kind)?.taskId !== taskId) return false
      activeTasks.delete(kind)
      return true
    }),
    completeExternalTask: vi.fn(async (_job, kind, taskId) => {
      if (activeTasks.get(kind)?.taskId !== taskId) return false
      activeTasks.delete(kind)
      return true
    }),
    markFailed: vi.fn(async () => undefined),
    recordRetry: vi.fn(async () => undefined),
  }
}

function memoryWorkspace(
  options: {
    parsed?: boolean
  } = {}
): KnowledgePipelineWorkspace {
  let parsed = options.parsed ?? false
  let chunks: HybridChunkResult | null = null
  let imageProjection: {
    filename: string
    configDigest: string
    images: []
    chunks: HybridChunkResult["chunks"]
  } | null = null
  let manifest: BuiltKnowledgeParent[] | null = null
  let checkpoint: {
    parentCount: number
    childCount: number
    embeddingProfileHash: string
    indexIntegrityDigest: string
  } | null = null

  return {
    openDoclingSource: vi.fn(async () => ({
      filename: "policy.pdf",
      contentType: "application/pdf",
      openStream: async () => Readable.from(Buffer.from("fixture")),
    })),
    getOriginalSha256: vi.fn(async () => "e".repeat(64)),
    hasParsedArtifacts: vi.fn(async () => parsed),
    saveParsedArtifacts: vi.fn(async () => {
      parsed = true
      return pipelineCheckpoint("parsed")
    }),
    loadDoclingJson: vi.fn(async () => ({
      filename: "policy.json",
      jsonBytes: Buffer.from(
        JSON.stringify({
          schema_name: "DoclingDocument",
          version: "1.10.0",
          name: "policy",
          origin: {
            mimetype: "application/pdf",
            binary_hash: 1,
            filename: "policy.pdf",
          },
          furniture: { self_ref: "#/furniture", children: [], name: "_root_" },
          body: { self_ref: "#/body", children: [], name: "_root_" },
          groups: [],
          texts: [],
          pictures: [],
          tables: [],
          key_value_items: [],
          form_items: [],
          pages: {},
        })
      ),
    })),
    hasHybridChunks: vi.fn(async () => chunks !== null),
    saveHybridChunks: vi.fn(async (_job, value) => {
      chunks = value
      return pipelineCheckpoint("chunks")
    }),
    loadHybridChunks: vi.fn(async () => {
      if (chunks === null) throw new Error("hybrid chunks are unavailable")
      return chunks
    }),
    hasImageProjection: vi.fn(async () => imageProjection !== null),
    loadImageAssets: vi.fn(async () => []),
    saveImageProjection: vi.fn(async (_job, value) => {
      imageProjection = value
      return pipelineCheckpoint("image-projection")
    }),
    loadImageProjection: vi.fn(async () => {
      if (imageProjection === null) {
        throw new Error("image projection is unavailable")
      }
      return imageProjection
    }),
    hasRetrievalManifest: vi.fn(async () => manifest !== null),
    saveRetrievalManifest: vi.fn(async (_job, value) => {
      manifest = [...value]
      return pipelineCheckpoint("manifest")
    }),
    loadRetrievalManifest: vi.fn(async () => {
      if (manifest === null)
        throw new Error("retrieval manifest is unavailable")
      return manifest
    }),
    saveEmbeddedIndexCheckpoint: vi.fn(
      async (
        _job: KnowledgeProcessingJob,
        parents: readonly IndexedParentDocument[]
      ) => {
        checkpoint = {
          parentCount: parents.length,
          childCount: parents.reduce(
            (total, parent) => total + parent.childCount,
            0
          ),
          embeddingProfileHash: job().embeddingProfileHash,
          indexIntegrityDigest: indexIntegrityDigest(parents),
        }
        return pipelineCheckpoint("index")
      }
    ),
    readCandidateIndexCheckpoint: vi.fn(async () => {
      if (checkpoint === null)
        throw new Error("index checkpoint is unavailable")
      return checkpoint
    }),
    prepareActivation: vi.fn(async () => {
      if (checkpoint === null)
        throw new Error("index checkpoint is unavailable")
      return checkpoint
    }),
    finalizeActivation: vi.fn(async () => undefined),
  }
}

function processor(input: {
  state: KnowledgePipelineStateStore
  workspace: KnowledgePipelineWorkspace
  docling?: DoclingServeClient
  embedding?: EmbeddingClient
  elasticsearch?: ElasticsearchKnowledgeAdapter
  usageRecorder?: ModelUsageRecorder
  officeConverter?: KnowledgeOfficeDocumentConverter
}): KnowledgePipelineProcessor {
  return new KnowledgePipelineProcessor({
    state: input.state,
    workspace: input.workspace,
    docling: input.docling ?? doclingClient(),
    embedding: {
      resolveEmbedding: vi.fn(async () => input.embedding ?? embeddingClient()),
    },
    elasticsearch: input.elasticsearch ?? elasticsearchAdapter(),
    indexingExecutor: {
      run: async ({ operation, signal }) =>
        operation(signal ?? new AbortController().signal),
      close: vi.fn(async () => undefined),
    },
    documentLock: immediateDocumentLock(),
    doclingTimeoutSeconds: 1_800,
    imageUnderstandingClient: {
      probe: vi.fn(async () => undefined),
      describe: vi.fn(async () => {
        throw new Error("disabled image understanding must not be called")
      }),
    },
    imageUnderstandingSettings: {
      getSnapshot: vi.fn(async () => createImageUnderstandingSnapshot(null)),
      resolveRuntime: vi.fn(async () => null),
    },
    imageUnderstandingConcurrency: 1,
    ...(input.officeConverter
      ? { officeConverter: input.officeConverter }
      : {}),
    ...(input.usageRecorder ? { usageRecorder: input.usageRecorder } : {}),
  })
}

function doclingClient(): DoclingServeClient {
  return new DoclingServeClient({
    baseUrl: "https://docling.example.test",
    apiKey: "docling-key",
    tenantId: "linksense",
    pollIntervalMs: 1,
  })
}

function embeddingClient(): EmbeddingClient {
  return new EmbeddingClient({
    baseUrl: "https://embedding.example.test",
    model: "fixture",
    dimensions: 2,
    maximumInputTokens: 8_192,
  })
}

function elasticsearchAdapter(): ElasticsearchKnowledgeAdapter {
  return new ElasticsearchKnowledgeAdapter({
    url: "https://elasticsearch.example.test",
    username: "elastic",
    password: "secret",
    index: "knowledge",
    dimensions: 2,
  })
}

function immediateDocumentLock(): KnowledgeDocumentLock {
  return {
    async runExclusive<T>(
      _documentId: string,
      operation: (signal: AbortSignal) => Promise<T>,
      signal?: AbortSignal
    ): Promise<T> {
      return operation(signal ?? new AbortController().signal)
    },
    close: vi.fn(async () => undefined),
  }
}

function memoryReconciliationCoordinator(): KnowledgeIndexReconciliationCoordinator {
  let cursor: string | null = null
  return {
    async tryRunExclusive<T>(operation: (signal: AbortSignal) => Promise<T>) {
      return {
        acquired: true as const,
        value: await operation(new AbortController().signal),
      }
    },
    getCursor: async () => cursor,
    setCursor: async (value) => {
      cursor = value
    },
    close: vi.fn(async () => undefined),
  }
}

function taskStatus(taskId: string, taskType: "convert" | "chunk") {
  return {
    task_id: taskId,
    task_type: taskType,
    task_status: "started" as const,
    task_position: null,
    task_meta: {
      num_docs: 1,
      num_processed: 0,
      num_succeeded: 0,
      num_partially_succeeded: 0,
      num_failed: 0,
    },
    error_message: null,
    failure: null,
  }
}

function pipelineCheckpoint(label: string) {
  return {
    configDigest: "f".repeat(64),
    outputHash: Buffer.from(label).toString("hex").padEnd(64, "0"),
    completedAt: new Date("2026-07-24T00:00:00.000Z"),
  }
}
