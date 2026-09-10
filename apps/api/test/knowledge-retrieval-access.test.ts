import { describe, expect, it, vi } from "vitest";

import type { PrismaClient } from "../src/generated/prisma/client.js";
import { PrismaKnowledgeStore } from "../src/modules/knowledge/repository.js";

function fixture(groupIds: string[] = ["group"]) {
  const members = vi.fn().mockResolvedValue(groupIds.map((userGroupId) => ({ userGroupId })));
  const grants = vi.fn().mockResolvedValue([
    { knowledgeBaseId: "direct" }, { knowledgeBaseId: "group-shared" },
  ]);
  const bases = vi.fn().mockResolvedValue([
    { id: "direct", ownerId: "other" },
    { id: "group-shared", ownerId: "other" },
    { id: "owned", ownerId: "actor" },
    { id: "private", ownerId: "other" },
  ]);
  const prisma = {
    userGroupMember: { findMany: members },
    knowledgeBaseGrant: { findMany: grants },
    knowledgeBase: { findMany: bases },
  } as unknown as PrismaClient;
  return { store: new PrismaKnowledgeStore(prisma), members, grants, bases };
}

describe("knowledge retrieval access queries", () => {
  it("resolves owned, user-shared and group-shared libraries without a selection or pagination limit", async () => {
    const { store, members, grants, bases } = fixture();
    await expect(store.resolveUsableKnowledgeBaseIds("actor")).resolves.toEqual(["direct", "group-shared", "owned"]);
    expect(members).toHaveBeenCalledWith({
      where: { userId: "actor", status: "active" }, select: { userGroupId: true },
    });
    expect(grants).toHaveBeenCalledWith({
      where: {
        status: "active",
        OR: [{ granteeType: "user", userId: "actor" }, { granteeType: "user_group", userGroupId: { in: ["group"] } }],
      }, select: { knowledgeBaseId: true },
    });
    expect(bases).toHaveBeenCalledWith({
      where: {
        OR: [{ ownerId: "actor" }, { id: { in: ["direct", "group-shared"] } }],
        lifecycleStatus: "active", availabilityStatus: "enabled",
      }, orderBy: { id: "asc" }, select: { id: true, ownerId: true },
    });
  });

  it("keeps an explicitly requested subset in request order and rejects private libraries", async () => {
    const { store, bases, grants } = fixture();
    const requested = ["owned", "private", "direct"];
    expect(await store.resolveUsableKnowledgeBaseIds("actor", requested)).toEqual(["owned", "direct"]);
    expect(bases).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: { in: requested }, lifecycleStatus: "active", availabilityStatus: "enabled" },
    }));
    expect(grants).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ knowledgeBaseId: { in: requested } }) }));
  });

  it("does not treat an explicit empty subset as permission to enumerate every library", async () => {
    const { store, members, grants, bases } = fixture();
    expect(await store.resolveUsableKnowledgeBaseIds("actor", [])).toEqual([]);
    expect(members).not.toHaveBeenCalled();
    expect(grants).not.toHaveBeenCalled();
    expect(bases).not.toHaveBeenCalled();
  });

  it("rechecks sharing and active group membership and excludes revoked access", async () => {
    const { store, members, grants } = fixture();
    expect(await store.resolveUsableKnowledgeBaseIds("actor")).toEqual(["direct", "group-shared", "owned"]);
    members.mockResolvedValue([]);
    grants.mockResolvedValue([]);
    expect(await store.resolveUsableKnowledgeBaseIds("actor")).toEqual(["owned"]);
    expect(grants).toHaveBeenLastCalledWith({
      where: { status: "active", OR: [{ granteeType: "user", userId: "actor" }] },
      select: { knowledgeBaseId: true },
    });
  });
});
