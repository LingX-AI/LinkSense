// Run after shared/API build. Creates only an isolated disposable PostgreSQL;
// never reads DATABASE_URL or connects to an existing business database.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { createPrismaClient } from "../apps/api/dist/db.js";
import { settleDeploymentTasks } from "../apps/api/dist/operations/deployment-task-stop.js";
import { isStoppedDeploymentEvent } from "../apps/api/dist/modules/events/deployment-fence.js";

const execute = promisify(execFile);
const root = fileURLToPath(new URL("..", import.meta.url));
const name = `linksense-deployment-test-${randomUUID()}`;
const password = randomUUID();
const docker = async (...args) =>
  (await execute("docker", args, { timeout: 30_000 })).stdout.trim();
let owned = false;
let prisma;
try {
  await docker("image", "inspect", "postgres:16-alpine");
  await docker(
    "run",
    "--detach",
    "--rm",
    "--pull",
    "never",
    "--name",
    name,
    "--label",
    `com.linksense.deployment.test=${name}`,
    "--memory",
    "256m",
    "--cpus",
    "1",
    "-e",
    "POSTGRES_DB=linksense_deployment_test",
    "-e",
    `POSTGRES_PASSWORD=${password}`,
    "-p",
    "127.0.0.1::5432",
    "postgres:16-alpine",
  );
  owned = true;
  const port = (await docker("port", name, "5432/tcp")).match(
    /^127\.0\.0\.1:(\d+)$/,
  )?.[1];
  assert.ok(port);
  const databaseUrl = `postgresql://postgres:${password}@127.0.0.1:${port}/linksense_deployment_test`;
  let ready = false;
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      await docker("exec", name, "pg_isready", "-U", "postgres");
      ready = true;
      break;
    } catch {
      await delay(100);
    }
  }
  assert.ok(ready, "isolated PostgreSQL did not become ready");
  await execute("pnpm", ["exec", "prisma", "migrate", "deploy"], {
    cwd: root,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    timeout: 120_000,
    maxBuffer: 4_000_000,
  });
  prisma = createPrismaClient(databaseUrl);
  const ownerId = randomUUID();
  const runtimeGeneration = randomUUID();
  const conversationId = randomUUID();
  const startConversationId = randomUUID();
  const startedAt = new Date("2026-09-09T00:00:00Z");
  const stoppedAt = new Date("2026-09-09T00:01:00Z");
  for (const id of [conversationId, startConversationId]) {
    await prisma.conversation.create({
      data: {
        id,
        ownerId,
        title: "Deployment fixture",
        titleSource: "manual",
        archiveStatus: "active",
        workspaceRelPath: id,
        runtimeGeneration,
        codexThreadId: id === conversationId ? "native-thread" : null,
      },
    });
  }
  const turnData = {
    conversationId,
    submittedBy: ownerId,
    codexThreadId: "native-thread",
    submitMode: "normal",
    capabilityGeneration: "a".repeat(64),
    capabilitiesJson: [],
    startedAt,
  };
  const completed = await prisma.conversationTurn.create({
    data: {
      ...turnData,
      sequenceNo: 1,
      codexTurnId: "native-completed",
      status: "completed",
      completedAt: startedAt,
    },
  });
  const running = await prisma.conversationTurn.create({
    data: {
      ...turnData,
      sequenceNo: 2,
      codexTurnId: "native-running",
      status: "running",
    },
  });
  await prisma.conversationTurnAttempt.create({
    data: {
      turnId: running.id,
      attemptNo: 1,
      kind: "primary",
      codexThreadId: "native-thread",
      codexTurnId: "native-running",
      status: "running",
      startedAt,
    },
  });
  await prisma.conversationGoal.create({
    data: {
      conversationId,
      ownerId,
      codexThreadId: "native-thread",
      activeTurnId: running.id,
      objective: "Retained goal",
      status: "active",
      nativeCreatedAt: startedAt,
      nativeUpdatedAt: startedAt,
    },
  });
  const message = await prisma.conversationMessage.create({
    data: {
      conversationId,
      turnId: running.id,
      sequenceNo: 1,
      role: "assistant",
      contentText: "Keep this existing response",
    },
  });
  const pending = await prisma.pendingRequest.create({
    data: {
      conversationId,
      submittedBy: ownerId,
      queueNo: 1n,
      inputText: "queued input",
      status: "waiting_previous_turn",
    },
  });
  const attachment = await prisma.conversationFile.create({
    data: {
      conversationId: startConversationId,
      kind: "attachment",
      source: "user_upload",
      status: "staged",
      filename: "keep.txt",
      sizeBytes: 10n,
      storageBackend: "workspace",
      workspaceRelativePath: "attachments/keep.txt",
      downloadable: false,
      createdBy: ownerId,
    },
  });
  const intent = await prisma.conversationTurnStartIntent.create({
    data: {
      projectionTurnId: randomUUID(),
      conversationId: startConversationId,
      ownerId,
      runtimeGeneration,
      capabilityGeneration: "a".repeat(64),
      inputText: "unprojected input",
      submitMode: "normal",
      attachmentsJson: [{ id: attachment.id }],
    },
  });
  const automation = await prisma.automation.create({
    data: {
      ownerId,
      conversationId,
      title: "Fixture schedule",
      instruction: "fixture",
      status: "active",
      frequency: "daily",
      intervalCount: 1,
      timeOfDayMinutes: 60,
      timeZone: "Asia/Shanghai",
      anchorAt: startedAt,
      nextRunAt: new Date("2026-09-10T00:00:00Z"),
      lastRunAt: startedAt,
      lastRunStatus: "started",
    },
  });
  const run = await prisma.automationRun.create({
    data: {
      automationId: automation.id,
      ownerId,
      conversationId,
      scheduledFor: startedAt,
      idempotencyKey: randomUUID(),
      status: "started",
      turnId: running.id,
    },
  });

  await assert.rejects(
    settleDeploymentTasks(
      prisma,
      {
        releaseTurnSlot: async () => {
          throw new Error("simulated Redis outage");
        },
      },
      stoppedAt,
    ),
    /simulated Redis outage/,
  );
  assert.equal(await prisma.conversationTurnStartIntent.count(), 1);
  assert.equal(
    await prisma.auditLog.count(),
    0,
    "transaction must roll back audit too",
  );
  assert.equal(
    (
      await prisma.conversationTurn.findUniqueOrThrow({
        where: { id: running.id },
      })
    ).status,
    "running",
  );
  const released = [];
  const redis = {
    releaseTurnSlot: async (conversation, turn) => {
      released.push([conversation, turn]);
    },
  };
  assert.deepEqual(await settleDeploymentTasks(prisma, redis, stoppedAt), {
    turns: 1,
    starts: 1,
    pending: 1,
  });
  assert.equal(
    (
      await prisma.conversationTurn.findUniqueOrThrow({
        where: { id: running.id },
      })
    ).errorCode,
    "DEPLOYMENT_STOPPED",
  );
  assert.deepEqual(
    await prisma.conversationTurn.findUniqueOrThrow({
      where: { id: completed.id },
    }),
    completed,
  );
  assert.deepEqual(
    await prisma.conversationMessage.findUniqueOrThrow({
      where: { id: message.id },
    }),
    message,
  );
  assert.equal(
    (
      await prisma.pendingRequest.findUniqueOrThrow({
        where: { id: pending.id },
      })
    ).blockCode,
    "deployment_stopped",
  );
  assert.equal(
    (
      await prisma.pendingRequest.findUniqueOrThrow({
        where: { id: intent.projectionTurnId },
      })
    ).inputText,
    intent.inputText,
  );
  const retainedFile = await prisma.conversationFile.findUniqueOrThrow({
    where: { id: attachment.id },
  });
  assert.equal(
    retainedFile.workspaceRelativePath,
    attachment.workspaceRelativePath,
  );
  assert.equal(retainedFile.pendingRequestId, intent.projectionTurnId);
  assert.equal(await prisma.conversationTurnStartIntent.count(), 0);
  assert.equal(
    (
      await prisma.conversationGoal.findUniqueOrThrow({
        where: { conversationId },
      })
    ).status,
    "paused",
  );
  assert.equal(
    (await prisma.automationRun.findUniqueOrThrow({ where: { id: run.id } }))
      .errorCode,
    "DEPLOYMENT_STOPPED",
  );
  assert.deepEqual(
    (
      await prisma.automation.findUniqueOrThrow({
        where: { id: automation.id },
      })
    ).nextRunAt,
    automation.nextRunAt,
  );
  assert.equal(
    await isStoppedDeploymentEvent(prisma, conversationId, "native-thread"),
    true,
  );
  assert.equal(
    await isStoppedDeploymentEvent(prisma, conversationId, "native-thread", {
      nativeUpdatedAt: stoppedAt.getTime() / 1000 + 1,
    }),
    false,
  );
  assert.equal(released.length, 2);
  const events = await prisma.conversationEvent.count();
  const audits = await prisma.auditLog.count();
  assert.deepEqual(await settleDeploymentTasks(prisma, redis, stoppedAt), {
    turns: 0,
    starts: 0,
    pending: 0,
  });
  assert.equal(await prisma.conversationEvent.count(), events);
  assert.equal(await prisma.auditLog.count(), audits);
  process.stdout.write(
    "PASS: real PostgreSQL settlement, rollback, history retention, replay fencing and idempotency.\n",
  );
} finally {
  await prisma?.$disconnect();
  if (owned) {
    assert.equal(
      await docker(
        "inspect",
        "--format",
        '{{ index .Config.Labels "com.linksense.deployment.test" }}',
        name,
      ),
      name,
    );
    await docker("rm", "--force", "--volumes", name);
    process.stdout.write(
      "Removed the isolated test container and its disposable database volume.\n",
    );
  }
}
