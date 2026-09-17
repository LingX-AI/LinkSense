import { act, cleanup, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  maintenanceNoticeStorageKey,
  rememberDismissedMaintenance,
  useDismissedMaintenance,
} from "./maintenance-notice-preference"

const period = "01900000-0000-7000-8000-000000000001"

describe("maintenance reminder preference", () => {
  beforeEach(() => window.localStorage.clear())
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it("notifies same-tab subscribers and restores the saved period on a new mount", () => {
    const first = renderHook(() => useDismissedMaintenance("admin"))
    const second = renderHook(() => useDismissedMaintenance("admin"))
    expect(first.result.current).toBeNull()
    act(() => expect(rememberDismissedMaintenance("admin", period)).toBe(true))
    expect(first.result.current).toBe(period)
    expect(second.result.current).toBe(period)
    first.unmount()
    second.unmount()
    expect(
      renderHook(() => useDismissedMaintenance("admin")).result.current
    ).toBe(period)
  })

  it("isolates administrators and updates the subscription when the account changes", () => {
    rememberDismissedMaintenance("first", period)
    const view = renderHook(({ userId }) => useDismissedMaintenance(userId), {
      initialProps: { userId: "first" },
    })
    expect(view.result.current).toBe(period)
    view.rerender({ userId: "second" })
    expect(view.result.current).toBeNull()
  })

  it.each(["broken", "null", "{}", "true"])(
    "ignores invalid saved data %s",
    (raw) => {
      window.localStorage.setItem(maintenanceNoticeStorageKey("admin"), raw)
      expect(
        renderHook(() => useDismissedMaintenance("admin")).result.current
      ).toBeNull()
    }
  )

  it("rejects invalid period ids without replacing a valid saved preference", () => {
    rememberDismissedMaintenance("admin", period)
    expect(rememberDismissedMaintenance("admin", "invalid")).toBe(false)
    expect(
      window.localStorage.getItem(maintenanceNoticeStorageKey("admin"))
    ).toBe(period)
  })

  it("does not report success when the browser silently ignores writes", () => {
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => undefined)
    expect(rememberDismissedMaintenance("admin", period)).toBe(false)
  })

  it("continues rendering when storage access is blocked", () => {
    vi.spyOn(window.localStorage, "getItem").mockImplementation(() => {
      throw new Error("Blocked")
    })
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new Error("Blocked")
    })
    expect(
      renderHook(() => useDismissedMaintenance("admin")).result.current
    ).toBeNull()
    expect(rememberDismissedMaintenance("admin", period)).toBe(false)
  })

  it("reacts to cross-tab clearing but ignores session storage events", () => {
    rememberDismissedMaintenance("admin", period)
    const view = renderHook(() => useDismissedMaintenance("admin"))
    act(() => {
      window.localStorage.clear()
      const event = new StorageEvent("storage", { key: null })
      Object.defineProperty(event, "storageArea", {
        value: window.sessionStorage,
      })
      window.dispatchEvent(event)
    })
    expect(view.result.current).toBe(period)
    act(() => {
      const event = new StorageEvent("storage", { key: null })
      Object.defineProperty(event, "storageArea", {
        value: window.localStorage,
      })
      window.dispatchEvent(event)
    })
    expect(view.result.current).toBeNull()
  })
})
