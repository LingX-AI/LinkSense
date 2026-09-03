import type {
  Conversation,
  ConversationFile,
  ConversationMessage,
} from "@/api/contracts"
import { projectVisibleConversationMessages } from "@/features/conversations/streaming-messages"
import type { EmbedFrameConfig } from "./config"

export type EmbedStatus =
  "waiting_for_ticket" | "authenticating" | "ready" | "failed"

export type EmbedOptimisticSubmission = Readonly<{
  id: string
  turnId: string | null
  content: string
  createdAt: string
  attachments: ConversationFile[]
}>

export function projectExternalEmbedConversation(
  conversation: Conversation,
  optimisticSubmission: EmbedOptimisticSubmission | null
): Conversation {
  const messages = (conversation.messages ?? []).map(toExternalEmbedMessageView)
  const optimisticMessage =
    optimisticSubmission &&
    !hasOptimisticMessage(messages, optimisticSubmission)
      ? optimisticSubmissionMessage(optimisticSubmission)
      : null

  return {
    ...conversation,
    selected_knowledge_base_ids: [],
    messages: projectVisibleConversationMessages(
      messages,
      [],
      optimisticMessage
    ),
  }
}

export function shouldShowEmbedOptimisticSubmission(
  conversation: Conversation | null,
  submission: EmbedOptimisticSubmission | null
) {
  if (!submission) return false
  if (!conversation) return true
  return !hasOptimisticMessage(conversation.messages ?? [], submission)
}

export function embedGateMessageKey(
  status: EmbedStatus,
  authMode: EmbedFrameConfig["auth_mode"]
) {
  if (status === "authenticating") {
    return authMode === "public"
      ? "embed.startingPublicSession"
      : "embed.authenticating"
  }
  if (status === "failed") {
    return authMode === "public"
      ? "embed.errors.publicSessionFailed"
      : "embed.errors.authenticationFailed"
  }
  return "embed.waitingForHost"
}

export function hostAuthenticationFailureError(
  message: Record<string, unknown>,
  appId: string,
  fallback: string
): string | null {
  if (
    message.type !== "linksense:host-authentication-failed" ||
    message.appId !== appId
  ) {
    return null
  }
  if (typeof message.message !== "string") return fallback
  const trimmed = message.message.trim()
  return trimmed ? trimmed.slice(0, 500) : fallback
}

function toExternalEmbedMessageView(
  message: ConversationMessage
): ConversationMessage {
  if (
    (message.selected_capabilities?.length ?? 0) === 0 &&
    (message.selected_knowledge_base_ids?.length ?? 0) === 0 &&
    (message.knowledge_citations?.length ?? 0) === 0
  ) {
    return message
  }
  return {
    ...message,
    knowledge_citations: [],
    selected_capabilities: [],
    selected_knowledge_base_ids: [],
  }
}

function optimisticSubmissionMessage(
  submission: EmbedOptimisticSubmission
): ConversationMessage {
  const id = `embed-optimistic-${submission.id}`
  return {
    id,
    client_render_key: id,
    role: "user",
    content: submission.content,
    turn_id: submission.turnId,
    created_at: submission.createdAt,
    attachments: submission.attachments,
    artifacts: [],
    knowledge_citations: [],
    selected_capabilities: [],
    selected_knowledge_base_ids: [],
  }
}

function hasOptimisticMessage(
  messages: readonly ConversationMessage[],
  submission: EmbedOptimisticSubmission
) {
  return messages.some((message) => {
    if (message.role !== "user") return false
    if (submission.turnId && message.turn_id === submission.turnId) return true
    if (!message.created_at || message.content !== submission.content) {
      return false
    }
    return Date.parse(message.created_at) >= Date.parse(submission.createdAt)
  })
}
