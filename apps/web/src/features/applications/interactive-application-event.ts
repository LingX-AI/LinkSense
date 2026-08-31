import { z } from "zod"

import type { ConversationEvent } from "@/api/contracts"

export function interactiveCustomEvent(event: ConversationEvent) {
  if (event.type !== "linksense/application/custom-event") return null
  const payload = z
    .strictObject({
      schema_version: z.literal(1),
      source: z.literal("linksense_runner"),
      method: z.literal("linksense/application/custom-event"),
      params: z
        .strictObject({
          eventId: z.string().uuid(),
          name: z.string().min(1).max(120),
          eventSchemaVersion: z.number().int().positive(),
          payload: z.unknown(),
        })
        .passthrough(),
    })
    .safeParse(event.payload)
  if (!payload.success) return null
  return {
    id: payload.data.params.eventId,
    name: payload.data.params.name,
    schema_version: payload.data.params.eventSchemaVersion,
    payload: payload.data.params.payload,
    turn_id: event.turn_id,
    sequence: event.sequence_no,
    created_at: event.created_at,
  }
}
