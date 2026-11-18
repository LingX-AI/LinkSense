import { z } from "zod";
import { timestampSchema, uuidSchema } from "./common.js";

export const localComputerSessionDurationMs = 5 * 60_000;
export const localComputerGrantLimit = 16;
export const localComputerCapabilitySchema = z.enum([
  "computer.observe",
  "computer.act",
  "computer.launch",
  "computer.clipboard",
]);
const targetSchema = z.strictObject({
  bundle_id: z.string().max(255).regex(/^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/u),
});
const requestIdSchema = uuidSchema.transform(value => value.toLowerCase());
export const localComputerSessionInputSchema = z.strictObject({ session_id: requestIdSchema });
export const localComputerPermissionInputSchema = z.discriminatedUnion("action", [
  localComputerSessionInputSchema.extend({
    action: z.literal("grant"),
    grant_id: requestIdSchema,
    capability: localComputerCapabilitySchema,
    target: targetSchema,
  }),
  localComputerSessionInputSchema.extend({
    action: z.literal("revoke"),
    grant_id: requestIdSchema,
  }),
]);
export const localComputerGrantSchema = z.strictObject({
  id: uuidSchema,
  capability: localComputerCapabilitySchema,
  scope: z.literal("session"),
  target: targetSchema,
  expires_at: timestampSchema,
});
export const localComputerStatusSchema = z.strictObject({
  device_id: uuidSchema,
  session: z.strictObject({
    id: uuidSchema,
    expires_at: timestampSchema,
  }).nullable(),
  grants: z.array(localComputerGrantSchema).max(localComputerGrantLimit),
});

export type LocalComputerStatus = z.infer<typeof localComputerStatusSchema>;
export type LocalComputerGrant = z.infer<typeof localComputerGrantSchema>;
export type LocalComputerPermissionInput = z.infer<typeof localComputerPermissionInputSchema>;
