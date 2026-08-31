import { describe, expect, it, vi } from "vitest";

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
        completedAt: { not: null },
        completionReadAt: null,
      },
      select: { conversationId: true, completedAt: true },
      orderBy: [{ completedAt: "desc" }, { id: "desc" }],
    });
  });

  it("acknowledges only unread completions at or before the observed cursor", async () => {
    const through = new Date("2026-07-31T01:02:03.000Z");
    const readAt = new Date("2026-07-31T01:02:04.000Z");
    const fixture = repositoryFixture();

    await fixture.repository.markCompletionNotificationsRead(
      OWNER_ID,
      through,
      readAt,
    );

    expect(fixture.automationRun.updateMany).toHaveBeenCalledWith({
      where: {
        ownerId: OWNER_ID,
        completedAt: { not: null, lte: through },
        completionReadAt: null,
      },
      data: { completionReadAt: readAt },
    });
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

function repositoryFixture() {
  const automationRun = {
    findFirst: vi.fn(),
    updateMany: vi.fn(async () => ({ count: 0 })),
  };
  return {
    automationRun,
    repository: new PrismaAutomationRepository({
      automationRun,
    } as never),
  };
}

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
