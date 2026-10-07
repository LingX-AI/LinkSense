import { describe, expect, it } from "vitest";

import {
  automationCompletionNotificationSchema,
  automationCreateInputSchema,
  automationModelPreferenceSchema,
  automationScheduleSchema,
  automationSchema,
  automationUpdateInputSchema,
  errorCatalog,
} from "../src/index.js";

const CONVERSATION_ID = "10000000-0000-4000-8000-000000000001";

describe("automation contracts", () => {
  it.each([
    {
      frequency: "hourly",
      interval: 2,
      minute: 15,
      time_zone: "Asia/Shanghai",
    },
    {
      frequency: "daily",
      interval: 1,
      time: "09:00",
      time_zone: "Asia/Shanghai",
    },
    {
      frequency: "weekly",
      interval: 1,
      weekdays: [1, 3, 5],
      time: "09:00",
      time_zone: "Asia/Shanghai",
    },
    {
      frequency: "monthly",
      interval: 1,
      day_of_month: 31,
      time: "09:00",
      time_zone: "Asia/Shanghai",
    },
    {
      frequency: "yearly",
      interval: 1,
      month_of_year: 2,
      day_of_month: 29,
      time: "09:00",
      time_zone: "Asia/Shanghai",
    },
  ])("accepts the $frequency custom cadence", (schedule) => {
    expect(automationScheduleSchema.parse(schedule)).toEqual(schedule);
  });

  it("supports either a pinned existing task or a one-time new task", () => {
    const common = {
      title: "Morning brief",
      instruction: "Summarize important updates.",
      schedule: {
        frequency: "daily" as const,
        interval: 1,
        time: "09:00",
        time_zone: "Asia/Shanghai",
      },
    };

    const existingTask = automationCreateInputSchema.parse({
        ...common,
        target: {
          mode: "existing_task",
          conversation_id: CONVERSATION_ID,
        },
      });
    expect(existingTask.target).toEqual({
      mode: "existing_task",
      conversation_id: CONVERSATION_ID,
    });
    expect(existingTask.expires_on).toBeNull();
    expect(
      automationCreateInputSchema.parse({
        ...common,
        target: { mode: "new_task" },
      }).target,
    ).toEqual({ mode: "new_task" });
  });

  it("accepts a valid optional expiration date and rejects invalid calendar dates", () => {
    const input = {
      title: "Morning brief",
      instruction: "Summarize important updates.",
      target: { mode: "new_task" as const },
      schedule: {
        frequency: "daily" as const,
        interval: 1,
        time: "09:00",
        time_zone: "Asia/Shanghai",
      },
    };

    expect(
      automationCreateInputSchema.parse({
        ...input,
        expires_on: "2026-08-31",
      }).expires_on,
    ).toBe("2026-08-31");
    expect(
      automationCreateInputSchema.safeParse({
        ...input,
        expires_on: "2026-02-30",
      }).success,
    ).toBe(false);
  });

  it("rejects duplicate weekdays, invalid dates, and empty updates", () => {
    expect(
      automationScheduleSchema.safeParse({
        frequency: "weekly",
        interval: 1,
        weekdays: [1, 1],
        time: "09:00",
        time_zone: "UTC",
      }).success,
    ).toBe(false);
    expect(
      automationScheduleSchema.safeParse({
        frequency: "yearly",
        interval: 1,
        month_of_year: 4,
        day_of_month: 31,
        time: "09:00",
        time_zone: "UTC",
      }).success,
    ).toBe(false);
    expect(automationUpdateInputSchema.safeParse({}).success).toBe(false);
  });

  it("validates completion notification state and rejects invalid timestamps", () => {
    const completedAt = "2026-07-31T01:02:03.000Z";
    const conversationId = "30000000-0000-4000-8000-000000000001";
    expect(
      automationCompletionNotificationSchema.parse({
        latest_unread: {
          conversation_id: conversationId,
          completed_at: completedAt,
        },
      }),
    ).toEqual({
      latest_unread: {
        conversation_id: conversationId,
        completed_at: completedAt,
      },
    });
    expect(
      automationCompletionNotificationSchema.parse({ latest_unread: null }),
    ).toEqual({ latest_unread: null });
    expect(
      automationCompletionNotificationSchema.safeParse({
        latest_unread: {
          conversation_id: conversationId,
          completed_at: "not-a-timestamp",
        },
      }).success,
    ).toBe(false);
    expect(
      automationCompletionNotificationSchema.safeParse({
        latest_unread: {
          conversation_id: "not-a-task-id",
          completed_at: completedAt,
        },
      }).success,
    ).toBe(false);
  });

  it("publishes stable task-boundary errors", () => {
    expect(errorCatalog.AUTOMATION_TASK_NOT_PINNED.http_status).toBe(422);
    expect(errorCatalog.AUTOMATION_TASK_IN_USE.http_status).toBe(409);
    expect(errorCatalog.AUTOMATION_EMPTY_RESULT).toMatchObject({
      message_key: "errors.automation.emptyResult",
      http_status: 502,
    });
    expect(errorCatalog.AUTOMATION_EXPIRED).toMatchObject({
      message_key: "errors.automation.expired",
      http_status: 409,
    });
  });

  it("accepts an optional model_preference override on create and update", () => {
    const base = {
      title: "Morning brief",
      instruction: "Summarize important updates.",
      target: { mode: "new_task" as const },
      schedule: {
        frequency: "daily" as const,
        interval: 1,
        time: "09:00",
        time_zone: "Asia/Shanghai",
      },
    };

    expect(
      automationCreateInputSchema.parse({
        ...base,
        model_preference: {
          model_id: "model-a",
          reasoning_effort: "high",
        },
      }).model_preference,
    ).toEqual({
      model_id: "model-a",
      reasoning_effort: "high",
    });
    expect(
      automationCreateInputSchema.parse(base).model_preference,
    ).toBeNull();
    expect(
      automationUpdateInputSchema.safeParse({
        model_preference: {
          model_id: "model-b",
          reasoning_effort: "low",
        },
      }).success,
    ).toBe(true);
    expect(
      automationUpdateInputSchema.safeParse({
        model_preference: { model_id: "model-c" },
      }).success,
    ).toBe(false);
  });

  it("round-trips model_preference through the automation schema", () => {
    expect(
      automationModelPreferenceSchema.parse({
        model_id: "model-a",
        reasoning_effort: "medium",
      }),
    ).toEqual({
      model_id: "model-a",
      reasoning_effort: "medium",
    });
    expect(automationModelPreferenceSchema.parse(null)).toBeNull();
    const parsed = automationSchema.parse({
      id: "20000000-0000-4000-8000-000000000001",
      title: "Morning brief",
      instruction: "Summarize important updates.",
      status: "active",
      conversation: {
        id: CONVERSATION_ID,
        title: "Morning brief",
        pinned_at: "2026-07-30T00:00:00.000Z",
      },
      schedule: {
        frequency: "daily",
        interval: 1,
        time: "09:00",
        time_zone: "UTC",
      },
      next_run_at: null,
      expires_on: null,
      last_run_at: null,
      last_run_status: null,
      last_error_code: null,
      model_preference: {
        model_id: "model-a",
        reasoning_effort: "high",
      },
      created_at: "2026-07-30T00:00:00.000Z",
      updated_at: "2026-07-30T00:00:00.000Z",
    });
    expect(parsed.model_preference).toEqual({
      model_id: "model-a",
      reasoning_effort: "high",
    });
  });
});
