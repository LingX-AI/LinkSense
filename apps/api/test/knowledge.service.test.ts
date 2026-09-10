import { Readable } from "node:stream";

import { describe, expect, it, vi } from "vitest";

import { KnowledgeService } from "../src/modules/knowledge/service.js";
import { AppError } from "../src/lib/errors.js";
import { KnowledgeProcessingError } from "../src/modules/knowledge-processing/errors.js";
import { PrismaKnowledgeStore } from "../src/modules/knowledge/repository.js";
import { buildKnowledgeObjectKey } from "../src/modules/knowledge-processing/object-store.js";
import type {
  KnowledgeBaseAccessRecord,
  KnowledgeBaseGrantRecord,
  KnowledgeBaseGrantViewRecord,
  KnowledgeBaseRecord,
  KnowledgeDocumentRecord,
  KnowledgeDocumentVersionRecord,
  KnowledgeDocumentAccessAdapter,
  KnowledgeDocumentIngestionAdapter,
  KnowledgeProcessingScheduler,
  KnowledgeStore,
  RegisterDocumentUploadInput,
} from "../src/modules/knowledge/types.js";

const ACTOR = {
  id: "00000000-0000-4000-8000-000000000001",
  role: "user" as const,
  status: "active" as const,
};
const BASE_ID = "00000000-0000-4000-8000-000000000002";
const DOCUMENT_ID = "00000000-0000-4000-8000-000000000003";
const VERSION_ID = "00000000-0000-4000-8000-000000000004";
const OBJECT_ID = "00000000-0000-4000-8000-000000000005";
const ASSET_ID = "00000000-0000-4000-8000-000000000006";
const KNOWLEDGE_BASE_ID_2 = "00000000-0000-4000-8000-000000000007";
const DOCUMENT_ID_2 = "00000000-0000-4000-8000-000000000008";
const GRANT_ID = "00000000-0000-4000-8000-000000000009";
const GRANT_TARGET_ID = "00000000-0000-4000-8000-000000000010";
const NOW = new Date("2026-07-22T00:00:00.000Z");

describe("KnowledgeService", () => {
  it("exposes configured upload limits to an active actor", () => {
    const limits = service(fakeStore({}), {
      maxFileSizeBytes: 123_456,
      maxFilesPerBatch: 37,
      storageQuotaBytes: 987_654n,
    }).getUploadLimits(ACTOR);

    expect(limits).toEqual({
      max_file_size_bytes: 123_456,
      max_files_per_batch: 37,
      storage_quota_bytes: 987_654,
    });
  });

  it("returns full share-target emails only for an owned writable knowledge base", async () => {
    const searchShareTargets = vi.fn(async () => ({
      items: [
        {
          id: GRANT_TARGET_ID,
          type: "user" as const,
          name: "Lin",
          email: "lin@example.test",
        },
      ],
      nextCursor: null,
    }));
    const knowledge = service(
      fakeStore({
        findKnowledgeBase: vi.fn(async () => baseRecord()),
        searchShareTargets,
      }),
    );

    const result = await knowledge.searchShareTargets(ACTOR, {
      knowledgeBaseId: BASE_ID,
      type: "user",
      search: "lin@example.test",
      limit: 30,
    });

    expect(result.items).toEqual([
      {
        id: GRANT_TARGET_ID,
        type: "user",
        name: "Lin",
        secondary_label: "lin@example.test",
      },
    ]);
    expect(searchShareTargets).toHaveBeenCalledWith({
      type: "user",
      search: "lin@example.test",
      limit: 30,
    });
  });

  it("rejects full-email share-target searches outside an owned knowledge base", async () => {
    const searchShareTargets = vi.fn();
    const knowledge = service(
      fakeStore({
        findKnowledgeBase: vi.fn(async () =>
          baseRecord({ ownerId: GRANT_TARGET_ID }),
        ),
        searchShareTargets,
      }),
    );

    await expect(
      knowledge.searchShareTargets(ACTOR, {
        knowledgeBaseId: BASE_ID,
        type: "user",
        search: "",
        limit: 30,
      }),
    ).rejects.toMatchObject({ code: "KNOWLEDGE_BASE_ACCESS_DENIED" });
    expect(searchShareTargets).not.toHaveBeenCalled();
  });

  it("orders user share targets by name and continues from the selected cursor", async () => {
    const findMany = vi.fn(async () => [
      { id: GRANT_TARGET_ID, name: "Alice", email: "alice@example.test" },
    ]);
    const store = new PrismaKnowledgeStore({
      user: { findMany },
    } as never);

    await store.searchShareTargets({
      type: "user",
      search: "ali",
      cursor: ACTOR.id,
      limit: 30,
    });

    expect(findMany).toHaveBeenCalledWith({
      where: {
        status: "active",
        OR: [
          { name: { contains: "ali", mode: "insensitive" } },
          { email: { contains: "ali", mode: "insensitive" } },
        ],
      },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      cursor: { id: ACTOR.id },
      skip: 1,
      take: 31,
      select: { id: true, name: true, email: true },
    });
  });

  it("counts only retrieval-compatible documents as searchable in knowledge-base lists", async () => {
    const currentEmbeddingProfileHash = "b".repeat(64);
    const groupBy = vi
      .fn()
      .mockResolvedValueOnce([
        { knowledgeBaseId: BASE_ID, _count: { _all: 3 } },
      ])
      .mockResolvedValueOnce([
        { knowledgeBaseId: BASE_ID, _count: { _all: 1 } },
      ]);
    const store = new PrismaKnowledgeStore({
      userGroupMember: { findMany: vi.fn(async () => []) },
      knowledgeBaseGrant: { findMany: vi.fn(async () => []) },
      knowledgeBase: { findMany: vi.fn(async () => [baseRecord()]) },
      user: {
        findMany: vi.fn(async () => [{ id: ACTOR.id, name: "Owner" }]),
      },
      userGroup: { findMany: vi.fn(async () => []) },
      knowledgeBaseDocument: { groupBy },
    } as never);

    const result = await store.listAccessibleKnowledgeBases({
      actorId: ACTOR.id,
      scope: "all",
      lifecycleStatus: "active",
      limit: 30,
      searchability: {
        currentEmbeddingProfileHash,
      },
    });

    expect(result.items[0]).toMatchObject({
      documentCount: 3,
      searchableDocumentCount: 1,
    });
    expect(groupBy).toHaveBeenNthCalledWith(2, {
      by: ["knowledgeBaseId"],
      where: {
        knowledgeBaseId: { in: [BASE_ID] },
        status: "ready",
        currentVersionId: { not: null },
        embeddingProfileHash: currentEmbeddingProfileHash,
      },
      _count: { _all: true },
    });
  });

  it("uses the same retrieval-compatible count for knowledge-base details", async () => {
    const currentEmbeddingProfileHash = "b".repeat(64);
    const count = vi.fn().mockResolvedValueOnce(3).mockResolvedValueOnce(1);
    const store = new PrismaKnowledgeStore({
      knowledgeBase: { findUnique: vi.fn(async () => baseRecord()) },
      userGroupMember: { findMany: vi.fn(async () => []) },
      knowledgeBaseGrant: { findMany: vi.fn(async () => []) },
      user: {
        findUnique: vi.fn(async () => ({ id: ACTOR.id, name: "Owner" })),
      },
      userGroup: { findMany: vi.fn(async () => []) },
      knowledgeBaseDocument: { count },
    } as never);

    const result = await store.findKnowledgeBaseAccess(BASE_ID, ACTOR.id, {
      currentEmbeddingProfileHash,
    });

    expect(result).toMatchObject({
      documentCount: 3,
      searchableDocumentCount: 1,
    });
    expect(count).toHaveBeenNthCalledWith(2, {
      where: {
        knowledgeBaseId: BASE_ID,
        status: "ready",
        currentVersionId: { not: null },
        embeddingProfileHash: currentEmbeddingProfileHash,
      },
    });
  });

  it("lists folders and documents recursively with their complete paths", async () => {
    const rootFolderId = "00000000-0000-4000-8000-000000000041";
    const nestedFolderId = "00000000-0000-4000-8000-000000000042";
    const baseEntry = {
      knowledgeBaseId: BASE_ID,
      sourceItemId: null,
      createdBy: ACTOR.id,
      createdAt: NOW,
      updatedAt: NOW,
    };
    const rootFolder = {
      ...baseEntry,
      id: rootFolderId,
      parentEntryId: null,
      entryType: "folder",
      name: "Policies",
      normalizedName: "policies",
      documentId: null,
    };
    const nestedFolder = {
      ...baseEntry,
      id: nestedFolderId,
      parentEntryId: rootFolderId,
      entryType: "folder",
      name: "HR",
      normalizedName: "hr",
      documentId: null,
    };
    const documentEntry = {
      ...baseEntry,
      id: "00000000-0000-4000-8000-000000000043",
      parentEntryId: nestedFolderId,
      entryType: "document",
      name: "manual.pdf",
      normalizedName: "manual.pdf",
      documentId: DOCUMENT_ID,
    };
    const folders = new Map<string, typeof rootFolder | typeof nestedFolder>([
      [rootFolderId, rootFolder],
      [nestedFolderId, nestedFolder],
    ]);
    const entryFindMany = vi.fn(
      async ({ where }: { where: Record<string, unknown> }) => {
        if (!("id" in where)) return [rootFolder, nestedFolder, documentEntry];
        const ids = (where.id as { in: string[] }).in;
        return ids.flatMap((id) => {
          const folder = folders.get(id);
          return folder === undefined ? [] : [folder];
        });
      },
    );
    const store = new PrismaKnowledgeStore({
      knowledgeBaseEntry: {
        findFirst: vi.fn(),
        findMany: entryFindMany,
      },
      knowledgeBaseDocument: {
        findMany: vi.fn(async () => [
          {
            id: DOCUMENT_ID,
            knowledgeBaseId: BASE_ID,
            status: "ready",
            cleanupStatus: "retained",
            activeProcessingVersionId: null,
            candidateVersionId: null,
          },
        ]),
      },
      knowledgeBaseDocumentVersion: {
        findMany: vi.fn(async () => []),
      },
    } as never);

    const result = await store.listFlatDirectoryEntries({
      knowledgeBaseId: BASE_ID,
      includeOwnerOnlyStates: true,
      limit: 100,
    });

    expect(result.breadcrumbs).toEqual([]);
    expect(result.nextCursor).toBeNull();
    expect(result.items).toHaveLength(3);
    expect(
      result.items.map(({ entry, path }) => [entry.entryType, path]),
    ).toEqual([
      ["folder", ["Policies"]],
      ["folder", ["Policies", "HR"]],
      ["document", ["Policies", "HR", "manual.pdf"]],
    ]);
    expect(entryFindMany).toHaveBeenNthCalledWith(1, {
      where: { knowledgeBaseId: BASE_ID },
      orderBy: [
        { entryType: "desc" },
        { normalizedName: "asc" },
        { id: "asc" },
      ],
      take: 101,
    });
  });

  it("maps the flat entry view through the authorized service boundary", async () => {
    const folderPath = ["Policies", "HR"];
    const documentPath = [...folderPath, "manual.pdf"];
    const listFlatDirectoryEntries = vi.fn(async () => ({
      breadcrumbs: [],
      items: [
        {
          entry: {
            id: "00000000-0000-4000-8000-000000000042",
            knowledgeBaseId: BASE_ID,
            parentEntryId: "00000000-0000-4000-8000-000000000041",
            entryType: "folder" as const,
            name: "HR",
            normalizedName: "hr",
            documentId: null,
            sourceItemId: null,
            createdBy: ACTOR.id,
            createdAt: NOW,
            updatedAt: NOW,
          },
          document: null,
          path: folderPath,
        },
        {
          entry: {
            id: "00000000-0000-4000-8000-000000000043",
            knowledgeBaseId: BASE_ID,
            parentEntryId: "00000000-0000-4000-8000-000000000042",
            entryType: "document" as const,
            name: "manual.pdf",
            normalizedName: "manual.pdf",
            documentId: DOCUMENT_ID,
            sourceItemId: null,
            createdBy: ACTOR.id,
            createdAt: NOW,
            updatedAt: NOW,
          },
          document: {
            document: documentRecord(),
            processingVersion: null,
            failedCandidateVersion: null,
          },
          path: documentPath,
        },
      ],
      nextCursor: null,
    }));
    const listDirectoryEntries = vi.fn();
    const store = fakeStore({
      findKnowledgeBase: vi.fn(async () => baseRecord()),
      findKnowledgeBaseAccess: vi.fn(async () => accessRecord()),
      listDirectoryEntries,
      listFlatDirectoryEntries,
    });

    const result = await service(store).listDirectoryEntries(ACTOR, BASE_ID, {
      view: "flat",
      limit: 100,
    });

    expect(result.items[0]).toMatchObject({
      entry_type: "folder",
      path: folderPath,
      document: null,
    });
    expect(result.items[1]).toMatchObject({
      entry_type: "document",
      path: documentPath,
      document: { id: DOCUMENT_ID },
    });
    expect(listFlatDirectoryEntries).toHaveBeenCalledWith({
      knowledgeBaseId: BASE_ID,
      includeOwnerOnlyStates: true,
      limit: 100,
    });
    expect(listDirectoryEntries).not.toHaveBeenCalled();
  });

  it("takes a key-share row lock while validating a knowledge-base group grant target", async () => {
    const groupId = "00000000-0000-4000-8000-000000000032";
    const rootQuery = vi.fn(async () => [{ id: groupId }]);
    const transactionQuery = vi.fn(async () => [{ id: groupId }]);
    const root = {
      $queryRawUnsafe: rootQuery,
      $transaction: vi.fn(
        async (work: (transaction: object) => Promise<unknown>) =>
          work({ $queryRawUnsafe: transactionQuery }),
      ),
    };
    const store = new PrismaKnowledgeStore(root as never);

    await expect(
      store.transaction((transactionStore) =>
        transactionStore.groupExists(groupId),
      ),
    ).resolves.toBe(true);
    expect(transactionQuery).toHaveBeenCalledWith(
      'SELECT "id" FROM "user_groups" WHERE "id" = $1::uuid FOR KEY SHARE',
      groupId,
    );
    expect(rootQuery).not.toHaveBeenCalled();
  });

  it("paginates grants by the stable created-at and id keyset without offset", async () => {
    const cursorId = "00000000-0000-4000-8000-000000000020";
    const firstId = "00000000-0000-4000-8000-000000000021";
    const secondId = "00000000-0000-4000-8000-000000000022";
    const extraId = "00000000-0000-4000-8000-000000000023";
    const pageCreatedAt = new Date("2026-07-22T01:00:00.000Z");
    const grants = [
      grantFixture({
        id: firstId,
        userId: GRANT_TARGET_ID,
        createdAt: pageCreatedAt,
      }),
      grantFixture({
        id: secondId,
        granteeType: "user_group",
        userId: null,
        userGroupId: "00000000-0000-4000-8000-000000000030",
        createdAt: pageCreatedAt,
      }),
      grantFixture({ id: extraId, createdAt: pageCreatedAt }),
    ];
    const findMany = vi.fn(async (query: unknown) => {
      void query;
      return grants;
    });
    const database = {
      knowledgeBaseGrant: {
        findFirst: vi.fn(async () => ({ id: cursorId, createdAt: NOW })),
        findMany,
      },
      user: {
        findMany: vi.fn(async () => [
          { id: GRANT_TARGET_ID, name: "Recipient", email: "r@example.test" },
        ]),
      },
      userGroup: {
        findMany: vi.fn(async () => [
          {
            id: "00000000-0000-4000-8000-000000000030",
            name: "Support",
          },
        ]),
      },
    };
    const store = new PrismaKnowledgeStore(database as never);

    const result = await store.listGrants({
      knowledgeBaseId: BASE_ID,
      cursor: cursorId,
      limit: 2,
    });

    expect(result.nextCursor).toBe(secondId);
    expect(result.items.map((grant) => grant.id)).toEqual([firstId, secondId]);
    expect(result.items.map((grant) => grant.targetName)).toEqual([
      "Recipient",
      "Support",
    ]);
    expect(findMany).toHaveBeenCalledWith({
      where: {
        knowledgeBaseId: BASE_ID,
        OR: [
          { createdAt: { gt: NOW } },
          { createdAt: NOW, id: { gt: cursorId } },
        ],
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: 3,
    });
    expect(findMany.mock.calls[0]?.[0]).not.toHaveProperty("skip");
  });

  it("rejects a grant cursor that does not belong to the requested knowledge base", async () => {
    const findMany = vi.fn();
    const store = new PrismaKnowledgeStore({
      knowledgeBaseGrant: {
        findFirst: vi.fn(async () => null),
        findMany,
      },
    } as never);

    await expect(
      store.listGrants({
        knowledgeBaseId: BASE_ID,
        cursor: GRANT_ID,
        limit: 30,
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(findMany).not.toHaveBeenCalled();
  });

  it("summarizes remaining group-member access without returning member details", async () => {
    const ownerId = ACTOR.id;
    const directRecipientId = GRANT_TARGET_ID;
    const noAccessMemberId = "00000000-0000-4000-8000-000000000011";
    const groupId = "00000000-0000-4000-8000-000000000012";
    const otherGroupId = "00000000-0000-4000-8000-000000000013";
    const userGroupMemberFindMany = vi.fn(
      async ({
        where,
      }: {
        where: {
          userGroupId: string | { in: string[] };
        };
      }) =>
        typeof where.userGroupId === "string"
          ? [ownerId, directRecipientId, noAccessMemberId].map((userId) => ({
              userId,
            }))
          : [{ userId: directRecipientId }],
    );
    const knowledgeBaseGrantFindMany = vi.fn(
      async ({ where }: { where: { granteeType: string } }) =>
        where.granteeType === "user"
          ? [{ userId: directRecipientId }]
          : [{ userGroupId: otherGroupId }],
    );
    const store = new PrismaKnowledgeStore({
      userGroupMember: { findMany: userGroupMemberFindMany },
      user: {
        findMany: vi.fn(async () =>
          [ownerId, directRecipientId, noAccessMemberId].map((id) => ({ id })),
        ),
      },
      knowledgeBaseGrant: { findMany: knowledgeBaseGrantFindMany },
    } as never);

    const result = await store.summarizeGroupMemberRemainingAccess({
      knowledgeBaseId: BASE_ID,
      ownerId,
      groupId,
    });

    expect(result).toEqual({
      memberAccess: "some",
      sourceTypes: ["owner", "direct", "user_group"],
    });
    expect(result).not.toHaveProperty("members");
    expect(result).not.toHaveProperty("memberIds");
  });

  it("passes grant keyset pagination through the owner-only service boundary", async () => {
    const nextCursor = "00000000-0000-4000-8000-000000000040";
    const listGrants = vi.fn(async () => ({
      items: [grantViewFixture()],
      nextCursor,
    }));
    const store = fakeStore({
      findKnowledgeBase: vi.fn(async () => baseRecord()),
      listGrants,
    });

    const result = await service(store).listGrants(ACTOR, BASE_ID, {
      cursor: GRANT_ID,
      limit: 25,
    });

    expect(result.next_cursor).toBe(nextCursor);
    expect(result.items[0]).toMatchObject({
      id: GRANT_ID,
      target: { id: GRANT_TARGET_ID, name: "Recipient" },
    });
    expect(listGrants).toHaveBeenCalledWith({
      knowledgeBaseId: BASE_ID,
      cursor: GRANT_ID,
      limit: 25,
    });
  });

  it("returns only remaining source types when an owner revokes a user grant", async () => {
    const secretGroupId = "00000000-0000-4000-8000-000000000041";
    const otherDirectGrantId = "00000000-0000-4000-8000-000000000042";
    const revokeGrant = vi.fn(async () => grantFixture({ status: "revoked" }));
    const store = fakeStore({
      lockKnowledgeBase: vi.fn(async () => undefined),
      findKnowledgeBase: vi.fn(async () => baseRecord()),
      findGrant: vi.fn(async () => grantFixture()),
      revokeGrant,
      isActiveUser: vi.fn(async () => true),
      findKnowledgeBaseAccess: vi.fn(async () =>
        accessRecord({
          accessSources: [
            { type: "direct_share", grantId: otherDirectGrantId },
            {
              type: "user_group",
              grantId: "00000000-0000-4000-8000-000000000043",
              groupId: secretGroupId,
              groupName: "Secret support group",
            },
          ],
        }),
      ),
      writeAudit: vi.fn(async () => undefined),
    });

    const result = await service(store).revokeGrant(ACTOR, BASE_ID, GRANT_ID);

    expect(result).toEqual({
      revoked_grant_id: GRANT_ID,
      target_type: "user",
      target_id: GRANT_TARGET_ID,
      remaining_access: {
        subject_type: "user",
        has_access: true,
        source_types: ["direct", "user_group"],
      },
    });
    expect(JSON.stringify(result)).not.toContain(secretGroupId);
    expect(JSON.stringify(result)).not.toContain("Secret support group");
    expect(revokeGrant).toHaveBeenCalledWith({
      id: GRANT_ID,
      actorId: ACTOR.id,
      reason: null,
      now: NOW,
    });
  });

  it("returns an aggregate group-member result after revoking a group grant", async () => {
    const groupId = "00000000-0000-4000-8000-000000000044";
    const summarizeGroupMemberRemainingAccess = vi.fn(async () => ({
      memberAccess: "some" as const,
      sourceTypes: ["owner" as const, "user_group" as const],
    }));
    const store = fakeStore({
      lockKnowledgeBase: vi.fn(async () => undefined),
      findKnowledgeBase: vi.fn(async () => baseRecord()),
      findGrant: vi.fn(async () =>
        grantFixture({
          granteeType: "user_group",
          userId: null,
          userGroupId: groupId,
        }),
      ),
      revokeGrant: vi.fn(async () => grantFixture({ status: "revoked" })),
      summarizeGroupMemberRemainingAccess,
      writeAudit: vi.fn(async () => undefined),
    });

    const result = await service(store).revokeGrant(ACTOR, BASE_ID, GRANT_ID);

    expect(result).toEqual({
      revoked_grant_id: GRANT_ID,
      target_type: "user_group",
      target_id: groupId,
      remaining_access: {
        subject_type: "user_group",
        member_access: "some",
        source_types: ["owner", "user_group"],
      },
    });
    expect(result.remaining_access).not.toHaveProperty("members");
    expect(summarizeGroupMemberRemainingAccess).toHaveBeenCalledWith({
      knowledgeBaseId: BASE_ID,
      ownerId: ACTOR.id,
      groupId,
    });
  });

  it("serializes concurrent quota reservations so only one crosses the hard boundary", async () => {
    const state = {
      base: baseRecord({ storageUsedBytes: 0n, storageReservedBytes: 0n }),
      reservations: [] as Array<Record<string, unknown>>,
    };
    const transaction = {
      $queryRawUnsafe: vi.fn(async () => [{ id: BASE_ID }]),
      knowledgeBase: {
        findUnique: vi.fn(async () => ({ ...state.base })),
        update: vi.fn(
          async ({
            data,
          }: {
            data: { storageReservedBytes: { increment: bigint } };
          }) => {
            state.base.storageReservedBytes +=
              data.storageReservedBytes.increment;
            return { ...state.base };
          },
        ),
      },
      knowledgeBaseDocument: {
        findUnique: vi.fn(async () => null),
      },
      knowledgeBaseStorageReservation: {
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          state.reservations.push(data);
          return data;
        }),
      },
    };
    let tail = Promise.resolve();
    const prisma = {
      $transaction: async <T>(
        work: (tx: typeof transaction) => Promise<T>,
      ): Promise<T> => {
        const previous = tail;
        let release!: () => void;
        tail = new Promise<void>((resolve) => {
          release = resolve;
        });
        await previous;
        try {
          return await work(transaction);
        } finally {
          release();
        }
      },
    };
    const store = new PrismaKnowledgeStore(prisma as never);
    const objectKey = (objectId: string) =>
      buildKnowledgeObjectKey({
        knowledgeBaseId: BASE_ID,
        documentId: DOCUMENT_ID,
        versionId: VERSION_ID,
        objectType: "original",
        objectId,
        extension: "pdf",
      });
    const reserve = (reservationId: string, objectId: string) =>
      store.transaction((locked) =>
        locked.reserveStorage({
          reservationId,
          reservationLeaseToken: objectId,
          knowledgeBaseId: BASE_ID,
          documentId: DOCUMENT_ID,
          documentVersionId: VERSION_ID,
          actorId: ACTOR.id,
          sizeBytes: 60n,
          objectKeys: [objectKey(objectId)],
          storageQuotaBytes: 100n,
          now: NOW,
        }),
      );

    const results = await Promise.all([
      reserve(
        "a0000000-0000-4000-8000-000000000001",
        "a0000000-0000-4000-8000-000000000011",
      ),
      reserve(
        "a0000000-0000-4000-8000-000000000002",
        "a0000000-0000-4000-8000-000000000012",
      ),
    ]);

    expect(results.map((result) => result.status).sort()).toEqual([
      "quota_exceeded",
      "reserved",
    ]);
    expect(state.base.storageReservedBytes).toBe(60n);
    expect(state.reservations).toHaveLength(1);
    expect(state.reservations[0]).toMatchObject({
      knowledgeBaseId: BASE_ID,
      documentId: DOCUMENT_ID,
      documentVersionId: VERSION_ID,
    });
    const duplicateKey = objectKey("a0000000-0000-4000-8000-000000000099");
    await expect(
      store.transaction((locked) =>
        locked.reserveStorage({
          reservationId: "a0000000-0000-4000-8000-000000000009",
          reservationLeaseToken: "a0000000-0000-4000-8000-000000000019",
          knowledgeBaseId: BASE_ID,
          documentId: DOCUMENT_ID,
          documentVersionId: VERSION_ID,
          actorId: ACTOR.id,
          sizeBytes: 1n,
          objectKeys: [duplicateKey, duplicateKey],
          storageQuotaBytes: 100n,
          now: NOW,
        }),
      ),
    ).rejects.toMatchObject({ code: "INTERNAL_ERROR" });
    transaction.knowledgeBaseDocument.findUnique.mockResolvedValueOnce({
      knowledgeBaseId: BASE_ID,
      status: "deleted",
    } as never);
    await expect(
      reserve(
        "a0000000-0000-4000-8000-000000000010",
        "a0000000-0000-4000-8000-000000000098",
      ),
    ).rejects.toMatchObject({ code: "KNOWLEDGE_DOCUMENT_NOT_FOUND" });
    expect(state.reservations).toHaveLength(1);
  });

  it("does not let an upload heartbeat revive an expired reservation lease", async () => {
    const updateMany = vi.fn(async () => ({ count: 0 }));
    const transaction = {
      $queryRawUnsafe: vi.fn(async () => [{ id: BASE_ID }]),
      knowledgeBaseStorageReservation: { updateMany },
    };
    const store = new PrismaKnowledgeStore({
      $transaction: vi.fn(
        async (work: (tx: typeof transaction) => Promise<unknown>) =>
          work(transaction),
      ),
    } as never);
    const reservationId = "a0000000-0000-4000-8000-000000000021";
    const leaseToken = "a0000000-0000-4000-8000-000000000022";

    await expect(
      store.transaction((locked) =>
        locked.heartbeatStorageReservation({
          reservationId,
          reservationLeaseToken: leaseToken,
          knowledgeBaseId: BASE_ID,
          now: NOW,
        }),
      ),
    ).rejects.toMatchObject({
      code: "KNOWLEDGE_DOCUMENT_PROCESSING_CONFLICT",
    });
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: reservationId,
        knowledgeBaseId: BASE_ID,
        leaseToken,
        cleanupStartedAt: null,
        leaseExpiresAt: { gt: NOW },
      },
      data: {
        leaseExpiresAt: new Date(NOW.getTime() + 10_000),
        updatedAt: NOW,
      },
    });
  });

  it("detects an exact-path duplicate from current document metadata", async () => {
    const replacementSha256 = "b".repeat(64);
    const incomingDocumentId = "00000000-0000-4000-8000-000000000061";
    const incomingVersionId = "00000000-0000-4000-8000-000000000062";
    const reservationId = "00000000-0000-4000-8000-000000000063";
    const leaseToken = "00000000-0000-4000-8000-000000000064";
    const objectKey = buildKnowledgeObjectKey({
      knowledgeBaseId: BASE_ID,
      documentId: incomingDocumentId,
      versionId: incomingVersionId,
      objectType: "original",
      objectId: OBJECT_ID,
      extension: "pdf",
    });
    const findDocument = vi.fn(async ({ where }: { where: { id?: string } }) =>
      where.id === DOCUMENT_ID
        ? { id: DOCUMENT_ID, originalSha256: replacementSha256 }
        : null,
    );
    const findProcessingVersion = vi.fn();
    const transaction = {
      $queryRawUnsafe: vi.fn(async () => [{ id: BASE_ID }]),
      knowledgeBase: {
        findUnique: vi.fn(async () =>
          baseRecord({
            storageUsedBytes: 0n,
            storageReservedBytes: 3n,
          }),
        ),
      },
      knowledgeBaseStorageReservation: {
        findUnique: vi.fn(async () => ({
          id: reservationId,
          knowledgeBaseId: BASE_ID,
          documentId: incomingDocumentId,
          documentVersionId: incomingVersionId,
          sizeBytes: 3n,
          leaseToken,
          cleanupStartedAt: null,
          leaseExpiresAt: new Date(NOW.getTime() + 10_000),
          objectKeysJson: [objectKey],
        })),
      },
      knowledgeBaseDocument: { findFirst: findDocument },
      knowledgeBaseEntry: {
        findFirst: vi.fn(async () => ({
          id: "00000000-0000-4000-8000-000000000066",
          entryType: "document",
          documentId: DOCUMENT_ID,
          name: "replacement.pdf",
        })),
      },
      knowledgeBaseDocumentVersion: { findFirst: findProcessingVersion },
    };
    const store = new PrismaKnowledgeStore({
      $transaction: vi.fn(
        async (work: (tx: typeof transaction) => Promise<unknown>) =>
          work(transaction),
      ),
    } as never);
    const input: RegisterDocumentUploadInput = {
      knowledgeBaseId: BASE_ID,
      actorId: ACTOR.id,
      documentId: incomingDocumentId,
      versionId: incomingVersionId,
      processingGeneration: "00000000-0000-4000-8000-000000000065",
      storageReservationId: reservationId,
      storageReservationLeaseToken: leaseToken,
      ingestion: {
        original: {
          id: OBJECT_ID,
          objectKey,
          mimeType: "application/pdf",
          sizeBytes: 3n,
          checksumSha256: replacementSha256,
        },
        originalFilename: "replacement.pdf",
        displayName: "replacement.pdf",
        normalizedDisplayName: "replacement.pdf",
        canonicalExtension: "pdf",
        canonicalMimeType: "application/pdf",
      },
      entry: {
        parentEntryId: null,
        segments: ["replacement.pdf"],
      },
      storageQuotaBytes: 100n,
      ocrEnabled: false,
      now: NOW,
    };

    await expect(
      store.transaction((locked) => locked.registerDocumentUpload(input)),
    ).resolves.toEqual({
      status: "duplicate",
      existingDocumentId: DOCUMENT_ID,
    });
    expect(findDocument).toHaveBeenCalledWith({
      where: {
        id: DOCUMENT_ID,
        knowledgeBaseId: BASE_ID,
        status: { not: "deleted" },
      },
    });
    expect(findProcessingVersion).not.toHaveBeenCalled();
  });

  it("resolves an existing document id by its normalized directory path", async () => {
    const parentEntryId = "00000000-0000-4000-8000-000000000067";
    const policiesEntryId = "00000000-0000-4000-8000-000000000068";
    const hrEntryId = "00000000-0000-4000-8000-000000000069";
    const findFirst = vi.fn(
      async ({ where }: { where: Record<string, unknown> }) => {
        if (where.id === parentEntryId) {
          return { id: parentEntryId, entryType: "folder" };
        }
        if (where.normalizedName === "policies") {
          return { id: policiesEntryId, entryType: "folder" };
        }
        if (where.normalizedName === "hr") {
          return { id: hrEntryId, entryType: "folder" };
        }
        if (where.normalizedName === "ai manual.pdf") {
          return {
            id: "00000000-0000-4000-8000-000000000070",
            entryType: "document",
            documentId: DOCUMENT_ID,
          };
        }
        return null;
      },
    );
    const store = new PrismaKnowledgeStore({
      knowledgeBaseEntry: { findFirst },
    } as never);

    await expect(
      store.findDocumentIdAtPath({
        knowledgeBaseId: BASE_ID,
        parentEntryId,
        segments: ["Policies", "HR", "ＡＩ Manual.pdf"],
      }),
    ).resolves.toBe(DOCUMENT_ID);
    expect(findFirst).toHaveBeenNthCalledWith(1, {
      where: {
        id: parentEntryId,
        knowledgeBaseId: BASE_ID,
        entryType: "folder",
      },
    });
    expect(findFirst).toHaveBeenLastCalledWith({
      where: {
        knowledgeBaseId: BASE_ID,
        parentEntryId: hrEntryId,
        normalizedName: "ai manual.pdf",
      },
    });
  });

  it("rejects a path replacement if another upload occupied the path after preflight", async () => {
    const incomingDocumentId = "00000000-0000-4000-8000-000000000073";
    const incomingVersionId = "00000000-0000-4000-8000-000000000074";
    const reservationId = "00000000-0000-4000-8000-000000000075";
    const leaseToken = "00000000-0000-4000-8000-000000000076";
    const objectKey = buildKnowledgeObjectKey({
      knowledgeBaseId: BASE_ID,
      documentId: incomingDocumentId,
      versionId: incomingVersionId,
      objectType: "original",
      objectId: OBJECT_ID,
      extension: "pdf",
    });
    const findDocument = vi.fn();
    const transaction = {
      $queryRawUnsafe: vi.fn(async () => [{ id: BASE_ID }]),
      knowledgeBase: {
        findUnique: vi.fn(async () =>
          baseRecord({
            storageUsedBytes: 0n,
            storageReservedBytes: 3n,
          }),
        ),
      },
      knowledgeBaseStorageReservation: {
        findUnique: vi.fn(async () => ({
          id: reservationId,
          knowledgeBaseId: BASE_ID,
          documentId: incomingDocumentId,
          documentVersionId: incomingVersionId,
          sizeBytes: 3n,
          leaseToken,
          cleanupStartedAt: null,
          leaseExpiresAt: new Date(NOW.getTime() + 10_000),
          objectKeysJson: [objectKey],
        })),
      },
      knowledgeBaseDocument: { findFirst: findDocument },
      knowledgeBaseEntry: {
        findFirst: vi.fn(async () => ({
          id: "00000000-0000-4000-8000-000000000077",
          entryType: "document",
          documentId: DOCUMENT_ID,
          name: "manual.pdf",
        })),
      },
    };
    const store = new PrismaKnowledgeStore({
      $transaction: vi.fn(
        async (work: (tx: typeof transaction) => Promise<unknown>) =>
          work(transaction),
      ),
    } as never);
    const input: RegisterDocumentUploadInput = {
      knowledgeBaseId: BASE_ID,
      actorId: ACTOR.id,
      documentId: incomingDocumentId,
      versionId: incomingVersionId,
      processingGeneration: "00000000-0000-4000-8000-000000000078",
      storageReservationId: reservationId,
      storageReservationLeaseToken: leaseToken,
      ingestion: {
        original: {
          id: OBJECT_ID,
          objectKey,
          mimeType: "application/pdf",
          sizeBytes: 3n,
          checksumSha256: "c".repeat(64),
        },
        originalFilename: "manual.pdf",
        displayName: "manual.pdf",
        normalizedDisplayName: "manual.pdf",
        canonicalExtension: "pdf",
        canonicalMimeType: "application/pdf",
      },
      entry: { parentEntryId: null, segments: ["manual.pdf"] },
      conflictResolution: "replace_path",
      pathDocumentIdBeforeUpload: null,
      storageQuotaBytes: 100n,
      ocrEnabled: false,
      now: NOW,
    };

    await expect(
      store.transaction((locked) => locked.registerDocumentUpload(input)),
    ).resolves.toEqual({ status: "processing_conflict" });
    expect(findDocument).not.toHaveBeenCalled();
  });

  it("removes folders created for an upload when its replacement target disappeared", async () => {
    const targetDocumentId = "00000000-0000-4000-8000-000000000081";
    const incomingVersionId = "00000000-0000-4000-8000-000000000082";
    const reservationId = "00000000-0000-4000-8000-000000000083";
    const leaseToken = "00000000-0000-4000-8000-000000000084";
    const createdFolderId = "00000000-0000-4000-8000-000000000085";
    const objectKey = buildKnowledgeObjectKey({
      knowledgeBaseId: BASE_ID,
      documentId: targetDocumentId,
      versionId: incomingVersionId,
      objectType: "original",
      objectId: OBJECT_ID,
      extension: "pdf",
    });
    const deleteEntry = vi.fn(async () => ({}));
    const findEntry = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: createdFolderId,
        parentEntryId: null,
        entryType: "folder",
      });
    const transaction = {
      $queryRawUnsafe: vi.fn(async () => [{ id: BASE_ID }]),
      knowledgeBase: {
        findUnique: vi.fn(async () =>
          baseRecord({
            storageUsedBytes: 0n,
            storageReservedBytes: 3n,
          }),
        ),
      },
      knowledgeBaseStorageReservation: {
        findUnique: vi.fn(async () => ({
          id: reservationId,
          knowledgeBaseId: BASE_ID,
          documentId: targetDocumentId,
          documentVersionId: incomingVersionId,
          sizeBytes: 3n,
          leaseToken,
          cleanupStartedAt: null,
          leaseExpiresAt: new Date(NOW.getTime() + 10_000),
          objectKeysJson: [objectKey],
        })),
      },
      knowledgeBaseDocument: { findFirst: vi.fn(async () => null) },
      knowledgeBaseEntry: {
        findFirst: findEntry,
        create: vi.fn(async () => ({ id: createdFolderId })),
        count: vi.fn(async () => 0),
        delete: deleteEntry,
      },
    };
    const store = new PrismaKnowledgeStore({
      $transaction: vi.fn(
        async (work: (tx: typeof transaction) => Promise<unknown>) =>
          work(transaction),
      ),
    } as never);
    const input: RegisterDocumentUploadInput = {
      knowledgeBaseId: BASE_ID,
      actorId: ACTOR.id,
      documentId: targetDocumentId,
      versionId: incomingVersionId,
      processingGeneration: "00000000-0000-4000-8000-000000000086",
      storageReservationId: reservationId,
      storageReservationLeaseToken: leaseToken,
      ingestion: {
        original: {
          id: OBJECT_ID,
          objectKey,
          mimeType: "application/pdf",
          sizeBytes: 3n,
          checksumSha256: "d".repeat(64),
        },
        originalFilename: "manual.pdf",
        displayName: "manual.pdf",
        normalizedDisplayName: "manual.pdf",
        canonicalExtension: "pdf",
        canonicalMimeType: "application/pdf",
      },
      entry: {
        parentEntryId: null,
        segments: ["New folder", "manual.pdf"],
      },
      conflictResolution: "replace",
      replaceDocumentId: targetDocumentId,
      storageQuotaBytes: 100n,
      ocrEnabled: false,
      now: NOW,
    };

    await expect(
      store.transaction((locked) => locked.registerDocumentUpload(input)),
    ).resolves.toEqual({ status: "replace_target_not_found" });
    expect(deleteEntry).toHaveBeenCalledWith({
      where: { id: createdFolderId },
    });
  });

  it("creates durable base and document tombstones before queueing base cleanup", async () => {
    const base = baseRecord({
      lifecycleStatus: "deleted",
      deletedAt: NOW,
      deletedBy: ACTOR.id,
      deletionReason: "user_requested",
      cleanupStatus: "pending",
    });
    const upsertBaseTombstone = vi.fn(async () => ({}));
    const createCleanup = vi.fn(async () => ({}));
    const discardAttempts = vi.fn(async () => ({ count: 2 }));
    const database = {
      knowledgeBase: { update: vi.fn(async () => base) },
      knowledgeBaseTombstone: { upsert: upsertBaseTombstone },
      knowledgeBaseDocument: { updateMany: vi.fn(async () => ({ count: 2 })) },
      knowledgeBaseDocumentVersion: {
        updateMany: vi.fn(async () => ({ count: 2 })),
      },
      knowledgeBaseProcessingAttempt: { updateMany: discardAttempts },
      knowledgeBaseObject: { updateMany: vi.fn(async () => ({ count: 4 })) },
      knowledgeBaseCleanupOutbox: { create: createCleanup },
      knowledgeBaseEntry: { findFirst: vi.fn(async () => null) },
      $executeRaw: vi.fn(async () => 2),
    };
    const store = new PrismaKnowledgeStore(database as never);

    await store.deleteKnowledgeBase({
      id: BASE_ID,
      actorId: ACTOR.id,
      reason: "user_requested",
      now: NOW,
    });

    expect(upsertBaseTombstone).toHaveBeenCalledWith({
      where: { id: BASE_ID },
      create: expect.objectContaining({
        id: BASE_ID,
        ownerId: ACTOR.id,
        cleanupStatus: "pending",
      }),
      update: expect.objectContaining({
        ownerId: ACTOR.id,
        cleanupStatus: "pending",
      }),
    });
    expect(database.$executeRaw).toHaveBeenCalledOnce();
    expect(discardAttempts).toHaveBeenCalledWith({
      where: { knowledgeBaseId: BASE_ID, status: "active" },
      data: {
        status: "discarded",
        discardedAt: NOW,
      },
    });
    expect(createCleanup).toHaveBeenCalledWith({
      data: expect.objectContaining({
        targetType: "knowledge_base",
        knowledgeBaseId: BASE_ID,
        status: "pending",
      }),
    });
  });

  it("creates the document tombstone in the same store transaction before cleanup", async () => {
    const document = documentRecord();
    const deleted = documentRecord({
      status: "deleted",
      deletedAt: NOW,
      deletedBy: ACTOR.id,
      deletionReason: "user_requested",
      cleanupStatus: "pending",
    });
    const upsertTombstone = vi.fn(async () => ({}));
    const createCleanup = vi.fn(async () => ({}));
    const discardAttempts = vi.fn(async () => ({ count: 1 }));
    const database = {
      $queryRawUnsafe: vi.fn(async () => [{ id: DOCUMENT_ID }]),
      knowledgeBaseDocument: {
        findFirst: vi.fn(async () => document),
        update: vi.fn(async () => deleted),
      },
      knowledgeBaseDocumentTombstone: { upsert: upsertTombstone },
      knowledgeBaseDocumentVersion: {
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
      knowledgeBaseProcessingAttempt: { updateMany: discardAttempts },
      knowledgeBaseObject: { updateMany: vi.fn(async () => ({ count: 1 })) },
      knowledgeBaseCleanupOutbox: { create: createCleanup },
      knowledgeBaseEntry: { findFirst: vi.fn(async () => null) },
    };
    const store = new PrismaKnowledgeStore(database as never);

    await expect(
      store.deleteDocument({
        knowledgeBaseId: BASE_ID,
        documentId: DOCUMENT_ID,
        actorId: ACTOR.id,
        reason: "user_requested",
        now: NOW,
      }),
    ).resolves.toEqual({ status: "deleted" });

    expect(upsertTombstone).toHaveBeenCalledWith({
      where: { id: DOCUMENT_ID },
      create: expect.objectContaining({
        id: DOCUMENT_ID,
        knowledgeBaseId: BASE_ID,
        cleanupStatus: "pending",
      }),
      update: expect.objectContaining({ cleanupStatus: "pending" }),
    });
    expect(discardAttempts).toHaveBeenCalledWith({
      where: { documentId: DOCUMENT_ID, status: "active" },
      data: {
        status: "discarded",
        discardedAt: NOW,
      },
    });
    expect(createCleanup).toHaveBeenCalledWith({
      data: expect.objectContaining({
        targetType: "document",
        knowledgeBaseId: BASE_ID,
        documentId: DOCUMENT_ID,
      }),
    });
  });

  it("discards the active external task in the cancellation transaction", async () => {
    const processingVersion = versionRecord({
      processingStage: "chunking",
      progressPercent: 55,
      versionStatus: "processing",
    });
    const processingDocument = documentRecord({
      status: "processing",
      currentVersionId: null,
      candidateVersionId: VERSION_ID,
      activeProcessingVersionId: VERSION_ID,
    });
    const discardAttempts = vi.fn(async () => ({ count: 1 }));
    const database = {
      $queryRawUnsafe: vi.fn(async () => [{ id: DOCUMENT_ID }]),
      knowledgeBaseDocument: {
        findFirst: vi.fn(async () => processingDocument),
        update: vi.fn(async ({ data }: { data: object }) => ({
          ...processingDocument,
          ...data,
        })),
      },
      knowledgeBaseDocumentVersion: {
        findUnique: vi.fn(async () => processingVersion),
        update: vi.fn(async ({ data }: { data: object }) => ({
          ...processingVersion,
          ...data,
        })),
      },
      knowledgeBaseProcessingAttempt: { updateMany: discardAttempts },
    };
    const store = new PrismaKnowledgeStore(database as never);

    await expect(
      store.cancelProcessing({
        knowledgeBaseId: BASE_ID,
        documentId: DOCUMENT_ID,
        actorId: ACTOR.id,
        reason: "user_requested",
        now: NOW,
      }),
    ).resolves.toMatchObject({ status: "cancelled" });

    expect(discardAttempts).toHaveBeenCalledWith({
      where: {
        documentVersionId: VERSION_ID,
        processingGeneration: processingVersion.processingGeneration,
        status: "active",
      },
      data: {
        status: "discarded",
        discardedAt: NOW,
      },
    });
  });

  it("reads the ordered start-intent snapshot before the turn projection exists", async () => {
    const prisma = {
      conversationTurn: { findFirst: vi.fn(async () => null) },
      conversationTurnStartIntent: {
        findUnique: vi.fn(async () => ({
          knowledgeBaseIdsJson: [KNOWLEDGE_BASE_ID_2, BASE_ID],
        })),
      },
      conversationTurnKnowledgeBase: { findMany: vi.fn(async () => []) },
    };
    const store = new PrismaKnowledgeStore(prisma as never);

    await expect(
      store.getTurnKnowledgeBaseIds({ turnId: DOCUMENT_ID }),
    ).resolves.toEqual([KNOWLEDGE_BASE_ID_2, BASE_ID]);
    expect(prisma.conversationTurnStartIntent.findUnique).toHaveBeenCalledWith({
      where: { projectionTurnId: DOCUMENT_ID },
      select: { knowledgeBaseIdsJson: true },
    });
    expect(
      prisma.conversationTurnKnowledgeBase.findMany,
    ).not.toHaveBeenCalled();
  });

  it("reprocesses from a compacted immutable original root without derived objects", async () => {
    const rootVersionId = "00000000-0000-4000-8000-000000000040";
    const currentVersionId = "00000000-0000-4000-8000-000000000041";
    const newVersionId = "00000000-0000-4000-8000-000000000042";
    const current = versionRecord({
      id: currentVersionId,
      versionNumber: 2,
      sourceVersionId: rootVersionId,
      processingConfigJson: { ocr_enabled: true },
    });
    const rootVersion = versionRecord({
      id: rootVersionId,
      versionStatus: "superseded",
      sourceVersionId: null,
    });
    const document = documentRecord({ currentVersionId });
    const createVersion = vi.fn(async ({ data }: { data: object }) => ({
      ...versionRecord({ id: newVersionId, versionNumber: 3 }),
      ...data,
    }));
    const findOriginal = vi.fn(
      async ({ where }: { where: { documentVersionId: string } }) =>
        where.documentVersionId === rootVersionId
          ? { id: OBJECT_ID, objectKey: "immutable-original" }
          : null,
    );
    const prisma = {
      $queryRawUnsafe: vi.fn(async () => [{ id: DOCUMENT_ID }]),
      knowledgeBaseDocument: {
        findFirst: vi.fn(async () => document),
        update: vi.fn(async ({ data }: { data: object }) => ({
          ...document,
          ...data,
        })),
      },
      knowledgeBaseDocumentVersion: {
        findUnique: vi.fn(async () => current),
        findFirst: vi.fn(async ({ where }: { where: { id: string } }) =>
          where.id === rootVersionId ? rootVersion : null,
        ),
        aggregate: vi.fn(async () => ({ _max: { versionNumber: 2 } })),
        create: createVersion,
      },
      knowledgeBaseObject: { findFirst: findOriginal },
    };
    const store = new PrismaKnowledgeStore(prisma as never);

    await expect(
      store.prepareProcessing({
        knowledgeBaseId: BASE_ID,
        documentId: DOCUMENT_ID,
        actorId: ACTOR.id,
        operation: "reprocess",
        newVersionId,
        processingGeneration: "00000000-0000-4000-8000-000000000043",
        now: NOW,
      }),
    ).resolves.toMatchObject({ status: "prepared" });

    expect(createVersion).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: newVersionId,
        sourceVersionId: rootVersionId,
        processingConfigJson: { ocr_enabled: true },
      }),
    });
    expect(findOriginal).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          documentVersionId: rootVersionId,
          objectType: "original",
          lifecycleStatus: "active",
        }),
      }),
    );
  });

  it("starts a fresh reprocess from the original after the initial candidate failed", async () => {
    const failedVersionId = "00000000-0000-4000-8000-000000000044";
    const newVersionId = "00000000-0000-4000-8000-000000000045";
    const failedCandidate = versionRecord({
      id: failedVersionId,
      versionStatus: "failed",
      operationType: "upload",
      processingStage: "failed",
      stableErrorCode: "KNOWLEDGE_IMAGE_MODEL_CONFIGURATION_CHANGED",
      processingConfigJson: { ocr_enabled: true, image_understanding: "old" },
    });
    const document = documentRecord({
      status: "failed",
      currentVersionId: null,
      candidateVersionId: failedVersionId,
      stableErrorCode: failedCandidate.stableErrorCode,
    });
    const createVersion = vi.fn(async ({ data }: { data: object }) => ({
      ...versionRecord({ id: newVersionId, versionNumber: 2 }),
      ...data,
    }));
    const updateDocument = vi.fn(
      async ({ data }: { data: Record<string, unknown> }) => ({
        ...document,
        ...data,
      }),
    );
    const store = new PrismaKnowledgeStore({
      $queryRawUnsafe: vi.fn(async () => [{ id: DOCUMENT_ID }]),
      knowledgeBaseDocument: {
        findFirst: vi.fn(async () => document),
        update: updateDocument,
      },
      knowledgeBaseDocumentVersion: {
        findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
          where.id === failedVersionId ? failedCandidate : null,
        ),
        aggregate: vi.fn(async () => ({ _max: { versionNumber: 1 } })),
        create: createVersion,
      },
      knowledgeBaseObject: {
        findFirst: vi.fn(async () => ({
          id: OBJECT_ID,
          objectKey: "failed-upload-original",
        })),
      },
    } as never);

    await expect(
      store.prepareProcessing({
        knowledgeBaseId: BASE_ID,
        documentId: DOCUMENT_ID,
        actorId: ACTOR.id,
        operation: "reprocess",
        newVersionId,
        processingGeneration: "00000000-0000-4000-8000-000000000046",
        now: NOW,
      }),
    ).resolves.toMatchObject({
      status: "prepared",
      value: {
        document: {
          status: "processing",
          candidateVersionId: newVersionId,
          activeProcessingVersionId: newVersionId,
        },
        processingVersion: {
          id: newVersionId,
          sourceVersionId: failedVersionId,
          operationType: "reprocess",
          processingStage: "queued",
        },
      },
    });
    expect(createVersion).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: newVersionId,
        sourceVersionId: failedVersionId,
        processingConfigJson: failedCandidate.processingConfigJson,
      }),
    });
    expect(updateDocument).toHaveBeenCalledWith({
      where: { id: DOCUMENT_ID },
      data: expect.objectContaining({
        status: "processing",
        candidateVersionId: newVersionId,
        activeProcessingVersionId: newVersionId,
        stableErrorCode: null,
      }),
    });
  });

  it("atomically retries a failed candidate requested by a batch rebuild", async () => {
    const candidate = versionRecord({
      versionStatus: "failed",
      operationType: "upload",
      processingStage: "failed",
      progressPercent: 45,
      stableErrorCode: "KNOWLEDGE_DOCUMENT_PARSING_INVALID",
    });
    const document = documentRecord({
      status: "failed",
      currentVersionId: null,
      candidateVersionId: candidate.id,
      stableErrorCode: candidate.stableErrorCode,
    });
    const updateVersion = vi.fn(
      async ({ data }: { data: Record<string, unknown> }) => ({
        ...candidate,
        ...data,
        processingRevision: candidate.processingRevision + 1n,
      }),
    );
    const updateDocument = vi.fn(
      async ({ data }: { data: Record<string, unknown> }) => ({
        ...document,
        ...data,
      }),
    );
    const store = new PrismaKnowledgeStore({
      $queryRawUnsafe: vi.fn(async () => [{ id: DOCUMENT_ID }]),
      knowledgeBaseDocument: {
        findFirst: vi.fn(async () => document),
        update: updateDocument,
      },
      knowledgeBaseDocumentVersion: {
        findUnique: vi.fn(async () => candidate),
        update: updateVersion,
      },
    } as never);

    const result = await store.prepareProcessing({
      knowledgeBaseId: BASE_ID,
      documentId: DOCUMENT_ID,
      actorId: ACTOR.id,
      operation: "retry_failed_or_rebuild_index",
      newVersionId: "00000000-0000-4000-8000-000000000040",
      processingGeneration: "00000000-0000-4000-8000-000000000041",
      now: NOW,
    });

    expect(result).toMatchObject({
      status: "prepared",
      value: {
        document: {
          status: "processing",
          activeProcessingVersionId: candidate.id,
        },
        processingVersion: {
          id: candidate.id,
          operationType: "retry",
          versionStatus: "processing",
          processingStage: "queued",
        },
      },
    });
    expect(updateVersion).toHaveBeenCalledWith({
      where: { id: candidate.id },
      data: expect.objectContaining({
        operationType: "retry",
        versionStatus: "processing",
        processingStage: "queued",
      }),
    });
  });

  it("atomically rebuilds a ready document requested by a batch rebuild", async () => {
    const current = versionRecord();
    const document = documentRecord({
      status: "ready",
      currentVersionId: current.id,
      candidateVersionId: null,
    });
    const updateVersion = vi.fn(
      async ({ data }: { data: Record<string, unknown> }) => ({
        ...current,
        ...data,
        processingRevision: current.processingRevision + 1n,
      }),
    );
    const updateDocument = vi.fn(
      async ({ data }: { data: Record<string, unknown> }) => ({
        ...document,
        ...data,
      }),
    );
    const store = new PrismaKnowledgeStore({
      $queryRawUnsafe: vi.fn(async () => [{ id: DOCUMENT_ID }]),
      knowledgeBaseDocument: {
        findFirst: vi.fn(async () => document),
        update: updateDocument,
      },
      knowledgeBaseDocumentVersion: {
        findUnique: vi.fn(async () => current),
        update: updateVersion,
      },
    } as never);

    const result = await store.prepareProcessing({
      knowledgeBaseId: BASE_ID,
      documentId: DOCUMENT_ID,
      actorId: ACTOR.id,
      operation: "retry_failed_or_rebuild_index",
      newVersionId: "00000000-0000-4000-8000-000000000040",
      processingGeneration: "00000000-0000-4000-8000-000000000041",
      now: NOW,
    });

    expect(result).toMatchObject({
      status: "prepared",
      value: {
        document: {
          status: "ready",
          activeProcessingVersionId: current.id,
        },
        processingVersion: {
          id: current.id,
          operationType: "rebuild_index",
          processingStage: "embedding",
        },
      },
    });
    expect(updateVersion).toHaveBeenCalledWith({
      where: { id: current.id },
      data: expect.objectContaining({
        operationType: "rebuild_index",
        processingStage: "embedding",
      }),
    });
  });

  it("projects safe numeric counters and all access sources", async () => {
    const currentEmbeddingProfileHash = "b".repeat(64);
    const access = accessRecord({
      accessSources: [
        { type: "owner" },
        {
          type: "direct_share",
          grantId: "00000000-0000-4000-8000-000000000030",
        },
        {
          type: "user_group",
          grantId: "00000000-0000-4000-8000-000000000031",
          groupId: "00000000-0000-4000-8000-000000000032",
          groupName: "Support",
        },
      ],
      documentCount: 4,
      searchableDocumentCount: 3,
    });
    const listAccessibleKnowledgeBases = vi.fn(async () => ({
      items: [access],
      nextCursor: null,
    }));
    const store = fakeStore({
      listAccessibleKnowledgeBases,
    });

    const result = await service(store, {
      currentEmbeddingProfileHash,
    }).listKnowledgeBases(ACTOR, { scope: "all", limit: 30 });

    expect(result.items[0]).toMatchObject({
      storage_used_bytes: 1_024,
      storage_reserved_bytes: 128,
      storage_quota_bytes: 10_737_418_240,
      access_sources: [
        { type: "owner" },
        {
          type: "direct",
          id: "00000000-0000-4000-8000-000000000030",
        },
        {
          type: "user_group",
          id: "00000000-0000-4000-8000-000000000032",
          name: "Support",
        },
      ],
      permissions: {
        view_content: true,
        manage_documents: true,
        delete: false,
      },
    });
    expect(listAccessibleKnowledgeBases).toHaveBeenCalledWith({
      actorId: ACTOR.id,
      scope: "all",
      lifecycleStatus: "active",
      limit: 30,
      searchability: {
        currentEmbeddingProfileHash,
      },
    });
  });

  it("rejects deletion unless the owner archived the knowledge base first", async () => {
    const deleteKnowledgeBase = vi.fn();
    const store = fakeStore({
      findKnowledgeBase: vi.fn(async () => baseRecord()),
      lockKnowledgeBase: vi.fn(async () => undefined),
      deleteKnowledgeBase,
    });

    await expect(
      service(store).deleteKnowledgeBase(ACTOR, BASE_ID, "user_requested"),
    ).rejects.toMatchObject({ code: "KNOWLEDGE_BASE_ARCHIVE_REQUIRED" });
    expect(deleteKnowledgeBase).not.toHaveBeenCalled();
  });

  it("reports the applications that must release a knowledge base before deletion", async () => {
    const deleteKnowledgeBase = vi.fn();
    const store = fakeStore({
      findKnowledgeBase: vi.fn(async () =>
        baseRecord({ lifecycleStatus: "archived" }),
      ),
      listKnowledgeBaseApplicationUsages: vi.fn(async () => [
        {
          id: "00000000-0000-4000-8000-000000000071",
          name: "制度问答助手",
          status: "active" as const,
        },
        {
          id: "00000000-0000-4000-8000-000000000072",
          name: "归档资料助手",
          status: "disabled" as const,
        },
      ]),
      deleteKnowledgeBase,
    });

    await expect(
      service(store).deleteKnowledgeBase(ACTOR, BASE_ID, "user_requested"),
    ).rejects.toMatchObject({
      code: "KNOWLEDGE_BASE_IN_USE",
      params: {
        usages: [
          {
            type: "application",
            resource_id: "00000000-0000-4000-8000-000000000071",
            name: "制度问答助手",
            status: "active",
          },
          {
            type: "application",
            resource_id: "00000000-0000-4000-8000-000000000072",
            name: "归档资料助手",
            status: "disabled",
          },
        ],
      },
    });
    expect(deleteKnowledgeBase).not.toHaveBeenCalled();
  });

  it("lists active application usages in binding order", async () => {
    const applicationId = "00000000-0000-4000-8000-000000000071";
    const disabledApplicationId = "00000000-0000-4000-8000-000000000072";
    const bindingFindMany = vi.fn(async () => [
      { applicationId: disabledApplicationId },
      { applicationId },
      { applicationId },
    ]);
    const applicationFindMany = vi.fn(async () => [
      { id: applicationId, name: "制度问答助手", status: "active" },
      {
        id: disabledApplicationId,
        name: "归档资料助手",
        status: "disabled",
      },
    ]);
    const store = new PrismaKnowledgeStore({
      applicationKnowledgeBase: { findMany: bindingFindMany },
      application: { findMany: applicationFindMany },
    } as never);

    await expect(
      store.listKnowledgeBaseApplicationUsages(BASE_ID),
    ).resolves.toEqual([
      {
        id: disabledApplicationId,
        name: "归档资料助手",
        status: "disabled",
      },
      { id: applicationId, name: "制度问答助手", status: "active" },
    ]);
    expect(bindingFindMany).toHaveBeenCalledWith({
      where: { knowledgeBaseId: BASE_ID },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { applicationId: true },
    });
    expect(applicationFindMany).toHaveBeenCalledWith({
      where: {
        id: { in: [disabledApplicationId, applicationId] },
        status: { in: ["active", "disabled"] },
        deletedAt: null,
      },
      select: { id: true, name: true, status: true },
    });
  });

  it("detects processing documents across the whole knowledge base", async () => {
    const findFirst = vi
      .fn()
      .mockResolvedValueOnce({ id: DOCUMENT_ID })
      .mockResolvedValueOnce(null);
    const store = new PrismaKnowledgeStore({
      knowledgeBaseDocument: { findFirst },
    } as never);

    await expect(store.hasProcessingDocuments(BASE_ID)).resolves.toBe(true);
    await expect(store.hasProcessingDocuments(BASE_ID)).resolves.toBe(false);
    expect(findFirst).toHaveBeenCalledWith({
      where: { knowledgeBaseId: BASE_ID, status: "processing" },
      select: { id: true },
    });
  });

  it("locks every knowledge-base document in stable order before deleting", async () => {
    const events: string[] = [];
    const deleteKnowledgeBase = vi.fn(async () => {
      events.push("delete-base");
      return baseRecord({ lifecycleStatus: "deleted" });
    });
    const scheduler: KnowledgeProcessingScheduler = {
      enqueue: vi.fn(async () => undefined),
      cancel: vi.fn(async () => undefined),
      async runDocumentExclusiveMutation<T>(
        documentId: string,
        operation: (signal: AbortSignal) => Promise<T>,
      ): Promise<T> {
        events.push(`acquire:${documentId}`);
        try {
          return await operation(new AbortController().signal);
        } finally {
          events.push(`release:${documentId}`);
        }
      },
      abortActiveDocumentMutations(documentIds) {
        events.push(`abort:${documentIds.join(",")}`);
      },
    };
    const store = fakeStore({
      findKnowledgeBase: vi.fn(async () =>
        baseRecord({ lifecycleStatus: "archived" }),
      ),
      lockKnowledgeBase: vi.fn(async () => {
        events.push("lock-base");
      }),
      listUndeletedDocumentIds: vi.fn(async () => [DOCUMENT_ID_2, DOCUMENT_ID]),
      deleteKnowledgeBase,
      writeAudit: vi.fn(async () => undefined),
    });

    await service(store, { scheduler }).deleteKnowledgeBase(
      ACTOR,
      BASE_ID,
      "user_requested",
    );

    expect(events).toEqual([
      `acquire:${DOCUMENT_ID}`,
      `acquire:${DOCUMENT_ID_2}`,
      "lock-base",
      "delete-base",
      `abort:${DOCUMENT_ID},${DOCUMENT_ID_2}`,
      `release:${DOCUMENT_ID_2}`,
      `release:${DOCUMENT_ID}`,
    ]);
    expect(deleteKnowledgeBase).toHaveBeenCalledOnce();
  });

  it("does not abort or delete any document when a later base lock is busy", async () => {
    const events: string[] = [];
    const abortActiveDocumentMutations = vi.fn();
    const deleteKnowledgeBase = vi.fn();
    const scheduler: KnowledgeProcessingScheduler = {
      enqueue: vi.fn(async () => undefined),
      cancel: vi.fn(async () => undefined),
      async runDocumentExclusiveMutation<T>(
        documentId: string,
        operation: (signal: AbortSignal) => Promise<T>,
      ): Promise<T> {
        events.push(`acquire:${documentId}`);
        if (documentId === DOCUMENT_ID_2) {
          throw new KnowledgeProcessingError("KNOWLEDGE_DOCUMENT_BUSY", {
            retryable: true,
          });
        }
        try {
          return await operation(new AbortController().signal);
        } finally {
          events.push(`release:${documentId}`);
        }
      },
      abortActiveDocumentMutations,
    };
    const store = fakeStore({
      findKnowledgeBase: vi.fn(async () =>
        baseRecord({ lifecycleStatus: "archived" }),
      ),
      listUndeletedDocumentIds: vi.fn(async () => [DOCUMENT_ID_2, DOCUMENT_ID]),
      deleteKnowledgeBase,
    });

    await expect(
      service(store, { scheduler }).deleteKnowledgeBase(
        ACTOR,
        BASE_ID,
        "user_requested",
      ),
    ).rejects.toMatchObject({ code: "KNOWLEDGE_DOCUMENT_BUSY" });

    expect(events).toEqual([
      `acquire:${DOCUMENT_ID}`,
      `acquire:${DOCUMENT_ID_2}`,
      `release:${DOCUMENT_ID}`,
    ]);
    expect(abortActiveDocumentMutations).not.toHaveBeenCalled();
    expect(deleteKnowledgeBase).not.toHaveBeenCalled();
  });

  it("deletes one document inside the shared Redis mutation boundary", async () => {
    const events: string[] = [];
    const processingVersion = versionRecord({
      versionStatus: "processing",
      processingStage: "embedding",
      progressPercent: 80,
    });
    const scheduler: KnowledgeProcessingScheduler = {
      enqueue: vi.fn(async () => undefined),
      cancel: vi.fn(async () => {
        events.push("cancel-queued");
      }),
      async runDocumentExclusiveMutation<T>(
        documentId: string,
        operation: (signal: AbortSignal) => Promise<T>,
      ): Promise<T> {
        events.push(`acquire:${documentId}`);
        try {
          return await operation(new AbortController().signal);
        } finally {
          events.push(`release:${documentId}`);
        }
      },
      abortActiveDocumentMutations(documentIds) {
        events.push(`abort:${documentIds.join(",")}`);
      },
    };
    const store = fakeStore({
      findKnowledgeBase: vi.fn(async () => baseRecord()),
      lockKnowledgeBase: vi.fn(async () => {
        events.push("lock-base");
      }),
      findDocument: vi.fn(async () => ({
        document: documentRecord({
          status: "processing",
          activeProcessingVersionId: VERSION_ID,
        }),
        processingVersion,
      })),
      deleteDocument: vi.fn(async () => {
        events.push("delete-document");
        return { status: "deleted" as const };
      }),
      writeAudit: vi.fn(async () => undefined),
    });

    await service(store, { scheduler }).deleteDocument(
      ACTOR,
      BASE_ID,
      DOCUMENT_ID,
      "user_requested",
    );

    expect(events).toEqual([
      `acquire:${DOCUMENT_ID}`,
      "lock-base",
      "delete-document",
      `abort:${DOCUMENT_ID}`,
      `release:${DOCUMENT_ID}`,
      "cancel-queued",
    ]);
  });

  it("does not abort an active document when its deletion transaction rolls back", async () => {
    const abortActiveDocumentMutations = vi.fn();
    const scheduler: KnowledgeProcessingScheduler = {
      enqueue: vi.fn(async () => undefined),
      cancel: vi.fn(async () => undefined),
      runDocumentExclusiveMutation,
      abortActiveDocumentMutations,
    };
    const store = fakeStore({
      findKnowledgeBase: vi.fn(async () => baseRecord()),
      lockKnowledgeBase: vi.fn(async () => undefined),
      findDocument: vi.fn(async () => ({
        document: documentRecord(),
        processingVersion: null,
      })),
      findDocumentVersion: vi.fn(async () => versionRecord()),
      deleteDocument: vi.fn(async () => {
        throw new Error("transaction rolled back");
      }),
    });

    await expect(
      service(store, { scheduler }).deleteDocument(
        ACTOR,
        BASE_ID,
        DOCUMENT_ID,
        "user_requested",
      ),
    ).rejects.toThrow("transaction rolled back");
    expect(abortActiveDocumentMutations).not.toHaveBeenCalled();
  });

  it("discards an uploaded object and returns the existing document on duplicate", async () => {
    const discardRegisteredUpload = vi.fn(async () => undefined);
    const registerDocumentUpload = vi.fn(async () => ({
      status: "duplicate" as const,
      existingDocumentId: DOCUMENT_ID,
    }));
    const scheduler = {
      enqueue: vi.fn(async () => undefined),
      cancel: vi.fn(async () => undefined),
      runDocumentExclusiveMutation,
      abortActiveDocumentMutations: vi.fn(),
    };
    const store = fakeStore({
      findKnowledgeBase: vi.fn(async () => baseRecord()),
      registerDocumentUpload,
      writeAudit: vi.fn(async () => undefined),
    });
    const knowledge = service(store, {
      scheduler,
      discardRegisteredUpload,
    });

    await expect(
      knowledge.uploadDocument(ACTOR, BASE_ID, {
        filename: "manual.pdf",
        declaredMimeType: "application/pdf",
        stream: Readable.from("pdf"),
      }),
    ).rejects.toMatchObject({
      code: "KNOWLEDGE_DOCUMENT_DUPLICATE",
      params: { existing_document_id: DOCUMENT_ID },
    });
    expect(registerDocumentUpload).toHaveBeenCalledWith(
      expect.objectContaining({ ocrEnabled: false }),
    );
    expect(discardRegisteredUpload).toHaveBeenCalledOnce();
    expect(scheduler.enqueue).not.toHaveBeenCalled();
  });

  it("persists an explicitly enabled OCR setting with the processing version", async () => {
    const registerDocumentUpload = vi.fn(async () => ({
      status: "duplicate" as const,
      existingDocumentId: DOCUMENT_ID,
    }));
    const store = fakeStore({
      findKnowledgeBase: vi.fn(async () => baseRecord()),
      registerDocumentUpload,
      writeAudit: vi.fn(async () => undefined),
    });

    await expect(
      service(store).uploadDocument(ACTOR, BASE_ID, {
        filename: "manual.pdf",
        declaredMimeType: "application/pdf",
        stream: Readable.from("pdf"),
        ocrEnabled: true,
      }),
    ).rejects.toMatchObject({ code: "KNOWLEDGE_DOCUMENT_DUPLICATE" });

    expect(registerDocumentUpload).toHaveBeenCalledWith(
      expect.objectContaining({ ocrEnabled: true }),
    );
  });

  it("registers a normalized directory path with automatic path replacement", async () => {
    const parentEntryId = "00000000-0000-4000-8000-000000000071";
    const sourceItemId = "00000000-0000-4000-8000-000000000072";
    const registerDocumentUpload = vi.fn(async () => ({
      status: "duplicate" as const,
      existingDocumentId: DOCUMENT_ID,
    }));
    const findDocumentIdAtPath = vi.fn(async () => DOCUMENT_ID);
    const registerUpload = vi.fn(
      async (
        input: Parameters<
          KnowledgeDocumentIngestionAdapter["registerUpload"]
        >[0],
      ) => {
        const objectKey = buildKnowledgeObjectKey({
          knowledgeBaseId: input.knowledgeBaseId,
          documentId: input.documentId,
          versionId: input.documentVersionId,
          objectType: "original",
          objectId: OBJECT_ID,
          extension: "pdf",
        });
        await input.reserveStorage({ sizeBytes: 3n, objectKeys: [objectKey] });
        return {
          original: {
            id: OBJECT_ID,
            objectKey,
            mimeType: "application/pdf",
            sizeBytes: 3n,
            checksumSha256: "a".repeat(64),
          },
          originalFilename: input.filename,
          displayName: input.filename,
          normalizedDisplayName: input.filename.toLocaleLowerCase(),
          canonicalExtension: "pdf",
          canonicalMimeType: "application/pdf",
        };
      },
    );
    const store = fakeStore({
      findKnowledgeBase: vi.fn(async () => baseRecord()),
      findDocumentIdAtPath,
      registerDocumentUpload,
      writeAudit: vi.fn(async () => undefined),
    });

    await expect(
      service(store, { registerUpload }).uploadDocument(ACTOR, BASE_ID, {
        filename: "ＡＩ Manual.pdf",
        declaredMimeType: "application/pdf",
        stream: Readable.from("pdf"),
        relativePath: "Policies/HR/ＡＩ Manual.pdf",
        parentEntryId,
        sourceItemId,
        conflictResolution: "replace_path",
      }),
    ).rejects.toMatchObject({ code: "KNOWLEDGE_DOCUMENT_DUPLICATE" });

    expect(findDocumentIdAtPath).toHaveBeenCalledWith({
      knowledgeBaseId: BASE_ID,
      parentEntryId,
      segments: ["Policies", "HR", "AI Manual.pdf"],
    });
    expect(registerUpload).toHaveBeenCalledWith(
      expect.objectContaining({ documentId: DOCUMENT_ID }),
    );
    expect(registerDocumentUpload).toHaveBeenCalledWith(
      expect.objectContaining({
        conflictResolution: "replace_path",
        documentId: DOCUMENT_ID,
        pathDocumentIdBeforeUpload: DOCUMENT_ID,
        entry: {
          parentEntryId,
          segments: ["Policies", "HR", "AI Manual.pdf"],
          sourceItemId,
        },
      }),
    );
  });

  it("rejects an unsafe directory path before writing object storage", async () => {
    const registerUpload = vi.fn();
    const store = fakeStore({
      findKnowledgeBase: vi.fn(async () => baseRecord()),
    });

    await expect(
      service(store, { registerUpload }).uploadDocument(ACTOR, BASE_ID, {
        filename: "manual.pdf",
        declaredMimeType: "application/pdf",
        stream: Readable.from("pdf"),
        relativePath: "../manual.pdf",
        conflictResolution: "replace_path",
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(registerUpload).not.toHaveBeenCalled();
  });

  it("discards an uploaded object and fails directly when storage quota is exhausted", async () => {
    const discardRegisteredUpload = vi.fn(async () => undefined);
    const scheduler = {
      enqueue: vi.fn(async () => undefined),
      cancel: vi.fn(async () => undefined),
      runDocumentExclusiveMutation,
      abortActiveDocumentMutations: vi.fn(),
    };
    const store = fakeStore({
      findKnowledgeBase: vi.fn(async () => baseRecord()),
      registerDocumentUpload: vi.fn(async () => ({
        status: "quota_exceeded" as const,
      })),
      writeAudit: vi.fn(async () => undefined),
    });

    await expect(
      service(store, { scheduler, discardRegisteredUpload }).uploadDocument(
        ACTOR,
        BASE_ID,
        {
          filename: "manual.pdf",
          declaredMimeType: "application/pdf",
          stream: Readable.from("pdf"),
        },
      ),
    ).rejects.toMatchObject({ code: "KNOWLEDGE_STORAGE_QUOTA_EXCEEDED" });
    expect(discardRegisteredUpload).toHaveBeenCalledOnce();
    expect(scheduler.enqueue).not.toHaveBeenCalled();
  });

  it("rejects an upload before registration when the atomic reservation exceeds quota", async () => {
    const reserveStorage = vi.fn(async () => ({
      status: "quota_exceeded" as const,
    }));
    const registerDocumentUpload = vi.fn();
    const discardRegisteredUpload = vi.fn();
    const store = fakeStore({
      findKnowledgeBase: vi.fn(async () => baseRecord()),
      reserveStorage,
      registerDocumentUpload,
    });

    await expect(
      service(store, { discardRegisteredUpload }).uploadDocument(
        ACTOR,
        BASE_ID,
        {
          filename: "manual.pdf",
          declaredMimeType: "application/pdf",
          stream: Readable.from("pdf"),
        },
      ),
    ).rejects.toMatchObject({ code: "KNOWLEDGE_STORAGE_QUOTA_EXCEEDED" });

    expect(reserveStorage).toHaveBeenCalledWith(
      expect.objectContaining({
        knowledgeBaseId: BASE_ID,
        sizeBytes: 3n,
        objectKeys: [expect.stringContaining(`/versions/`)],
      }),
    );
    expect(registerDocumentUpload).not.toHaveBeenCalled();
    expect(discardRegisteredUpload).not.toHaveBeenCalled();
  });

  it.each([
    { conflictResolution: "replace" },
    { conflictResolution: "keep_both", replaceDocumentId: DOCUMENT_ID },
    { replaceDocumentId: DOCUMENT_ID },
    { conflictResolution: "replace", replaceDocumentId: "not-a-uuid" },
  ])(
    "rejects invalid conflict options before writing to object storage: %j",
    async (conflictOptions) => {
      const registerUpload = vi.fn();
      const store = fakeStore({
        findKnowledgeBase: vi.fn(async () => baseRecord()),
      });

      await expect(
        service(store, { registerUpload }).uploadDocument(ACTOR, BASE_ID, {
          filename: "manual.pdf",
          declaredMimeType: "application/pdf",
          stream: Readable.from("pdf"),
          ...conflictOptions,
        } as never),
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

      expect(registerUpload).not.toHaveBeenCalled();
    },
  );

  it("keeps quota reserved when a rejected upload cannot be removed", async () => {
    const releaseStorageReservation = vi.fn(async () => undefined);
    const store = fakeStore({
      findKnowledgeBase: vi.fn(async () => baseRecord()),
      registerDocumentUpload: vi.fn(async () => ({
        status: "duplicate" as const,
        existingDocumentId: DOCUMENT_ID,
      })),
      releaseStorageReservation,
      writeAudit: vi.fn(async () => undefined),
    });

    await expect(
      service(store, {
        discardRegisteredUpload: vi.fn(async () => {
          throw new Error("MinIO unavailable");
        }),
      }).uploadDocument(ACTOR, BASE_ID, {
        filename: "manual.pdf",
        declaredMimeType: "application/pdf",
        stream: Readable.from("pdf"),
      }),
    ).rejects.toMatchObject({ code: "KNOWLEDGE_DOCUMENT_DUPLICATE" });

    expect(releaseStorageReservation).not.toHaveBeenCalled();
  });

  it("authorizes an exact historical version before resolving a Markdown asset", async () => {
    const getAsset = vi.fn(async () => ({
      filename: "asset.png",
      mimeType: "image/png",
      sizeBytes: 3n,
      stream: Readable.from("png"),
    }));
    const store = fakeStore({
      findKnowledgeBase: vi.fn(async () => baseRecord()),
      findKnowledgeBaseAccess: vi.fn(async () => accessRecord()),
      findDocument: vi.fn(async () => ({
        document: documentRecord(),
        processingVersion: null,
      })),
      findDocumentVersion: vi.fn(async () =>
        versionRecord({ versionStatus: "superseded" }),
      ),
    });
    const knowledge = service(store, { getAsset });

    await knowledge.getAsset(ACTOR, BASE_ID, DOCUMENT_ID, VERSION_ID, ASSET_ID);

    expect(getAsset).toHaveBeenCalledWith({
      actorId: ACTOR.id,
      knowledgeBaseId: BASE_ID,
      documentId: DOCUMENT_ID,
      documentVersionId: VERSION_ID,
      assetReferenceId: ASSET_ID,
    });
  });

  it("authorizes an exact historical version before returning parsed Markdown", async () => {
    const getParsedContent = vi.fn(async () => ({ markdown: "# Historical" }));
    const store = fakeStore({
      findKnowledgeBase: vi.fn(async () => baseRecord()),
      findKnowledgeBaseAccess: vi.fn(async () => accessRecord()),
      findDocument: vi.fn(async () => ({
        document: documentRecord({ status: "processing" }),
        processingVersion: null,
      })),
      findDocumentVersion: vi.fn(async () =>
        versionRecord({ versionStatus: "superseded" }),
      ),
    });

    const result = await service(store, { getParsedContent }).getParsedContent(
      ACTOR,
      BASE_ID,
      DOCUMENT_ID,
      VERSION_ID,
    );

    expect(result).toEqual({
      document_id: DOCUMENT_ID,
      document_version_id: VERSION_ID,
      markdown: "# Historical",
    });
    expect(getParsedContent).toHaveBeenCalledWith({
      knowledgeBaseId: BASE_ID,
      documentId: DOCUMENT_ID,
      documentVersionId: VERSION_ID,
    });
  });

  it("uses the exact-version original adapter and separate redacted preview and download audits", async () => {
    const writeAudit = vi.fn(async () => undefined);
    const getOriginal = vi.fn(async () => ({
      filename: "diagram.png",
      mimeType: "image/png",
      sizeBytes: 3n,
      stream: Readable.from("png"),
    }));
    const findKnowledgeBaseAccess = vi.fn(async () => accessRecord());
    const store = fakeStore({
      findKnowledgeBase: vi.fn(async () => baseRecord()),
      findKnowledgeBaseAccess,
      findDocument: vi.fn(async () => ({
        document: documentRecord(),
        processingVersion: null,
      })),
      findDocumentVersion: vi.fn(async () =>
        versionRecord({
          canonicalExtension: "png",
          mimeType: "image/png",
          originalFilename: "diagram.png",
          versionStatus: "superseded",
        }),
      ),
      writeAudit,
    });
    const knowledge = service(store, { getOriginal });

    const preview = await knowledge.getOriginalPreview(
      ACTOR,
      BASE_ID,
      DOCUMENT_ID,
      VERSION_ID,
    );
    const download = await knowledge.downloadOriginal(
      ACTOR,
      BASE_ID,
      DOCUMENT_ID,
      VERSION_ID,
    );
    preview.stream.destroy();
    download.stream.destroy();

    const exactInput = {
      actorId: ACTOR.id,
      knowledgeBaseId: BASE_ID,
      documentId: DOCUMENT_ID,
      documentVersionId: VERSION_ID,
    };
    expect(getOriginal).toHaveBeenNthCalledWith(1, exactInput);
    expect(getOriginal).toHaveBeenNthCalledWith(2, exactInput);
    expect(findKnowledgeBaseAccess).toHaveBeenCalledTimes(2);
    expect(writeAudit).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        action: "knowledge_document.original_previewed",
        targetType: "knowledge_document",
        targetId: DOCUMENT_ID,
        result: "success",
        metadata: {
          knowledge_base_id: BASE_ID,
          document_version_id: VERSION_ID,
          canonical_extension: "png",
        },
      }),
    );
    expect(writeAudit).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        action: "knowledge_document.original_downloaded",
        targetType: "knowledge_document",
        targetId: DOCUMENT_ID,
        result: "success",
        metadata: {
          knowledge_base_id: BASE_ID,
          document_version_id: VERSION_ID,
          canonical_extension: "png",
        },
      }),
    );
    expect(JSON.stringify(writeAudit.mock.calls)).not.toContain("diagram.png");
  });

  it.each(["doc", "xls", "ppt", "odt", "ods", "odp", "tif", "tiff", "bmp"])(
    "opens and audits the Flyfish-backed %s original preview",
    async (canonicalExtension) => {
      const writeAudit = vi.fn(async () => undefined);
      const getOriginal = vi.fn(async () => ({
        filename: `document.${canonicalExtension}`,
        mimeType: "application/octet-stream",
        sizeBytes: 3n,
        stream: Readable.from("raw"),
      }));
      const store = fakeStore({
        findKnowledgeBase: vi.fn(async () => baseRecord()),
        findKnowledgeBaseAccess: vi.fn(async () => accessRecord()),
        findDocument: vi.fn(async () => ({
          document: documentRecord(),
          processingVersion: null,
        })),
        findDocumentVersion: vi.fn(async () =>
          versionRecord({ canonicalExtension, versionStatus: "superseded" }),
        ),
        writeAudit,
      });

      const preview = await service(store, {
        getOriginal,
      }).getOriginalPreview(ACTOR, BASE_ID, DOCUMENT_ID, VERSION_ID);
      preview.stream.destroy();

      expect(getOriginal).toHaveBeenCalledOnce();
      expect(writeAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "knowledge_document.original_previewed",
          metadata: expect.objectContaining({
            canonical_extension: canonicalExtension,
          }),
        }),
      );
    },
  );

  it("reauthorizes each file-preview request before reopening the exact object", async () => {
    const findKnowledgeBaseAccess = vi
      .fn()
      .mockResolvedValueOnce(accessRecord())
      .mockResolvedValueOnce(null);
    const getOriginal = vi.fn(async () => ({
      filename: "diagram.png",
      mimeType: "image/png",
      sizeBytes: 3n,
      stream: Readable.from("png"),
    }));
    const store = fakeStore({
      findKnowledgeBase: vi.fn(async () => baseRecord()),
      findKnowledgeBaseAccess,
      findDocument: vi.fn(async () => ({
        document: documentRecord({ canonicalExtension: "png" }),
        processingVersion: null,
      })),
      findDocumentVersion: vi.fn(async () =>
        versionRecord({
          canonicalExtension: "png",
          versionStatus: "superseded",
        }),
      ),
      writeAudit: vi.fn(async () => undefined),
    });
    const knowledge = service(store, { getOriginal });

    const first = await knowledge.getOriginalPreview(
      ACTOR,
      BASE_ID,
      DOCUMENT_ID,
      VERSION_ID,
    );
    first.stream.destroy();
    await expect(
      knowledge.getOriginalPreview(ACTOR, BASE_ID, DOCUMENT_ID, VERSION_ID),
    ).rejects.toMatchObject({ code: "KNOWLEDGE_BASE_ACCESS_DENIED" });

    expect(findKnowledgeBaseAccess).toHaveBeenCalledTimes(2);
    expect(getOriginal).toHaveBeenCalledTimes(1);
  });

  it("projects exact historical version metadata and preview capability", async () => {
    const store = fakeStore({
      findKnowledgeBase: vi.fn(async () => baseRecord()),
      findKnowledgeBaseAccess: vi.fn(async () => accessRecord()),
      findDocument: vi.fn(async () => ({
        document: documentRecord({
          displayName: "current.docx",
          canonicalExtension: "docx",
          mimeType:
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        }),
        processingVersion: null,
      })),
      findDocumentVersion: vi.fn(async () =>
        versionRecord({
          versionStatus: "superseded",
          originalFilename: "historical.tiff",
          canonicalExtension: "tiff",
          mimeType: "image/tiff",
          sizeBytes: 42n,
        }),
      ),
    });

    const result = await service(store).getDocument(
      ACTOR,
      BASE_ID,
      DOCUMENT_ID,
      VERSION_ID,
    );

    expect(result).toMatchObject({
      display_name: "historical.tiff",
      canonical_extension: "tiff",
      mime_type: "image/tiff",
      size_bytes: 42,
      processing: null,
      preview: {
        parsed: true,
        original_supported: true,
        renderer: "file",
      },
    });
  });

  it("rejects an exact version that belongs to another document", async () => {
    const getParsedContent = vi.fn(async () => ({ markdown: "forbidden" }));
    const store = fakeStore({
      findKnowledgeBase: vi.fn(async () => baseRecord()),
      findKnowledgeBaseAccess: vi.fn(async () => accessRecord()),
      findDocument: vi.fn(async () => ({
        document: documentRecord(),
        processingVersion: null,
      })),
      findDocumentVersion: vi.fn(async () =>
        versionRecord({
          documentId: "00000000-0000-4000-8000-000000000099",
          versionStatus: "superseded",
        }),
      ),
    });

    await expect(
      service(store, { getParsedContent }).getParsedContent(
        ACTOR,
        BASE_ID,
        DOCUMENT_ID,
        VERSION_ID,
      ),
    ).rejects.toMatchObject({ code: "KNOWLEDGE_DOCUMENT_NOT_FOUND" });
    expect(getParsedContent).not.toHaveBeenCalled();
  });

  it("preserves selection order and reports the current authorization intersection", async () => {
    const usable = "00000000-0000-4000-8000-000000000010";
    const revoked = "00000000-0000-4000-8000-000000000011";
    const resolveUsableKnowledgeBaseIds = vi.fn(async () => [usable]);
    const store = fakeStore({ resolveUsableKnowledgeBaseIds });

    const result = await service(store).resolveUsableKnowledgeBaseIds(ACTOR, [
      usable,
      revoked,
      usable,
    ]);

    expect(result).toEqual({
      requested_ids: [usable, revoked],
      usable_ids: [usable],
      unavailable_ids: [revoked],
    });
    expect(resolveUsableKnowledgeBaseIds).toHaveBeenCalledWith(ACTOR.id, [
      usable,
      revoked,
    ]);
  });

  it.each([[], [KNOWLEDGE_BASE_ID_2]].map((selection) => ({ selection })))(
    "allows all currently authorized knowledge bases when the turn selection is %j",
    async ({ selection }) => {
      const resolveUsableKnowledgeBaseIds = vi.fn(async (_actorId: string, requested?: string[]) =>
        [BASE_ID, KNOWLEDGE_BASE_ID_2].filter((id) => requested === undefined || requested.includes(id)),
      );
      const knowledge = service(fakeStore({
        getTurnKnowledgeBaseIds: vi.fn(async () => selection),
        resolveUsableKnowledgeBaseIds,
      }));

      const scope = await knowledge.getTurnRetrievalScope(ACTOR, { turnId: DOCUMENT_ID });

      expect(scope).toEqual({
        requested_ids: selection,
        usable_ids: selection.length ? [KNOWLEDGE_BASE_ID_2, BASE_ID] : [BASE_ID, KNOWLEDGE_BASE_ID_2],
        unavailable_ids: [],
      });
      expect(resolveUsableKnowledgeBaseIds).toHaveBeenCalledWith(ACTOR.id);
    },
  );

  it("rechecks grants on every tool scope request and keeps unselected access after a selected grant is revoked", async () => {
    const resolveUsableKnowledgeBaseIds = vi.fn()
      .mockResolvedValueOnce([BASE_ID, KNOWLEDGE_BASE_ID_2])
      .mockResolvedValueOnce([KNOWLEDGE_BASE_ID_2])
      .mockResolvedValueOnce([]);
    const knowledge = service(fakeStore({
      getTurnKnowledgeBaseIds: vi.fn(async () => [BASE_ID]),
      resolveUsableKnowledgeBaseIds,
    }));
    expect((await knowledge.getTurnRetrievalScope(ACTOR, { turnId: DOCUMENT_ID })).usable_ids).toEqual([BASE_ID, KNOWLEDGE_BASE_ID_2]);
    expect(await knowledge.getTurnRetrievalScope(ACTOR, { turnId: DOCUMENT_ID })).toEqual({
      requested_ids: [BASE_ID], usable_ids: [KNOWLEDGE_BASE_ID_2], unavailable_ids: [BASE_ID],
    });
    expect((await knowledge.getTurnRetrievalScope(ACTOR, { turnId: DOCUMENT_ID })).usable_ids).toEqual([]);
  });

  it("renames only document metadata without scheduling processing", async () => {
    const enqueue = vi.fn(async () => undefined);
    const renameDocument = vi.fn(async () => ({
      status: "renamed" as const,
      value: { document: documentRecord(), processingVersion: null },
    }));
    const store = fakeStore({
      findKnowledgeBase: vi.fn(async () => baseRecord()),
      renameDocument,
      writeAudit: vi.fn(async () => undefined),
    });

    const result = await service(store, {
      scheduler: {
        enqueue,
        cancel: vi.fn(async () => undefined),
        runDocumentExclusiveMutation,
        abortActiveDocumentMutations: vi.fn(),
      },
    }).renameDocument(ACTOR, BASE_ID, DOCUMENT_ID, {
      displayName: "  Updated Manual.pdf  ",
    });

    expect(result.id).toBe(DOCUMENT_ID);
    expect(renameDocument).toHaveBeenCalledWith({
      knowledgeBaseId: BASE_ID,
      documentId: DOCUMENT_ID,
      actorId: ACTOR.id,
      displayName: "Updated Manual.pdf",
      normalizedDisplayName: "updated manual.pdf",
      now: NOW,
    });
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("rebuilds every requested document independently", async () => {
    const otherDocumentId = "00000000-0000-4000-8000-000000000040";
    const prepareProcessing = vi.fn(async (input: { documentId: string }) =>
      input.documentId === DOCUMENT_ID
        ? {
            status: "prepared" as const,
            value: {
              document: documentRecord(),
              processingVersion: versionRecord({
                operationType: "rebuild_index",
                processingStage: "embedding",
              }),
            },
          }
        : { status: "not_found" as const },
    );
    const store = fakeStore({
      findKnowledgeBase: vi.fn(async () => baseRecord()),
      prepareProcessing,
      writeAudit: vi.fn(async () => undefined),
    });

    const result = await service(store).rebuildDocuments(ACTOR, BASE_ID, [
      DOCUMENT_ID,
      otherDocumentId,
      DOCUMENT_ID,
    ]);

    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toMatchObject({
      document_id: DOCUMENT_ID,
      status: "accepted",
    });
    expect(result.items[1]).toEqual({
      document_id: otherDocumentId,
      status: "rejected",
      error_code: "KNOWLEDGE_DOCUMENT_NOT_FOUND",
    });
    expect(result.next_cursor).toBeNull();
  });

  it("allows one document rebuild after failed full maintenance while keeping the general gate closed", async () => {
    const assertMaintenanceAvailable = vi.fn(async () => {
      throw new AppError("KNOWLEDGE_MAINTENANCE_UNAVAILABLE");
    });
    const assertDocumentRebuildAvailable = vi.fn(async () => undefined);
    const enqueue = vi.fn(async () => undefined);
    const prepareProcessing = vi.fn(async () => ({
      status: "prepared" as const,
      value: {
        document: documentRecord(),
        processingVersion: versionRecord({
          operationType: "rebuild_index",
          processingStage: "embedding",
        }),
      },
    }));
    const store = fakeStore({
      findKnowledgeBase: vi.fn(async () => baseRecord()),
      prepareProcessing,
      writeAudit: vi.fn(async () => undefined),
    });

    const result = await service(store, {
      scheduler: {
        enqueue,
        cancel: vi.fn(async () => undefined),
        runDocumentExclusiveMutation,
        abortActiveDocumentMutations: vi.fn(),
      },
      assertMaintenanceAvailable,
      assertDocumentRebuildAvailable,
    }).rebuildDocument(ACTOR, BASE_ID, DOCUMENT_ID);

    expect(result.processing).toMatchObject({ operation: "rebuild" });
    expect(assertDocumentRebuildAvailable).toHaveBeenCalledOnce();
    expect(assertMaintenanceAvailable).not.toHaveBeenCalled();
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        documentId: DOCUMENT_ID,
        operation: "rebuild_index",
      }),
    );
  });

  it("allows retrying a failed in-place rebuild while the general maintenance gate is closed", async () => {
    const assertMaintenanceAvailable = vi.fn(async () => {
      throw new AppError("KNOWLEDGE_MAINTENANCE_UNAVAILABLE");
    });
    const assertDocumentRebuildAvailable = vi.fn(async () => undefined);
    const enqueue = vi.fn(async () => undefined);
    const prepareProcessing = vi.fn(async () => ({
      status: "prepared" as const,
      value: {
        document: documentRecord(),
        processingVersion: versionRecord({
          operationType: "rebuild_index",
          processingStage: "embedding",
        }),
      },
    }));
    const store = fakeStore({
      findKnowledgeBase: vi.fn(async () => baseRecord()),
      prepareProcessing,
      writeAudit: vi.fn(async () => undefined),
    });

    const result = await service(store, {
      scheduler: {
        enqueue,
        cancel: vi.fn(async () => undefined),
        runDocumentExclusiveMutation,
        abortActiveDocumentMutations: vi.fn(),
      },
      assertMaintenanceAvailable,
      assertDocumentRebuildAvailable,
    }).retryDocument(ACTOR, BASE_ID, DOCUMENT_ID);

    expect(result.processing).toMatchObject({ operation: "rebuild" });
    expect(assertDocumentRebuildAvailable).toHaveBeenCalledOnce();
    expect(assertMaintenanceAvailable).not.toHaveBeenCalled();
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        documentId: DOCUMENT_ID,
        operation: "rebuild_index",
      }),
    );
  });

  it("retries a failed candidate selected through the batch rebuild action", async () => {
    const enqueue = vi.fn(async () => undefined);
    const prepareProcessing = vi.fn(async () => ({
      status: "prepared" as const,
      value: {
        document: documentRecord({
          status: "processing",
          currentVersionId: null,
          candidateVersionId: VERSION_ID,
          activeProcessingVersionId: VERSION_ID,
        }),
        processingVersion: versionRecord({
          versionStatus: "processing",
          operationType: "retry",
          processingStage: "queued",
        }),
      },
    }));
    const store = fakeStore({
      findKnowledgeBase: vi.fn(async () => baseRecord()),
      prepareProcessing,
      writeAudit: vi.fn(async () => undefined),
    });

    const result = await service(store, {
      scheduler: {
        enqueue,
        cancel: vi.fn(async () => undefined),
        runDocumentExclusiveMutation,
        abortActiveDocumentMutations: vi.fn(),
      },
    }).rebuildDocuments(ACTOR, BASE_ID, [DOCUMENT_ID]);

    expect(result.items[0]).toMatchObject({
      document_id: DOCUMENT_ID,
      status: "accepted",
      document: {
        status: "processing",
        processing: {
          operation: "retry",
          stage: "queued",
        },
      },
    });
    expect(prepareProcessing).toHaveBeenCalledWith(
      expect.objectContaining({
        documentId: DOCUMENT_ID,
        operation: "retry_failed_or_rebuild_index",
      }),
    );
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        documentId: DOCUMENT_ID,
        operation: "retry",
      }),
    );
  });

  it("reads rebuild-all targets through a bounded id keyset page", async () => {
    const nextDocumentId = "00000000-0000-4000-8000-000000000040";
    const extraDocumentId = "00000000-0000-4000-8000-000000000041";
    const findMany = vi.fn(async (query: unknown) => {
      void query;
      return [
        { id: DOCUMENT_ID_2 },
        { id: nextDocumentId },
        { id: extraDocumentId },
      ];
    });
    const store = new PrismaKnowledgeStore({
      knowledgeBaseDocument: { findMany },
    } as never);

    const result = await store.listRebuildableDocumentPage({
      knowledgeBaseId: BASE_ID,
      afterDocumentId: DOCUMENT_ID,
      limit: 2,
    });

    expect(result).toEqual({
      documentIds: [DOCUMENT_ID_2, nextDocumentId],
      nextCursor: nextDocumentId,
    });
    expect(findMany).toHaveBeenCalledWith({
      where: {
        knowledgeBaseId: BASE_ID,
        status: { not: "deleted" },
        id: { gt: DOCUMENT_ID },
      },
      orderBy: { id: "asc" },
      select: { id: true },
      take: 3,
    });
    expect(findMany.mock.calls[0]?.[0]).not.toHaveProperty("skip");
  });

  it("rejects an unbounded explicit rebuild batch before scheduling", async () => {
    const prepareProcessing = vi.fn();
    const documentIds = Array.from(
      { length: 101 },
      (_, index) =>
        `00000000-0000-4000-8000-${String(index + 100).padStart(12, "0")}`,
    );
    const store = fakeStore({
      findKnowledgeBase: vi.fn(async () => baseRecord()),
      prepareProcessing,
    });

    await expect(
      service(store).rebuildDocuments(ACTOR, BASE_ID, documentIds),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(prepareProcessing).not.toHaveBeenCalled();
  });

  it("schedules only one bounded rebuild-all keyset page and returns its cursor", async () => {
    const nextCursor = "00000000-0000-4000-8000-000000000040";
    const listRebuildableDocumentPage = vi.fn(async () => ({
      documentIds: [DOCUMENT_ID],
      nextCursor,
    }));
    const prepareProcessing = vi.fn(async () => ({
      status: "prepared" as const,
      value: {
        document: documentRecord(),
        processingVersion: versionRecord({
          operationType: "rebuild_index",
          processingStage: "embedding",
        }),
      },
    }));
    const store = fakeStore({
      findKnowledgeBase: vi.fn(async () => baseRecord()),
      listRebuildableDocumentPage,
      prepareProcessing,
      writeAudit: vi.fn(async () => undefined),
    });

    const result = await service(store).rebuildDocuments(
      ACTOR,
      BASE_ID,
      undefined,
      DOCUMENT_ID_2,
    );

    expect(result).toMatchObject({
      items: [{ document_id: DOCUMENT_ID, status: "accepted" }],
      next_cursor: nextCursor,
    });
    expect(listRebuildableDocumentPage).toHaveBeenCalledWith({
      knowledgeBaseId: BASE_ID,
      afterDocumentId: DOCUMENT_ID_2,
      limit: 100,
    });
    expect(prepareProcessing).toHaveBeenCalledTimes(1);
  });

  it("blocks uploads at the maintenance gate before registering any object", async () => {
    const registerUpload = vi.fn();
    const store = fakeStore({
      findKnowledgeBase: vi.fn(async () => baseRecord()),
    });
    const knowledge = new KnowledgeService({
      store,
      ingestionAdapter: {
        registerUpload,
        discardRegisteredUpload: vi.fn(async () => undefined),
      },
      scheduler: {
        enqueue: vi.fn(async () => undefined),
        cancel: vi.fn(async () => undefined),
        runDocumentExclusiveMutation,
        abortActiveDocumentMutations: vi.fn(),
      },
      maintenanceGate: {
        assertAvailable: vi.fn(async () => {
          throw new AppError("KNOWLEDGE_MAINTENANCE_UNAVAILABLE");
        }),
        assertDocumentRebuildAvailable: vi.fn(async () => undefined),
      },
    });

    await expect(
      knowledge.uploadDocument(ACTOR, BASE_ID, {
        filename: "manual.pdf",
        declaredMimeType: "application/pdf",
        stream: Readable.from("pdf"),
      }),
    ).rejects.toMatchObject({ code: "KNOWLEDGE_MAINTENANCE_UNAVAILABLE" });
    expect(registerUpload).not.toHaveBeenCalled();
  });

  it("projects failed candidate state only to the owner", async () => {
    const failedCandidate = versionRecord({
      id: "00000000-0000-4000-8000-000000000050",
      versionStatus: "failed",
      processingStage: "failed",
      stableErrorCode: "KNOWLEDGE_DOCUMENT_STRUCTURE_INVALID",
    });
    const item = {
      document: documentRecord(),
      processingVersion: null,
      failedCandidateVersion: failedCandidate,
    };
    const store = fakeStore({
      findKnowledgeBase: vi.fn(async () => baseRecord()),
      findKnowledgeBaseAccess: vi.fn(async (_id, actorId) =>
        accessRecord({
          knowledgeBase: baseRecord(),
          accessSources:
            actorId === ACTOR.id
              ? [{ type: "owner" }]
              : [
                  {
                    type: "direct_share",
                    grantId: "00000000-0000-4000-8000-000000000051",
                  },
                ],
        }),
      ),
      listDocuments: vi.fn(async () => ({ items: [item], nextCursor: null })),
      hasProcessingDocuments: vi.fn(async () => true),
    });

    const knowledge = service(store);
    const ownerResult = await knowledge.listDocuments(ACTOR, BASE_ID, {
      limit: 50,
    });
    const recipientResult = await knowledge.listDocuments(
      { ...ACTOR, id: "00000000-0000-4000-8000-000000000052" },
      BASE_ID,
      { limit: 50 },
    );

    expect(ownerResult.items[0]?.candidate_failure).toMatchObject({
      stable_error_code: "KNOWLEDGE_DOCUMENT_STRUCTURE_INVALID",
      retryable: true,
    });
    expect(ownerResult.has_processing_documents).toBe(true);
    expect(recipientResult.items[0]?.candidate_failure).toBeNull();
    expect(recipientResult.has_processing_documents).toBe(false);
  });

  it("keeps a ready document searchable when only its chunking provenance differs", async () => {
    const currentEmbeddingProfileHash = "b".repeat(64);
    const listDocuments = vi.fn(async () => ({
      items: [
        {
          document: documentRecord({
            embeddingProfileHash: currentEmbeddingProfileHash,
            chunkingConfigDigest: "a".repeat(64),
          }),
          processingVersion: null,
          failedCandidateVersion: null,
        },
        {
          document: documentRecord({
            id: "00000000-0000-4000-8000-000000000061",
            embeddingProfileHash: "c".repeat(64),
            chunkingConfigDigest: "d".repeat(64),
          }),
          processingVersion: null,
          failedCandidateVersion: null,
        },
      ],
      nextCursor: null,
    }));
    const findKnowledgeBaseAccess = vi.fn(async () => accessRecord());
    const knowledge = service(
      fakeStore({
        findKnowledgeBase: vi.fn(async () => baseRecord()),
        findKnowledgeBaseAccess,
        listDocuments,
      }),
      { currentEmbeddingProfileHash },
    );

    const result = await knowledge.listDocuments(ACTOR, BASE_ID, { limit: 50 });

    expect(result.items[0]).toMatchObject({
      searchable: true,
      rebuild_required: false,
    });
    expect(result.items[1]).toMatchObject({
      searchable: false,
      rebuild_required: true,
    });
    expect(findKnowledgeBaseAccess).toHaveBeenCalledWith(BASE_ID, ACTOR.id, {
      currentEmbeddingProfileHash,
    });
  });

  it("limits an already-authorized application turn to recipient-safe ready documents", async () => {
    const listDocuments = vi.fn(async () => ({
      items: [
        {
          document: documentRecord(),
          processingVersion: null,
          failedCandidateVersion: versionRecord({
            id: "00000000-0000-4000-8000-000000000060",
            versionStatus: "failed",
            processingStage: "failed",
            stableErrorCode: "PRIVATE_OWNER_FAILURE",
          }),
        },
      ],
      nextCursor: null,
    }));
    const knowledge = service(fakeStore({ listDocuments }));

    const result = await knowledge.listDocumentsForAuthorizedApplicationTurn(
      BASE_ID,
      { status: "ready", limit: 25 },
    );

    expect(listDocuments).toHaveBeenCalledWith({
      knowledgeBaseId: BASE_ID,
      includeOwnerOnlyStates: false,
      status: "ready",
      limit: 25,
    });
    expect(result.items[0]?.candidate_failure).toBeNull();
  });

  it("reads parsed content for an authorized application turn only from the current ready version", async () => {
    const getParsedContentChunk = vi.fn(async () => ({
      markdown: "authorized content",
      byteStart: 0,
      byteEnd: 18,
      totalBytes: 18,
      complete: true,
    }));
    const findDocument = vi.fn(async () => ({
      document: documentRecord(),
      processingVersion: null,
      failedCandidateVersion: null,
    }));
    const knowledge = service(fakeStore({ findDocument }), {
      getParsedContentChunk,
    });

    const result =
      await knowledge.getParsedContentChunkForAuthorizedApplicationTurn(
        BASE_ID,
        DOCUMENT_ID,
        VERSION_ID,
        { byteOffset: 0, maxBytes: 4096, verifyIntegrity: true },
      );

    expect(result.markdown).toBe("authorized content");
    expect(getParsedContentChunk).toHaveBeenCalledWith({
      knowledgeBaseId: BASE_ID,
      documentId: DOCUMENT_ID,
      documentVersionId: VERSION_ID,
      byteOffset: 0,
      maxBytes: 4096,
      verifyIntegrity: true,
    });
  });
});

function service(
  store: KnowledgeStore,
  overrides: {
    scheduler?: KnowledgeProcessingScheduler;
    registerUpload?: KnowledgeDocumentIngestionAdapter["registerUpload"];
    discardRegisteredUpload?: KnowledgeDocumentIngestionAdapter["discardRegisteredUpload"];
    getAsset?: KnowledgeDocumentAccessAdapter["getAsset"];
    getParsedContent?: KnowledgeDocumentAccessAdapter["getParsedContent"];
    getParsedContentChunk?: KnowledgeDocumentAccessAdapter["getParsedContentChunk"];
    getOriginal?: KnowledgeDocumentAccessAdapter["getOriginal"];
    assertMaintenanceAvailable?: () => Promise<void>;
    assertDocumentRebuildAvailable?: () => Promise<void>;
    maxFileSizeBytes?: number;
    maxFilesPerBatch?: number;
    storageQuotaBytes?: bigint;
    currentEmbeddingProfileHash?: string;
  } = {},
) {
  return new KnowledgeService({
    store,
    ingestionAdapter: {
      registerUpload:
        overrides.registerUpload ??
        (async (input) => {
          const objectKey = [
            "knowledge-bases",
            input.knowledgeBaseId,
            "documents",
            input.documentId,
            "versions",
            input.documentVersionId,
            "original",
            `${OBJECT_ID}.pdf`,
          ].join("/");
          await input.reserveStorage({
            sizeBytes: 3n,
            objectKeys: [objectKey],
          });
          return {
            original: {
              id: OBJECT_ID,
              objectKey,
              mimeType: "application/pdf",
              sizeBytes: 3n,
              checksumSha256: "a".repeat(64),
            },
            originalFilename: input.filename,
            displayName: input.filename,
            normalizedDisplayName: input.filename.toLocaleLowerCase(),
            canonicalExtension: "pdf",
            canonicalMimeType: "application/pdf",
          };
        }),
      discardRegisteredUpload:
        overrides.discardRegisteredUpload ?? (async () => undefined),
    },
    scheduler: overrides.scheduler ?? {
      enqueue: vi.fn(async () => undefined),
      cancel: vi.fn(async () => undefined),
      runDocumentExclusiveMutation,
      abortActiveDocumentMutations: vi.fn(),
    },
    documentAccessAdapter: {
      getParsedContent:
        overrides.getParsedContent ?? (async () => ({ markdown: "content" })),
      getParsedContentChunk:
        overrides.getParsedContentChunk ??
        (async () => ({
          markdown: "content",
          byteStart: 0,
          byteEnd: 7,
          totalBytes: 7,
          complete: true,
        })),
      getOriginal:
        overrides.getOriginal ??
        (async () => ({
          filename: "manual.pdf",
          mimeType: "application/pdf",
          sizeBytes: 3n,
          stream: Readable.from("pdf"),
        })),
      getAsset:
        overrides.getAsset ??
        (async () => ({
          filename: "asset.png",
          mimeType: "image/png",
          sizeBytes: 3n,
          stream: Readable.from("png"),
        })),
    },
    ...(overrides.assertMaintenanceAvailable === undefined &&
    overrides.assertDocumentRebuildAvailable === undefined
      ? {}
      : {
          maintenanceGate: {
            assertAvailable:
              overrides.assertMaintenanceAvailable ?? (async () => undefined),
            assertDocumentRebuildAvailable:
              overrides.assertDocumentRebuildAvailable ??
              (async () => undefined),
          },
        }),
    ...(overrides.maxFileSizeBytes === undefined
      ? {}
      : { maxFileSizeBytes: overrides.maxFileSizeBytes }),
    ...(overrides.maxFilesPerBatch === undefined
      ? {}
      : { maxFilesPerBatch: overrides.maxFilesPerBatch }),
    ...(overrides.storageQuotaBytes === undefined
      ? {}
      : { storageQuotaBytes: overrides.storageQuotaBytes }),
    ...(overrides.currentEmbeddingProfileHash === undefined
      ? {}
      : {
          currentEmbeddingProfileHash: overrides.currentEmbeddingProfileHash,
        }),
    now: () => NOW,
    createId: (() => {
      let value = 100;
      return () =>
        `00000000-0000-4000-8000-${String(value++).padStart(12, "0")}`;
    })(),
  });
}

function fakeStore(overrides: Partial<KnowledgeStore>): KnowledgeStore {
  const value = { ...overrides } as Partial<KnowledgeStore>;
  value.findDocumentIdAtPath ??= async () => null;
  value.hasProcessingDocuments ??= async () => false;
  value.listKnowledgeBaseApplicationUsages ??= async () => [];
  value.reserveStorage ??= async () => ({ status: "reserved" });
  value.releaseStorageReservation ??= async () => undefined;
  value.transaction = async <T>(work: (store: KnowledgeStore) => Promise<T>) =>
    work(value as KnowledgeStore);
  return value as KnowledgeStore;
}

async function runDocumentExclusiveMutation<T>(
  _documentId: string,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  return operation(new AbortController().signal);
}

function baseRecord(
  overrides: Partial<KnowledgeBaseRecord> = {},
): KnowledgeBaseRecord {
  return {
    id: BASE_ID,
    ownerId: ACTOR.id,
    name: "Manuals",
    description: null,
    sourceType: "local",
    lifecycleStatus: "active",
    availabilityStatus: "enabled",
    storageUsedBytes: 1_024n,
    storageReservedBytes: 128n,
    archivedAt: null,
    archivedBy: null,
    disabledAt: null,
    disabledBy: null,
    disabledReason: null,
    deletedAt: null,
    deletedBy: null,
    deletionReason: null,
    cleanupStatus: "completed",
    cleanupErrorCode: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function accessRecord(
  overrides: Partial<KnowledgeBaseAccessRecord> = {},
): KnowledgeBaseAccessRecord {
  return {
    knowledgeBase: baseRecord(),
    owner: { id: ACTOR.id, name: "Owner" },
    accessSources: [{ type: "owner" }],
    documentCount: 1,
    searchableDocumentCount: 1,
    ...overrides,
  };
}

function grantFixture(
  overrides: Partial<KnowledgeBaseGrantRecord> = {},
): KnowledgeBaseGrantRecord {
  return {
    id: GRANT_ID,
    knowledgeBaseId: BASE_ID,
    granteeType: "user",
    userId: GRANT_TARGET_ID,
    userGroupId: null,
    permission: "use",
    status: "active",
    grantedBy: ACTOR.id,
    revokedBy: null,
    revokedAt: null,
    revocationReason: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function grantViewFixture(
  overrides: Partial<KnowledgeBaseGrantViewRecord> = {},
): KnowledgeBaseGrantViewRecord {
  return {
    ...grantFixture(overrides),
    targetName: "Recipient",
    targetEmail: "recipient@example.test",
    ...overrides,
  };
}

function documentRecord(
  overrides: Partial<KnowledgeDocumentRecord> = {},
): KnowledgeDocumentRecord {
  return {
    id: DOCUMENT_ID,
    knowledgeBaseId: BASE_ID,
    displayName: "manual.pdf",
    normalizedDisplayName: "manual.pdf",
    canonicalExtension: "pdf",
    mimeType: "application/pdf",
    sizeBytes: 3n,
    originalSha256: "a".repeat(64),
    status: "ready",
    currentVersionId: VERSION_ID,
    candidateVersionId: null,
    activeProcessingVersionId: null,
    embeddingProfileHash: null,
    chunkingConfigDigest: null,
    retrievalManifestSha256: null,
    indexIntegrityDigest: null,
    stableErrorCode: null,
    cleanupStatus: "completed",
    cleanupErrorCode: null,
    deletedAt: null,
    deletedBy: null,
    deletionReason: null,
    createdBy: ACTOR.id,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function versionRecord(
  overrides: Partial<KnowledgeDocumentVersionRecord> = {},
): KnowledgeDocumentVersionRecord {
  return {
    id: VERSION_ID,
    knowledgeBaseId: BASE_ID,
    documentId: DOCUMENT_ID,
    sourceVersionId: null,
    versionNumber: 1,
    versionStatus: "ready",
    operationType: "upload",
    processingGeneration: "00000000-0000-4000-8000-000000000020",
    processingStage: "completed",
    progressPercent: 100,
    processingRevision: 10n,
    stageAttemptCount: 0,
    stableErrorCode: null,
    stableErrorParamsJson: null,
    failedStage: null,
    retryAt: null,
    cancelRequestedAt: null,
    cancelRequestedBy: null,
    cancelReason: null,
    originalFilename: "manual.pdf",
    canonicalExtension: "pdf",
    mimeType: "application/pdf",
    sizeBytes: 3n,
    originalSha256: "a".repeat(64),
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
    processingConfigJson: {},
    processingConfigDigest: null,
    embeddingProfileHash: null,
    indexReady: true,
    indexIntegrityDigest: null,
    activationPreviousCurrentVersionId: null,
    parentCount: null,
    childCount: null,
    startedAt: null,
    completedAt: null,
    supersededAt: null,
    cleanupEligibleAt: null,
    createdBy: ACTOR.id,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}
