import { randomUUID } from "node:crypto";

import {
  knowledgeBaseSourceSchema,
  type KnowledgeSourceSyncPhase,
  type KnowledgeSourceSyncSchedule,
  type KnowledgeSourceSyncTrigger,
} from "@linksense/shared";
import { Prisma } from "../../generated/prisma/client.js";
import type { PrismaClient } from "../../generated/prisma/client.js";

import { AppError } from "../../lib/errors.js";
import type {
  KnowledgeService,
  KnowledgeBaseView,
} from "../knowledge/service.js";
import type { KnowledgeActor } from "../knowledge/types.js";
import type { SharePointSettingsService } from "./sharepoint-settings.js";
import type {
  SharePointGraphClient,
  SharePointResolvedFolder,
} from "./sharepoint-graph.js";
import { finalizeRunIfTerminal } from "./progress.js";
import {
  applySharePointDeltaCheckpoint,
  knowledgeSourceLeaseExpiry,
} from "./checkpoint.js";
import {
  knowledgeSourceScheduleFromRecord,
  knowledgeSourceScheduleToRecord,
  nextKnowledgeSourceSyncAt,
  normalizeKnowledgeSourceSchedule,
  type KnowledgeSourceScheduleRecord,
} from "./schedule.js";
import {
  buildKnowledgeSourceWorkItems,
  executeKnowledgeSourceWorkItems,
  type KnowledgeSourceWorkItem,
} from "./work-items.js";

export {
  isDescendantOf,
  knowledgeEntryPath,
  shouldRetrySourceDocument,
  sourceRelativePath,
} from "./work-items.js";

export interface KnowledgeSourceScheduler {
  enqueue(sourceId: string, trigger: KnowledgeSourceSyncTrigger): Promise<void>;
}

export interface SharePointGraphFactory {
  create(): Promise<SharePointGraphClient>;
}

export class KnowledgeSourceService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly settings: SharePointSettingsService,
    private readonly graphFactory: SharePointGraphFactory,
    private readonly knowledge: KnowledgeService,
    private readonly scheduler: KnowledgeSourceScheduler,
    private readonly now: () => Date = () => new Date(),
    private readonly createId: () => string = randomUUID,
  ) {}

  async createSharePointKnowledgeBase(
    actor: KnowledgeActor,
    input: {
      name: string;
      description?: string | null;
      folderUrl: string;
      schedule: KnowledgeSourceSyncSchedule;
    },
  ): Promise<KnowledgeBaseView> {
    assertActiveAdmin(actor);
    const schedule = parseKnowledgeSourceSchedule(input.schedule);
    await this.settings.resolveRuntime();
    const folder = await (
      await this.graphFactory.create()
    ).resolveFolder(input.folderUrl);
    const now = this.now();
    const nextScheduledSyncAt = nextKnowledgeSourceSyncAt(schedule, now, now);
    const knowledgeBaseId = this.createId();
    const sourceId = this.createId();
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.knowledgeBase.create({
          data: {
            id: knowledgeBaseId,
            ownerId: actor.id,
            name: input.name.trim(),
            description: normalizeNullable(input.description),
            sourceType: "sharepoint",
            lifecycleStatus: "active",
            availabilityStatus: "enabled",
            cleanupStatus: "completed",
            createdAt: now,
            updatedAt: now,
          },
        });
        await tx.knowledgeBaseSource.create({
          data: {
            id: sourceId,
            knowledgeBaseId,
            provider: "sharepoint",
            sourceUrl: folder.sourceUrl,
            siteId: folder.siteId,
            driveId: folder.driveId,
            rootItemId: folder.rootItemId,
            siteName: folder.siteName,
            driveName: folder.driveName,
            folderName: folder.folderName,
            ...knowledgeSourceScheduleToRecord(schedule),
            syncStatus: "pending",
            nextSyncAt: nextScheduledSyncAt,
            createdBy: actor.id,
            createdAt: now,
            updatedAt: now,
          },
        });
        await tx.auditLog.create({
          data: {
            actorId: actor.id,
            action: "knowledge_source.sharepoint_created",
            targetType: "knowledge_base_source",
            targetId: sourceId,
            result: "success",
            metadataJson: {
              knowledge_base_id: knowledgeBaseId,
              provider: "sharepoint",
              site_id: folder.siteId,
              drive_id: folder.driveId,
              root_item_id: folder.rootItemId,
              sync_frequency: schedule.frequency,
              sync_time_zone: schedule.time_zone,
            },
            ipAddress: actor.ipAddress ?? null,
            userAgent: actor.userAgent ?? null,
          },
        });
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new AppError("KNOWLEDGE_SOURCE_ALREADY_CONNECTED");
      }
      throw error;
    }
    try {
      await this.scheduler.enqueue(sourceId, "initial");
    } catch {
      await this.prisma.knowledgeBaseSource.update({
        where: { id: sourceId },
        data: {
          syncStatus: "failed",
          stableErrorCode: "KNOWLEDGE_SOURCE_SYNC_UNAVAILABLE",
          nextSyncAt: nextScheduledSyncAt,
        },
      });
    }
    return this.knowledge.getKnowledgeBase(actor, knowledgeBaseId);
  }

  async getSource(actor: KnowledgeActor, knowledgeBaseId: string) {
    assertActiveAdmin(actor);
    const source = await this.prisma.knowledgeBaseSource.findUnique({
      where: { knowledgeBaseId },
    });
    if (!source) throw new AppError("KNOWLEDGE_SOURCE_NOT_FOUND");
    const latestRun = await this.prisma.knowledgeSourceSyncRun.findFirst({
      where: { sourceId: source.id },
      orderBy: [{ startedAt: "desc" }, { createdAt: "desc" }],
    });
    return projectSource(source, latestRun);
  }

  async requestSync(actor: KnowledgeActor, knowledgeBaseId: string) {
    assertActiveAdmin(actor);
    const source = await this.prisma.knowledgeBaseSource.findUnique({
      where: { knowledgeBaseId },
      select: {
        id: true,
        syncStatus: true,
        stableErrorCode: true,
        syncLeaseExpiresAt: true,
      },
    });
    if (!source) throw new AppError("KNOWLEDGE_SOURCE_NOT_FOUND");
    if (source.syncStatus === "syncing" || source.syncStatus === "pending") {
      throw new AppError("CONFLICT");
    }
    const trigger: KnowledgeSourceSyncTrigger =
      source.syncStatus === "failed" ? "retry" : "manual";
    const queued = await this.prisma.knowledgeBaseSource.updateMany({
      where: { id: source.id, syncStatus: source.syncStatus },
      data: {
        syncStatus: "pending",
        stableErrorCode: null,
        syncLeaseExpiresAt: null,
      },
    });
    if (queued.count !== 1) throw new AppError("CONFLICT");
    try {
      await this.scheduler.enqueue(source.id, trigger);
    } catch (error) {
      await this.prisma.knowledgeBaseSource.updateMany({
        where: { id: source.id, syncStatus: "pending" },
        data: {
          syncStatus: source.syncStatus,
          stableErrorCode: source.stableErrorCode,
          syncLeaseExpiresAt: source.syncLeaseExpiresAt,
        },
      });
      const unavailable = new AppError("KNOWLEDGE_SOURCE_SYNC_UNAVAILABLE");
      unavailable.cause = error;
      throw unavailable;
    }
    return this.getSource(actor, knowledgeBaseId);
  }

  async processSync(
    sourceId: string,
    trigger: KnowledgeSourceSyncTrigger,
  ): Promise<void> {
    const source = await this.prisma.knowledgeBaseSource.findUnique({
      where: { id: sourceId },
    });
    if (!source) return;
    const base = await this.prisma.knowledgeBase.findUnique({
      where: { id: source.knowledgeBaseId },
      select: {
        ownerId: true,
        lifecycleStatus: true,
        availabilityStatus: true,
      },
    });
    if (
      !base ||
      base.lifecycleStatus !== "active" ||
      base.availabilityStatus !== "enabled"
    )
      return;
    const schedule = knowledgeSourceScheduleFromRecord(source);
    // The scheduled system workflow reuses owner-scoped document mutations.
    // It does not inherit administrator privileges from the source creator.
    const actor: KnowledgeActor = {
      id: base.ownerId,
      role: "user",
      status: "active",
    };
    const previousRun =
      trigger === "retry" || source.syncStatus === "failed"
        ? await this.prisma.knowledgeSourceSyncRun.findFirst({
            where: {
              sourceId,
              status: { in: ["partial", "failed"] },
            },
            orderBy: [{ startedAt: "desc" }, { createdAt: "desc" }],
          })
        : null;
    const resumeAfterScan =
      previousRun !== null &&
      previousRun.failurePhase !== "scanning" &&
      previousRun.scanDeltaLink !== null;
    const runId = this.createId();
    const startedAt = this.now();
    let currentPhase: KnowledgeSourceSyncPhase = resumeAfterScan
      ? "syncing"
      : "scanning";
    const claimed = await this.prisma.$transaction(async (tx) => {
      // The runtime settles an expired run and its unfinished item checkpoints
      // before scheduling recovery. A worker must never steal that lease and
      // leave the previous run permanently active.
      const result = await tx.knowledgeBaseSource.updateMany({
        where: {
          id: sourceId,
          syncStatus: { not: "syncing" },
        },
        data: {
          syncStatus: "syncing",
          stableErrorCode: null,
          syncLeaseExpiresAt: knowledgeSourceLeaseExpiry(startedAt),
        },
      });
      if (result.count !== 1) return false;
      await tx.knowledgeSourceItem.updateMany({
        where: { sourceId, syncStatus: "processing" },
        data: {
          syncStatus: "failed",
          syncAction: null,
          syncFailurePhase: "processing",
          stableErrorCode: "KNOWLEDGE_SOURCE_SYNC_UNAVAILABLE",
        },
      });
      await tx.knowledgeSourceSyncRun.create({
        data: {
          id: runId,
          sourceId,
          triggerType: trigger,
          status: "running",
          phase: currentPhase,
          retryOfRunId: previousRun?.id ?? null,
          scanBaseCursor:
            previousRun?.scanBaseCursor ?? source.deltaLink ?? null,
          scanCursor: resumeAfterScan
            ? null
            : (previousRun?.scanCursor ??
              previousRun?.scanBaseCursor ??
              source.deltaLink ??
              null),
          scanDeltaLink: previousRun?.scanDeltaLink ?? null,
          scannedCount: previousRun?.scannedCount ?? 0,
          startedAt,
        },
      });
      return true;
    });
    if (!claimed) return;
    try {
      const graph = await this.graphFactory.create();
      const finalDeltaLink = resumeAfterScan
        ? previousRun.scanDeltaLink
        : await this.applyDelta(source, graph, runId);
      currentPhase = "syncing";
      const work = await this.buildWorkItems(source);
      const preparedAt = this.now();
      await this.prisma.$transaction(async (tx) => {
        await tx.knowledgeSourceSyncRun.update({
          where: { id: runId },
          data: {
            phase: "syncing",
            scanCursor: null,
            scanDeltaLink: finalDeltaLink,
            totalCount: work.length,
          },
        });
        await tx.knowledgeBaseSource.update({
          where: { id: sourceId },
          data: {
            deltaLink: finalDeltaLink ?? source.deltaLink,
            nextSyncAt: nextKnowledgeSourceSyncAt(
              schedule,
              source.createdAt,
              preparedAt,
            ),
            syncLeaseExpiresAt: knowledgeSourceLeaseExpiry(preparedAt),
          },
        });
        await finalizeRunIfTerminal(tx, runId, preparedAt);
      });
      await this.executeWorkItems(source, graph, actor, runId, work);
      currentPhase = "processing";
      const waitingAt = this.now();
      await this.prisma.$transaction(async (tx) => {
        await tx.knowledgeSourceSyncRun.updateMany({
          where: { id: runId, status: "running" },
          data: { phase: "processing" },
        });
        await tx.knowledgeBaseSource.updateMany({
          where: { id: sourceId, syncStatus: "syncing" },
          data: {
            syncLeaseExpiresAt: knowledgeSourceLeaseExpiry(waitingAt),
          },
        });
        await finalizeRunIfTerminal(tx, runId, waitingAt);
      });
    } catch (error) {
      const completedAt = this.now();
      const code =
        error instanceof AppError
          ? error.code
          : "KNOWLEDGE_SOURCE_SYNC_UNAVAILABLE";
      await this.prisma.$transaction(async (tx) => {
        const failed = await tx.knowledgeSourceSyncRun.updateMany({
          where: { id: runId, status: "running" },
          data: {
            status: "failed",
            phase: "completed",
            failurePhase: currentPhase,
            stableErrorCode: code,
            completedAt,
          },
        });
        if (failed.count === 1) {
          await tx.knowledgeBaseSource.updateMany({
            where: { id: sourceId, syncStatus: "syncing" },
            data: {
              syncStatus: "failed",
              stableErrorCode: code,
              syncLeaseExpiresAt: null,
              nextSyncAt: nextKnowledgeSourceSyncAt(
                schedule,
                source.createdAt,
                completedAt,
              ),
            },
          });
        }
      });
      throw new Error(code, { cause: error });
    }
  }

  private async applyDelta(
    source: {
      id: string;
      driveId: string;
      rootItemId: string;
      deltaLink: string | null;
    },
    graph: SharePointGraphClient,
    runId: string,
  ): Promise<string | null> {
    return applySharePointDeltaCheckpoint({
      prisma: this.prisma,
      source,
      graph,
      runId,
      now: this.now,
    });
  }

  private async buildWorkItems(
    source: {
      id: string;
      knowledgeBaseId: string;
      rootItemId: string;
      folderName: string;
    },
  ): Promise<KnowledgeSourceWorkItem[]> {
    return buildKnowledgeSourceWorkItems(this.prisma, source);
  }

  private async executeWorkItems(
    source: {
      id: string;
      knowledgeBaseId: string;
      driveId: string;
    },
    graph: SharePointGraphClient,
    actor: KnowledgeActor,
    runId: string,
    work: KnowledgeSourceWorkItem[],
  ): Promise<void> {
    return executeKnowledgeSourceWorkItems({
      prisma: this.prisma,
      knowledge: this.knowledge,
      source,
      graph,
      actor,
      runId,
      work,
      now: this.now,
      extendLease: () => this.extendLease(source.id),
    });
  }

  private async extendLease(sourceId: string): Promise<void> {
    const now = this.now();
    const extended = await this.prisma.knowledgeBaseSource.updateMany({
      where: { id: sourceId, syncStatus: "syncing" },
      data: { syncLeaseExpiresAt: knowledgeSourceLeaseExpiry(now) },
    });
    if (extended.count !== 1) {
      throw new AppError("KNOWLEDGE_SOURCE_SYNC_UNAVAILABLE");
    }
  }
}

function projectSource(source: {
  id: string;
  knowledgeBaseId: string;
  provider: string;
  sourceUrl: string;
  siteName: string;
  driveName: string;
  folderName: string;
  syncStatus: string;
  stableErrorCode: string | null;
  lastSyncedAt: Date | null;
  nextSyncAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
} & KnowledgeSourceScheduleRecord, run: {
  id: string;
  triggerType: string;
  status: string;
  phase: string;
  failurePhase: string | null;
  retryOfRunId: string | null;
  scannedCount: number;
  totalCount: number | null;
  processedCount: number;
  createdCount: number;
  updatedCount: number;
  deletedCount: number;
  skippedCount: number;
  retriedCount: number;
  failedCount: number;
  startedAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
} | null) {
  const progressPercent =
    run?.totalCount === null || run === null
      ? null
      : run.totalCount === 0
        ? run.status === "running"
          ? 0
          : 100
        : Math.min(
            100,
            Math.floor((run.processedCount / run.totalCount) * 100),
          );
  return knowledgeBaseSourceSchema.parse({
    id: source.id,
    knowledge_base_id: source.knowledgeBaseId,
    provider: source.provider,
    source_url: source.sourceUrl,
    site_name: source.siteName,
    drive_name: source.driveName,
    folder_name: source.folderName,
    sync_schedule: knowledgeSourceScheduleFromRecord(source),
    sync_status: source.syncStatus,
    retry_available: source.syncStatus === "failed",
    sync_progress:
      run === null
        ? null
        : {
            run_id: run.id,
            trigger: run.triggerType,
            status: run.status,
            phase: run.phase,
            failure_phase: run.failurePhase,
            retry_of_run_id: run.retryOfRunId,
            scanned_count: run.scannedCount,
            total_count: run.totalCount,
            processed_count: run.processedCount,
            created_count: run.createdCount,
            updated_count: run.updatedCount,
            deleted_count: run.deletedCount,
            skipped_count: run.skippedCount,
            retried_count: run.retriedCount,
            failed_count: run.failedCount,
            progress_percent: progressPercent,
            started_at: run.startedAt.toISOString(),
            updated_at: run.updatedAt.toISOString(),
            completed_at: run.completedAt?.toISOString() ?? null,
          },
    stable_error_code: source.stableErrorCode,
    last_synced_at: source.lastSyncedAt?.toISOString() ?? null,
    next_sync_at: source.nextSyncAt?.toISOString() ?? null,
    created_at: source.createdAt.toISOString(),
    updated_at: source.updatedAt.toISOString(),
  });
}

function parseKnowledgeSourceSchedule(
  input: KnowledgeSourceSyncSchedule,
): KnowledgeSourceSyncSchedule {
  try {
    return normalizeKnowledgeSourceSchedule(input);
  } catch {
    throw new AppError("VALIDATION_ERROR");
  }
}

function assertActiveAdmin(actor: KnowledgeActor) {
  if (actor.status !== "active") throw new AppError("USER_DISABLED");
  if (actor.role !== "admin") throw new AppError("FORBIDDEN");
}

function normalizeNullable(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

export type KnowledgeSourceResolvedFolder = SharePointResolvedFolder;
