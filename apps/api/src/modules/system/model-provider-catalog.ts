import type { promises as dns } from "node:dns"

import {
  discoveredModelSchema,
  modelContextWindowSchema,
  modelIdentifierSchema,
  reasoningEffortValues,
  type DiscoveredModel,
  type ModelServiceProvider,
} from "@linksense/shared"
import { z } from "zod"

import { AppError } from "../../lib/errors.js"
import { fetchPublicHttpResource } from "../../lib/safe-http-fetch.js"

const MODEL_CATALOG_REQUEST_TIMEOUT_MS = 5_000
const MODEL_CATALOG_RESPONSE_LIMIT_BYTES = 2 * 1024 * 1024
const MODEL_CATALOG_MODEL_LIMIT = 1_000

const openAiCompatibleModelListSchema = z.object({
  data: z
    .array(
      z.object({
        id: z.string().min(1),
        name: z.string().optional(),
        display_name: z.string().optional(),
        max_model_len: z.number().nullable().optional(),
        context_window: z.number().nullable().optional(),
        context_length: z.number().nullable().optional(),
        max_context_length: z.number().nullable().optional(),
        architecture: z
          .object({ input_modalities: z.array(z.string()).optional() })
          .optional(),
        capabilities: z
          .object({
            chat_completion: z.boolean().optional(),
            embeddings: z.boolean().optional(),
          })
          .optional(),
      })
    )
    .max(MODEL_CATALOG_MODEL_LIMIT),
})

const anthropicModelListSchema = z.object({
  data: z
    .array(
      z.object({
        id: z.string().min(1),
        display_name: z.string().optional(),
        max_input_tokens: z.number().nullable().optional(),
        capabilities: z.unknown().optional(),
      })
    )
    .max(MODEL_CATALOG_MODEL_LIMIT),
})

const googleModelListSchema = z.object({
  models: z
    .array(
      z.object({
        name: z.string().min(1),
        baseModelId: z.string().optional(),
        displayName: z.string().optional(),
        inputTokenLimit: z.number().nullable().optional(),
        supportedGenerationMethods: z.array(z.string()).optional(),
        supportedActions: z.array(z.string()).optional(),
      })
    )
    .max(MODEL_CATALOG_MODEL_LIMIT),
})

const alibabaModelListSchema = z.object({
  output: z.object({
    models: z
      .array(
        z.object({
          model: z.string().min(1),
          name: z.string().optional(),
          inference_metadata: z
            .object({ request_modality: z.array(z.string()).optional() })
            .nullable()
            .optional(),
          model_info: z
            .object({
              context_window: z.number().nullable().optional(),
              max_input_tokens: z.number().nullable().optional(),
            })
            .nullable()
            .optional(),
        })
      )
      .max(MODEL_CATALOG_MODEL_LIMIT),
  }),
})

export type ModelProviderCatalogInput = {
  provider: ModelServiceProvider
  baseUrl: string
  apiKey: string
  providerProject: string | null
  providerLocation: string | null
}

export interface ModelProviderCatalogClient {
  listModels(
    input: ModelProviderCatalogInput,
    signal?: AbortSignal
  ): Promise<readonly DiscoveredModel[]>
}

export class HttpModelProviderCatalogClient
  implements ModelProviderCatalogClient
{
  constructor(
    private readonly fetchImplementation?: typeof fetch,
    private readonly lookup?: typeof dns.lookup
  ) {}

  async listModels(
    input: ModelProviderCatalogInput,
    signal?: AbortSignal
  ): Promise<readonly DiscoveredModel[]> {
    if (input.provider === "google_vertex") {
      throw new AppError("MODEL_CATALOG_NOT_SUPPORTED")
    }
    const request = modelCatalogRequest(input)
    try {
      const response = await fetchPublicHttpResource(request.url, {
        byteLimit: MODEL_CATALOG_RESPONSE_LIMIT_BYTES,
        redirectCount: 0,
        requestTimeoutMs: MODEL_CATALOG_REQUEST_TIMEOUT_MS,
        accept: "application/json",
        userAgent: "LinkSense-model-catalog/1",
        errorCode: "MODEL_CATALOG_UNAVAILABLE",
        allowedProtocols: ["https:"],
        headers: request.headers,
        ...(signal ? { signal } : {}),
        responseErrorCode: (status) =>
          status === 401 || status === 403
            ? "MODEL_CATALOG_AUTHENTICATION_FAILED"
            : undefined,
        ...(this.fetchImplementation
          ? { fetcher: this.fetchImplementation }
          : {}),
        ...(this.lookup ? { lookup: this.lookup } : {}),
      })
      const payload = parseJson(response.bytes)
      return parseModelCatalog(input.provider, payload)
    } catch (error) {
      if (error instanceof AppError) throw error
      throw new AppError("MODEL_CATALOG_UNAVAILABLE")
    }
  }
}

export function parseOpenAiCompatibleModelCatalog(
  payload: unknown
): readonly DiscoveredModel[] {
  const parsed = openAiCompatibleModelListSchema.safeParse(payload)
  if (!parsed.success) throw new AppError("MODEL_CATALOG_RESPONSE_INVALID")
  return normalizeModels(
    parsed.data.data.map((model) => {
      const capabilities = model.capabilities
      const kind = capabilities?.chat_completion
        ? "chat"
        : capabilities?.embeddings
          ? "embedding"
          : null
      return discoveredModel({
        id: model.id,
        displayName: model.display_name ?? model.name,
        kind,
        contextWindow: firstContextWindow(
          model.max_model_len,
          model.context_window,
          model.context_length,
          model.max_context_length
        ),
        supportsImageInput: model.architecture?.input_modalities
          ? model.architecture.input_modalities.includes("image")
          : null,
      })
    })
  )
}

function parseAnthropicModelCatalog(
  payload: unknown
): readonly DiscoveredModel[] {
  const parsed = anthropicModelListSchema.safeParse(payload)
  if (!parsed.success) throw new AppError("MODEL_CATALOG_RESPONSE_INVALID")
  return normalizeModels(
    parsed.data.data.map((model) => {
      const capabilities = asRecord(model.capabilities)
      const imageInput = asRecord(capabilities?.image_input)
      const effort = asRecord(capabilities?.effort)
      const efforts = reasoningEffortValues.filter(
        (value) => asRecord(effort?.[value])?.supported === true
      )
      return discoveredModel({
        id: model.id,
        displayName: model.display_name,
        kind: "chat",
        contextWindow: contextWindow(model.max_input_tokens),
        supportsImageInput:
          typeof imageInput?.supported === "boolean"
            ? imageInput.supported
            : null,
        supportedReasoningEfforts: efforts.length > 0 ? efforts : null,
        defaultReasoningEffort:
          efforts.length > 0
            ? efforts.includes("medium")
              ? "medium"
              : efforts[0]
            : null,
      })
    })
  )
}

function parseGoogleModelCatalog(payload: unknown): readonly DiscoveredModel[] {
  const parsed = googleModelListSchema.safeParse(payload)
  if (!parsed.success) throw new AppError("MODEL_CATALOG_RESPONSE_INVALID")
  return normalizeModels(
    parsed.data.models.map((model) => {
      const methods =
        model.supportedGenerationMethods ?? model.supportedActions ?? []
      const kind = methods.includes("generateContent")
        ? "chat"
        : methods.includes("embedContent")
          ? "embedding"
          : null
      return discoveredModel({
        id: model.baseModelId ?? model.name.replace(/^models\//u, ""),
        displayName: model.displayName,
        kind,
        contextWindow: contextWindow(model.inputTokenLimit),
      })
    })
  )
}

export function parseAlibabaModelCatalog(
  payload: unknown
): readonly DiscoveredModel[] {
  const parsed = alibabaModelListSchema.safeParse(payload)
  if (!parsed.success) throw new AppError("MODEL_CATALOG_RESPONSE_INVALID")
  return normalizeModels(
    parsed.data.output.models.map((model) =>
      discoveredModel({
        id: model.model,
        displayName: model.name,
        kind: "chat",
        contextWindow: firstContextWindow(
          model.model_info?.context_window,
          model.model_info?.max_input_tokens
        ),
        supportsImageInput:
          model.inference_metadata?.request_modality
            ?.map((value) => value.toLocaleLowerCase("en-US"))
            .includes("image") ?? null,
      })
    )
  )
}

function parseModelCatalog(
  provider: Exclude<ModelServiceProvider, "google_vertex">,
  payload: unknown
): readonly DiscoveredModel[] {
  return provider === "anthropic"
    ? parseAnthropicModelCatalog(payload)
    : provider === "google"
      ? parseGoogleModelCatalog(payload)
      : provider === "alibaba"
        ? parseAlibabaModelCatalog(payload)
        : parseOpenAiCompatibleModelCatalog(payload)
}

function modelCatalogRequest(input: ModelProviderCatalogInput): {
  url: URL
  headers: Headers
} {
  const headers = new Headers({ accept: "application/json" })
  const url = modelCatalogUrl(input)
  switch (input.provider) {
    case "anthropic":
      headers.set("x-api-key", input.apiKey)
      headers.set("anthropic-version", "2023-06-01")
      url.searchParams.set("limit", String(MODEL_CATALOG_MODEL_LIMIT))
      break
    case "google":
      headers.set("x-goog-api-key", input.apiKey)
      url.searchParams.set("pageSize", String(MODEL_CATALOG_MODEL_LIMIT))
      break
    case "azure_openai":
      headers.set("api-key", input.apiKey)
      break
    case "google_vertex":
      throw new AppError("MODEL_CATALOG_NOT_SUPPORTED")
    case "alibaba":
      headers.set("authorization", `Bearer ${input.apiKey}`)
      url.searchParams.set("page_no", "1")
      url.searchParams.set("page_size", "100")
      break
    case "deepseek":
    case "openai":
    case "openai_compatible":
    case "openrouter":
      headers.set("authorization", `Bearer ${input.apiKey}`)
      break
  }
  return { url, headers }
}

function modelCatalogUrl(input: ModelProviderCatalogInput): URL {
  if (input.provider === "alibaba") {
    const url = new URL(input.baseUrl)
    url.pathname = "/api/v1/models"
    url.search = ""
    url.hash = ""
    return url
  }
  return new URL("models", `${input.baseUrl.replace(/\/+$/u, "")}/`)
}

function discoveredModel(input: {
  id: string
  displayName?: string | undefined
  kind: DiscoveredModel["kind"]
  contextWindow: number | null
  supportsImageInput?: boolean | null
  supportedReasoningEfforts?: DiscoveredModel["supported_reasoning_efforts"]
  defaultReasoningEffort?:
    | DiscoveredModel["default_reasoning_effort"]
    | undefined
}): DiscoveredModel | null {
  const id = modelIdentifierSchema.safeParse(input.id.trim())
  if (!id.success) return null
  const displayName = (input.displayName?.trim() || id.data).slice(0, 120)
  const parsed = discoveredModelSchema.safeParse({
    id: id.data,
    display_name: displayName,
    kind: input.kind,
    context_window: input.contextWindow,
    supports_image_input: input.supportsImageInput ?? null,
    supported_reasoning_efforts: input.supportedReasoningEfforts ?? null,
    default_reasoning_effort: input.defaultReasoningEffort ?? null,
  })
  return parsed.success ? parsed.data : null
}

function normalizeModels(
  models: readonly (DiscoveredModel | null)[]
): readonly DiscoveredModel[] {
  const unique = new Map<string, DiscoveredModel>()
  for (const model of models) {
    if (model && !unique.has(model.id)) unique.set(model.id, model)
  }
  if (models.length > 0 && unique.size === 0) {
    throw new AppError("MODEL_CATALOG_RESPONSE_INVALID")
  }
  return [...unique.values()]
}

function firstContextWindow(
  ...values: readonly (number | null | undefined)[]
): number | null {
  for (const value of values) {
    const parsed = contextWindow(value)
    if (parsed !== null) return parsed
  }
  return null
}

function contextWindow(value: number | null | undefined): number | null {
  const parsed = modelContextWindowSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function parseJson(bytes: Buffer): unknown {
  try {
    return JSON.parse(bytes.toString("utf8")) as unknown
  } catch {
    throw new AppError("MODEL_CATALOG_RESPONSE_INVALID")
  }
}
