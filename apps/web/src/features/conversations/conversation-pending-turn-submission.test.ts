import { QueryClient } from "@tanstack/react-query"
import { describe, expect, it } from "vitest"

import {
  clearPendingConversationTurnSubmission,
  getPendingConversationTurnSubmission,
  movePendingConversationTurnSubmission,
  setPendingConversationTurnSubmission,
  updatePendingConversationTurnSubmission,
  type PendingConversationTurnSubmission,
} from "@/features/conversations/conversation-pending-turn-submission"

const pendingSubmission: PendingConversationTurnSubmission = {
  conversationId: "conversation-1",
  idempotencyKey: "operation-1",
  optimisticId: "optimistic-1",
  message: {
    id: "optimistic-operation-1",
    role: "user",
    content: "刚刚发送的消息",
    turn_id: null,
  },
}

describe("pending conversation turn submission", () => {
  it("keeps the optimistic message scoped to its task until projection", () => {
    const queryClient = new QueryClient()

    setPendingConversationTurnSubmission(
      queryClient,
      "conversation-1",
      pendingSubmission
    )
    updatePendingConversationTurnSubmission(
      queryClient,
      "conversation-1",
      (current) => ({
        ...current,
        turnId: "turn-1",
        status: "starting",
        message: { ...current.message, turn_id: "turn-1" },
      })
    )

    expect(
      getPendingConversationTurnSubmission(queryClient, "conversation-1")
    ).toMatchObject({
      conversationId: "conversation-1",
      turnId: "turn-1",
      message: { content: "刚刚发送的消息", turn_id: "turn-1" },
    })
    expect(
      getPendingConversationTurnSubmission(queryClient, "conversation-2")
    ).toBeUndefined()

    clearPendingConversationTurnSubmission(queryClient, "conversation-1")
    expect(
      getPendingConversationTurnSubmission(queryClient, "conversation-1")
    ).toBeNull()
  })

  it("moves a new-task submission to the persisted task id", () => {
    const queryClient = new QueryClient()
    setPendingConversationTurnSubmission(queryClient, "new", {
      ...pendingSubmission,
      conversationId: "new",
    })

    movePendingConversationTurnSubmission(
      queryClient,
      "new",
      "conversation-1"
    )

    expect(
      getPendingConversationTurnSubmission(queryClient, "new")
    ).toBeUndefined()
    expect(
      getPendingConversationTurnSubmission(queryClient, "conversation-1")
    ).toMatchObject({ conversationId: "conversation-1" })
  })
})
