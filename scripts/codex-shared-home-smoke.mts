import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { stageProjectHomes } from "../apps/api/src/operations/project-home-conversion.ts";
import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import pino from "../apps/runner/node_modules/pino/pino.js";
import { z } from "zod";

import { CodexJsonRpcClient } from "../apps/runner/src/codex/json-rpc-client.ts";
import { CODEX_SCHEMA_VERSION, type JsonRpcNotification } from "../apps/runner/src/codex/protocol.ts";

const threadResponse = z.object({
  thread: z.object({ id: z.string().min(1), cwd: z.string().min(1) }),
});

/** Offline native protocol probe. All state belongs to a disposable HOME. */
async function main(): Promise<void> {
  const command = process.env.CODEX_BIN ?? "codex";
  const { stdout } = await promisify(execFile)(command, ["--version"]);
  assert.equal(stdout.trim(), `codex-cli ${CODEX_SCHEMA_VERSION}`);
  const root = await mkdtemp(path.join(tmpdir(), "linksense-shared-home-"));
  const home = await realpath(root);
  const codexHome = path.join(home, ".codex");
  const firstProject = path.join(home, "projects", "first");
  const secondProject = path.join(home, "projects", "second");
  let modelCalls = 0;
  let probeMove = false;
  const fixtureFailures: unknown[] = [];
  const executionOutputs: unknown[] = [];
  const provider = createServer((request, response) => {
    void (async () => {
    let payload = "";
    for await (const chunk of request) payload += String(chunk);
    const body = z.object({ tools: z.array(z.record(z.string(), z.unknown())), input: z.array(z.record(z.string(), z.unknown())) }).parse(JSON.parse(payload));
    executionOutputs.push(...body.input.filter(item => item.type === "function_call_output" || item.type === "custom_tool_call_output"));
    const id = `fixture-${++modelCalls}`;
    const message = {
      id: `message-${id}`, type: "message", role: "assistant",
      status: "completed", phase: "final_answer",
      content: [{ type: "output_text", text: "SHARED_HOME_OK", annotations: [] }],
    };
    let item: Record<string, unknown> = message;
    if (probeMove) {
      probeMove = false;
      const object = z.record(z.string(), z.unknown());
      const definitions = body.tools.flatMap(tool => tool.type === "namespace" && Array.isArray(tool.tools)
        ? tool.tools.map(child => ({ ...object.parse(child), namespace: tool.name }))
        : [tool]);
      const definition = definitions.find(tool => ["exec", "functions__exec", "exec_command", "shell_command"].includes(String(tool.name)));
      assert(definition, `native catalog must expose execution: ${definitions.map(tool => String(tool.name)).join(", ")}`);
      const code = 'text(await tools.exec_command({cmd:"pwd > moved-cwd.txt",yield_time_ms:1000}));';
      const args = definition.name === "exec_command" ? { cmd: "pwd > moved-cwd.txt", yield_time_ms: 1000 }
        : definition.name === "shell_command" ? { command: "pwd > moved-cwd.txt" }
        : { input: code };
      item = {
        id: `item-${id}`, call_id: `call-${id}`, name: definition.name,
        status: "completed",
        ...(definition.namespace ? { namespace: definition.namespace } : {}),
        ...(definition.type === "custom"
          ? { type: "custom_tool_call", input: code }
          : { type: "function_call", arguments: JSON.stringify(args) }),
      };
    }
    const result = {
      id, object: "response", status: "completed", model: "gpt-5.4", output: [item],
      usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
    };
    response.writeHead(200, { "content-type": "text/event-stream" });
    for (const event of [
      { type: "response.created", response: { ...result, status: "in_progress", output: [] } },
      { type: "response.output_item.added", output_index: 0, item },
      { type: "response.output_item.done", output_index: 0, item },
      { type: "response.completed", response: result },
    ]) response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    response.end();
    })().catch((error: unknown) => {
      fixtureFailures.push(error);
      response.destroy();
    });
  });
  await new Promise<void>((resolve, reject) => {
    provider.once("error", reject);
    provider.listen(0, "127.0.0.1", resolve);
  });
  const address = provider.address();
  assert(address && typeof address !== "string");
  const clients: CodexJsonRpcClient[] = [];
  const createClient = (runtimeHome = home) => {
    const client = new CodexJsonRpcClient({
      command,
      userHome: runtimeHome,
      codexHome: path.join(runtimeHome, ".codex"),
      logger: pino({ level: "silent" }),
      requestTimeoutMs: 30_000,
      configOverrides: [
        "features.memories=false", "features.multi_agent=false", "features.hooks=false",
        'model="gpt-5.4"', 'model_provider="fixture"',
        'model_providers.fixture.name="Fixture"',
        'model_providers.fixture.wire_api="responses"',
        `model_providers.fixture.base_url="http://127.0.0.1:${address.port}/v1"`,
        "model_providers.fixture.requires_openai_auth=false",
      ],
    });
    clients.push(client);
    return client;
  };
  try {
    await Promise.all([codexHome, firstProject, secondProject].map(directory => mkdir(directory, { recursive: true })));
    await writeFile(path.join(codexHome, "config.toml"), 'model = "offline-probe"\n');
    const first = createClient();
    const firstInitialized = await first.initialize();
    const second = createClient();
    // Initialize the shared state database once before accepting parallel starts.
    const initialized = [firstInitialized, await second.initialize()];
    for (const result of initialized) assert.equal(await realpath(result.codexHome), codexHome);
    const started = await Promise.all([
      first.request("thread/start", { cwd: firstProject, approvalPolicy: "never", sandbox: "danger-full-access" }),
      second.request("thread/start", { cwd: firstProject, approvalPolicy: "never", sandbox: "danger-full-access" }),
      first.request("thread/start", { cwd: secondProject, approvalPolicy: "never", sandbox: "danger-full-access" }),
    ]);
    const threads = started.map(value => threadResponse.parse(value).thread);
    assert.equal(new Set(threads.map(thread => thread.id)).size, 3);
    assert.deepEqual(threads.map(thread => thread.cwd), [firstProject, firstProject, secondProject]);
    await Promise.all(threads.map((thread, index) => runTurn(index === 1 ? second : first, thread.id)));
    await Promise.all([first.close(), second.close()]);
    const resumed = createClient();
    await resumed.initialize();
    for (const thread of threads) {
      const response = threadResponse.parse(await resumed.request("thread/resume", { threadId: thread.id, cwd: thread.cwd }));
      assert.equal(response.thread.id, thread.id);
      assert.equal(response.thread.cwd, thread.cwd);
    }
    await resumed.close();
    const movedClient = createClient();
    await movedClient.initialize();
    const moved = threadResponse.parse(await movedClient.request("thread/resume", { threadId: threads[0]!.id, cwd: secondProject }));
    assert.equal(moved.thread.id, threads[0]!.id);
    // Thread metadata retains its original cwd; turn/start selects execution cwd.
    probeMove = true;
    await runTurn(movedClient, moved.thread.id, secondProject);
    const actualCwd = await readFile(path.join(secondProject, "moved-cwd.txt"), "utf8").catch(error => {
      throw new Error(`Native execution did not write in the destination project: ${JSON.stringify(executionOutputs)}; fixture failures: ${fixtureFailures.map(String).join(", ")}`, { cause: error });
    });
    assert.equal(actualCwd.trim(), secondProject);
    await movedClient.close();
    const legacy = path.join(home, "legacy-users"), migrated = path.join(home, "converted-users");
    const ownerId = randomUUID(), projectId = randomUUID();
    const migrationTasks = threads.map(thread => {
      const id = randomUUID();
      return { id, ownerId, projectId, applicationId: null, workspaceRelPath: `${ownerId}/home/workspaces/${id}`, nativeThreadIds: [thread.id] };
    });
    for (const task of migrationTasks) {
      const oldHome = path.join(legacy, ownerId, "home", "task-homes", task.id);
      await mkdir(oldHome, { recursive: true });
      await cp(codexHome, path.join(oldHome, ".codex"), { recursive: true });
      await mkdir(path.join(legacy, task.workspaceRelPath), { recursive: true });
      await writeFile(path.join(legacy, task.workspaceRelPath, "retained.txt"), task.id);
    }
    const convertedHome = path.join(migrated, ownerId, "home");
    const imported = await stageProjectHomes({ sourceRoot: legacy, stagingRoot: migrated, tasks: migrationTasks, nativeUserHome: convertedHome });
    const convertedClient = createClient(convertedHome);
    await convertedClient.initialize();
    for (const thread of threads) {
      const response = threadResponse.parse(await convertedClient.request("thread/resume", { threadId: thread.id, cwd: path.join(convertedHome, "projects", projectId) }));
      assert.equal(response.thread.id, thread.id);
    }
    for (const task of imported) assert.equal(await readFile(path.join(migrated, task.workspace, task.importedDirectory, "retained.txt"), "utf8"), task.id);
    probeMove = true;
    await runTurn(convertedClient, threads[0]!.id, path.join(convertedHome, "projects", projectId));
    assert.equal((await readFile(path.join(convertedHome, "projects", projectId, "moved-cwd.txt"), "utf8")).trim(), path.join(convertedHome, "projects", projectId));

    assert.deepEqual(fixtureFailures, []);
    assert.equal(modelCalls, 7);
    process.stdout.write(`${JSON.stringify({ status: "passed", codexVersion: CODEX_SCHEMA_VERSION, concurrentClients: 2, threads: 3, resumed: 3, projectMove: true, migratedNativeHistory: true, localFixtureCalls: modelCalls, externalModelCalls: 0 })}\n`);
  } finally {
    await Promise.allSettled(clients.map(client => client.close()));
    await new Promise<void>((resolve, reject) => provider.close(error => error ? reject(error) : resolve()));
    await rm(root, { recursive: true, force: true });
  }
}

async function runTurn(client: CodexJsonRpcClient, threadId: string, cwd?: string): Promise<void> {
  const completion = z.object({ threadId: z.string(), turn: z.object({ status: z.string(), error: z.unknown().optional() }) });
  let listener: (event: JsonRpcNotification) => void = () => {};
  let timeout: NodeJS.Timeout | undefined;
  const completed = new Promise<void>((resolve, reject) => {
    timeout = setTimeout(() => reject(new Error("Native turn did not complete")), 30_000);
    listener = event => {
      if (event.method !== "turn/completed") return;
      const parsed = completion.safeParse(event.params);
      if (!parsed.success || parsed.data.threadId !== threadId) return;
      if (parsed.data.turn.status === "completed") resolve();
      else reject(new Error(JSON.stringify(parsed.data.turn)));
    };
    client.on("notification", listener);
  });
  try {
    await Promise.all([
      completed,
      client.request("turn/start", { threadId, ...(cwd ? { cwd, runtimeWorkspaceRoots: [cwd] } : {}), approvalPolicy: "never", sandboxPolicy: { type: "dangerFullAccess" }, input: [{ type: "text", text: "Reply SHARED_HOME_OK", text_elements: [] }] }),
    ]);
  } finally {
    clearTimeout(timeout);
    client.off("notification", listener);
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : "NATIVE_SHARED_HOME_PROBE_FAILED"}\n`);
  process.exitCode = 1;
});
