// @vitest-environment node

import { describe, expect, it } from "vitest"

import type { ConversationEvent } from "@/api/contracts"
import {
  appendConversationLiveEvent,
  isStreamOnlyNativeEvent,
} from "@/features/conversations/conversation-live-events"

const TURN_ID = "40000000-0000-4000-8000-000000000001"

describe("conversation live event retention", () => {
  it("does not let more than 200 streaming deltas evict an earlier tool lifecycle", () => {
    const tool = nativeEvent(1, "item/started", {
      item: {
        type: "commandExecution",
        id: "command-1",
        status: "inProgress",
        commandActions: [],
      },
    })
    let retained = appendConversationLiveEvent([], tool)

    for (let sequence = 2; sequence <= 252; sequence += 1) {
      const delta = nativeEvent(sequence, "item/agentMessage/delta", {
        itemId: "message-1",
        delta: "x",
      })
      expect(isStreamOnlyNativeEvent(delta)).toBe(true)
      retained = appendConversationLiveEvent(retained, delta)
    }

    const reasoningSummary = nativeEvent(
      253,
      "item/reasoning/summaryTextDelta",
      {
        itemId: "reasoning-1",
        summaryIndex: 0,
        delta: "Evaluating test timing reliability",
      }
    )
    expect(isStreamOnlyNativeEvent(reasoningSummary)).toBe(true)
    retained = appendConversationLiveEvent(retained, reasoningSummary)

    expect(retained).toEqual([tool])
  })

  it("keeps only the latest complete plan snapshot for a turn", () => {
    const first = nativeEvent(1, "turn/plan/updated", {
      plan: [{ step: "旧步骤", status: "inProgress" }],
    })
    const latest = nativeEvent(2, "turn/plan/updated", {
      plan: [{ step: "新步骤", status: "completed" }],
    })

    expect(
      appendConversationLiveEvent(
        appendConversationLiveEvent([], first),
        latest
      )
    ).toEqual([latest])
  })

  it("keeps only the latest context usage snapshot", () => {
    const first = nativeEvent(1, "thread/tokenUsage/updated", {
      tokenUsage: tokenUsage(30, 258_000),
    })
    const latest = nativeEvent(2, "thread/tokenUsage/updated", {
      tokenUsage: tokenUsage(155_000, 258_000),
    })

    expect(
      appendConversationLiveEvent(
        appendConversationLiveEvent([], first),
        latest
      )
    ).toEqual([latest])
  })
})

function nativeEvent(
  sequence: number,
  method:
    | "item/started"
    | "item/agentMessage/delta"
    | "item/reasoning/summaryTextDelta"
    | "thread/tokenUsage/updated"
    | "turn/plan/updated",
  values: Record<string, unknown>
): ConversationEvent {
  const params = {
    threadId: "codex-thread-1",
    turnId: "codex-turn-1",
    ...values,
  }
  return {
    id: `conversation-1:${sequence}`,
    type: method,
    turn_id: TURN_ID,
    sequence_no: sequence,
    created_at: `2026-07-15T08:00:${String(sequence % 60).padStart(2, "0")}.000Z`,
    payload: {
      schema_version: 2,
      source: "codex_app_server",
      method,
      params,
    },
  }
}

function tokenUsage(totalTokens: number, modelContextWindow: number | null) {
  const usage = {
    totalTokens,
    inputTokens: totalTokens,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
  }
  return {
    total: usage,
    last: usage,
    modelContextWindow,
  }
}
