import type { Prisma, PrismaClient } from "../../generated/prisma/client.js";
import { AppError } from "../../lib/errors.js";
import { lockDesktopConversation } from "../desktop-credentials/run-authority.js";
import type { DesktopRunScope } from "../desktop-credentials/run-leases.js";
import type { ConversationAssetSource } from "../knowledge/conversation-asset-snapshots.js";
import { PrismaKnowledgeStore } from "../knowledge/repository.js";

export async function assertDesktopKnowledgeAssetCurrent(
  prisma: PrismaClient,
  tx: Prisma.TransactionClient,
  scope: DesktopRunScope,
  source: ConversationAssetSource,
): Promise<void> {
  await lockDesktopConversation(tx, scope);
  await tx.$queryRaw`SELECT id FROM conversation_turns WHERE id = ${scope.turnId}::uuid FOR SHARE`;
  // A grant, group membership, or document revision must not change between
  // the authorization read and committing the protected image.
  await tx.$queryRaw`SELECT id FROM knowledge_bases WHERE id = ${source.knowledgeBaseId}::uuid FOR SHARE`;
  await tx.$queryRaw`SELECT id FROM user_group_members WHERE user_id = ${scope.ownerId}::uuid AND status = 'active' FOR SHARE`;
  await tx.$queryRaw`
    SELECT id FROM knowledge_base_grants
    WHERE knowledge_base_id = ${source.knowledgeBaseId}::uuid AND status = 'active'
      AND (
        (grantee_type = 'user' AND user_id = ${scope.ownerId}::uuid)
        OR (grantee_type = 'user_group' AND user_group_id IN (
          SELECT user_group_id FROM user_group_members WHERE user_id = ${scope.ownerId}::uuid AND status = 'active'
        ))
      )
    FOR SHARE`;
  const [document] = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM knowledge_base_documents WHERE id = ${source.documentId}::uuid
      AND knowledge_base_id = ${source.knowledgeBaseId}::uuid
      AND current_version_id = ${source.documentVersionId}::uuid AND status = 'ready'
    FOR SHARE`;
  // The desktop start path only admits personal tasks, with no app-managed grants.
  const usable = await new PrismaKnowledgeStore(prisma, tx)
    .resolveUsableKnowledgeBaseIds(scope.ownerId, [source.knowledgeBaseId]);
  if (!document || !usable.includes(source.knowledgeBaseId)) throw new AppError("FORBIDDEN");
}
