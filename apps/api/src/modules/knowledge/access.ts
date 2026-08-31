import { createHash } from "node:crypto";
import type { Readable } from "node:stream";

import { z } from "zod";

import type { PrismaClient } from "../../generated/prisma/client.js";
import { AppError } from "../../lib/errors.js";
import type { KnowledgeObjectStore } from "../knowledge-processing/object-store.js";
import type {
  KnowledgeAssetFile,
  KnowledgeDocumentAccessAdapter,
  KnowledgeOriginalFile,
} from "./types.js";
import { resolveOriginalSource } from "./original-source.js";

const MAX_MARKDOWN_BYTES = 200 * 1024 * 1024;
const MARKDOWN_BOUNDARY_LOOKAHEAD_BYTES = 8 * 1024;
const uuidSchema = z.string().uuid();

export class PrismaMinioKnowledgeDocumentAccessAdapter
  implements KnowledgeDocumentAccessAdapter
{
  constructor(
    private readonly prisma: PrismaClient,
    private readonly objectStore: KnowledgeObjectStore,
  ) {}

  async getParsedContent(input: {
    knowledgeBaseId: string;
    documentId: string;
    documentVersionId: string;
  }): Promise<{ markdown: string }> {
    const object = await this.findVersionObject({
      ...input,
      objectType: "display_markdown",
    });
    if (!object || object.sizeBytes > BigInt(MAX_MARKDOWN_BYTES)) {
      throw new AppError("KNOWLEDGE_DOCUMENT_CONTENT_NOT_READY");
    }
    try {
      const bytes = await readAndVerifyStream(
        await this.objectStore.getStream(object.objectKey),
        Number(object.sizeBytes),
        object.checksumSha256,
      );
      return { markdown: bytes.toString("utf8") };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError("KNOWLEDGE_PROCESSING_UNAVAILABLE");
    }
  }

  async getParsedContentChunk(input: {
    knowledgeBaseId: string;
    documentId: string;
    documentVersionId: string;
    byteOffset: number;
    maxBytes: number;
    verifyIntegrity: boolean;
  }): Promise<{
    markdown: string;
    byteStart: number;
    byteEnd: number;
    totalBytes: number;
    complete: boolean;
  }> {
    const object = await this.findVersionObject({
      knowledgeBaseId: input.knowledgeBaseId,
      documentId: input.documentId,
      documentVersionId: input.documentVersionId,
      objectType: "display_markdown",
    });
    const totalBytes = object === null ? -1 : Number(object.sizeBytes);
    if (
      object === null ||
      !Number.isSafeInteger(totalBytes) ||
      totalBytes < 0 ||
      totalBytes > MAX_MARKDOWN_BYTES ||
      !Number.isSafeInteger(input.byteOffset) ||
      input.byteOffset < 0 ||
      input.byteOffset >= Math.max(1, totalBytes) ||
      !Number.isSafeInteger(input.maxBytes) ||
      input.maxBytes <= 0 ||
      input.maxBytes > MAX_MARKDOWN_BYTES
    ) {
      throw new AppError("KNOWLEDGE_DOCUMENT_CONTENT_NOT_READY");
    }
    try {
      if (
        input.verifyIntegrity &&
        !(await this.objectStore.verifyIntegrity({
          key: object.objectKey,
          expectedSha256: object.checksumSha256,
          expectedSizeBytes: object.sizeBytes,
        }))
      ) {
        throw new AppError("KNOWLEDGE_DOCUMENT_CONTENT_NOT_READY");
      }
      if (totalBytes === 0) {
        return {
          markdown: "",
          byteStart: 0,
          byteEnd: 0,
          totalBytes: 0,
          complete: true,
        };
      }
      const remaining = totalBytes - input.byteOffset;
      const rangeLength = Math.min(
        remaining,
        input.maxBytes + MARKDOWN_BOUNDARY_LOOKAHEAD_BYTES,
      );
      const bytes = await readExactRange(
        await this.objectStore.getRangeStream(
          object.objectKey,
          input.byteOffset,
          rangeLength,
        ),
        rangeLength,
      );
      const chunkLength =
        remaining <= input.maxBytes
          ? remaining
          : chooseMarkdownChunkBoundary(bytes, input.maxBytes);
      const markdown = new TextDecoder("utf-8", { fatal: true }).decode(
        bytes.subarray(0, chunkLength),
      );
      return {
        markdown,
        byteStart: input.byteOffset,
        byteEnd: input.byteOffset + chunkLength,
        totalBytes,
        complete: input.byteOffset + chunkLength === totalBytes,
      };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError("KNOWLEDGE_PROCESSING_UNAVAILABLE");
    }
  }

  async getOriginal(input: {
    actorId: string;
    knowledgeBaseId: string;
    documentId: string;
    documentVersionId: string;
  }): Promise<KnowledgeOriginalFile> {
    const resolved = await this.findOriginalVersionObject(input);
    if (!resolved) throw new AppError("KNOWLEDGE_ORIGINAL_UNAVAILABLE");
    try {
      return {
        filename: resolved.version.originalFilename,
        mimeType: resolved.object.mimeType,
        sizeBytes: resolved.object.sizeBytes,
        stream: await this.objectStore.getStream(resolved.object.objectKey),
      };
    } catch {
      throw new AppError("KNOWLEDGE_ORIGINAL_UNAVAILABLE");
    }
  }

  async getAsset(input: {
    actorId: string;
    knowledgeBaseId: string;
    documentId: string;
    documentVersionId: string;
    assetReferenceId: string;
  }): Promise<KnowledgeAssetFile> {
    const object = await this.findVersionObject({
      ...input,
      objectType: "asset",
      assetReferenceId: uuidSchema.parse(input.assetReferenceId),
    });
    if (!object) throw new AppError("KNOWLEDGE_DOCUMENT_NOT_FOUND");
    try {
      return {
        filename: `asset-${object.assetReferenceId ?? object.id}.png`,
        mimeType: object.mimeType,
        sizeBytes: object.sizeBytes,
        stream: await this.objectStore.getStream(object.objectKey),
      };
    } catch {
      throw new AppError("KNOWLEDGE_PROCESSING_UNAVAILABLE");
    }
  }

  private async findOriginalVersionObject(input: {
    knowledgeBaseId: string;
    documentId: string;
    documentVersionId: string;
  }) {
    const version = await this.prisma.knowledgeBaseDocumentVersion.findFirst({
      where: {
        id: input.documentVersionId,
        knowledgeBaseId: input.knowledgeBaseId,
        documentId: input.documentId,
        versionStatus: { in: ["ready", "superseded"] },
      },
      select: {
        id: true,
        sourceVersionId: true,
        originalFilename: true,
      },
    });
    if (!version) return null;
    const source = await resolveOriginalSource(this.prisma, {
      knowledgeBaseId: input.knowledgeBaseId,
      documentId: input.documentId,
      startVersion: version,
    });
    return source ? { version, object: source.object } : null;
  }

  private async findVersionObject(input: {
    knowledgeBaseId: string;
    documentId: string;
    documentVersionId: string;
    objectType: "display_markdown" | "asset";
    assetReferenceId?: string;
  }) {
    const version = await this.prisma.knowledgeBaseDocumentVersion.findFirst({
      where: {
        id: input.documentVersionId,
        knowledgeBaseId: input.knowledgeBaseId,
        documentId: input.documentId,
        versionStatus: { in: ["ready", "superseded"] },
      },
      select: { displayMarkdownObjectId: true },
    });
    if (!version?.displayMarkdownObjectId) return null;
    const markdownObject = await this.prisma.knowledgeBaseObject.findFirst({
      where: {
        id: version.displayMarkdownObjectId,
        knowledgeBaseId: input.knowledgeBaseId,
        documentId: input.documentId,
        documentVersionId: input.documentVersionId,
        objectType: "display_markdown",
        lifecycleStatus: "active",
      },
    });
    if (!markdownObject || input.objectType === "display_markdown") {
      return markdownObject;
    }
    const assetReferenceId = input.assetReferenceId
      ? uuidSchema.parse(input.assetReferenceId)
      : null;
    if (assetReferenceId === null) return null;
    return this.prisma.knowledgeBaseObject.findFirst({
      where: {
        knowledgeBaseId: input.knowledgeBaseId,
        documentId: input.documentId,
        documentVersionId: input.documentVersionId,
        processingGeneration: markdownObject.processingGeneration,
        objectType: "asset",
        assetReferenceId,
        lifecycleStatus: "active",
      },
    });
  }
}

async function readAndVerifyStream(
  stream: Readable,
  expectedSize: number,
  expectedSha256: string,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  const hash = createHash("sha256");
  for await (const chunk of stream) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > expectedSize || size > MAX_MARKDOWN_BYTES) {
      stream.destroy();
      throw new AppError("KNOWLEDGE_DOCUMENT_CONTENT_NOT_READY");
    }
    chunks.push(bytes);
    hash.update(bytes);
  }
  if (size !== expectedSize || hash.digest("hex") !== expectedSha256) {
    throw new AppError("KNOWLEDGE_DOCUMENT_CONTENT_NOT_READY");
  }
  return Buffer.concat(chunks, size);
}

async function readExactRange(
  stream: Readable,
  expectedSize: number,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of stream) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > expectedSize) {
      stream.destroy();
      throw new AppError("KNOWLEDGE_DOCUMENT_CONTENT_NOT_READY");
    }
    chunks.push(bytes);
  }
  if (size !== expectedSize) {
    throw new AppError("KNOWLEDGE_DOCUMENT_CONTENT_NOT_READY");
  }
  return Buffer.concat(chunks, size);
}

function chooseMarkdownChunkBoundary(
  bytes: Buffer,
  preferredMaximum: number,
): number {
  const maximum = Math.min(preferredMaximum, bytes.length);
  const minimumUsefulBoundary = Math.floor(maximum / 2);
  const paragraphBoundary = bytes.lastIndexOf(
    Buffer.from("\n\n"),
    maximum - 1,
  );
  if (paragraphBoundary + 2 >= minimumUsefulBoundary) {
    return paragraphBoundary + 2;
  }
  const lineBoundary = bytes.lastIndexOf(0x0a, maximum - 1);
  if (lineBoundary + 1 >= minimumUsefulBoundary) return lineBoundary + 1;

  let boundary = maximum;
  while (
    boundary > 0 &&
    boundary < bytes.length &&
    (bytes[boundary]! & 0xc0) === 0x80
  ) {
    boundary -= 1;
  }
  if (boundary <= 0) {
    throw new AppError("KNOWLEDGE_DOCUMENT_CONTENT_NOT_READY");
  }
  return boundary;
}
