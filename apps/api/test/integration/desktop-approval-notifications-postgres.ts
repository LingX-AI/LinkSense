import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { createPrismaClient } from "../../src/db.js";
import { sha256 } from "../../src/lib/crypto.js";
import {
  desktopApprovalNotificationsQuery,
  readDesktopApprovalNotifications,
} from "../../src/modules/conversations/desktop-approval-notifications.js";
import { lockDesktopConversation } from "../../src/modules/desktop-credentials/run-authority.js";
import { PrismaDesktopDeviceRepository } from "../../src/modules/desktop-devices/repository.js";

// Owns a disposable PostgreSQL cluster and never loads the application
// environment. All rows are synthetic; no credentials or personal data.
const execute = promisify(execFile);
const repositoryRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const root = await mkdtemp(join(tmpdir(), "linksense-approval-notify-pg-"));
const data = join(root, "data");
const port = await new Promise<number>((resolve, reject) => {
  const server = createServer();
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    if (!address || typeof address === "string") {
      server.close();
      reject(new Error("Missing test port"));
      return;
    }
    server.close(error => (error ? reject(error) : resolve(address.port)));
  });
});
const databaseUrl = (name: string) => {
  const url = new URL(`postgresql://127.0.0.1:${port}/${name}`);
  url.username = userInfo().username;
  return url.toString();
};
let started = false;
let prisma: ReturnType<typeof createPrismaClient> | undefined;

const NOW = new Date("2026-11-20T12:00:00.000Z");
const EPOCH = new Date("2026-01-01T00:00:00.000Z");
const PENDING_EXPIRY = new Date(NOW.getTime() + 60_000);
const APPROVAL_JSON = {
  method: "item/commandExecution/requestApproval",
  decisions: ["accept", "decline", "cancel"],
  command: "printf synthetic",
  cwd: null,
};

type Owner = { ownerId: string; deviceId: string; epoch: Date };

try {
  await execute(
    "initdb",
    ["-D", data, "--auth=trust", "--encoding=UTF8", "--no-locale"],
    { timeout: 30_000 },
  );
  await execute(
    "pg_ctl",
    [
      "-D",
      data,
      "-l",
      join(root, "server.log"),
      "-w",
      "start",
      "-o",
      `-h 127.0.0.1 -p ${port} -c unix_socket_directories='' -c timezone=UTC`,
    ],
    { timeout: 30_000 },
  );
  started = true;
  const control = createPrismaClient(databaseUrl("postgres"));
  try {
    await control.$executeRawUnsafe("CREATE DATABASE desktop_approval_notifications");
  } finally {
    await control.$disconnect();
  }
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
      timeout: 180_000,
      maxBuffer: 4_000_000,
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl("desktop_approval_notifications"),
      },
    },
  );

  prisma = createPrismaClient(databaseUrl("desktop_approval_notifications"));
  const db = prisma;
  let sequence = 0;
  let createdAtOffset = 0;

  const createOwner = async (
    label: string,
    options: { status?: string; epoch?: Date } = {},
  ): Promise<Owner> => {
    const ownerId = randomUUID();
    const epoch = options.epoch ?? EPOCH;
    await db.user.create({
      data: {
        id: ownerId,
        email: `${label}-${ownerId}@example.test`,
        name: label,
        role: "user",
        status: options.status ?? "active",
        authValidAfter: epoch,
        createdAt: epoch,
      },
    });
    const deviceId = randomUUID();
    await db.desktopDevice.create({
      data: {
        id: deviceId,
        ownerId,
        name: `${label} Mac`,
        platform: "darwin",
        arch: "arm64",
        appVersion: "0.1.0",
        tokenHash: `${randomUUID()}${randomUUID()}`.replaceAll("-", ""),
        authValidAfter: epoch,
      },
    });
    return { ownerId, deviceId, epoch };
  };

  const createConversation = async (input: {
    ownerId: string;
    deviceId: string;
    thread?: string;
    archiveStatus?: string;
    executionTarget?: string;
  }) => {
    const id = randomUUID();
    const thread = input.thread ?? randomUUID();
    const archiveStatus = input.archiveStatus ?? "active";
    await db.conversation.create({
      data: {
        id,
        ownerId: input.ownerId,
        title: "Synthetic local task",
        titleSource: "manual",
        archiveStatus,
        ...(archiveStatus === "archived" ? { archivedAt: NOW } : {}),
        workspaceRelPath: `${input.ownerId}/home/workspaces/${id}`,
        runtimeGeneration: randomUUID(),
        executionTarget: input.executionTarget ?? "local",
        desktopDeviceId: input.deviceId,
        codexThreadId: thread,
      },
    });
    return { id, thread };
  };

  const createTurn = async (input: {
    conversationId: string;
    ownerId: string;
    thread: string;
    codexTurnId?: string;
    status?: string;
    completedAt?: Date | null;
    interruptRequestedAt?: Date | null;
    sequenceNo?: number;
  }) => {
    const id = randomUUID();
    await db.conversationTurn.create({
      data: {
        id,
        conversationId: input.conversationId,
        sequenceNo: input.sequenceNo ?? ++sequence,
        submittedBy: input.ownerId,
        codexThreadId: input.thread,
        codexTurnId: input.codexTurnId ?? randomUUID(),
        status: input.status ?? "running",
        submitMode: "normal",
        capabilityGeneration: "0".repeat(64),
        capabilitiesJson: [],
        startedAt: new Date(NOW.getTime() - 86_400_000),
        completedAt: input.completedAt ?? null,
        interruptRequestedAt: input.interruptRequestedAt ?? null,
      },
    });
    return id;
  };

  const createApproval = async (input: {
    conversationId: string;
    turnId: string;
    ownerId: string;
    thread: string;
    codexTurnId: string;
    nativeRequestId: bigint;
    status?: string;
    expiresAt?: Date;
    createdAt?: Date;
  }) => {
    const id = randomUUID();
    await db.conversationDesktopApproval.create({
      data: {
        id,
        conversationId: input.conversationId,
        turnId: input.turnId,
        ownerId: input.ownerId,
        codexThreadId: input.thread,
        codexTurnId: input.codexTurnId,
        codexItemId: `item-${input.nativeRequestId}`,
        nativeRequestId: input.nativeRequestId,
        approvalJson: APPROVAL_JSON,
        status: input.status ?? "pending",
        expiresAt: input.expiresAt ?? PENDING_EXPIRY,
        createdAt:
          input.createdAt ??
          new Date(NOW.getTime() + createdAtOffset++ * 1_000),
      },
    });
    return id;
  };

  const read = (ownerId: string, filter: { conversationId?: string; requestId?: string } = {}) =>
    readDesktopApprovalNotifications(db, { ownerId, now: NOW, ...filter });

  const main = await createOwner("main");
  const mainConversation = await createConversation(main);
  const mainTurn = await createTurn({
    conversationId: mainConversation.id,
    ownerId: main.ownerId,
    thread: mainConversation.thread,
  });
  const mainApproval = await createApproval({
    conversationId: mainConversation.id,
    turnId: mainTurn,
    ownerId: main.ownerId,
    thread: mainConversation.thread,
    codexTurnId: (
      await db.conversationTurn.findUniqueOrThrow({ where: { id: mainTurn } })
    ).codexTurnId,
    nativeRequestId: 1n,
    createdAt: new Date(NOW.getTime() + 1_000),
  });

  // Two non-expired requests in one turn: only the oldest native request is
  // the head, even when the newer row was created first.
  const headConversation = await createConversation(main);
  const headTurn = await createTurn({
    conversationId: headConversation.id,
    ownerId: main.ownerId,
    thread: headConversation.thread,
  });
  const headCodexTurnId = (
    await db.conversationTurn.findUniqueOrThrow({ where: { id: headTurn } })
  ).codexTurnId;
  await createApproval({
    conversationId: headConversation.id,
    turnId: headTurn,
    ownerId: main.ownerId,
    thread: headConversation.thread,
    codexTurnId: headCodexTurnId,
    nativeRequestId: 9n,
    createdAt: new Date(NOW.getTime() + 3_000),
  });
  const headApproval = await createApproval({
    conversationId: headConversation.id,
    turnId: headTurn,
    ownerId: main.ownerId,
    thread: headConversation.thread,
    codexTurnId: headCodexTurnId,
    nativeRequestId: 2n,
    createdAt: new Date(NOW.getTime() + 4_000),
  });

  const excluded: string[] = [];

  // A stale native thread on the head blocks the turn; a newer valid request
  // must not be advertised because the responder would still reject it.
  const staleHeadConversation = await createConversation(main);
  const staleHeadTurn = await createTurn({
    conversationId: staleHeadConversation.id,
    ownerId: main.ownerId,
    thread: staleHeadConversation.thread,
  });
  const staleHeadCodexTurnId = (
    await db.conversationTurn.findUniqueOrThrow({ where: { id: staleHeadTurn } })
  ).codexTurnId;
  excluded.push(
    await createApproval({
      conversationId: staleHeadConversation.id,
      turnId: staleHeadTurn,
      ownerId: main.ownerId,
      thread: randomUUID(),
      codexTurnId: staleHeadCodexTurnId,
      nativeRequestId: 1n,
    }),
  );
  excluded.push(
    await createApproval({
      conversationId: staleHeadConversation.id,
      turnId: staleHeadTurn,
      ownerId: main.ownerId,
      thread: staleHeadConversation.thread,
      codexTurnId: staleHeadCodexTurnId,
      nativeRequestId: 2n,
    }),
  );
  const createCase = async (input: {
    conversation?: { archiveStatus?: string; executionTarget?: string };
    turn?: {
      status?: string;
      completedAt?: Date | null;
      interruptRequestedAt?: Date | null;
      thread?: string;
    };
    approval?: {
      status?: string;
      expiresAt?: Date;
      thread?: string;
      codexTurnId?: string;
    };
  }) => {
    const conversation = await createConversation({
      ownerId: main.ownerId,
      deviceId: main.deviceId,
      ...input.conversation,
    });
    const turn = await createTurn({
      conversationId: conversation.id,
      ownerId: main.ownerId,
      thread: input.turn?.thread ?? conversation.thread,
      ...(input.turn?.status ? { status: input.turn.status } : {}),
      ...(input.turn?.completedAt !== undefined
        ? { completedAt: input.turn.completedAt }
        : {}),
      ...(input.turn?.interruptRequestedAt !== undefined
        ? { interruptRequestedAt: input.turn.interruptRequestedAt }
        : {}),
    });
    const codexTurnId = (
      await db.conversationTurn.findUniqueOrThrow({ where: { id: turn } })
    ).codexTurnId;
    const approval = await createApproval({
      conversationId: conversation.id,
      turnId: turn,
      ownerId: main.ownerId,
      thread: input.approval?.thread ?? conversation.thread,
      codexTurnId: input.approval?.codexTurnId ?? codexTurnId,
      nativeRequestId: 5n,
      ...(input.approval?.status ? { status: input.approval.status } : {}),
      ...(input.approval?.expiresAt
        ? { expiresAt: input.approval.expiresAt }
        : {}),
    });
    excluded.push(approval);
    return { conversation, turn, approval, codexTurnId };
  };

  await createCase({
    approval: { expiresAt: new Date(NOW.getTime() - 1_000) },
  });
  excluded.push(
    await (async () => {
      const { conversation, turn, codexTurnId } = await createCase({
        approval: { status: "answering" },
      });
      return createApproval({
        conversationId: conversation.id,
        turnId: turn,
        ownerId: main.ownerId,
        thread: conversation.thread,
        codexTurnId,
        nativeRequestId: 6n,
      });
    })(),
  );
  await createCase({ approval: { status: "answered" } });
  await createCase({ approval: { status: "cancelled" } });
  await createCase({
    approval: { thread: randomUUID() },
  });
  await createCase({
    turn: { thread: randomUUID() },
  });
  await createCase({
    approval: { codexTurnId: randomUUID() },
  });
  await createCase({
    turn: { interruptRequestedAt: new Date(NOW.getTime() - 1_000) },
  });
  await createCase({
    turn: { status: "completed", completedAt: new Date(NOW.getTime() - 1_000) },
  });
  await createCase({ conversation: { archiveStatus: "archived" } });
  await createCase({ conversation: { executionTarget: "cloud" } });
  const deletedCase = await createCase({});
  await db.conversation.delete({ where: { id: deletedCase.conversation.id } });

  const snapshot = await read(main.ownerId);
  assert.deepEqual(
    snapshot.items.map(item => item.request_id),
    [mainApproval, headApproval],
    "only the oldest pending head of each live turn notifies",
  );
  for (const item of snapshot.items) {
    assert.deepEqual(Object.keys(item).sort(), [
      "conversation_id",
      "expires_at",
      "request_id",
    ]);
  }
  for (const requestId of excluded) {
    assert.ok(
      !snapshot.items.some(item => item.request_id === requestId),
      `excluded approval ${requestId} must not notify`,
    );
  }

  // Persisted credential and account predicates.
  const other = await createOwner("other");
  const otherConversation = await createConversation(other);
  const otherTurn = await createTurn({
    conversationId: otherConversation.id,
    ownerId: other.ownerId,
    thread: otherConversation.thread,
  });
  const otherApproval = await createApproval({
    conversationId: otherConversation.id,
    turnId: otherTurn,
    ownerId: other.ownerId,
    thread: otherConversation.thread,
    codexTurnId: (
      await db.conversationTurn.findUniqueOrThrow({ where: { id: otherTurn } })
    ).codexTurnId,
    nativeRequestId: 1n,
  });
  assert.deepEqual(await read(other.ownerId), {
    items: [
      {
        conversation_id: otherConversation.id,
        request_id: otherApproval,
        expires_at: PENDING_EXPIRY.toISOString(),
      },
    ],
  });
  assert.equal((await read(main.ownerId)).items.length, 2);
  assert.deepEqual(
    await read(main.ownerId, {
      conversationId: otherConversation.id,
      requestId: otherApproval,
    }),
    { items: [] },
    "a foreign exact pair must look like any other missing pair",
  );

  const createIneligibleOwnerCase = async (
    label: string,
    mutate: (owner: Owner) => Promise<unknown>,
    options: { status?: string; epoch?: Date } = {},
  ) => {
    const owner = await createOwner(label, options);
    await mutate(owner);
    const conversation = await createConversation(owner);
    const turn = await createTurn({
      conversationId: conversation.id,
      ownerId: owner.ownerId,
      thread: conversation.thread,
    });
    await createApproval({
      conversationId: conversation.id,
      turnId: turn,
      ownerId: owner.ownerId,
      thread: conversation.thread,
      codexTurnId: (
        await db.conversationTurn.findUniqueOrThrow({ where: { id: turn } })
      ).codexTurnId,
      nativeRequestId: 1n,
    });
    assert.deepEqual(
      await read(owner.ownerId),
      { items: [] },
      `${label} must not notify`,
    );
  };

  await createIneligibleOwnerCase(
    "windows",
    owner =>
      db.desktopDevice.update({
        where: { id: owner.deviceId },
        data: { platform: "windows" },
      }),
  );
  await createIneligibleOwnerCase("revoked", owner =>
    db.desktopDevice.update({
      where: { id: owner.deviceId },
      data: { revokedAt: new Date(NOW.getTime() - 1_000) },
    }),
  );
  await createIneligibleOwnerCase(
    "epoch",
    async owner => {
      await db.desktopDevice.update({
        where: { id: owner.deviceId },
        data: { authValidAfter: new Date(EPOCH.getTime() + 1_000) },
      });
    },
  );
  await createIneligibleOwnerCase("inactive", async () => undefined, {
    status: "disabled",
  });

  // A stored account epoch can carry microseconds that the pairing exchange
  // round-trips through Prisma's millisecond JS Date. The existing responder
  // compares getTime(), so this paired device is admitted; the feed must
  // compare at the same millisecond precision.
  const fractionalEpoch = new Date("2026-01-01T00:00:00.123Z");
  const fractionalOwnerId = randomUUID();
  await db.user.create({
    data: {
      id: fractionalOwnerId,
      email: `fractional-${fractionalOwnerId}@example.test`,
      name: "Fractional epoch",
      role: "user",
      status: "active",
      authValidAfter: fractionalEpoch,
      createdAt: fractionalEpoch,
    },
  });
  await db.$executeRaw`UPDATE users SET auth_valid_after = '2026-01-01T00:00:00.123456Z'::timestamptz
    WHERE id = ${fractionalOwnerId}::uuid`;
  const deviceRepository = new PrismaDesktopDeviceRepository(db);
  const pairingCode = randomBytes(16).toString("hex");
  const pairingNow = new Date(NOW.getTime() - 60_000);
  const storedEpoch = (
    await db.user.findUniqueOrThrow({
      where: { id: fractionalOwnerId },
      select: { authValidAfter: true },
    })
  ).authValidAfter;
  await deviceRepository.createPairing(
    fractionalOwnerId,
    storedEpoch,
    sha256(pairingCode),
    new Date(pairingNow.getTime() + 120_000),
    pairingNow,
  );
  const pairedDevice = await deviceRepository.consumePairing(
    sha256(pairingCode),
    sha256(randomBytes(32).toString("hex")),
    {
      name: "Fractional Mac",
      platform: "darwin",
      arch: "arm64",
      app_version: "0.1.0",
      capabilities: {
        local_execution: true,
        browser_extension: false,
        computer_use: false,
      },
    },
    pairingNow,
  );
  assert.ok(
    pairedDevice,
    "the pairing exchange must accept the fractional account epoch",
  );
  const fractionalConversation = await createConversation({
    ownerId: fractionalOwnerId,
    deviceId: pairedDevice.id,
  });
  const fractionalTurn = await createTurn({
    conversationId: fractionalConversation.id,
    ownerId: fractionalOwnerId,
    thread: fractionalConversation.thread,
  });
  const fractionalApproval = await createApproval({
    conversationId: fractionalConversation.id,
    turnId: fractionalTurn,
    ownerId: fractionalOwnerId,
    thread: fractionalConversation.thread,
    codexTurnId: (
      await db.conversationTurn.findUniqueOrThrow({
        where: { id: fractionalTurn },
      })
    ).codexTurnId,
    nativeRequestId: 1n,
  });
  const [epochState] = await db.$queryRaw<
    Array<{
      exactEqual: boolean;
      millisecondEqual: boolean;
      ownerMicros: string;
      deviceMicros: string;
    }>
  >`
    SELECT d.auth_valid_after = u.auth_valid_after AS "exactEqual",
      date_trunc('milliseconds', d.auth_valid_after) =
        date_trunc('milliseconds', u.auth_valid_after) AS "millisecondEqual",
      to_char(u.auth_valid_after, 'HH24:MI:SS.US') AS "ownerMicros",
      to_char(d.auth_valid_after, 'HH24:MI:SS.US') AS "deviceMicros"
    FROM desktop_devices d JOIN users u ON u.id = d.owner_id
    WHERE d.id = ${pairedDevice.id}::uuid`;
  assert.equal(
    epochState?.exactEqual,
    false,
    "Prisma pairing truncates the stored microsecond epoch",
  );
  assert.equal(epochState?.millisecondEqual, true);
  assert.equal(epochState?.ownerMicros, "00:00:00.123456");
  assert.equal(epochState?.deviceMicros, "00:00:00.123000");
  const fractionalConversationRow = await db.conversation.findUniqueOrThrow({
    where: { id: fractionalConversation.id },
    select: { runtimeGeneration: true },
  });
  const fractionalScope = {
    ownerId: fractionalOwnerId,
    deviceId: pairedDevice.id,
    conversationId: fractionalConversation.id,
    runtimeGeneration: fractionalConversationRow.runtimeGeneration,
  };
  const locked = await db.$transaction(tx =>
    lockDesktopConversation(tx, fractionalScope),
  );
  assert.equal(locked.codexThreadId, fractionalConversation.thread);
  assert.equal(locked.ownerEpoch.getTime(), fractionalEpoch.getTime());
  const fractionalExpected = {
    items: [
      {
        conversation_id: fractionalConversation.id,
        request_id: fractionalApproval,
        expires_at: PENDING_EXPIRY.toISOString(),
      },
    ],
  };
  const fractionalPair = {
    conversationId: fractionalConversation.id,
    requestId: fractionalApproval,
  };
  assert.deepEqual(
    await read(fractionalOwnerId),
    fractionalExpected,
    "the list must admit the same millisecond epoch the responder accepts",
  );
  assert.deepEqual(
    await read(fractionalOwnerId, fractionalPair),
    fractionalExpected,
    "the exact-pair click check must admit the same millisecond epoch",
  );

  // A different millisecond is a different credential epoch for both paths.
  await db.$executeRaw`UPDATE users SET auth_valid_after = '2026-01-01T00:00:00.124456Z'::timestamptz
    WHERE id = ${fractionalOwnerId}::uuid`;
  await assert.rejects(
    db.$transaction(tx => lockDesktopConversation(tx, fractionalScope)),
    { code: "FORBIDDEN" },
  );
  assert.deepEqual(await read(fractionalOwnerId), { items: [] });
  assert.deepEqual(await read(fractionalOwnerId, fractionalPair), {
    items: [],
  });

  // A click rechecks the same pair; after the responder resolves it the read
  // must go empty even though the notification was delivered earlier.
  assert.deepEqual(
    await read(main.ownerId, {
      conversationId: mainConversation.id,
      requestId: mainApproval,
    }),
    {
      items: [
        {
          conversation_id: mainConversation.id,
          request_id: mainApproval,
          expires_at: PENDING_EXPIRY.toISOString(),
        },
      ],
    },
  );
  assert.deepEqual(
    await read(main.ownerId, {
      conversationId: mainConversation.id,
      requestId: randomUUID(),
    }),
    { items: [] },
  );
  await db.conversationDesktopApproval.update({
    where: { id: mainApproval },
    data: { status: "answered", resolvedAt: new Date(NOW.getTime()) },
  });
  assert.deepEqual(
    await read(main.ownerId, {
      conversationId: mainConversation.id,
      requestId: mainApproval,
    }),
    { items: [] },
    "a resolved approval must not resurface for a click check",
  );

  // Deterministic ordering and the 100-item bound. One running turn per
  // conversation is a database invariant, so each candidate gets its own.
  const ordering = await createOwner("ordering");
  const expectedOrder: Array<{ requestId: string; createdAt: Date }> = [];
  const orderingCandidates = Array.from({ length: 105 }, (_, index) => {
    const createdAt = new Date(NOW.getTime() + (104 - index) * 1_000);
    expectedOrder.push({ requestId: "", createdAt });
    return {
      conversationId: randomUUID(),
      thread: randomUUID(),
      turnId: randomUUID(),
      codexTurnId: randomUUID(),
      createdAt,
    };
  });
  await db.conversation.createMany({
    data: orderingCandidates.map(candidate => ({
      id: candidate.conversationId,
      ownerId: ordering.ownerId,
      title: "Synthetic ordering task",
      titleSource: "manual",
      archiveStatus: "active",
      workspaceRelPath: `${ordering.ownerId}/home/workspaces/${candidate.conversationId}`,
      runtimeGeneration: randomUUID(),
      executionTarget: "local",
      desktopDeviceId: ordering.deviceId,
      codexThreadId: candidate.thread,
    })),
  });
  await db.conversationTurn.createMany({
    data: orderingCandidates.map(candidate => ({
      id: candidate.turnId,
      conversationId: candidate.conversationId,
      sequenceNo: 1,
      submittedBy: ordering.ownerId,
      codexThreadId: candidate.thread,
      codexTurnId: candidate.codexTurnId,
      status: "running",
      submitMode: "normal",
      capabilityGeneration: "0".repeat(64),
      capabilitiesJson: [],
      startedAt: NOW,
    })),
  });
  const orderingApprovals = orderingCandidates.map((candidate, index) => {
    const id = randomUUID();
    expectedOrder[index]!.requestId = id;
    return {
      id,
      conversationId: candidate.conversationId,
      turnId: candidate.turnId,
      ownerId: ordering.ownerId,
      codexThreadId: candidate.thread,
      codexTurnId: candidate.codexTurnId,
      codexItemId: `item-${index}`,
      nativeRequestId: BigInt(index + 1),
      approvalJson: APPROVAL_JSON,
      status: "pending",
      expiresAt: PENDING_EXPIRY,
      createdAt: candidate.createdAt,
    };
  });
  await db.conversationDesktopApproval.createMany({ data: orderingApprovals });
  const expectedIds = [...expectedOrder]
    .sort(
      (left, right) =>
        left.createdAt.getTime() - right.createdAt.getTime() ||
        left.requestId.localeCompare(right.requestId),
    )
    .slice(0, 100)
    .map(entry => entry.requestId);
  const firstPage = await read(ordering.ownerId);
  const secondPage = await read(ordering.ownerId);
  assert.equal(firstPage.items.length, 100);
  assert.deepEqual(
    firstPage.items.map(item => item.request_id),
    expectedIds,
    "oldest awaiting first, bounded to 100",
  );
  assert.deepEqual(secondPage, firstPage, "the read is deterministic");

  // Representative history so the EXPLAIN shows an index probe instead of a
  // scan over every approval the platform has ever stored.
  const history = await createOwner("history");
  const historyConversation = await createConversation(history);
  const historicalTurns = Array.from({ length: 2_000 }, (_, index) => ({
    id: randomUUID(),
    codexTurnId: randomUUID(),
    sequenceNo: index + 1,
  }));
  await db.conversationTurn.createMany({
    data: historicalTurns.map(turn => ({
      id: turn.id,
      conversationId: historyConversation.id,
      sequenceNo: turn.sequenceNo,
      submittedBy: history.ownerId,
      codexThreadId: historyConversation.thread,
      codexTurnId: turn.codexTurnId,
      status: "completed",
      submitMode: "normal",
      capabilityGeneration: "0".repeat(64),
      capabilitiesJson: [],
      startedAt: new Date(NOW.getTime() - 86_400_000),
      completedAt: new Date(NOW.getTime() - 3_600_000),
    })),
  });
  await db.conversationDesktopApproval.createMany({
    data: historicalTurns.map((turn, index) => ({
      id: randomUUID(),
      conversationId: historyConversation.id,
      turnId: turn.id,
      ownerId: history.ownerId,
      codexThreadId: historyConversation.thread,
      codexTurnId: turn.codexTurnId,
      codexItemId: `history-item-${index}`,
      nativeRequestId: BigInt(index + 1),
      approvalJson: APPROVAL_JSON,
      status: index % 2 === 0 ? "answered" : "cancelled",
      expiresAt: new Date(NOW.getTime() - 7_200_000),
      createdAt: new Date(NOW.getTime() - 86_400_000 + index * 1_000),
    })),
  });
  await db.$executeRawUnsafe("ANALYZE conversation_turns");
  await db.$executeRawUnsafe("ANALYZE conversation_desktop_approvals");
  await db.$executeRawUnsafe("ANALYZE conversations");
  await db.$executeRawUnsafe("ANALYZE desktop_devices");
  await db.$executeRawUnsafe("ANALYZE users");

  const explainQuery = desktopApprovalNotificationsQuery({
    ownerId: main.ownerId,
    now: NOW,
  });
  const planRows = await db.$queryRawUnsafe<Array<{ "QUERY PLAN": string }>>(
    `EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) ${explainQuery.text}`,
    ...explainQuery.values,
  );
  const plan = planRows.map(row => row["QUERY PLAN"]).join("\n");
  process.stdout.write(`\nEXPLAIN for the notification read:\n${plan}\n`);
  assert.match(
    plan,
    /conversation_turns_submitter_status_completed_idx/u,
    "the read starts from the owner's running turns",
  );
  assert.match(
    plan,
    /conversation_desktop_approvals_conversation_turn_idx/u,
    "the read probes approvals through the existing turn index",
  );
  assert.doesNotMatch(
    plan,
    /Seq Scan on conversation_desktop_approvals/u,
    "the read must not scan the full approval history",
  );
  assert.doesNotMatch(
    plan,
    /Seq Scan on conversation_turns/u,
    "the read must not scan the full turn history",
  );

  const auditBefore = await db.auditLog.count();
  const eventsBefore = await db.conversationEvent.count();
  await read(main.ownerId);
  await read(main.ownerId, {
    conversationId: headConversation.id,
    requestId: headApproval,
  });
  assert.equal(await db.auditLog.count(), auditBefore);
  assert.equal(await db.conversationEvent.count(), eventsBefore);

  process.stdout.write("desktop approval notification postgres checks passed\n");
} finally {
  await prisma?.$disconnect();
  if (started) {
    await execute("pg_ctl", ["-D", data, "-m", "immediate", "-w", "stop"], {
      timeout: 30_000,
    }).catch(() => undefined);
  }
  await rm(root, { recursive: true, force: true });
}
