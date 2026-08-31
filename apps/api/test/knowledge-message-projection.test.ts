import { describe, expect, it, vi } from "vitest";

import type { Prisma } from "../src/generated/prisma/client.js";
import { createProjectedAssistantMessage } from "../src/modules/events/knowledge-message-projection.js";

const knowledgeBaseId = "10000000-0000-4000-8000-000000000001";
const documentId = "20000000-0000-4000-8000-000000000001";
const documentVersionId = "30000000-0000-4000-8000-000000000001";
const conversationId = "40000000-0000-4000-8000-000000000001";
const turnId = "50000000-0000-4000-8000-000000000001";
const messageId = "60000000-0000-4000-8000-000000000001";

describe("createProjectedAssistantMessage", () => {
  it("writes the cleaned body, citation and ordered anchors through one transaction client", async () => {
    const fixture = transactionFixture();

    await createProjectedAssistantMessage(fixture.transaction, {
      conversationId,
      turnId,
      projection: {
        contentText: "结论来自知识库。",
        citations: [
          {
            citationNo: 1,
            knowledgeBaseId,
            documentId,
            documentVersionId,
            parentId: "parent-1",
            titlePath: ["第一章"],
            matchedChildIds: ["child-1"],
            pageNumbers: [1],
            anchors: [
              { occurrenceNo: 1, anchorAfterOffsetUtf16: 4 },
              { occurrenceNo: 2, anchorAfterOffsetUtf16: 8 },
            ],
          },
        ],
      },
    });

    expect(fixture.createMessage).toHaveBeenCalledWith({
      data: {
        conversationId,
        turnId,
        sequenceNo: 3,
        role: "assistant",
        contentText: "结论来自知识库。",
      },
    });
    expect(fixture.createCitation).toHaveBeenCalledWith({
      data: expect.objectContaining({
        messageId,
        citationNo: 1,
        documentVersionId,
        knowledgeBaseNameSnapshot: "售后知识库",
        documentNameSnapshot: "售后政策.pdf",
        parentId: "parent-1",
        titlePath: ["第一章"],
        matchedChildIds: ["child-1"],
        pageNumbers: [1],
      }),
    });
    expect(fixture.retainVersions).toHaveBeenCalledWith({
      where: { id: { in: [documentVersionId] } },
      data: { cleanupEligibleAt: null },
    });
    expect(fixture.createAnchors).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({ occurrenceNo: 1, anchorAfterOffsetUtf16: 4 }),
        expect.objectContaining({ occurrenceNo: 2, anchorAfterOffsetUtf16: 8 }),
      ],
    });
  });

  it("fails the transaction projection when the exact source version does not match", async () => {
    const fixture = transactionFixture();
    fixture.findVersions.mockResolvedValueOnce([
      {
        id: documentVersionId,
        knowledgeBaseId,
        documentId: "20000000-0000-4000-8000-000000000099",
      },
    ]);

    await expect(
      createProjectedAssistantMessage(fixture.transaction, {
        conversationId,
        turnId,
        projection: {
          contentText: "正文",
          citations: [
            {
              citationNo: 1,
              knowledgeBaseId,
              documentId,
              documentVersionId,
              parentId: "parent-1",
              titlePath: ["第一章"],
              matchedChildIds: ["child-1"],
              pageNumbers: [1],
              anchors: [{ occurrenceNo: 1, anchorAfterOffsetUtf16: 2 }],
            },
          ],
        },
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(fixture.createCitation).not.toHaveBeenCalled();
    expect(fixture.createAnchors).not.toHaveBeenCalled();
  });

  it("fails closed when the cited historical version is already queued for cleanup", async () => {
    const fixture = transactionFixture();
    fixture.findCleanup.mockResolvedValueOnce({ id: "cleanup" });

    await expect(
      createProjectedAssistantMessage(fixture.transaction, {
        conversationId,
        turnId,
        projection: {
          contentText: "正文",
          citations: [
            {
              citationNo: 1,
              knowledgeBaseId,
              documentId,
              documentVersionId,
              parentId: "parent-1",
              titlePath: ["第一章"],
              matchedChildIds: ["child-1"],
              pageNumbers: [1],
              anchors: [{ occurrenceNo: 1, anchorAfterOffsetUtf16: 2 }],
            },
          ],
        },
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(fixture.createCitation).not.toHaveBeenCalled();
  });
});

function transactionFixture() {
  const findLatestMessage = vi.fn().mockResolvedValue({ sequenceNo: 2 });
  const createMessage = vi.fn().mockResolvedValue({ id: messageId });
  const findVersions = vi.fn().mockResolvedValue([
    { id: documentVersionId, knowledgeBaseId, documentId },
  ]);
  const findKnowledgeBases = vi.fn().mockResolvedValue([
    { id: knowledgeBaseId, name: "售后知识库" },
  ]);
  const findDocuments = vi.fn().mockResolvedValue([
    { id: documentId, knowledgeBaseId, displayName: "售后政策.pdf" },
  ]);
  const createCitation = vi
    .fn()
    .mockResolvedValue({ id: "70000000-0000-4000-8000-000000000001" });
  const createAnchors = vi.fn().mockResolvedValue({ count: 2 });
  const retainVersions = vi.fn().mockResolvedValue({ count: 1 });
  const findCleanup = vi.fn().mockResolvedValue(null);
  const database = {
    $queryRaw: vi.fn().mockResolvedValue([]),
    conversationMessage: {
      findFirst: findLatestMessage,
      create: createMessage,
    },
    knowledgeBaseDocumentVersion: {
      findMany: findVersions,
      updateMany: retainVersions,
    },
    knowledgeBase: { findMany: findKnowledgeBases },
    knowledgeBaseDocument: { findMany: findDocuments },
    knowledgeBaseCleanupOutbox: {
      findFirst: findCleanup,
    },
    conversationMessageKnowledgeCitation: { create: createCitation },
    conversationMessageKnowledgeCitationAnchor: { createMany: createAnchors },
  };
  return {
    transaction: database as unknown as Prisma.TransactionClient,
    findVersions,
    findKnowledgeBases,
    findDocuments,
    createMessage,
    createCitation,
    createAnchors,
    retainVersions,
    findCleanup,
  };
}
