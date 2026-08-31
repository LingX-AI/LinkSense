import { describe, expect, it } from "vitest"

import {
  appendStreamingReasoningSummaryDelta,
  removeStreamingReasoningSummariesForTurn,
  removeStreamingReasoningSummaryItem,
  selectLatestStreamingReasoningSummary,
} from "@/features/conversations/streaming-reasoning-summaries"

describe("streaming reasoning summaries", () => {
  it("assembles interleaved native summary parts without losing word boundaries", () => {
    const first = appendStreamingReasoningSummaryDelta(
      {},
      update("reasoning-1", 0, "Evaluating ", 2)
    )
    const second = appendStreamingReasoningSummaryDelta(
      first,
      update("reasoning-1", 0, "test timing", 3)
    )
    const result = appendStreamingReasoningSummaryDelta(
      second,
      update("reasoning-1", 1, "Checking reliability", 4)
    )

    expect(
      selectLatestStreamingReasoningSummary(result, "turn-1")
    ).toMatchObject({
      itemId: "reasoning-1",
      summaryIndex: 1,
      text: "Checking reliability",
      sequence: 4,
    })
    expect(
      Object.values(result).find((summary) => summary.summaryIndex === 0)
    ).toMatchObject({ text: "Evaluating test timing" })
  })

  it("preserves Markdown block boundaries across streamed deltas", () => {
    const first = appendStreamingReasoningSummaryDelta(
      {},
      update("reasoning-1", 0, "## 方案\r\n\r\n1. **标题**", 2)
    )
    const result = appendStreamingReasoningSummaryDelta(
      first,
      update("reasoning-1", 0, "\r\n2. `内容`", 3)
    )

    expect(selectLatestStreamingReasoningSummary(result, "turn-1")?.text).toBe(
      "## 方案\n\n1. **标题**\n2. `内容`"
    )
  })

  it("ignores duplicate or stale deltas and bounds retained text", () => {
    const first = appendStreamingReasoningSummaryDelta(
      {},
      update("reasoning-1", 0, "initial", 2)
    )
    const duplicate = appendStreamingReasoningSummaryDelta(
      first,
      update("reasoning-1", 0, " duplicate", 2)
    )
    const bounded = appendStreamingReasoningSummaryDelta(
      duplicate,
      update("reasoning-1", 0, "x".repeat(5_000), 3)
    )

    expect(duplicate).toBe(first)
    expect(
      selectLatestStreamingReasoningSummary(bounded, "turn-1")?.text
    ).toHaveLength(4_000)
  })

  it("bounds the number of retained summary parts", () => {
    let result: ReturnType<typeof appendStreamingReasoningSummaryDelta> = {}
    for (let summaryIndex = 0; summaryIndex < 70; summaryIndex += 1) {
      result = appendStreamingReasoningSummaryDelta(
        result,
        update(
          "reasoning-1",
          summaryIndex,
          `Part ${summaryIndex}`,
          summaryIndex + 1
        )
      )
    }

    expect(Object.keys(result)).toHaveLength(64)
    expect(
      selectLatestStreamingReasoningSummary(result, "turn-1")
    ).toMatchObject({ summaryIndex: 69, text: "Part 69" })
    expect(
      Object.values(result).some((summary) => summary.summaryIndex === 0)
    ).toBe(false)
  })

  it("removes completed items and terminal turns independently", () => {
    const withFirst = appendStreamingReasoningSummaryDelta(
      {},
      update("reasoning-1", 0, "First", 2)
    )
    const withBoth = appendStreamingReasoningSummaryDelta(withFirst, {
      ...update("reasoning-2", 0, "Second", 3),
      turnId: "turn-2",
    })
    const withoutItem = removeStreamingReasoningSummaryItem(withBoth, {
      itemId: "reasoning-1",
      turnId: "turn-1",
    })

    expect(
      selectLatestStreamingReasoningSummary(withoutItem, "turn-1")
    ).toBeUndefined()
    expect(
      selectLatestStreamingReasoningSummary(withoutItem, "turn-2")?.text
    ).toBe("Second")
    expect(
      removeStreamingReasoningSummariesForTurn(withoutItem, "turn-2")
    ).toEqual({})
  })
})

function update(
  itemId: string,
  summaryIndex: number,
  delta: string,
  sequence: number
) {
  return {
    itemId,
    turnId: "turn-1",
    summaryIndex,
    delta,
    createdAt: `2026-07-15T08:00:0${sequence}.000Z`,
    sequence,
  }
}
