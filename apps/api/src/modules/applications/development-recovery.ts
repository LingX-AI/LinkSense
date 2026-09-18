import { Prisma, type PrismaClient } from "../../generated/prisma/client.js";
import { deleteConversationWithinTransaction } from "../conversations/deletion.js";

// Filter before LIMIT so active orphan tests cannot starve cleanup of idle ones.
const idleTest = Prisma.sql`
  NOT EXISTS (SELECT 1 FROM conversation_turns t WHERE t.conversation_id = c.id AND t.status = 'running')
  AND NOT EXISTS (SELECT 1 FROM conversation_turn_start_intents i WHERE i.conversation_id = c.id)
  AND NOT EXISTS (SELECT 1 FROM pending_requests p WHERE p.conversation_id = c.id)
  AND NOT EXISTS (SELECT 1 FROM automations a WHERE a.conversation_id = c.id AND a.deleted_at IS NULL)
`;

/** Repair previews whose application development was removed by an older release. Never touch installed applications. */
export async function recoverDetachedDevelopmentTests(db: PrismaClient): Promise<void> {
  const candidates = await db.$queryRaw<Array<{ id: string; ownerId: string }>>(Prisma.sql`
    SELECT a.id, a.owner_id AS "ownerId" FROM applications a
    WHERE a.development_only = true
      AND EXISTS (SELECT 1 FROM conversations c WHERE c.application_id = a.id AND c.owner_id = a.owner_id AND ${idleTest})
      AND NOT EXISTS (SELECT 1 FROM application_developments d
        WHERE d.preview_application_id = a.id AND d.owner_id = a.owner_id)
    ORDER BY a.id LIMIT 20
  `);
  for (const application of candidates) {
    await db.$transaction(async tx => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT id FROM applications WHERE id = ${application.id}::uuid
          AND owner_id = ${application.ownerId}::uuid AND development_only = true FOR UPDATE SKIP LOCKED
      `);
      if (!locked.length) return;
      const parent = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT d.id FROM application_developments d
        WHERE d.preview_application_id = ${application.id}::uuid AND d.owner_id = ${application.ownerId}::uuid
      `);
      if (parent.length) return;
      const sessions = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT c.id FROM conversations c WHERE c.application_id = ${application.id}::uuid
          AND c.owner_id = ${application.ownerId}::uuid AND ${idleTest}
        ORDER BY c.id LIMIT 20 FOR UPDATE OF c SKIP LOCKED
      `);
      for (const session of sessions) {
        const where = { conversationId: session.id };
        if (await tx.conversationTurn.count({ where: { ...where, status: "running" } }) ||
          await tx.conversationTurnStartIntent.count({ where }) || await tx.pendingRequest.count({ where }) ||
          await tx.automation.count({ where: { ...where, deletedAt: null } })) continue;
        await deleteConversationWithinTransaction(tx, application.ownerId, session.id, {});
      }
      await tx.application.updateMany({ where: { id: application.id, ownerId: application.ownerId, developmentOnly: true }, data: { status: "deleted", deletedAt: new Date(), deletedBy: application.ownerId } });
    }, { timeout: 30_000 });
  }
}
