import { describe, expect, it, vi } from "vitest";

import { AppError } from "../src/lib/errors.js";
import type { ApplicationService } from "../src/modules/applications/service.js";
import type { KnowledgeService } from "../src/modules/knowledge/service.js";
import { createTurnKnowledgeScopeResolver } from "../src/modules/knowledge/turn-scope.js";

const actor = { id: "user", role: "user", status: "active" } as const;
const locator = { turnId: "turn" };

function fixture(selected: string[], accessible: string[], delegated: string[] = []) {
  const knowledge = {
    getTurnRetrievalScope: vi.fn<KnowledgeService["getTurnRetrievalScope"]>().mockResolvedValue({
      requested_ids: selected,
      usable_ids: accessible,
      unavailable_ids: selected.filter((id) => !accessible.includes(id)),
    }),
    listDocuments: vi.fn<KnowledgeService["listDocuments"]>(),
    listDocumentsForAuthorizedApplicationTurn: vi.fn<KnowledgeService["listDocumentsForAuthorizedApplicationTurn"]>(),
    getParsedContentChunk: vi.fn<KnowledgeService["getParsedContentChunk"]>(),
    getParsedContentChunkForAuthorizedApplicationTurn: vi.fn<KnowledgeService["getParsedContentChunkForAuthorizedApplicationTurn"]>(),
  };
  const applications = {
    resolveUsableKnowledgeBaseIdsForTurn: vi.fn<ApplicationService["resolveUsableKnowledgeBaseIdsForTurn"]>()
      .mockImplementation(async (_actor, _locator, requested) => requested.filter((id) => delegated.includes(id))),
  };
  return { knowledge, applications, scope: createTurnKnowledgeScopeResolver(knowledge, applications) };
}

describe("turn knowledge access", () => {
  it.each([[], ["personal"], ["shared"], ["personal", "shared"], ["revoked"]].map((selected) => ({ selected })))(
    "preserves all user access independently of selection %j",
    async ({ selected }) => {
      const { scope } = fixture(selected, ["personal", "shared"]);
      const result = await scope.getTurnRetrievalScope(actor, locator);
      expect(new Set(result.usable_ids)).toEqual(new Set(["personal", "shared"]));
      expect(result.requested_ids).toEqual(selected);
      expect(result.unavailable_ids).toEqual(selected.filter((id) => id === "revoked"));
    },
  );

  it("combines user access with explicit application grants and prioritizes the current selection", async () => {
    const { scope } = fixture(["application", "shared", "denied"], ["personal", "shared"], ["application"]);
    await expect(scope.getTurnRetrievalScope(actor, locator)).resolves.toEqual({
      requested_ids: ["application", "shared", "denied"],
      usable_ids: ["application", "shared", "personal"],
      unavailable_ids: ["denied"],
    });
  });

  it("does not expose the creator's other libraries to an application user", async () => {
    const { scope } = fixture(["application"], [], ["application", "creator-private"]);
    expect((await scope.getTurnRetrievalScope(actor, locator)).usable_ids).toEqual(["application"]);
  });

  it("removes revoked application access while retaining the user's unselected libraries", async () => {
    const { scope, applications } = fixture(["application"], ["personal"], ["application"]);
    expect((await scope.getTurnRetrievalScope(actor, locator)).usable_ids).toEqual(["application", "personal"]);
    applications.resolveUsableKnowledgeBaseIdsForTurn.mockResolvedValue([]);
    await expect(scope.getTurnRetrievalScope(actor, locator)).resolves.toEqual({
      requested_ids: ["application"], usable_ids: ["personal"], unavailable_ids: ["application"],
    });
  });

  it.each([false, true])("routes document listing and reading through current authorization (application=%s)", async (delegated) => {
    const { scope, knowledge, applications } = fixture([], ["base"], delegated ? ["base"] : []);
    const listInput = { status: "ready", limit: 100, turnId: "turn" } as const;
    const chunkInput = { byteOffset: 0, maxBytes: 1024, verifyIntegrity: true, turnId: "turn" };
    await scope.listDocuments(actor, "base", listInput);
    await scope.getParsedContentChunk(actor, "base", "doc", "version", chunkInput);
    expect(applications.resolveUsableKnowledgeBaseIdsForTurn).toHaveBeenCalledWith(actor.id, locator, ["base"]);
    if (delegated) {
      expect(knowledge.listDocumentsForAuthorizedApplicationTurn).toHaveBeenCalledWith("base", listInput);
      expect(knowledge.getParsedContentChunkForAuthorizedApplicationTurn).toHaveBeenCalledWith("base", "doc", "version", chunkInput);
      expect(knowledge.listDocuments).not.toHaveBeenCalled();
      expect(knowledge.getParsedContentChunk).not.toHaveBeenCalled();
    } else {
      expect(knowledge.listDocuments).toHaveBeenCalledWith(actor, "base", listInput);
      expect(knowledge.getParsedContentChunk).toHaveBeenCalledWith(actor, "base", "doc", "version", chunkInput);
      expect(knowledge.listDocumentsForAuthorizedApplicationTurn).not.toHaveBeenCalled();
      expect(knowledge.getParsedContentChunkForAuthorizedApplicationTurn).not.toHaveBeenCalled();
    }
  });

  it("does not bypass a denied content read when application access has been revoked", async () => {
    const { scope, knowledge } = fixture(["application"], []);
    knowledge.getParsedContentChunk.mockRejectedValue(new AppError("FORBIDDEN"));
    await expect(scope.getParsedContentChunk(actor, "application", "doc", "version", {
      byteOffset: 0, maxBytes: 1024, verifyIntegrity: true, turnId: "turn",
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(knowledge.getParsedContentChunkForAuthorizedApplicationTurn).not.toHaveBeenCalled();
  });
});
