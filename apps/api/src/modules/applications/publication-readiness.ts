import { Prisma, type PrismaClient } from "../../generated/prisma/client.js";

/** Match publication admission, including a task whose start is still pending. */
export async function hasActiveApplicationTasks(
  prisma: Pick<PrismaClient, "$queryRaw">,
  ownerId: string,
  applicationId: string,
): Promise<boolean> {
  const active = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT c.id FROM conversations c WHERE c.owner_id = ${ownerId}::uuid AND c.application_id = ${applicationId}::uuid
      AND (EXISTS (SELECT 1 FROM conversation_turns t WHERE t.conversation_id = c.id AND t.status = 'running')
        OR EXISTS (SELECT 1 FROM conversation_turn_start_intents s WHERE s.conversation_id = c.id)) LIMIT 1
  `);
  return active.length > 0;
}
