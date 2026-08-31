import {
  knowledgeCitationEventSchema,
  knowledgeCitationPreviewSchema,
  type KnowledgeCitationEvent,
  type KnowledgeCitationPreview,
} from "@linksense/shared";

import type { PrismaClient } from "../../generated/prisma/client.js";
import { AppError } from "../../lib/errors.js";
import type { ParentEvidence } from "../knowledge-processing/elasticsearch.js";
import { collectKnowledgeAssetReferenceIds } from "./knowledge-asset-reference.js";
import type { KnowledgeService } from "./service.js";
import type {
  KnowledgeActor,
  KnowledgeAssetFile,
  KnowledgeOriginalFile,
} from "./types.js";

type CitationIdentity = {
  id: string;
  citationNo: number;
  knowledgeBaseId: string;
  documentId: string;
  documentVersionId: string;
  parentId: string;
};

type ResolvedAvailableCitation = {
  status: "available";
  citation: CitationIdentity;
  titlePath: string[];
  matchedChildIds: string[];
  pageNumbers: number[];
  knowledgeBaseName: string;
  documentName: string;
  renderer: "file" | null;
};

type ResolvedHistoricalCitation = {
  status: "historical_unavailable";
  citation: CitationIdentity;
  titlePath: string[];
  matchedChildIds: string[];
  pageNumbers: number[];
  knowledgeBaseName: string;
  documentName: string;
};

type ResolvedCitation = ResolvedAvailableCitation | ResolvedHistoricalCitation;

type PersistedCitation = {
  citation: {
    id: CitationIdentity["id"];
    citationNo: CitationIdentity["citationNo"];
    knowledgeBaseId: CitationIdentity["knowledgeBaseId"];
    documentId: CitationIdentity["documentId"];
    documentVersionId: CitationIdentity["documentVersionId"];
    parentId: CitationIdentity["parentId"];
  };
  titlePath: string[];
  matchedChildIds: string[];
  pageNumbers: number[];
  knowledgeBaseNameSnapshot: string;
  documentNameSnapshot: string;
};

export interface KnowledgeCitationEvidenceReader {
  getParentEvidence(input: {
    knowledgeBaseId: string;
    documentId: string;
    documentVersionId: string;
    parentId: string;
    matchedChildIds: string[];
  }): Promise<ParentEvidence | null>;
}

/**
 * Resolves a persisted citation entirely on the server. The browser-facing
 * contract never accepts or returns source UUIDs, a parent id or private child
 * ids. It resolves the immutable parent retrieval projection and exposes only
 * a safe parent excerpt plus the persisted page-level evidence.
 */
export class KnowledgeCitationReadService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly knowledge: Pick<
      KnowledgeService,
      | "getDocument"
      | "getOriginalPreview"
      | "downloadOriginal"
      | "getAsset"
      | "subscribeEvents"
    >,
    private readonly evidence: KnowledgeCitationEvidenceReader,
  ) {}

  async resolve(
    actor: KnowledgeActor,
    citationId: string,
  ): Promise<KnowledgeCitationPreview> {
    return this.#projectPreview(await this.#resolveCitation(actor, citationId));
  }

  async resolveForApplicationTurn(
    actor: KnowledgeActor,
    citationId: string,
    authorize: (input: {
      turnId: string;
      knowledgeBaseId: string;
    }) => Promise<boolean>,
  ): Promise<KnowledgeCitationPreview> {
    return this.#projectPreview(
      await this.#resolveCitation(actor, citationId, authorize),
    );
  }

  async #projectPreview(
    resolved: ResolvedCitation,
  ): Promise<KnowledgeCitationPreview> {
    if (resolved.status === "historical_unavailable") {
      return knowledgeCitationPreviewSchema.parse({
        status: "historical_unavailable",
        citation_id: resolved.citation.id,
        citation_no: resolved.citation.citationNo,
        summary: citationSummary(resolved),
      });
    }
    const evidence = await this.evidence.getParentEvidence({
      knowledgeBaseId: resolved.citation.knowledgeBaseId,
      documentId: resolved.citation.documentId,
      documentVersionId: resolved.citation.documentVersionId,
      parentId: resolved.citation.parentId,
      matchedChildIds: resolved.matchedChildIds,
    });
    if (
      evidence === null ||
      evidence.parentId !== resolved.citation.parentId ||
      !sameNumbers(
        resolved.pageNumbers,
        uniqueSortedPages(
          evidence.matchedChildren.flatMap((child) => child.pageNumbers),
        ),
      )
    ) {
      throw new AppError("NOT_FOUND");
    }
    const excerpt = sanitizeCitationExcerpt(evidence.parentText);
    if (excerpt.trim() === "") throw new AppError("NOT_FOUND");

    return knowledgeCitationPreviewSchema.parse({
      status: "available",
      citation_id: resolved.citation.id,
      citation_no: resolved.citation.citationNo,
      summary: citationSummary(resolved),
      parent_excerpt: excerpt,
      original:
        resolved.renderer === null
          ? { supported: false, renderer: null }
          : { supported: true, renderer: resolved.renderer },
    });
  }

  async getOriginalPreview(
    actor: KnowledgeActor,
    citationId: string,
  ): Promise<KnowledgeOriginalFile> {
    const resolved = await this.#resolveAvailableCitation(actor, citationId);
    if (resolved.renderer !== "file") {
      throw new AppError("KNOWLEDGE_PREVIEW_UNSUPPORTED");
    }
    return this.knowledge.getOriginalPreview(
      actor,
      resolved.citation.knowledgeBaseId,
      resolved.citation.documentId,
      resolved.citation.documentVersionId,
    );
  }

  async downloadOriginal(
    actor: KnowledgeActor,
    citationId: string,
  ): Promise<KnowledgeOriginalFile> {
    const resolved = await this.#resolveAvailableCitation(actor, citationId);
    return this.knowledge.downloadOriginal(
      actor,
      resolved.citation.knowledgeBaseId,
      resolved.citation.documentId,
      resolved.citation.documentVersionId,
    );
  }

  async getAsset(
    actor: KnowledgeActor,
    citationId: string,
    assetReferenceId: string,
  ): Promise<KnowledgeAssetFile> {
    const resolved = await this.#resolveAvailableCitation(actor, citationId);
    const evidence = await this.evidence.getParentEvidence({
      knowledgeBaseId: resolved.citation.knowledgeBaseId,
      documentId: resolved.citation.documentId,
      documentVersionId: resolved.citation.documentVersionId,
      parentId: resolved.citation.parentId,
      matchedChildIds: resolved.matchedChildIds,
    });
    if (
      evidence === null ||
      evidence.parentId !== resolved.citation.parentId ||
      !collectKnowledgeAssetReferenceIds(evidence.parentText).includes(
        assetReferenceId,
      )
    ) {
      throw new AppError("NOT_FOUND");
    }
    return this.knowledge.getAsset(
      actor,
      resolved.citation.knowledgeBaseId,
      resolved.citation.documentId,
      resolved.citation.documentVersionId,
      assetReferenceId,
    );
  }

  /**
   * Keeps citation authorization server-side and exposes only an opaque
   * invalidation signal. The first matching document event is the Redis/DB
   * reconciliation snapshot; it establishes a baseline and is not forwarded
   * as a change. Re-resolving after that snapshot closes the race where the
   * source was deleted between the initial authorization and subscription.
   */
  async *subscribeEvents(
    actor: KnowledgeActor,
    citationId: string,
    signal: AbortSignal,
  ): AsyncIterable<KnowledgeCitationEvent> {
    const resolved = await this.#resolveAvailableCitation(actor, citationId);
    const events = await this.knowledge.subscribeEvents(
      actor,
      resolved.citation.knowledgeBaseId,
      signal,
    );
    let baselineRevision: number | null = null;

    for await (const event of events) {
      if (signal.aborted) return;
      if (event.document_id !== resolved.citation.documentId) continue;
      if (baselineRevision === null) {
        baselineRevision = event.revision;
        await this.#resolveAvailableCitation(actor, citationId);
        continue;
      }
      if (event.revision <= baselineRevision) continue;
      baselineRevision = event.revision;
      yield knowledgeCitationEventSchema.parse({
        type: "knowledge_citation_source_changed",
      });
    }
  }

  async #resolveCitation(
    actor: KnowledgeActor,
    citationId: string,
    applicationAuthorization?: (input: {
      turnId: string;
      knowledgeBaseId: string;
    }) => Promise<boolean>,
  ): Promise<ResolvedCitation> {
    if (actor.status !== "active") throw new AppError("USER_DISABLED");
    const citation =
      await this.prisma.conversationMessageKnowledgeCitation.findUnique({
        where: { id: citationId },
      });
    if (!citation) throw new AppError("NOT_FOUND");

    const [conversation, message] = await Promise.all([
      this.prisma.conversation.findFirst({
        where: { id: citation.conversationId, ownerId: actor.id },
        select: { id: true },
      }),
      this.prisma.conversationMessage.findFirst({
        where: {
          id: citation.messageId,
          conversationId: citation.conversationId,
          turnId: citation.turnId,
          role: "assistant",
        },
        select: { id: true },
      }),
    ]);
    if (
      !conversation ||
      !message ||
      citation.matchedChildIds.length === 0 ||
      new Set(citation.matchedChildIds).size !==
        citation.matchedChildIds.length ||
      !sameNumbers(
        citation.pageNumbers,
        uniqueSortedPages(citation.pageNumbers),
      ) ||
      citation.pageNumbers.some(
        (page) => !Number.isSafeInteger(page) || page <= 0,
      )
    ) {
      throw new AppError("NOT_FOUND");
    }

    const persisted: PersistedCitation = {
      citation: {
        id: citation.id,
        citationNo: citation.citationNo,
        knowledgeBaseId: citation.knowledgeBaseId,
        documentId: citation.documentId,
        documentVersionId: citation.documentVersionId,
        parentId: citation.parentId,
      },
      titlePath: citation.titlePath.map(sanitizeCitationLabel),
      matchedChildIds: citation.matchedChildIds,
      pageNumbers: citation.pageNumbers,
      knowledgeBaseNameSnapshot: citation.knowledgeBaseNameSnapshot,
      documentNameSnapshot: citation.documentNameSnapshot,
    };
    const [knowledgeBase, document, version] = await Promise.all([
      this.prisma.knowledgeBase.findFirst({
        where: { id: citation.knowledgeBaseId },
        select: { id: true, name: true },
      }),
      this.prisma.knowledgeBaseDocument.findFirst({
        where: {
          id: citation.documentId,
          knowledgeBaseId: citation.knowledgeBaseId,
        },
        select: { id: true, displayName: true, deletedAt: true },
      }),
      this.prisma.knowledgeBaseDocumentVersion.findFirst({
        where: {
          id: citation.documentVersionId,
          knowledgeBaseId: citation.knowledgeBaseId,
          documentId: citation.documentId,
        },
        select: { id: true, versionStatus: true },
      }),
    ]);
    if (
      !knowledgeBase ||
      !document ||
      !version ||
      document.deletedAt !== null ||
      (version.versionStatus !== "ready" &&
        version.versionStatus !== "superseded")
    ) {
      return this.#resolveHistoricalDeletion(persisted, {
        knowledgeBaseExists: knowledgeBase !== null,
        documentExists: document !== null,
        versionExists: version !== null,
      });
    }

    if (applicationAuthorization) {
      const authorized = await applicationAuthorization({
        turnId: citation.turnId,
        knowledgeBaseId: citation.knowledgeBaseId,
      });
      if (!authorized) throw new AppError("NOT_FOUND");
      return {
        status: "available",
        citation: persisted.citation,
        titlePath: persisted.titlePath,
        matchedChildIds: persisted.matchedChildIds,
        pageNumbers: persisted.pageNumbers,
        knowledgeBaseName: knowledgeBase.name,
        documentName: document.displayName,
        renderer: null,
      };
    }

    // This call is the current authorization and exact-version status check.
    // An administrator receives no content unless separately authorized.
    const documentView = await this.knowledge.getDocument(
      actor,
      citation.knowledgeBaseId,
      citation.documentId,
      citation.documentVersionId,
    );
    return {
      status: "available",
      citation: persisted.citation,
      titlePath: persisted.titlePath,
      matchedChildIds: persisted.matchedChildIds,
      pageNumbers: persisted.pageNumbers,
      knowledgeBaseName: knowledgeBase.name,
      documentName: document.displayName,
      renderer:
        documentView.preview.original_supported &&
        documentView.preview.renderer === "file"
          ? documentView.preview.renderer
          : null,
    };
  }

  async #resolveAvailableCitation(
    actor: KnowledgeActor,
    citationId: string,
  ): Promise<ResolvedAvailableCitation> {
    const resolved = await this.#resolveCitation(actor, citationId);
    if (resolved.status === "historical_unavailable") {
      throw new AppError("NOT_FOUND");
    }
    return resolved;
  }

  async #resolveHistoricalDeletion(
    persisted: PersistedCitation,
    live: {
      knowledgeBaseExists: boolean;
      documentExists: boolean;
      versionExists: boolean;
    },
  ): Promise<ResolvedHistoricalCitation> {
    // A tombstone is the only durable proof that missing live rows were
    // intentionally deleted. Logical deletion and partially converged cleanup
    // must keep failing closed until the exact live document and version rows
    // have disappeared and the corresponding cleanup is completed.
    if (live.documentExists || live.versionExists) {
      throw new AppError("NOT_FOUND");
    }
    const deletionCompleted = live.knowledgeBaseExists
      ? await this.prisma.knowledgeBaseDocumentTombstone.findFirst({
          where: {
            id: persisted.citation.documentId,
            knowledgeBaseId: persisted.citation.knowledgeBaseId,
            cleanupStatus: "completed",
          },
          select: { id: true },
        })
      : await this.prisma.knowledgeBaseTombstone.findFirst({
          where: {
            id: persisted.citation.knowledgeBaseId,
            cleanupStatus: "completed",
          },
          select: { id: true },
        });
    if (!deletionCompleted) throw new AppError("NOT_FOUND");
    return {
      status: "historical_unavailable",
      citation: persisted.citation,
      titlePath: persisted.titlePath,
      matchedChildIds: persisted.matchedChildIds,
      pageNumbers: persisted.pageNumbers,
      knowledgeBaseName: persisted.knowledgeBaseNameSnapshot,
      documentName: persisted.documentNameSnapshot,
    };
  }
}

function citationSummary(resolved: ResolvedCitation) {
  return {
    knowledge_base_name: resolved.knowledgeBaseName,
    document_name: resolved.documentName,
    title_path: resolved.titlePath,
    page_numbers: resolved.pageNumbers,
  };
}

export function sanitizeCitationExcerpt(value: string): string {
  return [
    ...value
      .replace(/<!--[\s\S]*?-->/gu, "")
      .replace(
        /!\[([^\]]*)\]\(\s*kb-asset:\/\/[A-Za-z0-9_-]+(?:\s+["'][^"']*["'])?\s*\)/gu,
        (_match, alt: string) => alt.trim(),
      )
      .replace(/kb-asset:\/\/[A-Za-z0-9_-]+/gu, ""),
  ]
    .map((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 0x08 ||
        codePoint === 0x0b ||
        codePoint === 0x0c ||
        (codePoint >= 0x0e && codePoint <= 0x1f) ||
        codePoint === 0x7f
        ? " "
        : character;
    })
    .join("")
    .trim();
}

function uniqueSortedPages(values: readonly number[]): number[] {
  return [...new Set(values)].sort((left, right) => left - right);
}

function sameNumbers(
  left: readonly number[],
  right: readonly number[],
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function sanitizeCitationLabel(value: string): string {
  return value
    .normalize("NFC")
    .split("")
    .map((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 0x1f || codePoint === 0x7f ? " " : character;
    })
    .join("")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 500);
}
