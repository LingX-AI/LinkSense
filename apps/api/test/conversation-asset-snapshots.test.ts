import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import type { PrismaClient } from "../src/generated/prisma/client.js";
import { ConversationAssetSnapshots } from "../src/modules/knowledge/conversation-asset-snapshots.js";
import { KnowledgeTurnAssetReadService } from "../src/modules/knowledge/turn-asset-read.js";
import { knowledgeTurnAssetRoutes } from "../src/modules/knowledge/turn-asset-routes.js";

const OWNER = "00000000-0000-4000-8000-000000000001";
const CONVERSATION = "00000000-0000-4000-8000-000000000002";
const TURN = "00000000-0000-4000-8000-000000000003";
const BASE = "00000000-0000-4000-8000-000000000004";
const DOCUMENT = "00000000-0000-4000-8000-000000000005";
const VERSION = "00000000-0000-4000-8000-000000000006";
const ASSET = "00000000-0000-4000-8000-000000000007";
const SECOND_ASSET = "00000000-0000-4000-8000-000000000008";
const actor = { id: OWNER, status: "active" as const, role: "user" as const };
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aA1sAAAAASUVORK5CYII=",
  "base64",
);
const source = {
  knowledgeBaseId: BASE,
  documentId: DOCUMENT,
  documentVersionId: VERSION,
  assetReferenceIds: [ASSET],
};
const request = {
  actor,
  conversationId: CONVERSATION,
  turnId: TURN,
  sources: [source],
};

function harness() {
  type FileRow = Parameters<
    PrismaClient["conversationFile"]["create"]
  >[0]["data"];
  const rows = new Map<string, FileRow>();
  const objects = new Map<string, Buffer>();
  const findUnique = vi.fn(
    async ({ where }) =>
      rows.get(
        where.conversationId_knowledgeAssetReferenceId
          .knowledgeAssetReferenceId,
      ) ?? null,
  );
  const upsert = vi.fn(async ({ create }) => {
    if (!rows.has(create.knowledgeAssetReferenceId))
      rows.set(create.knowledgeAssetReferenceId, create);
    return rows.get(create.knowledgeAssetReferenceId)!;
  });
  const lockConversation = vi.fn().mockResolvedValue([{ id: CONVERSATION }]);
  const turn = vi.fn().mockResolvedValue({ id: TURN, sequenceNo: 2 });
  const tx = {
    $queryRaw: lockConversation,
    conversationFile: { upsert, findUnique },
    conversationTurn: { findFirst: turn },
    conversationTurnStartIntent: { findFirst: vi.fn().mockResolvedValue(null) },
  };
  const prisma = {
    ...tx,
    conversation: {
      findFirst: vi.fn().mockResolvedValue({ id: CONVERSATION }),
    },
    conversationFile: {
      ...tx.conversationFile,
      findFirst: vi.fn(
        async ({ where }) => rows.get(where.knowledgeAssetReferenceId) ?? null,
      ),
    },
    $transaction: vi.fn(async (fn) => fn(tx)),
  } as unknown as PrismaClient;
  const storage = {
    putObject: vi.fn(async (key: string, data: Buffer) => {
      objects.set(key, data);
    }),
    removeObject: vi.fn(async (key: string) => {
      objects.delete(key);
    }),
    getObjectStream: vi.fn(async (key: string) => {
      const bytes = objects.get(key);
      if (!bytes) throw new Error("missing object");
      return Readable.from(bytes);
    }),
  };
  const getAsset = vi.fn(async () => ({
    filename: "original.png",
    mimeType: "image/png",
    sizeBytes: BigInt(PNG.length),
    stream: Readable.from(PNG),
  }));
  const getTurnRetrievalScope = vi
    .fn()
    .mockResolvedValue({
      usable_ids: [BASE],
      requested_ids: [BASE],
      unavailable_ids: [],
    });
  const enqueueObjectDelete = vi.fn().mockResolvedValue(undefined);
  const service = new ConversationAssetSnapshots(
    prisma,
    storage,
    { getAsset },
    { getTurnRetrievalScope },
    { enqueueObjectDelete },
  );
  return {
    service,
    prisma,
    storage,
    objects,
    rows,
    getAsset,
    getTurnRetrievalScope,
    lockConversation,
    upsert,
    turn,
    enqueueObjectDelete,
  };
}

describe("conversation image snapshot publication", () => {
  it("copies valid images once and records source metadata and checksum", async () => {
    const h = harness();
    await h.service.capture({ ...request, sources: [source, source] });
    await h.service.capture(request);
    expect(h.getAsset).toHaveBeenCalledTimes(1);
    expect(h.storage.putObject).toHaveBeenCalledTimes(1);
    expect(h.storage.putObject).toHaveBeenCalledWith(
      expect.stringContaining(`/conversations/`.slice(1)),
      PNG,
      expect.objectContaining({ "knowledge-document-version-id": VERSION }),
    );
    expect(h.rows.get(ASSET)).toMatchObject({
      conversationId: CONVERSATION,
      turnId: TURN,
      knowledgeAssetReferenceId: ASSET,
      checksumSha256: createHash("sha256").update(PNG).digest("hex"),
      kind: "artifact",
      source: "system_generated",
      storageBackend: "minio",
      downloadable: false,
    });
    // Inline copies have no download card, so they must not advertise the
    // downloadable-artifact contract enforced by PostgreSQL.
    expect(h.rows.get(ASSET)?.downloadCardEventId).toBeUndefined();
  });

  it("deduplicates simultaneous API-instance uploads and removes only losing objects", async () => {
    const h = harness();
    await Promise.all([h.service.capture(request), h.service.capture(request)]);
    expect(h.rows.size).toBe(1);
    expect(h.objects.size).toBe(1);
    expect(h.storage.removeObject).toHaveBeenCalledTimes(1);
    expect(h.objects.has(h.rows.get(ASSET)!.minioObjectKey!)).toBe(true);
  });

  it("serves multiple images through the HTTP route after knowledge access and original storage disappear", async () => {
    const h = harness();
    await h.service.capture({
      ...request,
      sources: [{ ...source, assetReferenceIds: [ASSET, SECOND_ASSET] }],
    });
    h.getAsset.mockRejectedValue(new Error("knowledge base deleted"));
    h.getTurnRetrievalScope.mockRejectedValue(
      new Error("knowledge service offline"),
    );
    const app = Fastify();
    try {
      await app.register(knowledgeTurnAssetRoutes, {
        service: new KnowledgeTurnAssetReadService(h.prisma, h.storage),
        resolveActor: async () => actor,
      });
      for (const assetId of [ASSET, SECOND_ASSET]) {
        const response = await app.inject({
          method: "GET",
          url: `/${CONVERSATION}/turns/${TURN}/knowledge-assets/${assetId}`,
        });
        expect(response.statusCode).toBe(200);
        expect(response.rawPayload).toEqual(PNG);
        expect(response.headers["content-type"]).toBe("image/png");
        expect(response.headers["cache-control"]).toBe("private, no-store");
      }
      expect(h.getAsset).toHaveBeenCalledTimes(2);
    } finally {
      await app.close();
    }
  });

  it("rejects unauthorized knowledge sources before reading their objects", async () => {
    const h = harness();
    h.getTurnRetrievalScope.mockResolvedValue({
      usable_ids: [],
      requested_ids: [BASE],
      unavailable_ids: [BASE],
    });
    await expect(h.service.capture(request)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(h.getAsset).not.toHaveBeenCalled();
  });

  it.each(["revoked", "conversation deleted", "database failure"])(
    "cleans the copy when %s during publication",
    async (failure) => {
      const h = harness();
      if (failure === "revoked")
        h.getTurnRetrievalScope
          .mockResolvedValueOnce({ usable_ids: [BASE] })
          .mockResolvedValue({ usable_ids: [] });
      if (failure === "conversation deleted")
        h.lockConversation.mockResolvedValue([]);
      if (failure === "database failure")
        h.upsert.mockRejectedValue(new Error("database failure"));
      await expect(h.service.capture(request)).rejects.toThrow();
      expect(h.rows.size).toBe(0);
      expect(h.objects.size).toBe(0);
      expect(h.storage.removeObject).toHaveBeenCalledTimes(1);
    },
  );

  it("schedules retryable cleanup when removing an uncommitted object fails", async () => {
    const h = harness();
    h.lockConversation.mockResolvedValue([]);
    h.storage.removeObject.mockRejectedValue(new Error("storage offline"));
    await expect(h.service.capture(request)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(h.enqueueObjectDelete).toHaveBeenCalledWith(
      h.storage.putObject.mock.calls[0]![0],
    );
  });

  it.each(["oversized", "truncated", "not an image"])(
    "rejects %s input without publishing a file",
    async (failure) => {
      const h = harness();
      h.getAsset.mockResolvedValue({
        filename: "untrusted.png",
        mimeType: "image/png",
        sizeBytes:
          failure === "oversized"
            ? 20_000_000n
            : failure === "truncated"
              ? BigInt(PNG.length + 1)
              : 4n,
        stream: Readable.from(
          failure === "not an image" ? Buffer.from("html") : PNG,
        ),
      });
      await expect(h.service.capture(request)).rejects.toThrow();
      expect(h.storage.putObject).not.toHaveBeenCalled();
    },
  );
});
