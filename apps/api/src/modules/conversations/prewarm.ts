import { conversationCollaborationModeSchema } from "@linksense/shared"
import { z } from "zod"

export const conversationPrewarmInputSchema = z.strictObject({
  ownerId: z.uuid(),
  conversationId: z.uuid(),
  collaborationMode: conversationCollaborationModeSchema,
  reservationRevision: z.uuid().optional(),
})

export type ConversationPrewarmInput = z.infer<typeof conversationPrewarmInputSchema>

// Match the default idle native-process lifetime. Expired reservations are
// optional preparation only; creating a task must still work without one.
export const conversationPrewarmReservationTtlMs = 15 * 60_000

export const conversationPrewarmReservationSchema = conversationPrewarmInputSchema
  .pick({ ownerId: true, conversationId: true })
  .extend({ reservationRevision: z.uuid() })

export type ConversationPrewarmReservation = z.infer<typeof conversationPrewarmReservationSchema>
