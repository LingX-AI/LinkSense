// @vitest-environment node

import { describe, expect, it } from "vitest"

import type { Conversation, ConversationEvent } from "@/api/contracts"
import {
  applyConversationExecutionTransition,
  getConversationExecutionTransition,
} from "@/features/conversations/conversation-execution-lifecycle"

const activeTurnId = "30000000-0000-4000-8000-000000000001"

describe("conversation execution lifecycle", () => {
  it("projects the native terminal event into the matching task immediately", () => {
    const event = nativeTurnCompletedEvent(activeTurnId, "failed")
    const transition = getConversationExecutionTransition(event)

    expect(transition).toEqual({
      status: "failed",
      turnId: activeTurnId,
      occurredAt: event.created_at,
    })
    if (!transition) throw new Error("missing execution transition")
    expect(
      applyConversationExecutionTransition(runningConversation(), transition)
    ).toMatchObject({
      execution_status: "failed",
      running_turn: null,
      turns: [
        {
          id: activeTurnId,
          status: "failed",
          completed_at: event.created_at,
        },
      ],
    })
  })

  it("does not let a replayed completion stop a newer running turn", () => {
    const newerTurnId = "30000000-0000-4000-8000-000000000002"
    const conversation = runningConversation(newerTurnId)
    const transition = getConversationExecutionTransition(
      nativeTurnCompletedEvent(activeTurnId, "completed")
    )
    if (!transition) throw new Error("missing execution transition")

    expect(applyConversationExecutionTransition(conversation, transition)).toBe(
      conversation
    )
  })

  it("does not let a retained historical turn completion stop the active turn", () => {
    const newerTurnId = "30000000-0000-4000-8000-000000000002"
    const conversation: Conversation = {
      ...runningConversation(newerTurnId),
      turns: [
        { id: activeTurnId, status: "completed" },
        { id: newerTurnId, status: "running" },
      ],
    }
    const transition = getConversationExecutionTransition(
      nativeTurnCompletedEvent(activeTurnId, "completed")
    )
    if (!transition) throw new Error("missing execution transition")

    expect(applyConversationExecutionTransition(conversation, transition)).toBe(
      conversation
    )
  })

  it("ignores a terminal event for a turn missing from a terminal snapshot", () => {
    const conversation = runningConversation()
    const terminalConversation: Conversation = {
      ...conversation,
      execution_status: "completed",
      turns: conversation.turns?.map((turn) => ({
        ...turn,
        status: "completed" as const,
      })),
      running_turn: null,
    }
    const transition = getConversationExecutionTransition(
      nativeTurnCompletedEvent(
        "30000000-0000-4000-8000-000000000099",
        "completed"
      )
    )
    if (!transition) throw new Error("missing execution transition")

    expect(
      applyConversationExecutionTransition(terminalConversation, transition)
    ).toBe(terminalConversation)
  })

  it("supports the legacy status event during protocol transition", () => {
    const transition = getConversationExecutionTransition({
      id: "conversation:9",
      type: "conversation.status.changed",
      turn_id: activeTurnId,
      sequence_no: 9,
      created_at: "2026-08-13T08:00:09.000Z",
      payload: {
        schema_version: 1,
        turn_id: activeTurnId,
        turn_status: "interrupted",
        conversation_execution_status: "interrupted",
      },
    })

    expect(transition).toEqual({
      status: "interrupted",
      turnId: activeTurnId,
      occurredAt: "2026-08-13T08:00:09.000Z",
    })
  })

  it("clears the running turn for a legacy terminal event without a turn id", () => {
    const event: ConversationEvent = {
      id: "conversation:10",
      type: "conversation.completed",
      turn_id: null,
      sequence_no: 10,
      created_at: "2026-08-13T08:00:10.000Z",
      payload: { schema_version: 1 },
    }
    const transition = getConversationExecutionTransition(event)
    if (!transition) throw new Error("missing execution transition")

    expect(
      applyConversationExecutionTransition(runningConversation(), transition)
    ).toMatchObject({ execution_status: "completed", running_turn: null })
  })
})

function runningConversation(turnId = activeTurnId): Conversation {
  return {
    id: "conversation-1",
    title: "测试任务",
    archived: false,
    updated_at: "2026-08-13T08:00:00.000Z",
    execution_status: "running",
    has_unread_completion: false,
    has_automation: false,
    collaboration_mode: "default",
    turns: [{ id: turnId, status: "running" }],
    running_turn: { id: turnId, status: "running" },
    user_input_requests: [],
  }
}

function nativeTurnCompletedEvent(
  turnId: string,
  status: "completed" | "failed" | "interrupted"
): ConversationEvent {
  return {
    id: "conversation:8",
    type: "turn/completed",
    turn_id: turnId,
    sequence_no: 8,
    created_at: "2026-08-13T08:00:08.000Z",
    payload: {
      schema_version: 2,
      source: "codex_app_server",
      method: "turn/completed",
      params: {
        threadId: "thread-1",
        turn: { id: "native-turn-1", status },
      },
    },
  }
}
