// @vitest-environment node

import { describe, expect, it } from "vitest"

import type { ConversationEvent } from "@/api/contracts"
import {
  extractReasoningActivityText,
  selectReasoningActivitySummary,
} from "@/features/conversations/reasoning-activity-summary"
import { appendStreamingReasoningSummaryDelta } from "@/features/conversations/streaming-reasoning-summaries"

function reasoningEvent(
  sequence: number,
  summary: string[],
  turnId = "turn-1"
): ConversationEvent {
  return {
    id: `event-${sequence}`,
    type: "item/completed",
    turn_id: turnId,
    sequence_no: sequence,
    created_at: "2026-09-07T08:00:00.000Z",
    payload: {
      schema_version: 2,
      source: "codex_app_server",
      method: "item/completed",
      params: {
        threadId: "native-thread",
        turnId: "native-turn",
        item: { type: "reasoning", id: "reasoning-1", summary },
      },
    },
  }
}

describe("reasoning activity text", () => {
  it.each([
    ["**Comparing URL parsing options**", "Comparing URL parsing options"],
    ["## 正在核对结果", "正在核对结果"],
    ["Earlier step\n\n**Latest step**\n\n", "Latest step"],
    [
      "Checking `URL` and [options](https://example.com)",
      "Checking URL and options",
    ],
    ["Checking &amp; comparing", "Checking & comparing"],
    ["检查结果\n<!-- hidden metadata\nstill hidden -->", "检查结果"],
    ["检查结果\n<!-- unfinished metadata", "检查结果"],
    ["检查结果\n<!-", "检查结果"],
    ["<", null],
    ["<!-- metadata -->\n\n", null],
    ["\r\n  \t", null],
  ])("extracts the latest readable text from %j", (input, expected) => {
    expect(extractReasoningActivityText(input)).toBe(expected)
  })

  it("selects the latest readable part for this turn without letting empty parts erase it", () => {
    let summaries = {}
    for (const [summaryIndex, delta] of [
      "Earlier",
      "**Latest**",
      "<!-- hidden -->",
    ].entries()) {
      summaries = appendStreamingReasoningSummaryDelta(summaries, {
        itemId: "reasoning-1",
        turnId: "turn-1",
        summaryIndex,
        delta,
        sequence: summaryIndex + 1,
        createdAt: "2026-09-07T08:00:00.000Z",
      })
    }
    summaries = appendStreamingReasoningSummaryDelta(summaries, {
      itemId: "another-item",
      turnId: "another-turn",
      summaryIndex: 0,
      delta: "Another turn",
      sequence: 20,
      createdAt: "2026-09-07T08:00:00.000Z",
    })
    expect(selectReasoningActivitySummary("turn-1", summaries, [])?.text).toBe(
      "Latest"
    )
    expect(selectReasoningActivitySummary("missing", summaries, [])).toBeNull()
  })

  it("uses the completed summary after the live item is removed and ignores old live deltas", () => {
    const live = appendStreamingReasoningSummaryDelta(
      {},
      {
        itemId: "reasoning-1",
        turnId: "turn-1",
        summaryIndex: 0,
        delta: "Streaming",
        sequence: 2,
        createdAt: "2026-09-07T08:00:00.000Z",
      }
    )
    const events = [reasoningEvent(5, ["Earlier", "**Completed summary**"])]
    expect(selectReasoningActivitySummary("turn-1", live, events)?.text).toBe(
      "Completed summary"
    )
    expect(selectReasoningActivitySummary("turn-1", {}, events)?.text).toBe(
      "Completed summary"
    )
    expect(
      selectReasoningActivitySummary("turn-1", live, [reasoningEvent(5, [])])
    ).toBeNull()
  })

  it("prefers new live reasoning over completed history and isolates native turns", () => {
    const live = appendStreamingReasoningSummaryDelta(
      {},
      {
        itemId: "reasoning-2",
        turnId: "turn-1",
        summaryIndex: 0,
        delta: "New step",
        sequence: 8,
        createdAt: "2026-09-07T08:00:00.000Z",
      }
    )
    const events = [
      reasoningEvent(20, ["Another turn"], "turn-2"),
      reasoningEvent(5, ["Old step"]),
    ]
    expect(selectReasoningActivitySummary("turn-1", live, events)?.text).toBe(
      "New step"
    )
  })
})
