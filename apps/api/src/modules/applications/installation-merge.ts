import { isDeepStrictEqual } from "node:util";
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
type EditableApplication = Pick<InstalledApplicationBaseline, "name" | "instructions" | "model" | "reasoningEffort">;

/** Adopt upstream changes only where the installer has not changed the value. */
export function mergeInstalledApplication(
  current: EditableApplication,
  baseline: EditableApplication,
  incoming: EditableApplication,
): { values: EditableApplication; preserved: Array<"name" | "instructions" | "model" | "reasoning_effort"> } {
  const values = { ...current };
  const preserved: Array<"name" | "instructions" | "model" | "reasoning_effort"> = [];
  for (const key of ["name", "instructions"] as const) {
    if (current[key] === baseline[key]) values[key] = incoming[key];
    else if (current[key] !== incoming[key]) preserved.push(key);
  }
  // Model and reasoning effort are one validated selection, never merge halves.
  if (isDeepStrictEqual([current.model, current.reasoningEffort], [baseline.model, baseline.reasoningEffort])) {
    values.model = incoming.model;
    values.reasoningEffort = incoming.reasoningEffort;
  } else if (!isDeepStrictEqual([current.model, current.reasoningEffort], [incoming.model, incoming.reasoningEffort])) {
    preserved.push("model", "reasoning_effort");
  }
  return { values, preserved };
}
