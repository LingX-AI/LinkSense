import { z } from "zod";

import {
  jsonObjectSchema,
  timestampSchema,
  uniqueArraySchema,
  uuidSchema,
} from "./common.js";

export const builtInSkillNames = [
  "linksense-browser",
  "linksense-document-reader",
  "linksense-docs",
  "linksense-file-service",
  "linksense-image-generation",
  "linksense-knowledge-base",
  "linksense-skill-creator",
] as const;
export const builtInSkillNameSchema = z.enum(builtInSkillNames);
export type BuiltInSkillName = z.infer<typeof builtInSkillNameSchema>;

export const builtInPluginDefinitions = [] as const;

export const builtInCapabilityDefinitions = [
  ...builtInSkillNames.map((key) => ({
    key,
    type: "skill" as const,
    slug: key,
  })),
  ...builtInPluginDefinitions,
] satisfies ReadonlyArray<{
  key: string;
  type: "plugin" | "skill";
  slug: string;
}>;

export type BuiltInCapabilityKey =
  (typeof builtInCapabilityDefinitions)[number]["key"];
export type BuiltInCapabilityId =
  `builtin:capability:${BuiltInCapabilityKey}`;

export function builtInCapabilityId(
  key: BuiltInCapabilityKey,
): BuiltInCapabilityId {
  return `builtin:capability:${key}`;
}

const builtInCapabilityIds = new Set<string>(
  builtInCapabilityDefinitions.map((definition) =>
    builtInCapabilityId(definition.key),
  ),
);

export function isBuiltInCapabilityId(
  value: string,
): value is BuiltInCapabilityId {
  return builtInCapabilityIds.has(value);
}

export function builtInCapabilityDefinitionForId(id: string) {
  if (!isBuiltInCapabilityId(id)) return undefined;
  return builtInCapabilityDefinitions.find(
    (definition) => builtInCapabilityId(definition.key) === id,
  );
}

export const builtInCapabilityIdSchema = z.custom<BuiltInCapabilityId>(
  (value) => typeof value === "string" && isBuiltInCapabilityId(value),
  { message: "invalid_builtin_capability_id" },
);

export const capabilitySelectionIdSchema = z.union([
  uuidSchema,
  builtInCapabilityIdSchema,
]);

export const capabilityTypeSchema = z.enum(["plugin", "skill"]);
export const capabilityStatusSchema = z.enum(["active", "disabled", "failed"]);
export const capabilitySourceTypeSchema = z.enum([
  "local",
  "url",
  "marketplace",
  "clawhub",
]);

export const capabilityMcpEnvironmentReferenceSchema = z.strictObject({
  mcp_server: z.string().trim().min(1).max(160),
  env_key: z.string().min(1).max(120),
  source: z.enum(["local", "remote"]),
  usage: z.enum(["stdio_env_var", "bearer_token", "http_header"]),
  http_header: z.string().trim().min(1).max(256).nullable(),
});

export const capabilityRiskSummarySchema = z.strictObject({
  contains_mcp_server: z.boolean().default(false),
  contains_scripts: z.boolean().default(false),
  contains_external_connections: z.boolean().default(false),
  requires_environment_variables: z.boolean().default(false),
  requires_credentials: z.boolean().default(false),
  contains_dependency_download_commands: z.boolean().default(false),
  declared_environment_keys: uniqueArraySchema(
    z.string().min(1).max(120),
  ).default([]),
  mcp_environment_references: z
    .array(capabilityMcpEnvironmentReferenceSchema)
    .max(1_000)
    .default([]),
  dependency_commands: z.array(z.string().min(1).max(500)).default([]),
});

export const capabilitySchema = z
  .strictObject({
    id: uuidSchema,
    type: capabilityTypeSchema,
    owner_id: uuidSchema,
    name: z.string().trim().min(1).max(160),
    slug: z
      .string()
      .min(1)
      .max(180)
      .regex(/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/u),
    description: z.string().trim().max(4_000).nullable(),
    source_type: capabilitySourceTypeSchema,
    marketplace_listing_id: uuidSchema.nullable(),
    marketplace_release_id: uuidSchema.nullable(),
    logo_object_key: z.string().min(1).nullable(),
    manifest: jsonObjectSchema.nullable(),
    risk_summary: capabilityRiskSummarySchema.nullable(),
    status: capabilityStatusSchema,
    installed_by: uuidSchema,
    created_at: timestampSchema,
    updated_at: timestampSchema,
  })
  .superRefine((capability, context) => {
    const marketplaceOrigin = capability.source_type === "marketplace";
    if (
      marketplaceOrigin !==
      (capability.marketplace_listing_id !== null &&
        capability.marketplace_release_id !== null)
    ) {
      context.addIssue({
        code: "custom",
        path: ["marketplace_listing_id"],
        message: "capability_marketplace_origin_is_invalid",
      });
    }
  });

export const localCapabilityImportSchema = z.strictObject({
  source_type: z.literal("local"),
  upload_id: uuidSchema,
});

export const manualSkillInputSchema = z.strictObject({
  source_type: z.literal("local"),
  type: z.literal("skill"),
  name: z.string().trim().min(1).max(160),
  skill_markdown: z.string().min(1).max(1_000_000),
});

export const capabilityImportSchema = z.union([
  localCapabilityImportSchema,
  manualSkillInputSchema,
]);

export const capabilityUserPreferenceStatusSchema = z.enum([
  "enabled",
  "disabled",
]);

export const capabilityUserPreferenceSchema = z.strictObject({
  id: uuidSchema,
  user_id: uuidSchema,
  capability_id: uuidSchema,
  status: capabilityUserPreferenceStatusSchema,
  disabled_at: timestampSchema.nullable(),
  created_at: timestampSchema,
  updated_at: timestampSchema,
});

export const priorityCapabilityIdsSchema = uniqueArraySchema(
  capabilitySelectionIdSchema,
).max(100);

export const marketplaceListingStatusSchema = z.enum([
  "draft",
  "published",
  "unlisted",
  "suspended",
]);

export const marketplaceReleaseStatusSchema = z.enum([
  "pending",
  "approved",
  "rejected",
  "withdrawn",
]);

export const marketplaceListingSchema = z.strictObject({
  id: uuidSchema,
  publisher_id: uuidSchema,
  publisher_name: z.string().trim().min(1).max(120),
  type: capabilityTypeSchema,
  slug: z.string().min(1).max(180),
  status: marketplaceListingStatusSchema,
  current_release_id: uuidSchema.nullable(),
  suspended_by: uuidSchema.nullable(),
  suspended_at: timestampSchema.nullable(),
  suspension_reason: z.string().trim().max(4_000).nullable(),
  created_at: timestampSchema,
  updated_at: timestampSchema,
});

export const marketplaceReleaseSchema = z.strictObject({
  id: uuidSchema,
  listing_id: uuidSchema,
  source_capability_id: uuidSchema,
  release_number: z.number().int().positive(),
  status: marketplaceReleaseStatusSchema,
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(4_000).nullable(),
  release_notes: z.string().trim().max(8_000).nullable(),
  logo_url: z.string().url().nullable(),
  content_sha256: z.string().regex(/^[0-9a-f]{64}$/u),
  manifest: jsonObjectSchema,
  risk_summary: capabilityRiskSummarySchema,
  submitted_by: uuidSchema,
  reviewer_id: uuidSchema.nullable(),
  review_comment: z.string().trim().max(4_000).nullable(),
  submitted_at: timestampSchema,
  reviewed_at: timestampSchema.nullable(),
  published_at: timestampSchema.nullable(),
  created_at: timestampSchema,
  updated_at: timestampSchema,
});

export const marketplaceCatalogItemSchema = z.strictObject({
  listing: marketplaceListingSchema,
  release: marketplaceReleaseSchema,
  installed_capability_id: uuidSchema.nullable(),
  installed_release_id: uuidSchema.nullable(),
  update_available: z.boolean(),
  install_count: z.number().int().nonnegative(),
});

export type Capability = z.infer<typeof capabilitySchema>;
export type CapabilityMcpEnvironmentReference = z.infer<
  typeof capabilityMcpEnvironmentReferenceSchema
>;
export type CapabilityRiskSummary = z.infer<
  typeof capabilityRiskSummarySchema
>;
export type MarketplaceListing = z.infer<typeof marketplaceListingSchema>;
export type MarketplaceRelease = z.infer<typeof marketplaceReleaseSchema>;
export type MarketplaceCatalogItem = z.infer<
  typeof marketplaceCatalogItemSchema
>;
