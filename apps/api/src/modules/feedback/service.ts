import { createHash, randomUUID } from "node:crypto";

import {
  FEEDBACK_MAX_IMAGES,
  FEEDBACK_MAX_IMAGE_SIZE_BYTES,
  feedbackContentSchema,
  type FeedbackImageMimeType,
} from "@linksense/shared";
import { fileTypeFromBuffer } from "file-type";
import { z } from "zod";

import { AppError } from "../../lib/errors.js";
import type {
  FeedbackActor,
  FeedbackAudit,
  FeedbackCleanup,
  FeedbackImageContent,
  FeedbackImageRecord,
  FeedbackStorage,
  FeedbackStore,
  FeedbackUpload,
} from "./types.js";

const allowedImageTypes = new Map<FeedbackImageMimeType, string>([
  ["image/png", "png"],
  ["image/jpeg", "jpg"],
  ["image/webp", "webp"],
  ["image/gif", "gif"],
]);

const listInputSchema = z.strictObject({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export class FeedbackService {
  private readonly now: () => Date;
  private readonly createId: () => string;

  constructor(
    private readonly options: {
      store: FeedbackStore;
      storage: FeedbackStorage;
      cleanup: FeedbackCleanup;
      audit: FeedbackAudit;
      now?: () => Date;
      createId?: () => string;
    },
  ) {
    this.now = options.now ?? (() => new Date());
    this.createId = options.createId ?? randomUUID;
  }

  async submit(
    actor: FeedbackActor,
    input: { content: unknown; images: FeedbackUpload[] },
    context: { ipAddress?: string | null; userAgent?: string | null } = {},
  ) {
    const content = feedbackContentSchema.safeParse(input.content);
    if (!content.success || input.images.length > FEEDBACK_MAX_IMAGES) {
      throw new AppError("FEEDBACK_SUBMISSION_INVALID");
    }

    const feedbackId = this.createId();
    const createdAt = this.now();
    const preparedImages: FeedbackImageRecord[] = [];
    for (const [sortOrder, upload] of input.images.entries()) {
      preparedImages.push(
        await this.prepareImage(feedbackId, upload, sortOrder, createdAt),
      );
    }

    const uploadedKeys: string[] = [];
    try {
      for (const image of preparedImages) {
        const upload = input.images[image.sortOrder];
        if (!upload) throw new AppError("FEEDBACK_SUBMISSION_INVALID");
        await this.options.storage.putObject(image.objectKey, upload.bytes, {
          "content-type": image.mimeType,
          "original-filename": image.filename,
          "checksum-sha256": image.checksumSha256,
        });
        uploadedKeys.push(image.objectKey);
      }
    } catch (error) {
      await this.cleanupUploadedObjects(uploadedKeys);
      if (error instanceof AppError) throw error;
      throw new AppError("FEEDBACK_SUBMISSION_FAILED");
    }

    let result;
    try {
      result = await this.options.store.create({
        id: feedbackId,
        submitterId: actor.id,
        submitterName: actor.name,
        submitterEmail: actor.email,
        content: content.data,
        createdAt,
        images: preparedImages,
      });
    } catch {
      await this.cleanupUploadedObjects(uploadedKeys);
      throw new AppError("FEEDBACK_SUBMISSION_FAILED");
    }

    await this.options.audit
      .write({
        actorId: actor.id,
        action: "feedback_submitted",
        targetType: "feedback",
        targetId: feedbackId,
        result: "success",
        metadata: {
          image_count: preparedImages.length,
          content_length: content.data.length,
        },
        ...context,
      })
      .catch(() => undefined);
    return result;
  }

  listForAdmin(actor: FeedbackActor, input: unknown) {
    assertAdmin(actor);
    const parsed = listInputSchema.parse(input);
    return this.options.store.list({
      limit: parsed.limit,
      ...(parsed.cursor ? { cursor: parsed.cursor } : {}),
    });
  }

  async readImageForAdmin(
    actor: FeedbackActor,
    feedbackId: string,
    imageId: string,
  ): Promise<FeedbackImageContent> {
    assertAdmin(actor);
    const image = await this.options.store.findImage({ feedbackId, imageId });
    if (!image) throw new AppError("NOT_FOUND");
    const storedSize = await this.options.storage
      .getObjectSize(image.objectKey)
      .catch(() => 0);
    if (storedSize !== image.sizeBytes || storedSize <= 0) {
      throw new AppError("NOT_FOUND");
    }
    return {
      data: await this.options.storage.getObjectStream(image.objectKey),
      filename: image.filename,
      mimeType: image.mimeType,
      sizeBytes: image.sizeBytes,
    };
  }

  async deleteForAdmin(
    actor: FeedbackActor,
    feedbackId: string,
    context: { ipAddress?: string | null; userAgent?: string | null } = {},
  ): Promise<void> {
    assertAdmin(actor);
    const deleted = await this.options.store.delete(feedbackId);
    if (!deleted) throw new AppError("NOT_FOUND");

    await this.cleanupUploadedObjects(deleted.imageObjectKeys);
    await this.options.audit
      .write({
        actorId: actor.id,
        action: "feedback_deleted",
        targetType: "feedback",
        targetId: feedbackId,
        result: "success",
        metadata: { image_count: deleted.imageObjectKeys.length },
        ...context,
      })
      .catch(() => undefined);
  }

  private async prepareImage(
    feedbackId: string,
    upload: FeedbackUpload,
    sortOrder: number,
    createdAt: Date,
  ): Promise<FeedbackImageRecord> {
    if (
      upload.bytes.byteLength === 0 ||
      upload.bytes.byteLength > FEEDBACK_MAX_IMAGE_SIZE_BYTES
    ) {
      throw new AppError("FEEDBACK_SUBMISSION_INVALID");
    }
    const detected = await fileTypeFromBuffer(upload.bytes);
    const detectedMime = detected?.mime as FeedbackImageMimeType | undefined;
    const extension = detectedMime
      ? allowedImageTypes.get(detectedMime)
      : undefined;
    if (
      !detectedMime ||
      !extension ||
      upload.declaredMimeType !== detectedMime
    ) {
      throw new AppError("FEEDBACK_SUBMISSION_INVALID");
    }
    const imageId = this.createId();
    return {
      id: imageId,
      feedbackId,
      objectKey: `feedbacks/${feedbackId}/images/${imageId}.${extension}`,
      filename: sanitizeFilename(upload.filename),
      mimeType: detectedMime,
      sizeBytes: upload.bytes.byteLength,
      checksumSha256: createHash("sha256").update(upload.bytes).digest("hex"),
      sortOrder,
      createdAt,
    };
  }

  private async cleanupUploadedObjects(objectKeys: readonly string[]) {
    await Promise.all(
      objectKeys.map(async (objectKey) => {
        try {
          await this.options.storage.removeObject(objectKey);
        } catch {
          await this.options.cleanup
            .scheduleObjectRemoval(objectKey)
            .catch(() => undefined);
        }
      }),
    );
  }
}

function assertAdmin(actor: FeedbackActor) {
  if (actor.role !== "admin" || actor.status !== "active") {
    throw new AppError("FORBIDDEN");
  }
}

function sanitizeFilename(filename: string) {
  return (
    filename
      .normalize("NFKC")
      .split("")
      .filter((character) => {
        const codePoint = character.codePointAt(0);
        return codePoint !== undefined && codePoint > 31 && codePoint !== 127;
      })
      .join("")
      .replace(/[/\\]+/gu, "_")
      .trim()
      .slice(0, 260) || "feedback-image"
  );
}
