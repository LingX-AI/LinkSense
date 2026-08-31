import { describe, expect, it } from "vitest"

import type { ConversationEvent } from "@/api/contracts"
import { selectConversationTurnPlan } from "@/features/conversations/conversation-plan-selector"

const LOCAL_TURN_ID = "local-turn-1"

function planEvent({
  id,
  sequence,
  steps,
  turnId = LOCAL_TURN_ID,
}: {
  id: string
  sequence: number
  steps: Array<{
    step: string
    status: "pending" | "inProgress" | "completed" | "failed"
  }>
  turnId?: string
}): ConversationEvent {
  return {
    id,
    type: "turn/plan/updated",
    turn_id: turnId,
    sequence_no: sequence,
    created_at: `2026-07-14T08:00:${String(sequence).padStart(2, "0")}.000Z`,
    payload: {
      schema_version: 2,
      source: "codex_app_server",
      method: "turn/plan/updated",
      params: {
        threadId: "codex-thread-1",
        turnId: "codex-turn-1",
        plan: steps,
      },
    },
  }
}

function fileChangeEvent({
  id,
  itemId,
  sequence,
  method = "item/completed",
  paths,
  turnId = LOCAL_TURN_ID,
}: {
  id: string
  itemId: string
  sequence: number
  method?: "item/started" | "item/completed"
  paths: Array<string | undefined>
  turnId?: string
}): ConversationEvent {
  return {
    id,
    type: method,
    turn_id: turnId,
    sequence_no: sequence,
    created_at: `2026-07-14T08:01:${String(sequence).padStart(2, "0")}.000Z`,
    payload: {
      schema_version: 2,
      source: "codex_app_server",
      method,
      params: {
        threadId: "codex-thread-1",
        turnId: "codex-turn-1",
        item: {
          type: "fileChange",
          id: itemId,
          status: method === "item/completed" ? "completed" : "inProgress",
          changes: paths.map((path) => ({
            kind: { type: "update" },
            ...(path ? { path } : {}),
          })),
        },
      },
    },
  }
}

describe("selectConversationTurnPlan", () => {
  it("isolates the local turn, orders events and uses the latest full snapshot", () => {
    const older = planEvent({
      id: "plan-old",
      sequence: 2,
      steps: [
        { step: "Inspect", status: "inProgress" },
        { step: "Implement", status: "pending" },
      ],
    })
    const latest = planEvent({
      id: "plan-latest",
      sequence: 8,
      steps: [
        { step: "Inspect", status: "completed" },
        { step: "Test", status: "inProgress" },
        { step: "Deliver", status: "pending" },
      ],
    })
    const staleDuplicate = planEvent({
      id: "plan-latest",
      sequence: 4,
      steps: [{ step: "Stale duplicate", status: "inProgress" }],
    })
    const otherTurn = planEvent({
      id: "other-turn-plan",
      sequence: 100,
      turnId: "local-turn-2",
      steps: [{ step: "Other turn", status: "inProgress" }],
    })
    const invalidLatest = planEvent({
      id: "invalid-plan",
      sequence: 12,
      steps: [{ step: "Invalid status", status: "failed" }],
    })

    const result = selectConversationTurnPlan(
      [latest, otherTurn, older, invalidLatest, staleDuplicate],
      LOCAL_TURN_ID
    )

    expect(result).toEqual({
      turnId: LOCAL_TURN_ID,
      steps: [
        { step: "Inspect", status: "completed" },
        { step: "Test", status: "inProgress" },
        { step: "Deliver", status: "pending" },
      ],
      currentStepIndex: 1,
      completedCount: 1,
      total: 3,
      changedFileCount: 0,
      sourceEventId: "plan-latest",
      sequenceNo: 8,
    })
  })

  it("collapses each file-change lifecycle and counts unique safe paths", () => {
    const result = selectConversationTurnPlan(
      [
        fileChangeEvent({
          id: "file-1-completed",
          itemId: "file-item-1",
          sequence: 7,
          paths: ["$WORKSPACE/a.ts", "$WORKSPACE/b.ts"],
        }),
        fileChangeEvent({
          id: "file-2-completed",
          itemId: "file-item-2",
          sequence: 8,
          paths: ["$WORKSPACE/b.ts", "$WORKSPACE/c.ts", undefined],
        }),
        fileChangeEvent({
          id: "file-1-started",
          itemId: "file-item-1",
          method: "item/started",
          sequence: 3,
          paths: ["$WORKSPACE/obsolete.ts"],
        }),
        fileChangeEvent({
          id: "file-2-completed",
          itemId: "file-item-2",
          sequence: 4,
          paths: ["$WORKSPACE/stale-duplicate.ts"],
        }),
        fileChangeEvent({
          id: "other-turn-file",
          itemId: "file-item-other",
          sequence: 20,
          turnId: "local-turn-2",
          paths: ["$WORKSPACE/other.ts"],
        }),
        planEvent({
          id: "plan",
          sequence: 1,
          steps: [{ step: "Implement", status: "inProgress" }],
        }),
      ],
      LOCAL_TURN_ID
    )

    expect(result?.changedFileCount).toBe(3)
  })

  it("falls back to the first pending step and then the final completed step", () => {
    const pendingResult = selectConversationTurnPlan(
      [
        planEvent({
          id: "plan-pending",
          sequence: 1,
          steps: [
            { step: "Inspect", status: "completed" },
            { step: "Implement", status: "pending" },
            { step: "Test", status: "pending" },
          ],
        }),
      ],
      LOCAL_TURN_ID
    )
    const completedResult = selectConversationTurnPlan(
      [
        planEvent({
          id: "plan-completed",
          sequence: 1,
          steps: [
            { step: "Inspect", status: "completed" },
            { step: "Implement", status: "completed" },
          ],
        }),
      ],
      LOCAL_TURN_ID
    )

    expect(pendingResult?.currentStepIndex).toBe(1)
    expect(pendingResult?.completedCount).toBe(1)
    expect(completedResult?.currentStepIndex).toBe(1)
    expect(completedResult?.completedCount).toBe(2)
  })

  it("preserves an empty latest snapshot without inventing a current step", () => {
    const result = selectConversationTurnPlan(
      [
        planEvent({
          id: "plan-with-steps",
          sequence: 1,
          steps: [{ step: "Old step", status: "completed" }],
        }),
        planEvent({ id: "plan-empty", sequence: 2, steps: [] }),
      ],
      LOCAL_TURN_ID
    )

    expect(result).toMatchObject({
      steps: [],
      currentStepIndex: null,
      completedCount: 0,
      total: 0,
      sourceEventId: "plan-empty",
    })
  })

  it("returns null when the turn has no valid native plan snapshot", () => {
    const result = selectConversationTurnPlan(
      [
        fileChangeEvent({
          id: "file-only",
          itemId: "file-item",
          sequence: 1,
          paths: ["$WORKSPACE/a.ts"],
        }),
      ],
      LOCAL_TURN_ID
    )

    expect(result).toBeNull()
  })
})
