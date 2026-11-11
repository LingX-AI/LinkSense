import { z } from "zod";
import { applicationExternalOriginSchema } from "./application-embed.js";
import {
  applicationIconInputSchema,
  applicationIconSchema,
} from "./application-icons.js";
import {
  modelIdentifierSchema,
  reasoningEffortSchema,
  modelProviderProtocolModeSchema,
} from "./model-provider.js";
import { modelTokenPricingSchema } from "./model-pricing.js";
import { conversationEventSchema } from "./events.js";
import { publicKnowledgeOutputLimit } from "./public-knowledge-output.js";

export const publicKnowledgeConcurrencyLimit = 20;
export const publicKnowledgeFrameSandbox =
  "allow-scripts allow-same-origin allow-forms";

const publicKnowledgeSettingsFieldsSchema = z
  .strictObject({
    name: z.string().trim().min(1).max(160),
    description: z.string().trim().max(4_000).nullable().default(null),
    instructions: z.string().trim().min(1).max(20_000),
    model: modelIdentifierSchema,
    reasoning_effort: reasoningEffortSchema,
    skill_ids: z
      .array(z.uuid())
      .max(20)
      .refine((ids) => new Set(ids).size === ids.length)
      .default([]),
    knowledge_base_ids: z
      .array(z.uuid())
      .min(1)
      .max(20)
      .refine((ids) => new Set(ids).size === ids.length),
    allowed_origins: z
      .array(applicationExternalOriginSchema)
      .min(1)
      .max(30)
      .refine((origins) => new Set(origins).size === origins.length),
    max_concurrent_turns: z
      .number()
      .int()
      .min(1)
      .max(publicKnowledgeConcurrencyLimit)
      .default(publicKnowledgeConcurrencyLimit),
    session_ttl_hours: z.number().int().min(1).max(168).default(24),
    retention_days: z.number().int().min(1).max(365).default(30),
    enabled: z.boolean().default(true),
    show_references: z.boolean().default(true),
  });
function settingsWithinSizeLimit(
  settings: z.infer<typeof publicKnowledgeSettingsFieldsSchema>,
): boolean {
  // Leave room for display preferences on existing settings near the old limit.
  return new TextEncoder().encode(JSON.stringify(settings)).byteLength <= 61_000;
}
export const publicKnowledgeSettingsSchema = publicKnowledgeSettingsFieldsSchema.refine(
  settingsWithinSizeLimit,
  "public_knowledge_settings_too_large",
);
export type PublicKnowledgeSettings = z.infer<
  typeof publicKnowledgeSettingsSchema
>;
export const publicKnowledgeSaveInputSchema = publicKnowledgeSettingsFieldsSchema
  .extend({ icon: applicationIconInputSchema.optional() })
  .refine(
    ({ icon: _icon, ...settings }) => settingsWithinSizeLimit(settings),
    "public_knowledge_settings_too_large",
  );
export type PublicKnowledgeSaveInput = z.infer<
  typeof publicKnowledgeSaveInputSchema
>;
export const publicKnowledgeStatusInputSchema = z.strictObject({
  enabled: z.boolean(),
});
export const publicKnowledgeManagementSchema = z.strictObject({
  application_id: z.uuid(),
  public_id: z.string().min(24).max(80),
  version_number: z.string(),
  icon: applicationIconSchema,
  settings: publicKnowledgeSettingsSchema,
});
export const publicKnowledgeSessionInputSchema = z.strictObject({
  origin: applicationExternalOriginSchema,
});
export const publicKnowledgeSessionSchema = z.strictObject({
  token: z.string().min(40).max(256),
  expires_at: z.iso.datetime(),
  visitor_id: z.uuid(),
});
export const publicKnowledgeQuestionSchema = z.strictObject({
  input_text: z.string().trim().min(1).max(4_000),
  request_id: z.uuid(),
});
export const publicQaCitationSchema = z.strictObject({
  number: z.number().int().positive(),
  knowledge_base_id: z.uuid(),
  document_id: z.uuid(),
  document_version_id: z.uuid(),
  title: z.string().max(500),
  page_numbers: z.array(z.number().int().nonnegative()).max(100),
  excerpt: z.string().max(8_000),
});
export const publicKnowledgeTurnStatusSchema = z.enum([
  "queued",
  "running",
  "completed",
  "failed",
  "interrupted",
]);
export const publicKnowledgeUsageQuerySchema = z
  .strictObject({
    from: z.iso.datetime().optional(),
    to: z.iso.datetime().optional(),
  })
  .refine(
    (query) =>
      !query.from ||
      !query.to ||
      Date.parse(query.from) <= Date.parse(query.to),
  );
export type PublicKnowledgeUsageQuery = z.infer<
  typeof publicKnowledgeUsageQuerySchema
>;
export const publicKnowledgeUsageSchema = z.strictObject({
  visitors: z.number().int().nonnegative(),
  conversations: z.number().int().nonnegative(),
  questions: z.number().int().nonnegative(),
  statuses: z.record(
    publicKnowledgeTurnStatusSchema,
    z.number().int().nonnegative(),
  ),
  average_duration_ms: z.number().nonnegative().nullable(),
});
export type PublicKnowledgeUsage = z.infer<typeof publicKnowledgeUsageSchema>;
export const publicKnowledgeTurnSchema = z.strictObject({
  id: z.uuid(),
  input_text: z.string(),
  output_text: z.string(),
  status: publicKnowledgeTurnStatusSchema,
  model: z.string(),
  application_version: z.string(),
  citations: z.array(publicQaCitationSchema).max(8),
  error_code: z.string().nullable(),
  duration_ms: z.number().int().nonnegative().nullable(),
  created_at: z.iso.datetime(),
});
export const publicKnowledgeConversationSchema = z.strictObject({
  id: z.uuid(),
  visitor_id: z.uuid(),
  title: z.string(),
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime(),
});
export const publicKnowledgeConversationPageSchema = z.strictObject({
  items: z.array(publicKnowledgeConversationSchema).max(100),
  next_cursor: z.uuid().nullable(),
});
export const publicKnowledgeConversationDetailSchema = z.strictObject({
  conversation: publicKnowledgeConversationSchema,
  turns: z.array(publicKnowledgeTurnSchema).max(100),
  queue_waiting_visitors: z.number().int().positive().optional(),
  events: z.array(conversationEventSchema).max(4096).default([]),
  event_cursor: z.string().max(160).optional(),
});
export const publicKnowledgeConversationQuerySchema = z.strictObject({
  cursor: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  search: z.string().trim().max(240).optional(),
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
  status: publicKnowledgeTurnStatusSchema.optional(),
});
export const publicKnowledgeSkillSchema = z.strictObject({
  id: z.uuid(),
  name: z.string().min(1).max(160),
  markdown: z.string().min(1).max(128_000),
});
export type PublicKnowledgeSkill = z.infer<typeof publicKnowledgeSkillSchema>;
export const publicKnowledgeSkillsSchema = z
  .array(publicKnowledgeSkillSchema)
  .max(20)
  .refine(
    (skills) => new Set(skills.map((skill) => skill.id)).size === skills.length,
  )
  .refine(
    (skills) =>
      new TextEncoder().encode(JSON.stringify(skills)).byteLength <= 512_000,
  );
export const publicKnowledgeRunnerInputSchema = z.strictObject({
  applicationId: z.uuid(),
  conversationId: z.uuid(),
  operationId: z.uuid(),
  threadId: z.string().min(1).max(200).nullable(),
  instructions: z.string().min(1).max(24_000),
  skills: publicKnowledgeSkillsSchema.default([]),
  inputText: z.string().min(1).max(80_000),
  model: modelIdentifierSchema,
  reasoningEffort: reasoningEffortSchema,
  provider: z.strictObject({
    revision: z.number().int().positive(),
    baseUrl: z.url(),
    apiKey: z.string().min(1).max(16_384),
    protocolMode: modelProviderProtocolModeSchema,
    pricing: modelTokenPricingSchema.optional(),
    modelContextWindow: z.number().int().positive().optional(),
    modelAutoCompactTokenLimit: z.number().int().positive().optional(),
  }),
});
export const publicKnowledgeRunnerResultSchema = z.strictObject({
  threadId: z.string().min(1).max(200).nullable(),
  turnId: z.string().min(1).max(200).nullable(),
  status: z.enum(["completed", "failed", "interrupted"]),
  outputText: z.string().max(publicKnowledgeOutputLimit),
});
export type PublicKnowledgeRunnerInput = z.input<
  typeof publicKnowledgeRunnerInputSchema
>;
export type PublicKnowledgeRunnerResult = z.infer<
  typeof publicKnowledgeRunnerResultSchema
>;
export type PublicQaCitation = z.infer<typeof publicQaCitationSchema>;
export type PublicKnowledgeConversationQuery = z.infer<
  typeof publicKnowledgeConversationQuerySchema
>;
