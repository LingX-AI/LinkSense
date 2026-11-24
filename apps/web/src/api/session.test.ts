import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  captureAccessSessionGuard,
  getAccessToken,
  getStoredAccessSession,
  hasUsableAccessToken,
  readAccessTokenIdentity,
  restoreAccessTokenFromStorage,
  setAccessToken,
  subscribeToAccessToken,
} from "@/api/session"

const STORAGE_KEY = "linksense.auth.access-session"
const NOW = new Date("2026-07-13T08:00:00.000Z")
const USER_ID = "a58c4172-38cb-4f22-9ca4-520c5730672a"

function createJwt(expiresAt: Date, claims: Record<string, unknown> = {}) {
  const header = btoa(JSON.stringify({ alg: "none", typ: "JWT" }))
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
  const payload = btoa(
    JSON.stringify({
      sub: "user-id",
      exp: Math.floor(expiresAt.getTime() / 1000),
      ...claims,
    })
  )
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
  return `${header}.${payload}.signature`
}

function dispatchStorageChange(
  newValue: string | null,
  storageArea = window.localStorage
) {
  const event = new StorageEvent("storage", { key: STORAGE_KEY, newValue })
  Object.defineProperty(event, "storageArea", { value: storageArea })
  window.dispatchEvent(event)
}

describe("access token identity hint", () => {
  const expiresAt = new Date(NOW.getTime() + 60_000)

  it.each(["admin", "user"])(
    "reads a UUID and %s role from the claims",
    (role) => {
      const token = createJwt(expiresAt, { sub: USER_ID, role })

      expect(readAccessTokenIdentity(token)).toEqual({ id: USER_ID, role })
    }
  )

  it.each([
    ["no token", null],
    ["an opaque token", "opaque-access-token"],
    ["a malformed payload", "header.invalid-base64url.signature"],
    [
      "a malformed token",
      `${createJwt(expiresAt, { sub: USER_ID, role: "user" })}.extra`,
    ],
    ["a missing role", createJwt(expiresAt, { sub: USER_ID })],
    ["an unknown role", createJwt(expiresAt, { sub: USER_ID, role: "owner" })],
    [
      "an invalid subject",
      createJwt(expiresAt, { sub: "not-a-uuid", role: "user" }),
    ],
  ])("does not use %s to identify the account", (_label, token) => {
    expect(readAccessTokenIdentity(token)).toBeNull()
  })
})

describe("access token session storage", () => {
  beforeEach(() => {
    setAccessToken(null)
    window.localStorage.clear()
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
  })

  afterEach(() => {
    setAccessToken(null)
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it("persists only the access token and its JWT expiration", () => {
    const expiresAt = new Date(NOW.getTime() + 30 * 60 * 1000)
    const token = createJwt(expiresAt)

    setAccessToken(token)

    expect(
      JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null")
    ).toEqual({
      access_token: token,
      expires_at: expiresAt.getTime(),
    })
    expect(getStoredAccessSession()).toEqual({
      accessToken: token,
      expiresAt: expiresAt.getTime(),
    })
  })

  it("accepts an explicit ISO expiration while keeping existing calls compatible", () => {
    const expiresAt = new Date(NOW.getTime() + 10 * 60 * 1000)

    setAccessToken("opaque-access-token", expiresAt.toISOString())

    expect(getStoredAccessSession()).toEqual({
      accessToken: "opaque-access-token",
      expiresAt: expiresAt.getTime(),
    })

    setAccessToken("legacy-call-access-token")
    expect(getStoredAccessSession()).toEqual({
      accessToken: "legacy-call-access-token",
      expiresAt: NOW.getTime() + 2 * 60 * 60 * 1000,
    })
  })

  it("restores the latest usable token from localStorage", () => {
    const expiresAt = NOW.getTime() + 15 * 60 * 1000
    setAccessToken("stale-token", expiresAt)
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ access_token: "newer-tab-token", expires_at: expiresAt })
    )

    expect(getStoredAccessSession()?.accessToken).toBe("newer-tab-token")
    expect(restoreAccessTokenFromStorage()).toBe("newer-tab-token")
    expect(getAccessToken()).toBe("newer-tab-token")
    expect(hasUsableAccessToken()).toBe(true)
  })

  it("cleans up damaged and expired persisted sessions", () => {
    window.localStorage.setItem(STORAGE_KEY, "not-json")
    expect(getStoredAccessSession()).toBeNull()
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull()

    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        access_token: "expired-token",
        expires_at: NOW.getTime() - 1,
      })
    )
    expect(restoreAccessTokenFromStorage()).toBeNull()
    expect(getAccessToken()).toBeNull()
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull()
    expect(hasUsableAccessToken()).toBe(false)
  })

  it("clears an expired token without broadcasting a user sign-out", () => {
    const listener = vi.fn()
    const unsubscribe = subscribeToAccessToken(listener)
    setAccessToken("short-lived-token", NOW.getTime() + 1_000)
    listener.mockClear()

    vi.advanceTimersByTime(1_000)

    expect(getAccessToken()).toBeNull()
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull()
    expect(listener).not.toHaveBeenCalled()
    unsubscribe()
  })

  it("notifies subscribers when the session is explicitly cleared", () => {
    const listener = vi.fn()
    const unsubscribe = subscribeToAccessToken(listener)
    setAccessToken("active-token", NOW.getTime() + 60_000)
    listener.mockClear()

    setAccessToken(null)

    expect(listener).toHaveBeenCalledWith(null)
    unsubscribe()
  })

  it("synchronizes token changes from other tabs through storage events", () => {
    const expiresAt = NOW.getTime() + 20 * 60 * 1000
    const listener = vi.fn()
    const unsubscribe = subscribeToAccessToken(listener)
    const nextValue = JSON.stringify({
      access_token: "other-tab-token",
      expires_at: expiresAt,
    })
    window.localStorage.setItem(STORAGE_KEY, nextValue)

    dispatchStorageChange(nextValue)

    expect(getAccessToken()).toBe("other-tab-token")
    expect(listener).toHaveBeenLastCalledWith("other-tab-token")

    window.localStorage.removeItem(STORAGE_KEY)
    dispatchStorageChange(null)
    expect(getAccessToken()).toBeNull()
    expect(listener).toHaveBeenLastCalledWith(null)
    unsubscribe()
  })

  it("uses the current stored session when an older update arrives late", () => {
    const expiresAt = NOW.getTime() + 60_000
    const listener = vi.fn()
    const unsubscribe = subscribeToAccessToken(listener)
    const latestSession = JSON.stringify({
      access_token: "latest-tab-token",
      expires_at: expiresAt,
    })
    window.localStorage.setItem(STORAGE_KEY, latestSession)

    try {
      dispatchStorageChange(
        JSON.stringify({
          access_token: "older-tab-token",
          expires_at: expiresAt,
        })
      )
      dispatchStorageChange("older-invalid-session")

      expect(getAccessToken()).toBe("latest-tab-token")
      expect(window.localStorage.getItem(STORAGE_KEY)).toBe(latestSession)
      expect(listener).toHaveBeenCalledExactlyOnceWith("latest-tab-token")
    } finally {
      unsubscribe()
    }
  })

  it.each(["expiry timer", "access token read", "late removal event"])(
    "preserves a newer stored session during %s",
    (trigger) => {
      setAccessToken("short-lived-token", NOW.getTime() + 1_000)
      const listener = vi.fn()
      const unsubscribe = subscribeToAccessToken(listener)
      const latestSession = JSON.stringify({
        access_token: "latest-tab-token",
        expires_at: NOW.getTime() + 60_000,
      })
      window.localStorage.setItem(STORAGE_KEY, latestSession)

      try {
        if (trigger === "expiry timer") {
          vi.advanceTimersByTime(1_000)
        } else {
          vi.setSystemTime(NOW.getTime() + 1_000)
          if (trigger === "late removal event") dispatchStorageChange(null)
        }

        if (trigger !== "access token read") {
          expect(listener).toHaveBeenCalledExactlyOnceWith("latest-tab-token")
        }
        expect(getAccessToken()).toBe("latest-tab-token")
        expect(window.localStorage.getItem(STORAGE_KEY)).toBe(latestSession)
        expect(listener).toHaveBeenCalledExactlyOnceWith("latest-tab-token")
      } finally {
        unsubscribe()
      }
    }
  )

  it("ignores storage events from sessionStorage", () => {
    const expiresAt = NOW.getTime() + 60_000
    const foreignSession = JSON.stringify({
      access_token: "foreign-token",
      expires_at: expiresAt,
    })
    setAccessToken("active-token", expiresAt)

    dispatchStorageChange(foreignSession, window.sessionStorage)

    expect(getAccessToken()).toBe("active-token")
  })

  it("does not throw when localStorage is unavailable", () => {
    const getItem = vi
      .spyOn(window.localStorage, "getItem")
      .mockImplementation(() => {
        throw new DOMException("blocked", "SecurityError")
      })
    const setItem = vi
      .spyOn(window.localStorage, "setItem")
      .mockImplementation(() => {
        throw new DOMException("blocked", "SecurityError")
      })

    expect(() => setAccessToken("memory-only-token")).not.toThrow()
    expect(getAccessToken()).toBe("memory-only-token")
    expect(getStoredAccessSession()).toBeNull()
    expect(restoreAccessTokenFromStorage()).toBe("memory-only-token")
    expect(hasUsableAccessToken()).toBe(true)

    getItem.mockRestore()
    setItem.mockRestore()
  })

  it.each([false, true])(
    "keeps a memory-only session when storage writes fail (previous session: %s)",
    (hadPreviousSession) => {
      if (hadPreviousSession) setAccessToken("previous-token")
      const setItem = vi
        .spyOn(window.localStorage, "setItem")
        .mockImplementation(() => {
          throw new DOMException("storage full", "QuotaExceededError")
        })
      setAccessToken("memory-only-token")
      const isCurrent = captureAccessSessionGuard()

      expect(isCurrent()).toBe(true)
      expect(restoreAccessTokenFromStorage()).toBe("memory-only-token")

      setItem.mockRestore()
      const nextValue = JSON.stringify({
        access_token: "another-tab-token",
        expires_at: NOW.getTime() + 60_000,
      })
      window.localStorage.setItem(STORAGE_KEY, nextValue)
      expect(isCurrent()).toBe(false)
      dispatchStorageChange(nextValue)
      expect(getAccessToken()).toBe("another-tab-token")
    }
  )
})
