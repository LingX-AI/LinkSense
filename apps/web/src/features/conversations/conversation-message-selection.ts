import { sideChatSelectionMaximumLength } from "@linksense/shared"
import type { ConversationMessage } from "@/api/contracts"

export type MessageReferenceAction = Readonly<{
  label: string
  mode: "ask" | "return"
  disabled?: boolean
  onSelect: (message: ConversationMessage, text: string) => void
}>

export function sideChatTurnInput(submission: {
  input: string
  referenceId?: string
  taskReferences?: readonly { id: string; title: string }[]
}) {
  if (submission.taskReferences?.length)
    return {
      message_display: {
        kind: "task_references" as const,
        request: submission.input,
        conversation_ids: submission.taskReferences.map((source) => source.id),
      },
    }
  return submission.referenceId
    ? {
        message_display: {
          kind: "conversation_reference" as const,
          reference_id: submission.referenceId,
          request: submission.input,
        },
      }
    : { input_text: submission.input }
}

export function selectedMessageText(
  element: HTMLElement | null,
  selection: Selection | null,
  fallback: string,
  mode: MessageReferenceAction["mode"]
): string {
  const selected =
    element &&
    selection &&
    !selection.isCollapsed &&
    element.contains(selection.anchorNode) &&
    element.contains(selection.focusNode)
      ? selection.toString().trim()
      : ""
  const text = selected || fallback.trim()
  return mode === "ask" ? text.slice(0, sideChatSelectionMaximumLength) : text
}

export function appendSideChatQuote(
  draft: string,
  text: string,
  label: string
): string {
  const quote = text
    .trim()
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n")
  return [draft, `${label}\n${quote}`].filter(Boolean).join("\n\n") + "\n\n"
}
