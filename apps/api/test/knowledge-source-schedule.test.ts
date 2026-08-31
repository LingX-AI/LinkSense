import { describe, expect, it } from "vitest";

import {
  knowledgeSourceScheduleFromRecord,
  knowledgeSourceScheduleToRecord,
  nextKnowledgeSourceSyncAt,
  normalizeKnowledgeSourceSchedule,
} from "../src/modules/knowledge-sources/schedule.js";

describe("knowledge source synchronization recurrence", () => {
  it("uses the selected local time for a daily schedule", () => {
    const anchor = new Date("2026-08-12T00:00:00.000Z");
    const next = nextKnowledgeSourceSyncAt(
      {
        frequency: "daily",
        time: "09:00",
        time_zone: "Asia/Shanghai",
      },
      anchor,
      anchor,
    );

    expect(next.toISOString()).toBe("2026-08-12T01:00:00.000Z");
  });

  it("selects the configured weekday", () => {
    const schedule = normalizeKnowledgeSourceSchedule({
      frequency: "weekly",
      weekday: 3,
      time: "14:35",
      time_zone: "Asia/Shanghai",
    });
    const next = nextKnowledgeSourceSyncAt(
      schedule,
      new Date("2026-08-11T08:00:00.000Z"),
      new Date("2026-08-11T08:00:00.000Z"),
    );

    expect(schedule).toMatchObject({ weekday: 3 });
    expect(next.toISOString()).toBe("2026-08-12T06:35:00.000Z");
  });

  it("skips months that do not contain the configured date", () => {
    const next = nextKnowledgeSourceSyncAt(
      {
        frequency: "monthly",
        day_of_month: 31,
        time: "09:00",
        time_zone: "Asia/Shanghai",
      },
      new Date("2026-04-30T02:00:00.000Z"),
      new Date("2026-04-30T02:00:00.000Z"),
    );

    expect(next.toISOString()).toBe("2026-05-31T01:00:00.000Z");
  });

  it("round-trips normalized persistence fields without legacy intervals", () => {
    const schedule = {
      frequency: "weekly" as const,
      weekday: 4,
      time: "23:59",
      time_zone: "America/New_York",
    };
    const record = knowledgeSourceScheduleToRecord(schedule);

    expect(record).toEqual({
      syncFrequency: "weekly",
      syncTimeOfDayMinutes: 1_439,
      syncTimeZone: "America/New_York",
      syncWeekday: 4,
      syncDayOfMonth: null,
    });
    expect(knowledgeSourceScheduleFromRecord(record)).toEqual(schedule);
  });
});
