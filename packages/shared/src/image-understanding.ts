import { z } from "zod";

import { knowledgeSha256Schema } from "./knowledge.js";
import {
  modelIdentifierSchema,
  modelProviderBaseUrlSchema,
  modelServiceProviderSchema,
  modelServiceProviderValues,
} from "./model-provider.js";

export const imageUnderstandingProviderValues = modelServiceProviderValues;
export const imageUnderstandingProviderSchema = modelServiceProviderSchema;

export const imageThinkingStrategyValues = [
  "non_reasoning_model",
  "openai_none",
  "anthropic_disabled",
  "google_zero_budget",
  "alibaba_disabled",
  "deepseek_disabled",
  "openrouter_none",
  "vllm_qwen_disabled",
] as const;

export const imageThinkingStrategySchema = z.enum(imageThinkingStrategyValues);
export const imageThinkingPolicySchema = z.literal("disabled_required");

export const imageUnderstandingDescriptionSchema = z.strictObject({
  description: z.string().trim().min(1).max(500),
});

export const imageUnderstandingSettingsSchema = z.strictObject({
  configured: z.boolean(),
  enabled: z.boolean(),
  revision: z.number().int().nonnegative(),
  provider: imageUnderstandingProviderSchema.nullable(),
  base_url: z.string().max(2_048).nullable(),
  api_key_configured: z.boolean(),
  model: modelIdentifierSchema.nullable(),
  project: z.string().trim().min(1).max(240).nullable(),
  location: z.string().trim().min(1).max(120).nullable(),
  thinking_policy: imageThinkingPolicySchema,
  thinking_strategy: imageThinkingStrategySchema.nullable(),
});

export const updateImageUnderstandingSettingsSchema = z
  .strictObject({
    expected_revision: z.number().int().nonnegative(),
    enabled: z.boolean(),
    provider: imageUnderstandingProviderSchema.nullable(),
    base_url: modelProviderBaseUrlSchema.nullable(),
    api_key: z.string().trim().min(1).max(16_384).optional(),
    model: modelIdentifierSchema.nullable(),
    project: z.string().trim().min(1).max(240).nullable().default(null),
    location: z.string().trim().min(1).max(120).nullable().default(null),
  })
  .superRefine((settings, context) => {
    if (settings.enabled && settings.provider === null) {
      context.addIssue({
        code: "custom",
        path: ["provider"],
        message: "provider_is_required_when_enabled",
      });
    }
    if (settings.enabled && settings.model === null) {
      context.addIssue({
        code: "custom",
        path: ["model"],
        message: "model_is_required_when_enabled",
      });
    }
    if (
      settings.enabled &&
      (settings.provider === "openai_compatible" ||
        settings.provider === "azure_openai") &&
      settings.base_url === null
    ) {
      context.addIssue({
        code: "custom",
        path: ["base_url"],
        message: "base_url_is_required_for_selected_provider",
      });
    }
    if (
      settings.enabled &&
      settings.provider === "google_vertex" &&
      settings.project === null
    ) {
      context.addIssue({
        code: "custom",
        path: ["project"],
        message: "project_is_required_for_google_vertex",
      });
    }
    if (
      settings.enabled &&
      settings.provider === "google_vertex" &&
      settings.location === null
    ) {
      context.addIssue({
        code: "custom",
        path: ["location"],
        message: "location_is_required_for_google_vertex",
      });
    }
  });

export const updateImageUnderstandingSelectionSchema = z
  .strictObject({
    expected_revision: z.number().int().nonnegative(),
    enabled: z.boolean(),
    model: modelIdentifierSchema.nullable(),
  })
  .superRefine((settings, context) => {
    if (settings.enabled && settings.model === null) {
      context.addIssue({
        code: "custom",
        path: ["model"],
        message: "model_is_required_when_enabled",
      });
    }
  });

export const imageUnderstandingSnapshotSchema = z.strictObject({
  enabled: z.boolean(),
  revision: z.number().int().nonnegative(),
  provider: imageUnderstandingProviderSchema.nullable(),
  model: modelIdentifierSchema.nullable(),
  endpoint_identifier: z.string().trim().min(1).max(2_048).nullable(),
  thinking_policy: imageThinkingPolicySchema,
  thinking_strategy: imageThinkingStrategySchema.nullable(),
  prompt_version: z.string().trim().min(1).max(120),
  output_schema_version: z.string().trim().min(1).max(120),
  config_digest: knowledgeSha256Schema,
});

export type ImageUnderstandingProvider = z.infer<
  typeof imageUnderstandingProviderSchema
>;
export type ImageThinkingStrategy = z.infer<
  typeof imageThinkingStrategySchema
>;
export type ImageUnderstandingDescription = z.infer<
  typeof imageUnderstandingDescriptionSchema
>;
export type ImageUnderstandingSettings = z.infer<
  typeof imageUnderstandingSettingsSchema
>;
export type UpdateImageUnderstandingSettings = z.input<
  typeof updateImageUnderstandingSettingsSchema
>;
export type UpdateImageUnderstandingSelection = z.input<
  typeof updateImageUnderstandingSelectionSchema
>;
export type ImageUnderstandingSnapshot = z.infer<
  typeof imageUnderstandingSnapshotSchema
>;
