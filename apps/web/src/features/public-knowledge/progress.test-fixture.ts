import { conversationEventSchema } from "@linksense/shared"

export function publicProgressEvent(
  conversationId: string,
  turnId: string,
  sequence: number,
  type: string,
  payload: Record<string, unknown>
) {
  return conversationEventSchema.parse({
    id: `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
    conversation_id: conversationId,
    turn_id: turnId,
    sequence_no: sequence,
    event_type: type,
    payload,
    visibility: "user_collapsed",
    sse_event_id: `${conversationId}:${sequence}`,
    created_at: "2026-11-05T00:00:00Z",
  })
}
export function publicSearchEvent(
  conversationId: string,
  turnId: string,
  sequence: number,
  completed = false
) {
  return publicProgressEvent(
    conversationId,
    turnId,
    sequence,
    completed ? "conversation.step.completed" : "conversation.step.started",
    {
      schema_version: 1,
      item_id: `${turnId}:knowledge-search`,
      action: "knowledge_search",
      safe_summary: "",
    }
  )
}
