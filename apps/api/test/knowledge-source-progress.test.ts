import { describe, expect, it, vi } from "vitest";

import {
  completeKnowledgeSourceDocumentProcessing,
  failKnowledgeSourceDocumentProcessing,
} from "../src/modules/knowledge-sources/progress.js";

describe("knowledge source synchronization progress", () => {
  it("settles a document checkpoint exactly once and completes the source run", async () => {
    const fixture = progressFixture({ totalCount: 1 });

    await completeKnowledgeSourceDocumentProcessing(
      fixture.transaction as never,
      fixture.documentId,
      fixture.now,
    );
    await completeKnowledgeSourceDocumentProcessing(
      fixture.transaction as never,
      fixture.documentId,
      fixture.now,
    );

    expect(fixture.state.item.syncStatus).toBe("synced");
    expect(fixture.state.run).toMatchObject({
      status: "completed",
      phase: "completed",
      processedCount: 1,
      retriedCount: 1,
      failedCount: 0,
    });
    expect(fixture.state.source).toMatchObject({
      syncStatus: "ready",
      stableErrorCode: null,
      syncLeaseExpiresAt: null,
      lastSyncedAt: fixture.now,
    });
  });

  it("keeps the run active until every item settles and then exposes a resumable partial failure", async () => {
    const fixture = progressFixture({ totalCount: 2 });

    await failKnowledgeSourceDocumentProcessing(
      fixture.transaction as never,
      fixture.documentId,
      "KNOWLEDGE_DOCLING_TASK_NOT_FOUND",
      fixture.now,
    );

    expect(fixture.state.run).toMatchObject({
      status: "running",
      processedCount: 1,
      failedCount: 1,
      failurePhase: "processing",
    });
    expect(fixture.sourceUpdate).not.toHaveBeenCalled();

    const nextDocumentId = "00000000-0000-4000-8000-000000000206";
    fixture.state.item = {
      ...fixture.state.item,
      id: "00000000-0000-4000-8000-000000000205",
      documentId: nextDocumentId,
      syncStatus: "processing",
      syncAction: "retry",
      syncFailurePhase: null,
      stableErrorCode: null,
    };
    await completeKnowledgeSourceDocumentProcessing(
      fixture.transaction as never,
      nextDocumentId,
      fixture.now,
    );

    expect(fixture.state.run).toMatchObject({
      status: "partial",
      phase: "completed",
      processedCount: 2,
      retriedCount: 1,
      failedCount: 1,
      stableErrorCode: "KNOWLEDGE_SOURCE_ITEM_SYNC_FAILED",
    });
    expect(fixture.state.source).toMatchObject({
      syncStatus: "failed",
      stableErrorCode: "KNOWLEDGE_SOURCE_ITEM_SYNC_FAILED",
      syncLeaseExpiresAt: null,
    });
  });

  it("reconciles a late processing success after lease recovery without rewriting the failed run", async () => {
    const fixture = progressFixture({ totalCount: 1 });
    fixture.state.item = {
      ...fixture.state.item,
      syncStatus: "failed",
      syncAction: null,
      syncFailurePhase: "processing",
      stableErrorCode: "KNOWLEDGE_SOURCE_SYNC_LEASE_EXPIRED",
    };
    fixture.state.run = {
      ...fixture.state.run,
      status: "failed",
      phase: "completed",
      processedCount: 1,
      failedCount: 1,
      failurePhase: "processing",
      stableErrorCode: "KNOWLEDGE_SOURCE_SYNC_LEASE_EXPIRED",
      completedAt: fixture.now,
    };
    fixture.state.source = {
      ...fixture.state.source,
      syncStatus: "failed",
      stableErrorCode: "KNOWLEDGE_SOURCE_SYNC_LEASE_EXPIRED",
      syncLeaseExpiresAt: null,
    };

    await completeKnowledgeSourceDocumentProcessing(
      fixture.transaction as never,
      fixture.documentId,
      fixture.now,
    );

    expect(fixture.state.item).toMatchObject({
      syncStatus: "synced",
      syncAction: null,
      syncFailurePhase: null,
      stableErrorCode: null,
      syncedEtag: "etag-1",
      syncedCtag: "ctag-1",
    });
    expect(fixture.state.run).toMatchObject({
      status: "failed",
      processedCount: 1,
      failedCount: 1,
    });
    expect(fixture.state.source).toMatchObject({
      syncStatus: "failed",
      stableErrorCode: "KNOWLEDGE_SOURCE_SYNC_LEASE_EXPIRED",
    });
  });

  it("repairs the source item document checkpoint when activation resolves through the directory projection", async () => {
    const fixture = progressFixture({ totalCount: 1 });
    fixture.state.item.documentId = null;
    fixture.transaction.knowledgeBaseEntry.findFirst.mockResolvedValue({
      sourceItemId: fixture.state.item.id,
    });

    await completeKnowledgeSourceDocumentProcessing(
      fixture.transaction as never,
      fixture.documentId,
      fixture.now,
    );

    expect(fixture.state.item).toMatchObject({
      documentId: fixture.documentId,
      syncStatus: "synced",
      syncedEtag: "etag-1",
      syncedCtag: "ctag-1",
    });
    expect(fixture.state.run).toMatchObject({
      status: "completed",
      processedCount: 1,
    });
  });
});

function progressFixture(input: { totalCount: number }) {
  const now = new Date("2026-08-12T02:00:00.000Z");
  const documentId = "00000000-0000-4000-8000-000000000201";
  const state = {
    item: {
      id: "00000000-0000-4000-8000-000000000202",
      documentId: documentId as string | null,
      lastSyncRunId: "00000000-0000-4000-8000-000000000203",
      syncStatus: "processing",
      syncAction: "retry" as string | null,
      syncFailurePhase: null as string | null,
      stableErrorCode: null as string | null,
      etag: "etag-1",
      ctag: "ctag-1",
      syncedEtag: null as string | null,
      syncedCtag: null as string | null,
    },
    run: {
      id: "00000000-0000-4000-8000-000000000203",
      sourceId: "00000000-0000-4000-8000-000000000204",
      status: "running",
      phase: "processing",
      totalCount: input.totalCount,
      processedCount: 0,
      createdCount: 0,
      updatedCount: 0,
      deletedCount: 0,
      skippedCount: 0,
      retriedCount: 0,
      failedCount: 0,
      failurePhase: null as string | null,
      stableErrorCode: null as string | null,
      completedAt: null as Date | null,
    },
    source: {
      syncStatus: "syncing",
      stableErrorCode: null as string | null,
      syncLeaseExpiresAt: new Date("2026-08-12T04:00:00.000Z") as Date | null,
      lastSyncedAt: null as Date | null,
    },
  };
  const matchesItem = (where: Record<string, unknown>) =>
    (where.syncStatus === undefined || where.syncStatus === state.item.syncStatus) &&
    (where.syncFailurePhase === undefined ||
      where.syncFailurePhase === state.item.syncFailurePhase) &&
    (where.id === undefined || where.id === state.item.id) &&
    (where.documentId === undefined || where.documentId === state.item.documentId) &&
    (where.lastSyncRunId === undefined ||
      typeof where.lastSyncRunId === "object" ||
      where.lastSyncRunId === state.item.lastSyncRunId);
  const itemFindFirst = vi.fn(
    async ({ where }: { where: Record<string, unknown> }) =>
      matchesItem(where) ? { ...state.item } : null,
  );
  const itemUpdateMany = vi.fn(
    async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      if (!matchesItem(where)) return { count: 0 };
      Object.assign(state.item, data);
      return { count: 1 };
    },
  );
  const runUpdateMany = vi.fn(
    async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      if (where.id !== state.run.id || state.run.status !== "running") {
        return { count: 0 };
      }
      for (const [field, value] of Object.entries(data)) {
        if (
          typeof value === "object" &&
          value !== null &&
          typeof Reflect.get(value, "increment") === "number"
        ) {
          const key = field as keyof typeof state.run;
          Reflect.set(
            state.run,
            key,
            Number(Reflect.get(state.run, key)) +
              Number(Reflect.get(value, "increment")),
          );
        } else {
          Reflect.set(state.run, field, value);
        }
      }
      return { count: 1 };
    },
  );
  const sourceUpdate = vi.fn(
    async ({ data }: { data: Record<string, unknown> }) => {
      Object.assign(state.source, data);
      return { ...state.source };
    },
  );
  const transaction = {
    knowledgeSourceItem: {
      findFirst: itemFindFirst,
      updateMany: itemUpdateMany,
    },
    knowledgeBaseEntry: {
      findFirst: vi.fn(
        async (): Promise<{ sourceItemId: string } | null> => null,
      ),
    },
    knowledgeSourceSyncRun: {
      findFirst: vi.fn(async () =>
        state.run.status === "running" ? { ...state.run } : null,
      ),
      updateMany: runUpdateMany,
    },
    knowledgeBaseSource: { update: sourceUpdate },
  };
  return { now, documentId, state, transaction, sourceUpdate };
}
