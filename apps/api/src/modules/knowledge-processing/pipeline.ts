import { createHash, randomUUID } from "node:crypto";

import type { ConnectionOptions, Job } from "bullmq";
import { Queue, UnrecoverableError, Worker } from "bullmq";
import { Redis } from "ioredis";
import { z } from "zod";
import { imageUnderstandingSnapshotSchema } from "@linksense/shared";

import { containsControlCharacter } from "../../lib/text.js";
import type { KnowledgeProcessingCommand } from "../knowledge/types.js";
import type { KnowledgeMaintenanceRebuildResult } from "../knowledge/maintenance.js";
import type { KnowledgeMaintenanceGate } from "../knowledge/maintenance.js";
import type { DoclingInputFile, DoclingServeClient } from "./docling.js";
import { extractDoclingArchive } from "./docling.js";
import {
  type HybridChunkResult,
  validateDoclingJsonBytes,
} from "./docling-hybrid.js";
import {
  ingestDoclingArchive,
  type IngestedDoclingArchive,
} from "./docling-ingestion.js";
import type {
  ElasticsearchKnowledgeAdapter,
  IndexedParentDocument,
} from "./elasticsearch.js";
import { indexIntegrityDigest } from "./elasticsearch.js";
import type { KnowledgeEmbeddingClientResolver } from "./knowledge-model-runtime.js";
import {
  KnowledgeProcessingError,
  isKnowledgeProcessingError,
} from "./errors.js";
import {
  buildKnowledgeParents,
  type BuiltKnowledgeParent,
} from "./parent-builder.js";
import type {
  ImageProjection,
  ImageProjectionAsset,
} from "./image-projection.js";
import { buildImageProjection } from "./image-projection.js";
import type { ImageUnderstandingClient } from "./image-understanding-client.js";
import type { ImageUnderstandingSettingsReader } from "../system/image-understanding-settings.js";
import type { KnowledgeOfficeDocumentConverter } from "./office-converter.js";
import {
  projectMeasuredModelTokenUsage,
  type ModelUsageRecorder,
} from "../usage/model-usage.js";

export const knowledgeProcessingStageSchema = z.enum([
  "parsing",
  "chunking",
  "image_understanding",
  "parenting",
  "embedding",
  "indexing",
  "activating",
]);

export type KnowledgeProcessingStage = z.infer<
  typeof knowledgeProcessingStageSchema
>;

const processingJobSchema = z
  .strictObject({
    operation: z.enum([
      "upload",
      "replace",
      "retry",
      "reprocess",
      "rebuild_index",
    ]),
    knowledgeBaseId: z.string().uuid(),
    documentId: z.string().uuid(),
    documentVersionId: z.string().uuid(),
    processingGeneration: z.string().uuid(),
    requestedBy: z.string().uuid(),
    sourceFormat: z.string().trim().min(1).max(16),
    ocrEnabled: z.boolean().default(false),
    startStage: knowledgeProcessingStageSchema,
    parserConfigDigest: z.string().regex(/^[a-f0-9]{64}$/u),
    chunking: z.strictObject({
      tokenizer: z
        .string()
        .trim()
        .min(1)
        .max(1_024)
        .refine((value) => !containsControlCharacter(value)),
      childMaxTokens: z.number().int().positive().max(8_192),
      parentMaxTokens: z.number().int().positive(),
      embeddingMaxInputTokens: z.number().int().positive(),
      configDigest: z.string().regex(/^[a-f0-9]{64}$/u),
    }),
    imageUnderstanding: imageUnderstandingSnapshotSchema,
    embeddingProfileHash: z.string().regex(/^[a-f0-9]{64}$/u),
  })
  .superRefine((job, context) => {
    if (
      job.chunking.childMaxTokens >= job.chunking.embeddingMaxInputTokens ||
      job.chunking.childMaxTokens > job.chunking.parentMaxTokens
    ) {
      context.addIssue({
        code: "custom",
        path: ["chunking", "childMaxTokens"],
        message: "child token budget must fit parent and embedding budgets",
      });
    }
  });

export type KnowledgeProcessingJob = z.infer<typeof processingJobSchema>;
const persistedProcessingJobSchema = processingJobSchema;

const processingJobIdentitySchema = z.object({
  knowledgeBaseId: z.string().uuid(),
  documentId: z.string().uuid(),
  documentVersionId: z.string().uuid(),
  processingGeneration: z.string().uuid(),
});

export type KnowledgeProcessingJobIdentity = z.infer<
  typeof processingJobIdentitySchema
>;

export const KNOWLEDGE_PROCESSING_MAX_ATTEMPTS = 3;

const BULLMQ_STARTED_ATTEMPT_LIMIT_REASON =
  "job started more than allowable limit";
const BULLMQ_STALLED_ATTEMPT_LIMIT_REASON =
  "job stalled more than allowable limit";
const OUTER_FAILURE_RECOVERY_PAGE_SIZE = 100;
const PERSISTED_JOB_RECOVERY_STATES = [
  "waiting",
  "delayed",
  "prioritized",
  "waiting-children",
  "paused",
  "completed",
  "failed",
] as const;

export type KnowledgePipelineCheckpoint = {
  configDigest: string;
  outputHash: string;
  completedAt: Date;
};

export type KnowledgeExternalTaskKind = "convert" | "hybrid_chunk";

export interface KnowledgePipelineStateStore {
  isCurrentGeneration(job: KnowledgeProcessingJob): Promise<boolean>;
  isCancellationRequested(job: KnowledgeProcessingJob): Promise<boolean>;
  requestCancellation(job: KnowledgeProcessingJob): Promise<void>;
  transition(input: {
    job: KnowledgeProcessingJob;
    stage: KnowledgeProcessingStage;
    progress: number;
    retryAt?: Date;
  }): Promise<void>;
  getActiveExternalTask(
    job: KnowledgeProcessingJob,
    kind: KnowledgeExternalTaskKind,
  ): Promise<{ taskId: string; attemptNo: number } | null>;
  recordExternalTask(
    job: KnowledgeProcessingJob,
    kind: KnowledgeExternalTaskKind,
    taskId: string,
  ): Promise<{ taskId: string; attemptNo: number }>;
  discardExternalTask(
    job: KnowledgeProcessingJob,
    kind: KnowledgeExternalTaskKind,
    taskId: string,
  ): Promise<boolean>;
  completeExternalTask(
    job: KnowledgeProcessingJob,
    kind: KnowledgeExternalTaskKind,
    taskId: string,
  ): Promise<boolean>;
  markFailed(input: {
    job: KnowledgeProcessingJobIdentity;
    stage: KnowledgeProcessingStage;
    errorCode: string;
  }): Promise<void>;
  recordRetry(input: {
    job: KnowledgeProcessingJob;
    stage: KnowledgeProcessingStage;
    attempt: number;
    retryAt: Date;
  }): Promise<void>;
}

export interface KnowledgePipelineWorkspace {
  openDoclingSource(job: KnowledgeProcessingJob): Promise<DoclingInputFile>;
  getOriginalSha256(job: KnowledgeProcessingJob): Promise<string>;
  hasParsedArtifacts(job: KnowledgeProcessingJob): Promise<boolean>;
  saveParsedArtifacts(input: {
    job: KnowledgeProcessingJob;
    result: IngestedDoclingArchive;
  }): Promise<KnowledgePipelineCheckpoint>;
  loadDoclingJson(job: KnowledgeProcessingJob): Promise<{
    filename: string;
    jsonBytes: Buffer;
  }>;
  hasHybridChunks(job: KnowledgeProcessingJob): Promise<boolean>;
  saveHybridChunks(
    job: KnowledgeProcessingJob,
    result: HybridChunkResult,
  ): Promise<KnowledgePipelineCheckpoint>;
  loadHybridChunks(job: KnowledgeProcessingJob): Promise<HybridChunkResult>;
  hasImageProjection(job: KnowledgeProcessingJob): Promise<boolean>;
  loadImageAssets(job: KnowledgeProcessingJob): Promise<ImageProjectionAsset[]>;
  saveImageProjection(
    job: KnowledgeProcessingJob,
    projection: ImageProjection,
  ): Promise<KnowledgePipelineCheckpoint>;
  loadImageProjection(job: KnowledgeProcessingJob): Promise<ImageProjection>;
  hasRetrievalManifest(job: KnowledgeProcessingJob): Promise<boolean>;
  saveRetrievalManifest(
    job: KnowledgeProcessingJob,
    parents: readonly BuiltKnowledgeParent[],
  ): Promise<KnowledgePipelineCheckpoint>;
  loadRetrievalManifest(
    job: KnowledgeProcessingJob,
  ): Promise<BuiltKnowledgeParent[]>;
  saveEmbeddedIndexCheckpoint(
    job: KnowledgeProcessingJob,
    parents: readonly IndexedParentDocument[],
  ): Promise<KnowledgePipelineCheckpoint>;
  readCandidateIndexCheckpoint(job: KnowledgeProcessingJob): Promise<{
    parentCount: number;
    childCount: number;
    embeddingProfileHash: string;
    indexIntegrityDigest: string;
  }>;
  prepareActivation(job: KnowledgeProcessingJob): Promise<{
    parentCount: number;
    childCount: number;
    embeddingProfileHash: string;
    indexIntegrityDigest: string;
  }>;
  finalizeActivation(job: KnowledgeProcessingJob): Promise<void>;
}

export interface KnowledgeProcessingJobFactory {
  create(command: KnowledgeProcessingCommand): Promise<KnowledgeProcessingJob>;
}

export class KnowledgePipelineProcessor {
  constructor(
    private readonly dependencies: {
      state: KnowledgePipelineStateStore;
      workspace: KnowledgePipelineWorkspace;
      docling: DoclingServeClient;
      embedding: KnowledgeEmbeddingClientResolver;
      elasticsearch: ElasticsearchKnowledgeAdapter;
      indexingExecutor: KnowledgeIndexingExecutor;
      documentLock: KnowledgeDocumentLock;
      imageUnderstandingClient: ImageUnderstandingClient;
      imageUnderstandingSettings: ImageUnderstandingSettingsReader;
      imageUnderstandingConcurrency: number;
      doclingTimeoutSeconds: number;
      officeConverter?: KnowledgeOfficeDocumentConverter;
      usageRecorder?: ModelUsageRecorder;
      onActivationCommitted?: (job: KnowledgeProcessingJob) => Promise<void>;
    },
  ) {}

  async process(
    job: KnowledgeProcessingJob,
    stage: KnowledgeProcessingStage,
    signal?: AbortSignal,
  ): Promise<void> {
    await this.assertCanContinue(job, signal);
    let completedDuringStage = false;
    switch (stage) {
      case "parsing":
        await this.parse(job, signal);
        break;
      case "chunking":
        await this.chunk(job, signal);
        break;
      case "image_understanding":
        await this.projectImages(job, signal);
        break;
      case "parenting":
        await this.parent(job, signal);
        break;
      case "embedding":
        completedDuringStage = await this.embed(job, signal);
        break;
      case "indexing":
        await this.index(job);
        break;
      case "activating":
        await this.dependencies.documentLock.runExclusive(
          job.documentId,
          async (lockSignal) => {
            await this.assertCanContinue(job, lockSignal);
            await this.activate(job);
          },
          signal,
        );
        break;
    }
    await this.assertCanContinue(
      job,
      signal,
      stage === "activating" || completedDuringStage,
    );
  }

  /**
   * Rebuilds one current document from its immutable retrieval manifest while
   * the normal queues are globally paused. It never calls Docling or mutates
   * the user-visible processing lifecycle.
   */
  async rebuildForMaintenance(
    job: KnowledgeProcessingJob,
    signal?: AbortSignal,
  ): Promise<KnowledgeMaintenanceRebuildResult> {
    if (signal?.aborted) {
      throw new KnowledgeProcessingError("KNOWLEDGE_PROCESSING_CANCELLED");
    }
    const manifest =
      await this.dependencies.workspace.loadRetrievalManifest(job);
    const parents = await this.createEmbeddedParents(
      job,
      manifest,
      signal,
      false,
      false,
    );
    await this.dependencies.documentLock.runExclusive(
      job.documentId,
      (lockSignal) => this.replaceMaintenanceIndex(job, parents, lockSignal),
      signal,
    );
    return {
      embeddingProfileHash: job.embeddingProfileHash,
      chunkingConfigDigest: job.chunking.configDigest,
      retrievalManifestSha256: createRetrievalManifestDigest(manifest),
      indexIntegrityDigest: indexIntegrityDigest(parents),
      parentCount: parents.length,
      childCount: parents.reduce(
        (total, parent) => total + parent.childCount,
        0,
      ),
    };
  }

  private async parse(
    job: KnowledgeProcessingJob,
    signal?: AbortSignal,
  ): Promise<void> {
    await this.dependencies.state.transition({
      job,
      stage: "parsing",
      progress: 25,
    });
    if (await this.dependencies.workspace.hasParsedArtifacts(job)) {
      await this.completeCheckpointedExternalTask(job, "convert", signal);
      await this.dependencies.state.transition({
        job,
        stage: "parsing",
        progress: 50,
      });
      return;
    }
    const taskId = await this.ensureExternalTask(job, "convert", signal);
    let extracted: Awaited<ReturnType<typeof extractDoclingArchive>> | null =
      null;
    try {
      await this.waitForExternalTask(job, taskId, signal);
      const conversion = await this.dependencies.docling.getConversionResult(
        taskId,
        signal,
      );
      if (conversion.kind !== "archive") throw invalidDoclingResult();
      extracted = await extractDoclingArchive(conversion.stream);
      const result = await ingestDoclingArchive({
        extracted,
        originalSha256:
          await this.dependencies.workspace.getOriginalSha256(job),
      });
      await this.dependencies.workspace.saveParsedArtifacts({ job, result });
      if (
        !(await this.dependencies.state.completeExternalTask(
          job,
          "convert",
          taskId,
        ))
      ) {
        throw new KnowledgeProcessingError("KNOWLEDGE_PROCESSING_CANCELLED");
      }
    } catch (error) {
      await this.discardUnusableExternalTask(job, "convert", taskId, error);
      throw retryableMissingDoclingTask(error);
    } finally {
      await extracted?.cleanup();
    }
    await this.dependencies.state.transition({
      job,
      stage: "parsing",
      progress: 50,
    });
  }

  private async chunk(
    job: KnowledgeProcessingJob,
    signal?: AbortSignal,
  ): Promise<void> {
    await this.dependencies.state.transition({
      job,
      stage: "chunking",
      progress: 50,
    });
    if (await this.dependencies.workspace.hasHybridChunks(job)) {
      await this.completeCheckpointedExternalTask(job, "hybrid_chunk", signal);
      await this.dependencies.state.transition({
        job,
        stage: "chunking",
        progress: 60,
      });
      return;
    }
    const taskId = await this.ensureExternalTask(job, "hybrid_chunk", signal);
    try {
      await this.waitForExternalTask(job, taskId, signal);
      const result = await this.dependencies.docling.getHybridChunkResult(
        taskId,
        { maxTokens: job.chunking.childMaxTokens },
        signal,
      );
      await this.dependencies.workspace.saveHybridChunks(job, result);
      if (
        !(await this.dependencies.state.completeExternalTask(
          job,
          "hybrid_chunk",
          taskId,
        ))
      ) {
        throw new KnowledgeProcessingError("KNOWLEDGE_PROCESSING_CANCELLED");
      }
    } catch (error) {
      await this.discardUnusableExternalTask(
        job,
        "hybrid_chunk",
        taskId,
        error,
      );
      throw retryableMissingDoclingTask(error);
    }
    await this.dependencies.state.transition({
      job,
      stage: "chunking",
      progress: 60,
    });
  }

  private async completeCheckpointedExternalTask(
    job: KnowledgeProcessingJob,
    kind: KnowledgeExternalTaskKind,
    signal?: AbortSignal,
  ): Promise<void> {
    await this.dependencies.documentLock.runExclusive(
      job.documentId,
      async (lockSignal) => {
        await this.assertCanContinue(job, lockSignal);
        const active = await this.dependencies.state.getActiveExternalTask(
          job,
          kind,
        );
        if (active === null) return;
        const completed = await this.dependencies.state.completeExternalTask(
          job,
          kind,
          active.taskId,
        );
        if (!completed) {
          await this.assertCanContinue(job, lockSignal);
          throw new KnowledgeProcessingError(
            "KNOWLEDGE_DOCUMENT_STRUCTURE_INVALID",
          );
        }
      },
      signal,
    );
  }

  private async projectImages(
    job: KnowledgeProcessingJob,
    signal?: AbortSignal,
  ): Promise<void> {
    const assets = await this.dependencies.workspace.loadImageAssets(job);
    const shouldUnderstand =
      job.imageUnderstanding.enabled && assets.length > 0;
    if (shouldUnderstand) {
      await this.dependencies.state.transition({
        job,
        stage: "image_understanding",
        progress: 60,
      });
    }
    if (await this.dependencies.workspace.hasImageProjection(job)) {
      if (shouldUnderstand) {
        await this.dependencies.state.transition({
          job,
          stage: "image_understanding",
          progress: 70,
        });
      }
      return;
    }
    const [{ filename, jsonBytes }, hybrid, originalSha256, runtime] =
      await Promise.all([
        this.dependencies.workspace.loadDoclingJson(job),
        this.dependencies.workspace.loadHybridChunks(job),
        this.dependencies.workspace.getOriginalSha256(job),
        shouldUnderstand
          ? this.dependencies.imageUnderstandingSettings.resolveRuntime(
              job.imageUnderstanding,
            )
          : Promise.resolve(null),
      ]);
    const projection = await buildImageProjection({
      filename,
      doclingJson: validateDoclingJsonBytes(jsonBytes),
      originalSha256,
      hybrid,
      assets,
      snapshot: job.imageUnderstanding,
      runtime,
      client: this.dependencies.imageUnderstandingClient,
      concurrency: this.dependencies.imageUnderstandingConcurrency,
      projectionMaximumTokens: Math.min(
        job.chunking.parentMaxTokens,
        job.chunking.embeddingMaxInputTokens,
      ),
      ...(signal ? { signal } : {}),
      ...(shouldUnderstand
        ? {
            onProgress: async (completed: number, total: number) => {
              await this.assertCanContinue(job, signal);
              await this.dependencies.state.transition({
                job,
                stage: "image_understanding",
                progress: Math.min(
                  70,
                  60 + Math.floor((completed / Math.max(total, 1)) * 10),
                ),
              });
            },
          }
        : {}),
    });
    await this.dependencies.documentLock.runExclusive(
      job.documentId,
      async (lockSignal) => {
        await this.assertCanContinue(job, lockSignal);
        await this.dependencies.workspace.saveImageProjection(job, projection);
      },
      signal,
    );
    if (shouldUnderstand) {
      await this.dependencies.state.transition({
        job,
        stage: "image_understanding",
        progress: 70,
      });
    }
  }

  private async ensureExternalTask(
    job: KnowledgeProcessingJob,
    kind: KnowledgeExternalTaskKind,
    signal?: AbortSignal,
  ): Promise<string> {
    return this.dependencies.documentLock.runExclusive(
      job.documentId,
      async (lockSignal) => {
        await this.assertCanContinue(job, lockSignal);
        const existingTaskId =
          await this.dependencies.state.getActiveExternalTask(job, kind);
        if (existingTaskId !== null) return existingTaskId.taskId;
        return this.submitExternalTask(job, kind, lockSignal);
      },
      signal,
    );
  }

  private async submitExternalTask(
    job: KnowledgeProcessingJob,
    kind: KnowledgeExternalTaskKind,
    signal?: AbortSignal,
  ): Promise<string> {
    const submitted =
      kind === "convert"
        ? await this.submitDoclingConversion(job, signal)
        : await this.dependencies.docling.submitHybridChunk(
            await this.dependencies.workspace
              .loadDoclingJson(job)
              .then((source) => ({
                filename: source.filename,
                json: source.jsonBytes,
                options: {
                  tokenizer: job.chunking.tokenizer,
                  maxTokens: job.chunking.childMaxTokens,
                  mergePeers: false,
                  includeRawText: true,
                },
              })),
            signal,
          );
    await this.dependencies.state.recordExternalTask(
      job,
      kind,
      submitted.task_id,
    );
    return submitted.task_id;
  }

  private async submitDoclingConversion(
    job: KnowledgeProcessingJob,
    signal?: AbortSignal,
  ) {
    const original = await this.dependencies.workspace.openDoclingSource(job)
    const prepared = this.dependencies.officeConverter
      ? await this.dependencies.officeConverter.prepare({
          source: original,
          sourceFormat: job.sourceFormat,
          ...(signal ? { signal } : {}),
        })
      : {
          ...original,
          dispose: async () => undefined,
        }
    try {
      return await this.dependencies.docling.submitConversion(
        prepared,
        {
          documentTimeoutSeconds: this.dependencies.doclingTimeoutSeconds,
          ocrEnabled: job.ocrEnabled,
        },
        signal,
      )
    } finally {
      await prepared.dispose()
    }
  }

  private waitForExternalTask(
    job: KnowledgeProcessingJob,
    taskId: string,
    signal?: AbortSignal,
  ) {
    return this.dependencies.docling.waitForSuccess({
      taskId,
      deadlineEpochMs:
        Date.now() + (this.dependencies.doclingTimeoutSeconds + 60) * 1_000,
      ...(signal ? { signal } : {}),
      continueCheck: async () =>
        (await this.dependencies.state.isCurrentGeneration(job)) &&
        !(await this.dependencies.state.isCancellationRequested(job)),
    });
  }

  private async discardUnusableExternalTask(
    job: KnowledgeProcessingJob,
    kind: KnowledgeExternalTaskKind,
    taskId: string,
    error: unknown,
  ): Promise<void> {
    if (!isDiscardableDoclingResult(error)) return;
    await this.dependencies.state.discardExternalTask(job, kind, taskId);
  }

  private async parent(
    job: KnowledgeProcessingJob,
    signal?: AbortSignal,
  ): Promise<void> {
    await this.dependencies.state.transition({
      job,
      stage: "parenting",
      progress: 70,
    });
    if (await this.dependencies.workspace.hasRetrievalManifest(job)) {
      await this.dependencies.state.transition({
        job,
        stage: "parenting",
        progress: 75,
      });
      return;
    }
    const chunks = await this.dependencies.workspace.loadImageProjection(job);
    const parents = buildKnowledgeParents(
      chunks.chunks.map((chunk) => ({
        chunkIndex: chunk.chunkIndex,
        text: chunk.text,
        rawText: chunk.rawText,
        numTokens: chunk.numTokens,
        headings: chunk.headings,
        captions: chunk.captions,
        docItems: chunk.docItems,
        pageNumbers: chunk.pageNumbers,
      })),
      {
        documentVersionId: job.documentVersionId,
        maximumTokens: job.chunking.parentMaxTokens,
      },
    );
    await this.dependencies.documentLock.runExclusive(
      job.documentId,
      async (lockSignal) => {
        await this.assertCanContinue(job, lockSignal);
        await this.dependencies.workspace.saveRetrievalManifest(job, parents);
      },
      signal,
    );
    await this.dependencies.state.transition({
      job,
      stage: "parenting",
      progress: 75,
    });
  }

  private async embed(
    job: KnowledgeProcessingJob,
    signal?: AbortSignal,
  ): Promise<boolean> {
    await this.dependencies.state.transition({
      job,
      stage: "embedding",
      progress: 75,
    });
    const manifest =
      await this.dependencies.workspace.loadRetrievalManifest(job);
    const parents = await this.createEmbeddedParents(job, manifest, signal);
    await this.dependencies.state.transition({
      job,
      stage: "embedding",
      progress: 92,
    });
    const wholeDocument =
      indexReplacementScope(job.operation) === "whole_document";
    await this.writeCandidateIndex(job, parents, signal);
    return wholeDocument;
  }

  private async createEmbeddedParents(
    job: KnowledgeProcessingJob,
    manifest: readonly BuiltKnowledgeParent[],
    signal?: AbortSignal,
    reportProgress = true,
    validateGeneration = true,
  ): Promise<IndexedParentDocument[]> {
    const childCount = manifest.reduce(
      (total, parent) => total + parent.childCount,
      0,
    );
    if (childCount === 0) {
      throw new KnowledgeProcessingError("KNOWLEDGE_DOCUMENT_COVERAGE_INVALID");
    }
    let completed = 0;
    const parents: IndexedParentDocument[] = [];
    const embedding = await this.dependencies.embedding.resolveEmbedding(
      job.embeddingProfileHash,
    );
    for (const parent of manifest) {
      const children: IndexedParentDocument["children"] = [];
      for (const child of parent.children) {
        if (validateGeneration) {
          await this.assertCanContinue(job, signal);
        } else if (signal?.aborted) {
          throw new KnowledgeProcessingError("KNOWLEDGE_PROCESSING_CANCELLED");
        }
        const result = await embedding.embed(
          { context: "", body: child.text },
          signal,
          job.chunking.embeddingMaxInputTokens,
        );
        if (this.dependencies.usageRecorder) {
          await this.dependencies.usageRecorder.recordModelUsage({
            requestId: result.requestId,
            ownerId: job.requestedBy,
            knowledgeBaseId: job.knowledgeBaseId,
            documentId: job.documentId,
            documentVersionId: job.documentVersionId,
            processingGeneration: job.processingGeneration,
            operation: job.operation,
            workload: "document_embedding",
            modelKind: "embedding",
            model: result.model,
            ...projectMeasuredModelTokenUsage(result.usage),
            pricing: result.pricing,
          });
        }
        children.push({
          childId: child.childId,
          order: child.chunkIndex,
          text: child.text,
          rawText: child.rawText,
          titlePath: child.headings,
          captions: child.captions,
          docItems: child.docItems,
          pageNumbers: child.pageNumbers,
          numTokens: child.numTokens,
          contentHash: child.contentHash,
          vector: result.vector,
        });
        completed += 1;
        if (reportProgress) {
          await this.dependencies.state.transition({
            job,
            stage: "embedding",
            progress: 75 + Math.floor((completed / childCount) * 17),
          });
        }
      }
      parents.push({
        parentId: parent.parentId,
        parentOrder: parent.parentOrder,
        knowledgeBaseId: job.knowledgeBaseId,
        documentId: job.documentId,
        documentVersionId: job.documentVersionId,
        embeddingProfileHash: job.embeddingProfileHash,
        titlePath: parent.titlePath,
        parentText: parent.parentText,
        pageNumbers: parent.pageNumbers,
        contentHash: parent.contentHash,
        childIds: parent.childIds,
        childCount: parent.childCount,
        children,
      });
    }
    return parents;
  }

  private async index(job: KnowledgeProcessingJob): Promise<void> {
    await this.dependencies.state.transition({
      job,
      stage: "indexing",
      progress: 92,
    });
    const checkpoint =
      await this.dependencies.workspace.readCandidateIndexCheckpoint(job);
    await this.dependencies.elasticsearch.verifyDocumentVersionCandidate({
      knowledgeBaseId: job.knowledgeBaseId,
      documentId: job.documentId,
      documentVersionId: job.documentVersionId,
      expectedParentCount: checkpoint.parentCount,
      expectedChildCount: checkpoint.childCount,
      expectedEmbeddingProfileHash: checkpoint.embeddingProfileHash,
      expectedIndexIntegrityDigest: checkpoint.indexIntegrityDigest,
    });
    await this.assertCanContinue(job);
    await this.dependencies.state.transition({
      job,
      stage: "activating",
      progress: 98,
    });
  }

  private async writeCandidateIndex(
    job: KnowledgeProcessingJob,
    parents: IndexedParentDocument[],
    signal?: AbortSignal,
  ): Promise<void> {
    await this.dependencies.state.transition({
      job,
      stage: "indexing",
      progress: 92,
    });
    await this.assertCanContinue(job, signal);
    const replacement = {
      knowledgeBaseId: job.knowledgeBaseId,
      documentId: job.documentId,
      documentVersionId: job.documentVersionId,
      parents,
    };
    this.dependencies.elasticsearch.validateCandidateDocumentVersion(
      replacement,
    );
    const wholeDocument =
      indexReplacementScope(job.operation) === "whole_document";
    await this.dependencies.indexingExecutor.run({
      ...(signal === undefined ? {} : { signal }),
      operation: async (executorSignal) => {
        await this.dependencies.documentLock.runExclusive(
          job.documentId,
          async (lockSignal) => {
            await this.assertCanContinue(job, lockSignal);
            if (wholeDocument) {
              // Same-version rebuild cannot coexist under the exact version
              // identity. Enter the fail-closed boundary only after both the
              // global indexing slot and document lock have been acquired.
              await this.dependencies.state.transition({
                job,
                stage: "activating",
                progress: 98,
              });
              await this.dependencies.elasticsearch.replaceWholeDocument(
                replacement,
              );
            } else {
              await this.dependencies.elasticsearch.replaceDocumentVersion(
                replacement,
              );
            }
            await this.dependencies.elasticsearch.verifyDocumentVersionCandidate(
              {
                knowledgeBaseId: job.knowledgeBaseId,
                documentId: job.documentId,
                documentVersionId: job.documentVersionId,
                expectedParentCount: parents.length,
                expectedChildCount: parents.reduce(
                  (sum, parent) => sum + parent.childCount,
                  0,
                ),
                expectedEmbeddingProfileHash: job.embeddingProfileHash,
                expectedIndexIntegrityDigest: indexIntegrityDigest(parents),
              },
            );
            await this.assertCanContinue(job, lockSignal);
            await this.dependencies.workspace.saveEmbeddedIndexCheckpoint(
              job,
              parents,
            );
            if (wholeDocument) await this.activate(job);
          },
          executorSignal,
        );
      },
    });
  }

  private async replaceMaintenanceIndex(
    job: KnowledgeProcessingJob,
    parents: IndexedParentDocument[],
    signal?: AbortSignal,
  ): Promise<void> {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      if (signal?.aborted) {
        throw new KnowledgeProcessingError("KNOWLEDGE_PROCESSING_CANCELLED");
      }
      try {
        await this.dependencies.elasticsearch.replaceWholeDocument({
          knowledgeBaseId: job.knowledgeBaseId,
          documentId: job.documentId,
          documentVersionId: job.documentVersionId,
          parents,
        });
        return;
      } catch (error) {
        const stable = isKnowledgeProcessingError(error)
          ? error
          : new KnowledgeProcessingError(
              "KNOWLEDGE_ELASTICSEARCH_OPERATION_FAILED",
              { cause: error, retryable: true },
            );
        if (!stable.retryable || attempt === 3) throw stable;
        await delayWithCancellation(retryDelayForAttempt(attempt), signal);
      }
    }
  }

  private async activate(job: KnowledgeProcessingJob): Promise<void> {
    // Keep the previous PG current pointer and its ES parents intact while the
    // candidate is made searchable. PG post-filtering continues to select the
    // old ready version until the final transaction switches the pointer.
    const activation = await this.dependencies.workspace.prepareActivation(job);
    const reconciliation = {
      knowledgeBaseId: job.knowledgeBaseId,
      documentId: job.documentId,
      activeDocumentVersionId: job.documentVersionId,
      expectedParentCount: activation.parentCount,
      expectedChildCount: activation.childCount,
      expectedEmbeddingProfileHash: activation.embeddingProfileHash,
      expectedIndexIntegrityDigest: activation.indexIntegrityDigest,
    };
    await this.dependencies.elasticsearch.reconcileActiveDocumentVersion({
      ...reconciliation,
      preserveOtherVersions: true,
    });
    await this.dependencies.workspace.finalizeActivation(job);
    // Once PG has atomically switched the ready pointer, stale ES versions are
    // harmless under the mandatory PG post-filter and can be reconciled
    // best-effort. Startup/periodic reconciliation will retry cleanup.
    await this.dependencies.elasticsearch
      .reconcileActiveDocumentVersion(reconciliation)
      .catch(() => undefined);
    await this.dependencies.onActivationCommitted?.(job).catch(() => undefined);
  }

  private async assertCanContinue(
    job: KnowledgeProcessingJob,
    signal?: AbortSignal,
    allowCompleted = false,
  ): Promise<void> {
    if (
      signal?.aborted ||
      (await this.dependencies.state.isCancellationRequested(job))
    ) {
      throw new KnowledgeProcessingError("KNOWLEDGE_PROCESSING_CANCELLED");
    }
    if (
      !allowCompleted &&
      !(await this.dependencies.state.isCurrentGeneration(job))
    ) {
      throw new KnowledgeProcessingError("KNOWLEDGE_PROCESSING_CANCELLED");
    }
  }
}

type StageQueue = Queue<KnowledgeProcessingJob, void, KnowledgeProcessingStage>;
type KnowledgeProcessingQueueLane = "normal" | "document_rebuild";

export interface KnowledgeDocumentLock {
  runExclusive<T>(
    documentId: string,
    operation: (signal: AbortSignal) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T>;
  close(): Promise<void>;
}

export interface KnowledgeIndexingExecutor {
  run<T>(input: {
    operation: (signal: AbortSignal) => Promise<T>;
    signal?: AbortSignal;
  }): Promise<T>;
  close(): Promise<void>;
}

export class RedisKnowledgeIndexingExecutor implements KnowledgeIndexingExecutor {
  private readonly redis: Redis;
  private readonly keyPrefix: string;

  constructor(
    redisUrl: string,
    namespace: string,
    private readonly maximumConcurrency: number,
    private readonly options: {
      leaseMs?: number;
      renewalMs?: number;
      pollMs?: number;
    } = {},
    redis?: Redis,
  ) {
    if (!Number.isSafeInteger(maximumConcurrency) || maximumConcurrency <= 0) {
      throw new Error("invalid knowledge indexing concurrency");
    }
    this.redis = redis ?? new Redis(redisUrl, { maxRetriesPerRequest: null });
    this.keyPrefix = `linksense:knowledge:indexing-slot:${createHash("sha256")
      .update(namespace)
      .digest("hex")
      .slice(0, 16)}`;
  }

  async run<T>(input: {
    operation: (signal: AbortSignal) => Promise<T>;
    signal?: AbortSignal;
  }): Promise<T> {
    const leaseMs = this.options.leaseMs ?? 60_000;
    const renewalMs = this.options.renewalMs ?? 20_000;
    const pollMs = this.options.pollMs ?? 250;
    if (
      !Number.isSafeInteger(leaseMs) ||
      !Number.isSafeInteger(renewalMs) ||
      !Number.isSafeInteger(pollMs) ||
      leaseMs <= 0 ||
      renewalMs <= 0 ||
      pollMs <= 0 ||
      renewalMs * 2 >= leaseMs
    ) {
      throw new Error("invalid knowledge indexing lease configuration");
    }
    const token = randomUUID();
    const slotKey = await this.acquireSlot(
      token,
      leaseMs,
      pollMs,
      input.signal,
    );
    const stop = new AbortController();
    const lost = new AbortController();
    const operationSignal = input.signal
      ? AbortSignal.any([input.signal, lost.signal])
      : lost.signal;
    const renewal = this.renewSlot({
      slotKey,
      token,
      leaseMs,
      renewalMs,
      stopSignal: stop.signal,
      lost,
    });
    try {
      const result = await input.operation(operationSignal);
      if (lost.signal.aborted) throw indexingUnavailable();
      return result;
    } finally {
      stop.abort();
      await renewal;
      await this.redis
        .eval(releaseDocumentLockScript, 1, slotKey, token)
        .catch(() => undefined);
    }
  }

  close(): Promise<void> {
    return this.redis.quit().then(() => undefined);
  }

  private async acquireSlot(
    token: string,
    leaseMs: number,
    pollMs: number,
    signal?: AbortSignal,
  ): Promise<string> {
    for (;;) {
      if (signal?.aborted) {
        throw new KnowledgeProcessingError("KNOWLEDGE_PROCESSING_CANCELLED");
      }
      for (let slot = 0; slot < this.maximumConcurrency; slot += 1) {
        const key = `${this.keyPrefix}:${slot}`;
        let acquired: "OK" | null;
        try {
          acquired = await this.redis.set(key, token, "PX", leaseMs, "NX");
        } catch (error) {
          throw indexingUnavailable(error);
        }
        if (acquired === "OK") return key;
      }
      await delayWithCancellation(pollMs, signal);
    }
  }

  private async renewSlot(input: {
    slotKey: string;
    token: string;
    leaseMs: number;
    renewalMs: number;
    stopSignal: AbortSignal;
    lost: AbortController;
  }): Promise<void> {
    for (;;) {
      try {
        await abortableDelay(input.renewalMs, input.stopSignal);
      } catch {
        return;
      }
      try {
        const renewed = await this.redis.eval(
          renewDocumentLockScript,
          1,
          input.slotKey,
          input.token,
          String(input.leaseMs),
        );
        if (Number(renewed) !== 1) {
          input.lost.abort();
          return;
        }
      } catch {
        input.lost.abort();
        return;
      }
    }
  }
}

const renewDocumentLockScript = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("PEXPIRE", KEYS[1], ARGV[2])
end
return 0
`;

const releaseDocumentLockScript = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
end
return 0
`;

export class RedisKnowledgeDocumentLock implements KnowledgeDocumentLock {
  private readonly redis: Redis;

  constructor(
    redisUrl: string,
    private readonly options: {
      leaseMs?: number;
      renewalMs?: number;
    } = {},
    redis?: Redis,
  ) {
    this.redis = redis ?? new Redis(redisUrl, { maxRetriesPerRequest: null });
  }

  async runExclusive<T>(
    documentId: string,
    operation: (signal: AbortSignal) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    const safeDocumentId = z.string().uuid().parse(documentId);
    if (signal?.aborted) {
      throw new KnowledgeProcessingError("KNOWLEDGE_PROCESSING_CANCELLED");
    }
    const key = `linksense:knowledge:document-lock:${safeDocumentId}`;
    const token = randomUUID();
    const leaseMs = this.options.leaseMs ?? 60_000;
    const renewalMs = this.options.renewalMs ?? 20_000;
    if (
      !Number.isSafeInteger(leaseMs) ||
      !Number.isSafeInteger(renewalMs) ||
      leaseMs <= 0 ||
      renewalMs <= 0 ||
      renewalMs * 2 >= leaseMs
    ) {
      throw new Error("invalid document lock lease configuration");
    }

    let acquired: "OK" | null;
    try {
      acquired = await this.redis.set(key, token, "PX", leaseMs, "NX");
    } catch (error) {
      throw new KnowledgeProcessingError(
        "KNOWLEDGE_EXTERNAL_SERVICE_UNAVAILABLE",
        { cause: error, retryable: true },
      );
    }
    if (acquired !== "OK") {
      throw new KnowledgeProcessingError("KNOWLEDGE_DOCUMENT_BUSY", {
        retryable: true,
      });
    }

    const renewalController = new AbortController();
    const lockLostController = new AbortController();
    const operationSignal = signal
      ? AbortSignal.any([signal, lockLostController.signal])
      : lockLostController.signal;
    const renewal = this.renewLease({
      key,
      token,
      leaseMs,
      renewalMs,
      stopSignal: renewalController.signal,
      lockLostController,
    });

    try {
      const result = await operation(operationSignal);
      if (lockLostController.signal.aborted) {
        throw new KnowledgeProcessingError("KNOWLEDGE_DOCUMENT_BUSY", {
          retryable: true,
        });
      }
      return result;
    } finally {
      renewalController.abort();
      await renewal;
      try {
        await this.redis.eval(releaseDocumentLockScript, 1, key, token);
      } catch {
        // The lease expires by itself; never mask the processing outcome.
      }
    }
  }

  close(): Promise<void> {
    return this.redis.quit().then(() => undefined);
  }

  private async renewLease(input: {
    key: string;
    token: string;
    leaseMs: number;
    renewalMs: number;
    stopSignal: AbortSignal;
    lockLostController: AbortController;
  }): Promise<void> {
    for (;;) {
      try {
        await abortableDelay(input.renewalMs, input.stopSignal);
      } catch {
        return;
      }
      try {
        const renewed = await this.redis.eval(
          renewDocumentLockScript,
          1,
          input.key,
          input.token,
          String(input.leaseMs),
        );
        if (Number(renewed) !== 1) {
          input.lockLostController.abort();
          return;
        }
      } catch {
        input.lockLostController.abort();
        return;
      }
    }
  }
}

export class KnowledgeProcessingScheduler {
  private readonly connection: ConnectionOptions;
  private readonly queues = new Map<KnowledgeProcessingStage, StageQueue>();
  private readonly documentRebuildQueues = new Map<
    KnowledgeProcessingStage,
    StageQueue
  >();
  private readonly workers: Worker<
    KnowledgeProcessingJob,
    void,
    KnowledgeProcessingStage
  >[] = [];
  private readonly activeControllers = new Map<string, AbortController>();
  private readonly outerFailureConvergences = new Set<Promise<void>>();
  private readonly documentLock: KnowledgeDocumentLock;

  constructor(
    redisUrl: string,
    private readonly processor: KnowledgePipelineProcessor,
    private readonly state: KnowledgePipelineStateStore,
    private readonly concurrency: Record<KnowledgeProcessingStage, number>,
    private readonly jobFactory: KnowledgeProcessingJobFactory,
    documentLock?: KnowledgeDocumentLock,
    private readonly admissionGate?: KnowledgeMaintenanceGate,
  ) {
    this.connection = bullMqConnection(redisUrl);
    this.documentLock =
      documentLock ?? new RedisKnowledgeDocumentLock(redisUrl);
    for (const stage of knowledgeProcessingStageSchema.options) {
      this.queues.set(
        stage,
        new Queue(queueName(stage), {
          connection: this.connection,
          defaultJobOptions: {
            attempts: KNOWLEDGE_PROCESSING_MAX_ATTEMPTS,
            backoff: { type: "exponential", delay: 15_000 },
            removeOnComplete: 500,
            removeOnFail: 2_000,
          },
        }),
      );
      this.documentRebuildQueues.set(
        stage,
        new Queue(documentRebuildQueueName(stage), {
          connection: this.connection,
          defaultJobOptions: {
            attempts: KNOWLEDGE_PROCESSING_MAX_ATTEMPTS,
            backoff: { type: "exponential", delay: 15_000 },
            removeOnComplete: 500,
            removeOnFail: 2_000,
          },
        }),
      );
    }
  }

  async start(): Promise<void> {
    if (this.workers.length > 0) return;
    const lanes = [
      {
        lane: "normal" as const,
        queues: this.queues,
        name: queueName,
      },
      {
        lane: "document_rebuild" as const,
        queues: this.documentRebuildQueues,
        name: documentRebuildQueueName,
      },
    ];
    for (const { queues } of lanes) {
      for (const stage of knowledgeProcessingStageSchema.options) {
        await this.requiredQueue(stage, queues).setGlobalConcurrency(
          this.concurrency[stage],
        );
      }
      await this.recoverPersistedJobs(queues);
    }
    for (const { lane, name } of lanes) {
      for (const stage of knowledgeProcessingStageSchema.options) {
        const worker = new Worker<
          KnowledgeProcessingJob,
          void,
          KnowledgeProcessingStage
        >(name(stage), (job) => this.processQueueJob(stage, job, lane), {
          connection: this.connection,
          concurrency: this.concurrency[stage],
          // `attempts` does not count stalled executions. Cap every actual
          // processor start as one of the same three attempts. A third stall is
          // deliberately allowed back to wait; the next pickup is rejected by
          // maxStartedAttempts before the processor runs and emits a local
          // failed event that can converge the PostgreSQL lifecycle.
          maxStartedAttempts: KNOWLEDGE_PROCESSING_MAX_ATTEMPTS,
          maxStalledCount: KNOWLEDGE_PROCESSING_MAX_ATTEMPTS,
        });
        worker.on("failed", (failedJob, error) => {
          if (!failedJob || !isBullMqOuterAttemptLimitFailure(error.message)) {
            return;
          }
          this.trackOuterFailureConvergence(
            convergeOuterWorkerFailure({
              state: this.state,
              stage,
              jobData: failedJob.data,
              failedReason: error.message,
            }),
          );
        });
        this.workers.push(worker);
      }
    }
  }

  async enqueue(input: KnowledgeProcessingCommand): Promise<void> {
    if (input.operation === "rebuild_index") {
      await this.admissionGate?.assertDocumentRebuildAvailable();
    } else {
      await this.admissionGate?.assertAvailable();
    }
    const job = processingJobSchema.parse(await this.jobFactory.create(input));
    const useDocumentRebuildLane =
      input.operation === "rebuild_index" &&
      ((await this.admissionGate?.isBlocked()) ?? false);
    if (useDocumentRebuildLane) {
      const executionAvailable =
        (await this.admissionGate?.isDocumentRebuildExecutionAvailable()) ??
        true;
      if (!executionAvailable) await this.pauseDocumentRebuilds();
      await this.enqueueJobInLane(job, "document_rebuild");
      if (executionAvailable) await this.resumeDocumentRebuilds();
      return;
    }
    await this.enqueueJob(job);
  }

  async enqueueJob(input: KnowledgeProcessingJob): Promise<void> {
    const job = processingJobSchema.parse(input);
    await this.enqueueJobInLane(job, "normal");
  }

  async rebuildForMaintenance(
    input: KnowledgeProcessingCommand,
    signal?: AbortSignal,
  ): Promise<KnowledgeMaintenanceRebuildResult> {
    const job = processingJobSchema.parse(await this.jobFactory.create(input));
    return this.processor.rebuildForMaintenance(job, signal);
  }

  async pauseAndWait(signal?: AbortSignal): Promise<void> {
    const queues = this.allQueues();
    await Promise.all(queues.map((queue) => queue.pause()));
    const deadline = Date.now() + 35 * 60_000;
    while (Date.now() < deadline) {
      if (signal?.aborted) {
        throw new KnowledgeProcessingError("KNOWLEDGE_PROCESSING_CANCELLED");
      }
      const activeCounts = await Promise.all(
        queues.map((queue) => queue.getActiveCount()),
      );
      if (activeCounts.every((count) => count === 0)) return;
      await delayWithCancellation(1_000, signal);
    }
    throw new KnowledgeProcessingError(
      "KNOWLEDGE_EXTERNAL_SERVICE_UNAVAILABLE",
    );
  }

  async resumeDocumentRebuilds(): Promise<void> {
    await Promise.all(
      [...this.documentRebuildQueues.values()].map((queue) => queue.resume()),
    );
  }

  async resume(): Promise<void> {
    await Promise.all(this.allQueues().map((queue) => queue.resume()));
  }

  async cancel(input: KnowledgeProcessingCommand): Promise<void> {
    const job = processingJobSchema.parse(await this.jobFactory.create(input));
    await this.cancelJob(job);
  }

  async runDocumentExclusiveMutation<T>(
    documentId: string,
    operation: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    return this.documentLock.runExclusive(documentId, operation);
  }

  abortActiveDocumentMutations(documentIds: readonly string[]): void {
    for (const documentId of new Set(documentIds)) {
      this.abortActiveDocumentJobs(documentId);
    }
  }

  async cancelJob(input: KnowledgeProcessingJob): Promise<void> {
    const job = processingJobSchema.parse(input);
    await this.documentLock.runExclusive(job.documentId, async () =>
      this.state.requestCancellation(job),
    );
    this.activeControllers.get(documentGenerationKey(job))?.abort();
    await Promise.all(
      [this.queues, this.documentRebuildQueues].flatMap((queues) =>
        knowledgeProcessingStageSchema.options.map(async (stage) => {
          const queued = await this.requiredQueue(stage, queues).getJob(
            queueJobId(job, stage),
          );
          if (!queued) return;
          const state = await queued.getState();
          if (state === "waiting" || state === "delayed") {
            await queued.remove();
          }
        }),
      ),
    );
  }

  async close(): Promise<void> {
    await Promise.all(this.workers.map((worker) => worker.close()));
    this.workers.length = 0;
    await Promise.allSettled([...this.outerFailureConvergences]);
    await Promise.all(this.allQueues().map((queue) => queue.close()));
    await this.documentLock.close();
  }

  private async processQueueJob(
    stage: KnowledgeProcessingStage,
    queueJob: Job<KnowledgeProcessingJob, void, KnowledgeProcessingStage>,
    lane: KnowledgeProcessingQueueLane,
  ): Promise<void> {
    const parsedJob = persistedProcessingJobSchema.safeParse(queueJob.data);
    if (!parsedJob.success) {
      await quarantineInvalidPersistedJob({
        state: this.state,
        stage,
        jobData: queueJob.data,
      });
      throw new UnrecoverableError("KNOWLEDGE_EXTERNAL_SERVICE_UNAVAILABLE");
    }
    const job = parsedJob.data;
    const key = documentGenerationKey(job);
    const controller = new AbortController();
    this.activeControllers.set(key, controller);
    try {
      if (stage === "indexing") {
        await this.documentLock.runExclusive(
          job.documentId,
          (lockSignal) => this.processor.process(job, stage, lockSignal),
          controller.signal,
        );
      } else {
        await this.processor.process(job, stage, controller.signal);
      }
      const next = nextStage(stage);
      if (next && (await this.state.isCurrentGeneration(job))) {
        await this.requiredQueue(next, this.queuesForLane(lane)).add(next, job, {
          jobId: queueJobId(job, next),
        });
      }
    } catch (error) {
      const stable = isKnowledgeProcessingError(error)
        ? error
        : new KnowledgeProcessingError(
            "KNOWLEDGE_EXTERNAL_SERVICE_UNAVAILABLE",
            { cause: error, retryable: true },
          );
      const exhausted = isKnowledgeProcessingAttemptExhausted({
        attemptsMade: queueJob.attemptsMade,
        attemptsStarted: queueJob.attemptsStarted,
      });
      if (!stable.retryable || exhausted) {
        await this.state.markFailed({
          job,
          stage,
          errorCode: stable.code,
        });
      } else {
        const attempt = queueJob.attemptsMade + 1;
        await this.state.recordRetry({
          job,
          stage,
          attempt,
          retryAt: new Date(Date.now() + retryDelayForAttempt(attempt)),
        });
      }
      if (!stable.retryable) throw new UnrecoverableError(stable.code);
      throw stable;
    } finally {
      if (this.activeControllers.get(key) === controller) {
        this.activeControllers.delete(key);
      }
    }
  }

  private async enqueueJobInLane(
    job: KnowledgeProcessingJob,
    lane: KnowledgeProcessingQueueLane,
  ): Promise<void> {
    if (lane === "document_rebuild" && job.operation !== "rebuild_index") {
      throw new Error("document rebuild queue only accepts rebuild jobs");
    }
    await this.requiredQueue(job.startStage, this.queuesForLane(lane)).add(
      job.startStage,
      job,
      { jobId: queueJobId(job, job.startStage) },
    );
  }

  private async pauseDocumentRebuilds(): Promise<void> {
    await Promise.all(
      [...this.documentRebuildQueues.values()].map((queue) => queue.pause()),
    );
  }

  private queuesForLane(
    lane: KnowledgeProcessingQueueLane,
  ): Map<KnowledgeProcessingStage, StageQueue> {
    return lane === "document_rebuild"
      ? this.documentRebuildQueues
      : this.queues;
  }

  private allQueues(): StageQueue[] {
    return [
      ...this.queues.values(),
      ...this.documentRebuildQueues.values(),
    ];
  }

  private requiredQueue(
    stage: KnowledgeProcessingStage,
    queues: Map<KnowledgeProcessingStage, StageQueue> = this.queues,
  ): StageQueue {
    const queue = queues.get(stage);
    if (!queue) throw new Error("knowledge processing queue is unavailable");
    return queue;
  }

  private async recoverPersistedJobs(
    queues: Map<KnowledgeProcessingStage, StageQueue>,
  ): Promise<void> {
    for (const stage of knowledgeProcessingStageSchema.options) {
      const queue = this.requiredQueue(stage, queues);
      let start = 0;
      for (;;) {
        const jobs = await queue.getJobs(
          [...PERSISTED_JOB_RECOVERY_STATES],
          start,
          start + OUTER_FAILURE_RECOVERY_PAGE_SIZE - 1,
          true,
        );
        let retained = 0;
        for (const persistedJob of jobs) {
          const quarantined = await quarantineInvalidPersistedJob({
            state: this.state,
            stage,
            jobData: persistedJob.data,
          });
          if (quarantined) {
            try {
              await persistedJob.remove();
            } catch {
              retained += 1;
            }
            continue;
          }
          await convergeOuterWorkerFailure({
            state: this.state,
            stage,
            jobData: persistedJob.data,
            failedReason: persistedJob.failedReason,
          });
          retained += 1;
        }
        if (jobs.length < OUTER_FAILURE_RECOVERY_PAGE_SIZE) break;
        start += retained;
      }
    }
  }

  private trackOuterFailureConvergence(convergence: Promise<boolean>): void {
    const pending = convergence.then(() => undefined);
    this.outerFailureConvergences.add(pending);
    void pending
      .finally(() => this.outerFailureConvergences.delete(pending))
      .catch(() => undefined);
  }

  private abortActiveDocumentJobs(documentId: string): void {
    const prefix = `${documentId}:`;
    for (const [key, controller] of this.activeControllers) {
      if (key.startsWith(prefix)) controller.abort();
    }
  }
}

export function validateKnowledgeProcessingJob(
  input: unknown,
): KnowledgeProcessingJob | null {
  const parsed = persistedProcessingJobSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

export async function quarantineInvalidPersistedJob(input: {
  state: Pick<KnowledgePipelineStateStore, "markFailed">;
  stage: KnowledgeProcessingStage;
  jobData: unknown;
}): Promise<boolean> {
  if (persistedProcessingJobSchema.safeParse(input.jobData).success) {
    return false;
  }
  const identity = processingJobIdentitySchema.safeParse(input.jobData);
  if (identity.success) {
    await input.state.markFailed({
      job: identity.data,
      stage: input.stage,
      errorCode: "KNOWLEDGE_EXTERNAL_SERVICE_UNAVAILABLE",
    });
  }
  return true;
}

export function nextStage(
  stage: KnowledgeProcessingStage,
): KnowledgeProcessingStage | null {
  const order = knowledgeProcessingStageSchema.options;
  const position = order.indexOf(stage);
  return position < 0 || position === order.length - 1
    ? null
    : order[position + 1]!;
}

export function retryDelayForAttempt(attempt: number): number {
  if (
    !Number.isSafeInteger(attempt) ||
    attempt < 1 ||
    attempt >= KNOWLEDGE_PROCESSING_MAX_ATTEMPTS
  ) {
    throw new RangeError(
      `knowledge processing retry attempt must be between 1 and ${KNOWLEDGE_PROCESSING_MAX_ATTEMPTS - 1}`,
    );
  }
  return 15_000 * 2 ** (attempt - 1);
}

export function isKnowledgeProcessingAttemptExhausted(input: {
  attemptsMade: number;
  attemptsStarted: number;
}): boolean {
  return (
    Math.max(input.attemptsMade + 1, input.attemptsStarted) >=
    KNOWLEDGE_PROCESSING_MAX_ATTEMPTS
  );
}

export function isBullMqOuterAttemptLimitFailure(
  failedReason: string | undefined,
): boolean {
  return (
    failedReason === BULLMQ_STARTED_ATTEMPT_LIMIT_REASON ||
    failedReason === BULLMQ_STALLED_ATTEMPT_LIMIT_REASON
  );
}

export async function convergeOuterWorkerFailure(input: {
  state: Pick<KnowledgePipelineStateStore, "markFailed">;
  stage: KnowledgeProcessingStage;
  jobData: unknown;
  failedReason: string | undefined;
}): Promise<boolean> {
  if (!isBullMqOuterAttemptLimitFailure(input.failedReason)) return false;
  const parsedJob = persistedProcessingJobSchema.safeParse(input.jobData);
  if (!parsedJob.success) {
    await quarantineInvalidPersistedJob({
      state: input.state,
      stage: input.stage,
      jobData: input.jobData,
    });
    return true;
  }
  await input.state.markFailed({
    job: parsedJob.data,
    stage: input.stage,
    errorCode: "KNOWLEDGE_EXTERNAL_SERVICE_UNAVAILABLE",
  });
  return true;
}

export function indexReplacementScope(
  operation: KnowledgeProcessingJob["operation"],
): "document_version" | "whole_document" {
  return operation === "rebuild_index" ? "whole_document" : "document_version";
}

function isDoclingTaskNotFound(error: unknown): boolean {
  return (
    isKnowledgeProcessingError(error) &&
    error.code === "KNOWLEDGE_DOCLING_TASK_NOT_FOUND"
  );
}

function isDiscardableDoclingResult(error: unknown): boolean {
  return (
    isKnowledgeProcessingError(error) &&
    [
      "KNOWLEDGE_DOCLING_TASK_NOT_FOUND",
      "KNOWLEDGE_DOCLING_CHUNKER_UNAVAILABLE",
      "KNOWLEDGE_DOCLING_RESULT_INVALID",
      "KNOWLEDGE_DOCLING_RESULT_UNSAFE",
      "KNOWLEDGE_DOCUMENT_STRUCTURE_INVALID",
    ].includes(error.code)
  );
}

function retryableMissingDoclingTask(error: unknown): KnowledgeProcessingError {
  if (!isDoclingTaskNotFound(error)) throw error;
  return new KnowledgeProcessingError("KNOWLEDGE_DOCLING_TASK_NOT_FOUND", {
    cause: error,
    retryable: true,
  });
}

function invalidDoclingResult(): KnowledgeProcessingError {
  return new KnowledgeProcessingError("KNOWLEDGE_DOCLING_RESULT_INVALID");
}

function createRetrievalManifestDigest(
  parents: readonly BuiltKnowledgeParent[],
): string {
  return createHash("sha256").update(JSON.stringify(parents)).digest("hex");
}

function queueName(stage: KnowledgeProcessingStage): string {
  return `linksense-knowledge-${stage}`;
}

function documentRebuildQueueName(stage: KnowledgeProcessingStage): string {
  return `linksense-knowledge-document-rebuild-${stage}`;
}

function queueJobId(
  job: KnowledgeProcessingJob,
  stage: KnowledgeProcessingStage,
): string {
  return `${job.documentId}-${job.processingGeneration}-${stage}`;
}

function documentGenerationKey(job: KnowledgeProcessingJob): string {
  return `${job.documentId}:${job.processingGeneration}`;
}

function bullMqConnection(input: string): ConnectionOptions {
  const url = new URL(input);
  if (url.protocol !== "redis:" && url.protocol !== "rediss:") {
    throw new Error("REDIS_URL must use redis or rediss");
  }
  const databaseText = url.pathname.replace(/^\//u, "");
  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : 6379,
    ...(url.username ? { username: decodeURIComponent(url.username) } : {}),
    ...(url.password ? { password: decodeURIComponent(url.password) } : {}),
    ...(databaseText ? { db: Number(databaseText) } : {}),
    ...(url.protocol === "rediss:" ? { tls: {} } : {}),
    maxRetriesPerRequest: null,
  };
}

async function abortableDelay(
  milliseconds: number,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) throw signal.reason;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

async function delayWithCancellation(
  milliseconds: number,
  signal?: AbortSignal,
): Promise<void> {
  if (signal) {
    await abortableDelay(milliseconds, signal);
    return;
  }
  await new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function indexingUnavailable(cause?: unknown): KnowledgeProcessingError {
  return new KnowledgeProcessingError(
    "KNOWLEDGE_ELASTICSEARCH_OPERATION_FAILED",
    { cause, retryable: true },
  );
}
