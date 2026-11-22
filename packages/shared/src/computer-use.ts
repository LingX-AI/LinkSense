import { z } from "zod";

export const computerStatusToolName = "computer_status";
export const computerObserveToolName = "computer_observe";
export const computerActToolName = "computer_act";
export const computerWaitToolName = "computer_wait";

const observationIdSchema = z.string().min(1).max(120);
const elementRefSchema = z.string().min(1).max(200);
const effectTimeoutMsSchema = z.number().int().min(100).max(20_000);
const utf8Bytes = (value: string) => new TextEncoder().encode(value).length;

/**
 * A qualified agent-desktop ref from the latest observation. The pinned CLI
 * requires `@<snapshot_id>:e<N>` with a 3-64 character snapshot id, so a bare
 * element ref or a caller-invented prefix is rejected before any transport.
 */
export const computerQualifiedRefSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^@[A-Za-z0-9_-]{3,64}:e[0-9]{1,10}$/u);

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

/**
 * Bounded transport metadata for a screenshot fallback on an observation whose
 * accessibility tree is not good. The native producer owns consent, Screen
 * Recording and the host-chosen exact window; this schema carries no permission
 * claim. The Runner verifies the bounded PNG/JPEG bytes with sharp before they
 * become MCP image content, so these caps keep the serialized result well below
 * the existing 1 MiB desktop frame.
 *
 * Upstream agent-desktop v1.3.1 captures an exact window as PNG only and
 * verifies the process/window before and after; it falls back to a full display
 * only when no target is supplied, and its MCP envelope also carries
 * structuredContent. LinkSense emits text plus image without structuredContent
 * and accepts a bounded JPEG as well. A native PNG can exceed these caps and
 * must be produced within them.
 */
export const computerScreenshotMaxBytes = 192 * 1024;
export const computerScreenshotMaxEncodedBytes =
  Math.ceil(computerScreenshotMaxBytes / 3) * 4;
export const computerScreenshotMaxResultBytes = 384 * 1024;
export const computerScreenshotMaxDimension = 8_192;
export const computerScreenshotMaxPixels = 16_000_000;

export const computerScreenshotMimeTypeSchema = z.enum([
  "image/png",
  "image/jpeg",
]);
export type ComputerScreenshotMimeType = z.infer<
  typeof computerScreenshotMimeTypeSchema
>;

export const computerScreenshotSchema = z.strictObject({
  mime_type: computerScreenshotMimeTypeSchema,
  data_base64: z
    .string()
    .min(4)
    // Reject oversize strings before allocating their decoded data.
    .max(computerScreenshotMaxEncodedBytes)
    .pipe(z.base64()),
  width: z.number().int().min(1).max(computerScreenshotMaxDimension),
  height: z.number().int().min(1).max(computerScreenshotMaxDimension),
});
export type ComputerScreenshot = z.infer<typeof computerScreenshotSchema>;

export const computerObservationSchema = z.strictObject({
  observation_id: observationIdSchema,
  tree_quality: z.enum(["good", "partial", "unusable"]),
  truncated: z.boolean(),
  nodes: z.array(computerObservationNodeSchema).max(400),
  screenshot: computerScreenshotSchema.optional(),
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

/**
 * The only read-only wait input. The predicate is fixed to `actionable` by the
 * device; the model can name only the exact observation/ref pair it already
 * read and a bounded timeout. No selector, text, window, process or path is
 * representable.
 */
export const computerWaitInputSchema = z.strictObject({
  observation_id: observationIdSchema,
  ref: computerQualifiedRefSchema,
  timeout_ms: effectTimeoutMsSchema.default(8_000),
});
export type ComputerWaitInput = z.infer<typeof computerWaitInputSchema>;

/** A native predicate expiry is a normal bounded observation, not an error. */
export const computerWaitResultSchema = z.strictObject({
  result: z.enum(["met", "timed_out"]),
  waited_ms: z.number().int().nonnegative().max(20_000),
});
export type ComputerWaitResult = z.infer<typeof computerWaitResultSchema>;

export function computerFailure(
  code: ComputerFailureCode,
): { code: ComputerFailureCode; retryable: false } {
  return { code, retryable: false };
}
