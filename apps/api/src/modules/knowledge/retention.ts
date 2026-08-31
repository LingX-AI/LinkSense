import { Prisma } from "../../generated/prisma/client.js"
import { AppError } from "../../lib/errors.js"

export const SUPERSEDED_VERSION_RETENTION_MS = 30 * 24 * 60 * 60_000

export async function retainCitedKnowledgeVersions(
  transaction: Prisma.TransactionClient,
  versionIds: readonly string[],
): Promise<void> {
  const ids = uniqueSortedIds(versionIds)
  if (ids.length === 0) return
  await lockKnowledgeVersionRows(transaction, ids)
  const cleanup = await transaction.knowledgeBaseCleanupOutbox.findFirst({
    where: {
      targetType: "document_version",
      documentVersionId: { in: ids },
    },
    select: { id: true },
  })
  if (cleanup !== null) throw new AppError("VALIDATION_ERROR")
  await transaction.knowledgeBaseDocumentVersion.updateMany({
    where: { id: { in: ids } },
    data: { cleanupEligibleAt: null },
  })
}

/**
 * Re-opens the normal cleanup window after citations are removed. The caller
 * must invoke this after deleting the citations and inside the same database
 * transaction so a concurrent message projection cannot be lost.
 */
export async function restoreUnreferencedVersionCleanupEligibility(
  transaction: Prisma.TransactionClient,
  versionIds: readonly string[],
): Promise<void> {
  const ids = uniqueSortedIds(versionIds)
  if (ids.length === 0) return
  await lockKnowledgeVersionRows(transaction, ids)
  const [versions, remainingCitations] = await Promise.all([
    transaction.knowledgeBaseDocumentVersion.findMany({
      where: { id: { in: ids }, versionStatus: "superseded" },
      select: { id: true, supersededAt: true },
    }),
    transaction.conversationMessageKnowledgeCitation.findMany({
      where: { documentVersionId: { in: ids } },
      select: { documentVersionId: true },
      distinct: ["documentVersionId"],
    }),
  ])
  const retained = new Set(
    remainingCitations.map((citation) => citation.documentVersionId),
  )
  await Promise.all(
    versions
      .filter(
        (version) => version.supersededAt !== null && !retained.has(version.id),
      )
      .map((version) =>
        transaction.knowledgeBaseDocumentVersion.updateMany({
          where: {
            id: version.id,
            versionStatus: "superseded",
            cleanupEligibleAt: null,
          },
          data: {
            cleanupEligibleAt: new Date(
              version.supersededAt!.getTime() +
                SUPERSEDED_VERSION_RETENTION_MS,
            ),
          },
        }),
      ),
  )
}

export async function lockKnowledgeVersionRows(
  transaction: Prisma.TransactionClient,
  ids: readonly string[],
): Promise<void> {
  await transaction.$queryRaw(
    Prisma.sql`
      SELECT "id"
      FROM "knowledge_base_document_versions"
      WHERE "id"::text IN (${Prisma.join(ids)})
      ORDER BY "id" ASC
      FOR UPDATE
    `,
  )
}

function uniqueSortedIds(ids: readonly string[]): string[] {
  return [...new Set(ids)].sort()
}
