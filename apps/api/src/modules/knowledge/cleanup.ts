import { randomUUID } from "node:crypto";

import type { Prisma, PrismaClient } from "../../generated/prisma/client.js";

import { KnowledgeProcessingError } from "../knowledge-processing/errors.js";
import { assertManagedKnowledgeObjectKey } from "../knowledge-processing/object-store.js";
import { SUPERSEDED_VERSION_RETENTION_MS } from "./retention.js";

const STORAGE_RESERVATION_REAPER_LEASE_MS = 5 * 60_000;
const STORAGE_RESERVATION_REAPER_HEARTBEAT_MS = 60_000;
const DEFAULT_LEDGER_RECONCILE_INTERVAL_MS = 5 * 60_000;
const DEFAULT_LEDGER_RECONCILE_BATCH_SIZE = 100;

export type KnowledgeCleanupTargetType =
  "knowledge_base" | "document" | "document_version" | "object";

export type ClaimedKnowledgeCleanup = {
  id: string;
  targetType: KnowledgeCleanupTargetType;
  knowledgeBaseId: string;
  documentId: string | null;
  documentVersionId: string | null;
  objectId: string | null;
  attemptCount: number;
  maxAttempts: number;
};

export type KnowledgeCleanupObject = {
  id: string;
  objectKey: string;
};

export interface KnowledgeCleanupRepository {
  releaseExpiredStorageReservations(
    now: Date,
    objectStore: KnowledgeCleanupObjectStore,
  ): Promise<number>;
  reconcileStorageLedger(
    now: Date,
    afterId: string | null,
    limit: number,
  ): Promise<{ reconciled: number; nextCursor: string | null }>;
  enqueueDueVersionCleanup(now: Date): Promise<number>;
  enqueueStaleDerivedObjectCleanup(now: Date): Promise<number>;
  isRegisteredObjectKey(objectKey: string): Promise<boolean>;
  recoverExpired(now: Date): Promise<number>;
  claimDue(
    now: Date,
    leaseUntil: Date,
  ): Promise<ClaimedKnowledgeCleanup | null>;
  heartbeatClaim(
    target: ClaimedKnowledgeCleanup,
    now: Date,
    leaseUntil: Date,
  ): Promise<boolean>;
  listDocumentIds(input: {
    target: ClaimedKnowledgeCleanup;
    afterId: string | null;
    limit: number;
  }): Promise<{ items: string[]; nextCursor: string | null }>;
  listObjects(input: {
    target: ClaimedKnowledgeCleanup;
    afterId: string | null;
    limit: number;
  }): Promise<{ items: KnowledgeCleanupObject[]; nextCursor: string | null }>;
  markObjectRunning(
    target: ClaimedKnowledgeCleanup,
    objectId: string,
    now: Date,
  ): Promise<boolean>;
  markObjectFailed(
    target: ClaimedKnowledgeCleanup,
    objectId: string,
    errorCode: string,
    now: Date,
  ): Promise<boolean>;
  completeObjectAndReleaseQuota(
    target: ClaimedKnowledgeCleanup,
    objectId: string,
    now: Date,
  ): Promise<boolean>;
  completeTarget(target: ClaimedKnowledgeCleanup, now: Date): Promise<boolean>;
  failTarget(input: {
    target: ClaimedKnowledgeCleanup;
    errorCode: string;
    nextAttemptAt: Date | null;
    now: Date;
  }): Promise<boolean>;
}

export interface KnowledgeCleanupObjectStore {
  remove(key: string): Promise<void>;
  iterateManagedObjectsOlderThan?(
    cutoff: Date,
  ): AsyncIterable<{ key: string; lastModified: Date }>;
  listManagedObjectsOlderThan?(
    cutoff: Date,
    limit?: number,
  ): Promise<Array<{ key: string; lastModified: Date }>>;
}

export interface KnowledgeCleanupIndex {
  deleteDocument(knowledgeBaseId: string, documentId: string): Promise<void>;
  deleteDocumentVersion(input: {
    knowledgeBaseId: string;
    documentId: string;
    documentVersionId: string;
  }): Promise<void>;
}

export class KnowledgeCleanupWorker {
  private timer: NodeJS.Timeout | null = null;
  private inFlight: Promise<void> | null = null;
  private runController: AbortController | null = null;
  private started = false;
  private lastOrphanScanAt = Number.NEGATIVE_INFINITY;
  private ledgerReconcileCursor: string | null = null;
  private nextLedgerReconcileAt = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly repository: KnowledgeCleanupRepository,
    private readonly objectStore: KnowledgeCleanupObjectStore,
    private readonly index: KnowledgeCleanupIndex,
    private readonly options: {
      pollIntervalMs?: number;
      leaseMs?: number;
      batchSize?: number;
      orphanScanIntervalMs?: number;
      orphanIsolationMs?: number;
      orphanScanBatchSize?: number;
      ledgerReconcileIntervalMs?: number;
      ledgerReconcileBatchSize?: number;
      cleanupPageSize?: number;
      leaseHeartbeatMs?: number;
      now?: () => Date;
    } = {},
  ) {}

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.runController = new AbortController();
    const interval = this.options.pollIntervalMs ?? 5_000;
    this.timer = setInterval(() => {
      this.triggerCycle();
    }, interval);
    this.timer.unref();
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
  }

  async runOnce(signal?: AbortSignal): Promise<number> {
    if (signal?.aborted) return 0;
    const now = this.now();
    await this.repository
      .releaseExpiredStorageReservations(now, this.objectStore)
      .catch(() => 0);
    await this.reconcileStorageLedger(now);
    await this.repository.enqueueDueVersionCleanup(now).catch(() => 0);
    await this.repository.enqueueStaleDerivedObjectCleanup(now).catch(() => 0);
    await this.reconcileUnregisteredObjects(now);
    await this.repository.recoverExpired(now);
    if (signal?.aborted) return 0;
    const batchSize = this.options.batchSize ?? 20;
    let processed = 0;
    while (processed < batchSize && !signal?.aborted) {
      const claimed = await this.repository.claimDue(
        this.now(),
        new Date(this.now().getTime() + (this.options.leaseMs ?? 5 * 60_000)),
      );
      if (claimed === null) break;
      await this.processClaim(claimed);
      processed += 1;
    }
    return processed;
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

  private async reconcileStorageLedger(now: Date): Promise<void> {
    if (
      this.ledgerReconcileCursor === null &&
      now.getTime() < this.nextLedgerReconcileAt
    ) {
      return;
    }
    const limit =
      this.options.ledgerReconcileBatchSize ??
      DEFAULT_LEDGER_RECONCILE_BATCH_SIZE;
    try {
      const page = await this.repository.reconcileStorageLedger(
        now,
        this.ledgerReconcileCursor,
        limit,
      );
      this.ledgerReconcileCursor = page.nextCursor;
      if (page.nextCursor === null) {
        this.nextLedgerReconcileAt =
          now.getTime() +
          (this.options.ledgerReconcileIntervalMs ??
            DEFAULT_LEDGER_RECONCILE_INTERVAL_MS);
      }
    } catch {
      // Preserve the cursor so the next worker cycle retries the same bounded page.
    }
  }

  private async reconcileUnregisteredObjects(now: Date): Promise<void> {
    if (
      !this.objectStore.iterateManagedObjectsOlderThan &&
      !this.objectStore.listManagedObjectsOlderThan
    ) {
      return;
    }
    const interval = this.options.orphanScanIntervalMs ?? 60 * 60_000;
    if (now.getTime() - this.lastOrphanScanAt < interval) return;
    this.lastOrphanScanAt = now.getTime();
    const cutoff = new Date(
      now.getTime() - (this.options.orphanIsolationMs ?? 24 * 60 * 60_000),
    );
    const batchSize = this.options.orphanScanBatchSize ?? 100;
    let candidates: AsyncIterable<{ key: string; lastModified: Date }>;
    try {
      candidates = this.objectStore.iterateManagedObjectsOlderThan
        ? this.objectStore.iterateManagedObjectsOlderThan(cutoff)
        : asAsyncIterable(
            await this.objectStore.listManagedObjectsOlderThan!(
              cutoff,
              batchSize,
            ),
          );
    } catch {
      return;
    }
    let attemptedOrphans = 0;
    try {
      for await (const candidate of candidates) {
        try {
          if (await this.repository.isRegisteredObjectKey(candidate.key))
            continue;
          attemptedOrphans += 1;
          await this.objectStore.remove(candidate.key);
          if (attemptedOrphans >= batchSize) break;
        } catch {
          // A later scan retries this exact key; durable outbox work continues.
          if (attemptedOrphans >= batchSize) break;
        }
      }
    } catch {
      // A paged MinIO listing can fail between pages. The next scheduled scan
      // starts a fresh safe traversal and rechecks every key against the manifest.
    }
  }

  private async processClaim(target: ClaimedKnowledgeCleanup): Promise<void> {
    const lease = new KnowledgeCleanupClaimLease(
      this.repository,
      target,
      this.options.leaseMs ?? 5 * 60_000,
      this.options.leaseHeartbeatMs,
      () => this.now(),
    );
    lease.start();
    try {
      await this.deleteIndexData(target, () => lease.ensureActive());
      await lease.ensureActive();
      let objectCursor: string | null = null;
      for (;;) {
        await lease.ensureActive();
        const page = await this.repository.listObjects({
          target,
          afterId: objectCursor,
          limit: this.cleanupPageSize(),
        });
        for (const object of page.items) {
          await lease.ensureActive();
          if (
            !(await this.repository.markObjectRunning(
              target,
              object.id,
              this.now(),
            ))
          ) {
            throw new KnowledgeCleanupLeaseLostError();
          }
          try {
            await lease.ensureActive();
            await this.objectStore.remove(object.objectKey);
            await lease.ensureActive();
            if (
              !(await this.repository.completeObjectAndReleaseQuota(
                target,
                object.id,
                this.now(),
              ))
            ) {
              throw new KnowledgeCleanupLeaseLostError();
            }
          } catch (error) {
            if (error instanceof KnowledgeCleanupLeaseLostError) throw error;
            const code = cleanupErrorCode(error);
            await lease.ensureActive();
            if (
              !(await this.repository.markObjectFailed(
                target,
                object.id,
                code,
                this.now(),
              ))
            ) {
              throw new KnowledgeCleanupLeaseLostError();
            }
            throw error;
          }
        }
        if (page.nextCursor === null) break;
        if (page.items.length === 0 || page.nextCursor === objectCursor) {
          throw new Error("invalid knowledge cleanup object page");
        }
        objectCursor = page.nextCursor;
      }
      await lease.ensureActive();
      await lease.stopHeartbeat();
      if (lease.isLost()) return;
      await this.repository.completeTarget(target, this.now());
    } catch (error) {
      if (error instanceof KnowledgeCleanupLeaseLostError || lease.isLost()) {
        return;
      }
      try {
        await lease.ensureActive();
      } catch (leaseError) {
        if (leaseError instanceof KnowledgeCleanupLeaseLostError) return;
        throw leaseError;
      }
      await lease.stopHeartbeat();
      if (lease.isLost()) return;
      const exhausted = target.attemptCount >= target.maxAttempts;
      await this.repository.failTarget({
        target,
        errorCode: cleanupErrorCode(error),
        nextAttemptAt: exhausted
          ? null
          : new Date(
              this.now().getTime() + cleanupRetryDelay(target.attemptCount),
            ),
        now: this.now(),
      });
    } finally {
      await lease.stopHeartbeat();
    }
  }

  private async deleteIndexData(
    target: ClaimedKnowledgeCleanup,
    ensureActive: () => Promise<void>,
  ): Promise<void> {
    if (
      target.targetType === "document_version" &&
      target.documentId !== null &&
      target.documentVersionId !== null
    ) {
      await ensureActive();
      await this.index.deleteDocumentVersion({
        knowledgeBaseId: target.knowledgeBaseId,
        documentId: target.documentId,
        documentVersionId: target.documentVersionId,
      });
      return;
    }
    if (target.targetType === "object") return;
    await ensureActive();
    let documentCursor: string | null = null;
    for (;;) {
      await ensureActive();
      const page = await this.repository.listDocumentIds({
        target,
        afterId: documentCursor,
        limit: this.cleanupPageSize(),
      });
      for (const documentId of page.items) {
        await ensureActive();
        await this.index.deleteDocument(target.knowledgeBaseId, documentId);
      }
      if (page.nextCursor === null) break;
      if (page.items.length === 0 || page.nextCursor === documentCursor) {
        throw new Error("invalid knowledge cleanup document page");
      }
      documentCursor = page.nextCursor;
    }
  }

  private cleanupPageSize(): number {
    const value = this.options.cleanupPageSize ?? 100;
    if (!Number.isSafeInteger(value) || value < 1 || value > 1_000) {
      throw new Error("invalid knowledge cleanup page size");
    }
    return value;
  }

  private now(): Date {
    return (this.options.now ?? (() => new Date()))();
  }
}

class KnowledgeCleanupLeaseLostError extends Error {
  constructor() {
    super("knowledge cleanup claim lease lost");
    this.name = "KnowledgeCleanupLeaseLostError";
  }
}

class KnowledgeCleanupClaimLease {
  private timer: NodeJS.Timeout | null = null;
  private heartbeatInFlight: Promise<boolean> | null = null;
  private lost = false;

  constructor(
    private readonly repository: KnowledgeCleanupRepository,
    private readonly target: ClaimedKnowledgeCleanup,
    private readonly leaseMs: number,
    heartbeatMs: number | undefined,
    private readonly now: () => Date,
  ) {
    this.heartbeatMs =
      heartbeatMs ?? Math.max(10, Math.min(60_000, Math.floor(leaseMs / 3)));
  }

  private readonly heartbeatMs: number;

  start(): void {
    this.timer = setInterval(() => {
      void this.heartbeat();
    }, this.heartbeatMs);
    this.timer.unref();
  }

  async ensureActive(): Promise<void> {
    if (!(await this.heartbeat())) throw new KnowledgeCleanupLeaseLostError();
  }

  isLost(): boolean {
    return this.lost;
  }

  async stopHeartbeat(): Promise<void> {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    await this.heartbeatInFlight;
  }

  private heartbeat(): Promise<boolean> {
    if (this.lost) return Promise.resolve(false);
    if (this.heartbeatInFlight !== null) return this.heartbeatInFlight;
    const now = this.now();
    const heartbeat = this.repository
      .heartbeatClaim(this.target, now, new Date(now.getTime() + this.leaseMs))
      .catch(() => false)
      .then((active) => {
        if (!active) this.lost = true;
        return active;
      })
      .finally(() => {
        if (this.heartbeatInFlight === heartbeat) this.heartbeatInFlight = null;
      });
    this.heartbeatInFlight = heartbeat;
    return heartbeat;
  }
}

export class PrismaKnowledgeCleanupRepository implements KnowledgeCleanupRepository {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly currentTime: () => Date = () => new Date(),
  ) {}

  async releaseExpiredStorageReservations(
    now: Date,
    objectStore: KnowledgeCleanupObjectStore,
  ): Promise<number> {
    let released = 0;
    let cursor: { leaseExpiresAt: Date; id: string } | null = null;
    while (true) {
      const candidates: Array<{
        id: string;
        knowledgeBaseId: string;
        leaseExpiresAt: Date;
      }> = await this.prisma.knowledgeBaseStorageReservation.findMany({
        where: {
          leaseExpiresAt: { lte: now },
          ...(cursor === null
            ? {}
            : {
                OR: [
                  { leaseExpiresAt: { gt: cursor.leaseExpiresAt } },
                  {
                    leaseExpiresAt: cursor.leaseExpiresAt,
                    id: { gt: cursor.id },
                  },
                ],
              }),
        },
        orderBy: [{ leaseExpiresAt: "asc" }, { id: "asc" }],
        take: 100,
        select: { id: true, knowledgeBaseId: true, leaseExpiresAt: true },
      });
      if (candidates.length === 0) break;
      for (const candidate of candidates) {
        try {
          const claimNow = this.currentTime();
          const reaperToken = randomUUID();
          const claimed = await this.prisma.$transaction(
            async (transaction) => {
              await transaction.$queryRaw`
              SELECT "id"
              FROM "knowledge_bases"
              WHERE "id" = ${candidate.knowledgeBaseId}::uuid
              FOR UPDATE
            `;
              const reservation =
                await transaction.knowledgeBaseStorageReservation.findUnique({
                  where: { id: candidate.id },
                });
              if (reservation === null || reservation.leaseExpiresAt > claimNow)
                return null;
              const objectKeys = storageReservationObjectKeys(
                reservation.objectKeysJson,
                reservation.knowledgeBaseId,
                reservation.documentId,
                reservation.documentVersionId,
              );
              const registeredCount =
                await transaction.knowledgeBaseObject.count({
                  where: { objectKey: { in: objectKeys } },
                });
              if (registeredCount > 0 && registeredCount < objectKeys.length) {
                return { kind: "blocked" as const };
              }
              if (registeredCount === objectKeys.length) {
                if (reservation.sizeBytes > 0n) {
                  const updated = await transaction.knowledgeBase.updateMany({
                    where: {
                      id: reservation.knowledgeBaseId,
                      storageReservedBytes: { gte: reservation.sizeBytes },
                    },
                    data: {
                      storageReservedBytes: {
                        decrement: reservation.sizeBytes,
                      },
                      updatedAt: claimNow,
                    },
                  });
                  if (updated.count !== 1) {
                    throw new Error(
                      "knowledge storage reservation ledger is inconsistent",
                    );
                  }
                }
                await transaction.knowledgeBaseStorageReservation.delete({
                  where: { id: reservation.id },
                });
                return { kind: "released" as const };
              }
              await transaction.knowledgeBaseStorageReservation.update({
                where: { id: reservation.id },
                data: {
                  leaseToken: reaperToken,
                  leaseExpiresAt: new Date(
                    claimNow.getTime() + STORAGE_RESERVATION_REAPER_LEASE_MS,
                  ),
                  cleanupStartedAt: reservation.cleanupStartedAt ?? claimNow,
                },
              });
              return {
                kind: "claimed" as const,
                id: reservation.id,
                knowledgeBaseId: reservation.knowledgeBaseId,
                sizeBytes: reservation.sizeBytes,
                objectKeys,
              };
            },
          );
          if (claimed === null) continue;
          if (claimed.kind === "blocked") continue;
          if (claimed.kind === "released") {
            released += 1;
            continue;
          }
          const removed = await this.removeClaimedReservationObjects(
            claimed,
            reaperToken,
            objectStore,
          );
          if (!removed) continue;
          const finishNow = this.currentTime();
          const didRelease = await this.prisma.$transaction(
            async (transaction) => {
              await transaction.$queryRaw`
              SELECT "id"
              FROM "knowledge_bases"
              WHERE "id" = ${claimed.knowledgeBaseId}::uuid
              FOR UPDATE
            `;
              const reservation =
                await transaction.knowledgeBaseStorageReservation.findUnique({
                  where: { id: claimed.id },
                });
              if (
                reservation === null ||
                reservation.knowledgeBaseId !== claimed.knowledgeBaseId ||
                reservation.sizeBytes !== claimed.sizeBytes ||
                reservation.leaseToken !== reaperToken ||
                reservation.cleanupStartedAt === null
              )
                return false;
              if (reservation.sizeBytes > 0n) {
                const updated = await transaction.knowledgeBase.updateMany({
                  where: {
                    id: reservation.knowledgeBaseId,
                    storageReservedBytes: { gte: reservation.sizeBytes },
                  },
                  data: {
                    storageReservedBytes: { decrement: reservation.sizeBytes },
                    updatedAt: finishNow,
                  },
                });
                if (updated.count !== 1) {
                  throw new Error(
                    "knowledge storage reservation ledger is inconsistent",
                  );
                }
              }
              await transaction.knowledgeBaseStorageReservation.delete({
                where: { id: reservation.id },
              });
              return true;
            },
          );
          if (didRelease) released += 1;
        } catch {
          // One malformed or temporarily undeletable reservation must retain
          // quota without stopping keyset progress through later pages.
        }
      }
      const last = candidates.at(-1);
      if (last === undefined || candidates.length < 100) break;
      cursor = { leaseExpiresAt: last.leaseExpiresAt, id: last.id };
    }
    return released;
  }

  private async removeClaimedReservationObjects(
    claimed: {
      id: string;
      knowledgeBaseId: string;
      objectKeys: readonly string[];
    },
    reaperToken: string,
    objectStore: KnowledgeCleanupObjectStore,
  ): Promise<boolean> {
    let leaseLost = false;
    let heartbeat = Promise.resolve();
    const renew = () => {
      heartbeat = heartbeat
        .then(async () => {
          const now = this.currentTime();
          const renewed = await this.prisma.$transaction(
            async (transaction) => {
              await transaction.$queryRaw`
              SELECT "id"
              FROM "knowledge_bases"
              WHERE "id" = ${claimed.knowledgeBaseId}::uuid
              FOR UPDATE
            `;
              return transaction.knowledgeBaseStorageReservation.updateMany({
                where: {
                  id: claimed.id,
                  knowledgeBaseId: claimed.knowledgeBaseId,
                  leaseToken: reaperToken,
                  cleanupStartedAt: { not: null },
                },
                data: {
                  leaseExpiresAt: new Date(
                    now.getTime() + STORAGE_RESERVATION_REAPER_LEASE_MS,
                  ),
                },
              });
            },
          );
          if (renewed.count !== 1) leaseLost = true;
        })
        .catch(() => {
          leaseLost = true;
        });
    };
    const timer = setInterval(renew, STORAGE_RESERVATION_REAPER_HEARTBEAT_MS);
    timer.unref();
    try {
      const removals = await Promise.allSettled(
        claimed.objectKeys.map((objectKey) => objectStore.remove(objectKey)),
      );
      await heartbeat;
      return (
        !leaseLost && removals.every((result) => result.status === "fulfilled")
      );
    } finally {
      clearInterval(timer);
    }
  }

  async reconcileStorageLedger(
    now: Date,
    afterId: string | null,
    limit: number,
  ): Promise<{ reconciled: number; nextCursor: string | null }> {
    const boundedLimit = Math.max(1, Math.min(Math.trunc(limit), 1_000));
    const candidates =
      afterId === null
        ? await this.prisma.$queryRaw<Array<{ id: string }>>`
          SELECT kb."id"
          FROM "knowledge_bases" kb
          WHERE kb."storage_used_bytes" <> COALESCE((
              SELECT SUM(o."size_bytes")
              FROM "knowledge_base_objects" o
              WHERE o."knowledge_base_id" = kb."id"
                AND o."lifecycle_status" <> 'cleaned'
            ), 0)
            OR kb."storage_reserved_bytes" <> COALESCE((
              SELECT SUM(r."size_bytes")
              FROM "knowledge_base_storage_reservations" r
              WHERE r."knowledge_base_id" = kb."id"
            ), 0)
          ORDER BY kb."id" ASC
          LIMIT ${boundedLimit}
        `
        : await this.prisma.$queryRaw<Array<{ id: string }>>`
          SELECT kb."id"
          FROM "knowledge_bases" kb
          WHERE kb."id" > ${afterId}::uuid
            AND (
              kb."storage_used_bytes" <> COALESCE((
                SELECT SUM(o."size_bytes")
                FROM "knowledge_base_objects" o
                WHERE o."knowledge_base_id" = kb."id"
                  AND o."lifecycle_status" <> 'cleaned'
              ), 0)
              OR kb."storage_reserved_bytes" <> COALESCE((
                SELECT SUM(r."size_bytes")
                FROM "knowledge_base_storage_reservations" r
                WHERE r."knowledge_base_id" = kb."id"
              ), 0)
            )
          ORDER BY kb."id" ASC
          LIMIT ${boundedLimit}
        `;
    let reconciled = 0;
    for (const candidate of candidates) {
      try {
        const changed = await this.prisma.$transaction(async (transaction) => {
          await transaction.$queryRaw`
            SELECT "id"
            FROM "knowledge_bases"
            WHERE "id" = ${candidate.id}::uuid
            FOR UPDATE
          `;
          const [base, used, reserved] = await Promise.all([
            transaction.knowledgeBase.findUnique({
              where: { id: candidate.id },
              select: { storageUsedBytes: true, storageReservedBytes: true },
            }),
            transaction.knowledgeBaseObject.aggregate({
              where: {
                knowledgeBaseId: candidate.id,
                lifecycleStatus: { not: "cleaned" },
              },
              _sum: { sizeBytes: true },
            }),
            transaction.knowledgeBaseStorageReservation.aggregate({
              where: { knowledgeBaseId: candidate.id },
              _sum: { sizeBytes: true },
            }),
          ]);
          if (base === null) return false;
          const expectedUsed = used._sum.sizeBytes ?? 0n;
          const expectedReserved = reserved._sum.sizeBytes ?? 0n;
          if (
            base.storageUsedBytes === expectedUsed &&
            base.storageReservedBytes === expectedReserved
          ) {
            return false;
          }
          await transaction.knowledgeBase.update({
            where: { id: candidate.id },
            data: {
              storageUsedBytes: expectedUsed,
              storageReservedBytes: expectedReserved,
              updatedAt: now,
            },
          });
          return true;
        });
        if (changed) reconciled += 1;
      } catch {
        // A single inconsistent base remains discoverable on the next cycle.
      }
    }
    return {
      reconciled,
      nextCursor:
        candidates.length === boundedLimit
          ? (candidates.at(-1)?.id ?? null)
          : null,
    };
  }

  async isRegisteredObjectKey(objectKey: string): Promise<boolean> {
    const manifest = await this.prisma.knowledgeBaseObject.findUnique({
      where: { objectKey },
      select: { id: true },
    });
    if (manifest !== null) return true;
    return (
      (await this.prisma.knowledgeBaseStorageReservation.findFirst({
        where: { objectKeysJson: { array_contains: [objectKey] } },
        select: { id: true },
      })) !== null
    );
  }

  /**
   * Freezes the exact object set for each due superseded version. A source
   * root keeps only its immutable original while it still has consumers; the
   * worker must never widen this persisted pending set after leaving the
   * transaction. Base, document, then version locking serializes this choice
   * with archive/delete, reprocess, activation, and citation retention.
   */
  async enqueueDueVersionCleanup(now: Date): Promise<number> {
    const rows = await this.prisma.$queryRaw<
      Array<{
        id: string;
        knowledge_base_id: string;
        document_id: string;
      }>
    >`
      SELECT
        v."id",
        v."knowledge_base_id",
        v."document_id"
      FROM "knowledge_base_document_versions" v
      INNER JOIN "knowledge_base_documents" d
        ON d."id" = v."document_id"
       AND d."knowledge_base_id" = v."knowledge_base_id"
      INNER JOIN "knowledge_bases" kb
        ON kb."id" = v."knowledge_base_id"
      WHERE v."version_status" = 'superseded'
        AND v."cleanup_eligible_at" IS NOT NULL
        AND v."cleanup_eligible_at" <= ${now}
        AND d."status" <> 'deleted'
        AND (d."current_version_id" IS NULL OR d."current_version_id" <> v."id")
        AND kb."lifecycle_status" = 'active'
      ORDER BY v."cleanup_eligible_at" ASC, v."id" ASC
      LIMIT 100
    `;
    let enqueued = 0;
    for (const row of rows) {
      try {
        const didEnqueue = await this.prisma.$transaction(
          async (transaction) => {
            await transaction.$queryRaw`
            SELECT "id"
            FROM "knowledge_bases"
            WHERE "id" = ${row.knowledge_base_id}::uuid
            FOR UPDATE
          `;
            await transaction.$queryRaw`
            SELECT "id"
            FROM "knowledge_base_documents"
            WHERE "id" = ${row.document_id}::uuid
            FOR UPDATE
          `;
            await transaction.$queryRaw`
            SELECT "id"
            FROM "knowledge_base_document_versions"
            WHERE "id" = ${row.id}::uuid
            FOR UPDATE
          `;
            const [
              base,
              document,
              version,
              citationCount,
              sourceReferenceCount,
              existingOutbox,
            ] = await Promise.all([
              transaction.knowledgeBase.findUnique({
                where: { id: row.knowledge_base_id },
                select: { lifecycleStatus: true },
              }),
              transaction.knowledgeBaseDocument.findFirst({
                where: {
                  id: row.document_id,
                  knowledgeBaseId: row.knowledge_base_id,
                },
                select: { status: true, currentVersionId: true },
              }),
              transaction.knowledgeBaseDocumentVersion.findFirst({
                where: {
                  id: row.id,
                  knowledgeBaseId: row.knowledge_base_id,
                  documentId: row.document_id,
                },
                select: {
                  versionStatus: true,
                  cleanupEligibleAt: true,
                },
              }),
              transaction.conversationMessageKnowledgeCitation.count({
                where: { documentVersionId: row.id },
              }),
              transaction.knowledgeBaseDocumentVersion.count({
                where: {
                  sourceVersionId: row.id,
                  knowledgeBaseId: row.knowledge_base_id,
                  documentId: row.document_id,
                  versionStatus: { not: "deleted" },
                },
              }),
              transaction.knowledgeBaseCleanupOutbox.findFirst({
                where: {
                  targetType: "document_version",
                  documentVersionId: row.id,
                  status: { not: "completed" },
                },
                select: { id: true },
              }),
            ]);
            if (
              base?.lifecycleStatus !== "active" ||
              document === null ||
              document.status === "deleted" ||
              document.currentVersionId === row.id ||
              version?.versionStatus !== "superseded" ||
              version.cleanupEligibleAt === null ||
              version.cleanupEligibleAt > now ||
              existingOutbox !== null
            ) {
              return false;
            }
            if (citationCount > 0) {
              await transaction.knowledgeBaseDocumentVersion.updateMany({
                where: { id: row.id, versionStatus: "superseded" },
                data: { cleanupEligibleAt: null, updatedAt: now },
              });
              return false;
            }
            const claimed =
              await transaction.knowledgeBaseDocumentVersion.updateMany({
                where: {
                  id: row.id,
                  versionStatus: "superseded",
                  cleanupEligibleAt: { lte: now },
                },
                data: { cleanupEligibleAt: null, updatedAt: now },
              });
            if (claimed.count !== 1) return false;
            await transaction.knowledgeBaseObject.updateMany({
              where: {
                documentVersionId: row.id,
                lifecycleStatus: "active",
                ...(sourceReferenceCount > 0
                  ? { objectType: { not: "original" } }
                  : {}),
              },
              data: {
                lifecycleStatus: "pending_cleanup",
                cleanupStatus: "pending",
                cleanupEligibleAt: now,
                cleanupErrorCode: null,
                updatedAt: now,
              },
            });
            await transaction.knowledgeBaseCleanupOutbox.create({
              data: {
                targetType: "document_version",
                knowledgeBaseId: row.knowledge_base_id,
                documentId: row.document_id,
                documentVersionId: row.id,
                status: "pending",
                attemptCount: 0,
                maxAttempts: 10,
                nextAttemptAt: now,
                createdAt: now,
                updatedAt: now,
              },
            });
            return true;
          },
        );
        if (didEnqueue) enqueued += 1;
      } catch {
        // A contended or malformed candidate remains eligible for a later scan.
      }
    }
    return enqueued;
  }

  /**
   * Enqueues registered derived objects that are older than the isolation
   * window and are not part of the version's adopted artifact set. Originals
   * are deliberately excluded because failed-version originals remain
   * retryable until a successful retry or document deletion makes them
   * eligible for the normal cleanup flow.
   */
  async enqueueStaleDerivedObjectCleanup(now: Date): Promise<number> {
    const cutoff = new Date(now.getTime() - 24 * 60 * 60_000);
    return this.prisma.$transaction(async (transaction) => {
      const rows = await transaction.$queryRaw<
        Array<{
          id: string;
          knowledge_base_id: string;
          document_id: string;
          document_version_id: string;
        }>
      >`
        SELECT
          o."id",
          o."knowledge_base_id",
          o."document_id",
          o."document_version_id"
        FROM "knowledge_base_objects" o
        INNER JOIN "knowledge_base_document_versions" v
          ON v."id" = o."document_version_id"
         AND v."document_id" = o."document_id"
         AND v."knowledge_base_id" = o."knowledge_base_id"
        INNER JOIN "knowledge_base_documents" d
          ON d."id" = o."document_id"
         AND d."knowledge_base_id" = o."knowledge_base_id"
        INNER JOIN "knowledge_bases" kb
          ON kb."id" = o."knowledge_base_id"
        WHERE o."lifecycle_status" = 'active'
          AND o."object_type" IN (
            'docling_bundle',
            'display_markdown',
            'docling_json',
            'hybrid_chunks',
            'image_projection',
            'retrieval_manifest',
            'asset'
          )
          AND o."created_at" <= ${cutoff}
          AND d."status" <> 'deleted'
          AND kb."lifecycle_status" <> 'deleted'
          AND NOT EXISTS (
            SELECT 1
            FROM "knowledge_base_cleanup_outbox" q
            WHERE q."target_type" = 'object'
              AND q."object_id" = o."id"
          )
          AND NOT (
            o."object_type" = 'docling_bundle'
            AND v."docling_bundle_object_id" = o."id"
          )
          AND NOT (
            o."object_type" = 'display_markdown'
            AND v."display_markdown_object_id" = o."id"
          )
          AND NOT (
            o."object_type" = 'docling_json'
            AND v."docling_json_object_id" = o."id"
          )
          AND NOT (
            o."object_type" = 'hybrid_chunks'
            AND v."hybrid_chunks_object_id" = o."id"
          )
          AND NOT (
            o."object_type" = 'image_projection'
            AND v."image_projection_object_id" = o."id"
          )
          AND NOT (
            o."object_type" = 'retrieval_manifest'
            AND v."retrieval_manifest_object_id" = o."id"
          )
          AND NOT (
            o."object_type" = 'asset'
            AND o."asset_reference_id" IS NOT NULL
            AND v."display_markdown_object_id" IS NOT NULL
            AND v."processing_generation" = o."processing_generation"
          )
        ORDER BY o."created_at" ASC, o."id" ASC
        FOR UPDATE OF o SKIP LOCKED
        LIMIT 100
      `;
      let enqueued = 0;
      for (const row of rows) {
        const updated = await transaction.knowledgeBaseObject.updateMany({
          where: { id: row.id, lifecycleStatus: "active" },
          data: {
            lifecycleStatus: "pending_cleanup",
            cleanupStatus: "pending",
            cleanupEligibleAt: now,
            cleanupErrorCode: null,
            updatedAt: now,
          },
        });
        if (updated.count !== 1) continue;
        await transaction.knowledgeBaseCleanupOutbox.create({
          data: {
            targetType: "object",
            knowledgeBaseId: row.knowledge_base_id,
            documentId: row.document_id,
            documentVersionId: row.document_version_id,
            objectId: row.id,
            status: "pending",
            attemptCount: 0,
            maxAttempts: 10,
            nextAttemptAt: now,
            createdAt: now,
            updatedAt: now,
          },
        });
        enqueued += 1;
      }
      return enqueued;
    });
  }

  async recoverExpired(now: Date): Promise<number> {
    return this.prisma.$transaction(async (transaction) => {
      const exhausted = await transaction.$queryRaw<
        Array<{
          target_type: string;
          knowledge_base_id: string;
          document_id: string | null;
          object_id: string | null;
        }>
      >`
        UPDATE "knowledge_base_cleanup_outbox"
        SET
          "status" = 'failed',
          "next_attempt_at" = NULL,
          "last_error_code" = 'KNOWLEDGE_CLEANUP_INTERRUPTED',
          "updated_at" = ${now}
        WHERE (
            ("status" = 'running' AND "next_attempt_at" <= ${now})
            OR "status" = 'pending'
          )
          AND "attempt_count" >= "max_attempts"
        RETURNING
          "target_type",
          "knowledge_base_id",
          "document_id",
          "object_id"
      `;
      for (const target of exhausted) {
        await this.markTargetStatus(
          transaction,
          target,
          "failed",
          "KNOWLEDGE_CLEANUP_INTERRUPTED",
          now,
        );
      }
      const recovered = await transaction.$queryRaw<
        Array<{
          target_type: string;
          knowledge_base_id: string;
          document_id: string | null;
          object_id: string | null;
        }>
      >`
        UPDATE "knowledge_base_cleanup_outbox"
        SET
          "status" = 'pending',
          "next_attempt_at" = ${now},
          "last_error_code" = 'KNOWLEDGE_CLEANUP_INTERRUPTED',
          "updated_at" = ${now}
        WHERE "status" = 'running'
          AND "next_attempt_at" <= ${now}
          AND "attempt_count" < "max_attempts"
        RETURNING
          "target_type",
          "knowledge_base_id",
          "document_id",
          "object_id"
      `;
      for (const target of recovered) {
        await this.markTargetStatus(transaction, target, "pending", null, now);
      }
      return exhausted.length + recovered.length;
    });
  }

  async claimDue(
    now: Date,
    leaseUntil: Date,
  ): Promise<ClaimedKnowledgeCleanup | null> {
    return this.prisma.$transaction(async (transaction) => {
      const rows = await transaction.$queryRaw<
        Array<{
          id: string;
          target_type: string;
          knowledge_base_id: string;
          document_id: string | null;
          document_version_id: string | null;
          object_id: string | null;
          attempt_count: number;
          max_attempts: number;
        }>
      >`
        SELECT
          "id",
          "target_type",
          "knowledge_base_id",
          "document_id",
          "document_version_id",
          "object_id",
          "attempt_count",
          "max_attempts"
        FROM "knowledge_base_cleanup_outbox"
        WHERE "status" = 'pending'
          AND "attempt_count" < "max_attempts"
          AND ("next_attempt_at" IS NULL OR "next_attempt_at" <= ${now})
          AND NOT EXISTS (
            SELECT 1
            FROM "knowledge_base_storage_reservations" reservation
            WHERE reservation."knowledge_base_id" =
                  "knowledge_base_cleanup_outbox"."knowledge_base_id"
              AND (
                "knowledge_base_cleanup_outbox"."target_type" = 'knowledge_base'
                OR (
                  "knowledge_base_cleanup_outbox"."target_type" = 'document'
                  AND reservation."document_id" =
                      "knowledge_base_cleanup_outbox"."document_id"
                )
                OR (
                  "knowledge_base_cleanup_outbox"."target_type" = 'document_version'
                  AND reservation."document_id" =
                      "knowledge_base_cleanup_outbox"."document_id"
                  AND reservation."document_version_id" =
                      "knowledge_base_cleanup_outbox"."document_version_id"
                )
              )
          )
        ORDER BY "created_at" ASC, "id" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      `;
      const row = rows[0];
      if (row === undefined) return null;
      const attemptCount = row.attempt_count + 1;
      await transaction.knowledgeBaseCleanupOutbox.update({
        where: { id: row.id },
        data: {
          status: "running",
          attemptCount,
          lastAttemptAt: now,
          nextAttemptAt: leaseUntil,
          lastErrorCode: null,
          updatedAt: now,
        },
      });
      await this.markTargetStatus(transaction, row, "running", null, now);
      return {
        id: row.id,
        targetType: parseTargetType(row.target_type),
        knowledgeBaseId: row.knowledge_base_id,
        documentId: row.document_id,
        documentVersionId: row.document_version_id,
        objectId: row.object_id,
        attemptCount,
        maxAttempts: row.max_attempts,
      };
    });
  }

  async heartbeatClaim(
    target: ClaimedKnowledgeCleanup,
    now: Date,
    leaseUntil: Date,
  ): Promise<boolean> {
    const result = await this.prisma.knowledgeBaseCleanupOutbox.updateMany({
      where: {
        id: target.id,
        status: "running",
        attemptCount: target.attemptCount,
        nextAttemptAt: { gt: now },
      },
      data: {
        nextAttemptAt: leaseUntil,
        updatedAt: now,
      },
    });
    return result.count === 1;
  }

  async listDocumentIds(input: {
    target: ClaimedKnowledgeCleanup;
    afterId: string | null;
    limit: number;
  }): Promise<{ items: string[]; nextCursor: string | null }> {
    assertCleanupPage(input.afterId, input.limit);
    if (input.target.documentId !== null) {
      return input.afterId === null
        ? { items: [input.target.documentId], nextCursor: null }
        : { items: [], nextCursor: null };
    }
    const rows = await this.prisma.knowledgeBaseDocument.findMany({
      where: {
        knowledgeBaseId: input.target.knowledgeBaseId,
        ...(input.afterId === null ? {} : { id: { gt: input.afterId } }),
      },
      orderBy: { id: "asc" },
      take: input.limit,
      select: { id: true },
    });
    return {
      items: rows.map((row) => row.id),
      nextCursor: rows.length === input.limit ? rows.at(-1)!.id : null,
    };
  }

  async listObjects(input: {
    target: ClaimedKnowledgeCleanup;
    afterId: string | null;
    limit: number;
  }): Promise<{
    items: KnowledgeCleanupObject[];
    nextCursor: string | null;
  }> {
    assertCleanupPage(input.afterId, input.limit);
    const rows = await this.prisma.knowledgeBaseObject.findMany({
      where: {
        lifecycleStatus: "pending_cleanup",
        knowledgeBaseId: input.target.knowledgeBaseId,
        ...(input.target.documentId === null
          ? {}
          : { documentId: input.target.documentId }),
        ...(input.target.documentVersionId === null
          ? {}
          : { documentVersionId: input.target.documentVersionId }),
        ...(input.target.objectId === null
          ? input.afterId === null
            ? {}
            : { id: { gt: input.afterId } }
          : { id: input.target.objectId }),
      },
      orderBy: { id: "asc" },
      take: input.limit,
      select: { id: true, objectKey: true },
    });
    return {
      items: rows,
      nextCursor:
        input.target.objectId === null && rows.length === input.limit
          ? rows.at(-1)!.id
          : null,
    };
  }

  async markObjectRunning(
    target: ClaimedKnowledgeCleanup,
    objectId: string,
    now: Date,
  ): Promise<boolean> {
    return this.prisma.$transaction(async (transaction) => {
      if (!(await this.lockActiveClaim(transaction, target, now))) return false;
      await transaction.knowledgeBaseObject.updateMany({
        where: { id: objectId, lifecycleStatus: { not: "cleaned" } },
        data: {
          lifecycleStatus: "pending_cleanup",
          cleanupStatus: "running",
          cleanupErrorCode: null,
          updatedAt: now,
        },
      });
      return true;
    });
  }

  async markObjectFailed(
    target: ClaimedKnowledgeCleanup,
    objectId: string,
    errorCode: string,
    now: Date,
  ): Promise<boolean> {
    return this.prisma.$transaction(async (transaction) => {
      if (!(await this.lockActiveClaim(transaction, target, now))) return false;
      await transaction.knowledgeBaseObject.updateMany({
        where: { id: objectId, lifecycleStatus: { not: "cleaned" } },
        data: {
          lifecycleStatus: "pending_cleanup",
          cleanupStatus: "failed",
          cleanupErrorCode: errorCode,
          updatedAt: now,
        },
      });
      return true;
    });
  }

  async completeObjectAndReleaseQuota(
    target: ClaimedKnowledgeCleanup,
    objectId: string,
    now: Date,
  ): Promise<boolean> {
    return this.prisma.$transaction(async (transaction) => {
      if (!(await this.lockActiveClaim(transaction, target, now))) return false;
      const identity = await transaction.knowledgeBaseObject.findUnique({
        where: { id: objectId },
        select: { knowledgeBaseId: true },
      });
      if (identity === null) return true;
      await transaction.$queryRaw`
        SELECT "id"
        FROM "knowledge_bases"
        WHERE "id" = ${identity.knowledgeBaseId}::uuid
        FOR UPDATE
      `;
      const rows = await transaction.$queryRaw<
        Array<{
          id: string;
          knowledge_base_id: string;
          size_bytes: bigint;
          lifecycle_status: string;
        }>
      >`
        SELECT "id", "knowledge_base_id", "size_bytes", "lifecycle_status"
        FROM "knowledge_base_objects"
        WHERE "id" = ${objectId}::uuid
        FOR UPDATE
      `;
      const object = rows[0];
      if (object === undefined || object.lifecycle_status === "cleaned")
        return true;
      const released = await transaction.$executeRaw`
        UPDATE "knowledge_bases"
        SET
          "storage_used_bytes" = "storage_used_bytes" - ${object.size_bytes},
          "updated_at" = ${now}
        WHERE "id" = ${object.knowledge_base_id}::uuid
          AND "storage_used_bytes" >= ${object.size_bytes}
      `;
      if (released !== 1) {
        throw new Error("knowledge storage quota ledger is inconsistent");
      }
      await transaction.knowledgeBaseObject.update({
        where: { id: object.id },
        data: {
          lifecycleStatus: "cleaned",
          cleanupStatus: "completed",
          cleanupErrorCode: null,
          cleanedAt: now,
          updatedAt: now,
        },
      });
      return true;
    });
  }

  async completeTarget(
    target: ClaimedKnowledgeCleanup,
    now: Date,
  ): Promise<boolean> {
    return this.prisma.$transaction(async (transaction) => {
      if (!(await this.lockActiveClaim(transaction, target, now))) return false;
      await transaction.$queryRaw`
        SELECT "id"
        FROM "knowledge_bases"
        WHERE "id" = ${target.knowledgeBaseId}::uuid
        FOR UPDATE
      `;
      const reservationWhere = storageReservationTargetWhere(target);
      if (
        reservationWhere !== null &&
        (await transaction.knowledgeBaseStorageReservation.count({
          where: reservationWhere,
        })) > 0
      ) {
        await transaction.knowledgeBaseCleanupOutbox.updateMany({
          where: {
            id: target.id,
            status: "running",
            attemptCount: target.attemptCount,
          },
          data: {
            status: "pending",
            maxAttempts: { increment: 1 },
            nextAttemptAt: new Date(now.getTime() + 15_000),
            lastErrorCode: null,
            updatedAt: now,
          },
        });
        await this.markTargetStatus(transaction, target, "pending", null, now);
        return false;
      }
      if (
        target.targetType === "document_version" &&
        target.documentVersionId !== null &&
        target.documentId !== null
      ) {
        await this.completeVersionTarget(transaction, target, now);
      }
      if (
        target.targetType === "knowledge_base" ||
        target.targetType === "document"
      ) {
        await this.completeDeletionTarget(transaction, target, now);
        return true;
      }
      const deleted = await transaction.knowledgeBaseCleanupOutbox.deleteMany({
        where: {
          id: target.id,
          status: "running",
          attemptCount: target.attemptCount,
        },
      });
      return deleted.count === 1;
    });
  }

  private async completeDeletionTarget(
    transaction: Prisma.TransactionClient,
    target: ClaimedKnowledgeCleanup,
    now: Date,
  ): Promise<void> {
    if (target.targetType === "document") {
      const documentId = target.documentId;
      if (documentId === null) {
        throw new Error("document cleanup target is missing its document id");
      }
      await transaction.$queryRaw`
        SELECT "id"
        FROM "knowledge_base_documents"
        WHERE "id" = ${documentId}::uuid
        FOR UPDATE
      `;
      const [document, tombstone, remainingObjects] = await Promise.all([
        transaction.knowledgeBaseDocument.findFirst({
          where: { id: documentId, knowledgeBaseId: target.knowledgeBaseId },
          select: { status: true },
        }),
        transaction.knowledgeBaseDocumentTombstone.findFirst({
          where: { id: documentId, knowledgeBaseId: target.knowledgeBaseId },
          select: { id: true },
        }),
        transaction.knowledgeBaseObject.count({
          where: {
            knowledgeBaseId: target.knowledgeBaseId,
            documentId,
            lifecycleStatus: { not: "cleaned" },
          },
        }),
      ]);
      if (tombstone === null) {
        throw new Error("deleted document is missing its tombstone");
      }
      if (document !== null && document.status !== "deleted") {
        throw new Error("cleanup target is not a deleted document");
      }
      if (remainingObjects > 0) {
        throw new Error("deleted document still has unmanaged live objects");
      }
      await transaction.knowledgeBaseDocumentTombstone.update({
        where: { id: documentId },
        data: {
          cleanupStatus: "completed",
          cleanupErrorCode: null,
          updatedAt: now,
        },
      });
      await transaction.knowledgeBaseObject.deleteMany({
        where: { knowledgeBaseId: target.knowledgeBaseId, documentId },
      });
      await transaction.knowledgeBaseProcessingAttempt.deleteMany({
        where: { knowledgeBaseId: target.knowledgeBaseId, documentId },
      });
      await transaction.knowledgeBaseDocumentVersion.deleteMany({
        where: { knowledgeBaseId: target.knowledgeBaseId, documentId },
      });
      await transaction.knowledgeBaseStorageReservation.deleteMany({
        where: { knowledgeBaseId: target.knowledgeBaseId, documentId },
      });
      await transaction.knowledgeBaseCleanupOutbox.deleteMany({
        where: { knowledgeBaseId: target.knowledgeBaseId, documentId },
      });
      await transaction.knowledgeBaseEntry.deleteMany({
        where: { knowledgeBaseId: target.knowledgeBaseId, documentId },
      });
      await transaction.knowledgeBaseDocument.deleteMany({
        where: {
          id: documentId,
          knowledgeBaseId: target.knowledgeBaseId,
          status: "deleted",
        },
      });
      return;
    }

    const [
      knowledgeBase,
      tombstone,
      remainingObjects,
      liveDocuments,
      missingDocumentTombstones,
    ] = await Promise.all([
      transaction.knowledgeBase.findUnique({
        where: { id: target.knowledgeBaseId },
        select: {
          lifecycleStatus: true,
          storageUsedBytes: true,
          storageReservedBytes: true,
        },
      }),
      transaction.knowledgeBaseTombstone.findUnique({
        where: { id: target.knowledgeBaseId },
        select: { id: true },
      }),
      transaction.knowledgeBaseObject.count({
        where: {
          knowledgeBaseId: target.knowledgeBaseId,
          lifecycleStatus: { not: "cleaned" },
        },
      }),
      transaction.knowledgeBaseDocument.count({
        where: {
          knowledgeBaseId: target.knowledgeBaseId,
          status: { not: "deleted" },
        },
      }),
      transaction.$queryRaw<Array<{ id: string }>>`
        SELECT document."id"
        FROM "knowledge_base_documents" document
        LEFT JOIN "knowledge_base_document_tombstones" tombstone
          ON tombstone."id" = document."id"
         AND tombstone."knowledge_base_id" = document."knowledge_base_id"
        WHERE document."knowledge_base_id" = ${target.knowledgeBaseId}::uuid
          AND tombstone."id" IS NULL
        LIMIT 1
      `,
    ]);
    if (tombstone === null) {
      throw new Error("deleted knowledge base is missing its tombstone");
    }
    if (knowledgeBase !== null) {
      if (knowledgeBase.lifecycleStatus !== "deleted") {
        throw new Error("cleanup target is not a deleted knowledge base");
      }
      if (
        knowledgeBase.storageUsedBytes !== 0n ||
        knowledgeBase.storageReservedBytes !== 0n
      ) {
        throw new Error("deleted knowledge base quota has not converged");
      }
    }
    if (
      remainingObjects > 0 ||
      liveDocuments > 0 ||
      missingDocumentTombstones.length > 0
    ) {
      throw new Error("deleted knowledge base cleanup has not converged");
    }
    await transaction.knowledgeBaseTombstone.update({
      where: { id: target.knowledgeBaseId },
      data: {
        cleanupStatus: "completed",
        cleanupErrorCode: null,
        updatedAt: now,
      },
    });
    await transaction.knowledgeBaseDocumentTombstone.updateMany({
      where: { knowledgeBaseId: target.knowledgeBaseId },
      data: {
        cleanupStatus: "completed",
        cleanupErrorCode: null,
        updatedAt: now,
      },
    });
    await this.clearKnowledgeBaseSelectionReferences(
      transaction,
      target.knowledgeBaseId,
      now,
    );
    await transaction.knowledgeBaseGrant.deleteMany({
      where: { knowledgeBaseId: target.knowledgeBaseId },
    });
    await transaction.knowledgeBaseObject.deleteMany({
      where: { knowledgeBaseId: target.knowledgeBaseId },
    });
    await transaction.knowledgeBaseProcessingAttempt.deleteMany({
      where: { knowledgeBaseId: target.knowledgeBaseId },
    });
    await transaction.knowledgeBaseDocumentVersion.deleteMany({
      where: { knowledgeBaseId: target.knowledgeBaseId },
    });
    await transaction.knowledgeBaseStorageReservation.deleteMany({
      where: { knowledgeBaseId: target.knowledgeBaseId },
    });
    await transaction.knowledgeBaseEntry.deleteMany({
      where: { knowledgeBaseId: target.knowledgeBaseId },
    });
    await transaction.knowledgeBaseDocument.deleteMany({
      where: { knowledgeBaseId: target.knowledgeBaseId },
    });
    await transaction.knowledgeBaseCleanupOutbox.deleteMany({
      where: { knowledgeBaseId: target.knowledgeBaseId },
    });
    const sourceIds = (
      await transaction.knowledgeBaseSource.findMany({
        where: { knowledgeBaseId: target.knowledgeBaseId },
        select: { id: true },
      })
    ).map((source) => source.id);
    if (sourceIds.length > 0) {
      await transaction.knowledgeSourceItem.deleteMany({
        where: { sourceId: { in: sourceIds } },
      });
      await transaction.knowledgeSourceSyncRun.deleteMany({
        where: { sourceId: { in: sourceIds } },
      });
      await transaction.knowledgeBaseSource.deleteMany({
        where: { id: { in: sourceIds } },
      });
    }
    await transaction.knowledgeBase.deleteMany({
      where: { id: target.knowledgeBaseId, lifecycleStatus: "deleted" },
    });
  }

  private async clearKnowledgeBaseSelectionReferences(
    transaction: Prisma.TransactionClient,
    knowledgeBaseId: string,
    now: Date,
  ): Promise<void> {
    // Start-intent projection locks this row before writing a turn or updating
    // its conversation. Taking the same lock first prevents stale snapshots
    // from being projected after this transaction removes the deleted id.
    await transaction.$executeRaw`
      UPDATE "conversation_turn_start_intents"
      SET
        "knowledge_base_ids_json" =
          "knowledge_base_ids_json" - CAST(${knowledgeBaseId} AS text),
        "updated_at" = ${now}
      WHERE "knowledge_base_ids_json" ? CAST(${knowledgeBaseId} AS text)
    `;
    await transaction.$executeRaw`
      UPDATE "conversations"
      SET
        "selected_knowledge_base_ids_json" =
          "selected_knowledge_base_ids_json" - CAST(${knowledgeBaseId} AS text),
        "updated_at" = ${now}
      WHERE "selected_knowledge_base_ids_json" ? CAST(${knowledgeBaseId} AS text)
    `;
    await transaction.$executeRaw`
      UPDATE "conversation_drafts"
      SET
        "knowledge_base_ids_json" =
          "knowledge_base_ids_json" - CAST(${knowledgeBaseId} AS text),
        "updated_at" = ${now}
      WHERE "knowledge_base_ids_json" ? CAST(${knowledgeBaseId} AS text)
    `;
    await transaction.$executeRaw`
      UPDATE "pending_requests"
      SET
        "knowledge_base_ids_json" =
          "knowledge_base_ids_json" - CAST(${knowledgeBaseId} AS text),
        "updated_at" = ${now}
      WHERE "knowledge_base_ids_json" ? CAST(${knowledgeBaseId} AS text)
    `;
    await transaction.$executeRaw`
      UPDATE "conversation_turns"
      SET
        "knowledge_base_ids_json" =
          "knowledge_base_ids_json" - CAST(${knowledgeBaseId} AS text),
        "updated_at" = ${now}
      WHERE "knowledge_base_ids_json" ? CAST(${knowledgeBaseId} AS text)
    `;
    await transaction.conversationTurnKnowledgeBase.deleteMany({
      where: { knowledgeBaseId },
    });
  }

  private async completeVersionTarget(
    transaction: Prisma.TransactionClient,
    target: ClaimedKnowledgeCleanup,
    now: Date,
  ): Promise<void> {
    const documentId = target.documentId;
    const versionId = target.documentVersionId;
    if (documentId === null || versionId === null) return;
    await transaction.$queryRaw`
      SELECT "id"
      FROM "knowledge_base_documents"
      WHERE "id" = ${documentId}::uuid
      FOR UPDATE
    `;
    await transaction.$queryRaw`
      SELECT "id"
      FROM "knowledge_base_document_versions"
      WHERE "id" = ${versionId}::uuid
      FOR UPDATE
    `;
    const version = await transaction.knowledgeBaseDocumentVersion.findFirst({
      where: {
        id: versionId,
        knowledgeBaseId: target.knowledgeBaseId,
        documentId,
      },
      select: {
        sourceVersionId: true,
        versionStatus: true,
        supersededAt: true,
      },
    });
    if (version === null) return;
    if (version.sourceVersionId !== null) {
      await transaction.$queryRaw`
        SELECT "id"
        FROM "knowledge_base_document_versions"
        WHERE "id" = ${version.sourceVersionId}::uuid
        FOR UPDATE
      `;
    }
    const [activeOriginal, sourceReferenceCount] = await Promise.all([
      transaction.knowledgeBaseObject.findFirst({
        where: {
          knowledgeBaseId: target.knowledgeBaseId,
          documentId,
          documentVersionId: versionId,
          objectType: "original",
          lifecycleStatus: "active",
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: { id: true },
      }),
      transaction.knowledgeBaseDocumentVersion.count({
        where: {
          sourceVersionId: versionId,
          knowledgeBaseId: target.knowledgeBaseId,
          documentId,
          versionStatus: { not: "deleted" },
        },
      }),
    ]);
    const preserveSourceMetadata =
      activeOriginal !== null || sourceReferenceCount > 0;
    const rearmTargetAt =
      preserveSourceMetadata &&
      sourceReferenceCount === 0 &&
      version.versionStatus === "superseded" &&
      version.supersededAt !== null
        ? new Date(
            version.supersededAt.getTime() + SUPERSEDED_VERSION_RETENTION_MS,
          )
        : null;
    const releasedSourceVersionId = preserveSourceMetadata
      ? null
      : version.sourceVersionId;
    await transaction.knowledgeBaseProcessingAttempt.deleteMany({
      where: { documentVersionId: versionId },
    });
    await transaction.knowledgeBaseDocumentVersion.update({
      where: { id: versionId },
      data: {
        sourceVersionId: preserveSourceMetadata
          ? version.sourceVersionId
          : null,
        doclingBundleObjectId: null,
        doclingBundleSha256: null,
        displayMarkdownObjectId: null,
        displayMarkdownSha256: null,
        doclingJsonObjectId: null,
        doclingJsonSha256: null,
        hybridChunksObjectId: null,
        hybridChunksSha256: null,
        imageProjectionObjectId: null,
        imageProjectionSha256: null,
        retrievalManifestObjectId: null,
        retrievalManifestSha256: null,
        doclingVersion: null,
        parsedAssetCount: null,
        chunkerVersion: null,
        parserConfigDigest: null,
        chunkingConfigDigest: null,
        imageUnderstandingConfigDigest: null,
        processingConfigJson: {} as Prisma.InputJsonValue,
        processingConfigDigest: null,
        embeddingProfileHash: null,
        indexReady: false,
        indexIntegrityDigest: null,
        activationPreviousCurrentVersionId: null,
        parentCount: null,
        childCount: null,
        cleanupEligibleAt: rearmTargetAt,
        updatedAt: now,
      },
    });
    if (
      releasedSourceVersionId !== null &&
      releasedSourceVersionId !== versionId
    ) {
      await this.restoreReleasedSourceEligibility(
        transaction,
        target.knowledgeBaseId,
        documentId,
        releasedSourceVersionId,
        now,
      );
    }
  }

  private async restoreReleasedSourceEligibility(
    transaction: Prisma.TransactionClient,
    knowledgeBaseId: string,
    documentId: string,
    sourceVersionId: string,
    now: Date,
  ): Promise<void> {
    const [source, document, sourceReferenceCount, citationCount] =
      await Promise.all([
        transaction.knowledgeBaseDocumentVersion.findFirst({
          where: {
            id: sourceVersionId,
            knowledgeBaseId,
            documentId,
            versionStatus: "superseded",
          },
          select: { supersededAt: true },
        }),
        transaction.knowledgeBaseDocument.findFirst({
          where: { id: documentId, knowledgeBaseId },
          select: { currentVersionId: true },
        }),
        transaction.knowledgeBaseDocumentVersion.count({
          where: {
            sourceVersionId,
            knowledgeBaseId,
            documentId,
            versionStatus: { not: "deleted" },
          },
        }),
        transaction.conversationMessageKnowledgeCitation.count({
          where: { documentVersionId: sourceVersionId },
        }),
      ]);
    if (
      source === null ||
      source.supersededAt === null ||
      document === null ||
      document.currentVersionId === sourceVersionId ||
      sourceReferenceCount > 0 ||
      citationCount > 0
    ) {
      return;
    }
    await transaction.knowledgeBaseDocumentVersion.updateMany({
      where: {
        id: sourceVersionId,
        knowledgeBaseId,
        documentId,
        versionStatus: "superseded",
      },
      data: {
        cleanupEligibleAt: new Date(
          source.supersededAt.getTime() + SUPERSEDED_VERSION_RETENTION_MS,
        ),
        updatedAt: now,
      },
    });
  }

  async failTarget(input: {
    target: ClaimedKnowledgeCleanup;
    errorCode: string;
    nextAttemptAt: Date | null;
    now: Date;
  }): Promise<boolean> {
    return this.prisma.$transaction(async (transaction) => {
      if (!(await this.lockActiveClaim(transaction, input.target, input.now))) {
        return false;
      }
      const exhausted = input.nextAttemptAt === null;
      await transaction.knowledgeBaseCleanupOutbox.updateMany({
        where: {
          id: input.target.id,
          status: "running",
          attemptCount: input.target.attemptCount,
        },
        data: {
          status: exhausted ? "failed" : "pending",
          nextAttemptAt: input.nextAttemptAt,
          lastErrorCode: input.errorCode,
          updatedAt: input.now,
        },
      });
      await this.markTargetStatus(
        transaction,
        input.target,
        exhausted ? "failed" : "pending",
        exhausted ? input.errorCode : null,
        input.now,
      );
      return true;
    });
  }

  private async lockActiveClaim(
    transaction: Prisma.TransactionClient,
    target: Pick<ClaimedKnowledgeCleanup, "id" | "attemptCount">,
    now: Date,
  ): Promise<boolean> {
    const rows = await transaction.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "knowledge_base_cleanup_outbox"
      WHERE "id" = ${target.id}::uuid
        AND "status" = 'running'
        AND "attempt_count" = ${target.attemptCount}
        AND "next_attempt_at" > ${now}
      FOR UPDATE
    `;
    return rows.length === 1;
  }

  private async markTargetStatus(
    transaction: Prisma.TransactionClient,
    target:
      | Pick<
          ClaimedKnowledgeCleanup,
          "targetType" | "knowledgeBaseId" | "documentId" | "objectId"
        >
      | {
          target_type: string;
          knowledge_base_id: string;
          document_id: string | null;
          object_id: string | null;
        },
    status: "pending" | "running" | "failed" | "completed",
    errorCode: string | null,
    now: Date,
  ): Promise<void> {
    const targetType =
      "targetType" in target
        ? target.targetType
        : parseTargetType(target.target_type);
    const knowledgeBaseId =
      "knowledgeBaseId" in target
        ? target.knowledgeBaseId
        : target.knowledge_base_id;
    const documentId =
      "documentId" in target ? target.documentId : target.document_id;
    const objectId = "objectId" in target ? target.objectId : target.object_id;
    if (targetType === "knowledge_base") {
      await transaction.knowledgeBaseTombstone.updateMany({
        where: { id: knowledgeBaseId },
        data: {
          cleanupStatus: status,
          cleanupErrorCode: errorCode,
          updatedAt: now,
        },
      });
      await transaction.knowledgeBaseDocumentTombstone.updateMany({
        where: { knowledgeBaseId },
        data: {
          cleanupStatus: status,
          cleanupErrorCode: errorCode,
          updatedAt: now,
        },
      });
      await transaction.knowledgeBase.updateMany({
        where: { id: knowledgeBaseId },
        data: {
          cleanupStatus: status,
          cleanupErrorCode: errorCode,
          updatedAt: now,
        },
      });
      if (status === "completed") {
        await transaction.knowledgeBaseDocument.updateMany({
          where: { knowledgeBaseId, status: "deleted" },
          data: {
            cleanupStatus: "completed",
            cleanupErrorCode: null,
            updatedAt: now,
          },
        });
      }
      return;
    }
    if (targetType === "document" && documentId !== null) {
      await transaction.knowledgeBaseDocumentTombstone.updateMany({
        where: { id: documentId, knowledgeBaseId },
        data: {
          cleanupStatus: status,
          cleanupErrorCode: errorCode,
          updatedAt: now,
        },
      });
      await transaction.knowledgeBaseDocument.updateMany({
        where: { id: documentId, knowledgeBaseId },
        data: {
          cleanupStatus: status,
          cleanupErrorCode: errorCode,
          updatedAt: now,
        },
      });
      return;
    }
    if (targetType === "object" && objectId !== null) {
      await transaction.knowledgeBaseObject.updateMany({
        where: { id: objectId },
        data: {
          cleanupStatus: status,
          cleanupErrorCode: errorCode,
          updatedAt: now,
        },
      });
    }
  }
}

export function cleanupRetryDelay(attemptCount: number): number {
  const exponent = Math.max(0, Math.min(attemptCount - 1, 8));
  return Math.min(15_000 * 2 ** exponent, 60 * 60_000);
}

function storageReservationObjectKeys(
  value: unknown,
  knowledgeBaseId: string,
  documentId: string,
  documentVersionId: string,
): string[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((item) => typeof item !== "string") ||
    new Set(value).size !== value.length
  ) {
    throw new Error("invalid knowledge storage reservation object keys");
  }
  const objectKeys = value as string[];
  for (const objectKey of objectKeys) {
    assertManagedKnowledgeObjectKey(objectKey);
    if (
      !objectKey.startsWith(
        `knowledge-bases/${knowledgeBaseId}/documents/${documentId}/versions/${documentVersionId}/`,
      )
    ) {
      throw new Error("knowledge storage reservation object key mismatch");
    }
  }
  return objectKeys;
}

function storageReservationTargetWhere(
  target: ClaimedKnowledgeCleanup,
): Prisma.KnowledgeBaseStorageReservationWhereInput | null {
  if (target.targetType === "knowledge_base") {
    return { knowledgeBaseId: target.knowledgeBaseId };
  }
  if (target.targetType === "document" && target.documentId !== null) {
    return {
      knowledgeBaseId: target.knowledgeBaseId,
      documentId: target.documentId,
    };
  }
  if (
    target.targetType === "document_version" &&
    target.documentId !== null &&
    target.documentVersionId !== null
  ) {
    return {
      knowledgeBaseId: target.knowledgeBaseId,
      documentId: target.documentId,
      documentVersionId: target.documentVersionId,
    };
  }
  return null;
}

function cleanupErrorCode(error: unknown): string {
  if (error instanceof KnowledgeProcessingError) return error.code;
  return "KNOWLEDGE_CLEANUP_FAILED";
}

function assertCleanupPage(afterId: string | null, limit: number): void {
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 1_000 ||
    (afterId !== null &&
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
        afterId,
      ))
  ) {
    throw new Error("invalid knowledge cleanup page");
  }
}

async function* asAsyncIterable<T>(values: readonly T[]): AsyncIterable<T> {
  yield* values;
}

function parseTargetType(value: string): KnowledgeCleanupTargetType {
  if (
    value === "knowledge_base" ||
    value === "document" ||
    value === "document_version" ||
    value === "object"
  ) {
    return value;
  }
  throw new Error("invalid knowledge cleanup target type");
}
