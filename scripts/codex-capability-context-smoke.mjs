// Run in the pinned Worker image with compiled API/Runner mounted at
// /app/probe-api and /app/probe-runner, and this repo at /probe (read-only).
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
import { WorkspaceManager } from "/app/probe-runner/workspace/workspace-manager.js";
import { CapabilityRuntimeManager } from "/app/probe-runner/workspace/capability-runtime.js";
import { NativePluginManager } from "/app/probe-runner/codex/native-plugin-manager.js";
import { CodexJsonRpcClient } from "/app/probe-runner/codex/json-rpc-client.js";
import { CODEX_SCHEMA_VERSION } from "/app/probe-runner/codex/protocol.js";
import { buildTurnInput, buildTurnAdditionalContext } from "/app/probe-runner/context.js";
import { loadCodexTemplateFeatureOverrides } from "/app/probe-runner/codex/template-features.js";
import { linkSenseSkillConfigOverrides } from "/app/probe-runner/codex/runtime-config-overrides.js";
import { prepareCodexAdditionalContext } from "/app/probe-runner/codex/additional-context.js";
import { isolatedChildInvocation } from "/app/probe-runner/child-process-isolation.js";
import pino from "/app/node_modules/pino/pino.js";

const exec = promisify(execFile);
const root = await mkdtemp("/tmp/linksense-capability-context-");
await chmod(root, 0o770);
const identity = { uid: 1001, gid: 1000 };
const ownerId = randomUUID();
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
  const lease = await runtime.acquireLease({ controlRoot: paths.control, expectedGeneration: publication.generation });
  try {
    const prepared = await runtime.resolvePublished({ taskHome: paths.taskHome, controlRoot: paths.control, expectedGeneration: publication.generation, capabilities, lockHeld: true, reuseImmutableSnapshot: true });
    const pluginNames = capabilities.filter(c => c.type === "plugin").map(c => c.name);
    await native.reconcileBeforeStart({ command: "codex", userHome: paths.home, codexHome: paths.codexHome, workspace: paths.workspace, capabilityControl: prepared.capabilityControl, expectedGeneration: publication.generation, pluginContentDigest: prepared.pluginContentDigest, pluginNames, lockHeld: true, processIdentity: identity });
    return { paths, pluginNames };
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
    ...(mode === "plan" ? ["features.plugins=false"] : []),
  ];
  const client = new CodexJsonRpcClient({ command: "codex", userHome: task.paths.home, codexHome: task.paths.codexHome, logger, processIdentity: identity, configOverrides: config });
  clients.add(client);
  await client.initialize();
  const plugins = mode === "plan" ? [] : await native.verifyAfterStart({ client, userHome: task.paths.home, codexHome: task.paths.codexHome, workspace: task.paths.workspace, pluginNames: task.pluginNames });
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
  const taskId = randomUUID();
  const task = await prepare(taskId, capabilities);
  // Existing task configs from the faulty release must also be corrected by
  // runtime overrides; no in-place rewrite or permission changes are required.
  const configFile = path.join(task.paths.codexHome, "config.toml");
  const persistedConfig = (await readFile(configFile, "utf8")).replace("include_instructions = true", "include_instructions = false");
  await writeFile(configFile, persistedConfig);
  let session = await connect(task);
  const id = await thread(session);
  const pluginSelection = { priorityPlugins: [{ name: "context-office" }] };
  const pluginInput = await turn(session, id, pluginSelection);
  check("selected plugin exposes its skill description and locator to the model", pluginInput.includes("CONTEXT_DESCRIPTION_documents_ONE") && pluginInput.includes("/skills/documents/SKILL.md"));
  check("unselected authorized standalone skill is discoverable", pluginInput.includes("CONTEXT_DESCRIPTION_context-standalone_ONE"));
  check("native model receives workspace-first resource rules with this task's actual authorized paths", pluginInput.includes("First locate bundled Plugin and Skill resources") && pluginInput.includes(path.join(task.paths.workspace, ".agents/plugin-sources")) && pluginInput.includes("the SKILL.md actually loaded for this turn") && pluginInput.includes("Never relocate credentials"));
  const status = await session.client.request("mcpServerStatus/list", { threadId: id, detail: "toolsAndAuthOnly", limit: 100 });
  const pluginServer = status.data.find(s => s.tools.read_fixture);
  assert(pluginServer);
  nextToolCall = { type: "tool_search_call", execution: "client", arguments: { query: "context-office documents read fixture", limit: 5 } };
  await turn(session, id, pluginSelection);
  check("native tool search exposes deferred plugin tools with their usage schema", JSON.stringify(captures.at(-1)).includes("CONTEXT_MCP_DESCRIPTION"));
  const mcpResult = await session.client.request("mcpServer/tool/call", { threadId: id, server: pluginServer.name, tool: "read_fixture", arguments: {} });
  check("native plugin MCP tool executes successfully", JSON.stringify(mcpResult).includes("CONTEXT_MCP_EXECUTED"));
  check("native plugin MCP inherits the shared execution user's HOME", JSON.stringify(mcpResult).includes("SHARED_HOME_OK"));
  const explicit = await turn(session, id, { prioritySkills: [{ name: "context-standalone" }] });
  check("explicit standalone Skill loads full instructions natively", explicit.includes("CONTEXT_BODY_context-standalone_ONE"));
  const pluginSkill = session.skills.find(s => s.name === "context-office:documents");
  const invocation = isolatedChildInvocation(process.execPath, ["-e", "process.stdout.write(require('node:fs').readFileSync(process.argv[1], 'utf8'))", pluginSkill.path], identity);
  check("native task identity can read plugin instructions", (await exec(invocation.command, invocation.args)).stdout.includes("CONTEXT_BODY_documents_ONE"));
  const referenceInvocation = isolatedChildInvocation(process.execPath, ["-e", "process.stdout.write(require('node:fs').readFileSync(process.argv[1], 'utf8'))", path.join(path.dirname(pluginSkill.path), "references/usage.md")], identity);
  check("plugin relative references are readable by the task UID", (await exec(referenceInvocation.command, referenceInvocation.args)).stdout === "CONTEXT_REFERENCE_ONE");
  nextToolCall = { name: "exec_command", arguments: JSON.stringify({ cmd: `cat '${pluginSkill.path}' '${path.join(path.dirname(pluginSkill.path), "references/usage.md")}'`, max_output_tokens: 1000 }) };
  await turn(session, id, pluginSelection);
  const toolOutputs = JSON.stringify(captures.at(-1).input.filter(item => item.type === "function_call_output"));
  check("native model tool execution can read the plugin workflow and its relative reference", toolOutputs.includes("CONTEXT_BODY_documents_ONE") && toolOutputs.includes("CONTEXT_REFERENCE_ONE"));
  const workspacePluginScript = path.join(task.paths.workspace, ".agents/plugin-sources/context-office/scripts/probe.mjs");
  const workspaceSkillScript = path.join(task.paths.workspace, ".agents/skills/context-standalone/scripts/probe.mjs");
  const oldPluginScript = path.join(task.paths.home, ".agents/plugin-sources/context-office/scripts/probe.mjs");
  const oldSkillScript = path.join(task.paths.home, ".agents/skills/context-standalone/scripts/probe.mjs");
  await mkdir(path.join(task.paths.workspace, "temp"), { recursive: true });
  nextToolCall = { name: "exec_command", arguments: JSON.stringify({ cmd: `test ! -e '${oldPluginScript}' && test ! -e '${oldSkillScript}' && node '${workspacePluginScript}' && node '${workspaceSkillScript}'`, workdir: path.join(task.paths.workspace, "temp"), max_output_tokens: 1000 }) };
  await turn(session, id, pluginSelection);
  const workspaceScriptOutput = JSON.stringify(captures.at(-1).input.filter(item => item.type === "function_call_output"));
  check("native Shell runs the task's plugin script when the obsolete HOME path is absent and cwd is a subdirectory", workspaceScriptOutput.includes("WORKSPACE_PLUGIN_SCRIPT_OK"));
  check("native Shell runs the task's standalone Skill script when the obsolete HOME path is absent and cwd is a subdirectory", workspaceScriptOutput.includes("WORKSPACE_SKILL_SCRIPT_OK"));
  nextToolCall = { name: "exec_command", arguments: JSON.stringify({ cmd: 'umask 077; mkdir -p "$HOME/.shared-home-fixture"; printf synthetic-login > "$HOME/.shared-home-fixture/auth"; test "$HOME" != "$(dirname "$CODEX_HOME")" && printf SHARED_SHELL_HOME_OK', max_output_tokens: 1000 }) };
  await turn(session, id);
  check("native Shell receives shared HOME and distinct CODEX_HOME", JSON.stringify(captures.at(-1).input.filter(item => item.type === "function_call_output")).includes("SHARED_SHELL_HOME_OK"));
  const selectedKnowledgeBases = [{ id: randomUUID(), name: "CONTEXT_KNOWLEDGE_A" }];
  const knowledge = await turn(session, id, { selectedKnowledgeBases });
  const knowledgeSkill = session.skills.find(s => s.name === "linksense-knowledge-base");
  const knowledgeBody = (await readFile(knowledgeSkill.path, "utf8")).replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/u, "").trim();
  check("knowledge selection loads its complete retrieval Skill, not just library names", knowledge.includes(knowledgeBody) && knowledge.includes("CONTEXT_KNOWLEDGE_A"));
  const changedKnowledge = await turn(session, id, { selectedKnowledgeBases: [{ id: randomUUID(), name: "CONTEXT_KNOWLEDGE_B" }] });
  check("changing knowledge selection supplies current names and replacement semantics", changedKnowledge.lastIndexOf("CONTEXT_KNOWLEDGE_B") > changedKnowledge.lastIndexOf("CONTEXT_KNOWLEDGE_A") && changedKnowledge.includes("replaces all previous knowledge-base selections"));
  const cleared = await turn(session, id);
  check("clearing knowledge selection supplies an explicit empty current scope", cleared.lastIndexOf("No knowledge bases are selected.") > cleared.lastIndexOf("CONTEXT_KNOWLEDGE_B"));
  const applicationInstructions = `CONTEXT_APPLICATION_START\n${"应用要求。".repeat(3990)}\nCONTEXT_APPLICATION_END`;
  assert(applicationInstructions.length <= 20000);
  const application = await turn(session, id, { ...pluginSelection, prioritySkills: [{ name: "context-standalone" }], selectedKnowledgeBases, applicationInstructions });
  const applicationContext = prepareCodexAdditionalContext(buildTurnAdditionalContext({ userInput: "", attachments: [], priorityPlugins: [], prioritySkills: [], applicationInstructions }));
  check("application instructions and selected plugin, Skill and knowledge workflow all reach the model", Object.entries(applicationContext).filter(([key]) => key.startsWith("linksense.application-instructions")).every(([, entry]) => application.includes(entry.value)) && application.includes("CONTEXT_BODY_context-standalone_ONE") && application.includes(knowledgeBody) && application.includes("CONTEXT_DESCRIPTION_documents_ONE"));
  const replacement = await turn(session, id, { applicationInstructions: "CONTEXT_APPLICATION_REPLACEMENT" });
  check("shorter application instructions replace the multipart source on the next turn", replacement.lastIndexOf("CONTEXT_APPLICATION_REPLACEMENT") > replacement.lastIndexOf("CONTEXT_APPLICATION_END"));
  const afterConfig = await readFile(configFile, "utf8");
  check("runtime policy leaves the persisted Skill setting intact", /include_instructions\s*=\s*false/u.test(afterConfig));
  // Resume the same real native thread after a capability revision changes.
  await close(session);
  await put(path.join(pluginSource, "skills/documents/SKILL.md"), skill("documents", "TWO"));
  const longSkillBody = `${skill("context-standalone", "TWO")}\n${"技能完整步骤🙂。".repeat(2000)}\nCONTEXT_LONG_SKILL_END`;
  await put(path.join(standaloneSource, "SKILL.md"), longSkillBody);
  const updated = await prepare(taskId, capabilities.map(c => ({ ...c, revision: "two" })));
  session = await connect(updated);
  await thread(session, id);
  const resumed = await turn(session, id, pluginSelection);
  check("resumed native thread receives the updated capability catalog", resumed.includes("CONTEXT_DESCRIPTION_documents_TWO") && resumed.includes("CONTEXT_DESCRIPTION_context-standalone_TWO"));
  const selectedUpdated = await turn(session, id, { prioritySkills: [{ name: "context-standalone" }] });
  check("reselecting an updated Skill loads its new body", selectedUpdated.includes("CONTEXT_BODY_context-standalone_TWO"));
  check("long explicitly selected Skills preserve their complete native instructions", selectedUpdated.includes(longSkillBody));
  const separateTask = await prepare(randomUUID(), []);
  const separate = await connect(separateTask);
  const separateId = await thread(separate);
  const separateInput = await turn(separate, separateId);
  check("two native tasks share HOME while keeping distinct Codex homes", task.paths.home === separateTask.paths.home && task.paths.codexHome !== separateTask.paths.codexHome);
  nextToolCall = { name: "exec_command", arguments: JSON.stringify({ cmd: 'test "$(cat "$HOME/.shared-home-fixture/auth")" = synthetic-login && printf SHARED_LOGIN_OK', max_output_tokens: 1000 }) };
  await turn(separate, separateId);
  check("another native task can reuse the first task's persisted tool login", JSON.stringify(captures.at(-1).input.filter(item => item.type === "function_call_output")).includes("SHARED_LOGIN_OK"));
  check("another task cannot discover the first task's unauthorized plugins or Skills", !separateInput.includes("CONTEXT_DESCRIPTION_documents_") && !separateInput.includes("CONTEXT_DESCRIPTION_context-standalone_"));
  await close(separate);
  await close(session);
  const removed = await prepare(taskId, []);
  session = await connect(removed);
  await thread(session, id);
  const removedInput = await turn(session, id);
  const latestCatalog = removedInput.slice(removedInput.lastIndexOf("## Skills"));
  check("resuming after removal replaces the active catalog without deleted entries", removedInput.includes("## Skills") && !latestCatalog.includes("CONTEXT_DESCRIPTION_documents_") && !latestCatalog.includes("CONTEXT_DESCRIPTION_context-standalone_"));
  await close(session);
  const planTask = await prepare(randomUUID(), capabilities.map(c => ({ ...c, revision: "two" })));
  const plan = await connect(planTask, { mode: "plan" });
  const planId = await thread(plan);
  const planInput = await turn(plan, planId, pluginSelection);
  check("Plan mode does not activate plugin or execution Skill instructions", !planInput.includes("CONTEXT_DESCRIPTION_documents_") && !planInput.includes("CONTEXT_BODY_documents_") && !planInput.includes("CONTEXT_DESCRIPTION_context-standalone_"));
  const longPlanReferences = [{ name: "context-standalone", content: `PLAN_REFERENCE_START\n${"只读参考🙂。".repeat(2_000)}\nPLAN_REFERENCE_END` }];
  const planReferenceInput = await turn(plan, planId, { prioritySkills: [{ name: "context-standalone" }] }, longPlanReferences);
  const planContext = prepareCodexAdditionalContext(buildTurnAdditionalContext({ userInput: "", attachments: [], priorityPlugins: [], prioritySkills: [] }, plan.skills, "plan", longPlanReferences));
  check("long Plan Skill references and policy arrive completely without trust escalation", Object.entries(planContext).filter(([key]) => key.startsWith("linksense.plan-skill-reference-content") || key.startsWith("linksense.turn-mode-policy")).every(([, entry]) => planReferenceInput.includes(entry.value)));
  console.log(JSON.stringify({ codexVersion: CODEX_SCHEMA_VERSION, checks }));
  if (checks.some(c => !c.passed)) process.exitCode = 1;
} finally {
  for (const client of clients) await client.close();
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  await rm(root, { recursive: true, force: true });
}
