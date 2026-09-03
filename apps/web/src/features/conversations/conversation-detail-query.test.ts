import { createElement, type ReactNode } from "react"
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query"
import { renderHook, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  conversationDetailQueryOptions,
  selectFreshConversationEventSubscriptionId,
} from "@/features/conversations/conversation-detail-query"

describe("conversation detail event subscription", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("does not subscribe from cached task data while its fresh detail is loading", async () => {
    const conversationId = "conversation-b"
    const cachedCursor = `${conversationId}:95`
    const freshCursor = `${conversationId}:12`
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    queryClient.setQueryData(["conversation", conversationId], {
      id: conversationId,
      title: "任务 B",
      archived: false,
      updated_at: "2026-08-17T10:00:00.000Z",
      last_event_id: cachedCursor,
    })
    let resolveDetail!: (response: Response) => void
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            resolveDetail = resolve
          })
      )
    )

    const { result } = renderHook(
      () => {
        const query = useQuery(conversationDetailQueryOptions(conversationId))
        return {
          cursor: query.data?.last_event_id,
          subscriptionId: selectFreshConversationEventSubscriptionId({
            conversationId,
            isNew: false,
            isSuccess: query.isSuccess,
            isFetchedAfterMount: query.isFetchedAfterMount,
          }),
        }
      },
      {
        wrapper: ({ children }: { children: ReactNode }) =>
          createElement(QueryClientProvider, { client: queryClient }, children),
      }
    )

    expect(result.current).toEqual({
      cursor: cachedCursor,
      subscriptionId: undefined,
    })

    resolveDetail(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            id: conversationId,
            title: "任务 B",
            archived: false,
            updated_at: "2026-08-17T10:00:01.000Z",
            last_event_id: freshCursor,
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    )

    await waitFor(() =>
      expect(result.current).toEqual({
        cursor: freshCursor,
        subscriptionId: conversationId,
      })
    )
  })

  it("waits for a fresh detail snapshot before reconnecting to a cached task", () => {
    expect(
      selectFreshConversationEventSubscriptionId({
        conversationId: "conversation-b",
        isNew: false,
        isSuccess: true,
        isFetchedAfterMount: false,
      })
    ).toBeUndefined()

    expect(
      selectFreshConversationEventSubscriptionId({
        conversationId: "conversation-b",
        isNew: false,
        isSuccess: true,
        isFetchedAfterMount: true,
      })
    ).toBe("conversation-b")
  })

  it("subscribes from the server-fresh draft snapshot after a new task is promoted", () => {
    expect(
      selectFreshConversationEventSubscriptionId({
        conversationId: "conversation-new",
        isNew: false,
        isSuccess: true,
        isFetchedAfterMount: false,
        isPromotedNewTask: true,
      })
    ).toBe("conversation-new")
  })

  it.each([
    {
      name: "new task",
      conversationId: "new",
      isNew: true,
      isSuccess: true,
      isFetchedAfterMount: true,
    },
    {
      name: "missing task id",
      conversationId: undefined,
      isNew: false,
      isSuccess: true,
      isFetchedAfterMount: true,
    },
    {
      name: "failed detail request",
      conversationId: "conversation-b",
      isNew: false,
      isSuccess: false,
      isFetchedAfterMount: true,
    },
  ])("does not connect for $name", (state) => {
    expect(selectFreshConversationEventSubscriptionId(state)).toBeUndefined()
  })
})
