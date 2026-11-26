import {
  desktopCloudToolPingInputSchema,
  desktopCloudToolPingResultSchema,
  localToolsPingToolName,
} from "@linksense/shared";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import {
  failureToolResult,
  successToolResult,
  withRequestTimeout,
  type CoreMcpModuleDefinition,
} from "../core-service-module.js";

export const localToolsPingTool: Tool = {
  name: localToolsPingToolName,
  description:
    "Check the local tool lane on the signed-in Mac. Returns the Mac platform and app version and echoes a short message. The Mac must be online and the task must have local tools enabled; otherwise the call fails closed. This read-only check changes nothing on the Mac.",
  inputSchema: {
    type: "object",
    properties: {
      message: { type: "string", minLength: 1, maxLength: 200 },
    },
    required: ["message"],
    additionalProperties: false,
  },
  annotations: {
    title: "Check local tools",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
};

/**
 * Registers the cloud local-tool lane only for a worker whose task explicitly
 * enabled it. The API supplies the endpoint/token environment at start.
 */
export function localToolsCoreMcpModules(input: {
  environment: Readonly<NodeJS.ProcessEnv>;
}): readonly CoreMcpModuleDefinition[] {
  if (!input.environment.LINKSENSE_LOCAL_TOOLS_ENDPOINT ||
      !input.environment.LINKSENSE_LOCAL_TOOLS_TOKEN) {
    return [];
  }
  return [{
    key: "local_tools",
    modes: ["default"],
    toolNames: [localToolsPingToolName],
    create({ environment, fetch: requestFetch = globalThis.fetch }) {
      const endpoint = z.url().parse(environment.LINKSENSE_LOCAL_TOOLS_ENDPOINT);
      const token = z.string().min(32).parse(environment.LINKSENSE_LOCAL_TOOLS_TOKEN);
      return {
        key: "local_tools",
        tools: [localToolsPingTool],
        async callTool(call) {
          try {
            call.signal.throwIfAborted();
            const ping = desktopCloudToolPingInputSchema.parse(call.argumentsValue);
            const response = await requestFetch(endpoint, {
              method: "POST",
              headers: {
                authorization: `Bearer ${token}`,
                "content-type": "application/json",
              },
              body: JSON.stringify({ input: ping }),
              signal: withRequestTimeout(call.signal, 12_000),
            });
            const result: unknown = await response.json();
            if (!response.ok) {
              return failureToolResult({
                code: response.status === 403
                  ? "DESKTOP_TOOL_ACCESS_DENIED"
                  : "DESKTOP_TOOL_UNAVAILABLE",
                retryable: response.status >= 500,
              });
            }
            const parsed = desktopCloudToolPingResultSchema.safeParse(result);
            return parsed.success
              ? successToolResult(parsed.data)
              : failureToolResult({
                  code: "DESKTOP_TOOL_RESPONSE_INVALID",
                  retryable: false,
                });
          } catch (error) {
            if (call.signal.aborted) throw error;
            return failureToolResult({
              code: error instanceof z.ZodError
                ? "DESKTOP_TOOL_INVALID"
                : "DESKTOP_TOOL_UNAVAILABLE",
              retryable: !(error instanceof z.ZodError),
            });
          }
        },
      };
    },
  }];
}
