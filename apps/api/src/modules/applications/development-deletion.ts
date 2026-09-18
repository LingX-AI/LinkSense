import { Prisma } from "../../generated/prisma/client.js";
import { AppError } from "../../lib/errors.js";
import type { AuditContext } from "../audit/service.js";
import { deleteConversationWithinTransaction } from "../conversations/deletion.js";

/** Delete a draft and its private tests without touching the published application. */
export async function deleteApplicationDevelopment(
  tx: Prisma.TransactionClient, ownerId: string,
  target: { developmentId: string } | { applicationId: string }, context: AuditContext,
): Promise<void> {
  const selector = "developmentId" in target
    ? Prisma.sql`id = ${target.developmentId}::uuid`
    : Prisma.sql`application_id = ${target.applicationId}::uuid`;
  const [project] = await tx.$queryRaw<Array<{ id: string; applicationId: string | null; previewApplicationId: string | null }>>(Prisma.sql`
    SELECT id, application_id AS "applicationId", preview_application_id AS "previewApplicationId"
    FROM application_developments WHERE owner_id = ${ownerId}::uuid AND ${selector} FOR UPDATE
  `);
  if (!project) {
    if ("developmentId" in target) throw new AppError("APPLICATION_DEVELOPMENT_NOT_FOUND");
    return;
  }
  // The project lock serializes publication with deletion. A published application
  // remains usable independently and may start a new development project later.
  if (project.previewApplicationId) {
    const applications = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id FROM applications WHERE id = ${project.previewApplicationId}::uuid
        AND owner_id = ${ownerId}::uuid AND development_only = true FOR UPDATE
    `);
    if (!applications.length) throw new AppError("CONFLICT");
    const tests = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id FROM conversations WHERE application_id = ${project.previewApplicationId}::uuid
        AND owner_id = ${ownerId}::uuid ORDER BY id FOR UPDATE
    `);
    const ids = tests.map(test => test.id);
    if (await tx.conversationTurn.count({ where: { conversationId: { in: ids }, status: "running" } }) ||
      await tx.conversationTurnStartIntent.count({ where: { conversationId: { in: ids } } }) ||
      await tx.pendingRequest.count({ where: { conversationId: { in: ids } } })) throw new AppError("APPLICATION_DEVELOPMENT_TEST_BUSY");
    for (const test of tests) await deleteConversationWithinTransaction(tx, ownerId, test.id, context);
    await tx.application.updateMany({ where: { id: project.previewApplicationId, ownerId, developmentOnly: true },
      data: { status: "deleted", deletedAt: new Date(), deletedBy: ownerId } });
  }
  // Source conversations and user workspace files are retained as ordinary task history.
  await tx.applicationDevelopment.delete({ where: { id: project.id, ownerId } });
}
