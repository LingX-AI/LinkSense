import { act, cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { useGoalClockNow } from "@/features/conversations/conversation-goal-clock"

function ClockValue({ label }: { label: string }) {
  const nowMs = useGoalClockNow(true)
  return <output aria-label={label}>{nowMs}</output>
}

describe("conversation Goal clock", () => {
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it("publishes one shared second snapshot to every Goal timer", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-08-06T08:00:24.000Z"))
    const view = render(
      <>
        <ClockValue label="card clock" />
        <ClockValue label="processed clock" />
      </>
    )

    expect(screen.getByLabelText("card clock")).toHaveTextContent(
      String(Date.parse("2026-08-06T08:00:24.000Z"))
    )
    expect(screen.getByLabelText("processed clock")).toHaveTextContent(
      screen.getByLabelText("card clock").textContent ?? ""
    )

    act(() => vi.advanceTimersByTime(1_000))

    expect(screen.getByLabelText("processed clock")).toHaveTextContent(
      screen.getByLabelText("card clock").textContent ?? ""
    )
    expect(screen.getByLabelText("card clock")).toHaveTextContent(
      String(Date.parse("2026-08-06T08:00:25.000Z"))
    )

    view.unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
})
