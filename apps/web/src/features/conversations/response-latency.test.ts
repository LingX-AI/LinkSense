import { describe, expect, it, vi } from "vitest"
import { ResponseLatencyTracker } from "./response-latency"

describe("response latency", () => {
  it("includes creation and keeps text arriving before its HTTP receipt", () => {
    let time = 10
    const emit = vi.fn()
    const tracker = new ResponseLatencyTracker(emit, () => time)
    tracker.begin("draft", "new_task")
    time = 210
    tracker.move("draft", "task")
    tracker.record("task", "old-turn", "sse_first_text")
    time = 710
    tracker.record("task", "turn", "sse_first_text")
    time = 726
    tracker.record("task", "turn", "ui_first_text_commit")
    expect(emit).not.toHaveBeenCalled()
    time = 800
    tracker.bind("task", "turn")
    expect(
      emit.mock.calls.map(([sample]) => [
        sample.kind,
        sample.stage,
        sample.endedAt - sample.startedAt,
      ])
    ).toEqual([
      ["new_task", "sse_first_text", 700],
      ["new_task", "ui_first_text_commit", 716],
    ])
    tracker.record("task", "turn", "ui_first_text_commit")
    expect(emit).toHaveBeenCalledTimes(2)
  })

  it("measures each follow-up from its own submit and ignores other turns", () => {
    let time = 100
    const emit = vi.fn()
    const tracker = new ResponseLatencyTracker(emit, () => time)
    tracker.begin("task", "follow_up")
    tracker.bind("task", "new")
    tracker.record("task", "old", "ui_first_text_commit")
    time = 200
    tracker.record("task", "new", "ui_first_text_commit")
    expect(emit).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        kind: "follow_up",
        startedAt: 100,
        endedAt: 200,
      })
    )
  })
})
