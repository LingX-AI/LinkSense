import { z } from "zod";

export const runnerHeartbeatIntervalMs = 15_000;
export const runnerHeartbeatLeaseMs = 60_000;
export const runnerHeartbeatSchema = z.strictObject({
  bootId: z.uuid(),
  startup: z.boolean(),
});
export type RunnerHeartbeat = z.infer<typeof runnerHeartbeatSchema>;
