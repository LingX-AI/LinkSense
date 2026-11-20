import { describe, expect, it, vi } from "vitest";

import type { RunnerPrivacyMaskingCapture } from "@linksense/shared";

import type { PrismaClient } from "../src/generated/prisma/client.js";
import { PrivacyMaskingActivityService } from "../src/modules/privacy-masking/activity.js";

const userId = "10000000-0000-4000-8000-000000000001";

function capture(): RunnerPrivacyMaskingCapture {
  return {
    request_id: "30000000-0000-4000-8000-000000000001",
    owner_id: userId,
    conversation_id: "20000000-0000-4000-8000-000000000001",
    turn_id: "turn-1",
    model: "model-a",
    kinds: { API_KEY: 2, TERM: 1 },
    masked_count: 3,
    hints: [
      { kind: "API_KEY", length: 40, location: "tool_output", count: 2 },
      { kind: "TERM", length: 4, location: "prompt", count: 1 },
    ],
    observed_at: "2026-11-17T08:00:00.000Z",
  };
}

function fixture() {
  const createMany = vi.fn().mockResolvedValue({ count: 1 });
  const deleteMany = vi.fn().mockResolvedValue({ count: 0 });
  const aggregate = vi.fn().mockResolvedValue({
    _sum: { maskedCount: 5 },
    _count: { _all: 2 },
  });
  const findMany = vi.fn().mockResolvedValue([
    {
      id: "40000000-0000-4000-8000-000000000001",
      model: "model-a",
      maskedCount: 3,
      kinds: { API_KEY: 2, TERM: 1 },
      hints: [
        { kind: "API_KEY", length: 40, location: "tool_output", count: 2 },
        { kind: "TERM", length: 4, location: "prompt", count: 1 },
      ],
      createdAt: new Date("2026-11-17T08:00:00.000Z"),
    },
  ]);
  const prisma = {
    $transaction: async (operations: Promise<unknown>[]) =>
      Promise.all(operations),
    userPrivacyMaskingRecord: {
      createMany,
      deleteMany,
      aggregate,
      findMany,
    },
  } as unknown as PrismaClient;
  return {
    createMany,
    deleteMany,
    aggregate,
    findMany,
    service: new PrivacyMaskingActivityService(prisma),
  };
}

describe("privacy masking activity", () => {
  it("stores counts only and prunes expired rows for the same user", async () => {
    const f = fixture();
    await f.service.record(capture());
    expect(f.createMany).toHaveBeenCalledWith({
      data: [
        {
          userId,
          conversationId: "20000000-0000-4000-8000-000000000001",
          turnId: "turn-1",
          requestId: "30000000-0000-4000-8000-000000000001",
          model: "model-a",
          maskedCount: 3,
          kinds: { API_KEY: 2, TERM: 1 },
          hints: [
            { kind: "API_KEY", length: 40, location: "tool_output", count: 2 },
            { kind: "TERM", length: 4, location: "prompt", count: 1 },
          ],
          createdAt: new Date("2026-11-17T08:00:00.000Z"),
        },
      ],
      skipDuplicates: true,
    });
    expect(f.deleteMany).toHaveBeenCalledWith({
      where: {
        userId,
        createdAt: { lt: new Date("2026-10-18T08:00:00.000Z") },
      },
    });
  });

  it("summarizes the window and paginates newest first", async () => {
    const f = fixture();
    const result = await f.service.listForUser(userId, { days: 7 });
    expect(result).toEqual({
      summary: { masked_count: 5, request_count: 2 },
      records: [
        {
          id: "40000000-0000-4000-8000-000000000001",
          model: "model-a",
          masked_count: 3,
          kinds: { API_KEY: 2, TERM: 1 },
          hints: [
            { kind: "API_KEY", length: 40, location: "tool_output", count: 2 },
            { kind: "TERM", length: 4, location: "prompt", count: 1 },
          ],
          created_at: "2026-11-17T08:00:00.000Z",
        },
      ],
      next_before: null,
    });
    const findArgs = f.findMany.mock.calls[0]?.[0] as {
      where: { userId: string; createdAt: { gte: Date; lt?: Date } };
      orderBy: unknown;
    };
    expect(findArgs.where.userId).toBe(userId);
    expect(findArgs.where.createdAt.gte).toBeInstanceOf(Date);
    expect(findArgs.orderBy).toEqual([
      { createdAt: "desc" },
      { id: "desc" },
    ]);
    expect(findArgs.where.createdAt.lt).toBeUndefined();
  });

  it("returns the next cursor after a full page and applies it", async () => {
    const f = fixture();
    const rows = Array.from({ length: 51 }, (_, index) => ({
      id: `40000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      model: "model-a",
      maskedCount: 1,
      kinds: { API_KEY: 1 },
      hints: [],
      createdAt: new Date(Date.UTC(2026, 10, 17, 8, 0, 0, index)),
    }));
    f.findMany.mockResolvedValueOnce(rows);
    const result = await f.service.listForUser(userId, {
      days: 7,
      before: "2026-11-17T09:00:00.000Z",
    });
    expect(result.records).toHaveLength(50);
    expect(result.next_before).toBe(rows[49]?.createdAt.toISOString());
    const findArgs = f.findMany.mock.calls[0]?.[0] as {
      where: { createdAt: { lt?: Date } };
    };
    expect(findArgs.where.createdAt.lt).toEqual(
      new Date("2026-11-17T09:00:00.000Z"),
    );
  });
});
