import { describe, expect, it, vi } from "vitest"

import { createModelProviderProbeClient, type ResolvedProviderProbe } from "../src/modules/system/model-provider-probe.js"

const channel: ResolvedProviderProbe = {
  provider: "openai", base_url: "https://models.example.test/v1", api_key: "synthetic-probe-key",
  protocol_mode: "native_responses", provider_project: null, provider_location: null, discovery_protocol: "openai_compatible",
}
const responsesReply = () => Response.json({ status: "completed", output: [
  { type: "reasoning", summary: [] },
  { type: "message", content: [{ type: "output_text", text: "OK" }] },
] })
const chatReply = () => Response.json({ choices: [{ message: { content: "OK" }, finish_reason: "stop" }] })

describe("configuration-time model protocol detection", () => {
  it("chooses a chat model from discovery and validates the provider's preferred protocol", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url) =>
      String(url).endsWith("/models")
        ? Response.json({ data: [{ id: "text-embedding-test" }, { id: "chat-model" }] })
        : chatReply())

    await expect(createModelProviderProbeClient(fetcher).detectProtocol({ ...channel, provider: "alibaba" })).resolves.toEqual({
      status: "detected", protocol_mode: "chat_completions_bridge", model_id: "chat-model",
    })
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(String(fetcher.mock.calls[1]?.[0])).toBe(`${channel.base_url}/chat/completions`)
    expect(JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body))).toMatchObject({ model: "chat-model", tool_choice: "none", tools: [{ type: "function", function: { name: "linksense_protocol_probe" } }] })
  })

  it("distinguishes native custom tools from Responses function compatibility", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body))
      return body.tools[0].type === "custom" ? new Response(null, { status: 400 }) : responsesReply()
    })

    await expect(createModelProviderProbeClient(fetcher).detectProtocol({ ...channel, model_id: "chat-model" })).resolves.toEqual({
      status: "detected", protocol_mode: "responses_tool_compat", model_id: "chat-model",
    })
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(fetcher.mock.calls.every(([url]) => String(url) === `${channel.base_url}/responses`)).toBe(true)
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toMatchObject({ tool_choice: "none", tools: [{ type: "custom" }] })
    expect(JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body))).toMatchObject({ tool_choice: "none", tools: [{ type: "function", name: "linksense_protocol_probe" }] })
  })

  it("combines protocol detection with automatic /v1 adaptation", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url) =>
      String(url) === `${channel.base_url}/chat/completions` ? chatReply() : new Response(null, { status: 404 }))

    await expect(createModelProviderProbeClient(fetcher).detectProtocol({ ...channel, base_url: "https://models.example.test", model_id: "chat-model" })).resolves.toMatchObject({
      status: "detected", protocol_mode: "chat_completions_bridge",
    })
    expect(fetcher).toHaveBeenCalledTimes(6)
    expect(fetcher.mock.calls.every(([, init]) => init?.redirect === "manual")).toBe(true)
  })

  it.each([401, 403, 429, 500, 503, 302])("stops on HTTP %i without trying another protocol or exposing details", async (status) => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => new Response(channel.api_key, { status }))
    await expect(createModelProviderProbeClient(fetcher).detectProtocol({ ...channel, model_id: "chat-model" })).rejects.toMatchObject({ code: "MODEL_PROVIDER_CONNECTION_FAILED", message: "MODEL_PROVIDER_CONNECTION_FAILED" })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it("asks for a model when discovery is unavailable, without inventing a model ID", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ data: [{ id: "text-embedding-test" }] }))
    await expect(createModelProviderProbeClient(fetcher).detectProtocol(channel)).resolves.toEqual({ status: "model_required" })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it.each(["<html>proxy page</html>", JSON.stringify({ output: [] }), JSON.stringify({ error: { message: "failed" }, choices: [{ message: { content: "OK" } }] }), JSON.stringify({ status: "failed", output: [{ type: "message", content: [{ type: "output_text", text: "OK" }] }] })])("never certifies an invalid or empty response %s", async (body) => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => new Response(body))
    await expect(createModelProviderProbeClient(fetcher).detectProtocol({ ...channel, model_id: "chat-model" })).rejects.toMatchObject({ code: "MODEL_PROVIDER_CONNECTION_FAILED" })
    expect(fetcher).toHaveBeenCalledTimes(3)
  })

  it("bounds detection time even if the transport never settles", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(() => new Promise<Response>(() => undefined))
    await expect(createModelProviderProbeClient(fetcher, 10).detectProtocol({ ...channel, model_id: "chat-model" })).rejects.toMatchObject({ code: "MODEL_PROVIDER_CONNECTION_FAILED" })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})
