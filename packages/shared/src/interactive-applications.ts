import { z } from "zod";

import { timestampSchema, uuidSchema } from "./common.js";

export const interactiveApplicationTaskInputSchema = z.strictObject({
  prompt: z.string().trim().min(1).max(200_000),
  capability_ids: z.array(z.string()).max(50).default([]),
  knowledge_base_ids: z.array(uuidSchema).max(20).default([]),
  idempotency_key: z.string().trim().min(1).max(120).optional(),
});
export type InteractiveApplicationTaskInput = z.infer<
  typeof interactiveApplicationTaskInputSchema
>;

export const INTERACTIVE_APPLICATION_ARCHIVE_MAX_BYTES = 10 * 1024 * 1024;
export const INTERACTIVE_APPLICATION_EXPANDED_MAX_BYTES = 30 * 1024 * 1024;
export const INTERACTIVE_APPLICATION_ENTRY_MAX_BYTES = 5 * 1024 * 1024;
export const INTERACTIVE_APPLICATION_ENTRY_MAX_COUNT = 200;

export const interactiveApplicationEventNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u)
  .refine(
    (name) =>
      !name.startsWith("linksense.") &&
      !name.startsWith("conversation.") &&
      !name.startsWith("turn.") &&
      !name.startsWith("item."),
  );

export const interactiveApplicationCustomEventDefinitionSchema =
  z.strictObject({
    name: interactiveApplicationEventNameSchema,
    description: z.string().trim().min(1).max(2_000),
    schema_version: z.number().int().min(1).max(1_000).default(1),
    payload_schema: z.record(z.string(), z.json()),
  });

export const interactiveApplicationPermissionSchema = z.enum([
  "user.profile:read",
  "capabilities:read",
  "knowledge_bases:read",
  "mcp_servers:read",
  "tasks:write",
]);

export const interactiveApplicationManifestSchema = z
  .strictObject({
    schema_version: z.literal(1),
    id: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .regex(/^[a-z][a-z0-9]*(?:[-_][a-z0-9]+)*$/u),
    name: z.string().trim().min(1).max(160),
    version: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .regex(/^[0-9A-Za-z][0-9A-Za-z._+-]*$/u),
    description: z.string().trim().max(4_000).nullable().default(null),
    instructions: z.string().trim().max(20_000).nullable().default(null),
    icon: z.string().trim().min(1).max(500).nullable().default(null),
    entry: z.literal("index.html").default("index.html"),
    sdk_version: z.literal(1),
    permissions: z
      .array(interactiveApplicationPermissionSchema)
      .max(5)
      .default([
        "user.profile:read",
        "capabilities:read",
        "knowledge_bases:read",
        "mcp_servers:read",
        "tasks:write",
      ]),
    custom_events: z
      .array(interactiveApplicationCustomEventDefinitionSchema)
      .max(50)
      .default([]),
  })
  .superRefine((manifest, context) => {
    const eventNames = manifest.custom_events.map((event) => event.name);
    if (new Set(eventNames).size !== eventNames.length) {
      context.addIssue({
        code: "custom",
        path: ["custom_events"],
        message: "duplicate_custom_event_name",
      });
    }
    if (new Set(manifest.permissions).size !== manifest.permissions.length) {
      context.addIssue({
        code: "custom",
        path: ["permissions"],
        message: "duplicate_permission",
      });
    }
  });

export const interactiveApplicationPackageSchema = z.strictObject({
  id: uuidSchema,
  version: z.string().min(1).max(80),
  manifest: interactiveApplicationManifestSchema,
  created_at: timestampSchema,
});

export const interactiveApplicationRuntimeTokenResultSchema = z.strictObject({
  runtime_url: z.string().min(1).max(8_192),
  expires_at: timestampSchema,
  manifest: interactiveApplicationManifestSchema,
});

export const interactiveApplicationCustomEventSchema = z.strictObject({
  event_id: uuidSchema,
  conversation_id: uuidSchema,
  turn_id: uuidSchema,
  name: interactiveApplicationEventNameSchema,
  schema_version: z.number().int().min(1).max(1_000),
  sequence: z.number().int().positive(),
  payload: z.json(),
  created_at: timestampSchema,
});

export const emitInteractiveApplicationCustomEventInputSchema = z
  .strictObject({
    name: interactiveApplicationEventNameSchema,
    payload: z.record(z.string(), z.json()),
  })
  .superRefine((event, context) => {
    if (JSON.stringify(event.payload).length > 64 * 1024) {
      context.addIssue({
        code: "custom",
        path: ["payload"],
        message: "custom_event_payload_too_large",
      });
    }
  });

export type InteractiveApplicationManifest = z.infer<
  typeof interactiveApplicationManifestSchema
>;
export type InteractiveApplicationCustomEventDefinition = z.infer<
  typeof interactiveApplicationCustomEventDefinitionSchema
>;
export type InteractiveApplicationPackage = z.infer<
  typeof interactiveApplicationPackageSchema
>;
