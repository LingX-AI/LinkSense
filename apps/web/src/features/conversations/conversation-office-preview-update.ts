import type { Conversation, ConversationFile } from "@/api/contracts"
import { getConversationFilePreviewKind } from "@/features/conversations/conversation-file-preview"

/**
 * Flattens the API's message-owned artifact projection. Keeping this in one
 * place makes preview-update detection independent of how an artifact card is
 * rendered in the conversation timeline.
 */
export function getConversationFiles(conversation: Conversation) {
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

  return getConversationFiles(conversation).reduce<ConversationFile | null>(
    (first, file) => {
      if (
        file.kind !== "artifact" ||
        file.turn_id !== turnId ||
        !file.download_available ||
        getConversationFilePreviewKind(file) === null
      ) {
        return first
      }
      if (
        !first ||
        (first.created_at &&
          file.created_at &&
          file.created_at < first.created_at)
      ) {
        return file
      }
      return first
    },
    null
  )
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
