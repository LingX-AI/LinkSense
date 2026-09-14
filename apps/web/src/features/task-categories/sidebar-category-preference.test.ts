import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  readSidebarCategoryOpen,
  rememberSidebarCategoryOpen,
  sidebarCategoryStorageKey,
} from "./sidebar-category-preference"

describe("sidebar category preference", () => {
  beforeEach(() => window.localStorage.clear())
  afterEach(() => vi.restoreAllMocks())

  it("defaults to expanded and persists both choices independently per user and category", () => {
    expect(readSidebarCategoryOpen("first", "work")).toBe(true)
    rememberSidebarCategoryOpen("first", "work", false)
    expect(readSidebarCategoryOpen("first", "work")).toBe(false)
    expect(readSidebarCategoryOpen("first", "personal")).toBe(true)
    expect(readSidebarCategoryOpen("second", "work")).toBe(true)
    rememberSidebarCategoryOpen("first", "work", true)
    expect(readSidebarCategoryOpen("first", "work")).toBe(true)
  })

  it.each(["bad-json", "null", "0", '"false"', "{}", "[]"])(
    "ignores malformed stored preferences: %s",
    (raw) => {
      window.localStorage.setItem(
        sidebarCategoryStorageKey("first", "work"),
        raw
      )
      expect(readSidebarCategoryOpen("first", "work")).toBe(true)
    }
  )

  it("handles unavailable storage without blocking the sidebar", () => {
    vi.spyOn(window.localStorage, "getItem").mockImplementation(() => {
      throw new Error("blocked")
    })
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new Error("full")
    })
    expect(readSidebarCategoryOpen("first", "work")).toBe(true)
    expect(() =>
      rememberSidebarCategoryOpen("first", "work", false)
    ).not.toThrow()
  })
})
