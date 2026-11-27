import { describe, expect, it, vi } from "vitest"

import {
  createModelsDevModelCatalog,
  parseModelsDevCatalog,
  resolveCatalogContextWindow,
  resolveCatalogReasoningProfile,
} from "../src/modules/system/model-catalog.js"

const catalogPayload = {
  deepseek: {
    name: "DeepSeek",
    models: {
      "deepseek-flash": {
        id: "deepseek-flash",
        name: "DeepSeek V4.1 Flash 1017",
        canonical_model_id: "deepseek/deepseek-v4.1-flash-1017",
        limit: { context: 1_048_576, output: 393_216 },
        reasoning_options: [
          { type: "toggle" },
          { type: "effort", values: ["none", "low", "high", "max"] },
        ],
      },
      "deepseek-v4-flash": {
        id: "deepseek-v4-flash",
        name: "DeepSeek V4 Flash",
        limit: { context: 1_048_576, output: 393_216 },
      },
    },
  },
  openai: {
    name: "OpenAI",
    models: {
      "gpt-5.4": {
        id: "gpt-5.4",
        name: "GPT-5.4",
        limit: { context: 400_000 },
        reasoning_options: [
          {
            type: "effort",
            values: ["low", "medium", "high", "xhigh", "max"],
          },
        ],
      },
      "no-reasoning-effort": {
        id: "no-reasoning-effort",
        name: "No reasoning effort",
        reasoning_options: [{ type: "effort", values: ["none"] }],
      },
    },
  },
}

function catalogFetcher(payload: unknown = catalogPayload) {
  return vi.fn(
    async () =>
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
  )
}

describe("models.dev model catalog", () => {
  it("parses provider models and their capabilities", () => {
    const catalog = parseModelsDevCatalog(catalogPayload)
    expect(catalog?.get("deepseek")).toMatchObject([
      {
        id: "deepseek-flash",
        name: "DeepSeek V4.1 Flash 1017",
        canonicalId: "deepseek/deepseek-v4.1-flash-1017",
        contextWindow: 1_048_576,
        reasoningProfile: {
          supported_reasoning_efforts: ["low", "high", "max"],
          default_reasoning_effort: "high",
        },
      },
      {
        id: "deepseek-v4-flash",
        contextWindow: 1_048_576,
        reasoningProfile: null,
      },
    ])
  })

  it("maps catalog effort levels onto the LinkSense scale", () => {
    const openai = parseModelsDevCatalog(catalogPayload)?.get("openai") ?? []
    expect(
      resolveCatalogReasoningProfile(openai, {
        id: "gpt-5.4",
        display_name: "GPT-5.4",
      })
    ).toEqual({
      supported_reasoning_efforts: ["low", "medium", "high", "xhigh", "max"],
      default_reasoning_effort: "medium",
    })
    expect(
      resolveCatalogReasoningProfile(openai, {
        id: "no-reasoning-effort",
        display_name: "No reasoning effort",
      })
    ).toBeNull()
  })

  it("rejects a catalog payload with an unexpected shape", () => {
    expect(parseModelsDevCatalog({ deepseek: { models: "invalid" } })).toBeNull()
    expect(parseModelsDevCatalog(null)).toBeNull()
  })

  it("ignores zero and missing context limits from non-chat models", () => {
    const catalog = parseModelsDevCatalog({
      stepfun: {
        models: {
          tts: { id: "tts", name: "TTS", limit: { context: 0 } },
          "no-limit": { id: "no-limit", name: "No limit" },
          empty: { id: "empty", name: "Empty", limit: null },
          malformed: { id: 42, limit: { context: "large" } },
        },
      },
      "empty-provider": {},
    })
    expect(catalog?.get("stepfun")).toMatchObject([
      { id: "tts", contextWindow: null },
      { id: "no-limit", contextWindow: null },
      { id: "empty", contextWindow: null },
    ])
    expect(catalog?.get("empty-provider")).toEqual([])
  })

  it("matches a dated catalog name to the configured model id", () => {
    const deepseek = parseModelsDevCatalog(catalogPayload)?.get("deepseek") ?? []
    expect(
      resolveCatalogContextWindow(deepseek, {
        id: "deepseek-v4.1-flash",
        display_name: "DeepSeek-V4.1-Flash",
      })
    ).toBe(1_048_576)
    expect(
      resolveCatalogReasoningProfile(deepseek, {
        id: "deepseek-v4.1-flash",
        display_name: "DeepSeek-V4.1-Flash",
      })
    ).toEqual({
      supported_reasoning_efforts: ["low", "high", "max"],
      default_reasoning_effort: "high",
    })
  })

  it("does not return a value when fuzzy matches disagree", () => {
    expect(
      resolveCatalogContextWindow(
        [
          {
            id: "foo-bar-1017",
            name: "Foo Bar 1017",
            canonicalId: null,
            contextWindow: 100_000,
            reasoningProfile: null,
          },
          {
            id: "foo-bar-2025",
            name: "Foo Bar 2025",
            canonicalId: null,
            contextWindow: 200_000,
            reasoningProfile: null,
          },
        ],
        { id: "foo-bar", display_name: "Foo Bar" }
      )
    ).toBeNull()
  })

  it("looks only at the configured provider's catalog entries", async () => {
    const client = createModelsDevModelCatalog(
      catalogFetcher() as unknown as typeof fetch
    )
    await expect(
      client.resolveContextWindows("openai", [
        { id: "deepseek-v4-flash", display_name: "DeepSeek V4 Flash" },
      ])
    ).resolves.toEqual(new Map())
  })

  it("searches every provider when a compatible endpoint has no preset", async () => {
    const client = createModelsDevModelCatalog(
      catalogFetcher() as unknown as typeof fetch
    )
    await expect(
      client.resolveContextWindows("openai_compatible", [
        { id: "gpt-5.4", display_name: "GPT-5.4" },
      ])
    ).resolves.toEqual(new Map([["gpt-5.4", 400_000]]))
    await expect(
      client.resolveReasoningProfiles("openai_compatible", [
        { id: "gpt-5.4", display_name: "GPT-5.4" },
      ])
    ).resolves.toEqual(
      new Map([
        [
          "gpt-5.4",
          {
            supported_reasoning_efforts: [
              "low",
              "medium",
              "high",
              "xhigh",
              "max",
            ],
            default_reasoning_effort: "medium",
          },
        ],
      ])
    )
  })

  it("caches a successful catalog download", async () => {
    const fetcher = catalogFetcher()
    const client = createModelsDevModelCatalog(
      fetcher as unknown as typeof fetch
    )
    const query = [{ id: "deepseek-v4-flash", display_name: "DeepSeek V4 Flash" }]
    await client.resolveContextWindows("deepseek", query)
    await client.resolveReasoningProfiles("deepseek", query)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it("fails closed and caches a failed download", async () => {
    const fetcher = vi.fn(async () => {
      throw new Error("offline")
    })
    const client = createModelsDevModelCatalog(
      fetcher as unknown as typeof fetch
    )
    const query = [{ id: "deepseek-v4-flash", display_name: "DeepSeek V4 Flash" }]
    await expect(
      client.resolveContextWindows("deepseek", query)
    ).resolves.toEqual(new Map())
    await expect(
      client.resolveReasoningProfiles("deepseek", query)
    ).resolves.toEqual(new Map())
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})
