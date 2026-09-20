import {
  genericModelReasoningProfile,
  modelContextWindowSchema,
  updateModelProviderSettingsSchema,
  type ManagedModelKind,
  type ManagedPricedModel,
  type ManagedConversationModel,
} from "@linksense/shared"
import { z } from "zod"
import type { ModelProviderSettings } from "@/api/contracts"

export type ModelChannel = ModelProviderSettings["providers"][number]
export type ModelSettingsDraft = z.output<
  typeof updateModelProviderSettingsSchema
>
export type ModelChannelUpdate = ModelSettingsDraft["providers"][number]

export function toSettingsProviderUpdate(
  provider: ModelChannel
): ModelChannelUpdate {
  return {
    id: provider.id,
    ...(provider.name ? { name: provider.name } : {}),
    provider: provider.provider,
    provider_project: provider.provider_project,
    provider_location: provider.provider_location,
    base_url: provider.base_url,
    protocol_mode: provider.protocol_mode,
    models: provider.models,
  }
}

export function settingsDraft(
  settings: ModelProviderSettings
): ModelSettingsDraft {
  return {
    expected_revision: settings.revision,
    providers: settings.providers.map(toSettingsProviderUpdate),
    default_model: settings.default_model,
    title_model: settings.title_model,
    memory_extraction_model: settings.memory_extraction_model,
  }
}

export function newModel(): ManagedConversationModel {
  return {
    id: "",
    display_name: "",
    kind: "chat",
    enabled: true,
    input_price_per_million: "0",
    cached_input_price_per_million: "0",
    output_price_per_million: "0",
    supports_image_input: false,
    context_window: null,
    supported_reasoning_efforts: [
      ...genericModelReasoningProfile.supported_reasoning_efforts,
    ],
    default_reasoning_effort:
      genericModelReasoningProfile.default_reasoning_effort,
  }
}

export function changeModelKind(
  model: ManagedPricedModel,
  kind: ManagedModelKind
): ManagedPricedModel {
  if (model.kind === kind) return model
  const identity = {
    id: model.id,
    display_name: model.display_name,
    enabled: model.enabled,
    input_price_per_million: model.input_price_per_million,
  }
  return kind === "chat"
    ? { ...newModel(), ...identity }
    : { ...identity, kind }
}

export function parseContextWindow(value: string): {
  value: number | null
  valid: boolean
} {
  const trimmed = value.trim()
  if (!trimmed) return { value: null, valid: true }
  const parsed = modelContextWindowSchema.safeParse(Number(trimmed))
  return /^[1-9]\d*$/u.test(trimmed) && parsed.success
    ? { value: parsed.data, valid: true }
    : { value: null, valid: false }
}

export function replaceChannel(
  settings: ModelProviderSettings,
  channel: ModelChannelUpdate,
  renamedModel?: { previousId: string; id: string }
): ModelSettingsDraft {
  const draft = settingsDraft(settings)
  const exists = draft.providers.some((provider) => provider.id === channel.id)
  draft.providers = exists
    ? draft.providers.map((provider) =>
        provider.id === channel.id ? channel : provider
      )
    : [...draft.providers, channel]
  const models = draft.providers.flatMap((provider) => provider.models)
  const chats = models.filter((model) => model.kind === "chat")
  const available = chats.filter((model) => model.enabled)
  const defaultId =
    renamedModel && renamedModel.previousId === draft.default_model
      ? renamedModel.id
      : draft.default_model
  const titleId =
    renamedModel && renamedModel.previousId === draft.title_model
      ? renamedModel.id
      : draft.title_model
  if (
    renamedModel &&
    renamedModel.previousId === draft.memory_extraction_model
  ) {
    draft.memory_extraction_model = renamedModel.id
  }
  draft.default_model =
    available.find((model) => model.id === defaultId)?.id ??
    available[0]?.id ??
    null
  draft.title_model =
    chats.find((model) => model.id === titleId)?.id ?? chats[0]?.id ?? null
  return draft
}

export function replaceModel(
  settings: ModelProviderSettings,
  channel: ModelChannel,
  model: ManagedPricedModel,
  previousId: string | null
): ModelSettingsDraft {
  const provider = toSettingsProviderUpdate(channel)
  provider.models =
    previousId === null
      ? [...channel.models, model]
      : channel.models.map((current) =>
          current.id === previousId ? model : current
        )
  return replaceChannel(
    settings,
    provider,
    previousId ? { previousId, id: model.id } : undefined
  )
}

export function isSettingsDraftValid(
  draft: ModelSettingsDraft,
  settings: ModelProviderSettings
): boolean {
  const result = updateModelProviderSettingsSchema.safeParse(draft)
  return (
    result.success &&
    result.data.providers.every((provider) => {
      const needsKey = provider.models.some(
        (model) =>
          (model.kind === "chat" && model.enabled) ||
          model.id === draft.title_model ||
          model.id === draft.memory_extraction_model
      )
      return (
        !needsKey ||
        Boolean(provider.api_key) ||
        settings.providers.some(
          (saved) => saved.id === provider.id && saved.api_key_configured
        )
      )
    })
  )
}
