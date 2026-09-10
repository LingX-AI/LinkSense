import type { Conversation, ConversationMessage } from "@/api/contracts"

function sortMessages(messages: ConversationMessage[]): ConversationMessage[] {
  return messages.sort(
    (left, right) =>
      (left.sequence_no ?? Number.MAX_SAFE_INTEGER) -
      (right.sequence_no ?? Number.MAX_SAFE_INTEGER)
  )
}

/** Replace the fetched turns atomically; retain previously loaded history only. */
export function mergeConversationHistory(
  current: Conversation | undefined,
  incoming: Conversation,
  direction: "latest" | "older"
): Conversation {
  if (
    !current?.history ||
    !incoming.history ||
    current.id !== incoming.id ||
    current.history.scope_id !== incoming.history.scope_id
  ) {
    return direction === "older" && current ? current : incoming
  }
  const latest = direction === "latest" ? incoming : current
  const latestHistory =
    direction === "latest" ? incoming.history : current.history
  const activeTurns = new Set(latest.turns?.map((turn) => turn.id))
  const replacedTurns = new Set(incoming.history.turn_ids)
  const retainedMessages = (current.messages ?? []).filter(
    (message) =>
      message.turn_id &&
      activeTurns.has(message.turn_id) &&
      !replacedTurns.has(message.turn_id)
  )
  const messagesById = new Map(
    retainedMessages.map((message) => [message.id, message])
  )
  for (const message of incoming.messages ?? []) {
    if (!message.turn_id || activeTurns.has(message.turn_id))
      messagesById.set(message.id, message)
  }
  const eventsById = new Map(
    (current.events ?? [])
      .filter(
        (event) =>
          event.turn_id &&
          activeTurns.has(event.turn_id) &&
          !replacedTurns.has(event.turn_id)
      )
      .map((event) => [event.id, event])
  )
  for (const event of incoming.events ?? []) {
    if (!event.turn_id || activeTurns.has(event.turn_id))
      eventsById.set(event.id, event)
  }
  // History must never move the live SSE replay boundary or execution state.
  if (direction === "older") {
    for (const event of current.events ?? []) eventsById.set(event.id, event)
  }
  return {
    ...latest,
    fork_source:
      latest.fork_source ?? incoming.fork_source ?? current.fork_source,
    messages: sortMessages([...messagesById.values()]),
    events: [...eventsById.values()].sort(
      (a, b) => (a.sequence_no ?? 0) - (b.sequence_no ?? 0)
    ),
    history: {
      ...latestHistory,
      turn_ids: [
        ...new Set([...current.history.turn_ids, ...incoming.history.turn_ids]),
      ].filter((id) => activeTurns.has(id)),
    },
  }
}
