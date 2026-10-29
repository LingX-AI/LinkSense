import { describe, expect, it } from "vitest";

import {
  builtInCapabilityId,
  internalSkillManagementRequestSchema,
  localizedErrorMessage,
  skillManagementRequestSchema,
  skillManagementResultSchema,
  skillManagementToolInputs,
  supportedLocales,
} from "../src/index.js";

const id = "10000000-0000-4000-8000-000000000001";

describe("Skill management contracts", () => {
  it("accepts only account-scoped list and single-target uninstall inputs", () => {
    expect(skillManagementToolInputs.list_skills.parse({})).toEqual({});
    expect(skillManagementToolInputs.uninstall_skill.parse({ skill_id: id })).toEqual({ skill_id: id });
    expect(skillManagementToolInputs.uninstall_skill.parse({ skill_id: builtInCapabilityId("linksense-docs") })).toBeDefined();
    for (const input of [{ user_id: id }, { limit: 200 }, { status: "disabled" }, { conversation_id: id }]) {
      expect(skillManagementToolInputs.list_skills.safeParse(input).success).toBe(false);
    }
    for (const input of [{ skill_id: "../skill" }, { skill_id: id, user_id: id }, { skill_id: [id] }]) {
      expect(skillManagementToolInputs.uninstall_skill.safeParse(input).success).toBe(false);
    }
    expect(skillManagementRequestSchema.safeParse({ operation: "delete_plugin", skill_id: id }).success).toBe(false);
  });

  it("binds internal requests to a projected turn and rejects caller-supplied ownership", () => {
    const input = { conversationId: id, turnId: id, request: { operation: "list" } };
    expect(internalSkillManagementRequestSchema.safeParse(input).success).toBe(true);
    expect(internalSkillManagementRequestSchema.safeParse({ ...input, ownerId: id }).success).toBe(false);
    expect(internalSkillManagementRequestSchema.safeParse({ ...input, turnId: "native-turn" }).success).toBe(false);
  });

  it("does not impose the page API's 200 or 500 item cap and rejects sensitive fields", () => {
    const summary = { id, name: "notes", display_name: null, description: null, source_type: "local", is_builtin: false, can_uninstall: true };
    expect(skillManagementResultSchema.parse({ success: true, operation: "list", items: Array.from({ length: 501 }, () => summary) })).toHaveProperty("items.length", 501);
    expect(skillManagementResultSchema.safeParse({ success: true, operation: "list", items: [{ ...summary, storage_path: "/private/source" }] }).success).toBe(false);
  });

  it.each(supportedLocales)("provides a translated uninstall protection error in %s", locale => {
    const message = localizedErrorMessage("SKILL_UNINSTALL_NOT_ALLOWED", locale);
    expect(message.length).toBeGreaterThan(5);
    expect(message).not.toContain("errors.");
    if (locale !== "zh-CN") expect(message).not.toBe(localizedErrorMessage("SKILL_UNINSTALL_NOT_ALLOWED", "zh-CN"));
    if (locale !== "en-US") expect(message).not.toBe(localizedErrorMessage("SKILL_UNINSTALL_NOT_ALLOWED", "en-US"));
  });
});
