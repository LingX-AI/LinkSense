import { createHash } from "node:crypto"

import { imageUnderstandingSnapshotSchema } from "@linksense/shared"
import type { PrismaClient } from "../../generated/prisma/client.js"
import { z } from "zod"
import type { KnowledgeProcessingCommand } from "../knowledge/types.js"
import { failKnowledgeSourceDocumentProcessing } from "../knowledge-sources/progress.js"
import type { KnowledgeProcessingConfig } from "./config.js"
import { KnowledgeProcessingError } from "./errors.js"
import type { KnowledgeObjectStore } from "./object-store.js"
import type { ImageUnderstandingSettingsReader } from "../system/image-understanding-settings.js"
import type {
  KnowledgeModelSettingsReader,
  ResolvedKnowledgeModelRuntime,
} from "../system/knowledge-model-settings.js"
import {
  type KnowledgeExternalTaskKind,
  type KnowledgePipelineStateStore,
  type KnowledgeProcessingJob,
  type KnowledgeProcessingJobIdentity,
  type KnowledgeProcessingJobFactory,
  type KnowledgeProcessingStage,
} from "./pipeline.js"

export class PrismaKnowledgeProcessingJobFactory
  implements KnowledgeProcessingJobFactory
{
  constructor(
    private readonly prisma: PrismaClient,
    private readonly config: KnowledgeProcessingConfig,
    private readonly checkpointObjectStore: Pick<
      KnowledgeObjectStore,
      "verifyIntegrity"
    >,
    private readonly imageUnderstandingSettings: ImageUnderstandingSettingsReader,
    private readonly knowledgeModelSettings: KnowledgeModelSettingsReader,
  ) {}

  async create(
    command: KnowledgeProcessingCommand,
  ): Promise<KnowledgeProcessingJob> {
    const version = await this.prisma.knowledgeBaseDocumentVersion.findFirst({
      where: {
        id: command.documentVersionId,
        knowledgeBaseId: command.knowledgeBaseId,
        documentId: command.documentId,
        processingGeneration: command.processingGeneration,
      },
      select: {
        canonicalExtension: true,
        processingStage: true,
        failedStage: true,
        processingConfigJson: true,
        doclingBundleObjectId: true,
        doclingBundleSha256: true,
        displayMarkdownObjectId: true,
        displayMarkdownSha256: true,
        doclingJsonObjectId: true,
        doclingJsonSha256: true,
        parsedAssetCount: true,
        hybridChunksObjectId: true,
        hybridChunksSha256: true,
        imageProjectionObjectId: true,
        imageProjectionSha256: true,
        imageUnderstandingConfigDigest: true,
        retrievalManifestObjectId: true,
        retrievalManifestSha256: true,
        parserConfigDigest: true,
        chunkingConfigDigest: true,
      },
    })
    if (!version) {
      throw new KnowledgeProcessingError(
        "KNOWLEDGE_DOCUMENT_STRUCTURE_INVALID",
      )
    }
    const sourceFormat = version.canonicalExtension.toLowerCase()
    const processingConfig = persistedProcessingConfigSchema.safeParse(
      version.processingConfigJson,
    )
    if (!processingConfig.success) {
      throw new KnowledgeProcessingError(
        "KNOWLEDGE_DOCUMENT_STRUCTURE_INVALID",
      )
    }
    const isMaintenanceRebuild = command.operation === "rebuild_index"
    const persistedImageUnderstanding =
      processingConfig.data.image_understanding
    if (
      isMaintenanceRebuild &&
      version.chunkingConfigDigest === null
    ) {
      throw new KnowledgeProcessingError(
        "KNOWLEDGE_DOCUMENT_STRUCTURE_INVALID",
      )
    }
    const chunkingConfigDigest = isMaintenanceRebuild
      ? version.chunkingConfigDigest
      : this.config.chunkingConfigDigest
    if (chunkingConfigDigest === null) {
      throw new KnowledgeProcessingError(
        "KNOWLEDGE_DOCUMENT_STRUCTURE_INVALID",
      )
    }
    const useCurrentImageSettings =
      !isMaintenanceRebuild &&
      (command.operation !== "retry" ||
        persistedImageUnderstanding === undefined)
    const imageUnderstanding =
      useCurrentImageSettings || persistedImageUnderstanding === undefined
        ? await this.imageUnderstandingSettings.getSnapshot()
        : persistedImageUnderstanding
    let knowledgeModels: ResolvedKnowledgeModelRuntime
    try {
      knowledgeModels = await this.knowledgeModelSettings.resolveRuntime()
    } catch (error) {
      throw new KnowledgeProcessingError(
        "KNOWLEDGE_EMBEDDING_CONFIGURATION_CHANGED",
        { cause: error },
      )
    }
    if (!imageUnderstanding) {
      throw new KnowledgeProcessingError(
        "KNOWLEDGE_IMAGE_MODEL_CONFIGURATION_CHANGED",
      )
    }
    const nextProcessingConfig = {
      ...processingConfig.data,
      image_understanding: imageUnderstanding,
    }
    const processingConfigDigest = createHash("sha256")
      .update(JSON.stringify(nextProcessingConfig))
      .digest("hex")
    if (
      !isMaintenanceRebuild &&
      (useCurrentImageSettings ||
        version.imageUnderstandingConfigDigest !==
          imageUnderstanding.config_digest)
    ) {
      await this.prisma.knowledgeBaseDocumentVersion.updateMany({
        where: {
          id: command.documentVersionId,
          documentId: command.documentId,
          processingGeneration: command.processingGeneration,
        },
        data: {
          processingConfigJson: nextProcessingConfig,
          processingConfigDigest,
        },
      })
    }
    return {
      ...command,
      sourceFormat,
      ocrEnabled: processingConfig.data.ocr_enabled,
      startStage: isMaintenanceRebuild
        ? "embedding"
        : await resolveVerifiedStartStage({
            prisma: this.prisma,
            command,
            version,
            objectStore: this.checkpointObjectStore,
            parserConfigDigest: this.config.parserConfigDigest,
            chunkingConfigDigest: this.config.chunkingConfigDigest,
            imageUnderstandingConfigDigest:
              imageUnderstanding.config_digest,
          }),
      parserConfigDigest: this.config.parserConfigDigest,
      chunking: {
        ...this.config.chunking,
        configDigest: chunkingConfigDigest,
      },
      imageUnderstanding,
      embeddingProfileHash: knowledgeModels.embedding.profileHash,
    }
  }
}

const persistedProcessingConfigSchema = z
  .object({
    ocr_enabled: z.boolean().default(false),
    image_understanding: imageUnderstandingSnapshotSchema.optional(),
  })
  .passthrough()

export class PrismaKnowledgePipelineStateStore
  implements KnowledgePipelineStateStore
{
  constructor(private readonly prisma: PrismaClient) {}

  async isCurrentGeneration(job: KnowledgeProcessingJob): Promise<boolean> {
    const [document, version] = await Promise.all([
      this.prisma.knowledgeBaseDocument.findUnique({
        where: { id: job.documentId },
        select: { activeProcessingVersionId: true, status: true },
      }),
      this.prisma.knowledgeBaseDocumentVersion.findUnique({
        where: { id: job.documentVersionId },
        select: {
          processingGeneration: true,
          versionStatus: true,
          operationType: true,
        },
      }),
    ])
    return Boolean(
      document &&
        version &&
        document.status !== "deleted" &&
        document.activeProcessingVersionId === job.documentVersionId &&
        version.processingGeneration === job.processingGeneration &&
        isProcessableVersion(version.versionStatus, version.operationType),
    )
  }

  async isCancellationRequested(job: KnowledgeProcessingJob): Promise<boolean> {
    const version = await this.prisma.knowledgeBaseDocumentVersion.findFirst({
      where: {
        id: job.documentVersionId,
        processingGeneration: job.processingGeneration,
      },
      select: { cancelRequestedAt: true },
    })
    return version === null || version.cancelRequestedAt !== null
  }

  async requestCancellation(job: KnowledgeProcessingJob): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await lockDocumentRow(tx, job.documentId)
      const [document, version] = await Promise.all([
        tx.knowledgeBaseDocument.findUnique({
          where: { id: job.documentId },
          select: { status: true },
        }),
        tx.knowledgeBaseDocumentVersion.findFirst({
          where: {
            id: job.documentVersionId,
            documentId: job.documentId,
            processingGeneration: job.processingGeneration,
          },
          select: {
            cancelRequestedAt: true,
            processingStage: true,
            progressPercent: true,
            versionStatus: true,
          },
        }),
      ])
      // The domain cancellation transaction normally writes this first.
      if (
        !document ||
        !version ||
        document.status === "deleted" ||
        version.versionStatus === "deleted" ||
        version.cancelRequestedAt !== null
      ) {
        return
      }
      if (version.processingStage === "activating" || version.progressPercent >= 98) {
        throw new KnowledgeProcessingError("KNOWLEDGE_DOCUMENT_BUSY")
      }
      const now = new Date()
      await tx.knowledgeBaseDocumentVersion.update({
        where: { id: job.documentVersionId },
        data: {
          cancelRequestedAt: now,
          cancelRequestedBy: job.requestedBy,
          cancelReason: "user_requested",
          retryAt: null,
          processingRevision: { increment: 1 },
        },
      })
      await tx.knowledgeBaseProcessingAttempt.updateMany({
        where: {
          documentVersionId: job.documentVersionId,
          processingGeneration: job.processingGeneration,
          status: "active",
        },
        data: {
          status: "discarded",
          discardedAt: now,
        },
      })
    })
  }

  async transition(input: {
    job: KnowledgeProcessingJob
    stage: KnowledgeProcessingStage
    progress: number
    retryAt?: Date
  }): Promise<void> {
    const bounds = progressBounds[input.stage]
    if (
      !Number.isSafeInteger(input.progress) ||
      input.progress < bounds.minimum ||
      input.progress > bounds.maximum
    ) {
      throw new KnowledgeProcessingError(
        "KNOWLEDGE_DOCUMENT_STRUCTURE_INVALID",
      )
    }
    await this.prisma.$transaction(async (tx) => {
      await lockDocumentRow(tx, input.job.documentId)
      const [document, version] = await Promise.all([
        tx.knowledgeBaseDocument.findUnique({
          where: { id: input.job.documentId },
          select: {
            activeProcessingVersionId: true,
            currentVersionId: true,
            status: true,
          },
        }),
        tx.knowledgeBaseDocumentVersion.findFirst({
          where: {
            id: input.job.documentVersionId,
            documentId: input.job.documentId,
            processingGeneration: input.job.processingGeneration,
          },
          select: {
            progressPercent: true,
            processingStage: true,
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
        document.activeProcessingVersionId !== input.job.documentVersionId ||
        version.cancelRequestedAt !== null ||
        !isProcessableVersion(version.versionStatus, version.operationType)
      ) {
        throw new KnowledgeProcessingError("KNOWLEDGE_PROCESSING_CANCELLED")
      }
      const progressPercent = resolveMonotonicTransitionProgress({
        persistedStage: version.processingStage,
        persistedProgress: version.progressPercent,
        requestedStage: input.stage,
        requestedProgress: input.progress,
      })
      const processingStage = resolveMonotonicTransitionStage({
        persistedStage: version.processingStage,
        requestedStage: input.stage,
      })
      await tx.knowledgeBaseDocumentVersion.update({
        where: { id: input.job.documentVersionId },
        data: {
          processingStage,
          progressPercent,
          failedStage: null,
          retryAt: input.retryAt ?? null,
          processingRevision: { increment: 1 },
          updatedAt: new Date(),
        },
      })
      if (
        input.stage === "activating" &&
        version.operationType === "rebuild_index" &&
        version.versionStatus === "ready" &&
        document.currentVersionId === input.job.documentVersionId
      ) {
        await tx.knowledgeBaseDocument.update({
          where: { id: input.job.documentId },
          data: { status: "processing" },
        })
      }
    })
  }

  async getActiveExternalTask(
    job: KnowledgeProcessingJob,
    kind: KnowledgeExternalTaskKind,
  ): Promise<{ taskId: string; attemptNo: number } | null> {
    return this.prisma.knowledgeBaseProcessingAttempt.findFirst({
      where: {
        documentVersionId: job.documentVersionId,
        processingGeneration: job.processingGeneration,
        taskKind: kind,
        status: "active",
      },
      orderBy: { attemptNo: "desc" },
      select: {
        taskId: true,
        attemptNo: true,
      },
    })
  }

  async recordExternalTask(
    job: KnowledgeProcessingJob,
    kind: KnowledgeExternalTaskKind,
    taskId: string,
  ): Promise<{ taskId: string; attemptNo: number }> {
    return this.prisma.$transaction(async (tx) => {
      await lockDocumentRow(tx, job.documentId)
      const [document, version, existingTask] = await Promise.all([
        tx.knowledgeBaseDocument.findUnique({
          where: { id: job.documentId },
          select: { activeProcessingVersionId: true, status: true },
        }),
        tx.knowledgeBaseDocumentVersion.findFirst({
          where: {
            id: job.documentVersionId,
            documentId: job.documentId,
            processingGeneration: job.processingGeneration,
          },
          select: {
            cancelRequestedAt: true,
            operationType: true,
            versionStatus: true,
          },
        }),
        tx.knowledgeBaseProcessingAttempt.findUnique({
          where: {
            taskKind_taskId: {
              taskKind: kind,
              taskId,
            },
          },
          select: {
            documentVersionId: true,
            processingGeneration: true,
            attemptNo: true,
            status: true,
          },
        }),
      ])
      if (
        !document ||
        !version ||
        document.status === "deleted" ||
        document.activeProcessingVersionId !== job.documentVersionId ||
        version.cancelRequestedAt !== null ||
        !isProcessableVersion(version.versionStatus, version.operationType)
      ) {
        throw new KnowledgeProcessingError("KNOWLEDGE_PROCESSING_CANCELLED")
      }
      if (existingTask !== null) {
        if (
          existingTask.documentVersionId === job.documentVersionId &&
          existingTask.processingGeneration === job.processingGeneration &&
          existingTask.status === "active"
        ) {
          return { taskId, attemptNo: existingTask.attemptNo }
        }
        throw new KnowledgeProcessingError(
          "KNOWLEDGE_DOCUMENT_STRUCTURE_INVALID",
        )
      }

      const now = new Date()
      const latest = await tx.knowledgeBaseProcessingAttempt.aggregate({
        where: {
          documentVersionId: job.documentVersionId,
          processingGeneration: job.processingGeneration,
          taskKind: kind,
        },
        _max: { attemptNo: true },
      })
      const attemptNo = (latest._max.attemptNo ?? 0) + 1
      await tx.knowledgeBaseProcessingAttempt.updateMany({
        where: {
          documentVersionId: job.documentVersionId,
          processingGeneration: job.processingGeneration,
          taskKind: kind,
          status: "active",
        },
        data: {
          status: "discarded",
          discardedAt: now,
        },
      })
      await tx.knowledgeBaseProcessingAttempt.create({
        data: {
          knowledgeBaseId: job.knowledgeBaseId,
          documentId: job.documentId,
          documentVersionId: job.documentVersionId,
          processingGeneration: job.processingGeneration,
          taskKind: kind,
          processingStage: externalTaskStage(kind),
          attemptNo,
          taskId,
          status: "active",
          submittedAt: now,
        },
      })
      await tx.knowledgeBaseDocumentVersion.update({
        where: { id: job.documentVersionId },
        data: {
          processingRevision: { increment: 1 },
        },
      })
      return { taskId, attemptNo }
    })
  }

  async discardExternalTask(
    job: KnowledgeProcessingJob,
    kind: KnowledgeExternalTaskKind,
    taskId: string,
  ): Promise<boolean> {
    return this.finishExternalTask({
      job,
      kind,
      taskId,
      status: "discarded",
    })
  }

  async completeExternalTask(
    job: KnowledgeProcessingJob,
    kind: KnowledgeExternalTaskKind,
    taskId: string,
  ): Promise<boolean> {
    return this.finishExternalTask({
      job,
      kind,
      taskId,
      status: "completed",
    })
  }

  private async finishExternalTask(input: {
    job: KnowledgeProcessingJob
    kind: KnowledgeExternalTaskKind
    taskId: string
    status: "completed" | "discarded"
  }): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      await lockDocumentRow(tx, input.job.documentId)
      const [document, version] = await Promise.all([
        tx.knowledgeBaseDocument.findUnique({
          where: { id: input.job.documentId },
          select: { activeProcessingVersionId: true, status: true },
        }),
        tx.knowledgeBaseDocumentVersion.findFirst({
          where: {
            id: input.job.documentVersionId,
            documentId: input.job.documentId,
            processingGeneration: input.job.processingGeneration,
          },
          select: {
            operationType: true,
            versionStatus: true,
          },
        }),
      ])
      if (
        !document ||
        !version ||
        document.status === "deleted" ||
        document.activeProcessingVersionId !== input.job.documentVersionId ||
        !isProcessableVersion(version.versionStatus, version.operationType)
      ) {
        throw new KnowledgeProcessingError("KNOWLEDGE_PROCESSING_CANCELLED")
      }

      const now = new Date()
      const result = await tx.knowledgeBaseProcessingAttempt.updateMany({
        where: {
          documentVersionId: input.job.documentVersionId,
          processingGeneration: input.job.processingGeneration,
          taskKind: input.kind,
          taskId: input.taskId,
          status: "active",
        },
        data: {
          status: input.status,
          ...(input.status === "completed"
            ? { completedAt: now }
            : { discardedAt: now }),
        },
      })
      if (result.count === 0) return false
      await tx.knowledgeBaseDocumentVersion.update({
        where: { id: input.job.documentVersionId },
        data: {
          processingRevision: { increment: 1 },
        },
      })
      return true
    })
  }

  async markFailed(input: {
    job: KnowledgeProcessingJobIdentity
    stage: KnowledgeProcessingStage
    errorCode: string
  }): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await lockDocumentRow(tx, input.job.documentId)
      const document = await tx.knowledgeBaseDocument.findUnique({
        where: { id: input.job.documentId },
        select: {
          currentVersionId: true,
          activeProcessingVersionId: true,
          status: true,
        },
      })
      const version = await tx.knowledgeBaseDocumentVersion.findFirst({
        where: {
          id: input.job.documentVersionId,
          processingGeneration: input.job.processingGeneration,
        },
        select: {
          cancelRequestedAt: true,
          operationType: true,
          processingStage: true,
          versionStatus: true,
        },
      })
      if (
        !document ||
        !version ||
        document.status === "deleted" ||
        document.activeProcessingVersionId !== input.job.documentVersionId ||
        version.versionStatus === "deleted"
      ) {
        return
      }
      const stableErrorCode =
        version.cancelRequestedAt === null
          ? input.errorCode
          : "KNOWLEDGE_PROCESSING_CANCELLED"
      const rebuildOfCurrent =
        version.operationType === "rebuild_index" &&
        version.versionStatus === "ready" &&
        document.currentVersionId === input.job.documentVersionId
      const destructiveRebuildFailure =
        rebuildOfCurrent &&
        (document.status === "processing" ||
          version.processingStage === "activating")
      await tx.knowledgeBaseDocumentVersion.update({
        where: { id: input.job.documentVersionId },
        data: {
          versionStatus: rebuildOfCurrent ? "ready" : "failed",
          processingStage: "failed",
          failedStage: input.stage,
          stableErrorCode,
          retryAt: null,
          completedAt: new Date(),
          processingRevision: { increment: 1 },
        },
      })
      await tx.knowledgeBaseProcessingAttempt.updateMany({
        where: {
          documentVersionId: input.job.documentVersionId,
          processingGeneration: input.job.processingGeneration,
          status: "active",
        },
        data: {
          status: "failed",
          stableErrorCode,
          failedAt: new Date(),
        },
      })
      if (document.activeProcessingVersionId === input.job.documentVersionId) {
        const failedCurrent =
          destructiveRebuildFailure ||
          (!rebuildOfCurrent &&
            (document.currentVersionId === null ||
              document.currentVersionId === input.job.documentVersionId))
        await tx.knowledgeBaseDocument.update({
          where: { id: input.job.documentId },
          data: {
            status: failedCurrent ? "failed" : "ready",
            activeProcessingVersionId: null,
            ...(rebuildOfCurrent
              ? { candidateVersionId: input.job.documentVersionId }
              : {}),
            stableErrorCode: failedCurrent ? stableErrorCode : null,
          },
        })
      }
      await failKnowledgeSourceDocumentProcessing(
        tx,
        input.job.documentId,
        stableErrorCode,
        new Date(),
      )
    })
  }

  async recordRetry(input: {
    job: KnowledgeProcessingJob
    stage: KnowledgeProcessingStage
    attempt: number
    retryAt: Date
  }): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await lockDocumentRow(tx, input.job.documentId)
      const [document, version] = await Promise.all([
        tx.knowledgeBaseDocument.findUnique({
          where: { id: input.job.documentId },
          select: { activeProcessingVersionId: true, status: true },
        }),
        tx.knowledgeBaseDocumentVersion.findFirst({
          where: {
            id: input.job.documentVersionId,
            documentId: input.job.documentId,
            processingGeneration: input.job.processingGeneration,
          },
          select: {
            cancelRequestedAt: true,
            operationType: true,
            versionStatus: true,
          },
        }),
      ])
      if (
        !document ||
        !version ||
        document.status === "deleted" ||
        document.activeProcessingVersionId !== input.job.documentVersionId ||
        version.cancelRequestedAt !== null ||
        !isProcessableVersion(version.versionStatus, version.operationType)
      ) {
        return
      }
      await tx.knowledgeBaseDocumentVersion.update({
        where: { id: input.job.documentVersionId },
        data: {
          stageAttemptCount: input.attempt,
          retryAt: input.retryAt,
          processingRevision: { increment: 1 },
        },
      })
    })
  }
}

const progressBounds: Record<
  KnowledgeProcessingStage,
  { minimum: number; maximum: number }
> = {
  parsing: { minimum: 25, maximum: 50 },
  chunking: { minimum: 50, maximum: 60 },
  image_understanding: { minimum: 60, maximum: 70 },
  parenting: { minimum: 70, maximum: 75 },
  embedding: { minimum: 75, maximum: 92 },
  indexing: { minimum: 92, maximum: 98 },
  activating: { minimum: 98, maximum: 100 },
}

export function resolveMonotonicTransitionProgress(input: {
  persistedStage: string
  persistedProgress: number
  requestedStage: KnowledgeProcessingStage
  requestedProgress: number
}): number {
  if (input.requestedProgress >= input.persistedProgress) {
    return input.requestedProgress
  }

  const persistedPosition = knowledgeStagePosition(input.persistedStage)
  const requestedPosition = knowledgeStagePosition(input.requestedStage)
  const sameStage = input.persistedStage === input.requestedStage
  const startsNewGeneration = input.persistedStage === "queued"
  const continuesForward =
    persistedPosition !== null &&
    requestedPosition !== null &&
    requestedPosition > persistedPosition
  const recoversUncheckpointedVectors =
    input.requestedStage === "embedding" &&
    (input.persistedStage === "indexing" ||
      input.persistedStage === "activating")
  const recoversStandaloneIndexing =
    input.requestedStage === "indexing" &&
    input.persistedStage === "activating"

  if (
    sameStage ||
    startsNewGeneration ||
    continuesForward ||
    recoversUncheckpointedVectors ||
    recoversStandaloneIndexing
  ) {
    return input.persistedProgress
  }
  throw new KnowledgeProcessingError(
    "KNOWLEDGE_DOCUMENT_STRUCTURE_INVALID",
  )
}

function resolveMonotonicTransitionStage(input: {
  persistedStage: string
  requestedStage: KnowledgeProcessingStage
}): KnowledgeProcessingStage {
  if (
    input.persistedStage === "activating" &&
    (input.requestedStage === "embedding" ||
      input.requestedStage === "indexing")
  ) {
    return "activating"
  }
  if (
    input.persistedStage === "indexing" &&
    input.requestedStage === "embedding"
  ) {
    return "indexing"
  }
  return input.requestedStage
}

function knowledgeStagePosition(stage: string): number | null {
  const order: readonly KnowledgeProcessingStage[] = [
    "parsing",
    "chunking",
    "image_understanding",
    "parenting",
    "embedding",
    "indexing",
    "activating",
  ]
  const position = order.findIndex((candidate) => candidate === stage)
  return position < 0 ? null : position
}

type ProcessingArtifactFields = {
  processingStage: string
  failedStage: string | null
  doclingBundleObjectId: string | null
  doclingBundleSha256: string | null
  displayMarkdownObjectId: string | null
  displayMarkdownSha256: string | null
  doclingJsonObjectId: string | null
  doclingJsonSha256: string | null
  parsedAssetCount: number | null
  hybridChunksObjectId: string | null
  hybridChunksSha256: string | null
  imageProjectionObjectId: string | null
  imageProjectionSha256: string | null
  imageUnderstandingConfigDigest: string | null
  retrievalManifestObjectId: string | null
  retrievalManifestSha256: string | null
  parserConfigDigest: string | null
  chunkingConfigDigest: string | null
}

async function resolveVerifiedStartStage(input: {
  prisma: PrismaClient
  objectStore: Pick<KnowledgeObjectStore, "verifyIntegrity">
  command: KnowledgeProcessingCommand
  version: ProcessingArtifactFields
  parserConfigDigest: string
  chunkingConfigDigest: string
  imageUnderstandingConfigDigest: string
}): Promise<KnowledgeProcessingStage> {
  if (
    input.command.operation !== "retry" &&
    input.command.operation !== "rebuild_index"
  ) {
    return "parsing"
  }

  const requested =
    input.command.operation === "rebuild_index"
      ? "embedding"
      : (input.version.failedStage ?? input.version.processingStage)
  if (requested === "parsing") return "parsing"

  const parseArtifactsValid =
    input.version.parserConfigDigest === input.parserConfigDigest &&
    input.version.parsedAssetCount !== null &&
    (await verifyArtifacts(input, [
      {
        objectId: input.version.doclingBundleObjectId,
        sha256: input.version.doclingBundleSha256,
        objectType: "docling_bundle",
      },
      {
        objectId: input.version.displayMarkdownObjectId,
        sha256: input.version.displayMarkdownSha256,
        objectType: "display_markdown",
      },
      {
        objectId: input.version.doclingJsonObjectId,
        sha256: input.version.doclingJsonSha256,
        objectType: "docling_json",
      },
    ])) &&
    (await verifyParsedAssets(input, input.version.parsedAssetCount))
  if (!parseArtifactsValid) return "parsing"
  if (requested === "chunking") return "chunking"

  const hybridChunksValid =
    input.version.chunkingConfigDigest === input.chunkingConfigDigest &&
    (await verifyArtifacts(input, [
      {
        objectId: input.version.hybridChunksObjectId,
        sha256: input.version.hybridChunksSha256,
        objectType: "hybrid_chunks",
      },
    ]))
  if (!hybridChunksValid) return "chunking"
  if (requested === "image_understanding") return "image_understanding"

  const imageProjectionValid =
    input.version.imageUnderstandingConfigDigest ===
      input.imageUnderstandingConfigDigest &&
    (await verifyArtifacts(input, [
      {
        objectId: input.version.imageProjectionObjectId,
        sha256: input.version.imageProjectionSha256,
        objectType: "image_projection",
      },
    ]))
  if (!imageProjectionValid) return "image_understanding"
  if (requested === "parenting") return "parenting"

  const retrievalManifestValid = await verifyArtifacts(input, [
    {
      objectId: input.version.retrievalManifestObjectId,
      sha256: input.version.retrievalManifestSha256,
      objectType: "retrieval_manifest",
    },
  ])
  if (!retrievalManifestValid) return "parenting"

  // Embedding vectors are intentionally not persisted outside Elasticsearch.
  return "embedding"
}

async function verifyArtifacts(
  input: {
    prisma: PrismaClient
    objectStore: Pick<KnowledgeObjectStore, "verifyIntegrity">
    command: KnowledgeProcessingCommand
  },
  artifacts: readonly {
    objectId: string | null
    sha256: string | null
    objectType: string
  }[],
): Promise<boolean> {
  for (const artifact of artifacts) {
    if (artifact.objectId === null || artifact.sha256 === null) return false
    const object = await input.prisma.knowledgeBaseObject.findFirst({
      where: {
        id: artifact.objectId,
        knowledgeBaseId: input.command.knowledgeBaseId,
        documentId: input.command.documentId,
        documentVersionId: input.command.documentVersionId,
        processingGeneration: input.command.processingGeneration,
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
      object === null ||
      !(await input.objectStore.verifyIntegrity({
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

async function verifyParsedAssets(
  input: {
    prisma: PrismaClient
    objectStore: Pick<KnowledgeObjectStore, "verifyIntegrity">
    command: KnowledgeProcessingCommand
  },
  expectedCount: number,
): Promise<boolean> {
  if (!Number.isSafeInteger(expectedCount) || expectedCount < 0) return false
  const assets = await input.prisma.knowledgeBaseObject.findMany({
    where: {
      knowledgeBaseId: input.command.knowledgeBaseId,
      documentId: input.command.documentId,
      documentVersionId: input.command.documentVersionId,
      processingGeneration: input.command.processingGeneration,
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
      !(await input.objectStore.verifyIntegrity({
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

function isProcessableVersion(status: string, operation: string): boolean {
  return status === "processing" ||
    (status === "ready" && operation === "rebuild_index")
}

function externalTaskStage(
  kind: KnowledgeExternalTaskKind,
): "parsing" | "chunking" {
  return kind === "convert" ? "parsing" : "chunking"
}

async function lockDocumentRow(
  tx: Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0],
  documentId: string,
): Promise<void> {
  await tx.$queryRawUnsafe(
    'SELECT "id" FROM "knowledge_base_documents" WHERE "id" = $1::uuid FOR UPDATE',
    documentId,
  )
}
