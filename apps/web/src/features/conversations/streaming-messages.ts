import type { ConversationMessage } from "@/api/contracts"
import {
  filterKnowledgeSourceMarkerDelta,
  type KnowledgeSourceMarkerFilterState,
} from "@/features/conversations/knowledge-source-markers"
import { normalizeAssistantMessageContent } from "@/features/conversations/assistant-message-content"

export type StreamingAssistantMessage = ConversationMessage & {
  item_id: string
  last_applied_sequence_no: number
  knowledge_source_marker_filter_state?: KnowledgeSourceMarkerFilterState
}

export type StreamingAssistantMessages = Record<
  string,
  StreamingAssistantMessage
>

export function removeStreamingMessageItems(
  current: StreamingAssistantMessages,
  itemIds: ReadonlySet<string>
): StreamingAssistantMessages {
  const next = { ...current }
  let changed = false
  for (const itemId of itemIds) {
    if (!(itemId in next)) continue
    delete next[itemId]
    changed = true
  }
  return changed ? next : current
}

type StreamingMessagePhaseUpdate = Readonly<{
  itemId: string
  messageId?: string
  turnId?: string | null
  phase?: "commentary" | "final_answer" | null
  outputKind?: "agent_message" | "plan"
}>

function applyMissingMetadataFromStaleUpdate(
  current: StreamingAssistantMessages,
  previous: StreamingAssistantMessage | undefined,
  update: StreamingMessagePhaseUpdate
): StreamingAssistantMessages | null {
  if (!previous) return null
  const phase = previous.phase ?? update.phase
  const outputKind = previous.output_kind ?? update.outputKind
  if (phase === previous.phase && outputKind === previous.output_kind)
    return null

  return {
    ...current,
    [update.itemId]: {
      ...previous,
      turn_id: update.turnId ?? previous.turn_id,
      phase,
      output_kind: outputKind,
      id: update.messageId ?? previous.id,
    },
  }
}

export function projectVisibleConversationMessages(
  persistedMessages: readonly ConversationMessage[],
  streamedMessages: readonly ConversationMessage[],
  optimisticMessage: ConversationMessage | null,
  persistedRenderKeys?: ReadonlyMap<string, string>
): ConversationMessage[] {
  const projectedPersistedMessages = persistedRenderKeys
    ? persistedMessages.map((message) => {
        const clientRenderKey = persistedRenderKeys.get(message.id)
        return clientRenderKey
          ? { ...message, client_render_key: clientRenderKey }
          : message
      })
    : [...persistedMessages]
  const projectedMessages = [...projectedPersistedMessages, ...streamedMessages]
  if (!optimisticMessage) return projectedMessages

  const sameTurnMessageIndex = optimisticMessage.turn_id
    ? projectedMessages.findIndex(
        (message) => message.turn_id === optimisticMessage.turn_id
      )
    : -1
  // A newly admitted turn can emit its first assistant delta before the
  // refreshed conversation contains the persisted user message. Keep the
  // optimistic message at the persisted/streaming boundary until its turn is
  // known, then place it before every item already associated with that turn.
  const insertionIndex =
    sameTurnMessageIndex >= 0
      ? sameTurnMessageIndex
      : Math.min(projectedPersistedMessages.length, projectedMessages.length)

  return [
    ...projectedMessages.slice(0, insertionIndex),
    optimisticMessage,
    ...projectedMessages.slice(insertionIndex),
  ]
}

export function appendStreamingMessageDelta(
  current: StreamingAssistantMessages,
  update: {
    itemId: string
    messageId?: string
    turnId?: string | null
    phase?: "commentary" | "final_answer" | null
    outputKind?: "agent_message" | "plan"
    delta: string
    createdAt: string
    sequence: number
  }
): StreamingAssistantMessages {
  const previous = current[update.itemId]
  const lastAppliedSequence =
    previous?.last_applied_sequence_no ?? previous?.event_sequence_no
  if (
    lastAppliedSequence !== undefined &&
    update.sequence <= lastAppliedSequence
  ) {
    return (
      applyMissingMetadataFromStaleUpdate(current, previous, update) ?? current
    )
  }
  const filtered = filterKnowledgeSourceMarkerDelta(
    update.delta,
    previous?.knowledge_source_marker_filter_state
  )
  const content = normalizeAssistantMessageContent(
    `${previous?.content ?? ""}${filtered.text}`
  )
  return {
    ...current,
    [update.itemId]: {
      id: update.messageId ?? previous?.id ?? `streaming-${update.itemId}`,
      role: "assistant",
      // Some Codex lifecycle and delta events omit the turn after the item has
      // already been associated with one. Keep that established authorization
      // scope instead of temporarily making live knowledge assets unreadable.
      turn_id: update.turnId ?? previous?.turn_id,
      item_id: update.itemId,
      phase: update.phase ?? previous?.phase,
      output_kind: update.outputKind ?? previous?.output_kind,
      content,
      created_at: previous?.created_at ?? update.createdAt,
      event_sequence_no: previous?.event_sequence_no ?? update.sequence,
      last_applied_sequence_no: update.sequence,
      streaming: true,
      knowledge_source_marker_filter_state: filtered.state,
    },
  }
}

export function applyStreamingMessageLifecycle(
  current: StreamingAssistantMessages,
  update: {
    itemId: string
    messageId?: string
    turnId?: string | null
    phase?: "commentary" | "final_answer" | null
    outputKind?: "agent_message" | "plan"
    text?: string
    createdAt: string
    sequence: number
    completed: boolean
  }
): StreamingAssistantMessages {
  const previous = current[update.itemId]
  const lastAppliedSequence =
    previous?.last_applied_sequence_no ?? previous?.event_sequence_no
  if (
    lastAppliedSequence !== undefined &&
    update.sequence <= lastAppliedSequence
  ) {
    return (
      applyMissingMetadataFromStaleUpdate(current, previous, update) ?? current
    )
  }
  const completedText =
    update.completed && update.text !== undefined
      ? filterKnowledgeSourceMarkerDelta(update.text)
      : null
  const initialText = filterKnowledgeSourceMarkerDelta(update.text ?? "")
  const content = normalizeAssistantMessageContent(
    completedText?.text ?? (previous?.content || initialText.text)
  )
  return {
    ...current,
    [update.itemId]: {
      id: update.messageId ?? previous?.id ?? `streaming-${update.itemId}`,
      role: "assistant",
      turn_id: update.turnId ?? previous?.turn_id,
      item_id: update.itemId,
      phase: update.phase ?? previous?.phase,
      output_kind: update.outputKind ?? previous?.output_kind,
      content,
      created_at: previous?.created_at ?? update.createdAt,
      event_sequence_no: previous?.event_sequence_no ?? update.sequence,
      last_applied_sequence_no: update.sequence,
      streaming: !update.completed,
      knowledge_source_marker_filter_state:
        completedText?.state ??
        previous?.knowledge_source_marker_filter_state ??
        initialText.state,
    },
  }
}

export function completeLegacyStreamingMessage(
  current: StreamingAssistantMessages,
  update: {
    itemId?: string
    messageId?: string
    turnId?: string | null
    createdAt: string
    sequence: number
  }
): StreamingAssistantMessages {
  const itemId =
    (update.itemId && current[update.itemId] ? update.itemId : undefined) ??
    Object.entries(current)
      .filter(
        ([, message]) =>
          message.streaming === true && message.turn_id === update.turnId
      )
      .sort(
        ([, left], [, right]) =>
          left.last_applied_sequence_no - right.last_applied_sequence_no
      )
      .at(-1)?.[0]
  if (!itemId || !current[itemId]) return current

  return applyStreamingMessageLifecycle(current, {
    itemId,
    messageId: update.messageId,
    turnId: update.turnId,
    createdAt: update.createdAt,
    sequence: update.sequence,
    completed: true,
  })
}

export function removePersistedStreamingMessages(
  current: StreamingAssistantMessages,
  persistedMessageIds: ReadonlySet<string>,
  persistedItemIds: ReadonlySet<string>
): StreamingAssistantMessages {
  let next: StreamingAssistantMessages | null = null

  for (const [itemId, message] of Object.entries(current)) {
    if (!persistedMessageIds.has(message.id) && !persistedItemIds.has(itemId)) {
      continue
    }
    next ??= { ...current }
    delete next[itemId]
  }

  return next ?? current
}
