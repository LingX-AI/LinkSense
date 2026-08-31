import type { ConversationMessage } from "@/api/contracts"
import type { ConversationLineSidebarItem } from "@/features/conversations/conversation-line-sidebar"
import { getConversationMessageDisplayText } from "@/features/conversations/conversation-message-display"
import { stripKnowledgeSourceMarkers } from "@/features/conversations/knowledge-source-markers"

const MAX_VISIBLE_MESSAGE_EXCHANGES = 20

export function buildConversationLineSidebarItems(
  messages: readonly ConversationMessage[],
  awaitingAssistantLabel: string
): ConversationLineSidebarItem[] {
  const items: ConversationLineSidebarItem[] = []

  for (const message of messages) {
    const displayContent = getConversationMessageDisplayText(message)
    const content = (
      message.role === "assistant"
        ? stripKnowledgeSourceMarkers(displayContent)
        : displayContent
    ).trim()
    if (!content) continue

    if (message.role === "user") {
      items.push({
        id: message.id,
        userMessage: content,
        ...(message.created_at ? { createdAt: message.created_at } : {}),
      })
      continue
    }

    if (message.role !== "assistant") continue
    const currentItem = items.at(-1)
    if (!currentItem) continue
    currentItem.assistantMessage = currentItem.assistantMessage
      ? `${currentItem.assistantMessage}\n${content}`
      : content
  }

  return items
    .map((item) => ({
      ...item,
      assistantMessage: item.assistantMessage ?? awaitingAssistantLabel,
    }))
    .slice(-MAX_VISIBLE_MESSAGE_EXCHANGES)
}
