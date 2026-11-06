import dayjs from "dayjs";
import {
  publicKnowledgeUsageSchema,
  publicKnowledgeTurnStatusSchema,
  type PublicKnowledgeUsage,
  type PublicKnowledgeUsageQuery,
} from "@linksense/shared";
import { Prisma, type PrismaClient } from "../../generated/prisma/client.js";

export async function readPublicKnowledgeUsage(
  prisma: PrismaClient,
  applicationId: string,
  query: PublicKnowledgeUsageQuery,
): Promise<PublicKnowledgeUsage> {
  const from = query.from ? dayjs(query.from).toDate() : null;
  const to = query.to ? dayjs(query.to).toDate() : null;
  const createdAt = {
    ...(from ? { gte: from } : {}),
    ...(to ? { lte: to } : {}),
  };
  const [visitors, conversations, turns] = await Promise.all([
    prisma.publicKnowledgeVisitor.count({
      where: { applicationId, createdAt },
    }),
    prisma.publicKnowledgeConversation.count({
      where: { applicationId, createdAt },
    }),
    prisma.$queryRaw<
      Array<{
        status: string;
        count: number;
        average_duration_ms: number | null;
      }>
    >(Prisma.sql`
      SELECT t.status, COUNT(*)::integer AS count,
        AVG(GREATEST(0, EXTRACT(EPOCH FROM (t.completed_at - t.created_at)) * 1000))
          FILTER (WHERE t.status = 'completed' AND t.completed_at IS NOT NULL)::double precision AS average_duration_ms
      FROM public_knowledge_turns t
      JOIN public_knowledge_conversations c ON c.id = t.conversation_id
      WHERE c.application_id = ${applicationId}::uuid
        AND (${from}::timestamptz IS NULL OR t.created_at >= ${from}::timestamptz)
        AND (${to}::timestamptz IS NULL OR t.created_at <= ${to}::timestamptz)
      GROUP BY t.status
    `),
  ]);
  return publicKnowledgeUsageSchema.parse({
    visitors,
    conversations,
    questions: turns.reduce((total, row) => total + row.count, 0),
    statuses: Object.fromEntries(
      publicKnowledgeTurnStatusSchema.options.map((status) => [
        status,
        turns.find((row) => row.status === status)?.count ?? 0,
      ]),
    ),
    average_duration_ms:
      turns.find((row) => row.status === "completed")?.average_duration_ms ??
      null,
  });
}
