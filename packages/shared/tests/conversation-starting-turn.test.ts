import { describe, expect, it } from "vitest";
import { conversationStartingTurnSchema } from "../src/conversations.js";

const snapshot = {
  turn_id: "40000000-0000-4000-8000-000000000001", task_kind: "turn",
  idempotency_key: "accepted", input_text: "Analyze invoice", created_at: "2026-09-18T00:00:00Z",
  message_display: null,
  attachments: [{ id: "60000000-0000-4000-8000-000000000001", name: "invoice.png", mime_type: "image/png", size: 120 }],
};

describe("public starting turn snapshot", () => {
  it("accepts a redacted submission with its stable identity and file metadata", () => {
    expect(conversationStartingTurnSchema.parse(snapshot)).toEqual(snapshot);
    expect(conversationStartingTurnSchema.parse({ ...snapshot, idempotency_key: null, attachments: [] }).attachments).toEqual([]);
  });

  it("rejects leaked storage details and invalid identities", () => {
    expect(conversationStartingTurnSchema.safeParse({ ...snapshot, application_instructions: "private" }).success).toBe(false);
    expect(conversationStartingTurnSchema.safeParse({ ...snapshot, turn_id: "invalid" }).success).toBe(false);
    expect(conversationStartingTurnSchema.safeParse({ ...snapshot, attachments: [{ ...snapshot.attachments[0], workspaceRelativePath: "private" }] }).success).toBe(false);
    expect(conversationStartingTurnSchema.safeParse({ ...snapshot, attachments: [{ ...snapshot.attachments[0], size: -1 }] }).success).toBe(false);
  });
});
