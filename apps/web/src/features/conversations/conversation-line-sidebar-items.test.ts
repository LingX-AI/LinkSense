import { describe, expect, it } from "vitest"

import type { ConversationMessage } from "@/api/contracts"
import { buildConversationLineSidebarItems } from "@/features/conversations/conversation-line-sidebar-items"

describe("buildConversationLineSidebarItems", () => {
  it("pairs every user message with the following assistant messages", () => {
    const messages: ConversationMessage[] = [
      { id: "system-1", role: "system", content: "internal" },
      { id: "assistant-orphan", role: "assistant", content: "ignored" },
      {
        id: "user-1",
        role: "user",
        content: " 分析登录失败 ",
        created_at: "2026-07-11T08:05:00",
      },
      { id: "assistant-1", role: "assistant", content: "检查了会话状态。" },
      { id: "assistant-2", role: "assistant", content: "建议刷新令牌。" },
      { id: "user-2", role: "user", content: "补充测试" },
    ]

    expect(buildConversationLineSidebarItems(messages, "AI 正在回复…")).toEqual(
      [
        {
          id: "user-1",
          userMessage: "分析登录失败",
          assistantMessage: "检查了会话状态。\n建议刷新令牌。",
          createdAt: "2026-07-11T08:05:00",
        },
        {
          id: "user-2",
          userMessage: "补充测试",
          assistantMessage: "AI 正在回复…",
        },
      ]
    )
  })

  it("ignores empty messages and keeps the latest twenty exchanges", () => {
    const messages: ConversationMessage[] = [
      { id: "empty-user", role: "user", content: "   " },
      ...Array.from({ length: 21 }, (_, index) => ({
        id: `user-${index + 1}`,
        role: "user" as const,
        content: `问题 ${index + 1}`,
      })),
    ]

    const result = buildConversationLineSidebarItems(messages, "等待回复")

    expect(result).toHaveLength(20)
    expect(result[0]?.id).toBe("user-2")
    expect(result.at(-1)?.id).toBe("user-21")
  })

  it("uses the visible presentation annotation instead of internal model context", () => {
    const messages: ConversationMessage[] = [
      {
        id: "presentation-user",
        role: "user",
        content: "用户要求：改为英文\n\n元素定位：shape-7",
        display: {
          kind: "presentation_annotation",
          file_id: "70000000-0000-4000-8000-000000000001",
          file_name: "AI 入门.pptx",
          annotations: [
            {
              request: "改为英文",
              slide_number: 1,
              selection_count: 1,
            },
          ],
          annotation_count: 1,
        },
      },
    ]

    expect(buildConversationLineSidebarItems(messages, "等待回复")).toEqual([
      {
        id: "presentation-user",
        userMessage: "改为英文",
        assistantMessage: "等待回复",
      },
    ])
  })

  it("does not expose knowledge source markers in the task message rail", () => {
    const messages: ConversationMessage[] = [
      { id: "user-1", role: "user", content: "问题" },
      {
        id: "assistant-1",
        role: "assistant",
        content: "回答[[kb-source:opaque-source-reference]]。",
      },
    ]

    expect(buildConversationLineSidebarItems(messages, "等待回复")).toEqual([
      {
        id: "user-1",
        userMessage: "问题",
        assistantMessage: "回答。",
      },
    ])
  })
})
