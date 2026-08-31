import { z } from "zod";

import { timestampSchema, uuidSchema } from "./common.js";

export const weixinConnectionStatusSchema = z.enum([
  "active",
  "reauthorization_required",
]);

export const weixinRuntimeStatusSchema = z.enum([
  "online",
  "connecting",
  "error",
  "reauthorization_required",
]);

export const weixinConnectionSchema = z.strictObject({
  id: uuidSchema,
  account_hint: z.string().min(1).max(80),
  application: z
    .strictObject({
      id: uuidSchema,
      name: z.string().min(1).max(160),
    })
    .nullable(),
  status: weixinConnectionStatusSchema,
  runtime_status: weixinRuntimeStatusSchema,
  last_poll_at: timestampSchema.nullable(),
  last_inbound_at: timestampSchema.nullable(),
  last_error_code: z.string().min(1).max(120).nullable(),
  created_at: timestampSchema,
  updated_at: timestampSchema,
});

export const weixinConnectionListSchema = z.strictObject({
  items: z.array(weixinConnectionSchema).max(1),
});

export const weixinLoginStatusSchema = z.enum([
  "waiting_scan",
  "scanned",
  "verification_required",
  "connected",
  "expired",
  "failed",
]);

export const weixinLoginSessionSchema = z.strictObject({
  id: uuidSchema,
  status: weixinLoginStatusSchema,
  qrcode_url: z.string().url().max(4_096).nullable(),
  expires_at: timestampSchema,
  connection: weixinConnectionSchema.nullable(),
});

export const weixinLoginStartInputSchema = z.strictObject({
  application_id: uuidSchema.nullable().default(null),
});

export const weixinVerificationInputSchema = z.strictObject({
  verify_code: z.string().trim().regex(/^\d{4,8}$/u),
});

export const weixinConnectionUpdateInputSchema = z.strictObject({
  application_id: uuidSchema.nullable(),
});

export type WeixinConnection = z.infer<typeof weixinConnectionSchema>;
export type WeixinConnectionStatus = z.infer<
  typeof weixinConnectionStatusSchema
>;
export type WeixinLoginSession = z.infer<typeof weixinLoginSessionSchema>;
export type WeixinLoginStatus = z.infer<typeof weixinLoginStatusSchema>;
export type WeixinRuntimeStatus = z.infer<typeof weixinRuntimeStatusSchema>;
