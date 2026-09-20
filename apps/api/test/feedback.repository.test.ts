import { describe, expect, it, vi } from "vitest";

import type { PrismaClient } from "../src/generated/prisma/client.js";
import { PrismaFeedbackStore } from "../src/modules/feedback/repository.js";

const NOW = new Date("2026-08-03T05:06:07.000Z");

describe("PrismaFeedbackStore", () => {
  it("persists feedback and ordered image metadata in one transaction", async () => {
    const transaction = {
      feedback: { create: vi.fn(async () => undefined) },
      feedbackImage: { createMany: vi.fn(async () => ({ count: 1 })) },
    };
    const prisma = {
      $transaction: vi.fn(async (callback) => callback(transaction)),
    } as unknown as PrismaClient;
    const store = new PrismaFeedbackStore(prisma);

    await store.create({
      id: "10000000-0000-4000-8000-000000000010",
      submitterId: "10000000-0000-4000-8000-000000000001",
      submitterName: "林晓",
      submitterEmail: "lin@example.com",
      content: "反馈内容",
      createdAt: NOW,
      images: [
        {
          id: "10000000-0000-4000-8000-000000000011",
          feedbackId: "10000000-0000-4000-8000-000000000010",
          objectKey: "feedbacks/f/images/i.png",
          filename: "i.png",
          mimeType: "image/png",
          sizeBytes: 68,
          checksumSha256: "a".repeat(64),
          sortOrder: 0,
          createdAt: NOW,
        },
      ],
    });

    expect(transaction.feedback.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ content: "反馈内容" }),
    });
    expect(transaction.feedbackImage.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          feedbackId: "10000000-0000-4000-8000-000000000010",
          sizeBytes: 68n,
          sortOrder: 0,
        }),
      ],
    });
  });

  it("returns cursor-paginated feedback with ordered images and snapshot submitters", async () => {
    const feedback = {
      id: "10000000-0000-4000-8000-000000000010",
      submitterId: "10000000-0000-4000-8000-000000000001",
      submitterName: "林晓",
      submitterEmail: "lin@example.com",
      content: "反馈内容",
      createdAt: NOW,
    };
    const prisma = {
      feedback: {
        findMany: vi.fn(async () => [
          feedback,
          { ...feedback, id: "10000000-0000-4000-8000-000000000099" },
        ]),
      },
      feedbackReply: { groupBy: vi.fn(async () => []) },
      feedbackImage: {
        findMany: vi.fn(async () => [
          {
            id: "10000000-0000-4000-8000-000000000011",
            feedbackId: feedback.id,
            filename: "i.png",
            mimeType: "image/png",
            sizeBytes: 68n,
            sortOrder: 0,
          },
        ]),
      },
    } as unknown as PrismaClient;
    const store = new PrismaFeedbackStore(prisma);

    await expect(store.list({ limit: 1 })).resolves.toEqual({
      items: [
        {
          id: feedback.id,
          content: "反馈内容",
          reply_count: 0,
          created_at: NOW.toISOString(),
          submitter: {
            id: feedback.submitterId,
            name: "林晓",
            email: "lin@example.com",
          },
          images: [
            {
              id: "10000000-0000-4000-8000-000000000011",
              filename: "i.png",
              mime_type: "image/png",
              size_bytes: 68,
              sort_order: 0,
            },
          ],
        },
      ],
      next_cursor: feedback.id,
    });
  });

  it("deletes feedback and image metadata atomically and returns object keys", async () => {
    const transaction = {
      feedbackReply: {
        findMany: vi.fn(async () => []),
        deleteMany: vi.fn(async () => ({ count: 0 })),
      },
      feedbackReplyImage: {
        findMany: vi.fn(async () => []),
        deleteMany: vi.fn(async () => ({ count: 0 })),
      },
      feedback: { deleteMany: vi.fn(async () => ({ count: 1 })) },
      feedbackImage: {
        findMany: vi.fn(async () => [
          { objectKey: "feedbacks/f/images/one.png" },
          { objectKey: "feedbacks/f/images/two.png" },
        ]),
        deleteMany: vi.fn(async () => ({ count: 2 })),
      },
    };
    const prisma = {
      $transaction: vi.fn(async (callback) => callback(transaction)),
    } as unknown as PrismaClient;
    const store = new PrismaFeedbackStore(prisma);

    await expect(
      store.delete("10000000-0000-4000-8000-000000000010"),
    ).resolves.toEqual({
      id: "10000000-0000-4000-8000-000000000010",
      imageObjectKeys: [
        "feedbacks/f/images/one.png",
        "feedbacks/f/images/two.png",
      ],
    });
    expect(transaction.feedbackImage.deleteMany).toHaveBeenCalledWith({
      where: { feedbackId: "10000000-0000-4000-8000-000000000010" },
    });
  });

  it("leaves image metadata unchanged when the feedback does not exist", async () => {
    const transaction = {
      feedbackReply: {
        findMany: vi.fn(async () => []),
        deleteMany: vi.fn(async () => ({ count: 0 })),
      },
      feedbackReplyImage: {
        findMany: vi.fn(async () => []),
        deleteMany: vi.fn(async () => ({ count: 0 })),
      },
      feedback: { deleteMany: vi.fn(async () => ({ count: 0 })) },
      feedbackImage: {
        findMany: vi.fn(async () => []),
        deleteMany: vi.fn(async () => ({ count: 0 })),
      },
    };
    const prisma = {
      $transaction: vi.fn(async (callback) => callback(transaction)),
    } as unknown as PrismaClient;
    const store = new PrismaFeedbackStore(prisma);

    await expect(
      store.delete("10000000-0000-4000-8000-000000000010"),
    ).resolves.toBeNull();
    expect(transaction.feedbackImage.deleteMany).not.toHaveBeenCalled();
  });
  it("filters personal pages in the database and batches reply counts", async () => {
    const findMany = vi.fn(async () => [
      {
        id: "feedback",
        content: "text",
        createdAt: NOW,
        submitterId: "owner",
        submitterName: "Owner",
        submitterEmail: "owner@example.com",
      },
    ]);
    const groupBy = vi.fn(async () => [
      { feedbackId: "feedback", _count: { _all: 3 } },
    ]);
    const store = new PrismaFeedbackStore({
      feedback: { findMany },
      feedbackImage: { findMany: vi.fn(async () => []) },
      feedbackReply: { groupBy },
    } as unknown as PrismaClient);
    const page = await store.list({ submitterId: "owner", limit: 20 });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { submitterId: "owner" }, take: 21 }),
    );
    expect(page.items[0]?.reply_count).toBe(3);
    expect(groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ where: { feedbackId: { in: ["feedback"] } } }),
    );
  });

  it("locks the parent and persists replies and ordered images atomically", async () => {
    const transaction = {
      feedback: { updateMany: vi.fn(async () => ({ count: 1 })) },
      feedbackReply: { create: vi.fn(async () => undefined) },
      feedbackReplyImage: { createMany: vi.fn(async () => ({ count: 1 })) },
    };
    const store = new PrismaFeedbackStore({
      $transaction: vi.fn(async (callback) => callback(transaction)),
    } as unknown as PrismaClient);
    const reply = {
      id: "reply",
      feedbackId: "parent",
      authorId: "admin",
      content: "",
      createdAt: NOW,
      images: [
        {
          id: "image",
          feedbackId: "reply",
          objectKey: "reply/image",
          filename: "a.png",
          mimeType: "image/png" as const,
          sizeBytes: 68,
          checksumSha256: "a".repeat(64),
          sortOrder: 0,
          createdAt: NOW,
        },
      ],
    };
    await expect(store.createReply(reply)).resolves.toMatchObject({
      image_count: 1,
    });
    expect(transaction.feedback.updateMany).toHaveBeenCalledWith({
      where: { id: "parent" },
      data: { id: "parent" },
    });
    expect(transaction.feedbackReplyImage.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ replyId: "reply", sizeBytes: 68n })],
    });
    transaction.feedback.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(store.createReply(reply)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(transaction.feedbackReply.create).toHaveBeenCalledTimes(1);
  });

  it("returns chronological replies with redacted images only after checking ownership", async () => {
    const transaction = {
      feedback: {
        findFirst: vi.fn(async () => ({
          id: "parent",
          content: "feedback",
          createdAt: NOW,
        })),
      },
      feedbackImage: { findMany: vi.fn(async () => []) },
      feedbackReply: {
        findMany: vi.fn(async () => [
          { id: "reply", content: "answer", createdAt: NOW, authorId: "admin" },
        ]),
      },
      user: {
        findMany: vi.fn(async () => [{ id: "admin", name: "周蕊" }]),
      },
      feedbackReplyImage: {
        findMany: vi.fn(async () => [
          {
            id: "10000000-0000-4000-8000-000000000011",
            replyId: "reply",
            filename: "a.png",
            mimeType: "image/png",
            sizeBytes: 68n,
            sortOrder: 0,
            objectKey: "private/key",
          },
        ]),
      },
    };
    const store = new PrismaFeedbackStore({
      $transaction: vi.fn(async (callback) => callback(transaction)),
    } as unknown as PrismaClient);
    const details = await store.findDetails({
      feedbackId: "parent",
      submitterId: "owner",
    });
    expect(transaction.feedback.findFirst).toHaveBeenCalledWith({
      where: { id: "parent", submitterId: "owner" },
    });
    expect(transaction.feedbackReply.findMany).toHaveBeenCalledWith({
      where: { feedbackId: "parent" },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    expect(transaction.user.findMany).toHaveBeenCalledWith({
      where: { id: { in: ["admin"] } },
      select: { id: true, name: true },
    });
    expect(details?.reply_count).toBe(1);
    expect(details?.replies[0]?.author).toEqual({ name: "周蕊" });
    expect(details?.replies[0]).not.toHaveProperty("authorId");
    expect(details?.replies[0]?.images[0]).not.toHaveProperty("objectKey");
  });

  it("does not read a reply image belonging to a different feedback", async () => {
    const findImage = vi.fn();
    const store = new PrismaFeedbackStore({
      feedbackReply: { findFirst: vi.fn(async () => null) },
      feedbackReplyImage: { findFirst: findImage },
    } as unknown as PrismaClient);
    await expect(
      store.findImage({
        feedbackId: "other",
        replyId: "reply",
        imageId: "image",
      }),
    ).resolves.toBeNull();
    expect(findImage).not.toHaveBeenCalled();
  });

  it("deletes reply images and replies in the same transaction as their parent", async () => {
    const transaction = {
      feedback: { deleteMany: vi.fn(async () => ({ count: 1 })) },
      feedbackImage: {
        findMany: vi.fn(async () => []),
        deleteMany: vi.fn(async () => ({ count: 0 })),
      },
      feedbackReply: {
        findMany: vi.fn(async () => [{ id: "reply" }]),
        deleteMany: vi.fn(async () => ({ count: 1 })),
      },
      feedbackReplyImage: {
        findMany: vi.fn(async () => [{ objectKey: "reply/image" }]),
        deleteMany: vi.fn(async () => ({ count: 1 })),
      },
    };
    const store = new PrismaFeedbackStore({
      $transaction: vi.fn(async (callback) => callback(transaction)),
    } as unknown as PrismaClient);
    await expect(store.delete("parent")).resolves.toEqual({
      id: "parent",
      imageObjectKeys: ["reply/image"],
    });
    expect(transaction.feedbackReplyImage.deleteMany).toHaveBeenCalledWith({
      where: { replyId: { in: ["reply"] } },
    });
    expect(transaction.feedbackReply.deleteMany).toHaveBeenCalledWith({
      where: { feedbackId: "parent" },
    });
  });
});
