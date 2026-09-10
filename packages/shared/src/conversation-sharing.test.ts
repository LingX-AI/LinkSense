import { describe, expect, it } from "vitest";

import {
  conversationShareCreateSchema,
  conversationShareSnapshotSchema,
} from "./conversation-sharing.js";

const conversationId = "10000000-0000-4000-8000-000000000001";
const turnId = "20000000-0000-4000-8000-000000000001";
const otherTurnId = "20000000-0000-4000-8000-000000000002";
const messageId = "30000000-0000-4000-8000-000000000001";
const fileId = "40000000-0000-4000-8000-000000000001";

function snapshot() {
  return {
    conversation: {
      id: conversationId,
      title: "Shared task",
      updated_at: "2026-09-09T00:00:00.000Z",
      owner_id: "private-owner",
    },
    messages: [
      {
        id: messageId,
        role: "assistant",
        phase: "final_answer",
        content_text: "Visible answer",
        turn_id: turnId,
      },
    ],
    turns: [
      { id: turnId, status: "completed", model: "private-model" },
      { id: otherTurnId, status: "completed" },
    ],
    files: [
      {
        id: fileId,
        kind: "artifact",
        filename: "result.md",
        turn_id: turnId,
        status: "ready",
        minio_object_key: "private-key",
        downloadable: true,
      },
    ],
    activities: [],
    events: [],
    turn_file_change_counts: { [turnId]: 1, [otherTurnId]: 5 },
  };
}

describe("conversation sharing contracts", () => {
  it("projects only resources attached to shared messages and strips private fields", () => {
    const input = snapshot();
    input.files.push({
      ...input.files[0]!,
      id: "40000000-0000-4000-8000-000000000002",
      turn_id: otherTurnId,
    });
    const result = conversationShareSnapshotSchema.parse(input);
    expect(result.files).toEqual([
      {
        id: fileId,
        kind: "artifact",
        filename: "result.md",
        turn_id: turnId,
        status: "ready",
        downloadable: false,
      },
    ]);
    expect(result.turns).toEqual([{ id: turnId, status: "completed" }]);
    expect(result.turn_file_change_counts).toEqual({ [turnId]: 1 });
    expect(JSON.stringify(result)).not.toContain("private-");
    expect(conversationShareSnapshotSchema.parse(result)).toEqual(result);
  });

  it("keeps only the visible portion of a final answer that is still streaming", () => {
    const input = snapshot();
    input.turns = [{ id: turnId, status: "running" }];
    const result = conversationShareSnapshotSchema.parse(input);
    input.messages[0]!.content_text += " Later output";
    expect(result.messages[0]?.content_text).toBe("Visible answer");
    expect(result.turns[0]?.status).toBe("running");
  });

  it("does not share staged or queued attachments or artifacts without a visible answer", () => {
    const input = snapshot();
    const result = conversationShareSnapshotSchema.parse({
      ...input,
      messages: [{ ...input.messages[0], role: "user", phase: undefined }],
      files: [
        input.files[0],
        { ...input.files[0], kind: "attachment", status: "staged" },
        {
          ...input.files[0],
          kind: "attachment",
          pending_request_id: messageId,
        },
      ],
    });
    expect(result.files).toEqual([]);
    expect(result.turn_file_change_counts).toEqual({});
  });

  it("rejects empty snapshots, duplicate messages, invalid identifiers, and task-only requests", () => {
    const input = snapshot();
    for (const value of [
      undefined,
      {},
      { conversation_id: conversationId },
      { snapshot: { ...input, messages: [] } },
      {
        snapshot: {
          ...input,
          messages: [...input.messages, ...input.messages],
        },
      },
      {
        snapshot: {
          ...input,
          conversation: { ...input.conversation, id: "invalid" },
        },
      },
    ])
      expect(conversationShareCreateSchema.safeParse(value).success).toBe(
        false,
      );
  });
});
