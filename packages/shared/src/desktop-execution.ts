import { z } from "zod";

import { timestampSchema, uuidSchema } from "./common.js";
import { desktopDeviceReadySchema, desktopRunCredentialsSchema, desktopRunTokenSchema } from "./desktop-device.js";
import { desktopArtifactPrepareSchema, desktopArtifactSingleGrantSchema, desktopArtifactUploadGrantSchema, desktopWebsiteArtifactPrepareSchema } from "./desktop-artifacts.js";
import { connectionFailureCodeSchema } from "./connections.js";
import { browserUseRequestSchema, desktopBrowserUseResultSchema } from "./browser-use.js";
import { nativeUserInputResponseSchema, type NativeUserInputResponse } from "./conversation-forms.js";
import { runnerCodexGoalSchema, runnerCodexTurnSchema, runnerEventBatchReceiptSchema, runnerEventBatchSchema, runnerNativeIdSchema } from "./events.js";
import { computerActInputSchema, computerActResultSchema, computerFailureCodeSchema, computerObservationSchema, computerStatusResultSchema } from "./computer-use.js";
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
export const DESKTOP_ATTACHMENT_PROTOCOL_HEADER = "x-linksense-desktop-attachments";
export const desktopAttachmentProtocolVersion = 1;
export const desktopAttachmentDownloadPath = "/api/v1/desktop/attachments";
export const DESKTOP_ATTACHMENT_GRANT_HEADER = "x-linksense-desktop-attachment-grant";
export const desktopToolRequestLifetimeMs = WEB_SEARCH_MAX_TIMEOUT_MS + 2_000;
export const desktopToolClockSkewAllowanceMs = 5_000;
export const desktopExecutionMaxFrameBytes = 1024 * 1024;
export const desktopExecutionMaxInFlight = 8;
export function desktopCommandCapacity(operation: DesktopExecutionCommand["operation"], attachments: boolean): number {
  // Reserve room for Stop while ordinary commands wait for attachment I/O.
  return attachments && operation !== "turn.interrupt" ? desktopExecutionMaxInFlight - 1 : desktopExecutionMaxInFlight;
}
// Leave room for lifecycle callbacks while tool requests wait on providers.
export const desktopToolMaxInFlight = 4;
export const desktopExecutionCommandLifetimeMs = 65_000;
/** Bound whole status/observe/act round trips, including the bounded effect wait. */
export const desktopComputerExecuteLifetimeMs = 25_000;
/** Control-only quiescence gets a short deadline independent of grant expiry. */
export const desktopComputerQuiesceLifetimeMs = 5_000;
export const desktopAttachmentTransferLifetimeMs = 4 * 60_000;
// Reserve time for worker readiness and native admission after the last file.
export const desktopAttachmentStartupReserveMs = 30_000;
export const desktopAttachmentStartLifetimeMs = desktopAttachmentTransferLifetimeMs + desktopAttachmentStartupReserveMs;
export function desktopExecutionLifetimeFor(command: DesktopExecutionCommand): number {
  return command.operation === "turn.start" && command.body.attachments?.length
    ? desktopAttachmentStartLifetimeMs : desktopExecutionCommandLifetimeMs;
}
export const desktopAttachmentParamsSchema = z.strictObject({ turnId: uuidSchema, fileId: uuidSchema });
export const desktopAttachmentGrantSchema = z.string().regex(/^\d{13}\.[0-9a-f-]{36}\.[a-f0-9]{64}$/u);
export const desktopAttachmentGrantFieldsSchema = desktopAttachmentGrantSchema.transform(value => {
  const [expiry, commandId, signature] = value.split(".");
  return { expiresAt: Number(expiry), commandId, signature };
}).pipe(z.strictObject({
  expiresAt: z.number().int().positive(), commandId: uuidSchema, signature: z.string().regex(/^[a-f0-9]{64}$/u),
}));
export const desktopAttachmentSchema = z.strictObject({
  id: uuidSchema,
  filename: z.string().min(1).max(520).refine(name => name !== "." && name !== ".." && !/[\p{Cc}/\\]/u.test(name)),
  size_bytes: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  download_grant: desktopAttachmentGrantSchema,
});
const desktopAttachmentManifestSchema = z.array(desktopAttachmentSchema).min(1).max(256).refine(
  files => new Set(files.map(file => file.id.toLowerCase())).size === files.length,
);
export type DesktopAttachment = z.infer<typeof desktopAttachmentSchema>;
export const desktopExecutionOperation = z.enum(["turn.start", "turn.inspect", "turn.seal", "turn.interrupt", "turn.drain", "user-input.respond"]);
export const desktopToolOperationSchema = z.enum(["web.search", "knowledge.search", "knowledge.documents", "knowledge.markdown", "connection.execute", "browser.execute", "artifact.prepare", "artifact.multipart", "artifact.website"]);
export type DesktopToolOperation = z.infer<typeof desktopToolOperationSchema>;
/**
 * M1b computer operation. It is a negotiated tool request but deliberately not
 * part of the closed pre-existing tool-operation enum, so old negotiation
 * lists, defaults, and cloud behavior stay the same. The joined Mac fixture
 * and the opt-in product controller share this wire operation.
 */
export const desktopComputerExecuteOperation = "computer.execute" as const;
export const desktopToolRequestOperationSchema = z.enum([...desktopToolOperationSchema.options, desktopComputerExecuteOperation]);
export type DesktopToolRequestOperation = z.infer<typeof desktopToolRequestOperationSchema>;
/** Command operations, including the additive M1b computer operation. */
export const desktopExecutionCommandOperationSchema = z.enum([...desktopExecutionOperation.options, desktopComputerExecuteOperation]);
export const desktopNegotiatedOperationSchema = z.enum([...desktopToolRequestOperationSchema.options, "approval.respond"]);
export type DesktopNegotiatedOperation = z.infer<typeof desktopNegotiatedOperationSchema>;
export function supportsDesktopUserInput(
  operations: readonly DesktopNegotiatedOperation[],
  response?: NativeUserInputResponse,
): boolean {
  // A Mac that negotiated only computer.execute still needs native question
  // answers; every other operation and the approval method stay unchanged.
  return response && "method" in response ? operations.includes("approval.respond")
    : operations.includes("browser.execute") || operations.includes("artifact.prepare") ||
      operations.includes(desktopComputerExecuteOperation);
}
export function desktopToolLifetimeFor(operation: DesktopToolRequestOperation): number {
  if (operation === desktopComputerExecuteOperation) return desktopComputerExecuteLifetimeMs;
  if (operation === "artifact.prepare" || operation === "artifact.multipart" || operation === "artifact.website") return 10_000;
  if (operation === "connection.execute") return 58_000;
  if (operation === "browser.execute") return 34_000;
  return operation === "web.search" ? desktopToolRequestLifetimeMs : DEFAULT_KNOWLEDGE_SEARCH_TIMEOUT_MS + 2_000;
}
const toolOperations = z.array(desktopNegotiatedOperationSchema).max(desktopNegotiatedOperationSchema.options.length);
export const desktopExecutionDeviceReadySchema = desktopDeviceReadySchema.extend({
  execution_protocol_version: z.literal(desktopExecutionProtocolVersion),
  attachment_protocol_version: z.literal(desktopAttachmentProtocolVersion).optional(),
  tool_protocol_version: z.literal(desktopToolProtocolVersion).optional(),
  tool_operations: toolOperations.optional(),
});

const computerExecuteStatusRequest = z.strictObject({ kind: z.literal("status") });
const computerExecuteObserveRequest = z.strictObject({ kind: z.literal("observe") });
const computerExecuteActRequest = z.strictObject({
  kind: z.literal("act"),
  native_call_id: runnerNativeIdSchema,
  input: computerActInputSchema,
});
/**
 * Host policy chooses the target, session, selection, and holder; none of them
 * is accepted from the model or from this tool request body.
 */
export const computerExecuteInputSchema = z.discriminatedUnion("kind", [
  computerExecuteStatusRequest,
  computerExecuteObserveRequest,
  computerExecuteActRequest,
]);
export type ComputerExecuteInput = z.infer<typeof computerExecuteInputSchema>;
/** Server -> Mac command request. Quiescence exists only on this control path. */
export const desktopComputerExecuteBodySchema = z.strictObject({
  session_id: uuidSchema,
  selection_id: uuidSchema,
  // Read-only status never acquires an occupancy holder; every other kind must
  // carry the holder the first authorized observe bound.
  holder_id: uuidSchema.nullable(),
  request: z.discriminatedUnion("kind", [
    computerExecuteStatusRequest,
    computerExecuteObserveRequest,
    computerExecuteActRequest,
    z.strictObject({ kind: z.literal("quiesce") }),
  ]),
}).refine(body => body.request.kind === "status" ? body.holder_id === null : body.holder_id !== null, {
  path: ["holder_id"], error: "desktop_computer_holder_required",
});
export type DesktopComputerExecuteBody = z.infer<typeof desktopComputerExecuteBodySchema>;
/** Identical typed result under command.result `result` and tool.result `data`. */
export const computerExecuteResultSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("status"), result: computerStatusResultSchema }),
  z.strictObject({ kind: z.literal("observe"), result: computerObservationSchema }),
  z.strictObject({ kind: z.literal("act"), result: computerActResultSchema }),
  z.strictObject({ kind: z.literal("quiesce"), result: z.strictObject({ quiesced: z.literal(true) }) }),
  z.strictObject({ kind: z.literal("failure"), error: computerFailureCodeSchema }),
]);
export type ComputerExecuteResult = z.infer<typeof computerExecuteResultSchema>;

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
  response: nativeUserInputResponseSchema,
});
export const desktopUserInputReceiptSchema = z.strictObject({ accepted: z.literal(true) });
export const desktopExecutionCommandSchema = z.discriminatedUnion("operation", [
  command.extend({
    operation: z.literal("turn.start"),
    body: z.strictObject({
      native_thread_id: uuidSchema.nullable(),
      input: z.string().trim().max(128_000),
      attachments: desktopAttachmentManifestSchema.optional(),
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
  command.extend({ operation: z.literal("computer.execute"), body: desktopComputerExecuteBodySchema }),
]).refine(frame => frame.operation !== "turn.start" || frame.turn_id === frame.body.credentials.turn_id, {
  path: ["body", "credentials", "turn_id"], error: "desktop_turn_scope_mismatch",
}).refine(frame => frame.operation !== "turn.start" || Boolean(frame.body.input || frame.body.attachments?.length), {
  path: ["body", "input"], error: "desktop_turn_input_required",
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
    operation: desktopExecutionCommandOperationSchema,
    error_code: z.enum(["RUNNER_UNAVAILABLE", "RUNNER_OPERATION_UNCERTAIN", "FORBIDDEN", "USER_INPUT_REQUEST_UNAVAILABLE", "ATTACHMENT_UPLOAD_INVALID"]),
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
    operation: z.literal("computer.execute"),
    result: computerExecuteResultSchema,
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
  request.extend({ operation: z.literal("artifact.prepare"), body: desktopArtifactPrepareSchema }),
  request.extend({ operation: z.literal("artifact.multipart"), body: desktopArtifactPrepareSchema }),
  request.extend({ operation: z.literal("artifact.website"), body: desktopWebsiteArtifactPrepareSchema }),
  // Quiescence is control-only and can never be requested as a tool.
  request.extend({ operation: z.literal("computer.execute"), body: computerExecuteInputSchema }),
]);
export const desktopToolCancelSchema = callbackScope.extend({
  type: z.literal("tool.cancel"),
  operation: desktopToolRequestOperationSchema,
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
  callback.extend({ operation: z.literal("attachments.ready"), start_id: uuidSchema }),
  // The live gateway authorizes recovery against its pending drain command.
  // There is no bearer or model credential for a replacement worker.
  callbackScope.extend({
    type: z.literal("execution.recovery"),
    drain_id: uuidSchema,
    operation: z.literal("events"),
    body: runnerEventBatchSchema,
  }),
]).refine(frame => frame.type === "tool.request" || frame.operation === "turn.exited" || frame.operation === "attachments.ready" ||
  (frame.body.conversationId === frame.conversation_id &&
  (frame.operation !== "start.settled" || (frame.body.projectionTurnId === frame.turn_id &&
    frame.body.runtimeGeneration === frame.runtime_generation))), { error: "desktop_callback_scope_mismatch" });
const callbackResult = z.strictObject({ type: z.literal("execution.ack"), id: uuidSchema });
const toolResult = callbackResult.extend({ type: z.literal("tool.result"), ok: z.literal(true) });
export const desktopToolErrorSchema = z.union([
  webSearchFailureCodeSchema,
  connectionFailureCodeSchema,
  z.enum([
    "FORBIDDEN", "RUNNER_UNAVAILABLE", "KNOWLEDGE_PROCESSING_UNAVAILABLE", "ARTIFACT_REGISTRATION_INVALID", "CONFLICT",
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
  toolResult.extend({ operation: z.literal("artifact.prepare"), data: desktopArtifactSingleGrantSchema }),
  toolResult.extend({ operation: z.literal("artifact.multipart"), data: desktopArtifactUploadGrantSchema }),
  toolResult.extend({ operation: z.literal("artifact.website"), data: desktopArtifactUploadGrantSchema }),
  toolResult.extend({ operation: z.literal("computer.execute"), data: computerExecuteResultSchema }),
  toolResult.extend({ operation: desktopToolRequestOperationSchema, ok: z.literal(false), error_code: desktopToolErrorSchema }),
]);
export const desktopExecutionAckSchema = z.union([
  desktopToolResultSchema,
  callbackResult.extend({
    ok: z.literal(false),
    operation: z.enum(["events", "start.settled", "turn.exited", "attachments.ready"]),
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
  callbackResult.extend({ ok: z.literal(true), operation: z.enum(["turn.exited", "attachments.ready"]) }),
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
    attachment_version: z.literal(desktopAttachmentProtocolVersion).optional(),
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

// Workspace usage and cleanup are supervisor control messages, not device links:
// the settings page can request them while the device socket is idle.
export const desktopWorkspaceUsageSchema = z.strictObject({
  bytes: z.number().int().nonnegative(),
  files: z.number().int().nonnegative(),
  sessions: z.number().int().nonnegative(),
  retention_days: z.number().int().positive(),
  budget_bytes: z.number().int().positive(),
});
export const desktopWorkspaceCleanupSchema = z.strictObject({
  status: z.enum(["completed", "busy"]),
  deleted_sessions: z.number().int().nonnegative(),
  freed_bytes: z.number().int().nonnegative(),
  retained_bytes: z.number().int().nonnegative(),
});
// owner_id is filled by the native host from its own refresh session. The
// WebView never supplies it, so a page cannot name another account.
const workspaceControlRequest = z.strictObject({ request_id: uuidSchema, owner_id: uuidSchema });
// Cancelling is bound to one request id. A read-only usage scan has nothing to
// stop; the supervisor uses this for a cleanup that must not delete more files.
export const desktopRuntimeControlCancelSchema = z.strictObject({
  type: z.literal("workspace.cancel"), request_id: uuidSchema,
});
// Application-update admission is native-only and not account scoped. Go sends
// one request id with acquire, holds the gate until a matching release, and
// never exposes these frames to the WebView or the network.
const updateControlRequest = z.strictObject({ request_id: uuidSchema });
export const desktopRuntimeControlInputSchema = z.discriminatedUnion("type", [
  workspaceControlRequest.extend({ type: z.literal("workspace.usage") }),
  workspaceControlRequest.extend({ type: z.literal("workspace.cleanup") }),
  desktopRuntimeControlCancelSchema,
  updateControlRequest.extend({ type: z.literal("update.acquire") }),
  updateControlRequest.extend({ type: z.literal("update.release") }),
]);
const controlResult = z.strictObject({ request_id: uuidSchema });
export const desktopUpdateAdmissionErrorSchema = z.enum(["DESKTOP_UPDATE_BUSY", "DESKTOP_RUNTIME_UNAVAILABLE"]);
export const desktopRuntimeControlOutputSchema = z.union([
  controlResult.extend({
    type: z.literal("workspace.usage.result"), ok: z.literal(true), usage: desktopWorkspaceUsageSchema,
  }),
  controlResult.extend({
    type: z.literal("workspace.usage.result"), ok: z.literal(false), error_code: z.literal("DESKTOP_WORKSPACE_UNAVAILABLE"),
  }),
  controlResult.extend({
    type: z.literal("workspace.cleanup.result"), ok: z.literal(true), cleanup: desktopWorkspaceCleanupSchema,
  }),
  controlResult.extend({
    type: z.literal("workspace.cleanup.result"), ok: z.literal(false),
    error_code: z.enum(["DESKTOP_WORKSPACE_UNAVAILABLE", "DESKTOP_WORKSPACE_CLEANUP_FAILED"]),
  }),
  controlResult.extend({ type: z.literal("update.acquire.result"), ok: z.literal(true) }),
  controlResult.extend({
    type: z.literal("update.acquire.result"), ok: z.literal(false), error_code: desktopUpdateAdmissionErrorSchema,
  }),
]);
export type DesktopRuntimeControlInput = z.infer<typeof desktopRuntimeControlInputSchema>;
export type DesktopWorkspaceControlRequest = Extract<DesktopRuntimeControlInput, {
  type: "workspace.usage" | "workspace.cleanup"
}>;
export type DesktopRuntimeControlOutput = z.infer<typeof desktopRuntimeControlOutputSchema>;
export type DesktopWorkspaceUsage = z.infer<typeof desktopWorkspaceUsageSchema>;
export type DesktopWorkspaceCleanup = z.infer<typeof desktopWorkspaceCleanupSchema>;
