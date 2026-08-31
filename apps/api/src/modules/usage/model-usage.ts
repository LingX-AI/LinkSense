import {
  modelUsageWorkloadValues,
  modelIdentifierSchema,
  modelTokenPricingSchema,
  usageModelKindValues,
  usageMeasurementMethodSchema,
  type ModelTokenPricing,
} from "@linksense/shared"
import { z } from "zod"

export const modelUsageWorkloadSchema = z.enum(modelUsageWorkloadValues)
export const modelUsageKindSchema = z.enum(usageModelKindValues)

const modelUsageTokenCountSchema = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER)

export const modelUsageCaptureSchema = z
  .strictObject({
    requestId: z.uuid(),
    ownerId: z.uuid(),
    conversationId: z.uuid().optional(),
    turnId: z.uuid().optional(),
    knowledgeBaseId: z.uuid().optional(),
    documentId: z.uuid().optional(),
    documentVersionId: z.uuid().optional(),
    processingGeneration: z.uuid().optional(),
    operation: z.string().trim().min(1).max(32).optional(),
    workload: modelUsageWorkloadSchema,
    modelKind: modelUsageKindSchema,
    model: modelIdentifierSchema,
    measurementMethod: usageMeasurementMethodSchema,
    tokenUsage: z.strictObject({
      totalTokens: modelUsageTokenCountSchema,
      inputTokens: modelUsageTokenCountSchema,
      cachedInputTokens: modelUsageTokenCountSchema.default(0),
      outputTokens: modelUsageTokenCountSchema.default(0),
      reasoningOutputTokens: modelUsageTokenCountSchema.default(0),
    }),
    pricing: modelTokenPricingSchema,
    observedAt: z.date().optional(),
  })
  .superRefine((usage, context) => {
    if (usage.tokenUsage.cachedInputTokens > usage.tokenUsage.inputTokens) {
      context.addIssue({
        code: "custom",
        path: ["tokenUsage", "cachedInputTokens"],
        message: "cached_input_tokens_must_be_input_subset",
      })
    }
    if (
      usage.tokenUsage.reasoningOutputTokens > usage.tokenUsage.outputTokens
    ) {
      context.addIssue({
        code: "custom",
        path: ["tokenUsage", "reasoningOutputTokens"],
        message: "reasoning_output_tokens_must_be_output_subset",
      })
    }
    const expectedModelKind =
      usage.workload === "image_generation"
        ? "image"
        : usage.workload === "rerank"
        ? "rerank"
        : usage.workload === "memory_generation" ||
            usage.workload === "task_title_generation"
          ? "generation"
          : "embedding"
    if (usage.modelKind !== expectedModelKind) {
      context.addIssue({
        code: "custom",
        path: ["modelKind"],
        message: "model_kind_does_not_match_workload",
      })
    }
  })

export type ModelUsageCapture = z.output<typeof modelUsageCaptureSchema>

export type MeasuredModelTokenUsage = ModelUsageCapture["tokenUsage"] & {
  measurementMethod: ModelUsageCapture["measurementMethod"]
}

/**
 * Projects provider/runtime usage into the strict persistence contract.
 * Measurement provenance belongs beside tokenUsage and must never leak into
 * the strict token-count object passed to modelUsageCaptureSchema.
 */
export function projectMeasuredModelTokenUsage(
  usage: MeasuredModelTokenUsage,
): Pick<ModelUsageCapture, "measurementMethod" | "tokenUsage"> {
  const { measurementMethod, ...tokenUsage } = usage
  return { measurementMethod, tokenUsage }
}

export interface ModelUsageRecorder {
  recordModelUsage(input: ModelUsageCapture): Promise<{ recorded: boolean }>
}

export type UsagePriceAndCostSnapshot = {
  inputPriceMicrosPerMillion: bigint
  cachedInputPriceMicrosPerMillion: bigint
  outputPriceMicrosPerMillion: bigint
  inputCostPicoCny: bigint
  cachedInputCostPicoCny: bigint
  outputCostPicoCny: bigint
  totalCostPicoCny: bigint
  unpricedTokens: bigint
}

export function calculatePriceAndCostSnapshot(
  tokenUsage: {
    totalTokens: bigint
    inputTokens: bigint
    cachedInputTokens: bigint
    outputTokens: bigint
  },
  pricing: ModelTokenPricing | null,
): UsagePriceAndCostSnapshot {
  if (pricing === null) {
    return {
      inputPriceMicrosPerMillion: 0n,
      cachedInputPriceMicrosPerMillion: 0n,
      outputPriceMicrosPerMillion: 0n,
      inputCostPicoCny: 0n,
      cachedInputCostPicoCny: 0n,
      outputCostPicoCny: 0n,
      totalCostPicoCny: 0n,
      unpricedTokens: tokenUsage.totalTokens,
    }
  }

  const inputPriceMicrosPerMillion = priceToMicros(
    pricing.input_price_per_million,
  )
  const cachedInputPriceMicrosPerMillion = priceToMicros(
    pricing.cached_input_price_per_million,
  )
  const outputPriceMicrosPerMillion = priceToMicros(
    pricing.output_price_per_million,
  )
  const regularInputTokens =
    tokenUsage.inputTokens - tokenUsage.cachedInputTokens
  const inputCostPicoCny = regularInputTokens * inputPriceMicrosPerMillion
  const cachedInputCostPicoCny =
    tokenUsage.cachedInputTokens * cachedInputPriceMicrosPerMillion
  const outputCostPicoCny =
    tokenUsage.outputTokens * outputPriceMicrosPerMillion
  return {
    inputPriceMicrosPerMillion,
    cachedInputPriceMicrosPerMillion,
    outputPriceMicrosPerMillion,
    inputCostPicoCny,
    cachedInputCostPicoCny,
    outputCostPicoCny,
    totalCostPicoCny:
      inputCostPicoCny + cachedInputCostPicoCny + outputCostPicoCny,
    unpricedTokens: 0n,
  }
}

function priceToMicros(value: string): bigint {
  const normalized =
    modelTokenPricingSchema.shape.input_price_per_million.parse(value)
  const [whole = "0", fraction = ""] = normalized.split(".")
  return BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0") || "0")
}
