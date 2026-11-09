import { expect, it } from "vitest";
import { browserUseReplySchema } from "../src/browser-use.js";
import {
  builtInCapabilityDefinitionForId,
  capabilityPackageNameSchema,
  capabilitySelectionIdSchema,
  isBuiltInCapabilityId,
  priorityCapabilityIdsSchema,
} from "../src/capabilities.js";
import { userMessageCapabilitySchema } from "../src/conversations.js";
import { capabilityAttachedEventSchema } from "../src/events.js";
import { enabledSkillSummarySchema, skillManagementRequestSchema } from "../src/skill-management.js";
import * as legacyBrowser from "@linksense/shared/local-browser";

it("keeps the persisted Browser Use Skill ID and native name usable", () => {
  const id = "builtin:capability:linksense-local-browser";
  expect(isBuiltInCapabilityId(id)).toBe(true);
  expect(capabilitySelectionIdSchema.parse(id)).toBe(id);
  expect(priorityCapabilityIdsSchema.parse([id])).toEqual([id]);
  expect(userMessageCapabilitySchema.parse({
    id, name: "linksense-local-browser", type: "skill",
  }).id).toBe(id);
  expect(builtInCapabilityDefinitionForId(id)?.slug).toBe("linksense-local-browser");
  expect(capabilityAttachedEventSchema.shape.payload.parse({
    schema_version: 1, capability_id: id, capability_type: "skill",
    usage_type: "auto_skill", priority_requested: true,
    name: "linksense-local-browser", source_type: "builtin", status: "active",
  }).capability_id).toBe(id);
  expect(skillManagementRequestSchema.parse({
    operation: "uninstall", skill_id: id,
  }).operation).toBe("uninstall");
  expect(enabledSkillSummarySchema.parse({
    id, name: "linksense-local-browser", display_name: "Browser Use",
    description: null, source_type: "builtin", is_builtin: true, can_uninstall: false,
  }).id).toBe(id);
  expect(capabilityPackageNameSchema.safeParse("linksense-local-browser").success).toBe(false);
  expect(capabilitySelectionIdSchema.safeParse("builtin:capability:local-browser").success).toBe(false);
});

it.each(["linksense-browser-use", "linksense-computer-use-builtin-1"])(
  "preserves the formerly legal custom package name %s",
  (name) => {
    expect(capabilityPackageNameSchema.parse(name)).toBe(name);
  },
);

it("accepts only known pre-rename extension failure codes and normalizes their result", () => {
  const reply = {
    id: "40000000-0000-4000-8000-000000000001",
    result: {
      ok: false, code: "LOCAL_BROWSER_ACCESS_DENIED", retryable: false,
      help_path: "/settings/general#browser-extension",
    },
  };
  expect(browserUseReplySchema.parse(reply).result).toMatchObject({
    ok: false, code: "BROWSER_USE_ACCESS_DENIED", retryable: false,
  });
  expect(browserUseReplySchema.safeParse({
    ...reply, result: { ...reply.result, code: "LOCAL_BROWSER_UNKNOWN" },
  }).success).toBe(false);
});

it("keeps the previous shared package entrypoint and error contract usable", () => {
  expect(legacyBrowser.localBrowserRequestSchema.parse({ action: "status" })).toEqual({ action: "status" });
  expect(legacyBrowser.localBrowserFailure("LOCAL_BROWSER_NOT_CONNECTED")).toMatchObject({
    ok: false, code: "LOCAL_BROWSER_NOT_CONNECTED", retryable: false,
  });
});
