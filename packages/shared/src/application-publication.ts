import { z } from "zod";
import { uuidSchema } from "./common.js";

export const publishApplicationInputSchema = z.strictObject({
  usage_instructions: z.string().trim().min(1).max(20_000),
  allow_copy: z.boolean(),
});
export type PublishApplicationInput = z.infer<typeof publishApplicationInputSchema>;

export const applicationPublicationSchema = z.strictObject({
  version_id: uuidSchema.nullable(),
  version_number: z.number().int().positive().nullable(),
  allow_copy: z.boolean(),
  usage_instructions: z.string().max(20_000),
});
export type ApplicationPublication = z.infer<typeof applicationPublicationSchema>;

export const copyApplicationInputSchema = z.strictObject({
  name: z.string().trim().min(1).max(160),
});
export type CopyApplicationInput = z.infer<typeof copyApplicationInputSchema>;
