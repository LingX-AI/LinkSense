import { describe, expect, it, vi } from "vitest";

import {
  ElasticsearchKnowledgeAdapter,
  indexIntegrityDigest,
  knowledgeIndexMappings,
  normalizeNumCandidates,
  type ElasticsearchClientPort,
  type IndexedParentDocument,
  type ParentSearchHit,
} from "../src/modules/knowledge-processing/elasticsearch.js";
import { KnowledgeProcessingError } from "../src/modules/knowledge-processing/errors.js";
import {
  KnowledgeRetrievalOrchestrator,
  normalizeRetrievalParameters,
  reciprocalRankFusion,
} from "../src/modules/knowledge-processing/retrieval.js";

const KNOWLEDGE_BASE_ID = "00000000-0000-4000-8000-000000000001";
const DOCUMENT_ID = "00000000-0000-4000-8000-000000000002";
const VERSION_ID = "00000000-0000-4000-8000-000000000003";
const PARENT_ID = "00000000-0000-5000-8000-000000000004";
const PROFILE_HASH = "a".repeat(64);
const CONTENT_HASH = "b".repeat(64);
const CHILD_HASH = "c".repeat(64);

describe("knowledge Elasticsearch contract", () => {
  it("maps LinkSense parents with nested Hybrid children and no Markdown ranges or Docling refs", () => {
    const mapping = knowledgeIndexMappings(3);
    const serialized = JSON.stringify(mapping);
    const properties = mapping.properties as Record<
      string,
      Record<string, unknown>
    >;

    expect(properties.parent_text?.type).toBe("text");
    expect(properties.page_numbers?.type).toBe("integer");
    expect(properties.children?.type).toBe("nested");
    expect(
      properties.children?.properties as Record<string, unknown>,
    ).toMatchObject({
      text: { type: "text" },
      raw_text: { type: "text" },
      headings: expect.objectContaining({ type: "text" }),
      page_numbers: { type: "integer" },
      vector: expect.objectContaining({ dims: 3 }),
    });
    expect(serialized).not.toContain("source_start");
    expect(serialized).not.toContain("source_end");
    expect(serialized).not.toContain("self_refs");
    expect(serialized).not.toContain("markdown_range");
  });

  it("serializes contextualized child text for vectors and raw text as evidence", async () => {
    const port = mockPort();
    port.bulk.mockResolvedValue({
      errors: false,
      items: [{ index: { status: 201 } }],
    });
    port.count.mockResolvedValue({ count: 1 });
    const adapter = createAdapter(port);

    await adapter.replaceDocumentVersion({
      knowledgeBaseId: KNOWLEDGE_BASE_ID,
      documentId: DOCUMENT_ID,
      documentVersionId: VERSION_ID,
      parents: [indexedParent()],
    });

    const operations = port.bulk.mock.calls[0]![0];
    const body = operations[1] as Record<string, unknown>;
    expect(body).toMatchObject({
      parent_text: "# Policy\n\nraw evidence",
      page_numbers: [7],
      child_ids: [`${VERSION_ID}:0:child`],
      child_count: 1,
      children: [
        {
          child_id: `${VERSION_ID}:0:child`,
          text: "Policy contextualized child",
          raw_text: "raw evidence",
          headings: ["Policy"],
          page_numbers: [7],
          vector: [0.1, 0.2, 0.3],
        },
      ],
    });
  });

  it("rejects mismatched child ids, page unions and vectors before indexing", () => {
    const adapter = createAdapter(mockPort());
    const badIds = indexedParent();
    badIds.childIds = ["different"];
    expect(() =>
      adapter.validateCandidateDocumentVersion({
        knowledgeBaseId: KNOWLEDGE_BASE_ID,
        documentId: DOCUMENT_ID,
        documentVersionId: VERSION_ID,
        parents: [badIds],
      }),
    ).toThrowError(KnowledgeProcessingError);

    const badPages = indexedParent();
    badPages.pageNumbers = [8];
    expect(() =>
      adapter.validateCandidateDocumentVersion({
        knowledgeBaseId: KNOWLEDGE_BASE_ID,
        documentId: DOCUMENT_ID,
        documentVersionId: VERSION_ID,
        parents: [badPages],
      }),
    ).toThrowError(KnowledgeProcessingError);

    const badVector = indexedParent();
    badVector.children[0]!.vector = [0.1];
    expect(() =>
      adapter.validateCandidateDocumentVersion({
        knowledgeBaseId: KNOWLEDGE_BASE_ID,
        documentId: DOCUMENT_ID,
        documentVersionId: VERSION_ID,
        parents: [badVector],
      }),
    ).toThrowError(KnowledgeProcessingError);
  });

  it("uses nested child vectors and returns the exact dense inner hit", async () => {
    const port = mockPort();
    port.search.mockResolvedValue(searchResponse("dense"));
    const adapter = createAdapter(port);

    const results = await adapter.vectorSearch({
      vector: [0.1, 0.2, 0.3],
      filter: {
        knowledgeBaseIds: [KNOWLEDGE_BASE_ID],
        embeddingProfileHash: PROFILE_HASH,
      },
      k: 5,
    });

    const request = port.search.mock.calls[0]?.[1] as {
      knn: Record<string, unknown>;
      _source: unknown;
    };
    expect(request.knn).toMatchObject({
      field: "children.vector",
      k: 5,
      num_candidates: 50,
      inner_hits: expect.objectContaining({
        name: "matched_children",
        size: 3,
      }),
    });
    expect(request._source).toEqual({ excludes: ["children"] });
    expect(results[0]?.matchedChildren).toEqual([
      {
        childId: `${VERSION_ID}:0:child`,
        order: 0,
        rawText: "raw evidence",
        titlePath: ["Policy"],
        pageNumbers: [7],
        score: 4.2,
        matchKinds: ["dense"],
      },
    ]);
  });

  it("runs BM25 inside children with raw evidence boosted above headings and preserves lexical inner hits", async () => {
    const port = mockPort();
    port.search.mockResolvedValue(searchResponse("lexical"));
    const adapter = createAdapter(port);

    const results = await adapter.bm25Search({
      query: "evidence",
      filter: {
        knowledgeBaseIds: [KNOWLEDGE_BASE_ID],
        embeddingProfileHash: PROFILE_HASH,
      },
      size: 10,
    });

    const requestText = JSON.stringify(port.search.mock.calls[0]?.[1]);
    expect(requestText).toContain('"path":"children"');
    expect(requestText).toContain('"children.raw_text"');
    expect(requestText).toContain('"boost":4');
    expect(requestText).toContain('"children.headings"');
    expect(requestText).toContain('"boost":0.75');
    expect(requestText).toContain('"name":"matched_children"');
    expect(results[0]?.matchedChildren[0]?.matchKinds).toEqual(["lexical"]);
  });

  it("loads citation evidence by immutable parent and selected child ids", async () => {
    const port = mockPort();
    port.search.mockResolvedValue({
      hits: {
        hits: [
          {
            _source: {
              parent_id: PARENT_ID,
              parent_text: "# Policy\n\nraw evidence",
              children: [
                {
                  child_id: `${VERSION_ID}:0:child`,
                  order: 0,
                  raw_text: "raw evidence",
                  headings: ["Policy"],
                  page_numbers: [7],
                },
              ],
            },
          },
        ],
      },
    });
    const adapter = createAdapter(port);

    await expect(
      adapter.getParentEvidence({
        knowledgeBaseId: KNOWLEDGE_BASE_ID,
        documentId: DOCUMENT_ID,
        documentVersionId: VERSION_ID,
        parentId: PARENT_ID,
        matchedChildIds: [`${VERSION_ID}:0:child`],
      }),
    ).resolves.toEqual({
      parentId: PARENT_ID,
      parentText: "# Policy\n\nraw evidence",
      matchedChildren: [
        {
          childId: `${VERSION_ID}:0:child`,
          order: 0,
          rawText: "raw evidence",
          titlePath: ["Policy"],
          pageNumbers: [7],
        },
      ],
    });
    expect(JSON.stringify(port.search.mock.calls[0]?.[1])).toContain(PARENT_ID);
  });

  it("fails closed when an old index does not implement the exact contract", async () => {
    const port = mockPort();
    port.getMapping.mockResolvedValue({
      knowledge: {
        mappings: {
          _meta: { linksense_knowledge_contract_version: 1 },
          _routing: { required: true },
          properties: { retrieval_fragments: { type: "nested" } },
        },
      },
    });
    const adapter = createAdapter(port);

    await expect(adapter.getIndexContractState()).resolves.toBe("incompatible");
    await expect(adapter.verifyIndexContract()).rejects.toMatchObject({
      code: "KNOWLEDGE_ELASTICSEARCH_CONTRACT_INCOMPATIBLE",
    });
  });

  it("recreates an incompatible index instead of upgrading its mapping", async () => {
    const port = mockPort();
    const adapter = createAdapter(port);

    await adapter.recreateIndex();

    expect(port.deleteIndex).toHaveBeenCalledWith("knowledge");
    expect(port.createIndex).toHaveBeenCalledWith(
      "knowledge",
      knowledgeIndexMappings(3),
    );
  });
});

describe("parent retrieval fusion", () => {
  it("ranks by parent while retaining and merging dense and lexical child evidence", () => {
    const dense = parentHit({
      matchedChildren: [
        matchedChild(`${VERSION_ID}:0:dense`, 0, [2], ["dense"]),
      ],
    });
    const lexical = parentHit({
      matchedChildren: [
        matchedChild(`${VERSION_ID}:1:lexical`, 1, [3], ["lexical"]),
      ],
    });

    const fused = reciprocalRankFusion([dense], [lexical]);

    expect(fused).toHaveLength(1);
    expect(fused[0]?.vectorRank).toBe(1);
    expect(fused[0]?.bm25Rank).toBe(1);
    expect(
      fused[0]?.matchedChildren.map((child) => ({
        id: child.childId,
        pages: child.pageNumbers,
        kinds: child.matchKinds,
      })),
    ).toEqual([
      { id: `${VERSION_ID}:0:dense`, pages: [2], kinds: ["dense"] },
      { id: `${VERSION_ID}:1:lexical`, pages: [3], kinds: ["lexical"] },
    ]);
  });

  it("merges match kinds when both retrieval paths hit the same child", () => {
    const dense = parentHit({
      matchedChildren: [
        matchedChild(`${VERSION_ID}:0:same`, 0, [2], ["dense"]),
      ],
    });
    const lexical = parentHit({
      matchedChildren: [
        matchedChild(`${VERSION_ID}:0:same`, 0, [2], ["lexical"]),
      ],
    });

    expect(
      reciprocalRankFusion([dense], [lexical])[0]?.matchedChildren[0]
        ?.matchKinds,
    ).toEqual(["dense", "lexical"]);
  });

  it("rejects conflicting parent or child identities across retrieval paths", () => {
    const dense = parentHit();
    const conflicting = parentHit({ parentText: "changed" });
    expect(() => reciprocalRankFusion([dense], [conflicting])).toThrowError(
      KnowledgeProcessingError,
    );

    const conflictingChild = parentHit({
      matchedChildren: [
        {
          ...dense.matchedChildren[0]!,
          rawText: "changed evidence",
          matchKinds: ["lexical"],
        },
      ],
    });
    expect(() =>
      reciprocalRankFusion([dense], [conflictingChild]),
    ).toThrowError(KnowledgeProcessingError);
  });
});

describe("index integrity and candidate count", () => {
  it("includes page and child metadata in the integrity digest but excludes vectors and retrieval text", () => {
    const parent = indexedParent();
    const baseline = indexIntegrityDigest([parent]);
    const vectorChanged = indexedParent();
    vectorChanged.children[0]!.vector = [0.3, 0.2, 0.1];
    const textChanged = indexedParent();
    textChanged.children[0]!.text = "different";
    const pageChanged = indexedParent();
    pageChanged.children[0]!.pageNumbers = [8];
    pageChanged.pageNumbers = [8];

    expect(indexIntegrityDigest([vectorChanged])).toBe(baseline);
    expect(indexIntegrityDigest([textChanged])).toBe(baseline);
    expect(indexIntegrityDigest([pageChanged])).not.toBe(baseline);
  });

  it("normalizes and bounds vector candidate counts", () => {
    expect(normalizeNumCandidates({ k: 5, maximum: 100 })).toBe(50);
    expect(normalizeNumCandidates({ explicit: 20, k: 5, maximum: 100 })).toBe(
      20,
    );
    expect(normalizeNumCandidates({ explicit: 4, k: 5, maximum: 100 })).toBe(5);
    expect(normalizeNumCandidates({ k: 20, maximum: 100 })).toBe(100);
    expect(() =>
      normalizeNumCandidates({ explicit: 101, k: 5, maximum: 100 }),
    ).toThrowError(
      expect.objectContaining({
        code: "KNOWLEDGE_RETRIEVAL_PARAMETERS_INVALID",
      }),
    );
  });

  it("raises num_candidates to the cross-field candidate minimum", () => {
    expect(
      normalizeRetrievalParameters({
        finalTopK: 5,
        candidateMultiplier: 3,
        numCandidates: 10,
      }),
    ).toMatchObject({
      finalTopK: 5,
      candidateMultiplier: 3,
      candidateTopK: 15,
      numCandidates: 15,
    });
  });

  it("uses the normalized cross-field candidate count in vector search", async () => {
    const vectorSearch = vi.fn().mockResolvedValue([]);
    const orchestrator = new KnowledgeRetrievalOrchestrator(
      {
        profileHash: PROFILE_HASH,
        embedQuery: vi.fn().mockResolvedValue({
          requestId: "00000000-0000-4000-8000-000000000099",
          model: "embedding-model",
          pricing: {
            input_price_per_million: "0",
            cached_input_price_per_million: "0",
            output_price_per_million: "0",
          },
          usage: {
            totalTokens: 1,
            inputTokens: 1,
            cachedInputTokens: 0,
            outputTokens: 0,
            reasoningOutputTokens: 0,
            measurementMethod: "provider",
          },
          vector: [0.1, 0.2, 0.3],
        }),
      } as never,
      {
        vectorSearch,
        bm25Search: vi.fn().mockResolvedValue([]),
      } as never,
    );

    await orchestrator.search({
      query: "语言设置路径",
      authorizedKnowledgeBaseIds: [KNOWLEDGE_BASE_ID],
      parameters: {
        finalTopK: 5,
        candidateMultiplier: 3,
        numCandidates: 10,
      },
      filterCandidates: async (candidates) => [...candidates],
    });

    expect(vectorSearch).toHaveBeenCalledWith(
      expect.objectContaining({
        k: 15,
        size: 15,
        numCandidates: 15,
      }),
    );
  });
});

function createAdapter(port: ReturnType<typeof mockPort>) {
  return new ElasticsearchKnowledgeAdapter(
    {
      url: "http://elasticsearch.invalid",
      username: "elastic",
      password: "secret",
      index: "knowledge",
      dimensions: 3,
    },
    port,
  );
}

function mockPort() {
  return {
    ping: vi.fn<ElasticsearchClientPort["ping"]>(async () => ({})),
    indexExists: vi.fn<ElasticsearchClientPort["indexExists"]>(
      async () => true,
    ),
    createIndex: vi.fn<ElasticsearchClientPort["createIndex"]>(
      async () => ({}),
    ),
    deleteIndex: vi.fn<ElasticsearchClientPort["deleteIndex"]>(
      async () => ({}),
    ),
    getMapping: vi.fn<ElasticsearchClientPort["getMapping"]>(async () =>
      mappingResponse(3),
    ),
    bulk: vi.fn<ElasticsearchClientPort["bulk"]>(async () => ({
      errors: false,
      items: [],
    })),
    search: vi.fn<ElasticsearchClientPort["search"]>(async () => ({
      hits: { hits: [] },
    })),
    updateByQuery: vi.fn<ElasticsearchClientPort["updateByQuery"]>(
      async () => ({
        timed_out: false,
        version_conflicts: 0,
        failures: [],
      }),
    ),
    deleteByQuery: vi.fn<ElasticsearchClientPort["deleteByQuery"]>(
      async () => ({}),
    ),
    count: vi.fn<ElasticsearchClientPort["count"]>(async () => ({ count: 0 })),
  } satisfies ElasticsearchClientPort;
}

function mappingResponse(dimensions: number) {
  return { knowledge: { mappings: knowledgeIndexMappings(dimensions) } };
}

function indexedParent(): IndexedParentDocument {
  return {
    parentId: PARENT_ID,
    parentOrder: 0,
    knowledgeBaseId: KNOWLEDGE_BASE_ID,
    documentId: DOCUMENT_ID,
    documentVersionId: VERSION_ID,
    embeddingProfileHash: PROFILE_HASH,
    titlePath: ["Policy"],
    parentText: "# Policy\n\nraw evidence",
    pageNumbers: [7],
    contentHash: CONTENT_HASH,
    childIds: [`${VERSION_ID}:0:child`],
    childCount: 1,
    children: [
      {
        childId: `${VERSION_ID}:0:child`,
        order: 0,
        text: "Policy contextualized child",
        rawText: "raw evidence",
        titlePath: ["Policy"],
        captions: [],
        docItems: ["#/texts/0"],
        pageNumbers: [7],
        numTokens: 12,
        contentHash: CHILD_HASH,
        vector: [0.1, 0.2, 0.3],
      },
    ],
  };
}

function searchResponse(matchKind: "dense" | "lexical") {
  return {
    hits: {
      hits: [
        {
          _id: PARENT_ID,
          _score: 8,
          _source: {
            parent_id: PARENT_ID,
            parent_order: 0,
            knowledge_base_id: KNOWLEDGE_BASE_ID,
            document_id: DOCUMENT_ID,
            document_version_id: VERSION_ID,
            title_path: ["Policy"],
            parent_text: "# Policy\n\nraw evidence",
            page_numbers: [7],
            child_ids: [`${VERSION_ID}:0:child`],
            child_count: 1,
          },
          inner_hits: {
            matched_children: {
              hits: {
                hits: [
                  {
                    _score: 4.2,
                    _source: {
                      child_id: `${VERSION_ID}:0:child`,
                      order: 0,
                      raw_text: "raw evidence",
                      headings: ["Policy"],
                      page_numbers: [7],
                    },
                  },
                ],
              },
            },
          },
        },
      ],
    },
    matchKind,
  };
}

function parentHit(overrides: Partial<ParentSearchHit> = {}): ParentSearchHit {
  return {
    parentId: PARENT_ID,
    parentOrder: 0,
    knowledgeBaseId: KNOWLEDGE_BASE_ID,
    documentId: DOCUMENT_ID,
    documentVersionId: VERSION_ID,
    titlePath: ["Policy"],
    parentText: "# Policy\n\nraw evidence",
    pageNumbers: [2],
    childIds: [`${VERSION_ID}:0:same`],
    childCount: 1,
    matchedChildren: [matchedChild(`${VERSION_ID}:0:same`, 0, [2], ["dense"])],
    score: 1,
    ...overrides,
  };
}

function matchedChild(
  childId: string,
  order: number,
  pageNumbers: number[],
  matchKinds: Array<"dense" | "lexical">,
): ParentSearchHit["matchedChildren"][number] {
  return {
    childId,
    order,
    rawText: "raw evidence",
    titlePath: ["Policy"],
    pageNumbers,
    score: 1,
    matchKinds,
  };
}
