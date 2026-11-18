import { z } from "zod";

import { timestampSchema, uuidSchema } from "./common.js";
import { desktopDeviceReadySchema, desktopRunCredentialsSchema } from "./desktop-device.js";
import { runnerCodexGoalSchema } from "./events.js";
import { reasoningEffortSchema } from "./model-provider.js";
import { runnerTurnInterruptResultSchema } from "./runner.js";

// Negotiate execution independently of the login and device presence protocol.
export const DESKTOP_EXECUTION_PROTOCOL_HEADER = "x-linksense-desktop-execution";
export const desktopExecutionProtocolVersion = 1;
export const desktopExecutionMaxFrameBytes = 1024 * 1024;
export const desktopExecutionMaxInFlight = 8;
export const desktopExecutionCommandLifetimeMs = 65_000;
export const desktopExecutionOperation = z.enum(["turn.start", "turn.inspect", "turn.interrupt"]);
export const desktopExecutionDeviceReadySchema = desktopDeviceReadySchema.extend({
  execution_protocol_version: z.literal(desktopExecutionProtocolVersion),
});

const command = z.strictObject({
  type: z.literal("command"),
  id: uuidSchema,
  owner_id: uuidSchema,
  conversation_id: uuidSchema,
  runtime_generation: uuidSchema,
  turn_id: uuidSchema,
  expires_at: timestampSchema,
});
export const desktopExecutionCommandSchema = z.discriminatedUnion("operation", [
  command.extend({
    operation: z.literal("turn.start"),
    body: z.strictObject({
      native_thread_id: uuidSchema.nullable(),
      input: z.string().trim().min(1).max(128_000),
      reasoning_effort: reasoningEffortSchema,
      credentials: desktopRunCredentialsSchema,
    }),
  }),
  command.extend({ operation: z.literal("turn.inspect") }),
  command.extend({ operation: z.literal("turn.interrupt") }),
]).refine(frame => frame.operation !== "turn.start" || frame.turn_id === frame.body.credentials.turn_id, {
  path: ["body", "credentials", "turn_id"], error: "desktop_turn_scope_mismatch",
});
export const desktopExecutionCancelSchema = z.strictObject({
  type: z.literal("command.cancel"), id: uuidSchema,
});

const startReceipt = z.strictObject({
  conversationId: uuidSchema,
  projectionTurnId: uuidSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export const desktopExecutionStartReceiptSchema = z.discriminatedUnion("status", [
  startReceipt.extend({ status: z.literal("starting") }),
  startReceipt.extend({
    status: z.literal("succeeded"),
    result: z.strictObject({
      codexThreadId: uuidSchema,
      codexTurnId: uuidSchema,
      goal: runnerCodexGoalSchema.optional(),
    }),
  }),
  startReceipt.extend({
    status: z.literal("failed"),
    errorCode: z.enum(["RUNNER_TURN_START_FAILED", "RUNNER_TURN_START_SEALED"]),
  }),
  startReceipt.extend({
    status: z.literal("uncertain"),
    errorCode: z.literal("RUNNER_TURN_START_RESULT_UNCERTAIN"),
  }),
]);

const receipt = z.strictObject({ type: z.literal("command.result"), id: uuidSchema });
export const desktopExecutionResultSchema = z.union([
  receipt.extend({
    ok: z.literal(false),
    operation: desktopExecutionOperation,
    error_code: z.enum(["RUNNER_UNAVAILABLE", "RUNNER_OPERATION_UNCERTAIN", "FORBIDDEN"]),
  }),
  receipt.extend({
    ok: z.literal(true),
    operation: z.literal("turn.start"),
    result: desktopExecutionStartReceiptSchema,
  }),
  receipt.extend({
    ok: z.literal(true),
    operation: z.literal("turn.inspect"),
    result: desktopExecutionStartReceiptSchema.nullable(),
  }),
  receipt.extend({
    ok: z.literal(true),
    operation: z.literal("turn.interrupt"),
    result: runnerTurnInterruptResultSchema,
  }),
]);

export type DesktopExecutionCommand = z.infer<typeof desktopExecutionCommandSchema>;
export type DesktopExecutionCancel = z.infer<typeof desktopExecutionCancelSchema>;
export type DesktopExecutionResult = z.infer<typeof desktopExecutionResultSchema>;
