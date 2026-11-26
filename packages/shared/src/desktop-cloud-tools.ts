import { z } from "zod";

import { timestampSchema, uuidSchema } from "./common.js";
import { desktopDeviceAppVersionSchema } from "./desktop-device.js";

/**
 * Cloud task -> API -> Mac tool lane. It is independent of the retired local
 * execution protocol: the Mac advertises it even when no local runtime exists.
 */
export const DESKTOP_CLOUD_TOOL_PROTOCOL_HEADER = "x-linksense-desktop-cloud-tools";
export const DESKTOP_CLOUD_TOOL_OPERATIONS_HEADER = "x-linksense-desktop-cloud-tool-operations";
export const desktopCloudToolProtocolVersion = 1;
export const desktopCloudToolLifetimeMs = 10_000;

export const localToolsPingOperation = "local_tools.ping" as const;
export const desktopCloudToolOperationSchema = z.enum([localToolsPingOperation]);
export type DesktopCloudToolOperation = z.infer<typeof desktopCloudToolOperationSchema>;
export const localToolsPingToolName = "local_tools_ping" as const;

export const desktopCloudToolPingInputSchema = z.strictObject({
  message: z.string().trim().min(1).max(200),
});
export type DesktopCloudToolPingInput = z.infer<typeof desktopCloudToolPingInputSchema>;

export const desktopCloudToolPingResultSchema = z.strictObject({
  message: z.string(),
  platform: z.enum(["darwin", "windows"]),
  app_version: desktopDeviceAppVersionSchema,
});
export type DesktopCloudToolPingResult = z.infer<typeof desktopCloudToolPingResultSchema>;

export const desktopCloudToolErrorCodeSchema = z.enum([
  "FORBIDDEN",
  "RUNNER_UNAVAILABLE",
  "DESKTOP_TOOL_UNAVAILABLE",
  "CANCELLED",
]);
export type DesktopCloudToolErrorCode = z.infer<typeof desktopCloudToolErrorCodeSchema>;

export const desktopCloudToolRequestSchema = z.strictObject({
  type: z.literal("cloud_tool.request"),
  id: uuidSchema,
  operation: desktopCloudToolOperationSchema,
  input: desktopCloudToolPingInputSchema,
  expires_at: timestampSchema,
});
export type DesktopCloudToolRequest = z.infer<typeof desktopCloudToolRequestSchema>;

export const desktopCloudToolResultSchema = z.discriminatedUnion("ok", [
  z.strictObject({
    type: z.literal("cloud_tool.result"),
    id: uuidSchema,
    operation: desktopCloudToolOperationSchema,
    ok: z.literal(true),
    data: desktopCloudToolPingResultSchema,
  }),
  z.strictObject({
    type: z.literal("cloud_tool.result"),
    id: uuidSchema,
    operation: desktopCloudToolOperationSchema,
    ok: z.literal(false),
    error_code: desktopCloudToolErrorCodeSchema,
  }),
]);
export type DesktopCloudToolResult = z.infer<typeof desktopCloudToolResultSchema>;

export const desktopCloudToolCancelSchema = z.strictObject({
  type: z.literal("cloud_tool.cancel"),
  id: uuidSchema,
  operation: desktopCloudToolOperationSchema,
});
export type DesktopCloudToolCancel = z.infer<typeof desktopCloudToolCancelSchema>;
