import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PrismaClient } from "../src/generated/prisma/client.js";

const bull = vi.hoisted(() => ({
  add: vi.fn(async () => ({})),
  close: vi.fn(async () => undefined),
}));

vi.mock("bullmq", () => ({
  Queue: class {
    add = bull.add;
    close = bull.close;
    waitUntilReady = vi.fn(async () => undefined);
  },
  Worker: class {
    close = vi.fn(async () => undefined);
  },
}));

import { KnowledgeSourceRuntime } from "../src/modules/knowledge-sources/runtime.js";

describe("KnowledgeSourceRuntime", () => {
  beforeEach(() => {
    bull.add.mockClear();
    bull.close.mockClear();
  });

  it("does not deduplicate explicit retry requests with a retained queue job id", async () => {
    const runtime = new KnowledgeSourceRuntime(
      "redis://localhost:6379/0",
      {} as PrismaClient,
      vi.fn(),
    );

    await runtime.enqueue(
      "00000000-0000-4000-8000-000000000501",
      "retry",
    );

    expect(bull.add).toHaveBeenCalledWith(
      "sync",
      {
        sourceId: "00000000-0000-4000-8000-000000000501",
        trigger: "retry",
      },
      {},
    );
    await runtime.close();
  });

  it("atomically fails expired runs and their unfinished processing items", async () => {
    const now = new Date("2026-08-12T02:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const updateItems = vi.fn(async () => ({ count: 2 }));
    const updateRun = vi.fn(async () => ({ count: 1 }));
    const updateSource = vi.fn(async () => ({ count: 1 }));
    const transaction = {
      knowledgeSourceSyncRun: {
        findMany: vi.fn(async () => [
          { id: "00000000-0000-4000-8000-000000000503", phase: "processing" },
        ]),
        updateMany: updateRun,
      },
      knowledgeSourceItem: { updateMany: updateItems },
      knowledgeBaseSource: { updateMany: updateSource },
    };
    const prisma = {
      knowledgeBaseSource: {
        findMany: vi.fn(async () => [
          { id: "00000000-0000-4000-8000-000000000502" },
        ]),
      },
      knowledgeSourceItem: { findMany: vi.fn(async () => []) },
      $transaction: vi.fn(
        async (work: (client: typeof transaction) => Promise<unknown>) =>
          work(transaction),
      ),
    } as unknown as PrismaClient;
    const runtime = new KnowledgeSourceRuntime(
      "redis://localhost:6379/0",
      prisma,
      vi.fn(),
    );

    await (
      runtime as unknown as { recoverExpiredLeases(): Promise<void> }
    ).recoverExpiredLeases();

    expect(updateItems).toHaveBeenCalledWith({
      where: {
        lastSyncRunId: "00000000-0000-4000-8000-000000000503",
        syncStatus: "processing",
      },
      data: {
        syncStatus: "failed",
        syncAction: null,
        syncFailurePhase: "processing",
        stableErrorCode: "KNOWLEDGE_SOURCE_SYNC_UNAVAILABLE",
      },
    });
    expect(updateRun).toHaveBeenCalledWith({
      where: {
        id: "00000000-0000-4000-8000-000000000503",
        status: "running",
      },
      data: {
        status: "failed",
        phase: "completed",
        failurePhase: "processing",
        processedCount: { increment: 2 },
        failedCount: { increment: 2 },
        stableErrorCode: "KNOWLEDGE_SOURCE_SYNC_UNAVAILABLE",
        completedAt: now,
      },
    });
    expect(updateSource).toHaveBeenCalledWith({
      where: {
        id: { in: ["00000000-0000-4000-8000-000000000502"] },
        syncStatus: "syncing",
      },
      data: {
        syncStatus: "failed",
        stableErrorCode: "KNOWLEDGE_SOURCE_SYNC_UNAVAILABLE",
        syncLeaseExpiresAt: null,
        nextSyncAt: now,
      },
    });
    await runtime.close();
    vi.useRealTimers();
  });

  it("extends an expired source lease while downstream document processing is still active", async () => {
    const now = new Date("2026-08-12T02:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const sourceId = "00000000-0000-4000-8000-000000000504";
    const documentId = "00000000-0000-4000-8000-000000000505";
    const extendSource = vi.fn(async () => ({ count: 1 }));
    const transaction = vi.fn();
    const prisma = {
      knowledgeBaseSource: {
        findMany: vi.fn(async () => [{ id: sourceId }]),
        updateMany: extendSource,
      },
      knowledgeSourceItem: {
        findMany: vi.fn(async () => [
          {
            id: "00000000-0000-4000-8000-000000000506",
            sourceId,
            documentId,
          },
        ]),
      },
      knowledgeBaseEntry: { findMany: vi.fn(async () => []) },
      knowledgeBaseDocument: {
        findMany: vi.fn(async () => [{ id: documentId }]),
      },
      $transaction: transaction,
    } as unknown as PrismaClient;
    const runtime = new KnowledgeSourceRuntime(
      "redis://localhost:6379/0",
      prisma,
      vi.fn(),
    );

    await (
      runtime as unknown as { recoverExpiredLeases(): Promise<void> }
    ).recoverExpiredLeases();

    expect(extendSource).toHaveBeenCalledWith({
      where: {
        id: { in: [sourceId] },
        syncStatus: "syncing",
        syncLeaseExpiresAt: { lte: now },
      },
      data: {
        syncLeaseExpiresAt: new Date("2026-08-12T04:00:00.000Z"),
      },
    });
    expect(transaction).not.toHaveBeenCalled();
    await runtime.close();
    vi.useRealTimers();
  });

  it("recognizes active processing through a directory projection before the source item link is checkpointed", async () => {
    const now = new Date("2026-08-12T02:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const sourceId = "00000000-0000-4000-8000-000000000507";
    const itemId = "00000000-0000-4000-8000-000000000508";
    const documentId = "00000000-0000-4000-8000-000000000509";
    const extendSource = vi.fn(async () => ({ count: 1 }));
    const transaction = vi.fn();
    const prisma = {
      knowledgeBaseSource: {
        findMany: vi.fn(async () => [{ id: sourceId }]),
        updateMany: extendSource,
      },
      knowledgeSourceItem: {
        findMany: vi.fn(async () => [
          { id: itemId, sourceId, documentId: null },
        ]),
      },
      knowledgeBaseEntry: {
        findMany: vi.fn(async () => [{ sourceItemId: itemId, documentId }]),
      },
      knowledgeBaseDocument: {
        findMany: vi.fn(async () => [{ id: documentId }]),
      },
      $transaction: transaction,
    } as unknown as PrismaClient;
    const runtime = new KnowledgeSourceRuntime(
      "redis://localhost:6379/0",
      prisma,
      vi.fn(),
    );

    await (
      runtime as unknown as { recoverExpiredLeases(): Promise<void> }
    ).recoverExpiredLeases();

    expect(extendSource).toHaveBeenCalledTimes(1);
    expect(transaction).not.toHaveBeenCalled();
    await runtime.close();
    vi.useRealTimers();
  });
});
