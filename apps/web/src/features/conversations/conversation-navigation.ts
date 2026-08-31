import type { Conversation } from "@/api/contracts"

type ConversationNavigationTarget = Pick<Conversation, "id" | "application">

export function conversationPath(conversation: ConversationNavigationTarget) {
  return conversation.application?.kind === "interactive"
    ? `/applications/${conversation.application.id}/run/${conversation.id}`
    : `/conversations/${conversation.id}`
}

export function isConversationPathActive(
  pathname: string,
  conversation: ConversationNavigationTarget
) {
  return pathname === conversationPath(conversation)
}

export function isInteractiveApplicationRunPath(pathname: string) {
  return /^\/applications\/[^/]+\/run\/[^/]+$/u.test(pathname)
}
