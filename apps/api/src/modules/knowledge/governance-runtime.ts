import type { PrismaClient } from "../../generated/prisma/client.js"
import type { ElasticsearchKnowledgeAdapter } from "../knowledge-processing/elasticsearch.js"
import type { KnowledgeObjectStore } from "../knowledge-processing/object-store.js"
import type { KnowledgeProcessingScheduler } from "../knowledge-processing/pipeline.js"
import { KnowledgeAdminService, PrismaKnowledgeAdminStore } from "./admin.js"
import {
  KnowledgeCleanupWorker,
  PrismaKnowledgeCleanupRepository,
} from "./cleanup.js"
import {
  KnowledgeMaintenanceService,
  KnowledgeMaintenanceWorker,
  PrismaKnowledgeMaintenanceStore,
  RedisKnowledgeMaintenanceLock,
  type KnowledgeMaintenanceGate,
} from "./maintenance.js"

/**
 * Builds governance/background workers around the already-created processing
 * runtime. It deliberately performs no startup or Fastify registration so the
 * application composition root retains lifecycle control.
 */
export function createKnowledgeGovernanceRuntime(input: {
  prisma: PrismaClient
  redisUrl: string
  scheduler: KnowledgeProcessingScheduler
  maintenanceGate: KnowledgeMaintenanceGate
  maintenanceRebuildConcurrency: number
  currentEmbeddingProfileHash: () => string | undefined
  elasticsearch: ElasticsearchKnowledgeAdapter
  objectStore: KnowledgeObjectStore
}) {
  const adminStore = new PrismaKnowledgeAdminStore(input.prisma)
  const maintenanceStore = new PrismaKnowledgeMaintenanceStore(input.prisma)
  const cleanupRepository = new PrismaKnowledgeCleanupRepository(input.prisma)
  const adminService = new KnowledgeAdminService(adminStore, {
    maintenanceGate: input.maintenanceGate,
    scheduler: input.scheduler,
  })
  const maintenanceService = new KnowledgeMaintenanceService(maintenanceStore)
  const cleanupWorker = new KnowledgeCleanupWorker(
    cleanupRepository,
    input.objectStore,
    input.elasticsearch,
  )
  const maintenanceWorker = new KnowledgeMaintenanceWorker(
    maintenanceStore,
    new RedisKnowledgeMaintenanceLock(input.redisUrl),
    input.scheduler,
    input.elasticsearch,
    {
      rebuild: async ({ target, requestedBy }, signal) => {
        if (
          target.documentVersionId === null ||
          target.processingGeneration === null
        ) {
          throw new Error("knowledge maintenance target has no current version")
        }
        return input.scheduler.rebuildForMaintenance(
          {
            operation: "rebuild_index",
            knowledgeBaseId: target.knowledgeBaseId,
            documentId: target.documentId,
            documentVersionId: target.documentVersionId,
            processingGeneration: target.processingGeneration,
            requestedBy,
          },
          signal,
        )
      },
    },
    {
      rebuildConcurrency: input.maintenanceRebuildConcurrency,
      recovery: {
        index: input.elasticsearch,
        currentEmbeddingProfileHash: input.currentEmbeddingProfileHash,
        runDocumentExclusive: (documentId, operation) =>
          input.scheduler.runDocumentExclusiveMutation(documentId, operation),
      },
    },
  )

  return {
    adminService,
    maintenanceService,
    maintenanceGate: input.maintenanceGate,
    cleanupWorker,
    maintenanceWorker,
    async start(): Promise<void> {
      await maintenanceWorker.start()
      await cleanupWorker.start()
    },
    async close(): Promise<void> {
      await maintenanceWorker.close()
      await cleanupWorker.close()
    },
  }
}

export type KnowledgeGovernanceRuntime = ReturnType<
  typeof createKnowledgeGovernanceRuntime
>
