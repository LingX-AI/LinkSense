// @vitest-environment node

import { describe, expect, it } from "vitest"

import { isConversationContextCompactionAvailable } from "./conversation-context-compaction"

describe("conversation context compaction availability", () => {
  it.each(["completed", "failed", "interrupted"] as const)(
    "allows compaction after a %s task stops",
    (latestTurnStatus) => {
      expect(
        isConversationContextCompactionAvailable({
          isNew: false,
          archived: false,
          latestTurnStatus,
          turnExecutionActive: false,
        })
      ).toBe(true)
    }
  )

  it("rejects compaction while a turn is still active", () => {
    expect(
      isConversationContextCompactionAvailable({
        isNew: false,
        archived: false,
        latestTurnStatus: "running",
        turnExecutionActive: true,
      })
    ).toBe(false)
  })

  it("rejects compaction for new or archived conversations", () => {
    expect(
      isConversationContextCompactionAvailable({
        isNew: true,
        archived: false,
        latestTurnStatus: undefined,
        turnExecutionActive: false,
      })
    ).toBe(false)
    expect(
      isConversationContextCompactionAvailable({
        isNew: false,
        archived: true,
        latestTurnStatus: "interrupted",
        turnExecutionActive: false,
      })
    ).toBe(false)
  })
})
