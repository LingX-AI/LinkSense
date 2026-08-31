import { z } from "zod";

import { capabilityRiskSummarySchema } from "./capabilities.js";
import {
  jsonObjectSchema,
  timestampSchema,
  uuidSchema,
} from "./common.js";

export const skillCreatorArchivePathSchema = z
  .string()
  .min(1)
  .max(2_000)
  .refine(
    (value) => {
      if (
        value.includes("\\") ||
        !value.startsWith("artifacts/") ||
        !value.toLocaleLowerCase("en-US").endsWith(".zip")
      ) {
        return false;
      }
      const segments = value.split("/");
      return segments.every(
        (segment) => segment.length > 0 && segment !== "." && segment !== "..",
      );
    },
    { message: "skill_archive_must_be_an_artifacts_zip" },
  );

export const skillCreatorPreviewRequestSchema = z.strictObject({
  conversationId: uuidSchema,
  turnId: z.string().min(1).max(256),
  workspaceRelativePath: skillCreatorArchivePathSchema,
});

export const skillCreatorConfirmRequestSchema = z.strictObject({
  conversationId: uuidSchema,
  turnId: z.string().min(1).max(256),
  installToken: z.string().min(64).max(2_048),
});

export const skillCreatorPreviewResultSchema = z.strictObject({
  success: z.literal(true),
  install_token: z.string().min(64).max(2_048),
  expires_at: timestampSchema,
  name: z.string().min(1).max(160),
  description: z.string().max(4_000).nullable(),
  manifest: jsonObjectSchema,
  declared_capabilities: z.array(z.string().min(1).max(120)).max(32),
  risk_summary: capabilityRiskSummarySchema,
  skill_content_preview: z.string().max(200_000).nullable(),
  skill_content_truncated: z.boolean(),
});

export const skillCreatorInstallResultSchema = z.strictObject({
  success: z.literal(true),
  capability_id: uuidSchema,
  name: z.string().min(1).max(160),
  source_type: z.literal("local"),
  status: z.enum(["active", "disabled", "failed"]),
  preference_status: z.enum(["enabled", "disabled"]),
});

export type SkillCreatorPreviewRequest = z.infer<
  typeof skillCreatorPreviewRequestSchema
>;
export type SkillCreatorConfirmRequest = z.infer<
  typeof skillCreatorConfirmRequestSchema
>;
export type SkillCreatorPreviewResult = z.infer<
  typeof skillCreatorPreviewResultSchema
>;
export type SkillCreatorInstallResult = z.infer<
  typeof skillCreatorInstallResultSchema
>;
