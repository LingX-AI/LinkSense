import { StrictMode } from "react"
import { act, cleanup, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { useActivitySummary } from "@/features/conversations/use-activity-summary"

describe("useActivitySummary", () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  function setup() {
    return renderHook(
      ({ key, text, deferred }) =>
        useActivitySummary({ key, label: text, running: deferred }, deferred)
          .label,
      {
        initialProps: { key: "thinking", text: "Thinking", deferred: true },
        wrapper: StrictMode,
      }
    )
  }

  it("shows the initial status immediately and holds it for one second", () => {
    const { result, rerender } = setup()
    expect(result.current).toBe("Thinking")
    act(() => vi.advanceTimersByTime(200))
    rerender({ key: "tool-a", text: "Searching", deferred: true })
    act(() => vi.advanceTimersByTime(799))
    expect(result.current).toBe("Thinking")
    act(() => vi.advanceTimersByTime(1))
    expect(result.current).toBe("Searching")
  })

  it("coalesces intermediate states without postponing the display deadline", () => {
    const { result, rerender } = setup()
    act(() => vi.advanceTimersByTime(100))
    rerender({ key: "tool-a", text: "Searching", deferred: true })
    act(() => vi.advanceTimersByTime(400))
    rerender({ key: "thinking", text: "Thinking", deferred: true })
    act(() => vi.advanceTimersByTime(400))
    rerender({ key: "tool-b", text: "Reading", deferred: true })
    act(() => vi.advanceTimersByTime(100))
    expect(result.current).toBe("Reading")
    act(() => vi.advanceTimersByTime(2_000))
    expect(result.current).toBe("Reading")
  })

  it("updates content of the displayed activity immediately", () => {
    const { result, rerender } = setup()
    rerender({ key: "thinking", text: "Reviewing the results", deferred: true })
    expect(result.current).toBe("Reviewing the results")
  })

  it("retains the latest displayed text while waiting to switch to another activity", () => {
    const { result, rerender } = setup()
    rerender({ key: "thinking", text: "Reviewing the results", deferred: true })
    act(() => vi.advanceTimersByTime(200))
    rerender({ key: "tool-a", text: "Searching", deferred: true })
    expect(result.current).toBe("Reviewing the results")
    act(() => vi.advanceTimersByTime(800))
    expect(result.current).toBe("Searching")
  })

  it("retains matching details with a held tool label after streamed detail updates", () => {
    const { result, rerender } = renderHook(
      ({ key, label, detail }) =>
        useActivitySummary({ key, label, detail, running: true }, true),
      { initialProps: { key: "tool", label: "Running", detail: "pnpm" } }
    )
    rerender({ key: "tool", label: "Running", detail: "pnpm test" })
    expect(result.current.detail).toBe("pnpm test")
    rerender({ key: "thinking", label: "Reviewing results", detail: "" })
    expect(result.current).toMatchObject({
      label: "Running",
      detail: "pnpm test",
    })
    act(() => vi.advanceTimersByTime(1_000))
    expect(result.current).toMatchObject({
      label: "Reviewing results",
      detail: "",
    })
  })

  it.each([
    "completed",
    "failed",
    "interrupted",
    "waiting",
    "reconnecting",
    "answering",
  ])("shows %s immediately and cancels pending progress", (status) => {
    const { result, rerender } = setup()
    act(() => vi.advanceTimersByTime(100))
    rerender({ key: "tool-a", text: "Searching", deferred: true })
    rerender({ key: status, text: status, deferred: false })
    expect(result.current).toBe(status)
    expect(vi.getTimerCount()).toBe(0)
    act(() => vi.advanceTimersByTime(5_000))
    expect(result.current).toBe(status)
  })

  it("starts a fresh display period when activity resumes", () => {
    const { result, rerender } = setup()
    rerender({ key: "waiting", text: "Waiting", deferred: false })
    act(() => vi.advanceTimersByTime(5_000))
    rerender({ key: "thinking", text: "Thinking", deferred: true })
    expect(result.current).toBe("Thinking")
    act(() => vi.advanceTimersByTime(100))
    rerender({ key: "tool-a", text: "Searching", deferred: true })
    act(() => vi.advanceTimersByTime(899))
    expect(result.current).toBe("Thinking")
    act(() => vi.advanceTimersByTime(1))
    expect(result.current).toBe("Searching")
  })

  it("does not wait another second after the displayed status has already settled", () => {
    const { result, rerender } = setup()
    act(() => vi.advanceTimersByTime(2_000))
    rerender({ key: "tool-a", text: "Searching", deferred: true })
    act(() => vi.advanceTimersByTime(0))
    expect(result.current).toBe("Searching")
  })

  it("clears the pending timer when the activity row unmounts", () => {
    const { rerender, unmount } = setup()
    rerender({ key: "tool-a", text: "Searching", deferred: true })
    expect(vi.getTimerCount()).toBe(1)
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
})
