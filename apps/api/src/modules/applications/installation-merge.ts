import { z } from "zod";
import { modelIdentifierSchema, reasoningEffortSchema } from "@linksense/shared";

export const installedApplicationBaselineSchema = z.strictObject({
  name: z.string().min(1).max(160),
  instructions: z.string().max(20_000),
  model: modelIdentifierSchema.nullable(),
  reasoningEffort: reasoningEffortSchema.nullable(),
  interactivePackageId: z.uuid().nullable(),
  capabilities: z.array(z.strictObject({
    sourceId: z.uuid(),
    installedId: z.uuid(),
    contentSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  })).max(50),
  requiredKnowledgeBases: z.number().int().min(0).max(20),
  requiredMcpServers: z.number().int().min(0).max(20),
});
export type InstalledApplicationBaseline = z.infer<typeof installedApplicationBaselineSchema>;
