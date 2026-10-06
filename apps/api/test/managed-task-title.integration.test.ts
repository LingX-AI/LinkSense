import { createServer } from "node:http"

import {
  modelProviderProtocolModeValues,
  modelServiceProviderValues,
  type ModelProviderProtocolMode,
  type ModelServiceProvider,
} from "@linksense/shared"
import { describe, expect, it } from "vitest"
import { z } from "zod"

import { ManagedTaskTitleGenerator } from "../src/adapters/dashscope-title.js"
import type { ResolvedManagedModelRuntime } from "../src/modules/system/model-provider-settings.js"

const cases = modelServiceProviderValues.flatMap((provider) =>
  modelProviderProtocolModeValues.map((protocolMode) => ({
    provider,
    protocolMode,
  })),
)

describe("managed task titles through a local HTTP provider", () => {
  it.each(cases)(
    "$provider titles use the task channel's $protocolMode contract",
    async ({ provider, protocolMode }) => {
      const requests: Array<{
        url: string
        authorization: string | undefined
        nativeCredentials: string | string[] | undefined
        body: unknown
      }> = []
      const failures: unknown[] = []
      const endpoint =
        protocolMode === "chat_completions_bridge"
          ? "/v1/chat/completions"
          : "/v1/responses"
      const server = createServer((request, response) => {
        void (async () => {
          const chunks: Buffer[] = []
          for await (const chunk of request) chunks.push(Buffer.from(chunk))
          const body: unknown = JSON.parse(Buffer.concat(chunks).toString())
          requests.push({
            url: request.url ?? "",
            authorization: request.headers.authorization,
            nativeCredentials:
              request.headers["x-api-key"] ??
              request.headers["x-goog-api-key"] ??
              request.headers["api-key"],
            body,
          })
          expect(request.url).toBe(endpoint)
          const parsed = z.record(z.string(), z.unknown()).parse(body)
          expect(parsed.model).toBe("existing-title-model")
          response.setHeader("content-type", "application/json")
          if (protocolMode === "chat_completions_bridge") {
            expect(parsed.max_tokens).toBe(128)
            response.end(JSON.stringify({
              id: "local-chat",
              object: "chat.completion",
              created: 0,
              model: "existing-title-model",
              choices: [{
                index: 0,
                message: { role: "assistant", content: "Plan launch" },
                finish_reason: "stop",
              }],
              usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
            }))
          } else {
            expect(parsed.max_output_tokens).toBe(128)
            response.end(JSON.stringify({
              id: "local-response",
              object: "response",
              created_at: 0,
              model: "existing-title-model",
              status: "completed",
              output: [{
                id: "local-message",
                type: "message",
                role: "assistant",
                status: "completed",
                content: [{ type: "output_text", text: "Plan launch", annotations: [] }],
              }],
              usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12 },
            }))
          }
        })().catch((error: unknown) => {
          failures.push(error)
          response.statusCode = 500
          response.end(JSON.stringify({ error: { message: "synthetic provider failed" } }))
        })
      })
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
      try {
        const address = server.address()
        if (address === null || typeof address === "string") {
          throw new Error("missing local provider address")
        }
        const generator = new ManagedTaskTitleGenerator({
          resolveTaskTitleModel: async () => runtime(
            `http://127.0.0.1:${address.port}/v1`,
            provider,
            protocolMode,
          ),
        }, { timeoutMs: 5_000 })
        await expect(generator.generate([{ role: "user", content: "Plan the launch" }]))
          .resolves.toMatchObject({
            title: "Plan launch",
            model: "existing-title-model",
            usage: { inputTokens: 10, outputTokens: 2, measurementMethod: "provider" },
          })
        expect(failures).toEqual([])
        expect(requests).toHaveLength(1)
        expect(requests[0]).toMatchObject({
          url: endpoint,
          authorization: "Bearer synthetic-local-key",
          nativeCredentials: undefined,
        })
      } finally {
        server.closeAllConnections()
        await new Promise<void>((resolve, reject) =>
          server.close((error) => error ? reject(error) : resolve()),
        )
      }
    },
  )
})

function runtime(
  baseUrl: string,
  provider: ModelServiceProvider,
  protocolMode: ModelProviderProtocolMode,
): ResolvedManagedModelRuntime {
  return {
    revision: 8,
    model: {
      id: "existing-title-model",
      display_name: "Existing title model",
      enabled: true,
      kind: "chat",
      input_price_per_million: "1",
      cached_input_price_per_million: "0.5",
      output_price_per_million: "2",
      supports_image_input: false,
      context_window: null,
      supported_reasoning_efforts: ["medium"],
      default_reasoning_effort: "medium",
    },
    channel: {
      id: "existing-title-channel",
      name: null,
      provider,
      providerProject: null,
      providerLocation: null,
      baseUrl,
      protocolMode,
      apiKey: "synthetic-local-key",
    },
  }
}
