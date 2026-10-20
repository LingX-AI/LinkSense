import { Prisma } from "../../generated/prisma/client.js";

export function buildReasoningEventsQuery(
  conversationId: string,
  turnIds: readonly string[],
): Prisma.Sql {
  const turnIdSql = Prisma.join(
    turnIds.map((id) => Prisma.sql`CAST(${id} AS uuid)`),
  );
  // A delta is superseded only by a later completion of the same turn/item.
  // Keep all completion visibilities, matching the stored-event projection.
  return Prisma.sql`
    WITH completed_reasoning AS MATERIALIZED (
      SELECT completed.turn_id,
        completed.payload_json #>> '{params,item,id}' AS item_id,
        MAX(completed.sequence_no) AS sequence_no
      FROM conversation_events AS completed
      WHERE completed.conversation_id = CAST(${conversationId} AS uuid)
        AND completed.turn_id IN (${turnIdSql})
        AND completed.event_type = 'item/completed'
        AND completed.payload_json #>> '{params,item,type}' = 'reasoning'
      GROUP BY completed.turn_id, completed.payload_json #>> '{params,item,id}'
    )
    SELECT event.id, event.conversation_id AS "conversationId",
      event.turn_id AS "turnId", event.sequence_no AS "sequenceNo",
      event.event_type AS "eventType", event.visibility,
      event.payload_json AS "payloadJson", event.sse_event_id AS "sseEventId",
      event.created_at AS "createdAt"
    FROM conversation_events AS event
    LEFT JOIN completed_reasoning AS completed
      ON completed.turn_id = event.turn_id
      AND completed.item_id = event.payload_json #>> '{params,itemId}'
    WHERE event.conversation_id = CAST(${conversationId} AS uuid)
      AND event.turn_id IN (${turnIdSql})
      AND event.visibility IN ('user_visible', 'user_collapsed')
      AND (
        (event.event_type IN ('item/started', 'item/completed')
          AND event.payload_json #>> '{params,item,type}' = 'reasoning')
        OR (event.event_type = 'item/reasoning/textDelta'
          AND (completed.sequence_no IS NULL OR completed.sequence_no <= event.sequence_no))
      )
    ORDER BY event.sequence_no ASC
  `;
}
