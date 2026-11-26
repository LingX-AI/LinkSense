import { z } from "zod";

import { timestampSchema, uuidSchema } from "./common.js";
import {
  computerActResultSchema,
  computerObservationSchema,
  computerQualifiedRefSchema,
  computerWaitResultSchema,
} from "./computer-use.js";

/**
 * Cloud task -> Mac desktop lane. The Mac chooses the window with its native
 * picker; the model sees only a virtual selection id and bounded accessibility
 * observations. A selection lives for five minutes and can be paused, resumed
 * or stopped from the native app or the model.
 */
export const localComputerStatusOperation = "local_computer.status" as const;
export const localComputerSelectOperation = "local_computer.select" as const;
export const localComputerObserveOperation = "local_computer.observe" as const;
export const localComputerActOperation = "local_computer.act" as const;
export const localComputerWaitOperation = "local_computer.wait" as const;
export const localComputerPauseOperation = "local_computer.pause" as const;
export const localComputerResumeOperation = "local_computer.resume" as const;
export const localComputerStopOperation = "local_computer.stop" as const;
export const localComputerExtendedOperation = "local_computer.extended" as const;

export const localComputerOperationSchema = z.enum([
  localComputerExtendedOperation,
  localComputerStatusOperation,
  localComputerSelectOperation,
  localComputerObserveOperation,
  localComputerActOperation,
  localComputerWaitOperation,
  localComputerPauseOperation,
  localComputerResumeOperation,
  localComputerStopOperation,
]);
export type LocalComputerOperation = z.infer<typeof localComputerOperationSchema>;

export const localComputerToolNames = {
  status: "local_computer_status",
  select: "local_computer_select",
  observe: "local_computer_observe",
  act: "local_computer_act",
  wait: "local_computer_wait",
  pause: "local_computer_pause",
  resume: "local_computer_resume",
  stop: "local_computer_stop",
  extended: "local_computer_extended",
} as const;

const selection = z.strictObject({ selection_id: uuidSchema });

export const localComputerStatusInputSchema = z.strictObject({});
export const localComputerStatusStateSchema = z.enum([
  "idle",
  "active",
  "paused",
  "stopped",
  "unavailable",
]);
export const localComputerStatusResultSchema = z.strictObject({
  state: localComputerStatusStateSchema,
  available: z.boolean(),
  permissions: z.strictObject({
    accessibility: z.enum(["granted", "missing", "unknown"]),
  }),
  agent_desktop_version: z.string().min(1).max(40).optional(),
  selection_id: uuidSchema.optional(),
  expires_at: timestampSchema.optional(),
});
export type LocalComputerStatusResult = z.infer<typeof localComputerStatusResultSchema>;

export const localComputerSelectInputSchema = z.strictObject({});
export const localComputerSelectResultSchema = z.strictObject({
  selection_id: uuidSchema,
  expires_at: timestampSchema,
  state: z.literal("active"),
});
export type LocalComputerSelectResult = z.infer<typeof localComputerSelectResultSchema>;

export const localComputerObserveInputSchema = selection;
export const localComputerObserveResultSchema = computerObservationSchema;

const timeout = z.number().int().min(100).max(20_000).default(8_000);
export const localComputerActInputSchema = z.discriminatedUnion("action", [
  z.strictObject({
    selection_id: uuidSchema,
    action: z.literal("click"),
    observation_id: z.string().min(1).max(120),
    ref: computerQualifiedRefSchema,
    timeout_ms: timeout,
  }),
  z.strictObject({
    selection_id: uuidSchema,
    action: z.literal("type"),
    observation_id: z.string().min(1).max(120),
    ref: computerQualifiedRefSchema,
    text: z
      .string()
      .min(1)
      .max(8_000)
      .refine(value => new TextEncoder().encode(value).length <= 8_192,
        "text exceeds 8192 UTF-8 bytes"),
    timeout_ms: timeout,
  }),
]);
export type LocalComputerActInput = z.infer<typeof localComputerActInputSchema>;
export const localComputerActResultSchema = computerActResultSchema;

export const localComputerWaitInputSchema = z.strictObject({
  selection_id: uuidSchema,
  observation_id: z.string().min(1).max(120),
  ref: computerQualifiedRefSchema,
  timeout_ms: timeout,
});
export const localComputerWaitResultSchema = computerWaitResultSchema;

export const localComputerPauseInputSchema = selection;
export const localComputerResumeInputSchema = selection;
export const localComputerStopInputSchema = selection;
export const localComputerControlResultSchema = z.strictObject({
  state: z.enum(["active", "paused", "stopped"]),
  expires_at: timestampSchema.optional(),
});
export type LocalComputerControlResult = z.infer<typeof localComputerControlResultSchema>;

const extendedTimeout = z.number().int().min(100).max(20_000).default(8_000);
const extendedCombo = z.string().min(1).max(80).regex(/^[A-Za-z0-9+_.: -]+$/u);
const appName = z.string().min(1).max(120).regex(/^[^\u0000-\u001f]+$/u);
const extendedWindowAction = z.enum([
  "focus", "resize", "move", "minimize", "maximize", "restore",
]);

/** Internal-build full action set. Release builds return COMPUTER_UNAVAILABLE. */
export const localComputerExtendedInputSchema = z.discriminatedUnion("action", [
  z.strictObject({
    selection_id: uuidSchema,
    action: z.literal("scroll"),
    observation_id: z.string().min(1).max(120),
    ref: computerQualifiedRefSchema,
    direction: z.enum(["up", "down", "left", "right"]).default("down"),
    amount: z.number().int().min(1).max(20).default(3),
    timeout_ms: extendedTimeout,
  }),
  z.strictObject({
    selection_id: uuidSchema,
    action: z.literal("press"),
    combo: extendedCombo,
    timeout_ms: extendedTimeout,
  }),
  z.strictObject({
    selection_id: uuidSchema,
    action: z.literal("drag"),
    observation_id: z.string().min(1).max(120),
    from_ref: computerQualifiedRefSchema,
    to_ref: computerQualifiedRefSchema,
    timeout_ms: extendedTimeout,
  }),
  z.strictObject({
    selection_id: uuidSchema,
    action: z.literal("launch"),
    app: appName,
    timeout_ms: z.number().int().min(100).max(30_000).default(10_000),
  }),
  z.strictObject({
    selection_id: uuidSchema,
    action: z.literal("window"),
    window_action: extendedWindowAction,
    width: z.number().int().min(1).max(16_384).optional(),
    height: z.number().int().min(1).max(16_384).optional(),
    x: z.number().int().min(-32_768).max(32_768).optional(),
    y: z.number().int().min(-32_768).max(32_768).optional(),
    timeout_ms: extendedTimeout,
  }),
  z.strictObject({
    selection_id: uuidSchema,
    action: z.literal("clipboard_get"),
  }),
  z.strictObject({
    selection_id: uuidSchema,
    action: z.literal("clipboard_set"),
    text: z.string().max(131_072),
  }),
  z.strictObject({
    selection_id: uuidSchema,
    action: z.literal("clipboard_clear"),
  }),
  z.strictObject({
    selection_id: uuidSchema,
    action: z.literal("screenshot"),
    timeout_ms: z.number().int().min(100).max(20_000).default(8_000),
  }),
]);
export type LocalComputerExtendedInput = z.infer<typeof localComputerExtendedInputSchema>;

export const localComputerExtendedResultSchema = z.strictObject({
  ok: z.boolean(),
  effect: z.string().min(1).max(32).optional(),
  data: z.unknown().optional(),
  error: z.string().min(1).max(64).optional(),
});
export type LocalComputerExtendedResult = z.infer<typeof localComputerExtendedResultSchema>;
