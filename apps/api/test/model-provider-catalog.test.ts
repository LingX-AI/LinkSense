import { describe, expect, it, vi } from "vitest"

import { HttpModelProviderCatalogClient } from "../src/modules/system/model-provider-catalog.js"

const baseInput = {
  provider: "openai" as const,
  baseUrl: "https://models.example.test/v1",
  apiKey: "provider-secret",
  providerProject: null,
  providerLocation: null,
}

const publicLookup = vi.fn(async () => [
  { address: "93.184.216.34", family: 4 as const },
]) as unknown as typeof import("node:dns").promises.lookup

function catalogClient(fetchImplementation: typeof fetch) {
  return new HttpModelProviderCatalogClient(fetchImplementation, publicLookup)
}

describe("HttpModelProviderCatalogClient", () => {
  it("lists and normalizes OpenAI-compatible models", async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async () =>
      Response.json({
        data: [
          {
            id: "vision-model",
            name: "Vision Model",
            context_length: 128_000,
            architecture: { input_modalities: ["text", "image"] },
          },
        ],
      })
    )
    const client = catalogClient(fetchImplementation)

    await expect(client.listModels(baseInput)).resolves.toEqual([
      {
        id: "vision-model",
        display_name: "Vision Model",
        kind: null,
        context_window: 128_000,
        supports_image_input: true,
        supported_reasoning_efforts: null,
        default_reasoning_effort: null,
      },
    ])
    expect(fetchImplementation).toHaveBeenCalledWith(
      new URL("https://models.example.test/v1/models"),
      expect.objectContaining({
        method: "GET",
        redirect: "manual",
        headers: expect.any(Headers),
      })
    )
    const headers = fetchImplementation.mock.calls[0]?.[1]?.headers as Headers
    expect(headers.get("authorization")).toBe("Bearer provider-secret")
  })

  it("uses Anthropic authentication and capability metadata", async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async () =>
      Response.json({
        data: [
          {
            type: "model",
            id: "claude-model",
            display_name: "Claude Model",
            max_input_tokens: 200_000,
            capabilities: {
              image_input: { supported: true },
              effort: {
                supported: true,
                low: { supported: true },
                medium: { supported: true },
                high: { supported: true },
              },
            },
          },
        ],
        has_more: false,
      })
    )
    const client = catalogClient(fetchImplementation)

    await expect(
      client.listModels({ ...baseInput, provider: "anthropic" })
    ).resolves.toEqual([
      expect.objectContaining({
        id: "claude-model",
        kind: "chat",
        context_window: 200_000,
        supports_image_input: true,
        supported_reasoning_efforts: ["low", "medium", "high"],
        default_reasoning_effort: "medium",
      }),
    ])
    const headers = fetchImplementation.mock.calls[0]?.[1]?.headers as Headers
    expect(headers.get("x-api-key")).toBe("provider-secret")
    expect(headers.get("anthropic-version")).toBe("2023-06-01")
    expect(headers.has("authorization")).toBe(false)
  })

  it("uses the Gemini catalog shape and API key header", async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async () =>
      Response.json({
        models: [
          {
            name: "models/gemini-model",
            baseModelId: "gemini-model",
            displayName: "Gemini Model",
            inputTokenLimit: 1_000_000,
            supportedGenerationMethods: ["generateContent"],
          },
          {
            name: "models/embedding-model",
            baseModelId: "embedding-model",
            displayName: "Embedding Model",
            inputTokenLimit: 2_048,
            supportedGenerationMethods: ["embedContent"],
          },
        ],
      })
    )
    const client = catalogClient(fetchImplementation)

    await expect(
      client.listModels({ ...baseInput, provider: "google" })
    ).resolves.toEqual([
      expect.objectContaining({ id: "gemini-model", kind: "chat" }),
      expect.objectContaining({ id: "embedding-model", kind: "embedding" }),
    ])
    const [url, request] = fetchImplementation.mock.calls[0] ?? []
    expect(String(url)).toBe(
      "https://models.example.test/v1/models?pageSize=1000"
    )
    expect((request?.headers as Headers).get("x-goog-api-key")).toBe(
      "provider-secret"
    )
  })

  it("uses provider-specific Azure and Alibaba catalog endpoints", async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ data: [] }))
      .mockResolvedValueOnce(
        Response.json({
          output: {
            models: [
              {
                model: "qwen-max",
                name: "Qwen Max",
                inference_metadata: {
                  request_modality: ["Text", "Image"],
                },
                model_info: { context_window: 32_768 },
              },
            ],
          },
        })
      )
    const client = catalogClient(fetchImplementation)

    await client.listModels({ ...baseInput, provider: "azure_openai" })
    await expect(
      client.listModels({
        ...baseInput,
        provider: "alibaba",
        baseUrl:
          "https://workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
      })
    ).resolves.toEqual([
      expect.objectContaining({
        id: "qwen-max",
        display_name: "Qwen Max",
        kind: "chat",
        context_window: 32_768,
        supports_image_input: true,
      }),
    ])

    const [azureUrl, azureRequest] = fetchImplementation.mock.calls[0] ?? []
    expect(String(azureUrl)).toBe("https://models.example.test/v1/models")
    expect((azureRequest?.headers as Headers).get("api-key")).toBe(
      "provider-secret"
    )
    const [alibabaUrl, alibabaRequest] =
      fetchImplementation.mock.calls[1] ?? []
    expect(String(alibabaUrl)).toBe(
      "https://workspace.cn-beijing.maas.aliyuncs.com/api/v1/models?page_no=1&page_size=100"
    )
    expect((alibabaRequest?.headers as Headers).get("authorization")).toBe(
      "Bearer provider-secret"
    )
  })

  it("returns stable errors without exposing upstream response content", async () => {
    const authenticationClient = new HttpModelProviderCatalogClient(
      vi.fn(async () => new Response("secret upstream body", { status: 401 })),
      publicLookup
    )
    const invalidClient = new HttpModelProviderCatalogClient(
      vi.fn(async () => Response.json({ unexpected: true })),
      publicLookup
    )

    await expect(authenticationClient.listModels(baseInput)).rejects.toMatchObject(
      { code: "MODEL_CATALOG_AUTHENTICATION_FAILED" }
    )
    await expect(invalidClient.listModels(baseInput)).rejects.toMatchObject({
      code: "MODEL_CATALOG_RESPONSE_INVALID",
    })
  })

  it("keeps Google Vertex on the manual-entry path", async () => {
    const fetchImplementation = vi.fn()
    const client = catalogClient(fetchImplementation)

    await expect(
      client.listModels({ ...baseInput, provider: "google_vertex" })
    ).rejects.toMatchObject({ code: "MODEL_CATALOG_NOT_SUPPORTED" })
    expect(fetchImplementation).not.toHaveBeenCalled()
  })

  it("rejects insecure and private discovery targets before sending credentials", async () => {
    const fetchImplementation = vi.fn<typeof fetch>()
    const privateLookup = vi.fn(async () => [
      { address: "127.0.0.1", family: 4 as const },
    ]) as unknown as typeof import("node:dns").promises.lookup
    const client = new HttpModelProviderCatalogClient(
      fetchImplementation,
      privateLookup
    )

    await expect(
      client.listModels({
        ...baseInput,
        baseUrl: "http://public.example.test/v1",
      })
    ).rejects.toMatchObject({ code: "MODEL_CATALOG_UNAVAILABLE" })
    await expect(
      client.listModels({
        ...baseInput,
        baseUrl: "https://private.example.test/v1",
      })
    ).rejects.toMatchObject({ code: "MODEL_CATALOG_UNAVAILABLE" })
    expect(fetchImplementation).not.toHaveBeenCalled()
  })
})
