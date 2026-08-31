import type { FullAppConfig } from "../../config.js"
import type { PrismaClient } from "../../generated/prisma/client.js"
import { PrismaKnowledgeMaintenanceGate } from "../knowledge/maintenance.js"
import {
  PublishingKnowledgePipelineStateStore,
  type KnowledgeDocumentEventPublisher,
} from "../knowledge/events.js"
import { projectKnowledgeProcessingConfig } from "./config.js"
import { DoclingServeClient } from "./docling.js"
import { EmbeddingClient } from "./embedding.js"
import { ElasticsearchKnowledgeAdapter } from "./elasticsearch.js"
import { KnowledgeProcessingHealthProbe } from "./health.js"
import { KnowledgeObjectStore } from "./object-store.js"
import {
  KnowledgePipelineProcessor,
  KnowledgeProcessingScheduler,
  RedisKnowledgeIndexingExecutor,
  RedisKnowledgeDocumentLock,
  type KnowledgeProcessingJob,
} from "./pipeline.js"
import {
  PrismaKnowledgePipelineStateStore,
  PrismaKnowledgeProcessingJobFactory,
} from "./prisma-state.js"
import {
  KnowledgeIndexActivationReconciler,
  PrismaKnowledgeIndexReconciliationSource,
  RedisKnowledgeIndexReconciliationCoordinator,
} from "./reconciliation.js"
import { KnowledgeRetrievalOrchestrator } from "./retrieval.js"
import { PrismaMinioKnowledgePipelineWorkspace } from "./workspace.js"
import {
  VercelAiImageUnderstandingClient,
  type ImageUnderstandingClient,
} from "./image-understanding-client.js"
import {
  ImageUnderstandingSettingsService,
  type ImageUnderstandingSettingsReader,
} from "../system/image-understanding-settings.js"
import {
  KnowledgeModelSettingsService,
  type KnowledgeModelSettingsReader,
} from "../system/knowledge-model-settings.js"
import {
  ModelProviderSettingsService,
  type ManagedModelRuntimeSettingsReader,
} from "../system/model-provider-settings.js"
import {
  LiveKnowledgeModelClientResolver,
  LiveKnowledgeModelConfigurationProbe,
} from "./knowledge-model-runtime.js"
import type { ModelUsageRecorder } from "../usage/model-usage.js"
import {
  LocalUnoserverRuntime,
  UnoOfficeDocumentConverter,
} from "./office-converter.js"

/** Creates the complete processing graph without mutating app/services startup. */
export function createKnowledgeProcessingRuntime(input: {
  config: FullAppConfig
  prisma: PrismaClient
  eventPublisher?: KnowledgeDocumentEventPublisher
  imageUnderstandingSettings?: ImageUnderstandingSettingsReader
  imageUnderstandingClient?: ImageUnderstandingClient
  knowledgeModelSettings?: KnowledgeModelSettingsReader
  modelProviderSettings?: ManagedModelRuntimeSettingsReader
  usageRecorder?: ModelUsageRecorder
  onDocumentRebuildActivated?: () => void
}) {
  const config = projectKnowledgeProcessingConfig(input.config)
  const eventPublisher = input.eventPublisher
  const objectStore = new KnowledgeObjectStore({
    endpoint: input.config.minio.endpoint,
    port: input.config.minio.port,
    useSsl: input.config.minio.useSsl,
    accessKey: input.config.minio.accessKey,
    secretKey: input.config.minio.secretKey,
    bucket: input.config.minio.knowledgeBucket,
  })
  const docling = new DoclingServeClient({
    ...config.docling,
    hybridProbe: {
      tokenizer: config.chunking.tokenizer,
      maxTokens: config.chunking.childMaxTokens,
    },
  })
  const elasticsearch = new ElasticsearchKnowledgeAdapter({
    ...config.elasticsearch,
    dimensions: config.embedding.dimensions,
  })
  const baseState = new PrismaKnowledgePipelineStateStore(input.prisma)
  const state = eventPublisher
    ? new PublishingKnowledgePipelineStateStore(baseState, eventPublisher)
    : baseState
  const workspace = new PrismaMinioKnowledgePipelineWorkspace(
    input.prisma,
    objectStore,
    BigInt(input.config.knowledge.upload.storageQuotaBytes)
  )
  const officeConverter = new UnoOfficeDocumentConverter(
    new LocalUnoserverRuntime(),
    {
      maximumOutputBytes: input.config.knowledge.upload.maxFileSizeBytes,
    }
  )
  const imageUnderstandingClient =
    input.imageUnderstandingClient ?? new VercelAiImageUnderstandingClient()
  const modelProviderSettings =
    input.modelProviderSettings ??
    new ModelProviderSettingsService(input.prisma, input.config)
  const imageUnderstandingSettings =
    input.imageUnderstandingSettings ??
    new ImageUnderstandingSettingsService(
      input.prisma,
      input.config,
      imageUnderstandingClient,
      modelProviderSettings
    )
  const knowledgeModelSettings =
    input.knowledgeModelSettings ??
    new KnowledgeModelSettingsService(
      input.prisma,
      input.config,
      new LiveKnowledgeModelConfigurationProbe(),
      modelProviderSettings
    )
  const knowledgeModels = new LiveKnowledgeModelClientResolver(
    knowledgeModelSettings
  )
  const jobFactory = new PrismaKnowledgeProcessingJobFactory(
    input.prisma,
    config,
    objectStore,
    imageUnderstandingSettings,
    knowledgeModelSettings
  )
  const documentLock = new RedisKnowledgeDocumentLock(input.config.redisUrl)
  const indexingExecutor = new RedisKnowledgeIndexingExecutor(
    input.config.redisUrl,
    config.elasticsearch.index,
    config.concurrency.indexing
  )
  const maintenanceGate = new PrismaKnowledgeMaintenanceGate(input.prisma)
  const indexReconciler = new KnowledgeIndexActivationReconciler({
    source: new PrismaKnowledgeIndexReconciliationSource(input.prisma),
    coordinator: new RedisKnowledgeIndexReconciliationCoordinator(
      input.config.redisUrl,
      config.elasticsearch.index
    ),
    documentLock,
    elasticsearch,
    maintenanceGate,
  })
  const processor = new KnowledgePipelineProcessor({
    state,
    workspace,
    docling,
    embedding: knowledgeModels,
    elasticsearch,
    indexingExecutor,
    documentLock,
    imageUnderstandingClient,
    imageUnderstandingSettings,
    imageUnderstandingConcurrency: config.concurrency.image_understanding,
    doclingTimeoutSeconds: config.docling.documentTimeoutSeconds,
    officeConverter,
    ...(input.usageRecorder ? { usageRecorder: input.usageRecorder } : {}),
    ...(eventPublisher || input.onDocumentRebuildActivated
      ? {
          onActivationCommitted: async (job: KnowledgeProcessingJob) => {
            if (job.operation === "rebuild_index") {
              input.onDocumentRebuildActivated?.()
            }
            await eventPublisher?.publish(job)
          },
        }
      : {}),
  })
  const scheduler = new KnowledgeProcessingScheduler(
    input.config.redisUrl,
    processor,
    state,
    config.concurrency,
    jobFactory,
    documentLock,
    maintenanceGate
  )
  const retrieval = new KnowledgeRetrievalOrchestrator(
    knowledgeModels,
    elasticsearch,
    null,
    input.usageRecorder
  )
  const health = new KnowledgeProcessingHealthProbe({
    minio: objectStore,
    docling: {
      async health(signal?: AbortSignal): Promise<void> {
        await Promise.all([
          docling.health(signal),
          officeConverter.health(signal),
        ])
      },
    },
    embedding: async () => {
      const runtime = await knowledgeModelSettings.resolveRuntime()
      return new EmbeddingClient(runtime.embedding)
    },
    elasticsearch,
    rerank: knowledgeModels.resolveRerankHealth,
  })

  return {
    scheduler,
    maintenanceGate,
    currentEmbeddingProfileHash: () =>
      knowledgeModelSettings.getCurrentEmbeddingProfileHash?.(),
    retrieval,
    health,
    objectStore,
    elasticsearch,
    async reconcileActiveDocumentVersion(input: {
      knowledgeBaseId: string
      documentId: string
      activeDocumentVersionId: string
      expectedParentCount: number
    }): Promise<void> {
      await elasticsearch.reconcileActiveDocumentVersion(input)
    },
    async start(): Promise<void> {
      // Warm the synchronous document-compatibility projection without making
      // knowledge-model availability an API process startup dependency.
      await knowledgeModelSettings.resolveRuntime().catch(() => undefined)
      // A temporary converter failure degrades only legacy Office/VSDX jobs;
      // modern formats must remain usable and the health probe will expose it.
      await officeConverter.start().catch(() => undefined)
      await scheduler.start()
      await indexReconciler.start()
    },
    async close(): Promise<void> {
      await indexReconciler.close()
      await scheduler.close()
      await indexingExecutor.close()
      await officeConverter.close()
    },
  }
}

export type KnowledgeProcessingRuntime = ReturnType<
  typeof createKnowledgeProcessingRuntime
>
