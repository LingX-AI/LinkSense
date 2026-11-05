import { z } from "zod";

export const applicationKindSchema = z.enum([
  "standard",
  "interactive",
  "public_knowledge",
]);
export type ApplicationKind = z.infer<typeof applicationKindSchema>;
