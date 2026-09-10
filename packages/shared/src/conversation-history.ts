import { z } from "zod";

// Keep each turn together: messages, plans and attachments share this boundary.
export const CONVERSATION_HISTORY_PAGE_TURN_LIMIT = 20;

export const conversationHistoryQuerySchema = z.strictObject({
  around_turn: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
});

export type ConversationHistoryQuery = z.infer<typeof conversationHistoryQuerySchema>;

export const conversationHistoryIndexItemSchema = z.strictObject({
  turn_id: z.string(),
  sequence_no: z.number().int().positive(),
  message_id: z.string().nullable(),
  created_at: z.string(),
  has_content: z.boolean(),
});

export type ConversationHistoryIndexItem = z.infer<typeof conversationHistoryIndexItemSchema>;

export const conversationHistoryPageSchema = z.object({
  scope_id: z.string().nullable(),
  turn_ids: z.array(z.string()),
  index: z.array(conversationHistoryIndexItemSchema),
});

export type ConversationHistoryPage = z.infer<typeof conversationHistoryPageSchema>;
