import { getNativeCodexPayload, type ConversationEvent } from "@/api/contracts"

export type ReasoningActivityContent = {
  itemId: string
  content: string
  createdAt: string
  sequence: number
  running: boolean
}

function reasoningItemId(event: ConversationEvent): string | null {
  const native = getNativeCodexPayload(event)
  if (native?.method === "item/reasoning/textDelta") return native.params.itemId
  if (
    (native?.method === "item/started" ||
      native?.method === "item/completed") &&
    native.params.item.type === "reasoning"
  )
    return native.params.item.id
  return null
}

/**
 * Retain pending text deltas independently of the bounded tool timeline. Keeping
 * their sequence lets a refreshed history overlap the stream without repeating
 * text. A completed native snapshot replaces its deltas; the first event keeps
 * the stage's original position in the timeline.
 */
export function appendReasoningContentEvent(
  current: ConversationEvent[],
  event: ConversationEvent
): ConversationEvent[] {
  const itemId = reasoningItemId(event)
  if (itemId === null) return current
  const native = getNativeCodexPayload(event)
  // Ordered deltas cannot be covered by an earlier completion. Check only
  // envelope metadata in this hot path, without inspecting every retained body.
  if (
    native?.method !== "item/completed" &&
    current.every(
      (value) => value.id !== event.id && value.sequence_no < event.sequence_no
    )
  )
    return [...current, event]
  const matchesItem = (value: ConversationEvent) =>
    value.turn_id === event.turn_id && reasoningItemId(value) === itemId
  if (
    current.some(
      (value) =>
        value.id === event.id ||
        (matchesItem(value) &&
          value.sequence_no >= event.sequence_no &&
          getNativeCodexPayload(value)?.method === "item/completed")
    )
  )
    return current
  if (getNativeCodexPayload(event)?.method !== "item/completed")
    return [...current, event]
  const first = current.find(matchesItem)
  return [
    ...current.filter((value) => !matchesItem(value)),
    ...(first && first.sequence_no < event.sequence_no ? [first] : []),
    event,
  ]
}

/** A terminal turn alone does not prove its independently fetched history is current. */
export function areReasoningContentEventsReconciled(
  liveEvents: readonly ConversationEvent[],
  persistedEvents: readonly ConversationEvent[]
): boolean {
  return liveEvents.every(
    reasoningContentReconciliationPredicate(persistedEvents)
  )
}

/** Release overlap on every detail refresh, including while the turn is running. */
export function removeReconciledReasoningContentEvents(
  liveEvents: ConversationEvent[],
  persistedEvents: readonly ConversationEvent[]
): ConversationEvent[] {
  if (liveEvents.length === 0 || persistedEvents.length === 0) return liveEvents
  const reconciled = reasoningContentReconciliationPredicate(persistedEvents)
  const remaining = liveEvents.filter((event) => !reconciled(event))
  return remaining.length === liveEvents.length ? liveEvents : remaining
}

function reasoningContentReconciliationPredicate(
  persistedEvents: readonly ConversationEvent[]
): (event: ConversationEvent) => boolean {
  const persistedIds = new Set<string>()
  const completedSequences = new Map<string, number>()
  for (const event of persistedEvents) {
    const itemId = reasoningItemId(event)
    if (itemId === null) continue
    const key = `${event.turn_id}\u0000${itemId}`
    persistedIds.add(`${key}\u0000${event.id}`)
    if (getNativeCodexPayload(event)?.method === "item/completed") {
      completedSequences.set(
        key,
        Math.max(completedSequences.get(key) ?? -1, event.sequence_no)
      )
    }
  }
  return (event) => {
    const itemId = reasoningItemId(event)
    if (itemId === null) return true
    const key = `${event.turn_id}\u0000${itemId}`
    return (
      persistedIds.has(`${key}\u0000${event.id}`) ||
      (completedSequences.get(key) ?? -1) >= event.sequence_no
    )
  }
}

/** Full native text only: summaries never stand in for a missing body. */
export function selectReasoningActivities(
  turnId: string,
  liveEvents: readonly ConversationEvent[],
  events: readonly ConversationEvent[]
): ReasoningActivityContent[] {
  const items = new Map<
    string,
    ReasoningActivityContent & { parts: Map<number, string> }
  >()
  const seen = new Set<number>()
  for (const event of [...events, ...liveEvents].sort(
    (left, right) => left.sequence_no - right.sequence_no
  )) {
    if (event.turn_id !== turnId || seen.has(event.sequence_no)) continue
    const itemId = reasoningItemId(event)
    if (itemId === null) continue
    seen.add(event.sequence_no)
    const native = getNativeCodexPayload(event)
    const item = items.get(itemId) ?? {
      itemId,
      content: "",
      createdAt: event.created_at,
      sequence: event.sequence_no,
      running: true,
      parts: new Map<number, string>(),
    }
    if (native?.method === "item/reasoning/textDelta") {
      if (!item.running) continue
      const { contentIndex, delta } = native.params
      item.parts.set(
        contentIndex,
        `${item.parts.get(contentIndex) ?? ""}${delta}`
      )
    } else if (
      (native?.method === "item/started" ||
        native?.method === "item/completed") &&
      native.params.item.type === "reasoning"
    ) {
      item.parts = new Map(
        (native.params.item.content ?? []).map((part, index) => [index, part])
      )
      item.running = native.method !== "item/completed"
    }
    items.set(itemId, item)
  }
  // Empty reasoning items still separate adjacent tool stages when hidden.
  return [...items.values()]
    .map(({ parts, ...item }) => ({
      ...item,
      content: [...parts]
        .sort(([left], [right]) => left - right)
        .map(([, text]) => text)
        .join("\n\n"),
    }))
    .sort((left, right) => left.sequence - right.sequence)
}
