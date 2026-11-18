import { z } from "zod";
import { timestampSchema, uuidSchema } from "./common.js";
import { desktopProtocolVersion } from "./desktop-protocol.js";
import {
  modelContextWindowSchema,
  modelIdentifierSchema,
  modelProviderProtocolModeSchema,
  reasoningEffortSchema,
} from "./model-provider.js";

export const desktopDeviceCapabilitiesSchema = z.strictObject({
  local_execution: z.boolean().default(false),
  browser_extension: z.boolean().default(false),
  computer_use: z.boolean().default(false),
});
export const desktopDeviceRegistrationSchema = z.strictObject({
  name: z.string().trim().min(1).max(120).regex(/^[^\u0000-\u001f\u007f]+$/u),
  platform: z.enum(["darwin", "windows"]),
  arch: z.enum(["amd64", "arm64"]),
  app_version: z.string().min(1).max(40).regex(/^[A-Za-z0-9._+-]+$/u),
  capabilities: desktopDeviceCapabilitiesSchema.default({
    local_execution: false, browser_extension: false, computer_use: false,
  }),
});
export const desktopDeviceRenameInputSchema = desktopDeviceRegistrationSchema.pick({ name: true });
export const desktopPairingCodeSchema = z.string().regex(/^[a-f0-9]{32}$/u);
export const desktopDeviceTokenSchema = z.string().regex(/^[a-f0-9]{64}$/u);
export const desktopDevicePairInputSchema = desktopDeviceRegistrationSchema.extend({
  code: desktopPairingCodeSchema,
});
export const desktopPairingSchema = z.strictObject({
  code: desktopPairingCodeSchema,
  expires_at: timestampSchema,
});
export const desktopDeviceSchema = desktopDeviceRegistrationSchema.extend({
  id: uuidSchema,
  online: z.boolean(),
  last_seen_at: timestampSchema.nullable(),
  revoked_at: timestampSchema.nullable(),
  created_at: timestampSchema,
  updated_at: timestampSchema,
});
export const desktopDeviceRenameResultSchema = desktopDeviceSchema.pick({ id: true, name: true });
export const desktopDevicePairResultSchema = z.strictObject({
  token: desktopDeviceTokenSchema,
  owner_id: uuidSchema,
  device: desktopDeviceSchema,
});
export const desktopDeviceListSchema = z.strictObject({ items: z.array(desktopDeviceSchema) });
export const desktopDeviceClientFrameSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("hello"),
    token: desktopDeviceTokenSchema,
    protocol_version: z.literal(desktopProtocolVersion),
  }),
  z.strictObject({ type: z.literal("ping") }),
]);
export const desktopDeviceServerFrameSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("ready"),
    device_id: uuidSchema,
    connection_id: uuidSchema,
    protocol_version: z.literal(desktopProtocolVersion),
    heartbeat_interval_ms: z.literal(15_000),
  }),
  z.strictObject({ type: z.literal("pong") }),
]);

export const desktopRunTokenSchema = z.string().regex(/^lsdr_[A-Za-z0-9_-]{43}$/u);
export const desktopModelTokenSchema = z.string().regex(/^lsdm_[A-Za-z0-9_-]{43}$/u);
export const desktopModelPurposeSchema = z.enum(["primary", "memory_extraction", "transition_source"]);
const desktopModelAccessSchema = z.strictObject({
  model: modelIdentifierSchema,
  revision: z.number().int().nonnegative(),
  protocol_mode: modelProviderProtocolModeSchema,
  token: desktopModelTokenSchema,
});
const desktopModelContextShape = {
  context_window: modelContextWindowSchema.optional(),
  auto_compact_token_limit: modelContextWindowSchema.optional(),
};

export const desktopRunCredentialsSchema = z.strictObject({
  turn_id: uuidSchema,
  expires_at: timestampSchema,
  run_token: desktopRunTokenSchema,
  primary: desktopModelAccessSchema.extend({
    purpose: z.literal(desktopModelPurposeSchema.enum.primary),
    ...desktopModelContextShape,
  }),
  memory_extraction: desktopModelAccessSchema.extend({
    purpose: z.literal(desktopModelPurposeSchema.enum.memory_extraction),
    reasoning_effort: reasoningEffortSchema,
  }).optional(),
  transition_source: desktopModelAccessSchema.extend({
    purpose: z.literal(desktopModelPurposeSchema.enum.transition_source),
    ...desktopModelContextShape,
  }).optional(),
});

export type DesktopModelPurpose = z.infer<typeof desktopModelPurposeSchema>;
export type DesktopRunCredentials = z.infer<typeof desktopRunCredentialsSchema>;
export type DesktopDevice = z.infer<typeof desktopDeviceSchema>;
export type DesktopDeviceRenameResult = z.infer<typeof desktopDeviceRenameResultSchema>;
export type DesktopDeviceRegistration = z.infer<typeof desktopDeviceRegistrationSchema>;
export type DesktopDeviceCapabilities = z.infer<typeof desktopDeviceCapabilitiesSchema>;
export type DesktopPairing = z.infer<typeof desktopPairingSchema>;
