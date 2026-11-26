import { afterEach, describe, expect, it, vi } from "vitest";

import {
  TaskRecoveryScheduler,
  type TaskRecoveryQueueControl,
} from "../src/modules/events/recovery-scheduler.js";
import {
  START_INTENT_UNSETTLED_RELEASE_MILLISECONDS,
  START_RECOVERY_ATTEMPTS,
} from "../src/modules/conversations/start-intent-policy.js";

const ownerId = "10000000-0000-4000-8000-000000000001";
const bootId = "10000000-0000-4000-8000-000000000002";
const conversationId = "10000000-0000-4000-8000-000000000003";
const projectionTurnId = "10000000-0000-4000-8000-000000000004";
const deviceId = "10000000-0000-4000-8000-000000000005";
const connectionId = "10000000-0000-4000-8000-000000000006";
const runtimeGeneration = "10000000-0000-4000-8000-000000000007";
const capabilityGeneration = "a".repeat(64);
const desktop = { ownerId, deviceId, connectionId };
const desktopTurn = { ...desktop, conversationId, projectionTurnId, runtimeGeneration };
afterEach(() => vi.useRealTimers());

describe("targeted task recovery", () => {
  it("queues exact read-only recovery when a Mac reports exit even while its cloud runner is live", async () => {
    const f = fixture();
    f.prisma.conversationTurnStartIntent.findFirst.mockResolvedValueOnce({ projectionTurnId });
    f.redis.runnerOwnerDeadline.mockResolvedValue(Date.now() + 60_000);
    await f.scheduler.enqueueDesktopRecovery(desktopTurn);
    const job = f.queue.add.mock.calls[0]?.[1];
    expect(job).toEqual({ type: "desktop-turn", ...desktopTurn });
    await f.scheduler.process({ data: job });
    expect(f.conversations.recoverStartIntent).toHaveBeenCalledExactlyOnceWith(
      projectionTurnId, { resubmitNonTerminal: false, desktopConnectionId: connectionId },
    );
    expect(f.events.reconcileAfterProcessExit).toHaveBeenCalledExactlyOnceWith(
      { conversationId, projectionTurnId, capabilityGeneration }, { desktopConnectionId: connectionId },
    );
    expect(f.redis.runnerOwnerDeadline).not.toHaveBeenCalled();
  });

  it("reconciles a terminal turn whose reservation survived an API crash before release", async () => {
    const f = fixture();
    f.redis.runningTurnSlotsForOwner.mockResolvedValueOnce({
      slots: [{ conversationId, turnId: projectionTurnId }], after: null,
    });
    f.prisma.$queryRaw.mockImplementationOnce(async (_sql, ...params) =>
      params.some(value => Array.isArray(value) && value.includes(projectionTurnId))
        ? [{ conversationId, runtimeGeneration, startId: null, turnIds: [projectionTurnId] }]
        : [],
    );
    await f.scheduler.process({ data: { type: "desktop", ...desktop } });
    const job = f.queue.add.mock.calls[0]?.[1];
    expect(job).toEqual({ type: "desktop-turn", ...desktopTurn });
    await f.scheduler.process({ data: job });
    expect(f.events.reconcileAfterProcessExit).toHaveBeenCalledExactlyOnceWith(
      { conversationId, projectionTurnId, capabilityGeneration }, { desktopConnectionId: connectionId },
    );
    expect(f.conversations.recoverStartIntent).not.toHaveBeenCalled();
  });

  it("ignores an exit job after its Mac connection was replaced", async () => {
    const f = fixture();
    f.redis.client.mget.mockResolvedValueOnce([bootId, `${bootId}:${deviceId}`]);
    await f.scheduler.process({ data: { type: "desktop-turn", ...desktopTurn } });
    expect(f.conversations.recoverStartIntent).not.toHaveBeenCalled();
    expect(f.events.reconcileAfterProcessExit).not.toHaveBeenCalled();
  });

  it("keeps settling revoked Mac work when a conversation is locked and revisits it on the next sweep", async () => {
    const f = fixture();
    const nextTurnId = "10000000-0000-4000-8000-000000000008";
    const row = { ownerId, deviceId, conversationId, runtimeGeneration };
    const mac = { ...row, projectionTurnId };
    f.prisma.$queryRaw
      .mockResolvedValueOnce([{ ...row, turnIds: [projectionTurnId, nextTurnId] }])
      .mockResolvedValueOnce([{ ...row, turnIds: [projectionTurnId] }]);
    f.events.settleRevokedMacTurn.mockRejectedValueOnce(new Error("TASK_RECOVERY_BUSY"));
    await f.scheduler.process({ data: { type: "maintenance" } });
    await f.scheduler.process({ data: { type: "maintenance" } });
    expect(f.events.settleRevokedMacTurn.mock.calls).toEqual([
      [mac], [{ ...mac, projectionTurnId: nextTurnId }], [mac],
    ]);
    expect(f.events.reconcileAfterProcessExit).not.toHaveBeenCalled();
    expect(f.conversations.recoverStartIntent).not.toHaveBeenCalled();
  });

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

  it("scopes start job ids to the intent and keeps one total attempt budget", async () => {
    const f = fixture();
    const freshTurnId = "10000000-0000-4000-8000-000000000010";
    const fresh = new Date();
    const stale = new Date(
      Date.now() - START_INTENT_UNSETTLED_RELEASE_MILLISECONDS - 1,
    );
    f.prisma.conversationTurnStartIntent.findMany.mockResolvedValueOnce([
      { conversationId, projectionTurnId: freshTurnId, createdAt: fresh },
      { conversationId, projectionTurnId, createdAt: stale },
    ]);
    await f.scheduler.process({ data: { type: "maintenance" } });
    expect(f.queue.add).toHaveBeenCalledWith(
      "start",
      { type: "start", conversationId, projectionTurnId: freshTurnId },
      {
        jobId: `start-${freshTurnId}-${fresh.getTime()}`,
        attempts: START_RECOVERY_ATTEMPTS,
      },
    );
    expect(f.queue.add).toHaveBeenCalledWith(
      "start",
      { type: "start", conversationId, projectionTurnId },
      {
        jobId: `start-${projectionTurnId}-${stale.getTime()}`,
        attempts: START_RECOVERY_ATTEMPTS,
      },
    );
  });

  it("skips local conversations when dispatching start recovery", async () => {
    const f = fixture();
    const localConversationId = "10000000-0000-4000-8000-000000000013";
    const localTurnId = "10000000-0000-4000-8000-000000000014";
    const createdAt = new Date(Date.now() - 60_000);
    f.prisma.conversationTurnStartIntent.findMany.mockResolvedValueOnce([
      { conversationId, projectionTurnId, createdAt },
      {
        conversationId: localConversationId,
        projectionTurnId: localTurnId,
        createdAt,
      },
    ]);
    f.prisma.conversation.findMany.mockResolvedValueOnce([
      { id: conversationId, executionTarget: "cloud" },
      { id: localConversationId, executionTarget: "local" },
    ]);

    await f.scheduler.process({ data: { type: "maintenance" } });

    const starts = f.queue.add.mock.calls.filter(([name]) => name === "start");
    expect(starts.map(([, data]) => data)).toEqual([
      { type: "start", conversationId, projectionTurnId },
    ]);
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
    $queryRaw: vi.fn<(...params: unknown[]) => Promise<unknown[]>>(async () => []),
    desktopTurnSlotRelease: { findMany: vi.fn(async () => []) },
    $transaction: vi.fn(
      (run: (tx: unknown) => Promise<unknown>): Promise<unknown> => run(prisma),
    ),
    conversation: {
      findFirst: vi.fn(async () => ({ id: conversationId, runtimeGeneration })),
      findMany: vi.fn(async () => [] as Array<{ id: string; executionTarget: string | null }>),
    },
    conversationTurn: {
      findFirst: vi.fn(async () => ({ capabilityGeneration })),
      findMany: vi.fn<(...args: unknown[]) => Promise<unknown[]>>(
        async () => [],
      ),
    },
    conversationTurnStartIntent: {
      findFirst: vi.fn<() => Promise<{ projectionTurnId: string } | null>>(async () => null),
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
    client: {
      mget: vi.fn(async () => [connectionId, `${connectionId}:${deviceId}`]),
    },
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
    runningTurnSlotPage: vi.fn(async () => ({ slots: [], after: null })),
    revokedMacRecoveryCursor: vi.fn(async () => ({ conversation: null, slot: null })),
    setRevokedMacRecoveryCursor: vi.fn(async () => undefined),
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
    settleRevokedMacTurn: vi.fn<(input: {
      ownerId: string;
      conversationId: string;
      deviceId: string;
      projectionTurnId: string;
      runtimeGeneration: string;
    }) => Promise<void>>(async () => undefined),
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
