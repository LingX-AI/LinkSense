import { z } from "zod";

import { timestampSchema, uuidSchema } from "./common.js";
import {
  scheduleTimeOfDaySchema,
  scheduleTimeZoneSchema,
  scheduleWeekdaySchema,
} from "./schedules.js";

export const knowledgeSourceProviderSchema = z.enum(["sharepoint"]);
export const knowledgeBaseSourceTypeSchema = z.enum(["local", "sharepoint"]);
export const knowledgeSourceSyncStatusSchema = z.enum([
  "pending",
  "syncing",
  "ready",
  "failed",
]);

export const knowledgeSourceSyncTriggerSchema = z.enum([
  "initial",
  "scheduled",
  "manual",
  "retry",
]);

export const knowledgeSourceSyncRunStatusSchema = z.enum([
  "running",
  "completed",
  "partial",
  "failed",
]);

export const knowledgeSourceSyncPhaseSchema = z.enum([
  "scanning",
  "syncing",
  "processing",
  "completed",
]);

export const knowledgeSourceSyncFailurePhaseSchema = z.enum([
  "scanning",
  "syncing",
  "processing",
]);

export const knowledgeSourceSyncFrequencySchema = z.enum([
  "daily",
  "weekly",
  "monthly",
]);

const knowledgeSourceScheduleBase = {
  time: scheduleTimeOfDaySchema,
  time_zone: scheduleTimeZoneSchema,
};

export const dailyKnowledgeSourceSyncScheduleSchema = z.strictObject({
  frequency: z.literal("daily"),
  ...knowledgeSourceScheduleBase,
});

export const weeklyKnowledgeSourceSyncScheduleSchema = z.strictObject({
  frequency: z.literal("weekly"),
  ...knowledgeSourceScheduleBase,
  weekday: scheduleWeekdaySchema,
});

export const monthlyKnowledgeSourceSyncScheduleSchema = z.strictObject({
  frequency: z.literal("monthly"),
  ...knowledgeSourceScheduleBase,
  day_of_month: z.number().int().min(1).max(31),
});

export const knowledgeSourceSyncScheduleSchema = z.discriminatedUnion(
  "frequency",
  [
    dailyKnowledgeSourceSyncScheduleSchema,
    weeklyKnowledgeSourceSyncScheduleSchema,
    monthlyKnowledgeSourceSyncScheduleSchema,
  ],
);

export const knowledgeSourceSyncProgressSchema = z.strictObject({
  run_id: uuidSchema,
  trigger: knowledgeSourceSyncTriggerSchema,
  status: knowledgeSourceSyncRunStatusSchema,
  phase: knowledgeSourceSyncPhaseSchema,
  failure_phase: knowledgeSourceSyncFailurePhaseSchema.nullable(),
  retry_of_run_id: uuidSchema.nullable(),
  scanned_count: z.number().int().nonnegative(),
  total_count: z.number().int().nonnegative().nullable(),
  processed_count: z.number().int().nonnegative(),
  created_count: z.number().int().nonnegative(),
  updated_count: z.number().int().nonnegative(),
  deleted_count: z.number().int().nonnegative(),
  skipped_count: z.number().int().nonnegative(),
  retried_count: z.number().int().nonnegative(),
  failed_count: z.number().int().nonnegative(),
  progress_percent: z.number().int().min(0).max(100).nullable(),
  started_at: timestampSchema,
  updated_at: timestampSchema,
  completed_at: timestampSchema.nullable(),
});

export const sharePointConnectionSettingsSchema = z.strictObject({
  provider: z.literal("sharepoint"),
  revision: z.number().int().nonnegative(),
  enabled: z.boolean(),
  tenant_id: z.string().uuid().nullable(),
  client_id: z.string().uuid().nullable(),
  tenant_domain: z.string().trim().min(1).max(253).nullable(),
  client_secret_configured: z.boolean(),
});

export const updateSharePointConnectionSettingsSchema = z
  .strictObject({
    expected_revision: z.number().int().nonnegative(),
    enabled: z.boolean(),
    tenant_id: z.string().uuid().nullable(),
    client_id: z.string().uuid().nullable(),
    tenant_domain: z
      .string()
      .trim()
      .min(1)
      .max(253)
      .regex(/^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/iu)
      .nullable(),
    client_secret: z.string().trim().min(1).max(16_384).optional(),
  })
  .superRefine((value, context) => {
    if (!value.enabled) return;
    for (const field of ["tenant_id", "client_id", "tenant_domain"] as const) {
      if (value[field] === null) {
        context.addIssue({
          code: "custom",
          path: [field],
          message: `${field}_required`,
        });
      }
    }
  });

export const knowledgeBaseSourceSchema = z.strictObject({
  id: uuidSchema,
  knowledge_base_id: uuidSchema,
  provider: knowledgeSourceProviderSchema,
  source_url: z.string().url().max(2_048),
  site_name: z.string().max(260),
  drive_name: z.string().max(260),
  folder_name: z.string().max(260),
  sync_schedule: knowledgeSourceSyncScheduleSchema,
  sync_status: knowledgeSourceSyncStatusSchema,
  retry_available: z.boolean(),
  sync_progress: knowledgeSourceSyncProgressSchema.nullable(),
  stable_error_code: z.string().max(120).nullable(),
  last_synced_at: timestampSchema.nullable(),
  next_sync_at: timestampSchema.nullable(),
  created_at: timestampSchema,
  updated_at: timestampSchema,
});

export const createLocalKnowledgeBaseInputSchema = z.strictObject({
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(4_000).nullable().optional(),
  source_type: z.literal("local").optional().default("local"),
});

export const createSharePointKnowledgeBaseInputSchema = z.strictObject({
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(4_000).nullable().optional(),
  source_type: z.literal("sharepoint"),
  sharepoint_folder_url: z.string().url().max(2_048),
  sync_schedule: knowledgeSourceSyncScheduleSchema,
});

export const createKnowledgeBaseWithSourceInputSchema = z.union([
  createLocalKnowledgeBaseInputSchema,
  createSharePointKnowledgeBaseInputSchema,
]);

export type SharePointConnectionSettings = z.infer<
  typeof sharePointConnectionSettingsSchema
>;
export type UpdateSharePointConnectionSettings = z.input<
  typeof updateSharePointConnectionSettingsSchema
>;
export type KnowledgeBaseSource = z.infer<typeof knowledgeBaseSourceSchema>;
export type KnowledgeSourceSyncFrequency = z.infer<
  typeof knowledgeSourceSyncFrequencySchema
>;
export type KnowledgeSourceSyncSchedule = z.infer<
  typeof knowledgeSourceSyncScheduleSchema
>;
export type KnowledgeSourceSyncProgress = z.infer<
  typeof knowledgeSourceSyncProgressSchema
>;
export type KnowledgeSourceSyncPhase = z.infer<
  typeof knowledgeSourceSyncPhaseSchema
>;
export type KnowledgeSourceSyncTrigger = z.infer<
  typeof knowledgeSourceSyncTriggerSchema
>;
export type CreateKnowledgeBaseWithSourceInput = z.input<
  typeof createKnowledgeBaseWithSourceInputSchema
>;
