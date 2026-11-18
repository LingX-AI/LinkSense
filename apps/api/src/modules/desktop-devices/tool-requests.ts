import {
  desktopExecutionMaxFrameBytes, desktopToolErrorSchema, desktopToolResultSchema, type DesktopToolRequest, type DesktopToolResult,
} from "@linksense/shared";
import { AppError } from "../../lib/errors.js";
import type { AuditService } from "../audit/service.js";
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
  let result: DesktopToolResult;
  try {
    await authorize();
    const data = await dispatchTool(services, scope, frame, signal, authorize);
    await authorize();
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
      targetType: frame.operation === "web.search" ? "web_search" : "knowledge_base",
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
    if (result.operation !== "web.search" && services.knowledgeSearch) {
      const refs = result.operation === "knowledge.search" ? result.data.results.map(doc => doc.document_ref)
        : result.operation === "knowledge.documents" ? result.data.documents.map(doc => doc.document_ref)
          : [result.data.document_ref];
      await services.knowledgeSearch.assertDocumentReferencesCurrent({ ...scope, signal }, refs);
    }
    await authorize();
  }
  return result;
}

async function dispatchTool(
  { webSearchSettings, knowledgeSearch, checkPublication }: ToolRequestServices,
  { ownerId, conversationId, turnId }: DesktopRunScope,
  frame: DesktopToolRequest,
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
