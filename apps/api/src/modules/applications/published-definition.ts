import { z } from "zod";
import { applicationKindSchema, capabilitySourceTypeSchema, modelIdentifierSchema, reasoningEffortSchema } from "@linksense/shared";

// Stored definitions contain package metadata and resource references. Secret
// values are resolved from the encrypted credential stores at execution time.
export const publishedCapabilitySchema = z.strictObject({
  id: z.uuid(),
  type: z.enum(["plugin", "skill"]),
  name: z.string().min(1).max(160),
  description: z.string().nullable(),
  sourceType: capabilitySourceTypeSchema,
  marketplaceListingId: z.uuid().nullable().optional(),
  marketplaceReleaseId: z.uuid().nullable().optional(),
  storagePath: z.string().min(1).max(4_096),
  revision: z.iso.datetime(),
  contentSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  manifestJson: z.json().nullable(),
  riskSummaryJson: z.json().nullable(),
});
export type PublishedCapability = z.infer<typeof publishedCapabilitySchema>;

export const publishedApplicationDefinitionSchema = z.strictObject({
  schemaVersion: z.literal(1),
  description: z.string().nullable(),
  iconPreset: z.string(),
  iconObjectKey: z.string().nullable(),
  name: z.string().min(1).max(160),
  kind: applicationKindSchema,
  instructions: z.string().max(20_000),
  usageInstructions: z.string().max(20_000),
  model: modelIdentifierSchema.nullable(),
  reasoningEffort: reasoningEffortSchema.nullable(),
  interactivePackageId: z.uuid().nullable(),
  capabilities: z.array(publishedCapabilitySchema).max(50),
  knowledgeBaseIds: z.array(z.uuid()).max(20),
  mcpServerIds: z.array(z.uuid()).max(20),
});
export type PublishedApplicationDefinition = z.infer<typeof publishedApplicationDefinitionSchema>;
