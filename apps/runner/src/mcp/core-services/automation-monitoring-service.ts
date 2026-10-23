import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import {
  failureToolResult,
  successToolResult,
  withRequestTimeout,
  type CoreMcpModuleDefinition,
} from "../core-service-module.js";

const tool: Tool = {
  name: "stop_scheduled_monitor",
  description:
    "Request that the scheduled monitor producing this turn stop future automatic runs because its explicitly configured stop condition is met. Finish the current work normally. Only the host-bound current scheduled run is affected; never accept an automation, user or task ID. Unavailable for ordinary tasks and manual previews. The host pauses the plan after the current turn ends; it never interrupts or retries a turn.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
};

export const automationMonitoringCoreMcpModule: CoreMcpModuleDefinition = {
  key: "automation_monitoring",
  modes: ["default"],
  toolNames: [tool.name],
  create({ environment, fetch: fetcher = globalThis.fetch }) {
    return {
      key: "automation_monitoring",
      tools: [tool],
      async callTool(input) {
        try {
          z.strictObject({}).parse(input.argumentsValue);
          const response = await fetcher(
            z.url().parse(environment.LINKSENSE_AUTOMATION_STOP_ENDPOINT),
            {
              method: "POST",
              headers: {
                authorization: `Bearer ${z.string().min(32).parse(environment.LINKSENSE_CURRENT_USER_TOKEN)}`,
                "content-type": "application/json",
              },
              body: "{}",
              signal: withRequestTimeout(input.signal, 15_000),
            },
          );
          if (!response.ok)
            return failureToolResult({
              code: "AUTOMATION_STOP_UNAVAILABLE",
              retryable: response.status >= 500,
            });
          return successToolResult(
            z
              .strictObject({ stop_requested: z.literal(true) })
              .parse(await response.json()),
          );
        } catch (error) {
          if (input.signal.aborted) throw error;
          return failureToolResult({
            code: "AUTOMATION_STOP_UNAVAILABLE",
            retryable: false,
          });
        }
      },
    };
  },
};
