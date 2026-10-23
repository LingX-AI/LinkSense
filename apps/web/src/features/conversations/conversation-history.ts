import type { Conversation, ConversationMessage } from "@/api/contracts"
import { getNativeCodexPayload } from "@/api/contracts"
import { resolveConversationDeliveryFiles } from "@/features/conversations/conversation-delivery-references"

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
  const referencedFileIds = new Set(
    retainedMessages.flatMap((message) =>
      resolveConversationDeliveryFiles(message.content, current.files ?? [], {
        inlineImagesOnly: true,
      }).map((file) => file.id)
    )
  )
  for (const event of eventsById.values()) {
    const native = getNativeCodexPayload(event)
    if (
      native?.method === "item/completed" &&
      native.params.item.type === "imageView" &&
      native.params.item.fileId
    ) {
      referencedFileIds.add(native.params.item.fileId)
    }
  }
  const filesById = new Map(
    (current.files ?? [])
      .filter(
        (file) =>
          (file.turn_id &&
            activeTurns.has(file.turn_id) &&
            !replacedTurns.has(file.turn_id)) ||
          referencedFileIds.has(file.id)
      )
      .map((file) => [file.id, file])
  )
  for (const file of incoming.files ?? []) filesById.set(file.id, file)
  if (direction === "older") {
    for (const file of current.files ?? []) filesById.set(file.id, file)
  }
  return {
    ...latest,
    fork_source:
      latest.fork_source ?? incoming.fork_source ?? current.fork_source,
    messages: sortMessages([...messagesById.values()]),
    files: [...filesById.values()],
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
