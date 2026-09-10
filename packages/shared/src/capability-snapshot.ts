import { z } from "zod";

export const capabilitySnapshotDirectory = "snapshots";
export const capabilitySnapshotManifest = "capability-snapshot.json";
export const capabilitySnapshotIdSchema = z.string().regex(
  /^[a-f0-9]{64}-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u,
);
export const capabilitySnapshotSchema = z.strictObject({
  version: z.literal(1),
  id: capabilitySnapshotIdSchema,
  generation: z.string().regex(/^[a-f0-9]{64}$/u),
  contentDigest: z.string().regex(/^[a-f0-9]{64}$/u),
  sourceDigest: z.string().regex(/^[a-f0-9]{64}$/u),
  pluginNames: z.array(z.string().min(1).max(64).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u)).max(512)
    .refine((names) => names.every((name, index) => index === 0 || name > (names[index - 1] ?? ""))),
}).refine((value) => value.id.startsWith(`${value.generation}-`));
export type CapabilitySnapshot = z.infer<typeof capabilitySnapshotSchema>;
