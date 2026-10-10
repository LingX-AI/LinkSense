/**
 * Pinned Codex with real MCP processes and a local model fixture; no API key required.
 * CODEX_BIN=/path/to/pinned/codex pnpm --filter @linksense/runner exec tsx test/functional/mcp-startup.ts
 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import pino from "pino";
import { z } from "zod";
import { CodexJsonRpcClient } from "../../src/codex/json-rpc-client.js";
import { CODEX_SCHEMA_VERSION, type JsonRpcNotification } from "../../src/codex/protocol.js";
import { builtInMcpConfigOverrides } from "../../src/codex/runtime-config-overrides.js";
import { assertCodexRuntimeVersion } from "../../src/codex/runtime-version.js";
import { planRuntimeConfigOverrides } from "../../src/process-pool.js";

const command = process.env.CODEX_BIN?.trim() || "codex";
await assertCodexRuntimeVersion({ command });
const require = createRequire(import.meta.url);
const results: Array<Record<string, unknown>> = [];
for (const mode of ["default", "plan"] as const) {
  const root = await mkdtemp(join(tmpdir(), "linksense-mcp-startup-"));
  const codexHome = join(root, ".codex");
  const workspace = join(root, "workspace");
  await mkdir(codexHome);
  await mkdir(workspace);
  const fixture = join(root, "mcp.mjs");
  await writeFile(fixture, `
    import { McpServer } from ${JSON.stringify(pathToFileURL(require.resolve("@modelcontextprotocol/sdk/server/mcp.js")).href)};
    import { StdioServerTransport } from ${JSON.stringify(pathToFileURL(require.resolve("@modelcontextprotocol/sdk/server/stdio.js")).href)};
    const server = new McpServer({name: 'healthy', version: '1.0.0'});
    server.registerTool('ping', {description: 'Return a fixed test response', inputSchema: {}}, async () => ({content: [{type: 'text', text: 'MCP_OK'}]}));
    await server.connect(new StdioServerTransport());
  `);
  const provider = createServer(async (request, response) => {
    for await (const chunk of request) void chunk;
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    const item = { id: "msg_fixture", type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: "OK", annotations: [] }] };
    for (const [type, payload] of [
      ["response.created", { response: { id: "resp_fixture", status: "in_progress", output: [] } }],
      ["response.output_item.done", { output_index: 0, item }],
      ["response.completed", { response: { id: "resp_fixture", status: "completed", output: [item], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } }],
    ] as const) response.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...payload })}\n\n`);
    response.end();
  });
  await new Promise<void>((resolve) => provider.listen(0, "127.0.0.1", resolve));
  const address = provider.address();
  assert(address && typeof address !== "string");
  const notifications: JsonRpcNotification[] = [];
  const overrides = [
    'model_provider="fixture"', 'model="gpt-5.4"',
    'model_providers.fixture.name="Fixture"',
    'model_providers.fixture.wire_api="responses"',
    `model_providers.fixture.base_url="http://127.0.0.1:${address.port}/v1"`,
    "model_providers.fixture.requires_openai_auth=false",
    "features.memories=false",
    ...builtInMcpConfigOverrides({ command: process.execPath, args: ["-e", "process.exit(1)"], managedBrowserArgs: ["-e", "process.exit(1)"] }),
    ...planRuntimeConfigOverrides(mode),
    `mcp_servers.healthy.command=${JSON.stringify(process.execPath)}`,
    `mcp_servers.healthy.args=${JSON.stringify([fixture])}`,
    "mcp_servers.healthy.required=false",
    `mcp_servers.pending.command=${JSON.stringify(process.execPath)}`,
    'mcp_servers.pending.args=["-e","process.stdin.resume()"]',
    "mcp_servers.pending.required=false",
    "mcp_servers.pending.startup_timeout_sec=15",
  ];
  let client: CodexJsonRpcClient | undefined;
  const connect = async (): Promise<CodexJsonRpcClient> => {
    const connected = new CodexJsonRpcClient({ command, userHome: root, codexHome, logger: pino({ enabled: false }), configOverrides: overrides });
    client = connected;
    connected.on("notification", (notification: JsonRpcNotification) => notifications.push(notification));
    await connected.initialize();
    return connected;
  };
  const waitFor = async (check: () => boolean): Promise<void> => {
    const deadline = Date.now() + 20_000;
    while (!check()) {
      assert(Date.now() < deadline, "native notification timed out");
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  };
  try {
    let active = await connect();
    const start = performance.now();
    const started = z.object({ thread: z.object({ id: z.string() }) }).parse(await active.request("thread/start", {
      cwd: workspace, model: "gpt-5.4", modelProvider: "fixture", approvalPolicy: "never", sandbox: "read-only",
    }));
    const startMs = Math.round(performance.now() - start);
    assert(startMs < 10_000, "thread/start waited for the pending MCP timeout");
    const turn = performance.now();
    await active.request("turn/start", {
      threadId: started.thread.id,
      input: [{ type: "text", text: "Say OK", text_elements: [] }],
      collaborationMode: { mode, settings: { model: "gpt-5.4", reasoning_effort: "low", developer_instructions: null } },
    });
    await waitFor(() => notifications.some((notification) => notification.method === "turn/completed"));
    const turnMs = Math.round(performance.now() - turn);
    const completed = notifications.find((notification) => notification.method === "turn/completed");
    assert.equal(z.object({ turn: z.object({ status: z.string() }) }).parse(completed?.params).turn.status, "completed");
    assert(turnMs < 10_000, "turn completion waited for the pending MCP timeout");
    const statuses = notifications.filter((notification) => notification.method === "mcpServer/startupStatus/updated")
      .map((notification) => z.object({ name: z.string(), status: z.string() }).parse(notification.params));
    assert(statuses.some((status) => status.name === "linksense_core" && status.status === "failed"));
    assert(!statuses.some((status) => status.name === "pending" && status.status === "failed"), "the pending server must still be connecting when the turn completes");
    if (mode === "plan") assert(statuses.some((status) => status.name === "linksense_managed_browser" && status.status === "failed"));
    const ping = await active.request("mcpServer/tool/call", { threadId: started.thread.id, server: "healthy", tool: "ping", arguments: {} });
    assert(JSON.stringify(ping).includes("MCP_OK"), "healthy tools remain callable");
    await active.close();
    active = await connect();
    const resume = performance.now();
    const resumed = z.object({ thread: z.object({ id: z.string() }) }).parse(await active.request("thread/resume", {
      threadId: started.thread.id, cwd: workspace, model: "gpt-5.4", modelProvider: "fixture", approvalPolicy: "never", sandbox: "read-only",
    }));
    assert.equal(resumed.thread.id, started.thread.id);
    const resumeMs = Math.round(performance.now() - resume);
    assert(resumeMs < 10_000, "thread/resume waited for the pending MCP timeout");
    results.push({ mode, startMs, turnMs, resumeMs, healthyTool: "callable", failedCore: "unavailable", pendingMcp: "non-blocking" });
  } finally {
    await client?.close();
    await new Promise<void>((resolve, reject) => provider.close((error) => error ? reject(error) : resolve()));
    await rm(root, { recursive: true, force: true });
  }
}
console.log(JSON.stringify({ version: CODEX_SCHEMA_VERSION, results }));
