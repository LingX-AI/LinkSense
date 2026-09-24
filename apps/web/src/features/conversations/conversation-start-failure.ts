import {
  conversationStartFailurePayloadSchema,
  regenerationIdempotencyKey,
} from "@linksense/shared"
import type { ConversationEvent } from "@/api/contracts"
import type { PendingConversationTurnSubmission } from "./conversation-pending-turn-submission"

/** Generic errors, including native reconnects, do not terminate execution. */
export function matchingConversationStartFailure(
  event: ConversationEvent,
  submission:
    | (Pick<
        PendingConversationTurnSubmission,
        "turnId" | "idempotencyKey" | "replacesTurnId" | "afterEventSequence"
      > & {
        message?: Pick<PendingConversationTurnSubmission["message"], "id">
      })
    | null
    | undefined
) {
  if (event.type !== "conversation.error" || !submission) return null
  if (
    submission.afterEventSequence !== undefined &&
    event.sequence_no <= submission.afterEventSequence
  )
    return null
  const parsed = conversationStartFailurePayloadSchema.safeParse(event.payload)
  if (!parsed.success) return null
  const failure = parsed.data.start_failure
  if (submission.turnId && submission.turnId !== failure.turn_id) return null
  // A failure may reach SSE before the HTTP receipt binds the turn ID.
  if (failure.idempotency_key !== null) {
    const requestKey =
      submission.replacesTurnId && submission.message
        ? regenerationIdempotencyKey(
            submission.message.id,
            submission.idempotencyKey
          )
        : submission.idempotencyKey
    if (requestKey !== failure.idempotency_key) return null
  } else if (submission.turnId !== failure.turn_id) {
    return null
  }
  return parsed.data
}
