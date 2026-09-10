import { conversationShareCreateSchema } from "@linksense/shared";
import { describe, expect, it, vi } from "vitest";

import { ConversationShareService } from "../src/modules/conversations/sharing.js";

const OWNER_ID = "10000000-0000-4000-8000-000000000001";
const CONVERSATION_ID = "20000000-0000-4000-8000-000000000001";
const SHARE_ID = "30000000-0000-4000-8000-000000000001";
const TURN_ID = "40000000-0000-4000-8000-000000000001";
const MESSAGE_ID = "50000000-0000-4000-8000-000000000001";

describe("ConversationShareService", () => {
  it("creates separate immutable links and never adds messages outside the submitted preview", async () => {
    const source = conversationDetail();
    const firstInput = conversationShareCreateSchema.parse({
      snapshot: source,
    });
    const rows = new Map<string, ReturnType<typeof shareRow>>();
    const create = vi.fn(
      async ({
        data,
      }: {
        data: Pick<
          ReturnType<typeof shareRow>,
          "snapshotJson" | "titleSnapshot"
        >;
      }) => {
        const row = {
          ...shareRow(),
          ...data,
          id: rows.size ? "30000000-0000-4000-8000-000000000002" : SHARE_ID,
        };
        rows.set(row.id, structuredClone(row));
        return row;
      },
    );
    const reader = { get: vi.fn(async () => source) };
    const service = new ConversationShareService(
      {
        conversationShare: {
          create,
          findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
            rows.get(where.id),
          ),
        },
      } as never,
      reader,
    );

    source.messages.push({
      ...source.messages[0]!,
      id: "50000000-0000-4000-8000-000000000099",
      content_text: "Later private message",
    });
    source.messages[2]!.content_text = "Edited answer";
    source.conversation.title = "New title";
    source.files.push({
      ...source.files[0]!,
      id: "60000000-0000-4000-8000-000000000099",
      filename: "later-private.md",
    });

    const first = await service.create(OWNER_ID, CONVERSATION_ID, firstInput);
    const second = await service.create(
      OWNER_ID,
      CONVERSATION_ID,
      conversationShareCreateSchema.parse({ snapshot: source }),
    );
    expect(first.id).not.toBe(second.id);
    reader.get.mockClear();
    const savedFirst = await service.get(first.id);
    const savedSecond = await service.get(second.id);
    expect(savedFirst.snapshot).toEqual(firstInput.snapshot);
    expect(savedFirst.title).toBe("Shared task");
    expect(savedFirst.snapshot?.files.map((file) => file.filename)).toEqual([
      "result.md",
    ]);
    expect(
      savedSecond.snapshot?.messages.map((message) => message.content_text),
    ).toContain("Later private message");
    expect(savedSecond.title).toBe("New title");
    expect(reader.get).not.toHaveBeenCalled();
  });

  it.each(["conversation", "message", "file", "role", "turn"])(
    "rejects a preview with a forged %s",
    async (field) => {
      const input = conversationShareCreateSchema.parse({
        snapshot: conversationDetail(),
      });
      const foreignId = "90000000-0000-4000-8000-000000000001";
      if (field === "conversation") input.snapshot.conversation.id = foreignId;
      if (field === "message") input.snapshot.messages[0]!.id = foreignId;
      if (field === "file") input.snapshot.files[0]!.id = foreignId;
      if (field === "role") input.snapshot.messages[1]!.role = "user";
      if (field === "turn") input.snapshot.messages[0]!.turn_id = foreignId;
      const create = vi.fn();
      const service = new ConversationShareService(
        { conversationShare: { create } } as never,
        { get: vi.fn(async () => conversationDetail()) },
      );
      await expect(
        service.create(OWNER_ID, CONVERSATION_ID, input),
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
      expect(create).not.toHaveBeenCalled();
    },
  );

  it("does not store a snapshot when source ownership is denied", async () => {
    const create = vi.fn();
    const service = new ConversationShareService(
      { conversationShare: { create } } as never,
      { get: vi.fn().mockRejectedValue(new Error("access denied")) },
    );
    await expect(
      service.create(
        OWNER_ID,
        CONVERSATION_ID,
        conversationShareCreateSchema.parse({ snapshot: conversationDetail() }),
      ),
    ).rejects.toThrow("access denied");
    expect(create).not.toHaveBeenCalled();
  });

  it("stores a read-only snapshot without owner or runtime identifiers", async () => {
    const create = vi.fn(async (input: unknown) => {
      void input;
      return shareRow();
    });
    const reader = {
      get: vi.fn(async () => conversationDetail()),
    };
    const service = new ConversationShareService(
      { conversationShare: { create } } as never,
      reader,
    );

    const result = await service.create(
      OWNER_ID,
      CONVERSATION_ID,
      conversationShareCreateSchema.parse({ snapshot: conversationDetail() }),
    );

    expect(reader.get).toHaveBeenCalledWith(OWNER_ID, CONVERSATION_ID);
    expect(result).toMatchObject({
      id: SHARE_ID,
      conversation_id: CONVERSATION_ID,
      url_path: `/share/${SHARE_ID}`,
    });
    const storedSnapshot = (
      create.mock.calls[0]?.[0] as {
        data: {
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
    ).data.snapshotJson;
    expect(storedSnapshot.conversation).not.toHaveProperty("owner_id");
    expect(storedSnapshot.turns[0]).not.toHaveProperty("submitted_by");
    expect(storedSnapshot.turns[0]).not.toHaveProperty("codex_thread_id");
    expect(storedSnapshot.files[0]).not.toHaveProperty(
      "workspace_relative_path",
    );
    expect(storedSnapshot.files[0]).toMatchObject({ downloadable: false });
    expect(storedSnapshot.messages).toHaveLength(2);
    expect(
      storedSnapshot.messages.map((message) => message.content_text),
    ).toEqual(["Please fix the layout", "The layout is fixed."]);
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
