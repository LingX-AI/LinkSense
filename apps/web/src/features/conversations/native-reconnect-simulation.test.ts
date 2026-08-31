import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { ConversationEvent } from "@/api/contracts"
import {
  advanceNativeReconnectSnapshot,
  createNativeReconnectSnapshot,
  hasNativeReconnectFailure,
  isNativeStreamDisconnectRetry,
  nativeReconnectAttemptIntervalMs,
  nativeReconnectStorageKeyPrefix,
  readNativeReconnectSnapshot,
  useNativeReconnectSimulation,
} from "@/features/conversations/native-reconnect-simulation"

const conversationId = "conversation-1"
const turnId = "turn-1"
const startedAtMs = 1_000

describe("native reconnect simulation", () => {
  beforeEach(() => {
    window.localStorage.clear()
    vi.useFakeTimers()
    vi.setSystemTime(startedAtMs)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("advances five attempts per round and fails only after three rounds", () => {
    const initial = createNativeReconnectSnapshot({
      conversationId,
      turnId,
      nowMs: startedAtMs,
    })

    expect(initial).toMatchObject({
      phase: "reconnecting",
      round: 1,
      attempt: 1,
    })
    expect(
      advanceNativeReconnectSnapshot(
        initial,
        startedAtMs + nativeReconnectAttemptIntervalMs * 4
      )
    ).toMatchObject({
      phase: "reconnecting",
      round: 1,
      attempt: 5,
    })
    expect(
      advanceNativeReconnectSnapshot(
        initial,
        startedAtMs + nativeReconnectAttemptIntervalMs * 5
      )
    ).toMatchObject({
      phase: "reconnecting",
      round: 2,
      attempt: 1,
    })
    expect(
      advanceNativeReconnectSnapshot(
        initial,
        startedAtMs + nativeReconnectAttemptIntervalMs * 14
      )
    ).toMatchObject({
      phase: "reconnecting",
      round: 3,
      attempt: 5,
    })
    expect(
      advanceNativeReconnectSnapshot(
        initial,
        startedAtMs + nativeReconnectAttemptIntervalMs * 15
      )
    ).toMatchObject({
      phase: "failed",
      round: 3,
      attempt: 5,
      nextAttemptAtMs: null,
    })
  })

  it("persists the current round and resumes from elapsed wall-clock time", () => {
    const first = renderHook(() =>
      useNativeReconnectSimulation({ conversationId, turnId })
    )

    act(() => first.result.current.start())
    expect(first.result.current.state).toMatchObject({
      phase: "reconnecting",
      round: 1,
      attempt: 1,
    })

    act(() => vi.advanceTimersByTime(nativeReconnectAttemptIntervalMs))
    expect(first.result.current.state).toMatchObject({
      phase: "reconnecting",
      round: 1,
      attempt: 2,
    })

    act(() => first.result.current.start())
    expect(first.result.current.state).toMatchObject({
      round: 1,
      attempt: 2,
    })
    first.unmount()

    vi.setSystemTime(startedAtMs + nativeReconnectAttemptIntervalMs * 6)
    const second = renderHook(() =>
      useNativeReconnectSimulation({ conversationId, turnId })
    )
    act(() => vi.advanceTimersByTime(0))

    expect(second.result.current.state).toMatchObject({
      phase: "reconnecting",
      round: 2,
      attempt: 2,
    })
    expect(
      JSON.parse(
        window.localStorage.getItem(
          `${nativeReconnectStorageKeyPrefix}:${conversationId}`
        ) ?? "null"
      )
    ).toMatchObject({
      conversationId,
      turnId,
      round: 2,
      attempt: 2,
    })
  })

  it("clears both in-memory and persisted reconnect state after progress", () => {
    const reconnect = renderHook(() =>
      useNativeReconnectSimulation({ conversationId, turnId })
    )

    act(() => reconnect.result.current.start())
    expect(window.localStorage.length).toBe(1)

    act(() => reconnect.result.current.clear())

    expect(reconnect.result.current.state).toBeNull()
    expect(window.localStorage.length).toBe(0)
  })

  it("reaches the failed display state after fifteen five-second intervals", () => {
    const reconnect = renderHook(() =>
      useNativeReconnectSimulation({ conversationId, turnId })
    )
    act(() => reconnect.result.current.start())

    for (let interval = 0; interval < 14; interval += 1) {
      act(() => vi.advanceTimersByTime(nativeReconnectAttemptIntervalMs))
    }
    expect(reconnect.result.current.state).toMatchObject({
      phase: "reconnecting",
      round: 3,
      attempt: 5,
    })

    act(() => vi.advanceTimersByTime(nativeReconnectAttemptIntervalMs))
    expect(reconnect.result.current.state).toMatchObject({
      phase: "failed",
      round: 3,
      attempt: 5,
      stoppedAtMs: startedAtMs + nativeReconnectAttemptIntervalMs * 15,
    })
    expect(hasNativeReconnectFailure(conversationId)).toBe(true)
  })

  it("keeps an exhausted marker after terminal progress and clears it for a new turn", () => {
    const initialProps: { currentTurnId?: string } = {
      currentTurnId: turnId,
    }
    const reconnect = renderHook(
      ({ currentTurnId }: { currentTurnId?: string }) =>
        useNativeReconnectSimulation({
          conversationId,
          turnId: currentTurnId,
        }),
      { initialProps }
    )
    act(() => reconnect.result.current.start())
    for (let interval = 0; interval < 15; interval += 1) {
      act(() => vi.advanceTimersByTime(nativeReconnectAttemptIntervalMs))
    }

    act(() => reconnect.result.current.clear())
    expect(reconnect.result.current.state).toMatchObject({ phase: "failed" })
    expect(hasNativeReconnectFailure(conversationId)).toBe(true)

    reconnect.rerender({})
    act(() => vi.advanceTimersByTime(0))
    expect(reconnect.result.current.state).toMatchObject({
      phase: "failed",
      turnId,
    })

    reconnect.rerender({ currentTurnId: "turn-2" })
    act(() => vi.advanceTimersByTime(0))

    expect(reconnect.result.current.state).toBeNull()
    expect(hasNativeReconnectFailure(conversationId)).toBe(false)
  })

  it("discards malformed or stale persisted state", () => {
    const key = `${nativeReconnectStorageKeyPrefix}:${conversationId}`
    window.localStorage.setItem(key, '{"phase":"reconnecting"}')
    expect(
      readNativeReconnectSnapshot(window.localStorage, conversationId, turnId)
    ).toBeNull()
    expect(window.localStorage.getItem(key)).toBeNull()

    window.localStorage.setItem(
      key,
      JSON.stringify(
        createNativeReconnectSnapshot({
          conversationId,
          turnId: "old-turn",
          nowMs: startedAtMs,
        })
      )
    )
    expect(
      readNativeReconnectSnapshot(window.localStorage, conversationId, turnId)
    ).toBeNull()
    expect(window.localStorage.getItem(key)).toBeNull()
  })

  it("starts reconnect feedback only for a retryable response stream disconnect", () => {
    const streamDisconnect = nativeEvent(2, "error", {
      willRetry: true,
      error: {
        codexErrorInfo: {
          responseStreamDisconnected: { httpStatusCode: null },
        },
      },
    })
    const overloadedRetry = nativeEvent(3, "error", {
      willRetry: true,
      error: { codexErrorInfo: "serverOverloaded" },
    })
    const progress = nativeEvent(4, "turn/plan/updated", {
      plan: [{ step: "继续", status: "inProgress" }],
    })

    expect(isNativeStreamDisconnectRetry(streamDisconnect)).toBe(true)
    expect(isNativeStreamDisconnectRetry(overloadedRetry)).toBe(false)
    expect(isNativeStreamDisconnectRetry(progress)).toBe(false)
  })
})

function nativeEvent(
  sequence: number,
  method: "error" | "turn/plan/updated",
  values: Record<string, unknown>
): ConversationEvent {
  return {
    id: `event-${sequence}`,
    type: method,
    turn_id: turnId,
    sequence_no: sequence,
    created_at: `2026-07-18T08:00:${String(sequence).padStart(2, "0")}.000Z`,
    payload: {
      schema_version: 2,
      source: "codex_app_server",
      method,
      params: {
        threadId: "codex-thread-1",
        turnId: "codex-turn-1",
        ...values,
      },
    },
  }
}
