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
      data: [expect.objectContaining({ sizeBytes: 68n, sortOrder: 0 })],
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
});
