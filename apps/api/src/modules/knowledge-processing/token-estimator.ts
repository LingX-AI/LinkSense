import {
  countTokens,
  decode,
  encode,
} from "gpt-tokenizer/encoding/cl100k_base"

export const LENGTH_BUDGET_PERCENTAGES = [
  90, 85, 80, 75, 70, 65, 60, 55, 50,
] as const

export const EMBEDDING_TRUNCATION_MARKER =
  "\n\n[... linksense embedding truncation v1 ...]\n\n"

export const RERANK_TRUNCATION_MARKER =
  "\n\n[... linksense rerank truncation v1 ...]\n\n"

export interface TokenEstimator {
  count(text: string): number
  truncateHead(text: string, maximumTokens: number): string
  truncateTail(text: string, maximumTokens: number): string
}

export const cl100kTokenEstimator: TokenEstimator = {
  count(text) {
    return countTokens(text)
  },
  truncateHead(text, maximumTokens) {
    if (maximumTokens <= 0) return ""
    const tokens = encode(text)
    return tokens.length <= maximumTokens
      ? text
      : decode(tokens.slice(0, maximumTokens))
  },
  truncateTail(text, maximumTokens) {
    if (maximumTokens <= 0) return ""
    const tokens = encode(text)
    return tokens.length <= maximumTokens
      ? text
      : decode(tokens.slice(tokens.length - maximumTokens))
  },
}

export type HeadTailTruncation = {
  text: string
  originalTokens: number
  actualTokens: number
  truncated: boolean
}

/**
 * Produces a temporary model input while preserving structural context and
 * taking body slices only at cl100k token boundaries.
 */
export function truncateContextHeadTail(input: {
  context: string
  body: string
  maximumTokens: number
  marker: string
  estimator?: TokenEstimator
}): HeadTailTruncation | null {
  const estimator = input.estimator ?? cl100kTokenEstimator
  const fullText = joinContextAndBody(input.context, input.body)
  const originalTokens = estimator.count(fullText)
  if (originalTokens <= input.maximumTokens) {
    return {
      text: fullText,
      originalTokens,
      actualTokens: originalTokens,
      truncated: false,
    }
  }

  const context = input.context.trim()
  const contextPrefix = context === "" ? "" : `${context}\n\n`
  const fixedTokens = estimator.count(`${contextPrefix}${input.marker}`)
  const bodyBudget = input.maximumTokens - fixedTokens
  if (bodyBudget < 2) return null

  const headBudget = Math.floor(bodyBudget * 0.7)
  const tailBudget = bodyBudget - headBudget
  const head = estimator.truncateHead(input.body, headBudget)
  const tail = estimator.truncateTail(input.body, tailBudget)
  const text = `${contextPrefix}${head}${input.marker}${tail}`
  const actualTokens = estimator.count(text)

  if (actualTokens > input.maximumTokens) {
    const overflow = actualTokens - input.maximumTokens
    const adjustedTail = estimator.truncateTail(
      input.body,
      Math.max(0, tailBudget - overflow),
    )
    const adjusted = `${contextPrefix}${head}${input.marker}${adjustedTail}`
    const adjustedTokens = estimator.count(adjusted)
    if (adjustedTokens > input.maximumTokens) return null
    return {
      text: adjusted,
      originalTokens,
      actualTokens: adjustedTokens,
      truncated: true,
    }
  }

  return {
    text,
    originalTokens,
    actualTokens,
    truncated: true,
  }
}

export function joinContextAndBody(context: string, body: string): string {
  const normalizedContext = context.trim()
  return normalizedContext === ""
    ? body
    : `${normalizedContext}\n\n${body}`
}
