import { z } from "zod";

import {
  modelIdentifierSchema,
  reasoningEffortSchema,
} from "./model-provider.js";
import { timestampSchema, uuidSchema } from "./common.js";
import {
  scheduleIntervalSchema,
  scheduleTimeOfDaySchema,
  scheduleTimeZoneSchema,
  scheduleWeekdaysSchema,
} from "./schedules.js";

export const automationStatusSchema = z.enum(["active", "paused"]);
export const automationFrequencySchema = z.enum([
  "hourly",
  "daily",
  "weekly",
  "monthly",
  "yearly",
]);

const calendarDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/u)
  .refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, "invalid_calendar_date");
const scheduleBase = {
  interval: scheduleIntervalSchema,
  time_zone: scheduleTimeZoneSchema,
};

export const hourlyAutomationScheduleSchema = z.strictObject({
  frequency: z.literal("hourly"),
  ...scheduleBase,
  minute: z.number().int().min(0).max(59),
});

export const dailyAutomationScheduleSchema = z.strictObject({
  frequency: z.literal("daily"),
  ...scheduleBase,
  time: scheduleTimeOfDaySchema,
});

export const weeklyAutomationScheduleSchema = z.strictObject({
  frequency: z.literal("weekly"),
  ...scheduleBase,
  weekdays: scheduleWeekdaysSchema,
  time: scheduleTimeOfDaySchema,
});

export const monthlyAutomationScheduleSchema = z.strictObject({
  frequency: z.literal("monthly"),
  ...scheduleBase,
  day_of_month: z.number().int().min(1).max(31),
  time: scheduleTimeOfDaySchema,
});

export const yearlyAutomationScheduleSchema = z
  .strictObject({
    frequency: z.literal("yearly"),
    ...scheduleBase,
    month_of_year: z.number().int().min(1).max(12),
    day_of_month: z.number().int().min(1).max(31),
    time: scheduleTimeOfDaySchema,
  })
  .superRefine((schedule, context) => {
    const maximumDay = new Date(
      Date.UTC(2024, schedule.month_of_year, 0),
    ).getUTCDate();
    if (schedule.day_of_month > maximumDay) {
      context.addIssue({
        code: "custom",
        path: ["day_of_month"],
        message: "invalid_day_for_month",
      });
    }
  });

export const automationScheduleSchema = z.discriminatedUnion("frequency", [
  hourlyAutomationScheduleSchema,
  dailyAutomationScheduleSchema,
  weeklyAutomationScheduleSchema,
  monthlyAutomationScheduleSchema,
  yearlyAutomationScheduleSchema,
]);

export const automationTargetInputSchema = z.discriminatedUnion("mode", [
  z.strictObject({
    mode: z.literal("existing_task"),
    conversation_id: uuidSchema,
  }),
  z.strictObject({ mode: z.literal("new_task") }),
]);

export const automationModelPreferenceInputSchema = z
  .strictObject({
    model_id: modelIdentifierSchema,
    reasoning_effort: reasoningEffortSchema,
  })
  .nullable();

export const automationCreateInputSchema = z.strictObject({
  title: z.string().trim().min(1).max(160),
  instruction: z.string().trim().min(1).max(1_000_000),
  target: automationTargetInputSchema,
  schedule: automationScheduleSchema,
  expires_on: calendarDateSchema.nullable().default(null),
  model_preference: automationModelPreferenceInputSchema.default(null),
});

export const automationUpdateInputSchema = z
  .strictObject({
    title: z.string().trim().min(1).max(160).optional(),
    instruction: z.string().trim().min(1).max(1_000_000).optional(),
    target: automationTargetInputSchema.optional(),
    schedule: automationScheduleSchema.optional(),
    status: automationStatusSchema.optional(),
    expires_on: calendarDateSchema.nullable().optional(),
    model_preference: automationModelPreferenceInputSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "empty_automation_update");

export const automationConversationSummarySchema = z.strictObject({
  id: uuidSchema,
  title: z.string().min(1),
  pinned_at: timestampSchema,
});

export const automationModelPreferenceSchema = z
  .strictObject({
    model_id: modelIdentifierSchema,
    reasoning_effort: reasoningEffortSchema,
  })
  .nullable();

export const automationRunStatusSchema = z.enum([
  "dispatching",
  "queued",
  "started",
  "failed",
]);

export const automationSchema = z.strictObject({
  id: uuidSchema,
  title: z.string().min(1).max(160),
  instruction: z.string().min(1).max(1_000_000),
  status: automationStatusSchema,
  conversation: automationConversationSummarySchema,
  schedule: automationScheduleSchema,
  next_run_at: timestampSchema.nullable(),
  expires_on: calendarDateSchema.nullable(),
  last_run_at: timestampSchema.nullable(),
  last_run_status: automationRunStatusSchema.nullable(),
  last_error_code: z.string().max(120).nullable(),
  model_preference: automationModelPreferenceSchema,
  created_at: timestampSchema,
  updated_at: timestampSchema,
});

export const automationListSchema = z.strictObject({
  items: z.array(automationSchema),
});

export const automationPinnedConversationListSchema = z.strictObject({
  items: z.array(automationConversationSummarySchema),
});

export const automationCompletionNotificationSchema = z.strictObject({
  latest_unread: z
    .strictObject({
      conversation_id: uuidSchema,
      completed_at: timestampSchema,
    })
    .nullable(),
});

export const automationRunNowInputSchema = z.strictObject({
  request_id: uuidSchema,
});

export const automationRunNowResultSchema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("started"),
    turn_id: uuidSchema,
  }),
  z.strictObject({
    status: z.literal("queued"),
    pending_request_id: uuidSchema,
  }),
]);

export type AutomationStatus = z.infer<typeof automationStatusSchema>;
export type AutomationFrequency = z.infer<typeof automationFrequencySchema>;
export type AutomationSchedule = z.infer<typeof automationScheduleSchema>;
export type AutomationTargetInput = z.infer<typeof automationTargetInputSchema>;
export type AutomationModelPreferenceInput = z.infer<
  typeof automationModelPreferenceInputSchema
>;
export type AutomationModelPreference = z.infer<
  typeof automationModelPreferenceSchema
>;
export type AutomationCreateInput = z.input<typeof automationCreateInputSchema>;
export type AutomationUpdateInput = z.input<typeof automationUpdateInputSchema>;
export type AutomationRunStatus = z.infer<typeof automationRunStatusSchema>;
export type Automation = z.infer<typeof automationSchema>;
export type AutomationCompletionNotification = z.infer<
  typeof automationCompletionNotificationSchema
>;
export type AutomationRunNowInput = z.infer<typeof automationRunNowInputSchema>;
export type AutomationRunNowResult = z.infer<
  typeof automationRunNowResultSchema
>;
