import { getNativeCodexPayload, type ConversationEvent } from "@/api/contracts"
import {
  appendStreamingMessageDelta,
  applyStreamingMessageLifecycle,
  type StreamingAssistantMessages,
} from "@/features/conversations/streaming-messages"

/** Public messages use the same delta, phase and completion reducers as chat. */
export function applyPublicMessageEvent(
  current: StreamingAssistantMessages,
  event: ConversationEvent
): StreamingAssistantMessages {
  const native = getNativeCodexPayload(event)
  if (!native) return current
  if (
    (native.method === "item/started" || native.method === "item/completed") &&
    native.params.item.type === "agentMessage"
  ) {
    const item = native.params.item
    return applyStreamingMessageLifecycle(current, {
      itemId: item.id,
      messageId: `${event.turn_id}:${item.id}`,
      turnId: event.turn_id,
      phase: item.phase,
      text: item.text,
      createdAt: event.created_at,
      sequence: event.sequence_no,
      completed: native.method === "item/completed",
    })
  }
  if (native.method === "item/agentMessage/delta")
    return appendStreamingMessageDelta(current, {
      itemId: native.params.itemId,
      messageId: `${event.turn_id}:${native.params.itemId}`,
      turnId: event.turn_id,
      delta: native.params.delta,
      createdAt: event.created_at,
      sequence: event.sequence_no,
    })
  return current
}
