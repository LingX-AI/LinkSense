// @vitest-environment node

import { describe, expect, it } from "vitest"

import {
  allocateUsdMinorUnits,
  formatUsdCost,
  formatUsdMinorUnits,
  formatIntegerCount,
  formatTokenCount,
} from "@/lib/usage-number"

describe("usage number formatting", () => {
  it("keeps task and turn counts as localized full integers", () => {
    expect(formatIntegerCount(12_367, "zh-CN")).toBe("12,367")
    expect(formatIntegerCount("9007199254740993", "en-US")).toBe(
      "9,007,199,254,740,993"
    )
  })

  it("selects K, M, or B for token counts with at most one decimal", () => {
    expect(formatTokenCount("999", "zh-CN")).toBe("999")
    expect(formatTokenCount("1000", "zh-CN")).toBe("1K")
    expect(formatTokenCount("1050", "zh-CN")).toBe("1.1K")
    expect(formatTokenCount("12367", "zh-CN")).toBe("12.4K")
    expect(formatTokenCount("914044", "zh-CN")).toBe("914K")
    expect(formatTokenCount("824872", "en-US")).toBe("824.9K")
    expect(formatTokenCount("1000000", "zh-CN")).toBe("1M")
    expect(formatTokenCount("1250000", "zh-CN")).toBe("1.3M")
    expect(formatTokenCount("1000000000", "en-US")).toBe("1B")
    expect(formatTokenCount("1250000000", "en-US")).toBe("1.3B")
  })

  it("promotes a rounded value to the next available unit", () => {
    expect(formatTokenCount("999949", "zh-CN")).toBe("999.9K")
    expect(formatTokenCount("999950", "zh-CN")).toBe("1M")
    expect(formatTokenCount("999949999", "en-US")).toBe("999.9M")
    expect(formatTokenCount("999950000", "en-US")).toBe("1B")
  })

  it.each(["zh-CN", "en-US"] as const)(
    "formats context tokens using powers of 1024 in %s",
    (language) => {
      expect(formatTokenCount(0, language, 1_024)).toBe("0")
      expect(formatTokenCount(1_000, language, 1_024)).toBe("1,000")
      expect(formatTokenCount(1_023, language, 1_024)).toBe("1,023")
      expect(formatTokenCount(1_024, language, 1_024)).toBe("1K")
      expect(formatTokenCount(1_536, language, 1_024)).toBe("1.5K")
      expect(formatTokenCount(262_144, language, 1_024)).toBe("256K")
      expect(formatTokenCount(1_048_524, language, 1_024)).toBe("1,023.9K")
      expect(formatTokenCount(1_048_525, language, 1_024)).toBe("1M")
      expect(formatTokenCount(1_048_576, language, 1_024)).toBe("1M")
      expect(formatTokenCount("1073741824", language, 1_024)).toBe("1B")
      expect(formatTokenCount(-1, language, 1_024)).toBe("—")
      expect(formatTokenCount("invalid", language, 1_024)).toBe("—")
    }
  )

  it("formats very large token strings without losing integer precision", () => {
    expect(formatTokenCount("9007199254740993", "en-US")).toBe("9,007,199.3B")
  })

  it("returns a placeholder for invalid or negative values", () => {
    expect(formatIntegerCount("invalid", "zh-CN")).toBe("—")
    expect(formatTokenCount(-1, "en-US")).toBe("—")
    expect(formatTokenCount(Number.POSITIVE_INFINITY, "en-US")).toBe("—")
  })

  it("formats all USD costs with exactly two decimal places", () => {
    expect(formatUsdCost("0", "zh-CN")).toBe("$0.00")
    expect(formatUsdCost("12.340000000001", "zh-CN")).toBe("$12.34")
    expect(formatUsdCost("0.004999999999", "en-US")).toBe("$0.00")
    expect(formatUsdCost("0.005", "en-US")).toBe("$0.01")
    expect(formatUsdCost("9007199254740993.125", "en-US")).toBe(
      "$9,007,199,254,740,993.13"
    )
    expect(formatUsdCost("invalid", "zh-CN")).toBe("—")
  })

  it("allocates rounding differences so displayed details equal the total", () => {
    const allocated = allocateUsdMinorUnits(
      ["0.005", "0.005", "0.002"],
      "0.012"
    )

    expect(allocated).toEqual([1n, 0n, 0n])
    expect(allocated?.reduce((sum, amount) => sum + amount, 0n)).toBe(1n)
    expect(
      allocated?.map((amount) => formatUsdMinorUnits(amount, "zh-CN"))
    ).toEqual(["$0.01", "$0.00", "$0.00"])
  })

  it("rejects allocation when detail precision does not match its total", () => {
    expect(allocateUsdMinorUnits(["0.004", "0.004"], "0.009")).toBeNull()
  })
})
