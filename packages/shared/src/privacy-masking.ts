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
