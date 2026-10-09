// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest"
import { createUuid } from "./uuid"

afterEach(() => vi.unstubAllGlobals())

describe("createUuid", () => {
  it("uses the native UUID implementation when available", () => {
    const nativeId = "01234567-89ab-4cde-8f01-23456789abcd"
    const getRandomValues = vi.fn()
    const nativeCrypto = {
      randomUUID() {
        expect(this).toBe(nativeCrypto)
        return nativeId
      },
      getRandomValues,
    }
    vi.stubGlobal("crypto", nativeCrypto)
    expect(createUuid()).toBe(nativeId)
    expect(getRandomValues).not.toHaveBeenCalled()
  })

  it("generates fresh v4 UUIDs from secure random bytes without randomUUID", () => {
    let draw = 0
    const getRandomValues = vi.fn((bytes: Uint8Array) => bytes.fill(draw++))
    vi.stubGlobal("crypto", { getRandomValues })
    expect(createUuid()).toBe("00000000-0000-4000-8000-000000000000")
    expect(createUuid()).toBe("01010101-0101-4101-8101-010101010101")
    expect(getRandomValues).toHaveBeenCalledTimes(2)
    expect(getRandomValues.mock.calls[0]?.[0]).toHaveLength(16)
  })

  it("preserves random bits outside the UUID version and variant fields", () => {
    vi.stubGlobal("crypto", {
      getRandomValues: (bytes: Uint8Array) => bytes.fill(255),
    })
    expect(createUuid()).toBe("ffffffff-ffff-4fff-bfff-ffffffffffff")
  })

  it("propagates secure random generation failures without a weak fallback", () => {
    const error = new Error("Secure randomness unavailable")
    vi.stubGlobal("crypto", {
      getRandomValues: () => {
        throw error
      },
    })
    expect(createUuid).toThrow(error)
  })
})
