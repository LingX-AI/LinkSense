// @vitest-environment node
import { describe, expect, it } from "vitest"
import {
  creditQuotaInputToCreditLimit,
  creditLimitToCreditQuotaInput,
  formatRemainingCredits,
} from "@/lib/credit-quota"
describe("credit quota inputs", () => {
  it("uses decimal credits directly and represents unlimited as blank", () => {
    expect(creditLimitToCreditQuotaInput(null)).toBe("")
    expect(creditLimitToCreditQuotaInput("1.230000")).toBe("1.23")
    expect(creditLimitToCreditQuotaInput("500000")).toBe("500000")
    expect(creditQuotaInputToCreditLimit(" ")).toBeNull()
    expect(creditQuotaInputToCreditLimit("0.000001")).toBe("0.000001")
    expect(creditQuotaInputToCreditLimit("12.5")).toBe("12.5")
  })
  it.each(["0", "-1", "1e5", "0.0000001", "9223372036854.775808"])(
    "rejects invalid quota %s",
    (value) => {
      expect(() => creditQuotaInputToCreditLimit(value)).toThrow()
    }
  )
})

describe("remaining credit display", () => {
  it.each(["zh-CN", "en-US"] as const)(
    "truncates decimals without rounding in %s",
    (language) => {
      expect(formatRemainingCredits("12.999999", language)).toBe("12")
      expect(formatRemainingCredits("0.999999", language)).toBe("0")
      expect(formatRemainingCredits("0", language)).toBe("0")
      expect(formatRemainingCredits("1000.000001", language)).toBe("1,000")
      expect(formatRemainingCredits("9223372036854.775807", language)).toBe(
        "9,223,372,036,854"
      )
      expect(formatRemainingCredits(null, language)).toBe("-")
      expect(formatRemainingCredits("invalid", language)).toBe("-")
      expect(creditQuotaInputToCreditLimit("12.999999")).toBe("12.999999")
    }
  )
})
