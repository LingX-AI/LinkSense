import type { PrismaClient } from "../../generated/prisma/client.js"

const MAX_ORIGINAL_SOURCE_HOPS = 64

type OriginalSourceDatabase = Pick<
  PrismaClient,
  "knowledgeBaseDocumentVersion" | "knowledgeBaseObject"
>

type SourceVersion = {
  id: string
  sourceVersionId: string | null
}

/**
 * Resolves the immutable original behind a document version. New reprocessing
 * versions point directly at the returned root version, while the bounded
 * traversal keeps historical chained rows readable without allowing cycles or
 * cross-document references to escape their resource boundary.
 */
export async function resolveOriginalSource(
  database: OriginalSourceDatabase,
  input: {
    knowledgeBaseId: string
    documentId: string
    startVersion: SourceVersion
  },
) {
  const visited = new Set<string>()
  let version: SourceVersion | null = input.startVersion

  for (let hop = 0; hop < MAX_ORIGINAL_SOURCE_HOPS && version; hop += 1) {
    if (visited.has(version.id)) return null
    visited.add(version.id)

    const object = await database.knowledgeBaseObject.findFirst({
      where: {
        knowledgeBaseId: input.knowledgeBaseId,
        documentId: input.documentId,
        documentVersionId: version.id,
        objectType: "original",
        lifecycleStatus: "active",
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    })
    if (object) return { sourceVersionId: version.id, object }
    if (version.sourceVersionId === null) return null

    version = await database.knowledgeBaseDocumentVersion.findFirst({
      where: {
        id: version.sourceVersionId,
        knowledgeBaseId: input.knowledgeBaseId,
        documentId: input.documentId,
        versionStatus: { not: "deleted" },
      },
      select: { id: true, sourceVersionId: true },
    })
  }

  return null
}
