/**
 * Fixture-only MCP server for the computer_use proof. It registers the real
 * source module through the existing Core registry and a fake executor; it is
 * never part of production registration.
 *
 * argv: <audit-file> <default|plan>
 */
import { appendFileSync } from "node:fs";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { runnerNativeIdSchema } from "@linksense/shared";

import type {
  CoreMcpModuleDefinition,
  CoreMcpToolModule,
} from "../../../src/mcp/core-service-module.js";
import { createCoreMcpRegistry } from "../../../src/mcp/core-service-registry.js";
import {
  createComputerUseCoreMcpModule,
  type ComputerUseExecutor,
} from "../../../src/mcp/core-services/computer-use-service.js";

const [auditPath, requestedMode] = process.argv.slice(2);
if (!auditPath || (requestedMode !== "default" && requestedMode !== "plan")) {
  throw new Error("computer fixture requires an audit path and mode");
}
const mode = requestedMode;
const target = { bundleId: "com.example.LinkSenseComputerFixture" } as const;
const audit = (entry: Record<string, unknown>) =>
  appendFileSync(auditPath, `${JSON.stringify(entry)}\n`);

let observationCount = 0;
let latest: { id: string; refs: Set<string> } | undefined;
const executor: ComputerUseExecutor = {
  async status({ target: selected, signal }) {
    signal.throwIfAborted();
    audit({ tool: "status", target: selected.bundleId });
    return {
      available: true,
      permissions: { accessibility: "granted" },
      active_grant: true,
      agent_desktop_version: "fixture-1.0",
    };
  },
  async observe({ target: selected, signal }) {
    signal.throwIfAborted();
    observationCount += 1;
    const observation = {
      observation_id: `obs-${observationCount}`,
      tree_quality: "good" as const,
      truncated: false,
      nodes: [
        { ref: "e1", role: "button", name: "Continue" },
        { ref: "e2", role: "text_field", name: "Name" },
      ],
    };
    latest = {
      id: observation.observation_id,
      refs: new Set(observation.nodes.map((node) => node.ref)),
    };
    audit({ tool: "observe", target: selected.bundleId, ...observation });
    return observation;
  },
  async act(input) {
    input.signal.throwIfAborted();
    const entry = {
      tool: "act",
      target: input.target.bundleId,
      nativeCallId: input.nativeCallId,
      observationId: input.observationId,
      ref: input.ref,
      action: input.action,
      text: input.text ?? null,
    };
    if (!latest || latest.id !== input.observationId) {
      audit({ ...entry, error: "COMPUTER_STALE_OBSERVATION" });
      return { ok: false, error: "COMPUTER_STALE_OBSERVATION", waited_ms: 0 };
    }
    if (!latest.refs.has(input.ref)) {
      audit({ ...entry, error: "COMPUTER_STALE_REF" });
      return { ok: false, error: "COMPUTER_STALE_REF", waited_ms: 0 };
    }
    if (input.action === "type" && !input.text) {
      audit({ ...entry, error: "COMPUTER_ACTION_FAILED" });
      return { ok: false, error: "COMPUTER_ACTION_FAILED", waited_ms: 0 };
    }
    audit({ ...entry, effect: "done" });
    return { ok: true, effect: "done", waited_ms: 5 };
  },
};

const tinyJpeg =
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAAA//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AN//Z";
const imageTool: Tool = {
  name: "fixture_image",
  description: "Return a synthetic tiny image through MCP content for the fixture only.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  annotations: {
    title: "Fixture image",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
};
const imageModule: CoreMcpModuleDefinition = {
  key: "fixture_image",
  modes: [mode],
  toolNames: [imageTool.name],
  create(): CoreMcpToolModule {
    return {
      key: "fixture_image",
      tools: [imageTool],
      async callTool() {
        return {
          content: [
            { type: "text", text: "FIXTURE_IMAGE" },
            { type: "image", data: tinyJpeg, mimeType: "image/jpeg" },
          ],
          isError: false,
        };
      },
    };
  },
};

const registry = createCoreMcpRegistry({
  mode,
  environment: fixtureEnvironment(mode),
  extraModules: [
    createComputerUseCoreMcpModule({ mode, target, executor }),
    imageModule,
  ],
});

const server = new Server(
  { name: "computer_fixture", version: "1.0.0" },
  {
    capabilities: { tools: {} },
    ...(registry.instructions ? { instructions: registry.instructions } : {}),
  },
);
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [...registry.tools],
}));
server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
  const callId = runnerNativeIdSchema.safeParse(request.params._meta?.callId);
  return registry.callTool({
    toolName: request.params.name,
    argumentsValue: request.params.arguments,
    ...(callId.success ? { nativeCallId: callId.data } : {}),
    signal: extra.signal,
  });
});
await server.connect(new StdioServerTransport());

function fixtureEnvironment(collaborationMode: "default" | "plan"): NodeJS.ProcessEnv {
  const token = "turn-token-00000000000000000000000000000000";
  return {
    LINKSENSE_COLLABORATION_MODE: collaborationMode,
    LINKSENSE_CONVERSATION_ID: "01900000-0000-7000-8000-000000000001",
    LINKSENSE_FILE_SERVICE_ENDPOINT: "http://127.0.0.1:9/register-artifact",
    LINKSENSE_FILE_SERVICE_TOKEN: token,
    LINKSENSE_FORM_SERVICE_ENDPOINT: "http://127.0.0.1:9/form",
    LINKSENSE_FORM_SERVICE_TOKEN: token,
    LINKSENSE_IMAGE_GENERATION_ENDPOINT: "http://127.0.0.1:9/generate",
    LINKSENSE_IMAGE_GENERATION_TOKEN: token,
    LINKSENSE_KNOWLEDGE_SEARCH_ENDPOINT: "http://127.0.0.1:9/search",
    LINKSENSE_KNOWLEDGE_SEARCH_TIMEOUT_MS: "200000",
    LINKSENSE_KNOWLEDGE_SERVICE_TOKEN: token,
    LINKSENSE_SKILL_CREATOR_ENDPOINT: "http://127.0.0.1:9/skill",
    LINKSENSE_SKILL_CREATOR_TOKEN: token,
    LINKSENSE_WEB_SEARCH_ENDPOINT: "http://127.0.0.1:9/web-search",
    LINKSENSE_WEB_SEARCH_TOKEN: "synthetic-web-search-token-000000000000000000000",
    LINKSENSE_CURRENT_USER_ENDPOINT: "http://127.0.0.1:9/current-user",
    LINKSENSE_CURRENT_USER_TOKEN: token,
  };
}
