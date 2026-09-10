import type { ApplicationService } from "../applications/service.js";
import type { KnowledgeService } from "./service.js";
import type { TurnKnowledgeScopeResolver } from "./internal-search.js";

/** User access is live; delegated application access remains bound to this turn. */
export function createTurnKnowledgeScopeResolver(
  knowledge: Pick<
    KnowledgeService,
    | "getTurnRetrievalScope"
    | "listDocuments"
    | "listDocumentsForAuthorizedApplicationTurn"
    | "getParsedContentChunk"
    | "getParsedContentChunkForAuthorizedApplicationTurn"
  >,
  applications: Pick<ApplicationService, "resolveUsableKnowledgeBaseIdsForTurn">,
): TurnKnowledgeScopeResolver {
  return {
    async getTurnRetrievalScope(actor, locator) {
      const direct = await knowledge.getTurnRetrievalScope(actor, locator);
      const applicationIds =
        await applications.resolveUsableKnowledgeBaseIdsForTurn(
          actor.id,
          locator,
          direct.requested_ids,
        );
      const authorized = new Set([...direct.usable_ids, ...applicationIds]);
      const usable = [
        ...new Set([
          ...direct.requested_ids.filter((id) => authorized.has(id)),
          ...direct.usable_ids,
        ]),
      ];
      const usableSet = new Set(usable);
      return {
        requested_ids: direct.requested_ids,
        usable_ids: usable,
        unavailable_ids: direct.requested_ids.filter(
          (id) => !usableSet.has(id),
        ),
      };
    },
    listDocuments: async (actor, knowledgeBaseId, request) => {
      const applicationIds =
        await applications.resolveUsableKnowledgeBaseIdsForTurn(
          actor.id,
          { turnId: request.turnId },
          [knowledgeBaseId],
        );
      return applicationIds.includes(knowledgeBaseId)
        ? knowledge.listDocumentsForAuthorizedApplicationTurn(
            knowledgeBaseId,
            request,
          )
        : knowledge.listDocuments(actor, knowledgeBaseId, request);
    },
    getParsedContentChunk: async (
      actor,
      knowledgeBaseId,
      documentId,
      documentVersionId,
      request,
    ) => {
      const applicationIds =
        await applications.resolveUsableKnowledgeBaseIdsForTurn(
          actor.id,
          { turnId: request.turnId },
          [knowledgeBaseId],
        );
      return applicationIds.includes(knowledgeBaseId)
        ? knowledge.getParsedContentChunkForAuthorizedApplicationTurn(
            knowledgeBaseId,
            documentId,
            documentVersionId,
            request,
          )
        : knowledge.getParsedContentChunk(
            actor,
            knowledgeBaseId,
            documentId,
            documentVersionId,
            request,
          );
    },
  };
}
