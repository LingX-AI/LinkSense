import { z } from "zod";

export const conversationSourceUrlSchema = z.url({ protocol: /^https?$/ }).refine((value) => {
  const url = URL.parse(value);
  if (!url) return false;
  return !url.username && !url.password;
});

export const conversationSourceSchema = z.strictObject({
  url: conversationSourceUrlSchema,
  title: z.string().max(400).nullable(),
});

export const conversationSourcesSchema = z.strictObject({
  items: z.array(conversationSourceSchema),
});

export type ConversationSource = z.infer<typeof conversationSourceSchema>;
export type ConversationSources = z.infer<typeof conversationSourcesSchema>;
