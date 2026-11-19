import {
  desktopConnectionTextPageBytes, desktopExecutionMaxFrameBytes, desktopToolErrorSchema, desktopToolResultSchema,
  isWorkspaceInput, type DesktopConnectionRequestBody, type DesktopToolRequest, type DesktopToolResult, type WorkspaceResult,
} from "@linksense/shared";
import { sha256 } from "../../lib/crypto.js";
import { AppError } from "../../lib/errors.js";
import type { AuditService } from "../audit/service.js";
import { projectDesktopWorkspaceData } from "../connections/desktop-workspace-data.js";
import type { ConnectionService } from "../connections/service.js";
import type { DesktopRunLeases, DesktopRunScope } from "../desktop-credentials/run-leases.js";
import type { CheckKnowledgeAssetPublication } from "../knowledge/conversation-asset-snapshots.js";
import type { InternalKnowledgeSearchService } from "../knowledge/internal-search.js";
import type { WebSearchSettingsService } from "../system/web-search-settings.js";

type ToolRequestServices = {
  leases: Pick<DesktopRunLeases, "verifyRunBinding" | "claimToolRequest">;
  audit: Pick<AuditService, "write">;
  webSearchSettings: Pick<WebSearchSettingsService, "search">;
  knowledgeSearch: Pick<InternalKnowledgeSearchService,
    "search" | "listDocuments" | "getDocumentMarkdown" | "assertDocumentReferencesCurrent"> | null;
  checkPublication: CheckKnowledgeAssetPublication;
  connections?: Pick<ConnectionService, "executeScoped">;
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
  let recheckConnection: (() => Promise<void>) | undefined;
  let result: DesktopToolResult;
  try {
    await authorize();
    let data;
    if (frame.operation === "connection.execute") {
      if (!services.connections) throw new AppError("CONNECTION_NOT_CONFIGURED");
      const connection = await services.connections.executeScoped(
        scope.ownerId, scope.conversationId, scope.turnId, frame.body.input, signal, authorize,
      );
      recheckConnection = connection.assertCurrent;
      data = connection.data.kind === "workspace_data"
        ? pageWorkspaceText(frame.body, connection.data)
        : connection.data;
    } else {
      data = await dispatchTool(services, scope, frame, signal, authorize);
    }
    await authorize();
    if (frame.operation === "connection.execute" && Buffer.byteLength(JSON.stringify(data)) > desktopExecutionMaxFrameBytes - 1024) {
      throw new AppError("CONNECTION_FILE_TOO_LARGE");
    }
    result = desktopToolResultSchema.parse({ ...base, ok: true, data });
    if (Buffer.byteLength(JSON.stringify(result)) > desktopExecutionMaxFrameBytes) {
      result = { ...base, ok: false, error_code: frame.operation === "web.search" ? "WEB_SEARCH_RESPONSE_INVALID" : "KNOWLEDGE_PROCESSING_UNAVAILABLE" };
    }
  } catch (error) {
    const code = desktopToolErrorSchema.safeParse(error instanceof AppError ? error.code : undefined);
    result = {
      ...base, ok: false,
      error_code: code.success ? code.data : error instanceof AppError && ["AUTH_REQUIRED", "ACCESS_DENIED"].includes(error.code)
        ? "FORBIDDEN" : "RUNNER_OPERATION_UNCERTAIN",
    };
  }
  try {
    await services.audit.write({
      actorId: scope.ownerId, action: "desktop_tool_requested", targetId: frame.id,
      targetType: frame.operation === "web.search" ? "web_search" :
        frame.operation === "connection.execute" ? "connection" : "knowledge_base",
      result: result.ok ? "success" : "failed",
      metadata: {
        operation: frame.operation, conversation_id: scope.conversationId, turn_id: scope.turnId, device_id: scope.deviceId,
        ...(result.ok ? {} : { reason_code: result.error_code }),
      },
    });
  } catch {
    return { ...base, ok: false, error_code: "RUNNER_OPERATION_UNCERTAIN" };
  }
  if (result.ok) {
    if (recheckConnection) {
      await authorize();
      try {
        await recheckConnection();
      } catch (error) {
        const code = desktopToolErrorSchema.safeParse(error instanceof AppError ? error.code : undefined);
        return { ...base, ok: false, error_code: code.success ? code.data : "RUNNER_UNAVAILABLE" };
      }
      signal.throwIfAborted();
      return result;
    }
    if (result.operation !== "web.search" && result.operation !== "connection.execute" && services.knowledgeSearch) {
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
  frame: Exclude<DesktopToolRequest, { operation: "connection.execute" }>,
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
