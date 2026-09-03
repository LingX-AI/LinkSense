import { z } from "zod";

import { Prisma, type PrismaClient } from "../../generated/prisma/client.js";
import { AppError } from "../../lib/errors.js";

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
    draft_id: z.string().uuid().nullable().optional(),
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
        title: z.string(),
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
    messages: z.array(sharedConversationMessageSchema),
    turns: z.array(sharedConversationTurnSchema),
    files: z.array(sharedConversationFileSchema),
    activities: z.array(sharedConversationActivitySchema),
    events: z.array(sharedConversationEventSchema).default([]),
    turn_file_change_counts: z.record(z.string(), z.number().int().nonnegative()),
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
        const message = snapshot.messages.find((value) => value.id === messageId);
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

    return {
      ...snapshot,
      messages,
      turns: snapshot.turns.filter((turn) => sharedTurnIds.has(turn.id)),
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

type ConversationReader = {
  get(ownerId: string, conversationId: string): Promise<unknown>;
};

export class ConversationShareService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly conversations: ConversationReader,
  ) {}

  async create(ownerId: string, conversationId: string) {
    const snapshot = conversationShareSnapshotSchema.parse(
      await this.conversations.get(ownerId, conversationId),
    );
    const storedSnapshot = JSON.parse(
      JSON.stringify(snapshot),
    ) as Prisma.InputJsonValue;
    const share = await this.prisma.conversationShare.upsert({
      where: { conversationId },
      create: {
        conversationId,
        ownerId,
        titleSnapshot: snapshot.conversation.title,
        snapshotJson: storedSnapshot,
      },
      update: {
        ownerId,
        titleSnapshot: snapshot.conversation.title,
        snapshotJson: storedSnapshot,
      },
    });

    return projectConversationShare(share);
  }

  async get(shareId: string) {
    const share = await this.prisma.conversationShare.findUnique({
      where: { id: shareId },
    });
    if (!share) throw new AppError("CONVERSATION_NOT_FOUND");

    const snapshot = conversationShareSnapshotSchema.safeParse(
      share.snapshotJson,
    );
    if (!snapshot.success) throw new AppError("INTERNAL_ERROR");

    return projectConversationShare(share, snapshot.data);
  }
}

function projectConversationShare(
  share: {
    id: string;
    conversationId: string;
    titleSnapshot: string;
    createdAt: Date;
    updatedAt: Date;
  },
  snapshot?: ConversationShareSnapshot,
) {
  return {
    id: share.id,
    conversation_id: share.conversationId,
    title: share.titleSnapshot,
    url_path: `/share/${share.id}`,
    created_at: share.createdAt.toISOString(),
    updated_at: share.updatedAt.toISOString(),
    ...(snapshot ? { snapshot } : {}),
  };
}
