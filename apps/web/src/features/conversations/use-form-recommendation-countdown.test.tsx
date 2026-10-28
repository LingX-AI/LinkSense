import { act, cleanup, renderHook } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { ConversationUserInputRequest } from "@/api/contracts"
import { useFormRecommendationCountdown } from "./use-form-recommendation-countdown"

const request: Extract<ConversationUserInputRequest, { kind: "form" }> = {
  id: "30000000-0000-4000-8000-000000000001",
  conversation_id: "20000000-0000-4000-8000-000000000001",
  turn_id: "40000000-0000-4000-8000-000000000001",
  item_id: "form",
  kind: "form",
  server_name: "linksense_core",
  message: "Choose",
  requested_schema: {
    type: "object",
    properties: { scope: { type: "string" } },
  },
  ui_hints: {},
  response_semantics: { kind: "input" },
  waiting_policy: { kind: "optional", recommendation: { scope: "small" } },
  response_source: null,
  response_content: null,
  status: "pending",
  auto_resolve_at: "2026-10-27T00:03:00Z",
  resolved_at: null,
  resolved_action: null,
  created_at: "2026-10-27T00:00:00Z",
  updated_at: "2026-10-27T00:00:00Z",
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe("form recommendation countdown", () => {
  it("keeps an expired deadline at zero while the answer is being delivered", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-10-27T00:03:01Z"))
    const { result } = renderHook(() =>
      useFormRecommendationCountdown({ ...request, status: "answering" })
    )
    expect(result.current).toBe(0)
  })

  it("uses the original server deadline across rerenders and page remounts", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(request.created_at))
    const first = renderHook(() => useFormRecommendationCountdown(request))
    expect(first.result.current).toBe(180)
    act(() => vi.advanceTimersByTime(60_000))
    first.rerender()
    expect(first.result.current).toBe(120)
    first.unmount()
    act(() => vi.advanceTimersByTime(60_000))
    const reopened = renderHook(() => useFormRecommendationCountdown(request))
    expect(reopened.result.current).toBe(60)
    act(() => vi.advanceTimersByTime(60_000))
    expect(reopened.result.current).toBe(0)
  })

  it("has no countdown for required or settled forms", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(request.created_at))
    const { result, rerender } = renderHook(
      ({ value }) => useFormRecommendationCountdown(value),
      {
        initialProps: {
          value: {
            ...request,
            waiting_policy: { kind: "required" as const },
          } as typeof request,
        },
      }
    )
    act(() => vi.advanceTimersByTime(86_400_000))
    expect(result.current).toBeNull()
    rerender({ value: { ...request, status: "answered" } })
    expect(result.current).toBeNull()
  })
})
