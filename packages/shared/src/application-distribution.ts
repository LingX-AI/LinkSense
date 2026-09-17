import { z } from "zod";
import { timestampSchema, uniqueArraySchema, uuidSchema } from "./common.js";
import { applicationVersionInputSchema, applicationVersionNumberSchema } from "./application-version.js";

export const applicationUsageModeSchema = z.enum(["install", "service"]);
export const applicationUsageModesSchema = uniqueArraySchema(applicationUsageModeSchema).min(1).max(2);
export const applicationDistributionChannelSchema = z.enum(["direct", "center"]);
export type ApplicationUsageMode = z.infer<typeof applicationUsageModeSchema>;
export type ApplicationDistributionChannel = z.infer<typeof applicationDistributionChannelSchema>;

export const applicationInstallInputSchema = z.strictObject({
  name: z.string().trim().min(1).max(160),
  channel: applicationDistributionChannelSchema,
  version_id: uuidSchema,
});
export const applicationUpdateInstallationInputSchema = z.strictObject({
  version_id: uuidSchema,
});
export const applicationCenterSubmissionInputSchema = applicationVersionInputSchema.extend({
  usage_modes: applicationUsageModesSchema,
  release_notes: z.string().trim().max(8_000).default(""),
});
export const applicationCenterReviewInputSchema = z.strictObject({
  decision: z.enum(["approved", "rejected"]),
  comment: z.string().trim().max(4_000),
}).refine(value => value.decision !== "rejected" || value.comment.length > 0, { path: ["comment"] });
export const applicationCenterStatusInputSchema = z.strictObject({
  status: z.enum(["published", "unlisted", "suspended"]),
  reason: z.string().trim().max(4_000),
}).refine(value => value.status !== "suspended" || value.reason.length > 0, { path: ["reason"] });

export const applicationInstallationSchema = z.strictObject({
  source_application_id: uuidSchema,
  channel: applicationDistributionChannelSchema,
  installed_version_id: uuidSchema,
  installed_version_number: applicationVersionNumberSchema,
  latest_version_id: uuidSchema.nullable(),
  latest_version_number: applicationVersionNumberSchema.nullable(),
  update_available: z.boolean(),
  setup_required: z.boolean(),
});
export const applicationDistributionSummarySchema = z.strictObject({
  application_id: uuidSchema,
  published_version_id: uuidSchema.nullable(),
  published_version_number: applicationVersionNumberSchema.nullable(),
  usage_modes: z.array(applicationUsageModeSchema).max(2),
  installation: applicationInstallationSchema.nullable(),
  installed_application_id: uuidSchema.nullable(),
});
export const applicationCenterReleaseSchema = z.strictObject({
  id: uuidSchema,
  application_id: uuidSchema,
  version_id: uuidSchema,
  version_number: applicationVersionNumberSchema,
  name: z.string().min(1).max(160),
  kind: z.enum(["standard", "interactive"]),
  description: z.string().max(4_000).nullable(),
  usage_instructions: z.string().max(20_000),
  publisher_name: z.string().min(1).max(120),
  usage_modes: z.array(applicationUsageModeSchema).max(2),
  release_notes: z.string().max(8_000),
  status: z.enum(["pending", "approved", "rejected", "withdrawn"]),
  listing_status: z.enum(["draft", "published", "unlisted", "suspended"]),
  review_comment: z.string().max(4_000).nullable(),
  suspension_reason: z.string().max(4_000).nullable(),
  submitted_at: timestampSchema,
  reviewed_at: timestampSchema.nullable(),
  installed_application_id: uuidSchema.nullable(),
});
export const applicationInstallationUpdateSchema = z.strictObject({
  current_version_id: uuidSchema,
  latest_version_id: uuidSchema.nullable(),
  latest_version_number: applicationVersionNumberSchema.nullable(),
  update_available: z.boolean(),
  release_notes: z.string().max(8_000).nullable(),
  preserved_fields: z.array(z.enum(["name", "instructions", "model", "reasoning_effort", "capabilities", "resources"])),
  setup_required: z.boolean(),
});

export type ApplicationInstallInput = z.infer<typeof applicationInstallInputSchema>;
export type ApplicationCenterSubmissionInput = z.infer<typeof applicationCenterSubmissionInputSchema>;
export type ApplicationCenterRelease = z.infer<typeof applicationCenterReleaseSchema>;
export type ApplicationDistributionSummary = z.infer<typeof applicationDistributionSummarySchema>;
export type ApplicationInstallationUpdate = z.infer<typeof applicationInstallationUpdateSchema>;
