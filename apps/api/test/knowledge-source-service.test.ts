import { describe, expect, it, vi } from "vitest";

import type { PrismaClient } from "../src/generated/prisma/client.js";
import {
  KnowledgeSourceService,
  isDescendantOf,
  knowledgeEntryPath,
  shouldRetrySourceDocument,
  sourceRelativePath,
} from "../src/modules/knowledge-sources/service.js";
import { SharePointDeltaCursorExpiredError } from "../src/modules/knowledge-sources/sharepoint-graph.js";

const sourceScheduleRecord = {
  syncFrequency: "daily",
  syncTimeOfDayMinutes: 540,
  syncTimeZone: "Asia/Shanghai",
  syncWeekday: null,
  syncDayOfMonth: null,
  createdAt: new Date("2026-08-12T00:00:00.000Z"),
};

describe("knowledge source scope resolution", () => {
  it("keeps every nested file under the selected stable folder id and excludes siblings", () => {
    const records = [
      { externalItemId: "root", parentExternalItemId: "drive" },
      { externalItemId: "team-a", parentExternalItemId: "root" },
      { externalItemId: "resume", parentExternalItemId: "team-a" },
      { externalItemId: "photo-1", parentExternalItemId: "resume" },
      { externalItemId: "photo-2", parentExternalItemId: "resume" },
      { externalItemId: "other-team", parentExternalItemId: "drive" },
      { externalItemId: "private", parentExternalItemId: "other-team" },
    ];
    const byId = new Map(records.map((item) => [item.externalItemId, item]));

    expect(isDescendantOf(byId.get("photo-1")!, "root", byId)).toBe(true);
    expect(isDescendantOf(byId.get("photo-2")!, "root", byId)).toBe(true);
    expect(isDescendantOf(byId.get("private")!, "root", byId)).toBe(false);
  });

  it("fails closed for broken and cyclic parent chains", () => {
    const records = [
      { externalItemId: "a", parentExternalItemId: "b" },
      { externalItemId: "b", parentExternalItemId: "a" },
      { externalItemId: "orphan", parentExternalItemId: "missing" },
    ];
    const byId = new Map(records.map((item) => [item.externalItemId, item]));
    expect(isDescendantOf(byId.get("a")!, "root", byId)).toBe(false);
    expect(isDescendantOf(byId.get("orphan")!, "root", byId)).toBe(false);
  });

  it("projects the selected SharePoint folder and all ancestors into one relative path", () => {
    const records = [
      {
        externalItemId: "department",
        parentExternalItemId: "root",
        name: "Department",
        deletedAt: null,
      },
      {
        externalItemId: "policy",
        parentExternalItemId: "department",
        name: "Policy",
        deletedAt: null,
      },
      {
        externalItemId: "manual",
        parentExternalItemId: "policy",
        name: "manual.pdf",
        deletedAt: null,
      },
    ];
    const byId = new Map(records.map((item) => [item.externalItemId, item]));

    expect(
      sourceRelativePath(byId.get("manual")!, "root", "Shared", byId),
    ).toBe("Shared/Department/Policy/manual.pdf");
    expect(
      sourceRelativePath(
        { ...byId.get("manual")!, parentExternalItemId: "outside" },
        "root",
        "Shared",
        byId,
      ),
    ).toBeNull();
  });

  it("reconstructs a projected directory path and fails closed on cycles", () => {
    const entries = [
      { id: "root", parentEntryId: null, name: "Shared" },
      { id: "policy", parentEntryId: "root", name: "Policy" },
      { id: "manual", parentEntryId: "policy", name: "manual.pdf" },
    ];
    const byId = new Map(entries.map((entry) => [entry.id, entry]));
    expect(knowledgeEntryPath(byId.get("manual")!, byId)).toBe(
      "Shared/Policy/manual.pdf",
    );
    expect(
      knowledgeEntryPath(
        { id: "a", parentEntryId: "a", name: "cycle" },
        new Map([["a", { id: "a", parentEntryId: "a", name: "cycle" }]]),
      ),
    ).toBeNull();
  });

  it("rejects SharePoint creation before touching credentials for a regular user", async () => {
    const resolveRuntime = vi.fn();
    const service = new KnowledgeSourceService(
      {} as PrismaClient,
      { resolveRuntime } as never,
      { create: vi.fn() },
      {} as never,
      { enqueue: vi.fn() },
    );

    await expect(
      service.createSharePointKnowledgeBase(
        { id: "user-1", role: "user", status: "active" },
        {
          name: "Finance",
          folderUrl:
            "https://contoso.sharepoint.com/sites/Finance/Shared%20Documents",
          schedule: {
            frequency: "daily",
            time: "09:00",
            time_zone: "Asia/Shanghai",
          },
        },
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(resolveRuntime).not.toHaveBeenCalled();
  });

  it("persists a normalized calendar schedule and starts the initial sync immediately", async () => {
    const now = new Date("2026-08-12T02:00:00.000Z");
    const knowledgeBaseId = "00000000-0000-4000-8000-000000000051";
    const sourceId = "00000000-0000-4000-8000-000000000052";
    const createSource = vi.fn(
      async (input: { data: Record<string, unknown> }) => {
        void input;
        return {};
      },
    );
    const transaction = {
      knowledgeBase: { create: vi.fn(async () => ({})) },
      knowledgeBaseSource: { create: createSource },
      auditLog: { create: vi.fn(async () => ({})) },
    };
    const prisma = {
      $transaction: vi.fn(
        async (callback: (client: typeof transaction) => Promise<unknown>) =>
          callback(transaction),
      ),
    } as unknown as PrismaClient;
    const resolveRuntime = vi.fn(async () => ({}));
    const enqueue = vi.fn(async () => undefined);
    const getKnowledgeBase = vi.fn(async () => ({ id: knowledgeBaseId }));
    const createId = vi
      .fn<() => string>()
      .mockReturnValueOnce(knowledgeBaseId)
      .mockReturnValueOnce(sourceId);
    const service = new KnowledgeSourceService(
      prisma,
      { resolveRuntime } as never,
      {
        create: vi.fn(async () => ({
          resolveFolder: vi.fn(async () => ({
            sourceUrl:
              "https://contoso.sharepoint.com/sites/Finance/Documents/Policies",
            siteId: "site-1",
            driveId: "drive-1",
            rootItemId: "root-1",
            siteName: "Finance",
            driveName: "Documents",
            folderName: "Policies",
          })),
        })),
      } as never,
      { getKnowledgeBase } as never,
      { enqueue },
      () => now,
      createId,
    );

    await service.createSharePointKnowledgeBase(
      { id: "admin-1", role: "admin", status: "active" },
      {
        name: "Policies",
        folderUrl:
          "https://contoso.sharepoint.com/sites/Finance/Documents/Policies",
        schedule: {
          frequency: "weekly",
          weekday: 3,
          time: "14:35",
          time_zone: "Asia/Shanghai",
        },
      },
    );

    expect(createSource).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: sourceId,
        knowledgeBaseId,
        syncFrequency: "weekly",
        syncTimeOfDayMinutes: 875,
        syncTimeZone: "Asia/Shanghai",
        syncWeekday: 3,
        syncDayOfMonth: null,
        nextSyncAt: new Date("2026-08-12T06:35:00.000Z"),
      }),
    });
    expect(createSource.mock.calls[0]?.[0].data).not.toHaveProperty(
      "syncIntervalMinutes",
    );
    expect(enqueue).toHaveBeenCalledWith(sourceId, "initial");
    expect(getKnowledgeBase).toHaveBeenCalledWith(
      expect.objectContaining({ id: "admin-1" }),
      knowledgeBaseId,
    );
  });

  it("rejects an unknown synchronization time zone before reading credentials", async () => {
    const resolveRuntime = vi.fn();
    const service = new KnowledgeSourceService(
      {} as PrismaClient,
      { resolveRuntime } as never,
      { create: vi.fn() },
      {} as never,
      { enqueue: vi.fn() },
    );

    await expect(
      service.createSharePointKnowledgeBase(
        { id: "admin-1", role: "admin", status: "active" },
        {
          name: "Finance",
          folderUrl:
            "https://contoso.sharepoint.com/sites/Finance/Shared%20Documents",
          schedule: {
            frequency: "daily",
            time: "09:00",
            time_zone: "Not/A-Time-Zone",
          },
        },
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(resolveRuntime).not.toHaveBeenCalled();
  });

  it("projects the structured synchronization schedule without legacy interval fields", async () => {
    const source = {
      id: "00000000-0000-4000-8000-000000000061",
      knowledgeBaseId: "00000000-0000-4000-8000-000000000062",
      provider: "sharepoint",
      sourceUrl:
        "https://contoso.sharepoint.com/sites/Finance/Documents/Policies",
      siteName: "Finance",
      driveName: "Documents",
      folderName: "Policies",
      syncFrequency: "monthly",
      syncTimeOfDayMinutes: 875,
      syncTimeZone: "Asia/Shanghai",
      syncWeekday: null,
      syncDayOfMonth: 31,
      syncStatus: "ready",
      stableErrorCode: null,
      lastSyncedAt: new Date("2026-08-12T01:00:00.000Z"),
      nextSyncAt: new Date("2026-08-31T06:35:00.000Z"),
      createdAt: new Date("2026-08-12T00:00:00.000Z"),
      updatedAt: new Date("2026-08-12T01:00:00.000Z"),
    };
    const service = new KnowledgeSourceService(
      {
        knowledgeBaseSource: { findUnique: vi.fn(async () => source) },
        knowledgeSourceSyncRun: {
          findFirst: vi.fn(async () => ({
            id: "00000000-0000-4000-8000-000000000063",
            triggerType: "manual",
            status: "completed",
            phase: "completed",
            failurePhase: null,
            retryOfRunId: null,
            scannedCount: 4,
            totalCount: 4,
            processedCount: 4,
            createdCount: 1,
            updatedCount: 1,
            deletedCount: 0,
            skippedCount: 2,
            retriedCount: 0,
            failedCount: 0,
            startedAt: new Date("2026-08-12T00:55:00.000Z"),
            updatedAt: new Date("2026-08-12T01:00:00.000Z"),
            completedAt: new Date("2026-08-12T01:00:00.000Z"),
          })),
        },
      } as unknown as PrismaClient,
      {} as never,
      { create: vi.fn() },
      {} as never,
      { enqueue: vi.fn() },
    );

    const projected = await service.getSource(
      { id: "admin-1", role: "admin", status: "active" },
      source.knowledgeBaseId,
    );

    expect(projected.sync_schedule).toEqual({
      frequency: "monthly",
      day_of_month: 31,
      time: "14:35",
      time_zone: "Asia/Shanghai",
    });
    expect(projected).not.toHaveProperty("sync_interval_minutes");
    expect(projected).toMatchObject({
      retry_available: false,
      sync_progress: {
        status: "completed",
        phase: "completed",
        processed_count: 4,
        total_count: 4,
        progress_percent: 100,
      },
    });
    expect(projected.sync_progress).not.toHaveProperty("scan_cursor");
  });

  it("leaves expired synchronization recovery to the runtime before starting another worker", async () => {
    const createGraph = vi.fn();
    const source = {
      id: "00000000-0000-4000-8000-000000000001",
      knowledgeBaseId: "00000000-0000-4000-8000-000000000002",
      ...sourceScheduleRecord,
    };
    const claimSource = vi.fn(async () => ({ count: 0 }));
    const transaction = {
      knowledgeBaseSource: {
        updateMany: claimSource,
      },
      knowledgeSourceSyncRun: { create: vi.fn() },
    };
    const prisma = {
      knowledgeBaseSource: { findUnique: vi.fn(async () => source) },
      knowledgeBase: {
        findUnique: vi.fn(async () => ({
          ownerId: "00000000-0000-4000-8000-000000000003",
          lifecycleStatus: "active",
          availabilityStatus: "enabled",
        })),
      },
      $transaction: vi.fn(
        async (callback: (client: typeof transaction) => Promise<unknown>) =>
          callback(transaction),
      ),
    } as unknown as PrismaClient;
    const service = new KnowledgeSourceService(
      prisma,
      {} as never,
      { create: createGraph },
      {} as never,
      { enqueue: vi.fn() },
    );

    await expect(
      service.processSync(source.id, "scheduled"),
    ).resolves.toBeUndefined();
    expect(transaction.knowledgeSourceSyncRun.create).not.toHaveBeenCalled();
    expect(createGraph).not.toHaveBeenCalled();
    expect(claimSource).toHaveBeenCalledWith({
      where: {
        id: source.id,
        syncStatus: { not: "syncing" },
      },
      data: {
        syncStatus: "syncing",
        stableErrorCode: null,
        syncLeaseExpiresAt: expect.any(Date),
      },
    });
  });

  it("persists the next Graph page and resumes scanning from that checkpoint", async () => {
    const checkpoint = {
      scanBaseCursor: "https://graph.microsoft.com/delta/base",
      scanCursor: "https://graph.microsoft.com/delta/base",
    };
    const updateRun = vi.fn(
      async ({ data }: { data: Record<string, unknown> }) => {
        if ("scanCursor" in data) {
          checkpoint.scanCursor = String(data.scanCursor);
        }
        return {};
      },
    );
    const transaction = {
      knowledgeSourceItem: {
        findUnique: vi.fn(async () => null),
        upsert: vi.fn(async () => ({})),
      },
      knowledgeSourceSyncRun: { update: updateRun },
      knowledgeBaseSource: {
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
    };
    const prisma = {
      knowledgeSourceSyncRun: {
        findUnique: vi.fn(async () => ({ ...checkpoint })),
        update: updateRun,
      },
      $transaction: vi.fn(
        async (work: (client: typeof transaction) => Promise<unknown>) =>
          work(transaction),
      ),
    } as unknown as PrismaClient;
    const service = new KnowledgeSourceService(
      prisma,
      {} as never,
      { create: vi.fn() },
      {} as never,
      { enqueue: vi.fn() },
    );
    const source = {
      id: "00000000-0000-4000-8000-000000000071",
      driveId: "drive-1",
      rootItemId: "root-1",
      deltaLink: checkpoint.scanBaseCursor,
    };
    const firstGraph = {
      getDeltaPage: vi
        .fn()
        .mockResolvedValueOnce({
          items: [],
          nextLink: "https://graph.microsoft.com/delta/page-2",
          deltaLink: null,
        })
        .mockRejectedValueOnce(new Error("transient graph failure")),
    };
    const applyDelta = (
      service as unknown as {
        applyDelta(
          input: typeof source,
          graph: typeof firstGraph,
          runId: string,
        ): Promise<string | null>;
      }
    ).applyDelta.bind(service);

    await expect(applyDelta(source, firstGraph, "run-1")).rejects.toThrow();
    expect(firstGraph.getDeltaPage).toHaveBeenNthCalledWith(
      2,
      source.driveId,
      source.rootItemId,
      "https://graph.microsoft.com/delta/page-2",
    );
    expect(checkpoint.scanCursor).toBe(
      "https://graph.microsoft.com/delta/page-2",
    );

    const resumedGraph = {
      getDeltaPage: vi.fn(async () => ({
        items: [],
        nextLink: null,
        deltaLink: "https://graph.microsoft.com/delta/complete",
      })),
    };
    await expect(
      applyDelta(source, resumedGraph, "run-2"),
    ).resolves.toBe("https://graph.microsoft.com/delta/complete");
    expect(resumedGraph.getDeltaPage).toHaveBeenCalledTimes(1);
    expect(resumedGraph.getDeltaPage).toHaveBeenCalledWith(
      source.driveId,
      source.rootItemId,
      "https://graph.microsoft.com/delta/page-2",
    );
  });

  it("falls back to a root scan when an initial-scan page checkpoint expires", async () => {
    const checkpoint = {
      scanBaseCursor: null,
      scanCursor: "https://graph.microsoft.com/delta/page-2",
    };
    const updateRun = vi.fn(async () => ({}));
    const transaction = {
      knowledgeSourceItem: {
        findUnique: vi.fn(async () => null),
        upsert: vi.fn(async () => ({})),
      },
      knowledgeSourceSyncRun: { update: updateRun },
      knowledgeBaseSource: {
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
    };
    const service = new KnowledgeSourceService(
      {
        knowledgeSourceSyncRun: {
          findUnique: vi.fn(async () => checkpoint),
          update: updateRun,
        },
        $transaction: vi.fn(
          async (work: (client: typeof transaction) => Promise<unknown>) =>
            work(transaction),
        ),
      } as unknown as PrismaClient,
      {} as never,
      { create: vi.fn() },
      {} as never,
      { enqueue: vi.fn() },
    );
    const graph = {
      getDeltaPage: vi
        .fn()
        .mockRejectedValueOnce(new SharePointDeltaCursorExpiredError())
        .mockResolvedValueOnce({
          items: [],
          nextLink: null,
          deltaLink: "https://graph.microsoft.com/delta/fresh",
        }),
    };

    const result = await (
      service as unknown as {
        applyDelta(
          source: {
            id: string;
            driveId: string;
            rootItemId: string;
            deltaLink: string | null;
          },
          client: typeof graph,
          runId: string,
        ): Promise<string | null>;
      }
    ).applyDelta(
      { id: "source-1", driveId: "drive-1", rootItemId: "root", deltaLink: null },
      graph,
      "run-1",
    );

    expect(result).toBe("https://graph.microsoft.com/delta/fresh");
    expect(graph.getDeltaPage).toHaveBeenNthCalledWith(
      1,
      "drive-1",
      "root",
      checkpoint.scanCursor,
    );
    expect(graph.getDeltaPage).toHaveBeenNthCalledWith(
      2,
      "drive-1",
      "root",
      undefined,
    );
    expect(updateRun).toHaveBeenCalledWith({
      where: { id: "run-1" },
      data: {
        scanBaseCursor: null,
        scanCursor: null,
        scanDeltaLink: null,
        scannedCount: 0,
      },
    });
  });

  it("plans only failed or still-running checkpoints when successful files are unchanged", async () => {
    const sourceId = "00000000-0000-4000-8000-000000000081";
    const baseId = "00000000-0000-4000-8000-000000000082";
    const readyDocumentId = "00000000-0000-4000-8000-000000000083";
    const failedDocumentId = "00000000-0000-4000-8000-000000000084";
    const activeDocumentId = "00000000-0000-4000-8000-000000000088";
    const folderEntryId = "00000000-0000-4000-8000-000000000085";
    const item = (
      id: string,
      externalItemId: string,
      name: string,
      documentId: string,
      syncStatus: "synced" | "failed",
    ) => ({
      id,
      sourceId,
      externalItemId,
      parentExternalItemId: "root",
      documentId,
      itemType: "file",
      name,
      mimeType: "application/pdf",
      sizeBytes: 10n,
      etag: `etag-${externalItemId}`,
      ctag: `ctag-${externalItemId}`,
      syncedEtag: `etag-${externalItemId}`,
      syncedCtag: `ctag-${externalItemId}`,
      syncStatus,
      syncAction: null,
      syncFailurePhase: syncStatus === "failed" ? "processing" : null,
      stableErrorCode:
        syncStatus === "failed" ? "KNOWLEDGE_DOCLING_TASK_NOT_FOUND" : null,
      lastSyncRunId:
        syncStatus === "failed"
          ? "00000000-0000-4000-8000-000000000099"
          : null,
      webUrl: null,
      deletedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const readyItem = item(
      "00000000-0000-4000-8000-000000000086",
      "ready",
      "ready.pdf",
      readyDocumentId,
      "synced",
    );
    const failedItem = item(
      "00000000-0000-4000-8000-000000000087",
      "failed",
      "failed.pdf",
      failedDocumentId,
      "failed",
    );
    const activeItem = item(
      "00000000-0000-4000-8000-000000000089",
      "active",
      "active.pdf",
      activeDocumentId,
      "failed",
    );
    const entries = [
      {
        id: folderEntryId,
        knowledgeBaseId: baseId,
        parentEntryId: null,
        entryType: "folder",
        name: "Policies",
        normalizedName: "policies",
        documentId: null,
        sourceItemId: null,
        createdBy: "owner-1",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      ...[
        [readyItem, readyDocumentId],
        [failedItem, failedDocumentId],
        [activeItem, activeDocumentId],
      ].map(([sourceItem, documentId]) => ({
        id: `${documentId}-entry`,
        knowledgeBaseId: baseId,
        parentEntryId: folderEntryId,
        entryType: "document",
        name: (sourceItem as typeof readyItem).name,
        normalizedName: (sourceItem as typeof readyItem).name,
        documentId: documentId as string,
        sourceItemId: (sourceItem as typeof readyItem).id,
        createdBy: "owner-1",
        createdAt: new Date(),
        updatedAt: new Date(),
      })),
    ];
    const service = new KnowledgeSourceService(
      {
        knowledgeSourceItem: {
          findMany: vi.fn(async () => [readyItem, failedItem, activeItem]),
        },
        knowledgeBaseEntry: { findMany: vi.fn(async () => entries) },
        knowledgeBaseDocument: {
          findMany: vi.fn(async () => [
            {
              id: readyDocumentId,
              status: "ready",
              candidateVersionId: null,
              activeProcessingVersionId: null,
              stableErrorCode: null,
            },
            {
              id: failedDocumentId,
              status: "failed",
              candidateVersionId: failedDocumentId,
              activeProcessingVersionId: null,
              stableErrorCode: "KNOWLEDGE_DOCLING_TASK_NOT_FOUND",
            },
            {
              id: activeDocumentId,
              status: "ready",
              candidateVersionId: activeDocumentId,
              activeProcessingVersionId: activeDocumentId,
              stableErrorCode: null,
            },
          ]),
        },
      } as unknown as PrismaClient,
      {} as never,
      { create: vi.fn() },
      {} as never,
      { enqueue: vi.fn() },
    );
    const work = await (
      service as unknown as {
        buildWorkItems(input: {
          id: string;
          knowledgeBaseId: string;
          rootItemId: string;
          folderName: string;
        }): Promise<Array<Record<string, unknown>>>;
      }
    ).buildWorkItems({
      id: sourceId,
      knowledgeBaseId: baseId,
      rootItemId: "root",
      folderName: "Policies",
    });

    expect(work).toEqual([
      expect.objectContaining({
        kind: "retry",
        action: "retry",
        itemId: failedItem.id,
        documentId: failedDocumentId,
      }),
      expect.objectContaining({
        kind: "wait",
        action: "retry",
        itemId: activeItem.id,
        documentId: activeDocumentId,
      }),
    ]);
  });

  it("queues an explicit retry trigger when a failed source is retried manually", async () => {
    const source = {
      id: "00000000-0000-4000-8000-000000000091",
      knowledgeBaseId: "00000000-0000-4000-8000-000000000092",
      provider: "sharepoint",
      sourceUrl: "https://contoso.sharepoint.com/sites/Finance/Policies",
      siteName: "Finance",
      driveName: "Documents",
      folderName: "Policies",
      ...sourceScheduleRecord,
      syncStatus: "failed",
      stableErrorCode: "KNOWLEDGE_SOURCE_ITEM_SYNC_FAILED",
      syncLeaseExpiresAt: null,
      lastSyncedAt: null,
      nextSyncAt: new Date("2026-08-13T01:00:00.000Z"),
      updatedAt: new Date("2026-08-12T02:00:00.000Z"),
    };
    const enqueue = vi.fn(async () => undefined);
    const updateMany = vi.fn(async () => ({ count: 1 }));
    const service = new KnowledgeSourceService(
      {
        knowledgeBaseSource: {
          findUnique: vi.fn(async () => source),
          updateMany,
        },
        knowledgeSourceSyncRun: { findFirst: vi.fn(async () => null) },
      } as unknown as PrismaClient,
      {} as never,
      { create: vi.fn() },
      {} as never,
      { enqueue },
    );

    await service.requestSync(
      { id: "admin-1", role: "admin", status: "active" },
      source.knowledgeBaseId,
    );

    expect(enqueue).toHaveBeenCalledWith(source.id, "retry");
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: source.id, syncStatus: "failed" },
      data: {
        syncStatus: "pending",
        stableErrorCode: null,
        syncLeaseExpiresAt: null,
      },
    });
  });

  it("deletes a linked document when SharePoint moves it outside the selected root", async () => {
    const source = {
      id: "00000000-0000-4000-8000-000000000011",
      knowledgeBaseId: "00000000-0000-4000-8000-000000000012",
      driveId: "drive-1",
      rootItemId: "root",
      folderName: "Policies",
      deltaLink: "delta-before",
      ...sourceScheduleRecord,
    };
    const documentId = "00000000-0000-4000-8000-000000000013";
    const sourceItemId = "00000000-0000-4000-8000-000000000014";
    const sourceItem = {
      id: sourceItemId,
      sourceId: source.id,
      externalItemId: "manual",
      parentExternalItemId: "outside",
      documentId,
      itemType: "file",
      name: "manual.pdf",
      mimeType: "application/pdf",
      sizeBytes: 10n,
      etag: "etag-1",
      ctag: "ctag-1",
      syncedEtag: "etag-1",
      syncedCtag: "ctag-1",
      webUrl: null,
      deletedAt: null,
      syncStatus: "synced",
      syncAction: null,
      syncFailurePhase: null,
      stableErrorCode: null,
      lastSyncRunId: null,
      createdAt: new Date("2026-07-30T00:00:00.000Z"),
      updatedAt: new Date("2026-07-30T00:00:00.000Z"),
    };
    const detachSourceItem = vi.fn(async () => ({}));
    const updateSource = vi.fn(async () => ({}));
    const claimTransaction = {
      knowledgeBaseSource: {
        updateMany: vi.fn(async () => ({ count: 1 })),
        update: updateSource,
      },
      knowledgeSourceSyncRun: {
        create: vi.fn(async () => ({})),
        findUnique: vi.fn(async () => ({
          scanBaseCursor: source.deltaLink,
          scanCursor: source.deltaLink,
        })),
        findFirst: vi.fn(async () => null),
        update: vi.fn(async () => ({})),
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
      knowledgeSourceItem: {
        findUnique: vi.fn(async () => null),
        findFirst: vi.fn(async () => ({
          id: sourceItemId,
          etag: sourceItem.etag,
          ctag: sourceItem.ctag,
        })),
        upsert: vi.fn(async () => ({})),
        update: detachSourceItem,
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
    };
    const prisma = {
      knowledgeBaseSource: {
        findUnique: vi.fn(async () => source),
        updateMany: vi.fn(async () => ({ count: 1 })),
        update: updateSource,
      },
      knowledgeBase: {
        findUnique: vi.fn(async () => ({
          ownerId: "00000000-0000-4000-8000-000000000015",
          lifecycleStatus: "active",
          availabilityStatus: "enabled",
        })),
      },
      knowledgeSourceItem: {
        findMany: vi.fn(async () => [sourceItem]),
        update: detachSourceItem,
      },
      knowledgeBaseDocument: {
        findMany: vi.fn(async () => [
          {
            id: documentId,
            status: "ready",
            candidateVersionId: null,
            activeProcessingVersionId: null,
            stableErrorCode: null,
          },
        ]),
      },
      knowledgeBaseEntry: { findMany: vi.fn(async () => []) },
      knowledgeSourceSyncRun: claimTransaction.knowledgeSourceSyncRun,
      $transaction: vi.fn(
        async (
          work:
            | ((client: typeof claimTransaction) => Promise<unknown>)
            | Promise<unknown>[],
        ) =>
          Array.isArray(work)
            ? Promise.all(work)
            : work(claimTransaction),
      ),
    } as unknown as PrismaClient;
    const deleteDocument = vi.fn(async () => undefined);
    const service = new KnowledgeSourceService(
      prisma,
      {} as never,
      {
        create: vi.fn(async () => ({
          getDeltaPage: vi.fn(async () => ({
            items: [],
            nextLink: null,
            deltaLink: "delta-after",
          })),
        })),
      } as never,
      { deleteDocument } as never,
      { enqueue: vi.fn() },
      () => new Date("2026-08-12T02:00:00.000Z"),
    );

    await service.processSync(source.id, "scheduled");

    expect(deleteDocument).toHaveBeenCalledWith(
      expect.objectContaining({ id: expect.any(String) }),
      source.knowledgeBaseId,
      documentId,
      "sharepoint_source_moved_out_of_scope",
    );
    expect(detachSourceItem).toHaveBeenCalledWith({
      where: { id: sourceItemId },
      data: { documentId: null },
    });
    expect(updateSource).toHaveBeenCalledWith({
      where: { id: source.id },
      data: expect.objectContaining({
        nextSyncAt: new Date("2026-08-13T01:00:00.000Z"),
      }),
    });
  });

  it("deletes a linked document when a SharePoint item becomes unsupported", async () => {
    const source = {
      id: "00000000-0000-4000-8000-000000000021",
      knowledgeBaseId: "00000000-0000-4000-8000-000000000022",
      driveId: "drive-1",
      rootItemId: "root",
      folderName: "Policies",
      deltaLink: "delta-before",
      ...sourceScheduleRecord,
    };
    const documentId = "00000000-0000-4000-8000-000000000023";
    const sourceItemId = "00000000-0000-4000-8000-000000000024";
    const sourceItem = {
      id: sourceItemId,
      sourceId: source.id,
      externalItemId: "manual",
      parentExternalItemId: source.rootItemId,
      documentId,
      itemType: "file",
      name: "manual.exe",
      mimeType: "application/octet-stream",
      sizeBytes: 10n,
      etag: "etag-2",
      ctag: "ctag-2",
      syncedEtag: "etag-1",
      syncedCtag: "ctag-1",
      webUrl: null,
      deletedAt: null,
      syncStatus: "synced",
      syncAction: null,
      syncFailurePhase: null,
      stableErrorCode: null,
      lastSyncRunId: null,
      createdAt: new Date("2026-07-30T00:00:00.000Z"),
      updatedAt: new Date("2026-07-30T00:00:00.000Z"),
    };
    const detachSourceItem = vi.fn(async () => ({}));
    const claimTransaction = {
      knowledgeBaseSource: {
        updateMany: vi.fn(async () => ({ count: 1 })),
        update: vi.fn(async () => ({})),
      },
      knowledgeSourceSyncRun: {
        create: vi.fn(async () => ({})),
        findUnique: vi.fn(async () => ({
          scanBaseCursor: source.deltaLink,
          scanCursor: source.deltaLink,
        })),
        findFirst: vi.fn(async () => null),
        update: vi.fn(async () => ({})),
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
      knowledgeSourceItem: {
        findUnique: vi.fn(async () => null),
        findFirst: vi.fn(async () => ({
          id: sourceItemId,
          etag: sourceItem.etag,
          ctag: sourceItem.ctag,
        })),
        upsert: vi.fn(async () => ({})),
        update: detachSourceItem,
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
    };
    const prisma = {
      knowledgeBaseSource: {
        findUnique: vi.fn(async () => source),
        updateMany: vi.fn(async () => ({ count: 1 })),
        update: vi.fn(async () => ({})),
      },
      knowledgeBase: {
        findUnique: vi.fn(async () => ({
          ownerId: "00000000-0000-4000-8000-000000000025",
          lifecycleStatus: "active",
          availabilityStatus: "enabled",
        })),
      },
      knowledgeSourceItem: {
        findMany: vi.fn(async () => [sourceItem]),
        update: detachSourceItem,
      },
      knowledgeBaseDocument: {
        findMany: vi.fn(async () => [
          {
            id: documentId,
            status: "ready",
            candidateVersionId: null,
            activeProcessingVersionId: null,
            stableErrorCode: null,
          },
        ]),
      },
      knowledgeBaseEntry: { findMany: vi.fn(async () => []) },
      knowledgeSourceSyncRun: claimTransaction.knowledgeSourceSyncRun,
      $transaction: vi.fn(
        async (
          work:
            | ((client: typeof claimTransaction) => Promise<unknown>)
            | Promise<unknown>[],
        ) =>
          Array.isArray(work)
            ? Promise.all(work)
            : work(claimTransaction),
      ),
    } as unknown as PrismaClient;
    const deleteDocument = vi.fn(async () => undefined);
    const service = new KnowledgeSourceService(
      prisma,
      {} as never,
      {
        create: vi.fn(async () => ({
          getDeltaPage: vi.fn(async () => ({
            items: [],
            nextLink: null,
            deltaLink: "delta-after",
          })),
        })),
      } as never,
      { deleteDocument } as never,
      { enqueue: vi.fn() },
    );

    await service.processSync(source.id, "scheduled");

    expect(deleteDocument).toHaveBeenCalledWith(
      expect.objectContaining({ id: expect.any(String) }),
      source.knowledgeBaseId,
      documentId,
      "sharepoint_source_no_longer_supported",
    );
    expect(detachSourceItem).toHaveBeenCalledWith({
      where: { id: sourceItemId },
      data: { documentId: null },
    });
  });

  it("retries failed source processing without duplicating active candidates", () => {
    expect(
      shouldRetrySourceDocument({
        status: "failed",
        candidateVersionId: null,
        activeProcessingVersionId: null,
        stableErrorCode: "KNOWLEDGE_DOCUMENT_PROCESSING_FAILED",
      }),
    ).toBe(true);
    expect(
      shouldRetrySourceDocument({
        status: "ready",
        candidateVersionId: "candidate-1",
        activeProcessingVersionId: null,
        stableErrorCode: "KNOWLEDGE_DOCUMENT_PROCESSING_FAILED",
      }),
    ).toBe(true);
    expect(
      shouldRetrySourceDocument({
        status: "ready",
        candidateVersionId: "candidate-1",
        activeProcessingVersionId: "candidate-1",
        stableErrorCode: null,
      }),
    ).toBe(false);
  });
});
