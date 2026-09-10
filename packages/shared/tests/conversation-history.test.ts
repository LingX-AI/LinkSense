import { describe, expect, it } from "vitest";
import { conversationHistoryQuerySchema, conversationHistoryPageSchema } from "../src/conversation-history.js";

describe("conversation history contract", () => {
  it("accepts the latest window and a positive target turn", () => {
    expect(conversationHistoryQuerySchema.parse({})).toEqual({});
    expect(conversationHistoryQuerySchema.parse({ around_turn: "26" })).toEqual({ around_turn: 26 });
  });
  it.each(["", "x", "-1", "0", "1.1", "9007199254740992"])("rejects invalid target %s", (cursor) => {
    expect(conversationHistoryQuerySchema.safeParse({ around_turn: cursor }).success).toBe(false);
  });
  it("rejects the obsolete directional cursor", () => {
    expect(conversationHistoryQuerySchema.safeParse({ before_turn: 26 }).success).toBe(false);
  });
  it("requires a full metadata index without message bodies", () => {
    const page = { scope_id: "turn-1", turn_ids: ["turn-1"], index: [{ turn_id: "turn-1", sequence_no: 1, message_id: "user-1", created_at: "2026-09-07T00:00:00Z", has_content: true }] };
    expect(conversationHistoryPageSchema.safeParse(page).success).toBe(true);
    expect(conversationHistoryPageSchema.safeParse({ ...page, index: undefined }).success).toBe(false);
    expect(conversationHistoryPageSchema.safeParse({ ...page, index: [{ ...page.index[0], content: "private body" }] }).success).toBe(false);
  });
});
