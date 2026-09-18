import { Prisma } from "../../generated/prisma/client.js";
import { AppError } from "../../lib/errors.js";

export interface DevelopmentConversationCreation {
  id: string;
  workspaceRelPath: string;
  projectId: string | null;
}

/** The lock and conversation attachment belong to the same creation transaction. */
export async function lockDetachedDevelopment(
  tx: Prisma.TransactionClient, ownerId: string, expected: DevelopmentConversationCreation,
): Promise<void> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT id FROM application_developments WHERE id = ${expected.id}::uuid AND owner_id = ${ownerId}::uuid
      AND conversation_id IS NULL AND workspace_rel_path = ${expected.workspaceRelPath}
      AND project_id IS NOT DISTINCT FROM ${expected.projectId}::uuid FOR UPDATE
  `);
  if (!rows.length) throw new AppError("CONFLICT");
}
