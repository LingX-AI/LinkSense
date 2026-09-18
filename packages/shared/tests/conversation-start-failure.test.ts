import { describe, expect, it } from "vitest";
import { conversationEventSchema, conversationStartFailurePayloadSchema } from "../src/index.js";

const error = {
  schema_version: 1, error_code: "RUNNER_UNAVAILABLE",
  message_key: "errors.runnerUnavailable", retryable: true,
};
const failure = {
  turn_id: "40000000-0000-4000-8000-000000000001",
  idempotency_key: "interactive:manual-attempt",
};
const event = {
  id: "60000000-0000-4000-8000-000000000001",
  conversation_id: "20000000-0000-4000-8000-000000000001",
  turn_id: null, sequence_no: 1, event_type: "conversation.error",
  visibility: "user_visible", sse_event_id: "c1:1",
  created_at: "2026-09-17T13:15:00.000Z",
};

describe("pre-turn startup errors", () => {
  it("preserves the submission identity across stored-event and SSE validation", () => {
    const payload = conversationStartFailurePayloadSchema.parse({ ...error, start_failure: failure });
    expect(conversationEventSchema.parse({ ...event, payload }).payload).toEqual(payload);
  });
  it("continues reading existing generic errors without treating them as failed starts", () => {
    expect(conversationEventSchema.parse({ ...event, payload: error }).payload).toEqual(error);
    expect(conversationStartFailurePayloadSchema.safeParse(error).success).toBe(false);
  });
  it.each([{ ...failure, turn_id: "invalid" }, { ...failure, idempotency_key: "" }, { ...failure, idempotency_key: "x".repeat(121) }])("rejects malformed failure correlation %j", (start_failure) => {
    expect(conversationEventSchema.safeParse({ ...event, payload: { ...error, start_failure } }).success).toBe(false);
  });
});
