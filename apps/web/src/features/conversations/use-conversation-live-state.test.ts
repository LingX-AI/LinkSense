import { act, renderHook } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { useConversationLiveState } from "@/features/conversations/use-conversation-live-state"

const firstConversationId = "conversation-1"
const secondConversationId = "conversation-2"

describe("useConversationLiveState", () => {
  it("preserves and isolates every live projection while switching conversations", () => {
    const { result } = renderHook(() =>
      useConversationLiveState(firstConversationId)
    )
    const streamedMessage = {
      id: "message-1",
      role: "assistant" as const,
      content: "partial response",
      item_id: "item-1",
      last_applied_sequence_no: 1,
    }
    const reasoningSummary = {
      itemId: "reasoning-1",
      turnId: "turn-1",
      summaryIndex: 0,
      text: "reasoning",
      createdAt: "2026-09-04T08:00:00.000Z",
      sequence: 2,
    }
    const activity = { id: "activity-1", type: "tool_started" }
    const event = {
      id: "event-1",
      type: "item/started",
      turn_id: "turn-1",
      payload: {},
      created_at: "2026-09-04T08:00:01.000Z",
      sequence_no: 3,
    }

    act(() => {
      result.current.setStreamedMessages({ "item-1": streamedMessage })
      result.current.setReasoningSummaries({
        "reasoning-1": reasoningSummary,
      })
      result.current.setActivities([activity])
      result.current.setEvents([event])
    })

    act(() => result.current.switchConversation(secondConversationId))

    expect(result.current.conversationId).toBe(secondConversationId)
    expect(result.current.streamedMessages).toEqual({})
    expect(result.current.reasoningSummaries).toEqual({})
    expect(result.current.activities).toEqual([])
    expect(result.current.events).toEqual([])

    act(() => {
      result.current.setStreamedMessages({
        "item-2": {
          ...streamedMessage,
          id: "message-2",
          item_id: "item-2",
          content: "another response",
        },
      })
      result.current.switchConversation(firstConversationId)
    })

    expect(result.current.conversationId).toBe(firstConversationId)
    expect(result.current.streamedMessages).toEqual({
      "item-1": streamedMessage,
    })
    expect(result.current.reasoningSummaries).toEqual({
      "reasoning-1": reasoningSummary,
    })
    expect(result.current.activities).toEqual([activity])
    expect(result.current.events).toEqual([event])
    expect(result.current.hasConversationLiveState(firstConversationId)).toBe(
      true
    )

    act(() => {
      result.current.setStreamedMessages((current) => ({
        ...current,
        "item-1": {
          ...current["item-1"],
          content: `${current["item-1"]?.content} continued`,
          last_applied_sequence_no: 4,
        },
      }))
    })

    expect(result.current.streamedMessages["item-1"]?.content).toBe(
      "partial response continued"
    )

    act(() => result.current.switchConversation(secondConversationId))

    expect(result.current.streamedMessages["item-2"]?.content).toBe(
      "another response"
    )
    expect(result.current.streamedMessages["item-1"]).toBeUndefined()
    expect(result.current.hasConversationLiveState(secondConversationId)).toBe(
      true
    )

    act(() => result.current.clearConversationLiveState(firstConversationId))

    expect(result.current.streamedMessages["item-2"]?.content).toBe(
      "another response"
    )
    expect(result.current.hasConversationLiveState(firstConversationId)).toBe(
      false
    )
  })

  it("promotes placeholder live state to the persisted conversation id", () => {
    const { result } = renderHook(() => useConversationLiveState("new-task"))

    act(() => {
      result.current.setStreamedMessages({
        "item-1": {
          id: "message-1",
          role: "assistant",
          content: "response received before task creation completed",
          item_id: "item-1",
          last_applied_sequence_no: 1,
        },
      })
      result.current.promoteConversation("new-task", firstConversationId)
    })

    expect(result.current.conversationId).toBe(firstConversationId)
    expect(result.current.streamedMessages["item-1"]?.content).toBe(
      "response received before task creation completed"
    )

    act(() => result.current.switchConversation(secondConversationId))
    act(() => result.current.switchConversation(firstConversationId))

    expect(result.current.streamedMessages["item-1"]?.content).toBe(
      "response received before task creation completed"
    )
  })
})
