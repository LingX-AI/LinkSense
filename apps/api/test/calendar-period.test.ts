import dayjs from "dayjs";
import { describe, expect, it } from "vitest";

import { nextCalendarPeriodStart } from "../src/lib/calendar-period.js";

describe("local calendar period boundaries", () => {
  it.each([
    ["2026-03-02", "week", "America/New_York", "2026-03-09T04:00:00.000Z"],
    ["2026-10-26", "week", "America/New_York", "2026-11-02T05:00:00.000Z"],
    ["2026-03-01", "month", "America/New_York", "2026-04-01T04:00:00.000Z"],
    ["2026-11-01", "month", "America/New_York", "2026-12-01T05:00:00.000Z"],
    ["2024-02-01", "month", "Asia/Shanghai", "2024-02-29T16:00:00.000Z"],
    ["2026-12-01", "month", "UTC", "2027-01-01T00:00:00.000Z"],
    ["2026-04-01", "month", "Australia/Lord_Howe", "2026-04-30T13:30:00.000Z"],
  ] as const)("resolves %s + one %s in %s", (start, period, zone, end) => {
    expect(nextCalendarPeriodStart(dayjs.tz(`${start}T00:00:00`, zone), period, zone).toISOString()).toBe(end);
  });

  it.each(["", "invalid"])("rejects an invalid period start: %s", (value) => {
    expect(() => nextCalendarPeriodStart(dayjs(value), "month", "UTC")).toThrow(RangeError);
  });

  it("rejects an unsupported time zone", () => {
    expect(() => nextCalendarPeriodStart(dayjs.utc("2026-01-01"), "month", "Invalid/Zone")).toThrow(RangeError);
  });

  it("keeps adjacent DST months contiguous with no omitted or double-counted hour", () => {
    const zone = "America/New_York";
    const start = dayjs.tz("2026-11-01T00:00:00", zone);
    const end = nextCalendarPeriodStart(start, "month", zone);
    expect(end.valueOf()).toBe(dayjs.tz("2026-12-01T00:00:00", zone).valueOf());
  });
});
