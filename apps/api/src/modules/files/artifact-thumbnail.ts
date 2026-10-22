import { createHash } from "node:crypto";
import { addAbortSignal, type Readable } from "node:stream";
import { setTimeout } from "node:timers/promises";

import { taskArtifactThumbnail } from "@linksense/shared";
import sharp from "sharp";

import type { ObjectStorage } from "../../adapters/object-storage.js";
import type { LinkSenseRedis } from "../../adapters/redis.js";
import type { PrismaClient } from "../../generated/prisma/client.js";
import { AppError } from "../../lib/errors.js";

type ThumbnailStorage = Pick<
  ObjectStorage,
  "getObjectStream" | "putObject" | "removeObject"
>;

export type ArtifactThumbnailSource = {
  conversationId: string;
  fileId: string;
  objectKey: string;
  mimeType: string;
  sizeBytes: number;
  checksumSha256: string | null;
};

export function artifactThumbnailObjectKey(
  conversationId: string,
  fileId: string,
): string {
  return `conversations/${conversationId}/artifacts/${fileId}/thumbnails/v1.webp`;
}

/** The file ID is immutable; change the revision when the encoding specification changes. */
export async function getOrCreateArtifactThumbnail(input: {
  source: ArtifactThumbnailSource;
  storage: ThumbnailStorage;
  coordinator: Pick<
    LinkSenseRedis,
    "acquireArtifactThumbnailLease" | "releaseArtifactThumbnailLease"
  >;
  maximumSourceBytes: number;
  maxInputPixels?: number;
  assertCurrent: () => Promise<void>;
  scheduleRemoval: (objectKey: string) => Promise<void>;
}): Promise<Buffer> {
  const { source, storage, coordinator } = input;
  if (source.sizeBytes <= 0 || source.sizeBytes > input.maximumSourceBytes)
    throw new AppError("ARTIFACT_NOT_FOUND");
  const key = artifactThumbnailObjectKey(source.conversationId, source.fileId);
  const cached = await readCachedThumbnail(storage, key);
  if (cached) return cached;

  // Redis coordinates duplicate work and the decoding budget across API workers.
  let token: string | null = null;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    token = await coordinator.acquireArtifactThumbnailLease(source.fileId);
    if (token) break;
    await setTimeout(100);
  }
  if (!token) throw new AppError("CONFLICT");
  try {
    const completed = await readCachedThumbnail(storage, key);
    if (completed) return completed;
    const original = await readBoundedObject(
      storage,
      source.objectKey,
      input.maximumSourceBytes,
    );
    if (
      original.byteLength !== source.sizeBytes ||
      (source.checksumSha256 !== null &&
        createHash("sha256").update(original).digest("hex") !==
          source.checksumSha256.toLowerCase())
    ) {
      throw new AppError("ARTIFACT_NOT_FOUND");
    }
    let thumbnail: Buffer;
    try {
      const processor = sharp(original, {
        failOn: "error",
        limitInputPixels: input.maxInputPixels ?? 40_000_000,
        animated: false,
      }).timeout({ seconds: 5 });
      const metadata = await processor.metadata();
      const expectedFormat =
        source.mimeType === "image/svg+xml"
          ? "svg"
          : source.mimeType === "image/avif"
            ? "heif"
            : source.mimeType.slice(6);
      if (
        metadata.format !== expectedFormat ||
        (expectedFormat === "heif" && metadata.compression !== "av1")
      )
        throw new AppError("ARTIFACT_NOT_FOUND");
      thumbnail = await processor
        .autoOrient()
        .resize({
          width: taskArtifactThumbnail.imageSize,
          height: taskArtifactThumbnail.imageSize,
          fit: "cover",
          withoutEnlargement: true,
        })
        .webp({ quality: 70, effort: 3 })
        .timeout({ seconds: 5 })
        .toBuffer();
    } catch {
      throw new AppError("ARTIFACT_NOT_FOUND");
    }
    if (thumbnail.byteLength > taskArtifactThumbnail.maximumBytes)
      throw new AppError("ARTIFACT_NOT_FOUND");
    await storage.putObject(key, thumbnail, { "content-type": "image/webp" });
    try {
      // Deletion can finish while the decoder runs. Do not recreate its cache afterwards.
      await input.assertCurrent();
    } catch (error) {
      await storage.removeObject(key).catch(() => input.scheduleRemoval(key));
      throw error;
    }
    return thumbnail;
  } finally {
    await coordinator.releaseArtifactThumbnailLease(source.fileId, token);
  }
}

async function readCachedThumbnail(
  storage: ThumbnailStorage,
  key: string,
): Promise<Buffer | null> {
  try {
    return await readBoundedObject(
      storage,
      key,
      taskArtifactThumbnail.maximumBytes,
    );
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      ["NoSuchKey", "NoSuchObject", "NotFound", "ENOENT"].includes(
        String(error.code),
      )
    )
      return null;
    throw error;
  }
}

async function readBoundedObject(
  storage: Pick<ObjectStorage, "getObjectStream">,
  key: string,
  maximumBytes: number,
): Promise<Buffer> {
  const stream: Readable = await storage.getObjectStream(key);
  addAbortSignal(AbortSignal.timeout(5_000), stream);
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for await (const chunk of stream) {
      if (!Buffer.isBuffer(chunk)) throw new AppError("ARTIFACT_NOT_FOUND");
      size += chunk.byteLength;
      if (size > maximumBytes) throw new AppError("ARTIFACT_NOT_FOUND");
      chunks.push(chunk);
    }
    if (size === 0) throw new AppError("ARTIFACT_NOT_FOUND");
    return Buffer.concat(chunks, size);
  } finally {
    stream.destroy();
  }
}

export async function removeConversationArtifactThumbnails(
  prisma: Pick<PrismaClient, "retainedArtifact">,
  storage: Pick<ObjectStorage, "removeObject">,
  ownerId: string,
  conversationId: string,
): Promise<void> {
  const artifacts = await prisma.retainedArtifact.findMany({
    where: { ownerId, conversationId },
    select: { originalFileId: true },
  });
  for (const artifact of artifacts)
    await storage.removeObject(
      artifactThumbnailObjectKey(conversationId, artifact.originalFileId),
    );
}
