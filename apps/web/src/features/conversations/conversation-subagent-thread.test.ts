// @vitest-environment node

import { describe, expect, it } from "vitest"

import type { NativeSubAgentDetail } from "@/api/contracts"
import { buildSubAgentConversation } from "@/features/conversations/conversation-subagent-thread"

const agentKey = `agent_${"a".repeat(24)}`

describe("buildSubAgentConversation", () => {
  it("merges native turns into one synthetic conversation turn with stable ordering", () => {
    const detail: NativeSubAgentDetail = {
      agentKey,
      status: "completed",
      turns: [
        {
          status: "interrupted",
          durationMs: 500,
          items: [
            {
              type: "commandExecution",
              id: "detail-1",
              status: "inProgress",
              commandActions: [{ type: "read", command: "读取配置" }],
            },
          ],
        },
        {
          status: "completed",
          durationMs: 1_500,
          items: [
            {
              type: "commandExecution",
              id: "detail-1",
              status: "completed",
              commandActions: [{ type: "search", command: "搜索协议" }],
            },
            {
              type: "agentMessage",
              id: "detail-2",
              phase: "final_answer",
              text: "检查完成。",
            },
          ],
        },
      ],
    }

    const conversation = buildSubAgentConversation(
      detail,
      {
        conversationId: "conversation-1",
        agentName: "配置审计",
      },
      Date.parse("2026-07-19T08:00:02.000Z")
    )

    expect(conversation.turns).toHaveLength(1)
    expect(conversation.turns?.[0]).toMatchObject({
      status: "completed",
      started_at: "2026-07-19T08:00:00.000Z",
      completed_at: "2026-07-19T08:00:02.000Z",
    })
    expect(conversation.messages).toHaveLength(1)
    expect(conversation.events).toHaveLength(2)
    expect(
      conversation.events?.map((event) => event.sequence_no)
    ).toStrictEqual([1, 3])
    expect(conversation.activities).toEqual([
      expect.objectContaining({
        sequence_no: 2,
        message_key:
          "conversation.subAgentActivities.continuedAfterInterruption",
      }),
    ])
    expect(
      conversation.events?.map((event) => {
        const payload = event.payload as {
          params: { item: { id: string } }
        }
        return payload.params.item.id
      })
    ).toStrictEqual(["subagent-item-1-1", "subagent-item-2-1"])
  })
})
