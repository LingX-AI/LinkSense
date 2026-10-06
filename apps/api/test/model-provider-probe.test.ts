import { describe, expect, it, vi } from "vitest"
import { createModelProviderProbeClient, parseModelDiscovery, type ResolvedProviderProbe } from "../src/modules/system/model-provider-probe.js"
import { probeReplyResponse } from "./model-provider-probe-fixture.js"

const channel: ResolvedProviderProbe = {
  provider: "openai_compatible", base_url: "https://models.example.test/v1",
  protocol_mode: "chat_completions_bridge", api_key: "synthetic-probe-key",
  provider_project: null, provider_location: null, discovery_protocol: "openai_compatible",
}


describe("model provider discovery and connection probe", () => {
  it("reads an OpenAI-compatible list without inventing prices or unavailable capabilities", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ data: [
      { id: "with-context", max_model_len: 8192, name: "Context model" },
      { id: "unknown-capabilities" },
      { id: "vision", context_length: 32000, architecture: { input_modalities: ["text", "image"] } },
    ] }))
    const result = await createModelProviderProbeClient(fetcher).discover(channel)
    expect(result).toEqual({ status: "supported", truncated: false, models: [
      { id: "with-context", display_name: "Context model", context_window: 8192, supports_image_input: null },
      { id: "unknown-capabilities", display_name: "unknown-capabilities", context_window: null, supports_image_input: null },
      { id: "vision", display_name: "vision", context_window: 32000, supports_image_input: true },
    ] })
    expect(fetcher).toHaveBeenCalledWith(new URL(`${channel.base_url}/models`), expect.objectContaining({
      redirect: "manual", headers: expect.objectContaining({ authorization: `Bearer ${channel.api_key}` }),
    }))
    expect(JSON.stringify(result)).not.toContain(channel.api_key)
  })

  it("uses native Anthropic headers and provider-supplied metadata only when requested", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ data: [{
      id: "claude-test", display_name: "Claude Test", max_input_tokens: 64000,
      capabilities: { image_input: { supported: true } },
    }], has_more: true }))
    const result = await createModelProviderProbeClient(fetcher).discover({ ...channel, provider: "anthropic", discovery_protocol: "native" })
    expect(result).toMatchObject({ truncated: true, models: [{ id: "claude-test", context_window: 64000, supports_image_input: true }] })
    expect(fetcher.mock.calls[0]?.[1]?.headers).toEqual({ accept: "application/json", "x-api-key": channel.api_key, "anthropic-version": "2023-06-01" })
  })

  it("reads native Google generation models and leaves image capability unknown", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ models: [
      { name: "models/gemini-test", displayName: "Gemini Test", inputTokenLimit: 32768, supportedGenerationMethods: ["generateContent"] },
      { name: "models/embed-test", supportedGenerationMethods: ["embedContent"] },
    ], nextPageToken: "next" }))
    const result = await createModelProviderProbeClient(fetcher).discover({ ...channel, provider: "google", discovery_protocol: "native" })
    expect(result).toEqual({ status: "supported", truncated: true, models: [{ id: "gemini-test", display_name: "Gemini Test", context_window: 32768, supports_image_input: null }] })
    expect(fetcher.mock.calls[0]?.[1]?.headers).toEqual({ accept: "application/json", "x-goog-api-key": channel.api_key })
  })

  it("limits and deduplicates discovered models without pretending pagination is complete", () => {
    const data = Array.from({ length: 102 }, (_, index) => ({ id: `model-${index}` }))
    const result = parseModelDiscovery({ data: [...data, data[0]] }, channel)
    expect(result.models).toHaveLength(100)
    expect(result.truncated).toBe(true)
  })

  it.each(["azure_openai", "google_vertex"] as const)("returns manual entry for %s without making a request", async (provider) => {
    const fetcher = vi.fn<typeof fetch>()
    expect(await createModelProviderProbeClient(fetcher).discover({ ...channel, provider })).toEqual({ status: "manual_required", models: [], truncated: false })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it.each(["chat_completions_bridge", "native_responses", "responses_tool_compat"] as const)("actually calls the selected %s task endpoint through the SDK", async (protocol_mode) => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => probeReplyResponse(protocol_mode, "你好，连接正常。"))
    const result = await createModelProviderProbeClient(fetcher).testConnection({ ...channel, provider: "anthropic", protocol_mode, model_id: "test-model", kind: "chat" })
    expect(result).toEqual({ status: "success", model_id: "test-model" })
    expect(fetcher).toHaveBeenCalledTimes(1)
    const [url, init] = fetcher.mock.calls[0]!
    expect(String(url)).toBe(`${channel.base_url}/${protocol_mode === "chat_completions_bridge" ? "chat/completions" : "responses"}`)
    expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${channel.api_key}`)
    expect(init?.redirect).toBe("manual")
    expect(JSON.parse(String(init?.body))).toMatchObject({ model: "test-model" })
    const body = JSON.parse(String(init?.body))
    expect(body.stream).toBe(true)
    expect(body).not.toHaveProperty("tools")
    expect(body).not.toHaveProperty("tool_choice")
    expect(String(init?.body)).toContain("Please reply briefly with OK.")
  })

  it("does not certify embedding or reranker models with a chat request", async () => {
    const fetcher = vi.fn<typeof fetch>()
    const client = createModelProviderProbeClient(fetcher)
    for (const kind of ["embedding", "reranker"] as const) {
      expect(await client.testConnection({ ...channel, model_id: "test-model", kind })).toEqual({ status: "unsupported", model_id: "test-model" })
    }
    expect(fetcher).not.toHaveBeenCalled()
  })

  it("never retries a failed inference and does not disclose upstream details", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {})
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ error: { message: `${channel.api_key} private provider response` } }, { status: 500 }))
    try {
      await expect(createModelProviderProbeClient(fetcher).testConnection({ ...channel, model_id: "test-model", kind: "chat" })).rejects.toMatchObject({ code: "MODEL_PROVIDER_CONNECTION_FAILED", message: "MODEL_PROVIDER_CONNECTION_FAILED" })
      expect(fetcher).toHaveBeenCalledTimes(1)
      expect(log).not.toHaveBeenCalled()
    } finally { log.mockRestore() }
  })

  it.each(["chat_completions_bridge", "native_responses", "responses_tool_compat"] as const)("rejects empty replies and errors after text without retrying for %s", async (protocol_mode) => {
    for (const response of [probeReplyResponse(protocol_mode, " \n\t"), probeReplyResponse(protocol_mode, "OK", true)]) {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response)
      await expect(createModelProviderProbeClient(fetcher).testConnection({ ...channel, protocol_mode, model_id: "test-model", kind: "chat" })).rejects.toMatchObject({ code: "MODEL_PROVIDER_CONNECTION_FAILED" })
      expect(fetcher).toHaveBeenCalledTimes(1)
    }
  })

  it.each(["discover", "testConnection"] as const)("rejects credentialed redirects during %s", async (operation) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 302, headers: { location: "https://other.example.test/steal" } }))
    const client = createModelProviderProbeClient(fetcher)
    await expect(operation === "discover" ? client.discover(channel) : client.testConnection({ ...channel, model_id: "test-model", kind: "chat" })).rejects.toMatchObject({ code: operation === "discover" ? "MODEL_PROVIDER_DISCOVERY_FAILED" : "MODEL_PROVIDER_CONNECTION_FAILED" })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it("rejects malformed and oversized model discovery responses", async () => {
    for (const response of [Response.json({ providers: [] }), new Response("x", { headers: { "content-length": "3000000" } }), new Response("x".repeat(2 * 1024 * 1024 + 1))]) {
      await expect(createModelProviderProbeClient(vi.fn<typeof fetch>().mockResolvedValue(response)).discover(channel)).rejects.toMatchObject({ code: "MODEL_PROVIDER_DISCOVERY_FAILED" })
    }
  })

  it("times out discovery even when an injected transport does not settle", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(() => new Promise<Response>(() => undefined))
    await expect(createModelProviderProbeClient(fetcher, 10).discover(channel)).rejects.toMatchObject({ code: "MODEL_PROVIDER_DISCOVERY_FAILED" })
  })

  it.each(["stream", "redirect"] as const)("an unresponsive %s body cannot prevent the probe timeout", async (responseKind) => {
    const body = new ReadableStream<Uint8Array>({
      pull: () => new Promise<void>(() => undefined),
      cancel: () => new Promise<void>(() => undefined),
    })
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(body, { status: responseKind === "redirect" ? 302 : 200 }))
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const result = await Promise.race([
        createModelProviderProbeClient(fetcher, 10).discover(channel).catch((error: unknown) => error),
        new Promise<string>((resolve) => { timer = setTimeout(() => resolve("probe still pending"), 100) }),
      ])
      expect(result).toMatchObject({ code: "MODEL_PROVIDER_DISCOVERY_FAILED" })
    } finally {
      clearTimeout(timer)
    }
  })

  it("times out inference without retrying or exposing the credential", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(() => new Promise<Response>(() => undefined))
    await expect(createModelProviderProbeClient(fetcher, 10).testConnection({ ...channel, model_id: "test-model", kind: "chat" })).rejects.toMatchObject({ code: "MODEL_PROVIDER_CONNECTION_FAILED" })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})
