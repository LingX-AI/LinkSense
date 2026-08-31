import { describe, expect, it } from "vitest"

import {
  getConversationEventQueryRefreshScope,
  getConversationQueryRefreshScope,
} from "@/features/conversations/conversation-refresh-policy"

describe("conversation query refresh policy", () => {
  it.each([
    "thread/name/updated",
    "turn/started",
    "turn/completed",
    "conversation.title.updated",
    "conversation.status.changed",
    "conversation.interrupted",
    "conversation.completed",
    "conversation.plan_review.updated",
  ])("refreshes detail and list for %s", (eventType) => {
    expect(getConversationQueryRefreshScope(eventType)).toBe("detail-and-list")
  })

  it.each([
    "thread/goal/updated",
    "thread/goal/cleared",
    "conversation.pending_request.updated",
    "conversation.pending_request.cancelled",
    "conversation.user_input_request.updated",
    "item/tool/requestUserInput",
    "linksense/form/request",
    "serverRequest/resolved",
    "conversation.message.completed",
    "conversation.capability.attached",
    "conversation.file.created",
    "conversation.file.updated",
    "conversation.artifact.created",
  ])("refreshes only detail for %s", (eventType) => {
    expect(getConversationQueryRefreshScope(eventType)).toBe("detail")
  })

  it.each([
    "error",
    "turn/plan/updated",
    "item/started",
    "item/completed",
    "item/agentMessage/delta",
    "item/plan/delta",
    "item/reasoning/summaryTextDelta",
    "item/reasoning/summaryPartAdded",
    "conversation.message.delta",
    "conversation.step.started",
    "conversation.step.completed",
    "conversation.tool.started",
    "conversation.tool.completed",
    "conversation.capability.used",
    "conversation.system_capability.used",
    "conversation.reconnect",
    "conversation.error",
  ])("does not refetch queries for live-only event %s", (eventType) => {
    expect(getConversationQueryRefreshScope(eventType)).toBe("none")
  })

  it("refreshes detail when a late native Plan item creates a durable review", () => {
    expect(
      getConversationEventQueryRefreshScope({
        id: "conversation:42",
        type: "item/completed",
        turn_id: "10000000-0000-4000-8000-000000000001",
        created_at: "2026-08-09T12:00:00.000Z",
        sequence_no: 42,
        payload: {
          schema_version: 2,
          source: "codex_app_server",
          method: "item/completed",
          params: {
            threadId: "thread-plan",
            turnId: "turn-plan",
            item: {
              type: "plan",
              id: "item-plan",
              text: "## Plan",
            },
          },
          local: {
            message_id: "10000000-0000-4000-8000-000000000002",
            plan_review_id: "10000000-0000-4000-8000-000000000003",
          },
        },
      })
    ).toBe("detail")
  })

  it("keeps non-Plan native item completion live-only", () => {
    expect(
      getConversationEventQueryRefreshScope({
        id: "conversation:43",
        type: "item/completed",
        turn_id: "10000000-0000-4000-8000-000000000001",
        created_at: "2026-08-09T12:00:00.000Z",
        sequence_no: 43,
        payload: {
          schema_version: 2,
          source: "codex_app_server",
          method: "item/completed",
          params: {
            threadId: "thread-plan",
            turnId: "turn-plan",
            item: {
              type: "agentMessage",
              id: "item-answer",
              text: "Done",
              phase: "final_answer",
            },
          },
          local: {
            message_id: "10000000-0000-4000-8000-000000000004",
          },
        },
      })
    ).toBe("none")
  })
})
