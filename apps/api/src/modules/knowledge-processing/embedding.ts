import { createHash, randomUUID } from "node:crypto"

import type { ModelTokenPricing } from "@linksense/shared"
import { z } from "zod"

import { KnowledgeProcessingError } from "./errors.js"
import {
  knowledgeProviderTokenUsageSchema,
  normalizeKnowledgeProviderTokenUsage,
  type NormalizedKnowledgeProviderTokenUsage,
} from "./provider-token-usage.js"
import {
  EMBEDDING_TRUNCATION_MARKER,
  LENGTH_BUDGET_PERCENTAGES,
  cl100kTokenEstimator,
  joinContextAndBody,
  truncateContextHeadTail,
  type TokenEstimator,
} from "./token-estimator.js"

export const EMBEDDING_TRUNCATION_STRATEGY = "context-head70-tail30-v1" as const

const embeddingResponseSchema = z.object({
  object: z.string().optional(),
  model: z.string().optional(),
  data: z.array(
    z.strictObject({
      object: z.string().optional(),
      index: z.number().int().nonnegative(),
      embedding: z.array(z.number().finite()),
    })
  ),
  usage: knowledgeProviderTokenUsageSchema.optional(),
})

export type EmbeddingClientConfig = {
  baseUrl: string
  apiKey?: string
  model: string
  dimensions: number
  maximumInputTokens: number
  timeoutMs?: number
  pricing?: ModelTokenPricing
}

export type EmbeddingInput = {
  context: string
  body: string
}

export type EmbeddingResult = {
  requestId: string
  model: string
  pricing: ModelTokenPricing
  usage: {
    totalTokens: number
    inputTokens: number
    cachedInputTokens: number
    outputTokens: number
    reasoningOutputTokens: number
    measurementMethod: "provider" | "estimated"
  }
  vector: number[]
  fullInputTokens: number
  configuredMaximumTokens: number
  attemptedPercentage: number
  actualInputTokens: number
  truncated: boolean
  attempt: number
  truncationStrategy: typeof EMBEDDING_TRUNCATION_STRATEGY
}

export class EmbeddingClient {
  readonly profileHash: string
  private readonly endpoint: string

  constructor(
    private readonly config: EmbeddingClientConfig,
    private readonly fetcher: typeof fetch = fetch,
    private readonly estimator: TokenEstimator = cl100kTokenEstimator
  ) {
    if (
      !Number.isSafeInteger(config.dimensions) ||
      config.dimensions <= 0 ||
      !Number.isSafeInteger(config.maximumInputTokens) ||
      config.maximumInputTokens <= 0
    ) {
      throw new KnowledgeProcessingError("KNOWLEDGE_EMBEDDING_RESPONSE_INVALID")
    }
    const baseUrl = config.baseUrl.replace(/\/+$/u, "")
    this.endpoint = /\/v1$/iu.test(baseUrl)
      ? `${baseUrl}/embeddings`
      : `${baseUrl}/v1/embeddings`
    this.profileHash = createEmbeddingProfileHash(
      config.model,
      config.dimensions
    )
  }

  async embed(
    input: EmbeddingInput,
    signal?: AbortSignal,
    maximumInputTokens = this.config.maximumInputTokens
  ): Promise<EmbeddingResult> {
    const fullText = joinContextAndBody(input.context, input.body)
    const fullInputTokens = this.estimator.count(fullText)

    for (const [
      attemptIndex,
      percentage,
    ] of LENGTH_BUDGET_PERCENTAGES.entries()) {
      const maximumTokens = Math.floor((maximumInputTokens * percentage) / 100)
      const protectedInput = truncateContextHeadTail({
        context: input.context,
        body: input.body,
        maximumTokens,
        marker: EMBEDDING_TRUNCATION_MARKER,
        estimator: this.estimator,
      })
      if (protectedInput === null) {
        throw new KnowledgeProcessingError("EMBEDDING_INPUT_TOO_LARGE")
      }

      try {
        const response = await this.request(protectedInput.text, signal)
        const usage = response.usage
          ? {
              ...response.usage,
              measurementMethod: "provider" as const,
            }
          : {
              totalTokens: protectedInput.actualTokens,
              inputTokens: protectedInput.actualTokens,
              cachedInputTokens: 0 as const,
              outputTokens: 0,
              reasoningOutputTokens: 0 as const,
              measurementMethod: "estimated" as const,
            }
        return {
          requestId: response.requestId,
          model: this.config.model,
          pricing: this.config.pricing ?? DEFAULT_MODEL_PRICING,
          usage,
          vector: response.vector,
          fullInputTokens,
          configuredMaximumTokens: maximumInputTokens,
          attemptedPercentage: percentage,
          actualInputTokens: protectedInput.actualTokens,
          truncated: protectedInput.truncated,
          attempt: attemptIndex + 1,
          truncationStrategy: EMBEDDING_TRUNCATION_STRATEGY,
        }
      } catch (error) {
        if (!isEmbeddingInputLengthError(error)) throw error
        if (percentage === 50) {
          throw new KnowledgeProcessingError("EMBEDDING_INPUT_TOO_LARGE")
        }
      }
    }

    throw new KnowledgeProcessingError("EMBEDDING_INPUT_TOO_LARGE")
  }

  async embedQuery(
    query: string,
    signal?: AbortSignal
  ): Promise<EmbeddingResult> {
    return this.embed({ context: "", body: query }, signal)
  }

  async health(signal?: AbortSignal): Promise<void> {
    await this.embed({ context: "", body: "health" }, signal)
  }

  private async request(
    text: string,
    signal?: AbortSignal
  ): Promise<{
    requestId: string
    vector: number[]
    usage?: NormalizedKnowledgeProviderTokenUsage
  }> {
    const requestId = randomUUID()
    const headers = new Headers({ "content-type": "application/json" })
    if (this.config.apiKey) {
      headers.set("authorization", `Bearer ${this.config.apiKey}`)
    }
    const timeout = AbortSignal.timeout(this.config.timeoutMs ?? 60_000)
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout
    let response: Response
    try {
      response = await this.fetcher(this.endpoint, {
        method: "POST",
        headers,
        signal: combined,
        body: JSON.stringify({
          model: this.config.model,
          input: text,
          dimensions: this.config.dimensions,
        }),
      })
    } catch (error) {
      if (signal?.aborted) {
        throw new KnowledgeProcessingError("KNOWLEDGE_PROCESSING_CANCELLED")
      }
      throw new KnowledgeProcessingError(
        "KNOWLEDGE_EXTERNAL_SERVICE_UNAVAILABLE",
        { cause: error, retryable: true }
      )
    }

    if (!response.ok) {
      const errorShape = await parseExternalErrorShape(response)
      if (isLengthErrorShape(response.status, errorShape)) {
        throw new EmbeddingInputLengthError()
      }
      if (response.status === 401 || response.status === 403) {
        throw new KnowledgeProcessingError(
          "KNOWLEDGE_EXTERNAL_SERVICE_AUTHENTICATION_FAILED"
        )
      }
      throw new KnowledgeProcessingError(
        "KNOWLEDGE_EXTERNAL_SERVICE_UNAVAILABLE",
        {
          retryable:
            response.status === 408 ||
            response.status === 429 ||
            response.status >= 500,
        }
      )
    }

    let json: unknown
    try {
      json = await response.json()
    } catch (error) {
      throw new KnowledgeProcessingError(
        "KNOWLEDGE_EMBEDDING_RESPONSE_INVALID",
        { cause: error }
      )
    }
    const parsed = embeddingResponseSchema.safeParse(json)
    if (
      !parsed.success ||
      parsed.data.data.length !== 1 ||
      parsed.data.data[0]?.index !== 0
    ) {
      throw new KnowledgeProcessingError("KNOWLEDGE_EMBEDDING_RESPONSE_INVALID")
    }
    const vector = parsed.data.data[0].embedding
    validateEmbeddingVector(vector, this.config.dimensions)
    const usage = parsed.data.usage
      ? normalizeKnowledgeProviderTokenUsage(parsed.data.usage)
      : undefined
    if (parsed.data.usage && !usage) {
      throw new KnowledgeProcessingError("KNOWLEDGE_EMBEDDING_RESPONSE_INVALID")
    }
    return {
      requestId,
      vector,
      ...(usage ? { usage } : {}),
    }
  }
}

const DEFAULT_MODEL_PRICING: ModelTokenPricing = {
  input_price_per_million: "0",
  cached_input_price_per_million: "0",
  output_price_per_million: "0",
}

export function createEmbeddingProfileHash(
  model: string,
  dimensions: number
): string {
  const canonical = JSON.stringify({
    model: model.trim(),
    dimensions,
  })
  return createHash("sha256").update(canonical, "utf8").digest("hex")
}

export function validateEmbeddingVector(
  vector: readonly number[],
  dimensions: number
): void {
  if (
    vector.length !== dimensions ||
    vector.some((value) => !Number.isFinite(value))
  ) {
    throw new KnowledgeProcessingError("KNOWLEDGE_EMBEDDING_RESPONSE_INVALID")
  }
  let squaredNorm = 0
  for (const value of vector) squaredNorm += value * value
  if (!Number.isFinite(squaredNorm) || squaredNorm === 0) {
    throw new KnowledgeProcessingError("KNOWLEDGE_EMBEDDING_RESPONSE_INVALID")
  }
}

class EmbeddingInputLengthError extends Error {
  constructor() {
    super("embedding input exceeds provider limit")
    this.name = "EmbeddingInputLengthError"
  }
}

function isEmbeddingInputLengthError(
  value: unknown
): value is EmbeddingInputLengthError {
  return value instanceof EmbeddingInputLengthError
}

type ExternalErrorShape = {
  code: string | undefined
  type: string | undefined
  message: string | undefined
}

async function parseExternalErrorShape(
  response: Response
): Promise<ExternalErrorShape> {
  try {
    const text = (await response.text()).slice(0, 4_096)
    const parsed: unknown = JSON.parse(text)
    if (typeof parsed !== "object" || parsed === null) {
      return { code: undefined, type: undefined, message: undefined }
    }
    const nested = Reflect.get(parsed, "error")
    const source =
      typeof nested === "object" && nested !== null ? nested : parsed
    return {
      code: stringProperty(source, "code"),
      type: stringProperty(source, "type"),
      message: stringProperty(source, "message"),
    }
  } catch {
    return { code: undefined, type: undefined, message: undefined }
  }
}

function isLengthErrorShape(
  status: number,
  shape: ExternalErrorShape
): boolean {
  if (status !== 400 && status !== 413 && status !== 422) return false
  const stable = `${shape.code ?? ""} ${shape.type ?? ""}`.toLowerCase()
  if (
    stable.includes("context_length") ||
    stable.includes("input_too_long") ||
    stable.includes("max_tokens") ||
    stable.includes("token_limit")
  ) {
    return true
  }
  const message = shape.message?.toLowerCase() ?? ""
  return (
    /(?:maximum|max|context|input).{0,32}(?:token|length)/u.test(message) &&
    /(?:exceed|too long|larger|limit)/u.test(message)
  )
}

function stringProperty(value: object, key: string): string | undefined {
  const property = Reflect.get(value, key)
  return typeof property === "string" ? property.slice(0, 512) : undefined
}
