/** Execution smoke for the runtime verified by scripts/desktop.mjs, using an isolated model fixture. */
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { desktopExecutionCommandSchema } from "@linksense/shared";
import pino from "pino";
import { z } from "zod";
import { CodexJsonRpcClient } from "../../src/codex/json-rpc-client.js";
import { CODEX_SCHEMA_VERSION, type JsonRpcNotification } from "../../src/codex/protocol.js";
import { loadCodexTemplateFeatureOverrides } from "../../src/codex/template-features.js";
import { builtInMcpConfigOverrides, coreMcpEnvironmentVariables, linkSenseModelProviderId } from "../../src/codex/runtime-config-overrides.js";
import { DesktopWorkerProvider } from "../../src/controller/desktop-worker-provider.js";
import { ownerWorkerSecret } from "../../src/controller/storage-key.js";
import { DesktopTurns } from "../../src/desktop/turns.js";
import { StartOperationStore } from "../../src/start-operation.js";
import { RunnerEventOutboxStore } from "../../src/workspace/event-outbox.js";
import { prepareConversationControl, WorkspaceManager } from "../../src/workspace/workspace-manager.js";

const sourceRuntime = z.string().refine(path.isAbsolute).parse(process.argv[2]);
async function verifyRuntime(runtime: string, root: string): Promise<void> {
  const manifest = z.object({
    target: z.enum(["darwin/arm64", "darwin/amd64", "windows/arm64", "windows/amd64"]),
    versions: z.object({ codex: z.literal(CODEX_SCHEMA_VERSION) }),
  }).parse(JSON.parse(await readFile(path.join(runtime, "manifest.json"), "utf8")));
  const featureOverrides = await loadCodexTemplateFeatureOverrides(path.join(runtime, "template"));
  let modelRequests = 0;
  let workerHeartbeats = 0;
  const failures: unknown[] = [];
  const provider = createServer((request, response) => {
    void (async () => {
      assert.equal(request.method, "POST");
      let bytes = 0;
      for await (const chunk of request) {
        bytes += Buffer.byteLength(chunk);
        assert(bytes <= 2 * 1024 * 1024, "model fixture request exceeded its bound");
      }
      if (request.url === "/internal/runner/heartbeat") {
        assert.equal(request.headers.authorization, `Bearer ${ownerWorkerSecret(ownerId, controlToken, conversationId)}`);
        workerHeartbeats++;
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end('{"data":{"confirmed":true}}');
        return;
      }
      assert(request.url?.endsWith("/responses"));
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
  const ownerId = randomUUID(), conversationId = randomUUID(), controlToken = randomBytes(32).toString("hex");
  const logger = pino({ enabled: false });
  const origin = `http://127.0.0.1:${address.port}`;
  const workerProvider = new DesktopWorkerProvider({
    dataRoot: path.join(root, "workspaces"), runtimeRoot: runtime, controlToken,
    bridgeUrl: `${origin}/`,
  }, logger);
  const workerPaths = workerProvider.pathsFor(ownerId, conversationId);
  const home = workerPaths.home, codexHome = path.join(home, ".codex"), workspace = path.join(home, "workspace");
  await mkdir(codexHome, { recursive: true, mode: 0o700 });
  await mkdir(workspace, { mode: 0o700 });
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
    logger,
    extraEnvironment: coreEnvironment,
    configOverrides: [
      ...featureOverrides,
      "check_for_update_on_startup=false", `model_provider="${linkSenseModelProviderId}"`, 'model="gpt-5.4"',
      `model_providers.${linkSenseModelProviderId}.name="Fixture"`, `model_providers.${linkSenseModelProviderId}.wire_api="responses"`,
      `model_providers.${linkSenseModelProviderId}.base_url="${origin}/v1"`,
      `model_providers.${linkSenseModelProviderId}.requires_openai_auth=false`, "features.memories=false",
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
    await workerProvider.prepareOwnerFilesystem(workerPaths);
    const worker = await workerProvider.acquire({
      ownerId, serviceSessionId: conversationId, name: "desktop-package-check", storageKey: conversationId, probe: true,
    });
    const authorization = `Bearer ${ownerWorkerSecret(ownerId, controlToken, conversationId)}`;
    const deadline = Date.now() + 30_000;
    while (true) {
      const response = await fetch(`${worker.endpoint}/health/ready`, {
        headers: { authorization }, signal: AbortSignal.timeout(15_000), redirect: "error",
      }).catch(() => undefined);
      if (response?.ok) {
        const health = z.object({ status: z.literal("available"), codex_app_server: z.object({ status: z.literal("available") }) }).parse(await response.json());
        assert.equal(health.codex_app_server.status, "available");
        break;
      }
      await response?.body?.cancel();
      assert.equal(await workerProvider.inspect(worker), "running", "packaged worker exited before readiness");
      assert(Date.now() < deadline, "packaged worker did not pass its Codex readiness probe");
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    const otherTask = await fetch(`${worker.endpoint}/conversations/${randomUUID()}/turns/start`, {
      method: "POST", headers: { authorization, "x-linksense-owner-id": ownerId, "content-type": "application/json" },
      body: "{}", signal: AbortSignal.timeout(5_000), redirect: "error",
    });
    assert.equal(otherTask.status, 403, "worker accepted an unrelated session");
    await otherTask.body?.cancel();
    await waitFor(() => workerHeartbeats > 0);
    await workerProvider.release(worker);
    assert.equal(await workerProvider.inspect(worker), "stopped");
    await client.initialize();
    const started = z.object({ thread: z.object({ id: z.string() }) }).parse(await client.request("thread/start", {
      model: "gpt-5.4", modelProvider: linkSenseModelProviderId, cwd: workspace, runtimeWorkspaceRoots: [workspace],
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
    if (manifest.target.startsWith("darwin/")) {
      // Recreate the durable state of a worker lost before either output append.
      await client.close();
      const requestsBeforeRecovery = modelRequests;
      const projectionId = randomUUID(), runtimeGeneration = randomUUID();
      await prepareConversationControl(workerPaths, conversationId, "workspace", undefined, runtimeGeneration);
      const manager = new WorkspaceManager(workerPaths.root, undefined, {
        fixedOwnerId: ownerId, fixedHomeRoot: home, fixedControlRoot: workerPaths.control,
      });
      const journal = new StartOperationStore(manager);
      const start = await journal.createStarting(conversationId, projectionId, ownerId, "0".repeat(64));
      assert(start);
      await journal.update(start, { status: "succeeded", result: { codexThreadId: started.thread.id, codexTurnId: savedTurn.id } });
      const outbox = new RunnerEventOutboxStore(manager, { generation: runtimeGeneration, turnId: projectionId });
      const pendingApproval = await outbox.append(conversationId, {
        method: "item/commandExecution/requestApproval",
        visibility: "user_visible",
        params: {
          threadId: started.thread.id, turnId: savedTurn.id, itemId: "fixture-approval", requestId: 1,
          approval: { method: "item/commandExecution/requestApproval", command: "printf fixture",
            cwd: "$WORKSPACE", decisions: ["accept", "cancel"] },
        },
      });
      assert.equal((await outbox.peek(conversationId))?.deliveryId, pendingApproval.deliveryId);
      const turns = new DesktopTurns(workerProvider, runtime, origin, () => assert.fail("desktop recovery lost a worker"), logger);
      try {
        const deliveries: unknown[] = [];
        const result = await turns.execute(desktopExecutionCommandSchema.parse({
          type: "command", operation: "turn.drain", id: randomUUID(), owner_id: ownerId,
          conversation_id: conversationId, runtime_generation: runtimeGeneration, turn_id: projectionId,
          expires_at: new Date(Date.now() + 30_000).toISOString(),
        }), AbortSignal.timeout(20_000), { deliver: async batch => {
          deliveries.push(...batch.events.map(({ event }) => event));
          return { type: "execution.ack", id: randomUUID(), operation: "events", ok: true,
            data: { accepted_delivery_ids: batch.events.map(({ deliveryId }) => deliveryId) } };
        } });
        assert(result.ok && result.operation === "turn.drain");
        assert.equal(result.result.terminal?.turn.status, "completed");
        assert.equal(result.result.terminal?.turn.id, savedTurn.id);
        assert.equal(deliveries.length, 1);
        assert.match(JSON.stringify(deliveries[0]), /"method":"item\/completed".*"text":"DESKTOP_PACKAGE_OK"/u);
        assert.equal(modelRequests, requestsBeforeRecovery, "recovery submitted another model request");
        assert.equal(await outbox.peek(conversationId), null, "recovery left the abandoned approval in the outbox");
      } finally { await turns.shutdown(); }
    }
    assert.deepEqual(failures, []);
    console.log(JSON.stringify({ target: manifest.target, codex: CODEX_SCHEMA_VERSION, packagedWorker: "ready_and_stopped",
      coreMcp: "ready", catalog: "callable", nativeTurn: "completed", providerKeys: "not_required" }));
  } finally {
    await workerProvider.shutdown();
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
