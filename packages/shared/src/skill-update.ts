import { z } from "zod";
import { capabilityPackageNameSchema } from "./capabilities.js";
import { skillDisplayNameSchema } from "./skill-display-name.js";

export const skillRevisionSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const packagePathSchema = z.string().min(1).max(4_096);

export const skillPackageFileSchema = z.strictObject({
  path: packagePathSchema,
  size_bytes: z.number().int().nonnegative(),
});

export const skillPackageChangesSchema = z.strictObject({
  added: z.array(packagePathSchema).max(1_000),
  modified: z.array(packagePathSchema).max(1_000),
  deleted: z.array(packagePathSchema).max(1_000),
  unchanged_count: z.number().int().nonnegative().max(1_000),
});

export const skillUpdatePreviewSchema = z.strictObject({
  mode: z.enum(["edit", "replace"]),
  base_revision: skillRevisionSchema,
  changes: skillPackageChangesSchema,
});

export const skillEditInputSchema = z.strictObject({
  base_revision: skillRevisionSchema,
  display_name: skillDisplayNameSchema,
  description: z.string().trim().max(4_000).nullable().transform((value) => value || null),
  content: z.string().min(1).max(1_000_000).refine((value) => value.trim().length > 0),
});

export const skillEditDetailSchema = z.strictObject({
  name: capabilityPackageNameSchema,
  display_name: skillDisplayNameSchema,
  description: z.string().max(4_000).nullable(),
  content: z.string().max(1_000_000).nullable(),
  revision: skillRevisionSchema,
  files: z.array(skillPackageFileSchema).max(1_000),
});

export type SkillEditInput = z.infer<typeof skillEditInputSchema>;
export type SkillEditDetail = z.infer<typeof skillEditDetailSchema>;
export type SkillPackageChanges = z.infer<typeof skillPackageChangesSchema>;
export type SkillUpdatePreview = z.infer<typeof skillUpdatePreviewSchema>;
