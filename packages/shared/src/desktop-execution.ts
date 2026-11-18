import { z } from "zod";

import { timestampSchema, uuidSchema } from "./common.js";
import { desktopDeviceReadySchema, desktopRunCredentialsSchema, desktopRunTokenSchema } from "./desktop-device.js";
import { runnerCodexGoalSchema, runnerCodexTurnSchema, runnerEventBatchReceiptSchema, runnerEventBatchSchema } from "./events.js";
import { reasoningEffortSchema } from "./model-provider.js";
import { runnerStartSettledReceiptSchema, runnerStartSettledSchema, runnerTurnInterruptResultSchema } from "./runner.js";

// Negotiate execution independently of the login and device presence protocol.
export const DESKTOP_EXECUTION_PROTOCOL_HEADER = "x-linksense-desktop-execution";
export const desktopExecutionProtocolVersion = 1;
export const desktopExecutionMaxFrameBytes = 1024 * 1024;
export const desktopExecutionMaxInFlight = 8;
export const desktopExecutionCommandLifetimeMs = 65_000;
export const desktopExecutionOperation = z.enum(["turn.start", "turn.inspect", "turn.interrupt", "turn.drain"]);
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
  command.extend({ operation: z.literal("turn.drain") }),
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
export const desktopExecutionTerminalSchema = z.strictObject({
  codexThreadId: uuidSchema,
  turn: runnerCodexTurnSchema.omit({ items: true }).extend({
    id: uuidSchema,
    status: runnerCodexTurnSchema.shape.status.exclude(["inProgress"]),
  }),
});
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
  receipt.extend({
    ok: z.literal(true),
    operation: z.literal("turn.drain"),
    result: z.strictObject({
      drained: z.literal(true),
      // When the outbox did not contain the terminal event, return the
      // sanitized result of reading that exact stored native turn.
      terminal: desktopExecutionTerminalSchema.optional(),
    }),
  }),
]);

// Worker callbacks carry the exact turn lease; no server route or HTTP headers cross the wire.
const callbackScope = z.strictObject({
  id: uuidSchema,
  conversation_id: uuidSchema,
  runtime_generation: uuidSchema,
  turn_id: uuidSchema,
});
const callback = callbackScope.extend({
  type: z.literal("execution.callback"),
  run_token: desktopRunTokenSchema,
});
export const desktopExecutionCallbackSchema = z.union([
  callback.extend({
    operation: z.literal("events"),
    body: runnerEventBatchSchema,
  }),
  callback.extend({
    operation: z.literal("start.settled"),
    body: runnerStartSettledSchema,
  }),
  // The live gateway authorizes recovery against its pending drain command.
  // There is no bearer or model credential for a replacement worker.
  callbackScope.extend({
    type: z.literal("execution.recovery"),
    drain_id: uuidSchema,
    operation: z.literal("events"),
    body: runnerEventBatchSchema,
  }),
]).refine(frame => frame.body.conversationId === frame.conversation_id &&
  (frame.operation !== "start.settled" || (frame.body.projectionTurnId === frame.turn_id &&
    frame.body.runtimeGeneration === frame.runtime_generation)), { error: "desktop_callback_scope_mismatch" });
const callbackResult = z.strictObject({ type: z.literal("execution.ack"), id: uuidSchema });
export const desktopExecutionAckSchema = z.union([
  callbackResult.extend({
    ok: z.literal(false),
    operation: z.enum(["events", "start.settled"]),
    error_code: z.enum(["FORBIDDEN", "RUNNER_UNAVAILABLE"]),
  }),
  callbackResult.extend({
    ok: z.literal(true),
    operation: z.literal("events"),
    data: runnerEventBatchReceiptSchema,
  }),
  callbackResult.extend({
    ok: z.literal(true),
    operation: z.literal("start.settled"),
    data: runnerStartSettledReceiptSchema,
  }),
]);

export type DesktopExecutionCommand = z.infer<typeof desktopExecutionCommandSchema>;
export type DesktopExecutionCancel = z.infer<typeof desktopExecutionCancelSchema>;
export type DesktopExecutionResult = z.infer<typeof desktopExecutionResultSchema>;
export type DesktopExecutionCallback = z.infer<typeof desktopExecutionCallbackSchema>;
export type DesktopExecutionRecovery = Extract<DesktopExecutionCallback, { type: "execution.recovery" }>;
export type DesktopExecutionAck = z.infer<typeof desktopExecutionAckSchema>;

// The native host associates pipe messages with exactly one negotiated socket.
const link = z.strictObject({ link_id: uuidSchema });
export const desktopRuntimeInputSchema = z.union([
  link.extend({ type: z.literal("link.open"), owner_id: uuidSchema }),
  link.extend({ type: z.literal("link.close") }),
  link.extend({
    type: z.literal("link.frame"),
    frame: z.union([desktopExecutionCommandSchema, desktopExecutionCancelSchema, desktopExecutionAckSchema]),
  }),
]);
export const desktopRuntimeOutputSchema = link.extend({
  type: z.literal("link.frame"),
  frame: z.union([desktopExecutionResultSchema, desktopExecutionCallbackSchema]),
});
