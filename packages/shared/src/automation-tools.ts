import { z } from "zod";

import {
  automationCreateInputSchema,
  automationSchema,
  automationTargetInputSchema,
  automationUpdateInputSchema,
  automationConversationSummarySchema,
  automationRunNowResultSchema,
} from "./automations.js";
import { uuidSchema } from "./common.js";
import { errorCodeSchema } from "./errors.js";

export const AUTOMATION_TOOL_BODY_LIMIT = 8 * 1024 * 1024;

export const automationToolTargetSchema = z.discriminatedUnion("mode", [
  z.strictObject({ mode: z.literal("current_task") }),
  ...automationTargetInputSchema.options,
]);

const automationIdInputSchema = z.strictObject({ automation_id: uuidSchema });
const changesSchema = z
  .strictObject(automationUpdateInputSchema.shape)
  .omit({ status: true })
  .extend({ target: automationToolTargetSchema.optional() })
  .refine((value) => Object.keys(value).length > 0, "empty_automation_update");

export const automationToolNames = [
  "list_automations",
  "get_automation",
  "create_automation",
  "update_automation",
  "delete_automation",
  "pause_automation",
  "resume_automation",
  "run_automation_now",
] as const;
export const automationToolNameSchema = z.enum(automationToolNames);

export const automationToolInputs = {
  list_automations: z.strictObject({
    query: z.string().trim().min(1).max(160).optional(),
  }),
  get_automation: automationIdInputSchema,
  create_automation: automationCreateInputSchema.extend({
    request_id: uuidSchema,
    additional: z
      .boolean()
      .optional()
      .describe(
        "Set true only when the user explicitly requests another separate automation. Leave false or omit when adjusting a previously discussed plan; use update_automation for that adjustment.",
      ),
    target: automationToolTargetSchema
      .default({ mode: "new_task" })
      .describe(
        "Defaults to a separate execution task reused across runs, leaving this configuration chat unchanged. Select current_task or existing_task only when the user explicitly requests reusing that task.",
      ),
  }),
  update_automation: automationIdInputSchema.extend({ changes: changesSchema }),
  delete_automation: automationIdInputSchema,
  pause_automation: automationIdInputSchema,
  resume_automation: automationIdInputSchema,
  run_automation_now: automationIdInputSchema.extend({
    request_id: uuidSchema,
  }),
} as const;

export const automationToolOperations = {
  list_automations: "list",
  get_automation: "get",
  create_automation: "create",
  update_automation: "update",
  delete_automation: "delete",
  pause_automation: "pause",
  resume_automation: "resume",
  run_automation_now: "run_now",
} as const;

export const automationToolRequestSchema = z.discriminatedUnion("operation", [
  automationToolInputs.list_automations.extend({
    operation: z.literal("list"),
  }),
  automationToolInputs.get_automation.extend({ operation: z.literal("get") }),
  automationToolInputs.create_automation.extend({
    operation: z.literal("create"),
  }),
  automationToolInputs.update_automation.extend({
    operation: z.literal("update"),
  }),
  automationToolInputs.delete_automation.extend({
    operation: z.literal("delete"),
  }),
  automationToolInputs.pause_automation.extend({
    operation: z.literal("pause"),
  }),
  automationToolInputs.resume_automation.extend({
    operation: z.literal("resume"),
  }),
  automationToolInputs.run_automation_now.extend({
    operation: z.literal("run_now"),
  }),
]);

export const automationToolSummarySchema = automationSchema.omit({
  instruction: true,
});

export const automationToolResultSchema = z.discriminatedUnion("operation", [
  z.strictObject({
    operation: z.literal("list"),
    current_task: z.strictObject({
      id: uuidSchema,
      title: z.string(),
      pinned: z.boolean(),
      automation_ids: z.array(uuidSchema).max(100),
    }),
    items: z.array(automationToolSummarySchema).max(100),
    pinned_tasks: z.array(automationConversationSummarySchema).max(100),
  }),
  z.strictObject({
    operation: z.enum(["get", "create", "update", "pause", "resume"]),
    automation: automationSchema,
  }),
  z.strictObject({ operation: z.literal("delete"), automation_id: uuidSchema }),
  z.strictObject({
    operation: z.literal("run_now"),
    result: automationRunNowResultSchema,
  }),
]);

export const automationToolFailureSchema = z.strictObject({
  code: errorCodeSchema,
  retryable: z.boolean(),
});

export const internalAutomationToolRequestSchema = z.strictObject({
  conversationId: uuidSchema,
  turnId: uuidSchema,
  request: automationToolRequestSchema,
});

export type AutomationToolRequest = z.infer<typeof automationToolRequestSchema>;
export type AutomationToolResult = z.infer<typeof automationToolResultSchema>;
export type AutomationToolFailure = z.infer<typeof automationToolFailureSchema>;
export type InternalAutomationToolRequest = z.infer<
  typeof internalAutomationToolRequestSchema
>;
