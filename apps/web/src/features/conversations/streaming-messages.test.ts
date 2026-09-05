// @vitest-environment node

import { describe, expect, it } from "vitest"

import {
  appendStreamingMessageDelta,
  applyStreamingMessageLifecycle,
  completeLegacyStreamingMessage,
  projectVisibleConversationMessages,
  removeStreamingMessageItems,
  removePersistedStreamingMessages,
} from "@/features/conversations/streaming-messages"

describe("streaming assistant messages", () => {
  it("keeps an optimistic user message before the first streamed assistant item in its turn", () => {
    const result = projectVisibleConversationMessages(
      [
        {
          id: "previous-assistant",
          role: "assistant",
          turn_id: "turn-previous",
          content: "上一轮回复",
          created_at: "2026-08-03T08:00:00.000Z",
        },
      ],
      [
        {
          id: "streaming-current-assistant",
          role: "assistant",
          turn_id: "turn-current",
          item_id: "item-current",
          content: "当前回复正在输出",
          created_at: "2026-08-03T08:00:02.000Z",
          streaming: true,
        },
      ],
      {
        id: "optimistic-current-user",
        role: "user",
        turn_id: "turn-current",
        content: "当前问题",
        created_at: "2026-08-03T08:00:01.000Z",
      }
    )

    expect(result.map((message) => message.id)).toEqual([
      "previous-assistant",
      "optimistic-current-user",
      "streaming-current-assistant",
    ])
  })

  it("projects a stable client render key onto a persisted stream handoff", () => {
    const result = projectVisibleConversationMessages(
      [
        {
          id: "persisted-assistant",
          role: "assistant",
          turn_id: "turn-current",
          content: "完整回答",
        },
      ],
      [],
      null,
      new Map([["persisted-assistant", "assistant-item-legacy-stream-item"]])
    )

    expect(result[0]).toMatchObject({
      id: "persisted-assistant",
      client_render_key: "assistant-item-legacy-stream-item",
    })
  })

  it("keeps an unassigned optimistic user message ahead of the streaming tail while turn admission settles", () => {
    const result = projectVisibleConversationMessages(
      [
        {
          id: "previous-assistant",
          role: "assistant",
          turn_id: "turn-previous",
          content: "上一轮回复",
          created_at: "2026-08-03T08:00:00.000Z",
        },
      ],
      [
        {
          id: "streaming-current-assistant",
          role: "assistant",
          turn_id: "turn-current",
          item_id: "item-current",
          content: "当前回复正在输出",
          created_at: "2026-08-03T08:00:02.000Z",
          streaming: true,
        },
      ],
      {
        id: "optimistic-current-user",
        role: "user",
        turn_id: null,
        content: "当前问题",
        created_at: "2026-08-03T08:00:01.000Z",
      }
    )

    expect(result.map((message) => message.id)).toEqual([
      "previous-assistant",
      "optimistic-current-user",
      "streaming-current-assistant",
    ])
  })

  it("routes interleaved deltas to their own native item", () => {
    const first = appendStreamingMessageDelta(
      {},
      update("commentary-item", "正在", 2)
    )
    const second = appendStreamingMessageDelta(
      first,
      update("final-item", "最终", 3)
    )
    const result = appendStreamingMessageDelta(
      second,
      update("commentary-item", "检查", 4)
    )

    expect(result["commentary-item"]).toMatchObject({
      id: "streaming-commentary-item",
      item_id: "commentary-item",
      content: "正在检查",
      event_sequence_no: 2,
    })
    expect(result["final-item"]).toMatchObject({
      id: "streaming-final-item",
      item_id: "final-item",
      content: "最终",
      event_sequence_no: 3,
    })
    expect(Object.keys(result)).toHaveLength(2)
  })

  it("ignores duplicate and stale item sequences without changing state identity", () => {
    const first = appendStreamingMessageDelta(
      {},
      update("final-item", "重复", 2)
    )

    expect(
      appendStreamingMessageDelta(first, update("final-item", "重复", 2))
    ).toBe(first)
    expect(
      appendStreamingMessageDelta(first, update("final-item", "过期", 1))
    ).toBe(first)

    const completed = applyStreamingMessageLifecycle(first, {
      itemId: "final-item",
      messageId: "message-final",
      turnId: "turn-1",
      phase: "final_answer",
      text: "重复",
      createdAt: "2026-07-11T08:00:03.000Z",
      sequence: 3,
      completed: true,
    })

    expect(
      appendStreamingMessageDelta(
        completed,
        update("final-item", "完成后过期", 2)
      )
    ).toBe(completed)
  })

  it("fills a missing phase from a late lifecycle event without replaying stale text", () => {
    const streamed = appendStreamingMessageDelta(
      {},
      update("final-item", "最终回复", 3)
    )

    const repaired = applyStreamingMessageLifecycle(streamed, {
      itemId: "final-item",
      messageId: "message-final",
      turnId: "turn-1",
      phase: "final_answer",
      text: "",
      createdAt: "2026-07-11T08:00:02.000Z",
      sequence: 2,
      completed: false,
    })

    expect(repaired).not.toBe(streamed)
    expect(repaired["final-item"]).toMatchObject({
      id: "message-final",
      phase: "final_answer",
      content: "最终回复",
      last_applied_sequence_no: 3,
      streaming: true,
    })
  })

  it("keeps legitimate repeated text from later sequences", () => {
    const first = appendStreamingMessageDelta({}, update("final-item", "哈", 2))
    const second = appendStreamingMessageDelta(
      first,
      update("final-item", "哈", 3)
    )

    expect(second["final-item"]?.content).toBe("哈哈")
    expect(second["final-item"]?.last_applied_sequence_no).toBe(3)
  })

  it("repairs legacy absolute placeholders while deltas are streaming", () => {
    const first = appendStreamingMessageDelta(
      {},
      update("final-item", "```html\n<title>待办事项<$ABSO", 2)
    )
    const second = appendStreamingMessageDelta(
      first,
      update("final-item", "LUTE/title>\n```", 3)
    )

    expect(second["final-item"]?.content).toBe(
      "```html\n<title>待办事项</title>\n```"
    )
    expect(second["final-item"]?.content).not.toContain("$ABSOLUTE")
  })

  it("repairs legacy remote and knowledge URLs across delta boundaries", () => {
    const assetId = "50000000-0000-5000-8000-000000000001"
    const remoteStart = appendStreamingMessageDelta(
      {},
      update("remote-item", "https:$ABSO", 2)
    )
    const remoteComplete = appendStreamingMessageDelta(
      remoteStart,
      update(
        "remote-item",
        "LUTEupload.wikimedia.org$ABSOLUTE/wikipedia/image.jpg",
        3
      )
    )
    const knowledgeStart = appendStreamingMessageDelta(
      {},
      update("knowledge-item", "![步骤](kb-asset:$ABSO", 4)
    )
    const knowledgeComplete = appendStreamingMessageDelta(
      knowledgeStart,
      update("knowledge-item", `LUTE${assetId})`, 5)
    )

    expect(remoteComplete["remote-item"]?.content).toBe(
      "https://upload.wikimedia.org/wikipedia/image.jpg"
    )
    expect(knowledgeComplete["knowledge-item"]?.content).toBe(
      `![步骤](kb-asset://${assetId})`
    )
  })

  it("repairs a legacy placeholder in completed message text", () => {
    const result = applyStreamingMessageLifecycle(
      {},
      {
        itemId: "final-item",
        messageId: "message-final",
        turnId: "turn-1",
        phase: "final_answer",
        text: "<p>完成<$ABSOLUTE/p>",
        createdAt: "2026-07-11T08:00:03.000Z",
        sequence: 3,
        completed: true,
      }
    )

    expect(result["final-item"]?.content).toBe("<p>完成</p>")
  })

  it("uses the completed native item text when no delta was received", () => {
    const result = applyStreamingMessageLifecycle(
      {},
      {
        itemId: "final-item",
        messageId: "message-final",
        turnId: "turn-1",
        phase: "final_answer",
        text: "最终回复",
        createdAt: "2026-07-11T08:00:03.000Z",
        sequence: 3,
        completed: true,
      }
    )

    expect(result["final-item"]).toMatchObject({
      id: "message-final",
      phase: "final_answer",
      content: "最终回复",
      streaming: false,
    })
  })

  it("keeps a proposed plan identity across delta, stale lifecycle, and completion", () => {
    const streamed = appendStreamingMessageDelta(
      {},
      {
        ...update("plan-item", "# 实施方案", 3),
        outputKind: "plan",
      }
    )
    const staleLifecycle = applyStreamingMessageLifecycle(streamed, {
      itemId: "plan-item",
      messageId: "plan-message",
      turnId: "turn-1",
      phase: "final_answer",
      outputKind: "plan",
      text: "",
      createdAt: "2026-07-11T08:00:02.000Z",
      sequence: 2,
      completed: false,
    })
    const completed = applyStreamingMessageLifecycle(staleLifecycle, {
      itemId: "plan-item",
      messageId: "plan-message",
      turnId: "turn-1",
      phase: "final_answer",
      outputKind: "plan",
      text: "# 最终实施方案",
      createdAt: "2026-07-11T08:00:04.000Z",
      sequence: 4,
      completed: true,
    })

    expect(staleLifecycle["plan-item"]).toMatchObject({
      id: "plan-message",
      output_kind: "plan",
      content: "# 实施方案",
      streaming: true,
    })
    expect(completed["plan-item"]).toMatchObject({
      output_kind: "plan",
      content: "# 最终实施方案",
      streaming: false,
    })
  })

  it("never exposes a complete knowledge source marker from one delta", () => {
    const result = appendStreamingMessageDelta(
      {},
      update("final-item", "结论[[kb-source:opaque-source-reference]]。", 2)
    )

    expect(result["final-item"]?.content).toBe("结论。")
    expect(JSON.stringify(result["final-item"])).not.toContain(
      "opaque-source-reference"
    )
  })

  it("keeps an incomplete marker hidden when it spans multiple deltas", () => {
    const first = appendStreamingMessageDelta(
      {},
      update("final-item", "结论[", 2)
    )
    expect(first["final-item"]?.content).toBe("结论")

    const second = appendStreamingMessageDelta(
      first,
      update("final-item", "[kb-sour", 3)
    )
    expect(second["final-item"]?.content).toBe("结论")

    const third = appendStreamingMessageDelta(
      second,
      update("final-item", "ce:opaque-source-reference", 4)
    )
    expect(third["final-item"]?.content).toBe("结论")
    expect(JSON.stringify(third["final-item"])).not.toContain(
      "opaque-source-reference"
    )

    const completedMarker = appendStreamingMessageDelta(
      third,
      update("final-item", "]]，后续内容。", 5)
    )
    expect(completedMarker["final-item"]?.content).toBe("结论，后续内容。")
  })

  it("replaces temporary text with a sanitized completed item", () => {
    const streaming = appendStreamingMessageDelta(
      {},
      update("final-item", "临时答案", 2)
    )
    const completed = applyStreamingMessageLifecycle(streaming, {
      itemId: "final-item",
      messageId: "message-final",
      turnId: "turn-1",
      phase: "final_answer",
      text: "最终答案[[kb-source:opaque-source-reference]]。",
      createdAt: "2026-07-11T08:00:03.000Z",
      sequence: 3,
      completed: true,
    })

    expect(completed["final-item"]).toMatchObject({
      id: "message-final",
      content: "最终答案。",
      streaming: false,
    })
    expect(JSON.stringify(completed["final-item"])).not.toContain(
      "opaque-source-reference"
    )
  })

  it("keeps the known turn across deltas and lifecycle handoff events that omit it", () => {
    const started = applyStreamingMessageLifecycle(
      {},
      {
        itemId: "final-item",
        turnId: "turn-1",
        phase: "final_answer",
        createdAt: "2026-07-11T08:00:01.000Z",
        sequence: 1,
        completed: false,
      }
    )
    const streaming = appendStreamingMessageDelta(started, {
      itemId: "final-item",
      delta: "包含知识库图片",
      createdAt: "2026-07-11T08:00:02.000Z",
      sequence: 2,
    })
    const completed = applyStreamingMessageLifecycle(streaming, {
      itemId: "final-item",
      messageId: "message-final",
      phase: "final_answer",
      text: "包含知识库图片",
      createdAt: "2026-07-11T08:00:03.000Z",
      sequence: 3,
      completed: true,
    })

    expect(streaming["final-item"]?.turn_id).toBe("turn-1")
    expect(completed["final-item"]).toMatchObject({
      id: "message-final",
      turn_id: "turn-1",
      streaming: false,
    })
  })

  it("completes only the matching legacy stream without clearing visible content", () => {
    const first = appendStreamingMessageDelta(
      {},
      update("first-item", "第一条", 2)
    )
    const current = appendStreamingMessageDelta(
      first,
      update("second-item", "第二条", 3)
    )
    const completed = completeLegacyStreamingMessage(current, {
      itemId: "second-item",
      messageId: "message-second",
      turnId: "turn-1",
      createdAt: "2026-07-11T08:00:04.000Z",
      sequence: 4,
    })

    expect(completed["first-item"]).toBe(current["first-item"])
    expect(completed["second-item"]).toMatchObject({
      id: "message-second",
      content: "第二条",
      streaming: false,
      last_applied_sequence_no: 4,
    })
  })

  it("removes reconciled streams without publishing unchanged state", () => {
    const current = appendStreamingMessageDelta(
      {},
      update("final-item", "可见内容", 2)
    )

    expect(
      removePersistedStreamingMessages(current, new Set(), new Set())
    ).toBe(current)
    expect(
      removePersistedStreamingMessages(
        current,
        new Set(),
        new Set(["final-item"])
      )
    ).toEqual({})
  })

  it("removes only the exact items superseded by a blocked native Stop hook", () => {
    const commentary = appendStreamingMessageDelta(
      {},
      update("commentary-item", "正在核对数据。", 2)
    )
    const current = appendStreamingMessageDelta(
      commentary,
      update("invalid-final-item", "请切换模式后重试。", 3)
    )

    const result = removeStreamingMessageItems(
      current,
      new Set(["invalid-final-item"])
    )

    expect(result["commentary-item"]).toBe(current["commentary-item"])
    expect(result["invalid-final-item"]).toBeUndefined()
    expect(removeStreamingMessageItems(result, new Set(["missing-item"]))).toBe(
      result
    )
  })
})

function update(itemId: string, delta: string, sequence: number) {
  return {
    itemId,
    delta,
    turnId: "turn-1",
    createdAt: `2026-07-11T08:00:0${sequence}.000Z`,
    sequence,
  }
}
