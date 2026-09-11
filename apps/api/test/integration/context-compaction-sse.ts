import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import Fastify from "fastify";
import { conversationEventSchema } from "@linksense/shared";

import { LinkSenseRedis } from "../../src/adapters/redis.js";
import type { AppConfig } from "../../src/config.js";
import { createPrismaClient } from "../../src/db.js";
import { AppError } from "../../src/lib/errors.js";
import type { ConversationService } from "../../src/modules/conversations/service.js";
import { internalRunnerRoutes, sseRoutes } from "../../src/modules/events/routes.js";
import { ConversationEventService } from "../../src/modules/events/service.js";
import type { AppServices } from "../../src/services.js";

// Disposable containers only: never read the application's .env or connect to
// its databases. Run explicitly with pnpm exec tsx; this is not a unit test.
const execute = promisify(execFile);
const root = fileURLToPath(new URL("../../../../", import.meta.url));
const testName = `linksense-compaction-test-${randomUUID()}`;
const containers: string[] = [];
const docker = async (...args: string[]): Promise<string> =>
  (await execute("docker", args, { timeout: 30_000 })).stdout.trim();
const ownerId = randomUUID();
const conversationId = randomUUID();
const turnId = randomUUID();
const runtimeGeneration = randomUUID();
const sourceThreadId = randomUUID();
const compactTurnId = randomUUID();
const item = { type: "contextCompaction", id: randomUUID() };
const app = Fastify();
const streams: AbortController[] = [];
let prisma: ReturnType<typeof createPrismaClient> | undefined;
let redis: LinkSenseRedis | undefined;

try {
  const password = randomUUID();
  const pgPort = await startContainer("postgres", "postgres:16-alpine", "5432", [
    "-e", "POSTGRES_DB=linksense_compaction_test",
    "-e", `POSTGRES_PASSWORD=${password}`,
  ]);
  const databaseUrl = `postgresql://postgres:${password}@127.0.0.1:${pgPort}/linksense_compaction_test`;
  for (let attempt = 0; ; attempt += 1) {
    try {
      await docker("exec", `${testName}-postgres`, "pg_isready", "-U", "postgres");
      break;
    } catch (error) {
      if (attempt >= 50) throw error;
      await delay(100);
    }
  }
  await execute("pnpm", ["exec", "prisma", "migrate", "deploy", "--config", "apps/api/test/integration/prisma.config.ts"], {
    cwd: root,
    env: { ...process.env, DOTENV_CONFIG_PATH: "/dev/null", DATABASE_URL: databaseUrl },
    timeout: 120_000,
    maxBuffer: 4_000_000,
  });
  const redisPort = await startContainer("redis", "redis:7.4-alpine", "6379");
  const config = {
    redisUrl: `redis://127.0.0.1:${redisPort}`,
    publicBaseUrl: "http://localhost:5173",
    runnerSharedSecret: randomUUID(),
  } as AppConfig;
  const database = createPrismaClient(databaseUrl);
  prisma = database;
  redis = new LinkSenseRedis(config);
  await redis.connect();
  await database.conversation.create({
    data: {
      id: conversationId, ownerId, title: "Compaction stream test",
      titleSource: "manual", archiveStatus: "active",
      workspaceRelPath: `compaction-test/${conversationId}`,
      codexThreadId: sourceThreadId, runtimeGeneration,
    },
  });
  await database.conversationTurnStartIntent.create({
    data: {
      projectionTurnId: turnId, conversationId, ownerId, runtimeGeneration,
      capabilityGeneration: "0".repeat(64), inputText: "Continue",
      submitMode: "normal", runnerStatus: "prepared",
    },
  });
  // Only authentication/admission are fixtures. Ingestion, database predicates,
  // Redis fan-out, cursor replay and HTTP SSE use the production implementation.
  const conversations = {
    assertOwner: async (owner: string, id: string) => {
      const row = await database.conversation.findFirst({ where: { id, ownerId: owner } });
      if (!row) throw new AppError("CONVERSATION_NOT_FOUND");
      return row;
    },
  } as ConversationService;
  const events = new ConversationEventService(database, redis, conversations);
  const services = { config, conversations, events, redis } as AppServices;
  app.decorate("authenticate", async (request) => {
    request.authUser = {
      id: ownerId, email: "owner@example.test", name: "Owner", role: "user",
      status: "active", preferredLocale: "zh-CN", avatarObjectKey: null,
      authValidAfter: new Date(0),
    };
  });
  await app.register(internalRunnerRoutes, { prefix: "/internal", services });
  await app.register(sseRoutes, { prefix: "/conversations", services });
  const origin = await app.listen({ host: "127.0.0.1", port: 0 });
  const stream = await openStream(origin);
  const startDeliveryId = randomUUID();
  await publish("item/started", startDeliveryId);
  const started = await stream.readEvent();
  assert.equal(started.event_type, "item/started");
  assert.equal(started.turn_id, turnId);
  assert.equal(await database.conversationTurn.count({ where: { conversationId } }), 0);
  assert.equal(await database.conversationEvent.count({ where: { conversationId, eventType: "item/completed" } }), 0);
  console.log("compaction start arrived over HTTP SSE before completion or turn projection");

  const replay = await openStream(origin);
  assert.equal((await replay.readEvent()).id, started.id);
  assert.deepEqual((await events.historyPage(ownerId, conversationId, {
    afterSequence: BigInt(started.sequence_no), limit: 20,
  })).items, []);
  replay.close();
  await publish("item/completed", randomUUID());
  const completed = await stream.readEvent();
  assert.equal(completed.event_type, "item/completed");
  assert.equal(completed.turn_id, turnId);
  assert.equal(await database.conversationTurn.count({ where: { conversationId } }), 0);
  stream.close();

  // Unrelated unprojected items, stale branches and internal events stay hidden.
  await database.conversationEvent.createMany({
    data: [
      { turnId, itemType: "reasoning", visibility: "user_collapsed" },
      { turnId: randomUUID(), itemType: "contextCompaction", visibility: "user_collapsed" },
      { turnId, itemType: "contextCompaction", visibility: "internal_sanitized" },
    ].map((row, index) => ({
      conversationId, turnId: row.turnId, sequenceNo: BigInt(index + 3),
      eventType: "item/started", visibility: row.visibility,
      sseEventId: `${conversationId}:${index + 3}`,
      payloadJson: {
        schema_version: 2, source: "codex_app_server", method: "item/started",
        params: { threadId: sourceThreadId, turnId: compactTurnId,
          item: { type: row.itemType, id: randomUUID() } },
      },
    })),
  });
  const history = () => events.historyPage(ownerId, conversationId, { afterSequence: 0n, limit: 20 });
  assert.deepEqual((await history()).items.map((event) => event.id), [started.id, completed.id]);
  for (const runnerStatus of ["slot_pending", "release_pending"]) {
    await database.conversationTurnStartIntent.update({ where: { projectionTurnId: turnId }, data: { runnerStatus } });
    assert.deepEqual((await history()).items, []);
  }
  const targetThreadId = randomUUID();
  const targetTurnId = randomUUID();
  await database.conversationTurnStartIntent.update({
    where: { projectionTurnId: turnId },
    data: { runnerStatus: "runner_succeeded", codexThreadId: targetThreadId, codexTurnId: targetTurnId },
  });
  assert.deepEqual((await history()).items.map((event) => event.id), [started.id, completed.id]);
  await assert.rejects(events.historyPage(randomUUID(), conversationId, { afterSequence: 0n, limit: 20 }), { code: "CONVERSATION_NOT_FOUND" });

  await database.$transaction(async (tx) => {
    await tx.conversationTurn.create({
      data: {
        id: turnId, conversationId, submittedBy: ownerId, sequenceNo: 1,
        codexThreadId: targetThreadId, codexTurnId: targetTurnId, status: "running",
        submitMode: "normal", capabilityGeneration: "0".repeat(64),
        capabilitiesJson: [], startedAt: new Date(),
      },
    });
    await tx.conversation.update({ where: { id: conversationId }, data: { codexThreadId: targetThreadId } });
    await tx.conversationTurnStartIntent.delete({ where: { projectionTurnId: turnId } });
  });
  assert.deepEqual((await history()).items.slice(0, 2).map((event) => event.id), [started.id, completed.id]);
  await publish("item/started", startDeliveryId);
  assert.equal(await database.conversationEvent.count({ where: { id: startDeliveryId } }), 1);

  const foreignConversationId = randomUUID();
  const foreignTurnId = randomUUID();
  await database.conversationTurn.create({ data: {
    id: foreignTurnId, conversationId: foreignConversationId, submittedBy: ownerId,
    sequenceNo: 1, codexThreadId: targetThreadId, codexTurnId: randomUUID(), status: "running",
    submitMode: "normal", capabilityGeneration: "0".repeat(64), capabilitiesJson: [], startedAt: new Date(),
  } });
  const deltaPayload = (delta: string) => ({
    schema_version: 2, source: "codex_app_server", method: "item/agentMessage/delta",
    params: { threadId: targetThreadId, turnId: targetTurnId, itemId: "test-item", delta },
  });
  const titlePayload = (threadId: string) => ({
    schema_version: 2, source: "codex_app_server", method: "thread/name/updated",
    params: { threadId, threadName: "Test title" },
  });
  const mixedEvents = [
    { turnId, eventType: "item/agentMessage/delta", visibility: "user_visible", payloadJson: deltaPayload("正文"), visible: true },
    { turnId: foreignTurnId, eventType: "item/agentMessage/delta", visibility: "user_visible", payloadJson: deltaPayload("foreign"), visible: false },
    { turnId: null, eventType: "thread/name/updated", visibility: "user_visible", payloadJson: titlePayload(sourceThreadId), visible: false },
    { turnId: null, eventType: "thread/name/updated", visibility: "user_visible", payloadJson: titlePayload(targetThreadId), visible: true },
    { turnId: null, eventType: "conversation.title.updated", visibility: "user_visible", payloadJson: { schema_version: 1, title: "Test title", thread_id: targetThreadId }, visible: true },
    { turnId: null, eventType: "conversation.title.updated", visibility: "user_visible", payloadJson: { schema_version: 1, title: "Test title", thread_id: sourceThreadId }, visible: false },
    { turnId: null, eventType: "conversation.error", visibility: "user_visible", payloadJson: { schema_version: 1, error_code: "INTERNAL_ERROR", message_key: "errors.internal" }, visible: true },
    { turnId, eventType: "item/agentMessage/delta", visibility: "internal_sanitized", payloadJson: deltaPayload("internal"), visible: false },
  ];
  const lastBeforeMixed = await database.conversationEvent.findFirst({ where: { conversationId }, orderBy: { sequenceNo: "desc" } });
  assert.ok(lastBeforeMixed);
  const mixedRows = mixedEvents.map((event, index) => ({
    turnId: event.turnId, eventType: event.eventType, visibility: event.visibility, payloadJson: event.payloadJson, id: randomUUID(), conversationId,
    sequenceNo: lastBeforeMixed.sequenceNo + BigInt(index + 1),
    sseEventId: `${conversationId}:${lastBeforeMixed.sequenceNo + BigInt(index + 1)}`,
  }));
  await database.conversationEvent.createMany({ data: mixedRows });
  const expectedIds = mixedRows.filter((_row, index) => mixedEvents[index]!.visible).map(row => row.id);
  const actualIds: string[] = [];
  let cursor = lastBeforeMixed.sequenceNo;
  for (;;) {
    const page = await events.historyPage(ownerId, conversationId, { afterSequence: cursor, limit: 2 });
    actualIds.push(...page.items.map(event => event.id));
    cursor = page.last_sequence;
    if (!page.next_cursor) break;
    assert.equal(page.next_cursor, `${conversationId}:${cursor}`);
  }
  assert.deepEqual(actualIds, expectedIds);
  const emptyPage = await events.historyPage(ownerId, conversationId, { afterSequence: cursor, limit: 2 });
  assert.deepEqual(emptyPage.items, []);
  assert.equal(emptyPage.confirmed_sequence, mixedRows.at(-1)!.sequenceNo);
  const aheadCursor = mixedRows.at(-1)!.sequenceNo + 10n;
  assert.equal((await events.historyPage(ownerId, conversationId, { afterSequence: aheadCursor, limit: 2 })).confirmed_sequence, aheadCursor);

  // Changing the branch changes the next read, including title visibility;
  // global events remain visible and no projection state is cached.
  await database.conversation.update({ where: { id: conversationId }, data: { codexThreadId: sourceThreadId } });
  assert.deepEqual((await events.historyPage(ownerId, conversationId, { afterSequence: lastBeforeMixed.sequenceNo, limit: 20 })).items.map(event => event.id), [
    mixedRows[2]!.id, mixedRows[5]!.id, mixedRows[6]!.id,
  ]);
  await database.conversation.update({ where: { id: conversationId }, data: { codexThreadId: null } });
  assert.deepEqual((await events.historyPage(ownerId, conversationId, { afterSequence: lastBeforeMixed.sequenceNo, limit: 20 })).items.map(event => event.id), [mixedRows[6]!.id]);
  console.log("reconnect, completion, inactive-intent filtering, privacy and native branch projection: passed");
  console.log("mixed-event pagination, cross-conversation isolation, filtered gaps and branch changes: passed");

  await database.conversation.update({ where: { id: conversationId }, data: { codexThreadId: targetThreadId } });
  const batchItemId = randomUUID();
  const batchText = ["引号'；DROP TABLE conversation_events; --", '\\路径\n🙂 "正文"'];
  const batchEntries = [
    { method: "item/agentMessage/delta", visibility: "user_visible", params: { threadId: targetThreadId, turnId: targetTurnId, itemId: batchItemId, delta: batchText[0] } },
    { method: "item/agentMessage/delta", visibility: "user_visible", params: { threadId: targetThreadId, turnId: targetTurnId, itemId: batchItemId, delta: batchText[1] } },
    { method: "item/completed", visibility: "user_visible", params: { threadId: targetThreadId, turnId: targetTurnId, item: { id: batchItemId, type: "agentMessage", phase: "final_answer", text: batchText.join("") } } },
  ].map(event => ({ deliveryId: randomUUID(), event }));
  const ingest = events.ingest.bind(events);
  let failCompletion = true;
  events.ingest = async (...args) => {
    if (args[2] === batchEntries[2]!.deliveryId && failCompletion) throw new Error("injected completion failure");
    return ingest(...args);
  };
  const deliverBatch = async (entries: Array<{ deliveryId: string; event: (typeof batchEntries)[number]["event"] }>) => {
    const response = await fetch(`${origin}/internal/runner/events`, {
      method: "POST", headers: {
        "content-type": "application/json", authorization: `Bearer ${config.runnerSharedSecret}`,
        "x-linksense-owner-id": ownerId,
      },
      body: JSON.stringify({ conversationId, events: entries }),
      signal: AbortSignal.timeout(5_000),
    });
    assert.equal(response.status, 200);
    return await response.json() as { data: { accepted_delivery_ids: string[] } };
  };
  assert.deepEqual((await deliverBatch(batchEntries)).data.accepted_delivery_ids, batchEntries.slice(0, 2).map(entry => entry.deliveryId));
  assert.equal(await database.conversationEvent.count({ where: { id: batchEntries[2]!.deliveryId } }), 0);
  failCompletion = false;
  // Retrying the whole batch also covers a lost receipt: completed message
  // projection and durable event ids must stay unique.
  for (let retry = 0; retry < 2; retry++) {
    assert.deepEqual((await deliverBatch(batchEntries)).data.accepted_delivery_ids, batchEntries.map(entry => entry.deliveryId));
  }
  assert.equal(await database.conversationEvent.count({ where: { id: { in: batchEntries.map(entry => entry.deliveryId) } } }), 3);
  assert.equal(await database.conversationMessage.count({ where: { conversationId, contentText: batchText.join("") } }), 1);
  const storedText = await database.conversationEvent.findMany({
    where: { id: { in: batchEntries.slice(0, 2).map(entry => entry.deliveryId) } }, orderBy: { sequenceNo: "asc" },
  });
  assert.deepEqual(storedText.map(row => row.payloadJson), batchEntries.slice(0, 2).map(entry => ({
    schema_version: 2, source: "codex_app_server", method: entry.event.method, params: entry.event.params,
  })));

  const switchedEntries = batchEntries.map(entry => ({ ...entry, deliveryId: randomUUID() }));
  events.ingest = ingest;
  const ingestTextDeltaBatch = events.ingestTextDeltaBatch.bind(events);
  events.ingestTextDeltaBatch = async (...args) => {
    const result = await ingestTextDeltaBatch(...args);
    if (args[1][0]?.deliveryId === switchedEntries[0]!.deliveryId) {
      await database.conversation.update({ where: { id: conversationId }, data: { codexThreadId: sourceThreadId } });
    }
    return result;
  };
  assert.deepEqual((await deliverBatch(switchedEntries)).data.accepted_delivery_ids, switchedEntries.map(entry => entry.deliveryId));
  assert.equal(await database.conversationEvent.count({ where: { id: switchedEntries[2]!.deliveryId } }), 0);
  console.log("partial batch failure, lost receipts, duplicate message prevention and branch revalidation: passed");

  events.ingestTextDeltaBatch = ingestTextDeltaBatch;
  await database.conversation.update({ where: { id: conversationId }, data: { codexThreadId: targetThreadId } });
  const concurrentEntries = batchEntries.slice(0, 2).map(entry => ({ ...entry, deliveryId: randomUUID().toUpperCase() }));
  const concurrentResults = await Promise.all([
    deliverBatch(concurrentEntries), deliverBatch(concurrentEntries), deliverBatch(concurrentEntries),
  ]);
  for (const result of concurrentResults) {
    assert.deepEqual(result.data.accepted_delivery_ids, concurrentEntries.map(entry => entry.deliveryId));
  }
  const concurrentRows = await database.conversationEvent.findMany({
    where: { id: { in: concurrentEntries.map(entry => entry.deliveryId) } }, orderBy: { sequenceNo: "asc" },
  });
  assert.deepEqual(concurrentRows.map(row => row.id), concurrentEntries.map(entry => entry.deliveryId.toLowerCase()));
  assert.equal(concurrentRows[1]!.sequenceNo, concurrentRows[0]!.sequenceNo + 1n);
  const resumed = await openStream(origin, concurrentRows[0]!.sseEventId);
  assert.equal((await resumed.readEvent()).id, concurrentRows[1]!.id);
  resumed.close();
  console.log("concurrent text batch retries, unique consecutive sequences and SSE cursor resume: passed");

  async function publish(method: "item/started" | "item/completed", deliveryId: string): Promise<void> {
    const response = await fetch(`${origin}/internal/runner/events`, {
      method: "POST", headers: {
        "content-type": "application/json", authorization: `Bearer ${config.runnerSharedSecret}`,
        "x-linksense-owner-id": ownerId,
      },
      body: JSON.stringify({
        conversationId, events: [{ deliveryId,
        event: { method, visibility: "user_collapsed", preparation: { turnId },
          params: { threadId: sourceThreadId, turnId: compactTurnId, item } } }],
      }),
      signal: AbortSignal.timeout(5_000),
    });
    assert.equal(response.status, 200, await response.text());
  }
} finally {
  for (const stream of streams) stream.abort();
  await app.close();
  await redis?.close();
  await prisma?.$disconnect();
  for (const name of containers.reverse()) await docker("stop", "--time", "1", name);
}

async function startContainer(kind: string, image: string, port: string, args: string[] = []): Promise<string> {
  const name = `${testName}-${kind}`;
  await docker("run", "--detach", "--rm", "--pull", "never", "--name", name,
    "--label", `com.linksense.compaction.test=${testName}`, "--memory", "256m", "--cpus", "1",
    "-p", `127.0.0.1::${port}`, ...args, image);
  containers.push(name);
  const exposedPort = (await docker("port", name, `${port}/tcp`)).match(/^127\.0\.0\.1:(\d+)$/u)?.[1];
  assert.ok(exposedPort);
  return exposedPort;
}

async function openStream(origin: string, lastEventId?: string) {
  const controller = new AbortController();
  streams.push(controller);
  const response = await fetch(`${origin}/conversations/${conversationId}/events`, {
    signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]),
    headers: lastEventId ? { "last-event-id": lastEventId } : {},
  });
  assert.equal(response.status, 200);
  const reader = response.body?.getReader();
  assert.ok(reader);
  const decoder = new TextDecoder();
  let buffer = "";
  return {
    close: () => controller.abort(),
    async readEvent() {
      while (true) {
        const boundary = buffer.indexOf("\n\n");
        if (boundary >= 0) {
          const frame = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const data = frame.split("\n").find((line) => line.startsWith("data: "));
          if (data) return conversationEventSchema.parse(JSON.parse(data.slice(6)));
          continue;
        }
        const chunk = await reader.read();
        assert.equal(chunk.done, false, "SSE closed before compaction became visible");
        buffer += decoder.decode(chunk.value, { stream: true });
      }
    },
  };
}
