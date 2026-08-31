import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  getAccessToken,
  getStoredAccessSession,
  hasUsableAccessToken,
  restoreAccessTokenFromStorage,
  setAccessToken,
  subscribeToAccessToken,
} from "@/api/session"

const STORAGE_KEY = "linksense.auth.access-session"
const NOW = new Date("2026-07-13T08:00:00.000Z")

function createJwt(expiresAt: Date) {
  const header = btoa(JSON.stringify({ alg: "none", typ: "JWT" }))
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
  const payload = btoa(
    JSON.stringify({
      sub: "user-id",
      exp: Math.floor(expiresAt.getTime() / 1000),
    })
  )
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
  return `${header}.${payload}.signature`
}

function dispatchStorageChange(newValue: string | null) {
  const event = new Event("storage")
  Object.defineProperties(event, {
    key: { value: STORAGE_KEY },
    newValue: { value: newValue },
  })
  window.dispatchEvent(event)
}

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
})
