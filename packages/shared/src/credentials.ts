import { z } from "zod";

import { timestampSchema, uuidSchema } from "./common.js";

export const credentialStatusSchema = z.enum(["active", "disabled"]);
export const credentialBindingStatusSchema = z.enum(["active", "revoked"]);

export const credentialProviderTypeSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9]+(?:[_-][a-z0-9]+)*$/u);

export const credentialEnvironmentKeySchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[A-Za-z_][A-Za-z0-9_]*$/u);

export const credentialSchema = z.strictObject({
  id: uuidSchema,
  owner_id: uuidSchema,
  name: z.string().trim().min(1).max(160),
  provider_type: credentialProviderTypeSchema,
  encryption_key_id: z.string().min(1).max(120),
  status: credentialStatusSchema,
  created_by: uuidSchema,
  updated_by: uuidSchema.nullable(),
  last_used_at: timestampSchema.nullable(),
  created_at: timestampSchema,
  updated_at: timestampSchema,
});

export const credentialSecretPayloadSchema = z
  .record(
    credentialEnvironmentKeySchema,
    z
      .string()
      .min(1)
      .max(64 * 1024),
  )
  .refine((payload) => Object.keys(payload).length > 0, {
    message: "credential_payload_cannot_be_empty",
  });

export const createCredentialInputSchema = z.strictObject({
  name: z.string().trim().min(1).max(160),
  provider_type: credentialProviderTypeSchema,
  secret_payload: credentialSecretPayloadSchema,
});

export const credentialBindingSchema = z.strictObject({
  id: uuidSchema,
  credential_id: uuidSchema,
  capability_id: uuidSchema,
  user_id: uuidSchema,
  env_key: credentialEnvironmentKeySchema,
  credential_key: credentialEnvironmentKeySchema,
  status: credentialBindingStatusSchema,
  created_by: uuidSchema,
  revoked_by: uuidSchema.nullable(),
  revoked_at: timestampSchema.nullable(),
  created_at: timestampSchema,
  updated_at: timestampSchema,
});

export const credentialBindingMappingSchema = z.strictObject({
  env_key: credentialEnvironmentKeySchema,
  credential_key: credentialEnvironmentKeySchema,
});

export const syncCredentialBindingsInputSchema = z.strictObject({
  credential_id: uuidSchema,
  capability_id: uuidSchema,
  mappings: z.array(credentialBindingMappingSchema).max(1_000),
});

export const credentialResolutionBlockCodeSchema = z.enum([
  "required_credential_unavailable",
  "credential_binding_ambiguous",
]);

export type Credential = z.infer<typeof credentialSchema>;
export type CreateCredentialInput = z.input<typeof createCredentialInputSchema>;
export type CredentialBinding = z.infer<typeof credentialBindingSchema>;
export type CredentialBindingMapping = z.infer<
  typeof credentialBindingMappingSchema
>;
