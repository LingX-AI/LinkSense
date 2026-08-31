import { describe, expect, it, vi } from "vitest";

import {
  goalResumeIdempotencyKey,
  projectConversationGoal,
  upsertConversationGoal,
} from "../src/modules/conversations/goals.js";

describe("conversation Goal projection", () => {
  it("projects native usage and timestamps without changing their meaning", () => {
    const projected = projectConversationGoal({
      conversationId: "20000000-0000-4000-8000-000000000001",
      ownerId: "10000000-0000-4000-8000-000000000001",
      codexThreadId: "codex-thread-1",
      activeTurnId: "30000000-0000-4000-8000-000000000001",
      objective: "完整实现目标功能",
      status: "active",
      tokenBudget: 12_000n,
      tokensUsed: 800n,
      timeUsedSeconds: 38n,
      nativeCreatedAt: new Date("2026-08-06T08:00:00.000Z"),
      nativeUpdatedAt: new Date("2026-08-06T08:00:38.000Z"),
      createdAt: new Date("2026-08-06T08:00:00.000Z"),
      updatedAt: new Date("2026-08-06T08:00:38.000Z"),
    });

    expect(projected).toEqual({
      thread_id: "codex-thread-1",
      objective: "完整实现目标功能",
      status: "active",
      token_budget: 12_000,
      tokens_used: 800,
      time_used_seconds: 38,
      created_at: "2026-08-06T08:00:00.000Z",
      updated_at: "2026-08-06T08:00:38.000Z",
    });
  });

  it("keeps the resume idempotency key stable across page and service refreshes", () => {
    const input = {
      conversationId: "20000000-0000-4000-8000-000000000001",
      codexThreadId: "codex-thread-1",
      nativeUpdatedAt: new Date("2026-08-06T08:00:38.000Z"),
      objective: "完整实现目标功能",
      tokenBudget: null,
      priorityCapabilityIds: ["capability-1"],
      knowledgeBaseIds: ["knowledge-base-1"],
    };

    const first = goalResumeIdempotencyKey(input);
    const afterRefresh = goalResumeIdempotencyKey({ ...input });
    const nextPausedRevision = goalResumeIdempotencyKey({
      ...input,
      nativeUpdatedAt: new Date("2026-08-06T08:01:12.000Z"),
    });

    expect(first).toMatch(/^goal-resume:[a-f0-9]{64}$/u);
    expect(afterRefresh).toBe(first);
    expect(nextPausedRevision).not.toBe(first);
  });

  it("keeps a newer paused snapshot when an older active event arrives late", async () => {
    const current = {
      conversationId: "20000000-0000-4000-8000-000000000001",
      ownerId: "10000000-0000-4000-8000-000000000001",
      codexThreadId: "codex-thread-1",
      activeTurnId: "30000000-0000-4000-8000-000000000001",
      objective: "完整实现目标功能",
      status: "paused",
      tokenBudget: null,
      tokensUsed: 900n,
      timeUsedSeconds: 42n,
      nativeCreatedAt: new Date("2026-08-06T08:00:00.000Z"),
      nativeUpdatedAt: new Date("2026-08-06T08:00:42.000Z"),
      createdAt: new Date("2026-08-06T08:00:00.000Z"),
      updatedAt: new Date("2026-08-06T08:00:42.000Z"),
    };
    const upsert = vi.fn();
    const findUnique = vi.fn(async () => current);
    const tx = {
      $queryRaw: vi.fn(async () => [
        { nativeUpdatedAt: current.nativeUpdatedAt },
      ]),
      conversationGoal: { findUnique, upsert },
    } as unknown as Parameters<typeof upsertConversationGoal>[0];

    const result = await upsertConversationGoal(tx, {
      conversationId: current.conversationId,
      ownerId: current.ownerId,
      goal: {
        threadId: current.codexThreadId,
        objective: current.objective,
        status: "active",
        tokenBudget: null,
        tokensUsed: 850,
        timeUsedSeconds: 38,
        createdAt: current.nativeCreatedAt.getTime() / 1_000,
        updatedAt: new Date("2026-08-06T08:00:38.000Z").getTime() / 1_000,
      },
      activeTurnId: current.activeTurnId,
    });

    expect(result).toBe(current);
    expect(findUnique).toHaveBeenCalledWith({
      where: { conversationId: current.conversationId },
    });
    expect(upsert).not.toHaveBeenCalled();
  });

  it("does not regress a completed Goal when an active event with the same native timestamp arrives late", async () => {
    const current = {
      conversationId: "20000000-0000-4000-8000-000000000001",
      ownerId: "10000000-0000-4000-8000-000000000001",
      codexThreadId: "codex-thread-1",
      activeTurnId: null,
      objective: "完整实现目标功能",
      status: "complete",
      tokenBudget: null,
      tokensUsed: 1_200n,
      timeUsedSeconds: 51n,
      nativeCreatedAt: new Date("2026-08-06T08:00:00.000Z"),
      nativeUpdatedAt: new Date("2026-08-06T08:00:51.000Z"),
      createdAt: new Date("2026-08-06T08:00:00.000Z"),
      updatedAt: new Date("2026-08-06T08:00:51.000Z"),
    };
    const upsert = vi.fn();
    const findUnique = vi.fn(async () => current);
    const tx = {
      $queryRaw: vi.fn(async () => [
        {
          nativeUpdatedAt: current.nativeUpdatedAt,
          status: current.status,
          activeTurnId: current.activeTurnId,
        },
      ]),
      conversationGoal: { findUnique, upsert },
    } as unknown as Parameters<typeof upsertConversationGoal>[0];

    const result = await upsertConversationGoal(tx, {
      conversationId: current.conversationId,
      ownerId: current.ownerId,
      goal: {
        threadId: current.codexThreadId,
        objective: current.objective,
        status: "active",
        tokenBudget: null,
        tokensUsed: 1_200,
        timeUsedSeconds: 51,
        createdAt: current.nativeCreatedAt.getTime() / 1_000,
        updatedAt: current.nativeUpdatedAt.getTime() / 1_000,
      },
      activeTurnId: null,
    });

    expect(result).toBe(current);
    expect(findUnique).toHaveBeenCalledWith({
      where: { conversationId: current.conversationId },
    });
    expect(upsert).not.toHaveBeenCalled();
  });

  it("allows a new Goal turn to replace a completed Goal even within the same native second", async () => {
    const current = {
      conversationId: "20000000-0000-4000-8000-000000000001",
      ownerId: "10000000-0000-4000-8000-000000000001",
      codexThreadId: "codex-thread-1",
      activeTurnId: null,
      objective: "上一目标",
      status: "complete",
      tokenBudget: null,
      tokensUsed: 1_200n,
      timeUsedSeconds: 51n,
      nativeCreatedAt: new Date("2026-08-06T08:00:00.000Z"),
      nativeUpdatedAt: new Date("2026-08-06T08:00:51.000Z"),
      createdAt: new Date("2026-08-06T08:00:00.000Z"),
      updatedAt: new Date("2026-08-06T08:00:51.000Z"),
    };
    const nextTurnId = "30000000-0000-4000-8000-000000000002";
    const next = {
      ...current,
      activeTurnId: nextTurnId,
      objective: "下一目标",
      status: "active",
    };
    const upsert = vi.fn(async () => next);
    const tx = {
      $queryRaw: vi.fn(async () => [
        {
          nativeUpdatedAt: current.nativeUpdatedAt,
          status: current.status,
          activeTurnId: current.activeTurnId,
        },
      ]),
      conversationGoal: { findUnique: vi.fn(), upsert },
    } as unknown as Parameters<typeof upsertConversationGoal>[0];

    await expect(
      upsertConversationGoal(tx, {
        conversationId: current.conversationId,
        ownerId: current.ownerId,
        goal: {
          threadId: current.codexThreadId,
          objective: next.objective,
          status: "active",
          tokenBudget: null,
          tokensUsed: 0,
          timeUsedSeconds: 0,
          createdAt: current.nativeUpdatedAt.getTime() / 1_000,
          updatedAt: current.nativeUpdatedAt.getTime() / 1_000,
        },
        activeTurnId: nextTurnId,
      }),
    ).resolves.toBe(next);
    expect(upsert).toHaveBeenCalledOnce();
  });
});
