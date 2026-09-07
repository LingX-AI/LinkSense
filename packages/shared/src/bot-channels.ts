import { z } from "zod";

import { timestampSchema, uuidSchema } from "./common.js";

export const botChannelProviderSchema = z.enum(["wecom", "dingtalk", "teams"]);
export type BotChannelProvider = z.infer<typeof botChannelProviderSchema>;

const identifier = z.string().trim().min(1).max(128);
const secret = z.string().min(1).max(4096);
const access = {
  allowed_sender_id: z.string().trim().min(1).max(256),
  allow_group_messages: z.boolean().default(true),
};
export const botChannelCreateSchema = z.discriminatedUnion("provider", [
  z.strictObject({
    provider: z.literal("wecom"),
    bot_id: identifier,
    secret,
    ...access,
  }),
  z.strictObject({
    provider: z.literal("dingtalk"),
    client_id: identifier,
    client_secret: secret,
    ...access,
  }),
  z.strictObject({
    provider: z.literal("teams"),
    client_id: z.uuid(),
    client_secret: secret,
    tenant_id: z.uuid(),
    ...access,
    allowed_sender_id: z.uuid(),
  }),
]);
export type BotChannelCreate = z.infer<typeof botChannelCreateSchema>;

export const botChannelConnectionSchema = z.strictObject({
  id: uuidSchema,
  provider: botChannelProviderSchema,
  account_hint: identifier,
  allowed_sender_id: z.string().min(1).max(256),
  allow_group_messages: z.boolean(),
  runtime_status: z.enum(["connecting", "online", "waiting_message", "error"]),
  last_connected_at: timestampSchema.nullable(),
  last_inbound_at: timestampSchema.nullable(),
  last_error_code: z.string().max(120).nullable(),
  callback_url: z.url().nullable(),
  created_at: timestampSchema,
});
export type BotChannelConnection = z.infer<typeof botChannelConnectionSchema>;
export const botChannelConnectionListSchema = z.strictObject({
  items: z.array(botChannelConnectionSchema).max(3),
});
