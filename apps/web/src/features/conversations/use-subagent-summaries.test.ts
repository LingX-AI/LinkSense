import { createElement, type ReactNode } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, cleanup, renderHook } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { apiRequest } from "@/api/client"
import type { ConversationEvent } from "@/api/contracts"
import {
  subAgentSummariesRefetchInterval,
  useSubAgentSummaries,
} from "@/features/conversations/use-subagent-summaries"

vi.mock("@/api/client", () => ({
  apiRequest: vi.fn(),
}))

const agentKey = `agent_${"a".repeat(24)}`
const conversationId = "20000000-0000-4000-8000-000000000001"
const turnId = "30000000-0000-4000-8000-000000000001"

function collabAgentEvent({
  id,
  tool,
  status,
  projectedAgentKey = agentKey,
  sequenceNo,
}: {
  id: string
  tool: "spawnAgent" | "resumeAgent"
  status: "running" | "completed"
  projectedAgentKey?: string
  sequenceNo?: number
}): ConversationEvent {
  return {
    id,
    type: "item/completed",
    turn_id: turnId,
    sequence_no: sequenceNo ?? (tool === "spawnAgent" ? 1 : 2),
    created_at: "2026-08-28T08:00:00.000Z",
    payload: {
      schema_version: 2,
      source: "codex_app_server",
      method: "item/completed",
      params: {
        threadId: "thread-1",
        turnId,
        item: {
          id,
          type: "collabAgentToolCall",
          tool,
          status: "completed",
          agents: [{ agentKey: projectedAgentKey, status }],
        },
      },
    },
  }
}

describe("subagent summary polling", () => {
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it("continues polling while the projection is missing or empty", () => {
    expect(subAgentSummariesRefetchInterval(undefined, 3)).toBe(1_500)
    expect(subAgentSummariesRefetchInterval({ agents: [] }, 3)).toBe(1_500)
  })

  it("continues polling a partially hydrated projection", () => {
    expect(
      subAgentSummariesRefetchInterval(
        {
          agents: [{ agentKey, agentLabel: "纽约概览", status: "completed" }],
        },
        3
      )
    ).toBe(1_500)
  })

  it("continues polling an active child after its parent turn completes", () => {
    expect(
      subAgentSummariesRefetchInterval(
        {
          agents: [{ agentKey, agentLabel: "纽约概览", status: "running" }],
        },
        1
      )
    ).toBe(1_500)
  })

  it("stops polling only after every expected child reaches a terminal state", () => {
    expect(
      subAgentSummariesRefetchInterval(
        {
          agents: [{ agentKey, agentLabel: "纽约概览", status: "completed" }],
        },
        1
      )
    ).toBe(false)
  })

  it("stops polling when the selected native parent turn no longer exists", () => {
    expect(
      subAgentSummariesRefetchInterval(undefined, 1, { status: 404 })
    ).toBe(false)
  })

  it("projects a missing native parent turn as terminal not found", async () => {
    vi.useFakeTimers()
    vi.mocked(apiRequest).mockRejectedValue(
      Object.assign(new Error("missing"), { status: 404 })
    )
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children)
    const event = collabAgentEvent({
      id: "missing-parent-agent",
      tool: "spawnAgent",
      status: "completed",
    })

    const { result } = renderHook(
      () => useSubAgentSummaries({ conversationId, events: [event] }),
      { wrapper }
    )

    await advanceTimers(1)
    expect(result.current.get(turnId)).toEqual([
      { agentKey, status: "notFound" },
    ])
    await advanceTimers(1_700)
    expect(apiRequest).toHaveBeenCalledTimes(1)
  })

  it("starts a fresh summary query when a terminal child resumes in the same turn", async () => {
    vi.useFakeTimers()
    vi.mocked(apiRequest)
      .mockResolvedValueOnce({
        agents: [{ agentKey, agentLabel: "纽约概览", status: "completed" }],
      })
      .mockResolvedValueOnce({
        agents: [{ agentKey, agentLabel: "纽约概览", status: "running" }],
      })
      .mockResolvedValueOnce({
        agents: [{ agentKey, agentLabel: "纽约概览", status: "completed" }],
      })
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children)
    const spawnEvent = collabAgentEvent({
      id: "spawn-agent",
      tool: "spawnAgent",
      status: "completed",
    })
    const resumeEvent = collabAgentEvent({
      id: "resume-agent",
      tool: "resumeAgent",
      status: "running",
    })
    const { result, rerender } = renderHook(
      ({ events }: { events: ConversationEvent[] }) =>
        useSubAgentSummaries({ conversationId, events }),
      { initialProps: { events: [spawnEvent] }, wrapper }
    )

    await advanceTimers(1)
    expect(result.current.get(turnId)?.[0]?.status).toBe("completed")
    expect(apiRequest).toHaveBeenCalledTimes(1)

    rerender({ events: [spawnEvent, resumeEvent] })

    await advanceTimers(1)
    expect(apiRequest).toHaveBeenCalledTimes(2)
    expect(result.current.get(turnId)?.[0]?.status).toBe("running")
    await advanceTimers(1_500)
    expect(apiRequest).toHaveBeenCalledTimes(3)
    expect(result.current.get(turnId)?.[0]?.status).toBe("completed")
    await advanceTimers(1_700)
    expect(apiRequest).toHaveBeenCalledTimes(3)
  })

  it("starts a fresh summary query when another child is spawned later in the same turn", async () => {
    vi.useFakeTimers()
    const laterAgentKey = `agent_${"b".repeat(24)}`
    vi.mocked(apiRequest)
      .mockResolvedValueOnce({
        agents: [{ agentKey, agentLabel: "纽约概览", status: "completed" }],
      })
      .mockResolvedValueOnce({
        agents: [
          { agentKey, agentLabel: "纽约概览", status: "completed" },
          {
            agentKey: laterAgentKey,
            agentLabel: "纽约交通",
            status: "running",
          },
        ],
      })
      .mockResolvedValueOnce({
        agents: [
          { agentKey, agentLabel: "纽约概览", status: "completed" },
          {
            agentKey: laterAgentKey,
            agentLabel: "纽约交通",
            status: "completed",
          },
        ],
      })
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children)
    const firstSpawnEvent = collabAgentEvent({
      id: "spawn-first-agent",
      tool: "spawnAgent",
      status: "completed",
      sequenceNo: 1,
    })
    const laterSpawnEvent = collabAgentEvent({
      id: "spawn-later-agent",
      tool: "spawnAgent",
      status: "running",
      projectedAgentKey: laterAgentKey,
      sequenceNo: 2,
    })
    const { result, rerender } = renderHook(
      ({ events }: { events: ConversationEvent[] }) =>
        useSubAgentSummaries({ conversationId, events }),
      { initialProps: { events: [firstSpawnEvent] }, wrapper }
    )

    await advanceTimers(1)
    expect(result.current.get(turnId)).toEqual([
      { agentKey, agentLabel: "纽约概览", status: "completed" },
    ])
    expect(apiRequest).toHaveBeenCalledTimes(1)

    rerender({ events: [firstSpawnEvent, laterSpawnEvent] })

    await advanceTimers(1)
    expect(apiRequest).toHaveBeenCalledTimes(2)
    expect(result.current.get(turnId)).toEqual([
      { agentKey, agentLabel: "纽约概览", status: "completed" },
      {
        agentKey: laterAgentKey,
        agentLabel: "纽约交通",
        status: "running",
      },
    ])
    await advanceTimers(1_500)
    expect(apiRequest).toHaveBeenCalledTimes(3)
    expect(result.current.get(turnId)?.[1]?.status).toBe("completed")
    await advanceTimers(1_700)
    expect(apiRequest).toHaveBeenCalledTimes(3)
  })
})

async function advanceTimers(milliseconds: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(milliseconds)
  })
}
