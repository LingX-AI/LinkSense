import { describe, expect, it, vi } from "vitest"

import { HttpModelProviderCatalogClient } from "../src/modules/system/model-provider-catalog.js"

const baseInput = {
  provider: "openai" as const,
  baseUrl: "https://models.example.test/v1",
  apiKey: "provider-secret",
  providerProject: null,
  providerLocation: null,
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
    const client = new HttpModelProviderCatalogClient(fetchImplementation)

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
    const client = new HttpModelProviderCatalogClient(fetchImplementation)

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
    const client = new HttpModelProviderCatalogClient(fetchImplementation)

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
    const fetchImplementation = vi.fn<typeof fetch>(async () =>
      Response.json({ data: [] })
    )
    const client = new HttpModelProviderCatalogClient(fetchImplementation)

    await client.listModels({ ...baseInput, provider: "azure_openai" })
    await client.listModels({
      ...baseInput,
      provider: "alibaba",
      baseUrl:
        "https://workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
    })

    const [azureUrl, azureRequest] = fetchImplementation.mock.calls[0] ?? []
    expect(String(azureUrl)).toBe("https://models.example.test/v1/models")
    expect((azureRequest?.headers as Headers).get("api-key")).toBe(
      "provider-secret"
    )
    const [alibabaUrl, alibabaRequest] =
      fetchImplementation.mock.calls[1] ?? []
    expect(String(alibabaUrl)).toBe(
      "https://workspace.cn-beijing.maas.aliyuncs.com/api/v1/models"
    )
    expect((alibabaRequest?.headers as Headers).get("authorization")).toBe(
      "Bearer provider-secret"
    )
  })

  it("returns stable errors without exposing upstream response content", async () => {
    const authenticationClient = new HttpModelProviderCatalogClient(
      vi.fn(async () => new Response("secret upstream body", { status: 401 }))
    )
    const invalidClient = new HttpModelProviderCatalogClient(
      vi.fn(async () => Response.json({ unexpected: true }))
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
    const client = new HttpModelProviderCatalogClient(fetchImplementation)

    await expect(
      client.listModels({ ...baseInput, provider: "google_vertex" })
    ).rejects.toMatchObject({ code: "MODEL_CATALOG_NOT_SUPPORTED" })
    expect(fetchImplementation).not.toHaveBeenCalled()
  })
})
