import { z } from "zod";
import { applicationVersionInputSchema } from "./application-version.js";
import { DEFAULT_APPLICATION_ICON_PRESET, applicationIconInputSchema, applicationIconPresetSchema, applicationIconSchema } from "./application-icons.js";
import { interactiveApplicationManifestSchema, interactiveDependenciesSchema, interactiveDependencyStateSchema } from "./interactive-applications.js";

export const APPLICATION_BUILDER_SKILL_NAME = "linksense-interactive-app-builder";
export const APPLICATION_DEVELOPMENT_POLL_MS = 1500;

export const applicationSourceDirectorySchema = z.string().min(1).max(500)
  .refine(value => value.split("/").every(part => /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/u.test(part)) && !value.includes("\\"), "invalid_source_directory");
export const applicationDevelopmentOpenSchema = z.strictObject({
  name: z.string().trim().min(1).max(160),
  directory: applicationSourceDirectorySchema.optional(),
});
export const applicationDevelopmentDiagnosticSchema = z.strictObject({
  message: z.string().max(2000),
  file: z.string().max(300).default(""),
  line: z.number().int().min(0).max(10_000_000).default(0),
});
export const applicationDevelopmentSchema = z.strictObject({
  id: z.uuid(),
  conversation_id: z.uuid().nullable(),
  name: z.string(),
  icon: applicationIconSchema.default({ type: "preset", preset: DEFAULT_APPLICATION_ICON_PRESET }),
  directory: applicationSourceDirectorySchema,
  application_id: z.uuid().nullable(),
  preview_application_id: z.uuid().nullable(),
  preview_conversation_id: z.uuid().nullable(),
  preview_current: z.boolean(),
  revision: z.number().int().nonnegative(),
  source_hash: z.string().regex(/^[a-f0-9]{64}$/u).nullable(),
  installed_source_hash: z.string().regex(/^[a-f0-9]{64}$/u).nullable(),
  source_error: z.enum(["APPLICATION_PACKAGE_INVALID", "APPLICATION_DEVELOPMENT_SOURCE_CHANGED"]).nullable(),
  manifest: interactiveApplicationManifestSchema.nullable(),
  diagnostics: z.array(applicationDevelopmentDiagnosticSchema).max(20),
  updated_at: z.iso.datetime(),
});
export const applicationDevelopmentInstallSchema = applicationVersionInputSchema.extend({
  source_hash: z.string().regex(/^[a-f0-9]{64}$/u),
});
export const applicationDevelopmentMetadataSchema = z.strictObject({
  name: interactiveApplicationManifestSchema.shape.name.optional(),
  description: interactiveApplicationManifestSchema.shape.description.unwrap().optional(),
  icon: applicationIconInputSchema.optional(),
});
export const applicationDevelopmentMetadataUpdateSchema = applicationDevelopmentMetadataSchema.extend({
  source_hash: applicationDevelopmentInstallSchema.shape.source_hash,
}).refine(value => value.name !== undefined || value.description !== undefined || value.icon !== undefined, "empty_metadata");
export type ApplicationDevelopmentMetadata = z.infer<typeof applicationDevelopmentMetadataSchema>;
export type ApplicationDevelopmentMetadataUpdate = z.infer<typeof applicationDevelopmentMetadataUpdateSchema>;
export const applicationDevelopmentCapabilitiesSchema = z.strictObject({
  source_hash: applicationDevelopmentInstallSchema.shape.source_hash,
  dependencies: interactiveDependencyStateSchema,
});
export const applicationDevelopmentCapabilitiesUpdateSchema = z.strictObject({
  source_hash: applicationDevelopmentInstallSchema.shape.source_hash,
  dependencies: interactiveDependenciesSchema,
});
export type ApplicationDevelopmentCapabilities = z.infer<typeof applicationDevelopmentCapabilitiesSchema>;
export type ApplicationDevelopmentCapabilitiesUpdate = z.infer<typeof applicationDevelopmentCapabilitiesUpdateSchema>;
export const applicationTestSessionsQuerySchema = z.strictObject({
  cursor: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export const applicationTestRestartSchema = z.strictObject({
  preview_conversation_id: z.uuid().nullable(),
  revision: z.number().int().nonnegative(),
});
export const applicationTestSessionSchema = z.strictObject({
  id: z.uuid(),
  current: z.boolean(),
  version: z.string().nullable(),
  status: z.enum(["idle", "running", "completed", "failed", "interrupted"]),
  busy: z.boolean(),
  turn_count: z.number().int().nonnegative(),
  created_at: z.iso.datetime(),
  last_run_at: z.iso.datetime().nullable(),
});
export const applicationTestSessionsSchema = z.strictObject({
  items: z.array(applicationTestSessionSchema).max(100),
  next_cursor: z.uuid().nullable(),
});
export type ApplicationTestSessionsQuery = z.infer<typeof applicationTestSessionsQuerySchema>;
export type ApplicationTestSessions = z.infer<typeof applicationTestSessionsSchema>;
export type ApplicationTestRestart = z.infer<typeof applicationTestRestartSchema>;
export const applicationTestInspectionInputSchema = z.strictObject({
  conversation_id: z.uuid().optional(),
  cursor: z.uuid().optional(),
});
export const applicationTestInspectionSchema = z.strictObject({
  sessions: applicationTestSessionsSchema,
  detail: z.strictObject({
    conversation_id: z.uuid(),
    messages: z.array(z.strictObject({ role: z.enum(["user", "assistant"]), content: z.string().max(8000) })).max(40),
    truncated: z.boolean(),
  }).nullable(),
});
export type ApplicationTestInspection = z.infer<typeof applicationTestInspectionSchema>;
export const applicationBuilderMetadataSchema = z.strictObject({
  source_hash: applicationDevelopmentInstallSchema.shape.source_hash,
  name: interactiveApplicationManifestSchema.shape.name.optional(),
  description: interactiveApplicationManifestSchema.shape.description.unwrap().optional(),
  icon: z.discriminatedUnion("type", [
    z.strictObject({ type: z.literal("preset"), preset: applicationIconPresetSchema }),
    z.strictObject({ type: z.literal("file"), path: z.string().min(1).max(500) }),
  ]).optional(),
});
export const applicationBuilderRequestSchema = z.discriminatedUnion("operation", [
  applicationDevelopmentOpenSchema.extend({ operation: z.literal("open") }),
  z.strictObject({ operation: z.literal("inspect") }),
  applicationTestInspectionInputSchema.extend({ operation: z.literal("tests") }),
  applicationBuilderMetadataSchema.extend({ operation: z.literal("metadata") }),
]);
export type ApplicationDevelopment = z.infer<typeof applicationDevelopmentSchema>;
export type ApplicationDevelopmentDiagnostic = z.infer<typeof applicationDevelopmentDiagnosticSchema>;
export type ApplicationDevelopmentOpen = z.infer<typeof applicationDevelopmentOpenSchema>;
export type ApplicationBuilderRequest = z.infer<typeof applicationBuilderRequestSchema>;

export function sanitizeApplicationDevelopmentDiagnostic(value: ApplicationDevelopmentDiagnostic): ApplicationDevelopmentDiagnostic {
  return {
    ...value,
    message: value.message.replace(/https?:\/\/[^\s)]+/giu, "[resource]")
      .replace(/\b(Bearer\s+|(?:token|password|secret|api[_-]?key)\s*[:=]\s*)[^\s,;]+/giu, "$1[redacted]")
      .replace(/\/(?:Users|home|workspace|var|tmp)\/[^\s:]+/gu, "[path]").slice(0, 2000),
    file: value.file.replace(/^.*\//u, "").replace(/[?#].*$/u, "").slice(0, 300),
  };
}
