import { QueryClient } from "@tanstack/react-query"
import { describe, expect, it } from "vitest"
import { conversationSchema } from "@/api/contracts"
import { getPendingConversationExecution } from "./conversation-pending-execution"
import {
  getPendingConversationTurnSubmission,
  setPendingConversationTurnSubmission,
} from "./conversation-pending-turn-submission"
import { restoreStartingConversationTurn } from "./conversation-starting-turn"

const conversation = conversationSchema.parse({
  id: "task",
  title: "Task",
  project_id: null,
  updated_at: "2026-09-18T00:00:00Z",
  starting_turn: {
    turn_id: "40000000-0000-4000-8000-000000000001",
    task_kind: "turn",
    idempotency_key: "interactive:accepted",
    input_text: "Analyze invoice",
    created_at: "2026-09-18T00:00:00Z",
    message_display: null,
    attachments: [
      {
        id: "60000000-0000-4000-8000-000000000001",
        name: "invoice.png",
        mime_type: "image/png",
        size: 120,
      },
    ],
  },
})

describe("restoring accepted submissions", () => {
  it("restores the event boundary of a retry without reapplying an older failure", () => {
    const client = new QueryClient()
    restoreStartingConversationTurn(client, {
      ...conversation,
      events: [
        {
          id: "task:19",
          type: "conversation.error",
          turn_id: null,
          sequence_no: 19,
          created_at: "2026-09-17T23:59:59Z",
          payload: {},
        },
        {
          id: "task:20",
          type: "conversation.error",
          turn_id: null,
          sequence_no: 20,
          created_at: "2026-09-18T00:00:01Z",
          payload: {},
        },
      ],
    })
    expect(
      getPendingConversationTurnSubmission(client, conversation.id)
        ?.afterEventSequence
    ).toBe(19)
  })
  it("restores the prompt, attachments and exact accepted identity after a refresh", () => {
    const client = new QueryClient()
    restoreStartingConversationTurn(client, conversation)
    expect(getPendingConversationExecution(client, conversation.id)).toEqual({
      turnId: conversation.starting_turn?.turn_id,
    })
    expect(
      getPendingConversationTurnSubmission(client, conversation.id)
    ).toMatchObject({
      idempotencyKey: "interactive:accepted",
      status: "starting",
      turnId: conversation.starting_turn?.turn_id,
      message: {
        content: "Analyze invoice",
        attachments: conversation.starting_turn?.attachments,
      },
    })
  })

  it("preserves a newer local submission and its stop request", () => {
    const client = new QueryClient()
    const pending = {
      conversationId: conversation.id,
      idempotencyKey: "newer",
      interruptRequested: true,
      message: { id: "newer", role: "user" as const, content: "New request" },
    }
    setPendingConversationTurnSubmission(client, conversation.id, pending)
    restoreStartingConversationTurn(client, conversation)
    expect(
      getPendingConversationTurnSubmission(client, conversation.id)
    ).toEqual(pending)
    expect(
      getPendingConversationExecution(client, conversation.id)
    ).toBeUndefined()
  })

  it("does not fabricate a submission for historical tasks without a pending start", () => {
    const client = new QueryClient()
    restoreStartingConversationTurn(client, {
      ...conversation,
      starting_turn: null,
    })
    expect(
      getPendingConversationTurnSubmission(client, conversation.id)
    ).toBeUndefined()
  })

  it("restores compaction activity without adding an empty user message", () => {
    const client = new QueryClient()
    const compact = conversationSchema.parse({
      ...conversation,
      starting_turn: {
        ...conversation.starting_turn,
        task_kind: "compact",
        input_text: "",
      },
    })
    restoreStartingConversationTurn(client, compact)
    expect(
      getPendingConversationTurnSubmission(client, conversation.id)
    ).toBeUndefined()
    expect(
      getPendingConversationExecution(client, conversation.id)?.turnId
    ).toBe(conversation.starting_turn?.turn_id)
  })
})
