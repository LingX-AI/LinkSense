import { z } from "zod";

/**
 * Values the model gateway can replace before a request leaves LinkSense.
 * TERM is a user's own word; the rest are secret and personal-data kinds.
 * Personal-data kinds are reserved for the phase that adds those rules.
 */
export const privacyMaskingKindValues = [
  "PRIVATE_KEY",
  "API_KEY",
  "TOKEN",
  "SECRET",
  "PASSWORD",
  "TERM",
  "EMAIL",
  "PHONE",
  "ID_CARD",
  "BANK_CARD",
] as const;

export const privacyMaskingKindSchema = z.enum(privacyMaskingKindValues);
export type PrivacyMaskingKind = z.infer<typeof privacyMaskingKindSchema>;

export const privacyMaskingActionValues = ["mask", "warn", "block"] as const;
export const privacyMaskingActionSchema = z.enum(privacyMaskingActionValues);
export type PrivacyMaskingAction = z.infer<typeof privacyMaskingActionSchema>;

export const MAX_PRIVACY_MASKING_WORDS = 200;
export const MAX_PRIVACY_MASKING_VALUES = 200;
export const MAX_PRIVACY_MASKING_VALUE_LENGTH = 256;
export const MAX_PRIVACY_MASKING_SETTINGS_BYTES = 64 * 1024;

const privacyMaskingValueSchema = z
  .string()
  .trim()
  .max(MAX_PRIVACY_MASKING_VALUE_LENGTH);

const privacyMaskingWordSchema = privacyMaskingValueSchema.min(2);
const privacyMaskingAllowSchema = privacyMaskingValueSchema.min(1);

const privacyMaskingKindMapSchema = z.record(z.string(), z.boolean());
const privacyMaskingActionMapSchema = z.record(
  z.string(),
  privacyMaskingActionSchema,
);

function refineKindKeys(
  value: Record<string, unknown>,
  context: z.RefinementCtx,
  path: (string | number)[],
) {
  for (const key of Object.keys(value)) {
    if (!privacyMaskingKindSchema.safeParse(key).success) {
      context.addIssue({
        code: "custom",
        path: [...path, key],
        message: "privacy_masking_unknown_kind",
      });
    }
  }
}

export const privacyMaskingSettingsSchema = z
  .strictObject({
    enabled: z.boolean(),
    secrets: z.boolean(),
    personal: z.boolean(),
    kinds: privacyMaskingKindMapSchema,
    words: z
      .array(privacyMaskingWordSchema)
      .max(MAX_PRIVACY_MASKING_WORDS),
    words_any_case: z.boolean(),
    words_whole: z.boolean(),
    actions: privacyMaskingActionMapSchema,
    allow: z
      .array(privacyMaskingAllowSchema)
      .max(MAX_PRIVACY_MASKING_VALUES),
  })
  .superRefine((settings, context) => {
    refineKindKeys(settings.kinds, context, ["kinds"]);
    refineKindKeys(settings.actions, context, ["actions"]);
    const bytes = new TextEncoder().encode(JSON.stringify(settings))
      .byteLength;
    if (bytes > MAX_PRIVACY_MASKING_SETTINGS_BYTES) {
      context.addIssue({
        code: "custom",
        message: "privacy_masking_settings_too_large",
      });
    }
  });

export type PrivacyMaskingSettings = z.infer<
  typeof privacyMaskingSettingsSchema
>;

export const defaultPrivacyMaskingSettings: PrivacyMaskingSettings = {
  enabled: false,
  secrets: true,
  personal: false,
  kinds: {},
  words: [],
  words_any_case: true,
  words_whole: true,
  actions: {},
  allow: [],
};

export const privacyMaskingSettingsResponseSchema = z.strictObject({
  revision: z.number().int().nonnegative(),
  settings: privacyMaskingSettingsSchema,
});

export type PrivacyMaskingSettingsResponse = z.infer<
  typeof privacyMaskingSettingsResponseSchema
>;

export const updatePrivacyMaskingSettingsSchema = z.strictObject({
  expected_revision: z.number().int().nonnegative(),
  settings: privacyMaskingSettingsSchema,
});

export type UpdatePrivacyMaskingSettings = z.infer<
  typeof updatePrivacyMaskingSettingsSchema
>;

export const MAX_PRIVACY_MASKING_PREVIEW_LENGTH = 8000;

/**
 * The settings page's try-it box. `settings` carries the unsaved draft so a
 * user can check words before saving; omitted, the saved settings apply.
 */
export const privacyMaskingPreviewRequestSchema = z.strictObject({
  text: z.string().max(MAX_PRIVACY_MASKING_PREVIEW_LENGTH),
  settings: privacyMaskingSettingsSchema.optional(),
});

export type PrivacyMaskingPreviewRequest = z.infer<
  typeof privacyMaskingPreviewRequestSchema
>;

export const privacyMaskingPreviewHitSchema = z.strictObject({
  placeholder: z.string(),
  kind: privacyMaskingKindSchema,
  action: privacyMaskingActionSchema,
});

export const privacyMaskingPreviewResponseSchema = z.strictObject({
  text: z.string(),
  hits: z.array(privacyMaskingPreviewHitSchema),
});

export type PrivacyMaskingPreviewResponse = z.infer<
  typeof privacyMaskingPreviewResponseSchema
>;

export const PRIVACY_MASKING_ACTIVITY_RETENTION_DAYS = 30;
export const PRIVACY_MASKING_ACTIVITY_PAGE_SIZE = 50;

const privacyMaskingKindCountsSchema = z.record(
  z.string(),
  z.number().int().nonnegative(),
);

/** Where in the request a value was replaced. */
export const privacyMaskingLocationValues = [
  "prompt",
  "instructions",
  "tool_arguments",
  "tool_output",
  "tools",
  "other",
] as const;

export const privacyMaskingLocationSchema = z.enum(
  privacyMaskingLocationValues,
);
export type PrivacyMaskingLocation = z.infer<
  typeof privacyMaskingLocationSchema
>;

export const PRIVACY_MASKING_ACTIVITY_HINT_LIMIT = 50;

/**
 * One shape of value replaced in a request: its kind, how long it was and
 * where it appeared, never the value or its placeholder. Requests with the
 * same shape and place share one hint with a count.
 */
export const privacyMaskingHintSchema = z.strictObject({
  kind: privacyMaskingKindSchema,
  length: z.number().int().positive().max(1_000_000),
  location: privacyMaskingLocationSchema,
  count: z.number().int().positive(),
});

export type PrivacyMaskingHint = z.infer<typeof privacyMaskingHintSchema>;

/**
 * What the runner reports once per model request where values were replaced.
 * Counts and shapes only: the placeholder registry and original values never
 * leave the runner.
 */
export const runnerPrivacyMaskingCaptureSchema = z
  .strictObject({
    request_id: z.uuid(),
    owner_id: z.uuid(),
    conversation_id: z.uuid().nullable(),
    turn_id: z.string().min(1).max(120).nullable(),
    model: z.string().min(1).max(200),
    kinds: privacyMaskingKindCountsSchema,
    masked_count: z.number().int().positive(),
    hints: z
      .array(privacyMaskingHintSchema)
      .max(PRIVACY_MASKING_ACTIVITY_HINT_LIMIT)
      .default([]),
    observed_at: z.iso.datetime(),
  })
  .superRefine((capture, context) => {
    refineKindKeys(capture.kinds, context, ["kinds"]);
  });

export type RunnerPrivacyMaskingCapture = z.infer<
  typeof runnerPrivacyMaskingCaptureSchema
>;

export const privacyMaskingActivityRecordSchema = z.strictObject({
  id: z.uuid(),
  model: z.string(),
  masked_count: z.number().int().nonnegative(),
  kinds: privacyMaskingKindCountsSchema,
  hints: z
    .array(privacyMaskingHintSchema)
    .max(PRIVACY_MASKING_ACTIVITY_HINT_LIMIT)
    .default([]),
  created_at: z.iso.datetime(),
});

export const privacyMaskingActivityResponseSchema = z.strictObject({
  summary: z.strictObject({
    masked_count: z.number().int().nonnegative(),
    request_count: z.number().int().nonnegative(),
  }),
  records: z.array(privacyMaskingActivityRecordSchema),
  next_before: z.iso.datetime().nullable(),
});

export type PrivacyMaskingActivityResponse = z.infer<
  typeof privacyMaskingActivityResponseSchema
>;

export const privacyMaskingActivityQuerySchema = z
  .strictObject({
    days: z.coerce
      .number()
      .int()
      .min(1)
      .max(PRIVACY_MASKING_ACTIVITY_RETENTION_DAYS)
      .default(7),
    before: z.iso.datetime().optional(),
    before_id: z.uuid().optional(),
  })
  .refine(({ before, before_id }) => !before_id || !!before, {
    path: ["before"],
    message: "privacy_masking_activity_cursor_time_required",
  });

export type PrivacyMaskingActivityQuery = z.infer<typeof privacyMaskingActivityQuerySchema>;

/**
 * Sent to the runner only while masking is enabled; its presence is the
 * switch. The placeholder key is derived by the API per user so identical
 * values in different users' traffic never share a placeholder.
 */
export const privacyMaskingRuntimeSchema = z.strictObject({
  revision: z.number().int().nonnegative(),
  secrets: z.boolean(),
  personal: z.boolean(),
  kinds: privacyMaskingKindMapSchema,
  words: z.array(privacyMaskingWordSchema).max(MAX_PRIVACY_MASKING_WORDS),
  words_any_case: z.boolean(),
  words_whole: z.boolean(),
  actions: privacyMaskingActionMapSchema,
  allow: z.array(privacyMaskingAllowSchema).max(MAX_PRIVACY_MASKING_VALUES),
  placeholder_key: z.string().regex(/^[0-9a-f]{64}$/u),
});

export type PrivacyMaskingRuntime = z.infer<
  typeof privacyMaskingRuntimeSchema
>;
