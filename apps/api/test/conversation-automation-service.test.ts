import { describe, expect, it, vi } from "vitest";
import {
  automationToolRequestSchema,
  supportedLocales,
  type Automation,
  type AutomationToolRequest,
} from "@linksense/shared";

import { ConversationAutomationService } from "../src/modules/automations/conversation-service.js";

const ownerId = "10000000-0000-4000-8000-000000000001";
const conversationId = "20000000-0000-4000-8000-000000000001";
const executionConversationId = "20000000-0000-4000-8000-000000000002";
const turnId = "30000000-0000-4000-8000-000000000001";
const automationId = "40000000-0000-4000-8000-000000000001";
const requestId = "50000000-0000-4000-8000-000000000001";
const now = new Date("2026-10-26T01:00:00.000Z");

function fixture() {
  const automation: Automation = {
    id: automationId,
    title: "Morning brief",
    instruction: "Summarize updates.",
    status: "active",
    conversation: {
      id: conversationId,
      title: "Current",
      pinned_at: now.toISOString(),
    },
    schedule: {
      frequency: "daily",
      interval: 1,
      time: "09:00",
      time_zone: "Asia/Shanghai",
    },
    next_run_at: now.toISOString(),
    expires_on: null,
    last_run_at: null,
    last_run_status: null,
    last_error_code: null,
    model_preference: null,
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
  };
  const prisma = {
    user: {
      findUnique: vi.fn(async () => ({
        status: "active",
        preferredLocale: "zh-CN",
      })),
    },
    conversation: {
      findFirst: vi.fn(async () => ({
        id: conversationId,
        title: "Current",
        pinnedAt: null,
        collaborationMode: "default",
      })),
    },
    conversationTurn: { findFirst: vi.fn(async () => ({ id: turnId })) },
  };
  const automations = {
    list: vi.fn(async () => ({ items: [automation] })),
    get: vi.fn(async () => automation),
    listPinnedConversations: vi.fn(async () => ({
      items: [automation.conversation],
    })),
    create: vi.fn(async () => automation),
    update: vi.fn(async () => automation),
    delete: vi.fn(async () => undefined),
    runNow: vi.fn(async () => ({
      status: "queued" as const,
      pending_request_id: turnId,
    })),
  };
  const service = new ConversationAutomationService(
    prisma as never,
    automations,
    () => now,
  );
  const execute = (request: AutomationToolRequest) =>
    service.execute(ownerId, { conversationId, turnId, request }, {});
  return { prisma, automations, automation, execute };
}

describe("conversation automation management", () => {
  it("creates a separate execution task by default without pinning the configuration chat", async () => {
    const f = fixture();
    f.automations.list.mockResolvedValue({ items: [] });
    f.automation.conversation = {
      ...f.automation.conversation,
      id: executionConversationId,
      title: "Morning brief",
    };
    const result = await f.execute(
      automationToolRequestSchema.parse({
        operation: "create",
        request_id: requestId,
        title: f.automation.title,
        instruction: f.automation.instruction,
        schedule: f.automation.schedule,
      }),
    );

    expect(f.automations.create).toHaveBeenCalledWith(
      ownerId,
      expect.objectContaining({ target: { mode: "new_task" } }),
      {},
      "zh-CN",
      expect.objectContaining({ pinTarget: false, allowAdditional: false }),
    );
    expect(result).toMatchObject({
      operation: "create",
      automation: { conversation: { id: executionConversationId } },
    });
  });

  it.each(supportedLocales)(
    "honors an explicitly selected current task with persisted identity and locale %s",
    async (locale) => {
      const f = fixture();
      f.prisma.user.findUnique.mockResolvedValue({
        status: "active",
        preferredLocale: locale,
      });
      const request: AutomationToolRequest = {
        operation: "create",
        request_id: requestId,
        title: "Morning brief",
        instruction: "Summarize updates.",
        target: { mode: "current_task" },
        schedule: f.automation.schedule,
        expires_on: null,
        model_preference: null,
      };
      await f.execute(request);
      await f.execute(request);
      expect(f.automations.create.mock.calls[0]).toEqual(
        f.automations.create.mock.calls[1],
      );
      expect(f.automations.create).toHaveBeenCalledWith(
        ownerId,
        expect.objectContaining({
          target: { mode: "existing_task", conversation_id: conversationId },
        }),
        {},
        locale,
        {
          creationId: expect.stringMatching(/^[0-9a-f-]{36}$/u),
          pinTarget: true,
          allowAdditional: false,
        },
      );
      expect(f.prisma.conversation.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: conversationId,
            ownerId,
            archiveStatus: "active",
            applicationId: null,
          },
        }),
      );
      expect(f.prisma.conversationTurn.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: turnId,
            conversationId,
            submittedBy: ownerId,
            status: "running",
          },
        }),
      );
    },
  );

  it("preserves the explicit new-task target and optional model setting", async () => {
    const f = fixture();
    f.automations.list.mockResolvedValue({ items: [] });
    await f.execute({
      operation: "create",
      request_id: requestId,
      title: "Brief",
      instruction: "Summarize.",
      target: { mode: "new_task" },
      schedule: f.automation.schedule,
      expires_on: null,
      model_preference: null,
    });
    expect(f.automations.create).toHaveBeenCalledWith(
      ownerId,
      expect.objectContaining({
        target: { mode: "new_task" },
        model_preference: null,
      }),
      {},
      "zh-CN",
      expect.objectContaining({ pinTarget: false }),
    );
  });

  it("lists filtered summaries without leaking stored instructions", async () => {
    const f = fixture();
    const result = await f.execute({ operation: "list", query: "BRIEF" });
    expect(result).toMatchObject({
      operation: "list",
      current_task: {
        id: conversationId,
        pinned: false,
        automation_ids: [automationId],
      },
      items: [{ id: automationId }],
    });
    expect(JSON.stringify(result)).not.toContain(f.automation.instruction);
    expect(
      await f.execute({ operation: "list", query: "missing" }),
    ).toMatchObject({
      items: [],
      pinned_tasks: [],
      current_task: { automation_ids: [automationId] },
    });
  });

  it("gets and updates pre-existing records with absent optional settings", async () => {
    const f = fixture();
    expect(
      await f.execute({ operation: "get", automation_id: automationId }),
    ).toEqual({ operation: "get", automation: f.automation });
    await f.execute({
      operation: "update",
      automation_id: automationId,
      changes: { title: "Changed" },
    });
    expect(f.automations.update).toHaveBeenCalledWith(
      ownerId,
      automationId,
      { title: "Changed" },
      {},
      "zh-CN",
      { pinTarget: false },
    );
  });

  it("changes time from the configuration chat while preserving the independent execution task and plan ID", async () => {
    const f = fixture();
    f.automation.conversation = {
      ...f.automation.conversation,
      id: executionConversationId,
      title: "Morning brief",
    };
    expect(await f.execute({ operation: "list" })).toMatchObject({
      current_task: { id: conversationId, pinned: false, automation_ids: [] },
      items: [
        { id: automationId, conversation: { id: executionConversationId } },
      ],
    });
    expect(
      await f.execute({ operation: "get", automation_id: automationId }),
    ).toMatchObject({
      automation: {
        id: automationId,
        conversation: { id: executionConversationId },
      },
    });
    const schedule = { ...f.automation.schedule, time: "19:00" };
    f.automations.update.mockResolvedValueOnce({ ...f.automation, schedule });
    const result = await f.execute({
      operation: "update",
      automation_id: automationId,
      changes: { schedule },
    });
    expect(result).toMatchObject({
      operation: "update",
      automation: {
        id: automationId,
        conversation: { id: executionConversationId },
        schedule: { time: "19:00" },
      },
    });
    expect(f.automations.create).not.toHaveBeenCalled();
    expect(f.automations.update).toHaveBeenCalledWith(
      ownerId,
      automationId,
      { schedule },
      {},
      "zh-CN",
      { pinTarget: false },
    );
  });

  it("does not evade an existing task's automation by creating a separate target", async () => {
    const f = fixture();
    await expect(
      f.execute({
        operation: "create",
        request_id: requestId,
        title: "News at 19:00",
        instruction: f.automation.instruction,
        schedule: f.automation.schedule,
        target: { mode: "new_task" },
        expires_on: null,
        model_preference: null,
      }),
    ).rejects.toMatchObject({ code: "AUTOMATION_TARGET_ALREADY_CONFIGURED" });
    expect(f.automations.create).not.toHaveBeenCalled();
  });

  it("allows another plan only when the caller explicitly requests an additional automation", async () => {
    const f = fixture();
    await f.execute({
      operation: "create",
      request_id: requestId,
      title: "Second brief",
      instruction: "Summarize another topic.",
      schedule: f.automation.schedule,
      target: { mode: "new_task" },
      expires_on: null,
      model_preference: null,
      additional: true,
    });
    expect(f.automations.create).toHaveBeenCalledWith(
      ownerId,
      expect.objectContaining({ title: "Second brief" }),
      {},
      "zh-CN",
      expect.objectContaining({ allowAdditional: true }),
    );
  });

  it.each(["pause", "resume"] as const)(
    "maps %s to schedule status without starting work",
    async (operation) => {
      const f = fixture();
      await f.execute({ operation, automation_id: automationId });
      expect(f.automations.update).toHaveBeenCalledWith(
        ownerId,
        automationId,
        { status: operation === "pause" ? "paused" : "active" },
        {},
        "zh-CN",
      );
      expect(f.automations.runNow).not.toHaveBeenCalled();
    },
  );

  it("rejects resuming an expired plan", async () => {
    const f = fixture();
    f.automation.expires_on = "2026-10-25";
    await expect(
      f.execute({ operation: "resume", automation_id: automationId }),
    ).rejects.toMatchObject({ code: "AUTOMATION_EXPIRED" });
    expect(f.automations.update).not.toHaveBeenCalled();
  });

  it("deletes only the plan and starts immediate work only through runNow", async () => {
    const f = fixture();
    await f.execute({ operation: "delete", automation_id: automationId });
    expect(f.automations.delete).toHaveBeenCalledWith(
      ownerId,
      automationId,
      {},
    );
    expect(
      await f.execute({
        operation: "run_now",
        automation_id: automationId,
        request_id: requestId,
      }),
    ).toEqual({
      operation: "run_now",
      result: { status: "queued", pending_request_id: turnId },
    });
    expect(f.automations.runNow).toHaveBeenCalledWith(
      ownerId,
      automationId,
      requestId,
      {},
    );
    expect(f.automations.update).not.toHaveBeenCalled();
  });

  it.each(["inactive_user", "foreign_task", "inactive_turn", "plan"])(
    "rejects mutation from %s",
    async (condition) => {
      const f = fixture();
      if (condition === "inactive_user")
        f.prisma.user.findUnique.mockResolvedValue({
          status: "disabled",
          preferredLocale: "zh-CN",
        });
      if (condition === "foreign_task")
        f.prisma.conversation.findFirst.mockResolvedValueOnce(null as never);
      if (condition === "inactive_turn")
        f.prisma.conversationTurn.findFirst.mockResolvedValueOnce(
          null as never,
        );
      if (condition === "plan")
        f.prisma.conversation.findFirst.mockResolvedValueOnce({
          id: conversationId,
          title: "Current",
          pinnedAt: null,
          collaborationMode: "plan",
        });
      await expect(
        f.execute({ operation: "delete", automation_id: automationId }),
      ).rejects.toMatchObject({
        code:
          condition === "plan" ? "COLLABORATION_MODE_UNAVAILABLE" : "FORBIDDEN",
      });
      expect(f.automations.delete).not.toHaveBeenCalled();
    },
  );
});
