import {
  conversationShareCreateSchema,
  conversationShareSnapshotSchema,
  type ConversationShareCreate,
  type ConversationShareReceipt,
  type ConversationShareSnapshot,
} from "@linksense/shared";

import type { PrismaClient } from "../../generated/prisma/client.js";
import { AppError } from "../../lib/errors.js";

type ConversationReader = {
  get(ownerId: string, conversationId: string): Promise<unknown>;
};

export class ConversationShareService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly conversations: ConversationReader,
  ) {}

  async create(
    ownerId: string,
    conversationId: string,
    input: ConversationShareCreate,
  ): Promise<ConversationShareReceipt> {
    const source = conversationShareSnapshotSchema.parse(
      await this.conversations.get(ownerId, conversationId),
    );
    const { snapshot } = conversationShareCreateSchema.parse(input);
    const messages = new Map(
      source.messages.map((message) => [message.id, message]),
    );
    const turns = new Set(source.turns.map((turn) => turn.id));
    const files = new Map(source.files.map((file) => [file.id, file]));
    // The owner supplies the frozen preview, including text that may have changed
    // since it was displayed. Only resources from this task may be included.
    if (
      snapshot.conversation.id !== conversationId ||
      snapshot.messages.some((message) => {
        const original = messages.get(message.id);
        return (
          !original ||
          original.role !== message.role ||
          (original.turn_id ?? null) !== (message.turn_id ?? null)
        );
      }) ||
      snapshot.turns.some((turn) => !turns.has(turn.id)) ||
      snapshot.files.some((file) => {
        const original = files.get(file.id);
        return (
          !original ||
          original.kind !== file.kind ||
          original.turn_id !== file.turn_id ||
          (file.conversation_id !== undefined &&
            file.conversation_id !== conversationId)
        );
      })
    )
      throw new AppError("VALIDATION_ERROR");

    const share = await this.prisma.conversationShare.create({
      data: {
        conversationId,
        ownerId,
        titleSnapshot: snapshot.conversation.title,
        snapshotJson: snapshot,
      },
    });

    return projectConversationShare(share);
  }

  async get(
    shareId: string,
  ): Promise<
    ConversationShareReceipt & { snapshot: ConversationShareSnapshot }
  > {
    const share = await this.prisma.conversationShare.findUnique({
      where: { id: shareId },
    });
    if (!share) throw new AppError("CONVERSATION_NOT_FOUND");

    const snapshot = conversationShareSnapshotSchema.safeParse(
      share.snapshotJson,
    );
    if (!snapshot.success) throw new AppError("INTERNAL_ERROR");

    return { ...projectConversationShare(share), snapshot: snapshot.data };
  }
}

function projectConversationShare(share: {
  id: string;
  conversationId: string;
  titleSnapshot: string;
  createdAt: Date;
  updatedAt: Date;
}): ConversationShareReceipt {
  return {
    id: share.id,
    conversation_id: share.conversationId,
    title: share.titleSnapshot,
    url_path: `/share/${share.id}`,
    created_at: share.createdAt.toISOString(),
    updated_at: share.updatedAt.toISOString(),
  };
}
