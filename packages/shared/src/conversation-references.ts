import { z } from "zod";
import { uuidSchema } from "./common.js";

export const maximumConversationReferences = 3;
export const maximumConversationReferenceOffset = 10_000_000;
export const conversationReferenceIdsSchema = z.array(uuidSchema).min(1).max(maximumConversationReferences)
  .refine(ids => new Set(ids).size === ids.length, "duplicate_conversation_reference");
export const taskReferencesInputSchema = z.strictObject({
  kind: z.literal("task_references"),
  request: z.string().trim().min(1).max(20_000),
  conversation_ids: conversationReferenceIdsSchema,
});
export const taskReferencesDisplaySchema = taskReferencesInputSchema.extend({
  sources: z.array(z.strictObject({ id: uuidSchema, title: z.string().min(1).max(240) })).min(1).max(maximumConversationReferences),
}).refine(value => value.conversation_ids.length === value.sources.length && value.conversation_ids.every((id, index) => value.sources[index]?.id === id), "reference_sources_mismatch");
export const readConversationReferenceModeSchema = z.enum(["history", "latest_assistant"]);
export const readConversationReferenceInputSchema = z.strictObject({
  conversation_id: uuidSchema,
  mode: readConversationReferenceModeSchema.optional(),
  cursor: z.string().regex(/^\d{1,10}$/u).refine(value => Number(value) <= 2_147_483_647, "invalid_cursor").default("0"),
  offset: z.number().int().min(0).max(maximumConversationReferenceOffset).default(0),
});
export const readConversationReferenceResultSchema = z.strictObject({
  conversation_id: uuidSchema,
  title: z.string(),
  messages: z.array(z.strictObject({ id: uuidSchema, role: z.enum(["user", "assistant"]), text: z.string().max(16_000) })).max(20),
  next_cursor: z.string().nullable(),
  next_offset: z.number().int().nonnegative(),
});
export type ReadConversationReferenceInput = z.infer<typeof readConversationReferenceInputSchema>;
export type ReadConversationReferenceResult = z.infer<typeof readConversationReferenceResultSchema>;
export type TaskReferencesDisplay = z.infer<typeof taskReferencesDisplaySchema>;
