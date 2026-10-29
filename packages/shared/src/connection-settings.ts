import { z } from "zod";
import { connectionProviderSchema } from "./connections.js";

export const connectionSettingsStorage = {
  id: "00000000-0000-4000-8000-000000000001",
  key: "connection_settings_encrypted",
  context: "linksense:connection-settings:v1",
  lockKey: "linksense-connection-settings",
} as const;

export const connectionConfigurationSchema = z.strictObject({
  revision: z.number().int().nonnegative(),
  client_id: z.string().max(512),
  client_secret: z.string().max(16_384),
});
export type ConnectionConfiguration = z.infer<typeof connectionConfigurationSchema>;
export const connectionSettingsEnvelopeSchema = z.partialRecord(
  connectionProviderSchema,
  connectionConfigurationSchema,
);

export const connectionProviderSettingsSchema = z.strictObject({
  provider: connectionProviderSchema,
  revision: z.number().int().nonnegative(),
  client_id: z.string().max(512),
  secret_configured: z.boolean(),
  redirect_uri: z.url(),
  required_scopes: z.array(z.string().min(1).max(256)).max(100),
  connected_account_count: z.number().int().nonnegative(),
});
export type ConnectionProviderSettings = z.infer<typeof connectionProviderSettingsSchema>;
export const connectionSettingsListSchema = z.array(connectionProviderSettingsSchema);

export const updateConnectionSettingsSchema = z.strictObject({
  expected_revision: z.number().int().nonnegative(),
  client_id: z.string().trim().min(1).max(512),
  client_secret: z.string().min(1).max(16_384).refine((value) => value.trim().length > 0).optional(),
  acknowledge_reauthorization: z.boolean().default(false),
});
export type UpdateConnectionSettings = z.infer<typeof updateConnectionSettingsSchema>;
