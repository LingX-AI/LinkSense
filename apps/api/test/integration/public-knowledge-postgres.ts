import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { cp, mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { Redis } from "ioredis";
import Fastify from "fastify";
import pino from "pino";
import { BullMqPublicKnowledgeQueue } from "../../src/modules/public-knowledge/queue.js";
import {
  publicKnowledgeSettingsSchema,
  publicKnowledgeManagementSchema,
  publicKnowledgeConversationSchema,
  publicKnowledgeConversationDetailSchema,
  publicKnowledgeConversationPageSchema,
  publicKnowledgeSessionSchema,
  publicKnowledgeUsageSchema,
  publicKnowledgeRunnerProgressSchema,
  type PublicKnowledgeRunnerInput,
} from "@linksense/shared";
import { createPrismaClient } from "../../src/db.js";
import { PublicKnowledgeService } from "../../src/modules/public-knowledge/service.js";
import { PrismaPublicKnowledgeProgress } from "../../src/modules/public-knowledge/progress.js";
import { PublicKnowledgeSkills } from "../../src/modules/public-knowledge/skills.js";
import { RedisPublicKnowledgeCoordinator } from "../../src/modules/public-knowledge/coordinator.js";
import {
  publicKnowledgeManagementRoutes,
  publicKnowledgeVisitorRoutes,
} from "../../src/modules/public-knowledge/routes.js";
import { AuditService } from "../../src/modules/audit/service.js";
import { ApplicationService } from "../../src/modules/applications/service.js";
import { ApplicationPublicationService } from "../../src/modules/applications/publication-service.js";
import { normalizeError, errorDetails } from "../../src/lib/errors.js";
import { registerResponseSecurityHeaders } from "../../src/app.js";

// All state is disposable. Never read the application's .env or use its database.
const execute = promisify(execFile),
  repositoryRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const root = await mkdtemp(join(tmpdir(), "linksense-public-knowledge-db-")),
  containers: string[] = [];
const docker = async (...args: string[]) =>
  (await execute("docker", args, { timeout: 30_000 })).stdout.trim();
let prisma: ReturnType<typeof createPrismaClient> | undefined,
  redis: Redis | undefined,
  otherRedis: Redis | undefined;
let publicService: PublicKnowledgeService | undefined;
const app = Fastify();
try {
  const databaseContainer = `linksense-public-db-${randomUUID()}`,
    redisContainer = `linksense-public-redis-${randomUUID()}`,
    password = randomUUID();
  await docker(
    "run",
    "--rm",
    "--label",
    "com.linksense.test.disposable=true",
    "-d",
    "--name",
    databaseContainer,
    "-p",
    "127.0.0.1::5432",
    "-e",
    "POSTGRES_DB=public_knowledge_test",
    "-e",
    `POSTGRES_PASSWORD=${password}`,
    "postgres:16-alpine",
  );
  containers.push(databaseContainer);
  await docker(
    "run",
    "--rm",
    "--label",
    "com.linksense.test.disposable=true",
    "-d",
    "--name",
    redisContainer,
    "-p",
    "127.0.0.1::6379",
    "redis:7-alpine",
  );
  containers.push(redisContainer);
  const port = (await docker("port", databaseContainer, "5432"))
      .split(":")
      .at(-1),
    redisPort = (await docker("port", redisContainer, "6379"))
      .split(":")
      .at(-1);
  for (let attempt = 0; ; attempt++) {
    try {
      await docker(
        "exec",
        databaseContainer,
        "pg_isready",
        "-h",
        "127.0.0.1",
        "-U",
        "postgres",
      );
      break;
    } catch (error) {
      if (attempt > 50) throw error;
      await delay(100);
    }
  }
  const databaseUrl = `postgresql://postgres:${password}@127.0.0.1:${port}/public_knowledge_test`;
  const migrations = join(repositoryRoot, "prisma/migrations"),
    historical = join(root, "migrations");
  await mkdir(historical, { recursive: true });
  for (const entry of await readdir(migrations, { withFileTypes: true }))
    if (
      ![
        "20261105010000_public_knowledge_applications",
        "20261105011000_queue_public_knowledge_turns",
      ].includes(entry.name)
    )
      await cp(join(migrations, entry.name), join(historical, entry.name), {
        recursive: true,
      });
  const migrate = (path: string) =>
    execute(
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
        cwd: repositoryRoot,
        timeout: 120_000,
        maxBuffer: 8_000_000,
        env: {
          ...process.env,
          DATABASE_URL: databaseUrl,
          LINKSENSE_TEST_MIGRATIONS_PATH: path,
        },
      },
    );
  await migrate(historical);
  const db = createPrismaClient(databaseUrl);
  prisma = db;
  const owner = await db.user.create({
    data: {
      name: "Creator",
      email: "public-creator@example.test",
      role: "user",
      status: "active",
    },
  });
  const other = await db.user.create({
    data: {
      name: "Other creator",
      email: "other-creator@example.test",
      role: "user",
      status: "active",
    },
  });
  const legacy = await db.application.create({
    data: {
      ownerId: owner.id,
      name: "Existing standard",
      instructions: "Existing instructions",
    },
  });
  const interactive = await db.application.create({
    data: {
      ownerId: owner.id,
      name: "Existing interactive",
      instructions: "Existing interactive instructions",
      kind: "interactive",
      interactivePackageId: randomUUID(),
    },
  });
  const oldTask = await db.conversation.create({
    data: {
      ownerId: owner.id,
      applicationId: legacy.id,
      applicationNameSnapshot: legacy.name,
      title: "Existing conversation",
      titleSource: "manual",
      archiveStatus: "active",
      workspaceRelPath: "existing/workspace",
      runtimeGeneration: randomUUID(),
    },
  });
  const oldMessage = await db.conversationMessage.create({
    data: {
      conversationId: oldTask.id,
      sequenceNo: 1,
      role: "user",
      contentText: "Existing historical question",
    },
  });
  const before = JSON.stringify([legacy, interactive, oldTask, oldMessage]);
  await migrate(migrations);
  assert.equal(
    JSON.stringify([
      await db.application.findUnique({ where: { id: legacy.id } }),
      await db.application.findUnique({ where: { id: interactive.id } }),
      await db.conversation.findUnique({ where: { id: oldTask.id } }),
      await db.conversationMessage.findUnique({ where: { id: oldMessage.id } }),
    ]),
    before,
  );
  console.log(
    "PASS: upgrade preserves existing application kinds, task identity and historical content",
  );
  redis = new Redis(`redis://127.0.0.1:${redisPort}`, {
    maxRetriesPerRequest: 1,
  });
  otherRedis = new Redis(`redis://127.0.0.1:${redisPort}`, {
    maxRetriesPerRequest: 1,
  });
  await redis.ping();
  await otherRedis.ping();
  const coordinator = new RedisPublicKnowledgeCoordinator(redis, 2),
    otherCoordinator = new RedisPublicKnowledgeCoordinator(otherRedis, 2);
  const base = await db.knowledgeBase.create({
    data: {
      ownerId: owner.id,
      name: "Target website",
      description: "Public product documentation",
    },
  });
  const documentId = randomUUID(),
    documentVersionId = randomUUID();
  const models = {
    resolveRuntime: async () => {
      throw new Error("unexpected default model lookup");
    },
    resolveModelTransitionRuntime: async () => {
      throw new Error("unexpected model transition");
    },
    resolveRuntimeForSelection: async () => ({
      model: "fixture-model",
      reasoningEffort: "medium" as const,
      provider: {
        revision: 1,
        baseUrl: "https://inference.example.test/v1",
        protocolMode: "native_responses" as const,
        apiKey: "fixture-private-key",
      },
    }),
  };
  let nativeCalls = 0,
    nativeActive = 0,
    nativePeak = 0;
  let holdNative: Promise<void> | undefined;
  const nativeInputs: PublicKnowledgeRunnerInput[] = [];
  const runner = {
    runPublicKnowledgeTurn: async (input: PublicKnowledgeRunnerInput) => {
      nativeInputs.push(input);
      nativeCalls++;
      nativeActive++;
      nativePeak = Math.max(nativePeak, nativeActive);
      try {
        await holdNative;
      } finally {
        nativeActive--;
      }
      return {
        threadId: input.threadId ?? randomUUID(),
        turnId: randomUUID(),
        status: "completed" as const,
        outputText: `Product supports private deployment [1]. ${JSON.parse(input.inputText).question}`,
      };
    },
    readPublicKnowledgeResult: async () => null,
    interruptPublicKnowledgeTurn: async () => undefined,
  };
  const audit = new AuditService(db);
  const progressRedis = redis;
  const service = new PublicKnowledgeService({
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
    models,
    audit,
    runner,
    coordinator: new RedisPublicKnowledgeCoordinator(redis),
    queue: new BullMqPublicKnowledgeQueue(
      redis,
      `redis://127.0.0.1:${redisPort}`,
      pino({ level: "silent" }),
    ),
    knowledge: {
      resolveUsableKnowledgeBaseIds: async (actorId, ids) =>
        (
          await db.knowledgeBase.findMany({
            where: {
              id: { in: ids ?? [] },
              ownerId: actorId,
              lifecycleStatus: "active",
              availabilityStatus: "enabled",
            },
            select: { id: true },
          })
        ).map((row) => row.id),
    },
    retrieve: async (input) => {
      assert.deepEqual(input.knowledgeBaseIds, [base.id]);
      return {
        context:
          '[{"reference":1,"text":"This product supports private deployment."}]',
        citations: [
          {
            number: 1,
            knowledge_base_id: base.id,
            document_id: documentId,
            document_version_id: documentVersionId,
            title: "Deployment documentation",
            page_numbers: [],
            excerpt: "This product supports private deployment.",
          },
        ],
      };
    },
  });
  publicService = service;
  await service.start();
  const settled = async (turnId: string) => {
    for (let index = 0; index < 100; index++) {
      const turn = await db.publicKnowledgeTurn.findUniqueOrThrow({
        where: { id: turnId },
      });
      if (turn.status !== "queued" && turn.status !== "running") {
        assert.equal(turn.status, "completed");
        return turn;
      }
      await delay(100);
    }
    throw new Error("queued answer did not settle");
  };
  const actor = { id: owner.id, role: "user", status: "active" } as const;
  const settings = publicKnowledgeSettingsSchema.parse({
    name: "Website Q&A",
    instructions: "Answer from selected website knowledge",
    model: "fixture-model",
    reasoning_effort: "medium",
    knowledge_base_ids: [base.id],
    allowed_origins: ["https://website.example.test"],
    max_concurrent_turns: 2,
  });
  app.setErrorHandler((error, _request, reply) => {
    const normalized = normalizeError(error);
    reply
      .code(errorDetails(normalized.code, "en-US").status)
      .send({ error_code: normalized.code });
  });
  registerResponseSecurityHeaders(app);
  await app.register(publicKnowledgeManagementRoutes, {
    prefix: "/api/v1/applications",
    service,
    resolveActor: (request) => {
      if (!request.headers["x-test-actor"])
        throw new Error("test actor required");
      return { ...actor, id: String(request.headers["x-test-actor"]) };
    },
  });
  await app.register(publicKnowledgeVisitorRoutes, {
    prefix: "/api/v1/public-knowledge",
    service,
    developmentAssets: false,
  });
  const httpAddress = await app.listen({ host: "127.0.0.1", port: 0 });
  const createdResponse = await app.inject({
    method: "POST",
    url: "/api/v1/applications/public-knowledge",
    headers: { "x-test-actor": owner.id },
    payload: settings,
  });
  assert.equal(createdResponse.statusCode, 201, createdResponse.body);
  const application = publicKnowledgeManagementSchema.parse(
    createdResponse.json().data,
  );
  const frame = await app.inject(
    `/api/v1/public-knowledge/frame/${application.public_id}?parent_origin=${encodeURIComponent(settings.allowed_origins[0]!)}`,
  );
  assert.equal(frame.statusCode, 200);
  assert.equal(frame.headers["x-frame-options"], undefined);
  assert(
    String(frame.headers["content-security-policy"]).includes(
      "frame-ancestors https://website.example.test",
    ),
  );
  const regular = new ApplicationService(
    db,
    models,
    audit,
    {
      resolveForCapability: async () => {
        throw new Error("No plugin credentials expected");
      },
    },
    undefined,
    undefined,
    new ApplicationPublicationService(db, root),
  );
  const projected = await regular.get(actor, application.application_id);
  assert.equal(projected.kind, "public_knowledge");
  assert.equal(projected.knowledge_base_count, 1);
  await assert.rejects(
    regular.resolveRuntime(owner.id, application.application_id),
    { code: "FORBIDDEN" },
  );
  await assert.rejects(
    regular.update(
      actor,
      application.application_id,
      { instructions: "Generic path must not edit public settings" },
      {},
    ),
    { code: "FORBIDDEN" },
  );
  const catalog = await regular.catalog(actor, {
    state: "public_knowledge",
    limit: 30,
  });
  assert.equal(catalog.items.length, 1);
  assert.equal(
    (await regular.distributionSummaries(actor)).find(
      (item) => item.application_id === application.application_id,
    )?.usage_modes.length,
    0,
  );
  console.log(
    "PASS: create, publish, catalog projection and cross-origin frame security",
  );
  const first = publicKnowledgeSessionSchema.parse(
    await service.startSession(
      application.public_id,
      settings.allowed_origins[0]!,
      "visitor-a",
    ),
  );
  const second = publicKnowledgeSessionSchema.parse(
    await service.startSession(
      application.public_id,
      settings.allowed_origins[0]!,
      "visitor-b",
    ),
  );
  assert.notEqual(first.visitor_id, second.visitor_id);
  assert.notEqual(first.token, second.token);
  assert.equal(await db.user.count(), 2);
  assert.equal(await db.applicationRuntimeInstallation.count(), 0);
  const a = publicKnowledgeConversationSchema.parse(
    await service.createConversation(application.public_id, first.token),
  );
  const b = publicKnowledgeConversationSchema.parse(
    await service.createConversation(application.public_id, second.token),
  );
  const askUrl = (id: string) =>
    `/api/v1/public-knowledge/${application.public_id}/conversations/${id}/turns`;
  const question = {
    input_text: "VISITOR_A_PRIVATE_MARKER: is private deployment supported?",
    request_id: randomUUID(),
  };
  const answer = await app.inject({
    method: "POST",
    url: askUrl(a.id),
    headers: { authorization: `Bearer ${first.token}` },
    payload: question,
  });
  assert([200, 202].includes(answer.statusCode), answer.body);
  await settled(answer.json().data.id);
  const replay = await app.inject({
    method: "POST",
    url: askUrl(a.id),
    headers: { authorization: `Bearer ${first.token}` },
    payload: question,
  });
  assert.equal(replay.json().data.id, answer.json().data.id);
  assert.equal(replay.json().data.status, "completed");
  assert.equal(nativeCalls, 1);
  const forbidden = await app.inject({
    method: "POST",
    url: askUrl(a.id),
    headers: { authorization: `Bearer ${second.token}` },
    payload: { ...question, request_id: randomUUID() },
  });
  assert.equal(forbidden.statusCode, 404);
  assert.equal(nativeCalls, 1);
  await settled(
    (
      await service.ask(
        application.public_id,
        second.token,
        b.id,
        {
          input_text: "VISITOR_B_PRIVATE_MARKER: what does this product do?",
          request_id: randomUUID(),
        },
        "visitor-b",
      )
    ).id,
  );
  const threadA = (
    await db.publicKnowledgeConversation.findUniqueOrThrow({
      where: { id: a.id },
    })
  ).codexThreadId;
  await settled(
    (
      await service.ask(
        application.public_id,
        first.token,
        a.id,
        {
          input_text: "What configuration does that require?",
          request_id: randomUUID(),
        },
        "visitor-a",
      )
    ).id,
  );
  assert.equal(
    (
      await db.publicKnowledgeConversation.findUniqueOrThrow({
        where: { id: a.id },
      })
    ).codexThreadId,
    threadA,
  );
  assert.notEqual(
    (
      await db.publicKnowledgeConversation.findUniqueOrThrow({
        where: { id: b.id },
      })
    ).codexThreadId,
    threadA,
  );
  assert(
    !JSON.stringify(
      await service.visitorDetail(application.public_id, first.token, a.id),
    ).includes("VISITOR_B_PRIVATE_MARKER"),
  );
  assert(
    !JSON.stringify(
      await service.visitorDetail(application.public_id, second.token, b.id),
    ).includes("VISITOR_A_PRIVATE_MARKER"),
  );
  await assert.rejects(
    service.ownerDetail(
      { ...actor, id: other.id },
      application.application_id,
      a.id,
    ),
    { code: "APPLICATION_NOT_FOUND" },
  );
  const review = publicKnowledgeConversationDetailSchema.parse(
    await service.ownerDetail(actor, application.application_id, a.id),
  );
  assert.equal(
    review.turns[0]?.citations[0]?.document_version_id,
    documentVersionId,
  );
  assert.equal(nativeCalls, 3, "inspection must never invoke inference");
  const page = publicKnowledgeConversationPageSchema.parse(
    await service.listOwnerConversations(actor, application.application_id, {
      limit: 1,
    }),
  );
  assert.equal(page.items.length, 1);
  assert(page.next_cursor);
  const next = await service.listOwnerConversations(
    actor,
    application.application_id,
    { limit: 1, cursor: page.next_cursor },
  );
  assert.equal(next.items.length, 1);
  assert.notEqual(next.items[0]?.id, page.items[0]?.id);
  const searched = await service.listOwnerConversations(
    actor,
    application.application_id,
    { limit: 30, search: "VISITOR_A_PRIVATE_MARKER", status: "completed" },
  );
  assert.deepEqual(
    searched.items.map((item) => item.id),
    [a.id],
  );
  console.log(
    "PASS: anonymous isolation, continuation, idempotency, creator-only inspection and filtered pagination",
  );
  const one = await coordinator.acquire(application.application_id, a.id, 1);
  await assert.rejects(
    otherCoordinator.acquire(application.application_id, b.id, 1),
    { code: "APPLICATION_EXTERNAL_RATE_LIMITED" },
  );
  await assert.rejects(
    otherCoordinator.acquire(application.application_id, a.id, 2),
    { code: "APPLICATION_EXTERNAL_RATE_LIMITED" },
  );
  await one.release();
  const two = await otherCoordinator.acquire(
    application.application_id,
    b.id,
    1,
  );
  await two.release();
  const globalA = await coordinator.acquire(randomUUID(), randomUUID(), 1),
    globalB = await otherCoordinator.acquire(randomUUID(), randomUUID(), 1);
  await assert.rejects(
    otherCoordinator.acquire(randomUUID(), randomUUID(), 1),
    { code: "APPLICATION_EXTERNAL_RATE_LIMITED" },
  );
  await globalA.release();
  await globalB.release();
  const scaling = new RedisPublicKnowledgeCoordinator(redis),
    scalingApplication = randomUUID();
  const previousLimit = await Promise.all(
    Array.from({ length: 3 }, () =>
      scaling.acquire(scalingApplication, randomUUID(), 3),
    ),
  );
  await previousLimit[0]?.release();
  await assert.rejects(scaling.acquire(scalingApplication, randomUUID(), 1), {
    code: "APPLICATION_EXTERNAL_RATE_LIMITED",
  });
  await previousLimit[1]?.release();
  await previousLimit[2]?.release();
  const lowered = await scaling.acquire(scalingApplication, randomUUID(), 1);
  await lowered.release();
  console.log(
    "PASS: distributed per-conversation, application and global resource admission",
  );
  await Promise.all([
    service.save(
      actor,
      { ...settings, instructions: "Updated policy one" },
      application.application_id,
    ),
    service.save(
      actor,
      { ...settings, instructions: "Updated policy two" },
      application.application_id,
    ),
  ]);
  assert.equal(
    await db.applicationVersion.count({
      where: { applicationId: application.application_id },
    }),
    3,
  );
  assert.equal(
    (
      await db.publicKnowledgeTurn.findFirstOrThrow({
        where: { conversationId: a.id },
        orderBy: { createdAt: "asc" },
      })
    ).applicationVersion,
    "1.0.0",
  );
  await db.publicKnowledgeConversation.update({
    where: { id: b.id },
    data: { expiresAt: new Date(0) },
  });
  await assert.rejects(
    service.visitorDetail(application.public_id, second.token, b.id),
    { code: "CONVERSATION_NOT_FOUND" },
  );
  await assert.rejects(
    service.ownerDetail(actor, application.application_id, b.id),
    { code: "CONVERSATION_NOT_FOUND" },
  );
  await db.publicKnowledgeVisitor.update({
    where: { id: first.visitor_id },
    data: { expiresAt: new Date(0) },
  });
  await assert.rejects(
    service.visitorDetail(application.public_id, first.token, a.id),
    { code: "AUTH_REQUIRED" },
  );
  await assert.rejects(
    service.save(
      { ...actor, id: other.id },
      settings,
      application.application_id,
    ),
    { code: "APPLICATION_NOT_FOUND" },
  );
  assert.equal(await db.conversation.count(), 1);
  assert.equal(
    (
      await db.conversationMessage.findUniqueOrThrow({
        where: { id: oldMessage.id },
      })
    ).contentText,
    oldMessage.contentText,
  );
  assert.equal(await db.user.count(), 2);
  console.log(
    "PASS: concurrent publications retain version evidence; expiry and ownership checks remain enforced; existing business records unchanged",
  );
  await service.save(
    actor,
    { ...settings, max_concurrent_turns: 20 },
    application.application_id,
  );
  const people = await Promise.all(
    Array.from({ length: 21 }, async (_, index) => {
      const session = await service.startSession(
        application.public_id,
        settings.allowed_origins[0]!,
        `admission-${index}`,
      );
      return {
        token: session.token,
        conversation: await service.createConversation(
          application.public_id,
          session.token,
        ),
      };
    }),
  );
  let releaseNative = () => {};
  holdNative = new Promise<void>((resolve) => {
    releaseNative = resolve;
  });
  let accepted: Array<{ id: string }> = [];
  try {
    accepted = await Promise.all(
      people
        .slice(0, 20)
        .map((person) =>
          service.ask(
            application.public_id,
            person.token,
            person.conversation.id,
            { input_text: "Concurrent question", request_id: randomUUID() },
            "admission-test",
          ),
        ),
    );
    for (let i = 0; i < 100 && nativeCalls !== 23; i++) await delay(20);
    assert.equal(
      nativeCalls,
      23,
      "all 20 accepted turns must run concurrently without waiting for another answer",
    );
    const streamingPerson = people[0],
      otherPerson = people[1],
      streamingTurn = accepted[0];
    assert(streamingPerson && otherPerson && streamingTurn);
    const eventPath = `${httpAddress}/api/v1/public-knowledge/${application.public_id}/conversations/${streamingPerson.conversation.id}/events`;
    assert.equal((await fetch(eventPath)).status, 401);
    assert.equal(
      (
        await fetch(eventPath, {
          headers: { authorization: `Bearer ${otherPerson.token}` },
        })
      ).status,
      404,
    );
    const streamAbort = new AbortController();
    const response = await fetch(eventPath, {
      headers: { authorization: `Bearer ${streamingPerson.token}` },
      signal: AbortSignal.any([
        streamAbort.signal,
        AbortSignal.timeout(10_000),
      ]),
    });
    assert.equal(response.status, 200);
    assert.match(
      response.headers.get("content-type") ?? "",
      /text\/event-stream/u,
    );
    assert(response.body);
    const reader = response.body.getReader(),
      decoder = new TextDecoder();
    let progressText = "";
    const readUntil = async (marker: string) => {
      while (!progressText.includes(marker)) {
        const chunk = await reader.read();
        assert(!chunk.done);
        progressText += decoder.decode(chunk.value, { stream: true });
      }
    };
    try {
      await readUntil("conversation.step.completed");
      assert(progressText.includes("conversation.step.started"));
      const delivery = {
        deliveryId: randomUUID(),
        event: publicKnowledgeRunnerProgressSchema.parse({
          method: "linksense/publicKnowledge/progress",
          visibility: "user_visible",
          params: {
            threadId: streamingPerson.conversation.id,
            turnId: streamingTurn.id,
            notification: {
              method: "item/agentMessage/delta",
              visibility: "user_visible",
              params: {
                threadId: streamingPerson.conversation.id,
                turnId: streamingTurn.id,
                itemId: "public-live-message",
                delta: "PUBLIC_LIVE_DELTA",
              },
            },
          },
        }),
      };
      await service.ingestRunnerEvents(
        application.application_id,
        streamingPerson.conversation.id,
        [delivery],
      );
      await service.ingestRunnerEvents(
        application.application_id,
        streamingPerson.conversation.id,
        [delivery],
      );
      await readUntil("PUBLIC_LIVE_DELTA");
      assert.equal(
        await db.conversationEvent.count({
          where: { id: delivery.deliveryId },
        }),
        1,
      );
      assert.equal(
        (
          await db.publicKnowledgeTurn.findUniqueOrThrow({
            where: { id: streamingTurn.id },
          })
        ).status,
        "running",
        "SSE must deliver partial output before native completion",
      );
      await assert.rejects(
        service.ingestRunnerEvents(
          randomUUID(),
          streamingPerson.conversation.id,
          [delivery],
        ),
        { code: "FORBIDDEN" },
      );
      await assert.rejects(
        service.ingestRunnerEvents(
          application.application_id,
          otherPerson.conversation.id,
          [delivery],
        ),
        { code: "FORBIDDEN" },
      );
      console.log(
        "PASS: real HTTP SSE replays search progress and delivers partial output before completion; visitor/worker isolation and delivery idempotency remain enforced",
      );
    } finally {
      try {
        await reader.cancel();
      } finally {
        streamAbort.abort();
      }
    }
    const overflow = people[20];
    assert(overflow);
    const queued = await service.ask(
      application.public_id,
      overflow.token,
      overflow.conversation.id,
      { input_text: "Queued overflow", request_id: randomUUID() },
      "admission-test",
    );
    assert.equal(queued.status, "queued");
    accepted.push(queued);
    await delay(100);
    assert.equal(
      nativeCalls,
      23,
      "over-capacity input must remain queued until a slot is released",
    );
  } finally {
    holdNative = undefined;
    releaseNative();
  }
  await Promise.all(accepted.map((turn) => settled(turn.id)));
  console.log(
    "PASS: 20 distributed turns execute concurrently; the 21st turn queues and starts after a slot is released",
  );
  assert.equal(nativeCalls, 24);
  await service.save(
    actor,
    { ...settings, max_concurrent_turns: 2 },
    application.application_id,
  );
  assert.equal(
    (await service.management(actor, application.application_id)).settings
      .max_concurrent_turns,
    2,
  );
  const small = await Promise.all(
    Array.from({ length: 5 }, async (_, index) => {
      const session = await service.startSession(
        application.public_id,
        settings.allowed_origins[0]!,
        `configured-${index}`,
      );
      return {
        token: session.token,
        conversation: await service.createConversation(
          application.public_id,
          session.token,
        ),
      };
    }),
  );
  nativePeak = 0;
  holdNative = new Promise<void>((resolve) => {
    releaseNative = resolve;
  });
  let burst: Array<{ id: string }> = [],
    cancelledId: string | undefined;
  try {
    burst = await Promise.all(
      small.map((person) =>
        service.ask(
          application.public_id,
          person.token,
          person.conversation.id,
          { input_text: "Configured concurrency", request_id: randomUUID() },
          "configured-admission",
        ),
      ),
    );
    for (let i = 0; i < 100 && nativeCalls !== 26; i++) await delay(20);
    assert.equal(nativeCalls, 26);
    const rows = await db.publicKnowledgeTurn.findMany({
      where: { id: { in: burst.map((item) => item.id) } },
    });
    assert.equal(rows.filter((row) => row.status === "running").length, 2);
    assert.equal(rows.filter((row) => row.status === "queued").length, 3);
    const waiting = rows.find((row) => row.status === "queued");
    assert(waiting);
    const person = small.find(
      (item) => item.conversation.id === waiting.conversationId,
    );
    assert(person);
    assert.equal(
      (
        await service.visitorDetail(
          application.public_id,
          person.token,
          person.conversation.id,
        )
      ).queue_waiting_visitors,
      3,
    );
    const anotherConversation = await service.createConversation(
      application.public_id,
      person.token,
    );
    const duplicateVisitorTurn = await db.publicKnowledgeTurn.create({
      data: {
        conversationId: anotherConversation.id,
        applicationVersionId: waiting.applicationVersionId,
        applicationVersion: waiting.applicationVersion,
        requestId: randomUUID(),
        inputText: "Queue visitor count fixture",
        model: waiting.model,
        status: "queued",
      },
    });
    try {
      assert.equal(
        (
          await service.visitorDetail(
            application.public_id,
            person.token,
            person.conversation.id,
          )
        ).queue_waiting_visitors,
        3,
        "Multiple queued questions from one visitor count as one waiting person",
      );
    } finally {
      await db.publicKnowledgeTurn.delete({
        where: { id: duplicateVisitorTurn.id },
      });
      await db.publicKnowledgeConversation.delete({
        where: { id: anotherConversation.id },
      });
    }
    await service.interrupt(
      application.public_id,
      person.token,
      person.conversation.id,
      waiting.id,
    );
    cancelledId = waiting.id;
    const otherWaiting = rows.find(
      (row) => row.status === "queued" && row.id !== waiting.id,
    );
    const otherPerson = small.find(
      (item) => item.conversation.id === otherWaiting?.conversationId,
    );
    assert(otherPerson);
    assert.equal(
      (
        await service.visitorDetail(
          application.public_id,
          otherPerson.token,
          otherPerson.conversation.id,
        )
      ).queue_waiting_visitors,
      2,
    );
    assert.equal(
      (
        await db.publicKnowledgeTurn.findUniqueOrThrow({
          where: { id: waiting.id },
        })
      ).status,
      "interrupted",
    );
  } finally {
    holdNative = undefined;
    releaseNative();
  }
  await Promise.all(
    burst
      .filter((turn) => turn.id !== cancelledId)
      .map((turn) => settled(turn.id)),
  );
  assert.equal(nativePeak, 2);
  assert.equal(nativeCalls, 28);
  console.log(
    "PASS: saved concurrency of 2 admits exactly 2 of 5 visitors, queues the other 3, supports cancellation, and drains without duplicate inference",
  );
  const skillId = randomUUID(),
    skillRoot = join(root, "capabilities", skillId);
  await mkdir(skillRoot, { recursive: true });
  const markdown =
    "---\nname: website-guide\ndescription: Website response style\n---\nPUBLISHED_GUIDANCE_MARKER\n";
  await writeFile(join(skillRoot, "SKILL.md"), markdown);
  await writeFile(join(skillRoot, "script.sh"), "echo must-not-execute");
  await db.capability.create({
    data: {
      id: skillId,
      ownerId: owner.id,
      installedBy: owner.id,
      type: "skill",
      status: "active",
      name: "website-guide",
      slug: "website-guide",
      sourceType: "local",
      storagePath: skillId,
      manifestJson: { name: "website-guide" },
    },
  });
  // A public application published before skill_ids existed remains editable and executable.
  const existingPublic = await service.save(actor, settings);
  const oldSettings = Object.fromEntries(
    Object.entries(settings).filter(([key]) => key !== "skill_ids"),
  );
  await db.publicKnowledgeApplication.update({
    where: { applicationId: existingPublic.application_id },
    data: { settingsJson: oldSettings },
  });
  const oldManagement = await service.management(
    actor,
    existingPublic.application_id,
  );
  assert.deepEqual(oldManagement.settings.skill_ids, []);
  await service.save(
    actor,
    oldManagement.settings,
    existingPublic.application_id,
  );
  const skillVisitor = await service.startSession(
    existingPublic.public_id,
    settings.allowed_origins[0]!,
    "skill-visitor",
  );
  const skillConversation = await service.createConversation(
    existingPublic.public_id,
    skillVisitor.token,
  );
  const questionWithSkills = async () => {
    const queued = await service.ask(
      existingPublic.public_id,
      skillVisitor.token,
      skillConversation.id,
      { input_text: "What does the website say?", request_id: randomUUID() },
      "skill-test",
    );
    await settled(queued.id);
    return nativeInputs.at(-1);
  };
  assert.deepEqual((await questionWithSkills())?.skills, []);
  const selectedSettings = { ...settings, skill_ids: [skillId] };
  await service.save(actor, selectedSettings, existingPublic.application_id);
  assert.deepEqual(
    (await service.management(actor, existingPublic.application_id)).settings
      .skill_ids,
    [skillId],
  );
  const bindings = await db.applicationCapability.findMany({
    where: { applicationId: existingPublic.application_id },
  });
  assert.deepEqual(
    bindings.map((binding) => binding.capabilityId),
    [skillId],
  );
  await writeFile(
    join(skillRoot, "SKILL.md"),
    markdown.replace("PUBLISHED_GUIDANCE_MARKER", "UNPUBLISHED_SOURCE_EDIT"),
  );
  assert.deepEqual((await questionWithSkills())?.skills, [
    { id: skillId, name: "website-guide", markdown },
  ]);
  const dependencyUnavailable = (error: unknown) =>
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "APPLICATION_DEPENDENCY_UNAVAILABLE";
  for (const change of [
    { ownerId: other.id },
    { type: "plugin" },
    { status: "disabled" },
  ]) {
    await db.capability.update({ where: { id: skillId }, data: change });
    await assert.rejects(
      service.save(actor, selectedSettings, existingPublic.application_id),
      dependencyUnavailable,
    );
    await db.capability.update({
      where: { id: skillId },
      data: { ownerId: owner.id, type: "skill", status: "active" },
    });
  }
  await db.capabilityUserPreference.create({
    data: {
      userId: owner.id,
      capabilityId: skillId,
      status: "disabled",
      disabledAt: new Date(),
    },
  });
  await assert.rejects(
    service.save(actor, selectedSettings, existingPublic.application_id),
    dependencyUnavailable,
  );
  await db.capabilityUserPreference.delete({
    where: { userId_capabilityId: { userId: owner.id, capabilityId: skillId } },
  });
  await service.save(actor, settings, existingPublic.application_id);
  assert.equal(
    await db.applicationCapability.count({
      where: { applicationId: existingPublic.application_id },
    }),
    0,
  );
  assert.deepEqual((await questionWithSkills())?.skills, []);
  console.log(
    "PASS: existing public settings remain usable; selected Skills persist, bind, freeze at publication, reach execution, reject foreign/plugin/disabled selections, and can be removed",
  );
  const displaySettings = (
    await service.management(actor, existingPublic.application_id)
  ).settings;
  await service.save(
    actor,
    { ...displaySettings, show_references: false },
    existingPublic.application_id,
  );
  assert.equal(
    (
      await service.publicConfiguration(
        existingPublic.public_id,
        settings.allowed_origins[0]!,
      )
    ).show_references,
    false,
  );
  assert.equal(
    (
      await service.visitorDetail(
        existingPublic.public_id,
        skillVisitor.token,
        skillConversation.id,
      )
    ).turns[0]?.citations.length,
    0,
  );
  assert(
    (
      await service.ownerDetail(
        actor,
        existingPublic.application_id,
        skillConversation.id,
      )
    ).turns[0]?.citations[0]?.excerpt,
  );
  await service.save(actor, displaySettings, existingPublic.application_id);
  const visibleReferences = await service.visitorDetail(
    existingPublic.public_id,
    skillVisitor.token,
    skillConversation.id,
  );
  assert(visibleReferences.turns[0]?.citations[0]?.title);
  assert.equal(visibleReferences.turns[0]?.citations[0]?.excerpt, "");
  const versionsBeforeStatus = await db.applicationVersion.count({
    where: { applicationId: existingPublic.application_id },
  });
  const beforeStatus = await service.management(
    actor,
    existingPublic.application_id,
  );
  const statusUrl = `/api/v1/applications/${existingPublic.application_id}/public-knowledge/status`;
  const disabled = await app.inject({
    method: "PATCH",
    url: statusUrl,
    headers: { "x-test-actor": owner.id },
    payload: { enabled: false },
  });
  assert.equal(disabled.statusCode, 200, disabled.body);
  assert.equal(disabled.json().data.settings.enabled, false);
  await assert.rejects(
    service.startSession(
      existingPublic.public_id,
      settings.allowed_origins[0]!,
      "disabled-access",
    ),
    { code: "APPLICATION_NOT_FOUND" },
  );
  const deniedStatus = await app.inject({
    method: "PATCH",
    url: statusUrl,
    headers: { "x-test-actor": other.id },
    payload: { enabled: true },
  });
  assert.equal(deniedStatus.statusCode, 404);
  const enabled = await app.inject({
    method: "PATCH",
    url: statusUrl,
    headers: { "x-test-actor": owner.id },
    payload: { enabled: true },
  });
  assert.equal(enabled.statusCode, 200, enabled.body);
  assert.deepEqual(enabled.json().data.settings, beforeStatus.settings);
  assert.equal(
    await db.applicationVersion.count({
      where: { applicationId: existingPublic.application_id },
    }),
    versionsBeforeStatus,
  );
  const usageUrl = `/api/v1/applications/${application.application_id}/public-knowledge/usage`;
  const usageResponse = await app.inject({
    url: usageUrl,
    headers: { "x-test-actor": owner.id },
  });
  assert.equal(usageResponse.statusCode, 200, usageResponse.body);
  const usage = publicKnowledgeUsageSchema.parse(usageResponse.json().data);
  const ownedConversations = await db.publicKnowledgeConversation.findMany({
    where: { applicationId: application.application_id },
    select: { id: true },
  });
  assert.equal(usage.conversations, ownedConversations.length);
  assert.equal(
    usage.questions,
    await db.publicKnowledgeTurn.count({
      where: {
        conversationId: { in: ownedConversations.map((row) => row.id) },
      },
    }),
  );
  assert.equal(
    usage.questions,
    Object.values(usage.statuses).reduce((sum, value) => sum + value, 0),
  );
  assert.equal(
    usage.visitors,
    await db.publicKnowledgeVisitor.count({
      where: { applicationId: application.application_id },
    }),
  );
  assert(usage.average_duration_ms !== null && usage.average_duration_ms >= 0);
  const futureUsage = await service.usage(actor, application.application_id, {
    from: "2099-01-01T00:00:00Z",
  });
  assert.equal(futureUsage.questions, 0);
  assert.equal(futureUsage.visitors, 0);
  assert.equal(
    (await app.inject({ url: usageUrl, headers: { "x-test-actor": other.id } }))
      .statusCode,
    404,
  );
  await regular.delete(actor, existingPublic.application_id, {});
  assert.equal(
    (
      await db.application.findUniqueOrThrow({
        where: { id: existingPublic.application_id },
      })
    ).status,
    "deleted",
  );
  await assert.rejects(
    service.startSession(
      existingPublic.public_id,
      settings.allowed_origins[0]!,
      "deleted-access",
    ),
    { code: "APPLICATION_NOT_FOUND" },
  );
  assert.equal(
    await db.publicKnowledgeTurn.count({
      where: { conversationId: skillConversation.id },
    }),
    3,
    "Deleting an application retains its Q&A records",
  );
  console.log(
    "PASS: public access status changes preserve releases, usage is app-scoped and date-filtered, foreign management is denied, and deletion blocks visitors while retaining Q&A logs",
  );
} finally {
  await app.close();
  await publicService?.close();
  await prisma?.$disconnect();
  await redis?.quit();
  await otherRedis?.quit();
  await Promise.all(
    containers.map((name) =>
      docker("rm", "-f", "--volumes", name).catch(() => undefined),
    ),
  );
  await rm(root, { recursive: true, force: true });
}
