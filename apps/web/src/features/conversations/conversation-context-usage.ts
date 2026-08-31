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
