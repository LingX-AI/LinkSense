import { z } from "zod"

import { modelIdentifierSchema } from "./model-provider.js"

export const imageGenerationProviderValues = [
  "alibaba_bailian",
  "openai",
  "google_gemini",
  "stability",
  "fal",
  "replicate",
  "together",
] as const

export const imageGenerationProviderSchema = z.enum(
  imageGenerationProviderValues,
)

export const imageGenerationProviderDefinitions = [
  {
    key: "alibaba_bailian",
    default_model: "qwen-image-3.0",
    base_url:
      "https://{workspace_id}.{region}.maas.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation",
    requires_workspace_id: true,
    requires_region: true,
    default_region: "cn-beijing",
    max_images: 6,
  },
  {
    key: "openai",
    default_model: "gpt-image-2",
    base_url: "https://api.openai.com/v1",
    requires_workspace_id: false,
    requires_region: false,
    default_region: null,
    max_images: 10,
  },
  {
    key: "google_gemini",
    default_model: "gemini-3.1-flash-image",
    base_url: "https://generativelanguage.googleapis.com",
    requires_workspace_id: false,
    requires_region: false,
    default_region: null,
    max_images: 1,
  },
  {
    key: "stability",
    default_model: "stable-image-core",
    base_url: "https://api.stability.ai",
    requires_workspace_id: false,
    requires_region: false,
    default_region: null,
    max_images: 1,
  },
  {
    key: "fal",
    default_model: "fal-ai/flux/dev",
    base_url: "https://fal.run",
    requires_workspace_id: false,
    requires_region: false,
    default_region: null,
    max_images: 4,
  },
  {
    key: "replicate",
    default_model: "black-forest-labs/flux-schnell",
    base_url: "https://api.replicate.com/v1",
    requires_workspace_id: false,
    requires_region: false,
    default_region: null,
    max_images: 4,
  },
  {
    key: "together",
    default_model: "black-forest-labs/FLUX.1-schnell",
    base_url: "https://api.together.ai/v1",
    requires_workspace_id: false,
    requires_region: false,
    default_region: null,
    max_images: 4,
  },
] as const satisfies ReadonlyArray<{
  key: ImageGenerationProvider
  default_model: string
  base_url: string
  requires_workspace_id: boolean
  requires_region: boolean
  default_region: string | null
  max_images: number
}>

export const imageGenerationPricePerImageSchema = z
  .string()
  .trim()
  .regex(/^(?:0|[1-9]\d{0,3})(?:\.\d{1,6})?$/u)
  .transform(normalizeImageGenerationPrice)

export const imageGenerationCostAmountSchema = z
  .string()
  .trim()
  .regex(/^(?:0|[1-9]\d{0,4})(?:\.\d{1,6})?$/u)
  .transform(normalizeImageGenerationPrice)

export const imageGenerationProviderOptionsSchema = z.strictObject({
  workspace_id: z
    .string()
    .trim()
    .min(1)
    .max(240)
    .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/u)
    .nullable()
    .default(null),
  region: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .regex(/^[a-z0-9-]+$/u)
    .nullable()
    .default(null),
})

export const imageGenerationProviderDefinitionSchema = z.strictObject({
  key: imageGenerationProviderSchema,
  default_model: modelIdentifierSchema,
  base_url: z.string().min(1).max(2_048),
  requires_workspace_id: z.boolean(),
  requires_region: z.boolean(),
  default_region: z.string().min(1).max(120).nullable(),
  max_images: z.number().int().positive().max(10),
})

export const imageGenerationSettingsSchema = z.strictObject({
  configured: z.boolean(),
  revision: z.number().int().nonnegative(),
  enabled: z.boolean(),
  provider: imageGenerationProviderSchema.nullable(),
  provider_options: imageGenerationProviderOptionsSchema,
  base_url: z.string().min(1).max(2_048).nullable(),
  api_key_configured: z.boolean(),
  model: modelIdentifierSchema.nullable(),
  price_per_image: imageGenerationPricePerImageSchema,
  currency: z.literal("CNY"),
  providers: z.array(imageGenerationProviderDefinitionSchema),
})

export const updateImageGenerationSettingsSchema = z
  .strictObject({
    expected_revision: z.number().int().nonnegative(),
    enabled: z.boolean(),
    provider: imageGenerationProviderSchema.nullable(),
    provider_options: imageGenerationProviderOptionsSchema.default({
      workspace_id: null,
      region: null,
    }),
    api_key: z.string().trim().min(1).max(16_384).optional(),
    model: modelIdentifierSchema.nullable(),
    price_per_image: imageGenerationPricePerImageSchema.default("0"),
  })
  .superRefine((settings, context) => {
    if (!settings.enabled) return
    if (settings.provider === null) {
      context.addIssue({
        code: "custom",
        path: ["provider"],
        message: "provider_is_required_when_enabled",
      })
    }
    if (settings.model === null) {
      context.addIssue({
        code: "custom",
        path: ["model"],
        message: "model_is_required_when_enabled",
      })
    }
    if (
      settings.provider === "alibaba_bailian" &&
      settings.provider_options.workspace_id === null
    ) {
      context.addIssue({
        code: "custom",
        path: ["provider_options", "workspace_id"],
        message: "workspace_id_is_required_for_alibaba_bailian",
      })
    }
  })

export const imageGenerationRequestSchema = z.strictObject({
  prompt: z.string().trim().min(1).max(8_000),
  count: z.number().int().min(1).max(10).default(1),
  size: z
    .string()
    .trim()
    .regex(/^[1-9]\d{1,3}x[1-9]\d{1,3}$/u)
    .optional(),
  negative_prompt: z.string().trim().max(2_000).optional(),
  seed: z.number().int().min(0).max(4_294_967_295).optional(),
  background: z.enum(["opaque", "transparent"]).default("opaque"),
  transparency_mode: z
    .enum(["auto", "native", "chroma_key"])
    .default("auto"),
  chroma_key: z.enum(["green", "magenta"]).optional(),
}).superRefine((request, context) => {
  if (request.background === "opaque") {
    if (request.transparency_mode !== "auto") {
      context.addIssue({
        code: "custom",
        path: ["transparency_mode"],
        message: "transparency_mode_requires_transparent_background",
      })
    }
    if (request.chroma_key !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["chroma_key"],
        message: "chroma_key_requires_transparent_background",
      })
    }
  }
  if (
    request.background === "transparent" &&
    request.transparency_mode === "native" &&
    request.chroma_key !== undefined
  ) {
    context.addIssue({
      code: "custom",
      path: ["chroma_key"],
      message: "chroma_key_is_not_used_for_native_transparency",
    })
  }
})

export const imageGenerationTransparencyResultSchema = z.strictObject({
  requested: z.boolean(),
  strategy: z.enum(["none", "native", "chroma_key"]),
  chroma_key: z.enum(["green", "magenta"]).nullable(),
})

export const generatedImagePayloadSchema = z.strictObject({
  data_base64: z.string().min(1),
  mime_type: z.enum(["image/png", "image/jpeg", "image/webp"]),
  display_name: z.string().min(1).max(260),
  has_transparency: z.boolean(),
})

export const imageGenerationInternalResultSchema = z.strictObject({
  success: z.literal(true),
  provider: imageGenerationProviderSchema,
  model: modelIdentifierSchema,
  image_count: z.number().int().positive().max(10),
  unit_price: imageGenerationPricePerImageSchema,
  total_cost: imageGenerationCostAmountSchema,
  currency: z.literal("CNY"),
  transparency: imageGenerationTransparencyResultSchema,
  images: z.array(generatedImagePayloadSchema).min(1).max(10),
})

export const imageGenerationArtifactSchema = z.strictObject({
  artifact_id: z.uuid(),
  file_id: z.uuid(),
  display_name: z.string().min(1).max(260),
  download_card_event_id: z.uuid(),
  workspace_relative_path: z.string().min(1).max(2_000),
  mime_type: z.enum(["image/png", "image/jpeg", "image/webp"]),
  has_transparency: z.boolean(),
})

export const imageGenerationMcpSuccessSchema = z.strictObject({
  success: z.literal(true),
  provider: imageGenerationProviderSchema,
  model: modelIdentifierSchema,
  image_count: z.number().int().positive().max(10),
  unit_price: imageGenerationPricePerImageSchema,
  total_cost: imageGenerationCostAmountSchema,
  currency: z.literal("CNY"),
  transparency: imageGenerationTransparencyResultSchema,
  artifacts: z.array(imageGenerationArtifactSchema).min(1).max(10),
})

export const imageGenerationFailureCodeSchema = z.enum([
  "IMAGE_GENERATION_NOT_CONFIGURED",
  "IMAGE_GENERATION_FORBIDDEN",
  "IMAGE_GENERATION_TURN_INACTIVE",
  "IMAGE_GENERATION_INVALID",
  "IMAGE_GENERATION_UNAVAILABLE",
  "IMAGE_GENERATION_PROVIDER_REJECTED",
  "IMAGE_GENERATION_OUTPUT_INVALID",
  "IMAGE_GENERATION_TRANSPARENCY_UNSUPPORTED",
  "IMAGE_GENERATION_TRANSPARENCY_INVALID",
  "IMAGE_GENERATION_RECORDING_FAILED",
  "IMAGE_GENERATION_ARTIFACT_REGISTRATION_FAILED",
])

export const imageGenerationMcpFailureSchema = z.strictObject({
  code: imageGenerationFailureCodeSchema,
  retryable: z.boolean(),
  provider_code: z.string().trim().min(1).max(240).optional(),
  provider_message: z.string().trim().min(1).max(1_000).optional(),
  provider_request_id: z.string().trim().min(1).max(240).optional(),
})

export type ImageGenerationProvider = z.infer<
  typeof imageGenerationProviderSchema
>
export type ImageGenerationProviderOptions = z.infer<
  typeof imageGenerationProviderOptionsSchema
>
export type ImageGenerationSettings = z.infer<
  typeof imageGenerationSettingsSchema
>
export type UpdateImageGenerationSettings = z.input<
  typeof updateImageGenerationSettingsSchema
>
export type ImageGenerationRequest = z.infer<
  typeof imageGenerationRequestSchema
>
export type ImageGenerationInternalResult = z.infer<
  typeof imageGenerationInternalResultSchema
>
export type ImageGenerationMcpSuccess = z.infer<
  typeof imageGenerationMcpSuccessSchema
>
export type ImageGenerationMcpFailure = z.infer<
  typeof imageGenerationMcpFailureSchema
>

export function normalizeImageGenerationPrice(value: string): string {
  const [whole = "0", fraction = ""] = value.split(".")
  const normalizedFraction = fraction.replace(/0+$/u, "")
  return normalizedFraction === "" ? whole : `${whole}.${normalizedFraction}`
}
