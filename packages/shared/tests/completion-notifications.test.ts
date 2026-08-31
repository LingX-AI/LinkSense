import { describe, expect, it } from "vitest";

import { completionNotificationFeedSchema } from "../src/index.js";

const TURN_ID = "10000000-0000-4000-8000-000000000001";
const CONVERSATION_ID = "20000000-0000-4000-8000-000000000001";
const TERMINAL_AT = "2026-08-09T10:00:00.000Z";

describe("completion notification feed contract", () => {
  it("accepts the task identity, title, and actual terminal status", () => {
    expect(
      completionNotificationFeedSchema.parse({
        items: [
          {
            turn_id: TURN_ID,
            conversation_id: CONVERSATION_ID,
            source: "automation",
            task_title: "每日客户跟进",
            status: "failed",
            terminal_at: TERMINAL_AT,
          },
        ],
        next_cursor: `${TERMINAL_AT}|${TURN_ID}`,
      }),
    ).toEqual({
      items: [
        {
          turn_id: TURN_ID,
          conversation_id: CONVERSATION_ID,
          source: "automation",
          task_title: "每日客户跟进",
          status: "failed",
          terminal_at: TERMINAL_AT,
        },
      ],
      next_cursor: `${TERMINAL_AT}|${TURN_ID}`,
    });
  });

  it("rejects non-terminal statuses and obsolete completion-only fields", () => {
    expect(
      completionNotificationFeedSchema.safeParse({
        items: [
          {
            turn_id: TURN_ID,
            conversation_id: CONVERSATION_ID,
            source: "task",
            task_title: "季度分析",
            status: "running",
            terminal_at: TERMINAL_AT,
            completed_at: TERMINAL_AT,
          },
        ],
        next_cursor: `${TERMINAL_AT}|${TURN_ID}`,
      }).success,
    ).toBe(false);
  });
});
