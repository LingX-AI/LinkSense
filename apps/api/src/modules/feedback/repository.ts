import type { AdminFeedback, AdminFeedbackPage } from "@linksense/shared";

import type { PrismaClient } from "../../generated/prisma/client.js";
import type {
  CreateFeedbackRecord,
  FeedbackImageRecord,
  FeedbackStore,
} from "./types.js";

export class PrismaFeedbackStore implements FeedbackStore {
  constructor(private readonly prisma: PrismaClient) {}

  async create(input: CreateFeedbackRecord) {
    await this.prisma.$transaction(async (transaction) => {
      await transaction.feedback.create({
        data: {
          id: input.id,
          submitterId: input.submitterId,
          submitterName: input.submitterName,
          submitterEmail: input.submitterEmail,
          content: input.content,
          createdAt: input.createdAt,
        },
      });
      if (input.images.length > 0) {
        await transaction.feedbackImage.createMany({
          data: input.images.map((image) => ({
            id: image.id,
            feedbackId: image.feedbackId,
            objectKey: image.objectKey,
            filename: image.filename,
            mimeType: image.mimeType,
            sizeBytes: BigInt(image.sizeBytes),
            checksumSha256: image.checksumSha256,
            sortOrder: image.sortOrder,
            createdAt: image.createdAt,
          })),
        });
      }
    });
    return {
      id: input.id,
      created_at: input.createdAt.toISOString(),
      image_count: input.images.length,
    };
  }

  async list(input: {
    cursor?: string;
    limit: number;
  }): Promise<AdminFeedbackPage> {
    const rows = await this.prisma.feedback.findMany({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: input.limit + 1,
      ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > input.limit;
    const pageRows = rows.slice(0, input.limit);
    const feedbackIds = pageRows.map((feedback) => feedback.id);
    const imageRows =
      feedbackIds.length === 0
        ? []
        : await this.prisma.feedbackImage.findMany({
            where: { feedbackId: { in: feedbackIds } },
            orderBy: [{ feedbackId: "asc" }, { sortOrder: "asc" }],
          });
    const imagesByFeedback = new Map<string, AdminFeedback["images"]>();
    for (const image of imageRows) {
      const images = imagesByFeedback.get(image.feedbackId) ?? [];
      images.push({
        id: image.id,
        filename: image.filename,
        mime_type: image.mimeType as FeedbackImageRecord["mimeType"],
        size_bytes: Number(image.sizeBytes),
        sort_order: image.sortOrder,
      });
      imagesByFeedback.set(image.feedbackId, images);
    }
    return {
      items: pageRows.map((feedback) => ({
        id: feedback.id,
        content: feedback.content,
        created_at: feedback.createdAt.toISOString(),
        submitter: {
          id: feedback.submitterId,
          name: feedback.submitterName,
          email: feedback.submitterEmail,
        },
        images: imagesByFeedback.get(feedback.id) ?? [],
      })),
      next_cursor:
        hasMore && pageRows.length > 0 ? (pageRows.at(-1)?.id ?? null) : null,
    };
  }

  async findImage(input: {
    feedbackId: string;
    imageId: string;
  }): Promise<FeedbackImageRecord | null> {
    const image = await this.prisma.feedbackImage.findFirst({
      where: { id: input.imageId, feedbackId: input.feedbackId },
    });
    if (!image || image.sizeBytes > BigInt(Number.MAX_SAFE_INTEGER))
      return null;
    return {
      id: image.id,
      feedbackId: image.feedbackId,
      objectKey: image.objectKey,
      filename: image.filename,
      mimeType: image.mimeType as FeedbackImageRecord["mimeType"],
      sizeBytes: Number(image.sizeBytes),
      checksumSha256: image.checksumSha256,
      sortOrder: image.sortOrder,
      createdAt: image.createdAt,
    };
  }

  async delete(feedbackId: string) {
    return this.prisma.$transaction(async (transaction) => {
      const images = await transaction.feedbackImage.findMany({
        where: { feedbackId },
        select: { objectKey: true },
      });
      const deleted = await transaction.feedback.deleteMany({
        where: { id: feedbackId },
      });
      if (deleted.count !== 1) return null;
      await transaction.feedbackImage.deleteMany({ where: { feedbackId } });
      return {
        id: feedbackId,
        imageObjectKeys: images.map((image) => image.objectKey),
      };
    });
  }
}
