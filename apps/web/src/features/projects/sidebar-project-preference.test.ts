import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  readSidebarProjectOpen,
  rememberSidebarProjectOpen,
  sidebarProjectStorageKey,
} from "./sidebar-project-preference"

describe("sidebar project preference", () => {
  beforeEach(() => window.localStorage.clear())
  afterEach(() => vi.restoreAllMocks())

  it("defaults to expanded and persists both choices independently per user and project", () => {
    expect(readSidebarProjectOpen("first", "work")).toBe(true)
    rememberSidebarProjectOpen("first", "work", false)
    expect(readSidebarProjectOpen("first", "work")).toBe(false)
    expect(readSidebarProjectOpen("first", "personal")).toBe(true)
    expect(readSidebarProjectOpen("second", "work")).toBe(true)
    rememberSidebarProjectOpen("first", "work", true)
    expect(readSidebarProjectOpen("first", "work")).toBe(true)
  })

  it.each(["bad-json", "null", "0", '"false"', "{}", "[]"])(
    "ignores malformed stored preferences: %s",
    (raw) => {
      window.localStorage.setItem(
        sidebarProjectStorageKey("first", "work"),
        raw
      )
      expect(readSidebarProjectOpen("first", "work")).toBe(true)
    }
  )

  it("handles unavailable storage without blocking the sidebar", () => {
    vi.spyOn(window.localStorage, "getItem").mockImplementation(() => {
      throw new Error("blocked")
    })
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new Error("full")
    })
    expect(readSidebarProjectOpen("first", "work")).toBe(true)
    expect(() =>
      rememberSidebarProjectOpen("first", "work", false)
    ).not.toThrow()
  })
})
