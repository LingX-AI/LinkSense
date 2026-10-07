import { fromMarkdown } from "mdast-util-from-markdown"

import type { Conversation, ConversationFile } from "@/api/contracts"
import { getInlineArtifactId } from "@/features/conversations/assistant-markdown-image-utils"
import { parseAssistantProposedPlanBlock } from "@/features/conversations/assistant-message-content"
import { getConversationFilePreviewKind } from "@/features/conversations/conversation-file-preview"

type MarkdownNode = ReturnType<typeof fromMarkdown>["children"][number]

function collectDeliveryUrls(content: string): string[] {
  const tree = fromMarkdown(content)
  const definitions = new Map<string, string>()
  const collectDefinitions = (nodes: readonly MarkdownNode[]): void => {
    for (const node of nodes) {
      if (node.type === "definition" && !definitions.has(node.identifier)) {
        definitions.set(node.identifier, node.url)
      }
      if ("children" in node) collectDefinitions(node.children)
    }
  }
  collectDefinitions(tree.children)

  const urls: string[] = []
  const visit = (nodes: readonly MarkdownNode[]): void => {
    for (const node of nodes) {
      if (node.type === "image" || node.type === "link") {
        urls.push(node.url)
      } else if (
        node.type === "imageReference" ||
        node.type === "linkReference"
      ) {
        const url = definitions.get(node.identifier)
        if (url) urls.push(url)
      }
      if ("children" in node) {
        visit(node.children)
      }
    }
  }
  visit(tree.children)
  return urls
}

function getLocalDeliveryFilename(url: string): string | null {
  if (url.startsWith("//")) return null
  const protocol = /^([a-z][a-z0-9+.-]*):/iu.exec(url)?.[1]?.toLowerCase()
  if (protocol && protocol !== "file" && protocol !== "sandbox") return null

  try {
    if (protocol === "file" && new URL(url).hostname) return null
    const path = decodeURIComponent(url.split(/[?#]/u, 1)[0] ?? "")
    return path.split(/[\\/]/u).at(-1) || null
  } catch {
    return null
  }
}

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
  const filesById = new Map(files.map((file) => [file.id.toLowerCase(), file]))
  const filesByName = new Map<string, ConversationFile | null>()
  for (const file of files) {
    filesByName.set(file.name, filesByName.has(file.name) ? null : file)
  }
  for (const url of collectDeliveryUrls(finalMessage.content)) {
    const artifactId = getInlineArtifactId(url)
    const filename = artifactId ? null : getLocalDeliveryFilename(url)
    const file = artifactId
      ? filesById.get(artifactId)
      : filename
        ? filesByName.get(filename)
        : null
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
