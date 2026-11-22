import assert from "node:assert/strict";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  chmod, cp, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile,
} from "node:fs/promises";
import { createServer as createNetServer } from "node:net";
import { tmpdir, userInfo } from "node:os";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { createInterface } from "node:readline";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { conversationUserInputQuestionSchema } from "@linksense/shared";
import Fastify, { type FastifyInstance } from "fastify";
import { z } from "zod";

import { createPrismaClient } from "../../src/db.js";
import { sha256 } from "../../src/lib/crypto.js";
import { desktopComputerSelectionKey } from "../../src/modules/desktop-devices/computer-control.js";
import { localComputerGuiOccupancyKey } from "../../src/modules/local-computer/occupancy.js";
import { createRedisFixture } from "../fixtures/redis.js";
import { startJoinedComputerApi } from "./computer-use-joined.js";

/**
 * Joined M1b product-chain proof on a Mac test workstation.
 *
 * Boots the real Go device bridge (compiled from apps/desktop test code), the
 * real supervised Node runner, the official Core MCP server, and pinned Codex
 * against a loopback synthetic Responses provider. The API is the real Fastify
 * device socket plus `registerDesktopExecution` and the opt-in product
 * `DesktopComputerControl`; the Mac host uses the existing computer-control
 * state machine with a synthetic platform/executor. No real driver, app,
 * window, permission dialog, TCC, VM, downloaded image, production service or
 * secret is touched.
 *
 * Run only on a local Mac with initdb/pg_ctl/redis-server and a built shared +
 * runner. `LINKSENSE_JOINED_RUNTIME` must name the existing staged runtime as
 * read-only input; the proof copies it into a private fixture temp directory
 * before overlaying anything, so neither the checkout nor the supplied cache
 * is ever written.
 *   pnpm --filter @linksense/shared build
 *   pnpm --filter @linksense/runner build
 *   LINKSENSE_JOINED_RUNTIME=/path/to/read-only/runtime \
 *     pnpm --filter @linksense/api exec tsx test/integration/desktop-computer-product-chain.ts
 */

const execute = promisify(execFile);
const repositoryRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const fixtureModel = "joined-computer-fixture";
const privateMarker = `private-joined-${randomUUID()}`;
const runtimeUsage =
  "LINKSENSE_JOINED_RUNTIME must be an absolute path to the existing read-only staged desktop runtime";
const runtimeInput = process.env.LINKSENSE_JOINED_RUNTIME?.trim();
if (!runtimeInput || !isAbsolute(runtimeInput)) {
  console.error(`JOINED_USAGE: ${runtimeUsage}`);
  process.exit(2);
}
const sourceRuntimeRoot = resolve(runtimeInput);

const root = await mkdtemp(join(tmpdir(), "linksense-joined-computer-"));
const watchdog = setTimeout(() => {
  console.error("JOINED_WATCHDOG: the joined proof exceeded its bounded run time");
  process.exit(2);
}, 240_000);
let succeeded = false;
let manifest: z.infer<typeof runtimeManifestSchema> | undefined;
let receipt: Record<string, unknown> | undefined;
const cleanupFailures: string[] = [];
const computerAuditMetadataKeys: ReadonlySet<string> = new Set([
  "operation", "conversation_id", "turn_id", "device_id", "computer_request", "delivery",
  "computer_action", "duration_ms", "reason_code",
]);
// computer_request is the bounded request kind; a wait attempt carries the
// existing delivery vocabulary (`unconfirmed`) instead of computer_action and
// never carries a timeout, an element ref or an observation id.
const observeAuditKeys = [
  "computer_request", "conversation_id", "device_id", "duration_ms", "operation", "turn_id",
].sort();
const waitAuditKeys = [...observeAuditKeys, "delivery"].sort();
const actAuditKeys = [...observeAuditKeys, "computer_action"].sort();
const failedActAuditKeys = [...actAuditKeys, "reason_code"].sort();
const computerAuditMetadataSchema = z.strictObject({
  operation: z.literal("computer.execute"),
  conversation_id: z.uuid(),
  turn_id: z.uuid(),
  device_id: z.uuid(),
  computer_request: z.enum(["status", "observe", "act", "wait"]),
  computer_action: z.enum(["click", "type"]).optional(),
  delivery: z.literal("unconfirmed").optional(),
  duration_ms: z.number().int().min(0).max(240_000),
  reason_code: z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/u).optional(),
});

const runtimeFileSchema = z.strictObject({
  path: z.enum(["bin/node", "bin/codex", "bin/agent-desktop", "bin/agent-desktop-macos-helper"]),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u),
});
const runtimeManifestSchema = z.strictObject({
  schema_version: z.literal(1),
  application: z.literal("org.linksense.desktop"),
  target: z.literal("darwin/arm64"),
  runtime_arch: z.literal("arm64"),
  versions: z.strictObject({
    node: z.string().regex(/^24\.\d+\.\d+$/u),
    codex: z.literal("0.170.0"),
    agent_desktop: z.literal("1.3.1"),
  }),
  files: z.array(runtimeFileSchema).length(4).superRefine((files, context) => {
    if (new Set(files.map(file => file.path)).size !== files.length) {
      context.addIssue({ code: "custom", message: "the runtime manifest repeats a pinned file" });
    }
  }),
});

// ---------------------------------------------------------------------------
// Disposable PostgreSQL and Redis. Never loads the application .env.
// ---------------------------------------------------------------------------
const data = join(root, "pgdata");
let port = 0;
const databaseUrl = (name: string) => {
  const url = new URL(`postgresql://127.0.0.1:${port}/${name}`);
  url.username = userInfo().username;
  return url.toString();
};
let pgStarted = false;
let db: ReturnType<typeof createPrismaClient> | undefined;
let redis: Awaited<ReturnType<typeof createRedisFixture>> | undefined;
let redisPid: number | undefined;
let child: ChildProcess | undefined;
let api: Awaited<ReturnType<typeof startJoinedComputerApi>> | undefined;
let model: FastifyInstance | undefined;
let modelOrigin: string | undefined;
/** Every synthetic model gate, rejected before close so no SSE body can hang cleanup. */
const gates: Array<(error: Error) => void> = [];

try {
  port = await freePort();
  const redisFixture = await createRedisFixture();
  redis = redisFixture;
  try {
    const serverInfo = await redisFixture.client.info("server");
    const match = /^process_id:(\d+)$/mu.exec(serverInfo);
    if (match) redisPid = Number(match[1]);
  } catch {
    // The fixture close still owns teardown; only the exit receipt is skipped.
    redisPid = undefined;
  }

  // -------------------------------------------------------------------------
  // Runtime staging: prove the read-only pinned input, then overlay only the
  // fresh private copy owned by this fixture.
  // -------------------------------------------------------------------------
  const sourceInfo = await lstat(sourceRuntimeRoot);
  if (!sourceInfo.isDirectory() || sourceInfo.isSymbolicLink()) {
    throw new Error(`JOINED_USAGE: ${runtimeUsage}`);
  }
  const sourceRoot = await realpath(sourceRuntimeRoot);
  for (const relative of [
    "bin", "runner", "runner/dist", "runner/node_modules", "runner/node_modules/@linksense",
    "runner/node_modules/@linksense/shared", "runner/node_modules/@linksense/shared/dist",
  ]) {
    await requireRealDirectory(sourceRoot, relative, "the staged runtime");
  }
  manifest = await readRuntimeManifest(sourceRoot);
  for (const file of manifest.files) {
    const path = join(sourceRoot, file.path);
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.size <= 0) {
      throw new Error(`the staged runtime ${file.path} is not a bounded regular file`);
    }
    assert.equal(await fileDigest(path), file.sha256,
      `the staged runtime ${file.path} does not match its pinned manifest`);
  }
  for (const relative of [
    "runner/dist/desktop-supervised.js", "runner/package.json",
    "runner/node_modules/@linksense/shared/dist/index.js",
  ]) {
    const info = await lstat(join(sourceRoot, relative));
    assert(info.isFile() && !info.isSymbolicLink() && info.size > 0,
      `the staged runtime is missing its packaged ${relative}`);
  }
  z.looseObject({ name: z.literal("@linksense/runner"), type: z.literal("module") })
    .parse(JSON.parse(await readFile(join(sourceRoot, "runner/package.json"), "utf8")));

  const stagedRuntimeRoot = join(root, "runtime");
  await cp(sourceRoot, stagedRuntimeRoot, { recursive: true, dereference: false });
  await chmod(stagedRuntimeRoot, 0o700);
  const stagedRoot = await realpath(stagedRuntimeRoot);
  assert.equal(stagedRoot, join(await realpath(root), "runtime"),
    "the disposable runtime copy must stay inside the fixture directory");
  for (const file of manifest.files) {
    assert.equal(await fileDigest(join(stagedRoot, file.path)), file.sha256,
      `the disposable copy of ${file.path} does not match its pinned manifest`);
  }

  await replaceRuntimeDirectory(stagedRoot, "runner/dist", join(repositoryRoot, "apps/runner/dist"));
  await replaceRuntimeDirectory(stagedRoot, "runner/node_modules/@linksense/shared/dist",
    join(repositoryRoot, "packages/shared/dist"));

  // The only executable driver path in the disposable runtime is a sentinel: if
  // any product path actually invokes agent-desktop, it leaves a marker. Both
  // driver paths are proven to hold exactly that sentinel before any child
  // process starts.
  const driverProbe = join(root, "driver-probe");
  const driverSentinel = `#!/bin/sh\nprintf touched >> ${JSON.stringify(driverProbe)}\nexit 97\n`;
  const driverSentinelDigest = createHash("sha256").update(driverSentinel).digest("hex");
  const binDir = await requireRealDirectory(stagedRoot, "bin", "the disposable runtime");
  assert.deepEqual((await readdir(binDir)).sort(),
    ["agent-desktop", "agent-desktop-macos-helper", "codex", "node"],
    "the disposable runtime bin directory must contain only the pinned tools and both driver sentinels");
  for (const binary of ["agent-desktop", "agent-desktop-macos-helper"]) {
    const path = join(binDir, binary);
    const existing = await lstat(path);
    if (existing.isSymbolicLink() || !existing.isFile()) {
      throw new Error(`the disposable runtime ${binary} must be a regular file`);
    }
    await rm(path, { force: true });
    await writeFile(path, driverSentinel, { mode: 0o755 });
    await chmod(path, 0o755);
    const info = await lstat(path);
    assert(info.isFile() && !info.isSymbolicLink() && (info.mode & 0o111) !== 0 &&
      await fileDigest(path) === driverSentinelDigest,
    `the only executable driver at ${binary} must be the inert sentinel`);
  }
  assert.equal(
    (await execute(join(stagedRoot, "bin/codex"), ["--version"], { timeout: 10_000 })).stdout.trim(),
    "codex-cli 0.170.0",
    "the staged runtime must carry pinned Codex 0.170.0",
  );
  assert.equal(
    (await execute(join(stagedRoot, "bin/node"), ["--version"], { timeout: 10_000 })).stdout.trim(),
    `v${manifest.versions.node}`,
    "the staged runtime must carry its pinned Node runtime",
  );

  await execute("initdb", ["-D", data, "--auth=trust", "--encoding=UTF8", "--no-locale"], { timeout: 30_000 });
  await execute("pg_ctl", [
    "-D", data, "-l", join(root, "postgres.log"), "-w", "start",
    "-o", `-h 127.0.0.1 -p ${port} -c unix_socket_directories='' -c timezone=UTC`,
  ], { timeout: 30_000 });
  pgStarted = true;
  const pgControl = createPrismaClient(databaseUrl("postgres"));
  try {
    await pgControl.$executeRawUnsafe("CREATE DATABASE joined_computer");
  } finally {
    await pgControl.$disconnect();
  }
  await execute("pnpm", [
    "exec", "prisma", "migrate", "deploy",
    "--config", "apps/api/test/integration/prisma.config.ts",
  ], {
    cwd: repositoryRoot, timeout: 180_000, maxBuffer: 8_000_000,
    env: { ...process.env, DATABASE_URL: databaseUrl("joined_computer") },
  });
  db = createPrismaClient(databaseUrl("joined_computer"));

  const owner = await db.user.create({
    data: { email: `joined-computer-${randomUUID()}@example.test`, name: "Joined Owner", role: "user", status: "active" },
  });
  const token = randomBytes(32).toString("hex");
  const device = await db.desktopDevice.create({
    data: {
      ownerId: owner.id, tokenHash: sha256(token), authValidAfter: owner.authValidAfter,
      name: "Joined Mac", platform: "darwin", arch: "arm64", appVersion: "0.1.0",
    },
  });
  const conversationId = randomUUID();
  const runtimeGeneration = randomUUID();
  await db.conversation.create({
    data: {
      id: conversationId, ownerId: owner.id, title: "Joined computer fixture", titleSource: "manual",
      archiveStatus: "active", executionTarget: "local", desktopDeviceId: device.id,
      workspaceRelPath: `${owner.id}/services/${conversationId}/home/workspace`,
      runtimeGeneration,
    },
  });
  const workspaceRoot = join(root, "api-workspaces");
  const dataRoot = join(root, "native");
  await mkdir(workspaceRoot, { recursive: true, mode: 0o700 });
  await mkdir(join(dataRoot), { recursive: true, mode: 0o700 });

  api = await startJoinedComputerApi({
    prisma: db, redisClient: redisFixture.client, databaseUrl: databaseUrl("joined_computer"),
    workspaceRoot, ownerId: owner.id, deviceId: device.id, conversationId,
    runtimeGeneration, product: true,
  });
  assert(api.control(), "the product DesktopComputerControl must be composed");
  assert.equal(api.fixture(), undefined, "the fixture-only API computer interceptor must be absent");

  // -------------------------------------------------------------------------
  // Synthetic local Responses provider.
  // -------------------------------------------------------------------------
  model = Fastify({ forceCloseConnections: true });
  const providerKey = randomUUID();
  const captures: Array<Record<string, unknown>> = [];
  let modelFailure: string | undefined;
  let phase = 0;
  let lastObservationId = "";
  let resumeObservationId = "";
  const gate = <T>() => {
    let resolve!: (value: T) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<T>((settle, fail) => { resolve = settle; reject = fail; });
    void promise.catch(() => undefined);
    gates.push(reject);
    return { promise, resolve };
  };
  const selectionGate = gate<void>();
  const pauseGate = gate<void>();
  const resumeGate = gate<void>();
  const stopGate = gate<void>();
  const renewGate = gate<void>();
  const firstRequest = gate<void>();
  const observeResult = gate<Record<string, unknown>>();
  const denyResult = gate<Record<string, unknown>>();
  const approvedResult = gate<Record<string, unknown>>();
  const mutationObserved = gate<Record<string, unknown>>();
  const renewalStaleResult = gate<Record<string, unknown>>();
  const renewalObserved = gate<Record<string, unknown>>();
  const pausedActResult = gate<Record<string, unknown>>();
  const staleActResult = gate<Record<string, unknown>>();
  const resumeObserved = gate<Record<string, unknown>>();
  const waitMetResult = gate<Record<string, unknown>>();
  const waitTimedOutResult = gate<Record<string, unknown>>();
  const stoppedActResult = gate<Record<string, unknown>>();

  let rejectModel: ((error: Error) => void) | undefined;
  const modelFailed = new Promise<never>((_resolve, reject) => { rejectModel = reject; });
  void modelFailed.catch(() => undefined);
  model.setErrorHandler((error, _request, reply) => {
    modelFailure = error instanceof Error ? error.message : String(error);
    rejectModel?.(new Error(`Synthetic provider: ${modelFailure}`));
    void reply.code(400).send({ error: { code: "invalid_fixture_request" } });
  });
  model.post("/v1/responses", async (request, reply) => {
    assert.equal(request.headers.authorization, `Bearer ${providerKey}`, "provider authorization mismatch");
    const body = z.looseObject({
      model: z.string(), input: z.unknown(), stream: z.literal(true),
      tools: z.array(z.looseObject({ type: z.string(), name: z.string().optional() })).optional(),
    }).parse(request.body);
    captures.push(body);
    const serialized = JSON.stringify(body);
    assert(!serialized.includes(privateMarker), "a private native selection marker reached the model");
    assert(!serialized.includes(dataRoot), "a desktop data path reached the model");
    assert(!serialized.includes("data_base64"), "a screenshot payload reached the model");
    const current = phase++;
    const item = await script(current, body as Record<string, unknown>);
    reply.type("text/event-stream").send(responseStream(item));
  });
  async function script(current: number, body: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (current === 0) {
      firstRequest.resolve();
      await selectionGate.promise;
      return toolCall(body, "computer_observe", {}, "joined-call-1");
    }
    if (current === 1) {
      const observation = toolResult(body, "joined-call-1");
      assertObservation(observation, "initial observation");
      lastObservationId = observation.observation_id;
      observeResult.resolve(observation);
      return toolCall(body, "computer_act", {
        action: "click", observation_id: lastObservationId,
        ref: observation.nodes.find(node => node.name === "Ready")?.ref ?? "@joined:e1",
      }, "joined-call-2");
    }
    if (current === 2) {
      const denied = toolResult(body, "joined-call-2");
      const deniedText = toolOutputTexts(body, "joined-call-2").join("\n").toLowerCase();
      // Codex may surface the refusal as native cancellation text, or relay the
      // exact one-shot gate refusal as COMPUTER_ACCESS_DENIED. Both must have
      // caused zero executor effects.
      assert(!JSON.stringify(denied ?? "").includes('"ok":true') &&
        (deniedText.includes("cancel") || deniedText.includes("computer_access_denied")),
        `the denied act did not fail closed: ${deniedText}`);
      denyResult.resolve({ cancelled: true });
      return toolCall(body, "computer_act", {
        action: "click", observation_id: lastObservationId, ref: "@joined:e2",
      }, "joined-call-3");
    }
    if (current === 3) {
      const result = toolResult(body, "joined-call-3");
      approvedResult.resolve(result ?? {});
      return toolCall(body, "computer_observe", {}, "joined-call-4");
    }
    if (current === 4) {
      const observation = toolResult(body, "joined-call-4");
      assertObservation(observation, "post-mutation observation");
      mutationObserved.resolve(observation);
      // The explicit native renew runs while this lane is quiet: no act is
      // pending, no picker is open, and the observation below is still live.
      // The host refresh clears that observation, so its id/ref must fail.
      await renewGate.promise;
      return toolCall(body, "computer_act", {
        action: "click", observation_id: observation.observation_id,
        ref: observation.nodes.find(node => node.name === "Clicked 1")?.ref ?? "@joined:e1",
      }, "joined-call-5");
    }
    if (current === 5) {
      const result = toolResult(body, "joined-call-5");
      // The API selection is still the same, so the native host itself
      // refuses the cleared pre-renewal observation before any effect.
      assertFailure(result, "COMPUTER_ACCESS_DENIED", "pre-renewal observation act");
      renewalStaleResult.resolve(result ?? {});
      return toolCall(body, "computer_observe", {}, "joined-call-6");
    }
    if (current === 6) {
      const observation = toolResult(body, "joined-call-6");
      assertObservation(observation, "post-renewal observation");
      renewalObserved.resolve(observation);
      await pauseGate.promise;
      return toolCall(body, "computer_act", {
        action: "click", observation_id: observation.observation_id,
        ref: observation.nodes.find(node => node.name === "Clicked 1")?.ref ?? "@joined:e1",
      }, "joined-call-7");
    }
    if (current === 7) {
      const result = toolResult(body, "joined-call-7");
      assertFailure(result, "COMPUTER_UNAVAILABLE", "paused act");
      pausedActResult.resolve(result ?? {});
      await resumeGate.promise;
      return toolCall(body, "computer_act", {
        action: "click", observation_id: lastObservationId, ref: "@joined:e2",
      }, "joined-call-8");
    }
    if (current === 8) {
      const result = toolResult(body, "joined-call-8");
      assertFailure(result, "COMPUTER_STALE_OBSERVATION", "act after resume without observe");
      staleActResult.resolve(result ?? {});
      return toolCall(body, "computer_observe", {}, "joined-call-9");
    }
    if (current === 9) {
      const observation = toolResult(body, "joined-call-9");
      assertObservation(observation, "post-resume observation");
      resumeObservationId = observation.observation_id;
      resumeObserved.resolve(observation);
      // One fresh post-resume observation drives both bounded wait outcomes.
      // Wait is read-only: it consumes no approval and keeps the observation
      // usable for the later stopped act.
      return toolCall(body, "computer_wait", {
        observation_id: resumeObservationId, ref: "@joined:e1", timeout_ms: 1_000,
      }, "joined-call-11");
    }
    if (current === 10) {
      const result = toolResult(body, "joined-call-11");
      assertWaitResult(result, "met", 1_000, "wait on the actionable ref");
      waitMetResult.resolve(result ?? {});
      // The alternate ref is never actionable; a 100 ms bound is a normal
      // predicate expiry, not a tool/transport timeout.
      return toolCall(body, "computer_wait", {
        observation_id: resumeObservationId, ref: "@joined:e2", timeout_ms: 100,
      }, "joined-call-12");
    }
    if (current === 11) {
      const result = toolResult(body, "joined-call-12");
      assertWaitResult(result, "timed_out", 100, "wait on the non-actionable ref");
      waitTimedOutResult.resolve(result ?? {});
      await stopGate.promise;
      return toolCall(body, "computer_act", {
        action: "click", observation_id: resumeObservationId,
        ref: "@joined:e1",
      }, "joined-call-10");
    }
    if (current === 12) {
      const result = toolResult(body, "joined-call-10");
      assertFailure(result, "COMPUTER_UNAVAILABLE", "stopped act");
      stoppedActResult.resolve(result ?? {});
      return message("JOINED_COMPUTER_OK");
    }
    throw new Error(`unexpected model phase ${current}`);
  }

  modelOrigin = await model.listen({ host: "127.0.0.1", port: 0 });
  await api.modelProviderSettings.update(owner.id, {
    expected_revision: 0, default_model: fixtureModel, title_model: null,
    providers: [{
      id: "joined-computer", base_url: `${modelOrigin}/v1`, protocol_mode: "native_responses", api_key: providerKey,
      models: [{
        kind: "chat", id: fixtureModel, display_name: "Joined computer fixture", enabled: true,
        context_window: 32_768, supported_reasoning_efforts: ["low"], default_reasoning_effort: "low",
        supports_image_input: true, input_price_per_million: "10",
        cached_input_price_per_million: "2", output_price_per_million: "20",
      }],
    }],
  }, {});

  // -------------------------------------------------------------------------
  // Real Go bridge test binary: real runtime supervisor, device socket and
  // computer-control state machine with the synthetic platform seam.
  // -------------------------------------------------------------------------
  const binary = join(root, "joined-gateway");
  await execute("go", [
    "test", "-c", "-tags", "desktop_runtime_package", "-o", binary, ".",
  ], {
    cwd: join(repositoryRoot, "apps/desktop"),
    env: { ...process.env, GOPROXY: "off" },
    timeout: 180_000,
  });
  const gateway = spawn(binary, ["-test.run=^TestJoinedComputerGateway$", "-test.timeout=240s"], {
    env: {
      PATH: process.env.PATH,
      TMPDIR: process.env.TMPDIR,
      LINKSENSE_DESKTOP_RUNTIME_DIST: stagedRoot,
      LINKSENSE_JOINED_DRIVER_PROBE: driverProbe,
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  child = gateway;
  assert(gateway.stdin && gateway.stdout && gateway.stderr);
  let nativeOutput = "";
  const lines: Array<Record<string, unknown>> = [];
  /** Every control result is also retained for the pending-renewal takeover proof. */
  const controlLog: Array<Record<string, unknown>> = [];
  const lineWaiters: Array<(value: Record<string, unknown>) => void> = [];
  createInterface({ input: gateway.stdout }).on("line", line => {
    nativeOutput = `${nativeOutput}\n${line}`.slice(-200_000);
    try {
      const value = JSON.parse(line) as Record<string, unknown>;
      if (value.event === "control") controlLog.push(value);
      const waiter = lineWaiters.shift();
      if (waiter) waiter(value); else lines.push(value);
    } catch {
      // Go test output and t.Log lines are not JSON.
    }
  });
  gateway.stderr.on("data", (chunk: Buffer) => {
    nativeOutput = `${nativeOutput}\n${chunk.toString()}`.slice(-200_000);
  });
  gateway.stdin.on("error", () => undefined);
  const nextLine = async (timeout: number): Promise<Record<string, unknown>> => {
    if (lines.length) return lines.shift()!;
    return await new Promise<Record<string, unknown>>((resolve, reject) => {
      const waiter = (value: Record<string, unknown>) => {
        clearTimeout(timer);
        resolve(value);
      };
      const timer = setTimeout(() => {
        // A timed-out waiter must leave the queue so a later line is never
        // delivered to a promise that already rejected.
        const index = lineWaiters.indexOf(waiter);
        if (index >= 0) lineWaiters.splice(index, 1);
        reject(new Error("joined gateway line timeout"));
      }, timeout);
      timer.unref();
      lineWaiters.push(waiter);
    });
  };
  const waitEvent = async (
    event: string, predicate: (line: Record<string, unknown>) => boolean = () => true, timeout = 60_000,
  ): Promise<Record<string, unknown>> => {
    const deadline = Date.now() + timeout;
    for (;;) {
      if (modelFailure) throw new Error(`Synthetic provider: ${modelFailure}`);
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error(`joined gateway timed out waiting for ${event}: ${nativeOutput.slice(-4000)}`);
      const line = await nextLine(remaining);
      if (line.event === event && predicate(line)) return line;
    }
  };
  const send = (command: Record<string, unknown>) => {
    gateway.stdin.write(`${JSON.stringify(command)}\n`);
  };
  gateway.stdin.write(`${JSON.stringify({
    origin: api.origin, dataRoot,
    credential: { token, ownerId: owner.id, deviceId: device.id, name: "Joined Mac" },
    privateMarker, driverProbe,
  })}\n`);
  await waitEvent("ready", () => true, 90_000);

  const waitFor = async <T>(label: string, check: () => Promise<T | null | false>, timeout = 60_000): Promise<T> => {
    const deadline = Date.now() + timeout;
    for (;;) {
      if (modelFailure) throw new Error(`Synthetic provider: ${modelFailure}`);
      const value = await check();
      if (value !== null && value !== false) return value;
      if (Date.now() >= deadline) throw new Error(`timed out waiting for ${label}; native tail: ${nativeOutput.slice(-2000)}`);
      await delay(50);
    }
  };
  const withTimeout = async <T>(label: string, promise: Promise<T>, timeout = 60_000): Promise<T> => {
    let timer: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`timed out waiting for ${label}`)), timeout);
      timer.unref();
    });
    try {
      return await Promise.race([promise, modelFailed, timeoutPromise]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
  const controlAction = async (action: string, expected: string): Promise<Record<string, unknown>> => {
    send({ action, conversation_id: conversationId, turn_id: turn.turn_id });
    const line = await waitEvent("control", value => value.action === action, 45_000);
    assert.equal(line.error, undefined, `${action} failed: ${String(line.error)}`);
    assert.equal(line.state, expected, `${action} did not reach ${expected}`);
    return line;
  };
  const stats = async () => {
    send({ action: "stats" });
    return await waitEvent("stats");
  };
  const controlEventsSince = (index: number, action: string): Array<Record<string, unknown>> =>
    controlLog.slice(index).filter(line => line.action === action);
  const waitControlEvent = async (
    action: string, since: number, timeout = 45_000,
  ): Promise<Record<string, unknown>> => {
    return await waitFor(`the ${action} control result`, async () => {
      const line = controlLog.slice(since).find(candidate => candidate.action === action);
      return line ?? null;
    }, timeout);
  };
  /**
   * Holds the production conversation row lock from the fixture so a renewal's
   * locked select cannot commit or publish its positive ACK. The same lock is
   * what public stop and renewal already order on; this adds no instrumentation
   * to the API and performs no authorization bypass.
   */
  const holdConversationGate = async (): Promise<{
    pid: number; release: () => void; done: Promise<void>;
  }> => {
    let release!: () => void;
    const released = new Promise<void>(resolve => { release = resolve; });
    let ready!: (pid: number) => void;
    const readyPid = new Promise<number>(resolve => { ready = resolve; });
    const done = db!.$transaction(async tx => {
      const [row] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid()::int AS pid`;
      await tx.$queryRawUnsafe(
        "SELECT id FROM conversations WHERE id = $1::uuid FOR NO KEY UPDATE", conversationId);
      ready(row!.pid);
      await released;
    }, { maxWait: 5_000, timeout: 30_000 });
    // The caller awaits `done`; this keeps an early transaction failure from
    // becoming an unhandled rejection before that await.
    void done.catch(() => undefined);
    return { pid: await withTimeout("the conversation row gate", readyPid, 10_000), release, done };
  };
  /** True while a backend is waiting on exactly the gate's conversation lock. */
  const gateBlocksBackend = async (pid: number): Promise<boolean> => {
    const rows = await db!.$queryRaw<Array<{ blocked: number }>>`
      SELECT count(*)::int AS blocked
      FROM pg_stat_activity waiter
      WHERE waiter.datname = current_database()
        AND waiter.wait_event_type = 'Lock'
        AND ${pid}::int = ANY(pg_blocking_pids(waiter.pid))
        AND waiter.query LIKE '%FOR NO KEY UPDATE OF c%'`;
    return (rows[0]?.blocked ?? 0) > 0;
  };
  const approval = async () => {
    return await waitFor("a pending native computer_act approval", async () => {
      const request = await db!.conversationUserInputRequest.findFirst({
        where: {
          ownerId: owner.id, conversationId, turnId: turn.turn_id,
          requestKind: "questions", status: "pending",
        },
        orderBy: { createdAt: "asc" },
        select: { id: true, questionsJson: true },
      });
      if (!request) return null;
      const [question] = z.tuple([conversationUserInputQuestionSchema]).parse(request.questionsJson);
      if (!question.id.startsWith("mcp_tool_call_approval_")) return null;
      return { id: request.id, question };
    }, 45_000);
  };
  const answer = async (request: Awaited<ReturnType<typeof approval>>, choice: "Allow" | "Cancel") => {
    const option = request.question.options?.find(candidate => candidate.label === choice);
    assert(option, `native approval did not offer ${choice}`);
    const response = await api!.conversations.respondToUserInputRequest(owner.id, conversationId, request.id, {
      action: "accept", content: { [request.question.id]: option.label },
    }, {});
    assert.equal(response.status, "answered");
  };

  // The durable recovery marker is required before any turn admission; the
  // fixture process has no recovery scheduler, so it records the same
  // successful baseline that a real API startup would publish.
  await api.redisClient.hset("linksense:running-turn-recovery-status",
    "outcome", "succeeded", "last_success_at", new Date().toISOString());

  const turn = await api.conversations.acceptTurn(owner.id, conversationId, {
    inputText: "Exercise the joined Mac computer fixture.",
    idempotencyKey: randomUUID(), submitMode: "normal", priorityCapabilityIds: [],
  }, {});
  await withTimeout("the first synthetic model request", firstRequest.promise, 60_000);
  await waitFor("the materialized running local turn", async () => {
    const current = await db!.conversation.findUniqueOrThrow({
      where: { id: conversationId }, select: { codexThreadId: true },
    });
    if (!current.codexThreadId) return null;
    const row = await db!.conversationTurn.findFirst({
      where: { id: turn.turn_id, conversationId, status: "running" },
      select: { codexThreadId: true, collaborationMode: true },
    });
    return row && row.codexThreadId === current.codexThreadId ? row : null;
  }, 60_000);
  assert.equal(await db.localComputerSession.count({ where: { conversationId } }), 0,
    "no session may exist before the native selection");
  assert.equal(await db.computerPermissionGrant.count({ where: { conversationId } }), 0,
    "no grant may exist before the native selection");

  const selected = await controlAction("select", "active");
  const selectedExpiresAt = Date.parse(String(selected.expiresAt));
  const selectionId = String(selected.selectionId);
  assert(Number.isFinite(selectedExpiresAt), "select must return a bounded expiry");
  assert.match(selectionId, /^[0-9a-f-]{36}$/u, "select must return the native selection id");
  const selectedStats = await stats();
  assert.equal(selectedStats.picks, 1, "select must open exactly one native picker");
  assert.equal(selectedStats.executors, 1, "select must construct exactly one executor");
  const sessions = await db.localComputerSession.findMany({
    where: { conversationId }, select: { id: true, status: true, expiresAt: true },
  });
  assert.equal(sessions.length, 1, "select must prepare exactly one local computer session");
  assert.equal(sessions[0]?.status, "active");
  const selectedSessionId = sessions[0]!.id;
  assert.equal(selected.sessionId, selectedSessionId, "select must report the prepared session");
  assert(Math.abs((sessions[0]!.expiresAt?.getTime() ?? 0) - selectedExpiresAt) < 1_000,
    "select must report the persisted selection expiry");
  const grants = await db.computerPermissionGrant.findMany({
    where: { conversationId, sessionId: selectedSessionId },
    select: { id: true, capability: true, targetJson: true, expiresAt: true },
  });
  assert.deepEqual(grants.map(grant => grant.capability).sort(), ["computer.act", "computer.observe"]);
  assert(grants.every(grant => (grant.targetJson as { bundle_id?: string }).bundle_id === "com.example.LinkSenseProductFixture"));
  selectionGate.resolve();

  const observed = await withTimeout("the initial observation", observeResult.promise);
  assert.match(observed.observation_id as string, /^[0-9a-f]{32}$/u);

  const deniedApproval = await approval();
  assert.deepEqual(deniedApproval.question.options?.map(option => option.label).sort(), ["Allow", "Cancel"]);
  const beforeDeny = await stats();
  assert.equal((beforeDeny.stats as { acts: number }).acts, 0, "the denied act reached the executor");
  assert.equal((beforeDeny.stats as { mutations: number }).mutations, 0);
  assert.equal(await computerAuditCount("success"), 1, "the denied act was audited as a success");
  await answer(deniedApproval, "Cancel");
  await withTimeout("the denial result", denyResult.promise);
  const afterDeny = await stats();
  assert.equal((afterDeny.stats as { acts: number }).acts, 0, "the denied act was replayed");

  const approvedApproval = await approval();
  // Measured wall-clock deliberation after the prior observation and Cancel:
  // no clock adjustment, and the native lease/occupancy heartbeat must keep
  // the same observation and approval usable past the 45 second GUI TTL.
  const deliberationStartedAt = Date.now();
  await delay(46_000);
  const deliberationMs = Date.now() - deliberationStartedAt;
  assert(deliberationMs > 45_000,
    `the native Allow must be measured after more than 45 seconds, observed ${deliberationMs}ms`);
  await answer(approvedApproval, "Allow");
  const approved = await withTimeout("the approved act result", approvedResult.promise);
  const afterApproved = await stats();
  assert.equal(approved.ok, true,
    `the approved act failed: ${JSON.stringify(approved)}; executor=${JSON.stringify(afterApproved)}; native=${nativeOutput.slice(-4000)}`);
  assert.equal(approved.effect, "done");
  const mutatedObservation = await withTimeout("the post-mutation observation", mutationObserved.promise);
  const afterMutation = await stats();
  assert.equal((afterMutation.stats as { mutations: number }).mutations, 1,
    `the approved act did not mutate the synthetic state: approved=${JSON.stringify(approved)} observation=${JSON.stringify(mutatedObservation)} executor=${JSON.stringify(afterMutation)}`);
  assert((mutatedObservation.nodes as Array<{ name?: string }>).some(node => node.name === "Clicked 1"),
    `post-mutation observation did not reflect the mutation: ${JSON.stringify(mutatedObservation)}`);
  assert.deepEqual((afterMutation.stats as { acts: number }).acts, 1);
  assert.deepEqual((afterMutation.stats as { mutations: number }).mutations, 1);
  const approvedNativeIds = (afterMutation.stats as { act_native_ids: string[] }).act_native_ids;
  assert.equal(approvedNativeIds.length, 1,
    "the approved act must reach the executor exactly once under its own native call id");
  const approvedNativeId = approvedNativeIds[0]!;
  assert.match(approvedNativeId, /^[A-Za-z0-9_.:-]{1,128}$/u, "the native call id must be bounded");

  // -------------------------------------------------------------------------
  // Explicit renewal of the exact live selection while the native lane is
  // quiet: no picker, target switch, new executor, session, selection or grant.
  // -------------------------------------------------------------------------
  const beforeRenew = await stats();
  assert.equal((beforeRenew.stats as { observes: number }).observes, 2);
  const renewed = await controlAction("renew", "active");
  const renewedExpiresAt = Date.parse(String(renewed.expiresAt));
  assert(Number.isFinite(renewedExpiresAt), "renew must return a bounded expiry");
  assert(renewedExpiresAt > selectedExpiresAt, "explicit renew must strictly advance the selection expiry");
  assert.equal(renewed.sessionId, selectedSessionId, "renew must keep the same server session");
  assert.equal(renewed.selectionId, selectionId, "renew must keep the exact native selection");
  assert.equal(renewed.runtimeGeneration, selected.runtimeGeneration,
    "renew must keep the runtime generation");
  const afterRenew = await stats();
  assert.equal(afterRenew.picks, 1, "explicit renew must not open a picker or switch target");
  assert.equal(afterRenew.executors, 1, "explicit renew must not build another executor");
  assert.equal(afterRenew.executor, true);
  assert.equal(afterRenew.inputOpen, true, "explicit renew must leave local input open");
  assert.equal(afterRenew.gateInstalled, true);
  assert.equal((afterRenew.stats as { observes: number }).observes,
    (beforeRenew.stats as { observes: number }).observes, "explicit renew must not observe by itself");
  const renewedSessions = await db.localComputerSession.findMany({
    where: { conversationId }, select: { id: true, status: true, expiresAt: true },
  });
  assert.equal(renewedSessions.length, 1, "renew must not prepare a second session");
  assert.equal(renewedSessions[0]!.id, selectedSessionId);
  assert.equal(renewedSessions[0]!.status, "active");
  assert((renewedSessions[0]!.expiresAt?.getTime() ?? 0) > (sessions[0]!.expiresAt?.getTime() ?? 0),
    "the renewed session expiry must strictly advance");
  assert(Math.abs((renewedSessions[0]!.expiresAt?.getTime() ?? 0) - renewedExpiresAt) < 1_000,
    "the renewed session must carry the acknowledged expiry");
  const renewedGrants = await db.computerPermissionGrant.findMany({
    where: { conversationId, sessionId: selectedSessionId },
    select: { id: true, capability: true, expiresAt: true },
  });
  assert.deepEqual(renewedGrants.map(grant => grant.id).sort(), grants.map(grant => grant.id).sort(),
    "renew must keep the exact grants");
  assert(renewedGrants.every(grant => Math.abs((grant.expiresAt?.getTime() ?? 0) - renewedExpiresAt) < 1_000),
    "renew must extend both grants to the renewed expiry");

  // The host refresh clears the pre-renewal observation, so that exact id/ref
  // must fail before a fresh observe can act again.
  renewGate.resolve();
  const renewalApproval = await approval();
  await answer(renewalApproval, "Allow");
  const renewalStale = await withTimeout("the pre-renewal observation act result", renewalStaleResult.promise);
  assert.equal(renewalStale.ok, false,
    "the pre-renewal observation must be refused before any effect");
  assert.equal(renewalStale.error, "COMPUTER_ACCESS_DENIED");
  const freshRenewalObservation = await withTimeout("the post-renewal observation", renewalObserved.promise);
  assert.match(freshRenewalObservation.observation_id as string, /^[0-9a-f]{32}$/u);
  assert.notEqual(freshRenewalObservation.observation_id, mutatedObservation.observation_id,
    "renewal must require a fresh observation id");

  await controlAction("pause", "paused");
  pauseGate.resolve();
  const pausedApproval = await approval();
  const beforePausedAct = await stats();
  assert.equal((beforePausedAct.stats as { acts: number }).acts, 1);
  await answer(pausedApproval, "Allow");
  await withTimeout("the paused act result", pausedActResult.promise);

  const resumed = await controlAction("resume", "active");
  resumeGate.resolve();
  const staleApproval = await approval();
  await answer(staleApproval, "Allow");
  await withTimeout("the stale-observation act result", staleActResult.promise);
  const afterResumeObserve = await withTimeout("the post-resume observation", resumeObserved.promise);
  assert.match(afterResumeObserve.observation_id as string, /^[0-9a-f]{32}$/u);

  // Both waits reuse that one fresh observation and its two refs. The met
  // predicate returns the fixture state immediately; the alternate ref is
  // never actionable and expires at the explicit 100 ms predicate bound. A
  // timed_out wait is a normal bounded result, not a tool transport timeout.
  const waitMet = await withTimeout("the wait met result", waitMetResult.promise);
  assertWaitResult(waitMet, "met", 1_000, "wait on the actionable ref");
  const waitTimedOut = await withTimeout("the wait timed_out result", waitTimedOutResult.promise);
  assertWaitResult(waitTimedOut, "timed_out", 100, "wait on the non-actionable ref");
  assert.equal(waitMet.observation_id, undefined,
    "a wait result must not echo the observation id");
  assert.equal(waitTimedOut.ref, undefined, "a wait result must not echo an element ref");
  const waitStats = await stats();
  const waitCounters = waitStats.stats as {
    waits: number; wait_met: number; wait_timed_out: number; wait_failed: number;
    wait_in_flight: number; wait_refs: string[]; wait_observation_ids: string[];
    wait_timeouts: number[]; acts: number; authorizations: number; mutations: number;
    observes: number; act_native_ids: string[];
  };
  assert.equal(waitCounters.waits, 2, "both waits must reach the executor exactly once");
  assert.equal(waitCounters.wait_met, 1);
  assert.equal(waitCounters.wait_timed_out, 1);
  assert.equal(waitCounters.wait_failed, 0, "a predicate expiry is not a wait failure");
  assert.equal(waitCounters.wait_in_flight, 0);
  assert.deepEqual(waitCounters.wait_refs, ["@joined:e1", "@joined:e2"]);
  assert.deepEqual(waitCounters.wait_observation_ids,
    [afterResumeObserve.observation_id, afterResumeObserve.observation_id],
    "both waits must reuse the one fresh post-resume observation");
  assert.deepEqual(waitCounters.wait_timeouts, [1_000, 100]);
  // Wait never claims an act, an authorization, a native call or a mutation.
  assert.equal(waitCounters.acts, 1);
  assert.equal(waitCounters.authorizations, 1);
  assert.equal(waitCounters.mutations, 1);
  assert.equal(waitCounters.observes, 4);
  assert.deepEqual(waitCounters.act_native_ids, [approvedNativeId],
    "wait must not consume or add a native act call id");
  assert.equal(await db.conversationUserInputRequest.count({
    where: { ownerId: owner.id, conversationId, turnId: turn.turn_id, status: "pending" },
  }), 0, "wait must not open an approval or pending input request");

  // The native resume is a new selection id in the same server session. Prove
  // the live API selection and the native adopted holder are exactly that pair
  // before the stop frame uses them.
  const postResumeOccupancy = JSON.parse(
    await api.redisClient.get(localComputerGuiOccupancyKey(device.id)) ?? "null",
  ) as { holderId?: string; selectionId?: string } | null;
  const postResumeStats = await stats();
  assert.equal(postResumeStats.hostHasHolder, true,
    "the post-resume observe must adopt the API holder on the native host");
  assert.equal(postResumeStats.hostHolder, postResumeOccupancy?.holderId,
    "the native host must hold exactly the API post-resume holder");
  assert.equal(postResumeStats.hostBindingMatches, true,
    "the native host binding must match the resumed selection");
  const resumedSelectionId = String(resumed.selectionId);
  const selectionKey = desktopComputerSelectionKey({
    ownerId: owner.id, deviceId: device.id, conversationId,
    turnId: turn.turn_id, runtimeGeneration,
  });
  const liveSelection = JSON.parse(await api.redisClient.get(selectionKey) ?? "null") as {
    selectionId?: string; state?: string; expiresAt?: number; controlEpoch?: string;
    pendingInput?: unknown;
  } | null;
  assert(liveSelection, "the resumed selection metadata must be live before stop");
  assert.equal(liveSelection.selectionId, resumedSelectionId,
    "the server selection must match the native resumed selection before stop");
  assert.equal(liveSelection.state, "active");
  assert.equal(liveSelection.pendingInput, null,
    "read-only waits must leave the exact selection's pending input unclaimed");
  const preStopExpiresAt = Number(liveSelection.expiresAt);
  const preStopControlEpoch = String(liveSelection.controlEpoch);
  assert(Number.isFinite(preStopExpiresAt) && preStopExpiresAt > 0,
    "the resumed selection must carry a bounded expiry");
  assert.match(preStopControlEpoch, /^[0-9a-f-]{36}$/u,
    "the resumed selection must carry its control epoch");
  assert.equal(typeof postResumeOccupancy?.holderId, "string",
    "the resumed selection must hold the exact GUI occupancy holder");
  const preStopStats = await stats();
  assert.equal(preStopStats.statsSelectionId, resumedSelectionId,
    "the native selection must remain the resumed one before stop");
  assert.equal(Date.parse(String(preStopStats.selectionExpiresAt)), preStopExpiresAt,
    "the native host must still hold the pre-renewal grant when the takeover starts");

  // -------------------------------------------------------------------------
  // Stop takeover of a pending same-selection renewal. The fixture holds the
  // production conversation row lock, so the renewal's locked select cannot
  // commit or publish its positive ACK. A Stop on the same real device socket
  // must then be reserved for that exact pending selection instead of being
  // rejected as an overlapping control.
  // -------------------------------------------------------------------------
  const stopMark = controlLog.length;
  let takeoverReceipt: Record<string, unknown> | undefined;
  let rowGate: Awaited<ReturnType<typeof holdConversationGate>> | undefined;
  try {
    rowGate = await holdConversationGate();
    send({ action: "renew_async", conversation_id: conversationId, turn_id: turn.turn_id });
    await waitFor("the pending renewal to block on the conversation lock", async () =>
      await gateBlocksBackend(rowGate!.pid), 20_000);
    assert.equal(controlEventsSince(stopMark, "renew").length, 0,
      "the renewal must still be pending when Stop is sent");
    const holdMark = controlLog.length;
    send({ action: "stop", conversation_id: conversationId, turn_id: turn.turn_id });
    // Bounded observation window while the renewal remains provably pending.
    // A rejected overlapping Stop answers RUNNER_OPERATION_UNCERTAIN over the
    // local loopback long before this window ends.
    const holdUntil = Date.now() + 1_000;
    while (Date.now() < holdUntil) await delay(50);
    const renewalStillBlocked = await gateBlocksBackend(rowGate.pid);
    const stopReplies = controlEventsSince(holdMark, "stop");
    const supersededRenewals = controlEventsSince(holdMark, "renew");
    const takeoverEvidence = {
      renewalBlockedBeforeStop: true,
      renewalStillBlockedWhileStopPending: renewalStillBlocked,
      stopRepliesDuringPendingRenew: stopReplies.length,
      supersededRenewalCodes: supersededRenewals.map(line => String(line.error ?? "")),
    };
    assert.equal(renewalStillBlocked, true,
      `the renewal must remain pending while the Stop is accepted: ${JSON.stringify(takeoverEvidence)}`);
    assert.equal(stopReplies.length, 0,
      `the Stop must be parked for the pending renewal, not rejected: ${JSON.stringify(takeoverEvidence)}`);
    assert(supersededRenewals.every(line => typeof line.error === "string" && line.error !== ""),
      `a superseded renewal must never acknowledge active: ${JSON.stringify(takeoverEvidence)}`);

    rowGate.release();
    await withTimeout("the conversation row gate release", rowGate.done, 15_000);
    rowGate = undefined;

    const stopEvent = await waitControlEvent("stop", stopMark, 45_000);
    const renewalEvent = await waitControlEvent("renew", stopMark, 45_000);
    assert.equal(stopEvent.error, undefined, `the takeover Stop failed: ${String(stopEvent.error)}`);
    assert.equal(stopEvent.state, "stopped", "the takeover Stop must reach stopped");
    assert.equal(typeof renewalEvent.error, "string",
      "the pending renewal must fail closed instead of activating the local grant");
    const renewalLocalExpiry = renewalEvent.expiresAt === undefined || renewalEvent.expiresAt === ""
      ? Number.NaN : Date.parse(String(renewalEvent.expiresAt));
    assert(!Number.isFinite(renewalLocalExpiry) || renewalLocalExpiry <= preStopExpiresAt,
      "a superseded renewal must not widen or replace the native grant");
    assert.equal(controlEventsSince(stopMark, "stop").length, 1,
      "the takeover Stop must produce exactly one result");

    // The renewal's locked select committed while the reservation suppressed
    // its positive ACK. The stopped lease, exact session and both grants must
    // all be that renewal generation, not the pre-renewal one. The native
    // stopped status deliberately carries no expiry, so the exact committed
    // lease is the bounded proof.
    const stoppedLease = JSON.parse(await api.redisClient.get(selectionKey) ?? "null") as {
      state?: string; selectionId?: string; sessionId?: string; controlEpoch?: string;
      expiresAt?: number; pendingInput?: unknown;
    } | null;
    assert(stoppedLease, "the stopped selection metadata must remain bounded in Redis");
    const stoppedExpiresAt = Number(stoppedLease.expiresAt);
    assert(Number.isFinite(stoppedExpiresAt), "the stopped lease must carry a bounded expiry");
    assert(stoppedExpiresAt > preStopExpiresAt,
      "the takeover Stop must revoke the renewal-committed generation, not the pre-renewal one");
    assert(stoppedExpiresAt <= Date.now() + 5 * 60_000 + 30_000,
      "the renewal-committed expiry must stay inside the bounded renewal window");
    assert.equal(stoppedLease.state, "stopped");
    assert.equal(stoppedLease.selectionId, resumedSelectionId);
    assert.equal(stoppedLease.sessionId, selectedSessionId);
    assert.notEqual(stoppedLease.controlEpoch, preStopControlEpoch,
      "the stopped lease must be the renewal-advanced control epoch");
    assert.equal(stoppedLease.pendingInput, null,
      "the takeover Stop must leave no unproven pending input");
    assert.equal(await api.redisClient.get(localComputerGuiOccupancyKey(device.id)), null,
      "the takeover Stop must release the exact GUI holder");
    const stoppedSessions = await db.localComputerSession.findMany({
      where: { conversationId },
      select: { id: true, status: true, endedAt: true, expiresAt: true },
    });
    assert.equal(stoppedSessions.length, 1, "the takeover Stop must not prepare another session");
    assert.equal(stoppedSessions[0]!.id, selectedSessionId);
    assert.equal(stoppedSessions[0]!.status, "ended",
      "the takeover Stop must end the exact renewal session");
    assert(stoppedSessions[0]!.endedAt, "the takeover Stop must record the exact session end");
    assert.equal(stoppedSessions[0]!.expiresAt?.getTime(), stoppedExpiresAt,
      "the ended session must be the renewal-committed generation");
    const stoppedGrants = await db.computerPermissionGrant.findMany({
      where: { conversationId, sessionId: selectedSessionId },
      select: { capability: true, expiresAt: true, revokedAt: true },
    });
    assert.deepEqual(stoppedGrants.map(grant => grant.capability).sort(),
      ["computer.act", "computer.observe"]);
    assert(stoppedGrants.every(grant => grant.revokedAt !== null),
      "the takeover Stop must revoke both exact application grants");
    assert(stoppedGrants.every(grant => grant.expiresAt?.getTime() === stoppedExpiresAt),
      "the revoked grants must be the renewal-committed generation");
    takeoverReceipt = {
      ...takeoverEvidence,
      stoppedExpiryAdvanceMs: stoppedExpiresAt - preStopExpiresAt,
      stoppedLeaseEpochAdvanced: stoppedLease.controlEpoch !== preStopControlEpoch,
    };
  } catch (error) {
    const afterFailure = JSON.parse(await api.redisClient.get(selectionKey) ?? "null") as {
      selectionId?: string; state?: string; pendingInput?: { holderId?: string } | null;
    } | null;
    const occupancy = JSON.parse(await api.redisClient.get(localComputerGuiOccupancyKey(device.id)) ?? "null") as {
      holderId?: string; selectionId?: string; sessionId?: string;
    } | null;
    const afterStats = await stats().catch(() => undefined);
    const renewals = controlEventsSince(stopMark, "renew")
      .map(line => String(line.error ?? "unexpected-positive-ack"));
    const stops = controlEventsSince(stopMark, "stop")
      .map(line => `${String(line.state)}:${String(line.error ?? "ok")}`);
    throw new Error(`${error instanceof Error ? error.message : String(error)}; `
      + `native=${String(preStopStats.statsSelectionId)}; `
      + `gateHeld=${String(rowGate !== undefined)}; renewals=${renewals.join(",")}; stops=${stops.join(",")}; `
      + `serverBefore=${String(liveSelection.selectionId)}; serverAfter=${String(afterFailure?.selectionId)}; `
      + `stateAfter=${String(afterFailure?.state)}; pendingHolder=${String(afterFailure?.pendingInput?.holderId)}; `
      + `occSelection=${String(occupancy?.selectionId)}; occHolder=${String(occupancy?.holderId)}; `
      + `nativeAfter=${String(afterStats?.statsSelectionId)}; `
      + `postResumeHostHolder=${String(postResumeStats.hostHolder)}; `
      + `preStopHostHolder=${String(preStopStats.hostHolder)}; `
      + `preStopHostControls=${String(preStopStats.hostControls)}; `
      + `preStopBinding=${String(preStopStats.hostBindingMatches)}; `
      + `gateAfter=${String(afterStats?.gateInstalled)}; `
      + `hostBindingAfter=${String(afterStats?.hostBindingMatches)}`, { cause: error });
  } finally {
    if (rowGate) {
      rowGate.release();
      await withTimeout("the conversation row gate release", rowGate.done, 15_000).catch(() => undefined);
    }
  }
  stopGate.resolve();
  const stoppedApproval = await approval();
  await answer(stoppedApproval, "Allow");
  await withTimeout("the stopped act result", stoppedActResult.promise);
  const finalStats = await stats();
  assert.equal((finalStats.stats as { acts: number }).acts, 1, "only the one approved act may reach the executor");
  assert.deepEqual((finalStats.stats as { act_native_ids: string[] }).act_native_ids, [approvedNativeId],
    "no denied, stale or later act may reach the executor");
  assert.equal((finalStats.stats as { mutations: number }).mutations, 1, "the synthetic state mutated more than once");
  assert.equal((finalStats.stats as { observes: number }).observes, 4, "expected four observations");
  const finalWaitCounters = finalStats.stats as {
    waits: number; wait_met: number; wait_timed_out: number; wait_failed: number; wait_in_flight: number;
  };
  assert.equal(finalWaitCounters.waits, 2, "expected exactly two admitted waits");
  assert.equal(finalWaitCounters.wait_met, 1);
  assert.equal(finalWaitCounters.wait_timed_out, 1);
  assert.equal(finalWaitCounters.wait_failed, 0);
  assert.equal(finalWaitCounters.wait_in_flight, 0);
  assert.equal(finalStats.picks, 1, "only the initial select may open the native picker");
  assert.equal(finalStats.executors, 1, "only the initial select may build a native executor");
  assert.equal(finalStats.driverProbe, false, "the real agent-desktop driver was invoked");
  assert.equal(finalStats.statsSelectionId, "", "the takeover Stop must clear the native selection");
  assert.equal(finalStats.selectionExpiresAt, "", "the takeover Stop must clear the native grant");
  assert.equal(finalStats.inputOpen, false, "the takeover Stop must keep native input closed");
  assert.equal(finalStats.gateInstalled, false, "the takeover Stop must retire the exact executor");
  assert.equal(finalStats.controlState, "stopped", "the takeover Stop must publish stopped");

  await waitFor("the turn to complete", async () => {
    const row = await db!.conversationTurn.findUnique({
      where: { id: turn.turn_id }, select: { status: true, errorCode: true },
    });
    return row?.status === "completed" ? row : null;
  }, 60_000);
  assert.equal(await db.conversationTurn.count({ where: { conversationId } }), 1,
    "read-only waits must not create another turn");

  // Projection/audit must not contain native-only selection details, raw
  // screenshots or typed text. Native Codex private thread history is out of
  // scope here and deliberately retained by Codex.
  const eventRows = await db.conversationEvent.findMany({
    where: { conversationId }, select: { eventType: true, payloadJson: true },
  });
  const auditRows = await db.auditLog.findMany({
    where: { actorId: owner.id }, select: { action: true, targetType: true, result: true, metadataJson: true },
  });
  for (const row of [...eventRows, ...auditRows]) {
    const serialized = JSON.stringify(row);
    assert(!serialized.includes(privateMarker), "a private native marker leaked into API projection/audit");
    assert(!serialized.includes("data_base64"), "a screenshot payload leaked into API projection/audit");
    assert(!serialized.includes("screenshot"), "a screenshot field leaked into API projection/audit");
    // Synthetic secrets only; the assertion text never prints the values.
    assert(!serialized.includes(token), "the raw device credential leaked into API projection/audit");
    assert(!serialized.includes(providerKey), "the synthetic provider key leaked into API projection/audit");
  }
  const redisKeys = await api.redisClient.keys("*");
  for (const key of redisKeys) {
    if (await api.redisClient.type(key) !== "string") continue;
    const value = await api.redisClient.get(key);
    if (!value) continue;
    assert(!value.includes(privateMarker), `a private native marker leaked into Redis key ${key}`);
    assert(!value.includes("data_base64"), `a screenshot payload leaked into Redis key ${key}`);
    assert(!value.includes(providerKey), `the synthetic provider key leaked into Redis key ${key}`);
  }
  assert.equal(await computerAuditCount("success"), 7,
    "four observations, two bounded waits and the single approved act must be the only successful computer audits");
  assert.equal(await computerAuditCount("failure"), 4,
    "the pre-renewal, paused, post-resume and stopped acts must each fail closed in the audit projection");
  const failedAuditReasons = auditRows
    .filter(row => row.action === "desktop_tool_requested" && row.targetType === "local_computer" &&
      row.result === "failure")
    .map(row => (row.metadataJson as Record<string, unknown>).reason_code)
    .sort();
  assert.deepEqual(failedAuditReasons,
    ["COMPUTER_ACCESS_DENIED", "COMPUTER_STALE_OBSERVATION",
      "COMPUTER_UNAVAILABLE", "COMPUTER_UNAVAILABLE"]);
  const computerAudits = auditRows.filter(row =>
    row.action === "desktop_tool_requested" && row.targetType === "local_computer");
  assert.equal(computerAudits.length, 11,
    "four observations, two waits, one approved act and four failed acts must be audited");
  let successfulObserveAudits = 0;
  let successfulWaitAudits = 0;
  let successfulClickAudits = 0;
  let failedClickAudits = 0;
  for (const row of computerAudits) {
    // Strict typed allowlist: the sanitizer must retain only these bounded
    // fields. A missing producer field (for example a dropped duration, a
    // missing computer_request or a wait that lost its delivery tag) fails
    // here instead of silently flattening the audit projection.
    const metadata = computerAuditMetadataSchema.parse(row.metadataJson);
    const keys = Object.keys(metadata).sort();
    for (const key of keys) {
      assert(computerAuditMetadataKeys.has(key),
        `computer audit metadata key ${key} is outside the bounded allowlist`);
      assert(!/title|text|screenshot|url|path|bundle|timeout|ref|observation/iu.test(key),
        `computer audit metadata key ${key} would carry private or unbounded detail`);
    }
    assert.equal(typeof metadata.duration_ms, "number",
      "the audit lane must retain the bounded computer duration");
    assert.equal(metadata.conversation_id, conversationId,
      "every computer audit must name the exact joined conversation");
    assert.equal(metadata.turn_id, turn.turn_id,
      "every computer audit must name the exact joined turn");
    assert.equal(metadata.device_id, device.id,
      "every computer audit must name the exact joined device");
    if (row.result === "success") {
      assert.equal(metadata.reason_code, undefined,
        "a successful computer audit must not carry a reason code");
      if (metadata.computer_request === "wait") {
        successfulWaitAudits++;
        assert.equal(metadata.delivery, "unconfirmed",
          "a wait attempt must be audited as an unconfirmed delivery");
        assert.equal(metadata.computer_action, undefined,
          "a wait must not be tagged with computer_action");
        assert.deepEqual(keys, waitAuditKeys,
          "a wait attempt must carry only the bounded observe fields plus computer_request and delivery");
      } else if (metadata.computer_request === "observe") {
        successfulObserveAudits++;
        assert.equal(metadata.delivery, undefined,
          "an observation must not claim a delivery outcome");
        assert.equal(metadata.computer_action, undefined,
          "an observation must not name a computer action");
        assert.deepEqual(keys, observeAuditKeys,
          "an observation success must carry only the bounded observe fields");
      } else if (metadata.computer_request === "act") {
        successfulClickAudits++;
        assert.equal(metadata.computer_action, "click");
        assert.equal(metadata.delivery, undefined,
          "an act must not claim a delivery outcome");
        assert.deepEqual(keys, actAuditKeys,
          "a click success must carry only the bounded action and duration");
      } else {
        assert.fail(`unexpected successful computer request ${metadata.computer_request}`);
      }
    } else {
      assert.equal(row.result, "failure");
      assert.equal(metadata.computer_request, "act",
        "every failed computer audit must name its bounded act request");
      assert.equal(metadata.computer_action, "click",
        "every failed act must name its bounded computer action");
      assert.equal(metadata.delivery, undefined,
        "a failed act must not claim a delivery outcome");
      assert.equal(typeof metadata.reason_code, "string",
        "a failed computer audit must carry its stable reason code");
      assert.deepEqual(keys, failedActAuditKeys,
        "a failed act must not add arbitrary audit properties");
      failedClickAudits++;
    }
  }
  assert.equal(successfulObserveAudits, 4, "exactly four observations must be audited");
  assert.equal(successfulWaitAudits, 2, "exactly two wait attempts must be audited");
  assert.equal(successfulClickAudits, 1, "exactly one successful click must be audited");
  assert.equal(failedClickAudits, 4, "exactly four failed clicks must be audited");
  // The two wait attempts are the only synthetic met/timed_out records. Their
  // strict key set above is the whole story: no timeout value, element ref or
  // observation id may leak through a wait audit row.
  const waitAuditProjection = JSON.stringify(computerAudits
    .filter(row => (row.metadataJson as { computer_request?: unknown }).computer_request === "wait")
    .map(row => row.metadataJson));
  assert(!waitAuditProjection.includes("timeout"),
    "a wait audit leaked a timeout");
  assert(!waitAuditProjection.includes("observation"),
    "a wait audit leaked an observation id");
  assert(!waitAuditProjection.includes("@joined:"),
    "a wait audit leaked an element ref");

  await api.service.revoke(owner.id, device.id);
  await waitEvent("disconnected", () => true, 30_000);
  await api.service.revoke(owner.id, device.id);
  assert.equal(await api.service.authenticate(token), null);
  assert.equal(await db.localComputerSession.count({
    where: { conversationId, status: "active" },
  }), 0, "revoke must end the exact computer session");

  succeeded = true;
  receipt = {
    status: "desktop computer product chain: ok",
    codex: manifest.versions.codex,
    modelRequests: captures.length,
    phases: phase,
    approvals: 6,
    turns: 1,
    observations: 4,
    approvedActs: 1,
    failedActs: 4,
    waits: 2,
    waitMet: 1,
    waitTimedOut: 1,
    waitCallIds: ["joined-call-11", "joined-call-12"],
    renewals: 2,
    deliberationMs,
    renewalExpiryAdvanceMs: renewedExpiresAt - selectedExpiresAt,
    ...(takeoverReceipt ?? {}),
    privateMarkerAbsent: true,
    screenshotAbsent: true,
    driverTouched: false,
  };

  async function computerAuditCount(result: "success" | "failure"): Promise<number> {
    return await db!.auditLog.count({
      where: { actorId: owner.id, action: "desktop_tool_requested", targetType: "local_computer", result },
    });
  }
} finally {
  // The body watchdog covers only the proof, never cleanup: a hung cleanup
  // must end in a named nonzero failure, not a masked success.
  clearTimeout(watchdog);
  const step = async (label: string, work: () => Promise<unknown>, timeoutMs = 8_000): Promise<boolean> => {
    let timer: NodeJS.Timeout | undefined;
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error("timeout")), timeoutMs);
      timer.unref();
    });
    try {
      await Promise.race([work(), deadline]);
      return true;
    } catch {
      cleanupFailures.push(label);
      return false;
    } finally {
      if (timer) clearTimeout(timer);
    }
  };

  // Unblock every synthetic SSE script before closing the provider so no body,
  // request or socket timer can hold cleanup open. Settled gates ignore this.
  for (const reject of gates.splice(0)) reject(new Error("joined fixture cleanup"));

  const gatewayExited = await step("gateway", async () => {
    const gateway = child;
    if (!gateway) return;
    if (!hasExited(gateway)) {
      // Normal child stdin shutdown: the gateway stops its supervised runtime
      // and exits on its own. `exit` is checked before and after registering,
      // so a process that already closed is never awaited again.
      try {
        if (gateway.stdin?.writable) {
          gateway.stdin.write(`${JSON.stringify({ action: "shutdown" })}\n`);
        }
      } catch { /* the child closed stdin first */ }
      try { gateway.stdin?.end(); } catch { /* already ended */ }
      await waitForExit(gateway, 6_000);
    }
    if (!hasExited(gateway)) {
      gateway.kill("SIGTERM");
      await waitForExit(gateway, 3_000);
    }
    if (!hasExited(gateway)) {
      await killDirectChildren(gateway.pid);
      gateway.kill("SIGKILL");
      await waitForExit(gateway, 2_000);
    }
    if (!hasExited(gateway)) throw new Error("still running");
  }, 15_000);

  await step("model", async () => { if (model) await model.close(); }, 10_000);
  await step("api", async () => { if (api) await api.close(); }, 10_000);
  await step("database", async () => { if (db) await db.$disconnect(); }, 10_000);
  const redisExited = await step("redis", async () => {
    if (!redis) return;
    await redis.close();
    await waitForProcessGone(redisPid, 5_000);
  }, 12_000);

  const postgresStopped = !pgStarted || await step("postgres", () =>
    execute("pg_ctl", ["-D", data, "-m", "immediate", "-w", "stop"], { timeout: 10_000 }), 12_000);
  const scratchRemoved = postgresStopped &&
    await step("scratch", () => rm(root, { recursive: true, force: true }), 15_000);
  if (!postgresStopped) {
    // Never remove a data directory a live postmaster may still own.
    cleanupFailures.push("scratch-retained");
  }

  if (succeeded && cleanupFailures.length === 0 && gatewayExited && redisExited &&
    postgresStopped && scratchRemoved && receipt) {
    console.log(JSON.stringify({
      ...receipt,
      cleanup: "clean",
      gatewayExited,
      redisExited,
      postgresStopped,
      scratchRemoved,
      exitCode: 0,
    }));
    process.exitCode = 0;
  } else if (cleanupFailures.length > 0) {
    // Step names only: no paths, tokens, model captures or native detail.
    console.error(`JOINED_CLEANUP_FAILED: ${[...new Set(cleanupFailures)].join(",")}`);
    process.exitCode = 1;
  } else if (succeeded) {
    console.error("JOINED_FAILED: the joined proof produced no clean receipt");
    process.exitCode = 1;
  }
}

function assertObservation(
  observation: Record<string, unknown> | undefined, label: string,
): asserts observation is { observation_id: string; nodes: Array<{ name?: string; ref?: string }> } {
  assert(observation && typeof observation.observation_id === "string" &&
    Array.isArray(observation.nodes), `${label} was not a bounded observation: ${JSON.stringify(observation)}`);
}

function assertFailure(
  result: Record<string, unknown> | undefined, code: string, label: string,
): void {
  // The MCP tool boundary exposes a failed act as `{ok:false, error}`; it must
  // never expose an ok/effect for any act that did not execute.
  assert(result?.ok === false && result.error === code,
    `${label} did not fail closed with ${code}: ${JSON.stringify(result ?? null)}`);
}

function assertWaitResult(
  result: Record<string, unknown> | undefined, expected: "met" | "timed_out",
  timeoutMS: number, label: string,
): void {
  assert(result && result.result === expected && typeof result.waited_ms === "number" &&
    Number.isInteger(result.waited_ms) && result.waited_ms >= 0 && result.waited_ms <= timeoutMS,
    `${label} did not return a bounded ${expected} wait result: ${JSON.stringify(result ?? null)}`);
  assert.deepEqual(Object.keys(result).sort(), ["result", "waited_ms"],
    `${label} returned fields outside the closed wait result`);
  assert(result.ok === undefined && result.error === undefined,
    `${label} exposed an act/effect outcome: ${JSON.stringify(result)}`);
}

async function readRuntimeManifest(
  runtimeRoot: string,
): Promise<z.infer<typeof runtimeManifestSchema>> {
  const path = join(runtimeRoot, "manifest.json");
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size <= 0 || info.size > 1_048_576) {
    throw new Error("the staged runtime manifest must be a bounded regular file");
  }
  return runtimeManifestSchema.parse(JSON.parse(await readFile(path, "utf8")));
}

/** Walks one relative path without following any symlink component. */
async function requireRealDirectory(base: string, relative: string, label: string): Promise<string> {
  let current = base;
  for (const part of relative.split("/").filter(Boolean)) {
    current = join(current, part);
    const info = await lstat(current);
    if (!info.isDirectory() || info.isSymbolicLink()) {
      throw new Error(`${label} path ${relative} is not a real directory`);
    }
  }
  const resolved = await realpath(current);
  if (resolved !== base && !resolved.startsWith(`${base}${sep}`)) {
    throw new Error(`${label} path ${relative} escapes the fixture copy`);
  }
  return current;
}

/** Replaces one disposable-runtime directory with a freshly built source. */
async function replaceRuntimeDirectory(
  stagedRoot: string, relative: string, source: string,
): Promise<void> {
  const parentName = dirname(relative);
  const parent = await requireRealDirectory(stagedRoot, parentName, "the disposable runtime");
  const target = join(parent, relative.slice(relative.lastIndexOf("/") + 1));
  const existing = await lstat(target).catch(() => null);
  if (existing && (existing.isSymbolicLink() || !existing.isDirectory())) {
    throw new Error(`the disposable runtime ${relative} must be a real directory`);
  }
  await rm(target, { recursive: true, force: true });
  await cp(source, target, { recursive: true });
}

async function fileDigest(path: string): Promise<string> {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  return digest.digest("hex");
}

async function freePort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const server = createNetServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("missing test port"));
        return;
      }
      server.close(error => error ? reject(error) : resolve(address.port));
    });
  });
}

function hasExited(process: ChildProcess): boolean {
  return process.exitCode !== null || process.signalCode !== null;
}

async function waitForExit(process: ChildProcess, timeoutMs: number): Promise<void> {
  if (hasExited(process)) return;
  await new Promise<void>(resolve => {
    const done = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      // An expired interval is a normal return, not a failed step: the caller
      // re-checks hasExited and escalates to SIGTERM/SIGKILL. Rejecting here
      // would make the gateway step's catch skip the remaining escalation.
      process.off("exit", done);
      resolve();
    }, timeoutMs);
    timer.unref();
    process.once("exit", done);
    // The process may have exited between the precheck and `once`.
    if (hasExited(process)) {
      process.off("exit", done);
      done();
    }
  });
}

async function waitForProcessGone(pid: number | undefined, timeoutMs: number): Promise<void> {
  if (!pid) return;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      process.kill(pid, 0);
    } catch {
      return;
    }
    if (Date.now() >= deadline) throw new Error("timeout");
    await delay(50);
  }
}

/** Last-resort cleanup for a gateway that ignored graceful stdin shutdown. */
async function killDirectChildren(pid: number | undefined): Promise<void> {
  if (!pid) return;
  try {
    const { stdout } = await execute("ps", ["-o", "pid=", "-P", String(pid)], { timeout: 2_000 });
    for (const token of stdout.split(/\s+/u)) {
      const childPid = Number(token);
      if (!Number.isInteger(childPid) || childPid <= 0) continue;
      try { process.kill(childPid, "SIGKILL"); } catch { /* already gone */ }
    }
  } catch {
    // Best effort only; the gateway step still reports its own failure.
  }
}

function toolOutputTexts(body: Record<string, unknown>, callId: string): string[] {
  const inputs = Array.isArray(body.input) ? body.input : [];
  for (const candidate of inputs) {
    const item = candidate as { type?: string; call_id?: string; output?: Array<{ type?: string; text?: string }> };
    if (item.type !== "function_call_output" || item.call_id !== callId) continue;
    return (item.output ?? []).flatMap(part =>
      part.type === "input_text" && typeof part.text === "string" ? [part.text] : []);
  }
  return [];
}

function toolResult(body: Record<string, unknown>, callId: string): Record<string, unknown> | undefined {
  const inputs = Array.isArray(body.input) ? body.input : [];
  for (const candidate of inputs) {
    const item = candidate as { type?: string; call_id?: string; output?: Array<{ type?: string; text?: string }> };
    if (item.type !== "function_call_output" || item.call_id !== callId) continue;
    for (const part of item.output ?? []) {
      if (part.type !== "input_text" || typeof part.text !== "string") continue;
      try {
        return JSON.parse(part.text) as Record<string, unknown>;
      } catch {
        // Codex may prepend a "Wall time..." text part.
      }
    }
  }
  return undefined;
}

function toolCall(
  body: Record<string, unknown>, name: string, argumentsValue: unknown, callId: string,
): Record<string, unknown> {
  const namespace = namespaceFor(body, name);
  assert(namespace, `pinned Codex did not expose the ${name} tool`);
  return {
    id: `fc_${callId}`, type: "function_call", call_id: callId,
    namespace, name, arguments: JSON.stringify(argumentsValue),
  };
}

function namespaceFor(body: Record<string, unknown>, toolName: string): string | undefined {
  const tools = Array.isArray(body.tools) ? body.tools : [];
  for (const candidate of tools) {
    const namespace = candidate as {
      type?: string; name?: string; tools?: Array<{ name?: string }>;
    };
    if (namespace.type === "namespace" && namespace.name &&
      namespace.tools?.some(tool => tool.name === toolName)) return namespace.name;
  }
  return undefined;
}

function message(text: string): Record<string, unknown> {
  return {
    id: "msg_joined", type: "message", role: "assistant", status: "completed",
    content: [{ type: "output_text", text, annotations: [] }],
  };
}

function responseStream(item: Record<string, unknown>): string {
  const id = randomUUID();
  return [
    { type: "response.created", response: { id, status: "in_progress", output: [] } },
    { type: "response.output_item.added", output_index: 0, item },
    { type: "response.output_item.done", output_index: 0, item },
    { type: "response.completed", response: { id, status: "completed", output: [item],
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } },
  ].map(frame => `data: ${JSON.stringify(frame)}\n\n`).join("");
}
