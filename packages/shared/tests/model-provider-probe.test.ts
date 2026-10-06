import { describe, expect, it } from "vitest"
import { modelProviderPresets, modelServiceProviderValues, modelProviderProbeInputSchema, testModelProviderConnectionInputSchema, discoverModelProviderResultSchema } from "../src/model-provider.js"

describe("model channel probe contracts", () => {
  const draft = { provider: "openai_compatible", base_url: "https://models.example.test/v1/", protocol_mode: "chat_completions_bridge" }
  it("accepts a draft before saving its models and leaves the key optional for saved-channel reuse", () => {
    expect(modelProviderProbeInputSchema.parse({ ...draft, channel_id: "saved-channel" })).toEqual({ ...draft, base_url: "https://models.example.test/v1", channel_id: "saved-channel", provider_project: null, provider_location: null, discovery_protocol: "openai_compatible" })
    expect(testModelProviderConnectionInputSchema.parse({ ...draft, model_id: "test-model" })).toMatchObject({ model_id: "test-model", kind: "chat" })
  })
  it("rejects unsafe service URLs and unknown draft fields", () => {
    for (const base_url of ["file:///private", "https://key:secret@example.test/v1", "https://example.test/v1?key=secret", "https://example.test/v1#secret"]) {
      expect(modelProviderProbeInputSchema.safeParse({ ...draft, base_url }).success).toBe(false)
    }
    expect(modelProviderProbeInputSchema.safeParse({ ...draft, raw_credential: "secret" }).success).toBe(false)
  })
  it("covers every provider with a task-compatible recommendation and avoids unsupported native URLs", () => {
    expect(Object.keys(modelProviderPresets).sort()).toEqual([...modelServiceProviderValues].sort())
    expect(modelProviderPresets.anthropic.base_url).toBeNull()
    expect(modelProviderPresets.google_vertex.base_url).toBeNull()
    expect(modelProviderPresets.azure_openai.base_url).toBeNull()
    expect(modelProviderPresets.anthropic.requires_compatible_endpoint).toBe(true)
    expect(modelProviderPresets.google.base_url).toBe("https://generativelanguage.googleapis.com/v1beta/openai")
    expect(modelProviderPresets.google.protocol_mode).toBe("chat_completions_bridge")
  })
  it("keeps discovered metadata optional and prevents credential or fabricated price fields", () => {
    const result = { status: "supported", truncated: false, models: [{ id: "model", display_name: "Model", context_window: null, supports_image_input: null }] }
    expect(discoverModelProviderResultSchema.safeParse(result).success).toBe(true)
    expect(discoverModelProviderResultSchema.safeParse({ ...result, api_key: "secret" }).success).toBe(false)
    expect(discoverModelProviderResultSchema.safeParse({ ...result, models: [{ ...result.models[0], input_price_per_million: "0" }] }).success).toBe(false)
  })
})
