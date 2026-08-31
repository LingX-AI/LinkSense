import { describe, expect, it } from "vitest"

import type { ConversationEvent } from "@/api/contracts"
import {
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
