import { Prisma } from "../../generated/prisma/client.js";

/** Preview preparation alone is not a test. Include accepted and queued submissions too. */
export function developmentTestActivity(conversationId: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`(
    EXISTS (SELECT 1 FROM conversation_turns t WHERE t.conversation_id = ${conversationId})
    OR EXISTS (SELECT 1 FROM conversation_turn_start_intents i WHERE i.conversation_id = ${conversationId})
    OR EXISTS (SELECT 1 FROM pending_requests p WHERE p.conversation_id = ${conversationId})
    OR EXISTS (SELECT 1 FROM conversation_messages m WHERE m.conversation_id = ${conversationId} AND m.role = 'user')
  )`;
}
