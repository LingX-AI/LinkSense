import { describe, expect, it } from "vitest"

import type { ConversationEvent } from "@/api/contracts"
import {
  selectContextCompactionSavedTokens,
  selectConversationModelContextUsage,
  selectLatestConversationModelContextUsage,
} from "@/features/conversations/conversation-context-usage"

describe("selectLatestConversationModelContextUsage", () => {
  it("selects the latest native token usage event", () => {
    expect(
      selectLatestConversationModelContextUsage([
        tokenUsageEvent({
          id: "event-1",
          sequenceNo: 1,
          turnId: "turn-1",
          cumulativeTokens: 320_000,
          lastTokens: 100_000,
          modelContextWindow: 258_000,
        }),
        tokenUsageEvent({
          id: "event-2",
          sequenceNo: 2,
          turnId: "turn-2",
          cumulativeTokens: 475_000,
          lastTokens: 155_000,
          modelContextWindow: 258_000,
        }),
      ])
    ).toEqual({
      turnId: "turn-2",
      usedTokens: 155_000,
      modelContextWindow: 258_000,
    })
  })

  it("ignores non-token-usage native events", () => {
    expect(
      selectLatestConversationModelContextUsage([
        {
          id: "event-1",
          type: "turn/completed",
          turn_id: "turn-1",
          created_at: "2026-08-15T00:00:00.000Z",
          sequence_no: 1,
          payload: {
            schema_version: 2,
            source: "codex_app_server",
            method: "turn/completed",
            params: {
              threadId: "thread-1",
              turn: {
                id: "turn-1",
                status: "completed",
                items: [],
                error: null,
              },
            },
          },
        },
      ])
    ).toBeNull()
  })

  it("uses a durable usage snapshot when no token usage event exists", () => {
    expect(
      selectConversationModelContextUsage([], {
        used_tokens: 39_021,
        model_context_window: 142_500,
      })
    ).toEqual({
      turnId: null,
      usedTokens: 39_021,
      modelContextWindow: 142_500,
    })
  })

  it("prefers the latest token usage event over a durable snapshot", () => {
    expect(
      selectConversationModelContextUsage(
        [
          tokenUsageEvent({
            id: "event-1",
            sequenceNo: 1,
            turnId: "turn-1",
            cumulativeTokens: 364_043,
            lastTokens: 49_648,
            modelContextWindow: 258_000,
          }),
        ],
        {
          used_tokens: 39_021,
          model_context_window: 142_500,
        }
      )
    ).toEqual({
      turnId: "turn-1",
      usedTokens: 49_648,
      modelContextWindow: 258_000,
    })
  })
})

function tokenUsageEvent({
  id,
  sequenceNo,
  turnId,
  cumulativeTokens,
  lastTokens,
  modelContextWindow,
}: {
  id: string
  sequenceNo: number
  turnId: string
  cumulativeTokens: number
  lastTokens: number
  modelContextWindow: number | null
}): ConversationEvent {
  const total = {
    totalTokens: cumulativeTokens,
    inputTokens: cumulativeTokens,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
  }
  const last = {
    totalTokens: lastTokens,
    inputTokens: lastTokens,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
  }
  return {
    id,
    type: "thread/tokenUsage/updated",
    turn_id: turnId,
    created_at: "2026-08-15T00:00:00.000Z",
    sequence_no: sequenceNo,
    payload: {
      schema_version: 2,
      source: "codex_app_server",
      method: "thread/tokenUsage/updated",
      params: {
        threadId: "thread-1",
        turnId,
        tokenUsage: {
          total,
          last,
          modelContextWindow,
        },
      },
    },
  }
}

function compactionItemEvent({
  id,
  sequenceNo,
  method,
  itemId = "context-compaction-1",
}: {
  id: string
  sequenceNo: number
  method: "item/started" | "item/completed"
  itemId?: string
}): ConversationEvent {
  return {
    id,
    type: method,
    turn_id: "turn-1",
    sequence_no: sequenceNo,
    created_at: "2026-08-15T00:00:00.000Z",
    payload: {
      schema_version: 2,
      source: "codex_app_server",
      method,
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        item: { id: itemId, type: "contextCompaction" },
      },
    },
  }
}

describe("selectContextCompactionSavedTokens", () => {
  const itemId = "context-compaction-1"
  const beforeCompaction = tokenUsageEvent({
    id: "usage-before",
    sequenceNo: 1,
    turnId: "turn-1",
    cumulativeTokens: 508_329,
    lastTokens: 440_528,
    modelContextWindow: 258_000,
  })
  const compactionRequest = tokenUsageEvent({
    id: "usage-compaction-request",
    sequenceNo: 3,
    turnId: "turn-1",
    cumulativeTokens: 512_688,
    lastTokens: 435_922,
    modelContextWindow: 258_000,
  })
  const afterCompaction = tokenUsageEvent({
    id: "usage-after",
    sequenceNo: 4,
    turnId: "turn-1",
    cumulativeTokens: 512_688,
    lastTokens: 37_261,
    modelContextWindow: 258_000,
  })

  it("reports the tokens the compaction saved", () => {
    expect(
      selectContextCompactionSavedTokens(
        [
          beforeCompaction,
          compactionItemEvent({
            id: "compaction-started",
            sequenceNo: 2,
            method: "item/started",
          }),
          compactionRequest,
          afterCompaction,
          compactionItemEvent({
            id: "compaction-completed",
            sequenceNo: 5,
            method: "item/completed",
          }),
        ],
        itemId
      )
    ).toBe(403_267)
  })

  it("ignores context growth after the compaction", () => {
    expect(
      selectContextCompactionSavedTokens(
        [
          beforeCompaction,
          compactionItemEvent({
            id: "compaction-started",
            sequenceNo: 2,
            method: "item/started",
          }),
          afterCompaction,
          tokenUsageEvent({
            id: "usage-later",
            sequenceNo: 5,
            turnId: "turn-1",
            cumulativeTokens: 560_000,
            lastTokens: 90_000,
            modelContextWindow: 258_000,
          }),
        ],
        itemId
      )
    ).toBe(403_267)
  })

  it("ignores sizes reported for a later compaction", () => {
    expect(
      selectContextCompactionSavedTokens(
        [
          beforeCompaction,
          compactionItemEvent({
            id: "compaction-started",
            sequenceNo: 2,
            method: "item/started",
          }),
          afterCompaction,
          compactionItemEvent({
            id: "compaction-completed",
            sequenceNo: 5,
            method: "item/completed",
          }),
          compactionItemEvent({
            id: "next-compaction-started",
            sequenceNo: 6,
            method: "item/started",
            itemId: "context-compaction-2",
          }),
          tokenUsageEvent({
            id: "usage-after-next-compaction",
            sequenceNo: 7,
            turnId: "turn-2",
            cumulativeTokens: 520_000,
            lastTokens: 900,
            modelContextWindow: 258_000,
          }),
        ],
        itemId
      )
    ).toBe(403_267)
  })

  it("returns null when no size is reported after the compaction started", () => {
    expect(
      selectContextCompactionSavedTokens(
        [
          beforeCompaction,
          compactionItemEvent({
            id: "compaction-started",
            sequenceNo: 2,
            method: "item/started",
          }),
        ],
        itemId
      )
    ).toBeNull()
  })

  it("returns null when the context did not shrink", () => {
    expect(
      selectContextCompactionSavedTokens(
        [
          beforeCompaction,
          compactionItemEvent({
            id: "compaction-started",
            sequenceNo: 2,
            method: "item/started",
          }),
          tokenUsageEvent({
            id: "usage-larger",
            sequenceNo: 3,
            turnId: "turn-1",
            cumulativeTokens: 512_688,
            lastTokens: 460_000,
            modelContextWindow: 258_000,
          }),
        ],
        itemId
      )
    ).toBeNull()
  })

  it("returns null without a compaction item id", () => {
    expect(
      selectContextCompactionSavedTokens([beforeCompaction], undefined)
    ).toBeNull()
  })
})
