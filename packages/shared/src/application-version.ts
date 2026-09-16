import semver from "semver";
import { z } from "zod";

export const applicationVersionNumberSchema = z.string().trim().min(1).max(80)
  .refine(value => semver.valid(value) !== null)
  .transform(value => semver.valid(value)!);

export const applicationVersionInputSchema = z.strictObject({
  version_number: applicationVersionNumberSchema,
  usage_instructions: z.string().trim().max(20_000).default(""),
});
export type ApplicationVersionInput = z.infer<typeof applicationVersionInputSchema>;

export const applicationDistributionSettingsSchema = z.strictObject({
  version_number: applicationVersionNumberSchema,
  highest_version_number: applicationVersionNumberSchema.nullable(),
  usage_instructions: z.string().max(20_000),
});
export type ApplicationDistributionSettings = z.infer<typeof applicationDistributionSettingsSchema>;

export function applicationVersionStatus(value: string, highest: string | null): "invalid" | "lower" | "same" | "new" {
  const parsed = applicationVersionNumberSchema.safeParse(value);
  if (!parsed.success) return "invalid";
  if (highest === null) return "new";
  const compared = semver.compare(parsed.data, applicationVersionNumberSchema.parse(highest));
  return compared < 0 ? "lower" : compared === 0 ? "same" : "new";
}
