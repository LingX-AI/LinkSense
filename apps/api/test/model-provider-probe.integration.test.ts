import { createServer } from "node:http"
import { describe, expect, it } from "vitest"
import { z } from "zod"
import { createModelProviderProbeClient, type ResolvedProviderProbe } from "../src/modules/system/model-provider-probe.js"
import { probeReplyStream } from "./model-provider-probe-fixture.js"

describe("model probes through a local HTTP provider", () => {
  it.each(["chat_completions_bridge", "native_responses", "responses_tool_compat"] as const)("discovers models and accepts an ordinary streamed reply through the %s SDK", async (protocol_mode) => {
    const requests: Array<{ url: string; authorization: string | undefined; body: unknown }> = []
    const failures: unknown[] = []
    const server = createServer((request, response) => {
      void (async () => {
        const chunks: Buffer[] = []
        for await (const chunk of request) chunks.push(Buffer.from(chunk))
        const body: unknown = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : null
        requests.push({ url: request.url ?? "", authorization: request.headers.authorization, body })
        response.setHeader("content-type", "application/json")
        if (request.url === "/v1/models") {
          response.end(JSON.stringify({ data: [{ id: "local-model", context_length: 4096 }] }))
          return
        }
        const parsed = z.record(z.string(), z.unknown()).parse(body)
        expect(parsed.model).toBe("local-model")
        expect(parsed.stream).toBe(true)
        expect(parsed).not.toHaveProperty("tool_choice")
        expect(parsed).not.toHaveProperty("tools")
        response.setHeader("content-type", "text/event-stream")
        if (request.url === "/v1/chat/completions") {
          expect(parsed.max_tokens).toBe(2048)
        } else {
          expect(request.url).toBe("/v1/responses")
          expect(parsed.max_output_tokens).toBe(2048)
        }
        response.end(probeReplyStream(protocol_mode, "A normal reply without any tool calls."))
      })().catch((error: unknown) => {
        failures.push(error)
        response.statusCode = 500
        response.end(JSON.stringify({ error: { message: "synthetic provider failed" } }))
      })
    })
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    try {
      const address = server.address()
      if (address === null || typeof address === "string") throw new Error("missing local provider address")
      const input: ResolvedProviderProbe = {
        provider: "openai_compatible", base_url: `http://127.0.0.1:${address.port}/v1`,
        protocol_mode, api_key: "synthetic-local-key", provider_project: null,
        provider_location: null, discovery_protocol: "openai_compatible",
      }
      const client = createModelProviderProbeClient()
      expect(await client.discover(input)).toMatchObject({ status: "supported", models: [{ id: "local-model", context_window: 4096 }] })
      expect(await client.testConnection({ ...input, model_id: "local-model", kind: "chat" })).toEqual({ status: "success", model_id: "local-model" })
      expect(requests.map((request) => request.url)).toEqual(["/v1/models", protocol_mode === "chat_completions_bridge" ? "/v1/chat/completions" : "/v1/responses"])
      expect(requests.every((request) => request.authorization === "Bearer synthetic-local-key")).toBe(true)
      expect(failures).toEqual([])
    } finally {
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    }
  })
})
