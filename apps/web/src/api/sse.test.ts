import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  connectConversationEvents,
  fetchConversationEventHistory,
  parseSseFrame,
  type ConversationEventHandlers,
} from "@/api/sse"
import { setAccessToken } from "@/api/session"

const CONVERSATION_ID = "20000000-0000-4000-8000-000000000001"
const TURN_ID = "30000000-0000-4000-8000-000000000001"

describe("conversation SSE", () => {
  it.each([false, true])(
    "yields during event bursts across network chunks (one frame per chunk: %s)",
    async (onePerChunk) => {
      vi.useFakeTimers()
      const delivered: number[] = []
      let inputHandledAfterEvents = -1
      window.setTimeout(() => {
        inputHandledAfterEvents = delivered.length
      }, 0)
      const count = 512
      let started: () => void = () => {}
      const firstDelivery = new Promise<void>((resolve) => {
        started = resolve
      })
      const frames = Array.from(
        { length: count },
        (_, index) => `data: ${JSON.stringify(completedEvent(index + 1))}\n\n`
      )
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          for (const chunk of onePerChunk ? frames : [frames.join("")]) {
            controller.enqueue(new TextEncoder().encode(chunk))
          }
        },
      })
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(stream)))
      const disconnect = connectConversationEvents(CONVERSATION_ID, {
        onEvent: (event) => {
          delivered.push(event.sequence_no)
          started()
        },
      })
      try {
        await firstDelivery
        // A network backlog must leave a task boundary for input, painting and cancellation.
        await Promise.resolve()
        expect(delivered.length).toBeLessThan(count)
        await vi.runAllTimersAsync()
        expect(inputHandledAfterEvents).toBeGreaterThan(0)
        expect(inputHandledAfterEvents).toBeLessThan(count)
        expect(delivered).toEqual(
          Array.from({ length: count }, (_, index) => index + 1)
        )
        expect(
          window.sessionStorage.getItem(
            `linksense.sse.${CONVERSATION_ID}.lastEventId`
          )
        ).toBe(`${CONVERSATION_ID}:${count}`)
      } finally {
        disconnect()
      }
    }
  )

  it("stops a buffered event burst immediately when the page disconnects", async () => {
    vi.useFakeTimers()
    const onEvent = vi.fn()
    let started: () => void = () => {}
    const firstDelivery = new Promise<void>((resolve) => {
      started = resolve
    })
    const frames = Array.from(
      { length: 512 },
      (_, index) => `data: ${JSON.stringify(completedEvent(index + 1))}\n\n`
    ).join("")
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode(frames))
            },
          })
        )
      )
    )
    const disconnect = connectConversationEvents(CONVERSATION_ID, {
      onEvent: (event) => {
        onEvent(event)
        started()
      },
    })
    await firstDelivery
    const delivered = onEvent.mock.calls.length
    disconnect()
    await vi.runAllTimersAsync()
    expect(onEvent).toHaveBeenCalledTimes(delivered)
    expect(delivered).toBeLessThan(512)
  })

  beforeEach(() => {
    window.sessionStorage.clear()
    setAccessToken("access-token")
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it("accepts a large backlog of individually valid frames without reconnecting", async () => {
    vi.useFakeTimers()
    const received: number[] = []
    let started: () => void = () => {}
    const firstDelivery = new Promise<void>((resolve) => {
      started = resolve
    })
    // SSE comments do not affect event contents. This chunk exceeds the
    // per-frame safety limit in total while every individual frame is small.
    const frames = Array.from(
      { length: 80 },
      (_, index) =>
        `: ${"x".repeat(55_000)}\ndata: ${JSON.stringify(completedEvent(index + 1))}\n\n`
    ).join("")
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(frames))
          },
        })
      )
    )
    vi.stubGlobal("fetch", fetchMock)
    const disconnect = connectConversationEvents(CONVERSATION_ID, {
      onEvent: (event) => {
        received.push(event.sequence_no)
        started()
      },
    })
    try {
      await firstDelivery
      await vi.runAllTimersAsync()
      expect(received).toEqual(
        Array.from({ length: 80 }, (_, index) => index + 1)
      )
      expect(fetchMock).toHaveBeenCalledOnce()
    } finally {
      disconnect()
    }
  })

  it.each(["", "\n\n"])(
    "rejects an oversized individual frame (terminator: %j)",
    async (terminator) => {
      const cancel = vi.fn()
      const onEvent = vi.fn()
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode(
              `data: ${"x".repeat(4_000_001)}${terminator}`
            )
          )
        },
        cancel,
      })
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(stream)))
      const disconnect = connectConversationEvents(CONVERSATION_ID, { onEvent })
      try {
        await vi.waitFor(() => expect(cancel).toHaveBeenCalledOnce())
        expect(onEvent).not.toHaveBeenCalled()
        expect(
          window.sessionStorage.getItem(
            `linksense.sse.${CONVERSATION_ID}.lastEventId`
          )
        ).toBeNull()
      } finally {
        disconnect()
      }
    }
  )

  it("parses multiline frames, comments, retry, and IDs", () => {
    expect(
      parseSseFrame(
        ': keepalive\nid: event-12\nevent: conversation.completed\nretry: 2500\ndata: {"payload":\ndata: {}}'
      )
    ).toEqual({
      id: "event-12",
      event: "conversation.completed",
      retry: 2500,
      data: '{"payload":\n{}}',
    })
  })

  it("persists the event cursor and sends Last-Event-ID after reconnect", async () => {
    vi.useFakeTimers()
    const firstStream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            `id: ${CONVERSATION_ID}:42\nevent: conversation.completed\ndata: ${JSON.stringify(completedEvent(42))}\n\n`
          )
        )
        controller.close()
      },
    })
    const secondStream = new ReadableStream({ start() {} })
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(firstStream, { status: 200 }))
      .mockResolvedValueOnce(new Response(secondStream, { status: 200 }))
    vi.stubGlobal("fetch", fetchMock)
    const onEvent = vi.fn()
    const disconnect = connectConversationEvents(CONVERSATION_ID, { onEvent })

    await vi.waitFor(() => expect(onEvent).toHaveBeenCalledTimes(1))
    expect(
      window.sessionStorage.getItem(
        `linksense.sse.${CONVERSATION_ID}.lastEventId`
      )
    ).toBe(`${CONVERSATION_ID}:42`)
    await vi.advanceTimersByTimeAsync(1_000)
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))

    const secondInit = fetchMock.mock.calls[1]?.[1] as RequestInit
    expect(new Headers(secondInit.headers).get("Last-Event-ID")).toBe(
      `${CONVERSATION_ID}:42`
    )
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain(
      `last_event_id=${encodeURIComponent(`${CONVERSATION_ID}:42`)}`
    )
    disconnect()
  })

  it("does not persist a deferred event cursor until the consumer commits it", async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            `id: ${CONVERSATION_ID}:43\nevent: conversation.completed\ndata: ${JSON.stringify(completedEvent(43))}\n\n`
          )
        )
      },
    })
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(stream, { status: 200 }))
    )
    let commitCursor: (() => void) | undefined
    const onEvent: ConversationEventHandlers["onEvent"] = vi.fn(
      (_event, commit) => {
        commitCursor = commit
        return false as const
      }
    )

    const disconnect = connectConversationEvents(CONVERSATION_ID, { onEvent })
    await vi.waitFor(() => expect(onEvent).toHaveBeenCalledOnce())

    expect(
      window.sessionStorage.getItem(
        `linksense.sse.${CONVERSATION_ID}.lastEventId`
      )
    ).toBeNull()
    expect(commitCursor).toBeTypeOf("function")

    commitCursor?.()
    await Promise.resolve()

    expect(
      window.sessionStorage.getItem(
        `linksense.sse.${CONVERSATION_ID}.lastEventId`
      )
    ).toBe(`${CONVERSATION_ID}:43`)
    disconnect()
  })

  it("coalesces cursor writes and never skips an unconsumed event", async () => {
    const commits: Array<() => void> = []
    const write = vi.spyOn(window.sessionStorage, "setItem")
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            [41, 42, 43]
              .map(
                (sequence) =>
                  `data: ${JSON.stringify(completedEvent(sequence))}\n\n`
              )
              .join("")
          )
        )
      },
    })
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(stream)))
    const disconnect = connectConversationEvents(CONVERSATION_ID, {
      onEvent: (_event, commit) => {
        if (commit) commits.push(commit)
        return false
      },
    })
    await vi.waitFor(() => expect(commits).toHaveLength(3))
    commits[2]?.()
    await Promise.resolve()
    expect(write).not.toHaveBeenCalled()
    commits[0]?.()
    commits[1]?.()
    await Promise.resolve()
    expect(write).toHaveBeenCalledExactlyOnceWith(
      `linksense.sse.${CONVERSATION_ID}.lastEventId`,
      `${CONVERSATION_ID}:43`
    )
    disconnect()
    write.mockRestore()
  })

  it("starts after the latest event already returned by the detail API", async () => {
    const stream = new ReadableStream({ start() {} })
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(stream, { status: 200 }))
    vi.stubGlobal("fetch", fetchMock)

    const disconnect = connectConversationEvents(
      CONVERSATION_ID,
      { onEvent: vi.fn() },
      { initialEventId: `${CONVERSATION_ID}:18` }
    )

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain(
      `last_event_id=${encodeURIComponent(`${CONVERSATION_ID}:18`)}`
    )
    expect(new Headers(init.headers).get("Last-Event-ID")).toBe(
      `${CONVERSATION_ID}:18`
    )
    expect(
      window.sessionStorage.getItem(
        `linksense.sse.${CONVERSATION_ID}.lastEventId`
      )
    ).toBe(`${CONVERSATION_ID}:18`)
    disconnect()
  })

  it("replays an event after its consumer throws without leaving a permanent cursor gap", async () => {
    vi.useFakeTimers()
    const stream = (sequences: number[], close: boolean) =>
      new ReadableStream({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode(
              sequences
                .map(
                  (sequence) =>
                    `data: ${JSON.stringify(completedEvent(sequence))}\n\n`
                )
                .join("")
            )
          )
          if (close) controller.close()
        },
      })
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(stream([42], true)))
      .mockResolvedValueOnce(new Response(stream([42, 43], false)))
    vi.stubGlobal("fetch", fetchMock)
    const onEvent = vi
      .fn<ConversationEventHandlers["onEvent"]>()
      .mockImplementationOnce(() => {
        throw new Error("consumer failed")
      })
    const disconnect = connectConversationEvents(CONVERSATION_ID, { onEvent })
    try {
      await vi.waitFor(() => expect(onEvent).toHaveBeenCalledOnce())
      expect(
        window.sessionStorage.getItem(
          `linksense.sse.${CONVERSATION_ID}.lastEventId`
        )
      ).toBeNull()
      await vi.advanceTimersByTimeAsync(1_000)
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
      expect(
        new Headers(fetchMock.mock.calls[1]?.[1].headers).get("Last-Event-ID")
      ).toBeNull()
      expect(onEvent.mock.calls.map(([event]) => event.sequence_no)).toEqual([
        42, 42, 43,
      ])
      expect(
        window.sessionStorage.getItem(
          `linksense.sse.${CONVERSATION_ID}.lastEventId`
        )
      ).toBe(`${CONVERSATION_ID}:43`)
    } finally {
      disconnect()
    }
  })

  it("starts from the beginning when the detail API provides an empty cursor", async () => {
    window.sessionStorage.setItem(
      `linksense.sse.${CONVERSATION_ID}.lastEventId`,
      `${CONVERSATION_ID}:42`
    )
    const stream = new ReadableStream({ start() {} })
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(stream, { status: 200 }))
    vi.stubGlobal("fetch", fetchMock)

    const disconnect = connectConversationEvents(
      CONVERSATION_ID,
      { onEvent: vi.fn() },
      { initialEventId: "" }
    )

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).not.toContain("last_event_id")
    expect(new Headers(init.headers).get("Last-Event-ID")).toBeNull()
    disconnect()
  })

  it("loads older events through the bounded REST cursor contract", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            items: [completedEvent(12)],
            next_cursor: `${CONVERSATION_ID}:12`,
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    )
    vi.stubGlobal("fetch", fetchMock)

    const page = await fetchConversationEventHistory(CONVERSATION_ID, {
      cursor: `${CONVERSATION_ID}:4`,
      limit: 8,
    })

    expect(page.items).toEqual([
      expect.objectContaining({
        id: `${CONVERSATION_ID}:12`,
        type: "conversation.completed",
      }),
    ])
    expect(page.next_cursor).toBe(`${CONVERSATION_ID}:12`)
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("limit=8")
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      `cursor=${encodeURIComponent(`${CONVERSATION_ID}:4`)}`
    )
  })

  it("does not advance the cursor for a frame whose envelope disagrees with its data", async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            `id: ${CONVERSATION_ID}:99\nevent: conversation.completed\ndata: ${JSON.stringify(completedEvent(43))}\n\n`
          )
        )
      },
    })
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(stream, { status: 200 }))
    )
    const onEvent = vi.fn()

    const disconnect = connectConversationEvents(CONVERSATION_ID, { onEvent })
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce())

    expect(onEvent).not.toHaveBeenCalled()
    expect(
      window.sessionStorage.getItem(
        `linksense.sse.${CONVERSATION_ID}.lastEventId`
      )
    ).toBeNull()
    disconnect()
  })

  it("dispatches a native Codex lifecycle event without translating its method or payload", async () => {
    const native = nativeLifecycleEvent(21)
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            `id: ${CONVERSATION_ID}:21\nevent: item/completed\ndata: ${JSON.stringify(native)}\n\n`
          )
        )
      },
    })
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(stream, { status: 200 }))
    )
    const onEvent = vi.fn()

    const disconnect = connectConversationEvents(CONVERSATION_ID, { onEvent })
    await vi.waitFor(() => expect(onEvent).toHaveBeenCalledOnce())

    expect(onEvent).toHaveBeenCalledWith(
      {
        id: `${CONVERSATION_ID}:21`,
        type: "item/completed",
        turn_id: TURN_ID,
        sequence_no: 21,
        created_at: "2026-07-11T00:00:00.000Z",
        payload: expect.objectContaining({
          schema_version: 2,
          source: "codex_app_server",
          method: "item/completed",
          params: expect.objectContaining({
            item: expect.objectContaining({
              id: "command-1",
              type: "commandExecution",
            }),
          }),
        }),
      },
      expect.any(Function)
    )
    disconnect()
  })

  it("dispatches a native reasoning summary delta without translating its text", async () => {
    const native = nativeReasoningSummaryEvent(23)
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            `id: ${CONVERSATION_ID}:23\nevent: item/reasoning/summaryTextDelta\ndata: ${JSON.stringify(native)}\n\n`
          )
        )
      },
    })
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(stream, { status: 200 }))
    )
    const onEvent = vi.fn()

    const disconnect = connectConversationEvents(CONVERSATION_ID, { onEvent })
    await vi.waitFor(() => expect(onEvent).toHaveBeenCalledOnce())

    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        id: `${CONVERSATION_ID}:23`,
        type: "item/reasoning/summaryTextDelta",
        turn_id: TURN_ID,
        sequence_no: 23,
        payload: expect.objectContaining({
          method: "item/reasoning/summaryTextDelta",
          params: expect.objectContaining({
            itemId: "reasoning-1",
            summaryIndex: 0,
            delta: "Evaluating test timing reliability",
          }),
        }),
      }),
      expect.any(Function)
    )
    disconnect()
  })

  it("does not dispatch or advance the cursor for an unsafe native preview", async () => {
    const native = nativeLifecycleEvent(22, "curl --token=raw-secret-value")
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            `id: ${CONVERSATION_ID}:22\nevent: item/completed\ndata: ${JSON.stringify(native)}\n\n`
          )
        )
      },
    })
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(stream, { status: 200 }))
    )
    const onEvent = vi.fn()

    const disconnect = connectConversationEvents(CONVERSATION_ID, { onEvent })
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce())

    expect(onEvent).not.toHaveBeenCalled()
    expect(
      window.sessionStorage.getItem(
        `linksense.sse.${CONVERSATION_ID}.lastEventId`
      )
    ).toBeNull()
    disconnect()
  })
})

function completedEvent(sequence: number) {
  return {
    id: `60000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
    conversation_id: CONVERSATION_ID,
    turn_id: TURN_ID,
    sequence_no: sequence,
    event_type: "conversation.completed",
    visibility: "user_visible",
    payload: {
      schema_version: 1,
      turn_id: TURN_ID,
      codex_turn_id: "native-turn-1",
      status: "completed",
    },
    sse_event_id: `${CONVERSATION_ID}:${sequence}`,
    created_at: "2026-07-11T00:00:00.000Z",
  }
}

function nativeLifecycleEvent(sequence: number, command?: string) {
  return {
    id: `60000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
    conversation_id: CONVERSATION_ID,
    turn_id: TURN_ID,
    sequence_no: sequence,
    event_type: "item/completed",
    visibility: "user_collapsed",
    payload: {
      schema_version: 2,
      source: "codex_app_server",
      method: "item/completed",
      params: {
        threadId: "thread-1",
        turnId: TURN_ID,
        item: {
          id: "command-1",
          type: "commandExecution",
          status: "completed",
          commandActions: command ? [{ type: "unknown", command }] : [],
          ...(command ? { command } : {}),
        },
      },
    },
    sse_event_id: `${CONVERSATION_ID}:${sequence}`,
    created_at: "2026-07-11T00:00:00.000Z",
  }
}

function nativeReasoningSummaryEvent(sequence: number) {
  return {
    id: `60000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
    conversation_id: CONVERSATION_ID,
    turn_id: TURN_ID,
    sequence_no: sequence,
    event_type: "item/reasoning/summaryTextDelta",
    visibility: "user_collapsed",
    payload: {
      schema_version: 2,
      source: "codex_app_server",
      method: "item/reasoning/summaryTextDelta",
      params: {
        threadId: "thread-1",
        turnId: TURN_ID,
        itemId: "reasoning-1",
        summaryIndex: 0,
        delta: "Evaluating test timing reliability",
      },
    },
    sse_event_id: `${CONVERSATION_ID}:${sequence}`,
    created_at: "2026-07-11T00:00:00.000Z",
  }
}
