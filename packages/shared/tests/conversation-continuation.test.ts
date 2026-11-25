import { describe, expect, it } from "vitest";

import { conversationContinuationInputSchema } from "../src/conversations.js";

const REQUEST_ID = "40000000-0000-4000-8000-000000000011";
const DEVICE_ID = "10000000-0000-4000-8000-000000000009";

describe("conversation continuation input", () => {
  it("requires an explicit target and request id", () => {
    expect(
      conversationContinuationInputSchema.safeParse({
        request_id: REQUEST_ID,
        execution_target: "cloud",
      }).success,
    ).toBe(true);
    expect(
      conversationContinuationInputSchema.safeParse({
        request_id: REQUEST_ID,
        execution_target: "local",
        desktop_device_id: DEVICE_ID,
      }).success,
    ).toBe(true);
    expect(
      conversationContinuationInputSchema.safeParse({
        request_id: REQUEST_ID,
      }).success,
    ).toBe(false);
    expect(
      conversationContinuationInputSchema.safeParse({
        execution_target: "cloud",
      }).success,
    ).toBe(false);
  });

  it("enforces the paired-device selection", () => {
    expect(
      conversationContinuationInputSchema.safeParse({
        request_id: REQUEST_ID,
        execution_target: "local",
      }).success,
    ).toBe(false);
    expect(
      conversationContinuationInputSchema.safeParse({
        request_id: REQUEST_ID,
        execution_target: "cloud",
        desktop_device_id: DEVICE_ID,
      }).success,
    ).toBe(false);
  });

  it("does not accept owner, project, thread, files, prompt or prewarmed fields", () => {
    for (const field of [
      { owner_id: DEVICE_ID },
      { project_id: DEVICE_ID },
      { conversation_id: DEVICE_ID },
      { source_conversation_id: DEVICE_ID },
      { codex_thread_id: "thread" },
      { turn_id: DEVICE_ID },
      { file_ids: [DEVICE_ID] },
      { input_text: "resume" },
      { prewarmed_conversation_id: DEVICE_ID },
    ]) {
      expect(
        conversationContinuationInputSchema.safeParse({
          request_id: REQUEST_ID,
          execution_target: "cloud",
          ...field,
        }).success,
      ).toBe(false);
    }
  });
});
