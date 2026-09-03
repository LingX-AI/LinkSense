import {
  getNativeCodexPayload,
  type Conversation,
  type ConversationEvent,
} from "@/api/contracts"

export type ConversationExecutionTransition = Readonly<{
  status: NonNullable<Conversation["execution_status"]>
  turnId: string | null
  occurredAt: string
}>

export function isTerminalConversationExecutionStatus(
  status: unknown
): status is "completed" | "failed" | "interrupted" {
  return (
    status === "completed" || status === "failed" || status === "interrupted"
  )
}

export function getConversationExecutionTransition(
  event: ConversationEvent
): ConversationExecutionTransition | null {
  const native = getNativeCodexPayload(event)
  if (native?.method === "turn/started") {
    return {
      status: "running",
      turnId: event.turn_id,
      occurredAt: event.created_at,
    }
  }
  if (native?.method === "turn/completed") {
    const status = native.params.turn.status
    if (!isTerminalConversationExecutionStatus(status)) return null
    return { status, turnId: event.turn_id, occurredAt: event.created_at }
  }

  const payload = asRecord(event.payload)
  if (event.type === "conversation.status.changed") {
    const status = payload.conversation_execution_status
    if (!isConversationExecutionStatus(status)) return null
    return { status, turnId: event.turn_id, occurredAt: event.created_at }
  }
  if (event.type === "conversation.completed") {
    return {
      status: "completed",
      turnId: event.turn_id,
      occurredAt: event.created_at,
    }
  }
  if (event.type === "conversation.interrupted") {
    return {
      status: "interrupted",
      turnId: event.turn_id,
      occurredAt: event.created_at,
    }
  }
  return null
}

export function applyConversationExecutionTransition(
  conversation: Conversation,
  transition: ConversationExecutionTransition
): Conversation {
  const activeTurn = conversation.running_turn
  if (
    isTerminalConversationExecutionStatus(transition.status) &&
    transition.turnId &&
    activeTurn?.id &&
    activeTurn.id !== transition.turnId
  ) {
    // A replayed completion for an older turn must not stop a newer turn.
    return conversation
  }

  const turnStatus = isTurnExecutionStatus(transition.status)
    ? transition.status
    : null
  const turns = turnStatus
    ? conversation.turns?.map((turn) =>
        transition.turnId && turn.id === transition.turnId
          ? {
              ...turn,
              status: turnStatus,
              ...(isTerminalConversationExecutionStatus(turnStatus)
                ? { completed_at: turn.completed_at ?? transition.occurredAt }
                : {}),
            }
          : turn
      )
    : conversation.turns
  const transitionedTurn = transition.turnId
    ? turns?.find((turn) => turn.id === transition.turnId)
    : undefined
  const runningTurn =
    transition.status === "running"
      ? (transitionedTurn ??
        (activeTurn?.id === transition.turnId ? activeTurn : null))
      : transition.turnId &&
          activeTurn?.id &&
          activeTurn.id !== transition.turnId
        ? activeTurn
        : null

  if (
    conversation.execution_status === transition.status &&
    turns === conversation.turns &&
    runningTurn === conversation.running_turn
  ) {
    return conversation
  }
  return {
    ...conversation,
    execution_status: transition.status,
    ...(turns ? { turns } : {}),
    running_turn: runningTurn,
  }
}

function isConversationExecutionStatus(
  value: unknown
): value is NonNullable<Conversation["execution_status"]> {
  return (
    value === "idle" ||
    value === "running" ||
    value === "pending" ||
    value === "completed" ||
    value === "failed" ||
    value === "interrupted"
  )
}

function isTurnExecutionStatus(
  value: NonNullable<Conversation["execution_status"]>
): value is "running" | "completed" | "failed" | "interrupted" {
  return value !== "idle" && value !== "pending"
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {}
}
