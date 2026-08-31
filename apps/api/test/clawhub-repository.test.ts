import { describe, expect, it, vi } from "vitest";

import type { PrismaClient } from "../src/generated/prisma/client.js";
import {
  PrismaClawHubStore,
  type ClawHubSkillSyncRecord,
} from "../src/modules/clawhub/repository.js";

const RUN_ID = "10000000-0000-4000-8000-000000000001";
const SKILL_ID = "10000000-0000-4000-8000-000000000002";
const CAPABILITY_ID = "10000000-0000-4000-8000-000000000003";
const USER_ID = "10000000-0000-4000-8000-000000000004";
const NOW = new Date("2026-08-07T00:00:00.000Z");

describe("PrismaClawHubStore", () => {
  it("writes each publisher-qualified record to staging and the visible catalog atomically", async () => {
    const stageUpsert = vi.fn(async () => undefined);
    const visibleUpsert = vi.fn();
    const lockRun = vi.fn<
      (query: unknown) => Promise<Array<{ id: string }>>
    >(async () => [{ id: RUN_ID }]);
    const transaction = {
      $queryRaw: lockRun,
      clawHubSkillSyncStaging: { upsert: stageUpsert },
      clawHubSkill: { upsert: visibleUpsert },
    };
    const store = new PrismaClawHubStore({
      $transaction: vi.fn(async (work) => work(transaction)),
    } as unknown as PrismaClient);

    await store.stageSkill(RUN_ID, NOW, syncRecord());

    expect(stageUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          runId_ownerHandle_slug: {
            runId: RUN_ID,
            ownerHandle: "alice",
            slug: "shared-slug",
          },
        },
        create: expect.objectContaining({
          runId: RUN_ID,
          ownerHandle: "alice",
          slug: "shared-slug",
          installBlockReason: null,
          seenAt: NOW,
          stagedAt: NOW,
        }),
      }),
    );
    const lockQuery = lockRun.mock.calls[0]?.[0] as
      | { strings?: readonly string[]; values?: readonly unknown[] }
      | undefined;
    expect(lockQuery?.strings?.join(" ")).toContain("FOR SHARE");
    expect(lockQuery?.values).toEqual([RUN_ID]);
    expect(visibleUpsert).toHaveBeenCalledWith({
      where: {
        ownerHandle_slug: {
          ownerHandle: "alice",
          slug: "shared-slug",
        },
      },
      create: expect.objectContaining({
        ownerHandle: "alice",
        slug: "shared-slug",
        available: true,
        unavailableAt: null,
        lastSeenSyncRunId: RUN_ID,
        lastSeenAt: NOW,
      }),
      update: expect.objectContaining({
        ownerHandle: "alice",
        slug: "shared-slug",
        available: true,
        unavailableAt: null,
        lastSeenSyncRunId: RUN_ID,
        lastSeenAt: NOW,
      }),
    });
  });

  it("rejects late staging writes after the run is no longer running", async () => {
    const stageUpsert = vi.fn();
    const transaction = {
      $queryRaw: vi.fn(async () => []),
      clawHubSkillSyncStaging: { upsert: stageUpsert },
    };
    const store = new PrismaClawHubStore({
      $transaction: vi.fn(async (work) => work(transaction)),
    } as unknown as PrismaClient);

    await expect(
      store.stageSkill(RUN_ID, NOW, syncRecord()),
    ).rejects.toThrow("clawhub_sync_run_not_running");
    expect(stageUpsert).not.toHaveBeenCalled();
  });

  it("finalizes availability only after a complete run and clears staging", async () => {
    const lockRun = vi.fn(async () => [{ id: RUN_ID }]);
    const countStaging = vi.fn(async () => 12);
    const updateSkills = vi.fn(async () => ({ count: 2 }));
    const updateRun = vi.fn(async () => ({ count: 1 }));
    const clearStaging = vi.fn<(query: unknown) => Promise<number>>(
      async () => 12,
    );
    const transaction = {
      $queryRaw: lockRun,
      $executeRaw: clearStaging,
      clawHubSkill: { updateMany: updateSkills },
      clawHubSyncRun: { updateMany: updateRun },
      clawHubSkillSyncStaging: {
        count: countStaging,
      },
    };
    const runTransaction = vi.fn(async (work) => work(transaction));
    const prisma = {
      $transaction: runTransaction,
    } as unknown as PrismaClient;
    const store = new PrismaClawHubStore(prisma, {
      transactionTimeoutMs: 600_000,
    });

    await expect(
      store.publishSyncRun({
        runId: RUN_ID,
        listedCount: 12,
        detailCount: 12,
        finishedAt: NOW,
      }),
    ).resolves.toBe(2);
    expect(runTransaction).toHaveBeenCalledWith(expect.any(Function), {
      maxWait: 30_000,
      timeout: 600_000,
    });
    expect(countStaging).toHaveBeenCalledWith({ where: { runId: RUN_ID } });
    expect(updateSkills).toHaveBeenCalledWith({
      where: { available: true, lastSeenSyncRunId: { not: RUN_ID } },
      data: { available: false, unavailableAt: NOW },
    });
    expect(updateRun).toHaveBeenCalledWith({
      where: { id: RUN_ID, status: "running" },
      data: {
        status: "succeeded",
        listedCount: 12,
        detailCount: 12,
        unavailableCount: 2,
        errorCode: null,
        finishedAt: NOW,
      },
    });
    const clearQuery = clearStaging.mock.calls[0]?.[0] as
      | { strings?: readonly string[]; values?: readonly unknown[] }
      | undefined;
    expect(clearQuery?.strings?.join(" ")).toContain(
      'DELETE FROM "clawhub_skill_sync_staging"',
    );
    expect(clearQuery?.values).toEqual([RUN_ID]);
  });

  it("rejects an empty upstream snapshot when a formal catalog already exists", async () => {
    const updateSkills = vi.fn();
    const updateRun = vi.fn();
    const clearStaging = vi.fn<(query: unknown) => Promise<number>>();
    const countCatalog = vi.fn(async () => 1);
    const transaction = {
      $queryRaw: vi.fn(async () => [{ id: RUN_ID }]),
      $executeRaw: clearStaging,
      clawHubSkill: { count: countCatalog, updateMany: updateSkills },
      clawHubSyncRun: { updateMany: updateRun },
      clawHubSkillSyncStaging: {
        count: vi.fn(async () => 0),
      },
    };
    const store = new PrismaClawHubStore({
      $transaction: vi.fn(async (work) => work(transaction)),
    } as unknown as PrismaClient);

    await expect(
      store.publishSyncRun({
        runId: RUN_ID,
        listedCount: 0,
        detailCount: 0,
        finishedAt: NOW,
      }),
    ).rejects.toThrow("clawhub_sync_empty_snapshot");

    expect(countCatalog).toHaveBeenCalledOnce();
    expect(updateSkills).not.toHaveBeenCalled();
    expect(updateRun).not.toHaveBeenCalled();
    expect(clearStaging).not.toHaveBeenCalled();
  });

  it("allows an empty first snapshot when no formal catalog exists yet", async () => {
    const updateSkills = vi.fn(async () => ({ count: 0 }));
    const updateRun = vi.fn(async () => ({ count: 1 }));
    const clearStaging = vi.fn<(query: unknown) => Promise<number>>(
      async () => 0,
    );
    const transaction = {
      $queryRaw: vi.fn(async () => [{ id: RUN_ID }]),
      $executeRaw: clearStaging,
      clawHubSkill: { count: vi.fn(async () => 0), updateMany: updateSkills },
      clawHubSyncRun: { updateMany: updateRun },
      clawHubSkillSyncStaging: {
        count: vi.fn(async () => 0),
      },
    };
    const store = new PrismaClawHubStore({
      $transaction: vi.fn(async (work) => work(transaction)),
    } as unknown as PrismaClient);

    await expect(
      store.publishSyncRun({
        runId: RUN_ID,
        listedCount: 0,
        detailCount: 0,
        finishedAt: NOW,
      }),
    ).resolves.toBe(0);

    expect(updateSkills).toHaveBeenCalledOnce();
    expect(updateRun).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "succeeded" }),
      }),
    );
    expect(clearStaging).toHaveBeenCalledOnce();
  });

  it("marks a failed run and clears staging without hiding incrementally visible records", async () => {
    const updateSkills = vi.fn();
    const updateRun = vi.fn(async () => ({ count: 1 }));
    const clearStaging = vi.fn<(query: unknown) => Promise<number>>(
      async () => 3,
    );
    const transaction = {
      $queryRaw: vi.fn(async () => [{ id: RUN_ID, status: "running" }]),
      $executeRaw: clearStaging,
      clawHubSkill: { updateMany: updateSkills },
      clawHubSyncRun: { updateMany: updateRun },
    };
    const store = new PrismaClawHubStore({
      $transaction: vi.fn(async (work) => work(transaction)),
    } as unknown as PrismaClient);

    await store.failSyncRun({
      runId: RUN_ID,
      listedCount: 3,
      detailCount: 2,
      errorCode: "upstream_failed",
      finishedAt: NOW,
    });
    expect(updateSkills).not.toHaveBeenCalled();
    expect(updateRun).toHaveBeenCalledWith({
      where: { id: RUN_ID, status: "running" },
      data: {
        status: "failed",
        listedCount: 3,
        detailCount: 2,
        errorCode: "upstream_failed",
        finishedAt: NOW,
      },
    });
    expect(clearStaging).toHaveBeenCalledOnce();
    const clearQuery = clearStaging.mock.calls[0]?.[0] as
      | { strings?: readonly string[]; values?: readonly unknown[] }
      | undefined;
    expect(clearQuery?.values).toEqual([RUN_ID]);
  });

  it("recovers interrupted runs by clearing only their staging rows", async () => {
    const secondRunId = "10000000-0000-4000-8000-000000000099";
    const clearStaging = vi.fn<(query: unknown) => Promise<number>>(
      async () => 2,
    );
    const updateRuns = vi.fn(async () => ({ count: 2 }));
    const transaction = {
      $queryRaw: vi.fn(async () => [{ id: RUN_ID }, { id: secondRunId }]),
      $executeRaw: clearStaging,
      clawHubSyncRun: { updateMany: updateRuns },
      clawHubSkill: { updateMany: vi.fn() },
    };
    const store = new PrismaClawHubStore({
      $transaction: vi.fn(async (work) => work(transaction)),
    } as unknown as PrismaClient);

    await expect(store.recoverInterruptedRuns(NOW)).resolves.toBe(2);
    expect(clearStaging).toHaveBeenCalledTimes(2);
    expect(
      clearStaging.mock.calls.map(
        ([query]) =>
          (query as { values?: readonly unknown[] }).values?.[0],
      ),
    ).toEqual([RUN_ID, secondRunId]);
    expect(updateRuns).toHaveBeenCalledWith({
      where: { id: { in: [RUN_ID, secondRunId] }, status: "running" },
      data: { status: "failed", errorCode: "interrupted", finishedAt: NOW },
    });
    expect(transaction.clawHubSkill.updateMany).not.toHaveBeenCalled();
  });

  it("searches the local catalog, joins only the actor installation, and returns an opaque cursor", async () => {
    const rows = [
      skillRow({ installBlockReason: "manifest_unsafe" }),
      skillRow({
        id: "10000000-0000-4000-8000-000000000099",
        ownerHandle: "bob",
        slug: "second",
        downloadCount: 10,
      }),
    ];
    const findManySkills = vi.fn(async () => rows);
    const countSkills = vi.fn(async () => 2);
    const findManyInstallations = vi.fn(async () => [installationRow()]);
    const store = new PrismaClawHubStore({
      clawHubSkill: { findMany: findManySkills, count: countSkills },
      clawHubSkillInstallation: { findMany: findManyInstallations },
    } as unknown as PrismaClient);

    const page = await store.listCatalog({
      userId: USER_ID,
      search: "agent",
      sort: "downloads",
      limit: 1,
    });

    expect(findManySkills).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          available: true,
          searchText: { contains: "agent", mode: "insensitive" },
        }),
        orderBy: [
          { downloadCount: "desc" },
          { slug: "asc" },
          { ownerHandle: "asc" },
          { id: "asc" },
        ],
        take: 2,
      }),
    );
    expect(countSkills).toHaveBeenCalledWith({
      where: {
        available: true,
        searchText: { contains: "agent", mode: "insensitive" },
      },
    });
    expect(findManyInstallations).toHaveBeenCalledWith({
      where: { userId: USER_ID, clawHubSkillId: { in: [SKILL_ID] } },
    });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.skill.installBlockReason).toBe("manifest_unsafe");
    expect(page.items[0]?.installation?.capabilityId).toBe(CAPABILITY_ID);
    expect(page.totalCount).toBe(2);
    expect(page.nextCursor).toEqual(expect.any(String));
  });

  it("sorts by stars with a sort-bound keyset cursor", async () => {
    const rows = [
      skillRow({ starCount: 50 }),
      skillRow({
        id: "10000000-0000-4000-8000-000000000099",
        ownerHandle: "bob",
        slug: "second",
        starCount: 20,
      }),
    ];
    const findManySkills = vi
      .fn()
      .mockResolvedValueOnce(rows)
      .mockResolvedValueOnce([]);
    const store = new PrismaClawHubStore({
      clawHubSkill: {
        findMany: findManySkills,
        count: vi.fn(async () => 2),
      },
      clawHubSkillInstallation: { findMany: vi.fn(async () => []) },
    } as unknown as PrismaClient);

    const firstPage = await store.listCatalog({
      userId: USER_ID,
      sort: "stars",
      limit: 1,
    });

    expect(findManySkills).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        orderBy: [
          { starCount: "desc" },
          { slug: "asc" },
          { ownerHandle: "asc" },
          { id: "asc" },
        ],
      }),
    );
    expect(firstPage.nextCursor).toEqual(expect.any(String));
    const nextCursor = firstPage.nextCursor;
    if (!nextCursor) throw new Error("Expected a second catalog page");

    await store.listCatalog({
      userId: USER_ID,
      sort: "stars",
      cursor: nextCursor,
      limit: 1,
    });
    expect(findManySkills).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({
          AND: [
            expect.objectContaining({
              OR: expect.arrayContaining([
                { starCount: { lt: 50 } },
                {
                  starCount: 50,
                  slug: { gt: "shared-slug" },
                },
              ]),
            }),
          ],
        }),
      }),
    );
    await expect(
      store.listCatalog({
        userId: USER_ID,
        sort: "downloads",
        cursor: nextCursor,
        limit: 1,
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("rejects malformed cursors before querying Prisma", async () => {
    const findMany = vi.fn();
    const store = new PrismaClawHubStore({
      clawHubSkill: { findMany },
    } as unknown as PrismaClient);

    await expect(
      store.listCatalog({
        userId: USER_ID,
        sort: "downloads",
        cursor: "not-a-cursor",
        limit: 20,
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    const forgedCursor = Buffer.from(
      JSON.stringify({
        sort: "downloads",
        value: 10,
        slug: "skill",
        ownerHandle: "owner",
        id: "not-a-uuid",
      }),
      "utf8",
    ).toString("base64url");
    await expect(
      store.listCatalog({
        userId: USER_ID,
        sort: "downloads",
        cursor: forgedCursor,
        limit: 20,
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(findMany).not.toHaveBeenCalled();
  });
});

function syncRecord(): ClawHubSkillSyncRecord {
  return {
    ownerHandle: "alice",
    slug: "shared-slug",
    displayName: "Shared Skill",
    summary: "A useful agent skill",
    topics: ["agents"],
    tags: { latest: "1.2.3" },
    downloadCount: 100,
    installCount: 20,
    starCount: 10,
    commentCount: 2,
    versionCount: 3,
    latestVersion: "1.2.3",
    latestVersionCreatedAt: NOW,
    latestVersionChangelog: "Improved",
    latestVersionLicense: "MIT",
    ownerDisplayName: "Alice",
    ownerImageUrl: "https://example.com/alice.png",
    metadata: { os: ["darwin"] },
    sourceMetadata: {
      package: { ownerHandle: "alice", name: "shared-slug" },
      detail: { slug: "shared-slug" },
      version: { version: "1.2.3", files: [] },
    },
    moderationVerdict: "clean",
    moderationReasonCodes: [],
    moderationSummary: null,
    moderationEngineVersion: "1",
    moderationUpdatedAt: NOW,
    isSuspicious: false,
    isMalwareBlocked: false,
    securityStatus: "clean",
    securityHasWarnings: false,
    securityCheckedAt: NOW,
    fileCount: 2,
    totalFileBytes: 321,
    installBlockReason: null,
    canonicalUrl: "https://clawhub.ai/alice/skills/shared-slug",
    searchText: "shared skill alice agents",
    sourceCreatedAt: NOW,
    sourceUpdatedAt: NOW,
  };
}

function skillRow(overrides: Record<string, unknown> = {}) {
  const input = syncRecord();
  return {
    id: SKILL_ID,
    ownerHandle: input.ownerHandle,
    slug: input.slug,
    displayName: input.displayName,
    summary: input.summary,
    topicsJson: input.topics,
    tagsJson: input.tags,
    downloadCount: input.downloadCount,
    installCount: input.installCount,
    starCount: input.starCount,
    commentCount: input.commentCount,
    versionCount: input.versionCount,
    latestVersion: input.latestVersion,
    latestVersionCreatedAt: input.latestVersionCreatedAt,
    latestVersionChangelog: input.latestVersionChangelog,
    latestVersionLicense: input.latestVersionLicense,
    ownerDisplayName: input.ownerDisplayName,
    ownerImageUrl: input.ownerImageUrl,
    metadataJson: input.metadata,
    sourceMetadataJson: input.sourceMetadata,
    moderationVerdict: input.moderationVerdict,
    moderationReasonCodesJson: input.moderationReasonCodes,
    moderationSummary: input.moderationSummary,
    moderationEngineVersion: input.moderationEngineVersion,
    moderationUpdatedAt: input.moderationUpdatedAt,
    isSuspicious: input.isSuspicious,
    isMalwareBlocked: input.isMalwareBlocked,
    securityStatus: input.securityStatus,
    securityHasWarnings: input.securityHasWarnings,
    securityCheckedAt: input.securityCheckedAt,
    fileCount: input.fileCount,
    totalFileBytes: BigInt(input.totalFileBytes),
    installBlockReason: input.installBlockReason,
    canonicalUrl: input.canonicalUrl,
    searchText: input.searchText,
    sourceCreatedAt: input.sourceCreatedAt,
    sourceUpdatedAt: input.sourceUpdatedAt,
    available: true,
    unavailableAt: null,
    lastSeenSyncRunId: RUN_ID,
    lastSeenAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function installationRow() {
  return {
    id: "10000000-0000-4000-8000-000000000005",
    userId: USER_ID,
    clawHubSkillId: SKILL_ID,
    capabilityId: CAPABILITY_ID,
    installedVersion: "1.2.3",
    sourceSecurityStatus: "clean",
    sourceSecurityHasWarnings: false,
    contentSha256: "a".repeat(64),
    createdAt: NOW,
    updatedAt: NOW,
  };
}
