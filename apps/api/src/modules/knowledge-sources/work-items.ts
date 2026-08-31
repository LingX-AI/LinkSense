import { extname } from "node:path";

import { knowledgeDocumentFormats, uuidSchema } from "@linksense/shared";
import type { PrismaClient } from "../../generated/prisma/client.js";

import { AppError } from "../../lib/errors.js";
import type { KnowledgeService } from "../knowledge/service.js";
import type { KnowledgeActor } from "../knowledge/types.js";
import {
  completeKnowledgeSourceItem,
  failKnowledgeSourceItem,
  markKnowledgeSourceItemProcessing,
} from "./progress.js";
import type { SharePointGraphClient } from "./sharepoint-graph.js";

export type KnowledgeSourceWorkItem =
  | {
      kind: "delete";
      action: "delete";
      itemId: string;
      documentId: string;
      reason:
        | "sharepoint_source_deleted"
        | "sharepoint_source_moved_out_of_scope"
        | "sharepoint_source_no_longer_supported";
    }
  | { kind: "skip"; action: "skip"; itemId: string }
  | {
      kind: "rename";
      action: "update";
      itemId: string;
      documentId: string;
      displayName: string;
      relativePath: string;
    }
  | {
      kind: "retry";
      action: "retry";
      itemId: string;
      documentId: string;
      rename?: { displayName: string; relativePath: string };
    }
  | {
      kind: "wait";
      action: "retry";
      itemId: string;
      documentId: string;
    }
  | {
      kind: "upload";
      action: "create" | "update";
      itemId: string;
      externalItemId: string;
      documentId: string | null;
      filename: string;
      declaredMimeType: string;
      relativePath: string;
      etag: string | null;
      ctag: string | null;
    };

type KnowledgeSourceWorkTarget = {
  id: string;
  knowledgeBaseId: string;
  driveId?: string;
  rootItemId: string;
  folderName: string;
};

export async function buildKnowledgeSourceWorkItems(
  prisma: PrismaClient,
  source: KnowledgeSourceWorkTarget,
): Promise<KnowledgeSourceWorkItem[]> {
  let items = await prisma.knowledgeSourceItem.findMany({
    where: { sourceId: source.id },
  });
  const directoryEntries = await prisma.knowledgeBaseEntry.findMany({
    where: { knowledgeBaseId: source.knowledgeBaseId },
  });
  const projectedDocumentByItemId = new Map(
    directoryEntries.flatMap((entry) =>
      entry.sourceItemId === null || entry.documentId === null
        ? []
        : [[entry.sourceItemId, entry.documentId] as const],
    ),
  );
  let repairedDocumentLink = false;
  for (const item of items) {
    const projectedDocumentId = projectedDocumentByItemId.get(item.id);
    if (item.documentId !== null || projectedDocumentId === undefined) {
      continue;
    }
    await prisma.knowledgeSourceItem.update({
      where: { id: item.id },
      data: { documentId: projectedDocumentId },
    });
    repairedDocumentLink = true;
  }
  if (repairedDocumentLink) {
    items = await prisma.knowledgeSourceItem.findMany({
      where: { sourceId: source.id },
    });
  }
  const documentIds = items.flatMap((item) =>
    item.documentId ? [item.documentId] : [],
  );
  const documents = new Map(
    (
      await prisma.knowledgeBaseDocument.findMany({
        where: { id: { in: documentIds } },
        select: {
          id: true,
          status: true,
          candidateVersionId: true,
          activeProcessingVersionId: true,
          stableErrorCode: true,
        },
      })
    ).map((document) => [document.id, document]),
  );
  let detachedDocument = false;
  for (const item of items) {
    if (!item.documentId || item.deletedAt) continue;
    const document = documents.get(item.documentId);
    if (!document || document.status === "deleted") {
      await prisma.knowledgeSourceItem.update({
        where: { id: item.id },
        data: {
          documentId: null,
          syncedEtag: null,
          syncedCtag: null,
          syncStatus: "pending",
          syncAction: null,
          syncFailurePhase: null,
          stableErrorCode: null,
        },
      });
      detachedDocument = true;
    }
  }
  if (detachedDocument) {
    items = await prisma.knowledgeSourceItem.findMany({
      where: { sourceId: source.id },
    });
  }
  const byExternalId = new Map(
    items.map((item) => [item.externalItemId, item]),
  );
  const relativePath = (item: (typeof items)[number]) =>
    sourceRelativePath(
      item,
      source.rootItemId,
      source.folderName,
      byExternalId,
    );
  const directoryEntryById = new Map(
    directoryEntries.map((entry) => [entry.id, entry]),
  );
  const directoryEntryByDocumentId = new Map(
    directoryEntries.flatMap((entry) =>
      entry.documentId === null ? [] : [[entry.documentId, entry] as const],
    ),
  );
  const work: KnowledgeSourceWorkItem[] = [];
  for (const item of items) {
    const itemRelativePath = relativePath(item);
    const supported = isSupportedName(item.name);
    if (
      item.documentId !== null &&
      (item.deletedAt !== null ||
        itemRelativePath === null ||
        item.itemType !== "file" ||
        !supported)
    ) {
      work.push({
        kind: "delete",
        action: "delete",
        itemId: item.id,
        documentId: item.documentId,
        reason:
          item.deletedAt !== null
            ? "sharepoint_source_deleted"
            : itemRelativePath === null
              ? "sharepoint_source_moved_out_of_scope"
              : "sharepoint_source_no_longer_supported",
      });
      continue;
    }
    if (
      item.deletedAt !== null ||
      itemRelativePath === null ||
      item.itemType !== "file"
    ) {
      if (item.itemType === "file" && item.syncStatus !== "synced") {
        work.push({ kind: "skip", action: "skip", itemId: item.id });
      }
      continue;
    }
    if (!supported) {
      if (
        item.syncStatus !== "synced" ||
        item.syncedEtag !== item.etag ||
        item.syncedCtag !== item.ctag
      ) {
        work.push({ kind: "skip", action: "skip", itemId: item.id });
      }
      continue;
    }
    const contentNeedsSync =
      item.documentId === null ||
      item.syncedEtag !== item.etag ||
      item.syncedCtag !== item.ctag;
    const currentEntry =
      item.documentId === null
        ? undefined
        : directoryEntryByDocumentId.get(item.documentId);
    const locationNeedsSync =
      currentEntry === undefined ||
      currentEntry.sourceItemId !== item.id ||
      knowledgeEntryPath(currentEntry, directoryEntryById) !== itemRelativePath;
    const document =
      item.documentId === null ? undefined : documents.get(item.documentId);
    const retryProcessing =
      document !== undefined && shouldRetrySourceDocument(document);
    const resumeActiveProcessing =
      item.syncStatus === "failed" &&
      item.syncFailurePhase === "processing" &&
      document !== undefined &&
      document.activeProcessingVersionId !== null;
    const contentUnchanged =
      item.documentId !== null &&
      item.ctag !== null &&
      item.syncedCtag === item.ctag;
    if (resumeActiveProcessing) {
      work.push({
        kind: "wait",
        action: "retry",
        itemId: item.id,
        documentId: item.documentId!,
      });
    } else if (retryProcessing && (!contentNeedsSync || contentUnchanged)) {
      work.push({
        kind: "retry",
        action: "retry",
        itemId: item.id,
        documentId: item.documentId!,
        ...(locationNeedsSync
          ? {
              rename: {
                displayName: item.name,
                relativePath: itemRelativePath,
              },
            }
          : {}),
      });
    } else if (contentNeedsSync && contentUnchanged) {
      work.push({
        kind: "rename",
        action: "update",
        itemId: item.id,
        documentId: item.documentId!,
        displayName: item.name,
        relativePath: itemRelativePath,
      });
    } else if (contentNeedsSync) {
      work.push({
        kind: "upload",
        action: item.documentId === null ? "create" : "update",
        itemId: item.id,
        externalItemId: item.externalItemId,
        documentId: item.documentId,
        filename: item.name,
        declaredMimeType: declaredMime(item),
        relativePath: itemRelativePath,
        etag: item.etag,
        ctag: item.ctag,
      });
    } else if (locationNeedsSync) {
      work.push({
        kind: "rename",
        action: "update",
        itemId: item.id,
        documentId: item.documentId!,
        displayName: item.name,
        relativePath: itemRelativePath,
      });
    } else if (item.syncStatus !== "synced") {
      work.push({ kind: "skip", action: "skip", itemId: item.id });
    }
  }
  return work;
}

export async function executeKnowledgeSourceWorkItems(input: {
  prisma: PrismaClient;
  knowledge: KnowledgeService;
  source: { id: string; knowledgeBaseId: string; driveId: string };
  graph: SharePointGraphClient;
  actor: KnowledgeActor;
  runId: string;
  work: KnowledgeSourceWorkItem[];
  now: () => Date;
  extendLease: () => Promise<void>;
}): Promise<void> {
  for (const item of input.work) {
    await input.extendLease();
    await input.prisma.$transaction((transaction) =>
      markKnowledgeSourceItemProcessing(transaction, {
        itemId: item.itemId,
        runId: input.runId,
        action: item.action,
      }),
    );
    try {
      if (item.kind === "wait") {
        continue;
      } else if (item.kind === "delete") {
        await input.knowledge.deleteDocument(
          input.actor,
          input.source.knowledgeBaseId,
          item.documentId,
          item.reason,
        );
        await input.prisma.$transaction(async (transaction) => {
          await transaction.knowledgeSourceItem.update({
            where: { id: item.itemId },
            data: { documentId: null },
          });
          await completeKnowledgeSourceItem(transaction, {
            itemId: item.itemId,
            runId: input.runId,
            action: item.action,
            now: input.now(),
          });
        });
      } else if (item.kind === "skip") {
        await input.prisma.$transaction((transaction) =>
          completeKnowledgeSourceItem(transaction, {
            itemId: item.itemId,
            runId: input.runId,
            action: item.action,
            now: input.now(),
          }),
        );
      } else if (item.kind === "rename") {
        await input.knowledge.renameDocument(
          input.actor,
          input.source.knowledgeBaseId,
          item.documentId,
          {
            displayName: item.displayName,
            relativePath: item.relativePath,
            sourceItemId: item.itemId,
          },
        );
        await input.prisma.$transaction((transaction) =>
          completeKnowledgeSourceItem(transaction, {
            itemId: item.itemId,
            runId: input.runId,
            action: item.action,
            now: input.now(),
          }),
        );
      } else if (item.kind === "retry") {
        if (item.rename) {
          await input.knowledge.renameDocument(
            input.actor,
            input.source.knowledgeBaseId,
            item.documentId,
            {
              ...item.rename,
              sourceItemId: item.itemId,
            },
          );
        }
        await input.knowledge.retryDocument(
          input.actor,
          input.source.knowledgeBaseId,
          item.documentId,
        );
      } else {
        const document = await input.knowledge.uploadDocument(
          input.actor,
          input.source.knowledgeBaseId,
          item.documentId
            ? {
                filename: item.filename,
                declaredMimeType: item.declaredMimeType,
                stream: await input.graph.download(
                  input.source.driveId,
                  item.externalItemId,
                ),
                conflictResolution: "replace",
                replaceDocumentId: item.documentId,
                relativePath: item.relativePath,
                sourceItemId: item.itemId,
              }
            : {
                filename: item.filename,
                declaredMimeType: item.declaredMimeType,
                stream: await input.graph.download(
                  input.source.driveId,
                  item.externalItemId,
                ),
                conflictResolution: "keep_both",
                relativePath: item.relativePath,
                sourceItemId: item.itemId,
              },
        );
        await input.prisma.knowledgeSourceItem.update({
          where: { id: item.itemId },
          data: {
            documentId: document.id,
            syncedEtag: item.etag,
            syncedCtag: item.ctag,
          },
        });
      }
    } catch (error) {
      const registeredUploadDocumentId =
        item.kind === "upload"
          ? documentIdFromRegisteredUploadFailure(error)
          : null;
      if (item.kind === "upload") {
        await checkpointRegisteredUploadAfterEnqueueFailure({
          prisma: input.prisma,
          item,
          runId: input.runId,
          documentId: registeredUploadDocumentId,
        });
      }
      const stableErrorCode =
        error instanceof AppError
          ? error.code
          : "KNOWLEDGE_SOURCE_SYNC_UNAVAILABLE";
      await input.prisma.$transaction((transaction) =>
        failKnowledgeSourceItem(transaction, {
          itemId: item.itemId,
          runId: input.runId,
          phase:
            item.kind === "retry" || registeredUploadDocumentId !== null
              ? "processing"
              : "syncing",
          stableErrorCode,
          now: input.now(),
        }),
      );
    }
  }
}

async function checkpointRegisteredUploadAfterEnqueueFailure(input: {
  prisma: PrismaClient;
  item: Extract<KnowledgeSourceWorkItem, { kind: "upload" }>;
  runId: string;
  documentId: string | null;
}): Promise<void> {
  if (input.documentId === null) return;
  await input.prisma.knowledgeSourceItem.updateMany({
    where: {
      id: input.item.itemId,
      lastSyncRunId: input.runId,
      syncStatus: "processing",
    },
    data: {
      documentId: input.documentId,
      syncedEtag: input.item.etag,
      syncedCtag: input.item.ctag,
    },
  });
}

function documentIdFromRegisteredUploadFailure(error: unknown): string | null {
  if (
    !(error instanceof AppError) ||
    error.code !== "KNOWLEDGE_PROCESSING_UNAVAILABLE"
  ) {
    return null;
  }
  const documentId = uuidSchema.safeParse(error.params?.document_id);
  return documentId.success ? documentId.data : null;
}

export function isDescendantOf<
  T extends {
    externalItemId: string;
    parentExternalItemId: string | null;
  },
>(item: T, rootId: string, byId: Map<string, T>): boolean {
  let current: T | undefined = item;
  const visited = new Set<string>();
  while (current) {
    if (
      current.externalItemId === rootId ||
      current.parentExternalItemId === rootId
    ) {
      return true;
    }
    if (!current.parentExternalItemId || visited.has(current.externalItemId)) {
      return false;
    }
    visited.add(current.externalItemId);
    current = byId.get(current.parentExternalItemId);
  }
  return false;
}

export function sourceRelativePath<
  T extends {
    externalItemId: string;
    parentExternalItemId: string | null;
    name: string;
    deletedAt?: Date | null;
  },
>(
  item: T,
  rootId: string,
  rootName: string,
  byId: Map<string, T>,
): string | null {
  if (item.deletedAt) return null;
  const names = [item.name];
  const visited = new Set<string>([item.externalItemId]);
  let parentId = item.parentExternalItemId;
  while (parentId !== rootId) {
    if (parentId === null || visited.has(parentId)) return null;
    visited.add(parentId);
    const parent = byId.get(parentId);
    if (parent === undefined || parent.deletedAt) return null;
    names.push(parent.name);
    parentId = parent.parentExternalItemId;
  }
  names.push(rootName);
  return names.reverse().join("/");
}

export function knowledgeEntryPath<
  T extends {
    id: string;
    parentEntryId: string | null;
    name: string;
  },
>(entry: T, byId: Map<string, T>): string | null {
  const names = [entry.name];
  const visited = new Set<string>([entry.id]);
  let parentId = entry.parentEntryId;
  while (parentId !== null) {
    if (visited.has(parentId)) return null;
    visited.add(parentId);
    const parent = byId.get(parentId);
    if (parent === undefined) return null;
    names.push(parent.name);
    parentId = parent.parentEntryId;
  }
  return names.reverse().join("/");
}

export function shouldRetrySourceDocument(document: {
  status: string;
  candidateVersionId: string | null;
  activeProcessingVersionId: string | null;
  stableErrorCode: string | null;
}): boolean {
  return (
    document.status === "failed" ||
    (document.status === "ready" &&
      document.candidateVersionId !== null &&
      document.activeProcessingVersionId === null &&
      document.stableErrorCode !== null)
  );
}

function isSupportedName(name: string): boolean {
  const extension = extname(name).slice(1).toLocaleLowerCase("en-US");
  return SHAREPOINT_SYNC_EXTENSIONS.has(extension);
}

const SHAREPOINT_SYNC_EXTENSIONS = new Set<string>(knowledgeDocumentFormats);

function declaredMime(item: {
  name: string;
  mimeType: string | null;
}): string {
  if (item.mimeType && item.mimeType !== "application/octet-stream") {
    return item.mimeType;
  }
  const extension = extname(item.name).slice(1).toLocaleLowerCase("en-US");
  const fallback: Record<string, string> = {
    pdf: "application/pdf",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    doc: "application/msword",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    xls: "application/vnd.ms-excel",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ppt: "application/vnd.ms-powerpoint",
    txt: "text/plain",
    md: "text/markdown",
    html: "text/html",
    htm: "text/html",
    csv: "text/csv",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    tif: "image/tiff",
    tiff: "image/tiff",
    bmp: "image/bmp",
    webp: "image/webp",
    odt: "application/vnd.oasis.opendocument.text",
    ods: "application/vnd.oasis.opendocument.spreadsheet",
    odp: "application/vnd.oasis.opendocument.presentation",
  };
  return fallback[extension] ?? "application/octet-stream";
}
