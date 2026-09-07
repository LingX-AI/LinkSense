// @vitest-environment node

import { describe, expect, it } from "vitest"

import {
  calendarMonthLabels,
  formatCalendarDate,
  formatCompactDuration,
  formatConversationTimeSeparatorParts,
  formatContextualMessageTime,
  formatLongDateTime,
  formatMessageTime,
} from "@/i18n/date"

describe("calendar date formatting", () => {
  it("formats heatmap dates and month labels in both supported languages", () => {
    expect(formatCalendarDate("2026-07-27", "zh-CN")).toBe("2026年7月27日")
    expect(formatCalendarDate("2026-07-27", "en-US")).toBe("Jul 27, 2026")
    expect(calendarMonthLabels("zh-CN")).toHaveLength(12)
    expect(calendarMonthLabels("zh-CN")[0]).toBe("1月")
    expect(calendarMonthLabels("en-US")[11]).toBe("Dec")
  })
})

describe("formatLongDateTime", () => {
  it("formats an archived task timestamp in both supported languages", () => {
    expect(formatLongDateTime("2026-07-22T14:41:00", "zh-CN")).toBe(
      "2026年7月22日，14:41"
    )
    expect(formatLongDateTime("2026-07-22T14:41:00", "en-US")).toBe(
      "Jul 22, 2026, 14:41"
    )
  })

  it.each([undefined, null, "", "not-a-date"])(
    "returns an em dash for missing or invalid input",
    (value) => {
      expect(formatLongDateTime(value, "zh-CN")).toBe("—")
    }
  )
})

describe("formatCompactDuration", () => {
  it.each([
    ["2026-07-11T08:00:00.000Z", "2026-07-11T08:00:00.000Z", null],
    ["2026-07-11T08:00:00.000Z", "2026-07-11T08:00:00.999Z", null],
    ["2026-07-11T08:00:00.000Z", "2026-07-11T08:00:01.000Z", "1s"],
    ["2026-07-11T08:00:00.000Z", "2026-07-11T08:00:03.999Z", "3s"],
    ["2026-07-11T08:00:00.000Z", "2026-07-11T08:01:00.000Z", "1m"],
    ["2026-07-11T08:00:00.000Z", "2026-07-11T08:19:03.999Z", "19m 3s"],
    ["2026-07-11T08:00:00.000Z", "2026-07-11T09:02:03.999Z", "1h 2m 3s"],
    ["2026-07-11T08:00:00.000Z", "2026-07-11T09:00:00.000Z", "1h"],
  ])("formats %s through %s as %s", (startedAt, endedAt, expected) => {
    expect(formatCompactDuration(startedAt, endedAt)).toBe(expected)
  })

  it("uses the supplied current time while a run is still active", () => {
    expect(
      formatCompactDuration(
        "2026-07-11T08:00:00.000Z",
        null,
        Date.parse("2026-07-11T08:00:03.999Z")
      )
    ).toBe("3s")
  })

  it.each([
    [undefined, null, Date.now()],
    [null, null, Date.now()],
    ["", null, Date.now()],
    ["not-a-date", null, Date.now()],
    ["2026-07-11T08:00:00.000Z", "not-a-date", Date.now()],
    ["2026-07-11T08:00:00.000Z", null, Number.NaN],
    ["2026-07-11T08:00:01.000Z", "2026-07-11T08:00:00.000Z", Date.now()],
  ])(
    "returns null for missing, invalid, or reversed input",
    (startedAt, endedAt, nowMs) => {
      expect(formatCompactDuration(startedAt, endedAt, nowMs)).toBeNull()
    }
  )
})

describe("formatMessageTime", () => {
  it.each(["zh-CN", "en-US"] as const)(
    "formats a compact clock time for %s",
    (language) => {
      expect(formatMessageTime("2026-07-11T08:05:00", language)).toBe("08:05")
    }
  )

  it.each([undefined, null, "", "not-a-date"])(
    "returns null for missing or invalid input",
    (value) => {
      expect(formatMessageTime(value, "zh-CN")).toBeNull()
    }
  )
})

describe("formatContextualMessageTime", () => {
  it("shows only the clock time for messages created today", () => {
    expect(
      formatContextualMessageTime(
        "2026-07-11T08:05:00",
        "zh-CN",
        Date.parse("2026-07-11T12:30:00")
      )
    ).toBe("08:05")
  })

  it("shows the date and clock time for older messages", () => {
    expect(
      formatContextualMessageTime(
        "2026-07-10T08:05:00",
        "zh-CN",
        Date.parse("2026-07-11T12:30:00")
      )
    ).toBe("2026-07-10 08:05")
  })

  it.each([undefined, null, "", "not-a-date"])(
    "returns null for missing or invalid input",
    (value) => {
      expect(formatContextualMessageTime(value, "zh-CN")).toBeNull()
    }
  )
})

describe("formatConversationTimeSeparatorParts", () => {
  const now = Date.parse("2026-08-28T12:00:00")

  it("describes timestamps relative to today in Chinese", () => {
    expect(
      formatConversationTimeSeparatorParts("2026-08-28T09:33:00", "zh-CN", now)
    ).toEqual({ kind: "today", time: "9:33" })
    expect(
      formatConversationTimeSeparatorParts("2026-08-27T21:08:00", "zh-CN", now)
    ).toEqual({ kind: "yesterday", time: "21:08" })
  })

  it("formats same-year and cross-year dates for both languages", () => {
    expect(
      formatConversationTimeSeparatorParts("2026-07-11T08:05:00", "zh-CN", now)
    ).toEqual({ kind: "sameYear", date: "7月11日", time: "8:05" })
    expect(
      formatConversationTimeSeparatorParts("2025-12-31T23:50:00", "en-US", now)
    ).toEqual({
      kind: "otherYear",
      date: "Dec 31, 2025",
      time: "23:50",
    })
  })

  it.each([undefined, null, "", "not-a-date"])(
    "returns null for missing or invalid input",
    (value) => {
      expect(
        formatConversationTimeSeparatorParts(value, "zh-CN", now)
      ).toBeNull()
    }
  )
})
