import { z } from "zod";

import { builtInCapabilityId, builtInSkillNames } from "./capabilities.js";
import { uuidSchema } from "./common.js";

// MCP publishes JSON Schema, so use the canonical built-in names as an enum.
const skillIdSchema = z.union([uuidSchema, z.enum(builtInSkillNames.map(builtInCapabilityId))]);

export const skillManagementToolInputs = {
  list_skills: z.strictObject({}),
  uninstall_skill: z.strictObject({ skill_id: skillIdSchema }),
};

export const skillManagementRequestSchema = z.discriminatedUnion("operation", [
  skillManagementToolInputs.list_skills.extend({ operation: z.literal("list") }),
  skillManagementToolInputs.uninstall_skill.extend({ operation: z.literal("uninstall") }),
]);

export const internalSkillManagementRequestSchema = z.strictObject({
  conversationId: uuidSchema,
  turnId: uuidSchema,
  request: skillManagementRequestSchema,
});

export const enabledSkillSummarySchema = z.strictObject({
  id: skillIdSchema,
  name: z.string().min(1).max(160),
  display_name: z.string().max(64).nullable(),
  description: z.string().max(4_000).nullable(),
  source_type: z.enum(["builtin", "local", "url", "marketplace", "clawhub"]),
  is_builtin: z.boolean(),
  can_uninstall: z.boolean(),
});

export const skillManagementResultSchema = z.discriminatedUnion("operation", [
  z.strictObject({
    success: z.literal(true),
    operation: z.literal("list"),
    items: z.array(enabledSkillSummarySchema),
  }),
  z.strictObject({
    success: z.literal(true),
    operation: z.literal("uninstall"),
    skill_id: uuidSchema,
    name: z.string().min(1).max(160),
  }),
]);

export const skillManagementFailureSchema = z.strictObject({
  code: z.enum([
    "AUTH_REQUIRED",
    "FORBIDDEN",
    "VALIDATION_ERROR",
    "CAPABILITY_NOT_FOUND",
    "SKILL_UNINSTALL_NOT_ALLOWED",
    "COLLABORATION_MODE_UNAVAILABLE",
    "CAPABILITY_HOME_SYNC_FAILED",
    "INTERNAL_ERROR",
  ]),
  retryable: z.boolean(),
});

export type SkillManagementRequest = z.infer<typeof skillManagementRequestSchema>;
export type InternalSkillManagementRequest = z.infer<typeof internalSkillManagementRequestSchema>;
export type SkillManagementResult = z.infer<typeof skillManagementResultSchema>;
export type SkillManagementFailure = z.infer<typeof skillManagementFailureSchema>;
