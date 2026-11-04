import { z } from "zod";

export const computerUseToolName = "computer_use";
export const computerUseHelpPath = "/settings/general#computer-use";
export const COMPUTER_USE_PROTOCOL_VERSION = "1";
export const COMPUTER_USE_COMMAND_TTL_MS = 60_000;
export const COMPUTER_USE_MAX_IMAGE_LENGTH = 6_000_000;
const identifier = z.string().min(1).max(200).regex(/^[A-Za-z0-9][A-Za-z0-9._:+-]*$/u);
const app = z.string().min(1).max(200).regex(/^[\p{L}\p{N}][\p{L}\p{N}\p{M} ._:/+()&'-]*$/u);
const ref = z.string().max(200).regex(/^@[A-Za-z0-9._-]+:e[0-9]+$/u);
const device = { device_id: z.uuid() };
const window = { ...device, app, window_id: identifier };
export const computerUseKeyValues = [
  "Enter", "Tab", "Shift+Tab", "Escape", "Backspace", "Delete",
  "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space",
  "Cmd+A", "Cmd+C", "Cmd+V", "Cmd+S", "Cmd+Z", "Cmd+Shift+Z",
  "Ctrl+A", "Ctrl+C", "Ctrl+V", "Ctrl+S", "Ctrl+Z",
] as const;
export const computerUseRequestSchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("status") }),
  z.strictObject({ action: z.literal("apps"), ...device }),
  z.strictObject({ action: z.literal("windows"), ...device, app }),
  z.strictObject({ action: z.enum(["snapshot", "screenshot"]), ...window }),
  z.strictObject({ action: z.enum(["click", "focus"]), ...device, ref }),
  z.strictObject({
    action: z.literal("type"), ...device, ref,
    text: z.string().max(8_000).refine((value) => !value.includes("\0") && new TextEncoder().encode(value).length <= 8_000),
  }),
  z.strictObject({ action: z.literal("key"), ...window, key: z.enum(computerUseKeyValues) }),
  z.strictObject({
    action: z.literal("scroll"), ...device, ref,
    direction: z.enum(["up", "down", "left", "right"]),
    amount: z.number().int().min(1).max(10).default(3),
  }),
  z.strictObject({ action: z.literal("release"), ...device }),
]);
export type ComputerUseRequest = z.infer<typeof computerUseRequestSchema>;
export function computerUseReadOnly(input: ComputerUseRequest): boolean {
  return ["status", "apps", "windows", "snapshot", "screenshot"].includes(input.action);
}
export const computerUsePermissionSchema = z.enum(["granted", "denied", "unknown"]);
export const computerUsePermissionsSchema = z.strictObject({
  accessibility: computerUsePermissionSchema,
  screen_recording: computerUsePermissionSchema,
});
export const computerUseControlSchema = z.enum(["ready", "pending", "running", "paused"]);
export const computerUseDeviceSchema = z.strictObject({
  id: z.uuid(),
  name: z.string().min(1).max(100),
  platform: z.enum(["darwin", "win32", "linux"]),
});
export const computerUseStatusSchema = z.strictObject({
  connected: z.boolean(),
  device: computerUseDeviceSchema.optional(),
  control: computerUseControlSchema.optional(),
  permissions: computerUsePermissionsSchema.optional(),
  client_available: z.boolean().optional(),
  clients: z.object({
    darwin: z.boolean(),
    win32: z.boolean(),
    linux: z.boolean(),
  }).strict().optional(),
});
export type ComputerUseStatus = z.infer<typeof computerUseStatusSchema>;
export const computerUseFailureCodes = [
  "COMPUTER_USE_NOT_CONNECTED", "COMPUTER_USE_ACCESS_DENIED",
  "COMPUTER_USE_BUSY", "COMPUTER_USE_PAUSED", "COMPUTER_USE_TIMEOUT",
  "COMPUTER_USE_CANCELLED", "COMPUTER_USE_PERMISSION_REQUIRED",
  "COMPUTER_USE_ENGINE_UNAVAILABLE", "COMPUTER_USE_STALE_REF", "COMPUTER_USE_COMMAND_FAILED",
] as const;
export const computerUseResultSchema = z.discriminatedUnion("ok", [
  z.strictObject({
    ok: z.literal(true),
    data: z.strictObject({
      status: computerUseStatusSchema.optional(),
      text: z.string().max(512_000).optional(),
      truncated: z.boolean().optional(),
      image: z.string().max(COMPUTER_USE_MAX_IMAGE_LENGTH).regex(/^[A-Za-z0-9+/]*={0,2}$/u).optional(),
      mime_type: z.literal("image/png").optional(),
    }),
  }),
  z.strictObject({
    ok: z.literal(false),
    code: z.enum(computerUseFailureCodes),
    retryable: z.literal(false),
    delivery: z.enum(["not_delivered", "unknown"]),
    help_path: z.literal(computerUseHelpPath),
  }),
]);
export type ComputerUseResult = z.infer<typeof computerUseResultSchema>;
export function computerUseFailure(
  code: (typeof computerUseFailureCodes)[number],
  delivery: "not_delivered" | "unknown" = "not_delivered",
): ComputerUseResult {
  return { ok: false, code, retryable: false, delivery, help_path: computerUseHelpPath };
}
export const computerUsePairingSchema = z.strictObject({
  code: z.string().min(32).max(100),
  endpoint: z.url(),
  expires_at: z.iso.datetime(),
});
export const computerUsePairRequestSchema = z.strictObject({
  code: computerUsePairingSchema.shape.code,
  name: computerUseDeviceSchema.shape.name,
  platform: computerUseDeviceSchema.shape.platform,
});
export const computerUsePairResponseSchema = z.strictObject({
  token: z.string().min(32).max(100),
  device: computerUseDeviceSchema,
});
export const computerUseCommandSchema = z.strictObject({
  type: z.literal("command"),
  id: z.uuid(),
  connection_id: z.uuid(),
  device_id: z.uuid(),
  conversation_id: z.uuid(),
  turn_id: z.uuid(),
  title: z.string().max(500),
  expires_at: z.number().int().positive(),
  read_only: z.boolean(),
  request: computerUseRequestSchema,
});
export type ComputerUseCommand = z.infer<typeof computerUseCommandSchema>;
export const computerUseHelloSchema = z.strictObject({
  type: z.literal("authenticate"),
  version: z.literal(COMPUTER_USE_PROTOCOL_VERSION),
  token: computerUsePairResponseSchema.shape.token,
  device_id: z.uuid(),
});
export const computerUseClientMessageSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("heartbeat"), control: computerUseControlSchema, permissions: computerUsePermissionsSchema }),
  z.strictObject({ type: z.literal("reply"), id: z.uuid(), result: computerUseResultSchema }),
  z.strictObject({ type: z.enum(["pause", "resume"]) }),
]);
export const computerUseIntentRequestSchema = z.strictObject({ message_id: z.uuid() });
