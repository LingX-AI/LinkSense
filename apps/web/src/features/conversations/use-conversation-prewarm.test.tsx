import { StrictMode } from "react"
import { act, cleanup, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ConversationCollaborationMode } from "@linksense/shared"

import { ApiError } from "@/api/client"
import { useConversationPrewarm } from "./use-conversation-prewarm"

const mocks = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock("@/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/client")>()),
  apiRequest: mocks.request,
}))

const firstId = "71000000-0000-4000-8000-000000000001"
const secondId = "71000000-0000-4000-8000-000000000002"
type Receipt = { accepted: true; conversation_id: string }
const requests: Array<{
  resolve: (receipt: Receipt) => void
  reject: (reason: unknown) => void
}> = []
function input(
  overrides: Partial<Parameters<typeof useConversationPrewarm>[0]> = {}
) {
  return {
    ownerId: "user-1",
    conversationId: undefined,
    scopeKey: "new-page-1",
    collaborationMode: "default" as ConversationCollaborationMode,
    ...overrides,
  }
}
async function resolve(index: number, id = firstId) {
  await act(async () => {
    requests[index]?.resolve({ accepted: true, conversation_id: id })
  })
}
async function reject(index: number, error: unknown) {
  await act(async () => {
    requests[index]?.reject(error)
  })
}
function body(index: number): unknown {
  return mocks.request.mock.calls[index]?.[1].body
}

beforeEach(() => {
  requests.length = 0
  mocks.request.mockReset().mockImplementation(
    () =>
      new Promise<Receipt>((resolve, reject) => {
        requests.push({ resolve, reject })
      })
  )
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe("conversation prewarm scope", () => {
  it("prepares the selected project and never claims another project's receipt", async () => {
    const { result, rerender } = renderHook(useConversationPrewarm, {
      initialProps: input({ projectId: firstId }),
    })
    expect(body(0)).toEqual({
      collaboration_mode: "default",
      project_id: firstId,
    })
    rerender(input({ projectId: secondId }))
    await resolve(1, secondId)
    await resolve(0, firstId)
    expect(result.current.claim()).toBe(secondId)
  })

  it("refreshes visible idle preparation before expiry and stops after claim", async () => {
    vi.useFakeTimers()
    const { result } = renderHook(useConversationPrewarm, {
      initialProps: input(),
    })
    await resolve(0)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60_000)
    })
    expect(requests).toHaveLength(2)
    expect(body(1)).toMatchObject({ conversation_id: firstId })
    await resolve(1)
    expect(result.current.claim()).toBe(firstId)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60_000)
    })
    expect(requests).toHaveLength(2)
  })

  it("does not warm busy tasks and starts when they become idle", () => {
    const { rerender } = renderHook(useConversationPrewarm, {
      initialProps: input({ enabled: false }),
    })
    expect(requests).toHaveLength(0)
    rerender(input({ enabled: true }))
    expect(requests).toHaveLength(1)
  })
  it("keeps the prepared reservation claimable when foreground submission pauses background work", async () => {
    const { result, rerender } = renderHook(useConversationPrewarm, {
      initialProps: input(),
    })
    await resolve(0)
    rerender(input({ enabled: false }))
    expect(requests).toHaveLength(1)
    expect(result.current.claim()).toBe(firstId)
    rerender(input({ enabled: true }))
    expect(requests).toHaveLength(1)
  })
  it("reuses the initial reservation and sends only the latest mode after a pending receipt", async () => {
    const { result, rerender } = renderHook(useConversationPrewarm, {
      initialProps: input(),
    })
    rerender(input({ collaborationMode: "plan" }))
    expect(requests).toHaveLength(1)
    await resolve(0)
    expect(requests).toHaveLength(2)
    expect(body(1)).toEqual({
      conversation_id: firstId,
      collaboration_mode: "plan",
    })
    await resolve(1)
    expect(result.current.claim()).toBe(firstId)
    expect(result.current.claim()).toBeNull()
  })

  it("coalesces a rapid round trip between modes while the initial request is pending", async () => {
    const { result, rerender } = renderHook(useConversationPrewarm, {
      initialProps: input(),
    })
    rerender(input({ collaborationMode: "plan" }))
    rerender(input())
    await resolve(0)
    expect(requests).toHaveLength(1)
    expect(result.current.claim()).toBe(firstId)
  })

  it("ignores a late success from a previous new-task page", async () => {
    const { result, rerender } = renderHook(useConversationPrewarm, {
      initialProps: input(),
    })
    rerender(input({ scopeKey: "new-page-2" }))
    await resolve(1, secondId)
    await resolve(0)
    expect(result.current.claim()).toBe(secondId)
  })

  it("does not let a late failure clear the newer page's receipt or throttling", async () => {
    const { result, rerender } = renderHook(useConversationPrewarm, {
      initialProps: input(),
    })
    const next = input({ scopeKey: "new-page-2" })
    rerender(next)
    await resolve(1, secondId)
    await reject(0, new Error("old request failed"))
    rerender({ ...next })
    expect(requests).toHaveLength(2)
    expect(result.current.claim()).toBe(secondId)
  })

  it("starts exactly one fresh prewarm after an explicit reset of the same page", async () => {
    const { result } = renderHook(useConversationPrewarm, {
      initialProps: input(),
    })
    act(() => result.current.reset())
    expect(requests).toHaveLength(2)
    expect(body(1)).toEqual({ collaboration_mode: "default" })
    await resolve(0)
    await resolve(1, secondId)
    expect(result.current.claim()).toBe(secondId)
  })

  it("keeps one in-flight request through StrictMode effect cleanup and reactivation", async () => {
    const { result } = renderHook(useConversationPrewarm, {
      initialProps: input(),
      wrapper: StrictMode,
    })
    expect(requests).toHaveLength(1)
    await resolve(0)
    expect(result.current.claim()).toBe(firstId)
  })

  it("does not adopt a delayed receipt or queue a mode update after foreground creation claims the page", async () => {
    const { result, rerender } = renderHook(useConversationPrewarm, {
      initialProps: input(),
    })
    expect(result.current.claim()).toBeNull()
    rerender(input({ collaborationMode: "plan" }))
    await resolve(0)
    expect(result.current.claim()).toBeNull()
    expect(requests).toHaveLength(1)
  })

  it("allocates one fresh reservation when an unclaimed reservation has expired", async () => {
    const { result, rerender } = renderHook(useConversationPrewarm, {
      initialProps: input(),
    })
    await resolve(0)
    rerender(input({ collaborationMode: "plan" }))
    await reject(
      1,
      new ApiError({ status: 404, errorCode: "CONVERSATION_NOT_FOUND" })
    )
    expect(body(2)).toEqual({ collaboration_mode: "plan" })
    await resolve(2, secondId)
    expect(result.current.claim()).toBe(secondId)
  })

  it("does not allocate a new reservation when an existing task is missing", async () => {
    const { result } = renderHook(useConversationPrewarm, {
      initialProps: input({ conversationId: firstId }),
    })
    await reject(
      0,
      new ApiError({ status: 404, errorCode: "CONVERSATION_NOT_FOUND" })
    )
    expect(body(0)).toEqual({
      conversation_id: firstId,
      collaboration_mode: "default",
    })
    expect(requests).toHaveLength(1)
    expect(result.current.claim()).toBeNull()
  })

  it.each([
    new ApiError({ status: 503, errorCode: "RUNNER_UNAVAILABLE" }),
    new ApiError({ status: 401, errorCode: "AUTH_REQUIRED" }),
    new Error("network failure"),
  ])(
    "does not automatically retry a prewarm failure or drop a known reservation",
    async (error) => {
      const { result, rerender } = renderHook(useConversationPrewarm, {
        initialProps: input(),
      })
      await resolve(0)
      rerender(input({ collaborationMode: "plan" }))
      await reject(1, error)
      expect(requests).toHaveLength(2)
      expect(result.current.claim()).toBe(firstId)
    }
  )

  it("ignores responses after unmount and does not create an orphan mode update", async () => {
    const { rerender, unmount } = renderHook(useConversationPrewarm, {
      initialProps: input(),
    })
    rerender(input({ collaborationMode: "plan" }))
    unmount()
    await resolve(0)
    expect(requests).toHaveLength(1)
  })

  it("does not request without a signed-in user or share a reservation across accounts", async () => {
    const { result, rerender } = renderHook(useConversationPrewarm, {
      initialProps: input({ ownerId: undefined }),
    })
    expect(requests).toHaveLength(0)
    rerender(input())
    rerender(input({ ownerId: "user-2" }))
    await resolve(1, secondId)
    await resolve(0)
    expect(result.current.claim()).toBe(secondId)
  })
})
