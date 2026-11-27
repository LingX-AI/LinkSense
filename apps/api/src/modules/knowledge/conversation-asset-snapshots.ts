import { createHash, randomUUID } from "node:crypto";
import { addAbortSignal } from "node:stream";
import { fileTypeFromBuffer } from "file-type";
import pLimit from "p-limit";
import { z } from "zod";

import type { ObjectStorage } from "../../adapters/object-storage.js";
import type { Prisma, PrismaClient } from "../../generated/prisma/client.js";
import { AppError } from "../../lib/errors.js";
import type { FileCleanupScheduler } from "../files/service.js";
import { ConversationAssetRepository } from "./conversation-asset-repository.js";
import type { TurnKnowledgeScopeResolver } from "./internal-search.js";
import type {
  KnowledgeActor,
  KnowledgeDocumentAccessAdapter,
} from "./types.js";

const sourceSchema = z.strictObject({
  knowledgeBaseId: z.uuid(),
  documentId: z.uuid(),
  documentVersionId: z.uuid(),
  assetReferenceIds: z.array(z.uuid()).max(1_000),
});
export type ConversationAssetSource = z.infer<typeof sourceSchema>;
export type CheckKnowledgeAssetPublication = (
  tx: Prisma.TransactionClient,
  source: ConversationAssetSource,
) => Promise<void>;
export interface ConversationAssetSnapshotWriter {
  capture(input: {
    actor: KnowledgeActor;
    conversationId: string;
    turnId: string;
    sources: readonly ConversationAssetSource[];
    signal?: AbortSignal;
    checkPublication?: CheckKnowledgeAssetPublication;
  }): Promise<void>;
}

const MAX_IMAGES_PER_RESULT = 256;
const MAX_IMAGE_BYTES = 16 * 1024 * 1024;
const IMAGE_READ_TIMEOUT_MS = 30_000;
const IMAGE_CLEANUP_TIMEOUT_MS = 5_000;
const IMAGE_MIMES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

/**
 * Materializes images at the authorized retrieval boundary, before their
 * references enter model context. No browser request performs a backfill.
 * Existing conversation-file retention, fork and object-GC rules own copies.
 */
export class ConversationAssetSnapshots implements ConversationAssetSnapshotWriter {
  private readonly repository: ConversationAssetRepository;

  constructor(
    prisma: PrismaClient,
    private readonly storage: Pick<ObjectStorage, "putObject" | "removeObject">,
    private readonly originals: Pick<
      KnowledgeDocumentAccessAdapter,
      "getAsset"
    >,
    private readonly scopes: Pick<
      TurnKnowledgeScopeResolver,
      "getTurnRetrievalScope"
    >,
    private readonly cleanup: Pick<FileCleanupScheduler, "enqueueObjectDelete">,
  ) {
    this.repository = new ConversationAssetRepository(prisma);
  }

  async capture(
    input: Parameters<ConversationAssetSnapshotWriter["capture"]>[0],
  ): Promise<void> {
    z.uuid().parse(input.conversationId);
    z.uuid().parse(input.turnId);
    if (input.actor.status !== "active") throw new AppError("NOT_FOUND");
    const sources = z.array(sourceSchema).max(1_000).parse(input.sources);
    const images = new Map<
      string,
      { source: ConversationAssetSource; assetId: string }
    >();
    for (const source of sources) {
      for (const assetId of source.assetReferenceIds) {
        images.set(assetId, { source, assetId });
      }
    }
    if (images.size === 0) return;
    if (images.size > MAX_IMAGES_PER_RESULT)
      throw new AppError("FILE_LIMIT_EXCEEDED");
    const scope = await this.scopes.getTurnRetrievalScope(input.actor, {
      turnId: input.turnId,
    });
    if (
      [...images.values()].some(
        ({ source }) => !scope.usable_ids.includes(source.knowledgeBaseId),
      )
    ) {
      throw new AppError("FORBIDDEN");
    }
    const limit = pLimit(4);
    // Settle every copy before returning so a failed sibling never leaves
    // unmanaged promises uploading files after this operation has ended.
    const results = await Promise.allSettled(
      [...images.values()].map(({ source, assetId }) =>
        limit(() => this.copyOne(input, source, assetId)),
      ),
    );
    const failed = results.find((result) => result.status === "rejected");
    if (failed?.status === "rejected") throw failed.reason;
  }

  private async copyOne(
    input: Parameters<ConversationAssetSnapshotWriter["capture"]>[0],
    source: ConversationAssetSource,
    assetId: string,
  ): Promise<void> {
    const { signal, checkPublication } = input;
    signal?.throwIfAborted();
    if (
      await this.repository.exists({
        conversationId: input.conversationId,
        assetId,
      })
    )
      return;
    signal?.throwIfAborted();
    const readTimeout = AbortSignal.timeout(IMAGE_READ_TIMEOUT_MS);
    const readSignal = signal ? AbortSignal.any([signal, readTimeout]) : readTimeout;
    const original = await this.originals.getAsset({
      actorId: input.actor.id,
      knowledgeBaseId: source.knowledgeBaseId,
      documentId: source.documentId,
      documentVersionId: source.documentVersionId,
      assetReferenceId: assetId,
      signal: readSignal,
    });
    let data: Buffer;
    try {
      readSignal.throwIfAborted();
      if (
        original.sizeBytes <= 0n ||
        original.sizeBytes > BigInt(MAX_IMAGE_BYTES)
      ) {
        throw new AppError("FILE_LIMIT_EXCEEDED");
      }
      addAbortSignal(readSignal, original.stream);
      const chunks: Buffer[] = [];
      let bytes = 0;
      for await (const raw of original.stream) {
        const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
        bytes += chunk.byteLength;
        if (bytes > MAX_IMAGE_BYTES || BigInt(bytes) > original.sizeBytes) {
          throw new AppError("FILE_LIMIT_EXCEEDED");
        }
        chunks.push(chunk);
      }
      if (BigInt(bytes) !== original.sizeBytes)
        throw new AppError("KNOWLEDGE_PROCESSING_UNAVAILABLE");
      data = Buffer.concat(chunks);
    } catch (error) {
      if (readTimeout.aborted && !signal?.aborted) throw new AppError("KNOWLEDGE_PROCESSING_UNAVAILABLE");
      throw error;
    } finally {
      original.stream.destroy();
    }
    const detected = await fileTypeFromBuffer(data);
    if (
      !detected ||
      !IMAGE_MIMES.has(detected.mime) ||
      detected.mime !== original.mimeType
    ) {
      throw new AppError("ARTIFACT_REGISTRATION_INVALID");
    }
    const id = randomUUID();
    const filename = `${assetId}.${detected.ext}`;
    const objectKey = `conversations/${input.conversationId}/artifacts/${id}/${filename}`;
    signal?.throwIfAborted();
    let retained = false;
    try {
      await this.storage.putObject(objectKey, data, {
        "content-type": detected.mime,
        "knowledge-base-id": source.knowledgeBaseId,
        "knowledge-document-id": source.documentId,
        "knowledge-document-version-id": source.documentVersionId,
        "knowledge-asset-id": assetId,
      }, signal);
      const scope = await this.scopes.getTurnRetrievalScope(input.actor, {
        turnId: input.turnId,
      });
      if (!scope.usable_ids.includes(source.knowledgeBaseId))
        throw new AppError("FORBIDDEN");
        signal?.throwIfAborted();
      retained = await this.repository.publish({
        id,
        actorId: input.actor.id,
        conversationId: input.conversationId,
        turnId: input.turnId,
        assetId,
        filename,
        mimeType: detected.mime,
        sizeBytes: BigInt(data.byteLength),
        checksumSha256: createHash("sha256").update(data).digest("hex"),
        objectKey,
      }, {
        ...(signal ? { signal } : {}),
        ...(checkPublication ? { check: tx => checkPublication(tx, source) } : {}),
      });
    } finally {
      if (!retained) {
        // Each attempt has a unique object key; a duplicate request must never
        // remove the winning snapshot. Queue failures are propagated, not hidden.
        await this.storage
          .removeObject(objectKey, AbortSignal.timeout(IMAGE_CLEANUP_TIMEOUT_MS))
          .catch(() => this.cleanup.enqueueObjectDelete(objectKey));
      }
    }
  }
}
