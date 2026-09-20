import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  defaultSidebarTaskSortModes,
  readSidebarTaskSortModes,
  rememberSidebarTaskSortModes,
  sidebarTaskSortStorageKey,
} from "./sidebar-task-sort-preference"

describe("sidebar task sort preference", () => {
  beforeEach(() => window.localStorage.clear())
  afterEach(() => vi.restoreAllMocks())

  it("uses Codex defaults and stores independent choices per user", () => {
    expect(readSidebarTaskSortModes("first")).toEqual(
      defaultSidebarTaskSortModes
    )

    const selected = {
      pinned: "priority",
      projects: "manual",
      recent: "priority",
    } as const
    rememberSidebarTaskSortModes("first", selected)

    expect(readSidebarTaskSortModes("first")).toEqual(selected)
    expect(readSidebarTaskSortModes("second")).toEqual(
      defaultSidebarTaskSortModes
    )
  })

  it.each(["bad-json", "null", "{}", '"manual"'])(
    "ignores malformed stored preferences: %s",
    (raw) => {
      window.localStorage.setItem(sidebarTaskSortStorageKey("first"), raw)
      expect(readSidebarTaskSortModes("first")).toEqual(
        defaultSidebarTaskSortModes
      )
    }
  )

  it("keeps sorting available when browser storage is unavailable", () => {
    vi.spyOn(window.localStorage, "getItem").mockImplementation(() => {
      throw new Error("blocked")
    })
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new Error("full")
    })

    expect(readSidebarTaskSortModes("first")).toEqual(
      defaultSidebarTaskSortModes
    )
    expect(() =>
      rememberSidebarTaskSortModes("first", defaultSidebarTaskSortModes)
    ).not.toThrow()
  })
})
