import { z } from "zod"

import {
  modelTokenPricingSchema,
  modelTokenPricePerMillionSchema,
} from "./model-pricing.js"

export const reasoningEffortValues = [
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultra",
] as const

export const reasoningEffortSchema = z.enum(reasoningEffortValues)

type ReasoningEffortValue = (typeof reasoningEffortValues)[number]

export const genericReasoningEffortValues = [
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultra",
] as const satisfies readonly ReasoningEffortValue[]

export type ModelReasoningProfile = {
  supported_reasoning_efforts: readonly ReasoningEffortValue[]
  default_reasoning_effort: ReasoningEffortValue
}

export const genericModelReasoningProfile = {
  supported_reasoning_efforts: genericReasoningEffortValues,
  default_reasoning_effort: "medium",
} as const satisfies ModelReasoningProfile

export const modelProviderProtocolModeValues = [
  "native_responses",
  "responses_tool_compat",
  "chat_completions_bridge",
] as const

export const modelProviderProtocolModeSchema = z.enum(
  modelProviderProtocolModeValues,
)

export const modelServiceProviderValues = [
  "openai",
  "azure_openai",
  "anthropic",
  "google",
  "google_vertex",
  "alibaba",
  "deepseek",
  "openrouter",
  "openai_compatible",
] as const

export const modelServiceProviderSchema = z.enum(modelServiceProviderValues)

export const managedModelKindValues = [
  "chat",
  "embedding",
  "reranker",
] as const

export const managedModelKindSchema = z.enum(managedModelKindValues)

export const modelIdentifierSchema = z
  .string()
  .trim()
  .min(1)
  .max(240)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:/@+-]*$/u)

export const modelProviderIdentifierSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/u)

export const modelProviderNameSchema = z.string().trim().min(1).max(120)

const providerSpecificChannelShape = {
  provider_project: z.string().trim().min(1).max(240).nullable().default(null),
  provider_location: z.string().trim().min(1).max(120).nullable().default(null),
} as const

const managedModelIdentityShape = {
  id: modelIdentifierSchema,
  display_name: z.string().trim().min(1).max(120),
  enabled: z.boolean(),
} as const

const conversationReasoningShape = {
  supported_reasoning_efforts: z
    .array(reasoningEffortSchema)
    .min(1)
    .max(reasoningEffortValues.length),
  default_reasoning_effort: reasoningEffortSchema,
} as const

export const modelContextWindowSchema = z
  .number()
  .int()
  .positive()
  .max(Number.MAX_SAFE_INTEGER)

export const modelAutoCompactContextRatio = 0.85

export function modelAutoCompactTokenLimitFor(
  modelContextWindow: number
): number {
  return Math.max(
    1,
    Math.floor(modelContextWindow * modelAutoCompactContextRatio)
  )
}

export const managedConversationModelSchema = z
  .strictObject({
    ...managedModelIdentityShape,
    kind: z.literal("chat"),
    input_price_per_million: modelTokenPricePerMillionSchema.default("0"),
    cached_input_price_per_million:
      modelTokenPricePerMillionSchema.default("0"),
    output_price_per_million: modelTokenPricePerMillionSchema.default("0"),
    supports_image_input: z.boolean().default(false),
    context_window: modelContextWindowSchema.nullable().default(null),
    ...conversationReasoningShape,
  })
  .superRefine((model, context) => {
    validateReasoningProfile(model, context)
  })

export const managedEmbeddingModelSchema = z.strictObject({
  ...managedModelIdentityShape,
  kind: z.literal("embedding"),
  input_price_per_million: modelTokenPricePerMillionSchema.default("0"),
})

export const managedRerankerModelSchema = z.strictObject({
  ...managedModelIdentityShape,
  kind: z.literal("reranker"),
  input_price_per_million: modelTokenPricePerMillionSchema.default("0"),
})

export const managedPricedModelSchema = z.union([
  managedConversationModelSchema,
  managedEmbeddingModelSchema,
  managedRerankerModelSchema,
])

// Conversation preferences intentionally expose only selectable chat fields.
export const managedModelSchema = z.strictObject({
  id: modelIdentifierSchema,
  display_name: z.string().trim().min(1).max(120),
  enabled: z.boolean(),
  context_window: modelContextWindowSchema.nullable().default(null),
  supported_reasoning_efforts: z
    .array(reasoningEffortSchema)
    .min(1)
    .max(reasoningEffortValues.length),
  default_reasoning_effort: reasoningEffortSchema,
})

export const modelProviderBaseUrlSchema = z
  .url()
  .max(2_048)
  .refine((value) => {
    if (!URL.canParse(value)) return false
    const url = new URL(value)
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      url.username === "" &&
      url.password === "" &&
      url.search === "" &&
      url.hash === ""
    )
  }, "model_provider_base_url_invalid")
  .transform((value) => value.replace(/\/+$/u, ""))

export const modelProviderDiscoveryProtocolSchema = z.enum([
  "openai_compatible",
  "native",
])

// These presets describe the task gateway's Responses/Chat interfaces. Native
// vendor APIs are not interchangeable with that execution contract.
export const modelProviderPresets = {
  openai: { base_url: "https://api.openai.com/v1", protocol_mode: "native_responses", discovery_supported: true, requires_compatible_endpoint: false, discovery_protocol: "openai_compatible" },
  azure_openai: { base_url: null, protocol_mode: "responses_tool_compat", discovery_supported: false, requires_compatible_endpoint: true, discovery_protocol: "openai_compatible" },
  anthropic: { base_url: null, protocol_mode: "chat_completions_bridge", discovery_supported: true, requires_compatible_endpoint: true, discovery_protocol: "openai_compatible" },
  google: { base_url: "https://generativelanguage.googleapis.com/v1beta/openai", protocol_mode: "chat_completions_bridge", discovery_supported: true, requires_compatible_endpoint: false, discovery_protocol: "openai_compatible" },
  google_vertex: { base_url: null, protocol_mode: "chat_completions_bridge", discovery_supported: false, requires_compatible_endpoint: true, discovery_protocol: "openai_compatible" },
  alibaba: { base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1", protocol_mode: "chat_completions_bridge", discovery_supported: true, requires_compatible_endpoint: false, discovery_protocol: "openai_compatible" },
  deepseek: { base_url: "https://api.deepseek.com/v1", protocol_mode: "chat_completions_bridge", discovery_supported: true, requires_compatible_endpoint: false, discovery_protocol: "openai_compatible" },
  openrouter: { base_url: "https://openrouter.ai/api/v1", protocol_mode: "chat_completions_bridge", discovery_supported: true, requires_compatible_endpoint: false, discovery_protocol: "openai_compatible" },
  openai_compatible: { base_url: null, protocol_mode: "chat_completions_bridge", discovery_supported: true, requires_compatible_endpoint: false, discovery_protocol: "openai_compatible" },
} as const satisfies Record<ModelServiceProvider, {
  base_url: string | null
  protocol_mode: ModelProviderProtocolMode
  discovery_supported: boolean
  requires_compatible_endpoint: boolean
  discovery_protocol: z.infer<typeof modelProviderDiscoveryProtocolSchema>
}>

const modelProviderProbeShape = {
  channel_id: modelProviderIdentifierSchema.optional(),
  provider: modelServiceProviderSchema,
  ...providerSpecificChannelShape,
  base_url: modelProviderBaseUrlSchema,
  protocol_mode: modelProviderProtocolModeSchema,
  api_key: z.string().trim().min(1).max(16_384).optional(),
  discovery_protocol: modelProviderDiscoveryProtocolSchema.default("openai_compatible"),
} as const

export const modelProviderProbeInputSchema = z.strictObject(modelProviderProbeShape)
  .superRefine(validateProviderSpecificFields)

export const testModelProviderConnectionInputSchema = z.strictObject({
  ...modelProviderProbeShape,
  model_id: modelIdentifierSchema,
  kind: managedModelKindSchema.default("chat"),
}).superRefine(validateProviderSpecificFields)

export const discoveredProviderModelSchema = z.strictObject({
  id: modelIdentifierSchema,
  display_name: z.string().trim().min(1).max(120),
  context_window: modelContextWindowSchema.nullable(),
  supports_image_input: z.boolean().nullable(),
})

export const discoverModelProviderResultSchema = z.strictObject({
  status: z.enum(["supported", "manual_required"]),
  models: z.array(discoveredProviderModelSchema).max(100),
  truncated: z.boolean(),
})

export const testModelProviderConnectionResultSchema = z.strictObject({
  status: z.enum(["success", "unsupported"]),
  model_id: modelIdentifierSchema,
})

export type ModelProviderProbeInput = z.input<typeof modelProviderProbeInputSchema>
export type TestModelProviderConnectionInput = z.input<typeof testModelProviderConnectionInputSchema>
export type DiscoverModelProviderResult = z.infer<typeof discoverModelProviderResultSchema>
export type DiscoveredProviderModel = z.infer<typeof discoveredProviderModelSchema>
export type TestModelProviderConnectionResult = z.infer<typeof testModelProviderConnectionResultSchema>

const legacyManagedConversationModelSchema = z
  .strictObject({
    ...managedModelSchema.shape,
    input_price_per_million: modelTokenPricePerMillionSchema.default("0"),
    cached_input_price_per_million:
      modelTokenPricePerMillionSchema.default("0"),
    output_price_per_million: modelTokenPricePerMillionSchema.default("0"),
  })
  .transform((model): ManagedConversationModel => ({
    ...model,
    kind: "chat",
    supports_image_input: false,
    context_window: null,
  }))

const updateManagedModelSchema = z.union([
  managedPricedModelSchema,
  legacyManagedConversationModelSchema,
])

const updateModelCollectionSchema = z
  .array(updateManagedModelSchema)
  .max(100)

export const updateManagedModelProviderSchema = z
  .strictObject({
    id: modelProviderIdentifierSchema,
    name: modelProviderNameSchema.optional(),
    provider: modelServiceProviderSchema.default("openai_compatible"),
    ...providerSpecificChannelShape,
    base_url: modelProviderBaseUrlSchema,
    protocol_mode: modelProviderProtocolModeSchema.optional(),
    api_key: z.string().trim().min(1).max(16_384).optional(),
    models: updateModelCollectionSchema,
  })
  .superRefine(validateProviderSpecificFields)

export const managedModelProviderSettingsSchema = z
  .strictObject({
    id: modelProviderIdentifierSchema,
    name: modelProviderNameSchema.nullable().optional().default(null),
    provider: modelServiceProviderSchema,
    ...providerSpecificChannelShape,
    base_url: z.string(),
    protocol_mode: modelProviderProtocolModeSchema,
    api_key_configured: z.boolean(),
    models: z.array(managedPricedModelSchema),
  })
  .superRefine(validateProviderSpecificFields)

const modelProviderCollectionSchema = z
  .array(updateManagedModelProviderSchema)
  .min(1)
  .max(20)

function validateModelProviderCollection(
  value: {
    providers: z.infer<typeof modelProviderCollectionSchema>
    default_model: string | null
    title_model: string | null | undefined
    memory_extraction_model?: string | null | undefined
  },
  context: z.RefinementCtx,
): void {
  if (
    new Set(value.providers.map((provider) => provider.id)).size !==
    value.providers.length
  ) {
    context.addIssue({
      code: "custom",
      path: ["providers"],
      message: "model_provider_identifiers_must_be_unique",
    })
  }
  const models = value.providers.flatMap((provider) => provider.models)
  if (models.length > 100) {
    context.addIssue({
      code: "custom",
      path: ["providers"],
      message: "total_model_count_must_not_exceed_100",
    })
  }
  if (new Set(models.map((model) => model.id)).size !== models.length) {
    context.addIssue({
      code: "custom",
      path: ["providers"],
      message: "model_identifiers_must_be_unique",
    })
  }
  if (models.length > 0 && !models.some((model) => model.enabled)) {
    context.addIssue({
      code: "custom",
      path: ["providers"],
      message: "at_least_one_model_must_be_enabled",
    })
  }

  const chatModels = models.filter((model) => model.kind === "chat")
  if (
    value.memory_extraction_model != null &&
    !chatModels.some((model) => model.id === value.memory_extraction_model)
  ) {
    context.addIssue({
      code: "custom",
      path: ["memory_extraction_model"],
      message: "memory_extraction_model_must_be_a_chat_model",
    })
  }
  const enabledChatModels = chatModels.filter(
    (model) => model.kind === "chat" && model.enabled,
  )
  if (chatModels.length === 0) {
    if (value.default_model !== null) {
      context.addIssue({
        code: "custom",
        path: ["default_model"],
        message: "default_model_must_be_null_without_chat_models",
      })
    }
    if (value.title_model !== undefined && value.title_model !== null) {
      context.addIssue({
        code: "custom",
        path: ["title_model"],
        message: "title_model_must_be_null_without_chat_models",
      })
    }
    return
  }
  if (
    value.default_model === null ||
    !enabledChatModels.some((model) => model.id === value.default_model)
  ) {
    context.addIssue({
      code: "custom",
      path: ["default_model"],
      message: "default_model_must_be_an_enabled_chat_model",
    })
  }
  const titleModel = value.title_model ?? value.default_model
  if (
    titleModel === null ||
    !chatModels.some((model) => model.id === titleModel)
  ) {
    context.addIssue({
      code: "custom",
      path: ["title_model"],
      message: "title_model_must_be_a_chat_model",
    })
  }
}

export const updateModelProviderSettingsSchema = z
  .strictObject({
    expected_revision: z.number().int().nonnegative(),
    providers: modelProviderCollectionSchema,
    default_model: modelIdentifierSchema.nullable(),
    title_model: modelIdentifierSchema.nullable().optional(),
    memory_extraction_model: modelIdentifierSchema.nullable().optional(),
  })
  .superRefine((value, context) =>
    validateModelProviderCollection(
      {
        providers: value.providers,
        default_model: value.default_model,
        title_model: value.title_model,
        memory_extraction_model: value.memory_extraction_model,
      },
      context,
    ),
  )

export const updateModelAvailabilitySchema = z.strictObject({
  expected_revision: z.number().int().nonnegative(),
  model_id: modelIdentifierSchema,
  enabled: z.boolean(),
})

export const deleteModelProviderModelSchema = z.strictObject({
  expected_revision: z.number().int().nonnegative(),
  model_id: modelIdentifierSchema,
})

export const deleteModelProviderSchema = z.strictObject({
  expected_revision: z.number().int().nonnegative(),
  provider_id: modelProviderIdentifierSchema,
})

export const modelProviderSettingsSchema = z.strictObject({
  management_enabled: z.boolean().optional(),
  configured: z.boolean(),
  revision: z.number().int().nonnegative(),
  providers: z.array(managedModelProviderSettingsSchema),
  default_model: modelIdentifierSchema.nullable(),
  title_model: modelIdentifierSchema.nullable().default(null),
  memory_extraction_model: modelIdentifierSchema.nullable().default(null),
})

// Internal API-to-runner contract; never expose channel credentials to clients.
export const memoryExtractionRuntimeSchema = z.strictObject({
  model: modelIdentifierSchema,
  reasoningEffort: reasoningEffortSchema,
  baseUrl: modelProviderBaseUrlSchema,
  protocolMode: modelProviderProtocolModeSchema,
  apiKey: z.string().min(1).max(16_384),
  pricing: modelTokenPricingSchema,
})
export type MemoryExtractionRuntime = z.infer<typeof memoryExtractionRuntimeSchema>

export const codexModelReasoningCatalogEntrySchema = z
  .strictObject({
    id: modelIdentifierSchema,
    supported_reasoning_efforts: z
      .array(reasoningEffortSchema)
      .min(1)
      .max(reasoningEffortValues.length),
    default_reasoning_effort: reasoningEffortSchema,
  })
  .superRefine(validateReasoningProfile)

export const codexModelReasoningCatalogSchema = z.strictObject({
  models: z.array(codexModelReasoningCatalogEntrySchema).max(500),
})

export const modelPreferenceSchema = z.strictObject({
  configured: z.boolean(),
  models: z.array(managedModelSchema),
  default_model: modelIdentifierSchema.nullable(),
  selected_model: modelIdentifierSchema.nullable(),
  selected_reasoning_effort: reasoningEffortSchema.nullable(),
})

export const updateModelPreferenceSchema = z.strictObject({
  selected_model: modelIdentifierSchema,
  selected_reasoning_effort: reasoningEffortSchema,
})

function validateReasoningProfile(
  model: {
    supported_reasoning_efforts: ReasoningEffortValue[]
    default_reasoning_effort: ReasoningEffortValue
  },
  context: z.RefinementCtx,
): void {
  if (
    new Set(model.supported_reasoning_efforts).size !==
    model.supported_reasoning_efforts.length
  ) {
    context.addIssue({
      code: "custom",
      path: ["supported_reasoning_efforts"],
      message: "reasoning_efforts_must_be_unique",
    })
  }
  if (
    !model.supported_reasoning_efforts.includes(model.default_reasoning_effort)
  ) {
    context.addIssue({
      code: "custom",
      path: ["default_reasoning_effort"],
      message: "default_reasoning_effort_must_be_supported",
    })
  }
}

function validateProviderSpecificFields(
  provider: {
    provider: ModelServiceProvider
    provider_project: string | null
    provider_location: string | null
  },
  context: z.RefinementCtx,
): void {
  if (provider.provider !== "google_vertex") return
  if (provider.provider_project === null) {
    context.addIssue({
      code: "custom",
      path: ["provider_project"],
      message: "provider_project_is_required_for_google_vertex",
    })
  }
  if (provider.provider_location === null) {
    context.addIssue({
      code: "custom",
      path: ["provider_location"],
      message: "provider_location_is_required_for_google_vertex",
    })
  }
}

export type ReasoningEffort = z.infer<typeof reasoningEffortSchema>
export type ModelProviderProtocolMode = z.infer<
  typeof modelProviderProtocolModeSchema
>
export type ModelServiceProvider = z.infer<typeof modelServiceProviderSchema>
export type ManagedModelKind = z.infer<typeof managedModelKindSchema>
export type ManagedModel = z.infer<typeof managedModelSchema>
export type ManagedConversationModel = z.infer<
  typeof managedConversationModelSchema
>
export type ManagedEmbeddingModel = z.infer<typeof managedEmbeddingModelSchema>
export type ManagedRerankerModel = z.infer<typeof managedRerankerModelSchema>
export type ManagedPricedModel = z.infer<typeof managedPricedModelSchema>
export type ManagedModelProviderSettings = z.infer<
  typeof managedModelProviderSettingsSchema
>
export type UpdateManagedModelProvider = z.input<
  typeof updateManagedModelProviderSchema
>
export type ModelProviderSettings = z.infer<typeof modelProviderSettingsSchema>
export type UpdateModelProviderSettings = z.input<
  typeof updateModelProviderSettingsSchema
>
export type UpdateModelAvailability = z.infer<
  typeof updateModelAvailabilitySchema
>
export type DeleteModelProviderModel = z.infer<
  typeof deleteModelProviderModelSchema
>
export type DeleteModelProvider = z.infer<typeof deleteModelProviderSchema>
export type ModelPreference = z.infer<typeof modelPreferenceSchema>
export type UpdateModelPreference = z.infer<typeof updateModelPreferenceSchema>
export type CodexModelReasoningCatalog = z.infer<
  typeof codexModelReasoningCatalogSchema
>

export function isConversationModel(
  model: ManagedPricedModel,
): model is ManagedConversationModel {
  return model.kind === "chat"
}

export function applyModelReasoningProfile<T extends ManagedConversationModel>(
  model: T,
  profile: ModelReasoningProfile = genericModelReasoningProfile,
): T {
  return {
    ...model,
    supported_reasoning_efforts: [...profile.supported_reasoning_efforts],
    default_reasoning_effort: profile.supported_reasoning_efforts.includes(
      model.default_reasoning_effort,
    )
      ? model.default_reasoning_effort
      : profile.default_reasoning_effort,
  }
}
