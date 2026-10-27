import { describe, expect, it, vi } from "vitest"
import type { DiscoverImageGenerationModelsInput } from "@linksense/shared"
import type { PrismaClient } from "../src/generated/prisma/client.js"
import { encryptJson } from "../src/lib/crypto.js"
import { discoverImageGenerationModels } from "../src/modules/system/image-generation-model-discovery.js"
import { ImageGenerationSettingsService } from "../src/modules/system/image-generation-settings.js"
import { testConfig } from "./test-config.js"

const draft = { provider: "openai_compatible", base_url: "https://images.example.test/proxy", api_key: "synthetic-image-key" } as const

describe("image generation model discovery", () => {
  it("fetches, deduplicates and redacts compatible models while adapting /v1", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url) =>
      String(url) === `${draft.base_url}/v1/models`
        ? Response.json({ data: [{ id: "custom-image", name: "Image model", prices: "private" }, { id: "custom-image" }, { id: "chat-model", type: "chat" }] })
        : new Response(null, { status: 404 }))
    const result = await discoverImageGenerationModels(draft, fetcher)
    expect(result).toEqual({ status: "supported", truncated: false, models: [{ id: "custom-image", display_name: "custom-image", context_window: null, supports_image_input: null }] })
    expect(fetcher.mock.calls.map(([url]) => String(url))).toEqual([`${draft.base_url}/models`, `${draft.base_url}/v1/models`])
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ method: "GET", redirect: "manual", headers: { authorization: `Bearer ${draft.api_key}` } })
    expect(JSON.stringify(result)).not.toContain("private")
    expect(JSON.stringify(result)).not.toContain(draft.api_key)
  })

  it("uses Bailian's workspace catalog and image-generation capability filter", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ output: { total: 3, models: [
      { model: "qwen-image-3.0", name: "Qwen Image", capabilities: ["IG"] },
      { model: "qwen-text", inference_metadata: { response_modality: ["Text"] } },
    ] } }))
    const result = await discoverImageGenerationModels({ ...draft, provider: "alibaba_bailian", base_url: "https://workspace.cn-beijing.maas.aliyuncs.com/proxy/api/v1/services/aigc/multimodal-generation/generation" }, fetcher)
    const url = new URL(String(fetcher.mock.calls[0]?.[0]))
    expect(url.origin + url.pathname).toBe("https://workspace.cn-beijing.maas.aliyuncs.com/proxy/api/v1/models")
    expect(url.searchParams.get("capabilities")).toBe("IG")
    expect(result).toMatchObject({ truncated: true, models: [{ id: "qwen-image-3.0", display_name: "Qwen Image" }] })
  })

  it("reads Google's native image models with its own authentication header", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ models: [
      { name: "models/gemini-test-image", displayName: "Gemini image", supportedGenerationMethods: ["generateContent"] },
      { name: "models/imagen-predict-image", supportedGenerationMethods: ["predict"] },
      { name: "models/gemini-text", supportedGenerationMethods: ["generateContent"] },
    ] }))
    expect(await discoverImageGenerationModels({ ...draft, provider: "google_gemini" }, fetcher)).toMatchObject({ models: [{ id: "gemini-test-image" }] })
    expect(String(fetcher.mock.calls[0]?.[0])).toBe(`${draft.base_url}/v1beta/models?pageSize=1000`)
    expect(fetcher.mock.calls[0]?.[1]?.headers).toEqual({ accept: "application/json", "x-goog-api-key": draft.api_key })
  })

  it("reads fal's public image catalog without sending the inference key to another host", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ models: [{ endpoint_id: "fal-ai/test", metadata: { display_name: "Image test", category: "text-to-image" } }], has_more: true }))
    expect(await discoverImageGenerationModels({ ...draft, provider: "fal", base_url: "https://fal.run" }, fetcher)).toMatchObject({ truncated: true, models: [{ id: "fal-ai/test", display_name: "Image test" }] })
    const url = new URL(String(fetcher.mock.calls[0]?.[0]))
    expect(url.origin + url.pathname).toBe("https://api.fal.ai/v1/models")
    expect(url.searchParams.get("category")).toBe("text-to-image")
    expect(fetcher.mock.calls[0]?.[1]?.headers).not.toHaveProperty("authorization")
  })

  it("reads Replicate's image collection and Together's array model list", async () => {
    const replicate = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ models: [{ owner: "owner", name: "image-model" }] }))
    expect(await discoverImageGenerationModels({ ...draft, provider: "replicate" }, replicate)).toMatchObject({ models: [{ id: "owner/image-model" }] })
    expect(String(replicate.mock.calls[0]?.[0])).toBe(`${draft.base_url}/collections/text-to-image`)
    const together = vi.fn<typeof fetch>().mockResolvedValue(Response.json([{ id: "image-model", type: "image" }, { id: "embedding", type: "embedding" }]))
    expect(await discoverImageGenerationModels({ ...draft, provider: "together" }, together)).toMatchObject({ models: [{ id: "image-model" }] })
  })

  it("keeps unsupported catalogs manual without inventing model choices", async () => {
    const fetcher = vi.fn<typeof fetch>()
    expect(await discoverImageGenerationModels({ ...draft, provider: "stability" }, fetcher)).toEqual({ status: "manual_required", models: [], truncated: false })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it.each([401, 403, 500, 302])("redacts HTTP %i failures without retrying", async (status) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(draft.api_key, { status }))
    await expect(discoverImageGenerationModels(draft, fetcher)).rejects.toMatchObject({ code: "MODEL_PROVIDER_DISCOVERY_FAILED", message: "MODEL_PROVIDER_DISCOVERY_FAILED" })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it("bounds malformed, oversized and timed-out catalog responses", async () => {
    for (const response of [Response.json({ models: "invalid" }), new Response("x", { headers: { "content-length": "3000000" } })]) {
      await expect(discoverImageGenerationModels(draft, vi.fn<typeof fetch>().mockResolvedValue(response))).rejects.toMatchObject({ code: "MODEL_PROVIDER_DISCOVERY_FAILED" })
    }
    const fetcher = vi.fn<typeof fetch>().mockImplementation(() => new Promise<Response>(() => undefined))
    await expect(discoverImageGenerationModels(draft, fetcher, AbortSignal.timeout(10))).rejects.toMatchObject({ code: "MODEL_PROVIDER_DISCOVERY_FAILED" })
  })
})

describe("saved image discovery credentials", () => {
  function fixture(enabled = true) {
    const config = testConfig({ LINKSENSE_ADMIN_MODEL_MANAGEMENT_ENABLED: String(enabled) })
    const settingsJson = {
      image_generation_settings_key_id: config.credentialKeyId,
      image_generation_settings_encrypted: encryptJson({ version: 1, revision: 1, enabled: false,
        provider: "openai", providerOptions: { workspace_id: null, region: null }, apiKey: "saved-image-secret", model: null, pricePerImage: "0",
      }, config.credentialMasterKey, config.credentialKeyId, "linksense:image-generation-settings:v1"),
    }
    const transaction = vi.fn()
    const findUnique = vi.fn().mockResolvedValue({ settingsJson })
    const prisma = { systemSetting: { findUnique }, $transaction: transaction } as unknown as PrismaClient
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ data: [{ id: "image-model" }] }))
    return { service: new ImageGenerationSettingsService(prisma, config, { recordModelUsage: vi.fn() }, fetcher), fetcher, transaction, findUnique, settingsJson }
  }
  const savedDraft: DiscoverImageGenerationModelsInput = { provider: "openai", base_url: "https://api.openai.com/v1" }

  it("reuses an older connection with no saved Base URL or selected model without writing settings", async () => {
    const { service, fetcher, transaction, settingsJson } = fixture()
    const before = structuredClone(settingsJson)
    await expect(service.discover(savedDraft)).resolves.toMatchObject({ models: [{ id: "image-model" }] })
    expect(fetcher.mock.calls[0]?.[1]?.headers).toMatchObject({ authorization: "Bearer saved-image-secret" })
    expect(transaction).not.toHaveBeenCalled()
    expect(settingsJson).toEqual(before)
  })

  it.each([
    { provider: "openai_compatible" as const }, { base_url: "https://other.example.test/v1" },
    { base_url: "https://api.openai.com/other" }, { provider_options: { workspace_id: "different", region: null } },
  ])("never reuses a saved secret for a changed draft %j", async (change) => {
    const { service, fetcher } = fixture()
    await expect(service.discover({ ...savedDraft, ...change })).rejects.toMatchObject({ code: "MODEL_PROVIDER_CREDENTIAL_REQUIRED" })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it("uses a replacement key without reading stored secrets and rejects disabled management first", async () => {
    const { service, fetcher, findUnique } = fixture()
    await service.discover({ ...savedDraft, base_url: draft.base_url, api_key: draft.api_key })
    expect(findUnique).not.toHaveBeenCalled()
    expect(fetcher.mock.calls[0]?.[1]?.headers).toMatchObject({ authorization: `Bearer ${draft.api_key}` })
    const disabled = fixture(false)
    await expect(disabled.service.discover(savedDraft)).rejects.toMatchObject({ code: "MODEL_MANAGEMENT_DISABLED" })
    expect(disabled.findUnique).not.toHaveBeenCalled()
  })
})
