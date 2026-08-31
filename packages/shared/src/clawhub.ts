import { z } from "zod";

import { timestampSchema, uuidSchema } from "./common.js";

export const clawHubSecurityStatusSchema = z.enum([
  "clean",
  "suspicious",
  "malicious",
  "unverified",
]);

export const clawHubSkillCatalogSortSchema = z.enum(["downloads", "stars"]);

export const clawHubInstallBlockReasonSchema = z.enum([
  "files_unavailable",
  "manifest_too_large",
  "manifest_unsafe",
  "metadata_unavailable",
]);

export const clawHubInstallabilityReasonSchema = z.enum([
  "unavailable",
  "missing_version",
  "already_installed",
]);

export const clawHubSkillStatsSchema = z.strictObject({
  downloads: z.number().int().nonnegative(),
  installs: z.number().int().nonnegative(),
  stars: z.number().int().nonnegative(),
  comments: z.number().int().nonnegative(),
  versions: z.number().int().nonnegative(),
});

export const clawHubSkillPlatformMetadataSchema = z.strictObject({
  os: z.array(z.string().trim().min(1).max(120)).max(100).nullable(),
  systems: z.array(z.string().trim().min(1).max(120)).max(100).nullable(),
});

export const clawHubSkillCatalogItemSchema = z.strictObject({
  id: uuidSchema,
  slug: z.string().trim().min(1).max(240),
  display_name: z.string().trim().min(1).max(1_000),
  summary: z.string().trim().max(20_000).nullable(),
  topics: z.array(z.string().trim().min(1).max(240)).max(100),
  tags: z.record(
    z.string().trim().min(1).max(240),
    z.string().trim().min(1).max(240),
  ),
  latest_version: z.string().trim().min(1).max(240).nullable(),
  latest_version_created_at: timestampSchema.nullable(),
  latest_version_changelog: z.string().max(100_000).nullable(),
  latest_version_license: z.string().trim().max(240).nullable(),
  owner_handle: z.string().trim().min(1).max(240),
  owner_display_name: z.string().trim().min(1).max(500).nullable(),
  metadata: clawHubSkillPlatformMetadataSchema.nullable(),
  stats: clawHubSkillStatsSchema,
  security_status: clawHubSecurityStatusSchema,
  security_has_warnings: z.boolean(),
  is_suspicious: z.boolean(),
  is_malware_blocked: z.boolean(),
  source_created_at: timestampSchema,
  source_updated_at: timestampSchema,
  synced_at: timestampSchema,
  canonical_url: z.url().nullable(),
  available: z.boolean(),
  installable: z.boolean(),
  installability_reason: clawHubInstallabilityReasonSchema.nullable(),
  installed_capability_id: uuidSchema.nullable(),
  installed_version: z.string().trim().min(1).max(240).nullable(),
  update_available: z.boolean(),
});

export type ClawHubSecurityStatus = z.infer<
  typeof clawHubSecurityStatusSchema
>;
export type ClawHubSkillCatalogSort = z.infer<
  typeof clawHubSkillCatalogSortSchema
>;
export type ClawHubInstallBlockReason = z.infer<
  typeof clawHubInstallBlockReasonSchema
>;
export type ClawHubInstallabilityReason = z.infer<
  typeof clawHubInstallabilityReasonSchema
>;
export type ClawHubSkillCatalogItem = z.infer<
  typeof clawHubSkillCatalogItemSchema
>;
