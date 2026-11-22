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
import {
  runnerNativeIdSchema,
  type ComputerObservation,
} from "@linksense/shared";

import type {
  CoreMcpModuleDefinition,
  CoreMcpToolModule,
} from "../../../src/mcp/core-service-module.js";
import { createCoreMcpRegistry } from "../../../src/mcp/core-service-registry.js";
import {
  createComputerUseCoreMcpModule,
  type ComputerUseExecutor,
} from "../../../src/mcp/core-services/computer-use-service.js";
import { computerFixtureEnvironment } from "./fixture-environment.js";

const [auditPath, requestedMode] = process.argv.slice(2);
if (!auditPath || (requestedMode !== "default" && requestedMode !== "plan")) {
  throw new Error("computer fixture requires an audit path and mode");
}
const mode = requestedMode;
const audit = (entry: Record<string, unknown>) =>
  appendFileSync(auditPath, `${JSON.stringify(entry)}\n`);

/** Synthetic 2x3 PNG; 74 decoded bytes. */
const fallbackPng =
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAYAAAC56t6BAAAAEUlEQVR4nGPgEpH7D8IMGAwAWwsHY6MDm74AAAAASUVORK5CYII=";
/** Signature, IHDR and dimensions survive; IDAT pixel data does not. */
const truncatedPng = Buffer.from(fallbackPng, "base64").subarray(0, 50).toString("base64");

function observeScenario(count: number): ComputerObservation {
  const goodNodes = [
    { ref: "e1", role: "button", name: "Continue" },
    { ref: "e2", role: "text_field", name: "Name" },
  ];
  if (count === 3) {
    return {
      observation_id: "obs-3",
      tree_quality: "unusable",
      truncated: false,
      nodes: [],
      screenshot: {
        mime_type: "image/png",
        data_base64: fallbackPng,
        width: 2,
        height: 3,
      },
    };
  }
  if (count === 4) {
    return {
      observation_id: "obs-4",
      tree_quality: "good",
      truncated: false,
      nodes: goodNodes,
      screenshot: {
        mime_type: "image/png",
        data_base64: fallbackPng,
        width: 2,
        height: 3,
      },
    };
  }
  if (count === 5) {
    return {
      observation_id: "obs-5",
      tree_quality: "unusable",
      truncated: false,
      nodes: [],
      screenshot: {
        mime_type: "image/png",
        data_base64: truncatedPng,
        width: 2,
        height: 3,
      },
    };
  }
  if (count === 6) {
    return {
      observation_id: "obs-6",
      tree_quality: "partial",
      truncated: true,
      nodes: [{ ref: "e3", role: "button", name: "Canvas" }],
      screenshot: {
        mime_type: "image/jpeg",
        data_base64: tinyJpeg,
        width: 1,
        height: 1,
      },
    };
  }
  return {
    observation_id: `obs-${count}`,
    tree_quality: "good",
    truncated: false,
    nodes: goodNodes,
  };
}

let observationCount = 0;
let latest: { id: string; refs: Set<string> } | undefined;
const executor: ComputerUseExecutor = {
  async status({ signal }) {
    signal.throwIfAborted();
    audit({ tool: "status" });
    return {
      available: true,
      permissions: { accessibility: "granted" },
      active_grant: true,
      agent_desktop_version: "fixture-1.0",
    };
  },
  async observe({ signal }) {
    signal.throwIfAborted();
    observationCount += 1;
    const observation = observeScenario(observationCount);
    latest = {
      id: observation.observation_id,
      refs: new Set(observation.nodes.map((node) => node.ref)),
    };
    // Metadata only: fixture audit never carries screenshot bytes or proof.
    audit({
      tool: "observe",
      observation_id: observation.observation_id,
      tree_quality: observation.tree_quality,
      truncated: observation.truncated,
      node_count: observation.nodes.length,
    });
    return observation;
  },
  async act(input) {
    input.signal.throwIfAborted();
    const entry = {
      tool: "act",
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
  environment: computerFixtureEnvironment(mode),
  extraModules: [
    createComputerUseCoreMcpModule({ mode, executor, screenshots: true }),
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
