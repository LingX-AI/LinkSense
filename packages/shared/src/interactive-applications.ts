import { z } from "zod";
import { applicationIconPresetSchema } from "./application-icons.js";

import { timestampSchema, uuidSchema } from "./common.js";

export const INTERACTIVE_APPLICATION_FILE_SOURCE =
  "interactive_application_upload";
export const interactiveApplicationFileIdsSchema = z
  .array(uuidSchema)
  .max(100)
  .refine((ids) => new Set(ids).size === ids.length, "duplicate_file_id");
export const interactiveApplicationFileSchema = z.strictObject({
  id: uuidSchema,
  filename: z.string().min(1).max(260),
  mime_type: z.string().nullable(),
  size_bytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  status: z.enum(["staged", "bound"]),
  turn_id: uuidSchema.nullable(),
});
export const interactiveApplicationFilesResultSchema = z.strictObject({
  items: z.array(interactiveApplicationFileSchema),
});
export type InteractiveApplicationFile = z.infer<
  typeof interactiveApplicationFileSchema
>;

export const interactiveApplicationTaskInputSchema = z.strictObject({
  prompt: z.string().trim().min(1).max(200_000),
  capability_ids: z.array(z.string()).max(50).default([]),
  knowledge_base_ids: z.array(uuidSchema).max(20).default([]),
  file_ids: interactiveApplicationFileIdsSchema.default([]),
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
  "files:write",
]);

export const interactiveDependencyTypeSchema = z.enum([
  "plugin", "skill", "mcp_server", "knowledge_base",
]);
const dependencyDeclarationSchema = z.strictObject({
  id: uuidSchema.toLowerCase(),
  name: z.string().trim().min(1).max(160),
});
export const interactiveDependenciesSchema = z.strictObject({
  plugins: z.array(dependencyDeclarationSchema).max(50).default([]),
  skills: z.array(dependencyDeclarationSchema).max(50).default([]),
  mcp_servers: z.array(dependencyDeclarationSchema).max(20).default([]),
  knowledge_bases: z.array(dependencyDeclarationSchema).max(20).default([]),
}).superRefine((value, context) => {
  const capabilities = [...value.plugins, ...value.skills];
  if (capabilities.length > 50) context.addIssue({ code: "custom", message: "too_many_capabilities" });
  for (const items of [capabilities, value.mcp_servers, value.knowledge_bases]) {
    if (new Set(items.map(item => item.id)).size !== items.length) {
      context.addIssue({ code: "custom", message: "duplicate_dependency_id" });
    }
  }
});

export const interactiveDependencyBindingSchema = z.strictObject({
  type: interactiveDependencyTypeSchema,
  id: uuidSchema.toLowerCase(),
  resource_id: uuidSchema.toLowerCase().nullable(),
});
export const interactiveDependencyBindingsSchema = z.array(interactiveDependencyBindingSchema).max(90)
  .refine(items => new Set(items.map(item => `${item.type}:${item.id}`)).size === items.length, "duplicate_dependency_binding");
export const interactiveDependencySelectionSchema = z.strictObject({
  bindings: interactiveDependencyBindingsSchema,
});
export const interactiveDependencyStateSchema = z.strictObject({
  items: z.array(interactiveDependencyBindingSchema.extend({
    name: z.string(),
    resource_name: z.string().nullable(),
    available: z.boolean(),
  })).max(90),
});
export const interactiveDependencyOptionsSchema = z.strictObject({
  items: z.array(z.strictObject({ id: uuidSchema, name: z.string() })).max(100),
  next_cursor: uuidSchema.nullable(),
});
export type InteractiveDependencyOptions = z.infer<typeof interactiveDependencyOptionsSchema>;
export type InteractiveDependencyType = z.infer<typeof interactiveDependencyTypeSchema>;
export type InteractiveDependencyBinding = z.infer<typeof interactiveDependencyBindingSchema>;
export type InteractiveDependencyState = z.infer<typeof interactiveDependencyStateSchema>;
export type InteractiveDependencies = z.infer<typeof interactiveDependenciesSchema>;

export function interactiveDependencyDeclarations(dependencies: InteractiveDependencies): Array<{ type: InteractiveDependencyType; id: string; name: string }> {
  return [
    ...dependencies.plugins.map(item => ({ ...item, type: "plugin" as const })),
    ...dependencies.skills.map(item => ({ ...item, type: "skill" as const })),
    ...dependencies.mcp_servers.map(item => ({ ...item, type: "mcp_server" as const })),
    ...dependencies.knowledge_bases.map(item => ({ ...item, type: "knowledge_base" as const })),
  ];
}

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
    icon_preset: applicationIconPresetSchema.optional(),
    entry: z.literal("index.html").default("index.html"),
    sdk_version: z.literal(1),
    dependencies: interactiveDependenciesSchema.prefault({}),
    permissions: z
      .array(interactiveApplicationPermissionSchema)
      .max(interactiveApplicationPermissionSchema.options.length)
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

export const interactiveApplicationImportPreviewSchema = interactiveDependencyStateSchema.extend({
  application: z.strictObject({
    name: interactiveApplicationManifestSchema.shape.name,
    description: interactiveApplicationManifestSchema.shape.description,
    version: interactiveApplicationManifestSchema.shape.version,
  }),
});
export type InteractiveApplicationImportPreview = z.infer<typeof interactiveApplicationImportPreviewSchema>;

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
