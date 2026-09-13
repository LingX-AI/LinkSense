import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { cp, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { Prisma } from "../../src/generated/prisma/client.js";
import { createPrismaClient } from "../../src/db.js";
import { AppError } from "../../src/lib/errors.js";
import { upsertAsyncUserInputRequest } from "../../src/modules/events/async-user-input.js";
import {
  respondToAsyncUserInput,
  type AsyncAnswerDelivery,
} from "../../src/modules/conversations/async-user-input.js";

// Always creates a disposable PostgreSQL container; never loads application .env.
const execute = promisify(execFile);
const repositoryRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const migrationName = "20260913060000_add_async_user_input";
const temporaryRoot = await mkdtemp(
  join(tmpdir(), "linksense-async-input-db-"),
);
const containerName = `linksense-async-input-${randomUUID()}`;
const docker = async (...args: string[]) =>
  (await execute("docker", args, { timeout: 30_000 })).stdout.trim();
let containerStarted = false;
let database: ReturnType<typeof createPrismaClient> | undefined;
const ownerId = randomUUID();
const conversationId = randomUUID();
const sourceTurnId = randomUUID();
const nativeThreadId = randomUUID();
const nativeTurnId = randomUUID();
const response = {
  action: "accept",
  content: { "question-1": "Complete" },
} as const;
const results: string[] = [];

try {
  const password = randomUUID();
  await docker(
    "run",
    "--detach",
    "--name",
    containerName,
    "--publish",
    "127.0.0.1::5432",
    "--env",
    "POSTGRES_DB=linksense_async_input_test",
    "--env",
    `POSTGRES_PASSWORD=${password}`,
    "postgres:16-alpine",
  );
  containerStarted = true;
  const port = Number(
    (await docker("port", containerName, "5432")).split(":").at(-1),
  );
  assert(Number.isInteger(port) && port > 0);
  for (let attempt = 0; ; attempt++) {
    try {
      await docker("exec", containerName, "pg_isready", "-U", "postgres");
      break;
    } catch (error) {
      if (attempt >= 50) throw error;
      await delay(100);
    }
  }
  const databaseUrl = `postgresql://postgres:${password}@127.0.0.1:${port}/linksense_async_input_test`;
  const historicalMigrations = join(temporaryRoot, "migrations");
  const currentMigrations = join(repositoryRoot, "prisma/migrations");
  for (const entry of await readdir(currentMigrations, {
    withFileTypes: true,
  })) {
    if (!entry.isDirectory() || entry.name < migrationName)
      await cp(
        join(currentMigrations, entry.name),
        join(historicalMigrations, entry.name),
        { recursive: true },
      );
  }
  await migrate(historicalMigrations);
  database = createPrismaClient(databaseUrl);
  const prisma = database;
  const questionId = randomUUID();
  const formId = randomUUID();
  await prisma.$executeRaw`
    INSERT INTO conversation_user_input_requests
      (id, conversation_id, turn_id, owner_id, codex_thread_id, codex_turn_id, codex_item_id,
       native_request_id, questions_json, status, request_kind)
    VALUES (${questionId}::uuid, ${conversationId}::uuid, ${sourceTurnId}::uuid, ${ownerId}::uuid,
      ${nativeThreadId}, ${nativeTurnId}, 'legacy-question', 17,
      '[{"id":"legacy","header":"确认","question":"历史问题","is_other":true,"is_secret":false,"options":null}]'::jsonb,
      'pending', 'questions')`;
  await prisma.$executeRaw`
    INSERT INTO conversation_user_input_requests
      (id, conversation_id, turn_id, owner_id, codex_thread_id, codex_turn_id, codex_item_id,
       native_request_id, questions_json, status, request_kind, server_name, message_text,
       form_schema_json, form_ui_hints_json, form_response_semantics_json, response_content_json, resolved_action)
    VALUES (${formId}::uuid, ${conversationId}::uuid, ${sourceTurnId}::uuid, ${ownerId}::uuid,
      ${nativeThreadId}, ${nativeTurnId}, 'legacy-form', 18, '[]'::jsonb, 'answered', 'form', 'linksense_core', '历史表单',
      '{"type":"object","properties":{"title":{"type":"string","title":"标题"}},"required":["title"]}'::jsonb,
      '{}'::jsonb, '{"kind":"input"}'::jsonb, '{"title":"保留原有答案"}'::jsonb, 'accept')`;
  const before = await prisma.$queryRaw<
    Array<{ value: Prisma.JsonObject }>
  >`SELECT to_jsonb(q) AS value FROM conversation_user_input_requests q ORDER BY id`;
  const checksums = await prisma.$queryRaw<
    Array<{ migration_name: string; checksum: string }>
  >`SELECT migration_name, checksum FROM _prisma_migrations ORDER BY migration_name`;
  await migrate(currentMigrations);
  const after = await prisma.$queryRaw<
    Array<{ value: Prisma.JsonObject }>
  >`SELECT to_jsonb(q) - 'response_delivery_json' AS value FROM conversation_user_input_requests q ORDER BY id`;
  assert.deepEqual(after, before);
  const upgradedChecksums = await prisma.$queryRaw<
    Array<{ migration_name: string; checksum: string }>
  >`SELECT migration_name, checksum FROM _prisma_migrations WHERE migration_name < ${migrationName} ORDER BY migration_name`;
  assert.deepEqual(upgradedChecksums, checksums);
  assert.equal(
    (
      await prisma.conversationUserInputRequest.findUniqueOrThrow({
        where: { id: questionId },
      })
    ).nativeRequestId,
    17n,
  );
  assert.equal(
    (
      await prisma.conversationUserInputRequest.findUniqueOrThrow({
        where: { id: formId },
      })
    ).responseDeliveryJson,
    null,
  );
  results.push(
    "all historical fields, answers and migration checksums preserved",
  );

  await prisma.conversation.create({
    data: {
      id: conversationId,
      ownerId,
      codexThreadId: nativeThreadId,
      title: "Async input integration",
      titleSource: "manual",
      archiveStatus: "active",
      workspaceRelPath: `async-input/${conversationId}`,
      runtimeGeneration: randomUUID(),
    },
  });
  const sourceTurn = await prisma.conversationTurn.create({
    data: {
      id: sourceTurnId,
      conversationId,
      submittedBy: ownerId,
      sequenceNo: 1,
      codexThreadId: nativeThreadId,
      codexTurnId: nativeTurnId,
      status: "running",
      submitMode: "normal",
      capabilityGeneration: "0".repeat(64),
      capabilitiesJson: [],
      startedAt: new Date(),
    },
  });
  const createQuestion = async () => {
    assert(database);
    return database.$transaction((tx) =>
      upsertAsyncUserInputRequest(tx, conversationId, sourceTurn, {
        id: randomUUID(),
        questions: [
          { title: "Which scope?", options: ["Complete", "Minimal"] },
        ],
      }),
    );
  };
  const question = await createQuestion();
  const redelivered = await prisma.$transaction((tx) =>
    upsertAsyncUserInputRequest(tx, conversationId, sourceTurn, {
      id: question.codexItemId,
      questions: [{ title: "Which scope?", options: ["Complete", "Minimal"] }],
    }),
  );
  assert.equal(redelivered.id, question.id);
  assert.equal(redelivered.nativeRequestId, null);
  results.push("native async item persistence and JSONB redelivery");

  const deliveries: AsyncAnswerDelivery[] = [];
  let releaseDeliveries: (() => void) | undefined;
  const deliveryGate = new Promise<void>((resolve) => {
    releaseDeliveries = resolve;
  });
  const deliveryGateTimeout = setTimeout(
    () => releaseDeliveries?.(),
    10_000,
  ).unref();
  const deliver = async (
    delivery: AsyncAnswerDelivery,
    text: string,
    threadId: string,
  ) => {
    assert.equal(text, "> Which scope?\n\nComplete");
    assert.equal(threadId, nativeThreadId);
    deliveries.push(delivery);
    if (deliveries.length >= 2) releaseDeliveries?.();
    await deliveryGate;
  };
  const input = {
    prisma,
    ownerId,
    conversationId,
    requestId: question.id,
    response,
    deliver,
  };
  const answers = await Promise.all(
    Array.from({ length: 8 }, () => respondToAsyncUserInput(input)),
  );
  clearTimeout(deliveryGateTimeout);
  assert(deliveries.length >= 2);
  assert.equal(
    new Set(deliveries.map((delivery) => JSON.stringify(delivery))).size,
    1,
    "one native operation identity",
  );
  assert.equal(deliveries[0]?.method, "steer");
  assert.equal(
    answers.filter((answer) => answer.event !== null).length,
    1,
    "one completion event",
  );
  const callsBeforeRetry = deliveries.length;
  assert.equal((await respondToAsyncUserInput(input)).event, null);
  assert.equal(deliveries.length, callsBeforeRetry);
  assert.equal(
    await prisma.conversationEvent.count({
      where: {
        conversationId,
        eventType: "conversation.user_input_request.updated",
      },
    }),
    1,
  );
  results.push(
    "eight concurrent answers share one native operation and one completion event",
  );

  const duplicateAfterAnswer = await prisma.$transaction((tx) =>
    upsertAsyncUserInputRequest(tx, conversationId, sourceTurn, {
      id: question.codexItemId,
      questions: [{ title: "Which scope?", options: ["Complete", "Minimal"] }],
    }),
  );
  assert.equal(duplicateAfterAnswer.status, "answered");
  await assert.rejects(
    respondToAsyncUserInput({
      ...input,
      response: { action: "accept", content: { "question-1": "Changed" } },
    }),
    { code: "CONFLICT" },
  );
  await assert.rejects(
    respondToAsyncUserInput({ ...input, ownerId: randomUUID() }),
    { code: "USER_INPUT_REQUEST_UNAVAILABLE" },
  );
  results.push("resolved answers, ownership and changed-answer rejection");

  const uncertainQuestion = await createQuestion();
  let uncertainDelivery: AsyncAnswerDelivery | undefined;
  await assert.rejects(
    respondToAsyncUserInput({
      ...input,
      requestId: uncertainQuestion.id,
      deliver: async (delivery) => {
        uncertainDelivery = delivery;
        throw new AppError("TURN_STEER_REQUEST_UNCERTAIN");
      },
    }),
    { code: "TURN_STEER_REQUEST_UNCERTAIN" },
  );
  const uncertainRow =
    await prisma.conversationUserInputRequest.findUniqueOrThrow({
      where: { id: uncertainQuestion.id },
    });
  assert.equal(uncertainRow.status, "pending");
  assert.deepEqual(uncertainRow.responseDeliveryJson, uncertainDelivery);
  assert.deepEqual(uncertainRow.responseContentJson, response.content);
  await prisma.$disconnect();
  database = createPrismaClient(databaseUrl);
  const restarted = database;
  await respondToAsyncUserInput({
    ...input,
    prisma: restarted,
    requestId: uncertainQuestion.id,
    deliver: async (delivery) => {
      assert.deepEqual(delivery, uncertainDelivery);
    },
  });
  results.push(
    "uncertain delivery persists across database-client restart without rerouting",
  );

  await restarted.conversationTurn.update({
    where: { id: sourceTurnId },
    data: { status: "completed", completedAt: new Date() },
  });
  const afterTurn = await createQuestion();
  let startDelivery: AsyncAnswerDelivery | undefined;
  await respondToAsyncUserInput({
    ...input,
    prisma: restarted,
    requestId: afterTurn.id,
    deliver: async (delivery) => {
      startDelivery = delivery;
    },
  });
  assert.deepEqual(startDelivery, {
    method: "start",
    idempotencyKey: `async-answer:${afterTurn.id}`,
  });
  const cancelled = await createQuestion();
  await respondToAsyncUserInput({
    ...input,
    prisma: restarted,
    requestId: cancelled.id,
    response: { action: "cancel" },
    deliver: async () => {
      assert.fail("cancel must not execute a model request");
    },
  });
  assert.equal(
    (
      await restarted.conversationUserInputRequest.findUniqueOrThrow({
        where: { id: cancelled.id },
      })
    ).status,
    "cancelled",
  );
  results.push(
    "completed-turn answers start a new native input; cancellation does not execute",
  );

  await assert.rejects(
    restarted.conversationUserInputRequest.update({
      where: { id: questionId },
      data: { nativeRequestId: null },
    }),
  );
  await assert.rejects(
    restarted.conversationUserInputRequest.update({
      where: { id: formId },
      data: { formResponseSemanticsJson: Prisma.DbNull },
    }),
  );
  await assert.rejects(
    restarted.conversationUserInputRequest.update({
      where: { id: question.id },
      data: { nativeRequestId: 19n },
    }),
  );
  for (const invalid of [
    {},
    { method: "unknown" },
    { method: "start", idempotencyKey: "x".repeat(2100) },
    { method: "steer", turnId: sourceTurnId },
    { method: "start", idempotencyKey: "valid", extra: true },
  ]) {
    await assert.rejects(
      restarted.conversationUserInputRequest.update({
        where: { id: question.id },
        data: { responseDeliveryJson: invalid },
      }),
    );
  }
  results.push(
    "database rejects invalid legacy shapes, fake request ids and malformed or oversized delivery bindings",
  );
  console.log(
    JSON.stringify({
      status: "ok",
      database: "disposable PostgreSQL 16",
      results,
    }),
  );

  async function migrate(migrationsPath: string): Promise<void> {
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
        cwd: repositoryRoot,
        timeout: 120_000,
        maxBuffer: 4_000_000,
        env: {
          ...process.env,
          DATABASE_URL: databaseUrl,
          LINKSENSE_TEST_MIGRATIONS_PATH: migrationsPath,
        },
      },
    );
  }
} finally {
  await database?.$disconnect();
  if (containerStarted) await docker("rm", "--force", containerName);
  await rm(temporaryRoot, { recursive: true, force: true });
}
