// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest"

import { createRandomUuid } from "./random-uuid"

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("createRandomUuid", () => {
  it("uses fresh secure bytes for RFC UUIDs when HTTP has no native randomUUID", () => {
    let sequence = 0
    const getRandomValues = vi.fn((bytes: Uint8Array): Uint8Array => {
      bytes.fill(++sequence)
      return bytes
    })
    vi.stubGlobal("crypto", { getRandomValues })

    expect(createRandomUuid()).toBe("01010101-0101-4101-8101-010101010101")
    expect(createRandomUuid()).toBe("02020202-0202-4202-8202-020202020202")
    expect(getRandomValues).toHaveBeenCalledTimes(2)
    const first = getRandomValues.mock.calls[0]?.[0]
    const second = getRandomValues.mock.calls[1]?.[0]
    expect(first).toBeInstanceOf(Uint8Array)
    expect(first).toHaveLength(16)
    expect(second).toHaveLength(16)
    expect(first).not.toBe(second)
  })

  it("uses the same secure source even when native randomUUID exists", () => {
    const randomUUID = vi.fn(() => {
      throw new Error("Native UUID generation must not be used")
    })
    const getRandomValues = vi.fn((bytes: Uint8Array): Uint8Array => {
      bytes.fill(255)
      return bytes
    })
    vi.stubGlobal("crypto", { randomUUID, getRandomValues })

    expect(createRandomUuid()).toBe("ffffffff-ffff-4fff-bfff-ffffffffffff")
    expect(getRandomValues).toHaveBeenCalledOnce()
    expect(randomUUID).not.toHaveBeenCalled()
  })

  it.each([undefined, {}, { randomUUID: () => "predictable-native-id" }])(
    "fails closed instead of using weak randomness when the secure source is %j",
    (crypto) => {
      vi.stubGlobal("crypto", crypto)
      expect(createRandomUuid).toThrow(
        "Cryptographically secure random generation is unavailable"
      )
    }
  )

  it("does not conceal a secure entropy source failure", () => {
    const failure = new Error("Entropy source failed")
    vi.stubGlobal("crypto", {
      getRandomValues: () => {
        throw failure
      },
    })
    expect(createRandomUuid).toThrow(failure)
  })
})
