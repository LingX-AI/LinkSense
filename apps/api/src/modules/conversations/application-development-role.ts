import type { ConversationApplicationDevelopmentRole } from "@linksense/shared";
import type { PrismaClient, Prisma } from "../../generated/prisma/client.js";

/** Filter in the database before ordering, pagination and archive counts. */
export async function ordinaryConversationFilter(db: PrismaClient, ownerId: string): Promise<Prisma.ConversationWhereInput> {
  const previews = await db.application.findMany({ where: { ownerId, developmentOnly: true }, select: { id: true } });
  return previews.length ? { OR: [{ applicationId: null }, { applicationId: { notIn: previews.map(item => item.id) } }] } : {};
}

/** Derive task labels from owned resources, including previews from earlier revisions. */
export async function readConversationDevelopmentRoles(
  db: PrismaClient,
  ownerId: string,
  conversations: readonly { id: string; applicationId: string | null }[],
): Promise<ReadonlyMap<string, ConversationApplicationDevelopmentRole>> {
  const builderIds = conversations.filter((row) => !row.applicationId).map((row) => row.id);
  const applicationIds = [...new Set(conversations.flatMap((row) => row.applicationId ? [row.applicationId] : []))];
  const [developments, previewApplications] = await Promise.all([
    builderIds.length ? db.applicationDevelopment.findMany({
      where: { ownerId, conversationId: { in: builderIds } },
      select: { conversationId: true },
    }) : [],
    applicationIds.length ? db.application.findMany({
      where: { ownerId, id: { in: applicationIds }, developmentOnly: true },
      select: { id: true },
    }) : [],
  ]);
  const roles = new Map<string, ConversationApplicationDevelopmentRole>(
    developments.flatMap((row) => row.conversationId ? [[row.conversationId, "development"] as const] : []),
  );
  const previewIds = new Set(previewApplications.map((row) => row.id));
  for (const row of conversations) {
    if (row.applicationId && previewIds.has(row.applicationId)) roles.set(row.id, "preview");
  }
  return roles;
}
