import { fromMarkdown } from "mdast-util-from-markdown"
import { toString } from "mdast-util-to-string"

import { getNativeCodexPayload, type ConversationEvent } from "@/api/contracts"
import type { StreamingReasoningSummaries } from "@/features/conversations/streaming-reasoning-summaries"

export type ReasoningActivitySummary = { text: string; createdAt: string }

type ReasoningTextNode = Readonly<{
  type: string
  children?: readonly ReasoningTextNode[]
}>

/** Read a visible line from native text, without rendering markup or HTML. */
export function extractReasoningActivityText(
  content: string,
  position: "first" | "last" = "last"
): string | null {
  function readNode(node: ReasoningTextNode): string | null {
    if (
      node.children &&
      ["root", "blockquote", "list", "listItem"].includes(node.type)
    ) {
      const children =
        position === "first" ? node.children : node.children.toReversed()
      for (const child of children) {
        const line = readNode(child)
        if (line) return line
      }
      return null
    }
    const text = toString(
      node.type === "paragraph" || node.type === "heading"
        ? node.children?.map((child) =>
            child.type === "break" ? { type: "text", value: "\n" } : child
          )
        : node,
      { includeHtml: false }
    )
    const lines = text.split(/\r?\n/u)
    for (const textLine of position === "first" ? lines : lines.toReversed()) {
      const line = textLine.trim()
      // A comment opener may arrive across several streaming deltas.
      if (line && !"<!--".startsWith(line)) return line
    }
    return null
  }
  return readNode(fromMarkdown(content))
}

export function selectReasoningActivitySummary(
  turnId: string,
  liveSummaries: StreamingReasoningSummaries,
  events: readonly ConversationEvent[]
): ReasoningActivitySummary | null {
  const candidates: Array<{
    itemId: string
    content: string
    createdAt: string
    sequence: number
    summaryIndex: number
  }> = []
  const completedItems = new Map<string, number>()
  for (const event of events) {
    if (event.turn_id !== turnId) continue
    const native = getNativeCodexPayload(event)
    if (
      (native?.method !== "item/started" &&
        native?.method !== "item/completed") ||
      native.params.item.type !== "reasoning"
    )
      continue
    const { item } = native.params
    const sequence = event.sequence_no ?? 0
    if (native.method === "item/completed") {
      completedItems.set(
        item.id,
        Math.max(completedItems.get(item.id) ?? 0, sequence)
      )
    }
    candidates.push({
      itemId: item.id,
      content: (item.summary ?? []).join("\n"),
      createdAt: event.created_at,
      sequence,
      summaryIndex: 0,
    })
  }
  for (const summary of Object.values(liveSummaries)) {
    if (
      summary.turnId !== turnId ||
      (completedItems.get(summary.itemId) ?? -1) >= summary.sequence
    )
      continue
    candidates.push({
      itemId: summary.itemId,
      content: summary.text,
      createdAt: summary.createdAt,
      sequence: summary.sequence,
      summaryIndex: summary.summaryIndex,
    })
  }
  candidates.sort(
    (left, right) =>
      right.sequence - left.sequence || right.summaryIndex - left.summaryIndex
  )
  for (const candidate of candidates) {
    if ((completedItems.get(candidate.itemId) ?? -1) > candidate.sequence)
      continue
    const text = extractReasoningActivityText(candidate.content)
    if (text) return { text, createdAt: candidate.createdAt }
  }
  return null
}
