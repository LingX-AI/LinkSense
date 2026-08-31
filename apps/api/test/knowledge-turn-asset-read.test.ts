import { Readable } from "node:stream";

import { describe, expect, it, vi } from "vitest";

import type { PrismaClient } from "../src/generated/prisma/client.js";
import { KnowledgeTurnAssetReadService } from "../src/modules/knowledge/turn-asset-read.js";

const ACTOR = {
  id: "00000000-0000-4000-8000-000000000001",
  role: "user" as const,
  status: "active" as const,
};
const CONVERSATION_ID = "00000000-0000-4000-8000-000000000002";
const TURN_ID = "00000000-0000-4000-8000-000000000003";
const PREVIOUS_TURN_ID = "00000000-0000-4000-8000-000000000008";
const FUTURE_TURN_ID = "00000000-0000-4000-8000-000000000009";
const BASE_ID = "00000000-0000-4000-8000-000000000004";
const DOCUMENT_ID = "00000000-0000-4000-8000-000000000005";
const VERSION_ID = "00000000-0000-4000-8000-000000000006";
const ASSET_ID = "00000000-0000-5000-8000-000000000007";
const PARENT_ID = "00000000-0000-5000-8000-000000000010";
const CHILD_ID = `${VERSION_ID}:0:child`;

function createHarness(
  options: {
    owner?: boolean;
    turn?: boolean;
    registeredAssetIds?: string[];
    previousRegisteredAssetIds?: string[];
    usableKnowledgeBaseIds?: string[];
    persistentCitationTurnId?: string;
    evidenceParentText?: string;
  } = {},
) {
  const historicalTurnIds =
    options.previousRegisteredAssetIds === undefined
      ? []
      : [{ id: PREVIOUS_TURN_ID }];
  const citationTurnId = options.persistentCitationTurnId;
  const prisma = {
    conversation: {
      findFirst: vi
        .fn()
        .mockResolvedValue(
          options.owner === false ? null : { id: CONVERSATION_ID },
        ),
    },
    conversationTurn: {
      findFirst: vi
        .fn()
        .mockResolvedValue(
          options.turn === false ? null : { id: TURN_ID, sequenceNo: 2 },
        ),
      findMany: vi.fn(async (args) => {
        if ("id" in args.where) {
          return citationTurnId === PREVIOUS_TURN_ID
            ? [{ id: PREVIOUS_TURN_ID }]
            : [];
        }
        return historicalTurnIds;
      }),
    },
    knowledgeBaseObject: {
      findMany: vi.fn().mockResolvedValue([
        {
          knowledgeBaseId: BASE_ID,
          documentId: DOCUMENT_ID,
          documentVersionId: VERSION_ID,
        },
      ]),
    },
    conversationMessageKnowledgeCitation: {
      findMany: vi.fn().mockResolvedValue(
        citationTurnId === undefined
          ? []
          : [
              {
                turnId: citationTurnId,
                knowledgeBaseId: BASE_ID,
                documentId: DOCUMENT_ID,
                documentVersionId: VERSION_ID,
                parentId: PARENT_ID,
                matchedChildIds: [CHILD_ID],
                createdAt: new Date("2026-07-28T00:00:00.000Z"),
              },
            ],
      ),
    },
  } as unknown as PrismaClient;
  const readAssetSources = vi.fn(async (turnId: string) => [
    {
      knowledgeBaseId: BASE_ID,
      documentId: DOCUMENT_ID,
      documentVersionId: VERSION_ID,
      parentId: PARENT_ID,
      titlePath: ["第一章"],
      matchedChildIds: [CHILD_ID],
      pageNumbers: [1],
      assetReferenceIds:
        turnId === TURN_ID
          ? (options.registeredAssetIds ?? [ASSET_ID])
          : (options.previousRegisteredAssetIds ?? []),
    },
  ]);
  const getTurnRetrievalScope = vi.fn().mockResolvedValue({
    requested_ids: [BASE_ID],
    usable_ids: options.usableKnowledgeBaseIds ?? [BASE_ID],
    unavailable_ids: [],
  });
  const getAsset = vi.fn().mockResolvedValue({
    filename: "asset.png",
    mimeType: "image/png",
    sizeBytes: 3n,
    stream: Readable.from("png"),
  });
  const getParentEvidence = vi.fn().mockResolvedValue({
    parentId: PARENT_ID,
    parentText:
      options.evidenceParentText ??
      `# 第一章\n\n![步骤图](kb-asset://${ASSET_ID})`,
    matchedChildren: [
      {
        childId: CHILD_ID,
        order: 0,
        rawText: "步骤图",
        titlePath: ["第一章"],
        pageNumbers: [1],
      },
    ],
  });
  return {
    service: new KnowledgeTurnAssetReadService(
      prisma,
      { readAssetSources },
      { getTurnRetrievalScope },
      { getAsset },
      { getParentEvidence },
    ),
    prisma,
    readAssetSources,
    getTurnRetrievalScope,
    getAsset,
    getParentEvidence,
  };
}

describe("KnowledgeTurnAssetReadService", () => {
  it("loads an asset registered by retrieval for the owned turn", async () => {
    const harness = createHarness();

    await expect(
      harness.service.getAsset(ACTOR, CONVERSATION_ID, TURN_ID, ASSET_ID),
    ).resolves.toMatchObject({ filename: "asset.png", mimeType: "image/png" });
    expect(harness.readAssetSources).toHaveBeenCalledWith(TURN_ID);
    expect(harness.getTurnRetrievalScope).toHaveBeenCalledWith(ACTOR, {
      turnId: TURN_ID,
    });
    expect(harness.getAsset).toHaveBeenCalledWith({
      actorId: ACTOR.id,
      knowledgeBaseId: BASE_ID,
      documentId: DOCUMENT_ID,
      documentVersionId: VERSION_ID,
      assetReferenceId: ASSET_ID,
    });
  });

  it.each([
    ["another owner", { owner: false }],
    ["another conversation turn", { turn: false }],
    ["an unregistered asset", { registeredAssetIds: [] }],
    ["revoked knowledge access", { usableKnowledgeBaseIds: [] }],
  ])("fails closed for %s", async (_label, options) => {
    const harness = createHarness(options);

    await expect(
      harness.service.getAsset(ACTOR, CONVERSATION_ID, TURN_ID, ASSET_ID),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(harness.getAsset).not.toHaveBeenCalled();
  });

  it("loads an asset registered by a previous turn in the same conversation", async () => {
    const harness = createHarness({
      registeredAssetIds: [],
      previousRegisteredAssetIds: [ASSET_ID],
    });

    await expect(
      harness.service.getAsset(ACTOR, CONVERSATION_ID, TURN_ID, ASSET_ID),
    ).resolves.toMatchObject({ filename: "asset.png" });
    expect(harness.readAssetSources).toHaveBeenCalledWith(PREVIOUS_TURN_ID);
    expect(harness.getAsset).toHaveBeenCalledWith(
      expect.objectContaining({ assetReferenceId: ASSET_ID }),
    );
  });

  it("recovers expired transient provenance from a prior persisted citation", async () => {
    const harness = createHarness({
      registeredAssetIds: [],
      persistentCitationTurnId: PREVIOUS_TURN_ID,
    });

    await expect(
      harness.service.getAsset(ACTOR, CONVERSATION_ID, TURN_ID, ASSET_ID),
    ).resolves.toMatchObject({ filename: "asset.png" });
    expect(harness.getParentEvidence).toHaveBeenCalledWith({
      knowledgeBaseId: BASE_ID,
      documentId: DOCUMENT_ID,
      documentVersionId: VERSION_ID,
      parentId: PARENT_ID,
      matchedChildIds: [CHILD_ID],
    });
  });

  it.each([
    [
      "a citation from a later turn",
      {
        persistentCitationTurnId: FUTURE_TURN_ID,
      },
    ],
    [
      "a citation whose parent does not contain the asset",
      {
        persistentCitationTurnId: PREVIOUS_TURN_ID,
        evidenceParentText: "# 第一章\n\n没有图片",
      },
    ],
  ])("fails closed for %s", async (_label, options) => {
    const harness = createHarness({ registeredAssetIds: [], ...options });

    await expect(
      harness.service.getAsset(ACTOR, CONVERSATION_ID, TURN_ID, ASSET_ID),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(harness.getAsset).not.toHaveBeenCalled();
  });
});
