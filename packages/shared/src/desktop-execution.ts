import { z } from "zod";

import { timestampSchema, uuidSchema } from "./common.js";
import { desktopDeviceReadySchema, desktopRunCredentialsSchema, desktopRunTokenSchema } from "./desktop-device.js";
import { connectionFailureCodeSchema } from "./connections.js";
import { browserUseRequestSchema, desktopBrowserUseResultSchema } from "./browser-use.js";
import { conversationUserInputResponseSchema } from "./conversation-forms.js";
import { runnerCodexGoalSchema, runnerCodexTurnSchema, runnerEventBatchReceiptSchema, runnerEventBatchSchema } from "./events.js";
import { reasoningEffortSchema } from "./model-provider.js";
import { runnerStartSettledReceiptSchema, runnerStartSettledSchema, runnerTurnInterruptResultSchema } from "./runner.js";
import { runnerKnowledgeBaseSelectionSchema } from "./runner.js";
import {
  DEFAULT_KNOWLEDGE_SEARCH_TIMEOUT_MS, getKnowledgeDocumentMarkdownInputSchema, knowledgeDocumentListSuccessSchema,
  knowledgeDocumentMarkdownSuccessSchema,
  knowledgeSearchSuccessSchema, listKnowledgeDocumentsInputSchema, searchKnowledgeBaseInputSchema,
} from "./knowledge.js";
import { WEB_SEARCH_MAX_TIMEOUT_MS, webSearchFailureCodeSchema, webSearchRequestSchema, webSearchSuccessSchema } from "./web-search.js";
import { desktopConnectionRequestBodySchema, desktopConnectionResultSchema } from "./workspace-connections.js";

// Negotiate execution independently of the login and device presence protocol.
export const DESKTOP_EXECUTION_PROTOCOL_HEADER = "x-linksense-desktop-execution";
export const desktopExecutionProtocolVersion = 2;
export const DESKTOP_TOOL_PROTOCOL_HEADER = "x-linksense-desktop-tools";
export const DESKTOP_TOOL_OPERATIONS_HEADER = "x-linksense-desktop-tool-operations";
export const desktopToolProtocolVersion = 1;
export const desktopToolRequestLifetimeMs = WEB_SEARCH_MAX_TIMEOUT_MS + 2_000;
export const desktopToolClockSkewAllowanceMs = 5_000;
export const desktopExecutionMaxFrameBytes = 1024 * 1024;
export const desktopExecutionMaxInFlight = 8;
// Leave room for lifecycle callbacks while tool requests wait on providers.
export const desktopToolMaxInFlight = 4;
export const desktopExecutionCommandLifetimeMs = 65_000;
export const desktopExecutionOperation = z.enum(["turn.start", "turn.inspect", "turn.seal", "turn.interrupt", "turn.drain", "user-input.respond"]);
export const desktopToolOperationSchema = z.enum(["web.search", "knowledge.search", "knowledge.documents", "knowledge.markdown", "connection.execute", "browser.execute"]);
export type DesktopToolOperation = z.infer<typeof desktopToolOperationSchema>;
export function desktopToolLifetimeFor(operation: DesktopToolOperation): number {
  if (operation === "connection.execute") return 58_000;
  if (operation === "browser.execute") return 34_000;
  return operation === "web.search" ? desktopToolRequestLifetimeMs : DEFAULT_KNOWLEDGE_SEARCH_TIMEOUT_MS + 2_000;
}
const toolOperations = z.array(desktopToolOperationSchema).max(desktopToolOperationSchema.options.length);
export const desktopExecutionDeviceReadySchema = desktopDeviceReadySchema.extend({
  execution_protocol_version: z.literal(desktopExecutionProtocolVersion),
  tool_protocol_version: z.literal(desktopToolProtocolVersion).optional(),
  tool_operations: toolOperations.optional(),
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
const desktopUserInputResponseSchema = z.strictObject({
  codexThreadId: z.string().min(1).max(240),
  codexTurnId: z.string().min(1).max(240),
  itemId: z.string().min(1).max(240),
  requestId: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  response: conversationUserInputResponseSchema,
});
export const desktopUserInputReceiptSchema = z.strictObject({ accepted: z.literal(true) });
export const desktopExecutionCommandSchema = z.discriminatedUnion("operation", [
  command.extend({
    operation: z.literal("turn.start"),
    body: z.strictObject({
      native_thread_id: uuidSchema.nullable(),
      input: z.string().trim().min(1).max(128_000),
      selected_knowledge_bases: runnerKnowledgeBaseSelectionSchema.optional(),
      reasoning_effort: reasoningEffortSchema,
      credentials: desktopRunCredentialsSchema,
    }),
  }),
  command.extend({ operation: z.literal("turn.inspect") }),
  command.extend({ operation: z.literal("turn.seal") }),
  command.extend({ operation: z.literal("turn.interrupt") }),
  command.extend({ operation: z.literal("turn.drain") }),
  command.extend({ operation: z.literal("user-input.respond"), body: desktopUserInputResponseSchema }),
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
    error_code: z.enum(["RUNNER_UNAVAILABLE", "RUNNER_OPERATION_UNCERTAIN", "FORBIDDEN", "USER_INPUT_REQUEST_UNAVAILABLE"]),
  }),
  receipt.extend({
    ok: z.literal(true),
    operation: z.enum(["turn.start", "turn.seal"]),
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
    operation: z.literal("user-input.respond"),
    result: desktopUserInputReceiptSchema,
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
const request = callback.extend({
  type: z.literal("tool.request"),
  expires_at: timestampSchema,
});
export const desktopToolRequestSchema = z.discriminatedUnion("operation", [
  request.extend({ operation: z.literal("web.search"), body: webSearchRequestSchema }),
  request.extend({ operation: z.literal("knowledge.search"), body: searchKnowledgeBaseInputSchema }),
  request.extend({ operation: z.literal("knowledge.documents"), body: listKnowledgeDocumentsInputSchema }),
  request.extend({ operation: z.literal("knowledge.markdown"), body: getKnowledgeDocumentMarkdownInputSchema }),
  request.extend({ operation: z.literal("connection.execute"), body: desktopConnectionRequestBodySchema }),
  request.extend({ operation: z.literal("browser.execute"), body: browserUseRequestSchema }),
]);
export const desktopToolCancelSchema = callbackScope.extend({
  type: z.literal("tool.cancel"),
  operation: desktopToolOperationSchema,
});
export const desktopExecutionCallbackSchema = z.union([
  desktopToolRequestSchema,
  callback.extend({
    operation: z.literal("events"),
    body: runnerEventBatchSchema,
  }),
  callback.extend({
    operation: z.literal("start.settled"),
    body: runnerStartSettledSchema,
  }),
  callback.extend({ operation: z.literal("turn.exited") }),
  // The live gateway authorizes recovery against its pending drain command.
  // There is no bearer or model credential for a replacement worker.
  callbackScope.extend({
    type: z.literal("execution.recovery"),
    drain_id: uuidSchema,
    operation: z.literal("events"),
    body: runnerEventBatchSchema,
  }),
]).refine(frame => frame.type === "tool.request" || frame.operation === "turn.exited" || (frame.body.conversationId === frame.conversation_id &&
  (frame.operation !== "start.settled" || (frame.body.projectionTurnId === frame.turn_id &&
    frame.body.runtimeGeneration === frame.runtime_generation))), { error: "desktop_callback_scope_mismatch" });
const callbackResult = z.strictObject({ type: z.literal("execution.ack"), id: uuidSchema });
const toolResult = callbackResult.extend({ type: z.literal("tool.result"), ok: z.literal(true) });
export const desktopToolErrorSchema = z.union([
  webSearchFailureCodeSchema,
  connectionFailureCodeSchema,
  z.enum([
    "FORBIDDEN", "RUNNER_UNAVAILABLE", "KNOWLEDGE_PROCESSING_UNAVAILABLE",
    "KNOWLEDGE_SEARCH_UNAVAILABLE", "KNOWLEDGE_NO_AVAILABLE_BASES",
    "KNOWLEDGE_MAINTENANCE_UNAVAILABLE", "KNOWLEDGE_DOCUMENT_CONTENT_NOT_READY", "FILE_LIMIT_EXCEEDED",
    "KNOWLEDGE_BASE_NOT_FOUND", "KNOWLEDGE_BASE_ACCESS_DENIED", "KNOWLEDGE_BASE_DISABLED", "KNOWLEDGE_DOCUMENT_NOT_FOUND",
  ]),
]);
export const desktopToolResultSchema = z.union([
  toolResult.extend({ operation: z.literal("web.search"), data: webSearchSuccessSchema }),
  toolResult.extend({ operation: z.literal("knowledge.search"), data: knowledgeSearchSuccessSchema }),
  toolResult.extend({ operation: z.literal("knowledge.documents"), data: knowledgeDocumentListSuccessSchema }),
  toolResult.extend({ operation: z.literal("knowledge.markdown"), data: knowledgeDocumentMarkdownSuccessSchema }),
  toolResult.extend({ operation: z.literal("connection.execute"), data: desktopConnectionResultSchema }),
  toolResult.extend({ operation: z.literal("browser.execute"), data: desktopBrowserUseResultSchema }),
  toolResult.extend({ operation: desktopToolOperationSchema, ok: z.literal(false), error_code: desktopToolErrorSchema }),
]);
export const desktopExecutionAckSchema = z.union([
  desktopToolResultSchema,
  callbackResult.extend({
    ok: z.literal(false),
    operation: z.enum(["events", "start.settled", "turn.exited"]),
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
  callbackResult.extend({ ok: z.literal(true), operation: z.literal("turn.exited") }),
]);

export type DesktopExecutionCommand = z.infer<typeof desktopExecutionCommandSchema>;
export type DesktopExecutionCancel = z.infer<typeof desktopExecutionCancelSchema>;
export type DesktopExecutionResult = z.infer<typeof desktopExecutionResultSchema>;
export type DesktopExecutionTerminal = z.infer<typeof desktopExecutionTerminalSchema>;
export type DesktopExecutionCallback = z.infer<typeof desktopExecutionCallbackSchema>;
export type DesktopExecutionRecovery = Extract<DesktopExecutionCallback, { type: "execution.recovery" }>;
export type DesktopExecutionAck = z.infer<typeof desktopExecutionAckSchema>;
export type DesktopToolRequest = z.infer<typeof desktopToolRequestSchema>;
export type DesktopToolCancel = z.infer<typeof desktopToolCancelSchema>;
export type DesktopToolResult = z.infer<typeof desktopToolResultSchema>;

// The native host associates pipe messages with exactly one negotiated socket.
const link = z.strictObject({ link_id: uuidSchema });
export const desktopRuntimeInputSchema = z.union([
  link.extend({
    type: z.literal("link.open"), owner_id: uuidSchema, tools_version: z.literal(desktopToolProtocolVersion).optional(),
    tool_operations: toolOperations.optional(),
  }),
  link.extend({ type: z.literal("link.close") }),
  link.extend({
    type: z.literal("link.frame"),
    frame: z.union([desktopExecutionCommandSchema, desktopExecutionCancelSchema, desktopExecutionAckSchema]),
  }),
]);
export const desktopRuntimeOutputSchema = link.extend({
  type: z.literal("link.frame"),
  frame: z.union([desktopExecutionResultSchema, desktopExecutionCallbackSchema, desktopToolCancelSchema]),
});
