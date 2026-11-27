import type { QueryClient } from "@tanstack/react-query"
import dayjs from "dayjs"
import type { Conversation } from "@/api/contracts"
import {
  getPendingConversationTurnSubmission,
  setPendingConversationTurnSubmission,
  type PendingConversationTurnSubmission,
} from "./conversation-pending-turn-submission"
import {
  bindPendingConversationTurn,
  markConversationExecutionPending,
} from "./conversation-pending-execution"

export function restoreStartingConversationTurn(
  queryClient: QueryClient,
  conversation: Conversation
): void {
  const start = conversation.starting_turn
  const pending = getPendingConversationTurnSubmission(
    queryClient,
    conversation.id
  )
  if (pending) {
    const reconciled = reconcileStartingConversationTurn(conversation, pending)
    if (reconciled !== pending && reconciled.turnId) {
      setPendingConversationTurnSubmission(
        queryClient,
        conversation.id,
        reconciled
      )
      markConversationExecutionPending(queryClient, conversation.id)
      bindPendingConversationTurn(
        queryClient,
        conversation.id,
        reconciled.turnId
      )
    }
    return
  }
  if (!start || conversation.turns?.some((turn) => turn.id === start.turn_id))
    return
  if (start.task_kind !== "compact") {
    setPendingConversationTurnSubmission(queryClient, conversation.id, {
      conversationId: conversation.id,
      idempotencyKey: start.idempotency_key ?? "",
      afterEventSequence: (conversation.events ?? []).reduce(
        (sequence, event) =>
          dayjs(event.created_at).isBefore(start.created_at)
            ? Math.max(sequence, event.sequence_no)
            : sequence,
        0
      ),
      turnId: start.turn_id,
      status: "starting",
      message: {
        id: `starting-${start.turn_id}`,
        role: "user",
        content: start.input_text,
        turn_id: start.turn_id,
        created_at: start.created_at,
        display: start.message_display,
        attachments: start.attachments.map((file) => ({
          ...file,
          download_available: false,
        })),
      },
    })
  }
  markConversationExecutionPending(queryClient, conversation.id)
  bindPendingConversationTurn(queryClient, conversation.id, start.turn_id)
}

export function reconcileStartingConversationTurn(
  conversation: Conversation | undefined,
  pending: PendingConversationTurnSubmission
): PendingConversationTurnSubmission {
  if (
    !conversation ||
    pending.conversationId !== conversation.id ||
    !pending.idempotencyKey
  )
    return pending
  const matches = (id: string, key: string | null | undefined) =>
    pending.turnId ? id === pending.turnId : key === pending.idempotencyKey
  const projected = conversation.turns?.find((turn) =>
    matches(turn.id, turn.idempotency_key)
  )
  const start = conversation.starting_turn
  const turnId =
    projected?.id ??
    (start && matches(start.turn_id, start.idempotency_key)
      ? start.turn_id
      : undefined)
  const status = projected ? "running" : "starting"
  if (
    !turnId ||
    (pending.turnId === turnId &&
      (pending.status === status || pending.status === "running"))
  )
    return pending
  return {
    ...pending,
    turnId,
    status,
    message: { ...pending.message, turn_id: turnId },
  }
}
