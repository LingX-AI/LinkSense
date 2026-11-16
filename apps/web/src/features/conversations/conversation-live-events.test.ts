// @vitest-environment node

import { describe, expect, it } from "vitest"

import type { ConversationEvent } from "@/api/contracts"
import {
  appendConversationLiveEvent,
  isStreamOnlyNativeEvent,
} from "@/features/conversations/conversation-live-events"
import { selectConversationTurnPlan } from "@/features/conversations/conversation-plan-selector"

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
    const fullReasoning = nativeEvent(254, "item/reasoning/textDelta", {
      itemId: "reasoning-1",
      contentIndex: 0,
      delta: "Complete reasoning body",
    })
    expect(isStreamOnlyNativeEvent(fullReasoning)).toBe(true)
    retained = appendConversationLiveEvent(retained, fullReasoning)

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

  it("keeps live plan progress after a long tool sequence instead of reverting to the initial detail snapshot", () => {
    const initial = nativeEvent(1, "turn/plan/updated", {
      plan: [
        { step: "Inspect", status: "inProgress" },
        { step: "Implement", status: "pending" },
        { step: "Verify", status: "pending" },
      ],
    })
    const latest = nativeEvent(2, "turn/plan/updated", {
      plan: [
        { step: "Inspect", status: "completed" },
        { step: "Implement", status: "completed" },
        { step: "Verify", status: "inProgress" },
      ],
    })
    let retained = appendConversationLiveEvent([], latest)

    for (let sequence = 3; sequence <= 253; sequence += 1) {
      retained = appendConversationLiveEvent(retained, toolEvent(sequence))
    }

    expect(
      selectConversationTurnPlan([initial, ...retained], TURN_ID)
    ).toMatchObject({
      currentStepIndex: 2,
      completedCount: 2,
      sourceEventId: latest.id,
    })
    expect(retained).toHaveLength(200)
    expect(retained).toContainEqual(latest)
    expect(retained).toContainEqual(toolEvent(253))
    expect(retained).not.toContainEqual(toolEvent(3))
  })

  it("does not let a replayed older plan replace the latest snapshot for the same turn", () => {
    const older = nativeEvent(1, "turn/plan/updated", {
      plan: [{ step: "Inspect", status: "inProgress" }],
    })
    const latest = nativeEvent(3, "turn/plan/updated", {
      plan: [{ step: "Verify", status: "inProgress" }],
    })
    const retained = appendConversationLiveEvent([], latest)

    expect(appendConversationLiveEvent(retained, older)).toEqual([latest])
  })

  it("preserves an empty latest plan during long tool sequences without reviving its previous steps", () => {
    const initial = nativeEvent(1, "turn/plan/updated", {
      plan: [{ step: "Obsolete step", status: "inProgress" }],
    })
    const cleared = nativeEvent(2, "turn/plan/updated", { plan: [] })
    let retained = appendConversationLiveEvent([], cleared)

    for (let sequence = 3; sequence <= 203; sequence += 1) {
      retained = appendConversationLiveEvent(retained, toolEvent(sequence))
    }

    expect(
      selectConversationTurnPlan([initial, ...retained], TURN_ID)
    ).toMatchObject({ steps: [], sourceEventId: cleared.id })
  })

  it("preserves separate turn plans within the bounded event window", () => {
    const first = nativeEvent(1, "turn/plan/updated", {
      plan: [{ step: "First turn", status: "completed" }],
    })
    const second = {
      ...nativeEvent(2, "turn/plan/updated", {
        plan: [{ step: "Second turn", status: "inProgress" }],
      }),
      turn_id: "40000000-0000-4000-8000-000000000002",
    }
    let retained = appendConversationLiveEvent([first], second)

    for (let sequence = 3; sequence <= 203; sequence += 1) {
      retained = appendConversationLiveEvent(retained, toolEvent(sequence))
    }

    expect(retained).toHaveLength(200)
    expect(retained.slice(0, 2)).toEqual([first, second])
    expect(retained.at(-1)).toEqual(toolEvent(203))
  })

  it("keeps the event cache bounded even when every event is a different turn plan", () => {
    let retained: ConversationEvent[] = []
    for (let sequence = 1; sequence <= 205; sequence += 1) {
      retained = appendConversationLiveEvent(retained, {
        ...nativeEvent(sequence, "turn/plan/updated", { plan: [] }),
        turn_id: `local-turn-${sequence}`,
      })
    }

    expect(retained).toHaveLength(200)
    expect(retained[0]?.sequence_no).toBe(6)
    expect(retained.at(-1)?.sequence_no).toBe(205)
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

function toolEvent(sequence: number): ConversationEvent {
  return nativeEvent(sequence, "item/started", {
    item: {
      type: "commandExecution",
      id: `command-${sequence}`,
      status: "inProgress",
      commandActions: [],
    },
  })
}

function nativeEvent(
  sequence: number,
  method:
    | "item/started"
    | "item/agentMessage/delta"
    | "item/reasoning/summaryTextDelta"
    | "item/reasoning/textDelta"
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
