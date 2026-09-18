import { Prisma, type Conversation } from "../../generated/prisma/client.js";
import { AppError } from "../../lib/errors.js";
import { developmentTestActivity } from "./development-test-activity.js";

export interface DevelopmentPreviewCreation {
  id: string;
  revision: number;
  previousConversationId: string | null;
}

/** Keep one empty preview; submitted sessions retain their immutable package and history. */
export async function reuseUnusedDevelopmentPreview(
  tx: Prisma.TransactionClient, ownerId: string,
  application: { id: string; name: string; interactivePackageId: string | null },
  expected: DevelopmentPreviewCreation,
): Promise<Conversation | null> {
  if (!expected.previousConversationId) return null;
  await lockDevelopmentPreview(tx, ownerId, application.id, application.interactivePackageId, expected);
  const [current] = await tx.$queryRaw<Array<{ used: boolean }>>(Prisma.sql`
    SELECT ${developmentTestActivity(Prisma.sql`c.id`)} AS used FROM conversations c
    WHERE c.id = ${expected.previousConversationId}::uuid
      AND c.owner_id = ${ownerId}::uuid AND c.application_id = ${application.id}::uuid
  `);
  if (!current || current.used) return null;
  return tx.conversation.update({ where: { id: expected.previousConversationId }, data: {
    interactiveApplicationPackageId: application.interactivePackageId,
    applicationNameSnapshot: application.name, title: application.name,
  } });
}

export async function lockDevelopmentPreview(
  tx: Prisma.TransactionClient, ownerId: string, applicationId: string,
  packageId: string | null, expected: DevelopmentPreviewCreation,
): Promise<void> {
  const projects = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT d.id FROM application_developments d
    WHERE d.id = ${expected.id}::uuid AND d.owner_id = ${ownerId}::uuid
      AND d.preview_application_id = ${applicationId}::uuid
      AND d.revision = ${expected.revision}
      AND d.preview_conversation_id IS NOT DISTINCT FROM ${expected.previousConversationId}::uuid
    FOR UPDATE OF d
  `);
  if (!projects.length) throw new AppError("APPLICATION_DEVELOPMENT_TEST_CHANGED");
  const applications = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT id FROM applications WHERE id = ${applicationId}::uuid AND owner_id = ${ownerId}::uuid
      AND development_only = true AND status = 'active' AND interactive_package_id = ${packageId}::uuid FOR SHARE
  `);
  if (!applications.length) throw new AppError("APPLICATION_DEVELOPMENT_TEST_CHANGED");
  if (expected.previousConversationId) {
    await tx.$queryRaw(Prisma.sql`SELECT id FROM conversations WHERE id = ${expected.previousConversationId}::uuid FOR UPDATE`);
    const where = { conversationId: expected.previousConversationId };
    const previous = await tx.conversation.findUnique({ where: { id: expected.previousConversationId }, select: { interactiveApplicationPackageId: true } });
    if (previous?.interactiveApplicationPackageId !== packageId && (await tx.conversationTurn.count({ where: { ...where, status: "running" } }) ||
      await tx.conversationTurnStartIntent.count({ where }) || await tx.pendingRequest.count({ where }))) {
      throw new AppError("APPLICATION_DEVELOPMENT_TEST_BUSY");
    }
  }
}

/** Called with the task row locked at turn admission, so restart/delete cannot race admission. */
export async function assertCurrentDevelopmentPreview(tx: Prisma.TransactionClient, ownerId: string, conversationId: string, applicationId: string, packageId: string | null): Promise<void> {
  const invalid = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT a.id FROM applications a WHERE a.id = ${applicationId}::uuid AND a.development_only = true
      AND (a.owner_id <> ${ownerId}::uuid OR a.status <> 'active' OR NOT EXISTS (
        SELECT 1 FROM application_developments d
        WHERE d.owner_id = ${ownerId}::uuid AND d.preview_application_id = a.id
      ) OR NOT EXISTS (
        SELECT 1 FROM conversations c WHERE c.id = ${conversationId}::uuid
          AND c.interactive_application_package_id IS NOT DISTINCT FROM ${packageId}::uuid
      ))
  `);
  if (invalid.length) throw new AppError("APPLICATION_DEVELOPMENT_TEST_CHANGED");
}

/** Generic task creation/forking must not create untracked preview sessions. */
export async function assertNotDevelopmentPreview(tx: Prisma.TransactionClient, applicationId: string): Promise<void> {
  const previews = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT id FROM applications WHERE id = ${applicationId}::uuid AND development_only = true
  `);
  if (previews.length) throw new AppError("FORBIDDEN");
}
