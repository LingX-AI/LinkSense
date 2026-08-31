import { describe, expect, it, vi } from "vitest";

import {
  KnowledgeCleanupWorker,
  PrismaKnowledgeCleanupRepository,
  cleanupRetryDelay,
  type ClaimedKnowledgeCleanup,
  type KnowledgeCleanupRepository,
} from "../src/modules/knowledge/cleanup.js";
import { SUPERSEDED_VERSION_RETENTION_MS } from "../src/modules/knowledge/retention.js";

const BASE_ID = "00000000-0000-4000-8000-000000000001";
const DOCUMENT_ID = "00000000-0000-4000-8000-000000000002";
const VERSION_ID = "00000000-0000-4000-8000-000000000003";
const OBJECT_ID = "00000000-0000-4000-8000-000000000004";
const OUTBOX_ID = "00000000-0000-4000-8000-000000000005";
const CURRENT_VERSION_ID = "00000000-0000-4000-8000-000000000006";
const SOURCE_VERSION_ID = "00000000-0000-4000-8000-000000000007";
const SECOND_DOCUMENT_ID = "00000000-0000-4000-8000-000000000008";
const SECOND_OBJECT_ID = "00000000-0000-4000-8000-000000000009";
const NOW = new Date("2026-07-22T00:00:00.000Z");
const SUPERSEDED_AT = new Date(NOW.getTime() - SUPERSEDED_VERSION_RETENTION_MS);

describe("KnowledgeCleanupWorker", () => {
  it("removes only unregistered MinIO objects after the isolation window", async () => {
    const registeredKey = managedObjectKey(
      "00000000-0000-4000-8000-000000000006",
    );
    const orphanKey = managedObjectKey("00000000-0000-4000-8000-000000000007");
    const remove = vi.fn(async () => undefined);
    const worker = new KnowledgeCleanupWorker(
      fakeRepository({
        isRegisteredObjectKey: vi.fn(async (key) => key === registeredKey),
      }),
      {
        remove,
        listManagedObjectsOlderThan: vi.fn(async () => [
          {
            key: registeredKey,
            lastModified: new Date(NOW.getTime() - 90_000_000),
          },
          {
            key: orphanKey,
            lastModified: new Date(NOW.getTime() - 90_000_000),
          },
        ]),
      },
      { deleteDocument: vi.fn(), deleteDocumentVersion: vi.fn() },
      { now: () => NOW, orphanScanIntervalMs: 1 },
    );

    await expect(worker.runOnce()).resolves.toBe(0);

    expect(remove).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledWith(orphanKey);
  });

  it("streams past registered pages until it reaches the orphan batch", async () => {
    const registeredKeys = Array.from({ length: 101 }, (_, index) =>
      managedObjectKey(
        `40000000-0000-4000-8000-${String(index + 10).padStart(12, "0")}`,
      ),
    );
    const orphanKey = managedObjectKey("40000000-0000-4000-8000-000000000999");
    const remove = vi.fn(async () => undefined);
    const listFallback = vi.fn(async () => []);
    const worker = new KnowledgeCleanupWorker(
      fakeRepository({
        isRegisteredObjectKey: vi.fn(async (key) =>
          registeredKeys.includes(key),
        ),
      }),
      {
        remove,
        listManagedObjectsOlderThan: listFallback,
        async *iterateManagedObjectsOlderThan() {
          for (const key of [...registeredKeys, orphanKey]) {
            yield {
              key,
              lastModified: new Date(NOW.getTime() - 90_000_000),
            };
          }
        },
      },
      { deleteDocument: vi.fn(), deleteDocumentVersion: vi.fn() },
      {
        now: () => NOW,
        orphanScanIntervalMs: 1,
        orphanScanBatchSize: 1,
      },
    );

    await expect(worker.runOnce()).resolves.toBe(0);

    expect(listFallback).not.toHaveBeenCalled();
    expect(remove).toHaveBeenCalledExactlyOnceWith(orphanKey);
  });

  it("enqueues due superseded versions and marks their objects pending atomically", async () => {
    const updateObjects = vi.fn(async () => ({ count: 2 }));
    const createOutbox = vi.fn(async () => ({}));
    const updateVersion = vi.fn(async () => ({ count: 1 }));
    const transaction = {
      $queryRaw: vi.fn(async () => [{ id: OUTBOX_ID }]),
      knowledgeBase: {
        findUnique: vi.fn(async () => ({ lifecycleStatus: "active" })),
      },
      knowledgeBaseDocument: {
        findFirst: vi.fn(async () => ({
          status: "ready",
          currentVersionId: CURRENT_VERSION_ID,
        })),
      },
      knowledgeBaseObject: { updateMany: updateObjects },
      knowledgeBaseCleanupOutbox: {
        findFirst: vi.fn(async () => null),
        create: createOutbox,
      },
      knowledgeBaseDocumentVersion: {
        findFirst: vi.fn(async () => ({
          versionStatus: "superseded",
          cleanupEligibleAt: NOW,
        })),
        updateMany: updateVersion,
        count: vi.fn(async () => 0),
      },
      conversationMessageKnowledgeCitation: {
        count: vi.fn(async () => 0),
      },
    };
    const repository = new PrismaKnowledgeCleanupRepository({
      $queryRaw: vi.fn(async () => [
        {
          id: VERSION_ID,
          knowledge_base_id: BASE_ID,
          document_id: DOCUMENT_ID,
        },
      ]),
      $transaction: vi.fn(async (work: (tx: typeof transaction) => unknown) =>
        work(transaction),
      ),
    } as never);

    await expect(repository.enqueueDueVersionCleanup(NOW)).resolves.toBe(1);

    expect(updateObjects).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { documentVersionId: VERSION_ID, lifecycleStatus: "active" },
        data: expect.objectContaining({
          lifecycleStatus: "pending_cleanup",
          cleanupStatus: "pending",
        }),
      }),
    );
    expect(createOutbox).toHaveBeenCalledWith({
      data: expect.objectContaining({
        targetType: "document_version",
        knowledgeBaseId: BASE_ID,
        documentId: DOCUMENT_ID,
        documentVersionId: VERSION_ID,
      }),
    });
    expect(transaction.$queryRaw).toHaveBeenCalledTimes(3);
    expect(transaction.$queryRaw.mock.invocationCallOrder[2]).toBeLessThan(
      transaction.knowledgeBaseDocumentVersion.count.mock
        .invocationCallOrder[0]!,
    );
    expect(
      transaction.knowledgeBaseCleanupOutbox.findFirst,
    ).toHaveBeenCalledWith({
      where: {
        targetType: "document_version",
        documentVersionId: VERSION_ID,
        status: { not: "completed" },
      },
      select: { id: true },
    });
    expect(updateVersion).toHaveBeenCalledWith({
      where: {
        id: VERSION_ID,
        versionStatus: "superseded",
        cleanupEligibleAt: { lte: NOW },
      },
      data: { cleanupEligibleAt: null, updatedAt: NOW },
    });
  });

  it("cleans only derived objects when a retained version references the original root", async () => {
    const updateObjects = vi.fn(async () => ({ count: 4 }));
    const createOutbox = vi.fn(async () => ({}));
    const updateVersion = vi.fn(async () => ({ count: 1 }));
    const countSourceReferences = vi.fn(async () => 1);
    const transaction = {
      $queryRaw: vi.fn(async () => []),
      knowledgeBase: {
        findUnique: vi.fn(async () => ({ lifecycleStatus: "active" })),
      },
      knowledgeBaseDocument: {
        findFirst: vi.fn(async () => ({
          status: "ready",
          currentVersionId: CURRENT_VERSION_ID,
        })),
      },
      knowledgeBaseObject: { updateMany: updateObjects },
      knowledgeBaseCleanupOutbox: {
        findFirst: vi.fn(async () => null),
        create: createOutbox,
      },
      knowledgeBaseDocumentVersion: {
        findFirst: vi.fn(async () => ({
          versionStatus: "superseded",
          cleanupEligibleAt: NOW,
        })),
        updateMany: updateVersion,
        count: countSourceReferences,
      },
      conversationMessageKnowledgeCitation: {
        count: vi.fn(async () => 0),
      },
    };
    const repository = new PrismaKnowledgeCleanupRepository({
      $queryRaw: vi.fn(async () => [
        {
          id: VERSION_ID,
          knowledge_base_id: BASE_ID,
          document_id: DOCUMENT_ID,
        },
      ]),
      $transaction: vi.fn(async (work: (tx: typeof transaction) => unknown) =>
        work(transaction),
      ),
    } as never);

    await expect(repository.enqueueDueVersionCleanup(NOW)).resolves.toBe(1);

    expect(countSourceReferences).toHaveBeenCalledWith({
      where: {
        sourceVersionId: VERSION_ID,
        knowledgeBaseId: BASE_ID,
        documentId: DOCUMENT_ID,
        versionStatus: { not: "deleted" },
      },
    });
    expect(updateObjects).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          documentVersionId: VERSION_ID,
          lifecycleStatus: "active",
          objectType: { not: "original" },
        },
      }),
    );
    expect(createOutbox).toHaveBeenCalledOnce();
  });

  it("keeps every object when a structured answer citation retains the version", async () => {
    const updateObjects = vi.fn(async () => ({ count: 0 }));
    const createOutbox = vi.fn(async () => ({}));
    const updateVersion = vi.fn(async () => ({ count: 1 }));
    const transaction = {
      $queryRaw: vi.fn(async () => []),
      knowledgeBase: {
        findUnique: vi.fn(async () => ({ lifecycleStatus: "active" })),
      },
      knowledgeBaseDocument: {
        findFirst: vi.fn(async () => ({
          status: "ready",
          currentVersionId: CURRENT_VERSION_ID,
        })),
      },
      knowledgeBaseObject: { updateMany: updateObjects },
      knowledgeBaseCleanupOutbox: {
        findFirst: vi.fn(async () => null),
        create: createOutbox,
      },
      knowledgeBaseDocumentVersion: {
        findFirst: vi.fn(async () => ({
          versionStatus: "superseded",
          cleanupEligibleAt: NOW,
        })),
        updateMany: updateVersion,
        count: vi.fn(async () => 1),
      },
      conversationMessageKnowledgeCitation: {
        count: vi.fn(async () => 1),
      },
    };
    const repository = new PrismaKnowledgeCleanupRepository({
      $queryRaw: vi.fn(async () => [
        {
          id: VERSION_ID,
          knowledge_base_id: BASE_ID,
          document_id: DOCUMENT_ID,
        },
      ]),
      $transaction: vi.fn(async (work: (tx: typeof transaction) => unknown) =>
        work(transaction),
      ),
    } as never);

    await expect(repository.enqueueDueVersionCleanup(NOW)).resolves.toBe(0);

    expect(updateVersion).toHaveBeenCalledWith({
      where: { id: VERSION_ID, versionStatus: "superseded" },
      data: { cleanupEligibleAt: null, updatedAt: NOW },
    });
    expect(updateObjects).not.toHaveBeenCalled();
    expect(createOutbox).not.toHaveBeenCalled();
  });

  it("keeps an active original and compacts a referenced root to source-only metadata", async () => {
    const updateVersion = vi.fn(async () => ({}));
    const transaction = {
      $queryRaw: vi.fn(async () => [{ id: OUTBOX_ID }]),
      knowledgeBaseObject: {
        findFirst: vi.fn(async () => ({ id: OBJECT_ID })),
      },
      knowledgeBaseDocumentVersion: {
        findFirst: vi.fn(async () => ({
          sourceVersionId: null,
          versionStatus: "superseded",
          supersededAt: SUPERSEDED_AT,
        })),
        count: vi.fn(async () => 1),
        update: updateVersion,
      },
      knowledgeBaseProcessingAttempt: {
        deleteMany: vi.fn(async () => ({ count: 0 })),
      },
      knowledgeBaseCleanupOutbox: {
        deleteMany: vi.fn(async () => ({ count: 1 })),
      },
      knowledgeBaseStorageReservation: { count: vi.fn(async () => 0) },
    };
    const repository = new PrismaKnowledgeCleanupRepository({
      $transaction: vi.fn(async (work: (tx: typeof transaction) => unknown) =>
        work(transaction),
      ),
    } as never);

    await repository.completeTarget(documentVersionTarget(), NOW);

    expect(updateVersion).toHaveBeenCalledWith({
      where: { id: VERSION_ID },
      data: {
        sourceVersionId: null,
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
        imageUnderstandingConfigDigest: null,
        retrievalManifestObjectId: null,
        retrievalManifestSha256: null,
        doclingVersion: null,
        parsedAssetCount: null,
        chunkerVersion: null,
        parserConfigDigest: null,
        chunkingConfigDigest: null,
        processingConfigJson: {},
        processingConfigDigest: null,
        embeddingProfileHash: null,
        indexReady: false,
        indexIntegrityDigest: null,
        activationPreviousCurrentVersionId: null,
        parentCount: null,
        childCount: null,
        cleanupEligibleAt: null,
        updatedAt: NOW,
      },
    });
  });

  it("rearms a retained original for a second cleanup after its last consumer disappears", async () => {
    const updateVersion = vi.fn(async () => ({}));
    const transaction = {
      $queryRaw: vi.fn(async () => [{ id: OUTBOX_ID }]),
      knowledgeBaseObject: {
        findFirst: vi.fn(async () => ({ id: OBJECT_ID })),
      },
      knowledgeBaseDocumentVersion: {
        findFirst: vi.fn(async () => ({
          sourceVersionId: null,
          versionStatus: "superseded",
          supersededAt: SUPERSEDED_AT,
        })),
        count: vi.fn(async () => 0),
        update: updateVersion,
      },
      knowledgeBaseProcessingAttempt: {
        deleteMany: vi.fn(async () => ({ count: 0 })),
      },
      knowledgeBaseCleanupOutbox: {
        deleteMany: vi.fn(async () => ({ count: 1 })),
      },
      knowledgeBaseStorageReservation: { count: vi.fn(async () => 0) },
    };
    const repository = new PrismaKnowledgeCleanupRepository({
      $transaction: vi.fn(async (work: (tx: typeof transaction) => unknown) =>
        work(transaction),
      ),
    } as never);

    await repository.completeTarget(documentVersionTarget(), NOW);

    expect(updateVersion).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          displayMarkdownObjectId: null,
          hybridChunksObjectId: null,
          retrievalManifestObjectId: null,
          cleanupEligibleAt: new Date(
            SUPERSEDED_AT.getTime() + SUPERSEDED_VERSION_RETENTION_MS,
          ),
        }),
      }),
    );
  });

  it("releases the last source reference and rearms the root at its original deadline", async () => {
    const deleteOutbox = vi.fn(async () => ({ count: 1 }));
    const updateVersion = vi.fn(async () => ({}));
    const rearmSource = vi.fn(async () => ({ count: 1 }));
    const transaction = {
      $queryRaw: vi.fn(async () => [{ id: OUTBOX_ID }]),
      knowledgeBaseObject: { findFirst: vi.fn(async () => null) },
      knowledgeBaseDocument: {
        findFirst: vi.fn(async () => ({
          currentVersionId: CURRENT_VERSION_ID,
        })),
      },
      knowledgeBaseDocumentVersion: {
        findFirst: vi.fn(async ({ where }: { where: { id: string } }) =>
          where.id === VERSION_ID
            ? {
                sourceVersionId: SOURCE_VERSION_ID,
                versionStatus: "superseded",
                supersededAt: SUPERSEDED_AT,
              }
            : { supersededAt: SUPERSEDED_AT },
        ),
        count: vi.fn(async () => 0),
        update: updateVersion,
        updateMany: rearmSource,
      },
      knowledgeBaseProcessingAttempt: {
        deleteMany: vi.fn(async () => ({ count: 0 })),
      },
      conversationMessageKnowledgeCitation: {
        count: vi.fn(async () => 0),
      },
      knowledgeBaseCleanupOutbox: { deleteMany: deleteOutbox },
      knowledgeBaseEntry: { deleteMany: vi.fn(async () => ({ count: 0 })) },
      knowledgeBaseStorageReservation: { count: vi.fn(async () => 0) },
    };
    const repository = new PrismaKnowledgeCleanupRepository({
      $transaction: vi.fn(async (work: (tx: typeof transaction) => unknown) =>
        work(transaction),
      ),
    } as never);

    await repository.completeTarget(documentVersionTarget(), NOW);

    expect(updateVersion).toHaveBeenCalledWith({
      where: { id: VERSION_ID },
      data: expect.objectContaining({
        sourceVersionId: null,
        displayMarkdownObjectId: null,
        hybridChunksObjectId: null,
        retrievalManifestObjectId: null,
        indexReady: false,
      }),
    });
    expect(rearmSource).toHaveBeenCalledWith({
      where: {
        id: SOURCE_VERSION_ID,
        knowledgeBaseId: BASE_ID,
        documentId: DOCUMENT_ID,
        versionStatus: "superseded",
      },
      data: {
        cleanupEligibleAt: new Date(
          SUPERSEDED_AT.getTime() + SUPERSEDED_VERSION_RETENTION_MS,
        ),
        updatedAt: NOW,
      },
    });
    expect(deleteOutbox).toHaveBeenCalledWith({
      where: { id: OUTBOX_ID, status: "running", attemptCount: 1 },
    });
  });

  it("does not rearm an upstream original while another source consumer remains", async () => {
    const rearmSource = vi.fn(async () => ({ count: 1 }));
    let countCall = 0;
    const transaction = {
      $queryRaw: vi.fn(async () => []),
      knowledgeBaseObject: { findFirst: vi.fn(async () => null) },
      knowledgeBaseDocument: {
        findFirst: vi.fn(async () => ({
          currentVersionId: CURRENT_VERSION_ID,
        })),
      },
      knowledgeBaseDocumentVersion: {
        findFirst: vi.fn(async ({ where }: { where: { id: string } }) =>
          where.id === VERSION_ID
            ? {
                sourceVersionId: SOURCE_VERSION_ID,
                versionStatus: "superseded",
                supersededAt: SUPERSEDED_AT,
              }
            : { supersededAt: SUPERSEDED_AT },
        ),
        count: vi.fn(async () => (countCall++ === 0 ? 0 : 1)),
        update: vi.fn(async () => ({})),
        updateMany: rearmSource,
      },
      conversationMessageKnowledgeCitation: {
        count: vi.fn(async () => 0),
      },
      knowledgeBaseCleanupOutbox: {
        deleteMany: vi.fn(async () => ({ count: 1 })),
      },
      knowledgeBaseStorageReservation: { count: vi.fn(async () => 0) },
    };
    const repository = new PrismaKnowledgeCleanupRepository({
      $transaction: vi.fn(async (work: (tx: typeof transaction) => unknown) =>
        work(transaction),
      ),
    } as never);

    await repository.completeTarget(documentVersionTarget(), NOW);

    expect(rearmSource).not.toHaveBeenCalled();
  });

  it("lists only the object set durably frozen as pending cleanup", async () => {
    const findMany = vi.fn(async () => []);
    const repository = new PrismaKnowledgeCleanupRepository({
      knowledgeBaseObject: { findMany },
    } as never);

    await repository.listObjects({
      target: documentVersionTarget(),
      afterId: null,
      limit: 100,
    });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          lifecycleStatus: "pending_cleanup",
          knowledgeBaseId: BASE_ID,
          documentId: DOCUMENT_ID,
          documentVersionId: VERSION_ID,
        },
      }),
    );
  });

  it("enqueues stale unadopted derived objects without widening cleanup", async () => {
    const updateObject = vi.fn(async () => ({ count: 1 }));
    const createOutbox = vi.fn(async () => ({}));
    const transaction = {
      $queryRaw: vi.fn(async () => [
        {
          id: OBJECT_ID,
          knowledge_base_id: BASE_ID,
          document_id: DOCUMENT_ID,
          document_version_id: VERSION_ID,
        },
      ]),
      knowledgeBaseObject: { updateMany: updateObject },
      knowledgeBaseCleanupOutbox: { create: createOutbox },
    };
    const repository = new PrismaKnowledgeCleanupRepository({
      $transaction: vi.fn(async (work: (tx: typeof transaction) => unknown) =>
        work(transaction),
      ),
    } as never);

    await expect(
      repository.enqueueStaleDerivedObjectCleanup(NOW),
    ).resolves.toBe(1);

    expect(updateObject).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: OBJECT_ID, lifecycleStatus: "active" },
      }),
    );
    expect(createOutbox).toHaveBeenCalledWith({
      data: expect.objectContaining({
        targetType: "object",
        objectId: OBJECT_ID,
        documentVersionId: VERSION_ID,
      }),
    });
  });

  it("protects an exact MinIO key while a durable reservation exists", async () => {
    const objectKey = managedObjectKey();
    const findReservation = vi.fn(async () => ({ id: OUTBOX_ID }));
    const repository = new PrismaKnowledgeCleanupRepository({
      knowledgeBaseObject: { findUnique: vi.fn(async () => null) },
      knowledgeBaseStorageReservation: { findFirst: findReservation },
    } as never);

    await expect(repository.isRegisteredObjectKey(objectKey)).resolves.toBe(
      true,
    );
    expect(findReservation).toHaveBeenCalledWith({
      where: { objectKeysJson: { array_contains: [objectKey] } },
      select: { id: true },
    });
  });

  it("keyset-scans past 101 undeletable reservations and releases a later healthy row", async () => {
    const claimNow = new Date(NOW.getTime() + 10 * 60_000);
    const expiredAt = new Date(NOW.getTime() - 1);
    const candidates = Array.from({ length: 102 }, (_, index) => {
      const suffix = String(index + 100).padStart(12, "0");
      const id = `70000000-0000-4000-8000-${suffix}`;
      return {
        id,
        knowledgeBaseId: BASE_ID,
        expiresAt: expiredAt,
        objectKey: managedObjectKey(id),
      };
    });
    let page = 0;
    const findMany = vi.fn(async () =>
      page++ === 0 ? candidates.slice(0, 100) : candidates.slice(100),
    );
    const deleted: string[] = [];
    const leaseTokens = new Map<string, string>();
    const transaction = {
      $queryRaw: vi.fn(async () => []),
      knowledgeBaseStorageReservation: {
        findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
          const candidate = candidates.find((item) => item.id === where.id);
          return candidate
            ? {
                id: candidate.id,
                knowledgeBaseId: candidate.knowledgeBaseId,
                documentId: DOCUMENT_ID,
                documentVersionId: VERSION_ID,
                expiresAt: candidate.expiresAt,
                leaseExpiresAt: candidate.expiresAt,
                leaseToken: leaseTokens.get(candidate.id) ?? candidate.id,
                sizeBytes: 1n,
                objectKeysJson: [candidate.objectKey],
              }
            : null;
        }),
        update: vi.fn(
          async ({
            where,
            data,
          }: {
            where: { id: string };
            data: { leaseToken: string };
          }) => {
            leaseTokens.set(where.id, data.leaseToken);
            return {};
          },
        ),
        delete: vi.fn(async ({ where }: { where: { id: string } }) => {
          deleted.push(where.id);
          return {};
        }),
      },
      knowledgeBaseObject: { count: vi.fn(async () => 0) },
      knowledgeBase: { updateMany: vi.fn(async () => ({ count: 1 })) },
    };
    const repository = new PrismaKnowledgeCleanupRepository(
      {
        knowledgeBaseStorageReservation: { findMany },
        $transaction: vi.fn(async (work: (tx: typeof transaction) => unknown) =>
          work(transaction),
        ),
      } as never,
      () => claimNow,
    );
    const healthyKey = candidates.at(-1)!.objectKey;
    const remove = vi.fn(async (key: string) => {
      if (key !== healthyKey) throw new Error("still unavailable");
    });

    await expect(
      repository.releaseExpiredStorageReservations(NOW, { remove }),
    ).resolves.toBe(1);

    expect(findMany).toHaveBeenCalledTimes(2);
    expect(
      transaction.knowledgeBaseStorageReservation.update,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          leaseExpiresAt: new Date(claimNow.getTime() + 5 * 60_000),
          cleanupStartedAt: claimNow,
        }),
      }),
    );
    expect(remove).toHaveBeenCalledTimes(102);
    expect(deleted).toEqual([candidates.at(-1)!.id]);
  });

  it("keeps an expired reservation and all MinIO keys when only part of its suite is registered", async () => {
    const objectKeys = [
      managedObjectKey("71000000-0000-4000-8000-000000000001"),
      managedObjectKey("71000000-0000-4000-8000-000000000002"),
    ];
    const reservation = {
      id: OUTBOX_ID,
      knowledgeBaseId: BASE_ID,
      documentId: DOCUMENT_ID,
      documentVersionId: VERSION_ID,
      expiresAt: new Date(NOW.getTime() - 1),
      leaseExpiresAt: new Date(NOW.getTime() - 1),
      leaseToken: "71000000-0000-4000-8000-000000000003",
      cleanupStartedAt: null,
      sizeBytes: 9n,
      objectKeysJson: objectKeys,
    };
    const count = vi.fn(async () => 1);
    const updateReservation = vi.fn(async () => ({}));
    const deleteReservation = vi.fn(async () => ({}));
    const releaseQuota = vi.fn(async () => ({ count: 1 }));
    const transaction = {
      $queryRaw: vi.fn(async () => []),
      knowledgeBaseStorageReservation: {
        findUnique: vi.fn(async () => reservation),
        update: updateReservation,
        delete: deleteReservation,
      },
      knowledgeBaseObject: { count },
      knowledgeBase: { updateMany: releaseQuota },
    };
    const repository = new PrismaKnowledgeCleanupRepository(
      {
        knowledgeBaseStorageReservation: {
          findMany: vi.fn(async () => [
            {
              id: reservation.id,
              knowledgeBaseId: reservation.knowledgeBaseId,
              expiresAt: reservation.expiresAt,
            },
          ]),
        },
        $transaction: vi.fn(async (work: (tx: typeof transaction) => unknown) =>
          work(transaction),
        ),
      } as never,
      () => NOW,
    );
    const remove = vi.fn(async () => undefined);

    await expect(
      repository.releaseExpiredStorageReservations(NOW, { remove }),
    ).resolves.toBe(0);

    expect(count).toHaveBeenCalledWith({
      where: { objectKey: { in: objectKeys } },
    });
    expect(remove).not.toHaveBeenCalled();
    expect(updateReservation).not.toHaveBeenCalled();
    expect(deleteReservation).not.toHaveBeenCalled();
    expect(releaseQuota).not.toHaveBeenCalled();
  });

  it("releases duplicate reserved bytes without deleting MinIO when the whole suite is registered", async () => {
    const objectKeys = [
      managedObjectKey("72000000-0000-4000-8000-000000000001"),
      managedObjectKey("72000000-0000-4000-8000-000000000002"),
    ];
    const reservation = {
      id: OUTBOX_ID,
      knowledgeBaseId: BASE_ID,
      documentId: DOCUMENT_ID,
      documentVersionId: VERSION_ID,
      expiresAt: new Date(NOW.getTime() - 1),
      leaseExpiresAt: new Date(NOW.getTime() - 1),
      leaseToken: "72000000-0000-4000-8000-000000000003",
      cleanupStartedAt: null,
      sizeBytes: 9n,
      objectKeysJson: objectKeys,
    };
    const updateReservation = vi.fn(async () => ({}));
    const deleteReservation = vi.fn(async () => ({}));
    const releaseQuota = vi.fn(async () => ({ count: 1 }));
    const transaction = {
      $queryRaw: vi.fn(async () => []),
      knowledgeBaseStorageReservation: {
        findUnique: vi.fn(async () => reservation),
        update: updateReservation,
        delete: deleteReservation,
      },
      knowledgeBaseObject: { count: vi.fn(async () => objectKeys.length) },
      knowledgeBase: { updateMany: releaseQuota },
    };
    const repository = new PrismaKnowledgeCleanupRepository(
      {
        knowledgeBaseStorageReservation: {
          findMany: vi.fn(async () => [
            {
              id: reservation.id,
              knowledgeBaseId: reservation.knowledgeBaseId,
              expiresAt: reservation.expiresAt,
            },
          ]),
        },
        $transaction: vi.fn(async (work: (tx: typeof transaction) => unknown) =>
          work(transaction),
        ),
      } as never,
      () => NOW,
    );
    const remove = vi.fn(async () => undefined);

    await expect(
      repository.releaseExpiredStorageReservations(NOW, { remove }),
    ).resolves.toBe(1);

    expect(remove).not.toHaveBeenCalled();
    expect(updateReservation).not.toHaveBeenCalled();
    expect(releaseQuota).toHaveBeenCalledWith({
      where: {
        id: BASE_ID,
        storageReservedBytes: { gte: 9n },
      },
      data: {
        storageReservedBytes: { decrement: 9n },
        updatedAt: NOW,
      },
    });
    expect(deleteReservation).toHaveBeenCalledWith({
      where: { id: OUTBOX_ID },
    });
  });

  it("heartbeats a reaper lease while exact-key removal is still running", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const removal = deferred<void>();
    const objectKey = managedObjectKey();
    const reservation = {
      id: OUTBOX_ID,
      knowledgeBaseId: BASE_ID,
      documentId: DOCUMENT_ID,
      documentVersionId: VERSION_ID,
      expiresAt: new Date(NOW.getTime() - 1),
      leaseExpiresAt: new Date(NOW.getTime() - 1),
      leaseToken: "a0000000-0000-4000-8000-000000000001",
      cleanupStartedAt: null as Date | null,
      sizeBytes: 1n,
      objectKeysJson: [objectKey],
    };
    const renewLease = vi.fn(async () => ({ count: 1 }));
    const transaction = {
      $queryRaw: vi.fn(async () => []),
      knowledgeBaseStorageReservation: {
        findUnique: vi.fn(async () => reservation),
        update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          Object.assign(reservation, data);
          return reservation;
        }),
        updateMany: renewLease,
        delete: vi.fn(async () => ({})),
      },
      knowledgeBaseObject: { count: vi.fn(async () => 0) },
      knowledgeBase: { updateMany: vi.fn(async () => ({ count: 1 })) },
    };
    const repository = new PrismaKnowledgeCleanupRepository({
      knowledgeBaseStorageReservation: {
        findMany: vi.fn(async () => [
          {
            id: reservation.id,
            knowledgeBaseId: reservation.knowledgeBaseId,
            expiresAt: reservation.expiresAt,
          },
        ]),
      },
      $transaction: vi.fn(async (work: (tx: typeof transaction) => unknown) =>
        work(transaction),
      ),
    } as never);
    const running = repository.releaseExpiredStorageReservations(NOW, {
      remove: vi.fn(() => removal.promise),
    });
    await Promise.resolve();
    await Promise.resolve();

    await vi.advanceTimersByTimeAsync(60_000);
    expect(renewLease).toHaveBeenCalledWith({
      where: {
        id: reservation.id,
        knowledgeBaseId: BASE_ID,
        leaseToken: reservation.leaseToken,
        cleanupStartedAt: { not: null },
      },
      data: {
        leaseExpiresAt: new Date(NOW.getTime() + 60_000 + 5 * 60_000),
      },
    });

    removal.resolve();
    await expect(running).resolves.toBe(1);
    vi.useRealTimers();
  });

  it("reconciles used and reserved counters from durable fact rows", async () => {
    const update = vi.fn(async () => ({}));
    const transaction = {
      $queryRaw: vi.fn(async () => []),
      knowledgeBase: {
        findUnique: vi.fn(async () => ({
          storageUsedBytes: 1n,
          storageReservedBytes: 2n,
        })),
        update,
      },
      knowledgeBaseObject: {
        aggregate: vi.fn(async () => ({ _sum: { sizeBytes: 12n } })),
      },
      knowledgeBaseStorageReservation: {
        aggregate: vi.fn(async () => ({ _sum: { sizeBytes: 3n } })),
      },
    };
    const repository = new PrismaKnowledgeCleanupRepository({
      $queryRaw: vi.fn(async () => [{ id: BASE_ID }]),
      $transaction: vi.fn(async (work: (tx: typeof transaction) => unknown) =>
        work(transaction),
      ),
    } as never);

    await expect(
      repository.reconcileStorageLedger(NOW, null, 100),
    ).resolves.toEqual({
      reconciled: 1,
      nextCursor: null,
    });
    expect(update).toHaveBeenCalledWith({
      where: { id: BASE_ID },
      data: {
        storageUsedBytes: 12n,
        storageReservedBytes: 3n,
        updatedAt: NOW,
      },
    });
  });

  it("defers target completion without consuming an attempt while reservations remain", async () => {
    const updateOutbox = vi.fn(async () => ({ count: 1 }));
    const updateDocument = vi.fn(async () => ({ count: 1 }));
    const transaction = {
      $queryRaw: vi.fn(async (parts: TemplateStringsArray) =>
        parts.join("").includes("knowledge_base_cleanup_outbox")
          ? [{ id: OUTBOX_ID }]
          : [],
      ),
      knowledgeBaseStorageReservation: { count: vi.fn(async () => 1) },
      knowledgeBaseCleanupOutbox: { updateMany: updateOutbox },
      knowledgeBaseDocument: { updateMany: updateDocument },
      knowledgeBaseDocumentTombstone: {
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
    };
    const repository = new PrismaKnowledgeCleanupRepository({
      $transaction: vi.fn(async (work: (tx: typeof transaction) => unknown) =>
        work(transaction),
      ),
    } as never);

    await expect(
      repository.completeTarget(documentTarget(), NOW),
    ).resolves.toBe(false);

    expect(
      transaction.knowledgeBaseStorageReservation.count,
    ).toHaveBeenCalledWith({
      where: { knowledgeBaseId: BASE_ID, documentId: DOCUMENT_ID },
    });
    expect(updateOutbox).toHaveBeenCalledWith({
      where: { id: OUTBOX_ID, status: "running", attemptCount: 1 },
      data: {
        status: "pending",
        maxAttempts: { increment: 1 },
        nextAttemptAt: new Date(NOW.getTime() + 15_000),
        lastErrorCode: null,
        updatedAt: NOW,
      },
    });
    expect(updateDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ cleanupStatus: "pending" }),
      }),
    );
  });

  it("converges a deleted document to only its completed tombstone", async () => {
    const deleteObjects = vi.fn(async () => ({ count: 2 }));
    const deleteVersions = vi.fn(async () => ({ count: 1 }));
    const deleteDocument = vi.fn(async () => ({ count: 1 }));
    const deleteOutbox = vi.fn(async () => ({ count: 1 }));
    const deleteAttempts = vi.fn(async () => ({ count: 1 }));
    const completeTombstone = vi.fn(async () => ({}));
    const transaction = {
      $queryRaw: vi.fn(async () => [{ id: OUTBOX_ID }]),
      knowledgeBaseStorageReservation: {
        count: vi.fn(async () => 0),
        deleteMany: vi.fn(async () => ({ count: 0 })),
      },
      knowledgeBaseDocument: {
        findFirst: vi.fn(async () => ({ status: "deleted" })),
        deleteMany: deleteDocument,
      },
      knowledgeBaseDocumentTombstone: {
        findFirst: vi.fn(async () => ({ id: DOCUMENT_ID })),
        update: completeTombstone,
      },
      knowledgeBaseObject: {
        count: vi.fn(async () => 0),
        deleteMany: deleteObjects,
      },
      knowledgeBaseDocumentVersion: { deleteMany: deleteVersions },
      knowledgeBaseProcessingAttempt: { deleteMany: deleteAttempts },
      knowledgeBaseCleanupOutbox: { deleteMany: deleteOutbox },
      knowledgeBaseEntry: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    };
    const repository = new PrismaKnowledgeCleanupRepository({
      $transaction: vi.fn(async (work: (tx: typeof transaction) => unknown) =>
        work(transaction),
      ),
    } as never);

    await expect(
      repository.completeTarget(documentTarget(), NOW),
    ).resolves.toBe(true);

    expect(completeTombstone).toHaveBeenCalledWith({
      where: { id: DOCUMENT_ID },
      data: {
        cleanupStatus: "completed",
        cleanupErrorCode: null,
        updatedAt: NOW,
      },
    });
    expect(deleteObjects).toHaveBeenCalledWith({
      where: { knowledgeBaseId: BASE_ID, documentId: DOCUMENT_ID },
    });
    expect(deleteVersions).toHaveBeenCalledWith({
      where: { knowledgeBaseId: BASE_ID, documentId: DOCUMENT_ID },
    });
    expect(deleteAttempts).toHaveBeenCalledWith({
      where: { knowledgeBaseId: BASE_ID, documentId: DOCUMENT_ID },
    });
    expect(deleteOutbox).toHaveBeenCalledWith({
      where: { knowledgeBaseId: BASE_ID, documentId: DOCUMENT_ID },
    });
    expect(deleteDocument).toHaveBeenCalledWith({
      where: {
        id: DOCUMENT_ID,
        knowledgeBaseId: BASE_ID,
        status: "deleted",
      },
    });
  });

  it("converges a deleted knowledge base without retaining grants or live manifests", async () => {
    const deleteBase = vi.fn(async () => ({ count: 1 }));
    const deleteGrants = vi.fn(async () => ({ count: 3 }));
    const deleteDocuments = vi.fn(async () => ({ count: 2 }));
    const deleteVersions = vi.fn(async () => ({ count: 3 }));
    const deleteObjects = vi.fn(async () => ({ count: 6 }));
    const deleteOutbox = vi.fn(async () => ({ count: 4 }));
    const deleteAttempts = vi.fn(async () => ({ count: 2 }));
    const deleteTurnSelections = vi.fn(async () => ({ count: 5 }));
    const deleteTurns = vi.fn();
    const deleteMessages = vi.fn();
    const deleteCitations = vi.fn();
    const deleteAudits = vi.fn();
    const deleteMaintenanceTasks = vi.fn();
    const deleteSourceItems = vi.fn(async () => ({ count: 2 }));
    const deleteSourceRuns = vi.fn(async () => ({ count: 1 }));
    const deleteSources = vi.fn(async () => ({ count: 1 }));
    const selectionUpdates: Array<{ sql: string; values: unknown[] }> = [];
    const transaction = {
      $queryRaw: vi.fn(async (parts: TemplateStringsArray) =>
        parts.join("").includes("LEFT JOIN") ? [] : [{ id: OUTBOX_ID }],
      ),
      $executeRaw: vi.fn(
        async (parts: TemplateStringsArray, ...values: unknown[]) => {
          selectionUpdates.push({ sql: parts.join("?"), values });
          return 1;
        },
      ),
      knowledgeBaseStorageReservation: {
        count: vi.fn(async () => 0),
        deleteMany: vi.fn(async () => ({ count: 0 })),
      },
      knowledgeBase: {
        findUnique: vi.fn(async () => ({
          lifecycleStatus: "deleted",
          storageUsedBytes: 0n,
          storageReservedBytes: 0n,
        })),
        deleteMany: deleteBase,
      },
      knowledgeBaseTombstone: {
        findUnique: vi.fn(async () => ({ id: BASE_ID })),
        update: vi.fn(async () => ({})),
      },
      knowledgeBaseDocumentTombstone: {
        updateMany: vi.fn(async () => ({ count: 2 })),
      },
      knowledgeBaseObject: {
        count: vi.fn(async () => 0),
        deleteMany: deleteObjects,
      },
      knowledgeBaseDocument: {
        count: vi.fn(async () => 0),
        deleteMany: deleteDocuments,
      },
      knowledgeBaseEntry: { deleteMany: vi.fn(async () => ({ count: 0 })) },
      knowledgeBaseGrant: { deleteMany: deleteGrants },
      knowledgeBaseDocumentVersion: { deleteMany: deleteVersions },
      knowledgeBaseProcessingAttempt: { deleteMany: deleteAttempts },
      knowledgeBaseCleanupOutbox: { deleteMany: deleteOutbox },
      knowledgeBaseSource: {
        findMany: vi.fn(async () => [
          { id: "00000000-0000-4000-8000-000000000099" },
        ]),
        deleteMany: deleteSources,
      },
      knowledgeSourceItem: { deleteMany: deleteSourceItems },
      knowledgeSourceSyncRun: { deleteMany: deleteSourceRuns },
      conversationTurnKnowledgeBase: { deleteMany: deleteTurnSelections },
      conversationTurn: { deleteMany: deleteTurns },
      conversationMessage: { deleteMany: deleteMessages },
      conversationMessageKnowledgeCitation: { deleteMany: deleteCitations },
      auditLog: { deleteMany: deleteAudits },
      knowledgeBaseMaintenanceTask: { deleteMany: deleteMaintenanceTasks },
    };
    const repository = new PrismaKnowledgeCleanupRepository({
      $transaction: vi.fn(async (work: (tx: typeof transaction) => unknown) =>
        work(transaction),
      ),
    } as never);

    await expect(repository.completeTarget(baseTarget(), NOW)).resolves.toBe(
      true,
    );

    for (const deletion of [
      deleteGrants,
      deleteObjects,
      deleteAttempts,
      deleteVersions,
      deleteDocuments,
      deleteOutbox,
    ]) {
      expect(deletion).toHaveBeenCalledWith({
        where: { knowledgeBaseId: BASE_ID },
      });
    }
    expect(deleteBase).toHaveBeenCalledWith({
      where: { id: BASE_ID, lifecycleStatus: "deleted" },
    });
    expect(deleteSourceItems).toHaveBeenCalledOnce();
    expect(deleteSourceRuns).toHaveBeenCalledOnce();
    expect(deleteSources).toHaveBeenCalledOnce();
    expect(selectionUpdates).toHaveLength(5);
    for (const [index, expected] of [
      ["conversation_turn_start_intents", "knowledge_base_ids_json"],
      ["conversations", "selected_knowledge_base_ids_json"],
      ["conversation_drafts", "knowledge_base_ids_json"],
      ["pending_requests", "knowledge_base_ids_json"],
      ["conversation_turns", "knowledge_base_ids_json"],
    ].entries()) {
      const update = selectionUpdates[index];
      expect(update?.sql).toContain(`UPDATE "${expected[0]}"`);
      expect(update?.sql).toContain(`"${expected[1]}" - CAST(? AS text)`);
      expect(update?.sql).toContain(`WHERE "${expected[1]}" ? CAST(? AS text)`);
      expect(update?.values).toEqual([BASE_ID, NOW, BASE_ID]);
    }
    expect(deleteTurnSelections).toHaveBeenCalledWith({
      where: { knowledgeBaseId: BASE_ID },
    });
    for (const protectedDeletion of [
      deleteTurns,
      deleteMessages,
      deleteCitations,
      deleteAudits,
      deleteMaintenanceTasks,
    ]) {
      expect(protectedDeletion).not.toHaveBeenCalled();
    }
  });

  it("fails an expired final attempt and recovers only attempts that remain", async () => {
    const sqlStatements: string[] = [];
    const updateDocument = vi.fn(async () => ({ count: 1 }));
    const transaction = {
      $queryRaw: vi.fn(async (parts: TemplateStringsArray) => {
        const sql = parts.join("?");
        sqlStatements.push(sql);
        return sqlStatements.length === 1
          ? [
              {
                target_type: "document",
                knowledge_base_id: BASE_ID,
                document_id: DOCUMENT_ID,
                object_id: null,
              },
            ]
          : [
              {
                target_type: "document",
                knowledge_base_id: BASE_ID,
                document_id: DOCUMENT_ID,
                object_id: null,
              },
            ];
      }),
      knowledgeBaseDocument: { updateMany: updateDocument },
      knowledgeBaseDocumentTombstone: {
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
    };
    const repository = new PrismaKnowledgeCleanupRepository({
      $transaction: vi.fn(async (work: (tx: typeof transaction) => unknown) =>
        work(transaction),
      ),
    } as never);

    await expect(repository.recoverExpired(NOW)).resolves.toBe(2);

    expect(sqlStatements[0]).toContain('"attempt_count" >= "max_attempts"');
    expect(sqlStatements[1]).toContain('"attempt_count" < "max_attempts"');
    expect(updateDocument).toHaveBeenNthCalledWith(1, {
      where: { id: DOCUMENT_ID, knowledgeBaseId: BASE_ID },
      data: {
        cleanupStatus: "failed",
        cleanupErrorCode: "KNOWLEDGE_CLEANUP_INTERRUPTED",
        updatedAt: NOW,
      },
    });
    expect(updateDocument).toHaveBeenNthCalledWith(2, {
      where: { id: DOCUMENT_ID, knowledgeBaseId: BASE_ID },
      data: {
        cleanupStatus: "pending",
        cleanupErrorCode: null,
        updatedAt: NOW,
      },
    });
  });

  it("does not claim cleanup targets that still have scoped reservations", async () => {
    let sql = "";
    const transaction = {
      $queryRaw: vi.fn(async (parts: TemplateStringsArray) => {
        sql = parts.join("?");
        return [];
      }),
    };
    const repository = new PrismaKnowledgeCleanupRepository({
      $transaction: vi.fn(async (work: (tx: typeof transaction) => unknown) =>
        work(transaction),
      ),
    } as never);

    await expect(
      repository.claimDue(NOW, new Date(NOW.getTime() + 60_000)),
    ).resolves.toBeNull();

    expect(sql).toContain("knowledge_base_storage_reservations");
    expect(sql).toContain('reservation."document_id"');
    expect(sql).toContain('reservation."document_version_id"');
    expect(sql).toContain('"attempt_count" < "max_attempts"');
  });

  it("heartbeats only the unexpired running attempt that owns the fencing token", async () => {
    const updateMany = vi.fn(async () => ({ count: 1 }));
    const repository = new PrismaKnowledgeCleanupRepository({
      knowledgeBaseCleanupOutbox: { updateMany },
    } as never);
    const leaseUntil = new Date(NOW.getTime() + 60_000);

    await expect(
      repository.heartbeatClaim(documentTarget(), NOW, leaseUntil),
    ).resolves.toBe(true);

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: OUTBOX_ID,
        status: "running",
        attemptCount: 1,
        nextAttemptAt: { gt: NOW },
      },
      data: { nextAttemptAt: leaseUntil, updatedAt: NOW },
    });
  });

  it("rejects stale attempts before object, quota, fallback, or terminal mutations", async () => {
    const sqlStatements: string[] = [];
    const updateObject = vi.fn();
    const updateOutbox = vi.fn();
    const transaction = {
      $queryRaw: vi.fn(async (parts: TemplateStringsArray) => {
        sqlStatements.push(parts.join("?"));
        return [];
      }),
      knowledgeBaseObject: {
        updateMany: updateObject,
        findUnique: vi.fn(),
      },
      knowledgeBaseCleanupOutbox: { updateMany: updateOutbox },
    };
    const repository = new PrismaKnowledgeCleanupRepository({
      $transaction: vi.fn(async (work: (tx: typeof transaction) => unknown) =>
        work(transaction),
      ),
    } as never);
    const target = documentTarget();

    await expect(
      repository.markObjectRunning(target, OBJECT_ID, NOW),
    ).resolves.toBe(false);
    await expect(
      repository.markObjectFailed(
        target,
        OBJECT_ID,
        "KNOWLEDGE_CLEANUP_FAILED",
        NOW,
      ),
    ).resolves.toBe(false);
    await expect(
      repository.completeObjectAndReleaseQuota(target, OBJECT_ID, NOW),
    ).resolves.toBe(false);
    await expect(repository.completeTarget(target, NOW)).resolves.toBe(false);
    await expect(
      repository.failTarget({
        target,
        errorCode: "KNOWLEDGE_CLEANUP_FAILED",
        nextAttemptAt: new Date(NOW.getTime() + 15_000),
        now: NOW,
      }),
    ).resolves.toBe(false);

    expect(updateObject).not.toHaveBeenCalled();
    expect(updateOutbox).not.toHaveBeenCalled();
    expect(transaction.knowledgeBaseObject.findUnique).not.toHaveBeenCalled();
    expect(sqlStatements).toHaveLength(5);
    for (const sql of sqlStatements) {
      expect(sql).toContain("\"status\" = 'running'");
      expect(sql).toContain('"attempt_count" =');
      expect(sql).toContain('"next_attempt_at" >');
      expect(sql).toContain("FOR UPDATE");
    }
  });

  it("keeps ledger reconciliation paged and on an independent interval", async () => {
    let now = NOW;
    const reconcileStorageLedger = vi
      .fn<KnowledgeCleanupRepository["reconcileStorageLedger"]>()
      .mockResolvedValueOnce({ reconciled: 1, nextCursor: BASE_ID })
      .mockResolvedValue({ reconciled: 0, nextCursor: null });
    const worker = new KnowledgeCleanupWorker(
      fakeRepository({ reconcileStorageLedger }),
      { remove: vi.fn(async () => undefined) },
      { deleteDocument: vi.fn(), deleteDocumentVersion: vi.fn() },
      {
        now: () => now,
        ledgerReconcileIntervalMs: 60_000,
        ledgerReconcileBatchSize: 25,
      },
    );

    await worker.runOnce();
    now = new Date(NOW.getTime() + 5_000);
    await worker.runOnce();
    now = new Date(NOW.getTime() + 10_000);
    await worker.runOnce();
    now = new Date(NOW.getTime() + 66_000);
    await worker.runOnce();

    expect(reconcileStorageLedger.mock.calls).toEqual([
      [NOW, null, 25],
      [new Date(NOW.getTime() + 5_000), BASE_ID, 25],
      [new Date(NOW.getTime() + 66_000), null, 25],
    ]);
  });

  it("deducts a cleaned object's exact bytes only on the first transition", async () => {
    let lifecycleStatus = "pending_cleanup";
    const release = vi.fn(async () => 1);
    const transaction = {
      knowledgeBaseObject: {
        findUnique: vi.fn(async () => ({ knowledgeBaseId: BASE_ID })),
        update: vi.fn(async () => {
          lifecycleStatus = "cleaned";
          return {};
        }),
      },
      $queryRaw: vi.fn(async (parts: TemplateStringsArray) => {
        const sql = parts.join("");
        if (sql.includes("knowledge_base_cleanup_outbox")) {
          return [{ id: OUTBOX_ID }];
        }
        return sql.includes("knowledge_base_objects")
          ? [
              {
                id: OBJECT_ID,
                knowledge_base_id: BASE_ID,
                size_bytes: 7n,
                lifecycle_status: lifecycleStatus,
              },
            ]
          : [];
      }),
      $executeRaw: release,
    };
    const repository = new PrismaKnowledgeCleanupRepository({
      $transaction: vi.fn(async (work: (tx: typeof transaction) => unknown) =>
        work(transaction),
      ),
    } as never);

    await repository.completeObjectAndReleaseQuota(
      documentTarget(),
      OBJECT_ID,
      NOW,
    );
    await repository.completeObjectAndReleaseQuota(
      documentTarget(),
      OBJECT_ID,
      NOW,
    );

    expect(release).toHaveBeenCalledTimes(1);
    expect(transaction.knowledgeBaseObject.update).toHaveBeenCalledTimes(1);
  });

  it("deletes exact routed index data and releases quota only after object removal", async () => {
    const events: string[] = [];
    const repository = fakeRepository({
      claimDue: oneClaim(documentTarget()),
      listDocumentIds: vi.fn(async () => ({
        items: [DOCUMENT_ID],
        nextCursor: null,
      })),
      listObjects: vi.fn(async () => ({
        items: [{ id: OBJECT_ID, objectKey: managedObjectKey() }],
        nextCursor: null,
      })),
      markObjectRunning: vi.fn(async () => {
        events.push("object-running");
        return true;
      }),
      completeObjectAndReleaseQuota: vi.fn(async () => {
        events.push("quota-released");
        return true;
      }),
      completeTarget: vi.fn(async () => {
        events.push("target-completed");
        return true;
      }),
    });
    const remove = vi.fn(async () => {
      events.push("minio-removed");
    });
    const deleteDocument = vi.fn(async () => {
      events.push("index-removed");
    });
    const worker = new KnowledgeCleanupWorker(
      repository,
      { remove },
      { deleteDocument, deleteDocumentVersion: vi.fn() },
      { now: () => NOW, batchSize: 1 },
    );

    await expect(worker.runOnce()).resolves.toBe(1);

    expect(deleteDocument).toHaveBeenCalledWith(BASE_ID, DOCUMENT_ID);
    expect(remove).toHaveBeenCalledWith(managedObjectKey());
    expect(events).toEqual([
      "index-removed",
      "object-running",
      "minio-removed",
      "quota-released",
      "target-completed",
    ]);
  });

  it("uses exact version cleanup without widening to the whole document", async () => {
    const target = documentVersionTarget();
    const repository = fakeRepository({
      claimDue: oneClaim(target),
      listObjects: vi.fn(async () => ({ items: [], nextCursor: null })),
    });
    const deleteDocument = vi.fn();
    const deleteDocumentVersion = vi.fn(async () => undefined);
    const worker = new KnowledgeCleanupWorker(
      repository,
      { remove: vi.fn() },
      { deleteDocument, deleteDocumentVersion },
      { now: () => NOW, batchSize: 1 },
    );

    await worker.runOnce();

    expect(deleteDocumentVersion).toHaveBeenCalledWith({
      knowledgeBaseId: BASE_ID,
      documentId: DOCUMENT_ID,
      documentVersionId: VERSION_ID,
    });
    expect(deleteDocument).not.toHaveBeenCalled();
  });

  it("keyset-pages documents and objects for an unlimited-size knowledge base", async () => {
    const target: ClaimedKnowledgeCleanup = {
      ...documentTarget(),
      targetType: "knowledge_base",
      documentId: null,
    };
    const listDocumentIds = vi.fn(
      async ({ afterId }: { afterId: string | null }) =>
        afterId === null
          ? { items: [DOCUMENT_ID], nextCursor: DOCUMENT_ID }
          : { items: [SECOND_DOCUMENT_ID], nextCursor: null },
    );
    const listObjects = vi.fn(
      async ({ afterId }: { afterId: string | null }) =>
        afterId === null
          ? {
              items: [
                { id: OBJECT_ID, objectKey: managedObjectKey(OBJECT_ID) },
              ],
              nextCursor: OBJECT_ID,
            }
          : {
              items: [
                {
                  id: SECOND_OBJECT_ID,
                  objectKey: managedObjectKey(SECOND_OBJECT_ID),
                },
              ],
              nextCursor: null,
            },
    );
    const deleteDocument = vi.fn(async () => undefined);
    const remove = vi.fn(async () => undefined);
    const worker = new KnowledgeCleanupWorker(
      fakeRepository({
        claimDue: oneClaim(target),
        listDocumentIds,
        listObjects,
      }),
      { remove },
      { deleteDocument, deleteDocumentVersion: vi.fn() },
      { now: () => NOW, batchSize: 1, cleanupPageSize: 1 },
    );

    await expect(worker.runOnce()).resolves.toBe(1);

    expect(deleteDocument).toHaveBeenNthCalledWith(1, BASE_ID, DOCUMENT_ID);
    expect(deleteDocument).toHaveBeenNthCalledWith(
      2,
      BASE_ID,
      SECOND_DOCUMENT_ID,
    );
    expect(remove).toHaveBeenCalledTimes(2);
    expect(listDocumentIds).toHaveBeenCalledTimes(2);
    expect(listObjects).toHaveBeenCalledTimes(2);
  });

  it("keeps the deleted entity and schedules a bounded retry after failure", async () => {
    const target = documentTarget({ attemptCount: 1 });
    const failTarget = vi.fn(async () => true);
    const repository = fakeRepository({
      claimDue: oneClaim(target),
      listDocumentIds: vi.fn(async () => ({
        items: [DOCUMENT_ID],
        nextCursor: null,
      })),
      failTarget,
    });
    const worker = new KnowledgeCleanupWorker(
      repository,
      { remove: vi.fn() },
      {
        deleteDocument: vi.fn(async () => {
          throw new Error("private upstream detail");
        }),
        deleteDocumentVersion: vi.fn(),
      },
      { now: () => NOW, batchSize: 1 },
    );

    await worker.runOnce();

    expect(failTarget).toHaveBeenCalledWith({
      target,
      errorCode: "KNOWLEDGE_CLEANUP_FAILED",
      nextAttemptAt: new Date(NOW.getTime() + 15_000),
      now: NOW,
    });
  });

  it("stops automatic retries when max attempts are exhausted", async () => {
    const target = documentTarget({ attemptCount: 10, maxAttempts: 10 });
    const failTarget = vi.fn(async () => true);
    const repository = fakeRepository({
      claimDue: oneClaim(target),
      listDocumentIds: vi.fn(async () => ({
        items: [DOCUMENT_ID],
        nextCursor: null,
      })),
      failTarget,
    });
    const worker = new KnowledgeCleanupWorker(
      repository,
      { remove: vi.fn() },
      {
        deleteDocument: vi.fn(async () => {
          throw new Error("failure");
        }),
        deleteDocumentVersion: vi.fn(),
      },
      { now: () => NOW, batchSize: 1 },
    );

    await worker.runOnce();

    expect(failTarget).toHaveBeenCalledWith(
      expect.objectContaining({ nextAttemptAt: null }),
    );
  });

  it("stops after losing the claim heartbeat during object deletion", async () => {
    const removal = deferred<void>();
    let leaseOwned = true;
    const heartbeatClaim = vi.fn(async () => leaseOwned);
    const completeObjectAndReleaseQuota = vi.fn(async () => true);
    const completeTarget = vi.fn(async () => true);
    const failTarget = vi.fn(async () => true);
    const repository = fakeRepository({
      claimDue: oneClaim(documentTarget()),
      heartbeatClaim,
      listDocumentIds: vi.fn(async () => ({
        items: [DOCUMENT_ID],
        nextCursor: null,
      })),
      listObjects: vi.fn(async () => ({
        items: [{ id: OBJECT_ID, objectKey: managedObjectKey() }],
        nextCursor: null,
      })),
      completeObjectAndReleaseQuota,
      completeTarget,
      failTarget,
    });
    const remove = vi.fn(() => removal.promise);
    const worker = new KnowledgeCleanupWorker(
      repository,
      { remove },
      {
        deleteDocument: vi.fn(async () => undefined),
        deleteDocumentVersion: vi.fn(async () => undefined),
      },
      {
        now: () => NOW,
        batchSize: 1,
        leaseMs: 60,
        leaseHeartbeatMs: 5,
      },
    );

    const running = worker.runOnce();
    await vi.waitFor(() => expect(remove).toHaveBeenCalledOnce());
    const heartbeatCountBeforeLoss = heartbeatClaim.mock.calls.length;
    leaseOwned = false;
    await vi.waitFor(() =>
      expect(heartbeatClaim.mock.calls.length).toBeGreaterThan(
        heartbeatCountBeforeLoss,
      ),
    );
    removal.resolve();

    await expect(running).resolves.toBe(1);
    expect(completeObjectAndReleaseQuota).not.toHaveBeenCalled();
    expect(completeTarget).not.toHaveBeenCalled();
    expect(failTarget).not.toHaveBeenCalled();
  });

  it("doubles cleanup retry delays from fifteen seconds with a one-hour cap", () => {
    expect(cleanupRetryDelay(1)).toBe(15_000);
    expect(cleanupRetryDelay(2)).toBe(30_000);
    expect(cleanupRetryDelay(10)).toBe(3_600_000);
  });

  it("starts asynchronously, serializes ticks, and waits for claimed cleanup on close", async () => {
    const removal = deferred<void>();
    const claimDue = oneClaim(documentTarget());
    const remove = vi.fn(() => removal.promise);
    const worker = new KnowledgeCleanupWorker(
      fakeRepository({
        claimDue,
        listDocumentIds: vi.fn(async () => ({
          items: [DOCUMENT_ID],
          nextCursor: null,
        })),
        listObjects: vi.fn(async () => ({
          items: [{ id: OBJECT_ID, objectKey: managedObjectKey() }],
          nextCursor: null,
        })),
      }),
      { remove },
      {
        deleteDocument: vi.fn(async () => undefined),
        deleteDocumentVersion: vi.fn(async () => undefined),
      },
      { now: () => NOW, pollIntervalMs: 5 },
    );

    await expect(worker.start()).resolves.toBeUndefined();
    await vi.waitFor(() => expect(remove).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(claimDue).toHaveBeenCalledTimes(1);

    let closed = false;
    const closing = worker.close().then(() => {
      closed = true;
    });
    await Promise.resolve();
    expect(closed).toBe(false);
    removal.resolve();
    await closing;
    await new Promise((resolve) => setTimeout(resolve, 15));
    expect(closed).toBe(true);
    expect(claimDue).toHaveBeenCalledTimes(1);
  });
});

function fakeRepository(
  overrides: Partial<KnowledgeCleanupRepository> = {},
): KnowledgeCleanupRepository {
  return {
    releaseExpiredStorageReservations: vi.fn(async () => 0),
    reconcileStorageLedger: vi.fn(async () => ({
      reconciled: 0,
      nextCursor: null,
    })),
    enqueueDueVersionCleanup: vi.fn(async () => 0),
    enqueueStaleDerivedObjectCleanup: vi.fn(async () => 0),
    isRegisteredObjectKey: vi.fn(async () => false),
    recoverExpired: vi.fn(async () => 0),
    claimDue: vi.fn(async () => null),
    heartbeatClaim: vi.fn(async () => true),
    listDocumentIds: vi.fn(async () => ({ items: [], nextCursor: null })),
    listObjects: vi.fn(async () => ({ items: [], nextCursor: null })),
    markObjectRunning: vi.fn(async () => true),
    markObjectFailed: vi.fn(async () => true),
    completeObjectAndReleaseQuota: vi.fn(async () => true),
    completeTarget: vi.fn(async () => true),
    failTarget: vi.fn(async () => true),
    ...overrides,
  };
}

function oneClaim(target: ClaimedKnowledgeCleanup) {
  let consumed = false;
  return vi.fn(async () => {
    if (consumed) return null;
    consumed = true;
    return target;
  });
}

function documentTarget(
  overrides: Partial<ClaimedKnowledgeCleanup> = {},
): ClaimedKnowledgeCleanup {
  return {
    id: OUTBOX_ID,
    targetType: "document",
    knowledgeBaseId: BASE_ID,
    documentId: DOCUMENT_ID,
    documentVersionId: null,
    objectId: null,
    attemptCount: 1,
    maxAttempts: 10,
    ...overrides,
  };
}

function documentVersionTarget(): ClaimedKnowledgeCleanup {
  return {
    ...documentTarget(),
    targetType: "document_version",
    documentVersionId: VERSION_ID,
  };
}

function baseTarget(): ClaimedKnowledgeCleanup {
  return {
    ...documentTarget(),
    targetType: "knowledge_base",
    documentId: null,
  };
}

function managedObjectKey(objectId = OBJECT_ID): string {
  return `knowledge-bases/${BASE_ID}/documents/${DOCUMENT_ID}/versions/${VERSION_ID}/original/${objectId}`;
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
