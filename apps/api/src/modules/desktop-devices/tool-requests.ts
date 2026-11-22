import {
  computerExecuteResultSchema,
  desktopConnectionTextPageBytes, desktopExecutionMaxFrameBytes, desktopToolErrorSchema, desktopToolResultSchema,
  isWorkspaceInput, browserUseFailure, browserUseReadOnly,
  type ComputerExecuteResult, type ComputerFailureCode, type DesktopConnectionRequestBody, type DesktopToolRequest,
  type DesktopToolResult, type WorkspaceResult,
} from "@linksense/shared";
import { sha256 } from "../../lib/crypto.js";
import { AppError } from "../../lib/errors.js";
import type { AuditService } from "../audit/service.js";
import { projectDesktopWorkspaceData } from "../connections/desktop-workspace-data.js";
import type { ConnectionService } from "../connections/service.js";
import type { DesktopComputerWaitPublication } from "./computer-admission.js";
import type { DesktopRunLeases, DesktopRunScope } from "../desktop-credentials/run-leases.js";
import type { DesktopArtifacts } from "../files/desktop-artifacts.js";
import type { CheckKnowledgeAssetPublication } from "../knowledge/conversation-asset-snapshots.js";
import type { InternalKnowledgeSearchService } from "../knowledge/internal-search.js";
import type { WebSearchSettingsService } from "../system/web-search-settings.js";
import type { DesktopBrowserUse } from "./browser-use.js";

type ToolRequestServices = {
  leases: Pick<DesktopRunLeases, "verifyRunBinding" | "claimToolRequest">;
  audit: Pick<AuditService, "write">;
  webSearchSettings: Pick<WebSearchSettingsService, "search">;
  knowledgeSearch: Pick<InternalKnowledgeSearchService,
    "search" | "listDocuments" | "getDocumentMarkdown" | "assertDocumentReferencesCurrent"> | null;
  checkPublication: CheckKnowledgeAssetPublication;
  connections?: Pick<ConnectionService, "executeScoped">;
  browserUse?: Pick<DesktopBrowserUse, "execute">;
  artifacts?: Pick<DesktopArtifacts, "prepare">;
  /**
   * Supplied by the API composition (product controller or joined fixture),
   * never by the model. The product wait lane hands back its request-local
   * publication continuation through the second argument.
   */
  computerExecute?: (input: {
    scope: DesktopRunScope;
    request: Extract<DesktopToolRequest, { operation: "computer.execute" }>;
    signal: AbortSignal;
  }, publishWait?: (publication: DesktopComputerWaitPublication) => void) => Promise<ComputerExecuteResult>;
  /** True only for the socket generation that offered computer.wait too. */
  computerWait?: boolean;
};

/** Final send sink supplied by the transport; it owns the one true socket send. */
export type DesktopToolResultDelivery = (
  publication: DesktopComputerWaitPublication,
  result: Extract<DesktopToolResult, { ok: true }>,
) => Promise<boolean>;

export async function executeDesktopTool(
  services: ToolRequestServices, scope: DesktopRunScope, frame: DesktopToolRequest, signal: AbortSignal,
  publishResult?: DesktopToolResultDelivery,
): Promise<DesktopToolResult> {
  const startedAt = Date.now();
  const base = { type: "tool.result", id: frame.id, operation: frame.operation } as const;
  const wait = frame.operation === "computer.execute" && frame.body.kind === "wait";
  const waitFailure = (error: ComputerFailureCode): DesktopToolResult => ({
    type: "tool.result", id: frame.id, operation: "computer.execute", ok: true,
    data: { kind: "failure", error },
  });
  const authorize = async () => {
    signal.throwIfAborted();
    await services.leases.verifyRunBinding(scope, frame.run_token, "use");
    signal.throwIfAborted();
  };
  await authorize();
  if (!await services.leases.claimToolRequest(scope.turnId, frame.id)) {
    // A wait is a read: a settled duplicate is a clean bounded failure, never
    // mutation uncertainty, and it is never executed or replayed.
    if (wait) return waitFailure(signal.aborted ? "COMPUTER_TIMEOUT" : "COMPUTER_UNAVAILABLE");
    return { ...base, ok: false, error_code: "RUNNER_OPERATION_UNCERTAIN" };
  }
  let waitPublication: DesktopComputerWaitPublication | undefined;
  let recheckResource: (() => Promise<void>) | undefined;
  let browserMutationMayHaveRun = false;
  let computerMutationMayHaveRun = false;
  const artifact = frame.operation === "artifact.prepare" || frame.operation === "artifact.multipart" || frame.operation === "artifact.website";
  let result: DesktopToolResult;
  try {
    await authorize();
    let data;
    if (frame.operation === "connection.execute") {
      if (!services.connections) throw new AppError("CONNECTION_NOT_CONFIGURED");
      const connection = await services.connections.executeScoped(
        scope.ownerId, scope.conversationId, scope.turnId, frame.body.input, signal, authorize,
      );
      recheckResource = connection.assertCurrent;
      data = connection.data.kind === "workspace_data"
        ? pageWorkspaceText(frame.body, connection.data)
        : connection.data;
    } else if (frame.operation === "browser.execute") {
      if (!services.browserUse) throw new AppError("RUNNER_UNAVAILABLE");
      const browser = await services.browserUse.execute(scope, frame.body, signal, authorize);
      browserMutationMayHaveRun = !browserUseReadOnly(frame.body) &&
        (browser.data.result.ok || browser.data.result.code === "RUNNER_OPERATION_UNCERTAIN");
      recheckResource = browser.assertCurrent;
      data = browser.data;
    } else if (frame.operation === "computer.execute") {
      if (!services.computerExecute) throw new AppError("RUNNER_UNAVAILABLE");
      // The read-only wait kind is admitted only when this exact connection
      // offered the additive marker with computer.execute. An older Mac stays
      // valid; only its wait request is refused, without a device command.
      data = frame.body.kind === "wait" && services.computerWait !== true
        ? { kind: "failure" as const, error: "COMPUTER_UNAVAILABLE" as const }
        : await services.computerExecute({ scope, request: frame, signal }, publication => {
          waitPublication = publication;
        });
      // Only an act that may have reached the Mac must suppress a retry after a
      // later authorization failure; pre-dispatch denials stay retryable.
      const executed = computerExecuteResultSchema.safeParse(data);
      computerMutationMayHaveRun = frame.body.kind === "act" && executed.success &&
        (executed.data.kind !== "failure" || executed.data.error === "RUNNER_OPERATION_UNCERTAIN");
    } else if (artifact) {
      if (!services.artifacts) throw new AppError("RUNNER_UNAVAILABLE");
      data = await services.artifacts.prepare(scope, frame.body, signal, authorize, frame.operation !== "artifact.prepare");
    } else {
      data = await dispatchTool(services, scope, frame, signal, authorize);
    }
    await authorize();
    if (frame.operation === "connection.execute" && Buffer.byteLength(JSON.stringify(data)) > desktopExecutionMaxFrameBytes - 1024) {
      throw new AppError("CONNECTION_FILE_TOO_LARGE");
    }
    result = desktopToolResultSchema.parse({ ...base, ok: true, data });
    if (Buffer.byteLength(JSON.stringify(result)) > desktopExecutionMaxFrameBytes) {
      result = frame.operation === "browser.execute"
        ? { ...base, operation: frame.operation, ok: true, data: { result: browserUseFailure("BROWSER_USE_COMMAND_FAILED") } }
        : { ...base, ok: false, error_code: artifact ? "RUNNER_UNAVAILABLE"
          : frame.operation === "web.search" ? "WEB_SEARCH_RESPONSE_INVALID"
          : frame.operation === "computer.execute" ? "RUNNER_UNAVAILABLE"
          : "KNOWLEDGE_PROCESSING_UNAVAILABLE" };
    }
  } catch (error) {
    if (wait) {
      // Keep the existing failed-attempt audit below, but as a clean bounded
      // read outcome instead of mutation uncertainty.
      result = waitFailure(waitReadFailure(error, signal));
    } else {
      const errorCode = error instanceof AppError ? error.code : undefined;
      const code = desktopToolErrorSchema.safeParse(errorCode);
      result = {
        ...base, ok: false,
        error_code: browserMutationMayHaveRun || computerMutationMayHaveRun ? "RUNNER_OPERATION_UNCERTAIN"
          : code.success ? code.data : errorCode === "AUTH_REQUIRED" || errorCode === "ACCESS_DENIED"
          ? "FORBIDDEN" : "RUNNER_OPERATION_UNCERTAIN",
      };
    }
  }
  if (wait && signal.aborted && result.ok && result.operation === "computer.execute" &&
      result.data.kind === "wait") {
    // A cancel/deadline that arrived before the attempt audit must not be
    // recorded as a completed read, and the publication is never attempted.
    result = waitFailure("COMPUTER_TIMEOUT");
    waitPublication = undefined;
  }
  const reason = !result.ok ? result.error_code
    : result.operation === "browser.execute" && !result.data.result.ok ? result.data.result.code
    : computerToolFailureReason(result);
  try {
    await services.audit.write({
      actorId: scope.ownerId, action: "desktop_tool_requested", targetId: frame.id,
      targetType: frame.operation === "web.search" ? "web_search" : frame.operation === "browser.execute" ? "browser_use"
        : frame.operation === "connection.execute" ? "connection"
        : frame.operation === "computer.execute" ? "local_computer"
        : artifact ? "conversation_file" : "knowledge_base",
      result: reason ? "failed" : "success",
      metadata: {
        operation: frame.operation, conversation_id: scope.conversationId, turn_id: scope.turnId, device_id: scope.deviceId,
        ...(frame.operation === "browser.execute" ? { browser_action: frame.body.action } : {}),
        // Bounded action kind, outcome, and duration only; never AX trees,
        // window titles, typed text, screenshots, observation ids, element
        // refs, timeouts, or filesystem paths.
        ...(frame.operation === "computer.execute" && frame.body.kind === "act"
          ? { computer_action: frame.body.input.action } : {}),
        ...(frame.operation === "computer.execute"
          ? {
            duration_ms: Math.max(0, Date.now() - startedAt),
            computer_request: frame.body.kind,
            // A wait row is the single mandatory attempt record, written
            // before authority/queue/publication. `unconfirmed` is the
            // existing delivery vocabulary: a late final denial never turns
            // this row into a published-success claim.
            ...(frame.body.kind === "wait" ? { delivery: "unconfirmed" } : {}),
          } : {}),
        ...(reason ? { reason_code: reason } : {}),
      },
    });
  } catch {
    // The single bounded audit write above is the existing attempt record.
    // A wait read never becomes mutation uncertainty and never claims a
    // completed read through a rejected audit.
    if (wait) return waitFailure(signal.aborted ? "COMPUTER_TIMEOUT" : "COMPUTER_UNAVAILABLE");
    return { ...base, ok: false, error_code: "RUNNER_OPERATION_UNCERTAIN" };
  }
  if (waitPublication) {
    if (result.ok && result.operation === "computer.execute" && result.data.kind === "wait") {
      // The audit has resolved. Only the transport's final sink can publish
      // this read: it runs the request-local exact compare inside the locked
      // dispatch transaction and then the one synchronous socket send. Without
      // a sink (direct test/fixture lane) the result stays pre-publication only.
      if (publishResult) {
        const sent = await publishResult(waitPublication, result).catch(() => false);
        if (sent) return result;
        return waitFailure(signal.aborted || waitPublication.timedOut?.()
          ? "COMPUTER_TIMEOUT" : "COMPUTER_TARGET_CHANGED");
      }
    } else if (result.ok && !(result.operation === "computer.execute" && result.data.kind === "failure")) {
      // A publication may only accompany a wait success; any other success
      // fails closed. An existing typed computer failure is already closed and
      // keeps its failed-attempt audit below.
      return waitFailure("COMPUTER_UNAVAILABLE");
    }
  }
  if (wait && result.ok && result.operation === "computer.execute" && result.data.kind === "failure") {
    // A read failure is already the final bounded outcome and never needs the
    // post-success resource recheck; returning it keeps cancellation a clean
    // timeout instead of throwing out of the tool callback.
    return result;
  }
  if (result.ok) {
    if (browserMutationMayHaveRun) {
      try {
        await authorize();
        await recheckResource?.();
        signal.throwIfAborted();
      } catch {
        return { ...base, ok: false, error_code: "RUNNER_OPERATION_UNCERTAIN" };
      }
      return result;
    }
    if (computerMutationMayHaveRun) {
      // A successful act must not be reported as retryable just because the run
      // fenced or expired before the response was projected.
      try {
        await authorize();
        signal.throwIfAborted();
      } catch {
        return { ...base, ok: false, error_code: "RUNNER_OPERATION_UNCERTAIN" };
      }
      return result;
    }
    if (recheckResource) {
      await authorize();
      try {
        await recheckResource();
      } catch (error) {
        const code = desktopToolErrorSchema.safeParse(error instanceof AppError ? error.code : undefined);
        return { ...base, ok: false, error_code: code.success ? code.data : "RUNNER_UNAVAILABLE" };
      }
      signal.throwIfAborted();
      return result;
    }
    if ((result.operation === "knowledge.search" || result.operation === "knowledge.documents" ||
        result.operation === "knowledge.markdown") && services.knowledgeSearch) {
      const refs = result.operation === "knowledge.search" ? result.data.results.map(doc => doc.document_ref)
        : result.operation === "knowledge.documents" ? result.data.documents.map(doc => doc.document_ref)
          : [result.data.document_ref];
      await services.knowledgeSearch.assertDocumentReferencesCurrent({ ...scope, signal }, refs);
    }
    await authorize();
  }
  return result;
}

/**
 * A wait is a read with no effect to reconcile: every clean failure is a
 * bounded read outcome. Cancellation/deadline is a timeout; an authorization
 * denial stays denied; anything else is unavailable. Never uncertain, never
 * replayed.
 */
function waitReadFailure(error: unknown, signal: AbortSignal): ComputerFailureCode {
  if (signal.aborted) return "COMPUTER_TIMEOUT";
  const code = error instanceof AppError ? error.code : undefined;
  return code === "FORBIDDEN" || code === "ACCESS_DENIED" ||
    code === "AUTH_REQUIRED" || code === "AUTH_SESSION_EXPIRED"
    ? "COMPUTER_ACCESS_DENIED" : "COMPUTER_UNAVAILABLE";
}

function computerToolFailureReason(result: Extract<DesktopToolResult, { ok: true }>): string | undefined {
  if (result.operation !== "computer.execute") return undefined;
  if (result.data.kind === "failure") return result.data.error;
  // An act that reached the Mac but failed or lost proof is never audited as success.
  return result.data.kind === "act" && !result.data.result.ok ? result.data.result.error : undefined;
}

function pageWorkspaceText(
  { input, page }: DesktopConnectionRequestBody,
  result: Extract<WorkspaceResult, { kind: "workspace_data" }>,
) {
  if (!isWorkspaceInput(input)) throw new AppError("CONNECTION_UNAVAILABLE");
  const bytes = Buffer.from(JSON.stringify(projectDesktopWorkspaceData(input, result.data)));
  const hash = sha256(bytes);
  if (page && page.expected_sha256 !== hash) throw new AppError("CONNECTION_FILE_CONFLICT");
  const start = page?.byte_offset ?? 0;
  const continuesCodePoint = (index: number) => ((bytes[index] ?? 0) & 0xc0) === 0x80;
  if (start >= bytes.length || continuesCodePoint(start)) throw new AppError("VALIDATION_ERROR");
  const makePage = (end: number) => {
    while (continuesCodePoint(end)) end--;
    const complete = end === bytes.length;
    return {
      kind: "workspace_text" as const,
      data: bytes.toString("utf8", start, end),
      complete,
      sha256: hash,
      next_byte_offset: complete ? null : end,
      next_cursor: complete ? result.next_cursor : null,
    };
  };
  if (result.next_cursor && Buffer.byteLength(result.next_cursor) >= desktopConnectionTextPageBytes - 256)
    throw new AppError("CONNECTION_FILE_TOO_LARGE");
  let lo = start + 1;
  let hi = Math.min(start + desktopConnectionTextPageBytes, bytes.length);
  let output: ReturnType<typeof makePage> | undefined;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const candidate = makePage(mid);
    if (Buffer.byteLength(JSON.stringify(candidate)) <= desktopConnectionTextPageBytes) {
      if (candidate.data) output = candidate;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  if (!output) throw new AppError("CONNECTION_FILE_TOO_LARGE");
  return output;
}

async function dispatchTool(
  { webSearchSettings, knowledgeSearch, checkPublication }: ToolRequestServices,
  { ownerId, conversationId, turnId }: DesktopRunScope,
  frame: Exclude<DesktopToolRequest, { operation: "connection.execute" | "browser.execute" | "artifact.prepare" | "artifact.multipart" | "artifact.website" | "computer.execute" }>,
  signal: AbortSignal,
  checkRun: () => Promise<void>,
): Promise<Extract<DesktopToolResult, { ok: true }>["data"]> {
  const scope = { ownerId, conversationId, turnId };
  if (frame.operation === "web.search") return webSearchSettings.search({ ...scope, request: frame.body, signal });
  if (!knowledgeSearch) throw new AppError("KNOWLEDGE_PROCESSING_UNAVAILABLE");
  switch (frame.operation) {
    case "knowledge.search": {
      const { query, final_top_k, candidate_multiplier, num_candidates, min_score } = frame.body;
      return knowledgeSearch.search({
        ...scope, query, finalTopK: final_top_k, candidateMultiplier: candidate_multiplier,
        ...(num_candidates === undefined ? {} : { numCandidates: num_candidates }),
        minScore: min_score, signal, checkRun, checkPublication, maxResponseBytes: desktopExecutionMaxFrameBytes - 1024,
      });
    }
    case "knowledge.documents":
      return knowledgeSearch.listDocuments({
        ...scope, signal, checkRun, ...(frame.body.cursor === undefined ? {} : { cursor: frame.body.cursor }),
      });
    case "knowledge.markdown":
      return knowledgeSearch.getDocumentMarkdown({
        ...scope, signal, checkRun, checkPublication, documentRef: frame.body.document_ref,
        ...(frame.body.cursor === undefined ? {} : { cursor: frame.body.cursor }),
      });
  }
}
