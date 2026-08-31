import { describe, expect, it } from "vitest";

import {
  automationExpirationAt,
  automationExpirationOn,
  isAutomationExpired,
  minutesToTimeOfDay,
  nextAutomationRunBeforeExpiration,
  nextAutomationRunAt,
  normalizeAutomationSchedule,
  timeOfDayToMinutes,
} from "../src/modules/automations/schedule.js";

describe("automation recurrence", () => {
  it("runs an hourly cadence at the selected minute", () => {
    const anchor = new Date("2026-07-30T02:10:00.000Z");
    const first = nextAutomationRunAt(
      {
        frequency: "hourly",
        interval: 2,
        minute: 15,
        time_zone: "Asia/Shanghai",
      },
      anchor,
      anchor,
    );
    const second = nextAutomationRunAt(
      {
        frequency: "hourly",
        interval: 2,
        minute: 15,
        time_zone: "Asia/Shanghai",
      },
      anchor,
      first,
    );

    expect(first.toISOString()).toBe("2026-07-30T02:15:00.000Z");
    expect(second.toISOString()).toBe("2026-07-30T04:15:00.000Z");
  });

  it("uses the selected local time for a daily cadence", () => {
    const anchor = new Date("2026-07-30T00:00:00.000Z");
    const next = nextAutomationRunAt(
      {
        frequency: "daily",
        interval: 1,
        time: "09:00",
        time_zone: "Asia/Shanghai",
      },
      anchor,
      anchor,
    );

    expect(next.toISOString()).toBe("2026-07-30T01:00:00.000Z");
  });

  it("sorts weekdays and selects the next enabled weekday", () => {
    const schedule = normalizeAutomationSchedule({
      frequency: "weekly",
      interval: 1,
      weekdays: [5, 1, 3],
      time: "09:00",
      time_zone: "Asia/Shanghai",
    });
    const next = nextAutomationRunAt(
      schedule,
      new Date("2026-07-28T02:00:00.000Z"),
      new Date("2026-07-28T02:00:00.000Z"),
    );

    expect(schedule).toMatchObject({ weekdays: [1, 3, 5] });
    expect(next.toISOString()).toBe("2026-07-29T01:00:00.000Z");
  });

  it("skips months that do not contain the selected day", () => {
    const next = nextAutomationRunAt(
      {
        frequency: "monthly",
        interval: 1,
        day_of_month: 31,
        time: "09:00",
        time_zone: "Asia/Shanghai",
      },
      new Date("2026-04-30T02:00:00.000Z"),
      new Date("2026-04-30T02:00:00.000Z"),
    );

    expect(next.toISOString()).toBe("2026-05-31T01:00:00.000Z");
  });

  it("supports leap-day yearly schedules", () => {
    const next = nextAutomationRunAt(
      {
        frequency: "yearly",
        interval: 1,
        month_of_year: 2,
        day_of_month: 29,
        time: "09:00",
        time_zone: "Asia/Shanghai",
      },
      new Date("2025-03-01T00:00:00.000Z"),
      new Date("2025-03-01T00:00:00.000Z"),
    );

    expect(next.toISOString()).toBe("2028-02-29T01:00:00.000Z");
  });

  it("keeps daily wall-clock time across daylight-saving changes", () => {
    const schedule = {
      frequency: "daily" as const,
      interval: 1,
      time: "09:00",
      time_zone: "America/New_York",
    };
    const anchor = new Date("2026-03-07T12:00:00.000Z");
    const beforeChange = nextAutomationRunAt(schedule, anchor, anchor);
    const afterChange = nextAutomationRunAt(schedule, anchor, beforeChange);

    expect(beforeChange.toISOString()).toBe("2026-03-07T14:00:00.000Z");
    expect(afterChange.toISOString()).toBe("2026-03-08T13:00:00.000Z");
  });
});

describe("automation expiration", () => {
  it("keeps the selected date inclusive in the automation time zone", () => {
    const expiresAt = automationExpirationAt("2026-07-30", "Asia/Shanghai");

    expect(expiresAt.toISOString()).toBe("2026-07-30T16:00:00.000Z");
    expect(automationExpirationOn(expiresAt, "Asia/Shanghai")).toBe(
      "2026-07-30",
    );
    expect(
      isAutomationExpired(expiresAt, new Date("2026-07-30T15:59:59.999Z")),
    ).toBe(false);
    expect(isAutomationExpired(expiresAt, expiresAt)).toBe(true);
  });

  it("does not schedule a run at or after the exclusive expiration boundary", () => {
    const schedule = {
      frequency: "daily" as const,
      interval: 1,
      time: "09:00",
      time_zone: "Asia/Shanghai",
    };
    const anchor = new Date("2026-07-29T00:00:00.000Z");
    const expiresAt = automationExpirationAt("2026-07-30", "Asia/Shanghai");
    const first = nextAutomationRunBeforeExpiration(
      schedule,
      anchor,
      anchor,
      expiresAt,
    );

    expect(first?.toISOString()).toBe("2026-07-29T01:00:00.000Z");
    expect(
      nextAutomationRunBeforeExpiration(
        schedule,
        anchor,
        new Date("2026-07-30T01:00:00.000Z"),
        expiresAt,
      ),
    ).toBeNull();
  });
});

describe("automation time persistence", () => {
  it.each([
    ["00:00", 0],
    ["09:05", 545],
    ["23:59", 1_439],
  ])("round-trips %s", (time, minutes) => {
    expect(timeOfDayToMinutes(time)).toBe(minutes);
    expect(minutesToTimeOfDay(minutes)).toBe(time);
  });
});
