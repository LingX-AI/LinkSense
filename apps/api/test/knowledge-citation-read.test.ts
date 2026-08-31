import { describe, expect, it, vi } from "vitest";

import type { PrismaClient } from "../src/generated/prisma/client.js";
import {
  KnowledgeCitationReadService,
  sanitizeCitationExcerpt,
  type KnowledgeCitationEvidenceReader,
} from "../src/modules/knowledge/citation-read.js";
import type { KnowledgeService } from "../src/modules/knowledge/service.js";
import type { KnowledgeActor } from "../src/modules/knowledge/types.js";

const ACTOR_ID = "00000000-0000-4000-8000-000000000001";
const CONVERSATION_ID = "00000000-0000-4000-8000-000000000002";
const TURN_ID = "00000000-0000-4000-8000-000000000003";
const MESSAGE_ID = "00000000-0000-4000-8000-000000000004";
const CITATION_ID = "00000000-0000-4000-8000-000000000005";
const BASE_ID = "00000000-0000-4000-8000-000000000006";
const DOCUMENT_ID = "00000000-0000-4000-8000-000000000007";
const VERSION_ID = "00000000-0000-4000-8000-000000000008";
const PARENT_ID = "00000000-0000-5000-8000-000000000009";
const CHILD_ID = `${VERSION_ID}:0:child`;

const actor: KnowledgeActor = {
  id: ACTOR_ID,
  role: "user",
  status: "active",
};

describe("KnowledgeCitationReadService", () => {
  it("returns a safe parent excerpt and page-level summary without reading or slicing Markdown", async () => {
    const harness = createHarness();

    await expect(harness.service.resolve(actor, CITATION_ID)).resolves.toEqual({
      status: "available",
      citation_id: CITATION_ID,
      citation_no: 1,
      summary: {
        knowledge_base_name: "制度库",
        document_name: "安全策略.pdf",
        title_path: ["第一章", "访问控制"],
        page_numbers: [3],
      },
      parent_excerpt: "# 第一章\n\n证据内容",
      original: { supported: true, renderer: "file" },
    });
    expect(harness.getParentEvidence).toHaveBeenCalledWith({
      knowledgeBaseId: BASE_ID,
      documentId: DOCUMENT_ID,
      documentVersionId: VERSION_ID,
      parentId: PARENT_ID,
      matchedChildIds: [CHILD_ID],
    });
    expect("getParsedContent" in harness.knowledge).toBe(false);
  });

  it("allows a document-level citation when the source has no reliable page number", async () => {
    const harness = createHarness({
      citation: { pageNumbers: [] },
      evidencePages: [],
    });

    await expect(
      harness.service.resolve(actor, CITATION_ID),
    ).resolves.toMatchObject({
      status: "available",
      summary: { page_numbers: [] },
    });
  });

  it("fails closed when persisted pages do not match the selected Hybrid children", async () => {
    const harness = createHarness({ evidencePages: [4] });

    await expect(
      harness.service.resolve(actor, CITATION_ID),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("fails closed when a selected child or parent no longer exists", async () => {
    const harness = createHarness({ evidence: null });

    await expect(
      harness.service.resolve(actor, CITATION_ID),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("uses display snapshots for a fully deleted historical source", async () => {
    const harness = createHarness({
      knowledgeBase: { id: BASE_ID, name: "current" },
      document: null,
      version: null,
      tombstone: { id: DOCUMENT_ID },
    });

    await expect(harness.service.resolve(actor, CITATION_ID)).resolves.toEqual({
      status: "historical_unavailable",
      citation_id: CITATION_ID,
      citation_no: 1,
      summary: {
        knowledge_base_name: "制度库快照",
        document_name: "安全策略快照.pdf",
        title_path: ["第一章", "访问控制"],
        page_numbers: [3],
      },
    });
    expect(harness.getParentEvidence).not.toHaveBeenCalled();
  });

  it("keeps original file access behind current citation authorization", async () => {
    const harness = createHarness();

    await harness.service.getOriginalPreview(actor, CITATION_ID);

    expect(harness.knowledge.getOriginalPreview).toHaveBeenCalledWith(
      actor,
      BASE_ID,
      DOCUMENT_ID,
      VERSION_ID,
    );
  });

  it("loads an image only through the currently authorized citation source", async () => {
    const assetId = "00000000-0000-4000-8000-000000000010";
    const harness = createHarness({
      parentText: `# 第一章\n\n证据内容\n\n![组织结构](kb-asset://${assetId})`,
    });

    await harness.service.getAsset(actor, CITATION_ID, assetId);

    expect(harness.knowledge.getAsset).toHaveBeenCalledWith(
      actor,
      BASE_ID,
      DOCUMENT_ID,
      VERSION_ID,
      assetId,
    );
  });

  it("rejects an asset that is not present in the cited parent projection", async () => {
    const harness = createHarness();

    await expect(
      harness.service.getAsset(
        actor,
        CITATION_ID,
        "00000000-0000-4000-8000-000000000010",
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(harness.knowledge.getAsset).not.toHaveBeenCalled();
  });

  it("does not authorize an asset id mentioned only as plain text", async () => {
    const assetId = "00000000-0000-4000-8000-000000000010";
    const harness = createHarness({
      parentText: `引用示例：kb-asset://${assetId}`,
    });

    await expect(
      harness.service.getAsset(actor, CITATION_ID, assetId),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(harness.knowledge.getAsset).not.toHaveBeenCalled();
  });
});

describe("sanitizeCitationExcerpt", () => {
  it("removes private asset locators, comments and control characters", () => {
    expect(
      sanitizeCitationExcerpt(
        "before<!--private-->![chart](kb-asset://asset_1)\u0000after",
      ),
    ).toBe("beforechart after");
  });
});

function createHarness(
  options: {
    citation?: Partial<ReturnType<typeof citation>>;
    evidence?: null;
    evidencePages?: number[];
    parentText?: string;
    knowledgeBase?: { id: string; name: string } | null;
    document?: {
      id: string;
      displayName: string;
      deletedAt: Date | null;
    } | null;
    version?: { id: string; versionStatus: string } | null;
    tombstone?: { id: string } | null;
  } = {},
) {
  const persistedCitation = { ...citation(), ...options.citation };
  const prisma = {
    conversationMessageKnowledgeCitation: {
      findUnique: vi.fn(async () => persistedCitation),
    },
    conversation: {
      findFirst: vi.fn(async () => ({ id: CONVERSATION_ID })),
    },
    conversationMessage: {
      findFirst: vi.fn(async () => ({ id: MESSAGE_ID })),
    },
    knowledgeBase: {
      findFirst: vi.fn(async () =>
        options.knowledgeBase === undefined
          ? { id: BASE_ID, name: "制度库" }
          : options.knowledgeBase,
      ),
    },
    knowledgeBaseDocument: {
      findFirst: vi.fn(async () =>
        options.document === undefined
          ? {
              id: DOCUMENT_ID,
              displayName: "安全策略.pdf",
              deletedAt: null,
            }
          : options.document,
      ),
    },
    knowledgeBaseDocumentVersion: {
      findFirst: vi.fn(async () =>
        options.version === undefined
          ? { id: VERSION_ID, versionStatus: "ready" }
          : options.version,
      ),
    },
    knowledgeBaseDocumentTombstone: {
      findFirst: vi.fn(async () => options.tombstone ?? null),
    },
    knowledgeBaseTombstone: {
      findFirst: vi.fn(async () => options.tombstone ?? null),
    },
  } as unknown as PrismaClient;
  const knowledge = {
    getDocument: vi.fn(async () => ({
      preview: { original_supported: true, renderer: "file" },
    })),
    getOriginalPreview: vi.fn(async () => ({ stream: null })),
    downloadOriginal: vi.fn(async () => ({ stream: null })),
    getAsset: vi.fn(async () => ({ stream: null })),
    subscribeEvents: vi.fn(),
  } as unknown as Pick<
    KnowledgeService,
    | "getDocument"
    | "getOriginalPreview"
    | "downloadOriginal"
    | "getAsset"
    | "subscribeEvents"
  >;
  const getParentEvidence = vi.fn(async () =>
    options.evidence === null
      ? null
      : {
          parentId: PARENT_ID,
          parentText: options.parentText ?? "# 第一章\n\n证据内容",
          matchedChildren: [
            {
              childId: CHILD_ID,
              order: 0,
              rawText: "证据内容",
              titlePath: ["第一章", "访问控制"],
              pageNumbers: options.evidencePages ?? [3],
            },
          ],
        },
  );
  const evidence = {
    getParentEvidence,
  } satisfies KnowledgeCitationEvidenceReader;
  return {
    service: new KnowledgeCitationReadService(prisma, knowledge, evidence),
    knowledge,
    getParentEvidence,
  };
}

function citation() {
  return {
    id: CITATION_ID,
    citationNo: 1,
    conversationId: CONVERSATION_ID,
    turnId: TURN_ID,
    messageId: MESSAGE_ID,
    knowledgeBaseId: BASE_ID,
    documentId: DOCUMENT_ID,
    documentVersionId: VERSION_ID,
    parentId: PARENT_ID,
    titlePath: ["第一章", "访问控制"],
    matchedChildIds: [CHILD_ID],
    pageNumbers: [3],
    knowledgeBaseNameSnapshot: "制度库快照",
    documentNameSnapshot: "安全策略快照.pdf",
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}
