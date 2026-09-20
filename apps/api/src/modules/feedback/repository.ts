import {
  feedbackImageSchema,
  type FeedbackDetails,
  type FeedbackImage,
  type FeedbackSubmissionResult,
  type AdminFeedback,
  type AdminFeedbackPage,
} from "@linksense/shared";

import { AppError } from "../../lib/errors.js";
import type { PrismaClient } from "../../generated/prisma/client.js";
import type {
  CreateFeedbackRecord,
  CreateFeedbackReplyRecord,
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
    submitterId?: string;
  }): Promise<AdminFeedbackPage> {
    const rows = await this.prisma.feedback.findMany({
      where: input.submitterId ? { submitterId: input.submitterId } : {},
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
    const replyCounts =
      feedbackIds.length === 0
        ? []
        : await this.prisma.feedbackReply.groupBy({
            by: ["feedbackId"],
            where: { feedbackId: { in: feedbackIds } },
            _count: { _all: true },
          });
    const countsByFeedback = new Map(
      replyCounts.map((row) => [row.feedbackId, row._count._all]),
    );
    const imagesByFeedback = new Map<string, AdminFeedback["images"]>();
    for (const image of imageRows) {
      const images = imagesByFeedback.get(image.feedbackId) ?? [];
      images.push(publicImage(image));
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
        reply_count: countsByFeedback.get(feedback.id) ?? 0,
      })),
      next_cursor:
        hasMore && pageRows.length > 0 ? (pageRows.at(-1)?.id ?? null) : null,
    };
  }

  async findImage(input: {
    feedbackId: string;
    imageId: string;
    replyId?: string;
  }): Promise<FeedbackImageRecord | null> {
    if (
      input.replyId &&
      !(await this.prisma.feedbackReply.findFirst({
        where: { id: input.replyId, feedbackId: input.feedbackId },
        select: { id: true },
      }))
    )
      return null;
    const image = input.replyId
      ? await this.prisma.feedbackReplyImage.findFirst({
          where: { id: input.imageId, replyId: input.replyId },
        })
      : await this.prisma.feedbackImage.findFirst({
          where: { id: input.imageId, feedbackId: input.feedbackId },
        });
    if (!image || image.sizeBytes > BigInt(Number.MAX_SAFE_INTEGER))
      return null;
    return {
      id: image.id,
      feedbackId: input.feedbackId,
      objectKey: image.objectKey,
      filename: image.filename,
      mimeType: image.mimeType as FeedbackImageRecord["mimeType"],
      sizeBytes: Number(image.sizeBytes),
      checksumSha256: image.checksumSha256,
      sortOrder: image.sortOrder,
      createdAt: image.createdAt,
    };
  }

  async exists(input: {
    feedbackId: string;
    submitterId?: string;
  }): Promise<boolean> {
    return Boolean(
      await this.prisma.feedback.findFirst({
        where: {
          id: input.feedbackId,
          ...(input.submitterId ? { submitterId: input.submitterId } : {}),
        },
        select: { id: true },
      }),
    );
  }

  async createReply(
    input: CreateFeedbackReplyRecord,
  ): Promise<FeedbackSubmissionResult> {
    await this.prisma.$transaction(async (transaction) => {
      // A no-op parent update takes a row lock so concurrent deletion cannot leave orphan replies.
      const parent = await transaction.feedback.updateMany({
        where: { id: input.feedbackId },
        data: { id: input.feedbackId },
      });
      if (parent.count !== 1) throw new AppError("NOT_FOUND");
      await transaction.feedbackReply.create({
        data: {
          id: input.id,
          feedbackId: input.feedbackId,
          authorId: input.authorId,
          content: input.content,
          createdAt: input.createdAt,
        },
      });
      if (input.images.length > 0)
        await transaction.feedbackReplyImage.createMany({
          data: input.images.map((image) => ({
            id: image.id,
            replyId: input.id,
            objectKey: image.objectKey,
            filename: image.filename,
            mimeType: image.mimeType,
            sizeBytes: BigInt(image.sizeBytes),
            checksumSha256: image.checksumSha256,
            sortOrder: image.sortOrder,
            createdAt: image.createdAt,
          })),
        });
    });
    return {
      id: input.id,
      created_at: input.createdAt.toISOString(),
      image_count: input.images.length,
    };
  }

  async findDetails(input: {
    feedbackId: string;
    submitterId?: string;
  }): Promise<FeedbackDetails | null> {
    return this.prisma.$transaction(
      async (transaction) => {
        const feedback = await transaction.feedback.findFirst({
          where: {
            id: input.feedbackId,
            ...(input.submitterId ? { submitterId: input.submitterId } : {}),
          },
        });
        if (!feedback) return null;
        const images = await transaction.feedbackImage.findMany({
          where: { feedbackId: input.feedbackId },
          orderBy: { sortOrder: "asc" },
        });
        const replies = await transaction.feedbackReply.findMany({
          where: { feedbackId: input.feedbackId },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        });
        const authorIds = [...new Set(replies.map((reply) => reply.authorId))];
        const authors = authorIds.length
          ? await transaction.user.findMany({
              where: { id: { in: authorIds } },
              select: { id: true, name: true },
            })
          : [];
        const authorsById = new Map(
          authors.map((author) => [author.id, author.name]),
        );
        const replyImages = replies.length
          ? await transaction.feedbackReplyImage.findMany({
              where: { replyId: { in: replies.map((reply) => reply.id) } },
              orderBy: { sortOrder: "asc" },
            })
          : [];
        const imagesByReply = new Map<string, AdminFeedback["images"]>();
        for (const image of replyImages) {
          const group = imagesByReply.get(image.replyId) ?? [];
          group.push(publicImage(image));
          imagesByReply.set(image.replyId, group);
        }
        return {
          id: feedback.id,
          content: feedback.content,
          created_at: feedback.createdAt.toISOString(),
          images: images.map(publicImage),
          reply_count: replies.length,
          replies: replies.map((reply) => {
            const authorName = authorsById.get(reply.authorId);
            if (!authorName) throw new AppError("INTERNAL_ERROR");
            return {
              id: reply.id,
              author: { name: authorName },
              content: reply.content,
              created_at: reply.createdAt.toISOString(),
              images: imagesByReply.get(reply.id) ?? [],
            };
          }),
        };
      },
      { isolationLevel: "RepeatableRead" },
    );
  }

  async delete(feedbackId: string) {
    return this.prisma.$transaction(async (transaction) => {
      // Lock/delete the parent before reading attachments, serializing with reply creation.
      const deleted = await transaction.feedback.deleteMany({
        where: { id: feedbackId },
      });
      if (deleted.count !== 1) return null;
      const images = await transaction.feedbackImage.findMany({
        where: { feedbackId },
        select: { objectKey: true },
      });
      const replies = await transaction.feedbackReply.findMany({
        where: { feedbackId },
        select: { id: true },
      });
      const replyIds = replies.map((reply) => reply.id);
      const replyImages = await transaction.feedbackReplyImage.findMany({
        where: { replyId: { in: replyIds } },
        select: { objectKey: true },
      });
      await transaction.feedbackReplyImage.deleteMany({
        where: { replyId: { in: replyIds } },
      });
      await transaction.feedbackReply.deleteMany({ where: { feedbackId } });
      await transaction.feedbackImage.deleteMany({ where: { feedbackId } });
      return {
        id: feedbackId,
        imageObjectKeys: [...images, ...replyImages].map(
          (image) => image.objectKey,
        ),
      };
    });
  }
}

function publicImage(image: {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: bigint;
  sortOrder: number;
}): FeedbackImage {
  return feedbackImageSchema.parse({
    id: image.id,
    filename: image.filename,
    mime_type: image.mimeType,
    size_bytes: Number(image.sizeBytes),
    sort_order: image.sortOrder,
  });
}
