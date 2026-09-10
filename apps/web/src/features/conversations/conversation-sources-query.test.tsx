import { type ReactNode } from "react"
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query"
import { act, renderHook, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { apiRequest } from "@/api/client"
import {
  conversationSourcesQueryKey,
  conversationSourcesQueryOptions,
} from "./conversation-sources-query"

vi.mock("@/api/client", () => ({ apiRequest: vi.fn() }))
afterEach(() => vi.clearAllMocks())

function fixture(id = "task-1") {
  const client = new QueryClient()
  const hook = renderHook(
    ({ taskId }) => useQuery(conversationSourcesQueryOptions(taskId, "scope")),
    {
      initialProps: { taskId: id },
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    }
  )
  return { ...hook, client }
}

describe("task sources query", () => {
  it("keeps a new task idle without requesting sources", () => {
    const client = new QueryClient()
    const { result, unmount } = renderHook(
      () => useQuery(conversationSourcesQueryOptions(undefined)),
      {
        wrapper: ({ children }: { children: ReactNode }) => (
          <QueryClientProvider client={client}>{children}</QueryClientProvider>
        ),
      }
    )
    expect(result.current.fetchStatus).toBe("idle")
    expect(result.current.data).toBeUndefined()
    expect(apiRequest).not.toHaveBeenCalled()
    unmount()
  })
  it("retains sources during a revision refresh but clears them when the thread changes", async () => {
    const client = new QueryClient()
    vi.mocked(apiRequest)
      .mockResolvedValueOnce({
        items: [{ url: "https://first.test/", title: "First" }],
      })
      .mockImplementation(() => new Promise(() => undefined))
    const { result, rerender, unmount } = renderHook(
      ({ scope, revision }) =>
        useQuery(conversationSourcesQueryOptions("task-1", scope, revision)),
      {
        initialProps: { scope: "thread-1", revision: "event-1" },
        wrapper: ({ children }: { children: ReactNode }) => (
          <QueryClientProvider client={client}>{children}</QueryClientProvider>
        ),
      }
    )
    await waitFor(() => expect(result.current.data?.items).toHaveLength(1))
    rerender({ scope: "thread-1", revision: "event-2" })
    expect(result.current.isPlaceholderData).toBe(true)
    expect(result.current.data?.items[0]?.title).toBe("First")
    await waitFor(() => expect(apiRequest).toHaveBeenCalledTimes(2))
    rerender({ scope: "thread-2", revision: "event-3" })
    expect(result.current.data).toBeUndefined()
    await waitFor(() => expect(apiRequest).toHaveBeenCalledTimes(3))
    unmount()
  })
  it("fetches the full summary independently of loaded bodies and refreshes on completion invalidation", async () => {
    vi.mocked(apiRequest)
      .mockResolvedValueOnce({
        items: [{ url: "https://historical.test", title: "Historical" }],
      })
      .mockResolvedValueOnce({
        items: [
          { url: "https://historical.test", title: "Historical" },
          { url: "https://new.test", title: "New reply" },
        ],
      })
    const { result, client, unmount } = fixture()
    await waitFor(() => expect(result.current.data?.items).toHaveLength(1))
    expect(apiRequest).toHaveBeenCalledWith(
      "/conversations/task-1/sources",
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    )
    await act(() =>
      client.invalidateQueries({
        queryKey: conversationSourcesQueryKey("task-1"),
      })
    )
    await waitFor(() => expect(result.current.data?.items).toHaveLength(2))
    unmount()
  })
  it("clears previous task sources and cancels a pending request on task switch", async () => {
    let signal: AbortSignal | undefined
    vi.mocked(apiRequest)
      .mockImplementationOnce((_url, options) => {
        signal = options?.signal
        return new Promise(() => undefined)
      })
      .mockResolvedValueOnce({
        items: [{ url: "https://second.test", title: "Second task" }],
      })
    const { result, rerender, unmount } = fixture()
    await waitFor(() => expect(signal).toBeDefined())
    rerender({ taskId: "task-2" })
    expect(signal?.aborted).toBe(true)
    expect(result.current.data).toBeUndefined()
    await waitFor(() =>
      expect(result.current.data?.items[0]?.title).toBe("Second task")
    )
    unmount()
  })
  it("allows an explicit retry after failure without repeated requests", async () => {
    vi.mocked(apiRequest)
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ items: [] })
    const { result, unmount } = fixture()
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(apiRequest).toHaveBeenCalledOnce()
    await act(() => result.current.refetch())
    await waitFor(() => expect(result.current.data?.items).toEqual([]))
    unmount()
  })
})
