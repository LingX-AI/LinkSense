import { z } from "zod";
import { applicationIconInputSchema, applicationIconSchema } from "./application-icons.js";
import { applicationPublishedVersionInputSchema, applicationVersionInputSchema } from "./application-version.js";

import { capabilityTypeSchema } from "./capabilities.js";
import { timestampSchema, uniqueArraySchema, uuidSchema } from "./common.js";
import {
  modelIdentifierSchema,
  reasoningEffortSchema,
} from "./model-provider.js";
import { interactiveApplicationPackageSchema, interactiveDependencyTypeSchema } from "./interactive-applications.js";
import { applicationUsageModeSchema, applicationUsageModesSchema } from "./application-distribution.js";

export const applicationStatusSchema = z.enum(["active", "disabled"]);
export const applicationUnavailableReasonSchema = z.enum([
  "APPLICATION_NOT_FOUND",
  "APPLICATION_DELETED",
  "APPLICATION_DISABLED",
  "APPLICATION_CENTER_UNAVAILABLE",
  "APPLICATION_DEPENDENCY_UNAVAILABLE",
]);
export type ApplicationUnavailableReason = z.infer<
  typeof applicationUnavailableReasonSchema
>;
export const applicationKindSchema = z.enum(["standard", "interactive"]);
export const applicationListScopeSchema = z.enum(["all", "owned", "shared"]);
export const applicationAccessSourceSchema = z.enum([
  "owner",
  "direct",
  "user_group",
  "center",
]);
export const applicationGranteeTypeSchema = z.enum(["user", "user_group"]);

export const applicationShareTargetSummarySchema = z.strictObject({
  id: uuidSchema,
  type: applicationGranteeTypeSchema,
  name: z.string().min(1).max(120),
});

export const applicationCapabilitySchema = z.strictObject({
  id: uuidSchema,
  name: z.string().min(1).max(160),
  type: capabilityTypeSchema,
  description: z.string().max(4_000).nullable(),
  status: z.enum(["active", "disabled", "failed"]),
  available: z.boolean(),
  updated_at: timestampSchema,
});

export const applicationKnowledgeBaseSchema = z.strictObject({
  id: uuidSchema,
  name: z.string().min(1).max(160),
  lifecycle_status: z.string().min(1).max(32),
  availability_status: z.string().min(1).max(32),
  available: z.boolean(),
  updated_at: timestampSchema,
});

export const applicationMcpServerSchema = z.strictObject({
  id: uuidSchema,
  name: z.string().min(1).max(160),
  status: z.enum(["active", "disabled"]),
  available: z.boolean(),
  updated_at: timestampSchema,
});

export const applicationSchema = z.strictObject({
  id: uuidSchema,
  owner: z.strictObject({
    id: uuidSchema,
    name: z.string().min(1).max(120),
  }),
  name: z.string().min(1).max(160),
  icon: applicationIconSchema,
  description: z.string().max(4_000).nullable(),
  kind: applicationKindSchema.default("standard"),
  instructions: z.string().max(20_000).nullable(),
  model: modelIdentifierSchema.nullable(),
  reasoning_effort: reasoningEffortSchema.nullable(),
  status: applicationStatusSchema,
  is_owner: z.boolean(),
  can_manage: z.boolean(),
  access_source: applicationAccessSourceSchema,
  capability_count: z.number().int().min(0).max(50),
  knowledge_base_count: z.number().int().min(0).max(20),
  mcp_server_count: z.number().int().min(0).max(20),
  share_targets: z
    .array(applicationShareTargetSummarySchema)
    .max(200)
    .default([]),
  dependencies_available: z.boolean(),
  capabilities: z.array(applicationCapabilitySchema).max(50),
  knowledge_bases: z.array(applicationKnowledgeBaseSchema).max(20),
  mcp_servers: z.array(applicationMcpServerSchema).max(20),
  interactive_package: interactiveApplicationPackageSchema.nullable().default(null),
  created_at: timestampSchema,
  updated_at: timestampSchema,
});

// Read-only presentation data. Never include resource manifests, credentials,
// connection settings, or the application's private instructions here.
export const applicationResourceDetailsSchema = z.strictObject({
  id: uuidSchema,
  type: interactiveDependencyTypeSchema,
  name: z.string().min(1).max(160).nullable(),
  configured_name: z.string().min(1).max(160).nullable(),
  status: z.enum(["configured", "unconfigured", "unavailable"]),
});
export const applicationDetailsSchema = applicationSchema.pick({
  id: true, name: true, icon: true, description: true, kind: true,
  model: true, status: true, created_at: true, updated_at: true,
}).extend({
  creator_name: z.string().min(1).max(120),
  view: z.enum(["configuration", "published"]),
  version_number: z.string().min(1).max(80).nullable(),
  resources: z.array(applicationResourceDetailsSchema).max(90),
});
export type ApplicationResourceDetails = z.infer<typeof applicationResourceDetailsSchema>;
export type ApplicationDetails = z.infer<typeof applicationDetailsSchema>;

const applicationCapabilityIdsSchema = uniqueArraySchema(uuidSchema).max(50);
const applicationKnowledgeBaseIdsSchema = uniqueArraySchema(uuidSchema).max(20);
const applicationMcpServerIdsSchema = uniqueArraySchema(uuidSchema).max(20);

export const createApplicationInputSchema = z
  .strictObject({
    name: z.string().trim().min(1).max(160),
    description: z.string().trim().max(4_000).nullable().optional(),
    instructions: z.string().trim().min(1).max(20_000),
    model: modelIdentifierSchema.nullable().default(null),
    reasoning_effort: reasoningEffortSchema.nullable().default(null),
    capability_ids: applicationCapabilityIdsSchema.default([]),
    knowledge_base_ids: applicationKnowledgeBaseIdsSchema.default([]),
    mcp_server_ids: applicationMcpServerIdsSchema.default([]),
    icon: applicationIconInputSchema.optional(),
    status: applicationStatusSchema.optional(),
  })
  .refine(
    (value) => (value.model === null) === (value.reasoning_effort === null),
    { path: ["model"] },
  );

export const updateApplicationInputSchema = z
  .strictObject({
    name: z.string().trim().min(1).max(160).optional(),
    description: z.string().trim().max(4_000).nullable().optional(),
    instructions: z.string().trim().min(1).max(20_000).optional(),
    model: modelIdentifierSchema.nullable().optional(),
    reasoning_effort: reasoningEffortSchema.nullable().optional(),
    capability_ids: applicationCapabilityIdsSchema.optional(),
    knowledge_base_ids: applicationKnowledgeBaseIdsSchema.optional(),
    mcp_server_ids: applicationMcpServerIdsSchema.optional(),
    icon: applicationIconInputSchema.optional(),
    status: applicationStatusSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0)
  .refine(
    (value) =>
      (value.model === undefined && value.reasoning_effort === undefined) ||
      (value.model !== undefined &&
        value.reasoning_effort !== undefined &&
        (value.model === null) === (value.reasoning_effort === null)),
    { path: ["model"] },
  );

export const applicationListQuerySchema = z.strictObject({
  scope: applicationListScopeSchema.default("all"),
  search: z.string().trim().min(1).max(240).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

export const editAndPublishApplicationInputSchema = z.strictObject({
  changes: updateApplicationInputSchema,
  release: applicationVersionInputSchema,
});

export const applicationGrantSchema = z.strictObject({
  id: uuidSchema,
  application_id: uuidSchema,
  grantee_type: applicationGranteeTypeSchema,
  usage_modes: z.array(applicationUsageModeSchema).max(2),
  target: z.strictObject({
    id: uuidSchema,
    name: z.string().min(1).max(120),
  }),
  status: z.enum(["active", "revoked"]),
  created_at: timestampSchema,
  updated_at: timestampSchema,
});

export const createApplicationGrantInputSchema = z.discriminatedUnion(
  "grantee_type",
  [
    z.strictObject({
      grantee_type: z.literal("user"),
      user_id: uuidSchema,
      usage_modes: applicationUsageModesSchema,
    }),
    z.strictObject({
      grantee_type: z.literal("user_group"),
      user_group_id: uuidSchema,
      usage_modes: applicationUsageModesSchema,
    }),
  ],
);

export const applicationShareTargetSchema = z.strictObject({
  id: uuidSchema,
  type: applicationGranteeTypeSchema,
  name: z.string().min(1).max(120),
  secondary_text: z.string().max(320).nullable(),
});

export const applicationShareInputSchema = applicationPublishedVersionInputSchema.extend({
  target: createApplicationGrantInputSchema.nullable(),
});
export type ApplicationShareInput = z.infer<typeof applicationShareInputSchema>;

export const applicationConversationSchema = z.strictObject({
  conversation_id: uuidSchema,
});

export type Application = z.infer<typeof applicationSchema>;
export type ApplicationCapability = z.infer<typeof applicationCapabilitySchema>;
export type ApplicationKnowledgeBase = z.infer<
  typeof applicationKnowledgeBaseSchema
>;
export type ApplicationMcpServer = z.infer<
  typeof applicationMcpServerSchema
>;
export type ApplicationGrant = z.infer<typeof applicationGrantSchema>;
export type ApplicationShareTargetSummary = z.infer<
  typeof applicationShareTargetSummarySchema
>;
export type ApplicationShareTarget = z.infer<
  typeof applicationShareTargetSchema
>;
export type CreateApplicationInput = z.infer<
  typeof createApplicationInputSchema
>;
export type UpdateApplicationInput = z.infer<
  typeof updateApplicationInputSchema
>;
