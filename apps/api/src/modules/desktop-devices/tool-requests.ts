import {
  desktopConnectionTextPageBytes, desktopExecutionMaxFrameBytes, desktopToolErrorSchema, desktopToolResultSchema,
  isWorkspaceInput, browserUseFailure, browserUseReadOnly,
  type DesktopConnectionRequestBody, type DesktopToolRequest, type DesktopToolResult, type WorkspaceResult,
} from "@linksense/shared";
import { sha256 } from "../../lib/crypto.js";
import { AppError } from "../../lib/errors.js";
import type { AuditService } from "../audit/service.js";
import { projectDesktopWorkspaceData } from "../connections/desktop-workspace-data.js";
import type { ConnectionService } from "../connections/service.js";
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
};

export async function executeDesktopTool(
  services: ToolRequestServices, scope: DesktopRunScope, frame: DesktopToolRequest, signal: AbortSignal,
): Promise<DesktopToolResult> {
  const base = { type: "tool.result", id: frame.id, operation: frame.operation } as const;
  const authorize = async () => {
    signal.throwIfAborted();
    await services.leases.verifyRunBinding(scope, frame.run_token, "use");
    signal.throwIfAborted();
  };
  await authorize();
  if (!await services.leases.claimToolRequest(scope.turnId, frame.id)) {
    return { ...base, ok: false, error_code: "RUNNER_OPERATION_UNCERTAIN" };
  }
  let recheckResource: (() => Promise<void>) | undefined;
  let browserMutationMayHaveRun = false;
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
    } else if (frame.operation === "artifact.prepare") {
      if (!services.artifacts) throw new AppError("RUNNER_UNAVAILABLE");
      data = await services.artifacts.prepare(scope, frame.body, signal, authorize);
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
        : { ...base, ok: false, error_code: frame.operation === "web.search" ? "WEB_SEARCH_RESPONSE_INVALID" : "KNOWLEDGE_PROCESSING_UNAVAILABLE" };
    }
  } catch (error) {
    const errorCode = error instanceof AppError ? error.code : undefined;
    const code = desktopToolErrorSchema.safeParse(errorCode);
    result = {
      ...base, ok: false,
      error_code: browserMutationMayHaveRun ? "RUNNER_OPERATION_UNCERTAIN"
        : code.success ? code.data : errorCode === "AUTH_REQUIRED" || errorCode === "ACCESS_DENIED"
        ? "FORBIDDEN" : "RUNNER_OPERATION_UNCERTAIN",
    };
  }
  const reason = !result.ok ? result.error_code
    : result.operation === "browser.execute" && !result.data.result.ok ? result.data.result.code : undefined;
  try {
    await services.audit.write({
      actorId: scope.ownerId, action: "desktop_tool_requested", targetId: frame.id,
      targetType: frame.operation === "web.search" ? "web_search" : frame.operation === "browser.execute" ? "browser_use"
        : frame.operation === "connection.execute" ? "connection"
        : frame.operation === "artifact.prepare" ? "conversation_file" : "knowledge_base",
      result: reason ? "failed" : "success",
      metadata: {
        operation: frame.operation, conversation_id: scope.conversationId, turn_id: scope.turnId, device_id: scope.deviceId,
        ...(frame.operation === "browser.execute" ? { browser_action: frame.body.action } : {}),
        ...(reason ? { reason_code: reason } : {}),
      },
    });
  } catch {
    return { ...base, ok: false, error_code: "RUNNER_OPERATION_UNCERTAIN" };
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
  frame: Exclude<DesktopToolRequest, { operation: "connection.execute" | "browser.execute" | "artifact.prepare" }>,
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
