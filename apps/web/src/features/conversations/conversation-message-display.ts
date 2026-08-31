import type { ConversationMessage } from "@/api/contracts"
import { officeAnnotationRequestText } from "@linksense/shared"

export function getConversationMessageDisplayText(
  message: ConversationMessage
): string {
  if (message.role === "user" && message.display) {
    return officeAnnotationRequestText(message.display)
  }
  return message.content
}

export function isStructuredUserMessage(message: ConversationMessage) {
  return message.role === "user" && Boolean(message.display)
}
