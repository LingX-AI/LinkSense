import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "../src/generated/prisma/client.js";
import { KnowledgeTurnAssetReadService } from "../src/modules/knowledge/turn-asset-read.js";

const ACTOR = { id: "owner", role: "user" as const, status: "active" as const };

function harness() {
  const conversation = vi.fn().mockResolvedValue({ id: "conversation" });
  const turn = vi.fn().mockResolvedValue({ id: "turn", sequenceNo: 2 });
  const file = vi.fn().mockResolvedValue({
    id: "file",
    turnId: "first-turn",
    filename: "image.png",
    mimeType: "image/png",
    sizeBytes: 3n,
    minioObjectKey: "snapshot/image.png",
  });
  const getObjectStream = vi.fn(async () => Readable.from("png"));
  const prisma = {
    conversation: { findFirst: conversation },
    conversationTurn: { findFirst: turn },
    conversationFile: { findFirst: file },
  } as unknown as PrismaClient;
  return {
    conversation,
    turn,
    file,
    getObjectStream,
    service: new KnowledgeTurnAssetReadService(prisma, { getObjectStream }),
  };
}

describe("conversation knowledge image snapshots", () => {
  it("reads a previous-turn snapshot without knowledge selection, Redis or the knowledge base", async () => {
    const h = harness();
    const image = await h.service.getAsset(
      ACTOR,
      "conversation",
      "turn",
      "asset",
    );
    expect(image.mimeType).toBe("image/png");
    expect(h.getObjectStream).toHaveBeenCalledWith("snapshot/image.png");
    expect(h.file).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          conversationId: "conversation",
          knowledgeAssetReferenceId: "asset",
          kind: "artifact",
          source: "system_generated",
          status: "registered",
        }),
      }),
    );
    expect(h.turn).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: {
          id: "first-turn",
          conversationId: "conversation",
          sequenceNo: { lte: 2 },
        },
      }),
    );
    image.stream.destroy();
  });

  it("does not backfill a historical reference with no snapshot", async () => {
    const h = harness();
    h.file.mockResolvedValue(null);
    await expect(
      h.service.getAsset(ACTOR, "conversation", "turn", "asset"),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(h.getObjectStream).not.toHaveBeenCalled();
  });

  it.each([
    "foreign conversation",
    "foreign turn",
    "future source turn",
    "disabled actor",
  ])("denies %s before accessing object storage", async (scenario) => {
    const h = harness();
    if (scenario === "foreign conversation")
      h.conversation.mockResolvedValue(null);
    if (scenario === "foreign turn") h.turn.mockResolvedValue(null);
    if (scenario === "future source turn") {
      h.turn
        .mockResolvedValueOnce({ id: "turn", sequenceNo: 2 })
        .mockResolvedValueOnce(null);
    }
    const actor =
      scenario === "disabled actor"
        ? { ...ACTOR, status: "disabled" as const }
        : ACTOR;
    await expect(
      h.service.getAsset(actor, "conversation", "turn", "asset"),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(h.getObjectStream).not.toHaveBeenCalled();
  });

  it("maps missing snapshot storage to a stable error without using the original knowledge image", async () => {
    const h = harness();
    h.getObjectStream.mockRejectedValue(new Error("private storage details"));
    await expect(
      h.service.getAsset(ACTOR, "conversation", "turn", "asset"),
    ).rejects.toMatchObject({ code: "ARTIFACT_NOT_FOUND" });
  });
});
