import { describe, expect, it } from "vitest"
import {
  formatQuotaAmount,
  quotaChartData,
  quotaPercentage,
  stackedBarRadius,
} from "./personal-quota-data"

describe("personal quota chart data", () => {
  it("rounds only the visible top segment of each stacked bar", () => {
    const point = { series_0: 12, series_1: 0, series_2: 4 }
    const keys = ["series_0", "series_1", "series_2"]

    expect(stackedBarRadius(point, keys, 0)).toBe(0)
    expect(stackedBarRadius(point, keys, 1)).toBe(0)
    expect(stackedBarRadius(point, keys, 2)).toEqual([5, 5, 0, 0])
    expect(stackedBarRadius({ series_0: 12 }, keys, 0)).toEqual([5, 5, 0, 0])
  })

  it("adds tiny charges exactly and zero-fills inactive dates", () => {
    const result = quotaChartData(
      ["2026-09-19", "2026-09-20"],
      [
        { date: "2026-09-20", name: "a", amount: "0.000001" },
        { date: "2026-09-20", name: "a", amount: "0.000002" },
      ],
      "Other"
    )
    expect(result.total).toBe("0.000003")
    expect(result.series[0]).toMatchObject({ amount: "0.000003", share: 100 })
    expect(result.points[0]?.series_0).toBe(0)
    expect(result.points[1]?.series_0).toBe(0.000003)
  })
  it("limits the legend to five series without losing any usage", () => {
    const result = quotaChartData(
      ["2026-09-20"],
      Array.from({ length: 8 }, (_, i) => ({
        date: "2026-09-20",
        name: `model-${i}`,
        amount: String(i + 1),
      })),
      "Other"
    )
    expect(result.total).toBe("36")
    expect(result.series).toHaveLength(5)
    expect(result.series[4]).toMatchObject({ label: "Other", amount: "10" })
  })
  it("handles zero, unlimited and overdrawn quota values", () => {
    expect(quotaPercentage("1", null)).toBeNull()
    expect(quotaPercentage("0", "100")).toBe(0)
    expect(quotaPercentage("150", "100")).toBe(150)
    expect(formatQuotaAmount("9007199254740993.000001", "en-US")).toBe(
      "9,007,199,254,740,993"
    )
  })
  it("rounds display credits without changing accounting values", () => {
    expect(formatQuotaAmount("12610.951119", "zh-CN")).toBe("12,611")
    expect(formatQuotaAmount("3545.108241", "zh-CN")).toBe("3,545")
    expect(formatQuotaAmount("2.80622", "zh-CN")).toBe("3")
    expect(formatQuotaAmount("0.5", "en-US")).toBe("1")
    expect(formatQuotaAmount("0.04", "en-US")).toBe("0")
  })
})
