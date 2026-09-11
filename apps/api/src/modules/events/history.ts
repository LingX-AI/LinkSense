import { Prisma, type ConversationEvent, type PrismaClient } from "../../generated/prisma/client.js";

type HistoryRow = (ConversationEvent | { id: null }) & { confirmedSequence: bigint };

export async function readConversationEventHistory(
  prisma: PrismaClient,
  ownerId: string,
  conversationId: string,
  input: {
    afterSequence: bigint;
    limit: number;
    activeStartIntentStatuses: readonly string[];
  },
): Promise<{ rows: ConversationEvent[]; confirmedSequence: bigint }> {
  // A single SELECT gives the branch, preparation intents, events and filtered
  // gap confirmation the same PostgreSQL snapshot without a read transaction
  // and its per-query round trips. EXISTS also avoids loading every turn id.
  const result = await prisma.$queryRaw<HistoryRow[]>(Prisma.sql`
    SELECT
      event.id,
      event.conversation_id AS "conversationId",
      event.turn_id AS "turnId",
      event.sequence_no AS "sequenceNo",
      event.event_type AS "eventType",
      event.visibility,
      event.payload_json AS "payloadJson",
      event.sse_event_id AS "sseEventId",
      event.created_at AS "createdAt",
      CASE WHEN event.id IS NULL THEN GREATEST(
        ${input.afterSequence}::bigint,
        COALESCE((
          SELECT sequence_no FROM conversation_events
          WHERE conversation_id = conversation.id
          ORDER BY sequence_no DESC LIMIT 1
        ), ${input.afterSequence}::bigint)
      ) ELSE event.sequence_no END AS "confirmedSequence"
    FROM conversations AS conversation
    LEFT JOIN LATERAL (
      SELECT candidate.*
      FROM conversation_events AS candidate
      WHERE candidate.conversation_id = conversation.id
        AND candidate.sequence_no > ${input.afterSequence}::bigint
        AND candidate.visibility IN ('user_visible', 'user_collapsed')
        AND (
          EXISTS (
            SELECT 1 FROM conversation_turns AS turn
            WHERE turn.id = candidate.turn_id
              AND turn.conversation_id = conversation.id
              AND turn.codex_thread_id = NULLIF(conversation.codex_thread_id, '')
          )
          OR (
            candidate.event_type IN ('item/started', 'item/completed')
            AND candidate.payload_json #> '{params,item,type}' = '"contextCompaction"'::jsonb
            AND EXISTS (
              SELECT 1 FROM conversation_turn_start_intents AS intent
              WHERE intent.projection_turn_id = candidate.turn_id
                AND intent.conversation_id = conversation.id
                AND intent.owner_id = ${ownerId}::uuid
                AND intent.runner_status IN (${Prisma.join(input.activeStartIntentStatuses)})
            )
          )
          OR (
            candidate.turn_id IS NULL
            AND (
              candidate.event_type NOT IN ('thread/name/updated', 'conversation.title.updated')
              OR (
                candidate.event_type = 'thread/name/updated'
                AND candidate.payload_json #> '{params,threadId}' = to_jsonb(NULLIF(conversation.codex_thread_id, ''))
              )
              OR (
                candidate.event_type = 'conversation.title.updated'
                AND candidate.payload_json -> 'thread_id' = to_jsonb(NULLIF(conversation.codex_thread_id, ''))
              )
            )
          )
        )
      ORDER BY candidate.sequence_no ASC
      LIMIT ${input.limit + 1}
    ) AS event ON TRUE
    WHERE conversation.id = ${conversationId}::uuid
      AND conversation.owner_id = ${ownerId}::uuid
    ORDER BY event.sequence_no ASC
  `);
  return {
    rows: result.filter((row): row is ConversationEvent & { confirmedSequence: bigint } => row.id !== null),
    confirmedSequence: result.at(-1)?.confirmedSequence ?? input.afterSequence,
  };
}
