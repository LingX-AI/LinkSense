import { randomUUID } from "node:crypto";

import { builtInCapabilityId } from "@linksense/shared";
import { describe, expect, it, vi } from "vitest";

import type { PrismaClient } from "../src/generated/prisma/client.js";
import { AppError } from "../src/lib/errors.js";
import { ConversationSkillManagementService } from "../src/modules/capabilities/conversation-skill-management.js";
import type { CapabilityView } from "../src/modules/capabilities/service.js";

const ownerId = randomUUID(), conversationId = randomUUID(), turnId = randomUUID(), skillId = randomUUID();

function skill(overrides: Partial<CapabilityView> = {}): CapabilityView {
  return {
    id: skillId, type: "skill", name: "meeting-notes", slug: "meeting-notes", description: "Meeting notes",
    source_type: "local", builtin_key: null, is_builtin: false, marketplace_listing_id: null, marketplace_release_id: null,
    status: "active", has_logo: false, logo_url: null, manifest: null, risk_summary: null,
    preference_status: "enabled", can_manage: true, can_govern: false, can_select: true, can_delete: true, is_owner: true,
    created_at: null, updated_at: null, ...overrides,
  };
}

function fixture() {
  const user = vi.fn().mockResolvedValue({ id: ownerId, role: "user", status: "active" });
  const conversation = vi.fn().mockResolvedValue({ id: conversationId });
  const turn = vi.fn().mockResolvedValue({ collaborationMode: "default" });
  const listAvailable = vi.fn().mockResolvedValue([skill()]);
  const get = vi.fn().mockResolvedValue(skill());
  const remove = vi.fn().mockResolvedValue(undefined);
  const prisma = { user: { findUnique: user }, conversation: { findFirst: conversation }, conversationTurn: { findFirst: turn } } as unknown as Pick<PrismaClient, "user" | "conversation" | "conversationTurn">;
  const service = new ConversationSkillManagementService(prisma, { listAvailable, get, delete: remove });
  const execute = (request: { operation: "list" } | { operation: "uninstall"; skill_id: string }) => service.execute(ownerId, { conversationId, turnId, request });
  return { service, execute, user, conversation, turn, listAvailable, get, remove };
}

describe("conversation Skill management", () => {
  it("lists all enabled standalone Skills with only safe metadata, including older records without display names", async () => {
    const f = fixture();
    f.listAvailable.mockResolvedValue([
      skill({ id: builtInCapabilityId("linksense-docs"), source_type: "builtin", is_builtin: true, can_delete: false, is_owner: false }),
      ...["local", "url", "marketplace", "clawhub"].map(source_type => skill({ source_type: source_type as CapabilityView["source_type"] })),
      skill({ status: "disabled" }), skill({ status: "failed" }), skill({ preference_status: "disabled" }), skill({ type: "plugin" }),
    ]);
    const result = await f.execute({ operation: "list" });
    expect(result).toMatchObject({ operation: "list", items: expect.arrayContaining([
      expect.objectContaining({ is_builtin: true, can_uninstall: false }),
      expect.objectContaining({ id: skillId, display_name: null, can_uninstall: true }),
    ]) });
    if (result.operation !== "list") throw new Error("expected list result");
    expect(result.items).toHaveLength(5);
    expect(result.items.every(item => !('manifest' in item) && !('logo_url' in item) && !('risk_summary' in item))).toBe(true);
    expect(f.listAvailable).toHaveBeenCalledWith({ id: ownerId, role: "user", status: "active" });
    expect(f.conversation).toHaveBeenCalledWith(expect.objectContaining({ where: { id: conversationId, ownerId, archiveStatus: "active", applicationId: null } }));
    expect(f.turn).toHaveBeenCalledWith(expect.objectContaining({ where: { id: turnId, conversationId, submittedBy: ownerId, status: "running" } }));
  });

  it("returns an empty list and never truncates large accounts", async () => {
    const f = fixture();
    f.listAvailable.mockResolvedValueOnce([]).mockResolvedValueOnce(Array.from({ length: 501 }, () => skill()));
    expect(await f.execute({ operation: "list" })).toEqual({ success: true, operation: "list", items: [] });
    expect(await f.execute({ operation: "list" })).toHaveProperty("items.length", 501);
  });

  it("allows Plan to list but rejects uninstallation on the API boundary", async () => {
    const f = fixture();
    f.turn.mockResolvedValue({ collaborationMode: "plan" });
    await expect(f.execute({ operation: "list" })).resolves.toHaveProperty("success", true);
    await expect(f.execute({ operation: "uninstall", skill_id: skillId })).rejects.toMatchObject({ code: "COLLABORATION_MODE_UNAVAILABLE" });
    expect(f.remove).not.toHaveBeenCalled();
  });

  it.each(["user", "conversation", "turn"] as const)("rejects a missing %s before accessing Skills", async key => {
    const f = fixture();
    f[key].mockResolvedValue(null);
    await expect(f.execute({ operation: "list" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(f.listAvailable).not.toHaveBeenCalled();
    expect(f.remove).not.toHaveBeenCalled();
  });

  it("rejects a disabled account and does not grant administrators another user's Skills", async () => {
    const f = fixture();
    f.user.mockResolvedValueOnce({ id: ownerId, role: "user", status: "disabled" });
    await expect(f.execute({ operation: "list" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    f.user.mockResolvedValue({ id: ownerId, role: "admin", status: "active" });
    f.get.mockRejectedValue(new AppError("CAPABILITY_NOT_FOUND"));
    await expect(f.execute({ operation: "uninstall", skill_id: randomUUID() })).rejects.toMatchObject({ code: "CAPABILITY_NOT_FOUND" });
    expect(f.remove).not.toHaveBeenCalled();
  });

  it("uninstalls an owned Skill through the existing deletion and synchronization service, including disabled Skills", async () => {
    const f = fixture();
    f.get.mockResolvedValue(skill({ status: "disabled", preference_status: "disabled" }));
    expect(await f.execute({ operation: "uninstall", skill_id: skillId })).toEqual({ success: true, operation: "uninstall", skill_id: skillId, name: "meeting-notes" });
    expect(f.get).toHaveBeenCalledWith({ id: ownerId, role: "user", status: "active" }, skillId);
    expect(f.remove).toHaveBeenCalledWith({ id: ownerId, role: "user", status: "active" }, skillId);
  });

  it("rejects built-in IDs before querying or deleting any personal resource", async () => {
    const f = fixture();
    await expect(f.execute({ operation: "uninstall", skill_id: builtInCapabilityId("linksense-docs") })).rejects.toMatchObject({ code: "SKILL_UNINSTALL_NOT_ALLOWED" });
    expect(f.get).not.toHaveBeenCalled();
    expect(f.remove).not.toHaveBeenCalled();
  });

  it.each([{ type: "plugin" as const }, { is_owner: false }, { can_delete: false }])("rejects an invalid uninstall target %j", async overrides => {
    const f = fixture();
    f.get.mockResolvedValue(skill(overrides));
    await expect(f.execute({ operation: "uninstall", skill_id: skillId })).rejects.toBeInstanceOf(AppError);
    expect(f.remove).not.toHaveBeenCalled();
  });

  it("does not claim success when deletion or runtime synchronization fails", async () => {
    const f = fixture();
    f.remove.mockRejectedValue(new AppError("CAPABILITY_HOME_SYNC_FAILED"));
    await expect(f.execute({ operation: "uninstall", skill_id: skillId })).rejects.toMatchObject({ code: "CAPABILITY_HOME_SYNC_FAILED" });
    expect(f.remove).toHaveBeenCalledOnce();
  });
});
