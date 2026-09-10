import { type ReactNode } from "react"
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query"
import { act, renderHook, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { apiRequest } from "@/api/client"
import { conversationSchema } from "@/api/contracts"
import { useConversationHistory } from "@/features/conversations/use-conversation-history"

vi.mock("@/api/client", () => ({ apiRequest: vi.fn() }))
afterEach(() => vi.clearAllMocks())

const index = Array.from({ length: 50 }, (_, i) => ({
  turn_id: `turn-${i + 1}`,
  message_id: `message-${i + 1}`,
  sequence_no: i + 1,
  has_content: true,
  created_at: "2026-09-07T00:00:00Z",
}))
function page(start: number, end: number) {
  const window = index.slice(start - 1, end)
  return conversationSchema.parse({
    id: "task",
    title: "History",
    updated_at: "2026-09-07T00:00:00Z",
    last_event_id: `task:${end}`,
    turns: index.map((item) => ({ id: item.turn_id, status: "completed" })),
    messages: window.map((item) => ({
      id: item.message_id,
      turn_id: item.turn_id,
      role: "user",
      content: `Question ${item.sequence_no}`,
      sequence_no: item.sequence_no,
    })),
    history: {
      scope_id: "turn-1",
      turn_ids: window.map((item) => item.turn_id),
      index,
    },
  })
}
function fixture() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  client.setQueryData(["conversation", "task"], page(31, 50))
  const hook = renderHook(
    () => {
      const query = useQuery({
        queryKey: ["conversation", "task"],
        queryFn: async () => page(31, 50),
        enabled: false,
      })
      return useConversationHistory(query.data)
    },
    {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    }
  )
  return { ...hook, client }
}

describe("history loading", () => {
  it("loads only a requested distant window and deduplicates targets in that same page", async () => {
    let finish: (value: ReturnType<typeof page>) => void = () => undefined
    vi.mocked(apiRequest).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    const { result, client } = fixture()
    expect(apiRequest).not.toHaveBeenCalled()
    let request: Promise<void> | undefined
    act(() => {
      request = result.current.loadTurn("turn-1")
      void result.current.loadTurn("turn-10")
    })
    await waitFor(() => expect(apiRequest).toHaveBeenCalledOnce())
    expect(apiRequest).toHaveBeenCalledWith(
      "/conversations/task",
      expect.objectContaining({
        query: { around_turn: 1 },
        signal: expect.any(AbortSignal),
      })
    )
    await act(async () => {
      finish(page(1, 20))
      await request
    })
    expect(client.getQueryData(["conversation", "task"])).toMatchObject({
      last_event_id: "task:50",
    })
    expect(
      conversationSchema.parse(client.getQueryData(["conversation", "task"]))
        .messages
    ).toHaveLength(40)
    await act(() => result.current.loadTurn("turn-10"))
    expect(apiRequest).toHaveBeenCalledOnce()
  })
  it("keeps failed placeholders for explicit retry without a scroll-triggered request loop", async () => {
    vi.mocked(apiRequest)
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(page(1, 20))
    const { result } = fixture()
    await act(() => result.current.loadTurn("turn-1"))
    await waitFor(() =>
      expect(result.current.failedTurnIds.has("turn-1")).toBe(true)
    )
    await act(() => result.current.loadTurn("turn-1"))
    expect(apiRequest).toHaveBeenCalledOnce()
    await act(() => result.current.loadTurn("turn-1", true))
    await waitFor(() => expect(result.current.failedTurnIds.size).toBe(0))
  })
  it("cancels requests when leaving the task", async () => {
    let signal: AbortSignal | undefined
    vi.mocked(apiRequest).mockImplementationOnce((_url, options) => {
      signal = options?.signal
      return new Promise(() => undefined)
    })
    const { result, unmount } = fixture()
    act(() => {
      void result.current.loadTurn("turn-1")
    })
    await waitFor(() => expect(signal).toBeDefined())
    unmount()
    expect(signal?.aborted).toBe(true)
  })
})
