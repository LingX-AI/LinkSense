import { z } from "zod";

const sharedConversationMessageSchema = z
  .object({
    id: z.string().uuid(),
    role: z.enum(["user", "assistant", "system"]),
    content_text: z.string(),
    turn_id: z.string().uuid().nullable().optional(),
    sequence_no: z.number().int().positive().optional(),
    created_at: z.string().optional(),
    updated_at: z.string().optional(),
    phase: z.enum(["commentary", "final_answer"]).nullable().optional(),
    output_kind: z.enum(["agent_message", "plan"]).optional(),
    usage_type: z.literal("steer_current_turn").optional(),
  })
  .strip();

const sharedConversationTurnSchema = z
  .object({
    id: z.string().uuid(),
    status: z.enum(["running", "completed", "failed", "interrupted"]),
    task_kind: z.enum(["turn", "goal", "compact"]).optional(),
    started_at: z.string().optional(),
    completed_at: z.string().nullable().optional(),
    interrupt_requested_at: z.string().nullable().optional(),
    interrupted_at: z.string().nullable().optional(),
    created_at: z.string().optional(),
    updated_at: z.string().optional(),
  })
  .strip();

const sharedConversationFileSchema = z
  .object({
    id: z.string().uuid(),
    conversation_id: z.string().uuid().optional(),
    pending_request_id: z.string().uuid().nullable().optional(),
    turn_id: z.string().uuid().nullable().optional(),
    kind: z.enum(["attachment", "artifact"]),
    status: z.string().optional(),
    filename: z.string().min(1),
    mime_type: z.string().nullable().optional(),
    size_bytes: z.number().int().nonnegative().optional(),
    created_at: z.string().optional(),
    updated_at: z.string().optional(),
  })
  .strip()
  .transform((file) => ({ ...file, downloadable: false }));

const sharedConversationActivitySchema = z
  .object({
    id: z.string(),
    turn_id: z.string().uuid().nullable().optional(),
    item_id: z.string().optional(),
    type: z.string(),
    message_key: z.string().optional(),
    capability_name: z.string().optional(),
    status: z.string().optional(),
    created_at: z.string().optional(),
    sequence_no: z.number().int().nonnegative().optional(),
  })
  .strip();

const sharedConversationEventSchema = z
  .object({
    event_type: z.string().optional(),
    type: z.string().optional(),
    payload: z.unknown(),
  })
  .strip();

const nativeCompletedMessageEventSchema = z.object({
  schema_version: z.literal(2),
  source: z.literal("codex_app_server"),
  method: z.literal("item/completed"),
  params: z.object({
    item: z.discriminatedUnion("type", [
      z.object({
        type: z.literal("agentMessage"),
        phase: z.enum(["commentary", "final_answer"]).nullable(),
      }),
      z.object({ type: z.literal("plan") }),
    ]),
  }),
  local: z.object({ message_id: z.string().uuid() }),
});

export const conversationShareSnapshotSchema = z
  .object({
    conversation: z
      .object({
        id: z.string().uuid(),
        title: z.string().max(240),
        title_source: z.enum(["generated", "fallback", "manual"]).optional(),
        execution_status: z
          .enum([
            "idle",
            "running",
            "pending",
            "completed",
            "failed",
            "interrupted",
          ])
          .optional(),
        created_at: z.string().optional(),
        updated_at: z.string(),
      })
      .strip(),
    messages: z.array(sharedConversationMessageSchema).max(10000),
    turns: z.array(sharedConversationTurnSchema),
    files: z.array(sharedConversationFileSchema).max(10000),
    activities: z.array(sharedConversationActivitySchema),
    events: z.array(sharedConversationEventSchema).default([]),
    turn_file_change_counts: z.record(
      z.string(),
      z.number().int().nonnegative(),
    ),
  })
  .strip()
  .transform((snapshot) => {
    const finalMessageIdByTurn = new Map<string | null, string>();
    const nonFinalAssistantMessageIds = new Set<string>();
    for (const message of snapshot.messages) {
      if (message.role !== "assistant") continue;
      if (message.phase === "final_answer") {
        finalMessageIdByTurn.set(message.turn_id ?? null, message.id);
      } else if (
        message.phase === "commentary" ||
        message.output_kind === "plan"
      ) {
        nonFinalAssistantMessageIds.add(message.id);
      }
    }
    for (const event of snapshot.events) {
      const native = nativeCompletedMessageEventSchema.safeParse(event.payload);
      if (!native.success) continue;
      const messageId = native.data.local.message_id;
      const item = native.data.params.item;
      if (item.type === "agentMessage" && item.phase === "final_answer") {
        const message = snapshot.messages.find(
          (value) => value.id === messageId,
        );
        if (message) {
          finalMessageIdByTurn.set(message.turn_id ?? null, messageId);
        }
      } else if (
        item.type === "plan" ||
        (item.type === "agentMessage" && item.phase === "commentary")
      ) {
        nonFinalAssistantMessageIds.add(messageId);
      }
    }

    const turnStatusById = new Map(
      snapshot.turns.map((turn) => [turn.id, turn.status]),
    );
    const assistantMessagesByTurn = new Map<
      string | null,
      (typeof snapshot.messages)[number][]
    >();
    for (const message of snapshot.messages) {
      if (message.role !== "assistant") continue;
      const turnId = message.turn_id ?? null;
      const messages = assistantMessagesByTurn.get(turnId) ?? [];
      messages.push(message);
      assistantMessagesByTurn.set(turnId, messages);
    }
    for (const [turnId, messages] of assistantMessagesByTurn) {
      if (finalMessageIdByTurn.has(turnId)) continue;
      if (turnId && turnStatusById.get(turnId) === "running") continue;
      const fallback = [...messages]
        .reverse()
        .find((message) => !nonFinalAssistantMessageIds.has(message.id));
      if (fallback) finalMessageIdByTurn.set(turnId, fallback.id);
    }

    const finalMessageIds = new Set(finalMessageIdByTurn.values());
    const sharedTurnIds = new Set<string>();
    const messages = snapshot.messages.flatMap((message) => {
      if (message.role === "system") return [];
      if (message.role !== "assistant") return [message];
      if (!finalMessageIds.has(message.id)) return [];
      if (message.turn_id) sharedTurnIds.add(message.turn_id);
      return [
        {
          ...message,
          phase: "final_answer" as const,
          output_kind: "agent_message" as const,
        },
      ];
    });

    const messageTurnIds = new Set(messages.map((message) => message.turn_id));
    const assistantTurnIds = new Set(
      messages
        .filter((message) => message.role === "assistant")
        .map((message) => message.turn_id),
    );
    return {
      ...snapshot,
      messages,
      turns: snapshot.turns.filter((turn) => sharedTurnIds.has(turn.id)),
      files: snapshot.files.filter(
        (file) =>
          file.turn_id &&
          !file.pending_request_id &&
          file.status !== "staged" &&
          (file.kind === "artifact" ? assistantTurnIds : messageTurnIds).has(
            file.turn_id,
          ),
      ),
      turn_file_change_counts: Object.fromEntries(
        Object.entries(snapshot.turn_file_change_counts).filter(([turnId]) =>
          sharedTurnIds.has(turnId),
        ),
      ),
      activities: [],
      events: [],
      pending_requests: [],
      user_input_requests: [],
      plan_reviews: [],
    };
  });

export type ConversationShareSnapshot = z.infer<
  typeof conversationShareSnapshotSchema
>;

export const conversationShareCreateSchema = z.strictObject({
  snapshot: conversationShareSnapshotSchema.refine(
    (snapshot) =>
      snapshot.messages.length > 0 &&
      new Set(snapshot.messages.map((message) => message.id)).size ===
        snapshot.messages.length &&
      new Set(snapshot.turns.map((turn) => turn.id)).size ===
        snapshot.turns.length &&
      new Set(snapshot.files.map((file) => file.id)).size ===
        snapshot.files.length,
  ),
});

export type ConversationShareCreate = z.infer<
  typeof conversationShareCreateSchema
>;

export const conversationShareReceiptSchema = z.strictObject({
  id: z.string().uuid(),
  conversation_id: z.string().uuid(),
  title: z.string(),
  url_path: z.string().startsWith("/share/"),
  created_at: z.string(),
  updated_at: z.string(),
});

export type ConversationShareReceipt = z.infer<
  typeof conversationShareReceiptSchema
>;
