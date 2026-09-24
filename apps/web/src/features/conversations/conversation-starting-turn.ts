import type { QueryClient } from "@tanstack/react-query"
import dayjs from "dayjs"
import type { Conversation } from "@/api/contracts"
import {
  getPendingConversationTurnSubmission,
  setPendingConversationTurnSubmission,
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
  if (!start || conversation.turns?.some((turn) => turn.id === start.turn_id))
    return
  // A detail request may overlap a new submission. Keep its local identity
  // and stop request intact instead of replacing it with an older snapshot.
  if (getPendingConversationTurnSubmission(queryClient, conversation.id)) return
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
