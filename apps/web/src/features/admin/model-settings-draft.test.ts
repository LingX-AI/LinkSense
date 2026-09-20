import { describe, expect, it } from "vitest"
import type { ModelProviderSettings } from "@/api/contracts"
import {
  changeModelKind,
  isSettingsDraftValid,
  newModel,
  parseContextWindow,
  replaceModel,
  settingsDraft,
} from "./model-settings-draft"

const first = { ...newModel(), id: "alpha", display_name: "Alpha" }
const second = { ...newModel(), id: "beta", display_name: "Beta" }
const channel: ModelProviderSettings["providers"][number] = {
  id: "channel",
  name: "Main",
  provider: "openai_compatible",
  provider_project: null,
  provider_location: null,
  base_url: "https://models.example.test/v1",
  protocol_mode: "native_responses",
  api_key_configured: true,
  models: [first, second],
}
const settings: ModelProviderSettings = {
  configured: true,
  revision: 1,
  providers: [channel],
  default_model: "alpha",
  memory_extraction_model: null,
  title_model: "alpha",
}

describe("model settings drafts", () => {
  it("preserves the selected memory model when renaming it", () => {
    const configured = { ...settings, memory_extraction_model: "beta" }
    const renamed = replaceModel(
      configured,
      channel,
      { ...second, id: "renamed-memory" },
      "beta"
    )
    expect(renamed.memory_extraction_model).toBe("renamed-memory")
    expect(isSettingsDraftValid(renamed, configured)).toBe(true)
    expect(configured.memory_extraction_model).toBe("beta")

    const converted = replaceModel(
      configured,
      channel,
      changeModelKind(second, "embedding"),
      "beta"
    )
    expect(isSettingsDraftValid(converted, configured)).toBe(false)
  })

  it("requires credentials for a memory-only channel even when its model is hidden from conversations", () => {
    const memoryChannel = {
      ...channel,
      id: "memory-channel",
      api_key_configured: false,
      models: [{ ...second, enabled: false }],
    }
    const configured = {
      ...settings,
      providers: [{ ...channel, models: [first] }, memoryChannel],
      memory_extraction_model: "beta",
    }
    const draft = settingsDraft(configured)
    expect(isSettingsDraftValid(draft, configured)).toBe(false)
    const memoryProvider = draft.providers[1]
    if (!memoryProvider) throw new Error("Missing memory channel")
    memoryProvider.api_key = "test-memory-key"
    expect(isSettingsDraftValid(draft, configured)).toBe(true)
  })

  it("renames default and title references with the model while preserving siblings and quotas", () => {
    const result = replaceModel(
      settings,
      channel,
      { ...first, id: "renamed" },
      "alpha"
    )
    expect(result).toMatchObject({
      default_model: "renamed",
      title_model: "renamed",
      providers: [{ models: [{ id: "renamed" }, second] }],
    })
    expect(settings.providers[0]?.models[0]?.id).toBe("alpha")
    expect(result.providers[0]).not.toHaveProperty("api_key")
    expect(isSettingsDraftValid(result, settings)).toBe(true)
  })
  it("moves system selections to a chat model when converting the selected model to retrieval", () => {
    const converted = changeModelKind(first, "embedding")
    expect(converted).toEqual({
      id: "alpha",
      display_name: "Alpha",
      enabled: true,
      input_price_per_million: "0",
      kind: "embedding",
    })
    expect(replaceModel(settings, channel, converted, "alpha")).toMatchObject({
      default_model: "beta",
      title_model: "beta",
    })
    expect(changeModelKind(converted, "chat")).toMatchObject({
      kind: "chat",
      id: "alpha",
      context_window: null,
      supported_reasoning_efforts: newModel().supported_reasoning_efforts,
    })
  })
  it("rejects duplicate model IDs across the catalog", () => {
    const draft = replaceModel(
      settings,
      channel,
      { ...first, id: "beta" },
      "alpha"
    )
    expect(isSettingsDraftValid(draft, settings)).toBe(false)
  })
  it("requires credentials for channels with models used for conversations", () => {
    const unconfigured = {
      ...settings,
      providers: [{ ...channel, api_key_configured: false }],
    }
    const draft = settingsDraft(unconfigured)
    expect(isSettingsDraftValid(draft, unconfigured)).toBe(false)
    if (!draft.providers[0]) throw new Error("Missing channel")
    draft.providers[0].api_key = "test-key"
    expect(isSettingsDraftValid(draft, unconfigured)).toBe(true)
  })
  it("keeps order and leaves retrieval models out of default selections", () => {
    const draft = replaceModel(
      settings,
      channel,
      changeModelKind({ ...first, id: "embedding" }, "embedding"),
      null
    )
    expect(draft.providers[0]?.models.map((model) => model.id)).toEqual([
      "alpha",
      "beta",
      "embedding",
    ])
    expect(draft).toMatchObject({
      default_model: "alpha",
      title_model: "alpha",
    })
  })
  it.each(["", "   "])(
    "uses auto-detection for empty context input %j",
    (input) => {
      expect(parseContextWindow(input)).toEqual({ valid: true, value: null })
    }
  )
  it.each(["1.5", "-1", "0", "abc", "1e3", "9007199254740992"])(
    "rejects invalid context input %j",
    (input) => {
      expect(parseContextWindow(input).valid).toBe(false)
    }
  )
  it("accepts a positive integer context window", () => {
    expect(parseContextWindow(" 128000 ")).toEqual({
      valid: true,
      value: 128000,
    })
  })
})
