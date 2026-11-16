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
  snapshot?: ConversationModelContextUsageSnapshot | null
): ConversationModelContextUsage | null {
  const eventUsage = selectLatestConversationModelContextUsage(events)
  if (eventUsage) return eventUsage
  if (!snapshot) return null
  return {
    turnId: null,
    usedTokens: snapshot.used_tokens,
    modelContextWindow: snapshot.model_context_window,
  }
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
