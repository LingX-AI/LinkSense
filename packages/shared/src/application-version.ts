import semver from "semver";
import { z } from "zod";

export const applicationVersionNumberSchema = z.string().trim().min(1).max(80)
  .refine(value => semver.valid(value) !== null)
  .transform(value => value.replace(/^v/u, ""));

// Historical labels remain readable; new releases use a strict numeric triplet.
export const applicationReleaseVersionSchema = z.string().trim()
  .regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u)
  .pipe(applicationVersionNumberSchema);

export function nextApplicationVersion(highest: string | null): string {
  if (highest === null) return "0.0.1";
  const parsed = semver.parse(highest);
  if (!parsed) throw new Error("Invalid stored application version");
  return semver.inc(`${parsed.major}.${parsed.minor}.${parsed.patch}`, "patch")!;
}

export const applicationVersionInputSchema = z.strictObject({
  version_number: applicationReleaseVersionSchema,
  usage_instructions: z.string().trim().max(20_000).default(""),
});
// Distribution selects an existing immutable release, including historical labels.
export const applicationPublishedVersionInputSchema = applicationVersionInputSchema.extend({ version_number: applicationVersionNumberSchema });
export type ApplicationVersionInput = z.infer<typeof applicationVersionInputSchema>;

export const applicationDistributionSettingsSchema = z.strictObject({
  version_number: applicationVersionNumberSchema,
  highest_version_number: applicationVersionNumberSchema.nullable(),
  usage_instructions: z.string().max(20_000),
});
export type ApplicationDistributionSettings = z.infer<typeof applicationDistributionSettingsSchema>;

export const applicationPublicationReadinessSchema = z.strictObject({
  has_active_tasks: z.boolean(),
});
export type ApplicationPublicationReadiness = z.infer<typeof applicationPublicationReadinessSchema>;

export function applicationVersionStatus(value: string, highest: string | null): "invalid" | "lower" | "same" | "new" {
  const parsed = applicationVersionNumberSchema.safeParse(value);
  if (!parsed.success) return "invalid";
  if (highest === null) return "new";
  const compared = semver.compare(parsed.data, applicationVersionNumberSchema.parse(highest));
  return compared < 0 ? "lower" : compared === 0 ? "same" : "new";
}
