// @vitest-environment node
import { describe, expect, it } from "vitest"
import { conversationSchema, type Conversation } from "@/api/contracts"
import { mergeConversationHistory } from "@/features/conversations/conversation-history"

function page(turnIds: number[], allIds = [1, 2, 3, 4]): Conversation {
  return conversationSchema.parse({
    category_id: null,
    id: "task",
    title: "History",
    updated_at: "2026-09-07T00:00:00Z",
    history: {
      scope_id: "turn-1",
      turn_ids: turnIds.map((id) => `turn-${id}`),
      index: allIds.map((id) => ({
        turn_id: `turn-${id}`,
        sequence_no: id,
        message_id: `message-${id}`,
        created_at: "2026-09-07T00:00:00Z",
        has_content: true,
      })),
    },
    turns: allIds.map((id) => ({
      id: `turn-${id}`,
      status: "completed",
      sequence_no: id,
    })),
    messages: turnIds.map((id) => ({
      id: `message-${id}`,
      turn_id: `turn-${id}`,
      sequence_no: id,
      role: "user",
      content: `Question ${id}`,
    })),
    last_event_id: `task:${turnIds.at(-1)}`,
  })
}

describe("conversation history cache", () => {
  it("retains sparse windows across refreshes while the full index represents unloaded gaps", () => {
    const result = mergeConversationHistory(page([1], [1]), page([4]), "latest")
    expect(result.messages?.map((message) => message.sequence_no)).toEqual([
      1, 4,
    ])
    expect(result.history?.index).toHaveLength(4)
    expect(result.history?.turn_ids).toEqual(["turn-1", "turn-4"])
  })
  it("loads a distant page without replacing execution state, global index, or replay cursor", () => {
    const latest = { ...page([3, 4]), execution_status: "running" as const }
    const result = mergeConversationHistory(
      latest,
      { ...page([1, 2]), execution_status: "idle" },
      "older"
    )
    expect(result.messages?.map((message) => message.sequence_no)).toEqual([
      1, 2, 3, 4,
    ])
    expect(result.last_event_id).toBe("task:4")
    expect(result.execution_status).toBe("running")
    expect(result.history?.index).toEqual(latest.history?.index)
  })
  it("retains loaded pages but replaces authoritative messages on refresh", () => {
    const current = mergeConversationHistory(
      page([3, 4]),
      page([1, 2]),
      "older"
    )
    const refreshed = page([3, 4])
    refreshed.messages = refreshed.messages?.filter(
      (message) => message.sequence_no !== 3
    )
    expect(
      mergeConversationHistory(current, refreshed, "latest").messages?.map(
        (message) => message.sequence_no
      )
    ).toEqual([1, 2, 4])
  })
  it("removes replaced turns and rejects late pages from another scope", () => {
    const old = page([1, 2, 3, 4])
    const latest = page([4], [1, 3, 4])
    expect(
      mergeConversationHistory(old, latest, "latest").messages?.map(
        (message) => message.sequence_no
      )
    ).toEqual([1, 3, 4])
    const changed = {
      ...latest,
      history: {
        scope_id: "another-thread",
        turn_ids: ["turn-4"],
        index: latest.history!.index,
      },
    }
    expect(mergeConversationHistory(old, changed, "latest")).toBe(changed)
    expect(mergeConversationHistory(changed, old, "older")).toBe(changed)
  })
  it("deduplicates overlapping windows", () => {
    expect(
      mergeConversationHistory(page([2, 3, 4]), page([1, 2]), "older").messages
    ).toHaveLength(4)
  })
})
