import { z } from "zod";

export const computerStatusToolName = "computer_status";
export const computerObserveToolName = "computer_observe";
export const computerActToolName = "computer_act";

const observationIdSchema = z.string().min(1).max(120);
const elementRefSchema = z.string().min(1).max(200);
const effectTimeoutMsSchema = z.number().int().min(100).max(20_000);
const utf8Bytes = (value: string) => new TextEncoder().encode(value).length;

/**
 * The host chooses the single target before the task starts. It is never a tool
 * argument, so the model cannot name an application, window, process or path.
 */
export const computerStatusInputSchema = z.strictObject({});
export const computerStatusResultSchema = z.strictObject({
  available: z.boolean(),
  permissions: z.strictObject({
    accessibility: z.enum(["granted", "missing", "unknown"]),
  }),
  active_grant: z.boolean(),
  agent_desktop_version: z.string().min(1).max(40).optional(),
});
export type ComputerStatusResult = z.infer<typeof computerStatusResultSchema>;

export const computerObserveInputSchema = z.strictObject({});
export const computerObservationNodeSchema = z.strictObject({
  ref: elementRefSchema,
  role: z.string().min(1).max(64),
  name: z.string().max(500).optional(),
});
export const computerObservationSchema = z.strictObject({
  observation_id: observationIdSchema,
  tree_quality: z.enum(["good", "partial", "unusable"]),
  truncated: z.boolean(),
  nodes: z.array(computerObservationNodeSchema).max(400),
});
export type ComputerObservation = z.infer<typeof computerObservationSchema>;

export const computerActInputSchema = z.discriminatedUnion("action", [
  z.strictObject({
    action: z.literal("click"),
    observation_id: observationIdSchema,
    ref: elementRefSchema,
    timeout_ms: effectTimeoutMsSchema.default(8_000),
  }),
  z.strictObject({
    action: z.literal("type"),
    observation_id: observationIdSchema,
    ref: elementRefSchema,
    text: z
      .string()
      .min(1)
      .max(8_000)
      .refine((value) => utf8Bytes(value) <= 8_192, "text exceeds 8192 UTF-8 bytes"),
    timeout_ms: effectTimeoutMsSchema.default(8_000),
  }),
]);
export type ComputerActInput = z.infer<typeof computerActInputSchema>;

export const computerEffectSchema = z.enum([
  "done",
  "small_change",
  "no_effect",
  "place_changed",
]);
export type ComputerEffect = z.infer<typeof computerEffectSchema>;

export const computerFailureCodes = [
  "COMPUTER_UNAVAILABLE",
  "COMPUTER_STALE_OBSERVATION",
  "COMPUTER_STALE_REF",
  "COMPUTER_ACCESS_DENIED",
  "COMPUTER_TIMEOUT",
  "COMPUTER_INVALID",
  "COMPUTER_ACTION_FAILED",
  "DEVICE_BUSY",
  "COMPUTER_TARGET_CHANGED",
  "RUNNER_OPERATION_UNCERTAIN",
] as const;
export const computerFailureCodeSchema = z.enum(computerFailureCodes);
export type ComputerFailureCode = z.infer<typeof computerFailureCodeSchema>;

export const computerActResultSchema = z
  .strictObject({
    ok: z.boolean(),
    effect: computerEffectSchema.optional(),
    waited_ms: z.number().int().nonnegative().max(20_000),
    error: computerFailureCodeSchema.optional(),
  })
  .refine(
    (result) =>
      result.ok
        ? result.effect !== undefined && result.error === undefined
        : result.error !== undefined,
    "a successful action requires an effect and a failed action requires an error",
  );
export type ComputerActResult = z.infer<typeof computerActResultSchema>;

export function computerFailure(
  code: ComputerFailureCode,
): { code: ComputerFailureCode; retryable: false } {
  return { code, retryable: false };
}
