import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

// Run in a disposable worker container with an empty tmpfs at /home/linksense.
// Never mount user data. This probe needs neither a model nor network access.
await access("/.dockerenv");
assert.equal(process.getuid(), 1001);
const home = "/home/linksense";
const codexHome = path.join(home, ".codex");
await assert.rejects(access(codexHome), { code: "ENOENT" });
const require = createRequire("/app/package.json");
const { CodexJsonRpcClient } = await import("/app/dist/codex/json-rpc-client.js");
const { NativePluginManager } = await import("/app/dist/codex/native-plugin-manager.js");
const { CODEX_SCHEMA_VERSION } = await import("/app/dist/codex/protocol.js");
const { parse } = require("smol-toml");
const requirements = parse(await readFile("/etc/codex/requirements.toml", "utf8"));
assert.deepEqual(requirements.marketplaces, {
  restrict_to_allowed_sources: true,
  allowed_sources: { linksense: { source: "local", path: home } },
});
const exec = promisify(execFile);
const cli = async (args) => exec("codex", args, {
  env: { PATH: process.env.PATH, HOME: home, CODEX_HOME: codexHome },
  cwd: home, timeout: 30_000, maxBuffer: 1024 * 1024,
});
assert.equal((await cli(["--version"])).stdout.trim(), `codex-cli ${CODEX_SCHEMA_VERSION}`);
const pluginName = "marketplace-policy-probe";
const marker = "LOCAL_PLUGIN_MCP_POLICY_OK";
const source = path.join(home, ".agents/plugin-sources", pluginName);
const workspace = path.join(home, "workspace");
for (const directory of [codexHome, workspace, path.join(home, ".agents/plugins"),
  path.join(source, ".codex-plugin"), path.join(source, "skills/policy-probe")]) {
  await mkdir(directory, { recursive: true });
}
await writeFile(path.join(codexHome, "config.toml"),
  await readFile("/opt/linksense/codex-home-template/config.toml", "utf8"));
await writeFile(path.join(source, ".codex-plugin/plugin.json"), JSON.stringify({
  name: pluginName, version: "1.0.0", description: "Native marketplace policy probe",
  skills: "./skills/", mcpServers: "./.mcp.json",
}));
await writeFile(path.join(source, "skills/policy-probe/SKILL.md"),
  `---\nname: policy-probe\ndescription: Verify the local plugin under marketplace policy.\n---\n${marker}\n`);
const serverPath = path.join(home, "mcp-probe.mjs");
const sdk = pathToFileURL(require.resolve("@modelcontextprotocol/sdk/server/mcp.js")).href;
const stdio = pathToFileURL(require.resolve("@modelcontextprotocol/sdk/server/stdio.js")).href;
await writeFile(serverPath, `
import { McpServer } from ${JSON.stringify(sdk)};
import { StdioServerTransport } from ${JSON.stringify(stdio)};
const server = new McpServer({ name: "policy-probe", version: "1.0.0" });
server.registerTool("check_policy", { description: "Return the local fixture marker" },
  async () => ({ content: [{ type: "text", text: ${JSON.stringify(marker)} }] }));
await server.connect(new StdioServerTransport());
`);
await writeFile(path.join(source, ".mcp.json"), JSON.stringify({
  mcpServers: { policy_probe: { command: process.execPath, args: [serverPath] } },
}));
await writeFile(path.join(home, ".agents/plugins/marketplace.json"), JSON.stringify({
  name: "linksense-personal", interface: { displayName: "LinkSense Personal" },
  plugins: [{ name: pluginName,
    source: { source: "local", path: `./.agents/plugin-sources/${pluginName}` },
    policy: { installation: "AVAILABLE", authentication: "ON_USE" }, category: "Productivity",
  }],
}));
await cli(["plugin", "marketplace", "add", home, "--json"]);
await cli(["plugin", "add", `${pluginName}@linksense-personal`, "--json"]);
for (const deniedSource of ["https://github.com/openai/plugins.git", "/tmp"]) {
  await assert.rejects(cli(["plugin", "marketplace", "add", deniedSource, "--json"]),
    (error) => /not allowed by requirements/u.test(error.stderr));
}
const client = new CodexJsonRpcClient({
  command: "codex", userHome: home, codexHome,
  logger: { warn() {}, error() {} }, requestTimeoutMs: 30_000,
  configOverrides: [
    'model="gpt-5.4"', 'model_provider="offline-probe"',
    'model_providers.offline-probe.name="Offline probe"',
    'model_providers.offline-probe.wire_api="responses"',
    'model_providers.offline-probe.base_url="http://127.0.0.1:1/v1"',
    'model_providers.offline-probe.requires_openai_auth=false',
    "features.memories=false", "features.hooks=false",
  ],
});
try {
  await client.initialize();
  const manager = new NativePluginManager();
  const activations = await manager.verifyAfterStart({
    client, workspace, userHome: home, codexHome, pluginNames: [pluginName],
  });
  assert.equal(activations.length, 1);
  assert.equal(activations[0].skills.length, 1);
  assert.equal(activations[0].mcpServers.length, 1);
  const catalog = await client.request("skills/list", { cwds: [workspace], forceReload: true });
  assert(catalog.data.some((entry) => entry.skills.some((skill) =>
    skill.name === `${pluginName}:policy-probe` && skill.enabled)));
  const thread = await client.request("thread/start", {
    cwd: workspace, approvalPolicy: "never", sandbox: "danger-full-access",
  });
  const result = await client.request("mcpServer/tool/call", {
    threadId: thread.thread.id, server: activations[0].mcpServers[0],
    tool: "check_policy", arguments: {},
  });
  assert(JSON.stringify(result).includes(marker));
  // Startup catalog synchronization is asynchronous: inspect throughout the
  // window that reproduced the original download, not just after initialize.
  for (let sample = 0; sample < 30; sample++) {
    await delay(1000);
    await assert.rejects(access(path.join(codexHome, ".tmp/plugins")), { code: "ENOENT" });
  }
  console.log(JSON.stringify({ status: "passed", codex: CODEX_SCHEMA_VERSION,
    localPlugin: true, skill: true, mcpCall: true,
    disallowedGitAndLocalSources: true, curatedCacheBytes: 0 }));
} finally {
  await client.close();
}
