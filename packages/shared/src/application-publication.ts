import { z } from "zod";
import { uuidSchema } from "./common.js";
import { applicationVersionNumberSchema } from "./application-version.js";

export const applicationPublicationSchema = z.strictObject({
  version_id: uuidSchema.nullable(),
  version_number: applicationVersionNumberSchema.nullable(),
  usage_instructions: z.string().max(20_000),
});
export type ApplicationPublication = z.infer<typeof applicationPublicationSchema>;
