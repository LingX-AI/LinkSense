// @vitest-environment node

import { describe, expect, it, vi } from "vitest"
import type { ConversationEvent } from "@/api/contracts"
import {
  appendReasoningContentEvent,
  areReasoningContentEventsReconciled,
  removeReconciledReasoningContentEvents,
  selectReasoningActivities,
} from "./reasoning-activity-content"

function delta(
  sequence: number,
  text: string,
  contentIndex = 0,
  turnId = "turn-1"
): ConversationEvent {
  return {
    id: `event-${sequence}`,
    type: "item/reasoning/textDelta",
    turn_id: turnId,
    sequence_no: sequence,
    created_at: "2026-10-19T00:00:00.000Z",
    payload: {
      schema_version: 2,
      source: "codex_app_server",
      method: "item/reasoning/textDelta",
      params: {
        threadId: "native-thread",
        turnId: "native-turn",
        itemId: "reasoning-1",
        delta: text,
        contentIndex,
      },
    },
  }
}

function snapshot(sequence: number, content?: string[]): ConversationEvent {
  return {
    ...delta(sequence, ""),
    type: "item/completed",
    payload: {
      schema_version: 2,
      source: "codex_app_server",
      method: "item/completed",
      params: {
        threadId: "native-thread",
        turnId: "native-turn",
        item: {
          type: "reasoning",
          id: "reasoning-1",
          summary: ["Short summary"],
          ...(content ? { content } : {}),
        },
      },
    },
  }
}

describe("complete reasoning content", () => {
  it("does not rescan retained bodies when the ordered stream appends a new delta", () => {
    const readPayload = vi.fn()
    const live = Array.from({ length: 2_000 }, (_, index) => {
      const event = delta(index + 1, "Text")
      const payload = event.payload
      return {
        ...event,
        get payload() {
          readPayload()
          return payload
        },
      }
    })
    const next = delta(2_001, "Next")
    const appended = appendReasoningContentEvent(live, next)
    expect(appended).toHaveLength(2_001)
    expect(appended.at(-1)).toBe(next)
    expect(readPayload).not.toHaveBeenCalled()
    // An older replay still takes the full deduplication path.
    expect(appendReasoningContentEvent(appended, delta(1, "Text"))).toBe(
      appended
    )
  })

  it("releases persisted live events during execution without discarding pending text or other turns", () => {
    const live = [
      delta(1, "First"),
      delta(2, "Second"),
      delta(3, "Pending"),
      delta(4, "Other", 0, "turn-2"),
    ]
    expect(removeReconciledReasoningContentEvents(live, [])).toBe(live)
    const retained = removeReconciledReasoningContentEvents(live, [
      live[0]!,
      live[1]!,
    ])
    expect(retained).toEqual(live.slice(2))
    expect(
      selectReasoningActivities("turn-1", retained, live.slice(0, 2))[0]
        ?.content
    ).toBe("FirstSecondPending")
    const completed = snapshot(3, ["Authoritative body"])
    expect(removeReconciledReasoningContentEvents(live, [completed])).toEqual([
      live[3],
    ])
    expect(
      removeReconciledReasoningContentEvents(live, [
        { ...completed, turn_id: "different-turn" },
      ])
    ).toBe(live)
    expect(
      selectReasoningActivities(
        "turn-1",
        removeReconciledReasoningContentEvents(live, [completed]),
        [completed]
      )[0]?.content
    ).toBe("Authoritative body")
  })

  it("releases live content only after history contains its deltas or authoritative completion", () => {
    const first = delta(1, "First"),
      second = delta(2, "Second"),
      completed = snapshot(3, ["Complete body"])
    expect(areReasoningContentEventsReconciled([], [])).toBe(true)
    expect(areReasoningContentEventsReconciled([first, second], [first])).toBe(
      false
    )
    expect(
      areReasoningContentEventsReconciled([first, second], [first, second])
    ).toBe(true)
    expect(
      areReasoningContentEventsReconciled([first, completed], [first])
    ).toBe(false)
    expect(
      areReasoningContentEventsReconciled([first, completed], [completed])
    ).toBe(true)
    expect(
      areReasoningContentEventsReconciled(
        [first, completed],
        [{ ...completed, turn_id: "other-turn" }]
      )
    ).toBe(false)
  })

  it("keeps every paragraph beyond the summary limit and orders native content parts", () => {
    const first = "Beginning\r\n\r\n" + "长正文".repeat(3_000)
    const events = [
      delta(1, first),
      delta(2, "Third", 2),
      delta(3, "Second", 1),
      delta(4, " ending"),
    ]
    expect(selectReasoningActivities("turn-1", events, [])[0]?.content).toBe(
      `${first} ending\n\nSecond\n\nThird`
    )
  })

  it("merges refreshed history and replayed live deltas once, with an authoritative completed snapshot", () => {
    const one = delta(1, "First"),
      two = delta(2, " second"),
      three = delta(3, " third")
    expect(
      selectReasoningActivities("turn-1", [two, three, three], [one, two])[0]
        ?.content
    ).toBe("First second third")
    expect(
      selectReasoningActivities(
        "turn-1",
        [two, three],
        [one, snapshot(4, ["Final", "Body"])]
      )
    ).toMatchObject([{ sequence: 1, content: "Final\n\nBody", running: false }])
  })

  it("keeps partial interrupted content through a reload and isolates other turns", () => {
    const events = [
      delta(1, "Partial body"),
      delta(2, "Other turn", 0, "turn-2"),
    ]
    expect(selectReasoningActivities("turn-1", [], events)).toMatchObject([
      { content: "Partial body" },
    ])
    expect(selectReasoningActivities("missing-turn", events, [])).toEqual([])
  })

  it("does not substitute summaries for absent or empty full content", () => {
    for (const event of [snapshot(1), snapshot(2, [])]) {
      expect(selectReasoningActivities("turn-1", [], [event])).toMatchObject([
        { content: "", running: false },
      ])
    }
  })

  it("retains pending content beyond the tool event limit and compacts only after native completion", () => {
    let live: ConversationEvent[] = []
    for (let index = 1; index <= 250; index++)
      live = appendReasoningContentEvent(live, delta(index, `${index},`))
    expect(selectReasoningActivities("turn-1", live, [])[0]?.content).toBe(
      Array.from({ length: 250 }, (_, i) => `${i + 1},`).join("")
    )
    expect(appendReasoningContentEvent(live, delta(250, "250,"))).toBe(live)
    live = appendReasoningContentEvent(live, snapshot(251, ["Complete body"]))
    expect(live).toHaveLength(2)
    expect(selectReasoningActivities("turn-1", live, [])).toMatchObject([
      { content: "Complete body", sequence: 1, running: false },
    ])
    expect(appendReasoningContentEvent(live, delta(200, "Old replay"))).toBe(
      live
    )
  })
})
