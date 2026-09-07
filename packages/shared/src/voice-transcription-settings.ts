import { z } from "zod"

import {
  modelIdentifierSchema,
  modelProviderBaseUrlSchema,
} from "./model-provider.js"

export const voiceTranscriptionProviderValues = [
  "dashscope",
  "openai",
  "openai_compatible",
  "azure_openai",
  "groq",
  "deepgram",
  "assemblyai",
  "elevenlabs",
  "revai",
  "gladia",
  "fal",
] as const

export const voiceTranscriptionProviderSchema = z.enum(
  voiceTranscriptionProviderValues,
)

export type VoiceTranscriptionProvider = z.infer<
  typeof voiceTranscriptionProviderSchema
>

export const voiceTranscriptionProviderDefinitions = [
  {
    key: "dashscope",
    default_model: "qwen3-asr-flash",
    default_base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    requires_api_version: false,
    model_editable: true,
  },
  {
    key: "openai",
    default_model: "gpt-4o-mini-transcribe",
    default_base_url: "https://api.openai.com/v1",
    requires_api_version: false,
    model_editable: true,
  },
  {
    key: "openai_compatible",
    default_model: "whisper-1",
    default_base_url: "https://api.openai.com/v1",
    requires_api_version: false,
    model_editable: true,
  },
  {
    key: "azure_openai",
    default_model: "gpt-4o-mini-transcribe",
    default_base_url: null,
    requires_api_version: true,
    model_editable: true,
  },
  {
    key: "groq",
    default_model: "whisper-large-v3-turbo",
    default_base_url: "https://api.groq.com/openai/v1",
    requires_api_version: false,
    model_editable: true,
  },
  {
    key: "deepgram",
    default_model: "nova-3",
    default_base_url: "https://api.deepgram.com",
    requires_api_version: false,
    model_editable: true,
  },
  {
    key: "assemblyai",
    default_model: "universal-3-5-pro",
    default_base_url: "https://api.assemblyai.com",
    requires_api_version: false,
    model_editable: true,
  },
  {
    key: "elevenlabs",
    default_model: "scribe_v2",
    default_base_url: "https://api.elevenlabs.io",
    requires_api_version: false,
    model_editable: true,
  },
  {
    key: "revai",
    default_model: "machine",
    default_base_url: "https://api.rev.ai",
    requires_api_version: false,
    model_editable: true,
  },
  {
    key: "gladia",
    default_model: "default",
    default_base_url: "https://api.gladia.io",
    requires_api_version: false,
    model_editable: false,
  },
  {
    key: "fal",
    default_model: "whisper",
    default_base_url: "https://queue.fal.run",
    requires_api_version: false,
    model_editable: true,
  },
] as const satisfies ReadonlyArray<{
  key: VoiceTranscriptionProvider
  default_model: string
  default_base_url: string | null
  requires_api_version: boolean
  model_editable: boolean
}>

export const voiceTranscriptionProviderOptionsSchema = z.strictObject({
  api_version: z.string().trim().min(1).max(120).nullable().default(null),
})

export type VoiceTranscriptionProviderOptions = z.infer<
  typeof voiceTranscriptionProviderOptionsSchema
>

export const voiceTranscriptionProviderDefinitionSchema = z.strictObject({
  key: voiceTranscriptionProviderSchema,
  default_model: modelIdentifierSchema,
  default_base_url: modelProviderBaseUrlSchema.nullable(),
  requires_api_version: z.boolean(),
  model_editable: z.boolean(),
})

export const voiceTranscriptionSettingsSchema = z.strictObject({
  configured: z.boolean(),
  revision: z.number().int().nonnegative(),
  enabled: z.boolean(),
  provider: voiceTranscriptionProviderSchema.nullable(),
  provider_options: voiceTranscriptionProviderOptionsSchema,
  base_url: modelProviderBaseUrlSchema.nullable(),
  api_key_configured: z.boolean(),
  model: modelIdentifierSchema.nullable(),
  providers: z.array(voiceTranscriptionProviderDefinitionSchema),
})

export const voiceTranscriptionAvailabilitySchema = z.strictObject({
  available: z.boolean(),
})

export const updateVoiceTranscriptionSettingsSchema = z
  .strictObject({
    expected_revision: z.number().int().nonnegative(),
    enabled: z.boolean(),
    provider: voiceTranscriptionProviderSchema.nullable(),
    provider_options: voiceTranscriptionProviderOptionsSchema.default({
      api_version: null,
    }),
    base_url: modelProviderBaseUrlSchema.nullable(),
    api_key: z.string().trim().min(1).max(16_384).optional(),
    model: modelIdentifierSchema.nullable(),
  })
  .superRefine((value, context) => {
    if (!value.enabled) return
    if (!value.provider) {
      context.addIssue({
        code: "custom",
        path: ["provider"],
        message: "voice_transcription_provider_required",
      })
    }
    if (!value.base_url) {
      context.addIssue({
        code: "custom",
        path: ["base_url"],
        message: "voice_transcription_base_url_required",
      })
    }
    if (!value.model) {
      context.addIssue({
        code: "custom",
        path: ["model"],
        message: "voice_transcription_model_required",
      })
    }
    if (
      value.provider === "azure_openai" &&
      !value.provider_options.api_version
    ) {
      context.addIssue({
        code: "custom",
        path: ["provider_options", "api_version"],
        message: "voice_transcription_api_version_required",
      })
    }
  })

export type VoiceTranscriptionSettings = z.infer<
  typeof voiceTranscriptionSettingsSchema
>
export type VoiceTranscriptionAvailability = z.infer<
  typeof voiceTranscriptionAvailabilitySchema
>
export type UpdateVoiceTranscriptionSettings = z.infer<
  typeof updateVoiceTranscriptionSettingsSchema
>
