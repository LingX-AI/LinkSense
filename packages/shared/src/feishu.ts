import { z } from "zod";

import { timestampSchema, uuidSchema } from "./common.js";

export const feishuConnectionStatusSchema = z.enum([
  "active",
  "reauthorization_required",
]);

export const feishuRuntimeStatusSchema = z.enum([
  "online",
  "connecting",
  "pending_approval",
  "error",
  "reauthorization_required",
]);

export const feishuConnectionSchema = z.strictObject({
  id: uuidSchema,
  account_hint: z.string().min(1).max(80),
  bot_name: z.string().min(1).max(120).nullable(),
  status: feishuConnectionStatusSchema,
  runtime_status: feishuRuntimeStatusSchema,
  last_connected_at: timestampSchema.nullable(),
  last_inbound_at: timestampSchema.nullable(),
  last_error_code: z.string().min(1).max(120).nullable(),
  created_at: timestampSchema,
  updated_at: timestampSchema,
});

export const feishuConnectionListSchema = z.strictObject({
  items: z.array(feishuConnectionSchema).max(1),
});

export const feishuRegistrationStatusSchema = z.enum([
  "generating_qr",
  "waiting_scan",
  "pending_approval",
  "connected",
  "expired",
  "failed",
]);

export const feishuRegistrationSessionSchema = z.strictObject({
  id: uuidSchema,
  operation: z.enum(["create", "update"]),
  status: feishuRegistrationStatusSchema,
  qrcode_url: z.string().url().max(8_192).nullable(),
  expires_at: timestampSchema,
  connection: feishuConnectionSchema.nullable(),
});

export const feishuRegistrationStartInputSchema = z.strictObject({
  reuse_existing: z.boolean().optional().default(false),
  force_create: z.boolean().optional().default(false),
}).refine((input) => !(input.reuse_existing && input.force_create), {
  message: "FEISHU_REGISTRATION_MODE_CONFLICT",
});

export type FeishuConnection = z.infer<typeof feishuConnectionSchema>;
export type FeishuConnectionStatus = z.infer<
  typeof feishuConnectionStatusSchema
>;
export type FeishuRegistrationSession = z.infer<
  typeof feishuRegistrationSessionSchema
>;
export type FeishuRegistrationStatus = z.infer<
  typeof feishuRegistrationStatusSchema
>;
export type FeishuRuntimeStatus = z.infer<
  typeof feishuRuntimeStatusSchema
>;
