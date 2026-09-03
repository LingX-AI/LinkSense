import { describe, expect, it, vi } from "vitest";

import { ConversationShareService } from "../src/modules/conversations/sharing.js";

const OWNER_ID = "10000000-0000-4000-8000-000000000001";
const CONVERSATION_ID = "20000000-0000-4000-8000-000000000001";
const SHARE_ID = "30000000-0000-4000-8000-000000000001";
const TURN_ID = "40000000-0000-4000-8000-000000000001";
const MESSAGE_ID = "50000000-0000-4000-8000-000000000001";

describe("ConversationShareService", () => {
  it("stores a read-only snapshot without owner or runtime identifiers", async () => {
    const upsert = vi.fn(async (input: unknown) => {
      void input;
      return shareRow();
    });
    const reader = {
      get: vi.fn(async () => conversationDetail()),
    };
    const service = new ConversationShareService(
      { conversationShare: { upsert } } as never,
      reader,
    );

    const result = await service.create(OWNER_ID, CONVERSATION_ID);

    expect(reader.get).toHaveBeenCalledWith(OWNER_ID, CONVERSATION_ID);
    expect(result).toMatchObject({
      id: SHARE_ID,
      conversation_id: CONVERSATION_ID,
      url_path: `/share/${SHARE_ID}`,
    });
    const storedSnapshot = (
      upsert.mock.calls[0]?.[0] as {
        create: {
          snapshotJson: {
            conversation: Record<string, unknown>;
            turns: Array<Record<string, unknown>>;
            files: Array<Record<string, unknown>>;
            messages: Array<Record<string, unknown>>;
            activities: Array<Record<string, unknown>>;
            events: Array<Record<string, unknown>>;
          };
        };
      }
    ).create.snapshotJson;
    expect(storedSnapshot.conversation).not.toHaveProperty("owner_id");
    expect(storedSnapshot.turns[0]).not.toHaveProperty("submitted_by");
    expect(storedSnapshot.turns[0]).not.toHaveProperty("codex_thread_id");
    expect(storedSnapshot.files[0]).not.toHaveProperty(
      "workspace_relative_path",
    );
    expect(storedSnapshot.files[0]).toMatchObject({ downloadable: false });
    expect(storedSnapshot.messages).toHaveLength(2);
    expect(storedSnapshot.messages.map((message) => message.content_text)).toEqual(
      ["Please fix the layout", "The layout is fixed."],
    );
    expect(storedSnapshot.activities).toEqual([]);
    expect(storedSnapshot.events).toEqual([]);
  });

  it("returns the stored snapshot without reading the source task again", async () => {
    const reader = { get: vi.fn() };
    const service = new ConversationShareService(
      {
        conversationShare: {
          findUnique: vi.fn(async () => ({
            ...shareRow(),
            snapshotJson: conversationDetail(),
          })),
        },
      } as never,
      reader,
    );

    const result = await service.get(SHARE_ID);

    expect(result.snapshot?.conversation.title).toBe("Shared task");
    expect(reader.get).not.toHaveBeenCalled();
  });

  it("does not reveal whether an unknown identifier belongs to a task", async () => {
    const service = new ConversationShareService(
      {
        conversationShare: { findUnique: vi.fn(async () => null) },
      } as never,
      { get: vi.fn() },
    );

    await expect(service.get(SHARE_ID)).rejects.toMatchObject({
      code: "CONVERSATION_NOT_FOUND",
    });
  });
});

function shareRow() {
  return {
    id: SHARE_ID,
    conversationId: CONVERSATION_ID,
    ownerId: OWNER_ID,
    titleSnapshot: "Shared task",
    snapshotJson: conversationDetail(),
    createdAt: new Date("2026-09-03T04:00:00.000Z"),
    updatedAt: new Date("2026-09-03T04:00:00.000Z"),
  };
}

function conversationDetail() {
  return {
    conversation: {
      id: CONVERSATION_ID,
      owner_id: OWNER_ID,
      title: "Shared task",
      title_source: "manual",
      execution_status: "completed",
      codex_thread_id: "thread-secret",
      created_at: "2026-09-03T03:58:00.000Z",
      updated_at: "2026-09-03T04:00:00.000Z",
    },
    messages: [
      {
        id: MESSAGE_ID,
        role: "user",
        content_text: "Please fix the layout",
        turn_id: TURN_ID,
        sequence_no: 1,
        created_at: "2026-09-03T03:58:00.000Z",
        updated_at: "2026-09-03T03:58:00.000Z",
      },
      {
        id: "50000000-0000-4000-8000-000000000002",
        role: "assistant",
        content_text: "Inspecting the implementation.",
        turn_id: TURN_ID,
        sequence_no: 2,
        phase: "commentary",
        created_at: "2026-09-03T03:59:00.000Z",
        updated_at: "2026-09-03T03:59:00.000Z",
      },
      {
        id: "50000000-0000-4000-8000-000000000004",
        role: "assistant",
        content_text: "The layout is fixed.",
        turn_id: TURN_ID,
        sequence_no: 3,
        created_at: "2026-09-03T04:00:00.000Z",
        updated_at: "2026-09-03T04:00:00.000Z",
      },
      {
        id: "50000000-0000-4000-8000-000000000003",
        role: "system",
        content_text: "Internal instruction",
        turn_id: TURN_ID,
      },
    ],
    turns: [
      {
        id: TURN_ID,
        status: "completed",
        submitted_by: OWNER_ID,
        codex_thread_id: "thread-secret",
        codex_turn_id: "turn-secret",
        started_at: "2026-09-03T03:58:00.000Z",
        completed_at: "2026-09-03T04:00:00.000Z",
      },
    ],
    files: [
      {
        id: "60000000-0000-4000-8000-000000000001",
        conversation_id: CONVERSATION_ID,
        turn_id: TURN_ID,
        kind: "artifact",
        status: "ready",
        filename: "result.md",
        size_bytes: 120,
        workspace_relative_path: "secret/result.md",
        minio_object_key: "secret-object-key",
        downloadable: true,
      },
    ],
    activities: [
      {
        id: "activity-secret",
        turn_id: TURN_ID,
        type: "conversation.tool.completed",
        label: "Internal tool call",
      },
    ],
    events: [
      {
        event_type: "item/completed",
        payload: {
          schema_version: 2,
          source: "codex_app_server",
          method: "item/completed",
          params: {
            item: {
              type: "agentMessage",
              id: "commentary-item",
              text: "Inspecting the implementation.",
              phase: "commentary",
            },
          },
          local: {
            message_id: "50000000-0000-4000-8000-000000000002",
          },
        },
      },
      {
        event_type: "item/completed",
        payload: {
          schema_version: 2,
          source: "codex_app_server",
          method: "item/completed",
          params: {
            item: {
              type: "agentMessage",
              id: "final-item",
              text: "The layout is fixed.",
              phase: "final_answer",
            },
          },
          local: {
            message_id: "50000000-0000-4000-8000-000000000004",
          },
        },
      },
    ],
    turn_file_change_counts: { [TURN_ID]: 1 },
  };
}
