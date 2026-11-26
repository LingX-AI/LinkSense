import { getNativeCodexPayload, type ConversationEvent } from "@/api/contracts"

export type ConversationModelContextUsage = Readonly<{
  turnId: string | null
  usedTokens: number
  modelContextWindow: number | null
}>

export type ConversationModelContextUsageSnapshot = Readonly<{
  used_tokens: number
  model_context_window: number | null
}>

export type ConversationContextBreakdown = ConversationModelContextUsage &
  Readonly<{
    inputTokens: number
    cachedInputTokens: number
    outputTokens: number
    reasoningOutputTokens: number
  }>

export type ConversationContextRow = Readonly<{
  key: "input" | "cached" | "output" | "reasoning" | "free"
  tokens: number
  colorClass: string | null
  showPercent: boolean
}>

export function equalConversationContextBreakdown(
  a: ConversationContextBreakdown | null | undefined,
  b: ConversationContextBreakdown | null | undefined
): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return (
    a.turnId === b.turnId &&
    a.usedTokens === b.usedTokens &&
    a.modelContextWindow === b.modelContextWindow &&
    a.inputTokens === b.inputTokens &&
    a.cachedInputTokens === b.cachedInputTokens &&
    a.outputTokens === b.outputTokens &&
    a.reasoningOutputTokens === b.reasoningOutputTokens
  )
}

/**
 * Context categories shared by the session rail and the composer context card.
 * Reasoning is reported but not part of the context window, so it stays
 * percent-less like the deferred rows in the reference design.
 */
export function buildConversationContextRows(
  breakdown: ConversationContextBreakdown | null,
  usedTokens: number | null,
  totalTokens: number | null
): ConversationContextRow[] {
  if (!breakdown || usedTokens === null || totalTokens === null) return []
  return [
    {
      key: "input",
      tokens: Math.max(0, breakdown.inputTokens - breakdown.cachedInputTokens),
      colorClass: "bg-[var(--chart-1)]",
      showPercent: true,
    },
    {
      key: "cached",
      tokens: breakdown.cachedInputTokens,
      colorClass: "bg-[var(--chart-2)]",
      showPercent: true,
    },
    {
      key: "output",
      tokens: breakdown.outputTokens,
      colorClass: "bg-[var(--chart-3)]",
      showPercent: true,
    },
    {
      key: "reasoning",
      tokens: breakdown.reasoningOutputTokens,
      colorClass: null,
      showPercent: false,
    },
    {
      key: "free",
      tokens: Math.max(0, totalTokens - usedTokens),
      colorClass: null,
      showPercent: true,
    },
  ]
}

export function selectLatestConversationContextBreakdown(
  events: readonly ConversationEvent[]
): ConversationContextBreakdown | null {
  let latest: (ConversationContextBreakdown & { sequenceNo: number }) | null =
    null
  for (const event of events) {
    const native = getNativeCodexPayload(event)
    if (native?.method !== "thread/tokenUsage/updated") continue
    if (latest && event.sequence_no < latest.sequenceNo) continue
    latest = {
      turnId: event.turn_id ?? native.params.turnId,
      usedTokens: native.params.tokenUsage.last.totalTokens,
      modelContextWindow: native.params.tokenUsage.modelContextWindow,
      inputTokens: native.params.tokenUsage.last.inputTokens,
      cachedInputTokens: native.params.tokenUsage.last.cachedInputTokens,
      outputTokens: native.params.tokenUsage.last.outputTokens,
      reasoningOutputTokens:
        native.params.tokenUsage.last.reasoningOutputTokens,
      sequenceNo: event.sequence_no,
    }
  }
  if (!latest) return null
  return {
    turnId: latest.turnId,
    usedTokens: latest.usedTokens,
    modelContextWindow: latest.modelContextWindow,
    inputTokens: latest.inputTokens,
    cachedInputTokens: latest.cachedInputTokens,
    outputTokens: latest.outputTokens,
    reasoningOutputTokens: latest.reasoningOutputTokens,
  }
}

/**
 * Tokens the context shrank by when the given compaction item ran, or null
 * when the native stream does not report both sizes.
 *
 * The size before the compaction is the last one reported before the item,
 * which belongs to the preceding turn, so the whole conversation stream is
 * needed. The compacted size is the smallest one reported from the item up to
 * the next compaction: the compaction request itself still reports the
 * pre-compaction size, and the context only grows again afterwards.
 */
export function selectContextCompactionSavedTokens(
  events: readonly ConversationEvent[],
  itemId: string | undefined
): number | null {
  if (!itemId) return null
  let beforeCompaction: number | null = null
  let compacted: number | null = null
  let compactionStarted = false
  for (const event of events) {
    const native = getNativeCodexPayload(event)
    if (!native) continue
    if (
      native.method === "item/started" ||
      native.method === "item/completed"
    ) {
      if (native.params.item.type !== "contextCompaction") continue
      if (native.params.item.id !== itemId) {
        // A later compaction owns every size reported after it.
        if (compactionStarted) break
        continue
      }
      compactionStarted = true
      continue
    }
    if (native.method !== "thread/tokenUsage/updated") continue
    const usedTokens = native.params.tokenUsage.last.totalTokens
    if (!compactionStarted) {
      beforeCompaction = usedTokens
      continue
    }
    compacted =
      compacted === null ? usedTokens : Math.min(compacted, usedTokens)
  }
  if (beforeCompaction === null || compacted === null) return null
  const savedTokens = beforeCompaction - compacted
  return savedTokens > 0 ? savedTokens : null
}

export function selectConversationModelContextUsage(
  events: readonly ConversationEvent[],
  snapshot?: ConversationModelContextUsageSnapshot | null,
  catalogWindow?: number | null
): ConversationModelContextUsage | null {
  const usage = selectLatestConversationModelContextUsage(events) ??
    (snapshot
      ? {
          turnId: null,
          usedTokens: snapshot.used_tokens,
          modelContextWindow: snapshot.model_context_window,
        }
      : null)
  return usage
    ? { ...usage, modelContextWindow: usage.modelContextWindow ?? catalogWindow ?? null }
    : null
}

export function selectLatestConversationModelContextUsage(
  events: readonly ConversationEvent[]
): ConversationModelContextUsage | null {
  let latest:
    (ConversationModelContextUsage & Readonly<{ sequenceNo: number }>) | null =
    null

  for (const event of events) {
    const native = getNativeCodexPayload(event)
    if (native?.method !== "thread/tokenUsage/updated") continue
    if (latest && event.sequence_no < latest.sequenceNo) continue
    latest = {
      turnId: event.turn_id ?? native.params.turnId,
      usedTokens: native.params.tokenUsage.last.totalTokens,
      modelContextWindow: native.params.tokenUsage.modelContextWindow,
      sequenceNo: event.sequence_no,
    }
  }

  if (!latest) return null
  return {
    turnId: latest.turnId,
    usedTokens: latest.usedTokens,
    modelContextWindow: latest.modelContextWindow,
  }
}
