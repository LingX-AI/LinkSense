import { z } from "zod";

import { errorCodeSchema } from "./errors.js";
import {
  webSiteCreateSchema,
  webSiteMetadataFields,
  webSitePageSchema,
  webSitePublishSchema,
  webSiteSchema,
  webSiteSlugSchema,
  webSiteSourcesSchema,
  webSiteStatusSchema,
} from "./web-sites.js";

export const WEB_SITE_TOOL_BODY_LIMIT = 8_192;
const siteIdFields = { site_id: z.uuid() };

export const webSiteToolInputs = {
  list_sites: z.strictObject({
    search: z.string().trim().max(240).optional(),
    status: webSiteStatusSchema.optional(),
    cursor: z.string().max(100).optional(),
    limit: z.number().int().min(1).max(100).default(30),
  }),
  publish_site: z.strictObject({
    site: webSiteCreateSchema.omit({ conversation_id: true }).optional(),
  }),
  update_site: z.strictObject({
    ...siteIdFields,
    changes: z.union([
      webSitePublishSchema,
      z.strictObject(webSiteMetadataFields).refine(value => Object.keys(value).length > 0),
    ]),
  }),
  unpublish_site: z.strictObject(siteIdFields),
  delete_site: z.strictObject(siteIdFields),
};

export const webSiteToolRequestSchema = z.discriminatedUnion("tool", [
  webSiteToolInputs.list_sites.extend({ tool: z.literal("list_sites") }),
  webSiteToolInputs.publish_site.extend({ tool: z.literal("publish_site") }),
  webSiteToolInputs.update_site.extend({ tool: z.literal("update_site") }),
  webSiteToolInputs.unpublish_site.extend({ tool: z.literal("unpublish_site") }),
  webSiteToolInputs.delete_site.extend({ tool: z.literal("delete_site") }),
]);
export type WebSiteToolRequest = z.infer<typeof webSiteToolRequestSchema>;

const linkedSiteSchema = webSiteSchema.omit({ url_path: true }).extend({
  url: z.url({ protocol: /^https?$/u }),
});
export type LinkedWebSite = z.infer<typeof linkedSiteSchema>;
const siteChangeResultSchema = z.strictObject({
  tool: z.enum(["update_site", "unpublish_site"]),
  site: linkedSiteSchema,
});
export const webSiteToolResultSchema = z.union([
  webSitePageSchema.extend({
    tool: z.literal("list_sites"),
    items: z.array(linkedSiteSchema),
  }),
  z.strictObject({
    tool: z.literal("publish_site"),
    outcome: z.enum(["published", "existing"]),
    site: linkedSiteSchema,
  }),
  z.strictObject({
    tool: z.literal("publish_site"),
    outcome: z.literal("sources"),
    sources: webSiteSourcesSchema,
  }),
  siteChangeResultSchema,
  z.strictObject({ tool: z.literal("delete_site"), ...siteIdFields }),
  z.strictObject({
    tool: z.enum(["publish_site", "update_site", "delete_site"]),
    outcome: z.literal("cancelled"),
  }),
]);
export type WebSiteToolResult = z.infer<typeof webSiteToolResultSchema>;

export const webSiteToolFailureSchema = z.strictObject({
  code: errorCodeSchema,
  retryable: z.boolean(),
});
export type WebSiteToolFailure = z.infer<typeof webSiteToolFailureSchema>;

export const webSiteTargetSchema = webSiteSchema.pick({
  name: true,
  slug: true,
  status: true,
  release_id: true,
});
export type WebSiteTarget = z.infer<typeof webSiteTargetSchema>;

// These payloads stay between the API and the authenticated Runner.
const siteConfirmationSchema = z.discriminatedUnion("tool", [
  z.strictObject({
    tool: z.literal("publish_site"),
    site: webSiteCreateSchema.extend({ slug: webSiteSlugSchema }),
  }),
  z.strictObject({
    tool: z.literal("update_site"),
    ...siteIdFields,
    file_id: z.uuid(),
    expected: webSiteTargetSchema.extend({ status: z.literal("published") }),
  }),
  z.strictObject({
    tool: z.literal("delete_site"),
    ...siteIdFields,
    expected: webSiteTargetSchema,
  }),
]);
export type WebSiteToolConfirmation = z.infer<typeof siteConfirmationSchema>;

const toolTurnFields = { conversationId: z.uuid(), turnId: z.uuid() };
export const internalWebSiteToolRequestSchema = z.strictObject({
  ...toolTurnFields,
  request: webSiteToolRequestSchema,
  // Older APIs reject this field before they can execute an unconfirmed deletion.
  requiresDeleteApproval: z.literal(true).optional(),
}).refine(input => input.request.tool !== "delete_site" || input.requiresDeleteApproval === true);
export type InternalWebSiteToolRequest = z.infer<typeof internalWebSiteToolRequestSchema>;
export const internalWebSiteToolConfirmSchema = z.strictObject({
  ...toolTurnFields,
  confirmation: siteConfirmationSchema,
});
export type InternalWebSiteToolConfirm = z.infer<typeof internalWebSiteToolConfirmSchema>;

export const webSiteToolApprovalSchema = z.strictObject({
  confirmation: siteConfirmationSchema,
  message: z.string().min(1).max(4_000),
  decisionLabel: z.string().min(1).max(160),
  approveLabel: z.string().min(1).max(500),
  rejectLabel: z.string().min(1).max(500),
});
export type WebSiteToolApproval = z.infer<typeof webSiteToolApprovalSchema>;
export const internalWebSiteToolResultSchema = z.union([webSiteToolApprovalSchema, webSiteToolResultSchema]);
