import { z } from "zod";
import { applicationIconSchema } from "./application-icons.js";
import { applicationSchema } from "./applications.js";

export const applicationCatalogFilterSchema = z.enum(["all", "developing", "standard", "interactive"]);
export const applicationCatalogQuerySchema = z.strictObject({
  search: z.string().trim().min(1).max(240).optional(),
  state: applicationCatalogFilterSchema.default("all"),
  cursor: z.string().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});
export const applicationDevelopmentSummarySchema = z.strictObject({
  id: z.uuid(),
  conversation_id: z.uuid().nullable(),
  name: z.string().min(1).max(160),
  icon: applicationIconSchema.optional(),
  description: z.string().max(4000).nullable().optional(),
  capability_count: z.number().int().min(0).max(50),
  knowledge_base_count: z.number().int().min(0).max(20),
  mcp_server_count: z.number().int().min(0).max(20),
  has_changes: z.boolean(),
  updated_at: z.iso.datetime(),
});
export const applicationCatalogItemSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("application"),
    application: applicationSchema,
    development: applicationDevelopmentSummarySchema.nullable(),
  }),
  z.strictObject({
    type: z.literal("development"),
    development: applicationDevelopmentSummarySchema,
  }),
]);
export const applicationCatalogPageSchema = z.strictObject({
  items: z.array(applicationCatalogItemSchema).max(200),
  next_cursor: z.string().max(512).nullable(),
});
export type ApplicationCatalogFilter = z.infer<typeof applicationCatalogFilterSchema>;
export type ApplicationCatalogQuery = z.infer<typeof applicationCatalogQuerySchema>;
export type ApplicationDevelopmentSummary = z.infer<typeof applicationDevelopmentSummarySchema>;
export type ApplicationCatalogItem = z.infer<typeof applicationCatalogItemSchema>;
export type ApplicationCatalogPage = z.infer<typeof applicationCatalogPageSchema>;
