import {
  desktopExecutionMaxFrameBytes, desktopToolResultSchema, webSearchFailureCodeSchema, webSearchSuccessSchema,
  type DesktopToolRequest,
} from "@linksense/shared";
import type { z } from "zod";
import { AppError } from "../../lib/errors.js";
import type { AuditService } from "../audit/service.js";
import type { DesktopRunLeases, DesktopRunScope } from "../desktop-credentials/run-leases.js";
import type { WebSearchSettingsService } from "../system/web-search-settings.js";

type ToolResult = z.infer<typeof desktopToolResultSchema>;
type ToolRequestServices = {
  leases: Pick<DesktopRunLeases, "verifyRunBinding" | "claimToolRequest">;
  audit: Pick<AuditService, "write">;
  webSearchSettings: Pick<WebSearchSettingsService, "search">;
};

export async function executeDesktopTool(
  services: ToolRequestServices, scope: DesktopRunScope, frame: DesktopToolRequest, signal: AbortSignal,
): Promise<ToolResult> {
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
  let result: ToolResult;
  try {
    await authorize();
    const { ownerId, conversationId, turnId } = scope;
    const data = webSearchSuccessSchema.parse(await services.webSearchSettings.search({
      ownerId, conversationId, turnId, request: frame.body, signal,
    }));
    await authorize();
    result = desktopToolResultSchema.parse({ ...base, ok: true, data });
    if (Buffer.byteLength(JSON.stringify(result)) > desktopExecutionMaxFrameBytes) {
      result = { ...base, ok: false, error_code: "WEB_SEARCH_RESPONSE_INVALID" };
    }
  } catch (error) {
    const code = webSearchFailureCodeSchema.safeParse(error instanceof AppError ? error.code : undefined);
    result = {
      ...base, ok: false,
      error_code: code.success ? code.data : error instanceof AppError && ["AUTH_REQUIRED", "FORBIDDEN"].includes(error.code)
        ? "FORBIDDEN" : "RUNNER_OPERATION_UNCERTAIN",
    };
  }
  try {
    await services.audit.write({
      actorId: scope.ownerId, action: "desktop_tool_requested", targetId: frame.id, targetType: "web_search",
      result: result.ok ? "success" : "failed",
      metadata: {
        operation: frame.operation, conversation_id: scope.conversationId, turn_id: scope.turnId, device_id: scope.deviceId,
        ...(result.ok ? {} : { reason_code: result.error_code }),
      },
    });
  } catch {
    return { ...base, ok: false, error_code: "RUNNER_OPERATION_UNCERTAIN" };
  }
  if (result.ok) await authorize();
  return result;
}
