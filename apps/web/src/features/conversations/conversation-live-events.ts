import { getNativeCodexPayload, type ConversationEvent } from "@/api/contracts"

const LIVE_EVENT_LIMIT = 200
const STREAM_ONLY_NATIVE_METHODS = new Set([
  "item/agentMessage/delta",
  "item/plan/delta",
  "item/reasoning/summaryTextDelta",
  "item/reasoning/summaryPartAdded",
])

export function isStreamOnlyNativeEvent(event: ConversationEvent) {
  const native = getNativeCodexPayload(event)
  return native ? STREAM_ONLY_NATIVE_METHODS.has(native.method) : false
}

export function appendConversationLiveEvent(
  current: ConversationEvent[],
  event: ConversationEvent
) {
  const native = getNativeCodexPayload(event)
  if (!native || STREAM_ONLY_NATIVE_METHODS.has(native.method)) return current

  const retained = current.filter((value) => {
    if (value.id === event.id) return false
    const existingNative = getNativeCodexPayload(value)
    if (native.method === "thread/tokenUsage/updated") {
      return existingNative?.method !== "thread/tokenUsage/updated"
    }
    if (native.method !== "turn/plan/updated") return true
    return !(
      existingNative?.method === "turn/plan/updated" &&
      value.turn_id === event.turn_id
    )
  })

  return [...retained.slice(-(LIVE_EVENT_LIMIT - 1)), event]
}
