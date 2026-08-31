import { Readable } from "node:stream";

import { describe, expect, it, vi } from "vitest";

import type { PrismaClient } from "../src/generated/prisma/client.js";
import { AppError } from "../src/lib/errors.js";
import { executeKnowledgeSourceWorkItems } from "../src/modules/knowledge-sources/work-items.js";

describe("knowledge source work item checkpoints", () => {
  it("checkpoints a registered upload before marking enqueue failure so retry can reuse it", async () => {
    const sourceId = "00000000-0000-4000-8000-000000000601";
    const baseId = "00000000-0000-4000-8000-000000000602";
    const itemId = "00000000-0000-4000-8000-000000000603";
    const runId = "00000000-0000-4000-8000-000000000604";
    const documentId = "00000000-0000-4000-8000-000000000605";
    const markItem = vi.fn(async () => ({}));
    const failItem = vi.fn(async () => ({ count: 1 }));
    const checkpointUpload = vi.fn(async () => ({ count: 1 }));
    const transaction = {
      knowledgeSourceItem: {
        update: markItem,
        updateMany: failItem,
      },
      knowledgeSourceSyncRun: {
        updateMany: vi.fn(async () => ({ count: 1 })),
        findFirst: vi.fn(async () => null),
      },
    };
    const prisma = {
      knowledgeSourceItem: { updateMany: checkpointUpload },
      $transaction: vi.fn(
        async (work: (client: typeof transaction) => Promise<unknown>) =>
          work(transaction),
      ),
    } as unknown as PrismaClient;
    const download = vi.fn(async () => Readable.from(["pdf"]));
    const uploadDocument = vi.fn(async () => {
      throw new AppError("KNOWLEDGE_PROCESSING_UNAVAILABLE", {
        document_id: documentId,
      });
    });

    await executeKnowledgeSourceWorkItems({
      prisma,
      knowledge: { uploadDocument } as never,
      source: { id: sourceId, knowledgeBaseId: baseId, driveId: "drive-1" },
      graph: { download } as never,
      actor: { id: "owner-1", role: "user", status: "active" },
      runId,
      work: [
        {
          kind: "upload",
          action: "create",
          itemId,
          externalItemId: "sharepoint-item-1",
          documentId: null,
          filename: "policy.pdf",
          declaredMimeType: "application/pdf",
          relativePath: "Policies/policy.pdf",
          etag: "etag-1",
          ctag: "ctag-1",
        },
      ],
      now: () => new Date("2026-08-12T02:00:00.000Z"),
      extendLease: vi.fn(async () => undefined),
    });

    expect(download).toHaveBeenCalledTimes(1);
    expect(checkpointUpload).toHaveBeenCalledWith({
      where: {
        id: itemId,
        lastSyncRunId: runId,
        syncStatus: "processing",
      },
      data: {
        documentId,
        syncedEtag: "etag-1",
        syncedCtag: "ctag-1",
      },
    });
    expect(failItem).toHaveBeenCalledWith({
      where: {
        id: itemId,
        lastSyncRunId: runId,
        syncStatus: "processing",
      },
      data: {
        syncStatus: "failed",
        syncAction: null,
        syncFailurePhase: "processing",
        stableErrorCode: "KNOWLEDGE_PROCESSING_UNAVAILABLE",
      },
    });
    expect(checkpointUpload.mock.invocationCallOrder[0]).toBeLessThan(
      failItem.mock.invocationCallOrder[0]!,
    );
  });
});
