import { describe, expect, it } from "vitest"

import {
  knowledgeModelSettingsSchema,
  updateKnowledgeModelSettingsSchema,
} from "../src/index.js"

describe("knowledge model settings contract", () => {
  it("exposes only existing model selections and deployment constraints", () => {
    const settings = knowledgeModelSettingsSchema.parse({
      revision: 1,
      embedding: {
        configured: true,
        model: "embedding-v1",
        dimensions: 2560,
        maximum_input_tokens: 8192,
      },
      rerank: {
        enabled: false,
        model: null,
        maximum_input_tokens: 8192,
        timeout_ms: 60000,
      },
    })

    expect(settings.embedding.model).toBe("embedding-v1")
    expect(settings.embedding).not.toHaveProperty("base_url")
    expect(settings.embedding).not.toHaveProperty("api_key_configured")
    expect(settings.embedding).not.toHaveProperty("input_price_per_million")
    expect(settings.rerank).not.toHaveProperty("base_url")
    expect(settings.rerank).not.toHaveProperty("api_key_configured")
    expect(settings.rerank).not.toHaveProperty("input_price_per_million")
  })

  it("rejects connection and pricing fields in selection updates", () => {
    const result = updateKnowledgeModelSettingsSchema.safeParse({
      expected_revision: 1,
      embedding: {
        model: "embedding-v1",
        base_url: "https://embedding.example.test",
        input_price_per_million: "1",
      },
      rerank: {
        enabled: false,
        model: null,
        api_key: "obsolete-secret",
      },
    })

    expect(result.success).toBe(false)
  })
})
