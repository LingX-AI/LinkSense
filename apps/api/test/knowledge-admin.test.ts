import { describe, expect, it, vi } from "vitest"

import {
  KnowledgeAdminService,
  PrismaKnowledgeAdminStore,
  type KnowledgeAdminBaseMetadataRecord,
  type KnowledgeAdminStore,
} from "../src/modules/knowledge/admin.js"
import type { PrismaClient } from "../src/generated/prisma/client.js"
import type {
  KnowledgeActor,
  KnowledgeProcessingScheduler,
} from "../src/modules/knowledge/types.js"

const ADMIN: KnowledgeActor = {
  id: "00000000-0000-4000-8000-000000000001",
  role: "admin",
  status: "active",
}
const USER: KnowledgeActor = { ...ADMIN, role: "user" }
const BASE_ID = "00000000-0000-4000-8000-000000000002"
const OWNER_ID = "00000000-0000-4000-8000-000000000003"
const NEW_OWNER_ID = "00000000-0000-4000-8000-000000000004"
const GRANT_ID = "00000000-0000-4000-8000-000000000005"
const OUTBOX_ID = "00000000-0000-4000-8000-000000000006"
const DOCUMENT_ID = "00000000-0000-4000-8000-000000000007"
const DOCUMENT_VERSION_ID = "00000000-0000-4000-8000-000000000008"
const OBJECT_ID = "00000000-0000-4000-8000-000000000009"
const DOCUMENT_ID_2 = "00000000-0000-4000-8000-000000000010"
const NOW = new Date("2026-07-22T00:00:00.000Z")

describe("KnowledgeAdminService", () => {
  it("returns only the governance metadata whitelist", async () => {
    const store = fakeStore({
      listMetadata: vi.fn(async () => ({
        items: [metadataRecord()],
        nextCursor: null,
      })),
    })

    const result = await service(store).list(ADMIN, { limit: 50 })

    expect(result.items[0]).toEqual({
      id: BASE_ID,
      name: "Policies",
      owner: { id: OWNER_ID, name: "Owner", status: "disabled" },
      lifecycle_status: "active",
      availability_status: "enabled",
      document_counts: { total: 3, processing: 1, ready: 1, failed: 1 },
      storage_used_bytes: 1_024,
      storage_reserved_bytes: 128,
      share_count: 1,
      active_grants: [
        {
          id: GRANT_ID,
          target_type: "user_group",
          target_id: NEW_OWNER_ID,
          target_name: "Compliance",
        },
      ],
      stable_error_codes: ["KNOWLEDGE_DOCUMENT_INVALID"],
      cleanup_status: "completed",
      disabled_reason: null,
      created_at: NOW.toISOString(),
      updated_at: NOW.toISOString(),
    })
    expect(JSON.stringify(result)).not.toContain("document.md")
    expect(JSON.stringify(result)).not.toContain("object_key")
  })

  it("rejects governance for a non-administrator", async () => {
    await expect(service(fakeStore()).disable(USER, BASE_ID, "policy"))
      .rejects.toMatchObject({ code: "FORBIDDEN" })
  })

  it("disables a base and writes the mandatory reason in the same transaction", async () => {
    const disableKnowledgeBase = vi.fn(async () => undefined)
    const writeAudit = vi.fn(async () => undefined)
    const store = fakeStore({ disableKnowledgeBase, writeAudit })

    await service(store).disable(ADMIN, BASE_ID, "policy violation")

    expect(disableKnowledgeBase).toHaveBeenCalledWith({
      id: BASE_ID,
      actorId: ADMIN.id,
      reason: "policy violation",
      now: NOW,
    })
    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "knowledge_base.admin_disabled",
        metadata: expect.objectContaining({ reason: "policy violation" }),
      }),
    )
  })

  it("transfers ownership only to a different active user", async () => {
    const transferOwnership = vi.fn(async () => undefined)
    const store = fakeStore({
      isActiveUser: vi.fn(async (id) => id === NEW_OWNER_ID),
      transferOwnership,
    })

    await service(store).transferOwnership(
      ADMIN,
      BASE_ID,
      NEW_OWNER_ID,
      "owner disabled",
    )

    expect(transferOwnership).toHaveBeenCalledWith({
      id: BASE_ID,
      ownerId: NEW_OWNER_ID,
      now: NOW,
    })
    await expect(
      service(store).transferOwnership(ADMIN, BASE_ID, OWNER_ID, "same owner"),
    ).rejects.toMatchObject({ code: "KNOWLEDGE_BASE_GRANT_TARGET_INVALID" })
  })

  it("requires a separate archive before administrator force deletion", async () => {
    const deleteKnowledgeBase = vi.fn(async () => undefined)
    const store = fakeStore({ deleteKnowledgeBase })

    await expect(
      service(store).forceDelete(ADMIN, BASE_ID, "remove"),
    ).rejects.toMatchObject({ code: "KNOWLEDGE_BASE_ARCHIVE_REQUIRED" })
    expect(deleteKnowledgeBase).not.toHaveBeenCalled()

    const archived = fakeStore({
      findKnowledgeBase: vi.fn(async () => ({
        id: BASE_ID,
        ownerId: OWNER_ID,
        lifecycleStatus: "archived" as const,
        availabilityStatus: "enabled" as const,
      })),
      deleteKnowledgeBase,
    })
    await service(archived).forceDelete(ADMIN, BASE_ID, "remove")
    expect(deleteKnowledgeBase).toHaveBeenCalledOnce()
  })

  it("blocks administrator force deletion during full-index maintenance", async () => {
    const deleteKnowledgeBase = vi.fn(async () => undefined)
    const assertAvailable = vi.fn(async () => {
      throw new Error("maintenance blocked")
    })
    const store = fakeStore({ deleteKnowledgeBase })

    await expect(
      service(store, assertAvailable).forceDelete(ADMIN, BASE_ID, "remove"),
    ).rejects.toThrow("maintenance blocked")
    expect(deleteKnowledgeBase).not.toHaveBeenCalled()
  })

  it("uses the same stable document-lock order for administrator force deletion", async () => {
    const events: string[] = []
    const scheduler: KnowledgeProcessingScheduler = {
      enqueue: vi.fn(async () => undefined),
      cancel: vi.fn(async () => undefined),
      async runDocumentExclusiveMutation<T>(
        documentId: string,
        operation: (signal: AbortSignal) => Promise<T>,
      ): Promise<T> {
        events.push(`acquire:${documentId}`)
        try {
          return await operation(new AbortController().signal)
        } finally {
          events.push(`release:${documentId}`)
        }
      },
      abortActiveDocumentMutations(documentIds) {
        events.push(`abort:${documentIds.join(",")}`)
      },
    }
    const deleteKnowledgeBase = vi.fn(async () => {
      events.push("delete-base")
    })
    const store = fakeStore({
      findKnowledgeBase: vi.fn(async () => ({
        id: BASE_ID,
        ownerId: OWNER_ID,
        lifecycleStatus: "archived" as const,
        availabilityStatus: "enabled" as const,
      })),
      listUndeletedDocumentIds: vi.fn(async () => [
        DOCUMENT_ID_2,
        DOCUMENT_ID,
      ]),
      lockKnowledgeBase: vi.fn(async () => {
        events.push("lock-base")
      }),
      deleteKnowledgeBase,
    })

    await service(store, undefined, scheduler).forceDelete(
      ADMIN,
      BASE_ID,
      "policy cleanup",
    )

    expect(events).toEqual([
      `acquire:${DOCUMENT_ID}`,
      `acquire:${DOCUMENT_ID_2}`,
      "lock-base",
      "delete-base",
      `abort:${DOCUMENT_ID},${DOCUMENT_ID_2}`,
      `release:${DOCUMENT_ID_2}`,
      `release:${DOCUMENT_ID}`,
    ])
  })

  it("revokes only an active grant and records its target metadata", async () => {
    const revokeGrant = vi.fn(async () => undefined)
    const writeAudit = vi.fn(async () => undefined)
    const store = fakeStore({ revokeGrant, writeAudit })

    await service(store).revokeGrant(
      ADMIN,
      BASE_ID,
      GRANT_ID,
      "inappropriate share",
    )

    expect(revokeGrant).toHaveBeenCalledWith({
      grantId: GRANT_ID,
      actorId: ADMIN.id,
      reason: "inappropriate share",
      now: NOW,
    })
    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        targetType: "knowledge_base_grant",
        metadata: expect.objectContaining({ target_type: "user_group" }),
      }),
    )
  })

  it("retries a failed child cleanup while an active base remains available", async () => {
    const retryCleanup = vi.fn(async () => 1)
    const writeAudit = vi.fn(async () => undefined)
    const store = fakeStore({ retryCleanup, writeAudit })

    await expect(
      service(store).retryCleanup(
        ADMIN,
        BASE_ID,
        { type: "document", id: DOCUMENT_ID },
        "manual recovery",
      ),
    ).resolves.toEqual({ retried_count: 1 })

    expect(retryCleanup).toHaveBeenCalledWith({
      knowledgeBaseId: BASE_ID,
      target: { type: "document", id: DOCUMENT_ID },
      allowKnowledgeBaseTarget: false,
      now: NOW,
    })
    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "knowledge_base.cleanup_retried",
        metadata: {
          reason: "manual recovery",
          retried_count: 1,
          cleanup_target_type: "document",
          cleanup_target_id: DOCUMENT_ID,
        },
      }),
    )
  })

  it("allows a deleted base to retry its exact failed outbox", async () => {
    const retryCleanup = vi.fn(async () => 1)
    const store = fakeStore({
      findKnowledgeBase: vi.fn(async () => ({
        id: BASE_ID,
        ownerId: OWNER_ID,
        lifecycleStatus: "deleted" as const,
        availabilityStatus: "enabled" as const,
      })),
      retryCleanup,
    })

    await service(store).retryCleanup(
      ADMIN,
      BASE_ID,
      { type: "outbox", id: OUTBOX_ID },
      "manual recovery",
    )

    expect(retryCleanup).toHaveBeenCalledWith(
      expect.objectContaining({ allowKnowledgeBaseTarget: true }),
    )
  })

  it("retries all failed cleanup targets for the selected base", async () => {
    const retryCleanup = vi.fn(async () => 2)
    const writeAudit = vi.fn(async () => undefined)
    const store = fakeStore({ retryCleanup, writeAudit })

    await expect(
      service(store).retryCleanup(
        ADMIN,
        BASE_ID,
        undefined,
        "manual recovery",
      ),
    ).resolves.toEqual({ retried_count: 2 })

    expect(retryCleanup).toHaveBeenCalledWith({
      knowledgeBaseId: BASE_ID,
      target: undefined,
      allowKnowledgeBaseTarget: false,
      now: NOW,
    })
    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: {
          reason: "manual recovery",
          retried_count: 2,
          cleanup_target_type: "knowledge_base",
          cleanup_target_id: BASE_ID,
        },
      }),
    )
  })

  it("reports a stable error when the selected cleanup target is not retryable", async () => {
    const store = fakeStore({ retryCleanup: vi.fn(async () => 0) })

    await expect(
      service(store).retryCleanup(
        ADMIN,
        BASE_ID,
        { type: "object", id: OBJECT_ID },
        "manual recovery",
      ),
    ).rejects.toMatchObject({
      code: "KNOWLEDGE_CLEANUP_TARGET_NOT_RETRYABLE",
    })
  })
})

describe("PrismaKnowledgeAdminStore deletion", () => {
  it("creates base and document tombstones before queueing knowledge-base cleanup", async () => {
    const discardAttempts = vi.fn(async () => ({ count: 2 }))
    const upsertBaseTombstone = vi.fn(async () => ({}))
    const executeRaw = vi.fn(async () => 2)
    const database = {
      knowledgeBase: {
        update: vi.fn(async () => ({ id: BASE_ID, ownerId: OWNER_ID })),
      },
      knowledgeBaseTombstone: { upsert: upsertBaseTombstone },
      knowledgeBaseDocument: {
        updateMany: vi.fn(async () => ({ count: 2 })),
      },
      knowledgeBaseDocumentVersion: {
        updateMany: vi.fn(async () => ({ count: 2 })),
      },
      knowledgeBaseProcessingAttempt: { updateMany: discardAttempts },
      knowledgeBaseObject: {
        updateMany: vi.fn(async () => ({ count: 4 })),
      },
      knowledgeBaseCleanupOutbox: { create: vi.fn(async () => ({})) },
      $executeRaw: executeRaw,
    }
    const store = new PrismaKnowledgeAdminStore(
      database as unknown as PrismaClient,
    )

    await store.deleteKnowledgeBase({
      id: BASE_ID,
      actorId: ADMIN.id,
      reason: "policy cleanup",
      now: NOW,
    })

    expect(discardAttempts).toHaveBeenCalledWith({
      where: { knowledgeBaseId: BASE_ID, status: "active" },
      data: {
        status: "discarded",
        discardedAt: NOW,
      },
    })
    expect(upsertBaseTombstone).toHaveBeenCalledWith({
      where: { id: BASE_ID },
      create: expect.objectContaining({
        id: BASE_ID,
        ownerId: OWNER_ID,
        deletedBy: ADMIN.id,
        deletionReason: "policy cleanup",
        cleanupStatus: "pending",
      }),
      update: expect.objectContaining({
        ownerId: OWNER_ID,
        deletedBy: ADMIN.id,
        deletionReason: "policy cleanup",
        cleanupStatus: "pending",
      }),
    })
    expect(executeRaw).toHaveBeenCalledOnce()
    expect(database.knowledgeBaseCleanupOutbox.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        targetType: "knowledge_base",
        knowledgeBaseId: BASE_ID,
        status: "pending",
      }),
    })
  })
})

describe("PrismaKnowledgeAdminStore cleanup retry", () => {
  it("repairs missing deletion tombstones before retrying whole-base cleanup", async () => {
    const database = cleanupStoreDatabase({
      id: OUTBOX_ID,
      targetType: "knowledge_base",
      documentId: null,
      documentVersionId: null,
      objectId: null,
    })
    const store = new PrismaKnowledgeAdminStore(
      database as unknown as PrismaClient,
    )

    await expect(
      store.retryCleanup({
        knowledgeBaseId: BASE_ID,
        target: undefined,
        allowKnowledgeBaseTarget: true,
        now: NOW,
      }),
    ).resolves.toBe(1)

    expect(database.knowledgeBaseCleanupOutbox.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          knowledgeBaseId: BASE_ID,
          status: "failed",
          targetType: {
            in: ["knowledge_base", "document", "document_version", "object"],
          },
        },
      }),
    )
    expect(database.knowledgeBaseTombstone.upsert).toHaveBeenCalledOnce()
    expect(database.$executeRaw).toHaveBeenCalledOnce()
  })

  it.each([
    {
      target: { type: "outbox" as const, id: OUTBOX_ID },
      expectedTargetWhere: {
        id: OUTBOX_ID,
        targetType: { in: ["document", "document_version", "object"] },
      },
    },
    {
      target: { type: "document" as const, id: DOCUMENT_ID },
      expectedTargetWhere: { targetType: "document", documentId: DOCUMENT_ID },
    },
    {
      target: {
        type: "document_version" as const,
        id: DOCUMENT_VERSION_ID,
      },
      expectedTargetWhere: {
        targetType: "document_version",
        documentVersionId: DOCUMENT_VERSION_ID,
      },
    },
    {
      target: { type: "object" as const, id: OBJECT_ID },
      expectedTargetWhere: { targetType: "object", objectId: OBJECT_ID },
    },
  ])("selects only the failed $target.type target", async ({
    target,
    expectedTargetWhere,
  }) => {
    const database = cleanupStoreDatabase({
      id: OUTBOX_ID,
      targetType: "document",
      documentId: DOCUMENT_ID,
      documentVersionId: null,
      objectId: null,
    })
    const store = new PrismaKnowledgeAdminStore(
      database as unknown as PrismaClient,
    )

    await store.retryCleanup({
      knowledgeBaseId: BASE_ID,
      target,
      allowKnowledgeBaseTarget: false,
      now: NOW,
    })

    expect(database.knowledgeBaseCleanupOutbox.findMany).toHaveBeenCalledWith({
      where: {
        knowledgeBaseId: BASE_ID,
        status: "failed",
        ...expectedTargetWhere,
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        targetType: true,
        documentId: true,
        documentVersionId: true,
        objectId: true,
      },
    })
    expect(database.knowledgeBase.updateMany).not.toHaveBeenCalled()
  })

  it("resets only a deleted document and its failed objects without changing the base cleanup status", async () => {
    const database = cleanupStoreDatabase({
      id: OUTBOX_ID,
      targetType: "document",
      documentId: DOCUMENT_ID,
      documentVersionId: null,
      objectId: null,
    })
    const store = new PrismaKnowledgeAdminStore(
      database as unknown as PrismaClient,
    )

    await expect(
      store.retryCleanup({
        knowledgeBaseId: BASE_ID,
        target: { type: "document", id: DOCUMENT_ID },
        allowKnowledgeBaseTarget: false,
        now: NOW,
      }),
    ).resolves.toBe(1)

    expect(database.knowledgeBase.updateMany).not.toHaveBeenCalled()
    expect(database.knowledgeBaseDocument.updateMany).toHaveBeenCalledWith({
      where: {
        id: { in: [DOCUMENT_ID] },
        knowledgeBaseId: BASE_ID,
        status: "deleted",
        cleanupStatus: "failed",
      },
      data: {
        cleanupStatus: "pending",
        cleanupErrorCode: null,
        updatedAt: NOW,
      },
    })
    expect(database.knowledgeBaseObject.updateMany).toHaveBeenCalledWith({
      where: {
        knowledgeBaseId: BASE_ID,
        documentId: { in: [DOCUMENT_ID] },
        cleanupStatus: "failed",
      },
      data: {
        cleanupStatus: "pending",
        cleanupErrorCode: null,
        updatedAt: NOW,
      },
    })
  })

  it("never selects a knowledge-base outbox for an active or archived base", async () => {
    const database = cleanupStoreDatabase(null)
    const store = new PrismaKnowledgeAdminStore(
      database as unknown as PrismaClient,
    )

    await expect(
      store.retryCleanup({
        knowledgeBaseId: BASE_ID,
        target: { type: "outbox", id: OUTBOX_ID },
        allowKnowledgeBaseTarget: false,
        now: NOW,
      }),
    ).resolves.toBe(0)

    expect(database.knowledgeBaseCleanupOutbox.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: OUTBOX_ID,
          targetType: { in: ["document", "document_version", "object"] },
        }),
      }),
    )
    expect(database.knowledgeBase.updateMany).not.toHaveBeenCalled()
    expect(database.knowledgeBaseDocument.updateMany).not.toHaveBeenCalled()
    expect(database.knowledgeBaseObject.updateMany).not.toHaveBeenCalled()
  })
})

function service(
  store: KnowledgeAdminStore,
  assertAvailable?: () => Promise<void>,
  scheduler: KnowledgeProcessingScheduler = immediateScheduler(),
) {
  return new KnowledgeAdminService(store, {
    now: () => NOW,
    scheduler,
    ...(assertAvailable === undefined
      ? {}
      : { maintenanceGate: { assertAvailable } }),
  })
}

function immediateScheduler(): KnowledgeProcessingScheduler {
  return {
    enqueue: vi.fn(async () => undefined),
    cancel: vi.fn(async () => undefined),
    async runDocumentExclusiveMutation<T>(
      _documentId: string,
      operation: (signal: AbortSignal) => Promise<T>,
    ): Promise<T> {
      return operation(new AbortController().signal)
    },
    abortActiveDocumentMutations: vi.fn(),
  }
}

function fakeStore(
  overrides: Partial<KnowledgeAdminStore> = {},
): KnowledgeAdminStore {
  const store: KnowledgeAdminStore = {
    transaction: async <T>(work: (value: KnowledgeAdminStore) => Promise<T>) =>
      work(store),
    lockKnowledgeBase: vi.fn(async () => undefined),
    listUndeletedDocumentIds: vi.fn(async () => []),
    findKnowledgeBase: vi.fn(async () => ({
      id: BASE_ID,
      ownerId: OWNER_ID,
      lifecycleStatus: "active" as const,
      availabilityStatus: "enabled" as const,
    })),
    listMetadata: vi.fn(async () => ({ items: [], nextCursor: null })),
    isActiveUser: vi.fn(async () => true),
    findActiveGrant: vi.fn(async () => ({
      id: GRANT_ID,
      targetType: "user_group" as const,
      targetId: NEW_OWNER_ID,
    })),
    disableKnowledgeBase: vi.fn(async () => undefined),
    enableKnowledgeBase: vi.fn(async () => undefined),
    transferOwnership: vi.fn(async () => undefined),
    archiveKnowledgeBase: vi.fn(async () => undefined),
    revokeGrant: vi.fn(async () => undefined),
    deleteKnowledgeBase: vi.fn(async () => undefined),
    retryCleanup: vi.fn(async () => 1),
    writeAudit: vi.fn(async () => undefined),
    ...overrides,
  }
  return store
}

function metadataRecord(): KnowledgeAdminBaseMetadataRecord {
  return {
    id: BASE_ID,
    name: "Policies",
    owner: { id: OWNER_ID, name: "Owner", status: "disabled" },
    lifecycleStatus: "active",
    availabilityStatus: "enabled",
    documentCounts: { total: 3, processing: 1, ready: 1, failed: 1 },
    storageUsedBytes: 1_024n,
    storageReservedBytes: 128n,
    grants: [
      {
        id: GRANT_ID,
        targetType: "user_group",
        targetId: NEW_OWNER_ID,
        targetName: "Compliance",
      },
    ],
    stableErrorCodes: ["KNOWLEDGE_DOCUMENT_INVALID"],
    cleanupStatus: "completed",
    disabledReason: null,
    createdAt: NOW,
    updatedAt: NOW,
  }
}

function cleanupStoreDatabase(
  failed:
    | {
        id: string
        targetType: string
        documentId: string | null
        documentVersionId: string | null
        objectId: string | null
      }
    | null,
) {
  return {
    knowledgeBaseCleanupOutbox: {
      findMany: vi.fn(async () => (failed === null ? [] : [failed])),
      updateMany: vi.fn(async () => ({ count: failed === null ? 0 : 1 })),
    },
    knowledgeBase: {
      findFirst: vi.fn(async () => ({
        id: BASE_ID,
        ownerId: OWNER_ID,
        deletedBy: ADMIN.id,
        deletedAt: NOW,
        deletionReason: "policy cleanup",
        createdAt: NOW,
      })),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    knowledgeBaseTombstone: {
      upsert: vi.fn(async () => ({})),
    },
    knowledgeBaseDocument: {
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    knowledgeBaseObject: {
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    $executeRaw: vi.fn(async () => 1),
  }
}
