// Run in a disposable pinned Worker image with compiled API mounted at
// /app/probe-api and this repo at /probe (read-only). Runner and MCP launchers
// come from the built image. Use its API uid 1000/task uid 1001 with the
// production setpriv ambient capabilities; no user data volumes are needed.
// Uses production publication, native plugin installation and the real task UID.
// The model endpoint is a loopback fixture; no account data or external API calls.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { UserHomeCapabilityMaterializer } from "/app/probe-api/modules/capabilities/user-home-materializer.js";
import { WorkspaceManager } from "/app/dist/workspace/workspace-manager.js";
import { CapabilityRuntimeManager } from "/app/dist/workspace/capability-runtime.js";
import { NativePluginManager } from "/app/dist/codex/native-plugin-manager.js";
import { CodexJsonRpcClient } from "/app/dist/codex/json-rpc-client.js";
import { CODEX_SCHEMA_VERSION } from "/app/dist/codex/protocol.js";
import { buildTurnInput, buildTurnAdditionalContext } from "/app/dist/context.js";
import { loadCodexTemplateFeatureOverrides } from "/app/dist/codex/template-features.js";
import { linkSenseSkillConfigOverrides } from "/app/dist/codex/runtime-config-overrides.js";
import { prepareCodexAdditionalContext } from "/app/dist/codex/additional-context.js";
import { ConnectionRuntimePlugins } from "/app/probe-api/modules/connections/runtime-plugins.js";
import { activePluginNames, connectionPluginConfigOverrides } from "/app/dist/codex/connection-plugin-policy.js";
import pino from "/app/node_modules/pino/pino.js";

const exec = promisify(execFile);
const root = await mkdtemp("/tmp/linksense-microsoft-plugin-");
await chmod(root, 0o770);
const identity = { uid: 1001, gid: 1000 };
const ownerId = randomUUID();
const requirementsPath = "/etc/codex/requirements.toml";
const requirements = await readFile(requirementsPath, "utf8");
const template = "/probe/deploy/codex-home-template";
const clients = new Set();
const captures = [];
let nextToolCall;
const checks = [];
const logger = pino({ enabled: false });
const materializer = new UserHomeCapabilityMaterializer({ userDataRoot: path.join(root, "users") });
const workspace = new WorkspaceManager(path.join(root, "users"), template, {
  directoryCleanupIdentity: identity, managedCodexFileIdentity: identity,
});
const runtime = new CapabilityRuntimeManager({ apiIdentity: { uid: 1000, gid: 1000 }, taskIdentity: identity });
const native = new NativePluginManager();
const model = "gpt-5.4";
const server = createServer(async (req, res) => {
  try {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    if (req.url === "/execute") {
      assert.equal(req.headers.authorization, "Bearer connection-smoke-token-with-32-characters");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ kind: "connections", items: [] }));
      return;
    }
    captures.push(body);
    const id = `resp_fixture_${captures.length}`;
    const item = nextToolCall
      ? { id: `fc_fixture_${captures.length}`, type: "function_call", call_id: `call_fixture_${captures.length}`, ...nextToolCall }
      : { id: `msg_fixture_${captures.length}`, type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: "FIXTURE_OK", annotations: [] }] };
    nextToolCall = undefined;
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    const emit = (type, value) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...value })}\n\n`);
    emit("response.created", { response: { id, object: "response", status: "in_progress", output: [] } });
    emit("response.output_item.done", { output_index: 0, item });
    emit("response.completed", { response: { id, object: "response", status: "completed", output: [item], usage: { input_tokens: 10, output_tokens: 1, total_tokens: 11 } } });
    res.end();
  } catch (error) { res.writeHead(500); res.end(String(error)); }
});
function check(name, condition) { checks.push({ name, passed: !!condition }); console.log(JSON.stringify(checks.at(-1))); }
async function put(file, contents) { await mkdir(path.dirname(file), { recursive: true, mode: 0o750 }); await writeFile(file, contents, { mode: 0o640 }); }
function skill(name, version) { return `---\nname: ${name}\ndescription: CONTEXT_DESCRIPTION_${name}_${version}. Read the usage instructions before using this capability.\n---\n\nCONTEXT_BODY_${name}_${version}\nRead references/usage.md for the synthetic operation.\n`; }
async function prepare(taskId, capabilities) {
  const publication = await materializer.reconcile({ ownerId, conversationId: taskId, capabilities });
  workspace.bindOwner(taskId, ownerId);
  const paths = await workspace.ensureConversation(taskId, "capability-context-smoke");
  const lease = await runtime.acquireLease({ controlRoot: paths.ownerControl, expectedGeneration: publication.generation });
  try {
    const prepared = await runtime.resolvePublished({ userHome: paths.home, controlRoot: paths.ownerControl, expectedGeneration: publication.generation, capabilities, lockHeld: true, reuseImmutableSnapshot: true });
    const pluginNames = capabilities.filter(c => c.type === "plugin").map(c => c.name);
    await native.reconcileBeforeStart({ command: "codex", userHome: paths.home, codexHome: paths.codexHome, workspace: paths.workspace, capabilityControl: prepared.capabilityControl, expectedGeneration: publication.generation, pluginContentDigest: prepared.pluginContentDigest, pluginNames, lockHeld: true, processIdentity: identity });
    return { paths, pluginNames, capabilities };
  } finally { await lease.release(); }
}
async function connect(task, { mode = "default" } = {}) {
  const config = [
    ...await loadCodexTemplateFeatureOverrides(template),
    ...linkSenseSkillConfigOverrides(mode),
    "features.memories=false", "features.multi_agent=false", "features.hooks=false",
    "model_provider=\"fixture\"", `model=${JSON.stringify(model)}`,
    "model_providers.fixture.name=\"Fixture\"", "model_providers.fixture.wire_api=\"responses\"",
    `model_providers.fixture.base_url=\"http://127.0.0.1:${server.address().port}/v1\"`,
    "model_providers.fixture.requires_openai_auth=false",
    ...connectionPluginConfigOverrides(task.capabilities, mode),
  ];
  const client = new CodexJsonRpcClient({ command: "codex", userHome: task.paths.home, codexHome: task.paths.codexHome, logger, processIdentity: identity, configOverrides: config,
    extraEnvironment: { LINKSENSE_COLLABORATION_MODE: mode, LINKSENSE_CONNECTION_ENDPOINT: `http://127.0.0.1:${server.address().port}/execute`, LINKSENSE_CONNECTION_TOKEN: "connection-smoke-token-with-32-characters" },
  });
  clients.add(client);
  await client.initialize();
  const allowedPluginNames = activePluginNames(task.capabilities, mode);
  const plugins = mode === "plan" && !allowedPluginNames.length ? [] : await native.verifyAfterStart({ client, userHome: task.paths.home, codexHome: task.paths.codexHome, workspace: task.paths.workspace, pluginNames: allowedPluginNames });
  const result = await client.request("skills/list", { cwds: [task.paths.workspace], forceReload: true });
  const skills = result.data[0].skills.filter(s => s.enabled);
  assert.equal(result.data[0].errors.length, 0);
  return { client, skills, plugins, task, mode };
}
async function thread(session, threadId) {
  const result = await session.client.request(threadId ? "thread/resume" : "thread/start", {
    ...(threadId ? { threadId } : {}), cwd: session.task.paths.workspace,
    model, modelProvider: "fixture", approvalPolicy: "never", sandbox: "danger-full-access",
  });
  return result.thread.id;
}
async function turn(session, threadId, selection = {}, planReferences = []) {
  const context = { userInput: "Use the selected capability.", attachments: [], priorityPlugins: [], prioritySkills: [], ...selection };
  const refs = {
    plugins: session.plugins.filter(p => context.priorityPlugins.some(s => s.name === p.name)).map(p => ({ name: p.name, path: p.mentionPath })),
    skills: session.skills.filter(s => context.prioritySkills.some(p => p.name === s.name) || (context.selectedKnowledgeBases?.length && s.name === "linksense-knowledge-base")),
  };
  const before = captures.length;
  const completion = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { session.client.off("notification", listener); reject(new Error("native turn timeout")); }, 20000);
    const listener = n => { if (n.method === "turn/completed") { clearTimeout(timer); session.client.off("notification", listener); resolve(n.params.turn); } };
    session.client.on("notification", listener);
  });
  // Observe rejection even when turn/start itself fails first.
  void completion.catch(() => undefined);
  await session.client.request("turn/start", {
    threadId, input: [{ type: "text", text: buildTurnInput(context, refs, session.mode), text_elements: [] }],
    additionalContext: prepareCodexAdditionalContext(buildTurnAdditionalContext(context, session.skills, session.mode, planReferences)),
    collaborationMode: { mode: session.mode, settings: { model, reasoning_effort: "low", developer_instructions: null } },
  });
  assert.equal((await completion).status, "completed");
  const capture = captures.slice(before).at(-1);
  assert(capture, "model request must be captured");
  return capture.input.filter(i => i.type === "message").flatMap(i => i.content ?? []).map(c => c.text ?? "").join("\n");
}
async function close(session) { await session.client.close(); clients.delete(session.client); }
try {
  assert.equal(process.getuid(), 1000); assert.equal(process.getgid(), 1000);
  assert.equal((await exec("codex", ["--version"])).stdout.trim(), `codex-cli ${CODEX_SCHEMA_VERSION}`);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  await materializer.ensureOwner(ownerId);
  const owner = await workspace.ensureOwner(ownerId);
  // Disposable test container: apply the same marketplace restriction to the
  // fixture home. Production mounts the authorized home at /home/linksense.
  await writeFile(requirementsPath, requirements.replace('path = "/home/linksense"', `path = ${JSON.stringify(owner.home)}`));
  await symlink(path.join(root, "users", ownerId, "managed/agents"), path.join(owner.home, ".agents"));
  const pluginSource = path.join(root, "plugin-source");
  const mcpFixture = `
import { McpServer } from "/app/node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.js";
import { StdioServerTransport } from "/app/node_modules/@modelcontextprotocol/sdk/dist/esm/server/stdio.js";
const server = new McpServer({ name: "context-documents", version: "1.0.0" });
server.registerTool("read_fixture", { description: "CONTEXT_MCP_DESCRIPTION: read synthetic fixture data", inputSchema: {}, annotations: { readOnlyHint: true } }, async () => ({ content: [{ type: "text", text: "CONTEXT_MCP_EXECUTED " + (process.env.HOME === ${JSON.stringify(owner.home)} ? "SHARED_HOME_OK" : "WRONG_HOME") }] }));
await server.connect(new StdioServerTransport());
`;
  await put(path.join(pluginSource, ".codex-plugin/plugin.json"), JSON.stringify({
    name: "context-office", version: "1.0.0", skills: "./skills",
    mcpServers: { documents: { command: "node", args: ["--input-type=module", "-e", mcpFixture] } },
  }));
  await put(path.join(pluginSource, "skills/documents/SKILL.md"), skill("documents", "ONE"));
  await put(path.join(pluginSource, "skills/documents/references/usage.md"), "CONTEXT_REFERENCE_ONE");
  await put(path.join(pluginSource, "scripts/probe.mjs"), 'process.stdout.write("WORKSPACE_PLUGIN_SCRIPT_OK\\n");');
  const standaloneSource = path.join(root, "standalone-source");
  await put(path.join(standaloneSource, "SKILL.md"), skill("context-standalone", "ONE"));
  await put(path.join(standaloneSource, "scripts/probe.mjs"), 'process.stdout.write("WORKSPACE_SKILL_SCRIPT_OK\\n");');
  const capabilities = [
    { id: randomUUID(), name: "context-office", type: "plugin", revision: "one", sourcePath: pluginSource },
    { id: randomUUID(), name: "context-standalone", type: "skill", revision: "one", sourcePath: standaloneSource },
  ];
  const connectionCatalog = new ConnectionRuntimePlugins({ listAvailableProviders: async () => ["onedrive", "sharepoint"] });
  const connectionCapabilities = await connectionCatalog.resolve(ownerId);
  const connectedTaskId = randomUUID();
  const connectedTask = await prepare(connectedTaskId, connectionCapabilities);
  const connected = await connect(connectedTask);
  const connectedId = await thread(connected);
  await turn(connected, connectedId);
  const initialTools = JSON.stringify(captures.at(-1).tools);
  check("connected Microsoft tools are deferred instead of sending all schemas initially", !initialTools.includes("expected_etag"));
  const connectedStatus = await connected.client.request("mcpServerStatus/list", { threadId: connectedId, detail: "toolsAndAuthOnly", limit: 100 });
  const filesServer = connectedStatus.data.find(s => s.tools.read_files);
  check("official plugin exposes Microsoft read and write tools", !!filesServer?.tools.write_files);
  assert(filesServer);
  nextToolCall = { type: "tool_search_call", execution: "client", arguments: { query: "OneDrive SharePoint write_files update files", limit: 5 } };
  await turn(connected, connectedId);
  check("Microsoft tool schemas become available through native tool search", JSON.stringify(captures.at(-1)).includes("expected_etag"));
  const connectionResult = await connected.client.request("mcpServer/tool/call", { threadId: connectedId, server: filesServer.name, tool: "read_files", arguments: { operation: "list_connections" } });
  check("official plugin calls the task-bound connection service", JSON.stringify(connectionResult).includes("connections"));
  await close(connected);
  const disconnectedTask = await prepare(connectedTaskId, []);
  const disconnected = await connect(disconnectedTask);
  await thread(disconnected, connectedId);
  const disconnectedStatus = await disconnected.client.request("mcpServerStatus/list", { threadId: connectedId, detail: "toolsAndAuthOnly", limit: 100 });
  check("next task process removes Microsoft tools after disconnect", !disconnectedStatus.data.some(s => s.tools.read_files || s.tools.write_files));
  await close(disconnected);
  const planConnectedTask = await prepare(randomUUID(), [...capabilities, ...connectionCapabilities]);
  const planConnected = await connect(planConnectedTask, { mode: "plan" });
  const planConnectedId = await thread(planConnected);
  const planConnectedStatus = await planConnected.client.request("mcpServerStatus/list", { threadId: planConnectedId, detail: "toolsAndAuthOnly", limit: 100 });
  check("Plan permits only the official Microsoft read tool and keeps personal plugins disabled", planConnectedStatus.data.some(s => s.tools.read_files) && !planConnectedStatus.data.some(s => s.tools.write_files || s.tools.read_fixture));
  console.log(JSON.stringify({ codexVersion: CODEX_SCHEMA_VERSION, checks }));
  if (checks.some(c => !c.passed)) process.exitCode = 1;
} finally {
  for (const client of clients) await client.close();
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  await writeFile(requirementsPath, requirements);
  await rm(root, { recursive: true, force: true });
}
