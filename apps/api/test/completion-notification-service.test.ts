import { describe, expect, it, vi } from "vitest";

import {
  CompletionNotificationService,
  encodeCompletionNotificationCursor,
  parseCompletionNotificationCursor,
  type CompletionNotificationCursor,
  type CompletionNotificationPosition,
  type CompletionNotificationReplay,
} from "../src/modules/completion-notifications/service.js";

const OWNER_ID = "10000000-0000-4000-8000-000000000001";
const TASK_CONVERSATION_ID = "20000000-0000-4000-8000-000000000001";
const AUTOMATION_CONVERSATION_ID = "20000000-0000-4000-8000-000000000002";
const EMPTY_AUTOMATION_CONVERSATION_ID = "20000000-0000-4000-8000-000000000003";
const TASK_TURN_ID = "30000000-0000-4000-8000-000000000001";
const AUTOMATION_TURN_ID = "30000000-0000-4000-8000-000000000002";
const EMPTY_AUTOMATION_TURN_ID = "30000000-0000-4000-8000-000000000003";
const BASELINE_AT = new Date("2026-08-09T10:00:00.000Z");
const NOW = new Date("2026-08-09T10:00:10.000Z");
const REPLAY_EXPIRES_AT = new Date("2026-08-09T10:02:10.000Z");
const BASELINE_POSITION = {
  terminalAt: BASELINE_AT,
  turnId: TASK_TURN_ID,
};

describe("CompletionNotificationService", () => {
  it("establishes a baseline at the latest terminal turn without replaying history", async () => {
    const fixture = serviceFixture();
    fixture.conversationTurn.findFirst
      .mockResolvedValueOnce({
        id: TASK_TURN_ID,
        completedAt: BASELINE_AT,
      })
      .mockResolvedValueOnce(null);

    await expect(
      fixture.service.list(OWNER_ID, { limit: 100 }),
    ).resolves.toEqual({
      items: [],
      next_cursor: encodedCursor(completionCursor()),
    });
    expect(fixture.conversationTurn.findMany).not.toHaveBeenCalled();
  });

  it("uses a valid epoch cursor when no terminal turn exists", async () => {
    const fixture = serviceFixture();
    fixture.conversationTurn.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);

    const result = await fixture.service.list(OWNER_ID, { limit: 100 });
    const emptyPosition = {
      terminalAt: new Date(0),
      turnId: "00000000-0000-4000-8000-000000000000",
    };

    expect(result.items).toEqual([]);
    expect(parseCompletionNotificationCursor(result.next_cursor)).toEqual({
      baseline: emptyPosition,
      position: emptyPosition,
      nextLane: "forward",
      replay: null,
    });
  });

  it("emits task titles and actual automation outcome statuses", async () => {
    const taskCompletedAt = new Date("2026-08-09T10:00:01.000Z");
    const automationCompletedAt = new Date("2026-08-09T10:00:02.000Z");
    const emptyCompletedAt = new Date("2026-08-09T10:00:03.000Z");
    const finalPosition = position(EMPTY_AUTOMATION_TURN_ID, emptyCompletedAt);
    const fixture = serviceFixture();
    fixture.conversationTurn.findMany
      .mockResolvedValueOnce([
        turn(TASK_TURN_ID, TASK_CONVERSATION_ID, taskCompletedAt),
        turn(
          AUTOMATION_TURN_ID,
          AUTOMATION_CONVERSATION_ID,
          automationCompletedAt,
          "automation:successful",
        ),
        turn(
          EMPTY_AUTOMATION_TURN_ID,
          EMPTY_AUTOMATION_CONVERSATION_ID,
          emptyCompletedAt,
          "automation:empty",
        ),
      ])
      .mockResolvedValueOnce([]);
    fixture.automationRun.findMany.mockResolvedValueOnce([
      {
        id: "40000000-0000-4000-8000-000000000001",
        automationId: "50000000-0000-4000-8000-000000000001",
        conversationId: AUTOMATION_CONVERSATION_ID,
        turnId: AUTOMATION_TURN_ID,
        idempotencyKey: "automation:successful",
        status: "started",
        errorCode: null,
        completedAt: automationCompletedAt,
      },
      {
        id: "40000000-0000-4000-8000-000000000002",
        automationId: "50000000-0000-4000-8000-000000000002",
        conversationId: EMPTY_AUTOMATION_CONVERSATION_ID,
        turnId: null,
        idempotencyKey: "automation:empty",
        status: "failed",
        errorCode: "AUTOMATION_EMPTY_RESULT",
        completedAt: null,
      },
    ]);
    fixture.conversation.findMany.mockResolvedValueOnce([
      { id: TASK_CONVERSATION_ID, title: "季度经营分析" },
      { id: AUTOMATION_CONVERSATION_ID, title: "日报任务会话" },
      { id: EMPTY_AUTOMATION_CONVERSATION_ID, title: "空结果任务会话" },
    ]);
    fixture.automation.findMany.mockResolvedValueOnce([
      {
        id: "50000000-0000-4000-8000-000000000001",
        title: "每日经营日报",
      },
      {
        id: "50000000-0000-4000-8000-000000000002",
        title: "每日空结果检查",
      },
    ]);

    const result = await fixture.service.list(OWNER_ID, {
      cursor: completionCursor(),
      limit: 100,
    });

    expect(result).toEqual({
      items: [
        {
          turn_id: TASK_TURN_ID,
          conversation_id: TASK_CONVERSATION_ID,
          source: "task",
          task_title: "季度经营分析",
          status: "completed",
          terminal_at: taskCompletedAt.toISOString(),
        },
        {
          turn_id: AUTOMATION_TURN_ID,
          conversation_id: AUTOMATION_CONVERSATION_ID,
          source: "automation",
          task_title: "每日经营日报",
          status: "completed",
          terminal_at: automationCompletedAt.toISOString(),
        },
        {
          turn_id: EMPTY_AUTOMATION_TURN_ID,
          conversation_id: EMPTY_AUTOMATION_CONVERSATION_ID,
          source: "automation",
          task_title: "每日空结果检查",
          status: "failed",
          terminal_at: emptyCompletedAt.toISOString(),
        },
      ],
      next_cursor: encodedCursor(
        completionCursor(finalPosition, {
          nextLane: "replay",
          replay: replayState(finalPosition),
        }),
      ),
    });
  });

  it("projects a completed task with a visible missing Plan output error as failed", async () => {
    const planTurnId = "30000000-0000-4000-8000-000000000004";
    const planConversationId = "20000000-0000-4000-8000-000000000004";
    const defaultTurnId = "30000000-0000-4000-8000-000000000005";
    const defaultConversationId = "20000000-0000-4000-8000-000000000005";
    const planCompletedAt = new Date("2026-08-09T10:00:01.000Z");
    const defaultCompletedAt = new Date("2026-08-09T10:00:02.000Z");
    const fixture = serviceFixture();
    fixture.conversationTurn.findMany
      .mockResolvedValueOnce([
        turn(planTurnId, planConversationId, planCompletedAt),
        turn(defaultTurnId, defaultConversationId, defaultCompletedAt),
      ])
      .mockResolvedValueOnce([]);
    fixture.conversationEvent.findMany.mockResolvedValueOnce([
      { turnId: planTurnId },
    ]);
    fixture.conversation.findMany.mockResolvedValueOnce([
      { id: planConversationId, title: "缺少计划输出的任务" },
      { id: defaultConversationId, title: "正常完成的任务" },
    ]);

    const result = await fixture.service.list(OWNER_ID, {
      cursor: completionCursor(),
      limit: 100,
    });

    expect(result.items).toEqual([
      {
        turn_id: planTurnId,
        conversation_id: planConversationId,
        source: "task",
        task_title: "缺少计划输出的任务",
        status: "failed",
        terminal_at: planCompletedAt.toISOString(),
      },
      {
        turn_id: defaultTurnId,
        conversation_id: defaultConversationId,
        source: "task",
        task_title: "正常完成的任务",
        status: "completed",
        terminal_at: defaultCompletedAt.toISOString(),
      },
    ]);
    expect(fixture.conversationEvent.findMany).toHaveBeenCalledWith({
      where: {
        conversationId: {
          in: [planConversationId, defaultConversationId],
        },
        turnId: { in: [planTurnId, defaultTurnId] },
        eventType: "conversation.error",
        visibility: "user_visible",
        payloadJson: {
          path: ["error_code"],
          equals: "PLAN_OUTPUT_MISSING",
        },
      },
      select: { turnId: true },
    });
  });

  it("emits failed and interrupted task statuses in terminal order", async () => {
    const failedAt = new Date("2026-08-09T10:00:01.000Z");
    const interruptedAt = new Date("2026-08-09T10:00:02.000Z");
    const interruptedTurnId = "30000000-0000-4000-8000-000000000004";
    const interruptedConversationId = "20000000-0000-4000-8000-000000000004";
    const finalPosition = position(interruptedTurnId, interruptedAt);
    const fixture = serviceFixture();
    fixture.conversationTurn.findMany
      .mockResolvedValueOnce([
        turn(TASK_TURN_ID, TASK_CONVERSATION_ID, failedAt, null, "failed"),
      ])
      .mockResolvedValueOnce([
        turn(
          interruptedTurnId,
          interruptedConversationId,
          interruptedAt,
          null,
          "interrupted",
        ),
      ]);
    fixture.conversation.findMany.mockResolvedValueOnce([
      { id: TASK_CONVERSATION_ID, title: "失败任务" },
      { id: interruptedConversationId, title: "中断任务" },
    ]);

    const result = await fixture.service.list(OWNER_ID, {
      cursor: completionCursor(),
      limit: 100,
    });

    expect(result.items).toEqual([
      {
        turn_id: TASK_TURN_ID,
        conversation_id: TASK_CONVERSATION_ID,
        source: "task",
        task_title: "失败任务",
        status: "failed",
        terminal_at: failedAt.toISOString(),
      },
      {
        turn_id: interruptedTurnId,
        conversation_id: interruptedConversationId,
        source: "task",
        task_title: "中断任务",
        status: "interrupted",
        terminal_at: interruptedAt.toISOString(),
      },
    ]);
    expect(requiredCursor(result.next_cursor).position).toEqual(finalPosition);
  });

  it("does not expose a turn whose conversation is no longer owned by the submitter", async () => {
    const completedAt = new Date("2026-08-09T10:00:01.000Z");
    const turnPosition = position(TASK_TURN_ID, completedAt);
    const fixture = serviceFixture();
    fixture.conversationTurn.findMany
      .mockResolvedValueOnce([
        turn(TASK_TURN_ID, TASK_CONVERSATION_ID, completedAt),
      ])
      .mockResolvedValueOnce([]);
    fixture.conversation.findMany.mockResolvedValueOnce([]);

    await expect(
      fixture.service.list(OWNER_ID, {
        cursor: completionCursor(),
        limit: 100,
      }),
    ).resolves.toEqual({
      items: [],
      next_cursor: encodedCursor(
        completionCursor(turnPosition, {
          nextLane: "replay",
          replay: replayState(turnPosition),
        }),
      ),
    });
  });

  it("does not misclassify a task when an unrelated failed automation reused its key", async () => {
    const completedAt = new Date("2026-08-09T10:00:01.000Z");
    const fixture = serviceFixture();
    fixture.conversationTurn.findMany
      .mockResolvedValueOnce([
        turn(
          TASK_TURN_ID,
          TASK_CONVERSATION_ID,
          completedAt,
          "shared-request-key",
        ),
      ])
      .mockResolvedValueOnce([]);
    fixture.automationRun.findMany.mockResolvedValueOnce([
      {
        id: "40000000-0000-4000-8000-000000000003",
        automationId: "50000000-0000-4000-8000-000000000003",
        conversationId: TASK_CONVERSATION_ID,
        turnId: null,
        idempotencyKey: "shared-request-key",
        status: "failed",
        errorCode: "AUTOMATION_DISPATCH_FAILED",
        completedAt: null,
      },
    ]);
    fixture.conversation.findMany.mockResolvedValueOnce([
      { id: TASK_CONVERSATION_ID, title: "共享请求键测试" },
    ]);

    const result = await fixture.service.list(OWNER_ID, {
      cursor: completionCursor(),
      limit: 100,
    });

    expect(result.items).toEqual([
      {
        turn_id: TASK_TURN_ID,
        conversation_id: TASK_CONVERSATION_ID,
        source: "task",
        task_title: "共享请求键测试",
        status: "completed",
        terminal_at: completedAt.toISOString(),
      },
    ]);
  });

  it("alternates to replay at limit one even while forward work remains", async () => {
    const highPosition = position(
      AUTOMATION_TURN_ID,
      new Date("2026-08-09T10:00:02.000Z"),
    );
    const forwardPosition = position(
      EMPTY_AUTOMATION_TURN_ID,
      new Date("2026-08-09T10:00:03.000Z"),
    );
    const lateTurnId = "30000000-0000-4000-8000-000000000004";
    const lateConversationId = "20000000-0000-4000-8000-000000000004";
    const lateCompletedAt = new Date("2026-08-09T10:00:01.000Z");
    const replay = replayState(highPosition);
    const fixture = serviceFixture();
    fixture.conversationTurn.findMany
      .mockResolvedValueOnce([
        turn(
          forwardPosition.turnId,
          TASK_CONVERSATION_ID,
          forwardPosition.terminalAt,
        ),
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        turn(lateTurnId, lateConversationId, lateCompletedAt),
      ])
      .mockResolvedValueOnce([]);
    fixture.conversation.findMany
      .mockResolvedValueOnce([{ id: TASK_CONVERSATION_ID, title: "前向任务" }])
      .mockResolvedValueOnce([{ id: lateConversationId, title: "延迟任务" }]);

    const forward = await fixture.service.list(OWNER_ID, {
      cursor: completionCursor(highPosition, {
        nextLane: "forward",
        replay,
      }),
      limit: 1,
    });
    const forwardCursor = requiredCursor(forward.next_cursor);

    expect(forwardCursor).toEqual({
      baseline: BASELINE_POSITION,
      position: forwardPosition,
      nextLane: "replay",
      replay,
    });

    const replayed = await fixture.service.list(OWNER_ID, {
      cursor: forwardCursor,
      limit: 1,
    });

    expect(replayed.items.map((item) => item.turn_id)).toEqual([lateTurnId]);
    expect(fixture.conversationTurn.findMany).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        orderBy: [{ completedAt: "desc" }, { id: "desc" }],
        take: 2,
      }),
    );
  });

  it("paginates a replay generation at limit one without repeating its newest row", async () => {
    const highPosition = position(
      AUTOMATION_TURN_ID,
      new Date("2026-08-09T10:00:02.000Z"),
    );
    const newestLate = turn(
      "30000000-0000-4000-8000-000000000005",
      "20000000-0000-4000-8000-000000000005",
      new Date("2026-08-09T10:00:01.500Z"),
    );
    const oldestLate = turn(
      "30000000-0000-4000-8000-000000000006",
      "20000000-0000-4000-8000-000000000006",
      new Date("2026-08-09T10:00:01.000Z"),
    );
    const fixture = serviceFixture();
    fixture.conversationTurn.findMany
      .mockResolvedValueOnce([newestLate, oldestLate])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([oldestLate])
      .mockResolvedValueOnce([]);
    fixture.conversation.findMany
      .mockResolvedValueOnce([
        { id: newestLate.conversationId, title: "较新延迟任务" },
      ])
      .mockResolvedValueOnce([
        { id: oldestLate.conversationId, title: "较早延迟任务" },
      ]);

    const first = await fixture.service.list(OWNER_ID, {
      cursor: completionCursor(highPosition, {
        nextLane: "replay",
        replay: replayState(highPosition),
      }),
      limit: 1,
    });
    const firstCursor = requiredCursor(first.next_cursor);
    expect(first.items.map((item) => item.turn_id)).toEqual([newestLate.id]);
    expect(firstCursor.replay?.before).toEqual(
      position(newestLate.id, terminalAt(newestLate)),
    );

    const forward = await fixture.service.list(OWNER_ID, {
      cursor: firstCursor,
      limit: 1,
    });
    const forwardCursor = requiredCursor(forward.next_cursor);
    expect(forward.items).toEqual([]);
    expect(forwardCursor.nextLane).toBe("replay");

    const second = await fixture.service.list(OWNER_ID, {
      cursor: forwardCursor,
      limit: 1,
    });
    expect(second.items.map((item) => item.turn_id)).toEqual([oldestLate.id]);
    expect(requiredCursor(second.next_cursor).replay?.before).toEqual(
      highPosition,
    );
  });

  it("runs one final replay pass after expiry and seals the generation", async () => {
    const highPosition = position(
      AUTOMATION_TURN_ID,
      new Date("2026-08-09T10:00:02.000Z"),
    );
    const lateTurn = turn(
      "30000000-0000-4000-8000-000000000007",
      "20000000-0000-4000-8000-000000000007",
      new Date("2026-08-09T10:00:01.000Z"),
    );
    const expiredReplay = replayState(highPosition, {
      before: position(
        "30000000-0000-4000-8000-000000000008",
        new Date("2026-08-09T10:00:00.500Z"),
      ),
      expiresAt: new Date(NOW.getTime() - 1),
    });
    const fixture = serviceFixture();
    fixture.conversationTurn.findMany
      .mockResolvedValueOnce([lateTurn])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    fixture.conversation.findMany.mockResolvedValueOnce([
      { id: lateTurn.conversationId, title: "最终补扫任务" },
    ]);

    const final = await fixture.service.list(OWNER_ID, {
      cursor: completionCursor(highPosition, {
        nextLane: "replay",
        replay: expiredReplay,
      }),
      limit: 1,
    });
    const sealedCursor = requiredCursor(final.next_cursor);

    expect(final.items.map((item) => item.turn_id)).toEqual([lateTurn.id]);
    expect(sealedCursor).toEqual(
      completionCursor(highPosition, { nextLane: "forward", replay: null }),
    );

    const afterSeal = await fixture.service.list(OWNER_ID, {
      cursor: sealedCursor,
      limit: 1,
    });
    expect(afterSeal.items).toEqual([]);
    expect(requiredCursor(afterSeal.next_cursor)).toEqual(sealedCursor);
    expect(fixture.conversationTurn.findMany).toHaveBeenCalledTimes(4);
    expect(fixture.conversationTurn.findMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([
            expect.objectContaining({
              OR: [
                { completedAt: { lt: highPosition.terminalAt } },
                {
                  completedAt: highPosition.terminalAt,
                  id: { lt: highPosition.turnId },
                },
              ],
            }),
          ]),
        }),
      }),
    );
  });

  it("starts a new generation when forward advanced during the old final pass", async () => {
    const oldUpper = position(
      AUTOMATION_TURN_ID,
      new Date("2026-08-09T10:00:02.000Z"),
    );
    const currentPosition = position(
      EMPTY_AUTOMATION_TURN_ID,
      new Date("2026-08-09T10:00:03.000Z"),
    );
    const fixture = serviceFixture();
    fixture.conversationTurn.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const result = await fixture.service.list(OWNER_ID, {
      cursor: completionCursor(currentPosition, {
        nextLane: "replay",
        replay: replayState(oldUpper, {
          expiresAt: new Date(NOW.getTime() - 1),
          final: true,
        }),
      }),
      limit: 1,
    });

    expect(requiredCursor(result.next_cursor)).toEqual(
      completionCursor(currentPosition, {
        nextLane: "forward",
        replay: replayState(currentPosition),
      }),
    );
  });
});

describe("completion notification cursor", () => {
  it("round-trips an active replay generation", () => {
    const highPosition = position(
      AUTOMATION_TURN_ID,
      new Date("2026-08-09T10:00:02.000Z"),
    );
    const cursor = completionCursor(highPosition, {
      nextLane: "replay",
      replay: replayState(highPosition, {
        before: position(TASK_TURN_ID, new Date("2026-08-09T10:00:01.000Z")),
        final: true,
      }),
    });

    expect(parseCompletionNotificationCursor(encodedCursor(cursor))).toEqual(
      cursor,
    );
  });

  it("rejects malformed and internally inconsistent replay cursors", () => {
    const highPosition = position(
      AUTOMATION_TURN_ID,
      new Date("2026-08-09T10:00:02.000Z"),
    );
    const futurePosition = position(
      EMPTY_AUTOMATION_TURN_ID,
      new Date("2026-08-09T10:00:03.000Z"),
    );

    expect(parseCompletionNotificationCursor("not-a-cursor")).toBeNull();
    expect(
      parseCompletionNotificationCursor(
        encodedCursor({
          ...completionCursor(highPosition),
          nextLane: "replay",
        }),
      ),
    ).toBeNull();
    expect(
      parseCompletionNotificationCursor(
        encodedCursor(
          completionCursor(highPosition, {
            nextLane: "replay",
            replay: replayState(futurePosition),
          }),
        ),
      ),
    ).toBeNull();
    expect(
      parseCompletionNotificationCursor(
        encodedCursor(
          completionCursor(highPosition, {
            nextLane: "replay",
            replay: replayState(highPosition, { before: futurePosition }),
          }),
        ),
      ),
    ).toBeNull();
    expect(
      parseCompletionNotificationCursor(
        `v3|${BASELINE_AT.toISOString()}|${TASK_TURN_ID}|${highPosition.terminalAt.toISOString()}|${highPosition.turnId}|replay|${highPosition.terminalAt.toISOString()}|${highPosition.turnId}||||`,
      ),
    ).toBeNull();
  });
});

function completionCursor(
  positionValue: CompletionNotificationPosition = BASELINE_POSITION,
  options: Readonly<{
    nextLane?: "forward" | "replay";
    replay?: CompletionNotificationReplay | null;
  }> = {},
): CompletionNotificationCursor {
  return {
    baseline: BASELINE_POSITION,
    position: positionValue,
    nextLane: options.nextLane ?? "forward",
    replay: options.replay ?? null,
  };
}

function replayState(
  upper: CompletionNotificationPosition,
  options: Readonly<{
    before?: CompletionNotificationPosition;
    expiresAt?: Date;
    final?: boolean;
  }> = {},
): CompletionNotificationReplay {
  return {
    upper,
    before: options.before ?? upper,
    expiresAt: options.expiresAt ?? REPLAY_EXPIRES_AT,
    final: options.final ?? false,
  };
}

function encodedCursor(cursor: CompletionNotificationCursor): string {
  return encodeCompletionNotificationCursor(cursor);
}

function requiredCursor(value: string): CompletionNotificationCursor {
  const cursor = parseCompletionNotificationCursor(value);
  if (!cursor) throw new Error("expected a valid completion cursor");
  return cursor;
}

function position(
  turnId: string,
  terminalAtValue: Date,
): CompletionNotificationPosition {
  return { terminalAt: terminalAtValue, turnId };
}

function turn(
  id: string,
  conversationId: string,
  terminalAtValue: Date,
  idempotencyKey: string | null = null,
  status: "completed" | "failed" | "interrupted" = "completed",
) {
  return {
    id,
    conversationId,
    idempotencyKey,
    status,
    completedAt: status === "interrupted" ? null : terminalAtValue,
    interruptedAt: status === "interrupted" ? terminalAtValue : null,
  };
}

function terminalAt(row: CompletionTurnRow): Date {
  const value =
    row.status === "interrupted" ? row.interruptedAt : row.completedAt;
  if (!value) throw new Error("expected terminal timestamp");
  return value;
}

type CompletionTurnRow = ReturnType<typeof turn>;
type AutomationRunRow = {
  id: string;
  automationId: string;
  conversationId: string;
  turnId: string | null;
  idempotencyKey: string;
  status: string;
  errorCode: string | null;
  completedAt: Date | null;
};
type ConversationRow = { id: string; title: string };
type AutomationRow = { id: string; title: string };
type ConversationEventRow = { turnId: string | null };

function serviceFixture(now = NOW) {
  const conversationTurn = {
    findFirst: vi.fn(),
    findMany: vi.fn<() => Promise<CompletionTurnRow[]>>(async () => []),
  };
  const automationRun = {
    findMany: vi.fn<() => Promise<AutomationRunRow[]>>(async () => []),
  };
  const conversation = {
    findMany: vi.fn<() => Promise<ConversationRow[]>>(async () => []),
  };
  const automation = {
    findMany: vi.fn<() => Promise<AutomationRow[]>>(async () => []),
  };
  const conversationEvent = {
    findMany: vi.fn<() => Promise<ConversationEventRow[]>>(async () => []),
  };
  return {
    conversationTurn,
    automationRun,
    conversation,
    automation,
    conversationEvent,
    service: new CompletionNotificationService(
      {
        conversationTurn,
        automationRun,
        conversation,
        automation,
        conversationEvent,
      } as never,
      () => now,
    ),
  };
}
