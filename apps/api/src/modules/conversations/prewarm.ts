import { conversationCollaborationModeSchema } from "@linksense/shared"
import { z } from "zod"

export const conversationPrewarmInputSchema = z.strictObject({
  ownerId: z.uuid(),
  conversationId: z.uuid(),
  collaborationMode: conversationCollaborationModeSchema,
  reservationRevision: z.uuid().optional(),
  projectId: z.uuid().nullable().optional(),
})

export type ConversationPrewarmInput = z.infer<typeof conversationPrewarmInputSchema>

// Match the default idle native-process lifetime. Expired reservations are
// optional preparation only; creating a task must still work without one.
export const conversationPrewarmReservationTtlMs = 15 * 60_000

export const conversationPrewarmReservationSchema = conversationPrewarmInputSchema
  .pick({ ownerId: true, conversationId: true })
  .extend({
    reservationRevision: z.uuid(),
    projectId: z.uuid().nullable().optional(),
    collaborationMode: conversationCollaborationModeSchema.optional(),
  })

export type ConversationPrewarmReservation = z.infer<typeof conversationPrewarmReservationSchema>

export function prewarmReservationScope(projectId?: string | null, mode = "default"): string {
  return `${projectId ?? "personal"}:${mode}`
}

export function prewarmReservationValue(input: ConversationPrewarmReservation): string {
  return `${input.ownerId}:${input.reservationRevision}:${prewarmReservationScope(input.projectId, input.collaborationMode)}`
}
