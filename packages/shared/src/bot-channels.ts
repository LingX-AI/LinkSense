import { z } from "zod";
import { timestampSchema, uuidSchema } from "./common.js";

export const botChannelProviderSchema = z.enum(["wecom", "dingtalk", "teams"]);
export type BotChannelProvider = z.infer<typeof botChannelProviderSchema>;
const identifier = z.string().trim().min(1).max(128);
const secret = z.string().min(1).max(4096);
const wecomCredentials = z.strictObject({
  provider: z.literal("wecom"),
  bot_id: identifier,
  secret,
});
const dingtalkCredentials = z.strictObject({
  provider: z.literal("dingtalk"),
  client_id: identifier,
  client_secret: secret,
});
const teamsCredentials = z.strictObject({
  provider: z.literal("teams"),
  client_id: z.uuid(),
  client_secret: secret,
  tenant_id: z.uuid(),
});
export const botChannelCredentialsSchema = z.discriminatedUnion("provider", [
  wecomCredentials,
  dingtalkCredentials,
  teamsCredentials,
]);
export type BotChannelCredentials = z.infer<typeof botChannelCredentialsSchema>;
export const botChannelPolicySchema = z.strictObject({
  allow_group_messages: z.boolean().default(true),
});
export const botChannelAdminCreateSchema = z.discriminatedUnion("provider", [
  wecomCredentials.extend(botChannelPolicySchema.shape),
  teamsCredentials.extend(botChannelPolicySchema.shape),
]);
export type BotChannelAdminCreate = z.infer<typeof botChannelAdminCreateSchema>;
export const botChannelEnabledSchema = z.strictObject({ enabled: z.boolean() });
export const botChannelConnectionSchema = z.strictObject({
  id: uuidSchema,
  provider: botChannelProviderSchema,
  scope: z.enum(["personal", "organization"]),
  identity_linked: z.boolean(),
  allow_group_messages: z.boolean(),
  runtime_status: z.enum([
    "connecting",
    "online",
    "waiting_message",
    "error",
    "disabled",
  ]),
  last_connected_at: timestampSchema.nullable(),
  last_inbound_at: timestampSchema.nullable(),
  last_error_code: z.string().max(120).nullable(),
  created_at: timestampSchema,
});
export type BotChannelConnection = z.infer<typeof botChannelConnectionSchema>;
export const botChannelConnectionListSchema = z.strictObject({
  items: z.array(botChannelConnectionSchema).max(3),
});
export const botChannelAdminConnectionSchema =
  botChannelConnectionSchema.extend({
    account_hint: identifier,
    callback_url: z.url().nullable(),
  });
export type BotChannelAdminConnection = z.infer<
  typeof botChannelAdminConnectionSchema
>;
export const botChannelAdminConnectionListSchema = z.strictObject({
  items: z.array(botChannelAdminConnectionSchema).max(2),
});
export const botChannelLinkingSessionSchema = z.strictObject({
  command: z.string().regex(/^LINK [A-F0-9]{24}$/u),
  expires_at: timestampSchema,
});
export type BotChannelLinkingSession = z.infer<
  typeof botChannelLinkingSessionSchema
>;
export const botChannelRegistrationSchema = z.strictObject({
  id: uuidSchema,
  status: z.enum(["waiting_scan", "connected", "expired", "failed"]),
  qr_code_url: z.url().nullable(),
  expires_at: timestampSchema,
  connection_id: uuidSchema.nullable(),
});
export type BotChannelRegistration = z.infer<
  typeof botChannelRegistrationSchema
>;
