import { Queue, Worker, type ConnectionOptions } from "bullmq";
import { z } from "zod";

import type { PrismaClient } from "../../generated/prisma/client.js";
import { knowledgeSourceLeaseExpiry } from "./checkpoint.js";
import type { KnowledgeSourceScheduler } from "./service.js";

const QUEUE_NAME = "linksense-knowledge-source-sync";
const JOB_NAME = "sync";
const jobSchema = z.strictObject({
  sourceId: z.string().uuid(),
  trigger: z.enum(["initial", "manual", "scheduled", "retry"]),
});
type SyncJob = z.infer<typeof jobSchema>;

export class KnowledgeSourceRuntime implements KnowledgeSourceScheduler {
  private readonly producerConnection: ConnectionOptions;
  private readonly workerConnection: ConnectionOptions;
  private readonly queue: Queue<SyncJob, void, typeof JOB_NAME>;
  private worker: Worker<SyncJob, void, typeof JOB_NAME> | null = null;
  private monitor: ReturnType<typeof setInterval> | null = null;

  constructor(
    redisUrl: string,
    private readonly prisma: PrismaClient,
    private readonly process: (
      sourceId: string,
      trigger: SyncJob["trigger"],
    ) => Promise<void>,
  ) {
    this.producerConnection = bullMqConnection(redisUrl, false);
    this.workerConnection = bullMqConnection(redisUrl, true);
    this.queue = new Queue(QUEUE_NAME, {
      connection: this.producerConnection,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 15_000 },
        removeOnComplete: 500,
        removeOnFail: 2_000,
      },
    });
  }

  async start(): Promise<void> {
    if (this.worker) return;
    await this.queue.waitUntilReady();
    await this.recoverExpiredLeases();
    this.worker = new Worker(
      QUEUE_NAME,
      async (job) => {
        const input = jobSchema.parse(job.data);
        await this.process(input.sourceId, input.trigger);
      },
      { connection: this.workerConnection, concurrency: 2 },
    );
    await this.enqueueDue();
    this.monitor = setInterval(
      () =>
        void this.recoverExpiredLeases()
          .then(() => this.enqueueDue())
          .catch(() => undefined),
      60_000,
    );
    this.monitor.unref();
  }

  async enqueue(sourceId: string, trigger: SyncJob["trigger"]): Promise<void> {
    const input = jobSchema.parse({ sourceId, trigger });
    await this.queue.add(JOB_NAME, input, {
      ...(trigger === "scheduled" || trigger === "initial"
        ? {
            jobId: `knowledge-source-${sourceId}-${trigger}-${Math.floor(Date.now() / 60_000)}`,
          }
        : {}),
    });
  }

  async close(): Promise<void> {
    if (this.monitor) clearInterval(this.monitor);
    this.monitor = null;
    await this.worker?.close();
    this.worker = null;
    await this.queue.close();
  }

  private async enqueueDue() {
    const now = new Date();
    const sources = await this.prisma.knowledgeBaseSource.findMany({
      where: {
        syncStatus: { in: ["pending", "ready", "failed"] },
        OR: [{ nextSyncAt: null }, { nextSyncAt: { lte: now } }],
      },
      select: { id: true, knowledgeBaseId: true },
      take: 100,
    });
    const runnableKnowledgeBases = new Set(
      (
        await this.prisma.knowledgeBase.findMany({
          where: {
            id: { in: sources.map((source) => source.knowledgeBaseId) },
            lifecycleStatus: "active",
            availabilityStatus: "enabled",
          },
          select: { id: true },
        })
      ).map((knowledgeBase) => knowledgeBase.id),
    );
    await Promise.all(
      sources
        .filter((source) => runnableKnowledgeBases.has(source.knowledgeBaseId))
        .map((source) => this.enqueue(source.id, "scheduled")),
    );
  }

  private async recoverExpiredLeases(): Promise<void> {
    const now = new Date();
    const expired = await this.prisma.knowledgeBaseSource.findMany({
      where: { syncStatus: "syncing", syncLeaseExpiresAt: { lte: now } },
      select: { id: true },
      take: 100,
    });
    if (expired.length === 0) return;
    const expiredSourceIds = expired.map((source) => source.id);
    const activeSourceIds = await this.activeProcessingSourceIds(
      expiredSourceIds,
    );
    if (activeSourceIds.size > 0) {
      await this.prisma.knowledgeBaseSource.updateMany({
        where: {
          id: { in: [...activeSourceIds] },
          syncStatus: "syncing",
          syncLeaseExpiresAt: { lte: now },
        },
        data: { syncLeaseExpiresAt: knowledgeSourceLeaseExpiry(now) },
      });
    }
    const sourceIds = expiredSourceIds.filter(
      (sourceId) => !activeSourceIds.has(sourceId),
    );
    if (sourceIds.length === 0) return;
    await this.prisma.$transaction(async (transaction) => {
      const runs = await transaction.knowledgeSourceSyncRun.findMany({
        where: { sourceId: { in: sourceIds }, status: "running" },
        select: { id: true, phase: true },
      });
      const runIds = runs.map((run) => run.id);
      if (runIds.length > 0) {
        for (const run of runs) {
          const failedItems = await transaction.knowledgeSourceItem.updateMany({
            where: {
              lastSyncRunId: run.id,
              syncStatus: "processing",
            },
            data: {
              syncStatus: "failed",
              syncAction: null,
              syncFailurePhase: "processing",
              stableErrorCode: "KNOWLEDGE_SOURCE_SYNC_UNAVAILABLE",
            },
          });
          await transaction.knowledgeSourceSyncRun.updateMany({
            where: { id: run.id, status: "running" },
            data: {
              status: "failed",
              phase: "completed",
              failurePhase:
                run.phase === "scanning"
                  ? "scanning"
                  : run.phase === "syncing"
                    ? "syncing"
                    : "processing",
              ...(failedItems.count > 0
                ? {
                    processedCount: { increment: failedItems.count },
                    failedCount: { increment: failedItems.count },
                  }
                : {}),
              stableErrorCode: "KNOWLEDGE_SOURCE_SYNC_UNAVAILABLE",
              completedAt: now,
            },
          });
        }
      }
      await transaction.knowledgeBaseSource.updateMany({
        where: { id: { in: sourceIds }, syncStatus: "syncing" },
        data: {
          syncStatus: "failed",
          stableErrorCode: "KNOWLEDGE_SOURCE_SYNC_UNAVAILABLE",
          syncLeaseExpiresAt: null,
          nextSyncAt: now,
        },
      });
    });
  }

  private async activeProcessingSourceIds(
    sourceIds: string[],
  ): Promise<Set<string>> {
    const items = await this.prisma.knowledgeSourceItem.findMany({
      where: {
        sourceId: { in: sourceIds },
        syncStatus: "processing",
      },
      select: { id: true, sourceId: true, documentId: true },
    });
    if (items.length === 0) return new Set();
    const sourceIdByItemId = new Map(
      items.map((item) => [item.id, item.sourceId]),
    );
    const unresolvedItemIds = items
      .filter((item) => item.documentId === null)
      .map((item) => item.id);
    const projectedEntries =
      unresolvedItemIds.length === 0
        ? []
        : await this.prisma.knowledgeBaseEntry.findMany({
            where: {
              sourceItemId: { in: unresolvedItemIds },
              documentId: { not: null },
            },
            select: { sourceItemId: true, documentId: true },
          });
    const processingDocuments = [
      ...items.flatMap((item) =>
        item.documentId === null
          ? []
          : [{ sourceId: item.sourceId, documentId: item.documentId }],
      ),
      ...projectedEntries.flatMap((entry) => {
        const sourceId =
          entry.sourceItemId === null
            ? undefined
            : sourceIdByItemId.get(entry.sourceItemId);
        return sourceId === undefined || entry.documentId === null
          ? []
          : [{ sourceId, documentId: entry.documentId }];
      }),
    ];
    if (processingDocuments.length === 0) return new Set();
    const documentIds = processingDocuments.map((item) => item.documentId);
    const activeDocumentIds = new Set(
      (
        await this.prisma.knowledgeBaseDocument.findMany({
          where: {
            id: { in: documentIds },
            activeProcessingVersionId: { not: null },
            status: { not: "deleted" },
          },
          select: { id: true },
        })
      ).map((document) => document.id),
    );
    return new Set(
      processingDocuments.flatMap((item) =>
        activeDocumentIds.has(item.documentId) ? [item.sourceId] : [],
      ),
    );
  }
}

function bullMqConnection(input: string, worker: boolean): ConnectionOptions {
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
    maxRetriesPerRequest: worker ? null : 1,
    ...(!worker ? { connectTimeout: 1_000, enableOfflineQueue: false } : {}),
  };
}
