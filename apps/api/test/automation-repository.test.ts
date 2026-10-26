import { describe, expect, it, vi } from "vitest";
import type { Prisma } from "../src/generated/prisma/client.js";

import { PrismaAutomationRepository } from "../src/modules/automations/repository.js";
import { AutomationTargetCollaborationModeError } from "../src/modules/automations/types.js";

const OWNER_ID = "10000000-0000-4000-8000-000000000001";
const AUTOMATION_ID = "20000000-0000-4000-8000-000000000001";
const CONVERSATION_ID = "30000000-0000-4000-8000-000000000001";
const RUN_ID = "40000000-0000-4000-8000-000000000001";
const NOW = new Date("2026-07-31T01:02:03.000Z");

describe("PrismaAutomationRepository completion notifications", () => {
  it("finds only the owner's latest unread successful completion", async () => {
    const completedAt = new Date("2026-07-31T01:02:03.000Z");
    const fixture = repositoryFixture();
    fixture.automationRun.findFirst.mockResolvedValueOnce({
      conversationId: CONVERSATION_ID,
      completedAt,
    });

    await expect(
      fixture.repository.latestUnreadCompletion(OWNER_ID),
    ).resolves.toEqual({
      conversationId: CONVERSATION_ID,
      completedAt,
    });
    expect(fixture.automationRun.findFirst).toHaveBeenCalledWith({
      where: {
        ownerId: OWNER_ID,
        conversationId: { in: [CONVERSATION_ID] },
        completedAt: { not: null },
      },
      select: { conversationId: true, completedAt: true },
      orderBy: [{ completedAt: "desc" }, { id: "desc" }],
    });
    expect(fixture.conversation.findMany).toHaveBeenCalledWith({
      where: { ownerId: OWNER_ID, completionUnread: true },
      select: { id: true },
    });
  });

  it("does not report stale automation runs after every task is read", async () => {
    const fixture = repositoryFixture({ unreadConversationIds: [] });

    await expect(
      fixture.repository.latestUnreadCompletion(OWNER_ID),
    ).resolves.toBeNull();
    expect(fixture.automationRun.findFirst).not.toHaveBeenCalled();
  });

  it.each([null, new Date("2026-07-31T02:00:00.000Z")])(
    "reports an unread task after an earlier bulk acknowledgment set its run read time to %s",
    async (completionReadAt) => {
      const fixture = repositoryFixture();
      const storedRun = {
        conversationId: CONVERSATION_ID,
        completedAt: NOW,
        completionReadAt,
      };
      fixture.automationRun.findFirst.mockImplementation(
        async ({ where }: { where: Prisma.AutomationRunWhereInput }) =>
          where.completionReadAt === null && storedRun.completionReadAt !== null
            ? null
            : storedRun,
      );

      await expect(
        fixture.repository.latestUnreadCompletion(OWNER_ID),
      ).resolves.toEqual({ conversationId: CONVERSATION_ID, completedAt: NOW });
    },
  );

  it("does not report a notification before its run has completed", async () => {
    const fixture = repositoryFixture();
    fixture.automationRun.findFirst.mockResolvedValueOnce({
      conversationId: CONVERSATION_ID,
      completedAt: null,
    });

    await expect(
      fixture.repository.latestUnreadCompletion(OWNER_ID),
    ).resolves.toBeNull();
  });
});

describe("PrismaAutomationRepository owned record lookup", () => {
  it("loads the automation record without fetching conversation details", async () => {
    const row = automationRow();
    const automation = {
      findFirst: vi.fn(async () => row),
    };
    const conversation = {
      findMany: vi.fn(),
    };
    const repository = new PrismaAutomationRepository({
      automation,
      conversation,
    } as never);

    await expect(
      repository.findOwnedRecord(OWNER_ID, AUTOMATION_ID),
    ).resolves.toMatchObject({
      id: AUTOMATION_ID,
      ownerId: OWNER_ID,
      conversationId: CONVERSATION_ID,
    });
    expect(automation.findFirst).toHaveBeenCalledWith({
      where: {
        id: AUTOMATION_ID,
        ownerId: OWNER_ID,
        deletedAt: null,
      },
    });
    expect(conversation.findMany).not.toHaveBeenCalled();
  });
});

describe("PrismaAutomationRepository target mode locking", () => {
  it("rejects Plan mode after locking the target task and before creating an automation", async () => {
    const transaction = {
      $executeRaw: vi.fn(async () => 1),
      $queryRaw: vi.fn(async () => [
        {
          id: CONVERSATION_ID,
          ownerId: OWNER_ID,
          title: "Plan task",
          archiveStatus: "active",
          pinnedAt: NOW,
          collaborationMode: "plan",
        },
      ]),
      automation: {
        count: vi.fn(async () => 0),
        create: vi.fn(),
      },
    };
    const repository = new PrismaAutomationRepository({
      $transaction: vi.fn(
        async (callback: (tx: typeof transaction) => Promise<unknown>) =>
          callback(transaction),
      ),
    } as never);

    await expect(
      repository.createWithinOwnerLimit(
        {
          ownerId: OWNER_ID,
          conversationId: CONVERSATION_ID,
          title: "Morning brief",
          instruction: "Summarize updates.",
          status: "active",
          frequency: "daily",
          intervalCount: 1,
          minuteOfHour: null,
          timeOfDayMinutes: 540,
          weekdays: [],
          dayOfMonth: null,
          monthOfYear: null,
          timeZone: "Asia/Shanghai",
          anchorAt: NOW,
          nextRunAt: NOW,
          expiresAt: null,
          modelId: null,
          reasoningEffort: null,
        },
        100,
      ),
    ).rejects.toBeInstanceOf(AutomationTargetCollaborationModeError);
    expect(transaction.$queryRaw).toHaveBeenCalledOnce();
    expect(transaction.automation.count).not.toHaveBeenCalled();
    expect(transaction.automation.create).not.toHaveBeenCalled();
  });
});

describe("PrismaAutomationRepository manual runs", () => {
  it("claims a manual run for an owned paused automation without changing its schedule", async () => {
    const automation = {
      id: AUTOMATION_ID,
      ownerId: OWNER_ID,
      conversationId: CONVERSATION_ID,
      title: "Morning brief",
      instruction: "Summarize updates.",
      status: "paused",
      frequency: "daily",
      intervalCount: 1,
      minuteOfHour: null,
      timeOfDayMinutes: 540,
      weekdays: [],
      dayOfMonth: null,
      monthOfYear: null,
      timeZone: "Asia/Shanghai",
      anchorAt: NOW,
      nextRunAt: null,
      expiresAt: null,
      lastRunAt: null,
      lastRunStatus: null,
      lastErrorCode: null,
      modelId: null,
      reasoningEffort: null,
      deletedAt: null,
      createdAt: NOW,
      updatedAt: NOW,
    };
    const run = {
      id: RUN_ID,
      automationId: AUTOMATION_ID,
      ownerId: OWNER_ID,
      conversationId: CONVERSATION_ID,
      scheduledFor: NOW,
      idempotencyKey: "automation:manual:test",
      status: "dispatching",
      turnId: null,
      pendingRequestId: null,
      errorCode: null,
      completedAt: null,
      completionReadAt: null,
      createdAt: NOW,
      updatedAt: NOW,
    };
    const transaction = {
      $executeRaw: vi.fn(async () => 1),
      automation: {
        findFirst: vi.fn(async () => automation),
        update: vi.fn(),
      },
      automationRun: {
        findUnique: vi
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(null),
        create: vi.fn(async () => run),
      },
    };
    const repository = new PrismaAutomationRepository({
      $transaction: vi.fn(
        async (callback: (tx: typeof transaction) => Promise<unknown>) =>
          callback(transaction),
      ),
    } as never);

    await expect(
      repository.claimManualRun({
        ownerId: OWNER_ID,
        automationId: AUTOMATION_ID,
        requestedAt: NOW,
        idempotencyKey: "automation:manual:test",
      }),
    ).resolves.toMatchObject({
      automation: { id: AUTOMATION_ID, status: "paused", nextRunAt: null },
      run: { id: RUN_ID, scheduledFor: NOW },
      shouldDispatch: true,
    });
    expect(transaction.automation.findFirst).toHaveBeenCalledWith({
      where: {
        id: AUTOMATION_ID,
        ownerId: OWNER_ID,
        deletedAt: null,
      },
    });
    expect(transaction.automationRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        automationId: AUTOMATION_ID,
        ownerId: OWNER_ID,
        scheduledFor: NOW,
        status: "dispatching",
      }),
    });
    expect(transaction.automation.update).not.toHaveBeenCalled();
  });
});

function repositoryFixture(options?: { unreadConversationIds?: string[] }) {
  const automationRun = {
    findFirst: vi.fn(),
  };
  const conversation = {
    findMany: vi.fn(async () =>
      (options?.unreadConversationIds ?? [CONVERSATION_ID]).map((id) => ({
        id,
      })),
    ),
  };
  return {
    automationRun,
    conversation,
    repository: new PrismaAutomationRepository({
      automationRun,
      conversation,
    } as never),
  };
}

describe("automation creation and pinning transactions", () => {
  function fixture(pinnedAt: Date | null = null) {
    const row = automationRow();
    const transaction = {
      $executeRaw: vi.fn(async () => 1),
      $queryRaw: vi.fn(async () => [{ id: CONVERSATION_ID, ownerId: OWNER_ID, title: "Current", archiveStatus: "active", collaborationMode: "default", pinnedAt }]),
      conversation: { update: vi.fn(async () => ({ pinnedAt: NOW })) },
      automation: {
        findUnique: vi.fn(async (): Promise<ReturnType<typeof automationRow> | null> => null),
        count: vi.fn(async () => 0), create: vi.fn(async () => row),
      },
    };
    const repository = new PrismaAutomationRepository({ $transaction: vi.fn(async (callback: (tx: typeof transaction) => Promise<unknown>) => callback(transaction)) } as never);
    const input: import("../src/modules/automations/types.js").CreateAutomationRecord = {
      id: row.id, ownerId: row.ownerId, conversationId: row.conversationId,
      title: row.title, instruction: row.instruction, status: "active", frequency: "daily",
      intervalCount: row.intervalCount, minuteOfHour: row.minuteOfHour, timeOfDayMinutes: row.timeOfDayMinutes,
      weekdays: row.weekdays, dayOfMonth: row.dayOfMonth, monthOfYear: row.monthOfYear, timeZone: row.timeZone,
      anchorAt: row.anchorAt, nextRunAt: row.nextRunAt, expiresAt: row.expiresAt, modelId: row.modelId, reasoningEffort: row.reasoningEffort,
    };
    return { transaction, repository, input, row };
  }

  it("pins the current task inside the same transaction as creating its automation", async () => {
    const f = fixture();
    const result = await f.repository.createWithinOwnerLimit(f.input, 100, { pinTarget: true });
    expect(f.transaction.conversation.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: CONVERSATION_ID }, data: { pinnedAt: expect.any(Date), sortOrder: null } }));
    expect(result?.conversation?.pinnedAt).toEqual(NOW);
    expect(f.transaction.automation.create).toHaveBeenCalledOnce();
  });

  it("keeps the target unpinned when the owner has reached the creation limit", async () => {
    const f = fixture();
    f.transaction.automation.count.mockResolvedValueOnce(100);
    expect(await f.repository.createWithinOwnerLimit(f.input, 100, { pinTarget: true })).toBeNull();
    expect(f.transaction.conversation.update).not.toHaveBeenCalled();
    expect(f.transaction.automation.create).not.toHaveBeenCalled();
  });

  it("rejects another default chat creation for an already configured target without pinning or writing", async () => {
    const f = fixture();
    Object.assign(f.transaction.automation, { findFirst: vi.fn(async () => ({ id: AUTOMATION_ID })) });
    await expect(f.repository.createWithinOwnerLimit(f.input, 100, { pinTarget: true, allowAdditional: false })).rejects.toMatchObject({ name: "AutomationTargetAlreadyConfiguredError" });
    expect(f.transaction.conversation.update).not.toHaveBeenCalled();
    expect(f.transaction.automation.create).not.toHaveBeenCalled();
  });

  it("allows an explicitly additional plan without treating the existing plan as a duplicate request", async () => {
    const f = fixture(NOW);
    const existing = vi.fn(async () => ({ id: AUTOMATION_ID }));
    Object.assign(f.transaction.automation, { findFirst: existing });
    await expect(f.repository.createWithinOwnerLimit(f.input, 100, { allowAdditional: true })).resolves.toMatchObject({ wasCreated: true });
    expect(existing).not.toHaveBeenCalled();
    expect(f.transaction.automation.create).toHaveBeenCalledOnce();
  });

  it("returns the primary-key creation receipt under the owner lock before counting or creating", async () => {
    const f = fixture(NOW);
    f.transaction.automation.findUnique.mockResolvedValueOnce(f.row);
    expect((await f.repository.createWithinOwnerLimit(f.input, 100, { allowAdditional: false }))?.id).toBe(AUTOMATION_ID);
    expect(f.transaction.$executeRaw).toHaveBeenCalledOnce();
    expect(f.transaction.automation.count).not.toHaveBeenCalled();
    expect(f.transaction.automation.create).not.toHaveBeenCalled();
  });
});

function automationRow() {
  return {
    id: AUTOMATION_ID,
    ownerId: OWNER_ID,
    conversationId: CONVERSATION_ID,
    title: "Morning brief",
    instruction: "Summarize updates.",
    status: "active",
    frequency: "daily",
    intervalCount: 1,
    minuteOfHour: null,
    timeOfDayMinutes: 540,
    weekdays: [],
    dayOfMonth: null,
    monthOfYear: null,
    timeZone: "Asia/Shanghai",
    anchorAt: NOW,
    nextRunAt: NOW,
    expiresAt: null,
    lastRunAt: null,
    lastRunStatus: null,
    lastErrorCode: null,
    modelId: null,
    reasoningEffort: null,
    deletedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
}
