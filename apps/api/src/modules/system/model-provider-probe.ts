import { streamText } from "ai"
import { z } from "zod"
import {
  createModelProviderFetch,
  discoveredProviderModelSchema,
  modelContextWindowSchema,
  modelIdentifierSchema,
  modelProviderProbeInputSchema,
  modelProviderPresets,
  modelProviderProtocolModeValues,
  type DetectModelProviderProtocolResult,
  type DiscoverModelProviderResult,
  type DiscoveredProviderModel,
  type TestModelProviderConnectionResult,
} from "@linksense/shared"

import { createTaskLanguageModel } from "../../adapters/task-language-model.js"
import { AppError } from "../../lib/errors.js"

export type ResolvedProviderProbe = Omit<z.infer<typeof modelProviderProbeInputSchema>, "channel_id" | "api_key"> & { api_key: string }

export interface ModelProviderProbeClient {
  discover(input: ResolvedProviderProbe, signal?: AbortSignal): Promise<DiscoverModelProviderResult>
  detectProtocol(input: ResolvedProviderProbe & { model_id?: string }, signal?: AbortSignal): Promise<DetectModelProviderProtocolResult>
  testConnection(input: ResolvedProviderProbe & {
    model_id: string
    kind: "chat" | "embedding" | "reranker"
  }): Promise<TestModelProviderConnectionResult>
}

const RESPONSE_BYTE_LIMIT = 2 * 1024 * 1024
const MODEL_LIMIT = 100
const DISCOVERY_TIMEOUT_MS = 12_000
const CONNECTION_TIMEOUT_MS = 60_000
const CONNECTION_OUTPUT_TOKEN_LIMIT = 2_048
const protocolProbeFunction = {
  name: "linksense_protocol_probe",
  description: "A placeholder tool. Do not call it; reply with OK.",
  parameters: { type: "object", properties: {}, additionalProperties: false, required: [] },
}
const responsesProbeReplySchema = z.object({
  status: z.literal("completed").optional(),
  error: z.null().optional(),
  output: z.array(z.object({
    type: z.string(),
    content: z.array(z.object({ type: z.string(), text: z.string().optional() })).optional(),
  })),
}).refine(({ output }) => output.some((item) => item.type === "message" &&
  item.content?.some((part) => part.type === "output_text" && part.text?.trim())))
const chatProbeReplySchema = z.object({
  error: z.null().optional(),
  choices: z.array(z.object({
    message: z.object({ content: z.string().nullable() }),
    finish_reason: z.enum(["stop", "length"]).nullable().optional(),
  })),
}).refine(({ choices }) => choices.some((choice) => choice.message.content?.trim()))
const metadataModelSchema = z.object({
  id: modelIdentifierSchema,
  name: z.string().optional(),
  display_name: z.string().optional(),
  max_model_len: modelContextWindowSchema.nullable().optional(),
  context_window: modelContextWindowSchema.nullable().optional(),
  context_length: modelContextWindowSchema.nullable().optional(),
  max_context_length: modelContextWindowSchema.nullable().optional(),
  max_input_tokens: modelContextWindowSchema.nullable().optional(),
  supports_image_input: z.boolean().nullable().optional(),
  architecture: z.object({ input_modalities: z.array(z.string()).optional() }).optional(),
  capabilities: z.object({ image_input: z.object({ supported: z.boolean() }).optional() }).nullable().optional(),
})
const modelListSchema = z.object({
  data: z.array(metadataModelSchema).max(10_000),
  has_more: z.boolean().optional(),
})
const googleModelListSchema = z.object({
  models: z.array(z.object({
    name: z.string(),
    displayName: z.string().optional(),
    inputTokenLimit: modelContextWindowSchema.optional(),
    supportedGenerationMethods: z.array(z.string()).optional(),
  })).max(10_000),
  nextPageToken: z.string().optional(),
})

/** Probe only the caller's explicit target, never follow a credentialed redirect. */
export function createModelProviderProbeClient(
  fetcher: typeof fetch = fetch,
  timeoutMs?: number,
): ModelProviderProbeClient {
  return {
    async detectProtocol(input, parentSignal) {
      try {
        const signal = AbortSignal.any([
          AbortSignal.timeout(timeoutMs ?? CONNECTION_TIMEOUT_MS),
          ...(parentSignal ? [parentSignal] : []),
        ])
        let modelId = input.model_id
        if (!modelId) {
          try {
            const discovery = await this.discover(input, signal)
            // shortcut: infer non-chat models from IDs until discovery supplies a reliable model kind.
            modelId = discovery.models.find((model) => !/(embed|rerank|whisper|tts|dall-e)/iu.test(model.id))?.id
          } catch {
            signal.throwIfAborted()
            return { status: "model_required" }
          }
        }
        if (!modelId) return { status: "model_required" }
        const preferred = modelProviderPresets[input.provider].protocol_mode
        const modes = [preferred, ...modelProviderProtocolModeValues.filter((mode) => mode !== preferred)]
        const boundedFetch = createBoundedModelProviderFetch(input.base_url, fetcher, signal)
        for (const mode of modes) {
          const chat = mode === "chat_completions_bridge"
          const responsesTool = mode === "native_responses"
            ? { type: "custom", name: protocolProbeFunction.name, description: protocolProbeFunction.description, format: { type: "text" } }
            : { type: "function", ...protocolProbeFunction }
          const tools = chat ? [{ type: "function", function: protocolProbeFunction }] : [responsesTool]
          const message = { role: "user", content: "Please reply briefly with OK." }
          const response = await boundedFetch(new URL(`${input.base_url}/${chat ? "chat/completions" : "responses"}`), {
            method: "POST",
            headers: { authorization: `Bearer ${input.api_key}`, "content-type": "application/json", accept: "application/json" },
            body: JSON.stringify({
              model: modelId, stream: false, tools, tool_choice: "none",
              ...(chat ? { messages: [message], max_tokens: CONNECTION_OUTPUT_TOKEN_LIMIT } : { input: [message], max_output_tokens: CONNECTION_OUTPUT_TOKEN_LIMIT, store: false }),
            }),
            signal,
          })
          if ([400, 404, 405, 422].includes(response.status)) continue
          if (!response.ok) throw new AppError("MODEL_PROVIDER_CONNECTION_FAILED")
          const payload: unknown = await response.json().catch(() => null)
          if ((chat ? chatProbeReplySchema : responsesProbeReplySchema).safeParse(payload).success) {
            return { status: "detected", protocol_mode: mode, model_id: modelId }
          }
        }
        throw new AppError("MODEL_PROVIDER_CONNECTION_FAILED")
      } catch {
        throw new AppError("MODEL_PROVIDER_CONNECTION_FAILED")
      }
    },
    async discover(input, parentSignal) {
      if (input.provider === "azure_openai" || input.provider === "google_vertex") {
        return { status: "manual_required", models: [], truncated: false }
      }
      if (input.discovery_protocol === "native" && input.provider !== "anthropic" && input.provider !== "google") {
        return { status: "manual_required", models: [], truncated: false }
      }
      try {
        const signal = AbortSignal.any([
          AbortSignal.timeout(timeoutMs ?? DISCOVERY_TIMEOUT_MS),
          ...(parentSignal ? [parentSignal] : []),
        ])
        const boundedFetch = createBoundedModelProviderFetch(input.base_url, fetcher, signal)
        const url = new URL(`${input.base_url}/models`)
        const headers: Record<string, string> = { accept: "application/json" }
        if (input.discovery_protocol === "native" && input.provider === "anthropic") {
          headers["x-api-key"] = input.api_key
          headers["anthropic-version"] = "2023-06-01"
          url.searchParams.set("limit", String(MODEL_LIMIT))
        } else if (input.discovery_protocol === "native" && input.provider === "google") {
          headers["x-goog-api-key"] = input.api_key
          url.searchParams.set("pageSize", String(MODEL_LIMIT))
        } else {
          headers.authorization = `Bearer ${input.api_key}`
        }
        const response = await boundedFetch(url, { headers, signal })
        if (!response.ok) throw new AppError("MODEL_PROVIDER_DISCOVERY_FAILED")
        return parseModelDiscovery(await response.json(), input)
      } catch {
        throw new AppError("MODEL_PROVIDER_DISCOVERY_FAILED")
      }
    },
    async testConnection(input) {
      if (input.kind !== "chat") return { status: "unsupported", model_id: input.model_id }
      try {
        const deadlineMs = timeoutMs ?? CONNECTION_TIMEOUT_MS
        const signal = AbortSignal.timeout(deadlineMs)
        const result = streamText({
          model: createTaskLanguageModel({
            model: input.model_id,
            apiKey: input.api_key,
            baseUrl: input.base_url,
            protocolMode: input.protocol_mode,
          }, { fetch: createBoundedModelProviderFetch(input.base_url, fetcher, signal) }),
          prompt: "Please reply briefly with OK.",
          maxOutputTokens: CONNECTION_OUTPUT_TOKEN_LIMIT,
          maxRetries: 0,
          abortSignal: signal,
          timeout: { totalMs: deadlineMs },
          // The stream below propagates failures as a redacted application error.
          // Disable the SDK's default logger, which can print upstream details.
          onError: () => {},
        })
        let hasReply = false
        for await (const part of result.fullStream) {
          if (part.type === "error" || part.type === "abort" ||
            (part.type === "finish" && part.finishReason === "error")) {
            throw new AppError("MODEL_PROVIDER_CONNECTION_FAILED")
          }
          if (part.type === "text-delta" && part.text.trim()) hasReply = true
        }
        if (!hasReply) {
          throw new AppError("MODEL_PROVIDER_CONNECTION_FAILED")
        }
        return { status: "success", model_id: input.model_id }
      } catch {
        throw new AppError("MODEL_PROVIDER_CONNECTION_FAILED")
      }
    },
  }
}

export function parseModelDiscovery(
  payload: unknown,
  input: Pick<ResolvedProviderProbe, "provider" | "discovery_protocol">,
): DiscoverModelProviderResult {
  let models: DiscoveredProviderModel[]
  let hasMore: boolean
  if (input.provider === "google" && input.discovery_protocol === "native") {
    const parsed = googleModelListSchema.parse(payload)
    models = parsed.models
      .filter((model) => model.supportedGenerationMethods?.includes("generateContent"))
      .map((model) => discoveredProviderModelSchema.parse({
        id: model.name.replace(/^models\//u, ""),
        display_name: displayName(model.displayName, model.name.replace(/^models\//u, "")),
        context_window: model.inputTokenLimit ?? null,
        supports_image_input: null,
      }))
    hasMore = Boolean(parsed.nextPageToken)
  } else {
    const parsed = modelListSchema.parse(payload)
    models = parsed.data.map((model) => ({
      id: model.id,
      display_name: displayName(model.display_name ?? model.name, model.id),
      context_window: model.max_model_len ?? model.context_window ?? model.context_length ?? model.max_context_length ?? model.max_input_tokens ?? null,
      supports_image_input: model.supports_image_input ?? model.capabilities?.image_input?.supported ??
        (model.architecture?.input_modalities ? model.architecture.input_modalities.includes("image") : null),
    }))
    hasMore = parsed.has_more ?? false
  }
  const unique = [...new Map(models.map((model) => [model.id, model])).values()]
  return {
    status: "supported",
    models: unique.slice(0, MODEL_LIMIT),
    truncated: hasMore || unique.length > MODEL_LIMIT,
  }
}

function displayName(name: string | undefined, id: string): string {
  return (name?.trim() || id).slice(0, 120)
}

export function createBoundedModelProviderFetch(
  baseUrl: string,
  fetcher: typeof fetch,
  signal: AbortSignal,
): typeof fetch {
  const target = new URL(baseUrl)
  const providerFetch = createModelProviderFetch(baseUrl, fetcher)
  return async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    if (url.origin !== target.origin || !url.pathname.startsWith(`${target.pathname.replace(/\/+$/u, "")}/`)) {
      throw new Error("probe destination changed")
    }
    const requestSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined)
    const response = await withAbort(providerFetch(input, {
      ...init,
      redirect: "manual",
      signal: requestSignal ? AbortSignal.any([signal, requestSignal]) : signal,
    }), signal)
    if (response.status >= 300 && response.status < 400) {
      if (response.body) await withAbort(response.body.cancel(), signal).catch(() => undefined)
      throw new Error("probe redirect rejected")
    }
    const declaredLength = Number(response.headers.get("content-length"))
    if (Number.isFinite(declaredLength) && declaredLength > RESPONSE_BYTE_LIMIT) {
      if (response.body) await withAbort(response.body.cancel(), signal).catch(() => undefined)
      throw new Error("probe response too large")
    }
    if (!response.body) return response
    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let total = 0
    try {
      for (;;) {
        const part = await withAbort(reader.read(), signal)
        if (part.done) break
        total += part.value.byteLength
        if (total > RESPONSE_BYTE_LIMIT) throw new Error("probe response too large")
        chunks.push(part.value)
      }
    } finally {
      await withAbort(reader.cancel(), signal).catch(() => undefined)
      reader.releaseLock()
    }
    return new Response(Buffer.concat(chunks, total), {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    })
  }
}

function withAbort<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new Error("probe timed out"))
    if (signal.aborted) {
      reject(new Error("probe timed out"))
      // The operation has already been started. Always handle a late rejection.
      void operation.catch(() => undefined)
      return
    }
    signal.addEventListener("abort", abort, { once: true })
    void operation.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort))
  })
}
