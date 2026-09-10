import { afterEach, describe, expect, it, vi } from "vitest";

import {
  TaskRecoveryScheduler,
  type TaskRecoveryQueueControl,
} from "../src/modules/events/recovery-scheduler.js";

const ownerId = "10000000-0000-4000-8000-000000000001";
const bootId = "10000000-0000-4000-8000-000000000002";
const conversationId = "10000000-0000-4000-8000-000000000003";
const projectionTurnId = "10000000-0000-4000-8000-000000000004";
const capabilityGeneration = "a".repeat(64);
afterEach(() => vi.useRealTimers());

describe("targeted task recovery", () => {
  it("checks only expired workers and indexed pending records during ordinary maintenance", async () => {
    const f = fixture();
    await f.scheduler.process({ data: { type: "maintenance" } });
    expect(f.events.recoverRunningTurns).not.toHaveBeenCalled();
    expect(f.prisma.conversationTurn.findMany).not.toHaveBeenCalled();
    expect(f.events.reconcileAfterProcessExit).not.toHaveBeenCalled();
    expect(f.prisma.conversationTurnStartIntent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 100,
        where: expect.objectContaining({
          runnerStatus: {
            in: [
              "slot_pending",
              "prepared",
              "runner_succeeded",
              "release_pending",
            ],
          },
        }),
      }),
    );
  });

  it("rebuilds the baseline only when Redis has lost it", async () => {
    const f = fixture();
    f.redis.runningTurnRecoveryStatus.mockResolvedValueOnce({
      outcome: "not_started",
      last_success_at: null,
    });
    await f.scheduler.process({ data: { type: "maintenance" } });
    expect(f.events.recoverRunningTurns).toHaveBeenCalledOnce();
  });

  it("does not acknowledge an expired worker when durable enqueue fails", async () => {
    const f = fixture();
    f.redis.expiredRunnerOwners.mockResolvedValue([{ ownerId, deadline: 42 }]);
    f.queue.add.mockRejectedValueOnce(new Error("redis unavailable"));
    await expect(
      f.scheduler.process({ data: { type: "maintenance" } }),
    ).rejects.toThrow();
    expect(f.redis.acknowledgeExpiredRunnerOwner).not.toHaveBeenCalled();
  });

  it("queues only the affected owner's reserved turns and ignores obsolete expiry jobs", async () => {
    const f = fixture();
    const job = {
      type: "owner" as const,
      ownerId,
      trigger: "expired-42",
      deadline: 42,
    };
    f.redis.runnerOwnerDeadline.mockResolvedValueOnce(43);
    await f.scheduler.process({ data: job });
    expect(f.prisma.conversationTurn.findMany).not.toHaveBeenCalled();
    f.redis.runningTurnSlotsForOwner.mockResolvedValueOnce({
      slots: [{ conversationId, turnId: projectionTurnId }],
      after: null,
    });
    f.prisma.conversationTurn.findMany.mockResolvedValueOnce([
      {
        id: projectionTurnId,
        conversationId,
        capabilityGeneration,
        submittedBy: ownerId,
      },
    ]);
    await f.scheduler.process({ data: job });
    expect(f.prisma.conversationTurn.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: [projectionTurnId] } },
        take: 100,
      }),
    );
    expect(f.queue.add).toHaveBeenCalledWith(
      "turn",
      expect.objectContaining({
        conversationId,
        projectionTurnId,
        capabilityGeneration,
      }),
      expect.objectContaining({
        jobId: expect.stringContaining(projectionTurnId),
      }),
    );
  });

  it("retries an uncertain projection without resubmitting the native turn", async () => {
    const f = fixture();
    f.conversations.recoverStartIntent.mockResolvedValueOnce("pending");
    await expect(
      f.scheduler.process({
        data: { type: "start", conversationId, projectionTurnId },
      }),
    ).rejects.toThrow("TASK_RECOVERY_PENDING");
    expect(f.conversations.recoverStartIntent).toHaveBeenCalledWith(
      projectionTurnId,
      { resubmitNonTerminal: false },
    );
    expect(f.redis.releaseRecoveryLock).toHaveBeenCalledWith(
      conversationId,
      "lease",
    );
  });

  it("preserves capacity when an indexed turn belongs to a different owner", async () => {
    const f = fixture();
    f.redis.runningTurnSlotsForOwner.mockResolvedValueOnce({
      slots: [{ conversationId, turnId: projectionTurnId }],
      after: null,
    });
    f.prisma.conversationTurn.findMany.mockResolvedValueOnce([
      {
        id: projectionTurnId,
        conversationId,
        capabilityGeneration,
        submittedBy: bootId,
      },
    ]);
    await expect(
      f.scheduler.process({
        data: { type: "owner", ownerId, trigger: "expired-42" },
      }),
    ).rejects.toThrow("TASK_RECOVERY_OWNER_MISMATCH");
    expect(f.redis.releaseTurnSlot).not.toHaveBeenCalled();
    expect(f.queue.add).not.toHaveBeenCalled();
  });

  it("restores queue concurrency on later ticks and stops dispatching after close", async () => {
    vi.useFakeTimers();
    const f = fixture();
    await f.scheduler.start();
    f.queue.setGlobalConcurrency.mockClear();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(f.queue.setGlobalConcurrency).toHaveBeenCalledExactlyOnceWith(5);
    await f.scheduler.close();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(f.queue.setGlobalConcurrency).toHaveBeenCalledOnce();
  });

  it("releases an orphaned exact reservation but preserves an unresolved start", async () => {
    const f = fixture();
    const page = {
      slots: [{ conversationId, turnId: projectionTurnId }],
      after: null,
    };
    f.redis.runningTurnSlotsForOwner.mockResolvedValue(page);
    f.prisma.conversationTurnStartIntent.findMany.mockResolvedValueOnce([
      { projectionTurnId },
    ]);
    await f.scheduler.process({
      data: { type: "owner", ownerId, trigger: "expired-42" },
    });
    expect(f.redis.releaseTurnSlot).not.toHaveBeenCalled();
    await f.scheduler.process({
      data: { type: "owner", ownerId, trigger: "expired-42" },
    });
    expect(f.prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "RepeatableRead",
    });
    expect(f.redis.releaseTurnSlot).toHaveBeenCalledWith(
      conversationId,
      projectionTurnId,
    );
  });

  it("persists the next pending page only after every record has been durably enqueued", async () => {
    const f = fixture();
    const createdAt = new Date("2026-09-07T00:00:00Z");
    const rows = Array.from({ length: 100 }, (_, i) => ({
      conversationId,
      projectionTurnId: `10000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
      createdAt,
    }));
    f.prisma.conversationTurnStartIntent.findMany.mockResolvedValueOnce(rows);
    f.queue.add.mockRejectedValueOnce(new Error("offline"));
    await expect(
      f.scheduler.process({ data: { type: "maintenance" } }),
    ).rejects.toThrow("offline");
    expect(f.redis.setRecoveryDispatchCursor).not.toHaveBeenCalled();
    f.prisma.conversationTurnStartIntent.findMany.mockResolvedValueOnce(rows);
    await f.scheduler.process({ data: { type: "maintenance" } });
    expect(f.redis.setRecoveryDispatchCursor).toHaveBeenCalledWith("start", {
      id: rows.at(-1)?.projectionTurnId,
      createdAt: createdAt.toISOString(),
    });
  });

  it("keeps the queued turn eligible for retry when another recovery owns its lock", async () => {
    const f = fixture();
    f.redis.acquireRecoveryLock.mockResolvedValueOnce(null);
    await expect(
      f.scheduler.process({
        data: {
          type: "turn",
          conversationId,
          projectionTurnId,
          capabilityGeneration,
        },
      }),
    ).rejects.toThrow("TASK_RECOVERY_BUSY");
    expect(f.events.reconcileAfterProcessExit).not.toHaveBeenCalled();
    expect(f.redis.releaseRecoveryLock).not.toHaveBeenCalled();
  });

  it("preserves the native in-progress result without adding a new recovery attempt", async () => {
    const f = fixture();
    await f.scheduler.process({
      data: {
        type: "turn",
        conversationId,
        projectionTurnId,
        capabilityGeneration,
      },
    });
    expect(f.events.reconcileAfterProcessExit).toHaveBeenCalledOnce();
    expect(f.queue.add).not.toHaveBeenCalled();
  });

  it("queues startup recovery before acknowledging the heartbeat and deduplicates boot reports", async () => {
    const f = fixture();
    await f.scheduler.heartbeat(ownerId, { bootId, startup: true });
    await f.scheduler.heartbeat(ownerId, { bootId, startup: false });
    expect(f.queue.add).toHaveBeenCalledOnce();
    expect(f.redis.recordRunnerHeartbeat).toHaveBeenCalledTimes(2);
    expect(f.queue.add.mock.invocationCallOrder[0]).toBeLessThan(
      f.redis.recordRunnerHeartbeat.mock.invocationCallOrder[0]!,
    );
  });

  it("registers one shared maintenance schedule and closes its worker before the queue", async () => {
    const f = fixture();
    await f.scheduler.start();
    await f.scheduler.start();
    expect(f.queue.add).toHaveBeenCalledWith(
      "maintenance",
      { type: "maintenance" },
      {
        jobId: "maintenance",
        attempts: 1,
        removeOnComplete: true,
        removeOnFail: true,
      },
    );
    expect(f.queue.setGlobalConcurrency).toHaveBeenCalledWith(5);
    await f.scheduler.close();
    expect(f.worker.close).toHaveBeenCalledOnce();
    expect(f.queue.close).toHaveBeenCalledOnce();
  });
});

function fixture() {
  const queue = {
    add: vi.fn<TaskRecoveryQueueControl["add"]>(async () => undefined as never),
    close: vi.fn(async () => undefined),
    waitUntilReady: vi.fn<TaskRecoveryQueueControl["waitUntilReady"]>(
      async () => undefined as never,
    ),
    setGlobalConcurrency: vi.fn(async () => 5),
  };
  const worker = { close: vi.fn(async () => undefined) };
  const prisma = {
    $transaction: vi.fn(
      (run: (tx: unknown) => Promise<unknown>): Promise<unknown> => run(prisma),
    ),
    conversationTurn: {
      findMany: vi.fn<(...args: unknown[]) => Promise<unknown[]>>(
        async () => [],
      ),
    },
    conversationTurnStartIntent: {
      findMany: vi.fn<(...args: unknown[]) => Promise<unknown[]>>(
        async () => [],
      ),
    },
    conversationTurnAttempt: {
      findMany: vi.fn<(...args: unknown[]) => Promise<unknown[]>>(
        async () => [],
      ),
    },
  };
  const redis = {
    runningTurnRecoveryStatus: vi.fn<
      () => Promise<{ outcome: string; last_success_at: string | null }>
    >(async () => ({
      outcome: "succeeded",
      last_success_at: "2026-09-07T00:00:00Z",
    })),
    expiredRunnerOwners: vi.fn<
      () => Promise<Array<{ ownerId: string; deadline: number }>>
    >(async () => []),
    acknowledgeExpiredRunnerOwner: vi.fn(async () => undefined),
    runnerOwnerDeadline: vi.fn<() => Promise<number | null>>(async () => null),
    recordRunnerHeartbeat: vi.fn(async () => undefined),
    runningTurnSlotsForOwner: vi.fn<
      () => Promise<{
        slots: Array<{ conversationId: string; turnId: string }>;
        after: string | null;
      }>
    >(async () => ({ slots: [], after: null })),
    releaseTurnSlot: vi.fn(async () => undefined),
    recoveryDispatchCursor: vi.fn(async () => null),
    setRecoveryDispatchCursor: vi.fn(async () => undefined),
    acquireRecoveryLock: vi.fn<() => Promise<string | null>>(
      async () => "lease",
    ),
    releaseRecoveryLock: vi.fn(async () => undefined),
  };
  const events = {
    recoverRunningTurns: vi.fn(async () => undefined),
    reconcileAfterProcessExit: vi.fn(async () => ({ outcome: "succeeded" })),
  };
  const conversations = {
    recoverStartIntent: vi.fn(async () => "projected"),
    recoverContextWindowAttempt: vi.fn(async () => "running"),
  };
  const scheduler = new TaskRecoveryScheduler(
    { redisUrl: "redis://unused" },
    prisma as never,
    redis as never,
    events as never,
    conversations as never,
    queue,
    () => worker,
  );
  return { scheduler, queue, worker, prisma, redis, events, conversations };
}
