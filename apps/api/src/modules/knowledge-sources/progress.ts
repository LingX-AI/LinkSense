import type { Prisma } from "../../generated/prisma/client.js";

export type KnowledgeSourceItemAction =
  | "create"
  | "update"
  | "delete"
  | "skip"
  | "retry";

export type KnowledgeSourceItemFailurePhase = "syncing" | "processing";

const ITEM_SYNC_FAILED = "KNOWLEDGE_SOURCE_ITEM_SYNC_FAILED";

export async function markKnowledgeSourceItemProcessing(
  transaction: Prisma.TransactionClient,
  input: {
    itemId: string;
    runId: string;
    action: KnowledgeSourceItemAction;
  },
): Promise<void> {
  await transaction.knowledgeSourceItem.update({
    where: { id: input.itemId },
    data: {
      syncStatus: "processing",
      syncAction: input.action,
      syncFailurePhase: null,
      stableErrorCode: null,
      lastSyncRunId: input.runId,
    },
  });
}

export async function completeKnowledgeSourceItem(
  transaction: Prisma.TransactionClient,
  input: {
    itemId: string;
    runId: string;
    action: KnowledgeSourceItemAction;
    documentId?: string;
    now: Date;
  },
): Promise<boolean> {
  const item = await transaction.knowledgeSourceItem.findFirst({
    where: {
      id: input.itemId,
      lastSyncRunId: input.runId,
      syncStatus: "processing",
    },
    select: { id: true, etag: true, ctag: true },
  });
  if (!item) return false;

  const claimed = await transaction.knowledgeSourceItem.updateMany({
    where: {
      id: item.id,
      lastSyncRunId: input.runId,
      syncStatus: "processing",
    },
    data: {
      syncStatus: "synced",
      syncAction: null,
      syncFailurePhase: null,
      stableErrorCode: null,
      syncedEtag: item.etag,
      syncedCtag: item.ctag,
      ...(input.documentId === undefined
        ? {}
        : { documentId: input.documentId }),
    },
  });
  if (claimed.count !== 1) return false;

  await incrementRunOutcome(transaction, input.runId, input.action);
  await finalizeRunIfTerminal(transaction, input.runId, input.now);
  return true;
}

export async function failKnowledgeSourceItem(
  transaction: Prisma.TransactionClient,
  input: {
    itemId: string;
    runId: string;
    phase: KnowledgeSourceItemFailurePhase;
    stableErrorCode: string;
    documentId?: string;
    now: Date;
  },
): Promise<boolean> {
  const claimed = await transaction.knowledgeSourceItem.updateMany({
    where: {
      id: input.itemId,
      lastSyncRunId: input.runId,
      syncStatus: "processing",
    },
    data: {
      syncStatus: "failed",
      syncAction: null,
      syncFailurePhase: input.phase,
      stableErrorCode: input.stableErrorCode,
      ...(input.documentId === undefined
        ? {}
        : { documentId: input.documentId }),
    },
  });
  if (claimed.count !== 1) return false;

  await transaction.knowledgeSourceSyncRun.updateMany({
    where: { id: input.runId, status: "running" },
    data: {
      processedCount: { increment: 1 },
      failedCount: { increment: 1 },
      failurePhase: input.phase,
    },
  });
  await finalizeRunIfTerminal(transaction, input.runId, input.now);
  return true;
}

export async function completeKnowledgeSourceDocumentProcessing(
  transaction: Prisma.TransactionClient,
  documentId: string,
  now: Date,
): Promise<void> {
  const item = await findProcessingItemForDocument(transaction, documentId);
  if (item?.syncAction && isItemAction(item.syncAction)) {
    await completeKnowledgeSourceItem(transaction, {
      itemId: item.id,
      runId: item.lastSyncRunId,
      action: item.syncAction,
      documentId,
      now,
    });
    return;
  }

  const late = await findFailedProcessingItemForDocument(
    transaction,
    documentId,
  );
  if (!late) return;
  await transaction.knowledgeSourceItem.updateMany({
    where: {
      id: late.id,
      lastSyncRunId: late.lastSyncRunId,
      syncStatus: "failed",
      syncFailurePhase: "processing",
    },
    data: {
      syncStatus: "synced",
      syncAction: null,
      syncFailurePhase: null,
      stableErrorCode: null,
      syncedEtag: late.etag,
      syncedCtag: late.ctag,
      documentId,
    },
  });
}

export async function failKnowledgeSourceDocumentProcessing(
  transaction: Prisma.TransactionClient,
  documentId: string,
  stableErrorCode: string,
  now: Date,
): Promise<void> {
  const item = await findProcessingItemForDocument(transaction, documentId);
  if (!item) return;
  await failKnowledgeSourceItem(transaction, {
    itemId: item.id,
    runId: item.lastSyncRunId,
    phase: "processing",
    stableErrorCode,
    documentId,
    now,
  });
}

export async function finalizeRunIfTerminal(
  transaction: Prisma.TransactionClient,
  runId: string,
  now: Date,
): Promise<boolean> {
  const run = await transaction.knowledgeSourceSyncRun.findFirst({
    where: { id: runId, status: "running" },
    select: {
      id: true,
      sourceId: true,
      totalCount: true,
      processedCount: true,
      failedCount: true,
      failurePhase: true,
    },
  });
  if (
    !run ||
    run.totalCount === null ||
    run.processedCount < run.totalCount
  ) {
    return false;
  }

  const failed = run.failedCount > 0;
  const completed = await transaction.knowledgeSourceSyncRun.updateMany({
    where: { id: run.id, status: "running" },
    data: {
      status: failed ? "partial" : "completed",
      phase: "completed",
      failurePhase: failed ? (run.failurePhase ?? "processing") : null,
      stableErrorCode: failed ? ITEM_SYNC_FAILED : null,
      completedAt: now,
    },
  });
  if (completed.count !== 1) return false;

  await transaction.knowledgeBaseSource.update({
    where: { id: run.sourceId },
    data: {
      syncStatus: failed ? "failed" : "ready",
      stableErrorCode: failed ? ITEM_SYNC_FAILED : null,
      syncLeaseExpiresAt: null,
      lastSyncedAt: now,
    },
  });
  return true;
}

async function incrementRunOutcome(
  transaction: Prisma.TransactionClient,
  runId: string,
  action: KnowledgeSourceItemAction,
): Promise<void> {
  const outcome =
    action === "create"
      ? { createdCount: { increment: 1 } }
      : action === "update"
        ? { updatedCount: { increment: 1 } }
        : action === "delete"
          ? { deletedCount: { increment: 1 } }
          : action === "skip"
            ? { skippedCount: { increment: 1 } }
            : { retriedCount: { increment: 1 } };
  await transaction.knowledgeSourceSyncRun.updateMany({
    where: { id: runId, status: "running" },
    data: {
      processedCount: { increment: 1 },
      ...outcome,
    },
  });
}

async function findProcessingItemForDocument(
  transaction: Prisma.TransactionClient,
  documentId: string,
) {
  const direct = await transaction.knowledgeSourceItem.findFirst({
    where: {
      documentId,
      syncStatus: "processing",
      lastSyncRunId: { not: null },
    },
    select: {
      id: true,
      lastSyncRunId: true,
      syncAction: true,
    },
  });
  if (direct?.lastSyncRunId) return direct as typeof direct & {
    lastSyncRunId: string;
  };

  const entry = await transaction.knowledgeBaseEntry.findFirst({
    where: { documentId, sourceItemId: { not: null } },
    select: { sourceItemId: true },
  });
  if (!entry?.sourceItemId) return null;
  const projected = await transaction.knowledgeSourceItem.findFirst({
    where: {
      id: entry.sourceItemId,
      syncStatus: "processing",
      lastSyncRunId: { not: null },
    },
    select: {
      id: true,
      lastSyncRunId: true,
      syncAction: true,
    },
  });
  return projected?.lastSyncRunId
    ? (projected as typeof projected & { lastSyncRunId: string })
    : null;
}

async function findFailedProcessingItemForDocument(
  transaction: Prisma.TransactionClient,
  documentId: string,
) {
  const select = {
    id: true,
    lastSyncRunId: true,
    etag: true,
    ctag: true,
  } as const;
  const direct = await transaction.knowledgeSourceItem.findFirst({
    where: {
      documentId,
      syncStatus: "failed",
      syncFailurePhase: "processing",
      lastSyncRunId: { not: null },
    },
    select,
  });
  if (direct?.lastSyncRunId) {
    return direct as typeof direct & { lastSyncRunId: string };
  }

  const entry = await transaction.knowledgeBaseEntry.findFirst({
    where: { documentId, sourceItemId: { not: null } },
    select: { sourceItemId: true },
  });
  if (!entry?.sourceItemId) return null;
  const projected = await transaction.knowledgeSourceItem.findFirst({
    where: {
      id: entry.sourceItemId,
      syncStatus: "failed",
      syncFailurePhase: "processing",
      lastSyncRunId: { not: null },
    },
    select,
  });
  return projected?.lastSyncRunId
    ? (projected as typeof projected & { lastSyncRunId: string })
    : null;
}

function isItemAction(value: string): value is KnowledgeSourceItemAction {
  return ["create", "update", "delete", "skip", "retry"].includes(value);
}
