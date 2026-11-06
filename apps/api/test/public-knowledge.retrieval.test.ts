import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "../src/generated/prisma/client.js";
import { createPublicKnowledgeRetriever } from "../src/modules/public-knowledge/retrieval.js";
import type { FusedParentCandidate } from "../src/modules/knowledge-processing/retrieval.js";

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const parent: FusedParentCandidate = {
  parentId: id(1),
  parentOrder: 0,
  knowledgeBaseId: id(2),
  documentId: id(3),
  documentVersionId: id(4),
  titlePath: [],
  parentText: "Official website evidence",
  pageNumbers: [],
  childIds: [],
  childCount: 0,
  matchedChildren: [],
  score: 1,
  rrfScore: 1,
};
const input = {
  ownerId: id(5),
  knowledgeBaseIds: [id(2)],
  query: "website",
  conversationId: id(6),
  turnId: id(7),
};
function fixture() {
  const db = {
    user: { findFirst: vi.fn(async () => ({ id: input.ownerId })) },
    knowledgeBaseDocument: {
      findFirst: vi.fn(
        async (): Promise<{ id: string; displayName: string } | null> => ({
          id: parent.documentId,
          displayName: "Product page",
        }),
      ),
    },
  };
  const knowledge = {
    resolveUsableKnowledgeBaseIds: vi.fn(async () => [id(2)]),
  };
  const search = vi.fn(async () => ({
    parents: [parent],
    ranking: "rrf" as const,
  }));
  return {
    db,
    knowledge,
    search,
    retrieve: createPublicKnowledgeRetriever(
      db as unknown as PrismaClient,
      knowledge,
      { search },
    ),
  };
}
describe("public knowledge evidence boundaries", () => {
  it("retrieves only the published selection and rechecks permission before returning evidence", async () => {
    const f = fixture();
    const result = await f.retrieve(input);
    expect(f.search).toHaveBeenCalledWith(
      expect.objectContaining({ authorizedKnowledgeBaseIds: [id(2)] }),
    );
    expect(f.knowledge.resolveUsableKnowledgeBaseIds).toHaveBeenCalledTimes(2);
    expect(result.citations[0]).toMatchObject({
      title: "Product page",
      excerpt: "Official website evidence",
      document_version_id: id(4),
    });
    expect(result.context).not.toContain(parent.documentId);
  });
  it("fails closed when website permission is revoked during retrieval", async () => {
    const f = fixture();
    f.knowledge.resolveUsableKnowledgeBaseIds
      .mockResolvedValueOnce([id(2)])
      .mockResolvedValueOnce([]);
    await expect(f.retrieve(input)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
  it("excludes stale document versions and unexpected libraries from search results", async () => {
    const f = fixture();
    f.search.mockResolvedValueOnce({
      parents: [{ ...parent, knowledgeBaseId: id(99) }, parent],
      ranking: "rrf",
    });
    f.db.knowledgeBaseDocument.findFirst.mockResolvedValueOnce(null);
    expect((await f.retrieve(input)).citations).toEqual([]);
  });
  it("does not invoke search for a disabled creator or an unavailable knowledge base", async () => {
    const f = fixture();
    f.knowledge.resolveUsableKnowledgeBaseIds.mockResolvedValueOnce([]);
    await expect(f.retrieve(input)).rejects.toMatchObject({
      code: "APPLICATION_DEPENDENCY_UNAVAILABLE",
    });
    expect(f.search).not.toHaveBeenCalled();
  });
  it.each(["官网产品资料".repeat(2000), "\u0001".repeat(6000)])(
    "bounds encoded multilingual and escaped evidence for persistence and native input",
    async (text) => {
      const f = fixture();
      f.search.mockResolvedValueOnce({
        parents: Array.from({ length: 6 }, (_, n) => ({
          ...parent,
          parentId: id(20 + n),
          parentText: text,
        })),
        ranking: "rrf",
      });
      const result = await f.retrieve(input);
      expect(result.citations).toHaveLength(6);
      expect(
        Buffer.byteLength(JSON.stringify(result.citations), "utf8"),
      ).toBeLessThanOrEqual(90_000);
      expect(result.context.length).toBeLessThanOrEqual(50_000);
      expect(result.citations.every((item) => item.excerpt.length > 0)).toBe(
        true,
      );
    },
  );
});
