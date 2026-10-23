import { z } from "zod";

export const automationMonitoringSettingsSchema = z.strictObject({
  stop_condition: z.string().trim().min(1).max(500).nullable().default(null),
  max_runs: z.number().int().min(1).max(10_000).nullable().default(null),
  context_mode: z.enum(["reuse_task", "fresh_task"]).default("reuse_task"),
});

export const automationMonitoringStateSchema =
  automationMonitoringSettingsSchema.extend({
    automatic_run_count: z.number().int().nonnegative().default(0),
    stop_reason: z
      .enum(["condition_met", "run_limit_reached"])
      .nullable()
      .default(null),
    stop_requested_run_id: z.uuid().nullable().default(null),
    last_run_conversation_id: z.uuid().nullable().default(null),
  });

export const automationRunContextSchema = z.strictObject({
  trigger: z.enum(["scheduled", "manual"]),
  context_mode: automationMonitoringSettingsSchema.shape.context_mode,
  stop_condition: automationMonitoringSettingsSchema.shape.stop_condition,
  target_conversation_id: z.uuid().optional(),
});

export type AutomationMonitoringSettings = z.infer<
  typeof automationMonitoringSettingsSchema
>;
export type AutomationMonitoringState = z.infer<
  typeof automationMonitoringStateSchema
>;
export type AutomationRunContext = z.infer<typeof automationRunContextSchema>;

export function readAutomationMonitoring(
  value: unknown,
): AutomationMonitoringState {
  return automationMonitoringStateSchema.parse(value ?? {});
}
