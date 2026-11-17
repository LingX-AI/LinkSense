/** Real packaged Node, Core MCP and pinned Codex; the model endpoint is an isolated local fixture. */
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { constants, createReadStream } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import pino from "pino";
import { z } from "zod";
import { CodexJsonRpcClient } from "../../src/codex/json-rpc-client.js";
import { CODEX_SCHEMA_VERSION, type JsonRpcNotification } from "../../src/codex/protocol.js";
import { loadCodexTemplateFeatureOverrides } from "../../src/codex/template-features.js";
import { builtInMcpConfigOverrides, coreMcpEnvironmentVariables } from "../../src/codex/runtime-config-overrides.js";

const sourceRuntime = z.string().refine(path.isAbsolute).parse(process.argv[2]);
async function verifyRuntime(runtime: string, root: string): Promise<void> {
  const manifest = z.object({
    target: z.enum(["darwin/arm64", "darwin/amd64", "windows/arm64", "windows/amd64"]),
    versions: z.object({ codex: z.literal(CODEX_SCHEMA_VERSION) }),
    files: z.array(z.strictObject({
      path: z.string().regex(/^bin\/[a-z0-9.-]+$/u),
      sha256: z.string().regex(/^[a-f0-9]{64}$/u),
    })).min(3),
  }).parse(JSON.parse(await readFile(path.join(runtime, "manifest.json"), "utf8")));
  for (const file of manifest.files) {
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(path.join(runtime, file.path))) hash.update(chunk);
    assert.equal(hash.digest("hex"), file.sha256, `packaged executable changed: ${file.path}`);
  }
  const home = path.join(root, "home"), codexHome = path.join(home, ".codex"), workspace = path.join(home, "workspace");
  await mkdir(codexHome, { recursive: true });
  await mkdir(workspace);
  const featureOverrides = await loadCodexTemplateFeatureOverrides(path.join(runtime, "template"));
  let modelRequests = 0;
  const failures: unknown[] = [];
  const provider = createServer((request, response) => {
    void (async () => {
      assert.equal(request.method, "POST");
      assert(request.url?.endsWith("/responses"));
      let bytes = 0;
      for await (const chunk of request) {
        bytes += Buffer.byteLength(chunk);
        assert(bytes <= 2 * 1024 * 1024, "model fixture request exceeded its bound");
      }
      modelRequests++;
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      const item = { id: "msg_fixture", type: "message", role: "assistant", status: "completed",
        content: [{ type: "output_text", text: "DESKTOP_PACKAGE_OK", annotations: [] }] };
      for (const [type, payload] of [
        ["response.created", { response: { id: "resp_fixture", status: "in_progress", output: [] } }],
        ["response.output_item.done", { output_index: 0, item }],
        ["response.completed", { response: { id: "resp_fixture", status: "completed", output: [item],
          usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } }],
      ] as const) response.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...payload })}\n\n`);
      response.end();
    })().catch((error: unknown) => { failures.push(error); response.destroy(); });
  });
  await new Promise<void>((resolve, reject) => {
    provider.once("error", reject);
    provider.listen(0, "127.0.0.1", resolve);
  });
  const address = provider.address();
  assert(address && typeof address !== "string");
  const suffix = manifest.target.startsWith("windows") ? ".exe" : "";
  const node = path.join(runtime, "bin", `node${suffix}`);
  const core = path.join(runtime, "runner/dist/mcp/core-service-server.js");
  const coreEnvironment = Object.fromEntries(coreMcpEnvironmentVariables.flatMap(key => {
    if (key.endsWith("_ENDPOINT")) return [[key, `http://127.0.0.1:${address.port}/fixture/${key.toLowerCase()}`]];
    if (key.endsWith("_TOKEN")) return [[key, randomBytes(32).toString("hex")]];
    return [];
  }));
  coreEnvironment.LINKSENSE_CONVERSATION_ID = randomUUID();
  coreEnvironment.LINKSENSE_COLLABORATION_MODE = "default";
  const notifications: JsonRpcNotification[] = [];
  const client = new CodexJsonRpcClient({
    command: path.join(runtime, "bin", `codex${suffix}`), userHome: home, codexHome,
    logger: pino({ enabled: false }),
    extraEnvironment: coreEnvironment,
    configOverrides: [
      ...featureOverrides,
      "check_for_update_on_startup=false", 'model_provider="fixture"', 'model="gpt-5.4"',
      'model_providers.fixture.name="Fixture"', 'model_providers.fixture.wire_api="responses"',
      `model_providers.fixture.base_url="http://127.0.0.1:${address.port}/v1"`,
      "model_providers.fixture.requires_openai_auth=false", "features.memories=false",
      ...builtInMcpConfigOverrides({ command: node, args: [core] }),
      `mcp_servers.linksense_core.cwd=${JSON.stringify(workspace)}`,
      "mcp_servers.linksense_core.required=true",
      "mcp_servers.linksense_core.startup_timeout_sec=20",
    ],
  });
  client.on("notification", (notification: JsonRpcNotification) => notifications.push(notification));
  async function waitFor(check: () => boolean): Promise<void> {
    const deadline = Date.now() + 25_000;
    while (!check()) {
      assert(Date.now() < deadline, "packaged native runtime did not reach the expected state");
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  }
  try {
    await client.initialize();
    const started = z.object({ thread: z.object({ id: z.string() }) }).parse(await client.request("thread/start", {
      model: "gpt-5.4", modelProvider: "fixture", cwd: workspace, runtimeWorkspaceRoots: [workspace],
      approvalPolicy: "untrusted", sandbox: "workspace-write",
    }));
    await waitFor(() => notifications.some(notification => notification.method === "mcpServer/startupStatus/updated" &&
      z.object({ name: z.string(), status: z.string() }).parse(notification.params).name === "linksense_core" &&
      z.object({ status: z.string() }).parse(notification.params).status === "ready"));
    const catalog = await client.request("mcpServer/tool/call", {
      threadId: started.thread.id, server: "linksense_core", tool: "get_rich_output_catalog", arguments: {},
    });
    assert(JSON.stringify(catalog).includes("Panel"), "packaged Core MCP did not return its actual catalog");
    const turn = z.object({ turn: z.object({ id: z.string() }) }).parse(await client.request("turn/start", {
      threadId: started.thread.id, cwd: workspace, runtimeWorkspaceRoots: [workspace],
      input: [{ type: "text", text: "Return the fixed fixture response.", text_elements: [] }],
      approvalPolicy: "untrusted",
      sandboxPolicy: { type: "workspaceWrite", writableRoots: [workspace], networkAccess: false,
        excludeTmpdirEnvVar: true, excludeSlashTmp: true },
    }));
    await waitFor(() => notifications.some(notification => notification.method === "turn/completed" &&
      z.object({ turn: z.object({ id: z.string() }) }).parse(notification.params).turn.id === turn.turn.id));
    const completed = notifications.find(notification => notification.method === "turn/completed");
    assert.equal(z.object({ turn: z.object({ status: z.string() }) }).parse(completed?.params).turn.status, "completed");
    const saved = z.object({ thread: z.object({ turns: z.array(z.object({ id: z.string(), items: z.array(z.unknown()) })) }) })
      .parse(await client.request("thread/read", { threadId: started.thread.id, includeTurns: true }));
    const savedTurn = saved.thread.turns.find(item => item.id === turn.turn.id);
    assert(savedTurn, "the packaged native turn was not persisted");
    assert(savedTurn.items.some(item => {
      const message = z.object({ type: z.literal("agentMessage"), text: z.string() }).safeParse(item);
      return message.success && message.data.text.includes("DESKTOP_PACKAGE_OK");
    }), "the packaged native thread did not retain its model response");
    assert(modelRequests > 0, "the packaged Codex did not call the model fixture");
    assert.deepEqual(failures, []);
    console.log(JSON.stringify({ target: manifest.target, codex: CODEX_SCHEMA_VERSION,
      coreMcp: "ready", catalog: "callable", nativeTurn: "completed", providerKeys: "not_required" }));
  } finally {
    await client.close();
    await new Promise<void>((resolve, reject) => provider.close(error => error ? reject(error) : resolve()));
    assert.equal(client.isExited, true, "the packaged native process did not exit");
  }
}

const root = await mkdtemp(path.join(tmpdir(), "linksense-desktop-package-"));
try {
  const runtime = path.join(root, "runtime");
  await cp(sourceRuntime, runtime, { recursive: true, verbatimSymlinks: true, mode: constants.COPYFILE_FICLONE });
  await verifyRuntime(runtime, root);
} finally { await rm(root, { recursive: true, force: true }); }
