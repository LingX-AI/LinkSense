import { describe, expect, it } from "vitest"

import type { ConversationMessage, ConversationTurn } from "@/api/contracts"
import {
  insertConversationCompactionCommandMessages,
  isConversationCompactionCommandMessage,
} from "@/features/conversations/conversation-compaction-command"

function turn({
  id,
  startedAt,
  taskKind = "turn",
}: {
  id: string
  startedAt: string
  taskKind?: "turn" | "compact"
}): ConversationTurn {
  return {
    id,
    status: "completed",
    task_kind: taskKind,
    started_at: startedAt,
    completed_at: startedAt,
  }
}

function message({
  id,
  turnId,
  createdAt,
}: {
  id: string
  turnId: string
  createdAt: string
}): ConversationMessage {
  return {
    id,
    role: "user",
    turn_id: turnId,
    content: `message ${id}`,
    created_at: createdAt,
  }
}

describe("insertConversationCompactionCommandMessages", () => {
  it("places the compaction command before the messages sent after it", () => {
    const messages = [
      message({
        id: "first",
        turnId: "turn-1",
        createdAt: "2026-07-11T08:00:00.000Z",
      }),
      message({
        id: "second",
        turnId: "turn-3",
        createdAt: "2026-07-11T08:10:00.000Z",
      }),
    ]
    const turns = [
      turn({ id: "turn-1", startedAt: "2026-07-11T07:59:00.000Z" }),
      turn({
        id: "turn-2",
        startedAt: "2026-07-11T08:05:00.000Z",
        taskKind: "compact",
      }),
      turn({ id: "turn-3", startedAt: "2026-07-11T08:09:00.000Z" }),
    ]

    const merged = insertConversationCompactionCommandMessages(messages, turns)
    const command = merged[1]

    expect(merged.map((entry) => entry.id)).toEqual([
      "first",
      "context-compaction-command:turn-2",
      "second",
    ])
    expect(command).toMatchObject({
      role: "user",
      content: "/compact",
      turn_id: "turn-2",
      created_at: "2026-07-11T08:05:00.000Z",
    })
    expect(command && isConversationCompactionCommandMessage(command)).toBe(
      true
    )
  })

  it("returns only real messages without a compact turn", () => {
    const messages = [
      message({
        id: "first",
        turnId: "turn-1",
        createdAt: "2026-07-11T08:00:00.000Z",
      }),
    ]

    expect(
      insertConversationCompactionCommandMessages(messages, [
        turn({ id: "turn-1", startedAt: "2026-07-11T07:59:00.000Z" }),
      ])
    ).toEqual(messages)
  })

  it("keeps existing messages of a compact turn instead of inventing one", () => {
    const messages = [
      message({
        id: "command",
        turnId: "turn-2",
        createdAt: "2026-07-11T08:05:00.000Z",
      }),
    ]

    expect(
      insertConversationCompactionCommandMessages(messages, [
        turn({
          id: "turn-2",
          startedAt: "2026-07-11T08:05:00.000Z",
          taskKind: "compact",
        }),
      ])
    ).toEqual(messages)
  })

  it("appends a trailing compaction command after the last message", () => {
    const merged = insertConversationCompactionCommandMessages(
      [],
      [
        turn({
          id: "turn-1",
          startedAt: "2026-07-11T08:00:00.000Z",
          taskKind: "compact",
        }),
      ]
    )

    expect(merged.map((entry) => entry.content)).toEqual(["/compact"])
  })
})
