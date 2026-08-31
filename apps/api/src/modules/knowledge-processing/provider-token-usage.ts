import { z } from "zod"

const providerTokenCountSchema = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER)

const cachedTokenDetailsSchema = z.object({
  cached_tokens: providerTokenCountSchema.optional(),
})

const reasoningTokenDetailsSchema = z.object({
  reasoning_tokens: providerTokenCountSchema.optional(),
})

export const knowledgeProviderTokenUsageSchema = z.object({
  prompt_tokens: providerTokenCountSchema.optional(),
  input_tokens: providerTokenCountSchema.optional(),
  total_tokens: providerTokenCountSchema,
  prompt_tokens_details: cachedTokenDetailsSchema.nullish(),
  input_tokens_details: cachedTokenDetailsSchema.nullish(),
  completion_tokens_details: reasoningTokenDetailsSchema.nullish(),
  output_tokens_details: reasoningTokenDetailsSchema.nullish(),
})

export type NormalizedKnowledgeProviderTokenUsage = {
  totalTokens: number
  inputTokens: number
  cachedInputTokens: number
  outputTokens: number
  reasoningOutputTokens: number
}

export function normalizeKnowledgeProviderTokenUsage(
  usage: z.infer<typeof knowledgeProviderTokenUsageSchema>
): NormalizedKnowledgeProviderTokenUsage | null {
  const inputTokens =
    usage.prompt_tokens ?? usage.input_tokens ?? usage.total_tokens
  const cachedInputTokens =
    usage.prompt_tokens_details?.cached_tokens ??
    usage.input_tokens_details?.cached_tokens ??
    0
  const outputTokens = usage.total_tokens - inputTokens
  const reasoningOutputTokens =
    usage.completion_tokens_details?.reasoning_tokens ??
    usage.output_tokens_details?.reasoning_tokens ??
    0
  if (
    outputTokens < 0 ||
    cachedInputTokens > inputTokens ||
    reasoningOutputTokens > outputTokens
  ) {
    return null
  }
  return {
    totalTokens: usage.total_tokens,
    inputTokens,
    cachedInputTokens,
    outputTokens,
    reasoningOutputTokens,
  }
}
