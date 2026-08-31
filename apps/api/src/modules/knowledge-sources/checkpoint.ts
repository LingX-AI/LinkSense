import type { Prisma, PrismaClient } from "../../generated/prisma/client.js";

import { AppError } from "../../lib/errors.js";
import {
  SharePointDeltaCursorExpiredError,
  type SharePointDeltaItem,
  type SharePointGraphClient,
} from "./sharepoint-graph.js";

const SYNC_LEASE_DURATION_MS = 2 * 60 * 60_000;

export type KnowledgeSourceDeltaTarget = {
  id: string;
  driveId: string;
  rootItemId: string;
  deltaLink: string | null;
};

export async function applySharePointDeltaCheckpoint(input: {
  prisma: PrismaClient;
  source: KnowledgeSourceDeltaTarget;
  graph: SharePointGraphClient;
  runId: string;
  now: () => Date;
}): Promise<string | null> {
  const run = await input.prisma.knowledgeSourceSyncRun.findUnique({
    where: { id: input.runId },
    select: {
      scanBaseCursor: true,
      scanCursor: true,
    },
  });
  if (!run) throw new AppError("KNOWLEDGE_SOURCE_SYNC_UNAVAILABLE");
  let baseCursor = run.scanBaseCursor;
  let cursor = run.scanCursor ?? baseCursor;
  let finalDeltaLink: string | null = null;
  let resumedFromBase = cursor === baseCursor;
  let resumedFromRoot = cursor === null;
  while (true) {
    let page;
    try {
      page = await input.graph.getDeltaPage(
        input.source.driveId,
        input.source.rootItemId,
        cursor ?? undefined,
      );
    } catch (error) {
      if (!(error instanceof SharePointDeltaCursorExpiredError)) throw error;
      if (!resumedFromBase && baseCursor !== null) {
        cursor = baseCursor;
        resumedFromBase = true;
      } else if (!resumedFromRoot) {
        baseCursor = null;
        cursor = null;
        resumedFromRoot = true;
      } else {
        throw new AppError("KNOWLEDGE_SOURCE_SYNC_UNAVAILABLE");
      }
      finalDeltaLink = null;
      await input.prisma.knowledgeSourceSyncRun.update({
        where: { id: input.runId },
        data: {
          scanBaseCursor: baseCursor,
          scanCursor: cursor,
          scanDeltaLink: null,
          scannedCount: 0,
        },
      });
      continue;
    }

    const pageNow = input.now();
    await input.prisma.$transaction(async (transaction) => {
      for (const item of page.items) {
        await upsertDeltaItem(transaction, input.source.id, item, pageNow);
      }
      await transaction.knowledgeSourceSyncRun.update({
        where: { id: input.runId },
        data: {
          scannedCount: { increment: page.items.length },
          scanCursor: page.nextLink,
          scanDeltaLink: page.deltaLink ?? finalDeltaLink,
          ...(page.nextLink === null ? { phase: "syncing" } : {}),
        },
      });
      const extended = await transaction.knowledgeBaseSource.updateMany({
        where: { id: input.source.id, syncStatus: "syncing" },
        data: { syncLeaseExpiresAt: knowledgeSourceLeaseExpiry(pageNow) },
      });
      if (extended.count !== 1) {
        throw new AppError("KNOWLEDGE_SOURCE_SYNC_UNAVAILABLE");
      }
    });
    cursor = page.nextLink;
    finalDeltaLink = page.deltaLink ?? finalDeltaLink;
    if (cursor === null) break;
  }
  return finalDeltaLink;
}

export function knowledgeSourceLeaseExpiry(now: Date): Date {
  return new Date(now.getTime() + SYNC_LEASE_DURATION_MS);
}

async function upsertDeltaItem(
  transaction: Prisma.TransactionClient,
  sourceId: string,
  item: SharePointDeltaItem,
  now: Date,
): Promise<void> {
  const existing = await transaction.knowledgeSourceItem.findUnique({
    where: { sourceId_externalItemId: { sourceId, externalItemId: item.id } },
  });
  if (item.deleted) {
    if (existing) {
      await transaction.knowledgeSourceItem.update({
        where: { id: existing.id },
        data: {
          deletedAt: now,
          syncStatus: existing.documentId === null ? "synced" : "pending",
          syncAction: null,
          syncFailurePhase: null,
          stableErrorCode: null,
        },
      });
    }
    return;
  }
  const changed =
    existing === null ||
    existing.deletedAt !== null ||
    existing.parentExternalItemId !== item.parentId ||
    existing.itemType !== item.itemType ||
    existing.name !== item.name ||
    existing.mimeType !== item.mimeType ||
    existing.sizeBytes !== item.sizeBytes ||
    existing.etag !== item.etag ||
    existing.ctag !== item.ctag ||
    existing.webUrl !== item.webUrl;
  await transaction.knowledgeSourceItem.upsert({
    where: { sourceId_externalItemId: { sourceId, externalItemId: item.id } },
    create: {
      sourceId,
      externalItemId: item.id,
      parentExternalItemId: item.parentId,
      itemType: item.itemType,
      name: item.name,
      mimeType: item.mimeType,
      sizeBytes: item.sizeBytes,
      etag: item.etag,
      ctag: item.ctag,
      webUrl: item.webUrl,
      syncStatus: item.itemType === "folder" ? "synced" : "pending",
    },
    update: {
      parentExternalItemId: item.parentId,
      itemType: item.itemType,
      name: item.name,
      mimeType: item.mimeType,
      sizeBytes: item.sizeBytes,
      etag: item.etag,
      ctag: item.ctag,
      webUrl: item.webUrl,
      deletedAt: null,
      ...(changed
        ? {
            syncStatus: item.itemType === "folder" ? "synced" : "pending",
            syncAction: null,
            syncFailurePhase: null,
            stableErrorCode: null,
          }
        : {}),
    },
  });
}
