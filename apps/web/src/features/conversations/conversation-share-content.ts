import {
  conversationShareSnapshotSchema,
  uuidSchema,
  type ConversationShareSnapshot,
} from "@linksense/shared"

import { conversationDetailSchema, type Conversation } from "@/api/contracts"
import { getConversationMessageDisplayText } from "@/features/conversations/conversation-message-display"

export function captureConversationShareSnapshot(
  conversation: Conversation
): ConversationShareSnapshot {
  const messages = (conversation.messages ?? []).filter(
    (message) => uuidSchema.safeParse(message.id).success
  )
  // Use only files already attached to the visible messages. Staged uploads and
  // results belonging to unloaded history are outside this sharing session.
  const files = new Map(
    messages.flatMap((message) =>
      [...(message.attachments ?? []), ...(message.artifacts ?? [])].map(
        (file) => [file.id, file] as const
      )
    )
  )
  const messageTurnIds = new Set(messages.map((message) => message.turn_id))
  return conversationShareSnapshotSchema.parse({
    conversation,
    messages: messages.map((message) => ({
      ...message,
      content_text: getConversationMessageDisplayText(message),
    })),
    turns: (conversation.turns ?? []).filter((turn) =>
      messageTurnIds.has(turn.id)
    ),
    files: [...files.values()].map((file) => ({
      ...file,
      filename: file.name,
      size_bytes: file.size,
    })),
    activities: [],
    events: [],
    turn_file_change_counts: conversation.turn_file_change_counts ?? {},
  })
}

export function projectConversationForSharing(
  conversation: Conversation
): Conversation {
  return projectConversationShareSnapshot(
    captureConversationShareSnapshot(conversation)
  )
}

export function projectConversationShareSnapshot(
  snapshot: ConversationShareSnapshot
): Conversation {
  const projected = conversationDetailSchema.parse({
    ...snapshot,
    conversation: { ...snapshot.conversation, project_id: null },
  })
  return {
    ...projected,
    messages: projected.messages?.map((message) => ({
      ...message,
      created_at: undefined,
    })),
    // A snapshot has no live execution to follow. Keep completed timing only.
    turns: projected.turns?.filter((turn) => turn.status !== "running"),
    running_turn: null,
  }
}
