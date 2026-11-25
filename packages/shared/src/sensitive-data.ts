import { z } from "zod"

import {
  memoryExtractionRuntimeSchema,
  modelIdentifierSchema,
} from "./model-provider.js"

export const sensitiveDataInspectionSchema = z.enum(["turn_start", "every_request"])
export const MAX_SENSITIVE_DATA_DETECTION_PROMPT_LENGTH = 4_000
const detectionPromptSchema = z.string().trim()
  .max(MAX_SENSITIVE_DATA_DETECTION_PROMPT_LENGTH)
  .transform((prompt) => prompt || null)
  .nullable()
const localModelIdsSchema = z.array(modelIdentifierSchema).max(100).refine(
  (ids) => new Set(ids).size === ids.length,
  "duplicate_local_models",
)
const decisionEndpointSchema = z.string().trim().max(2048).url().refine((value) => {
  if (!URL.canParse(value)) return false
  const url = new URL(value)
  return ["http:", "https:"].includes(url.protocol) && !url.username &&
    !url.password && !url.search && !url.hash
}, "invalid_decision_endpoint")

export const sensitiveDataSettingsSchema = z.strictObject({
  enabled: z.boolean(),
  revision: z.number().int().nonnegative(),
  inspection: sensitiveDataInspectionSchema,
  local_model_ids: localModelIdsSchema,
  default_model_id: modelIdentifierSchema.nullable(),
  decision_endpoint: decisionEndpointSchema.nullable(),
  decision_model_id: modelIdentifierSchema.nullable(),
  detection_prompt: detectionPromptSchema.default(null),
  decision_key_configured: z.boolean(),
})

export const updateSensitiveDataSettingsSchema = sensitiveDataSettingsSchema
  .omit({ revision: true, decision_key_configured: true })
  .extend({
    expected_revision: z.number().int().nonnegative(),
    decision_api_key: z.string().trim().min(1).max(16_384).optional(),
    detection_prompt: detectionPromptSchema.optional(),
  })
  .refine((settings) => settings.default_model_id === null ||
    settings.local_model_ids.includes(settings.default_model_id), {
    path: ["default_model_id"],
    message: "default_must_be_a_local_model",
  })
  .refine((settings) => !settings.enabled || Boolean(
    settings.default_model_id && settings.decision_endpoint && settings.decision_model_id,
  ), { message: "sensitive_data_configuration_required" })

export const updateSensitiveDataPreferenceSchema = z.strictObject({
  selection: z.enum(["ask", "default"]),
  default_model_id: modelIdentifierSchema.nullable(),
  detection_prompt: detectionPromptSchema.optional(),
})
export const sensitiveDataPreferenceSchema = updateSensitiveDataPreferenceSchema.extend({
  detection_prompt: detectionPromptSchema.default(null),
})
export type SensitiveDataPreference = z.infer<typeof sensitiveDataPreferenceSchema>
export type UpdateSensitiveDataPreference = z.infer<typeof updateSensitiveDataPreferenceSchema>
export const defaultSensitiveDataPreference: SensitiveDataPreference = {
  selection: "ask",
  default_model_id: null,
  detection_prompt: null,
}

const localModelOptionSchema = z.strictObject({
  id: modelIdentifierSchema,
  name: z.string(),
})

export const sensitiveDataUserSettingsSchema = z.strictObject({
  enabled: z.boolean(),
  local_models: z.array(localModelOptionSchema),
  system_default_model_id: modelIdentifierSchema.nullable(),
  preference: sensitiveDataPreferenceSchema,
})

export const sensitiveDataChoiceSchema = z.strictObject({
  turn_id: z.uuid(),
  model_id: modelIdentifierSchema,
  remember: z.boolean(),
})

export const sensitiveDataModelSwitchSchema = z.strictObject({
  model_id: modelIdentifierSchema,
  expected_model_id: modelIdentifierSchema,
})
export type SensitiveDataModelSwitch = z.infer<typeof sensitiveDataModelSwitchSchema>

export const sensitiveDataTaskStatusSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("idle") }),
  z.strictObject({
    status: z.literal("waiting"),
    turn_id: z.uuid(),
    local_models: z.array(localModelOptionSchema),
    default_model_id: modelIdentifierSchema.nullable(),
  }),
  z.strictObject({
    status: z.literal("local"),
    model: localModelOptionSchema,
    local_models: z.array(localModelOptionSchema),
    next_model: localModelOptionSchema.optional(),
  }),
])

export type SensitiveDataSettings = z.infer<typeof sensitiveDataSettingsSchema>
export type UpdateSensitiveDataSettings = z.infer<typeof updateSensitiveDataSettingsSchema>
export type SensitiveDataUserSettings = z.infer<typeof sensitiveDataUserSettingsSchema>
export type SensitiveDataTaskStatus = z.infer<typeof sensitiveDataTaskStatusSchema>

// Only the authenticated worker relay consumes these contracts.
export const sensitiveDataContextLimit = 256 * 1024
export const sensitiveDataChoiceWaitMs = 90_000
const requestScope = {
  conversation_id: z.uuid(),
  turn_id: z.uuid().nullable(),
  execution_model: modelIdentifierSchema,
}
export const sensitiveDataRelayInputSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("transport"), ...requestScope }),
  z.strictObject({
    kind: z.literal("inspect"),
    ...requestScope,
    auxiliary: z.boolean(),
    context: z.string().max(sensitiveDataContextLimit).nullable(),
  }),
  z.strictObject({ kind: z.literal("selection"), ...requestScope }),
])
export const sensitiveDataRelayResultSchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("forward") }),
  z.strictObject({ action: z.literal("http") }),
  z.strictObject({ action: z.literal("blocked") }),
  z.strictObject({ action: z.literal("waiting") }),
  z.strictObject({
    action: z.literal("local"),
    runtime: memoryExtractionRuntimeSchema.extend({ revision: z.number().int().nonnegative() }),
  }),
])
export type SensitiveDataRelayInput = z.infer<typeof sensitiveDataRelayInputSchema>
export type SensitiveDataRelayResult = z.infer<typeof sensitiveDataRelayResultSchema>
