import type { PrismaClient } from "../../generated/prisma/client.js";
import { AppError } from "../../lib/errors.js";
import type {
  TurnKnowledgeAssetSource,
  TurnKnowledgeSourceStore,
} from "../events/knowledge-source-store.js";
import type { KnowledgeCitationEvidenceReader } from "./citation-read.js";
import type { TurnKnowledgeScopeResolver } from "./internal-search.js";
import { collectKnowledgeAssetReferenceIds } from "./knowledge-asset-reference.js";
import type {
  KnowledgeActor,
  KnowledgeAssetFile,
  KnowledgeDocumentAccessAdapter,
} from "./types.js";

const MAX_TRANSIENT_HISTORY_TURNS = 100;
const MAX_PERSISTED_CITATION_CANDIDATES = 500;

type AssetLocation = {
  knowledgeBaseId: string;
  documentId: string;
  documentVersionId: string;
};

/**
 * Resolves assets that were returned by knowledge retrieval for the current
 * turn or an earlier turn in the same owned conversation. A bare asset UUID
 * never grants access: every fallback is intersected with the current turn's
 * live knowledge scope, and durable provenance is revalidated against the
 * exact indexed parent Markdown before object storage is read.
 */
export class KnowledgeTurnAssetReadService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly sources: Pick<
      TurnKnowledgeSourceStore,
      "readAssetSources"
    >,
    private readonly scopes: Pick<
      TurnKnowledgeScopeResolver,
      "getTurnRetrievalScope"
    >,
    private readonly assets: Pick<KnowledgeDocumentAccessAdapter, "getAsset">,
    private readonly evidence: KnowledgeCitationEvidenceReader,
  ) {}

  async getAsset(
    actor: KnowledgeActor,
    conversationId: string,
    turnId: string,
    assetReferenceId: string,
  ): Promise<KnowledgeAssetFile> {
    if (actor.status !== "active") throw new AppError("NOT_FOUND");

    const [conversation, turn] = await Promise.all([
      this.prisma.conversation.findFirst({
        where: { id: conversationId, ownerId: actor.id },
        select: { id: true },
      }),
      this.prisma.conversationTurn.findFirst({
        where: { id: turnId, conversationId },
        select: { id: true, sequenceNo: true },
      }),
    ]);
    if (!conversation || !turn) throw new AppError("NOT_FOUND");

    const [scope, currentSources] = await Promise.all([
      this.scopes.getTurnRetrievalScope(actor, { turnId }),
      this.sources.readAssetSources(turnId),
    ]);
    const usableKnowledgeBaseIds = new Set(scope.usable_ids);
    if (usableKnowledgeBaseIds.size === 0) throw new AppError("NOT_FOUND");

    const currentAsset = await this.#readFromSources(
      actor,
      currentSources,
      usableKnowledgeBaseIds,
      assetReferenceId,
    );
    if (currentAsset !== null) return currentAsset;

    const previousTurns = await this.prisma.conversationTurn.findMany({
      where: {
        conversationId,
        sequenceNo: { lt: turn.sequenceNo },
      },
      orderBy: { sequenceNo: "desc" },
      select: { id: true },
      take: MAX_TRANSIENT_HISTORY_TURNS,
    });
    for (const previousTurn of previousTurns) {
      const historicalAsset = await this.#readFromSources(
        actor,
        await this.sources.readAssetSources(previousTurn.id),
        usableKnowledgeBaseIds,
        assetReferenceId,
      );
      if (historicalAsset !== null) return historicalAsset;
    }

    const persistedAsset = await this.#readFromPersistedCitations({
      actor,
      conversationId,
      maximumTurnSequence: turn.sequenceNo,
      usableKnowledgeBaseIds,
      assetReferenceId,
    });
    if (persistedAsset !== null) return persistedAsset;

    throw new AppError("NOT_FOUND");
  }

  async #readFromSources(
    actor: KnowledgeActor,
    sources: readonly TurnKnowledgeAssetSource[],
    usableKnowledgeBaseIds: ReadonlySet<string>,
    assetReferenceId: string,
  ): Promise<KnowledgeAssetFile | null> {
    const authorizedSources = sources.filter(
      (source) =>
        source.assetReferenceIds.includes(assetReferenceId) &&
        usableKnowledgeBaseIds.has(source.knowledgeBaseId),
    );

    for (const source of authorizedSources) {
      const asset = await this.#tryReadAsset(actor, source, assetReferenceId);
      if (asset !== null) return asset;
    }
    return null;
  }

  async #readFromPersistedCitations(input: {
    actor: KnowledgeActor;
    conversationId: string;
    maximumTurnSequence: number;
    usableKnowledgeBaseIds: ReadonlySet<string>;
    assetReferenceId: string;
  }): Promise<KnowledgeAssetFile | null> {
    const locations = await this.prisma.knowledgeBaseObject.findMany({
      where: {
        assetReferenceId: input.assetReferenceId,
        knowledgeBaseId: { in: [...input.usableKnowledgeBaseIds] },
        objectType: "asset",
        lifecycleStatus: "active",
      },
      select: {
        knowledgeBaseId: true,
        documentId: true,
        documentVersionId: true,
      },
    });
    const uniqueLocations = uniqueAssetLocations(locations);
    if (uniqueLocations.length === 0) return null;

    const citations =
      await this.prisma.conversationMessageKnowledgeCitation.findMany({
        where: {
          conversationId: input.conversationId,
          OR: uniqueLocations.map((location) => ({
            knowledgeBaseId: location.knowledgeBaseId,
            documentId: location.documentId,
            documentVersionId: location.documentVersionId,
          })),
        },
        orderBy: { createdAt: "desc" },
        select: {
          turnId: true,
          knowledgeBaseId: true,
          documentId: true,
          documentVersionId: true,
          parentId: true,
          matchedChildIds: true,
        },
        take: MAX_PERSISTED_CITATION_CANDIDATES,
      });
    if (citations.length === 0) return null;

    const citationTurnIds = [...new Set(citations.map(({ turnId }) => turnId))];
    const visibleTurns = await this.prisma.conversationTurn.findMany({
      where: {
        id: { in: citationTurnIds },
        conversationId: input.conversationId,
        sequenceNo: { lte: input.maximumTurnSequence },
      },
      select: { id: true },
    });
    const visibleTurnIds = new Set(visibleTurns.map(({ id }) => id));

    for (const citation of citations) {
      if (
        !visibleTurnIds.has(citation.turnId) ||
        !input.usableKnowledgeBaseIds.has(citation.knowledgeBaseId) ||
        citation.matchedChildIds.length === 0 ||
        new Set(citation.matchedChildIds).size !==
          citation.matchedChildIds.length
      ) {
        continue;
      }
      const parent = await this.evidence.getParentEvidence({
        knowledgeBaseId: citation.knowledgeBaseId,
        documentId: citation.documentId,
        documentVersionId: citation.documentVersionId,
        parentId: citation.parentId,
        matchedChildIds: citation.matchedChildIds,
      });
      if (
        parent === null ||
        parent.parentId !== citation.parentId ||
        !collectKnowledgeAssetReferenceIds(parent.parentText).includes(
          input.assetReferenceId,
        )
      ) {
        continue;
      }
      const asset = await this.#tryReadAsset(
        input.actor,
        citation,
        input.assetReferenceId,
      );
      if (asset !== null) return asset;
    }
    return null;
  }

  async #tryReadAsset(
    actor: KnowledgeActor,
    location: AssetLocation,
    assetReferenceId: string,
  ): Promise<KnowledgeAssetFile | null> {
    try {
      return await this.assets.getAsset({
        actorId: actor.id,
        knowledgeBaseId: location.knowledgeBaseId,
        documentId: location.documentId,
        documentVersionId: location.documentVersionId,
        assetReferenceId,
      });
    } catch (error) {
      if (
        error instanceof AppError &&
        error.code === "KNOWLEDGE_DOCUMENT_NOT_FOUND"
      ) {
        return null;
      }
      throw error;
    }
  }
}

function uniqueAssetLocations(
  locations: readonly AssetLocation[],
): AssetLocation[] {
  return [
    ...new Map(
      locations.map((location) => [
        `${location.knowledgeBaseId}:${location.documentId}:${location.documentVersionId}`,
        location,
      ]),
    ).values(),
  ];
}
