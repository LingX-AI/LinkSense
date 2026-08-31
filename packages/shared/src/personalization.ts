import { z } from "zod";

import { timestampSchema, uuidSchema } from "./common.js";
import { modelIdentifierSchema } from "./model-provider.js";
import { modelTokenPricingSchema } from "./model-pricing.js";
import { usageMeasurementMethodSchema } from "./usage.js";

export const MAX_CUSTOM_INSTRUCTIONS_LENGTH = 20_000;

export const personalizationSettingsSchema = z.strictObject({
  custom_instructions: z.string().max(MAX_CUSTOM_INSTRUCTIONS_LENGTH),
  memories_enabled: z.boolean(),
});

export const updatePersonalizationSettingsSchema = personalizationSettingsSchema
  .partial()
  .refine(
    (input) =>
      input.custom_instructions !== undefined ||
      input.memories_enabled !== undefined,
    "personalization_update_must_not_be_empty",
  );

export const resetMemoriesResultSchema = z.strictObject({
  reset: z.literal(true),
});

export const memoryGenerationOperationValues = [
  "extract",
  "consolidate",
] as const;
export const memoryGenerationOperationSchema = z.enum(
  memoryGenerationOperationValues,
);

const memoryTokenCountSchema = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER);

export const runnerMemoryUsageCaptureSchema = z
  .strictObject({
    request_id: uuidSchema,
    owner_id: uuidSchema,
    conversation_id: uuidSchema,
    operation: memoryGenerationOperationSchema,
    model: modelIdentifierSchema,
    measurement_method: usageMeasurementMethodSchema,
    token_usage: z.strictObject({
      total_tokens: memoryTokenCountSchema,
      input_tokens: memoryTokenCountSchema,
      cached_input_tokens: memoryTokenCountSchema,
      output_tokens: memoryTokenCountSchema,
      reasoning_output_tokens: memoryTokenCountSchema,
    }),
    pricing: modelTokenPricingSchema,
    observed_at: timestampSchema,
  })
  .superRefine((usage, context) => {
    if (
      usage.token_usage.cached_input_tokens > usage.token_usage.input_tokens
    ) {
      context.addIssue({
        code: "custom",
        path: ["token_usage", "cached_input_tokens"],
        message: "cached_input_tokens_must_be_input_subset",
      });
    }
    if (
      usage.token_usage.reasoning_output_tokens >
      usage.token_usage.output_tokens
    ) {
      context.addIssue({
        code: "custom",
        path: ["token_usage", "reasoning_output_tokens"],
        message: "reasoning_output_tokens_must_be_output_subset",
      });
    }
  });

export type PersonalizationSettings = z.infer<
  typeof personalizationSettingsSchema
>;
export type UpdatePersonalizationSettings = z.infer<
  typeof updatePersonalizationSettingsSchema
>;
export type MemoryGenerationOperation = z.infer<
  typeof memoryGenerationOperationSchema
>;
export type RunnerMemoryUsageCapture = z.infer<
  typeof runnerMemoryUsageCaptureSchema
>;
