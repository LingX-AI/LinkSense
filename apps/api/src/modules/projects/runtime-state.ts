import { Prisma } from "../../generated/prisma/client.js";
import { AppError } from "../../lib/errors.js";

/** Caller holds the project row lock, including when all its developer tasks were deleted. */
export async function assertProjectHasNoApplicationSources(tx: Prisma.TransactionClient, ownerId: string, projectId: string): Promise<void> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT id FROM application_developments WHERE owner_id = ${ownerId}::uuid AND project_id = ${projectId}::uuid LIMIT 1
  `);
  if (rows.length) throw new AppError("APPLICATION_DEVELOPMENT_WORKSPACE_BOUND");
}

/** Call after locking the affected conversation rows, before changing their cwd. */
export async function assertProjectTasksIdle(tx: Prisma.TransactionClient, conversationIds: string[]): Promise<void> {
  if (conversationIds.length === 0) return;
  const ids = Prisma.sql`ARRAY[${Prisma.join(conversationIds)}]::uuid[]`;
  const [state] = await tx.$queryRaw<Array<{ busy: boolean; development: boolean }>>(Prisma.sql`
    SELECT (
      EXISTS (SELECT 1 FROM conversation_turns WHERE conversation_id = ANY(${ids}) AND status = 'running')
      OR EXISTS (SELECT 1 FROM conversation_turn_start_intents WHERE conversation_id = ANY(${ids}))
      OR EXISTS (SELECT 1 FROM pending_requests WHERE conversation_id = ANY(${ids}))
      OR EXISTS (SELECT 1 FROM conversation_goals WHERE conversation_id = ANY(${ids}) AND status <> 'complete')
      OR EXISTS (SELECT 1 FROM conversation_plan_reviews WHERE conversation_id = ANY(${ids}) AND status IN ('preparing', 'pending'))
    ) AS busy,
    EXISTS (SELECT 1 FROM application_developments WHERE conversation_id = ANY(${ids})) AS development
  `);
  if (state?.busy !== false) throw new AppError("PROJECT_TASK_ACTIVE");
  if (state.development) throw new AppError("APPLICATION_DEVELOPMENT_WORKSPACE_BOUND");
}
