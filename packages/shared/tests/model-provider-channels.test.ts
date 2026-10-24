import { describe, expect, it } from "vitest"
import { updateModelProviderSettingsSchema } from "../src/model-provider.js"

const channel = { id: "primary", name: "Primary", base_url: "https://models.example.test/v1", models: [] }

describe("model channel creation contract", () => {
  it.each(["test", null])("accepts a separate optional test model %j without adding a configured model", (test_model_id) => {
    const input = { expected_revision: 0, providers: [{ ...channel, test_model_id }], default_model: null, title_model: null }
    expect(updateModelProviderSettingsSchema.parse(input).providers[0]).toMatchObject({ test_model_id, models: [] })
  })
  it.each(["", "invalid model", "x".repeat(241)])("rejects an invalid test model ID %j", (test_model_id) => {
    expect(updateModelProviderSettingsSchema.safeParse({ expected_revision: 0, providers: [{ ...channel, test_model_id }], default_model: null, title_model: null }).success).toBe(false)
  })
  it("accepts channels without models and null model selections", () => {
    expect(updateModelProviderSettingsSchema.safeParse({ expected_revision: 0, providers: [channel], default_model: null, title_model: null }).success).toBe(true)
  })
  it.each(["default_model", "title_model", "memory_extraction_model"])("rejects a dangling %s for a channel without models", (field) => {
    expect(updateModelProviderSettingsSchema.safeParse({ expected_revision: 0, providers: [channel], default_model: null, title_model: null, [field]: "missing" }).success).toBe(false)
  })
})
