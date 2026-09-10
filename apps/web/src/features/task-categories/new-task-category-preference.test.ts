import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  newTaskCategoryNavigationState,
  newTaskCategoryStorageKey,
  readNewTaskCategory,
  readNewTaskSource,
  rememberNewTaskCategory,
  withoutNewTaskSource,
} from "./new-task-category-preference"

const categoryId = "80000000-0000-4000-8000-000000000001"

describe("new task category preference", () => {
  beforeEach(() => {
    window.localStorage.clear()
    vi.restoreAllMocks()
  })
  it("persists the last explicit choice per user, including Unclassified", () => {
    rememberNewTaskCategory("first", categoryId)
    expect(readNewTaskCategory("first")).toBe(categoryId)
    expect(readNewTaskCategory("second")).toBeNull()
    rememberNewTaskCategory("first", null)
    expect(readNewTaskCategory("first")).toBeNull()
    expect(
      window.localStorage.getItem(newTaskCategoryStorageKey("first"))
    ).toBe("null")
  })
  it.each([
    "bad-json",
    JSON.stringify("invalid-id"),
    JSON.stringify({ categoryId }),
  ])("ignores invalid stored data %s", (raw) => {
    window.localStorage.setItem(newTaskCategoryStorageKey("first"), raw)
    expect(readNewTaskCategory("first")).toBeNull()
  })
  it("does not block task creation when browser storage is disabled", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("disabled")
    })
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("disabled")
    })
    expect(readNewTaskCategory("first")).toBeNull()
    expect(() => rememberNewTaskCategory("first", categoryId)).not.toThrow()
  })
  it("validates and isolates navigation context without discarding other route state", () => {
    const state = {
      ...newTaskCategoryNavigationState("first", "task-1"),
      other: true,
    }
    expect(readNewTaskSource(state, "first")).toBe("task-1")
    expect(readNewTaskSource(state, "second")).toBeUndefined()
    expect(
      readNewTaskSource({ newTaskSource: "invalid" }, "first")
    ).toBeUndefined()
    expect(withoutNewTaskSource(state)).toEqual({ other: true })
    expect(newTaskCategoryNavigationState("first", "new")).toBeNull()
  })
})
