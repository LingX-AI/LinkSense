import { Profiler, useState } from "react"
import { act, render, renderHook, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { ConversationEventHandlers } from "@/api/sse"
import type { ConversationEvent } from "@/api/contracts"
import {
  conversationReconnectingWarningDelayMs,
  conversationStreamFrameFallbackDelayMs,
  useConversationEvents,
} from "@/features/conversations/use-conversation-events"

const sseMocks = vi.hoisted(() => ({
  connectConversationEvents: vi.fn(),
}))

vi.mock("@/api/sse", () => ({
  connectConversationEvents: sseMocks.connectConversationEvents,
}))

let animationFrames = new Map<number, FrameRequestCallback>()

describe("useConversationEvents", () => {
  const disconnects: ReturnType<typeof vi.fn>[] = []
  let nextAnimationFrameId = 1
  let originalRequestAnimationFrame: PropertyDescriptor | undefined
  let originalCancelAnimationFrame: PropertyDescriptor | undefined

  beforeEach(() => {
    disconnects.length = 0
    sseMocks.connectConversationEvents.mockReset()
    sseMocks.connectConversationEvents.mockImplementation(() => {
      const disconnect = vi.fn()
      disconnects.push(disconnect)
      return disconnect
    })
    animationFrames = new Map()
    nextAnimationFrameId = 1
    originalRequestAnimationFrame = Object.getOwnPropertyDescriptor(
      window,
      "requestAnimationFrame"
    )
    originalCancelAnimationFrame = Object.getOwnPropertyDescriptor(
      window,
      "cancelAnimationFrame"
    )
    Object.defineProperty(window, "requestAnimationFrame", {
      configurable: true,
      writable: true,
      value: vi.fn((callback: FrameRequestCallback) => {
        const frameId = nextAnimationFrameId
        nextAnimationFrameId += 1
        animationFrames.set(frameId, callback)
        return frameId
      }),
    })
    Object.defineProperty(window, "cancelAnimationFrame", {
      configurable: true,
      writable: true,
      value: vi.fn((frameId: number) => animationFrames.delete(frameId)),
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    restoreWindowProperty(
      "requestAnimationFrame",
      originalRequestAnimationFrame
    )
    restoreWindowProperty("cancelAnimationFrame", originalCancelAnimationFrame)
  })

  it("coalesces a burst of streaming events into one animation-frame delivery", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
    const onEvent = vi.fn()
    const renderPhases: string[] = []
    const { unmount } = render(
      <Profiler
        id="conversation-stream"
        onRender={(_id, phase) => renderPhases.push(phase)}
      >
        <ConversationEventRenderHarness onEvent={onEvent} />
      </Profiler>
    )
    const handlers = sseMocks.connectConversationEvents.mock
      .calls[0]?.[1] as ConversationEventHandlers
    const events = Array.from({ length: 100 }, (_, index) =>
      nativeAgentDelta(index + 2, String(index))
    )

    act(() => events.forEach((event) => handlers.onEvent(event)))

    expect(onEvent).not.toHaveBeenCalled()
    expect(screen.getByTestId("received-event-ids")).toBeEmptyDOMElement()
    expect(animationFrames.size).toBe(1)

    runAnimationFrame(16)

    expect(onEvent).toHaveBeenCalledTimes(events.length)
    expect(onEvent.mock.calls.map(([event]) => event.id)).toEqual(
      events.map((event) => event.id)
    )
    expect(screen.getByTestId("received-event-ids")).toHaveTextContent(
      events.map((event) => event.id).join(",")
    )
    expect(renderPhases.filter((phase) => phase === "update")).toHaveLength(1)
    act(() => vi.advanceTimersByTime(conversationStreamFrameFallbackDelayMs))
    expect(onEvent).toHaveBeenCalledTimes(events.length)
    unmount()
  })

  it("flushes pending deltas before a lifecycle event", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
    const onEvent = vi.fn()
    const { unmount } = renderHook(() =>
      useConversationEvents("conversation-1", onEvent, "event-1")
    )
    const handlers = sseMocks.connectConversationEvents.mock
      .calls[0]?.[1] as ConversationEventHandlers
    const delta = nativeAgentDelta(2, "尾部内容")
    const completed: ConversationEvent = {
      id: "event-3",
      type: "turn/completed",
      turn_id: "turn-1",
      payload: {},
      created_at: "2026-07-15T00:00:03.000Z",
      sequence_no: 3,
    }

    act(() => {
      handlers.onEvent(delta)
      handlers.onEvent(completed)
    })

    expect(onEvent.mock.calls.map(([event]) => event.id)).toEqual([
      delta.id,
      completed.id,
    ])
    expect(animationFrames.size).toBe(0)
    unmount()
  })

  it("uses a bounded timer fallback when animation frames are suspended", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
    const onEvent = vi.fn()
    const { unmount } = renderHook(() =>
      useConversationEvents("conversation-1", onEvent, "event-1")
    )
    const handlers = sseMocks.connectConversationEvents.mock
      .calls[0]?.[1] as ConversationEventHandlers
    const delta = nativeAgentDelta(2, "后台标签页也不能丢")

    act(() => handlers.onEvent(delta))
    act(() =>
      vi.advanceTimersByTime(conversationStreamFrameFallbackDelayMs - 1)
    )
    expect(onEvent).not.toHaveBeenCalled()

    act(() => vi.advanceTimersByTime(1))
    expect(onEvent).toHaveBeenCalledWith(delta)
    expect(animationFrames.size).toBe(0)
    unmount()
  })

  it("leaves a dropped frame uncommitted so it can replay after a conversation change", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
    const onEvent = vi.fn()
    const { rerender, unmount } = renderHook(
      ({ conversationId }) =>
        useConversationEvents(conversationId, onEvent, "event-1"),
      { initialProps: { conversationId: "conversation-1" } }
    )
    const firstHandlers = sseMocks.connectConversationEvents.mock
      .calls[0]?.[1] as ConversationEventHandlers
    const commitCursor = vi.fn()

    act(() =>
      firstHandlers.onEvent(nativeAgentDelta(2, "旧任务内容"), commitCursor)
    )
    rerender({ conversationId: "conversation-2" })
    runAnimationFrame(16)
    act(() => vi.advanceTimersByTime(conversationStreamFrameFallbackDelayMs))

    expect(onEvent).not.toHaveBeenCalled()
    expect(commitCursor).not.toHaveBeenCalled()
    unmount()
  })

  it("keeps one stream for a conversation when its persisted cursor advances", () => {
    const firstOnEvent = vi.fn()
    const latestOnEvent = vi.fn()
    const { rerender, unmount } = renderHook(
      ({
        conversationId,
        initialEventId,
        onEvent,
      }: {
        conversationId?: string
        initialEventId?: string
        onEvent: ConversationEventHandlers["onEvent"]
      }) => useConversationEvents(conversationId, onEvent, initialEventId),
      {
        initialProps: {
          conversationId: "conversation-1",
          initialEventId: "event-1",
          onEvent: firstOnEvent,
        },
      }
    )

    expect(sseMocks.connectConversationEvents).toHaveBeenCalledOnce()
    expect(sseMocks.connectConversationEvents).toHaveBeenLastCalledWith(
      "conversation-1",
      expect.any(Object),
      { initialEventId: "event-1" }
    )

    rerender({
      conversationId: "conversation-1",
      initialEventId: "event-2",
      onEvent: latestOnEvent,
    })

    expect(sseMocks.connectConversationEvents).toHaveBeenCalledOnce()
    expect(disconnects[0]).not.toHaveBeenCalled()

    const firstHandlers = sseMocks.connectConversationEvents.mock
      .calls[0]?.[1] as ConversationEventHandlers
    act(() => {
      firstHandlers.onEvent({
        id: "event-2",
        type: "turn/completed",
        turn_id: "turn-1",
        payload: {},
        created_at: "2026-07-15T00:00:00.000Z",
        sequence_no: 2,
      })
    })
    expect(firstOnEvent).not.toHaveBeenCalled()
    expect(latestOnEvent).toHaveBeenCalledOnce()

    rerender({
      conversationId: "conversation-2",
      initialEventId: "event-9",
      onEvent: latestOnEvent,
    })

    expect(disconnects[0]).toHaveBeenCalledOnce()
    expect(sseMocks.connectConversationEvents).toHaveBeenCalledTimes(2)
    expect(sseMocks.connectConversationEvents).toHaveBeenLastCalledWith(
      "conversation-2",
      expect.any(Object),
      { initialEventId: "event-9" }
    )

    unmount()
    expect(disconnects[1]).toHaveBeenCalledOnce()
  })

  it("starts from the beginning when the fresh detail snapshot has no cursor", () => {
    const { unmount } = renderHook(() =>
      useConversationEvents("conversation-1", vi.fn())
    )

    expect(sseMocks.connectConversationEvents).toHaveBeenCalledWith(
      "conversation-1",
      expect.any(Object),
      { initialEventId: "" }
    )
    unmount()
  })

  it("keeps a reconnect warning hidden when the stream recovers within three seconds", () => {
    vi.useFakeTimers()
    const { result, unmount } = renderHook(() =>
      useConversationEvents("conversation-1", vi.fn(), "event-1")
    )
    const handlers = sseMocks.connectConversationEvents.mock
      .calls[0]?.[1] as ConversationEventHandlers

    act(() => handlers.onConnectionChange?.("reconnecting"))
    expect(result.current).toEqual({
      connectionState: "reconnecting",
      reconnectingWarningVisible: false,
    })

    act(() => {
      vi.advanceTimersByTime(conversationReconnectingWarningDelayMs - 1)
      handlers.onConnectionChange?.("connected")
    })
    expect(result.current).toEqual({
      connectionState: "connected",
      reconnectingWarningVisible: false,
    })

    act(() => vi.advanceTimersByTime(1))
    expect(result.current.reconnectingWarningVisible).toBe(false)
    unmount()
  })

  it("shows a reconnect warning only after one continuous three-second outage", () => {
    vi.useFakeTimers()
    const { result, unmount } = renderHook(() =>
      useConversationEvents("conversation-1", vi.fn(), "event-1")
    )
    const handlers = sseMocks.connectConversationEvents.mock
      .calls[0]?.[1] as ConversationEventHandlers

    act(() => handlers.onConnectionChange?.("reconnecting"))
    act(() => vi.advanceTimersByTime(1_500))
    act(() => handlers.onConnectionChange?.("reconnecting"))
    act(() => vi.advanceTimersByTime(1_499))
    expect(result.current.reconnectingWarningVisible).toBe(false)

    act(() => vi.advanceTimersByTime(1))
    expect(result.current).toEqual({
      connectionState: "reconnecting",
      reconnectingWarningVisible: true,
    })

    act(() => handlers.onConnectionChange?.("connected"))
    expect(result.current.reconnectingWarningVisible).toBe(false)
    unmount()
  })
})

function ConversationEventRenderHarness({
  onEvent,
}: {
  onEvent: ConversationEventHandlers["onEvent"]
}) {
  const [receivedEventIds, setReceivedEventIds] = useState<string[]>([])
  useConversationEvents(
    "conversation-1",
    (event) => {
      onEvent(event)
      setReceivedEventIds((current) => [...current, event.id])
    },
    "event-1"
  )
  return (
    <output data-testid="received-event-ids">
      {receivedEventIds.join(",")}
    </output>
  )
}

function nativeAgentDelta(sequence: number, delta: string): ConversationEvent {
  return {
    id: `event-${sequence}`,
    type: "item/agentMessage/delta",
    turn_id: "turn-1",
    sequence_no: sequence,
    created_at: `2026-07-15T00:00:${String(sequence).padStart(2, "0")}.000Z`,
    payload: {
      schema_version: 2,
      source: "codex_app_server",
      method: "item/agentMessage/delta",
      params: {
        threadId: "thread-1",
        turnId: "native-turn-1",
        itemId: "item-1",
        delta,
      },
    },
  }
}

function runAnimationFrame(timestamp: number) {
  const callbacks = [...animationFrames.values()]
  animationFrames.clear()
  act(() => callbacks.forEach((callback) => callback(timestamp)))
}

function restoreWindowProperty(
  property: "requestAnimationFrame" | "cancelAnimationFrame",
  descriptor: PropertyDescriptor | undefined
) {
  if (descriptor) Object.defineProperty(window, property, descriptor)
  else Reflect.deleteProperty(window, property)
}
