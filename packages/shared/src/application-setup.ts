import { z } from "zod";
import { timestampSchema, uuidSchema } from "./common.js";
import { applicationVersionNumberSchema } from "./application-version.js";
import { interactiveDependencyTypeSchema } from "./interactive-applications.js";
import { modelIdentifierSchema, reasoningEffortSchema } from "./model-provider.js";

export const applicationSetupItemSchema = z.strictObject({
  id: uuidSchema,
  type: z.enum(["plugin", "skill", "knowledge_base", "mcp_server", "model"]),
  position: z.number().int().min(0).max(99),
  name: z.string().min(1).max(160).nullable(),
  description: z.string().max(4_000).nullable(),
  resource_id: uuidSchema.nullable(),
  resource_name: z.string().min(1).max(160).nullable(),
  status: z.enum(["configured", "unconfigured", "unavailable", "credentials_required"]),
});
export const applicationInstallationSetupSchema = z.strictObject({
  application_id: uuidSchema,
  installed_version_id: uuidSchema,
  installed_version_number: applicationVersionNumberSchema,
  updated_at: timestampSchema,
  usage_instructions: z.string().max(20_000),
  model: modelIdentifierSchema.nullable(),
  reasoning_effort: reasoningEffortSchema.nullable(),
  items: z.array(applicationSetupItemSchema).max(181),
  can_complete: z.boolean(),
  can_use: z.boolean(),
});
export const applicationSetupRevisionSchema = z.strictObject({
  installed_version_id: uuidSchema,
  updated_at: timestampSchema,
});
export const applicationSetupBindingInputSchema = applicationSetupRevisionSchema.extend({
  type: interactiveDependencyTypeSchema,
  position: z.number().int().min(0).max(99),
  resource_id: uuidSchema.nullable(),
});
export const applicationSetupModelInputSchema = applicationSetupRevisionSchema.extend({
  model: modelIdentifierSchema.nullable(),
  reasoning_effort: reasoningEffortSchema.nullable(),
}).refine(value => (value.model === null) === (value.reasoning_effort === null), { path: ["reasoning_effort"] });
export type ApplicationSetupItem = z.infer<typeof applicationSetupItemSchema>;
export type ApplicationInstallationSetup = z.infer<typeof applicationInstallationSetupSchema>;
export type ApplicationSetupRevision = z.infer<typeof applicationSetupRevisionSchema>;
export type ApplicationSetupBindingInput = z.infer<typeof applicationSetupBindingInputSchema>;
export type ApplicationSetupModelInput = z.infer<typeof applicationSetupModelInputSchema>;
