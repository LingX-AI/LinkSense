import type { PropsWithChildren } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, renderHook, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { ApiError, apiRequest } from "@/api/client"
import { conversationTimelineEventSchema } from "@/api/contracts"
import {
  useInteractiveTaskState,
  refreshesInteractiveTaskState,
} from "./use-interactive-task-state"
vi.mock("@/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/client")>()),
  apiRequest: vi.fn(),
}))
afterEach(() => vi.clearAllMocks())
const starting = {
  status: "starting",
  turn_id: "40000000-0000-4000-8000-000000000001",
  file_ids: [],
  can_submit: false,
  interrupt_requested: false,
}
function setup(enabled = true) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const post = vi.fn()
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  const hook = renderHook(
    () => useInteractiveTaskState({ conversationId: "task", enabled, post }),
    { wrapper }
  )
  return { ...hook, post, client }
}
describe("interactive task state bridge", () => {
  it("publishes restored and live snapshots without submitting work, and deduplicates unchanged reads", async () => {
    vi.mocked(apiRequest).mockResolvedValue(starting)
    const { result, post, unmount, client } = setup()
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith({
        type: "task-state",
        revision: 1,
        state: starting,
      })
    )
    await act(async () => {
      await result.current.getState()
    })
    expect(post).toHaveBeenCalledTimes(1)
    const completed = { ...starting, status: "completed", can_submit: true }
    vi.mocked(apiRequest).mockResolvedValue(completed)
    await act(async () => {
      await result.current.refresh()
    })
    await waitFor(() =>
      expect(post).toHaveBeenLastCalledWith({
        type: "task-state",
        revision: 2,
        state: completed,
      })
    )
    expect(
      vi
        .mocked(apiRequest)
        .mock.calls.every(
          ([path, options]) =>
            path.endsWith("/interactive-task-state") && !options?.method
        )
    ).toBe(true)
    unmount()
    client.clear()
  })
  it("does not read before iframe readiness and permission", async () => {
    const { unmount, client } = setup(false)
    expect(apiRequest).not.toHaveBeenCalled()
    unmount()
    client.clear()
  })
  it("ignores text deltas and refreshes for persisted user input and lifecycle events", () => {
    const event = (type: string) =>
      conversationTimelineEventSchema.parse({
        id: "event",
        conversation_id: "task",
        turn_id: null,
        type,
        payload: {},
        sequence_no: 1,
        created_at: "2026-09-18T00:00:00Z",
      })
    for (const type of [
      "turn/started",
      "turn/completed",
      "conversation.user_input_request.updated",
      "conversation.error",
    ])
      expect(refreshesInteractiveTaskState(event(type))).toBe(true)
    expect(
      refreshesInteractiveTaskState(event("conversation.message.delta"))
    ).toBe(false)
  })
  it("reports an unavailable snapshot and recovers through the same subscription", async () => {
    vi.mocked(apiRequest).mockRejectedValue(
      new ApiError({ status: 403, errorCode: "FORBIDDEN" })
    )
    const { result, post, unmount, client } = setup()
    await waitFor(
      () =>
        expect(post).toHaveBeenCalledWith({
          type: "task-state-error",
          revision: 1,
          error: "FORBIDDEN",
        }),
      { timeout: 2500 }
    )
    vi.mocked(apiRequest).mockResolvedValue(starting)
    await act(async () => {
      await result.current.getState()
    })
    await waitFor(() =>
      expect(post).toHaveBeenLastCalledWith({
        type: "task-state",
        revision: 2,
        state: starting,
      })
    )
    unmount()
    client.clear()
  })
})

it("cancels a pre-admission initial read before publishing the accepted state", async () => {
  let finishOld: (value: unknown) => void = () => undefined
  vi.mocked(apiRequest).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishOld = resolve
      })
  )
  const { result, post, client, unmount } = setup()
  await waitFor(() => expect(apiRequest).toHaveBeenCalled())
  vi.mocked(apiRequest).mockResolvedValue(starting)
  await act(async () => {
    await result.current.refresh()
  })
  await waitFor(() =>
    expect(post).toHaveBeenCalledWith({
      type: "task-state",
      revision: 1,
      state: starting,
    })
  )
  await act(async () => {
    finishOld({ ...starting, status: "idle", can_submit: true })
  })
  expect(post).toHaveBeenCalledTimes(1)
  unmount()
  client.clear()
})
