import { randomUUID } from "node:crypto";

import { Redis } from "ioredis";
import pLimit from "p-limit";

import { Prisma, type PrismaClient } from "../../generated/prisma/client.js";
import { AppError } from "../../lib/errors.js";
import { sanitizeAuditMetadata } from "../audit/service.js";
import type { KnowledgeActor, KnowledgeAuditInput } from "./types.js";

export type KnowledgeMaintenanceStatus =
  "pending" | "running" | "failed" | "completed";

export type KnowledgeMaintenanceStage =
  | "pausing_processing"
  | "recreating_index"
  | "rebuilding_documents"
  | "reconciling";

export type KnowledgeMaintenanceTaskRecord = {
  id: string;
  status: KnowledgeMaintenanceStatus;
  requestedBy: string;
  reason: string;
  confirmedAt: Date;
  currentStage: KnowledgeMaintenanceStage | null;
  totalCount: bigint;
  succeededCount: bigint;
  failedCount: bigint;
  stableErrorCode: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type KnowledgeMaintenanceTaskView = {
  id: string;
  status: KnowledgeMaintenanceStatus;
  current_stage: KnowledgeMaintenanceStage | null;
  total_count: number;
  succeeded_count: number;
  failed_count: number;
  stable_error_code: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
};

export type KnowledgeMaintenanceDocumentTarget = {
  knowledgeBaseId: string;
  documentId: string;
  documentVersionId: string | null;
  processingGeneration: string | null;
};

export type KnowledgeMaintenanceRebuildResult = {
  embeddingProfileHash: string;
  chunkingConfigDigest: string;
  retrievalManifestSha256: string;
  indexIntegrityDigest: string;
  parentCount: number;
  childCount: number;
};

export type KnowledgeMaintenanceRecoveryTarget = {
  knowledgeBaseId: string;
  documentId: string;
  documentVersionId: string;
  expectedParentCount: number;
  expectedChildCount: number;
  expectedEmbeddingProfileHash: string;
  expectedIndexIntegrityDigest: string;
};

export interface KnowledgeMaintenanceStore {
  transaction<T>(
    work: (store: KnowledgeMaintenanceStore) => Promise<T>,
  ): Promise<T>;
  lockTaskCreation(): Promise<void>;
  findLatest(): Promise<KnowledgeMaintenanceTaskRecord | null>;
  findPending(): Promise<KnowledgeMaintenanceTaskRecord | null>;
  findRunning(): Promise<KnowledgeMaintenanceTaskRecord | null>;
  createTask(input: {
    id: string;
    actorId: string;
    reason: string;
    now: Date;
  }): Promise<KnowledgeMaintenanceTaskRecord>;
  startTask(taskId: string, now: Date): Promise<boolean>;
  updateStage(
    taskId: string,
    stage: KnowledgeMaintenanceStage,
    now: Date,
  ): Promise<void>;
  countTargets(): Promise<number>;
  listTargetPage(input: {
    afterDocumentId: string | null;
    limit: number;
  }): Promise<KnowledgeMaintenanceDocumentTarget[]>;
  setTotalCount(taskId: string, totalCount: number, now: Date): Promise<void>;
  recordDocumentResult(input: {
    taskId: string;
    target: KnowledgeMaintenanceDocumentTarget;
    result: KnowledgeMaintenanceRebuildResult | null;
    now: Date;
  }): Promise<void>;
  resolveRecoveryTarget(input: {
    documentId: string;
    expectedEmbeddingProfileHash: string;
  }): Promise<KnowledgeMaintenanceRecoveryTarget | null>;
  completeRecoveredTask(input: {
    taskId: string;
    expectedTotalCount: number;
    expectedEmbeddingProfileHash: string;
    now: Date;
  }): Promise<boolean>;
  completeTask(taskId: string, now: Date): Promise<void>;
  failTask(taskId: string, errorCode: string, now: Date): Promise<void>;
  writeAudit(input: KnowledgeAuditInput): Promise<void>;
}

export interface KnowledgeMaintenanceIndex {
  recreateIndex(): Promise<void>;
  verifyIndexContract(): Promise<void>;
}

export interface KnowledgeMaintenanceRebuildExecutor {
  rebuild(
    input: {
      target: KnowledgeMaintenanceDocumentTarget;
      requestedBy: string;
    },
    signal?: AbortSignal,
  ): Promise<KnowledgeMaintenanceRebuildResult>;
}

export interface KnowledgeMaintenanceRecoveryIndex {
  reconcileActiveDocumentVersion(input: {
    knowledgeBaseId: string;
    documentId: string;
    activeDocumentVersionId: string;
    expectedParentCount: number;
    expectedChildCount: number;
    expectedEmbeddingProfileHash: string;
    expectedIndexIntegrityDigest: string;
  }): Promise<void>;
}

export type KnowledgeMaintenanceRecoveryDependencies = {
  index: KnowledgeMaintenanceRecoveryIndex;
  currentEmbeddingProfileHash: () => string | undefined;
  runDocumentExclusive<T>(
    documentId: string,
    operation: (signal: AbortSignal) => Promise<T>,
  ): Promise<T>;
};

export interface KnowledgeMaintenanceProcessingControl {
  pauseAndWait(signal?: AbortSignal): Promise<void>;
  resumeDocumentRebuilds(): Promise<void>;
  resume(): Promise<void>;
}

export interface KnowledgeMaintenanceLock {
  tryRunExclusive<T>(
    operation: (signal: AbortSignal) => Promise<T>,
  ): Promise<{ acquired: true; value: T } | { acquired: false }>;
  close(): Promise<void>;
}

export interface KnowledgeMaintenanceGate {
  isBlocked(): Promise<boolean>;
  isDocumentRebuildExecutionAvailable(): Promise<boolean>;
  assertAvailable(): Promise<void>;
  assertDocumentRebuildAvailable(): Promise<void>;
}

export class KnowledgeMaintenanceService {
  constructor(
    private readonly store: KnowledgeMaintenanceStore,
    private readonly options: {
      now?: () => Date;
      createId?: () => string;
    } = {},
  ) {}

  async getLatest(
    actor: KnowledgeActor,
  ): Promise<KnowledgeMaintenanceTaskView | null> {
    assertAdmin(actor);
    const task = await this.store.findLatest();
    return task === null ? null : taskView(task);
  }

  async requestRebuild(
    actor: KnowledgeActor,
    input: { reason: string; confirmed: true },
  ): Promise<KnowledgeMaintenanceTaskView> {
    assertAdmin(actor);
    const reason = requiredReason(input.reason);
    if (input.confirmed !== true) throw new AppError("VALIDATION_ERROR");
    const now = this.now();
    const task = await this.store.transaction(async (store) => {
      await store.lockTaskCreation();
      const latest = await store.findLatest();
      if (latest?.status === "pending" || latest?.status === "running") {
        throw new AppError("KNOWLEDGE_MAINTENANCE_IN_PROGRESS");
      }
      const created = await store.createTask({
        id: (this.options.createId ?? randomUUID)(),
        actorId: actor.id,
        reason,
        now,
      });
      await store.writeAudit({
        actorId: actor.id,
        action: "knowledge_base.maintenance_rebuild_requested",
        targetType: "knowledge_base_maintenance_task",
        targetId: created.id,
        result: "success",
        metadata: {
          reason,
          confirmed_at: now.toISOString(),
          scope: "all_documents",
        },
        ipAddress: actor.ipAddress ?? null,
        userAgent: actor.userAgent ?? null,
      });
      return created;
    });
    return taskView(task);
  }

  private now(): Date {
    return (this.options.now ?? (() => new Date()))();
  }
}

export class KnowledgeMaintenanceWorker {
  private timer: NodeJS.Timeout | null = null;
  private inFlight: Promise<void> | null = null;
  private runController: AbortController | null = null;
  private started = false;
  private failedTaskRecoveryRequested = false;

  constructor(
    private readonly store: KnowledgeMaintenanceStore,
    private readonly lock: KnowledgeMaintenanceLock,
    private readonly processing: KnowledgeMaintenanceProcessingControl,
    private readonly index: KnowledgeMaintenanceIndex,
    private readonly executor: KnowledgeMaintenanceRebuildExecutor,
    private readonly options: {
      pollIntervalMs?: number;
      targetPageSize?: number;
      rebuildConcurrency?: number;
      now?: () => Date;
      recovery?: KnowledgeMaintenanceRecoveryDependencies;
    } = {},
  ) {}

  async start(): Promise<void> {
    if (this.started) return;
    await this.reconcileInterruptedTask();
    this.failedTaskRecoveryRequested = true;
    const latest = await this.store.findLatest();
    if (latest?.status === "completed" || latest?.status === "failed") {
      await this.processing.resume();
    } else if (latest?.status === "pending" || latest?.status === "running") {
      await this.processing.pauseAndWait();
    }
    this.started = true;
    this.runController = new AbortController();
    this.timer = setInterval(() => {
      this.triggerCycle();
    }, this.options.pollIntervalMs ?? 5_000);
    this.timer.unref();
    this.triggerCycle();
  }

  requestFailedTaskRecovery(): void {
    this.failedTaskRecoveryRequested = true;
    this.triggerCycle();
  }

  async close(): Promise<void> {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.started = false;
    this.runController?.abort();
    this.runController = null;
    await this.inFlight;
    this.inFlight = null;
    await this.lock.close();
  }

  async runOnce(lifecycleSignal?: AbortSignal): Promise<boolean> {
    if (lifecycleSignal?.aborted) return false;
    const pending = await this.store.findPending();
    if (pending !== null && !lifecycleSignal?.aborted) {
      const result = await this.lock.tryRunExclusive(async (lockSignal) => {
        const combined = combineAbortSignals(lockSignal, lifecycleSignal);
        try {
          if (combined.signal.aborted) return;
          await this.execute(pending.id, pending.requestedBy, combined.signal);
        } finally {
          combined.dispose();
        }
      });
      return result.acquired;
    }
    return this.runFailedTaskRecovery(lifecycleSignal);
  }

  private triggerCycle(): void {
    if (!this.started || this.inFlight !== null) return;
    const signal = this.runController?.signal;
    const cycle = this.runOnce(signal)
      .then(() => undefined)
      .catch(() => undefined);
    this.inFlight = cycle;
    void cycle.finally(() => {
      if (this.inFlight === cycle) this.inFlight = null;
    });
  }

  private async reconcileInterruptedTask(): Promise<void> {
    const running = await this.store.findRunning();
    if (running === null) return;
    const result = await this.lock.tryRunExclusive(async () => {
      await this.store.failTask(
        running.id,
        "KNOWLEDGE_MAINTENANCE_INTERRUPTED",
        this.now(),
      );
    });
    // A busy lock means another live API worker still owns this task.
    if (!result.acquired) return;
  }

  private async execute(
    taskId: string,
    requestedBy: string,
    signal: AbortSignal,
  ): Promise<void> {
    if (!(await this.store.startTask(taskId, this.now()))) return;
    try {
      await this.store.updateStage(taskId, "pausing_processing", this.now());
      await this.processing.pauseAndWait(signal);
      assertNotAborted(signal);
      await this.store.updateStage(taskId, "recreating_index", this.now());
      await this.index.recreateIndex();
      assertNotAborted(signal);
      await this.store.updateStage(taskId, "rebuilding_documents", this.now());
      // Manual single-document rebuilds use a dedicated lane. It must remain
      // paused until the shared index has been recreated, otherwise a repair
      // accepted during the pending/recreating stages could be erased by the
      // deployment-wide rebuild moments later.
      await this.processing.resumeDocumentRebuilds();
      const totalCount = await this.store.countTargets();
      await this.store.setTotalCount(taskId, totalCount, this.now());
      const pageSize = this.targetPageSize();
      const rebuildLimit = pLimit(this.rebuildConcurrency());
      let afterDocumentId: string | null = null;
      while (true) {
        const targets = await this.store.listTargetPage({
          afterDocumentId,
          limit: pageSize,
        });
        if (targets.length === 0) break;
        const outcomes = await Promise.allSettled(
          targets.map((target) =>
            rebuildLimit(async () => {
              if (signal.aborted) throw new Error("maintenance lock lost");
              try {
                const result =
                  target.documentVersionId === null ||
                  target.processingGeneration === null
                    ? null
                    : await this.executor.rebuild(
                        { target, requestedBy },
                        signal,
                      );
                await this.store.recordDocumentResult({
                  taskId,
                  target,
                  result,
                  now: this.now(),
                });
              } catch {
                await this.store.recordDocumentResult({
                  taskId,
                  target,
                  result: null,
                  now: this.now(),
                });
              }
            }),
          ),
        );
        const rejected = outcomes.find(
          (outcome): outcome is PromiseRejectedResult =>
            outcome.status === "rejected",
        );
        if (rejected) throw rejected.reason;
        const lastTarget = targets.at(-1);
        if (lastTarget === undefined) break;
        afterDocumentId = lastTarget.documentId;
        if (signal.aborted) {
          throw new Error("maintenance lock lost");
        }
        if (targets.length < pageSize) break;
      }
      assertNotAborted(signal);
      await this.store.updateStage(taskId, "reconciling", this.now());
      await this.index.verifyIndexContract();
      assertNotAborted(signal);
      const task = await this.store.findLatest();
      if (task?.id !== taskId || task.failedCount > 0n) {
        await this.store.failTask(
          taskId,
          "KNOWLEDGE_MAINTENANCE_DOCUMENT_FAILURE",
          this.now(),
        );
        this.failedTaskRecoveryRequested = true;
        await this.processing.resume();
        return;
      }
      await this.store.completeTask(taskId, this.now());
      await this.processing.resume();
    } catch {
      await this.store.failTask(
        taskId,
        "KNOWLEDGE_MAINTENANCE_REBUILD_FAILED",
        this.now(),
      );
      // Retrieval remains blocked by the failed maintenance record. Resume the
      // normal queues so owners can repair individual documents before an
      // administrator explicitly retries the deployment-wide rebuild.
      await this.processing.resume();
    }
  }

  private async runFailedTaskRecovery(
    lifecycleSignal?: AbortSignal,
  ): Promise<boolean> {
    if (!this.failedTaskRecoveryRequested || lifecycleSignal?.aborted) {
      return false;
    }
    const recovery = this.options.recovery;
    if (recovery === undefined) {
      this.failedTaskRecoveryRequested = false;
      return false;
    }
    const expectedEmbeddingProfileHash =
      recovery.currentEmbeddingProfileHash();
    if (!isSha256(expectedEmbeddingProfileHash)) {
      // Governance starts before the processing runtime resolves the live
      // model profile. Keep the request pending for the next worker tick.
      return false;
    }
    const latest = await this.store.findLatest();
    if (!isRecoverableFailedTask(latest)) {
      this.failedTaskRecoveryRequested = false;
      return false;
    }
    const result = await this.lock.tryRunExclusive(async (lockSignal) => {
      const combined = combineAbortSignals(lockSignal, lifecycleSignal);
      this.failedTaskRecoveryRequested = false;
      try {
        if (combined.signal.aborted) return false;
        return await this.recoverFailedTask({
          taskId: latest.id,
          expectedEmbeddingProfileHash,
          signal: combined.signal,
          recovery,
        });
      } catch {
        return false;
      } finally {
        combined.dispose();
      }
    });
    return result.acquired;
  }

  private async recoverFailedTask(input: {
    taskId: string;
    expectedEmbeddingProfileHash: string;
    signal: AbortSignal;
    recovery: KnowledgeMaintenanceRecoveryDependencies;
  }): Promise<boolean> {
    const latest = await this.store.findLatest();
    if (!isRecoverableFailedTask(latest) || latest.id !== input.taskId) {
      return false;
    }
    await this.index.verifyIndexContract();
    assertNotAborted(input.signal);
    const totalCount = await this.store.countTargets();
    const pageSize = this.targetPageSize();
    const verificationLimit = pLimit(this.rebuildConcurrency());
    let verifiedCount = 0;
    let afterDocumentId: string | null = null;
    while (true) {
      const targets = await this.store.listTargetPage({
        afterDocumentId,
        limit: pageSize,
      });
      if (targets.length === 0) break;
      const outcomes = await Promise.allSettled(
        targets.map((target) =>
          verificationLimit(async () => {
            assertNotAborted(input.signal);
            await input.recovery.runDocumentExclusive(
              target.documentId,
              async (documentSignal) => {
                const combined = combineAbortSignals(
                  input.signal,
                  documentSignal,
                );
                try {
                  assertNotAborted(combined.signal);
                  const current = await this.store.resolveRecoveryTarget({
                    documentId: target.documentId,
                    expectedEmbeddingProfileHash:
                      input.expectedEmbeddingProfileHash,
                  });
                  if (current === null) {
                    throw new Error("knowledge maintenance target is not ready");
                  }
                  await input.recovery.index.reconcileActiveDocumentVersion({
                    knowledgeBaseId: current.knowledgeBaseId,
                    documentId: current.documentId,
                    activeDocumentVersionId: current.documentVersionId,
                    expectedParentCount: current.expectedParentCount,
                    expectedChildCount: current.expectedChildCount,
                    expectedEmbeddingProfileHash:
                      current.expectedEmbeddingProfileHash,
                    expectedIndexIntegrityDigest:
                      current.expectedIndexIntegrityDigest,
                  });
                } finally {
                  combined.dispose();
                }
              },
            );
            verifiedCount += 1;
          }),
        ),
      );
      if (outcomes.some((outcome) => outcome.status === "rejected")) {
        return false;
      }
      const lastTarget = targets.at(-1);
      if (lastTarget === undefined) break;
      afterDocumentId = lastTarget.documentId;
      assertNotAborted(input.signal);
      if (targets.length < pageSize) break;
    }
    if (
      verifiedCount !== totalCount ||
      input.recovery.currentEmbeddingProfileHash() !==
        input.expectedEmbeddingProfileHash
    ) {
      return false;
    }
    return this.store.completeRecoveredTask({
      taskId: input.taskId,
      expectedTotalCount: totalCount,
      expectedEmbeddingProfileHash: input.expectedEmbeddingProfileHash,
      now: this.now(),
    });
  }

  private now(): Date {
    return (this.options.now ?? (() => new Date()))();
  }

  private targetPageSize(): number {
    const pageSize = this.options.targetPageSize ?? 100;
    if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 1_000) {
      throw new AppError("INTERNAL_ERROR");
    }
    return pageSize;
  }

  private rebuildConcurrency(): number {
    const concurrency = this.options.rebuildConcurrency ?? 3;
    if (
      !Number.isSafeInteger(concurrency) ||
      concurrency < 1 ||
      concurrency > 16
    ) {
      throw new AppError("INTERNAL_ERROR");
    }
    return concurrency;
  }
}

export class PrismaKnowledgeMaintenanceGate implements KnowledgeMaintenanceGate {
  constructor(private readonly prisma: PrismaClient) {}

  async isBlocked(): Promise<boolean> {
    const latest = await this.prisma.knowledgeBaseMaintenanceTask.findFirst({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { status: true },
    });
    return (
      latest?.status === "pending" ||
      latest?.status === "running" ||
      latest?.status === "failed"
    );
  }

  async assertAvailable(): Promise<void> {
    if (await this.isBlocked()) {
      throw new AppError("KNOWLEDGE_MAINTENANCE_UNAVAILABLE");
    }
  }

  async assertDocumentRebuildAvailable(): Promise<void> {
    // A single-document rebuild is the only processing operation admitted
    // during deployment-wide maintenance. The scheduler routes it to an
    // isolated lane and holds that lane until index recreation has completed.
  }

  async isDocumentRebuildExecutionAvailable(): Promise<boolean> {
    const latest = await this.prisma.knowledgeBaseMaintenanceTask.findFirst({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { status: true, currentStage: true },
    });
    if (latest?.status !== "pending" && latest?.status !== "running") {
      return true;
    }
    return (
      latest.status === "running" &&
      (latest.currentStage === "rebuilding_documents" ||
        latest.currentStage === "reconciling")
    );
  }
}

export class PrismaKnowledgeMaintenanceStore implements KnowledgeMaintenanceStore {
  constructor(
    private readonly root: PrismaClient,
    private readonly database: PrismaClient | Prisma.TransactionClient = root,
  ) {}

  async transaction<T>(
    work: (store: KnowledgeMaintenanceStore) => Promise<T>,
  ): Promise<T> {
    if (this.database !== this.root) return work(this);
    return this.root.$transaction((transaction) =>
      work(new PrismaKnowledgeMaintenanceStore(this.root, transaction)),
    );
  }

  async lockTaskCreation(): Promise<void> {
    await this.database.$queryRaw<Array<{ lockResult: string }>>`
      SELECT pg_advisory_xact_lock(
        hashtext('linksense:knowledge:maintenance:create')
      )::text AS "lockResult"
    `;
  }

  findLatest(): Promise<KnowledgeMaintenanceTaskRecord | null> {
    return this.findTask({});
  }

  findPending(): Promise<KnowledgeMaintenanceTaskRecord | null> {
    return this.findTask({ status: "pending" });
  }

  findRunning(): Promise<KnowledgeMaintenanceTaskRecord | null> {
    return this.findTask({ status: "running" });
  }

  async createTask(input: {
    id: string;
    actorId: string;
    reason: string;
    now: Date;
  }): Promise<KnowledgeMaintenanceTaskRecord> {
    const totalCount = await this.countTargets();
    return taskRecord(
      await this.database.knowledgeBaseMaintenanceTask.create({
        data: {
          id: input.id,
          taskType: "rebuild_all_vectors",
          scope: "all_documents",
          status: "pending",
          requestedBy: input.actorId,
          reason: input.reason,
          confirmedAt: input.now,
          totalCount,
          createdAt: input.now,
          updatedAt: input.now,
        },
      }),
    );
  }

  async startTask(taskId: string, now: Date): Promise<boolean> {
    const result = await this.database.knowledgeBaseMaintenanceTask.updateMany({
      where: { id: taskId, status: "pending" },
      data: {
        status: "running",
        currentStage: "pausing_processing",
        stableErrorCode: null,
        startedAt: now,
        completedAt: null,
        updatedAt: now,
      },
    });
    return result.count === 1;
  }

  async updateStage(
    taskId: string,
    stage: KnowledgeMaintenanceStage,
    now: Date,
  ): Promise<void> {
    await this.database.knowledgeBaseMaintenanceTask.updateMany({
      where: { id: taskId, status: "running" },
      data: { currentStage: stage, updatedAt: now },
    });
  }

  async countTargets(): Promise<number> {
    const rows = await this.database.$queryRaw<Array<{ total: bigint }>>`
      SELECT COUNT(*)::bigint AS "total"
      FROM "knowledge_base_documents" AS document
      INNER JOIN "knowledge_bases" AS knowledge_base
        ON knowledge_base."id" = document."knowledge_base_id"
      WHERE document."status" <> 'deleted'
        AND knowledge_base."lifecycle_status" <> 'deleted'
    `;
    const total = rows[0]?.total ?? 0n;
    const totalCount = Number(total);
    if (!Number.isSafeInteger(totalCount) || totalCount < 0) {
      throw new AppError("INTERNAL_ERROR");
    }
    return totalCount;
  }

  async listTargetPage(input: {
    afterDocumentId: string | null;
    limit: number;
  }): Promise<KnowledgeMaintenanceDocumentTarget[]> {
    if (
      !Number.isSafeInteger(input.limit) ||
      input.limit < 1 ||
      input.limit > 1_000
    ) {
      throw new AppError("INTERNAL_ERROR");
    }
    const cursorFilter = input.afterDocumentId
      ? Prisma.sql`AND document."id" > ${input.afterDocumentId}::uuid`
      : Prisma.empty;
    const rows = await this.database.$queryRaw<
      Array<{
        knowledgeBaseId: string;
        documentId: string;
        documentVersionId: string | null;
        processingGeneration: string | null;
      }>
    >(Prisma.sql`
      SELECT
        document."knowledge_base_id" AS "knowledgeBaseId",
        document."id" AS "documentId",
        current_version."id" AS "documentVersionId",
        current_version."processing_generation" AS "processingGeneration"
      FROM "knowledge_base_documents" AS document
      INNER JOIN "knowledge_bases" AS knowledge_base
        ON knowledge_base."id" = document."knowledge_base_id"
      LEFT JOIN "knowledge_base_document_versions" AS current_version
        ON current_version."id" = document."current_version_id"
      WHERE document."status" <> 'deleted'
        AND knowledge_base."lifecycle_status" <> 'deleted'
        ${cursorFilter}
      ORDER BY document."id" ASC
      LIMIT ${input.limit}
    `);
    return rows;
  }

  async setTotalCount(
    taskId: string,
    totalCount: number,
    now: Date,
  ): Promise<void> {
    if (!Number.isSafeInteger(totalCount) || totalCount < 0) {
      throw new AppError("INTERNAL_ERROR");
    }
    await this.database.knowledgeBaseMaintenanceTask.updateMany({
      where: {
        id: taskId,
        status: "running",
        succeededCount: 0,
        failedCount: 0,
      },
      data: { totalCount, updatedAt: now },
    });
  }

  async recordDocumentResult(input: {
    taskId: string;
    target: KnowledgeMaintenanceDocumentTarget;
    result: KnowledgeMaintenanceRebuildResult | null;
    now: Date;
  }): Promise<void> {
    await this.root.$transaction(async (transaction) => {
      await transaction.$queryRawUnsafe(
        'SELECT "id" FROM "knowledge_base_maintenance_tasks" WHERE "id" = $1::uuid FOR UPDATE',
        input.taskId,
      );
      const task = await transaction.knowledgeBaseMaintenanceTask.findUnique({
        where: { id: input.taskId },
        select: {
          status: true,
          totalCount: true,
          succeededCount: true,
          failedCount: true,
        },
      });
      if (task?.status !== "running") return;
      if (task.succeededCount + task.failedCount >= task.totalCount) return;
      let succeeded =
        input.result !== null && input.target.documentVersionId !== null;
      if (
        succeeded &&
        input.result !== null &&
        input.target.documentVersionId !== null
      ) {
        const versionUpdate =
          await transaction.knowledgeBaseDocumentVersion.updateMany({
            where: {
              id: input.target.documentVersionId,
              documentId: input.target.documentId,
              versionStatus: { in: ["ready", "superseded"] },
            },
            data: {
              embeddingProfileHash: input.result.embeddingProfileHash,
              chunkingConfigDigest: input.result.chunkingConfigDigest,
              retrievalManifestSha256: input.result.retrievalManifestSha256,
              indexIntegrityDigest: input.result.indexIntegrityDigest,
              parentCount: input.result.parentCount,
              childCount: input.result.childCount,
              indexReady: true,
              updatedAt: input.now,
            },
          });
        const documentUpdate =
          await transaction.knowledgeBaseDocument.updateMany({
            where: {
              id: input.target.documentId,
              knowledgeBaseId: input.target.knowledgeBaseId,
              currentVersionId: input.target.documentVersionId,
              status: { not: "deleted" },
            },
            data: {
              embeddingProfileHash: input.result.embeddingProfileHash,
              chunkingConfigDigest: input.result.chunkingConfigDigest,
              retrievalManifestSha256: input.result.retrievalManifestSha256,
              indexIntegrityDigest: input.result.indexIntegrityDigest,
              stableErrorCode: null,
              updatedAt: input.now,
            },
          });
        succeeded = versionUpdate.count === 1 && documentUpdate.count === 1;
      }
      await transaction.knowledgeBaseMaintenanceTask.update({
        where: { id: input.taskId },
        data: {
          ...(succeeded
            ? { succeededCount: { increment: 1 } }
            : { failedCount: { increment: 1 } }),
          updatedAt: input.now,
        },
      });
    });
  }

  async resolveRecoveryTarget(input: {
    documentId: string;
    expectedEmbeddingProfileHash: string;
  }): Promise<KnowledgeMaintenanceRecoveryTarget | null> {
    assertSha256(input.expectedEmbeddingProfileHash);
    const rows = await this.database.$queryRaw<
      KnowledgeMaintenanceRecoveryTarget[]
    >(Prisma.sql`
      SELECT
        document."knowledge_base_id" AS "knowledgeBaseId",
        document."id" AS "documentId",
        current_version."id" AS "documentVersionId",
        current_version."parent_count" AS "expectedParentCount",
        current_version."child_count" AS "expectedChildCount",
        current_version."embedding_profile_hash" AS "expectedEmbeddingProfileHash",
        current_version."index_integrity_digest" AS "expectedIndexIntegrityDigest"
      FROM "knowledge_base_documents" AS document
      INNER JOIN "knowledge_bases" AS knowledge_base
        ON knowledge_base."id" = document."knowledge_base_id"
      INNER JOIN "knowledge_base_document_versions" AS current_version
        ON current_version."id" = document."current_version_id"
      WHERE document."id" = ${input.documentId}::uuid
        AND document."status" <> 'deleted'
        AND knowledge_base."lifecycle_status" <> 'deleted'
        AND ${recoveryCompatibilityPredicate({
          expectedEmbeddingProfileHash: input.expectedEmbeddingProfileHash,
        })}
      LIMIT 1
    `);
    return rows[0] ?? null;
  }

  async completeRecoveredTask(input: {
    taskId: string;
    expectedTotalCount: number;
    expectedEmbeddingProfileHash: string;
    now: Date;
  }): Promise<boolean> {
    if (
      !Number.isSafeInteger(input.expectedTotalCount) ||
      input.expectedTotalCount < 0
    ) {
      throw new AppError("INTERNAL_ERROR");
    }
    assertSha256(input.expectedEmbeddingProfileHash);
    return this.root.$transaction(async (transaction) => {
      await transaction.$queryRawUnsafe(
        'SELECT "id" FROM "knowledge_base_maintenance_tasks" WHERE "id" = $1::uuid FOR UPDATE',
        input.taskId,
      );
      const task =
        await transaction.knowledgeBaseMaintenanceTask.findUnique({
          where: { id: input.taskId },
          select: {
            status: true,
            requestedBy: true,
            stableErrorCode: true,
          },
        });
      const latest =
        await transaction.knowledgeBaseMaintenanceTask.findFirst({
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          select: { id: true },
        });
      const projectionRows = await transaction.$queryRaw<
        Array<{ totalCount: bigint; compatibleCount: bigint }>
      >(Prisma.sql`
        SELECT
          COUNT(*)::bigint AS "totalCount",
          COUNT(*) FILTER (
            WHERE ${recoveryCompatibilityPredicate({
              expectedEmbeddingProfileHash: input.expectedEmbeddingProfileHash,
            })}
          )::bigint AS "compatibleCount"
        FROM "knowledge_base_documents" AS document
        INNER JOIN "knowledge_bases" AS knowledge_base
          ON knowledge_base."id" = document."knowledge_base_id"
        LEFT JOIN "knowledge_base_document_versions" AS current_version
          ON current_version."id" = document."current_version_id"
        WHERE document."status" <> 'deleted'
          AND knowledge_base."lifecycle_status" <> 'deleted'
      `);
      const expectedTotalCount = BigInt(input.expectedTotalCount);
      const projection = projectionRows[0];
      if (
        task?.status !== "failed" ||
        task.stableErrorCode !== "KNOWLEDGE_MAINTENANCE_DOCUMENT_FAILURE" ||
        latest?.id !== input.taskId ||
        projection?.totalCount !== expectedTotalCount ||
        projection.compatibleCount !== expectedTotalCount
      ) {
        return false;
      }
      await transaction.knowledgeBaseMaintenanceTask.update({
        where: { id: input.taskId },
        data: {
          status: "completed",
          currentStage: "reconciling",
          totalCount: expectedTotalCount,
          succeededCount: expectedTotalCount,
          failedCount: 0,
          stableErrorCode: null,
          completedAt: input.now,
          updatedAt: input.now,
        },
      });
      await transaction.auditLog.create({
        data: {
          actorId: task.requestedBy,
          action: "knowledge_base.maintenance_rebuild_completed",
          targetType: "knowledge_base_maintenance_task",
          targetId: input.taskId,
          result: "success",
          metadataJson: sanitizeAuditMetadata(
            "knowledge_base.maintenance_rebuild_completed",
            {
              scope: "all_documents",
              total_count: input.expectedTotalCount,
              succeeded_count: input.expectedTotalCount,
              failed_count: 0,
            },
          ),
        },
      });
      return true;
    });
  }

  async completeTask(taskId: string, now: Date): Promise<void> {
    await this.root.$transaction(async (transaction) => {
      await transaction.$queryRawUnsafe(
        'SELECT "id" FROM "knowledge_base_maintenance_tasks" WHERE "id" = $1::uuid FOR UPDATE',
        taskId,
      );
      const task = await transaction.knowledgeBaseMaintenanceTask.findUnique({
        where: { id: taskId },
        select: {
          status: true,
          requestedBy: true,
          totalCount: true,
          succeededCount: true,
          failedCount: true,
        },
      });
      if (
        task?.status !== "running" ||
        task.failedCount !== 0n ||
        task.succeededCount !== task.totalCount
      ) {
        throw new AppError("INTERNAL_ERROR");
      }
      await transaction.knowledgeBaseMaintenanceTask.update({
        where: { id: taskId },
        data: {
          status: "completed",
          currentStage: "reconciling",
          stableErrorCode: null,
          completedAt: now,
          updatedAt: now,
        },
      });
      await transaction.auditLog.create({
        data: {
          actorId: task.requestedBy,
          action: "knowledge_base.maintenance_rebuild_completed",
          targetType: "knowledge_base_maintenance_task",
          targetId: taskId,
          result: "success",
          metadataJson: sanitizeAuditMetadata(
            "knowledge_base.maintenance_rebuild_completed",
            {
              scope: "all_documents",
              total_count: Number(task.totalCount),
              succeeded_count: Number(task.succeededCount),
              failed_count: Number(task.failedCount),
            },
          ),
        },
      });
    });
  }

  async failTask(taskId: string, errorCode: string, now: Date): Promise<void> {
    await this.root.$transaction(async (transaction) => {
      await transaction.$queryRawUnsafe(
        'SELECT "id" FROM "knowledge_base_maintenance_tasks" WHERE "id" = $1::uuid FOR UPDATE',
        taskId,
      );
      const task = await transaction.knowledgeBaseMaintenanceTask.findUnique({
        where: { id: taskId },
        select: {
          status: true,
          requestedBy: true,
          totalCount: true,
          succeededCount: true,
          failedCount: true,
        },
      });
      if (task === null || !["pending", "running"].includes(task.status))
        return;
      await transaction.knowledgeBaseMaintenanceTask.update({
        where: { id: taskId },
        data: {
          status: "failed",
          stableErrorCode: errorCode,
          completedAt: now,
          updatedAt: now,
        },
      });
      await transaction.auditLog.create({
        data: {
          actorId: task.requestedBy,
          action: "knowledge_base.maintenance_rebuild_failed",
          targetType: "knowledge_base_maintenance_task",
          targetId: taskId,
          result: "failure",
          metadataJson: sanitizeAuditMetadata(
            "knowledge_base.maintenance_rebuild_failed",
            {
              scope: "all_documents",
              total_count: Number(task.totalCount),
              succeeded_count: Number(task.succeededCount),
              failed_count: Number(task.failedCount),
              stable_error_code: errorCode,
            },
          ),
        },
      });
    });
  }

  async writeAudit(input: KnowledgeAuditInput): Promise<void> {
    await this.database.auditLog.create({
      data: {
        actorId: input.actorId,
        action: input.action,
        targetType: input.targetType ?? null,
        targetId: input.targetId ?? null,
        result: input.result,
        metadataJson: sanitizeAuditMetadata(input.action, input.metadata ?? {}),
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
      },
    });
  }

  private async findTask(
    where: Prisma.KnowledgeBaseMaintenanceTaskWhereInput,
  ): Promise<KnowledgeMaintenanceTaskRecord | null> {
    const task = await this.database.knowledgeBaseMaintenanceTask.findFirst({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    return task === null ? null : taskRecord(task);
  }
}

const renewLockScript = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("PEXPIRE", KEYS[1], ARGV[2])
end
return 0
`;

const releaseLockScript = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
end
return 0
`;

export class RedisKnowledgeMaintenanceLock implements KnowledgeMaintenanceLock {
  private readonly redis: Redis;

  constructor(
    redisUrl: string,
    private readonly options: { leaseMs?: number; renewalMs?: number } = {},
    redis?: Redis,
  ) {
    this.redis = redis ?? new Redis(redisUrl, { maxRetriesPerRequest: null });
  }

  async tryRunExclusive<T>(
    operation: (signal: AbortSignal) => Promise<T>,
  ): Promise<{ acquired: true; value: T } | { acquired: false }> {
    const key = "linksense:knowledge:maintenance:rebuild-all:lock";
    const token = randomUUID();
    const leaseMs = this.options.leaseMs ?? 60_000;
    const renewalMs = this.options.renewalMs ?? 20_000;
    const acquired = await this.redis.set(key, token, "PX", leaseMs, "NX");
    if (acquired !== "OK") return { acquired: false };
    const stopController = new AbortController();
    const lostController = new AbortController();
    const renewal = this.renew({
      key,
      token,
      leaseMs,
      renewalMs,
      stopSignal: stopController.signal,
      lostController,
    });
    try {
      const value = await operation(lostController.signal);
      if (lostController.signal.aborted)
        throw new Error("maintenance lock lost");
      return { acquired: true, value };
    } finally {
      stopController.abort();
      await renewal;
      await this.redis
        .eval(releaseLockScript, 1, key, token)
        .catch(() => undefined);
    }
  }

  close(): Promise<void> {
    return this.redis.quit().then(() => undefined);
  }

  private async renew(input: {
    key: string;
    token: string;
    leaseMs: number;
    renewalMs: number;
    stopSignal: AbortSignal;
    lostController: AbortController;
  }): Promise<void> {
    while (!input.stopSignal.aborted) {
      try {
        await abortableDelay(input.renewalMs, input.stopSignal);
      } catch {
        return;
      }
      try {
        const renewed = await this.redis.eval(
          renewLockScript,
          1,
          input.key,
          input.token,
          String(input.leaseMs),
        );
        if (Number(renewed) !== 1) {
          input.lostController.abort();
          return;
        }
      } catch {
        input.lostController.abort();
        return;
      }
    }
  }
}

function taskRecord(
  value: Prisma.KnowledgeBaseMaintenanceTaskModel,
): KnowledgeMaintenanceTaskRecord {
  return {
    id: value.id,
    status: value.status as KnowledgeMaintenanceStatus,
    requestedBy: value.requestedBy,
    reason: value.reason,
    confirmedAt: value.confirmedAt,
    currentStage: value.currentStage as KnowledgeMaintenanceStage | null,
    totalCount: value.totalCount,
    succeededCount: value.succeededCount,
    failedCount: value.failedCount,
    stableErrorCode: value.stableErrorCode,
    startedAt: value.startedAt,
    completedAt: value.completedAt,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

function taskView(
  task: KnowledgeMaintenanceTaskRecord,
): KnowledgeMaintenanceTaskView {
  return {
    id: task.id,
    status: task.status,
    current_stage: task.currentStage,
    total_count: safeCount(task.totalCount),
    succeeded_count: safeCount(task.succeededCount),
    failed_count: safeCount(task.failedCount),
    stable_error_code: task.stableErrorCode,
    created_at: task.createdAt.toISOString(),
    started_at: task.startedAt?.toISOString() ?? null,
    completed_at: task.completedAt?.toISOString() ?? null,
  };
}

function safeCount(value: bigint): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 0)
    throw new AppError("INTERNAL_ERROR");
  return result;
}

function requiredReason(value: string): string {
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > 1_000) {
    throw new AppError("VALIDATION_ERROR");
  }
  return normalized;
}

function assertAdmin(actor: KnowledgeActor): void {
  if (actor.status !== "active") throw new AppError("USER_DISABLED");
  if (actor.role !== "admin") throw new AppError("FORBIDDEN");
}

function assertNotAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new Error("maintenance cancelled");
}

function isRecoverableFailedTask(
  task: KnowledgeMaintenanceTaskRecord | null,
): task is KnowledgeMaintenanceTaskRecord {
  return (
    task?.status === "failed" &&
    task.stableErrorCode === "KNOWLEDGE_MAINTENANCE_DOCUMENT_FAILURE"
  );
}

function isSha256(value: string | null | undefined): value is string {
  return /^[a-f0-9]{64}$/u.test(value ?? "");
}

function assertSha256(value: string): void {
  if (!isSha256(value)) throw new AppError("INTERNAL_ERROR");
}

function recoveryCompatibilityPredicate(input: {
  expectedEmbeddingProfileHash: string;
}): Prisma.Sql {
  return Prisma.sql`
    document."status" = 'ready'
    AND document."candidate_version_id" IS NULL
    AND document."active_processing_version_id" IS NULL
    AND document."stable_error_code" IS NULL
    AND document."embedding_profile_hash" = ${input.expectedEmbeddingProfileHash}
    AND current_version."version_status" = 'ready'
    AND current_version."processing_stage" = 'completed'
    AND current_version."progress_percent" = 100
    AND current_version."stable_error_code" IS NULL
    AND current_version."index_ready" = true
    AND current_version."embedding_profile_hash" = ${input.expectedEmbeddingProfileHash}
    AND document."chunking_config_digest" = current_version."chunking_config_digest"
    AND document."chunking_config_digest" ~ '^[a-f0-9]{64}$'
    AND current_version."parent_count" > 0
    AND current_version."child_count" > 0
    AND document."retrieval_manifest_sha256" = current_version."retrieval_manifest_sha256"
    AND document."retrieval_manifest_sha256" ~ '^[a-f0-9]{64}$'
    AND document."index_integrity_digest" = current_version."index_integrity_digest"
    AND document."index_integrity_digest" ~ '^[a-f0-9]{64}$'
  `;
}

function abortableDelay(
  milliseconds: number,
  signal: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error("aborted"));
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, milliseconds);
    const abort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      reject(new Error("aborted"));
    };
    signal.addEventListener("abort", abort, { once: true });
  });
}

function combineAbortSignals(
  primary: AbortSignal,
  secondary?: AbortSignal,
): { signal: AbortSignal; dispose: () => void } {
  if (secondary === undefined) {
    return { signal: primary, dispose: () => undefined };
  }
  const controller = new AbortController();
  const signals = [primary, secondary];
  const listeners: Array<{ signal: AbortSignal; listener: () => void }> = [];
  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      break;
    }
    const listener = () => controller.abort(signal.reason);
    signal.addEventListener("abort", listener, { once: true });
    listeners.push({ signal, listener });
  }
  return {
    signal: controller.signal,
    dispose: () => {
      for (const entry of listeners) {
        entry.signal.removeEventListener("abort", entry.listener);
      }
    },
  };
}
