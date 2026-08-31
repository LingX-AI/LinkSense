import { describe, expect, it, vi } from "vitest";

import type { PrismaClient } from "../src/generated/prisma/client.js";
import { InternalKnowledgeSearchService } from "../src/modules/knowledge/internal-search.js";
import { collectKnowledgeAssetReferenceIds } from "../src/modules/knowledge/knowledge-asset-reference.js";
import type { KnowledgeRetrievalOrchestrator } from "../src/modules/knowledge-processing/retrieval.js";
import { KnowledgeProcessingError } from "../src/modules/knowledge-processing/errors.js";
import type { TurnKnowledgeSourceStore } from "../src/modules/events/knowledge-source-store.js";
import type { ParentSearchHit } from "../src/modules/knowledge-processing/elasticsearch.js";

const OWNER_ID = "00000000-0000-4000-8000-000000000001";
const CONVERSATION_ID = "00000000-0000-4000-8000-000000000002";
const TURN_ID = "00000000-0000-4000-8000-000000000003";
const BASE_ID = "00000000-0000-4000-8000-000000000004";
const DOCUMENT_ID = "00000000-0000-4000-8000-000000000005";
const VERSION_ID = "00000000-0000-4000-8000-000000000006";
const PARENT_ID = "00000000-0000-5000-8000-000000000007";
const ASSET_ID = "00000000-0000-5000-8000-000000000008";
const UNRELATED_ASSET_ID = "00000000-0000-5000-8000-000000000009";

function parent(overrides: Partial<ParentSearchHit> = {}): ParentSearchHit {
  return {
    parentId: PARENT_ID,
    parentOrder: 0,
    knowledgeBaseId: BASE_ID,
    documentId: DOCUMENT_ID,
    documentVersionId: VERSION_ID,
    titlePath: ["第一章", "发布"],
    parentText: "完整父段内容",
    pageNumbers: [2],
    childIds: [`${VERSION_ID}:0:child`],
    childCount: 1,
    matchedChildren: [
      {
        childId: `${VERSION_ID}:0:child`,
        order: 0,
        rawText: "证据内容",
        titlePath: ["第一章", "发布"],
        pageNumbers: [2],
        score: 1,
        matchKinds: ["dense"],
      },
    ],
    score: 1,
    ...overrides,
  };
}

function input() {
  return {
    ownerId: OWNER_ID,
    conversationId: CONVERSATION_ID,
    turnId: TURN_ID,
    query: "发布流程",
    finalTopK: 5,
    candidateMultiplier: 3,
    minScore: 0.2,
  };
}

function createHarness(
  options: {
    scopes?: Array<{
      requested_ids: string[];
      usable_ids: string[];
      unavailable_ids: string[];
    }>;
    markdown?: string;
    retrievalError?: Error;
    turnProjected?: boolean;
    activeProcessingVersionId?: string | null;
    maintenanceError?: Error;
    parents?: ParentSearchHit[];
    applyCandidateFilter?: boolean;
    bases?: Array<{ id: string; name: string }>;
    documents?: Array<{
      id: string;
      knowledgeBaseId: string;
      displayName: string;
      canonicalExtension: string;
      currentVersionId: string | null;
      activeProcessingVersionId: string | null;
    }>;
    listedDocuments?: Array<{
      id: string;
      display_name: string;
      canonical_extension: string;
      current_version_id: string | null;
      searchable: boolean;
    }>;
    listNextCursor?: string | null;
    parsedChunks?: Array<{
      markdown: string;
      byteStart: number;
      byteEnd: number;
      totalBytes: number;
      complete: boolean;
    }>;
    documentReference?: {
      knowledgeBaseId: string;
      documentId: string;
      documentVersionId: string;
      contentVerified: boolean;
    } | null;
    listCursorState?: {
      knowledgeBaseId: string;
      documentCursor: string | null;
    } | null;
    markdownCursorState?: {
      documentRef: string;
      byteOffset: number;
      chunkIndex: number;
    } | null;
    finalDocumentFound?: boolean;
  } = {},
) {
  const baseRows = options.bases ?? [{ id: BASE_ID, name: "产品\n制度" }];
  const documentRows = options.documents ?? [
    {
      id: DOCUMENT_ID,
      knowledgeBaseId: BASE_ID,
      displayName: "发布手册.pdf",
      canonicalExtension: "pdf",
      currentVersionId: VERSION_ID,
      activeProcessingVersionId: options.activeProcessingVersionId ?? null,
    },
  ];
  const prisma = {
    conversationTurn: {
      findFirst: vi
        .fn()
        .mockResolvedValue(
          options.turnProjected === false ? null : { id: TURN_ID },
        ),
    },
    conversationTurnStartIntent: {
      findFirst: vi
        .fn()
        .mockResolvedValue(
          options.turnProjected === false
            ? { projectionTurnId: TURN_ID }
            : null,
        ),
    },
    user: {
      findUnique: vi.fn().mockResolvedValue({
        id: OWNER_ID,
        role: "user",
        status: "active",
      }),
    },
    knowledgeBase: {
      findMany: vi.fn().mockResolvedValue(baseRows),
      findFirst: vi.fn().mockResolvedValue(baseRows[0] ?? null),
    },
    knowledgeBaseDocument: {
      findMany: vi.fn().mockResolvedValue(documentRows),
      findFirst: vi.fn().mockResolvedValue(
        options.finalDocumentFound === false
          ? null
          : documentRows[0] === undefined
            ? null
            : {
                displayName: documentRows[0].displayName,
                canonicalExtension: documentRows[0].canonicalExtension,
              },
      ),
    },
  } as unknown as PrismaClient;
  const defaultScope = {
    requested_ids: [BASE_ID],
    usable_ids: [BASE_ID],
    unavailable_ids: [],
  };
  const getTurnRetrievalScope = vi.fn();
  for (const scope of options.scopes ?? [defaultScope, defaultScope]) {
    getTurnRetrievalScope.mockResolvedValueOnce(scope);
  }
  const rerankCandidates: ParentSearchHit[][] = [];
  const parents = options.parents ?? [
    parent({ parentText: options.markdown ?? "完整父段内容" }),
  ];
  const search = options.retrievalError
    ? vi.fn().mockRejectedValue(options.retrievalError)
    : vi
        .fn()
        .mockImplementation(
          async (
            retrievalInput: Parameters<
              KnowledgeRetrievalOrchestrator["search"]
            >[0],
          ) => {
            const filtered = options.applyCandidateFilter
              ? await retrievalInput.filterCandidates(
                  parents.map((candidate) => ({ ...candidate, rrfScore: 1 })),
                )
              : parents;
            rerankCandidates.push(filtered);
            return { ranking: "rrf", parents: filtered };
          },
        );
  const register = vi.fn().mockResolvedValue([
    {
      sourceRef: "source_ref_00000000000000000001",
      knowledgeBaseId: BASE_ID,
      documentId: DOCUMENT_ID,
      documentVersionId: VERSION_ID,
      parentId: PARENT_ID,
      titlePath: ["第一章", "发布"],
      matchedChildIds: [`${VERSION_ID}:0:child`],
      pageNumbers: [2],
    },
  ]);
  const registerAssetSources = vi.fn().mockResolvedValue(undefined);
  const registerDocument = vi
    .fn()
    .mockResolvedValue("document_ref_0000000000000000001");
  const registerListCursor = vi
    .fn()
    .mockResolvedValue("list_cursor_000000000000000000001");
  const readListCursor = vi
    .fn()
    .mockResolvedValue(options.listCursorState ?? null);
  const registerMarkdownCursor = vi
    .fn()
    .mockResolvedValue("markdown_cursor_00000000000000001");
  const readMarkdownCursor = vi
    .fn()
    .mockResolvedValue(options.markdownCursorState ?? null);
  const readDocument = vi.fn().mockResolvedValue(
    options.documentReference === undefined
      ? {
          knowledgeBaseId: BASE_ID,
          documentId: DOCUMENT_ID,
          documentVersionId: VERSION_ID,
          contentVerified: false,
        }
      : options.documentReference,
  );
  const markContentVerified = vi.fn().mockResolvedValue(true);
  const listDocuments = vi.fn().mockResolvedValue({
    items: options.listedDocuments ?? [
      {
        id: DOCUMENT_ID,
        display_name: "发布手册.pdf",
        canonical_extension: "pdf",
        current_version_id: VERSION_ID,
        searchable: true,
      },
    ],
    next_cursor: options.listNextCursor ?? null,
  });
  const getParsedContentChunk = vi.fn();
  for (const chunk of options.parsedChunks ?? [
    {
      markdown: "# 发布手册\n",
      byteStart: 0,
      byteEnd: 17,
      totalBytes: 17,
      complete: true,
    },
  ]) {
    getParsedContentChunk.mockResolvedValueOnce(chunk);
  }
  const assertAvailable = options.maintenanceError
    ? vi.fn().mockRejectedValue(options.maintenanceError)
    : vi.fn().mockResolvedValue(undefined);
  const service = new InternalKnowledgeSearchService(
    prisma,
    {
      getTurnRetrievalScope,
      listDocuments,
      getParsedContentChunk,
    },
    { search } as unknown as KnowledgeRetrievalOrchestrator,
    { register, registerAssetSources } as unknown as TurnKnowledgeSourceStore,
    {
      registerDocument,
      registerListCursor,
      readListCursor,
      registerMarkdownCursor,
      readMarkdownCursor,
      readDocument,
      markContentVerified,
    } as never,
    { assertAvailable },
  );
  return {
    service,
    search,
    register,
    registerAssetSources,
    registerDocument,
    registerListCursor,
    readListCursor,
    registerMarkdownCursor,
    readMarkdownCursor,
    readDocument,
    markContentVerified,
    listDocuments,
    getParsedContentChunk,
    getTurnRetrievalScope,
    assertAvailable,
    rerankCandidates,
  };
}

describe("InternalKnowledgeSearchService", () => {
  it("collects unique valid knowledge image references for turn authorization", () => {
    expect(
      collectKnowledgeAssetReferenceIds(
        `![一](kb-asset://${ASSET_ID})\n![重复](kb-asset://${ASSET_ID.toUpperCase()})\nkb-asset://${UNRELATED_ASSET_ID}\n\`![代码](kb-asset://${UNRELATED_ASSET_ID})\`\n\`\`\`md\n![代码块](kb-asset://${UNRELATED_ASSET_ID})\n\`\`\``,
      ),
    ).toEqual([ASSET_ID]);
  });

  it("returns no-available-bases without calling external retrieval", async () => {
    const harness = createHarness({
      scopes: [
        {
          requested_ids: [BASE_ID],
          usable_ids: [],
          unavailable_ids: [BASE_ID],
        },
      ],
    });

    await expect(harness.service.search(input())).rejects.toMatchObject({
      code: "KNOWLEDGE_NO_AVAILABLE_BASES",
    });
    expect(harness.search).not.toHaveBeenCalled();
    expect(harness.register).not.toHaveBeenCalled();
    expect(harness.assertAvailable).not.toHaveBeenCalled();
  });

  it("blocks retrieval while full-index maintenance is unavailable", async () => {
    const maintenanceError = Object.assign(new Error("maintenance"), {
      code: "KNOWLEDGE_MAINTENANCE_UNAVAILABLE",
    });
    const harness = createHarness({ maintenanceError });

    await expect(harness.service.search(input())).rejects.toBe(
      maintenanceError,
    );
    expect(harness.assertAvailable).toHaveBeenCalledOnce();
    expect(harness.search).not.toHaveBeenCalled();
    expect(harness.register).not.toHaveBeenCalled();
  });

  it("returns only safe parent fields and registers an opaque turn source", async () => {
    const harness = createHarness({
      markdown: `完整父段内容\n\n![流程](kb-asset://${ASSET_ID})`,
      scopes: [
        {
          requested_ids: [BASE_ID, "00000000-0000-4000-8000-000000000099"],
          usable_ids: [BASE_ID],
          unavailable_ids: ["00000000-0000-4000-8000-000000000099"],
        },
        {
          requested_ids: [BASE_ID, "00000000-0000-4000-8000-000000000099"],
          usable_ids: [BASE_ID],
          unavailable_ids: ["00000000-0000-4000-8000-000000000099"],
        },
      ],
    });

    await expect(harness.service.search(input())).resolves.toEqual({
      success: true,
      results: [
        {
          source_ref: "source_ref_00000000000000000001",
          citation_marker: "[[kb-source:source_ref_00000000000000000001]]",
          document_ref: "document_ref_0000000000000000001",
          knowledge_base_name: "产品 制度",
          document_name: "发布手册.pdf",
          document_version_id: VERSION_ID,
          title_path: ["第一章", "发布"],
          page_numbers: [2],
          location: "page 2 · 第一章 › 发布",
          content: `完整父段内容\n\n![流程](kb-asset://${ASSET_ID})`,
        },
      ],
      unavailable_knowledge_base_count: 1,
    });
    expect(harness.register).toHaveBeenCalledWith(TURN_ID, [
      expect.objectContaining({
        knowledgeBaseId: BASE_ID,
        documentVersionId: VERSION_ID,
        parentId: PARENT_ID,
        titlePath: ["第一章", "发布"],
        matchedChildIds: [`${VERSION_ID}:0:child`],
        pageNumbers: [2],
        assetReferenceIds: [ASSET_ID],
      }),
    ]);
    expect(harness.registerDocument).toHaveBeenCalledWith(TURN_ID, {
      knowledgeBaseId: BASE_ID,
      documentId: DOCUMENT_ID,
      documentVersionId: VERSION_ID,
    });
  });

  it("removes unavailable bases, deleted documents, and stale versions before rerank", async () => {
    const unavailableBaseId = "00000000-0000-4000-8000-000000000007";
    const deletedDocumentId = "00000000-0000-4000-8000-000000000008";
    const staleDocumentId = "00000000-0000-4000-8000-000000000009";
    const staleVersionId = "00000000-0000-4000-8000-000000000010";
    const currentVersionId = "00000000-0000-4000-8000-000000000011";
    const currentScope = {
      requested_ids: [BASE_ID, unavailableBaseId],
      usable_ids: [BASE_ID, unavailableBaseId],
      unavailable_ids: [],
    };
    const harness = createHarness({
      scopes: [currentScope, currentScope, currentScope],
      applyCandidateFilter: true,
      parents: [
        parent(),
        parent({
          parentId: "00000000-0000-5000-8000-000000000008",
          knowledgeBaseId: unavailableBaseId,
          parentText: "unavailable base private content",
        }),
        parent({
          parentId: "00000000-0000-5000-8000-000000000009",
          documentId: deletedDocumentId,
          parentText: "deleted document private content",
        }),
        parent({
          parentId: "00000000-0000-5000-8000-000000000010",
          documentId: staleDocumentId,
          documentVersionId: staleVersionId,
          parentText: "stale version private content",
        }),
      ],
      bases: [{ id: BASE_ID, name: "产品制度" }],
      documents: [
        {
          id: DOCUMENT_ID,
          knowledgeBaseId: BASE_ID,
          displayName: "发布手册.pdf",
          canonicalExtension: "pdf",
          currentVersionId: VERSION_ID,
          activeProcessingVersionId: null,
        },
        {
          id: staleDocumentId,
          knowledgeBaseId: BASE_ID,
          displayName: "历史版本.pdf",
          canonicalExtension: "pdf",
          currentVersionId,
          activeProcessingVersionId: null,
        },
      ],
    });

    await expect(harness.service.search(input())).resolves.toMatchObject({
      success: true,
      results: [{ content: "完整父段内容" }],
    });
    expect(harness.rerankCandidates).toHaveLength(1);
    expect(harness.rerankCandidates[0]).toEqual([
      expect.objectContaining({ parentId: PARENT_ID }),
    ]);
    expect(JSON.stringify(harness.rerankCandidates)).not.toContain(
      "private content",
    );
  });

  it("uses the immutable start-intent snapshot during the runner projection race", async () => {
    const harness = createHarness({ turnProjected: false });

    await expect(harness.service.search(input())).resolves.toMatchObject({
      success: true,
      results: [{ document_name: "发布手册.pdf" }],
    });
    expect(harness.getTurnRetrievalScope).toHaveBeenCalledWith(
      expect.objectContaining({ id: OWNER_ID }),
      { turnId: TURN_ID },
    );
    expect(harness.register).toHaveBeenCalledWith(TURN_ID, expect.any(Array));
  });

  it("keeps current content searchable until a same-version rebuild enters its destructive window", async () => {
    const preparing = createHarness({ activeProcessingVersionId: VERSION_ID });

    await expect(preparing.service.search(input())).resolves.toMatchObject({
      success: true,
      results: [{ document_name: "发布手册.pdf" }],
    });

    // The real Prisma query returns no row after the activating transition
    // atomically changes this same-version rebuild document to processing.
    const replacing = createHarness({ documents: [] });
    await expect(replacing.service.search(input())).resolves.toMatchObject({
      success: true,
      results: [],
    });
    expect(replacing.register).toHaveBeenCalledWith(TURN_ID, []);

    const replacement = createHarness({
      activeProcessingVersionId: "00000000-0000-4000-8000-000000000007",
    });
    await expect(replacement.service.search(input())).resolves.toMatchObject({
      success: true,
      results: [{ document_name: "发布手册.pdf" }],
    });
  });

  it("maps private external failures and oversized results to a stable error", async () => {
    const unavailable = createHarness({
      retrievalError: new Error("private elasticsearch response"),
    });
    await expect(unavailable.service.search(input())).rejects.toMatchObject({
      code: "KNOWLEDGE_SEARCH_UNAVAILABLE",
    });

    const oversized = createHarness({ markdown: "x".repeat(2 * 1024 * 1024) });
    await expect(oversized.service.search(input())).rejects.toMatchObject({
      code: "KNOWLEDGE_SEARCH_UNAVAILABLE",
    });
    expect(oversized.register).not.toHaveBeenCalled();
  });

  it("maps invalid retrieval parameters to a non-retryable validation error", async () => {
    const harness = createHarness({
      retrievalError: new KnowledgeProcessingError(
        "KNOWLEDGE_RETRIEVAL_PARAMETERS_INVALID",
      ),
    });

    await expect(harness.service.search(input())).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    expect(harness.register).not.toHaveBeenCalled();
  });

  it("lists only searchable current document versions and returns opaque pagination state", async () => {
    const backendCursor = "00000000-0000-4000-8000-000000000020";
    const harness = createHarness({
      listNextCursor: backendCursor,
      listedDocuments: [
        {
          id: DOCUMENT_ID,
          display_name: "发布\n手册.pdf",
          canonical_extension: "pdf",
          current_version_id: VERSION_ID,
          searchable: true,
        },
        {
          id: "00000000-0000-4000-8000-000000000021",
          display_name: "处理中.pdf",
          canonical_extension: "pdf",
          current_version_id: null,
          searchable: false,
        },
      ],
    });

    await expect(
      harness.service.listDocuments({
        ownerId: OWNER_ID,
        conversationId: CONVERSATION_ID,
        turnId: TURN_ID,
      }),
    ).resolves.toEqual({
      success: true,
      documents: [
        {
          document_ref: "document_ref_0000000000000000001",
          knowledge_base_name: "产品 制度",
          document_name: "发布 手册.pdf",
          file_type: "pdf",
        },
      ],
      next_cursor: "list_cursor_000000000000000000001",
      unavailable_knowledge_base_count: 0,
    });
    expect(harness.listDocuments).toHaveBeenCalledWith(
      expect.objectContaining({ id: OWNER_ID }),
      BASE_ID,
      { status: "ready", limit: 100, turnId: TURN_ID },
    );
    expect(harness.registerListCursor).toHaveBeenCalledWith(TURN_ID, {
      knowledgeBaseId: BASE_ID,
      documentCursor: backendCursor,
    });
    expect(harness.registerDocument).toHaveBeenCalledTimes(1);
  });

  it("reads complete Markdown without overlap and verifies the immutable object only once", async () => {
    const markdownCursor = "markdown_cursor_00000000000000001";
    const harness = createHarness({
      scopes: [
        {
          requested_ids: [BASE_ID],
          usable_ids: [BASE_ID],
          unavailable_ids: [],
        },
        {
          requested_ids: [BASE_ID],
          usable_ids: [BASE_ID],
          unavailable_ids: [],
        },
        {
          requested_ids: [BASE_ID],
          usable_ids: [BASE_ID],
          unavailable_ids: [],
        },
        {
          requested_ids: [BASE_ID],
          usable_ids: [BASE_ID],
          unavailable_ids: [],
        },
      ],
      markdownCursorState: {
        documentRef: "document_ref_0000000000000000001",
        byteOffset: 12,
        chunkIndex: 1,
      },
      parsedChunks: [
        {
          markdown: "# 第一页\n",
          byteStart: 0,
          byteEnd: 12,
          totalBytes: 24,
          complete: false,
        },
        {
          markdown: "# 第二页\n",
          byteStart: 12,
          byteEnd: 24,
          totalBytes: 24,
          complete: true,
        },
      ],
    });
    harness.readDocument
      .mockResolvedValueOnce({
        knowledgeBaseId: BASE_ID,
        documentId: DOCUMENT_ID,
        documentVersionId: VERSION_ID,
        contentVerified: false,
      })
      .mockResolvedValueOnce({
        knowledgeBaseId: BASE_ID,
        documentId: DOCUMENT_ID,
        documentVersionId: VERSION_ID,
        contentVerified: true,
      });

    const first = await harness.service.getDocumentMarkdown({
      ownerId: OWNER_ID,
      conversationId: CONVERSATION_ID,
      turnId: TURN_ID,
      documentRef: "document_ref_0000000000000000001",
    });
    const second = await harness.service.getDocumentMarkdown({
      ownerId: OWNER_ID,
      conversationId: CONVERSATION_ID,
      turnId: TURN_ID,
      documentRef: "document_ref_0000000000000000001",
      cursor: markdownCursor,
    });

    expect(first).toMatchObject({
      markdown: "# 第一页\n",
      chunk_index: 0,
      byte_start: 0,
      byte_end: 12,
      next_cursor: markdownCursor,
      complete: false,
    });
    expect(second).toMatchObject({
      markdown: "# 第二页\n",
      chunk_index: 1,
      byte_start: 12,
      byte_end: 24,
      next_cursor: null,
      complete: true,
    });
    expect(first.markdown + second.markdown).toBe("# 第一页\n# 第二页\n");
    expect(harness.getParsedContentChunk).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ id: OWNER_ID }),
      BASE_ID,
      DOCUMENT_ID,
      VERSION_ID,
      {
        byteOffset: 0,
        maxBytes: 128 * 1024,
        turnId: TURN_ID,
        verifyIntegrity: true,
      },
    );
    expect(harness.getParsedContentChunk).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ id: OWNER_ID }),
      BASE_ID,
      DOCUMENT_ID,
      VERSION_ID,
      {
        byteOffset: 12,
        maxBytes: 128 * 1024,
        turnId: TURN_ID,
        verifyIntegrity: false,
      },
    );
    expect(harness.markContentVerified).toHaveBeenCalledOnce();
  });

  it("authorizes every knowledge image returned by full-document Markdown", async () => {
    const firstAssetId = ASSET_ID;
    const secondAssetId = UNRELATED_ASSET_ID;
    const harness = createHarness({
      parsedChunks: [
        {
          markdown: `# 完整文档\n\n![首页](kb-asset://${firstAssetId})\n![流程](kb-asset://${secondAssetId})\n`,
          byteStart: 0,
          byteEnd: 128,
          totalBytes: 128,
          complete: true,
        },
      ],
    });

    await harness.service.getDocumentMarkdown({
      ownerId: OWNER_ID,
      conversationId: CONVERSATION_ID,
      turnId: TURN_ID,
      documentRef: "document_ref_0000000000000000001",
    });

    expect(harness.registerAssetSources).toHaveBeenCalledWith(TURN_ID, [
      {
        knowledgeBaseId: BASE_ID,
        documentId: DOCUMENT_ID,
        documentVersionId: VERSION_ID,
        assetReferenceIds: [firstAssetId, secondAssetId],
      },
    ]);
  });

  it("rejects a Markdown cursor bound to another document before reading storage", async () => {
    const harness = createHarness({
      markdownCursorState: {
        documentRef: "another_document_ref_00000000001",
        byteOffset: 12,
        chunkIndex: 1,
      },
    });

    await expect(
      harness.service.getDocumentMarkdown({
        ownerId: OWNER_ID,
        conversationId: CONVERSATION_ID,
        turnId: TURN_ID,
        documentRef: "document_ref_0000000000000000001",
        cursor: "markdown_cursor_00000000000000001",
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(harness.getParsedContentChunk).not.toHaveBeenCalled();
  });

  it("does not return document names or Markdown after current access is revoked", async () => {
    const usable = {
      requested_ids: [BASE_ID],
      usable_ids: [BASE_ID],
      unavailable_ids: [],
    };
    const revoked = {
      requested_ids: [BASE_ID],
      usable_ids: [],
      unavailable_ids: [BASE_ID],
    };
    const listHarness = createHarness({ scopes: [usable, revoked] });
    await expect(
      listHarness.service.listDocuments({
        ownerId: OWNER_ID,
        conversationId: CONVERSATION_ID,
        turnId: TURN_ID,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(listHarness.registerDocument).not.toHaveBeenCalled();

    const markdownHarness = createHarness({ scopes: [usable, revoked] });
    await expect(
      markdownHarness.service.getDocumentMarkdown({
        ownerId: OWNER_ID,
        conversationId: CONVERSATION_ID,
        turnId: TURN_ID,
        documentRef: "document_ref_0000000000000000001",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(markdownHarness.registerMarkdownCursor).not.toHaveBeenCalled();
  });

  it("rejects a document reference after its exact current version changes", async () => {
    const harness = createHarness({ finalDocumentFound: false });

    await expect(
      harness.service.getDocumentMarkdown({
        ownerId: OWNER_ID,
        conversationId: CONVERSATION_ID,
        turnId: TURN_ID,
        documentRef: "document_ref_0000000000000000001",
      }),
    ).rejects.toMatchObject({ code: "KNOWLEDGE_DOCUMENT_NOT_FOUND" });
  });
});
