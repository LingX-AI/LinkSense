/**
 * Joined Mac Computer Use white-box fixture (M1b, fixture-only).
 *
 * One pinned Codex 0.170.0 turn calls the real Core MCP computer tools through an
 * in-process official-SDK loopback MCP endpoint. The executor is the production
 * DesktopLink.requestTool adapter, the device is the real Go bridge child
 * (TestComputerDeviceGateway) over an authenticated device WebSocket, and the API
 * runs the real registerDesktopExecution route with PostgreSQL authorization,
 * Redis leases/occupancy/claims, and the test-injected synthetic Mac executor.
 *
 * No app, AX, screen, window, driver, permission, VM, or non-loopback network is
 * used. CODEX_BIN must point at the pinned 0.170.0 binary.
 *
 * Run:
 *   CODEX_BIN=<pinned codex> pnpm --filter @linksense/api exec tsx \
 *     ../../scripts/desktop-computer-use-joined.mts
 */
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import pino from "../apps/runner/node_modules/pino/pino.js";
import { assertCodexRuntimeVersion } from "../apps/runner/src/codex/runtime-version.ts";
import { CodexJsonRpcClient } from "../apps/runner/src/codex/json-rpc-client.ts";
import { CODEX_SCHEMA_VERSION } from "../apps/runner/src/codex/protocol.ts";
import { createJoinedDesktopLink, message, noArgumentSchema, output, startComputerUseMcpFixture, startResponsesFixture, toolCall } from "../apps/runner/test/functional/fixtures/computer-use-joined.ts";
import { startJoinedComputerApi } from "../apps/api/test/integration/computer-use-joined.ts";
import { createRedisFixture } from "../apps/api/test/fixtures/redis.ts";
import { MemoryDesktopDeviceCoordinator } from "../apps/api/test/desktop-devices.fixture.ts";
import { createPrismaClient } from "../apps/api/src/db.ts";
import { projectWorkspaceRelativePath } from "../apps/api/src/lib/user-runtime-paths.ts";
import { DesktopDeviceService } from "../apps/api/src/modules/desktop-devices/service.ts";
import { PrismaDesktopDeviceRepository } from "../apps/api/src/modules/desktop-devices/repository.ts";

const execute = promisify(execFile);
const command = process.env.CODEX_BIN?.trim() || "codex";
const typedText = "你好，LinkSense 👋";
const bundleId = "com.example.LinkSenseComputerFixture";
const target = { bundleId };
const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const checks = [];
const record = (name, passed, details) => checks.push({ name, passed, ...(details === undefined ? {} : { details }) });
await assertCodexRuntimeVersion({ command });

const root = await mkdtemp(join(tmpdir(), "linksense-desktop-joined-"));
const data = join(root, "pg");
const port = await freePort();
const databaseUrl = (name) => {
  const url = new URL(`postgresql://127.0.0.1:${port}/${name}`);
  url.username = userInfo().username;
  return url.toString();
};
let startedPostgres = false;
let prisma;
let redisFixture;
let api;
let gateway;
let linkState;
let mcp;
let provider;
let client;
try {
  await execute("initdb", ["-D", data, "--auth=trust", "--encoding=UTF8", "--no-locale"], { timeout: 30_000 });
  await execute("pg_ctl", [
    "-D", data, "-l", join(root, "server.log"), "-w", "start",
    "-o", `-h 127.0.0.1 -p ${port} -c unix_socket_directories='' -c timezone=UTC`,
  ], { timeout: 30_000 });
  startedPostgres = true;
  prisma = createPrismaClient(databaseUrl("postgres"));
  await prisma.$executeRawUnsafe("CREATE DATABASE desktop_joined");
  await prisma.$disconnect();
  prisma = createPrismaClient(databaseUrl("desktop_joined"));
  await execute("pnpm", [
    "exec", "prisma", "migrate", "deploy", "--config", "apps/api/test/integration/prisma.config.ts",
  ], {
    cwd: repositoryRoot, timeout: 120_000, maxBuffer: 4_000_000,
    env: { ...process.env, DATABASE_URL: databaseUrl("desktop_joined") },
  });

  const workspaceRoot = join(root, "workspaces");
  await mkdir(workspaceRoot, { recursive: true });
  const ownerId = randomUUID();
  const sessionEpoch = new Date();
  const owner = await prisma.user.create({ data: {
    id: ownerId, email: `joined-${ownerId}@example.test`, name: "Joined fixture owner",
    role: "user", status: "active", createdAt: sessionEpoch, authValidAfter: sessionEpoch,
  } });
  const pairingService = new DesktopDeviceService(
    new PrismaDesktopDeviceRepository(prisma), new MemoryDesktopDeviceCoordinator(),
  );
  const pairing = await pairingService.pairing(owner.id, owner.authValidAfter);
  const issued = await pairingService.pair({
    code: pairing.code, name: "Joined fixture Mac", platform: "darwin", arch: "arm64", app_version: "0.1.0",
  });
  const deviceId = issued.device.id;
  const runtimeGeneration = randomUUID();
  const conversation = await prisma.conversation.create({ data: {
    ownerId, title: "Joined Mac computer use", titleSource: "manual", archiveStatus: "active",
    workspaceRelPath: projectWorkspaceRelativePath(ownerId, null),
    runtimeGeneration, executionTarget: "local", desktopDeviceId: deviceId,
  } });
  const conversationId = conversation.id;
  const turnId = randomUUID();
  const sessionId = randomUUID();
  const selectionId = randomUUID();
  await prisma.conversationTurnStartIntent.create({ data: {
    projectionTurnId: turnId, ownerId, conversationId, runtimeGeneration,
    capabilityGeneration: "0".repeat(64), inputText: "Exercise the joined computer fixture.",
    capabilitiesJson: [], attachmentsJson: [], submitMode: "normal", runnerStatus: "prepared",
  } });

  redisFixture = await createRedisFixture();
  api = await startJoinedComputerApi({
    prisma, redisClient: redisFixture.client, databaseUrl: databaseUrl("desktop_joined"), workspaceRoot,
    ownerId, deviceId, conversationId, runtimeGeneration, turnId, sessionId, selectionId, bundleId,
  });
  const scope = { ownerId, deviceId, connectionId: "", conversationId, turnId, runtimeGeneration };
  const occupancyKey = api.occupancyKey;

  // Real Go bridge child compiled from the reviewed test seam.
  const gatewayBinary = join(root, "computer-gateway.test");
  await execute("go", ["test", "-c", "-tags", "desktop_runtime_package", "-o", gatewayBinary, "."], {
    cwd: join(repositoryRoot, "apps/desktop"), timeout: 180_000,
    env: { ...process.env, GOPROXY: "off" },
  });
  gateway = spawn(gatewayBinary, ["-test.run=^TestComputerDeviceGateway$", "-test.timeout=120s"], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  let gatewayErrors = "";
  gateway.stderr.setEncoding("utf8");
  gateway.stderr.on("data", chunk => { gatewayErrors = `${gatewayErrors}${chunk}`.slice(-8_000); });

  const opened = Promise.withResolvers();
  const pendingFrames = [];
  createInterface({ input: gateway.stdout }).on("line", line => {
    let parsed;
    try { parsed = JSON.parse(line); } catch { return; }
    if (parsed?.type === "link.open") { opened.resolve(parsed); return; }
    if (parsed?.type !== "link.frame") return;
    if (!linkState) { pendingFrames.push(parsed.frame); return; }
    if (parsed.link_id === linkState.link.id) linkState.link.receive(parsed.frame);
  });
  gateway.once("exit", code => {
    opened.reject(new Error(`computer gateway exited early (${code}): ${gatewayErrors}`));
  });
  writeLine(JSON.stringify({
    origin: api.origin,
    credential: { token: issued.token, ownerId, deviceId, name: issued.device.name },
    selection: {
      owner_id: ownerId, conversation_id: conversationId, runtime_generation: runtimeGeneration,
      turn_id: turnId, session_id: sessionId, selection_id: selectionId,
      expires_at: new Date(api.sessionExpiresAt).toISOString(),
    },
  }));
  const linkOpen = await withTimeout(opened.promise, 20_000, "Go bridge did not publish link.open");
  assert.equal(linkOpen.owner_id, ownerId);
  record("the negotiated Go bridge link offers computer.execute",
    Array.isArray(linkOpen.tool_operations) && linkOpen.tool_operations.includes("computer.execute"),
    linkOpen.tool_operations);
  scope.connectionId = linkOpen.link_id;
  await waitFor(() => api.coordinator.isCurrentConnection(deviceId, scope.connectionId), 10_000,
    "the real device connection was not current");

  const credentials = await api.leases.issue(
    { deviceId, connectionId: scope.connectionId },
    {
      ownerId, conversationId, projectionTurnId: turnId, expectedRuntimeGeneration: runtimeGeneration,
      model: "fixture-model",
      modelProvider: {
        revision: 1, protocolMode: "native_responses",
        baseUrl: "http://127.0.0.1:9/v1", apiKey: randomUUID(),
      },
    },
  );
  const wireRequests = [];
  linkState = await createJoinedDesktopLink({
    linkId: scope.connectionId,
    ownerId,
    scope: {
      owner_id: ownerId, conversation_id: conversationId,
      runtime_generation: runtimeGeneration, turn_id: turnId,
    },
    write: async frame => {
      if (frame.type === "link.frame" && frame.frame?.type === "tool.request") wireRequests.push(frame.frame);
      await writeLine(JSON.stringify(frame));
    },
  });
  for (const frame of pendingFrames.splice(0)) linkState.link.receive(frame);
  const { executor } = linkState.runFor(credentials.run_token);

  mcp = await startComputerUseMcpFixture({ executor, target });
  const redisClient = api.redisClient;
  let firstHolder;
  let observationId;

  provider = await startResponsesFixture(async (body, step) => {
    if (step === 1) {
      record("status/observe keep the strict no-argument schema",
        noArgumentSchema(body, "computer_status") && noArgumentSchema(body, "computer_observe"));
      record("act is model-discoverable", toolCall(body, "computer_act", {}, "probe") !== undefined);
      return toolCall(body, "computer_status", {}, "call_status") ?? message("missing status tool");
    }
    if (step === 2) {
      const status = output(body, "call_status");
      record("status without a holder returns the synthetic availability", status?.available === true, status);
      const occupancy = await redisClient.get(occupancyKey);
      const binding = await redisClient.get(api.bindingKey(scope));
      record("status never acquires a GUI holder", occupancy === null && binding === null,
        { occupancy, binding });
      return toolCall(body, "computer_observe", {}, "call_observe") ?? message("missing observe tool");
    }
    if (step === 3) {
      const observation = output(body, "call_observe");
      observationId = observation?.observation_id;
      record("observe returns the generated AX tree",
        typeof observationId === "string" &&
        observation?.nodes?.some(node => node.name === "Continue" && node.ref === "e1") === true &&
        observation?.nodes?.some(node => node.name === "Name" && node.ref === "e2") === true,
        observation);
      const occupancy = parseJson(await redisClient.get(occupancyKey));
      const binding = parseJson(await redisClient.get(api.bindingKey(scope)));
      firstHolder = occupancy?.holderId;
      record("the first observe pins one API-issued holder",
        isUuid(firstHolder) && binding?.holderId === firstHolder &&
        occupancy?.sessionId === sessionId && occupancy?.selectionId === selectionId &&
        occupancy?.scope?.connectionId === scope.connectionId,
        { occupancy, binding });
      return toolCall(body, "computer_act", {
        action: "click", observation_id: observationId, ref: "e1",
      }, "call_click") ?? message("missing click tool");
    }
    if (step === 4) {
      const click = output(body, "call_click");
      record("click effect reaches the next model request", click?.ok === true && click?.effect === "done", click);
      const occupancy = parseJson(await redisClient.get(occupancyKey));
      record("a second observe reuses the pinned holder", occupancy?.holderId === firstHolder, occupancy);
      return toolCall(body, "computer_observe", {}, "call_observe_2") ?? message("missing second observe");
    }
    if (step === 5) {
      const observation = output(body, "call_observe_2");
      observationId = observation?.observation_id;
      return toolCall(body, "computer_act", {
        action: "type", observation_id: observationId, ref: "e2", text: typedText,
      }, "call_type") ?? message("missing type tool");
    }
    if (step === 6) {
      const type = output(body, "call_type");
      record("Unicode type effect reaches the next model request",
        type?.ok === true && type?.effect === "done", type);
      const act = wireRequests.find(request => request.body?.kind === "act" &&
        request.body.input?.action === "type");
      record("the Unicode text reaches the Go bridge without a model selector",
        act?.body?.native_call_id === "call_type" && act?.body?.input?.text === typedText &&
        act?.body?.input?.observation_id === observationId && act?.body?.input?.ref === "e2" &&
        !JSON.stringify(act?.body).match(/bundle_id|selection_id|holder_id|session_id|window|pid|path/u),
        act?.body);
      return message("COMPUTER_JOINED_OK");
    }
    return message("COMPUTER_JOINED_OK");
  });

  const codexHome = join(root, ".codex");
  const workspace = join(root, "workspace");
  await mkdir(codexHome, { recursive: true });
  await mkdir(workspace, { recursive: true });
  client = new CodexJsonRpcClient({
    command,
    userHome: root,
    codexHome,
    logger: pino({ enabled: false }),
    configOverrides: [
      'model_provider="fixture"',
      'model="gpt-5.4"',
      'model_providers.fixture.name="Fixture"',
      'model_providers.fixture.wire_api="responses"',
      `model_providers.fixture.base_url=${JSON.stringify(provider.url)}`,
      "model_providers.fixture.requires_openai_auth=false",
      "features.memories=false",
      `mcp_servers.computer_fixture.url=${JSON.stringify(mcp.url)}`,
      "mcp_servers.computer_fixture.enabled=true",
      "mcp_servers.computer_fixture.required=true",
      "mcp_servers.computer_fixture.startup_timeout_sec=20",
      "mcp_servers.computer_fixture.tool_timeout_sec=30",
      'mcp_servers.computer_fixture.tools.computer_act.approval_mode="approve"',
    ],
  });
  const notifications = [];
  client.on("notification", notification => notifications.push(notification));
  await client.initialize();
  const thread = await client.request("thread/start", {
    cwd: workspace, model: "gpt-5.4", modelProvider: "fixture",
    approvalPolicy: "never", sandbox: "read-only",
  });
  const threadId = thread.thread.id;
  await waitFor(() => notifications.some(notification =>
    notification.method === "mcpServer/startupStatus/updated" &&
    notification.params?.name === "computer_fixture" && notification.params?.status === "ready"),
  30_000, "the loopback MCP fixture did not become ready");
  const turn = await client.request("turn/start", {
    threadId,
    input: [{ type: "text", text: "Exercise the joined computer fixture.", text_elements: [] }],
    collaborationMode: {
      mode: "default",
      settings: { model: "gpt-5.4", reasoning_effort: "low", developer_instructions: null },
    },
  });
  await waitFor(() => notifications.some(notification =>
    notification.method === "turn/completed" && notification.params?.turn?.id === turn.turn.id),
  60_000, "the joined computer fixture turn did not complete");
  const completed = notifications.find(notification =>
    notification.method === "turn/completed" && notification.params?.turn?.id === turn.turn.id);
  assert.equal(completed.params.turn.status, "completed");
  record("the model turn completed after the tool round trips",
    provider.captures.length >= 6, { modelRequests: provider.captures.length });

  // Wrong run bearer: the same canonical scope with a well-formed foreign token.
  const wrong = linkState.runFor(`lsdr_${"Z".repeat(43)}`).executor;
  await assert.rejects(
    wrong.status({ target, signal: AbortSignal.timeout(10_000) }),
    error => error?.code === "COMPUTER_ACCESS_DENIED",
    "a foreign run bearer must be rejected",
  );
  record("a wrong run bearer is rejected by the real run lease", true);

  // A new authorized tool request with the same native call ID is not replayed.
  const duplicate = await linkState.runFor(credentials.run_token).executor.act({
    target, nativeCallId: "call_type", observationId, ref: "e2",
    action: "type", text: typedText, timeoutMs: 8_000,
    signal: AbortSignal.timeout(10_000),
  });
  record("a new request with the same native call ID is rejected",
    duplicate.ok === false && duplicate.error === "RUNNER_OPERATION_UNCERTAIN", duplicate);

  const failed = checks.filter(entry => !entry.passed);
  record("all joined checks passed", failed.length === 0, failed);
  const result = {
    version: CODEX_SCHEMA_VERSION,
    linkId: scope.connectionId,
    modelRequests: provider.captures.length,
    toolRequests: wireRequests.length,
    checks: checks.map(entry => ({ name: entry.name, passed: entry.passed })),
  };
  console.log(JSON.stringify(result));
  assert.deepEqual(failed, []);
  await client.close();
  client = undefined;
  await linkState.close();
  linkState = undefined;
  await api.close();
  api = undefined;
  await redisFixture.close();
  redisFixture = undefined;
  await prisma.$disconnect();
  prisma = undefined;
} finally {
  await client?.close().catch(() => undefined);
  await mcp?.close().catch(() => undefined);
  await provider?.close().catch(() => undefined);
  await linkState?.close().catch(() => undefined);
  gateway?.kill("SIGTERM");
  await api?.close().catch(() => undefined);
  await redisFixture?.close().catch(() => undefined);
  await prisma?.$disconnect().catch(() => undefined);
  if (startedPostgres) {
    await execute("pg_ctl", ["-D", data, "-m", "immediate", "-w", "stop"], { timeout: 30_000 }).catch(() => undefined);
  }
  await rm(root, { recursive: true, force: true });
}

function writeLine(line) {
  return new Promise((resolve, reject) => {
    if (!gateway?.stdin?.writable) return reject(new Error("computer gateway stdin is closed"));
    gateway.stdin.write(`${line}\n`, error => error ? reject(error) : resolve());
  });
}

async function waitFor(condition, timeoutMs, failure) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await condition()) return;
    if (Date.now() >= deadline) throw new Error(failure);
    await new Promise(resolve => setTimeout(resolve, 25));
  }
}

function withTimeout(promise, timeoutMs, failure) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(failure)), timeoutMs).unref()),
  ]);
}

function parseJson(value) {
  if (typeof value !== "string") return null;
  try { return JSON.parse(value); } catch { return null; }
}

function isUuid(value) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(value);
}

async function freePort() {
  const server = createServer();
  server.once("error", () => undefined);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("missing test port");
  await new Promise(resolve => server.close(resolve));
  return address.port;
}
