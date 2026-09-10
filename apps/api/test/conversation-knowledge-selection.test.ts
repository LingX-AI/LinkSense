import { describe, expect, it, vi } from "vitest";

import { resolveRunnerKnowledgeSelection } from "../src/modules/conversations/knowledge-selection.js";

const owner = "10000000-0000-4000-8000-000000000001";
const a = "20000000-0000-4000-8000-000000000001";
const b = "20000000-0000-4000-8000-000000000002";
const c = "20000000-0000-4000-8000-000000000003";
function fixture() {
  const store = { resolveUsableKnowledgeBaseIds: vi.fn(async (_owner: string, ids: string[]) => ids) };
  const prisma = { knowledgeBase: { findMany: vi.fn(async (input: { where: { id: { in: string[] } } }) =>
    [...input.where.id.in].reverse().map((id) => ({ id, name: id === a ? "Policies" : "资料库" })),
  ) } };
  return { store, prisma };
}

describe("runner knowledge selection metadata", () => {
  it("resolves additions, reductions, replacements, reordering, clearing and reselection as complete snapshots", async () => {
    const { store, prisma } = fixture();
    for (const ids of [[], [a], [b], [a, b], [a, b, c], [c, b], [c], [], [a]]) {
      const snapshot = await resolveRunnerKnowledgeSelection(prisma, store, owner, ids);
      expect(snapshot).toEqual(ids.map((id) => ({ id, name: id === a ? "Policies" : "资料库" })));
    }
    expect(store.resolveUsableKnowledgeBaseIds).toHaveBeenCalledWith(owner, [c, b]);
    expect(prisma.knowledgeBase.findMany).toHaveBeenCalledWith({
      where: { id: { in: [c, b] }, lifecycleStatus: "active", availabilityStatus: "enabled" },
      select: { id: true, name: true },
    });
  });

  it("does not look up names for unauthorized, revoked, disabled or deleted selections", async () => {
    const { store, prisma } = fixture();
    store.resolveUsableKnowledgeBaseIds.mockResolvedValue([a, c]);
    // c is an unrelated result and must not expand the requested scope.
    expect(await resolveRunnerKnowledgeSelection(prisma, store, owner, [b, a])).toEqual([
      { id: b, name: null }, { id: a, name: "Policies" },
    ]);
    expect(prisma.knowledgeBase.findMany.mock.calls[0]?.[0].where.id.in).toEqual([a]);
    store.resolveUsableKnowledgeBaseIds.mockResolvedValue([]);
    prisma.knowledgeBase.findMany.mockClear();
    expect(await resolveRunnerKnowledgeSelection(prisma, store, owner, [a, b])).toEqual([{ id: a, name: null }, { id: b, name: null }]);
    expect(prisma.knowledgeBase.findMany).not.toHaveBeenCalled();
  });

  it("marks a library that disappears after authorization as unavailable", async () => {
    const { store, prisma } = fixture();
    prisma.knowledgeBase.findMany.mockResolvedValue([]);
    expect(await resolveRunnerKnowledgeSelection(prisma, store, owner, [a])).toEqual([{ id: a, name: null }]);
  });

  it("does not read storage for an empty selection and fails closed on missing or failing access checks", async () => {
    const { store, prisma } = fixture();
    expect(await resolveRunnerKnowledgeSelection(prisma, undefined, owner, [])).toEqual([]);
    expect(prisma.knowledgeBase.findMany).not.toHaveBeenCalled();
    await expect(resolveRunnerKnowledgeSelection(prisma, undefined, owner, [a])).rejects.toMatchObject({ code: "KNOWLEDGE_PROCESSING_UNAVAILABLE" });
    store.resolveUsableKnowledgeBaseIds.mockRejectedValue(new Error("access check failed"));
    await expect(resolveRunnerKnowledgeSelection(prisma, store, owner, [a])).rejects.toThrow("access check failed");
    expect(prisma.knowledgeBase.findMany).not.toHaveBeenCalled();
  });

  it("rejects duplicate or invalid IDs before reading any metadata", async () => {
    const { store, prisma } = fixture();
    for (const ids of [[a, a], ["invalid"]]) await expect(resolveRunnerKnowledgeSelection(prisma, store, owner, ids)).rejects.toThrow();
    expect(store.resolveUsableKnowledgeBaseIds).not.toHaveBeenCalled();
    expect(prisma.knowledgeBase.findMany).not.toHaveBeenCalled();
  });
});
