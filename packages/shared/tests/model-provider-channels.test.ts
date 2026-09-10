import { describe, expect, it } from "vitest"
import { updateModelProviderSettingsSchema } from "../src/model-provider.js"

const channel = { id: "primary", name: "Primary", base_url: "https://models.example.test/v1", models: [] }

describe("model channel creation contract", () => {
  it("accepts channels without models and null model selections", () => {
    expect(updateModelProviderSettingsSchema.safeParse({ expected_revision: 0, providers: [channel], default_model: null, title_model: null }).success).toBe(true)
  })
  it.each(["default_model", "title_model"])("rejects a dangling %s for a channel without models", (field) => {
    expect(updateModelProviderSettingsSchema.safeParse({ expected_revision: 0, providers: [channel], default_model: null, title_model: null, [field]: "missing" }).success).toBe(false)
  })
})
