import { Prisma } from "../../generated/prisma/client.js";
import { AppError } from "../../lib/errors.js";

/** Call after locking the affected conversation rows, before changing their cwd. */
export async function assertProjectTasksIdle(tx: Prisma.TransactionClient, conversationIds: string[]): Promise<void> {
  if (conversationIds.length === 0) return;
  const ids = Prisma.sql`ARRAY[${Prisma.join(conversationIds)}]::uuid[]`;
  const [state] = await tx.$queryRaw<Array<{ busy: boolean }>>(Prisma.sql`
    SELECT (
      EXISTS (SELECT 1 FROM conversation_turns WHERE conversation_id = ANY(${ids}) AND status = 'running')
      OR EXISTS (SELECT 1 FROM conversation_turn_start_intents WHERE conversation_id = ANY(${ids}))
      OR EXISTS (SELECT 1 FROM pending_requests WHERE conversation_id = ANY(${ids}))
      OR EXISTS (SELECT 1 FROM conversation_goals WHERE conversation_id = ANY(${ids}) AND status <> 'complete')
      OR EXISTS (SELECT 1 FROM conversation_plan_reviews WHERE conversation_id = ANY(${ids}) AND status IN ('preparing', 'pending'))
    ) AS busy
  `);
  if (state?.busy !== false) throw new AppError("PROJECT_TASK_ACTIVE");
}
