import { describe, expect, it } from "vitest"
import type { ConversationEvent } from "@/api/contracts"
import { matchingConversationStartFailure } from "./conversation-start-failure"

const turnId = "40000000-0000-4000-8000-000000000001"
const payload = {
  schema_version: 1,
  error_code: "RUNNER_UNAVAILABLE",
  message_key: "errors.runnerUnavailable",
  retryable: true,
  start_failure: { turn_id: turnId, idempotency_key: "submitted-request" },
}
const event: ConversationEvent = {
  id: "c1:1",
  type: "conversation.error",
  turn_id: null,
  created_at: "2026-09-17T13:15:00.000Z",
  sequence_no: 1,
  payload,
}

describe("failed start correlation", () => {
  it.each([undefined, turnId])(
    "matches a persisted regeneration failure with receipt %s",
    (receiptTurnId) => {
      const failure = {
        ...event,
        payload: {
          ...payload,
          start_failure: {
            turn_id: turnId,
            idempotency_key: "regenerate:message-1:submitted-request",
          },
        },
      }
      expect(
        matchingConversationStartFailure(failure, {
          turnId: receiptTurnId,
          idempotencyKey: "submitted-request",
          replacesTurnId: "previous-turn",
          message: { id: "message-1" },
        })
      ).toEqual(failure.payload)
    }
  )
  it.each([
    { message: { id: "another-message" }, replacesTurnId: "previous-turn" },
    { message: { id: "message-1" } },
  ])(
    "does not match a scoped regeneration failure to a different operation %j",
    (operation) => {
      expect(
        matchingConversationStartFailure(
          {
            ...event,
            payload: {
              ...payload,
              start_failure: {
                turn_id: turnId,
                idempotency_key: "regenerate:message-1:submitted-request",
              },
            },
          },
          { idempotencyKey: "submitted-request", ...operation }
        )
      ).toBeNull()
    }
  )
  it.each([undefined, turnId])(
    "matches the exact request with receipt %s",
    (turnId) => {
      expect(
        matchingConversationStartFailure(event, {
          turnId,
          idempotencyKey: "submitted-request",
        })
      ).toEqual(payload)
    }
  )
  it.each([
    undefined,
    { idempotencyKey: "new-request" },
    { turnId, idempotencyKey: "new-request" },
    {
      turnId: "40000000-0000-4000-8000-000000000002",
      idempotencyKey: "submitted-request",
    },
  ])("ignores old or unrelated failures for submission %j", (submission) => {
    expect(matchingConversationStartFailure(event, submission)).toBeNull()
  })
  it.each([
    {
      schema_version: 1,
      error_code: "RUNNER_UNAVAILABLE",
      message_key: "errors.runnerUnavailable",
      retryable: true,
    },
    { ...payload, error_code: "CODEX_TURN_FAILED" },
    {
      ...payload,
      start_failure: {
        turn_id: "invalid",
        idempotency_key: "submitted-request",
      },
    },
  ])(
    "does not terminate a turn for an uncorrelated, native or invalid error",
    (payload) => {
      expect(
        matchingConversationStartFailure(
          { ...event, payload },
          { turnId, idempotencyKey: "submitted-request" }
        )
      ).toBeNull()
    }
  )
  it("uses the exact turn identity for a submission without an idempotency key", () => {
    const failure = {
      ...event,
      payload: {
        ...payload,
        start_failure: { turn_id: turnId, idempotency_key: null },
      },
    }
    expect(
      matchingConversationStartFailure(failure, {
        turnId,
        idempotencyKey: "unused",
      })
    ).not.toBeNull()
    expect(
      matchingConversationStartFailure(failure, { idempotencyKey: "unused" })
    ).toBeNull()
  })
})
