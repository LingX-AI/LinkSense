import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { assertCoreMcpRuntime } from "../deploy/docker/runner-runtime-smoke.mjs";

const execute = promisify(execFile);
const smokeUrl = new URL("../deploy/docker/runner-runtime-smoke.mjs", import.meta.url).href;
const runnerRoot = resolve(import.meta.dirname, "../apps/runner");

test("the Docker smoke check accepts the actual Core MCP registry over stdio in both modes", async () => {
  // Load source explicitly so stale dist output cannot make this test pass.
  const nodeArguments = ["--conditions=development", "--import", "tsx"];
  const { stdout } = await execute(process.execPath, [
    ...nodeArguments, "--input-type=module", "--eval", `
      import { assertCoreMcpRuntime } from ${JSON.stringify(smokeUrl)};
      import { coreMcpToolNamesFor } from ${JSON.stringify(pathToFileURL(resolve(runnerRoot, "src/mcp/core-service-registry.ts")).href)};
      await assertCoreMcpRuntime(${JSON.stringify(runnerRoot)}, {
        registryPath: "src/mcp/core-service-registry.ts",
        serverPath: "src/mcp/core-service-server.ts",
        nodeArguments: ${JSON.stringify(nodeArguments)},
      });
      console.log(JSON.stringify({ default: coreMcpToolNamesFor("default"), plan: coreMcpToolNamesFor("plan") }));
    `,
  ], { cwd: runnerRoot, timeout: 15_000 });
  const tools = JSON.parse(stdout);
  assert.ok(tools.default.includes("update_application_metadata"));
  assert.deepEqual(tools.plan, [
    "convert_document_to_markdown", "get_current_user_info", "search_knowledge_base",
    "list_knowledge_documents", "get_knowledge_document_markdown", "request_user_form",
    "emit_application_event",
  ]);
});

async function fixture(t, responses) {
  const root = await mkdtemp(join(tmpdir(), "linksense-mcp-smoke-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "dist/mcp"), { recursive: true });
  await writeFile(join(root, "package.json"), JSON.stringify({ type: "module" }));
  await writeFile(join(root, "dist/mcp/core-service-registry.js"), `
    export function coreMcpToolNamesFor(mode) {
      return mode === "default" ? ["existing_tool", "newly_declared_tool"] : ["existing_tool"];
    }
  `);
  await writeFile(join(root, "dist/mcp/core-service-server.js"), `
    import { createInterface } from "node:readline";
    const responses = ${JSON.stringify(responses)};
    for await (const line of createInterface({ input: process.stdin })) {
      const request = JSON.parse(line);
      const result = request.method === "tools/list" ? responses[process.env.LINKSENSE_COLLABORATION_MODE] : {};
      console.log(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }));
    }
  `);
  return root;
}

function list(names) {
  return { tools: names.map((name) => ({ name })) };
}

test("new module declarations are smoke-tested without maintaining another tool list", async (t) => {
  const root = await fixture(t, {
    default: list(["newly_declared_tool", "existing_tool"]),
    plan: list(["existing_tool"]),
  });
  await assertCoreMcpRuntime(root);
});

for (const [name, mode, response, message] of [
  ["missing tool", "default", list(["existing_tool"]), /expected=\["existing_tool","newly_declared_tool"\]; actual=\["existing_tool"\]/u],
  ["unexpected tool", "default", list(["existing_tool", "newly_declared_tool", "undeclared_tool"]), /actual=\["existing_tool","newly_declared_tool","undeclared_tool"\]/u],
  ["duplicate tool", "default", list(["existing_tool", "existing_tool"]), /actual=\["existing_tool","existing_tool"\]/u],
  ["tool leaked into Plan mode", "plan", list(["existing_tool", "newly_declared_tool"]), /Core MCP in Plan mode exposed an unexpected tool registry/u],
  ["malformed tool list", "default", { tools: {} }, /returned an invalid tools\/list response/u],
  ["malformed tool name", "default", { tools: [{ name: null }] }, /returned an invalid tools\/list response/u],
]) {
  test(`the runtime smoke still rejects a ${name}`, async (t) => {
    const root = await fixture(t, {
      default: list(["existing_tool", "newly_declared_tool"]),
      plan: list(["existing_tool"]),
      [mode]: response,
    });
    await assert.rejects(assertCoreMcpRuntime(root), message);
  });
}
