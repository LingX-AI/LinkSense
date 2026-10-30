import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { readAutomationMonitoring } from "@linksense/shared";

import { Prisma, type AutomationRun } from "../src/generated/prisma/client.js";
import { PrismaAutomationRepository } from "../src/modules/automations/repository.js";
import {
  requestMonitoringStop,
  settleMonitoringRunStop,
  settleMonitoringStop,
  settleCancelledAutomationPending,
  monitoringInstructionsForStart,
} from "../src/modules/automations/monitoring.js";

const OWNER = "10000000-0000-4000-8000-000000000001";
const AUTOMATION = "20000000-0000-4000-8000-000000000001";
const CONVERSATION = "30000000-0000-4000-8000-000000000001";
const RUN = "40000000-0000-4000-8000-000000000001";
const PENDING = "50000000-0000-4000-8000-000000000001";
const TURN = "60000000-0000-4000-8000-000000000001";
const NEXT = "30000000-0000-4000-8000-000000000002";
const NOW = new Date("2026-10-23T01:00:00Z");

describe("monitoring instructions stay outside visible user messages", () => {
  it.each(["scheduled", "manual"])(
    "reads only the host-bound %s run context",
    async (trigger) => {
      const findFirst = vi.fn(async () => ({
        executionContextJson: {
          trigger,
          context_mode: "reuse_task",
          stop_condition: "清单全部完成",
        },
      }));
      const tx = { automationRun: { findFirst } };
      const instructions = await monitoringInstructionsForStart(
        tx as never,
        OWNER,
        CONVERSATION,
        "automation:trusted",
      );
      expect(findFirst).toHaveBeenCalledWith({
        where: {
          ownerId: OWNER,
          conversationId: CONVERSATION,
          idempotencyKey: "automation:trusted",
        },
        select: { executionContextJson: true },
      });
      expect(instructions).toContain("清单全部完成");
      expect(instructions).toContain(
        trigger === "scheduled"
          ? "call stop_scheduled_monitor"
          : "do not stop the schedule",
      );
    },
  );
  it("does not add policy for ordinary requests or old records", async () => {
    const findFirst = vi.fn(async () => ({ executionContextJson: null }));
    const tx = { automationRun: { findFirst } };
    await expect(
      monitoringInstructionsForStart(
        tx as never,
        OWNER,
        CONVERSATION,
        "normal",
      ),
    ).resolves.toBeNull();
    expect(findFirst).not.toHaveBeenCalled();
    await expect(
      monitoringInstructionsForStart(
        tx as never,
        OWNER,
        CONVERSATION,
        "automation:legacy",
      ),
    ).resolves.toBeNull();
  });
});

function automation(monitoringJson: unknown = null) {
  return {
    id: AUTOMATION,
    ownerId: OWNER,
    conversationId: CONVERSATION,
    title: "Monitor",
    instruction: "Check the checklist",
    status: "active",
    frequency: "hourly",
    intervalCount: 1,
    minuteOfHour: 0,
    timeOfDayMinutes: null,
    weekdays: [],
    dayOfMonth: null,
    monthOfYear: null,
    timeZone: "UTC",
    anchorAt: NOW,
    nextRunAt: NOW,
    expiresAt: null,
    lastRunAt: null,
    lastRunStatus: null,
    lastErrorCode: null,
    modelId: null,
    reasoningEffort: null,
    deletedAt: null,
    monitoringJson,
    notificationTargetJson: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function run(overrides: Partial<AutomationRun> = {}): AutomationRun {
  return {
    id: RUN,
    automationId: AUTOMATION,
    ownerId: OWNER,
    conversationId: CONVERSATION,
    scheduledFor: NOW,
    idempotencyKey: "automation:test",
    status: "dispatching",
    turnId: null,
    pendingRequestId: null,
    errorCode: null,
    completedAt: null,
    completionReadAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    executionContextJson: null,
    ...overrides,
  };
}

function repositoryFixture(monitoring: unknown = null) {
  const row = automation(monitoring);
  let storedRun: ReturnType<typeof run> | null = null;
  const tx = {
    $executeRaw: vi.fn(async () => 1),
    $queryRaw: vi.fn(async () => [
      {
        id: CONVERSATION,
        ownerId: OWNER,
        title: "Monitor",
        archiveStatus: "active",
        pinnedAt: NOW,
        collaborationMode: "default",
      },
    ]),
    automation: {
      findUnique: vi.fn(async () => row),
      findFirst: vi.fn(async () => row),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const status = data.status ?? row.status;
        const nextRunAt =
          data.nextRunAt === undefined ? row.nextRunAt : data.nextRunAt;
        if (status === "active" && nextRunAt === null)
          throw new Error("automations_active_schedule_check");
        return Object.assign(row, data);
      }),
      updateMany: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        Object.assign(row, data);
        return { count: 1 };
      }),
    },
    automationRun: {
      findUnique: vi.fn(async () => storedRun),
      findFirst: vi.fn(async () => storedRun),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        storedRun = run({ id: randomUUID(), ...data });
        return storedRun;
      }),
      updateMany: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        if (!storedRun || storedRun.status !== "dispatching")
          return { count: 0 };
        Object.assign(storedRun, data);
        return { count: 1 };
      }),
    },
  };
  const db = {
    $transaction: vi.fn(
      async (action: (client: typeof tx) => Promise<unknown>) => action(tx),
    ),
  };
  return {
    row,
    tx,
    db,
    repository: new PrismaAutomationRepository(db as never),
  };
}

const claim = {
  automationId: AUTOMATION,
  scheduledFor: NOW,
  nextRunAt: new Date("2026-10-23T02:00:00Z"),
  claimedAt: NOW,
  idempotencyKey: "automation:test",
};

describe("automation monitoring durable dispatch", () => {
  it("keeps pre-change records unlimited and reuses the original task", async () => {
    const f = repositoryFixture();
    const result = await f.repository.claimOccurrence(claim);
    expect(result?.run.conversationId).toBe(CONVERSATION);
    expect(result?.automation.monitoring).toMatchObject({
      automatic_run_count: 1,
      max_runs: null,
      context_mode: "reuse_task",
    });
    expect(f.row.nextRunAt).toEqual(claim.nextRunAt);
  });

  it("counts the final automatic trigger once across retries and restart receipts", async () => {
    const f = repositoryFixture(
      readAutomationMonitoring({ max_runs: 1, context_mode: "fresh_task" }),
    );
    const first = await f.repository.claimOccurrence(claim);
    const retry = await f.repository.claimOccurrence(claim);
    expect(first?.run.conversationId).not.toBe(CONVERSATION);
    expect(retry?.run.id).toBe(first?.run.id);
    expect(retry?.run.conversationId).toBe(first?.run.conversationId);
    expect(readAutomationMonitoring(f.row.monitoringJson)).toMatchObject({
      automatic_run_count: 1,
      stop_requested_run_id: first?.run.id,
      last_run_conversation_id: null,
    });
    expect(f.row.nextRunAt).toEqual(claim.nextRunAt);
    expect(f.tx.automationRun.create).toHaveBeenCalledOnce();
  });

  it("excludes stopping records before taking the due batch, including old null records", async () => {
    const eligible = automation();
    const findMany = vi.fn(async (query: Prisma.AutomationFindManyArgs) => {
      const pending = automation(
        readAutomationMonitoring({ stop_requested_run_id: RUN }),
      );
      const hasDatabaseFilter = JSON.stringify(query.where).includes(
        "stop_requested_run_id",
      );
      return (hasDatabaseFilter ? [eligible] : [pending, eligible]).slice(
        0,
        Number(query.take),
      );
    });
    const repository = new PrismaAutomationRepository({
      automation: { findMany },
    } as never);
    await expect(repository.listDue(NOW, 1)).resolves.toHaveLength(1);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ AND: expect.any(Array) }),
      }),
    );
  });

  it("keeps manual fresh previews out of the count and reuses their ID on retry", async () => {
    const f = repositoryFixture(
      readAutomationMonitoring({
        automatic_run_count: 4,
        max_runs: 4,
        context_mode: "fresh_task",
      }),
    );
    const input = {
      ownerId: OWNER,
      automationId: AUTOMATION,
      requestedAt: NOW,
      idempotencyKey: "automation:manual:test",
    };
    const first = await f.repository.claimManualRun(input);
    const retry = await f.repository.claimManualRun(input);
    expect(first?.run.conversationId).not.toBe(CONVERSATION);
    expect(retry?.run.id).toBe(first?.run.id);
    expect(retry?.run.conversationId).toBe(first?.run.conversationId);
    expect(
      readAutomationMonitoring(f.row.monitoringJson).automatic_run_count,
    ).toBe(4);
    expect(f.tx.automationRun.create).toHaveBeenCalledOnce();
  });

  it.each(["started", "queued"] as const)(
    "publishes the real fresh task only after its %s receipt",
    async (status) => {
      const f = repositoryFixture(
        readAutomationMonitoring({ context_mode: "fresh_task" }),
      );
      const claimed = await f.repository.claimManualRun({
        ownerId: OWNER,
        automationId: AUTOMATION,
        requestedAt: NOW,
        idempotencyKey: "automation:manual:test",
      });
      expect(
        readAutomationMonitoring(f.row.monitoringJson).last_run_conversation_id,
      ).toBeNull();
      const identity = {
        runId: claimed!.run.id,
        automationId: AUTOMATION,
        triggeredAt: NOW,
      };
      if (status === "started")
        await f.repository.markRunStarted({ ...identity, turnId: TURN });
      else
        await f.repository.markRunQueued({
          ...identity,
          pendingRequestId: PENDING,
        });
      expect(
        readAutomationMonitoring(f.row.monitoringJson).last_run_conversation_id,
      ).toBe(claimed!.run.conversationId);
    },
  );

  it("pauses a failed final dispatch without linking the uncreated fresh task", async () => {
    const f = repositoryFixture(
      readAutomationMonitoring({
        max_runs: 1,
        context_mode: "fresh_task",
        last_run_conversation_id: CONVERSATION,
      }),
    );
    const claimed = await f.repository.claimOccurrence(claim);
    await f.repository.markRunFailed({
      runId: claimed!.run.id,
      automationId: AUTOMATION,
      errorCode: "RUNNER_UNAVAILABLE",
      triggeredAt: NOW,
      pause: false,
    });
    expect(f.row.status).toBe("paused");
    expect(readAutomationMonitoring(f.row.monitoringJson)).toMatchObject({
      automatic_run_count: 1,
      stop_requested_run_id: null,
      last_run_conversation_id: CONVERSATION,
    });
    const retry = await f.repository.claimOccurrence(claim);
    expect(retry?.shouldDispatch ?? false).toBe(false);
    expect(f.tx.automationRun.create).toHaveBeenCalledOnce();
  });

  it("keeps exhausted plans paused until the limit changes, without resetting history", async () => {
    const f = repositoryFixture(
      readAutomationMonitoring({
        automatic_run_count: 4,
        max_runs: 4,
        stop_reason: "run_limit_reached",
      }),
    );
    f.row.status = "paused";
    await expect(
      f.repository.updateOwned(OWNER, AUTOMATION, { status: "active" }),
    ).rejects.toMatchObject({ code: "AUTOMATION_RUN_LIMIT_REACHED" });
    const monitoring = readAutomationMonitoring({
      ...(f.row.monitoringJson as object),
      max_runs: 5,
    });
    await f.repository.updateOwned(OWNER, AUTOMATION, {
      status: "active",
      monitoring,
    });
    expect(readAutomationMonitoring(f.row.monitoringJson)).toMatchObject({
      automatic_run_count: 4,
      max_runs: 5,
      stop_reason: null,
    });
    expect(f.row.status).toBe("active");
  });

  it("clears the pending run-limit stop when the user raises the limit during a run", async () => {
    const f = repositoryFixture(
      readAutomationMonitoring({
        automatic_run_count: 1,
        max_runs: 1,
        stop_reason: "run_limit_reached",
        stop_requested_run_id: RUN,
      }),
    );
    await f.repository.updateOwned(OWNER, AUTOMATION, {
      monitoring: readAutomationMonitoring({ max_runs: 2 }),
    });
    expect(readAutomationMonitoring(f.row.monitoringJson)).toMatchObject({
      automatic_run_count: 1,
      max_runs: 2,
      stop_reason: null,
      stop_requested_run_id: null,
    });
  });

  it("edits a stop criterion without resetting the lifetime count", async () => {
    const f = repositoryFixture(
      readAutomationMonitoring({
        stop_condition: "Old condition",
        automatic_run_count: 4,
        stop_reason: "condition_met",
        stop_requested_run_id: RUN,
      }),
    );
    await f.repository.updateOwned(OWNER, AUTOMATION, {
      monitoring: readAutomationMonitoring({ stop_condition: "New condition" }),
    });
    expect(readAutomationMonitoring(f.row.monitoringJson)).toMatchObject({
      stop_condition: "New condition",
      automatic_run_count: 4,
      stop_reason: null,
      stop_requested_run_id: null,
    });
  });

  it("uses the locked count when a run is claimed while an edit waits for the task", async () => {
    const f = repositoryFixture(
      readAutomationMonitoring({ automatic_run_count: 1 }),
    );
    f.tx.automation.findFirst
      .mockResolvedValueOnce({
        ...f.row,
        monitoringJson: readAutomationMonitoring({ automatic_run_count: 0 }),
      })
      .mockResolvedValueOnce({
        ...f.row,
        monitoringJson: readAutomationMonitoring({ automatic_run_count: 1 }),
      });
    await f.repository.updateOwned(OWNER, AUTOMATION, {
      monitoring: readAutomationMonitoring({ max_runs: 2 }),
    });
    expect(readAutomationMonitoring(f.row.monitoringJson)).toMatchObject({
      automatic_run_count: 1,
      max_runs: 2,
    });
  });

  it("still edits pre-change null settings without turning on monitoring", async () => {
    const f = repositoryFixture();
    await f.repository.updateOwned(OWNER, AUTOMATION, { title: "Renamed" });
    expect(f.row.title).toBe("Renamed");
    expect(f.row.monitoringJson).toBeNull();
    expect(readAutomationMonitoring(f.row.monitoringJson)).toMatchObject({
      automatic_run_count: 0,
      max_runs: null,
      context_mode: "reuse_task",
    });
  });
});

function stopFixture(
  monitoring: unknown = readAutomationMonitoring({
    stop_condition: "Checklist complete",
    stop_requested_run_id: RUN,
    stop_reason: "condition_met",
  }),
) {
  const row = automation(monitoring);
  const currentRun = run({
    executionContextJson: {
      trigger: "scheduled",
      context_mode: "reuse_task",
      stop_condition: "Checklist complete",
    },
  });
  const tx = {
    $executeRaw: vi.fn(async () => 1),
    $queryRaw: vi.fn(async () => [{ id: TURN }]),
    conversationTurn: {
      findFirst: vi.fn(async () => ({
        idempotencyKey: currentRun.idempotencyKey,
      })),
    },
    automation: {
      findFirst: vi.fn(async () => row),
      findUnique: vi.fn(async () => row),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const status = data.status ?? row.status;
        const nextRunAt =
          data.nextRunAt === undefined ? row.nextRunAt : data.nextRunAt;
        if (status === "active" && nextRunAt === null)
          throw new Error("automations_active_schedule_check");
        return Object.assign(row, data);
      }),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    automationRun: {
      findFirst: vi.fn(async () => currentRun),
      findMany: vi.fn(async () => [currentRun]),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
  };
  const db = {
    $transaction: vi.fn(
      async (action: (client: typeof tx) => Promise<unknown>) => action(tx),
    ),
  };
  return { row, currentRun, tx, db };
}

describe("automation monitoring host-bound stop", () => {
  it("binds stop requests to the running owner turn and leaves that turn untouched", async () => {
    const f = stopFixture(
      readAutomationMonitoring({ stop_condition: "Checklist complete" }),
    );
    await expect(
      requestMonitoringStop(f.db as never, OWNER, CONVERSATION, TURN),
    ).resolves.toEqual({ stop_requested: true });
    expect(f.tx.conversationTurn.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: TURN,
          conversationId: CONVERSATION,
          submittedBy: OWNER,
          status: "running",
        },
      }),
    );
    expect(f.row.status).toBe("active");
    expect(f.row.nextRunAt).toEqual(NOW);
    expect(readAutomationMonitoring(f.row.monitoringJson)).toMatchObject({
      stop_reason: "condition_met",
      stop_requested_run_id: RUN,
    });
  });

  it.each([
    null,
    {
      trigger: "manual",
      context_mode: "reuse_task",
      stop_condition: "Checklist complete",
    },
  ])("denies ordinary or preview contexts: %s", async (context) => {
    const f = stopFixture();
    f.currentRun.executionContextJson = context;
    await expect(
      requestMonitoringStop(f.db as never, OWNER, CONVERSATION, TURN),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(f.tx.automation.update).not.toHaveBeenCalled();
  });

  it("denies missing or non-running owner turns before changing a plan", async () => {
    const f = stopFixture();
    f.tx.$queryRaw.mockResolvedValueOnce([]);
    await expect(
      requestMonitoringStop(f.db as never, OWNER, CONVERSATION, TURN),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(f.tx.automation.update).not.toHaveBeenCalled();
  });

  it("rejects a stop from an old criterion after the user edits it", async () => {
    const f = stopFixture(
      readAutomationMonitoring({ stop_condition: "A different condition" }),
    );
    await expect(
      requestMonitoringStop(f.db as never, OWNER, CONVERSATION, TURN),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(f.tx.automation.update).not.toHaveBeenCalled();
  });

  it("settles a persisted stop after native terminal recovery without replay", async () => {
    const f = stopFixture();
    await settleMonitoringStop(f.tx as never, CONVERSATION, {
      id: TURN,
      submittedBy: OWNER,
      idempotencyKey: "automation:test",
    });
    expect(f.row.status).toBe("paused");
    expect(f.row.nextRunAt).toBeNull();
    expect(
      readAutomationMonitoring(f.row.monitoringJson).stop_requested_run_id,
    ).toBeNull();
  });

  it("does not pause pre-change runs or a different pending stop", async () => {
    const legacy = stopFixture(null);
    legacy.currentRun.executionContextJson = null;
    await settleMonitoringStop(legacy.tx as never, CONVERSATION, {
      id: TURN,
      submittedBy: OWNER,
      idempotencyKey: "automation:test",
    });
    expect(legacy.tx.automation.update).not.toHaveBeenCalled();
    const other = stopFixture(
      readAutomationMonitoring({ stop_requested_run_id: NEXT }),
    );
    await settleMonitoringRunStop(other.tx as never, {
      id: RUN,
      automationId: AUTOMATION,
    });
    expect(other.tx.automation.update).not.toHaveBeenCalled();
  });

  it("settles deployment termination of the final run even without a native event", async () => {
    const f = stopFixture(
      readAutomationMonitoring({
        max_runs: 1,
        automatic_run_count: 1,
        stop_reason: "run_limit_reached",
        stop_requested_run_id: RUN,
      }),
    );
    await settleMonitoringRunStop(f.tx as never, {
      id: RUN,
      automationId: AUTOMATION,
    });
    expect(f.row.status).toBe("paused");
    expect(readAutomationMonitoring(f.row.monitoringJson)).toMatchObject({
      automatic_run_count: 1,
      stop_requested_run_id: null,
    });
  });

  it("closes cancelled queued runs, including cancellation before their receipt is saved", async () => {
    const f = stopFixture(
      readAutomationMonitoring({
        max_runs: 1,
        automatic_run_count: 1,
        stop_reason: "run_limit_reached",
        stop_requested_run_id: RUN,
      }),
    );
    await settleCancelledAutomationPending(f.tx as never, {
      id: PENDING,
      conversationId: CONVERSATION,
      submittedBy: OWNER,
      idempotencyKey: "automation:test",
    });
    expect(f.tx.automationRun.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          conversationId: CONVERSATION,
          ownerId: OWNER,
          OR: [
            { pendingRequestId: PENDING },
            { idempotencyKey: "automation:test" },
          ],
        }),
      }),
    );
    expect(f.tx.automationRun.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "failed",
          pendingRequestId: null,
          errorCode: "TURN_START_CLOSED",
        }),
      }),
    );
    expect(f.row.status).toBe("paused");
    expect(readAutomationMonitoring(f.row.monitoringJson)).toMatchObject({
      automatic_run_count: 1,
      stop_requested_run_id: null,
    });
  });

  it("does not settle a cancellation that lost to an already-started or completed run", async () => {
    const f = stopFixture();
    f.tx.automationRun.updateMany.mockResolvedValueOnce({ count: 0 });
    await settleCancelledAutomationPending(f.tx as never, {
      id: PENDING,
      conversationId: CONVERSATION,
      submittedBy: OWNER,
      idempotencyKey: "automation:test",
    });
    expect(f.tx.automation.update).not.toHaveBeenCalled();
    expect(f.tx.automation.updateMany).not.toHaveBeenCalled();
    expect(f.row.status).toBe("active");
  });

  it("cancels a pre-change queued run without adding limits or changing the original task", async () => {
    const f = stopFixture(null);
    f.currentRun.executionContextJson = null;
    await settleCancelledAutomationPending(f.tx as never, {
      id: PENDING,
      conversationId: CONVERSATION,
      submittedBy: OWNER,
      idempotencyKey: "automation:test",
    });
    expect(f.row.monitoringJson).toBeNull();
    expect(f.row.conversationId).toBe(CONVERSATION);
    expect(f.row.status).toBe("active");
    expect(f.tx.automationRun.updateMany).toHaveBeenCalledOnce();
  });

  it("leaves ordinary pending messages on their existing cancellation path", async () => {
    const f = stopFixture();
    await settleCancelledAutomationPending(f.tx as never, {
      id: PENDING,
      conversationId: CONVERSATION,
      submittedBy: OWNER,
      idempotencyKey: null,
    });
    expect(f.tx.automationRun.findMany).not.toHaveBeenCalled();
    expect(f.tx.automation.update).not.toHaveBeenCalled();
  });
});
