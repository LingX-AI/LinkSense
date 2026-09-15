import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  newProjectNavigationState,
  newProjectStorageKey,
  readNewProject,
  readNewTaskSource,
  rememberNewProject,
  withoutNewTaskSource,
} from "./new-project-preference"

const projectId = "80000000-0000-4000-8000-000000000001"

describe("new task project preference", () => {
  beforeEach(() => {
    window.localStorage.clear()
    vi.restoreAllMocks()
  })
  it("persists the last explicit choice per user, including Common workspace", () => {
    rememberNewProject("first", projectId)
    expect(readNewProject("first")).toBe(projectId)
    expect(readNewProject("second")).toBeNull()
    rememberNewProject("first", null)
    expect(readNewProject("first")).toBeNull()
    expect(window.localStorage.getItem(newProjectStorageKey("first"))).toBe(
      "null"
    )
  })
  it.each([
    "bad-json",
    JSON.stringify("invalid-id"),
    JSON.stringify({ projectId }),
  ])("ignores invalid stored data %s", (raw) => {
    window.localStorage.setItem(newProjectStorageKey("first"), raw)
    expect(readNewProject("first")).toBeNull()
  })
  it("does not block task creation when browser storage is disabled", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("disabled")
    })
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("disabled")
    })
    expect(readNewProject("first")).toBeNull()
    expect(() => rememberNewProject("first", projectId)).not.toThrow()
  })
  it("validates and isolates navigation context without discarding other route state", () => {
    const state = {
      ...newProjectNavigationState("first", "task-1"),
      other: true,
    }
    expect(readNewTaskSource(state, "first")).toBe("task-1")
    expect(readNewTaskSource(state, "second")).toBeUndefined()
    expect(
      readNewTaskSource({ newTaskSource: "invalid" }, "first")
    ).toBeUndefined()
    expect(withoutNewTaskSource(state)).toEqual({ other: true })
    expect(newProjectNavigationState("first", "new")).toBeNull()
  })
})
