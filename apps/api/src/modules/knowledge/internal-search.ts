import { Buffer } from "node:buffer";

import {
  knowledgeDocumentFormatSchema,
  type KnowledgeDocumentListSuccess,
  type KnowledgeDocumentMarkdownSuccess,
  type KnowledgeSearchSuccess,
} from "@linksense/shared";

import type { PrismaClient } from "../../generated/prisma/client.js";
import { AppError } from "../../lib/errors.js";
import type { TurnKnowledgeSourceStore } from "../events/knowledge-source-store.js";
import type { KnowledgeRetrievalOrchestrator } from "../knowledge-processing/retrieval.js";
import type { ParentSearchHit } from "../knowledge-processing/elasticsearch.js";
import { isKnowledgeProcessingError } from "../knowledge-processing/errors.js";
import type { TurnKnowledgeDocumentReferenceStore } from "./knowledge-document-ref-store.js";
import { collectKnowledgeAssetReferenceIds } from "./knowledge-asset-reference.js";
import type { KnowledgeMaintenanceGate } from "./maintenance.js";
import type { KnowledgeActor } from "./types.js";
import type { ConversationAssetSnapshotWriter } from "./conversation-asset-snapshots.js";

const MAX_MCP_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_DOCUMENTS_PER_TOOL_PAGE = 100;
const MAX_MARKDOWN_BYTES_PER_TOOL_PAGE = 128 * 1024;
const SOURCE_REF_PLACEHOLDER = "x".repeat(32);
const DOCUMENT_REF_PLACEHOLDER = "d".repeat(32);

export type InternalKnowledgeSearchInput = {
  ownerId: string;
  conversationId: string;
  turnId: string;
  query: string;
  finalTopK: number;
  candidateMultiplier: number;
  numCandidates?: number;
  minScore: number;
  signal?: AbortSignal;
};

export type InternalKnowledgeSearchResult = KnowledgeSearchSuccess;

export type InternalKnowledgeDocumentListInput = {
  ownerId: string;
  conversationId: string;
  turnId: string;
  cursor?: string;
};

export type InternalKnowledgeDocumentMarkdownInput = {
  ownerId: string;
  conversationId: string;
  turnId: string;
  documentRef: string;
  cursor?: string;
};

export interface TurnKnowledgeScopeResolver {
  getTurnRetrievalScope(
    actor: KnowledgeActor,
    locator: { turnId?: string; codexTurnId?: string },
  ): Promise<{
    requested_ids: string[];
    usable_ids: string[];
    unavailable_ids: string[];
  }>;
  listDocuments(
    actor: KnowledgeActor,
    knowledgeBaseId: string,
    input: {
      status: "ready";
      cursor?: string;
      limit: number;
      turnId: string;
    },
  ): Promise<{
    items: Array<{
      id: string;
      display_name: string;
      canonical_extension: string;
      current_version_id: string | null;
      searchable: boolean;
    }>;
    next_cursor: string | null;
  }>;
  getParsedContentChunk(
    actor: KnowledgeActor,
    knowledgeBaseId: string,
    documentId: string,
    documentVersionId: string,
    input: {
      byteOffset: number;
      maxBytes: number;
      verifyIntegrity: boolean;
      turnId: string;
    },
  ): Promise<{
    markdown: string;
    byteStart: number;
    byteEnd: number;
    totalBytes: number;
    complete: boolean;
  }>;
}

/**
 * Resolves the immutable local-turn snapshot and intersects it with current
 * authorization on every call. Resource ids and Elasticsearch metadata never
 * cross the MCP boundary; only an opaque turn-scoped source handle does.
 */
export class InternalKnowledgeSearchService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly scopes: TurnKnowledgeScopeResolver,
    private readonly retrieval: KnowledgeRetrievalOrchestrator,
    private readonly sourceStore: TurnKnowledgeSourceStore,
    private readonly documentReferences: TurnKnowledgeDocumentReferenceStore,
    private readonly assetSnapshots: ConversationAssetSnapshotWriter,
    private readonly maintenanceGate?: Pick<
      KnowledgeMaintenanceGate,
      "assertAvailable"
    >,
  ) {}

  async search(
    input: InternalKnowledgeSearchInput,
  ): Promise<InternalKnowledgeSearchResult> {
    const { actor, projectionTurnId, scope } =
      await this.#resolveTurnContext(input);
    await this.maintenanceGate?.assertAvailable();

    let parents: ParentSearchHit[];
    try {
      parents = (
        await this.retrieval.search({
          query: input.query,
          authorizedKnowledgeBaseIds: scope.usable_ids,
          usageContext: {
            ownerId: input.ownerId,
            conversationId: input.conversationId,
            turnId: projectionTurnId,
          },
          ...(input.signal ? { signal: input.signal } : {}),
          filterCandidates: async (candidates) => {
            const currentScope = await this.scopes.getTurnRetrievalScope(
              actor,
              {
                turnId: projectionTurnId,
              },
            );
            return (
              await this.#loadSafeParents(
                candidates,
                new Set(currentScope.usable_ids),
              )
            ).map(({ parent }) => parent);
          },
          parameters: {
            finalTopK: input.finalTopK,
            candidateMultiplier: input.candidateMultiplier,
            ...(input.numCandidates === undefined
              ? {}
              : { numCandidates: input.numCandidates }),
            minScore: input.minScore,
          },
        })
      ).parents;
    } catch (error) {
      if (
        isKnowledgeProcessingError(error) &&
        error.code === "KNOWLEDGE_RETRIEVAL_PARAMETERS_INVALID"
      ) {
        throw new AppError("VALIDATION_ERROR");
      }
      throw new AppError("KNOWLEDGE_SEARCH_UNAVAILABLE");
    }

    // Recheck after the external request so a concurrent revoke/archive cannot
    // leak a result that was authorized only at the start of this call.
    const finalScope = await this.scopes.getTurnRetrievalScope(actor, {
      turnId: projectionTurnId,
    });
    const usableIds = new Set(finalScope.usable_ids);
    const safeParents = await this.#loadSafeParents(parents, usableIds);

    const preflight = safeParents.map(({ parent, base, document }) => ({
      source_ref: SOURCE_REF_PLACEHOLDER,
      citation_marker: `[[kb-source:${SOURCE_REF_PLACEHOLDER}]]`,
      document_ref: DOCUMENT_REF_PLACEHOLDER,
      knowledge_base_name: safeLabel(base.name, 200),
      document_name: safeLabel(document.displayName, 260),
      document_version_id: parent.documentVersionId,
      title_path: citationTitlePath(parent)
        .map((value) => safeLabel(value, 500))
        .filter((value) => value !== "-"),
      page_numbers: evidencePageNumbers(parent),
      location: parentLocation(parent, document.canonicalExtension),
      content: parent.parentText,
    }));
    assertResponseSize({
      success: true,
      results: preflight,
      unavailable_knowledge_base_count: finalScope.unavailable_ids.length,
    });

    await this.assetSnapshots.capture({
      actor,
      conversationId: input.conversationId,
      turnId: projectionTurnId,
      sources: safeParents.map(({ parent }) => ({
        knowledgeBaseId: parent.knowledgeBaseId,
        documentId: parent.documentId,
        documentVersionId: parent.documentVersionId,
        assetReferenceIds: collectKnowledgeAssetReferenceIds(parent.parentText),
      })),
    });
    const registered = await this.sourceStore.register(
      projectionTurnId,
      safeParents.map(({ parent }) => ({
        knowledgeBaseId: parent.knowledgeBaseId,
        documentId: parent.documentId,
        documentVersionId: parent.documentVersionId,
        parentId: parent.parentId,
        titlePath: citationTitlePath(parent),
        matchedChildIds: evidenceChildren(parent).map((child) => child.childId),
        pageNumbers: evidencePageNumbers(parent),
      })),
    );
    const documentRefs = await Promise.all(
      safeParents.map(({ parent }) =>
        this.documentReferences.registerDocument(projectionTurnId, {
          knowledgeBaseId: parent.knowledgeBaseId,
          documentId: parent.documentId,
          documentVersionId: parent.documentVersionId,
        }),
      ),
    );
    return {
      success: true,
      results: preflight.map((result, index) => {
        const sourceRef = registered[index]?.sourceRef;
        const documentRef = documentRefs[index];
        if (!sourceRef || !documentRef) {
          throw new AppError("KNOWLEDGE_SEARCH_UNAVAILABLE");
        }
        return {
          ...result,
          source_ref: sourceRef,
          citation_marker: `[[kb-source:${sourceRef}]]`,
          document_ref: documentRef,
        };
      }),
      unavailable_knowledge_base_count: finalScope.unavailable_ids.length,
    };
  }

  async listDocuments(
    input: InternalKnowledgeDocumentListInput,
  ): Promise<KnowledgeDocumentListSuccess> {
    const { actor, projectionTurnId, scope } =
      await this.#resolveTurnContext(input);
    const cursor =
      input.cursor === undefined
        ? {
            knowledgeBaseId: scope.usable_ids[0]!,
            documentCursor: null,
          }
        : await this.documentReferences.readListCursor(
            projectionTurnId,
            input.cursor,
          );
    if (cursor === null) throw new AppError("VALIDATION_ERROR");
    const baseIndex = scope.usable_ids.indexOf(cursor.knowledgeBaseId);
    if (baseIndex < 0) throw new AppError("FORBIDDEN");

    const base = await this.prisma.knowledgeBase.findFirst({
      where: {
        id: cursor.knowledgeBaseId,
        lifecycleStatus: "active",
        availabilityStatus: "enabled",
      },
      select: { id: true, name: true },
    });
    if (base === null) throw new AppError("FORBIDDEN");
    const page = await this.scopes.listDocuments(actor, base.id, {
      status: "ready",
      ...(cursor.documentCursor === null
        ? {}
        : { cursor: cursor.documentCursor }),
      limit: MAX_DOCUMENTS_PER_TOOL_PAGE,
      turnId: projectionTurnId,
    });
    const visible = page.items.filter(
      (
        document,
      ): document is typeof document & { current_version_id: string } =>
        document.searchable && document.current_version_id !== null,
    );
    const finalScope = await this.scopes.getTurnRetrievalScope(actor, {
      turnId: projectionTurnId,
    });
    if (!finalScope.usable_ids.includes(base.id)) {
      throw new AppError("FORBIDDEN");
    }
    const documentRefs = await Promise.all(
      visible.map((document) =>
        this.documentReferences.registerDocument(projectionTurnId, {
          knowledgeBaseId: base.id,
          documentId: document.id,
          documentVersionId: document.current_version_id,
        }),
      ),
    );
    const nextState =
      page.next_cursor !== null
        ? {
            knowledgeBaseId: base.id,
            documentCursor: page.next_cursor,
          }
        : baseIndex + 1 < scope.usable_ids.length
          ? {
              knowledgeBaseId: scope.usable_ids[baseIndex + 1]!,
              documentCursor: null,
            }
          : null;
    const nextCursor =
      nextState === null
        ? null
        : await this.documentReferences.registerListCursor(
            projectionTurnId,
            nextState,
          );
    const result: KnowledgeDocumentListSuccess = {
      success: true,
      documents: visible.map((document, index) => ({
        document_ref: documentRefs[index]!,
        knowledge_base_name: safeLabel(base.name, 200),
        document_name: safeLabel(document.display_name, 260),
        file_type: knowledgeDocumentFormatSchema.parse(
          document.canonical_extension,
        ),
      })),
      next_cursor: nextCursor,
      unavailable_knowledge_base_count: finalScope.unavailable_ids.length,
    };
    assertResponseSize(result, "KNOWLEDGE_PROCESSING_UNAVAILABLE");
    return result;
  }

  async getDocumentMarkdown(
    input: InternalKnowledgeDocumentMarkdownInput,
  ): Promise<KnowledgeDocumentMarkdownSuccess> {
    const { actor, projectionTurnId, scope } =
      await this.#resolveTurnContext(input);
    const reference = await this.documentReferences.readDocument(
      projectionTurnId,
      input.documentRef,
    );
    if (reference === null) throw new AppError("KNOWLEDGE_DOCUMENT_NOT_FOUND");
    if (!scope.usable_ids.includes(reference.knowledgeBaseId)) {
      throw new AppError("FORBIDDEN");
    }

    const markdownCursor =
      input.cursor === undefined
        ? {
            documentRef: input.documentRef,
            byteOffset: 0,
            chunkIndex: 0,
          }
        : await this.documentReferences.readMarkdownCursor(
            projectionTurnId,
            input.cursor,
          );
    if (
      markdownCursor === null ||
      markdownCursor.documentRef !== input.documentRef
    ) {
      throw new AppError("VALIDATION_ERROR");
    }

    const chunk = await this.scopes.getParsedContentChunk(
      actor,
      reference.knowledgeBaseId,
      reference.documentId,
      reference.documentVersionId,
      {
        byteOffset: markdownCursor.byteOffset,
        maxBytes: MAX_MARKDOWN_BYTES_PER_TOOL_PAGE,
        verifyIntegrity: !reference.contentVerified,
        turnId: projectionTurnId,
      },
    );
    if (
      !reference.contentVerified &&
      !(await this.documentReferences.markContentVerified(
        projectionTurnId,
        input.documentRef,
      ))
    ) {
      throw new AppError("KNOWLEDGE_PROCESSING_UNAVAILABLE");
    }

    // Recheck after object storage access so a concurrent revoke, archive, or
    // disable cannot leak bytes that were only authorized at call start.
    const finalScope = await this.scopes.getTurnRetrievalScope(actor, {
      turnId: projectionTurnId,
    });
    if (!finalScope.usable_ids.includes(reference.knowledgeBaseId)) {
      throw new AppError("FORBIDDEN");
    }
    const [base, document] = await Promise.all([
      this.prisma.knowledgeBase.findFirst({
        where: {
          id: reference.knowledgeBaseId,
          lifecycleStatus: "active",
          availabilityStatus: "enabled",
        },
        select: { name: true },
      }),
      this.prisma.knowledgeBaseDocument.findFirst({
        where: {
          id: reference.documentId,
          knowledgeBaseId: reference.knowledgeBaseId,
          currentVersionId: reference.documentVersionId,
          status: "ready",
        },
        select: {
          displayName: true,
          canonicalExtension: true,
        },
      }),
    ]);
    if (base === null || document === null) {
      throw new AppError("KNOWLEDGE_DOCUMENT_NOT_FOUND");
    }
    const nextCursor = chunk.complete
      ? null
      : await this.documentReferences.registerMarkdownCursor(projectionTurnId, {
          documentRef: input.documentRef,
          byteOffset: chunk.byteEnd,
          chunkIndex: markdownCursor.chunkIndex + 1,
        });
    const result: KnowledgeDocumentMarkdownSuccess = {
      success: true,
      document_ref: input.documentRef,
      knowledge_base_name: safeLabel(base.name, 200),
      document_name: safeLabel(document.displayName, 260),
      file_type: knowledgeDocumentFormatSchema.parse(
        document.canonicalExtension,
      ),
      markdown: chunk.markdown,
      chunk_index: markdownCursor.chunkIndex,
      byte_start: chunk.byteStart,
      byte_end: chunk.byteEnd,
      total_bytes: chunk.totalBytes,
      next_cursor: nextCursor,
      complete: chunk.complete,
    };
    assertResponseSize(result, "KNOWLEDGE_PROCESSING_UNAVAILABLE");
    const assetReferenceIds = collectKnowledgeAssetReferenceIds(chunk.markdown);
    if (assetReferenceIds.length > 0) {
      await this.assetSnapshots.capture({
        actor,
        conversationId: input.conversationId,
        turnId: projectionTurnId,
        sources: [{
          knowledgeBaseId: reference.knowledgeBaseId,
          documentId: reference.documentId,
          documentVersionId: reference.documentVersionId,
          assetReferenceIds,
        }],
      });
    }
    return result;
  }

  async #resolveTurnContext(input: {
    ownerId: string;
    conversationId: string;
    turnId: string;
  }): Promise<{
    actor: KnowledgeActor;
    projectionTurnId: string;
    scope: {
      requested_ids: string[];
      usable_ids: string[];
      unavailable_ids: string[];
    };
  }> {
    const [turn, startIntent, user] = await Promise.all([
      this.prisma.conversationTurn.findFirst({
        where: {
          id: input.turnId,
          conversationId: input.conversationId,
          submittedBy: input.ownerId,
          status: "running",
        },
        select: { id: true },
      }),
      this.prisma.conversationTurnStartIntent.findFirst({
        where: {
          projectionTurnId: input.turnId,
          conversationId: input.conversationId,
          ownerId: input.ownerId,
          runnerStatus: "runner_succeeded",
        },
        select: { projectionTurnId: true },
      }),
      this.prisma.user.findUnique({
        where: { id: input.ownerId },
        select: { id: true, role: true, status: true },
      }),
    ]);
    if (
      (turn === null && startIntent === null) ||
      user === null ||
      (user.role !== "user" && user.role !== "admin") ||
      user.status !== "active"
    ) {
      throw new AppError("FORBIDDEN");
    }
    const actor: KnowledgeActor = {
      id: user.id,
      role: user.role,
      status: "active",
    };
    const projectionTurnId = turn?.id ?? startIntent!.projectionTurnId;
    const scope = await this.scopes.getTurnRetrievalScope(actor, {
      turnId: projectionTurnId,
    });
    if (scope.usable_ids.length === 0) {
      throw new AppError("KNOWLEDGE_NO_AVAILABLE_BASES");
    }
    return { actor, projectionTurnId, scope };
  }

  async #loadSafeParents<T extends ParentSearchHit>(
    parents: readonly T[],
    usableKnowledgeBaseIds: ReadonlySet<string>,
  ): Promise<
    Array<{
      parent: T;
      base: { id: string; name: string };
      document: {
        id: string;
        knowledgeBaseId: string;
        displayName: string;
        canonicalExtension: string;
        currentVersionId: string | null;
      };
    }>
  > {
    const candidateParents = parents.filter((parent) =>
      usableKnowledgeBaseIds.has(parent.knowledgeBaseId),
    );
    const [bases, documents] = await Promise.all([
      this.prisma.knowledgeBase.findMany({
        where: {
          id: {
            in: [
              ...new Set(
                candidateParents.map((parent) => parent.knowledgeBaseId),
              ),
            ],
          },
          lifecycleStatus: "active",
          availabilityStatus: "enabled",
        },
        select: { id: true, name: true },
      }),
      this.prisma.knowledgeBaseDocument.findMany({
        where: {
          id: {
            in: [
              ...new Set(candidateParents.map((parent) => parent.documentId)),
            ],
          },
          status: "ready",
        },
        select: {
          id: true,
          knowledgeBaseId: true,
          displayName: true,
          canonicalExtension: true,
          currentVersionId: true,
        },
      }),
    ]);
    const baseById = new Map(bases.map((base) => [base.id, base]));
    const documentById = new Map(
      documents.map((document) => [document.id, document]),
    );
    return candidateParents.flatMap((parent) => {
      const base = baseById.get(parent.knowledgeBaseId);
      const document = documentById.get(parent.documentId);
      if (
        base === undefined ||
        document === undefined ||
        document.knowledgeBaseId !== parent.knowledgeBaseId ||
        document.currentVersionId !== parent.documentVersionId ||
        parent.parentText.trim() === "" ||
        !hasValidMatchedChildren(parent)
      ) {
        return [];
      }
      return [{ parent, base, document }];
    });
  }
}

function parentLocation(parent: ParentSearchHit, extension: string): string {
  const titlePath = parent.titlePath
    .map((value) => safeLabel(value, 200))
    .filter(Boolean)
    .join(" › ");
  const pages = evidencePageNumbers(parent);
  const source =
    pages.length > 0
      ? `${["ppt", "pptx", "odp"].includes(extension) ? "slide" : "page"} ${compactNumberRange(pages)}`
      : "document";
  return safeLabel(titlePath ? `${source} · ${titlePath}` : source, 1_000);
}

function evidenceChildren(parent: ParentSearchHit) {
  return [...parent.matchedChildren].sort(
    (left, right) =>
      left.order - right.order || left.childId.localeCompare(right.childId),
  );
}

function evidencePageNumbers(parent: ParentSearchHit): number[] {
  return [
    ...new Set(evidenceChildren(parent).flatMap((child) => child.pageNumbers)),
  ].sort((left, right) => left - right);
}

function citationTitlePath(parent: ParentSearchHit): string[] {
  const matchedPath =
    evidenceChildren(parent).find((child) => child.titlePath.length > 0)
      ?.titlePath ?? parent.titlePath;
  return matchedPath
    .map((value) => safeLabel(value, 500))
    .filter((value) => value !== "-");
}

function hasValidMatchedChildren(parent: ParentSearchHit): boolean {
  if (parent.matchedChildren.length === 0) return false;
  const parentChildIds = new Set(parent.childIds);
  return parent.matchedChildren.every(
    (child) =>
      parentChildIds.has(child.childId) &&
      child.rawText.trim() !== "" &&
      child.pageNumbers.every((page) => Number.isSafeInteger(page) && page > 0),
  );
}

function compactNumberRange(values: number[]): string {
  if (values.length === 0) return "";
  if (values.length === 1) return String(values[0]);
  const first = values[0]!;
  const last = values.at(-1)!;
  return values.every((value, index) => value === first + index)
    ? `${first}-${last}`
    : values.join(",");
}

function safeLabel(value: string, maximumLength: number): string {
  return (
    [...value.normalize("NFC")]
      .map((character) => {
        const codePoint = character.codePointAt(0) ?? 0;
        return codePoint <= 0x1f || codePoint === 0x7f ? " " : character;
      })
      .join("")
      .replace(/\s+/gu, " ")
      .trim()
      .slice(0, maximumLength) || "-"
  );
}

function assertResponseSize(
  value:
    | InternalKnowledgeSearchResult
    | KnowledgeDocumentListSuccess
    | KnowledgeDocumentMarkdownSuccess,
  errorCode:
    | "KNOWLEDGE_SEARCH_UNAVAILABLE"
    | "KNOWLEDGE_PROCESSING_UNAVAILABLE" = "KNOWLEDGE_SEARCH_UNAVAILABLE",
): void {
  if (
    Buffer.byteLength(JSON.stringify(value), "utf8") > MAX_MCP_RESPONSE_BYTES
  ) {
    throw new AppError(errorCode);
  }
}
