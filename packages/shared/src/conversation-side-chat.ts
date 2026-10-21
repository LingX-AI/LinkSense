import { z } from "zod";

import { uuidSchema } from "./common.js";

export const sideChatSelectionMaximumLength = 4_000;
export const sideChatBackgroundMaximumLength = 1_000;

export const sideChatSelectionSchema = z.strictObject({
  source_message_id: uuidSchema,
  selection_text: z.string().trim().min(1).max(sideChatSelectionMaximumLength),
  include_recent_messages: z.boolean().default(true),
});

export const sideChatReferenceSchema = sideChatSelectionSchema.extend({
  id: uuidSchema,
  source_conversation_id: uuidSchema,
  source_title: z.string().min(1).max(240),
  recent_messages: z.array(z.strictObject({
    id: uuidSchema,
    role: z.enum(["user", "assistant"]),
    text: z.string().max(sideChatBackgroundMaximumLength),
  })).max(2),
});

export const sideChatSchema = z.strictObject({
  conversation_id: uuidSchema,
  parent_conversation_id: uuidSchema,
  reference: sideChatReferenceSchema,
});

export const conversationReferenceInputSchema = z.strictObject({
  kind: z.literal("conversation_reference"),
  reference_id: uuidSchema,
  request: z.string().trim().min(1).max(20_000),
});

export const conversationReferenceDisplaySchema = conversationReferenceInputSchema.extend({
  source_conversation_id: uuidSchema,
  source_message_id: uuidSchema,
  source_title: sideChatReferenceSchema.shape.source_title,
  selection_text: sideChatSelectionSchema.shape.selection_text,
  recent_message_count: z.number().int().min(0).max(2),
});

export type SideChatSelection = z.infer<typeof sideChatSelectionSchema>;
export type SideChatReference = z.infer<typeof sideChatReferenceSchema>;
export type SideChat = z.infer<typeof sideChatSchema>;
export type ConversationReferenceInput = z.infer<typeof conversationReferenceInputSchema>;
export type ConversationReferenceDisplay = z.infer<typeof conversationReferenceDisplaySchema>;
