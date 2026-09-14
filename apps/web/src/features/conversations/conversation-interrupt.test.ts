import { afterEach, describe, expect, it, vi } from "vitest"

import { apiRequest } from "@/api/client"
import {
  conversationInterruptTimeoutMs,
  interruptConversationTurn,
} from "./conversation-interrupt"

vi.mock("@/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/client")>()),
  apiRequest: vi.fn(),
}))

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe("interruptConversationTurn", () => {
  it("bounds a hung request, aborts transport and allows an explicit retry", async () => {
    vi.useFakeTimers()
    vi.mocked(apiRequest).mockImplementationOnce(() => new Promise(() => {}))
    const request = interruptConversationTurn("conversation-1", "turn-1")
    const rejection = expect(request).rejects.toMatchObject({
      errorCode: "TURN_INTERRUPT_REQUEST_FAILED",
    })
    await vi.advanceTimersByTimeAsync(conversationInterruptTimeoutMs)
    await rejection
    expect(vi.mocked(apiRequest).mock.calls[0]?.[1].signal?.aborted).toBe(true)
    expect(apiRequest).toHaveBeenCalledTimes(1)
    vi.mocked(apiRequest).mockResolvedValueOnce({})
    await expect(
      interruptConversationTurn("conversation-1", "turn-1")
    ).resolves.toBeUndefined()
    expect(apiRequest).toHaveBeenCalledTimes(2)
    expect(vi.getTimerCount()).toBe(0)
  })

  it("preserves a server failure without automatically replaying cancellation", async () => {
    const error = new Error("unavailable")
    vi.mocked(apiRequest).mockRejectedValueOnce(error)
    await expect(
      interruptConversationTurn("conversation-1", "turn-1")
    ).rejects.toBe(error)
    expect(apiRequest).toHaveBeenCalledTimes(1)
  })
})
