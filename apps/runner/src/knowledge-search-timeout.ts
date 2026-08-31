import { z } from "zod"

export const DEFAULT_KNOWLEDGE_SEARCH_TIMEOUT_MS = 200_000

const TRANSPORT_MARGIN_MS = 5_000
const OUTER_TRANSPORT_COUNT = 3
const MAXIMUM_BASE_TIMEOUT_MS =
  Number.MAX_SAFE_INTEGER - TRANSPORT_MARGIN_MS * OUTER_TRANSPORT_COUNT

export const knowledgeSearchTimeoutMsSchema = z.coerce
  .number()
  .int()
  .positive()
  .max(MAXIMUM_BASE_TIMEOUT_MS)

/**
 * The configured value is the innermost controller-to-API budget. Each caller
 * adds one small response/serialization margin so an outer timer cannot win a
 * race with the request it owns.
 */
export function deriveKnowledgeSearchTimeouts(input: unknown): {
  apiProxyMs: number
  workerRelayMs: number
  mcpHelperMs: number
  codexToolSeconds: number
} {
  const apiProxyMs = knowledgeSearchTimeoutMsSchema.parse(input)
  const workerRelayMs = apiProxyMs + TRANSPORT_MARGIN_MS
  const mcpHelperMs = workerRelayMs + TRANSPORT_MARGIN_MS
  const codexToolMilliseconds = mcpHelperMs + TRANSPORT_MARGIN_MS
  return {
    apiProxyMs,
    workerRelayMs,
    mcpHelperMs,
    codexToolSeconds: Math.ceil(codexToolMilliseconds / 1_000),
  }
}
