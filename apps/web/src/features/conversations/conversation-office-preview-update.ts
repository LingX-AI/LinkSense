import type { Conversation, ConversationFile } from "@/api/contracts"
import { resolveConversationDeliveryFiles } from "@/features/conversations/conversation-delivery-references"
import { parseAssistantProposedPlanBlock } from "@/features/conversations/assistant-message-content"
import { getConversationFilePreviewKind } from "@/features/conversations/conversation-file-preview"

/**
 * Flattens the API's message-owned artifact projection. Keeping this in one
 * place makes preview-update detection independent of how an artifact card is
 * rendered in the conversation timeline.
 */
export function getConversationFiles(
  conversation: Conversation
): ConversationFile[] {
  const files = [
    ...(conversation.attachments ?? []),
    ...(conversation.artifacts ?? []),
    ...(conversation.messages ?? []).flatMap((message) => [
      ...(message.attachments ?? []),
      ...(message.artifacts ?? []),
    ]),
  ]
  return [...new Map(files.map((file) => [file.id, file])).values()]
}

export function findFirstCompletedTurnPreviewFile(
  conversation: Conversation,
  turnId: string
): ConversationFile | null {
  if (
    conversation.turns?.find((turn) => turn.id === turnId)?.status !==
    "completed"
  ) {
    return null
  }

  const messages = (conversation.messages ?? []).filter(
    (message) =>
      message.role === "assistant" &&
      message.turn_id === turnId &&
      !message.streaming &&
      message.output_kind !== "plan" &&
      !parseAssistantProposedPlanBlock(message.content)
  )
  const finalMessage =
    messages.findLast((message) => message.phase === "final_answer") ??
    messages.findLast((message) => !message.phase)
  if (!finalMessage) return null

  // Message artifact lists group every registered file from a turn for display;
  // only rendered references in the final reply establish delivery intent.
  const files = getConversationFiles(conversation).filter(
    (file) => file.turn_id === turnId
  )
  for (const file of resolveConversationDeliveryFiles(
    finalMessage.content,
    files
  )) {
    if (
      file?.kind === "artifact" &&
      file.download_available &&
      getConversationFilePreviewKind(file) !== null
    ) {
      return file
    }
  }
  return null
}

export function findUpdatedOfficePreviewFile({
  sourceFile,
  knownFileIds,
  files,
}: Readonly<{
  sourceFile: ConversationFile
  knownFileIds: readonly string[]
  files: readonly ConversationFile[]
}>): ConversationFile | null {
  // Keep the historical function name for callers, but allow an already-open
  // read-only preview (code, PDF, media, etc.) to offer the same replacement
  // affordance as Office files after an agent writes a compatible artifact.
  const sourceKind = getConversationFilePreviewKind(sourceFile)
  if (!sourceKind) return null

  const known = new Set(knownFileIds)
  const candidates = files.filter(
    (file) =>
      file.id !== sourceFile.id &&
      !known.has(file.id) &&
      file.kind === "artifact" &&
      file.download_available &&
      getConversationFilePreviewKind(file) === sourceKind
  )

  // The detail endpoint orders files by creation time. Keeping the last match
  // gives the user the newest version if an agent registered more than one
  // intermediate artifact in the same turn.
  return candidates.at(-1) ?? null
}
