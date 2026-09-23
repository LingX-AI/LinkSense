import { z } from "zod";

import { timestampSchema, uniqueArraySchema, uuidSchema } from "./common.js";
import { projectColorSchema, projectIconSchema } from "./project-appearance.js";

// A fixed, user-requested project name; changing UI language must not create another project.
export const APPLICATION_DEVELOPMENT_PROJECT_NAME = "制作应用";

export const projectNameSchema = z.string().trim().min(1).max(80);
export const projectInputSchema = z.strictObject({
  name: projectNameSchema,
  icon: projectIconSchema.optional(),
  color: projectColorSchema.optional(),
});
export const projectSchema = z.strictObject({
  id: uuidSchema,
  name: projectNameSchema,
  icon: projectIconSchema,
  color: projectColorSchema,
  created_at: timestampSchema,
  updated_at: timestampSchema,
});
export const projectListSchema = z.array(projectSchema);
export const projectOrderSchema = z.strictObject({
  project_ids: uniqueArraySchema(uuidSchema).min(2).max(10_000),
});
export type ProjectOrder = z.infer<typeof projectOrderSchema>;
export type Project = z.infer<typeof projectSchema>;
export type ProjectInput = z.infer<typeof projectInputSchema>;
