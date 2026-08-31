import { describe, expect, it } from "vitest"

import {
  millionTokenQuotaInputToTokenLimit,
  tokenLimitToMillionTokenQuotaInput,
} from "@/lib/token-quota"

describe("token usage unit conversion", () => {
  it("formats stored token counts as million-token usage inputs", () => {
    expect(tokenLimitToMillionTokenQuotaInput(null)).toBe("")
    expect(tokenLimitToMillionTokenQuotaInput("500000")).toBe("0.5")
    expect(tokenLimitToMillionTokenQuotaInput("1000000")).toBe("1")
    expect(tokenLimitToMillionTokenQuotaInput("1200000")).toBe("1.2")
    expect(tokenLimitToMillionTokenQuotaInput("1234567")).toBe("1.234567")
  })

  it("converts million-token usage inputs to stored token counts", () => {
    expect(millionTokenQuotaInputToTokenLimit("")).toBeNull()
    expect(millionTokenQuotaInputToTokenLimit("0.000001")).toBe("1")
    expect(millionTokenQuotaInputToTokenLimit("0.5")).toBe("500000")
    expect(millionTokenQuotaInputToTokenLimit("2")).toBe("2000000")
    expect(millionTokenQuotaInputToTokenLimit("1.234567")).toBe("1234567")
  })

  it("rejects zero and values that cannot map to whole tokens", () => {
    expect(() => millionTokenQuotaInputToTokenLimit("0")).toThrow()
    expect(() => millionTokenQuotaInputToTokenLimit("0.000000")).toThrow()
    expect(() => millionTokenQuotaInputToTokenLimit("0.0000001")).toThrow()
    expect(() => millionTokenQuotaInputToTokenLimit("0.0000010")).toThrow()
    expect(() => millionTokenQuotaInputToTokenLimit("1.2345678")).toThrow()
  })
})
