import { describe, expect, it, vi } from "vitest";

import { AutomationService } from "../src/modules/automations/service.js";
import {
  AutomationTargetCollaborationModeError,
  AutomationTargetNotPinnedError,
  type AutomationRecord,
  type AutomationRepository,
  type AutomationWithConversationRecord,
  type CreateAutomationRecord,
  type UpdateAutomationRecord,
} from "../src/modules/automations/types.js";

const OWNER_ID = "10000000-0000-4000-8000-000000000001";
const AUTOMATION_ID = "20000000-0000-4000-8000-000000000001";
const CONVERSATION_ID = "30000000-0000-4000-8000-000000000001";
const NEW_CONVERSATION_ID = "30000000-0000-4000-8000-000000000002";
const RUN_ID = "40000000-0000-4000-8000-000000000001";
const TURN_ID = "50000000-0000-4000-8000-000000000001";
const PENDING_ID = "60000000-0000-4000-8000-000000000001";
const REQUEST_ID = "70000000-0000-4000-8000-000000000001";
const NOW = new Date("2026-07-30T00:00:00.000Z");

describe("AutomationService", () => {
  it("creates a new pinned task once and persists it as the reusable target", async () => {
    const fixture = automationFixture();
    fixture.conversations.createPinnedConversation.mockResolvedValueOnce({
      id: NEW_CONVERSATION_ID,
    });
    fixture.repository.createWithinOwnerLimit.mockImplementationOnce(
      async (input: CreateAutomationRecord) =>
        automationWithConversation(
          {
            ...input,
            id: AUTOMATION_ID,
            lastRunAt: null,
            lastRunStatus: null,
            lastErrorCode: null,
            deletedAt: null,
            createdAt: NOW,
            updatedAt: NOW,
          },
          NEW_CONVERSATION_ID,
        ),
    );

    const created = await fixture.service.create(
      OWNER_ID,
      {
        title: "Morning brief",
        instruction: "Summarize important updates.",
        target: { mode: "new_task" },
        schedule: {
          frequency: "daily",
          interval: 1,
          time: "09:00",
          time_zone: "Asia/Shanghai",
        },
        expires_on: null,
      },
      {},
      "zh-CN",
    );

    expect(
      fixture.conversations.createPinnedConversation,
    ).toHaveBeenCalledOnce();
    expect(fixture.conversations.createPinnedConversation).toHaveBeenCalledWith(
      OWNER_ID,
      "Morning brief",
      "zh-CN",
    );
    expect(fixture.repository.createWithinOwnerLimit).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: NEW_CONVERSATION_ID }),
      100,
    );
    expect(
      fixture.conversations.assertAutomationCompatible,
    ).not.toHaveBeenCalled();
    expect(created.conversation.id).toBe(NEW_CONVERSATION_ID);
  });

  it("maps a non-pinned or foreign target to the public domain error", async () => {
    const fixture = automationFixture();
    fixture.repository.createWithinOwnerLimit.mockRejectedValueOnce(
      new AutomationTargetNotPinnedError(),
    );

    await expect(
      fixture.service.create(
        OWNER_ID,
        {
          title: "Morning brief",
          instruction: "Summarize important updates.",
          target: {
            mode: "existing_task",
            conversation_id: CONVERSATION_ID,
          },
          schedule: {
            frequency: "hourly",
            interval: 1,
            minute: 5,
            time_zone: "UTC",
          },
          expires_on: null,
        },
        {},
      ),
    ).rejects.toMatchObject({ code: "AUTOMATION_TASK_NOT_PINNED" });
  });

  it("maps a target-mode race to the public Plan-mode conflict", async () => {
    const fixture = automationFixture();
    fixture.repository.createWithinOwnerLimit.mockRejectedValueOnce(
      new AutomationTargetCollaborationModeError(),
    );

    await expect(
      fixture.service.create(
        OWNER_ID,
        {
          title: "Morning brief",
          instruction: "Summarize important updates.",
          target: {
            mode: "existing_task",
            conversation_id: CONVERSATION_ID,
          },
          schedule: {
            frequency: "hourly",
            interval: 1,
            minute: 5,
            time_zone: "UTC",
          },
          expires_on: null,
        },
        {},
      ),
    ).rejects.toMatchObject({ code: "COLLABORATION_MODE_UNAVAILABLE" });
  });

  it("avoids redundant conversation reads before the locked update", async () => {
    const fixture = automationFixture();
    const existing = automationRecord();
    fixture.repository.findOwnedRecord.mockResolvedValueOnce(existing);
    fixture.repository.updateOwned.mockImplementationOnce(
      async (
        _ownerId: string,
        _automationId: string,
        input: UpdateAutomationRecord,
      ) =>
        automationWithConversation({
          ...existing,
          ...input,
          updatedAt: NOW,
        }),
    );

    await fixture.service.update(
      OWNER_ID,
      AUTOMATION_ID,
      {
        title: "Updated brief",
        target: {
          mode: "existing_task",
          conversation_id: CONVERSATION_ID,
        },
      },
      {},
    );

    expect(fixture.repository.findOwnedRecord).toHaveBeenCalledWith(
      OWNER_ID,
      AUTOMATION_ID,
    );
    expect(fixture.repository.findOwned).not.toHaveBeenCalled();
    expect(
      fixture.conversations.assertAutomationCompatible,
    ).not.toHaveBeenCalled();
    expect(fixture.repository.updateOwned).toHaveBeenCalledWith(
      OWNER_ID,
      AUTOMATION_ID,
      expect.objectContaining({
        title: "Updated brief",
        conversationId: CONVERSATION_ID,
      }),
    );
  });

  it("reports the latest unread automation completion", async () => {
    const fixture = automationFixture();
    const completedAt = new Date("2026-07-30T00:30:00.000Z");
    fixture.repository.latestUnreadCompletion.mockResolvedValueOnce(
      { conversationId: CONVERSATION_ID, completedAt },
    );

    await expect(
      fixture.service.completionNotifications(OWNER_ID),
    ).resolves.toEqual({
      latest_unread: {
        conversation_id: CONVERSATION_ID,
        completed_at: completedAt.toISOString(),
      },
    });
    expect(fixture.repository.latestUnreadCompletion).toHaveBeenCalledWith(
      OWNER_ID,
    );
  });

  it("marks only completions through the observed cursor as read", async () => {
    const fixture = automationFixture();
    const through = "2026-07-29T23:50:00.000Z";
    fixture.repository.latestUnreadCompletion.mockResolvedValueOnce(null);

    await expect(
      fixture.service.markCompletionNotificationsRead(OWNER_ID, { through }),
    ).resolves.toEqual({
      latest_unread: null,
    });
    expect(
      fixture.repository.markCompletionNotificationsRead,
    ).toHaveBeenCalledWith(OWNER_ID, new Date(through), NOW);
  });

  it.each([
    ["started", { status: "started" as const, turnId: TURN_ID }],
    ["queued", { status: "queued" as const, pendingRequestId: PENDING_ID }],
  ])(
    "dispatches through the existing conversation lifecycle as %s",
    async (expectedStatus, submission) => {
      const fixture = automationFixture();
      const automation = automationRecord();
      const scheduledFor = automation.nextRunAt!;
      fixture.repository.findById.mockResolvedValueOnce(automation);
      fixture.repository.claimOccurrence.mockResolvedValueOnce({
        automation,
        run: {
          id: RUN_ID,
          automationId: AUTOMATION_ID,
          ownerId: OWNER_ID,
          conversationId: CONVERSATION_ID,
          scheduledFor,
          idempotencyKey: "automation:test",
          status: "dispatching",
          turnId: null,
          pendingRequestId: null,
          errorCode: null,
          completedAt: null,
          completionReadAt: null,
          createdAt: NOW,
          updatedAt: NOW,
        },
        shouldDispatch: true,
      });
      fixture.repository.findPinnedConversation.mockResolvedValueOnce(
        pinnedConversation(),
      );
      fixture.conversations.submitScheduledTurn.mockResolvedValueOnce(
        submission,
      );

      await fixture.service.dispatchOccurrence(AUTOMATION_ID, scheduledFor);

      expect(fixture.conversations.submitScheduledTurn).toHaveBeenCalledWith(
        OWNER_ID,
        CONVERSATION_ID,
        "Summarize important updates.",
        "automation:test",
        undefined,
      );
      if (expectedStatus === "started") {
        expect(fixture.repository.markRunStarted).toHaveBeenCalledWith(
          expect.objectContaining({ turnId: TURN_ID }),
        );
        expect(fixture.repository.markRunQueued).not.toHaveBeenCalled();
      } else {
        expect(fixture.repository.markRunQueued).toHaveBeenCalledWith(
          expect.objectContaining({ pendingRequestId: PENDING_ID }),
        );
        expect(fixture.repository.markRunStarted).not.toHaveBeenCalled();
      }
    },
  );

  it("runs a paused automation immediately without claiming its schedule", async () => {
    const fixture = automationFixture();
    const automation = automationRecord({
      status: "paused",
      nextRunAt: null,
    });
    fixture.repository.claimManualRun.mockResolvedValueOnce({
      automation,
      run: {
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
      },
      shouldDispatch: true,
    });
    fixture.repository.findPinnedConversation.mockResolvedValueOnce(
      pinnedConversation(),
    );
    fixture.conversations.submitScheduledTurn.mockResolvedValueOnce({
      status: "started",
      turnId: TURN_ID,
    });

    await expect(
      fixture.service.runNow(OWNER_ID, AUTOMATION_ID, REQUEST_ID, {
        ipAddress: "127.0.0.1",
      }),
    ).resolves.toEqual({ status: "started", turn_id: TURN_ID });

    expect(fixture.repository.claimManualRun).toHaveBeenCalledWith({
      ownerId: OWNER_ID,
      automationId: AUTOMATION_ID,
      requestedAt: NOW,
      idempotencyKey: expect.stringMatching(/^automation:manual:/u),
    });
    expect(fixture.repository.claimOccurrence).not.toHaveBeenCalled();
    expect(fixture.conversations.submitScheduledTurn).toHaveBeenCalledWith(
      OWNER_ID,
      CONVERSATION_ID,
      "Summarize important updates.",
      "automation:manual:test",
      undefined,
    );
    expect(fixture.audit.write).toHaveBeenCalledWith(
      expect.objectContaining({
        ipAddress: "127.0.0.1",
        action: "automation_dispatched",
        targetId: AUTOMATION_ID,
      }),
    );
  });

  it("returns the prior queued receipt when an immediate-run request is retried", async () => {
    const fixture = automationFixture();
    const automation = automationRecord();
    fixture.repository.claimManualRun.mockResolvedValueOnce({
      automation,
      run: {
        id: RUN_ID,
        automationId: AUTOMATION_ID,
        ownerId: OWNER_ID,
        conversationId: CONVERSATION_ID,
        scheduledFor: NOW,
        idempotencyKey: "automation:manual:test",
        status: "queued",
        turnId: null,
        pendingRequestId: PENDING_ID,
        errorCode: null,
        completedAt: null,
        completionReadAt: null,
        createdAt: NOW,
        updatedAt: NOW,
      },
      shouldDispatch: false,
    });

    await expect(
      fixture.service.runNow(OWNER_ID, AUTOMATION_ID, REQUEST_ID, {}),
    ).resolves.toEqual({
      status: "queued",
      pending_request_id: PENDING_ID,
    });
    expect(fixture.conversations.submitScheduledTurn).not.toHaveBeenCalled();
  });

  it("pauses an automation when its task is no longer pinned", async () => {
    const fixture = automationFixture();
    const automation = automationRecord();
    const scheduledFor = automation.nextRunAt!;
    fixture.repository.findById.mockResolvedValueOnce(automation);
    fixture.repository.claimOccurrence.mockResolvedValueOnce({
      automation,
      run: {
        id: RUN_ID,
        automationId: AUTOMATION_ID,
        ownerId: OWNER_ID,
        conversationId: CONVERSATION_ID,
        scheduledFor,
        idempotencyKey: "automation:test",
        status: "dispatching",
        turnId: null,
        pendingRequestId: null,
        errorCode: null,
        completedAt: null,
        completionReadAt: null,
        createdAt: NOW,
        updatedAt: NOW,
      },
      shouldDispatch: true,
    });
    fixture.repository.findPinnedConversation.mockResolvedValueOnce(null);

    await fixture.service.dispatchOccurrence(AUTOMATION_ID, scheduledFor);

    expect(fixture.repository.markRunFailed).toHaveBeenCalledWith({
      runId: RUN_ID,
      automationId: AUTOMATION_ID,
      errorCode: "AUTOMATION_TASK_NOT_PINNED",
      triggeredAt: NOW,
      pause: true,
    });
    expect(fixture.conversations.submitScheduledTurn).not.toHaveBeenCalled();
  });

  it("resumes a paused automation with its original cadence anchor", async () => {
    const fixture = automationFixture();
    const paused = automationWithConversation({
      ...automationRecord(),
      status: "paused",
      nextRunAt: null,
    });
    fixture.repository.findOwnedRecord.mockResolvedValueOnce(paused);
    fixture.repository.updateOwned.mockImplementationOnce(
      async (
        _ownerId: string,
        _automationId: string,
        input: UpdateAutomationRecord,
      ) => automationWithConversation({ ...paused, ...input, updatedAt: NOW }),
    );

    const result = await fixture.service.update(
      OWNER_ID,
      AUTOMATION_ID,
      { status: "active" },
      {},
    );

    expect(result.status).toBe("active");
    expect(result.next_run_at).toBe("2026-07-30T01:00:00.000Z");
  });

  it("forwards the persisted model preference to the scheduled turn", async () => {
    const fixture = automationFixture();
    const automation = automationRecord({
      modelId: "model-a",
      reasoningEffort: "high",
    });
    fixture.repository.findById.mockResolvedValueOnce(automation);
    fixture.repository.findPinnedConversation.mockResolvedValueOnce(
      pinnedConversation(),
    );
    fixture.repository.claimOccurrence.mockResolvedValueOnce({
      automation,
      run: {
        id: RUN_ID,
        automationId: AUTOMATION_ID,
        ownerId: OWNER_ID,
        conversationId: CONVERSATION_ID,
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
      },
      shouldDispatch: true,
    });
    fixture.conversations.submitScheduledTurn.mockResolvedValueOnce({
      status: "started",
      turnId: TURN_ID,
    });

    await fixture.service.dispatchOccurrence(AUTOMATION_ID, NOW);

    expect(fixture.conversations.submitScheduledTurn).toHaveBeenCalledWith(
      OWNER_ID,
      CONVERSATION_ID,
      "Summarize important updates.",
      "automation:test",
      {
        modelId: "model-a",
        reasoningEffort: "high",
      },
    );
  });

  it("persists the supplied model preference on create and update", async () => {
    const fixture = automationFixture();
    fixture.conversations.createPinnedConversation.mockResolvedValueOnce({
      id: NEW_CONVERSATION_ID,
    });
    fixture.repository.createWithinOwnerLimit.mockResolvedValueOnce(
      automationWithConversation(
        automationRecord({
          modelId: "model-a",
          reasoningEffort: "low",
        }),
      ),
    );

    await fixture.service.create(
      OWNER_ID,
      {
        title: "Morning brief",
        instruction: "Summarize important updates.",
        target: { mode: "new_task" },
        schedule: {
          frequency: "daily",
          interval: 1,
          time: "09:00",
          time_zone: "UTC",
        },
        expires_on: null,
        model_preference: {
          model_id: "model-a",
          reasoning_effort: "low",
        },
      },
      {},
      "zh-CN",
    );

    expect(
      fixture.repository.createWithinOwnerLimit,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        modelId: "model-a",
        reasoningEffort: "low",
      }),
      100,
    );

    const existing = automationRecord();
    fixture.repository.findOwnedRecord.mockResolvedValueOnce(existing);
    fixture.repository.updateOwned.mockResolvedValueOnce(
      automationWithConversation({
        ...existing,
        modelId: "model-b",
        reasoningEffort: "xhigh",
      }),
    );

    await fixture.service.update(
      OWNER_ID,
      AUTOMATION_ID,
      {
        model_preference: {
          model_id: "model-b",
          reasoning_effort: "xhigh",
        },
      },
      {},
    );

    expect(fixture.repository.updateOwned).toHaveBeenCalledWith(
      OWNER_ID,
      AUTOMATION_ID,
      expect.objectContaining({
        modelId: "model-b",
        reasoningEffort: "xhigh",
      }),
    );
  });
});

function automationFixture() {
  const repository = {
    listByOwner: vi.fn(async () => []),
    findById: vi.fn(),
    findOwnedRecord: vi.fn(async () => automationRecord()),
    findOwned: vi.fn(async () => automationWithConversation(automationRecord())),
    listPinnedConversations: vi.fn(async () => []),
    findPinnedConversation: vi.fn(),
    createWithinOwnerLimit: vi.fn(),
    updateOwned: vi.fn(),
    softDeleteOwned: vi.fn(),
    listDue: vi.fn(async () => []),
    latestUnreadCompletion: vi.fn<
      () => Promise<{
        conversationId: string;
        completedAt: Date;
      } | null>
    >(async () => null),
    markCompletionNotificationsRead: vi.fn(async () => undefined),
    claimOccurrence: vi.fn(),
    claimManualRun: vi.fn(),
    markRunStarted: vi.fn(async () => undefined),
    markRunQueued: vi.fn(async () => undefined),
    markRunFailed: vi.fn(async () => undefined),
  };
  const conversations = {
    createPinnedConversation: vi.fn(),
    assertAutomationCompatible: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
    submitScheduledTurn: vi.fn(),
  };
  const audit = { write: vi.fn(async () => undefined) };
  return {
    repository,
    conversations,
    audit,
    service: new AutomationService(
      repository as unknown as AutomationRepository,
      conversations as never,
      audit as never,
      () => NOW,
    ),
  };
}

function automationRecord(
  overrides: Partial<AutomationRecord> = {},
): AutomationRecord {
  return {
    id: AUTOMATION_ID,
    ownerId: OWNER_ID,
    conversationId: CONVERSATION_ID,
    title: "Morning brief",
    instruction: "Summarize important updates.",
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
    nextRunAt: new Date("2026-07-30T01:00:00.000Z"),
    expiresAt: null,
    lastRunAt: null,
    lastRunStatus: null,
    lastErrorCode: null,
    modelId: null,
    reasoningEffort: null,
    deletedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function pinnedConversation(conversationId = CONVERSATION_ID) {
  return {
    id: conversationId,
    ownerId: OWNER_ID,
    title: "Morning brief",
    archiveStatus: "active",
    pinnedAt: NOW,
  };
}

function automationWithConversation(
  record: AutomationRecord,
  conversationId = record.conversationId,
): AutomationWithConversationRecord {
  return {
    ...record,
    conversationId,
    conversation: pinnedConversation(conversationId),
  };
}
