import { z } from "zod";

import { localeSchema, timestampSchema } from "./common.js";

export const DEFAULT_ORGANIZATION_DISPLAY_NAME = "LinkSense";

export const organizationDisplayNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .refine((value) => Array.from(value).length <= 120, {
    message: "organization_display_name_too_long",
  });

export function resolveOrganizationDisplayName(value: unknown): string {
  const parsed = organizationDisplayNameSchema.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_ORGANIZATION_DISPLAY_NAME;
}

export function productFilenamePrefix(value: unknown): string {
  const normalized = resolveOrganizationDisplayName(value)
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}._-]+/gu, "-")
    .replace(/^[._-]+|[._-]+$/gu, "");
  return (
    Array.from(normalized).slice(0, 80).join("") ||
    DEFAULT_ORGANIZATION_DISPLAY_NAME
  );
}

const editableProductSettingsSchema = z.strictObject({
  organization_display_name: organizationDisplayNameSchema,
  default_locale: localeSchema,
});

export const productSettingsSchema = editableProductSettingsSchema.extend({
  logo_url: z.string().min(1).nullable().optional(),
  logo_updated_at: timestampSchema.nullable().optional(),
});

export const patchProductSettingsSchema = editableProductSettingsSchema
  .partial()
  .refine((settings) => Object.keys(settings).length > 0, {
    message: "product_settings_patch_cannot_be_empty",
  });

export const executionConcurrencyLimitSchema = z
  .number()
  .int()
  .positive()
  .max(Number.MAX_SAFE_INTEGER);

const executionConcurrencyValuesSchema = z.strictObject({
  max_concurrent_conversations: executionConcurrencyLimitSchema,
  runner_app_server_process_limit: executionConcurrencyLimitSchema,
});

export const updateExecutionConcurrencySettingsSchema = z.strictObject({
  max_concurrent_conversations: executionConcurrencyLimitSchema.nullable(),
  runner_app_server_process_limit: executionConcurrencyLimitSchema.nullable(),
});

export const executionConcurrencySettingsSchema =
  updateExecutionConcurrencySettingsSchema.extend({
    environment_defaults: executionConcurrencyValuesSchema,
    effective: executionConcurrencyValuesSchema,
  });

const nullableTimestampSchema = timestampSchema.nullable();

export const updateMaintenanceSettingsSchema = z
  .strictObject({
    enabled: z.boolean(),
    reason: z.string().trim().max(1_000).nullable(),
    start_at: nullableTimestampSchema,
    end_at: nullableTimestampSchema,
  })
  .superRefine((settings, context) => {
    if (settings.enabled) {
      if (!settings.start_at) {
        context.addIssue({
          code: "custom",
          path: ["start_at"],
          message: "maintenance_start_at_required",
        });
      }
      if (!settings.end_at) {
        context.addIssue({
          code: "custom",
          path: ["end_at"],
          message: "maintenance_end_at_required",
        });
      }
    }
    if (
      settings.start_at &&
      settings.end_at &&
      Date.parse(settings.end_at) <= Date.parse(settings.start_at)
    ) {
      context.addIssue({
        code: "custom",
        path: ["end_at"],
        message: "maintenance_end_must_follow_start",
      });
    }
  });

export const maintenanceStatusSchema = z.strictObject({
  enabled: z.boolean(),
  active: z.boolean(),
  reason: z.string().max(1_000).nullable(),
  start_at: nullableTimestampSchema,
  end_at: nullableTimestampSchema,
});

export const maintenanceStateSchema = maintenanceStatusSchema.extend({
  maintenance_id: z.uuid().nullable(),
}).refine((status) => !status.active || status.maintenance_id !== null, {
  path: ["maintenance_id"],
  message: "active_maintenance_requires_period",
});

export const systemSettingsMetadataSchema = z.strictObject({
  system_initialized: z.boolean(),
  agents_template_version: z.string().min(1).max(80).nullable(),
  agents_template_updated_at: timestampSchema.nullable(),
});

export const dependencyHealthStatusSchema = z.enum([
  "not_configured",
  "unavailable",
  "available",
]);

export const healthComponentSchema = z.strictObject({
  status: dependencyHealthStatusSchema,
  checked_at: timestampSchema,
  reason_code: z.string().min(1).max(120).nullable(),
});

export type ProductSettings = z.infer<typeof productSettingsSchema>;
export type PatchProductSettings = z.input<typeof patchProductSettingsSchema>;
export type ExecutionConcurrencySettings = z.infer<
  typeof executionConcurrencySettingsSchema
>;
export type UpdateExecutionConcurrencySettings = z.input<
  typeof updateExecutionConcurrencySettingsSchema
>;
export type ResolvedExecutionConcurrencySettings = z.infer<
  typeof executionConcurrencyValuesSchema
>;
export type MaintenanceStatus = z.infer<typeof maintenanceStatusSchema>;
export type UpdateMaintenanceSettings = z.input<
  typeof updateMaintenanceSettingsSchema
>;

export type MaintenanceState = z.infer<typeof maintenanceStateSchema>;
