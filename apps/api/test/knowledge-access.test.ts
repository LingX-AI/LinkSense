import { createHash } from "node:crypto";
import { Readable } from "node:stream";

import { describe, expect, it, vi } from "vitest";

import { PrismaMinioKnowledgeDocumentAccessAdapter } from "../src/modules/knowledge/access.js";

const actorId = "10000000-0000-4000-8000-000000000001";
const knowledgeBaseId = "20000000-0000-4000-8000-000000000001";
const documentId = "30000000-0000-4000-8000-000000000001";
const documentVersionId = "40000000-0000-4000-8000-000000000001";
const originalRootVersionId = "40000000-0000-4000-8000-000000000002";
const assetReferenceId = "90000000-0000-4000-8000-000000000001";
const processingGeneration = "80000000-0000-4000-8000-000000000001";

describe("PrismaMinioKnowledgeDocumentAccessAdapter", () => {
  it("downloads an original through a historical source chain", async () => {
    const fixture = accessFixture();
    fixture.version.sourceVersionId = originalRootVersionId;
    fixture.originalHolder.versionId = originalRootVersionId;

    await expect(
      fixture.adapter.getOriginal({
        actorId,
        knowledgeBaseId,
        documentId,
        documentVersionId,
      }),
    ).resolves.toMatchObject({
      filename: "report.docx",
      sizeBytes: 5n,
    });

    expect(
      fixture.prisma.knowledgeBaseDocumentVersion.findFirst,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: originalRootVersionId }),
      }),
    );
  });

  it("reads and verifies the exact Docling display Markdown object", async () => {
    const fixture = accessFixture();

    await expect(
      fixture.adapter.getParsedContent({
        knowledgeBaseId,
        documentId,
        documentVersionId,
      }),
    ).resolves.toEqual({ markdown: fixture.markdown });
    expect(fixture.objectStore.getStream).toHaveBeenCalledWith(
      fixture.markdownObject.objectKey,
    );
  });

  it("fails closed when display Markdown integrity does not match", async () => {
    const fixture = accessFixture();
    fixture.markdownObject.checksumSha256 = "0".repeat(64);

    await expect(
      fixture.adapter.getParsedContent({
        knowledgeBaseId,
        documentId,
        documentVersionId,
      }),
    ).rejects.toMatchObject({
      code: "KNOWLEDGE_DOCUMENT_CONTENT_NOT_READY",
    });
  });

  it("reads verified Markdown in continuous UTF-8-safe chunks", async () => {
    const fixture = accessFixture("# 标题\n\n第一段包含中文。\n\n第二段结束。\n");
    const chunks: string[] = [];
    let byteOffset = 0;
    let complete = false;
    let first = true;

    while (!complete) {
      const chunk = await fixture.adapter.getParsedContentChunk({
        knowledgeBaseId,
        documentId,
        documentVersionId,
        byteOffset,
        maxBytes: 17,
        verifyIntegrity: first,
      });
      expect(chunk.byteStart).toBe(byteOffset);
      expect(chunk.byteEnd).toBeGreaterThan(chunk.byteStart);
      chunks.push(chunk.markdown);
      byteOffset = chunk.byteEnd;
      complete = chunk.complete;
      first = false;
    }

    expect(chunks.join("")).toBe(fixture.markdown);
    expect(byteOffset).toBe(Buffer.byteLength(fixture.markdown));
    expect(fixture.objectStore.verifyIntegrity).toHaveBeenCalledTimes(1);
    expect(fixture.objectStore.getRangeStream).toHaveBeenCalled();
  });

  it("does not return a Markdown range when first-page integrity verification fails", async () => {
    const fixture = accessFixture();
    fixture.objectStore.verifyIntegrity.mockResolvedValue(false);

    await expect(
      fixture.adapter.getParsedContentChunk({
        knowledgeBaseId,
        documentId,
        documentVersionId,
        byteOffset: 0,
        maxBytes: 8,
        verifyIntegrity: true,
      }),
    ).rejects.toMatchObject({
      code: "KNOWLEDGE_DOCUMENT_CONTENT_NOT_READY",
    });
    expect(fixture.objectStore.getRangeStream).not.toHaveBeenCalled();
  });

  it("serves only assets from the display Markdown generation", async () => {
    const fixture = accessFixture();

    await expect(
      fixture.adapter.getAsset({
        actorId,
        knowledgeBaseId,
        documentId,
        documentVersionId,
        assetReferenceId,
      }),
    ).resolves.toMatchObject({
      mimeType: "image/png",
      sizeBytes: 3n,
    });

    fixture.assetObject.processingGeneration =
      "80000000-0000-4000-8000-000000000099";
    await expect(
      fixture.adapter.getAsset({
        actorId,
        knowledgeBaseId,
        documentId,
        documentVersionId,
        assetReferenceId,
      }),
    ).rejects.toMatchObject({ code: "KNOWLEDGE_DOCUMENT_NOT_FOUND" });
  });
});

function accessFixture(markdown = "# 已校验内容\n") {
  const markdownBytes = Buffer.from(markdown);
  const originalBytes = Buffer.from("hello");
  const assetBytes = Buffer.from("png");
  const markdownObjectId = "60000000-0000-4000-8000-000000000001";
  const version = {
    id: documentVersionId,
    sourceVersionId: null as string | null,
    originalFilename: "report.docx",
    displayMarkdownObjectId: markdownObjectId,
  };
  const rootVersion = {
    id: originalRootVersionId,
    sourceVersionId: null,
  };
  const originalHolder = { versionId: documentVersionId };
  const originalObject = {
    id: "50000000-0000-4000-8000-000000000001",
    objectKey: "knowledge/original/report.docx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    sizeBytes: BigInt(originalBytes.length),
    checksumSha256: sha256(originalBytes),
  };
  const markdownObject = {
    id: markdownObjectId,
    processingGeneration,
    objectKey: "knowledge/markdown/report.md",
    mimeType: "text/markdown; charset=utf-8",
    sizeBytes: BigInt(markdownBytes.length),
    checksumSha256: sha256(markdownBytes),
    assetReferenceId: null,
  };
  const assetObject = {
    id: "a0000000-0000-4000-8000-000000000001",
    processingGeneration,
    objectKey: "knowledge/assets/image.png",
    mimeType: "image/png",
    sizeBytes: BigInt(assetBytes.length),
    checksumSha256: sha256(assetBytes),
    assetReferenceId,
  };
  const prisma = {
    knowledgeBaseDocumentVersion: {
      findFirst: vi.fn(
        async (query: { where?: { id?: string } }) =>
          query.where?.id === originalRootVersionId ? rootVersion : version,
      ),
    },
    knowledgeBaseObject: {
      findFirst: vi.fn(
        async (query: { where: Record<string, unknown> }) => {
          if (query.where.objectType === "original") {
            return query.where.documentVersionId === originalHolder.versionId
              ? originalObject
              : null;
          }
          if (query.where.objectType === "display_markdown")
            return markdownObject;
          if (
            query.where.objectType === "asset" &&
            query.where.assetReferenceId === assetReferenceId &&
            query.where.processingGeneration ===
              assetObject.processingGeneration
          ) {
            return assetObject;
          }
          return null;
        },
      ),
    },
  };
  const objectStore = {
    getStream: vi.fn(async (key: string) =>
      Readable.from(
        key === markdownObject.objectKey
          ? markdownBytes
          : key === assetObject.objectKey
            ? assetBytes
            : originalBytes,
      ),
    ),
    getRangeStream: vi.fn(
      async (key: string, offset: number, length: number) =>
        Readable.from(
          (key === markdownObject.objectKey
            ? markdownBytes
            : Buffer.alloc(0)
          ).subarray(offset, offset + length),
        ),
    ),
    verifyIntegrity: vi.fn(async () => true),
  };
  return {
    markdown,
    markdownObject,
    assetObject,
    version,
    originalHolder,
    prisma,
    objectStore,
    adapter: new PrismaMinioKnowledgeDocumentAccessAdapter(
      prisma as never,
      objectStore as never,
    ),
  };
}

function sha256(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}
