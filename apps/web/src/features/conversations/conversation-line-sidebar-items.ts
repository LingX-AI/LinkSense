import type { ConversationHistoryIndexItem } from "@linksense/shared"
import type { ConversationMessage } from "@/api/contracts"
import type { ConversationLineSidebarItem } from "@/features/conversations/conversation-line-sidebar"
import { getConversationMessageDisplayText } from "@/features/conversations/conversation-message-display"
import { stripKnowledgeSourceMarkers } from "@/features/conversations/knowledge-source-markers"

const MAX_PREVIEW_CHARACTERS = 400

export function buildConversationLineSidebarItems(
  messages: readonly ConversationMessage[],
  awaitingAssistantLabel: string,
  navigation?: {
    index: readonly ConversationHistoryIndexItem[]
    unloadedLabel: (ordinal: number) => string
    unloadedPreview: string
  }
): ConversationLineSidebarItem[] {
  const items: ConversationLineSidebarItem[] = []
  for (const message of messages) {
    if (message.usage_type === "steer_current_turn") continue
    const display = getConversationMessageDisplayText(message)
    const content = (
      message.role === "assistant"
        ? stripKnowledgeSourceMarkers(display)
        : display
    )
      .trim()
      .slice(0, MAX_PREVIEW_CHARACTERS)
    if (!content) continue
    if (message.role === "user") {
      items.push({
        id: message.id,
        userMessage: content,
        ...(message.created_at ? { createdAt: message.created_at } : {}),
      })
    } else if (message.role === "assistant") {
      const item = items.at(-1)
      if (item)
        item.assistantMessage = (
          item.assistantMessage
            ? `${item.assistantMessage}\n${content}`
            : content
        ).slice(0, MAX_PREVIEW_CHARACTERS)
    }
  }
  const loaded = items.map((item) => ({
    ...item,
    assistantMessage: item.assistantMessage ?? awaitingAssistantLabel,
  }))
  if (!navigation) return loaded
  const byId = new Map(loaded.map((item) => [item.id, item]))
  let ordinal = 0
  const indexed: ConversationLineSidebarItem[] = navigation.index.flatMap(
    (item) => {
      const id = item.message_id
      if (id === null) return []
      ordinal += 1
      return [
        byId.get(id) ?? {
          id,
          userMessage: navigation.unloadedLabel(ordinal),
          assistantMessage: navigation.unloadedPreview,
          createdAt: item.created_at,
        },
      ]
    }
  )
  const indexedIds = new Set(indexed.map((item) => item.id))
  // Live/optimistic messages appear immediately, before the index is refreshed.
  return [...indexed, ...loaded.filter((item) => !indexedIds.has(item.id))]
}
