import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer, request as httpRequest } from "node:http";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir, cpus, totalmem, arch, platform } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { Redis } from "ioredis";
import Fastify from "fastify";
import pino from "pino";
import { z } from "zod";
import {
  publicKnowledgeSettingsSchema,
  publicKnowledgeRunnerResultSchema,
  publicKnowledgeTurnSchema,
  runnerEventBatchSchema,
  publicKnowledgeRunnerProgressSchema,
  type PublicKnowledgeRunnerInput,
} from "@linksense/shared";
import { createPrismaClient } from "../../src/db.js";
import { PublicKnowledgeService } from "../../src/modules/public-knowledge/service.js";
import { PrismaPublicKnowledgeProgress } from "../../src/modules/public-knowledge/progress.js";
import { PublicKnowledgeSkills } from "../../src/modules/public-knowledge/skills.js";
import { RedisPublicKnowledgeCoordinator } from "../../src/modules/public-knowledge/coordinator.js";
import { BullMqPublicKnowledgeQueue } from "../../src/modules/public-knowledge/queue.js";
import { publicKnowledgeVisitorRoutes } from "../../src/modules/public-knowledge/routes.js";
import { AuditService } from "../../src/modules/audit/service.js";
import { normalizeError, errorDetails } from "../../src/lib/errors.js";

// No .env, existing database, running service or paid model is used. The queue,
// Redis, PostgreSQL, controller, worker and pinned native Codex are real; only
// the external inference and retrieval results are controlled fixtures.
const execute = promisify(execFile),
  repository = fileURLToPath(new URL("../../../../", import.meta.url));
const root = await mkdtemp(join(tmpdir(), "linksense-public-load-")),
  suffix = randomUUID();
const image = `linksense-public-load:${suffix}`,
  controlNetwork = `linksense-public-control-${suffix}`,
  egressNetwork = `linksense-public-egress-${suffix}`;
const containers: string[] = [],
  networks: string[] = [];
const docker = async (...args: string[]) => {
  const result = await execute("docker", args, {
    timeout: 60_000,
    maxBuffer: 4_000_000,
  });
  return (result.stdout + (args[0] === "logs" ? result.stderr : "")).trim();
};
const output = resolve(
  process.env.LINKSENSE_LOAD_RESULT ??
    join(tmpdir(), "linksense-public-knowledge-load.json"),
);
const inferenceDelayMs = z.coerce
  .number()
  .int()
  .min(0)
  .max(5000)
  .parse(process.env.LINKSENSE_LOAD_INFERENCE_DELAY_MS ?? 3000);
const socket = (
  await docker("context", "inspect", "--format", "{{.Endpoints.docker.Host}}")
).replace(/^unix:\/\//u, "");
assert(socket.startsWith("/"), "A local Docker socket is required");
const inferenceFailures: unknown[] = [];
let modelCalls = 0,
  inferenceActive = 0,
  inferencePeak = 0;
type InferenceBatch = {
  arrived: number;
  expected: number;
  promise: Promise<void>;
  release(): void;
  firstArrival: number | null;
  lastArrival: number | null;
};
let inferenceBatch: InferenceBatch | null = null;
let progressApiTarget: string | undefined;
const progressGateway = createServer((request, response) => {
  if (!progressApiTarget) {
    response.writeHead(503);
    response.end();
    return;
  }
  const upstream = httpRequest(
    new URL(request.url ?? "/", progressApiTarget),
    { method: request.method, headers: request.headers, timeout: 5_000 },
    (incoming) => {
      response.writeHead(incoming.statusCode ?? 502, incoming.headers);
      incoming.pipe(response);
    },
  );
  upstream.on("error", () => response.destroy());
  upstream.on("timeout", () =>
    upstream.destroy(new Error("fixture progress proxy deadline")),
  );
  request.pipe(upstream);
});
const evidenceText =
  "该产品支持私有部署、独立权限控制、知识库检索与多轮问答。".repeat(60);
const evidenceCount = 6;
const createBatch = (expected: number) => {
  let release = () => {},
    reject: (error: Error) => void = () => {};
  const promise = new Promise<void>((resolve, fail) => {
    release = resolve;
    reject = fail;
  });
  const deadline = setTimeout(
    () => reject(new Error("expected simultaneous inference was not reached")),
    30_000,
  );
  void promise.catch(() => undefined);
  const batch: InferenceBatch = {
    arrived: 0,
    expected,
    promise,
    release,
    firstArrival: null,
    lastArrival: null,
  };
  return { batch, deadline };
};
const inference = createServer((request, response) => {
  void (async () => {
    const buffers: Buffer[] = [];
    for await (const chunk of request) buffers.push(Buffer.from(chunk));
    const body = z
      .object({
        input: z.array(z.unknown()),
        tools: z.array(z.unknown()),
        tool_choice: z.literal("none"),
      })
      .parse(JSON.parse(Buffer.concat(buffers).toString()));
    assert.deepEqual(body.tools, []);
    const text = JSON.stringify(body.input),
      markers = [...new Set(text.match(/VISITOR_\d+_\d+_ONLY/gu) ?? [])];
    assert(
      markers.length === 1,
      "native request must contain exactly one visitor's context",
    );
    if (text.includes("FOLLOWUP_REMEMBER"))
      assert(
        text.includes("FIRST_QUESTION"),
        "continuation must retain the earlier visitor context",
      );
    modelCalls++;
    inferenceActive++;
    inferencePeak = Math.max(inferencePeak, inferenceActive);
    try {
      const batch = inferenceBatch;
      if (batch) {
        batch.arrived++;
        batch.firstArrival ??= performance.now();
        batch.lastArrival = performance.now();
        if (batch.arrived === batch.expected) batch.release();
        await batch.promise;
      }
      await delay(inferenceDelayMs);
      const item = {
        id: `msg_${randomUUID()}`,
        type: "message",
        role: "assistant",
        status: "completed",
        content: [
          {
            type: "output_text",
            text: `Website evidence answer ${markers[0]} [1]`,
            annotations: [],
          },
        ],
      };
      const result = {
        id: `resp_${randomUUID()}`,
        object: "response",
        status: "completed",
        output: [item],
        usage: { input_tokens: 1500, output_tokens: 30, total_tokens: 1530 },
      };
      response.writeHead(200, { "content-type": "text/event-stream" });
      for (const event of [
        {
          type: "response.created",
          response: { ...result, status: "in_progress", output: [] },
        },
        { type: "response.output_item.added", output_index: 0, item },
        { type: "response.output_item.done", output_index: 0, item },
        { type: "response.completed", response: result },
      ])
        response.write(
          `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
        );
      response.end();
    } finally {
      inferenceActive--;
    }
  })().catch((error) => {
    inferenceFailures.push(error);
    response.destroy();
  });
});
let db: ReturnType<typeof createPrismaClient> | undefined,
  redis: Redis | undefined,
  service: PublicKnowledgeService | undefined,
  built = false;
const api = Fastify();
type Resource = { memoryBytes: number; cpuPercent: number; pids: number };
type Sample = {
  worker: Resource;
  controller: Resource;
  database: Resource;
  redis: Resource;
  apiRssBytes: number;
  apiCpuPercent: number;
  codexProcesses: number;
};
const statsSchema = z.object({
  memory_stats: z.object({
    usage: z.number(),
    stats: z.record(z.string(), z.number()).default({}),
  }),
  pids_stats: z.object({ current: z.number().default(0) }),
  cpu_stats: z.object({
    cpu_usage: z.object({ total_usage: z.number() }),
    system_cpu_usage: z.number(),
    online_cpus: z.number(),
  }),
});
try {
  await cp(join(repository, "apps/runner/dist"), join(root, "runner"), {
    recursive: true,
  });
  await cp(join(repository, "packages/shared/dist"), join(root, "shared"), {
    recursive: true,
  });
  await cp(
    join(repository, "scripts/public-knowledge-load-controller.mjs"),
    join(root, "controller.mjs"),
  );
  const baseImage =
    process.env.LINKSENSE_TEST_WORKER_BASE_IMAGE ??
    "linksense-runner-worker:oss-local";
  assert(/^[\w./:-]+$/u.test(baseImage));
  await writeFile(
    join(root, "Dockerfile"),
    `FROM ${baseImage}\nUSER 0:1000\nCOPY --chown=1000:1000 runner/ /app/dist/\nCOPY shared/ /tmp/shared-dist/\nRUN cp -R /tmp/shared-dist/. "$(readlink -f /app/node_modules/@linksense/shared)/dist/" && rm -rf /tmp/shared-dist\n`,
  );
  await docker("build", "--quiet", "--tag", image, root);
  built = true;
  for (const name of [controlNetwork, egressNetwork]) {
    await docker("network", "create", name);
    networks.push(name);
  }
  const database = `linksense-public-db-${suffix}`,
    redisContainer = `linksense-public-redis-${suffix}`,
    controller = `linksense-public-controller-${suffix}`,
    password = randomUUID();
  await docker(
    "run",
    "--rm",
    "-d",
    "--label",
    "com.linksense.test.disposable=true",
    "--name",
    database,
    "-p",
    "127.0.0.1::5432",
    "-e",
    "POSTGRES_DB=public_knowledge_load",
    "-e",
    `POSTGRES_PASSWORD=${password}`,
    "postgres:16-alpine",
  );
  containers.push(database);
  await docker(
    "run",
    "--rm",
    "-d",
    "--label",
    "com.linksense.test.disposable=true",
    "--name",
    redisContainer,
    "-p",
    "127.0.0.1::6379",
    "redis:7-alpine",
    "redis-server",
    "--save",
    "",
    "--appendonly",
    "no",
  );
  containers.push(redisContainer);
  const databasePort = (await docker("port", database, "5432/tcp"))
      .split(":")
      .at(-1),
    redisPort = (await docker("port", redisContainer, "6379/tcp"))
      .split(":")
      .at(-1);
  for (let index = 0; ; index++) {
    try {
      await docker(
        "exec",
        database,
        "pg_isready",
        "-U",
        "postgres",
        "-h",
        "127.0.0.1",
      );
      break;
    } catch {
      if (index === 50) throw new Error("test database unavailable");
      await delay(100);
    }
  }
  const databaseUrl = `postgresql://postgres:${password}@127.0.0.1:${databasePort}/public_knowledge_load`,
    redisUrl = `redis://127.0.0.1:${redisPort}`;
  await execute(
    "pnpm",
    [
      "exec",
      "prisma",
      "migrate",
      "deploy",
      "--config",
      "apps/api/test/integration/prisma.config.ts",
    ],
    {
      cwd: repository,
      timeout: 120_000,
      maxBuffer: 8_000_000,
      env: { ...process.env, DATABASE_URL: databaseUrl },
    },
  );
  db = createPrismaClient(databaseUrl);
  redis = new Redis(redisUrl, { maxRetriesPerRequest: 1 });
  await new Promise<void>((resolve) => inference.listen(0, "0.0.0.0", resolve));
  const inferenceAddress = inference.address();
  assert(inferenceAddress && typeof inferenceAddress !== "string");
  const owner = await db.user.create({
    data: {
      name: "Load test creator",
      email: "load-creator@example.test",
      role: "user",
      status: "active",
    },
  });
  const knowledge = await db.knowledgeBase.create({
    data: { ownerId: owner.id, name: "Website evidence" },
  });
  const secret = randomUUID() + randomUUID(),
    users = join(root, "users");
  await mkdir(users);
  await new Promise<void>((resolve) =>
    progressGateway.listen(0, "0.0.0.0", resolve),
  );
  const progressAddress = progressGateway.address();
  assert(progressAddress && typeof progressAddress !== "string");
  const controllerConfig = {
    LINKSENSE_RUNNER_MODE: "controller",
    LINKSENSE_USER_DATA_ROOT: users,
    LINKSENSE_RUNNER_SHARED_SECRET: secret,
    LINKSENSE_API_INTERNAL_URL: `http://host.docker.internal:${progressAddress.port}`,
    LINKSENSE_CONTROLLER_INTERNAL_URL: `http://${controller}:4010`,
    LINKSENSE_WORKER_IMAGE: image,
    LINKSENSE_WORKER_CONTROL_NETWORK: controlNetwork,
    LINKSENSE_WORKER_EGRESS_NETWORK: egressNetwork,
    LINKSENSE_WORKER_MEMORY_MB: "2048",
    LINKSENSE_WORKER_CPUS: "2",
    LINKSENSE_WORKER_IDLE_TTL_SECONDS: "600",
    LINKSENSE_RUNNER_INSTANCE_ID: randomUUID(),
  };
  await writeFile(
    join(root, "controller.json"),
    JSON.stringify(controllerConfig),
    { mode: 0o600 },
  );
  await docker(
    "run",
    "--rm",
    "-d",
    "--label",
    "com.linksense.test.disposable=true",
    "--name",
    controller,
    "--user",
    "0:1000",
    "--network",
    controlNetwork,
    "-p",
    "127.0.0.1::4010",
    "-e",
    "LOG_LEVEL=silent",
    "--volume",
    `${socket}:/var/run/docker.sock`,
    "--volume",
    `${root}:${root}`,
    "--entrypoint",
    "node",
    image,
    join(root, "controller.mjs"),
    join(root, "controller.json"),
  );
  containers.push(controller);
  const controllerPort = (await docker("port", controller, "4010/tcp"))
      .split(":")
      .at(-1),
    controllerUrl = `http://127.0.0.1:${controllerPort}`;
  for (let index = 0; ; index++) {
    try {
      if ((await fetch(`${controllerUrl}/health/live`)).ok) break;
    } catch {
      /* booting */
    }
    if (index === 100)
      throw new Error(
        `test controller unavailable: ${await docker("logs", "--tail", "30", controller)}`,
      );
    await delay(100);
  }
  const runnerRequest = async (
    applicationId: string,
    path: string,
    payload?: unknown,
  ) => {
    const response = await fetch(`${controllerUrl}${path}`, {
      method: payload === undefined ? "GET" : "POST",
      headers: {
        authorization: `Bearer ${secret}`,
        "x-linksense-owner-id": applicationId,
        ...(payload === undefined
          ? {}
          : { "content-type": "application/json" }),
      },
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
      signal: AbortSignal.timeout(220_000),
    });
    assert(
      response.ok,
      `native worker request failed: ${response.status} ${await response.clone().text()}`,
    );
    return response.status === 204
      ? null
      : (response.json() as Promise<unknown>);
  };
  const progressRedis = redis;
  service = new PublicKnowledgeService({
    progress: new PrismaPublicKnowledgeProgress(
      db,
      {
        duplicate: () => progressRedis.duplicate({ lazyConnect: true }),
        publishConversationEvents: async (id, events) => {
          for (const event of events)
            await progressRedis.publish(
              `linksense:conversation-events:${id}`,
              JSON.stringify(event),
            );
        },
      },
      pino({ level: "silent" }),
    ),
    skills: new PublicKnowledgeSkills(db, join(root, "capabilities")),
    prisma: db,
    audit: new AuditService(db),
    coordinator: new RedisPublicKnowledgeCoordinator(redis),
    queue: new BullMqPublicKnowledgeQueue(
      redis,
      redisUrl,
      pino({ level: "silent" }),
    ),
    models: {
      resolveRuntime: async () => {
        throw new Error("unexpected default model");
      },
      resolveModelTransitionRuntime: async () => {
        throw new Error("unexpected model transition");
      },
      resolveRuntimeForSelection: async () => ({
        model: "gpt-5.4",
        reasoningEffort: "minimal",
        provider: {
          revision: 1,
          baseUrl: `http://host.docker.internal:${inferenceAddress.port}/v1`,
          protocolMode: "native_responses",
          apiKey: "fixture-private-key",
        },
      }),
    },
    knowledge: { resolveUsableKnowledgeBaseIds: async () => [knowledge.id] },
    retrieve: async () => ({
      citations: Array.from({ length: evidenceCount }, (_, index) => ({
        number: index + 1,
        knowledge_base_id: knowledge.id,
        document_id: knowledge.id,
        document_version_id: knowledge.id,
        title: `Website ${index + 1}`,
        page_numbers: [],
        excerpt: evidenceText,
      })),
      context: JSON.stringify(
        Array.from({ length: evidenceCount }, (_, index) => ({
          reference: index + 1,
          text: evidenceText,
        })),
      ),
    }),
    runner: {
      runPublicKnowledgeTurn: async (input: PublicKnowledgeRunnerInput) =>
        publicKnowledgeRunnerResultSchema.parse(
          await runnerRequest(
            input.applicationId,
            "/public-knowledge/turn",
            input,
          ),
        ),
      readPublicKnowledgeResult: async (
        applicationId,
        conversationId,
        operationId,
      ) =>
        z
          .object({ result: publicKnowledgeRunnerResultSchema.nullable() })
          .parse(
            await runnerRequest(
              applicationId,
              `/public-knowledge/conversations/${conversationId}/operations/${operationId}`,
            ),
          ).result,
      interruptPublicKnowledgeTurn: async (
        applicationId,
        conversationId,
        operationId,
      ) => {
        await runnerRequest(
          applicationId,
          `/public-knowledge/conversations/${conversationId}/operations/${operationId}/interrupt`,
          {},
        );
      },
    },
  });
  await service.start();
  const publicService = service;
  api.post("/internal/runner/events", async (request, reply) => {
    if (request.headers.authorization !== `Bearer ${secret}`)
      return reply.code(401).send({ error_code: "AUTH_REQUIRED" });
    const body = runnerEventBatchSchema.parse(request.body);
    const entries = body.events.map(({ deliveryId, event }) => ({
      deliveryId,
      event: publicKnowledgeRunnerProgressSchema.parse(event),
    }));
    await publicService.ingestRunnerEvents(
      z.uuid().parse(request.headers["x-linksense-owner-id"]),
      body.conversationId,
      entries,
    );
    return {
      success: true,
      data: { accepted_delivery_ids: entries.map((entry) => entry.deliveryId) },
    };
  });
  api.setErrorHandler((error, _request, reply) => {
    const normalized = normalizeError(error);
    reply
      .code(errorDetails(normalized.code, "en-US").status)
      .send({ error_code: normalized.code });
  });
  await api.register(publicKnowledgeVisitorRoutes, {
    prefix: "/api/v1/public-knowledge",
    service,
    developmentAssets: false,
  });
  const address = await api.listen({ host: "127.0.0.1", port: 0 });
  progressApiTarget = address;
  const settings = publicKnowledgeSettingsSchema.parse({
    name: "Concurrent website Q&A",
    instructions:
      "Answer using website evidence and remember this visitor's earlier questions.",
    model: "gpt-5.4",
    reasoning_effort: "minimal",
    knowledge_base_ids: [knowledge.id],
    allowed_origins: ["https://website.example.test"],
    max_concurrent_turns: 20,
  });
  const application = await service.save(
    { id: owner.id, role: "user", status: "active" },
    settings,
  );
  const visitor = async (index: number) => {
    assert(service);
    const session = await service.startSession(
      application.public_id,
      settings.allowed_origins[0]!,
      `visitor-${index}`,
    );
    const conversation = await service.createConversation(
      application.public_id,
      session.token,
    );
    return { token: session.token, id: conversation.id };
  };
  const question = async (
    person: Awaited<ReturnType<typeof visitor>>,
    text: string,
  ) => {
    const started = performance.now(),
      route = `${address}/api/v1/public-knowledge/${application.public_id}/conversations/${person.id}`;
    const response = await fetch(`${route}/turns`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${person.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ input_text: text, request_id: randomUUID() }),
      signal: AbortSignal.timeout(10_000),
    });
    const payload: unknown = await response.json();
    assert(response.ok, JSON.stringify(payload));
    const turn = publicKnowledgeTurnSchema.parse(
        z.object({ data: z.unknown() }).parse(payload).data,
      ),
      queued = turn.status === "queued";
    for (let index = 0; index < 600; index++) {
      const detailResponse = await fetch(route, {
        headers: { authorization: `Bearer ${person.token}` },
        signal: AbortSignal.timeout(10_000),
      });
      assert(detailResponse.ok);
      const detail = z
        .object({
          data: z.object({ turns: z.array(publicKnowledgeTurnSchema) }),
        })
        .parse(await detailResponse.json());
      const current = detail.data.turns.find((item) => item.id === turn.id);
      if (
        current &&
        current.status !== "queued" &&
        current.status !== "running"
      )
        return {
          status: current.status,
          latencyMs: performance.now() - started,
          queued,
          output: current.output_text,
        };
      await delay(200);
    }
    throw new Error("answer observation timed out");
  };
  const warmup = await visitor(0);
  assert.equal(
    (await question(warmup, "VISITOR_0_0_ONLY FIRST_QUESTION")).status,
    "completed",
  );
  const workers = (
    await docker(
      "ps",
      "-q",
      "--filter",
      `label=com.linksense.runner.owner-id=${application.application_id}`,
    )
  )
    .split(/\s+/u)
    .filter(Boolean);
  assert.equal(workers.length, 1);
  const worker = workers[0]!;
  containers.push(worker);
  assert.equal(
    (await docker("exec", worker, "codex", "--version")).trim(),
    "codex-cli 0.154.0",
  );
  const engineGet = (path: string): Promise<unknown> =>
    new Promise((resolve, reject) => {
      const req = httpRequest(
        {
          socketPath: socket,
          path: `/v1.45${path}`,
          method: "GET",
          timeout: 10_000,
        },
        (response) => {
          const parts: Buffer[] = [];
          response.on("data", (chunk: Buffer) => parts.push(chunk));
          response.on("error", reject);
          response.on("end", () => {
            try {
              assert.equal(response.statusCode, 200);
              resolve(JSON.parse(Buffer.concat(parts).toString()));
            } catch (error) {
              reject(error);
            }
          });
        },
      );
      req.on("timeout", () =>
        req.destroy(new Error("benchmark Docker stats timeout")),
      );
      req.on("error", reject);
      req.end();
    });
  const previousStats = new Map<string, { cpu: number; system: number }>();
  const resource = async (id: string): Promise<Resource> => {
    const stats = statsSchema.parse(
      await engineGet(`/containers/${id}/stats?stream=false&one-shot=true`),
    );
    const previous = previousStats.get(id),
      cpu = stats.cpu_stats.cpu_usage.total_usage,
      system = stats.cpu_stats.system_cpu_usage;
    previousStats.set(id, { cpu, system });
    const cpuDelta = previous ? cpu - previous.cpu : 0,
      systemDelta = previous ? system - previous.system : 0;
    return {
      memoryBytes: Math.max(
        0,
        stats.memory_stats.usage -
          (stats.memory_stats.stats.inactive_file ??
            stats.memory_stats.stats.total_inactive_file ??
            0),
      ),
      cpuPercent:
        systemDelta > 0 && cpuDelta >= 0
          ? (cpuDelta / systemDelta) * stats.cpu_stats.online_cpus * 100
          : 0,
      pids: stats.pids_stats.current,
    };
  };
  let previousCpu = process.cpuUsage(),
    previousTime = performance.now();
  const sample = async (): Promise<Sample> => {
    const [w, c, d, r, top] = await Promise.all([
      resource(worker),
      resource(controller),
      resource(database),
      resource(redisContainer),
      engineGet(`/containers/${worker}/top?ps_args=-eo%20pid,comm,args`),
    ]);
    const now = performance.now(),
      usage = process.cpuUsage(),
      delta = usage.user + usage.system - previousCpu.user - previousCpu.system;
    const result = {
      worker: w,
      controller: c,
      database: d,
      redis: r,
      apiRssBytes: process.memoryUsage().rss,
      apiCpuPercent: (delta / ((now - previousTime) * 1000)) * 100,
      codexProcesses: z
        .object({ Processes: z.array(z.array(z.string())) })
        .parse(top)
        .Processes.filter((row) => row[1] === "codex").length,
    };
    previousCpu = usage;
    previousTime = now;
    return result;
  };
  const baseline = await sample(),
    waves = [];
  console.log(
    "PASS: real Docker worker accepts native isolated public turns; starting concurrent visitor waves",
  );
  for (const count of [10, 15, 20]) {
    const people = await Promise.all(
      Array.from({ length: count }, (_, index) => visitor(count * 100 + index)),
    );
    const samples: Sample[] = [],
      answers = [],
      arrivalSpreads: number[] = [],
      started = performance.now();
    let done = false;
    inferencePeak = 0;
    const sampling = (async () => {
      while (!done) {
        samples.push(await sample());
        if (!done) await delay(500);
      }
    })();
    void sampling.catch(() => undefined);
    try {
      for (const round of [1, 2]) {
        const batch = createBatch(count);
        inferenceBatch = batch.batch;
        let roundResults;
        try {
          roundResults = await Promise.all(
            people.map((person, index) =>
              question(
                person,
                `VISITOR_${count}_${index}_ONLY ${round === 1 ? "FIRST_QUESTION is private deployment supported?" : "FOLLOWUP_REMEMBER what did I ask earlier?"}`,
              ),
            ),
          );
        } finally {
          clearTimeout(batch.deadline);
          inferenceBatch = null;
        }
        assert.equal(batch.batch.arrived, count);
        arrivalSpreads.push(
          (batch.batch.lastArrival ?? 0) - (batch.batch.firstArrival ?? 0),
        );
        for (const [index, answer] of roundResults.entries()) {
          assert.equal(answer.status, "completed");
          assert(answer.output.includes(`VISITOR_${count}_${index}_ONLY`));
        }
        answers.push(...roundResults);
      }
    } finally {
      done = true;
      await sampling;
    }
    const sorted = answers.map((item) => item.latencyMs).sort((a, b) => a - b),
      percentile = (p: number) => sorted[Math.ceil(sorted.length * p) - 1] ?? 0;
    const peak = (select: (sample: Sample) => number) =>
      Math.max(0, ...samples.map(select));
    const wave = {
      visitors: count,
      turns: answers.length,
      completed: answers.filter((item) => item.status === "completed").length,
      acceptedAsync: answers.filter((item) => item.queued).length,
      peakParallelInference: inferencePeak,
      roundInferenceArrivalSpreadMs: arrivalSpreads,
      failed: answers.filter((item) => item.status !== "completed").length,
      elapsedMs: performance.now() - started,
      latencyP50Ms: percentile(0.5),
      latencyP95Ms: percentile(0.95),
      latencyMaxMs: percentile(1),
      peakWorkerMemoryBytes: peak((item) => item.worker.memoryBytes),
      peakWorkerCpuPercent: peak((item) => item.worker.cpuPercent),
      peakWorkerPids: peak((item) => item.worker.pids),
      peakCodexProcesses: peak((item) => item.codexProcesses),
      peakControllerMemoryBytes: peak((item) => item.controller.memoryBytes),
      peakControllerCpuPercent: peak((item) => item.controller.cpuPercent),
      peakDatabaseMemoryBytes: peak((item) => item.database.memoryBytes),
      peakRedisMemoryBytes: peak((item) => item.redis.memoryBytes),
      peakApiRssBytes: peak((item) => item.apiRssBytes),
      peakApiCpuPercent: peak((item) => item.apiCpuPercent),
      samples: samples.length,
    };
    waves.push(wave);
    console.log(JSON.stringify(wave));
    assert.equal(
      (
        await docker(
          "ps",
          "-q",
          "--filter",
          `label=com.linksense.runner.owner-id=${application.application_id}`,
        )
      )
        .split(/\s+/u)
        .filter(Boolean).length,
      1,
      "visitor count must not allocate more application workers",
    );
    assert.equal(wave.peakParallelInference, count);
    assert.equal(wave.peakCodexProcesses, count);
    assert.equal(inferenceFailures.length, 0);
    await delay(1200);
  }
  assert.equal(modelCalls, 91);
  assert.equal(inferencePeak, 20);
  const result = {
    testedAt: new Date().toISOString(),
    host: {
      platform: platform(),
      arch: arch(),
      cpu: cpus()[0]?.model,
      logicalCpus: cpus().length,
      memoryBytes: totalmem(),
      node: process.version,
      docker: await docker("version", "--format", "{{.Server.Version}}"),
    },
    nativeCodex: "0.154.0",
    workerMemoryLimitMiB: 2048,
    workerCpuLimit: 2,
    applicationConcurrency: 20,
    nativeTokioWorkerThreadsEnvironment: "2",
    evidenceCount,
    evidenceCharactersPerTurn: evidenceText.length * evidenceCount,
    sampleIntervalMs: 500,
    simultaneousInferenceBarrier: true,
    inferenceDelayMs,
    roundsPerVisitor: 2,
    modelCalls,
    peakParallelInference: inferencePeak,
    fixtureInferenceAndRetrieval: true,
    baseline,
    waves,
  };
  await writeFile(output, JSON.stringify(result, null, 2) + "\n");
  console.log(
    `PASS: 10/15/20 visitor completion, continuation and context isolation; results written to ${output}`,
  );
} finally {
  progressGateway.closeAllConnections();
  if (progressGateway.listening)
    await new Promise<void>((resolve) =>
      progressGateway.close(() => resolve()),
    );
  await api.close();
  await service?.close();
  await db?.$disconnect();
  await redis?.quit();
  inference.closeAllConnections();
  await new Promise<void>((resolve) => inference.close(() => resolve()));
  if (built)
    containers.push(
      ...(await docker("ps", "-aq", "--filter", `ancestor=${image}`))
        .split(/\s+/u)
        .filter(Boolean),
    );
  await Promise.all(
    [...new Set(containers)]
      .reverse()
      .map((name) =>
        docker("rm", "-f", "--volumes", name).catch(() => undefined),
      ),
  );
  for (const network of networks)
    await docker("network", "rm", network).catch(() => undefined);
  if (built) await docker("image", "rm", image).catch(() => undefined);
  await rm(root, { recursive: true, force: true });
}
