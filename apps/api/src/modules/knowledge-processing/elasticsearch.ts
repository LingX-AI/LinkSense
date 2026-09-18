import { createHash } from "node:crypto";

import { Client } from "@elastic/elasticsearch";
import { z } from "zod";

import { validateEmbeddingVector } from "./embedding.js";
import { KnowledgeProcessingError } from "./errors.js";

export type IndexedKnowledgeChild = {
  childId: string;
  order: number;
  text: string;
  rawText: string;
  titlePath: string[];
  captions: string[];
  docItems: string[];
  pageNumbers: number[];
  numTokens: number;
  contentHash: string;
  vector: number[];
};

export type IndexedParentDocument = {
  parentId: string;
  parentOrder: number;
  knowledgeBaseId: string;
  documentId: string;
  documentVersionId: string;
  embeddingProfileHash: string;
  titlePath: string[];
  parentText: string;
  pageNumbers: number[];
  contentHash: string;
  childIds: string[];
  childCount: number;
  children: IndexedKnowledgeChild[];
};

type KnowledgeIndexIntegrityParent = Omit<
  IndexedParentDocument,
  | "knowledgeBaseId"
  | "documentId"
  | "documentVersionId"
  | "embeddingProfileHash"
  | "parentText"
  | "children"
> & {
  children: Array<Omit<IndexedKnowledgeChild, "text" | "rawText" | "vector">>;
};

export type MatchedKnowledgeChild = {
  childId: string;
  order: number;
  rawText: string;
  titlePath: string[];
  pageNumbers: number[];
  score: number;
  matchKinds: Array<"dense" | "lexical">;
};

export type ParentSearchHit = {
  parentId: string;
  parentOrder: number;
  knowledgeBaseId: string;
  documentId: string;
  documentVersionId: string;
  titlePath: string[];
  parentText: string;
  pageNumbers: number[];
  childIds: string[];
  childCount: number;
  matchedChildren: MatchedKnowledgeChild[];
  score: number;
};

export type ParentEvidence = {
  parentId: string;
  parentText: string;
  matchedChildren: Array<{
    childId: string;
    order: number;
    rawText: string;
    titlePath: string[];
    pageNumbers: number[];
  }>;
};

export type KnowledgeSearchFilter = {
  knowledgeBaseIds: string[];
  embeddingProfileHash: string;
};

export const KNOWLEDGE_INDEX_CONTRACT_VERSION = 1;

export type KnowledgeIndexContractState = "missing" | "ready" | "incompatible";

export interface ElasticsearchClientPort {
  ping(): Promise<unknown>;
  indexExists(index: string, signal?: AbortSignal): Promise<boolean>;
  createIndex(
    index: string,
    mappings: Record<string, unknown>,
  ): Promise<unknown>;
  deleteIndex(index: string): Promise<unknown>;
  getMapping(index: string, signal?: AbortSignal): Promise<unknown>;
  bulk(operations: unknown[]): Promise<unknown>;
  search(
    index: string,
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<unknown>;
  updateByQuery(input: {
    index: string;
    routing?: string;
    query: Record<string, unknown>;
    script: Record<string, unknown>;
    signal?: AbortSignal;
  }): Promise<unknown>;
  deleteByQuery(input: {
    index: string;
    routing: string;
    query: Record<string, unknown>;
    signal?: AbortSignal;
  }): Promise<unknown>;
  count(input: {
    index: string;
    routing?: string;
    query: Record<string, unknown>;
    signal?: AbortSignal;
  }): Promise<unknown>;
}

class OfficialElasticsearchClientPort implements ElasticsearchClientPort {
  constructor(private readonly client: Client) {}

  ping(): Promise<unknown> {
    return this.client.ping();
  }

  async indexExists(index: string, signal?: AbortSignal): Promise<boolean> {
    return Boolean(await this.client.indices.exists({ index }, signal ? { signal } : undefined));
  }

  createIndex(
    index: string,
    mappings: Record<string, unknown>,
  ): Promise<unknown> {
    return this.client.indices.create({ index, mappings });
  }

  deleteIndex(index: string): Promise<unknown> {
    return this.client.indices.delete({ index });
  }

  getMapping(index: string, signal?: AbortSignal): Promise<unknown> {
    return this.client.indices.getMapping({ index }, signal ? { signal } : undefined);
  }

  bulk(operations: unknown[]): Promise<unknown> {
    return this.client.bulk({ operations, refresh: "wait_for" });
  }

  search(
    index: string,
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<unknown> {
    return signal
      ? this.client.search({ index, ...body }, { signal })
      : this.client.search({ index, ...body });
  }

  updateByQuery(input: {
    index: string;
    routing?: string;
    query: Record<string, unknown>;
    script: Record<string, unknown>;
    signal?: AbortSignal;
  }): Promise<unknown> {
    return this.client.updateByQuery({
      index: input.index,
      ...(input.routing === undefined ? {} : { routing: input.routing }),
      query: input.query,
      script: input.script,
      refresh: true,
      conflicts: "abort",
    }, input.signal ? { signal: input.signal } : undefined);
  }

  deleteByQuery(input: {
    index: string;
    routing: string;
    query: Record<string, unknown>;
    signal?: AbortSignal;
  }): Promise<unknown> {
    return this.client.deleteByQuery({
      index: input.index,
      routing: input.routing,
      query: input.query,
      refresh: true,
      conflicts: "proceed",
    }, input.signal ? { signal: input.signal } : undefined);
  }

  count(input: {
    index: string;
    routing?: string;
    query: Record<string, unknown>;
    signal?: AbortSignal;
  }): Promise<unknown> {
    const { signal, ...request } = input;
    return this.client.count(request, signal ? { signal } : undefined);
  }
}

const childSourceSchema = z.object({
  child_id: z.string().min(1).max(160),
  order: z.number().int().nonnegative(),
  raw_text: z.string().min(1),
  headings: z.array(z.string()),
  page_numbers: z.array(z.number().int().positive()),
});

const innerHitSchema = z.object({
  _score: z.number().finite().nullable(),
  _source: childSourceSchema,
});

const searchHitSchema = z.object({
  _id: z.string(),
  _score: z.number().finite().nullable(),
  _source: z.object({
    parent_id: z.string().uuid(),
    parent_order: z.number().int().nonnegative(),
    knowledge_base_id: z.string().uuid(),
    document_id: z.string().uuid(),
    document_version_id: z.string().uuid(),
    title_path: z.array(z.string()),
    parent_text: z.string().min(1),
    page_numbers: z.array(z.number().int().positive()),
    child_ids: z.array(z.string().min(1).max(160)),
    child_count: z.number().int().positive(),
  }),
  inner_hits: z.object({
    matched_children: z.object({
      hits: z.object({
        hits: z.array(innerHitSchema).min(1),
      }),
    }),
  }),
});

const searchResponseSchema = z.object({
  hits: z.object({ hits: z.array(searchHitSchema) }),
});

const evidenceSearchResponseSchema = z.object({
  hits: z.object({
    hits: z
      .array(
        z.object({
          _source: z.object({
            parent_id: z.string().uuid(),
            parent_text: z.string().min(1),
            children: z.array(childSourceSchema).min(1),
          }),
        }),
      )
      .max(1),
  }),
});

const integrityChildSchema = z.object({
  child_id: z.string().min(1).max(160),
  order: z.number().int().nonnegative(),
  headings: z.array(z.string()),
  captions: z.array(z.string()),
  doc_items: z.array(z.string()),
  page_numbers: z.array(z.number().int().positive()),
  num_tokens: z.number().int().positive(),
  content_hash: z.string().regex(/^[a-f0-9]{64}$/u),
});

const integritySearchResponseSchema = z.object({
  hits: z.object({
    hits: z.array(
      z.object({
        sort: z.array(z.union([z.string(), z.number()])),
        _source: z.object({
          parent_id: z.string().uuid(),
          parent_order: z.number().int().nonnegative(),
          knowledge_base_id: z.string().uuid(),
          document_id: z.string().uuid(),
          document_version_id: z.string().uuid(),
          embedding_profile_hash: z.string().regex(/^[a-f0-9]{64}$/u),
          title_path: z.array(z.string()),
          page_numbers: z.array(z.number().int().positive()),
          content_hash: z.string().regex(/^[a-f0-9]{64}$/u),
          child_ids: z.array(z.string().min(1).max(160)),
          child_count: z.number().int().positive(),
          children: z.array(integrityChildSchema).min(1),
        }),
      }),
    ),
  }),
});

const bulkResponseSchema = z.object({
  errors: z.boolean(),
  items: z.array(z.record(z.string(), z.unknown())),
});
const countResponseSchema = z.object({ count: z.number().int().nonnegative() });
const updateByQueryResponseSchema = z.object({
  timed_out: z.boolean().optional().default(false),
  version_conflicts: z.number().int().nonnegative().optional().default(0),
  failures: z.array(z.unknown()).optional().default([]),
});
const documentIdentitySchema = z.strictObject({
  knowledgeBaseId: z.string().uuid(),
  documentId: z.string().uuid(),
});
const documentVersionIdentitySchema = documentIdentitySchema.extend({
  documentVersionId: z.string().uuid(),
});

/**
 * Digest of all non-vector child and parent identity fields. It detects stale,
 * missing, duplicated or reordered Hybrid chunks without loading vectors or
 * large retrieval text from Elasticsearch.
 */
export function indexIntegrityDigest(
  parents: readonly KnowledgeIndexIntegrityParent[],
): string {
  const canonical = [...parents]
    .sort(
      (left, right) =>
        left.parentOrder - right.parentOrder ||
        left.parentId.localeCompare(right.parentId),
    )
    .map((parent) => ({
      parentId: parent.parentId,
      parentOrder: parent.parentOrder,
      titlePath: parent.titlePath,
      pageNumbers: parent.pageNumbers,
      contentHash: parent.contentHash,
      childIds: parent.childIds,
      childCount: parent.childCount,
      children: [...parent.children]
        .sort((left, right) => left.order - right.order)
        .map((child) => ({
          childId: child.childId,
          order: child.order,
          titlePath: child.titlePath,
          captions: child.captions,
          docItems: child.docItems,
          pageNumbers: child.pageNumbers,
          numTokens: child.numTokens,
          contentHash: child.contentHash,
        })),
    }));
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

export class ElasticsearchKnowledgeAdapter {
  private readonly client: ElasticsearchClientPort;
  private contractVerified = false;

  constructor(
    private readonly config: {
      url: string;
      username: string;
      password: string;
      index: string;
      dimensions: number;
      maximumNumCandidates?: number;
    },
    client?: ElasticsearchClientPort,
  ) {
    this.client =
      client ??
      new OfficialElasticsearchClientPort(
        new Client({
          node: config.url,
          auth: { username: config.username, password: config.password },
          requestTimeout: 60_000,
          maxRetries: 0,
        }),
      );
  }

  async health(): Promise<void> {
    try {
      this.contractVerified = false;
      await this.client.ping();
      if (!(await this.client.indexExists(this.config.index))) return;
      await this.verifyIndexContract();
    } catch (error) {
      if (error instanceof KnowledgeProcessingError) throw error;
      throw elasticsearchError(error, true);
    }
  }

  async ensureIndex(): Promise<void> {
    try {
      if (!(await this.client.indexExists(this.config.index))) {
        await this.client.createIndex(
          this.config.index,
          knowledgeIndexMappings(this.config.dimensions),
        );
      }
      await this.verifyIndexContract();
    } catch (error) {
      if (error instanceof KnowledgeProcessingError) throw error;
      throw elasticsearchError(error, isRetryableElasticsearchError(error));
    }
  }

  async recreateIndex(): Promise<void> {
    try {
      this.contractVerified = false;
      if (await this.client.indexExists(this.config.index)) {
        await this.client.deleteIndex(this.config.index);
      }
      await this.client.createIndex(
        this.config.index,
        knowledgeIndexMappings(this.config.dimensions),
      );
      await this.verifyIndexContract();
    } catch (error) {
      if (error instanceof KnowledgeProcessingError) throw error;
      throw elasticsearchError(error, isRetryableElasticsearchError(error));
    }
  }

  async verifyIndexContract(signal?: AbortSignal): Promise<void> {
    this.contractVerified = false;
    readIndexContract(
      await this.client.getMapping(this.config.index, signal),
      this.config.index,
      this.config.dimensions,
    );
    this.contractVerified = true;
  }

  async getIndexContractState(): Promise<KnowledgeIndexContractState> {
    try {
      if (!(await this.client.indexExists(this.config.index))) return "missing";
      try {
        readIndexContract(
          await this.client.getMapping(this.config.index),
          this.config.index,
          this.config.dimensions,
        );
        return "ready";
      } catch (error) {
        if (
          error instanceof KnowledgeProcessingError &&
          (error.code === "KNOWLEDGE_ELASTICSEARCH_CONTRACT_INCOMPATIBLE" ||
            error.code === "EMBEDDING_DIMENSION_MISMATCH")
        ) {
          return "incompatible";
        }
        throw error;
      }
    } catch (error) {
      if (error instanceof KnowledgeProcessingError) throw error;
      throw elasticsearchError(error, isRetryableElasticsearchError(error));
    }
  }

  async replaceDocumentVersion(input: {
    knowledgeBaseId: string;
    documentId: string;
    documentVersionId: string;
    parents: IndexedParentDocument[];
  }): Promise<void> {
    validateReplacementInput(input, this.config.dimensions);
    await this.replaceParents({
      replacement: input,
      countQuery: documentVersionScopeQuery(
        input.knowledgeBaseId,
        input.documentId,
        input.documentVersionId,
      ),
      deleteExisting: () =>
        this.deleteDocumentVersion({
          knowledgeBaseId: input.knowledgeBaseId,
          documentId: input.documentId,
          documentVersionId: input.documentVersionId,
        }),
    });
  }

  async replaceWholeDocument(input: {
    knowledgeBaseId: string;
    documentId: string;
    documentVersionId: string;
    parents: IndexedParentDocument[];
  }): Promise<void> {
    validateReplacementInput(input, this.config.dimensions);
    await this.replaceParents({
      replacement: input,
      countQuery: documentScopeQuery(input.knowledgeBaseId, input.documentId),
      deleteExisting: () =>
        this.deleteDocument(input.knowledgeBaseId, input.documentId),
    });
  }

  validateCandidateDocumentVersion(input: {
    knowledgeBaseId: string;
    documentId: string;
    documentVersionId: string;
    parents: IndexedParentDocument[];
  }): void {
    validateReplacementInput(input, this.config.dimensions);
  }

  async verifyDocumentVersionCandidate(input: {
    knowledgeBaseId: string;
    documentId: string;
    documentVersionId: string;
    expectedParentCount: number;
    expectedChildCount: number;
    expectedEmbeddingProfileHash: string;
    expectedIndexIntegrityDigest: string;
  }): Promise<void> {
    try {
      await this.assertIndexContractReady();
      await this.assertDocumentVersionCount(input);
      await this.assertDocumentVersionIntegrity(input);
      const response = countResponseSchema.safeParse(
        await this.client.count({
          index: this.config.index,
          routing: input.documentId,
          query: nonSearchableDocumentVersionScopeQuery(
            input.knowledgeBaseId,
            input.documentId,
            input.documentVersionId,
          ),
        }),
      );
      if (
        !response.success ||
        response.data.count !== input.expectedParentCount
      ) {
        throw elasticsearchError(
          response.success ? undefined : response.error,
          true,
        );
      }
    } catch (error) {
      if (error instanceof KnowledgeProcessingError) throw error;
      throw elasticsearchError(error, isRetryableElasticsearchError(error));
    }
  }

  async deleteDocumentVersion(input: {
    knowledgeBaseId: string;
    documentId: string;
    documentVersionId: string;
  }): Promise<void> {
    const identity = documentVersionIdentitySchema.safeParse(input);
    if (!identity.success) throw elasticsearchError(identity.error, false);
    try {
      await this.client.deleteByQuery({
        index: this.config.index,
        routing: input.documentId,
        query: documentVersionScopeQuery(
          input.knowledgeBaseId,
          input.documentId,
          input.documentVersionId,
        ),
      });
    } catch (error) {
      throw elasticsearchError(error, isRetryableElasticsearchError(error));
    }
  }

  async deleteDocument(
    knowledgeBaseId: string,
    documentId: string,
  ): Promise<void> {
    const identity = documentIdentitySchema.safeParse({
      knowledgeBaseId,
      documentId,
    });
    if (!identity.success) throw elasticsearchError(identity.error, false);
    try {
      await this.client.deleteByQuery({
        index: this.config.index,
        routing: documentId,
        query: documentScopeQuery(knowledgeBaseId, documentId),
      });
    } catch (error) {
      throw elasticsearchError(error, isRetryableElasticsearchError(error));
    }
  }

  async reconcileActiveDocumentVersion(input: {
    knowledgeBaseId: string;
    documentId: string;
    activeDocumentVersionId: string;
    expectedParentCount: number;
    expectedChildCount?: number;
    expectedEmbeddingProfileHash?: string;
    expectedIndexIntegrityDigest?: string;
    preserveOtherVersions?: boolean;
    signal?: AbortSignal;
  }): Promise<void> {
    const identity = documentVersionIdentitySchema.safeParse({
      knowledgeBaseId: input.knowledgeBaseId,
      documentId: input.documentId,
      documentVersionId: input.activeDocumentVersionId,
    });
    if (
      !identity.success ||
      !Number.isSafeInteger(input.expectedParentCount) ||
      input.expectedParentCount <= 0
    ) {
      throw elasticsearchError(
        identity.success ? undefined : identity.error,
        false,
      );
    }
    try {
      await this.assertIndexContractReady(input.signal);
      const version = {
        knowledgeBaseId: input.knowledgeBaseId,
        documentId: input.documentId,
        documentVersionId: input.activeDocumentVersionId,
        expectedParentCount: input.expectedParentCount,
        ...(input.signal ? { signal: input.signal } : {}),
      };
      await this.assertDocumentVersionCount(version);
      if (
        input.expectedChildCount !== undefined ||
        input.expectedEmbeddingProfileHash !== undefined ||
        input.expectedIndexIntegrityDigest !== undefined
      ) {
        if (
          !Number.isSafeInteger(input.expectedChildCount) ||
          (input.expectedChildCount ?? 0) <= 0 ||
          !/^[a-f0-9]{64}$/u.test(input.expectedEmbeddingProfileHash ?? "") ||
          !/^[a-f0-9]{64}$/u.test(input.expectedIndexIntegrityDigest ?? "")
        ) {
          throw elasticsearchError(undefined, false);
        }
        await this.assertDocumentVersionIntegrity({
          ...version,
          expectedChildCount: input.expectedChildCount!,
          expectedEmbeddingProfileHash: input.expectedEmbeddingProfileHash!,
          expectedIndexIntegrityDigest: input.expectedIndexIntegrityDigest!,
        });
      }
      if (input.preserveOtherVersions) {
        await this.setExactVersionSearchable(version, true);
      } else {
        await this.setDocumentSearchableVersion(version);
      }
      await this.assertSearchableDocumentVersionCount(version);
      if (!input.preserveOtherVersions) {
        await this.assertSearchableDocumentCount({
          knowledgeBaseId: input.knowledgeBaseId,
          documentId: input.documentId,
          expectedParentCount: input.expectedParentCount,
          ...(input.signal ? { signal: input.signal } : {}),
        });
        await this.client.deleteByQuery({
          index: this.config.index,
          routing: input.documentId,
          query: staleDocumentVersionsQuery(
            input.knowledgeBaseId,
            input.documentId,
            input.activeDocumentVersionId,
          ),
          ...(input.signal ? { signal: input.signal } : {}),
        });
      }
    } catch (error) {
      if (input.preserveOtherVersions) {
        await this.setExactVersionSearchable(
          {
            knowledgeBaseId: input.knowledgeBaseId,
            documentId: input.documentId,
            documentVersionId: input.activeDocumentVersionId,
            ...(input.signal ? { signal: input.signal } : {}),
          },
          false,
        ).catch(() => undefined);
      }
      if (error instanceof KnowledgeProcessingError) throw error;
      throw elasticsearchError(error, isRetryableElasticsearchError(error));
    }
  }

  async vectorSearch(input: {
    vector: number[];
    filter: KnowledgeSearchFilter;
    k: number;
    numCandidates?: number;
    size?: number;
    signal?: AbortSignal;
  }): Promise<ParentSearchHit[]> {
    await this.assertIndexContractReady();
    validateEmbeddingVector(input.vector, this.config.dimensions);
    const numCandidates = normalizeNumCandidates({
      k: input.k,
      maximum: this.config.maximumNumCandidates ?? 10_000,
      ...(input.numCandidates === undefined
        ? {}
        : { explicit: input.numCandidates }),
    });
    return this.search(
      {
        size: input.size ?? input.k,
        _source: { excludes: ["children"] },
        knn: {
          field: "children.vector",
          query_vector: input.vector,
          k: input.k,
          num_candidates: numCandidates,
          filter: createSecurityFilter(input.filter),
          inner_hits: matchedChildrenInnerHits(),
        },
      },
      "dense",
      input.signal,
    );
  }

  async bm25Search(input: {
    query: string;
    filter: KnowledgeSearchFilter;
    size: number;
    signal?: AbortSignal;
  }): Promise<ParentSearchHit[]> {
    await this.assertIndexContractReady();
    return this.search(
      {
        size: input.size,
        _source: { excludes: ["children"] },
        query: {
          bool: {
            must: [
              {
                nested: {
                  path: "children",
                  score_mode: "max",
                  query: {
                    bool: {
                      should: [
                        {
                          match: {
                            "children.raw_text": {
                              query: input.query,
                              boost: 4,
                            },
                          },
                        },
                        {
                          match: {
                            "children.text": {
                              query: input.query,
                              boost: 1.5,
                            },
                          },
                        },
                        {
                          match: {
                            "children.headings": {
                              query: input.query,
                              boost: 0.75,
                            },
                          },
                        },
                        {
                          match: {
                            "children.captions": {
                              query: input.query,
                              boost: 0.5,
                            },
                          },
                        },
                      ],
                      minimum_should_match: 1,
                    },
                  },
                  inner_hits: matchedChildrenInnerHits(),
                },
              },
            ],
            filter: createSecurityFilter(input.filter).bool.filter,
          },
        },
      },
      "lexical",
      input.signal,
    );
  }

  async getParentEvidence(input: {
    knowledgeBaseId: string;
    documentId: string;
    documentVersionId: string;
    parentId: string;
    matchedChildIds: string[];
  }): Promise<ParentEvidence | null> {
    if (
      !documentVersionIdentitySchema.safeParse({
        knowledgeBaseId: input.knowledgeBaseId,
        documentId: input.documentId,
        documentVersionId: input.documentVersionId,
      }).success ||
      !z.string().uuid().safeParse(input.parentId).success ||
      input.matchedChildIds.length === 0 ||
      new Set(input.matchedChildIds).size !== input.matchedChildIds.length
    ) {
      throw invalidIndexInput();
    }
    await this.assertIndexContractReady();
    try {
      const response = evidenceSearchResponseSchema.safeParse(
        await this.client.search(this.config.index, {
          routing: input.documentId,
          size: 1,
          _source: {
            includes: [
              "parent_id",
              "parent_text",
              "children.child_id",
              "children.order",
              "children.raw_text",
              "children.headings",
              "children.page_numbers",
            ],
          },
          query: {
            bool: {
              filter: [
                ...documentVersionScopeQuery(
                  input.knowledgeBaseId,
                  input.documentId,
                  input.documentVersionId,
                ).bool.filter,
                { term: { parent_id: input.parentId } },
                { term: { searchable: true } },
              ],
            },
          },
        }),
      );
      if (!response.success) {
        throw elasticsearchError(response.error, true);
      }
      const hit = response.data.hits.hits[0];
      if (hit === undefined) return null;
      const byId = new Map(
        hit._source.children.map((child) => [child.child_id, child]),
      );
      const matchedChildren = input.matchedChildIds.map((childId) =>
        byId.get(childId),
      );
      if (matchedChildren.some((child) => child === undefined)) return null;
      return {
        parentId: hit._source.parent_id,
        parentText: hit._source.parent_text,
        matchedChildren: matchedChildren
          .map((child) => ({
            childId: child!.child_id,
            order: child!.order,
            rawText: child!.raw_text,
            titlePath: child!.headings,
            pageNumbers: uniqueSortedPages(child!.page_numbers),
          }))
          .sort(
            (left, right) =>
              left.order - right.order ||
              left.childId.localeCompare(right.childId),
          ),
      };
    } catch (error) {
      if (error instanceof KnowledgeProcessingError) throw error;
      throw elasticsearchError(error, isRetryableElasticsearchError(error));
    }
  }

  private async search(
    body: Record<string, unknown>,
    matchKind: "dense" | "lexical",
    signal?: AbortSignal,
  ): Promise<ParentSearchHit[]> {
    try {
      const response = searchResponseSchema.safeParse(
        await this.client.search(this.config.index, body, signal),
      );
      if (!response.success) {
        throw new KnowledgeProcessingError(
          "KNOWLEDGE_ELASTICSEARCH_OPERATION_FAILED",
          { cause: response.error },
        );
      }
      return response.data.hits.hits.map((hit) => {
        const source = hit._source;
        if (source.child_count !== source.child_ids.length) {
          throw new KnowledgeProcessingError(
            "KNOWLEDGE_ELASTICSEARCH_OPERATION_FAILED",
          );
        }
        return {
          parentId: source.parent_id,
          parentOrder: source.parent_order,
          knowledgeBaseId: source.knowledge_base_id,
          documentId: source.document_id,
          documentVersionId: source.document_version_id,
          titlePath: source.title_path,
          parentText: source.parent_text,
          pageNumbers: uniqueSortedPages(source.page_numbers),
          childIds: source.child_ids,
          childCount: source.child_count,
          matchedChildren: hit.inner_hits.matched_children.hits.hits.map(
            (innerHit) => ({
              childId: innerHit._source.child_id,
              order: innerHit._source.order,
              rawText: innerHit._source.raw_text,
              titlePath: innerHit._source.headings,
              pageNumbers: uniqueSortedPages(innerHit._source.page_numbers),
              score: innerHit._score ?? 0,
              matchKinds: [matchKind],
            }),
          ),
          score: hit._score ?? 0,
        };
      });
    } catch (error) {
      if (signal?.aborted) {
        throw new KnowledgeProcessingError("KNOWLEDGE_PROCESSING_CANCELLED");
      }
      if (error instanceof KnowledgeProcessingError) throw error;
      throw elasticsearchError(error, isRetryableElasticsearchError(error));
    }
  }

  private async replaceParents(input: {
    replacement: {
      knowledgeBaseId: string;
      documentId: string;
      documentVersionId: string;
      parents: IndexedParentDocument[];
    };
    countQuery: Record<string, unknown>;
    deleteExisting: () => Promise<void>;
  }): Promise<void> {
    await this.ensureIndex();
    await input.deleteExisting();
    try {
      const operations = input.replacement.parents.flatMap((parent) => [
        {
          index: {
            _index: this.config.index,
            _id: parent.parentId,
            routing: input.replacement.documentId,
          },
        },
        serializeIndexedParent(parent),
      ]);
      const response = bulkResponseSchema.safeParse(
        await this.client.bulk(operations),
      );
      if (!response.success || response.data.errors) {
        throw elasticsearchError(
          response.success ? undefined : response.error,
          true,
        );
      }
      const count = countResponseSchema.safeParse(
        await this.client.count({
          index: this.config.index,
          routing: input.replacement.documentId,
          query: input.countQuery,
        }),
      );
      if (
        !count.success ||
        count.data.count !== input.replacement.parents.length
      ) {
        throw elasticsearchError(count.success ? undefined : count.error, true);
      }
    } catch (error) {
      await input.deleteExisting().catch(() => undefined);
      if (error instanceof KnowledgeProcessingError) throw error;
      throw elasticsearchError(error, true);
    }
  }

  private async assertDocumentVersionIntegrity(input: {
    knowledgeBaseId: string;
    documentId: string;
    documentVersionId: string;
    expectedParentCount: number;
    expectedChildCount: number;
    expectedEmbeddingProfileHash: string;
    expectedIndexIntegrityDigest: string;
    signal?: AbortSignal;
  }): Promise<void> {
    const parents: KnowledgeIndexIntegrityParent[] = [];
    let searchAfter: Array<string | number> | undefined;
    while (parents.length < input.expectedParentCount) {
      const response = integritySearchResponseSchema.safeParse(
        await this.client.search(this.config.index, {
          routing: input.documentId,
          size: Math.min(500, input.expectedParentCount - parents.length),
          _source: {
            includes: [
              "parent_id",
              "parent_order",
              "knowledge_base_id",
              "document_id",
              "document_version_id",
              "embedding_profile_hash",
              "title_path",
              "page_numbers",
              "content_hash",
              "child_ids",
              "child_count",
              "children.child_id",
              "children.order",
              "children.headings",
              "children.captions",
              "children.doc_items",
              "children.page_numbers",
              "children.num_tokens",
              "children.content_hash",
            ],
          },
          query: documentVersionScopeQuery(
            input.knowledgeBaseId,
            input.documentId,
            input.documentVersionId,
          ),
          sort: [{ parent_order: "asc" }, { parent_id: "asc" }],
          ...(searchAfter === undefined ? {} : { search_after: searchAfter }),
        }, input.signal),
      );
      if (!response.success || response.data.hits.hits.length === 0) {
        throw elasticsearchError(
          response.success ? undefined : response.error,
          true,
        );
      }
      for (const hit of response.data.hits.hits) {
        const source = hit._source;
        if (
          source.knowledge_base_id !== input.knowledgeBaseId ||
          source.document_id !== input.documentId ||
          source.document_version_id !== input.documentVersionId ||
          source.embedding_profile_hash !==
            input.expectedEmbeddingProfileHash ||
          source.child_count !== source.child_ids.length ||
          source.child_count !== source.children.length
        ) {
          throw elasticsearchError(undefined, true);
        }
        parents.push({
          parentId: source.parent_id,
          parentOrder: source.parent_order,
          titlePath: source.title_path,
          pageNumbers: uniqueSortedPages(source.page_numbers),
          contentHash: source.content_hash,
          childIds: source.child_ids,
          childCount: source.child_count,
          children: source.children.map((child) => ({
            childId: child.child_id,
            order: child.order,
            titlePath: child.headings,
            captions: child.captions,
            docItems: child.doc_items,
            pageNumbers: uniqueSortedPages(child.page_numbers),
            numTokens: child.num_tokens,
            contentHash: child.content_hash,
          })),
        });
        searchAfter = hit.sort;
      }
    }
    const childCount = parents.reduce(
      (total, parent) => total + parent.childCount,
      0,
    );
    if (
      parents.length !== input.expectedParentCount ||
      childCount !== input.expectedChildCount ||
      indexIntegrityDigest(parents) !== input.expectedIndexIntegrityDigest
    ) {
      throw elasticsearchError(undefined, true);
    }
  }

  private async assertDocumentVersionCount(input: {
    knowledgeBaseId: string;
    documentId: string;
    documentVersionId: string;
    expectedParentCount: number;
    signal?: AbortSignal;
  }): Promise<void> {
    const response = countResponseSchema.safeParse(
      await this.client.count({
        index: this.config.index,
        routing: input.documentId,
        query: documentVersionScopeQuery(
          input.knowledgeBaseId,
          input.documentId,
          input.documentVersionId,
        ),
        ...(input.signal ? { signal: input.signal } : {}),
      }),
    );
    if (
      !response.success ||
      response.data.count !== input.expectedParentCount
    ) {
      throw elasticsearchError(
        response.success ? undefined : response.error,
        true,
      );
    }
  }

  private async assertSearchableDocumentVersionCount(input: {
    knowledgeBaseId: string;
    documentId: string;
    documentVersionId: string;
    expectedParentCount: number;
    signal?: AbortSignal;
  }): Promise<void> {
    const response = countResponseSchema.safeParse(
      await this.client.count({
        index: this.config.index,
        routing: input.documentId,
        query: searchableDocumentVersionScopeQuery(
          input.knowledgeBaseId,
          input.documentId,
          input.documentVersionId,
        ),
        ...(input.signal ? { signal: input.signal } : {}),
      }),
    );
    if (
      !response.success ||
      response.data.count !== input.expectedParentCount
    ) {
      throw elasticsearchError(
        response.success ? undefined : response.error,
        true,
      );
    }
  }

  private async assertSearchableDocumentCount(input: {
    knowledgeBaseId: string;
    documentId: string;
    expectedParentCount: number;
    signal?: AbortSignal;
  }): Promise<void> {
    const response = countResponseSchema.safeParse(
      await this.client.count({
        index: this.config.index,
        routing: input.documentId,
        query: searchableDocumentScopeQuery(
          input.knowledgeBaseId,
          input.documentId,
        ),
        ...(input.signal ? { signal: input.signal } : {}),
      }),
    );
    if (
      !response.success ||
      response.data.count !== input.expectedParentCount
    ) {
      throw elasticsearchError(
        response.success ? undefined : response.error,
        true,
      );
    }
  }

  private async setDocumentSearchableVersion(input: {
    knowledgeBaseId: string;
    documentId: string;
    documentVersionId: string;
    signal?: AbortSignal;
  }): Promise<void> {
    await this.runUpdateByQuery({
      routing: input.documentId,
      query: documentScopeQuery(input.knowledgeBaseId, input.documentId),
      ...(input.signal ? { signal: input.signal } : {}),
      script: {
        lang: "painless",
        source:
          "ctx._source.searchable = ctx._source.document_version_id == params.document_version_id",
        params: { document_version_id: input.documentVersionId },
      },
    });
  }

  private async setExactVersionSearchable(
    input: {
      knowledgeBaseId: string;
      documentId: string;
      documentVersionId: string;
      signal?: AbortSignal;
    },
    searchable: boolean,
  ): Promise<void> {
    await this.runUpdateByQuery({
      routing: input.documentId,
      query: documentVersionScopeQuery(
        input.knowledgeBaseId,
        input.documentId,
        input.documentVersionId,
      ),
      script: searchableAssignmentScript(searchable),
      ...(input.signal ? { signal: input.signal } : {}),
    });
  }

  private async runUpdateByQuery(input: {
    routing?: string;
    query: Record<string, unknown>;
    script: Record<string, unknown>;
    signal?: AbortSignal;
  }): Promise<void> {
    const response = updateByQueryResponseSchema.safeParse(
      await this.client.updateByQuery({
        index: this.config.index,
        ...(input.routing === undefined ? {} : { routing: input.routing }),
        query: input.query,
        script: input.script,
        ...(input.signal ? { signal: input.signal } : {}),
      }),
    );
    if (
      !response.success ||
      response.data.timed_out ||
      response.data.version_conflicts > 0 ||
      response.data.failures.length > 0
    ) {
      throw elasticsearchError(
        response.success ? undefined : response.error,
        true,
      );
    }
  }

  private async assertIndexContractReady(signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    if (this.contractVerified) return;
    try {
      if (!(await this.client.indexExists(this.config.index, signal))) {
        throw incompatibleIndexContract();
      }
      await this.verifyIndexContract(signal);
    } catch (error) {
      if (error instanceof KnowledgeProcessingError) throw error;
      throw elasticsearchError(error, isRetryableElasticsearchError(error));
    }
  }
}

export function knowledgeIndexMappings(
  dimensions: number,
): Record<string, unknown> {
  return {
    _meta: {
      linksense_knowledge_contract_version: KNOWLEDGE_INDEX_CONTRACT_VERSION,
    },
    _routing: { required: true },
    dynamic: "strict",
    properties: {
      parent_id: { type: "keyword" },
      parent_order: { type: "integer" },
      knowledge_base_id: { type: "keyword" },
      document_id: { type: "keyword" },
      document_version_id: { type: "keyword" },
      embedding_profile_hash: { type: "keyword" },
      searchable: { type: "boolean" },
      title_path: {
        type: "text",
        fields: { keyword: { type: "keyword", ignore_above: 1_024 } },
      },
      parent_text: { type: "text" },
      page_numbers: { type: "integer" },
      content_hash: { type: "keyword" },
      child_ids: { type: "keyword", index: false },
      child_count: { type: "integer" },
      children: {
        type: "nested",
        dynamic: "strict",
        properties: {
          child_id: { type: "keyword" },
          order: { type: "integer" },
          text: { type: "text" },
          raw_text: { type: "text" },
          headings: {
            type: "text",
            fields: { keyword: { type: "keyword", ignore_above: 1_024 } },
          },
          captions: { type: "text" },
          doc_items: { type: "keyword", index: false },
          page_numbers: { type: "integer" },
          num_tokens: { type: "integer" },
          content_hash: { type: "keyword" },
          vector: {
            type: "dense_vector",
            dims: dimensions,
            index: true,
            similarity: "cosine",
          },
        },
      },
    },
  };
}

export function normalizeNumCandidates(input: {
  explicit?: number;
  k: number;
  maximum: number;
}): number {
  if (
    !Number.isSafeInteger(input.k) ||
    input.k <= 0 ||
    !Number.isSafeInteger(input.maximum) ||
    input.maximum < input.k ||
    (input.explicit !== undefined &&
      (!Number.isSafeInteger(input.explicit) || input.explicit <= 0))
  ) {
    throw new KnowledgeProcessingError(
      "KNOWLEDGE_RETRIEVAL_PARAMETERS_INVALID",
    );
  }
  const value = Math.max(
    input.explicit ?? Math.min(input.k * 10, input.maximum),
    input.k,
  );
  if (value > input.maximum) {
    throw new KnowledgeProcessingError(
      "KNOWLEDGE_RETRIEVAL_PARAMETERS_INVALID",
    );
  }
  return value;
}

function matchedChildrenInnerHits(): Record<string, unknown> {
  return {
    name: "matched_children",
    size: 3,
    _source: { excludes: ["vector", "text", "captions", "doc_items"] },
  };
}

function serializeIndexedParent(parent: IndexedParentDocument) {
  return {
    parent_id: parent.parentId,
    parent_order: parent.parentOrder,
    knowledge_base_id: parent.knowledgeBaseId,
    document_id: parent.documentId,
    document_version_id: parent.documentVersionId,
    embedding_profile_hash: parent.embeddingProfileHash,
    searchable: false,
    title_path: parent.titlePath,
    parent_text: parent.parentText,
    page_numbers: parent.pageNumbers,
    content_hash: parent.contentHash,
    child_ids: parent.childIds,
    child_count: parent.childCount,
    children: parent.children.map((child) => ({
      child_id: child.childId,
      order: child.order,
      text: child.text,
      raw_text: child.rawText,
      headings: child.titlePath,
      captions: child.captions,
      doc_items: child.docItems,
      page_numbers: child.pageNumbers,
      num_tokens: child.numTokens,
      content_hash: child.contentHash,
      vector: child.vector,
    })),
  };
}

function readIndexContract(
  mapping: unknown,
  index: string,
  dimensions: number,
): void {
  const indexMapping = objectProperty(mapping, index);
  const mappings = objectProperty(indexMapping, "mappings");
  const routing = objectProperty(mappings, "_routing");
  const properties = objectProperty(mappings, "properties");
  const children = objectProperty(properties, "children");
  const childProperties = objectProperty(children, "properties");
  const vector = objectProperty(childProperties, "vector");
  if (typeof vector.dims === "number" && vector.dims !== dimensions) {
    throw new KnowledgeProcessingError("EMBEDDING_DIMENSION_MISMATCH", {
      retryable: false,
    });
  }
  const meta = objectProperty(mappings, "_meta");
  if (
    routing.required !== true ||
    mappings.dynamic !== "strict" ||
    meta.linksense_knowledge_contract_version !==
      KNOWLEDGE_INDEX_CONTRACT_VERSION ||
    !hasMappingType(properties, "parent_text", "text") ||
    !hasMappingType(properties, "page_numbers", "integer") ||
    !hasMappingType(properties, "child_ids", "keyword") ||
    !hasMappingType(properties, "child_count", "integer") ||
    children.type !== "nested" ||
    children.dynamic !== "strict" ||
    !hasMappingType(childProperties, "child_id", "keyword") ||
    !hasMappingType(childProperties, "order", "integer") ||
    !hasMappingType(childProperties, "text", "text") ||
    !hasMappingType(childProperties, "raw_text", "text") ||
    !hasMappingType(childProperties, "headings", "text") ||
    !hasMappingType(childProperties, "captions", "text") ||
    !hasMappingType(childProperties, "doc_items", "keyword") ||
    !hasMappingType(childProperties, "page_numbers", "integer") ||
    !hasMappingType(childProperties, "num_tokens", "integer") ||
    !hasMappingType(childProperties, "content_hash", "keyword") ||
    vector.type !== "dense_vector" ||
    vector.dims !== dimensions ||
    vector.index !== true ||
    vector.similarity !== "cosine"
  ) {
    throw incompatibleIndexContract();
  }
}

function validateReplacementInput(
  input: {
    knowledgeBaseId: string;
    documentId: string;
    documentVersionId: string;
    parents: IndexedParentDocument[];
  },
  dimensions: number,
): void {
  if (
    !documentVersionIdentitySchema.safeParse({
      knowledgeBaseId: input.knowledgeBaseId,
      documentId: input.documentId,
      documentVersionId: input.documentVersionId,
    }).success ||
    input.parents.length === 0
  ) {
    throw invalidIndexInput();
  }
  const parentIds = new Set<string>();
  const childIds = new Set<string>();
  let expectedParentOrder = 0;
  for (const parent of input.parents) {
    if (
      !z.string().uuid().safeParse(parent.parentId).success ||
      parentIds.has(parent.parentId) ||
      parent.parentOrder !== expectedParentOrder ||
      parent.knowledgeBaseId !== input.knowledgeBaseId ||
      parent.documentId !== input.documentId ||
      parent.documentVersionId !== input.documentVersionId ||
      !/^[a-f0-9]{64}$/u.test(parent.embeddingProfileHash) ||
      !/^[a-f0-9]{64}$/u.test(parent.contentHash) ||
      parent.parentText.trim() === "" ||
      !validPages(parent.pageNumbers) ||
      parent.childCount <= 0 ||
      parent.childCount !== parent.childIds.length ||
      parent.childCount !== parent.children.length
    ) {
      throw invalidIndexInput();
    }
    parentIds.add(parent.parentId);
    expectedParentOrder += 1;
    const expectedIds = parent.children.map((child) => child.childId);
    if (
      !sameStrings(parent.childIds, expectedIds) ||
      !sameNumbers(
        parent.pageNumbers,
        uniqueSortedPages(
          parent.children.flatMap((child) => child.pageNumbers),
        ),
      )
    ) {
      throw invalidIndexInput();
    }
    let previousOrder = -1;
    for (const child of parent.children) {
      if (
        child.childId.length < 1 ||
        child.childId.length > 160 ||
        childIds.has(child.childId) ||
        child.order <= previousOrder ||
        child.text.trim() === "" ||
        child.rawText.trim() === "" ||
        !validPages(child.pageNumbers) ||
        !Number.isSafeInteger(child.numTokens) ||
        child.numTokens <= 0 ||
        !/^[a-f0-9]{64}$/u.test(child.contentHash)
      ) {
        throw invalidIndexInput();
      }
      validateEmbeddingVector(child.vector, dimensions);
      childIds.add(child.childId);
      previousOrder = child.order;
    }
  }
}

function createSecurityFilter(filter: KnowledgeSearchFilter) {
  if (
    filter.knowledgeBaseIds.length === 0 ||
    !/^[a-f0-9]{64}$/u.test(filter.embeddingProfileHash)
  ) {
    throw invalidIndexInput();
  }
  return {
    bool: {
      filter: [
        { terms: { knowledge_base_id: [...new Set(filter.knowledgeBaseIds)] } },
        { term: { embedding_profile_hash: filter.embeddingProfileHash } },
        { term: { searchable: true } },
      ],
    },
  };
}

function documentScopeQuery(knowledgeBaseId: string, documentId: string) {
  return {
    bool: {
      filter: [
        { term: { knowledge_base_id: knowledgeBaseId } },
        { term: { document_id: documentId } },
      ],
    },
  };
}

function documentVersionScopeQuery(
  knowledgeBaseId: string,
  documentId: string,
  documentVersionId: string,
) {
  return {
    bool: {
      filter: [
        { term: { knowledge_base_id: knowledgeBaseId } },
        { term: { document_id: documentId } },
        { term: { document_version_id: documentVersionId } },
      ],
    },
  };
}

function searchableDocumentVersionScopeQuery(
  knowledgeBaseId: string,
  documentId: string,
  documentVersionId: string,
) {
  return {
    bool: {
      filter: [
        ...documentVersionScopeQuery(
          knowledgeBaseId,
          documentId,
          documentVersionId,
        ).bool.filter,
        { term: { searchable: true } },
      ],
    },
  };
}

function nonSearchableDocumentVersionScopeQuery(
  knowledgeBaseId: string,
  documentId: string,
  documentVersionId: string,
) {
  return {
    bool: {
      filter: [
        ...documentVersionScopeQuery(
          knowledgeBaseId,
          documentId,
          documentVersionId,
        ).bool.filter,
        { term: { searchable: false } },
      ],
    },
  };
}

function searchableDocumentScopeQuery(
  knowledgeBaseId: string,
  documentId: string,
) {
  return {
    bool: {
      filter: [
        ...documentScopeQuery(knowledgeBaseId, documentId).bool.filter,
        { term: { searchable: true } },
      ],
    },
  };
}

function staleDocumentVersionsQuery(
  knowledgeBaseId: string,
  documentId: string,
  activeDocumentVersionId: string,
) {
  return {
    bool: {
      filter: [
        { term: { knowledge_base_id: knowledgeBaseId } },
        { term: { document_id: documentId } },
      ],
      must_not: [{ term: { document_version_id: activeDocumentVersionId } }],
    },
  };
}

function searchableAssignmentScript(searchable: boolean) {
  return {
    lang: "painless",
    source: "ctx._source.searchable = params.searchable",
    params: { searchable },
  };
}

function uniqueSortedPages(values: readonly number[]): number[] {
  return [...new Set(values)].sort((left, right) => left - right);
}

function validPages(values: readonly number[]): boolean {
  return (
    sameNumbers(values, uniqueSortedPages(values)) &&
    values.every((value) => Number.isSafeInteger(value) && value > 0)
  );
}

function sameStrings(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
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

function objectProperty(value: unknown, key: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null) return {};
  const property = Reflect.get(value, key);
  return typeof property === "object" && property !== null ? property : {};
}

function hasMappingType(
  properties: Record<string, unknown>,
  key: string,
  type: string,
): boolean {
  return objectProperty(properties, key).type === type;
}

function incompatibleIndexContract(cause?: unknown): KnowledgeProcessingError {
  return new KnowledgeProcessingError(
    "KNOWLEDGE_ELASTICSEARCH_CONTRACT_INCOMPATIBLE",
    { cause, retryable: false },
  );
}

function invalidIndexInput(): KnowledgeProcessingError {
  return new KnowledgeProcessingError(
    "KNOWLEDGE_ELASTICSEARCH_OPERATION_FAILED",
    { retryable: false },
  );
}

function elasticsearchError(
  cause: unknown,
  retryable: boolean,
): KnowledgeProcessingError {
  return new KnowledgeProcessingError(
    "KNOWLEDGE_ELASTICSEARCH_OPERATION_FAILED",
    { cause, retryable },
  );
}

function isRetryableElasticsearchError(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return true;
  const meta = Reflect.get(value, "meta");
  if (typeof meta !== "object" || meta === null) return true;
  const statusCode = Reflect.get(meta, "statusCode");
  return (
    statusCode === undefined ||
    statusCode === 408 ||
    statusCode === 429 ||
    (typeof statusCode === "number" && statusCode >= 500)
  );
}
