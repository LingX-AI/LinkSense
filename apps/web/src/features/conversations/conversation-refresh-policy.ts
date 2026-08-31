import { getNativeCodexPayload, type ConversationEvent } from "@/api/contracts"

export type ConversationQueryRefreshScope =
  "none" | "detail" | "detail-and-list"

const detailAndListEvents = new Set<ConversationEvent["type"]>([
  "thread/name/updated",
  "turn/started",
  "turn/completed",
  "conversation.title.updated",
  "conversation.status.changed",
  "conversation.interrupted",
  "conversation.completed",
  "conversation.plan_review.updated",
])

const detailEvents = new Set<ConversationEvent["type"]>([
  "thread/goal/updated",
  "thread/goal/cleared",
  "conversation.pending_request.updated",
  "conversation.pending_request.cancelled",
  "conversation.user_input_request.updated",
  "item/tool/requestUserInput",
  "linksense/form/request",
  "serverRequest/resolved",
  "conversation.message.completed",
  "conversation.capability.attached",
  "conversation.file.created",
  "conversation.file.updated",
  "conversation.artifact.created",
])

export function getConversationQueryRefreshScope(
  eventType: ConversationEvent["type"]
): ConversationQueryRefreshScope {
  if (detailAndListEvents.has(eventType)) return "detail-and-list"
  if (detailEvents.has(eventType)) return "detail"
  return "none"
}

export function getConversationEventQueryRefreshScope(
  event: ConversationEvent
): ConversationQueryRefreshScope {
  const native = getNativeCodexPayload(event)
  if (
    native?.method === "item/completed" &&
    native.params.item.type === "plan" &&
    native.local?.plan_review_id
  ) {
    return "detail"
  }
  return getConversationQueryRefreshScope(event.type)
}
