import { describe, expect, it } from "vitest";
import { taskReferencesInputSchema, readConversationReferenceInputSchema } from "../src/conversation-references.js";

const id = "11111111-1111-4111-8111-111111111111";
describe("explicit conversation reference boundary", () => {
  it("requires one to three unique UUID sources", () => {
    const input = { kind: "task_references", request: "Compare", conversation_ids: [id] };
    expect(taskReferencesInputSchema.safeParse(input).success).toBe(true);
    for (const ids of [[], [id, id], [id, id, id, id], ["../../private"]]) expect(taskReferencesInputSchema.safeParse({ ...input, conversation_ids: ids }).success).toBe(false);
  });
  it("bounds continuation values and rejects identity overrides", () => {
    expect(readConversationReferenceInputSchema.parse({ conversation_id: id })).toEqual({ conversation_id: id, cursor: "0", offset: 0 });
    expect(readConversationReferenceInputSchema.safeParse({ conversation_id: id, cursor: "1", offset: 1_008_000 }).success).toBe(true);
    for (const fields of [{ cursor: "-1" }, { cursor: "2147483648" }, { offset: -1 }, { offset: 10_000_001 }, { owner_id: id }]) expect(readConversationReferenceInputSchema.safeParse({ conversation_id: id, ...fields }).success).toBe(false);
  });
  it("accepts an optional latest-assistant mode without changing legacy requests", () => {
    for (const mode of ["history", "latest_assistant"]) {
      expect(readConversationReferenceInputSchema.parse({ conversation_id: id, mode })).toEqual({ conversation_id: id, mode, cursor: "0", offset: 0 });
    }
    expect(readConversationReferenceInputSchema.safeParse({ conversation_id: id, mode: "latest_user" }).success).toBe(false);
  });
});
