import { afterEach, describe, expect, it, vi } from "vitest"

import { waitForSseReconnectDelay } from "@/api/sse-reconnect-delay"

describe("SSE reconnect delay", () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it("removes the abort listener when the reconnect timer completes", async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    const addEventListener = vi.spyOn(controller.signal, "addEventListener")
    const removeEventListener = vi.spyOn(
      controller.signal,
      "removeEventListener"
    )

    const pending = waitForSseReconnectDelay(1_000, controller.signal)
    const abortListener = addEventListener.mock.calls[0]?.[1]

    expect(abortListener).toBeTypeOf("function")
    await vi.advanceTimersByTimeAsync(1_000)
    await pending

    expect(removeEventListener).toHaveBeenCalledOnce()
    expect(removeEventListener).toHaveBeenCalledWith("abort", abortListener)
    expect(vi.getTimerCount()).toBe(0)
  })

  it("clears the reconnect timer and listener when aborted", async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    const removeEventListener = vi.spyOn(
      controller.signal,
      "removeEventListener"
    )

    const pending = waitForSseReconnectDelay(1_000, controller.signal)
    controller.abort()
    await pending

    expect(removeEventListener).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it("does not create a timer or listener for an already aborted signal", async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    controller.abort()
    const addEventListener = vi.spyOn(controller.signal, "addEventListener")

    await waitForSseReconnectDelay(1_000, controller.signal)

    expect(addEventListener).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })
})
