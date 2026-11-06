import type { PublicQaCitation } from "@linksense/shared";
import type { PrismaClient } from "../../generated/prisma/client.js";
import type { KnowledgeRetrievalOrchestrator } from "../knowledge-processing/retrieval.js";
import type { KnowledgeStore } from "../knowledge/types.js";
import { AppError } from "../../lib/errors.js";

export type PublicKnowledgeEvidence = {
  citations: PublicQaCitation[];
  context: string;
};
export type PublicKnowledgeRetriever = (input: {
  ownerId: string;
  knowledgeBaseIds: string[];
  query: string;
  conversationId: string;
  turnId: string;
}) => Promise<PublicKnowledgeEvidence>;

/** The creator delegates only the published selection, never all their libraries. */
export function createPublicKnowledgeRetriever(
  prisma: PrismaClient,
  store: Pick<KnowledgeStore, "resolveUsableKnowledgeBaseIds">,
  retrieval: Pick<KnowledgeRetrievalOrchestrator, "search">,
): PublicKnowledgeRetriever {
  return async (input) => {
    const actor = await prisma.user.findFirst({
      where: { id: input.ownerId, status: "active" },
      select: { id: true },
    });
    if (!actor) throw new AppError("FORBIDDEN");
    const authorized = await store.resolveUsableKnowledgeBaseIds(
      input.ownerId,
      input.knowledgeBaseIds,
    );
    const ids = input.knowledgeBaseIds.filter((id) => authorized.includes(id));
    if (ids.length !== input.knowledgeBaseIds.length)
      throw new AppError("APPLICATION_DEPENDENCY_UNAVAILABLE");
    const isCurrent = async (
      knowledgeBaseId: string,
      documentId: string,
      documentVersionId: string,
    ) =>
      Boolean(
        await prisma.knowledgeBaseDocument.findFirst({
          where: {
            id: documentId,
            knowledgeBaseId,
            currentVersionId: documentVersionId,
            status: "ready",
          },
          select: { id: true },
        }),
      );
    const result = await retrieval.search({
      query: input.query,
      authorizedKnowledgeBaseIds: ids,
      parameters: { finalTopK: 6 },
      signal: AbortSignal.timeout(60_000),
      usageContext: {
        ownerId: input.ownerId,
        conversationId: input.conversationId,
        turnId: input.turnId,
      },
      filterCandidates: async (candidates) => {
        const visible = await Promise.all(
          candidates.map(async (item) =>
            ids.includes(item.knowledgeBaseId) &&
            (await isCurrent(
              item.knowledgeBaseId,
              item.documentId,
              item.documentVersionId,
            ))
              ? item
              : null,
          ),
        );
        return visible.filter((item) => item !== null);
      },
    });
    const finalIds = await store.resolveUsableKnowledgeBaseIds(
      input.ownerId,
      input.knowledgeBaseIds,
    );
    if (ids.some((id) => !finalIds.includes(id)))
      throw new AppError("FORBIDDEN");
    const citations: PublicQaCitation[] = [];
    for (const parent of result.parents.slice(0, 6)) {
      if (
        !ids.includes(parent.knowledgeBaseId) ||
        !(await isCurrent(
          parent.knowledgeBaseId,
          parent.documentId,
          parent.documentVersionId,
        ))
      )
        continue;
      const document = await prisma.knowledgeBaseDocument.findFirst({
        where: {
          id: parent.documentId,
          knowledgeBaseId: parent.knowledgeBaseId,
        },
        select: { displayName: true },
      });
      if (!document) continue;
      citations.push({
        number: citations.length + 1,
        knowledge_base_id: parent.knowledgeBaseId,
        document_id: parent.documentId,
        document_version_id: parent.documentVersionId,
        title: document.displayName.slice(0, 500),
        page_numbers: parent.pageNumbers.slice(0, 100),
        excerpt: parent.parentText.slice(0, 6_000),
      });
    }
    const context = () =>
      JSON.stringify(
        citations.map((item) => ({
          reference: item.number,
          title: item.title,
          text: item.excerpt,
        })),
      );
    // Bound encoded data, including CJK and escaped control characters. Leave
    // room for PostgreSQL jsonb spacing and the independently bounded question.
    while (
      Buffer.byteLength(JSON.stringify(citations), "utf8") > 90_000 ||
      context().length > 50_000
    ) {
      const longest = citations.reduce<PublicQaCitation | undefined>(
        (selected, item) =>
          !selected || item.excerpt.length > selected.excerpt.length
            ? item
            : selected,
        undefined,
      );
      if (!longest?.excerpt) throw new AppError("KNOWLEDGE_SEARCH_UNAVAILABLE");
      longest.excerpt = longest.excerpt
        .slice(0, Math.floor(longest.excerpt.length * 0.75))
        .replace(/[\uD800-\uDBFF]$/u, "");
    }
    return { citations, context: context() };
  };
}
