import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { cp, mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { z } from "zod";
import { createPrismaClient } from "../../src/db.js";

// This destructive migration test accepts only a freshly created disposable local database.
const databaseUrl = z
  .url()
  .parse(process.env.BOT_CHANNEL_UPGRADE_TEST_DATABASE_URL);
const target = new URL(databaseUrl);
assert.equal(target.hostname, "127.0.0.1");
assert.equal(target.pathname, "/linksense_channel_upgrade_tests");
const root = resolve(fileURLToPath(new URL("../../../../", import.meta.url)));
const staging = await mkdtemp(join(tmpdir(), "linksense-channel-upgrade-"));
const prisma = createPrismaClient(databaseUrl);
const environment = { ...process.env, DATABASE_URL: databaseUrl };
const require = createRequire(import.meta.url);
const firstChangeMigration = "20261029040000_split_personal_and_organization_bot_channels";
try {
  const tables = await prisma.$queryRaw<
    Array<{ name: string }>
  >`SELECT tablename AS name FROM pg_tables WHERE schemaname = 'public'`;
  assert.equal(
    tables.length,
    0,
    "Use a fresh disposable database; never overwrite an existing installation",
  );
  const previous = join(staging, "migrations");
  await mkdir(previous);
  for (const entry of await readdir(join(root, "prisma/migrations"))) {
    if (entry === "migration_lock.toml" || entry < firstChangeMigration)
      await cp(join(root, "prisma/migrations", entry), join(previous, entry), {
        recursive: true,
      });
  }
  const oldSchema = execFileSync("git", ["show", "HEAD:prisma/schema.prisma"], {
    cwd: root,
    encoding: "utf8",
  });
  await writeFile(join(staging, "schema.prisma"), oldSchema);
  const config = join(staging, "prisma.config.mjs");
  await writeFile(
    config,
    `import { defineConfig } from ${JSON.stringify(pathToFileURL(require.resolve("prisma/config")).href)};\nexport default defineConfig({schema:${JSON.stringify(join(staging, "schema.prisma"))}, migrations:{path:${JSON.stringify(previous)}}, datasource:{url:process.env.BOT_CHANNEL_UPGRADE_TEST_DATABASE_URL}});\n`,
  );
  execFileSync(
    "pnpm",
    ["exec", "prisma", "migrate", "deploy", "--config", config],
    { cwd: root, env: environment, maxBuffer: 8 * 1024 * 1024, stdio: "pipe" },
  );
  const owner = randomUUID(),
    conversation = randomUUID();
  await prisma.user.create({
    data: {
      id: owner,
      email: `${owner}@example.test`,
      name: "Existing member",
      role: "user",
      status: "active",
    },
  });
  await prisma.conversation.create({
    data: {
      id: conversation,
      ownerId: owner,
      title: "Existing task",
      titleSource: "manual",
      archiveStatus: "active",
      workspaceRelPath: `upgrade-test/${conversation}`,
      runtimeGeneration: randomUUID(),
    },
  });
  const weixin = await prisma.weixinConnection.create({
    data: {
      ownerId: owner,
      ilinkBotId: "existing-weixin",
      ilinkUserId: "existing-user",
      apiBaseUrl: "https://example.test",
      encryptedState: "test-ciphertext",
      encryptionKeyId: "test-key",
      status: "active",
    },
  });
  const feishu = await prisma.feishuConnection.create({
    data: {
      ownerId: owner,
      appId: "existing-feishu",
      ownerOpenId: "existing-open-id",
      domain: "feishu",
      encryptedCredentials: "test-ciphertext",
      encryptionKeyId: "test-key",
      status: "active",
    },
  });
  for (const provider of ["wecom", "dingtalk", "teams"]) {
    const connection = randomUUID(),
      inbound = randomUUID(),
      peer = randomUUID(),
      delivery = randomUUID(),
      turn = randomUUID();
    await prisma.$executeRaw`INSERT INTO bot_channel_connections (id, owner_id, provider, external_id, allowed_sender_id, encrypted_credentials, encryption_key_id, updated_at) VALUES (${connection}::uuid, ${owner}::uuid, ${provider}, ${provider}, 'legacy-member', 'test-ciphertext', 'test-key', now())`;
    await prisma.$executeRaw`INSERT INTO bot_channel_peer_sessions (id, connection_id, chat_id, sender_id, conversation_id, last_inbound_at, updated_at) VALUES (${peer}::uuid, ${connection}::uuid, 'legacy-chat', 'legacy-member', ${conversation}::uuid, now(), now())`;
    await prisma.$executeRaw`INSERT INTO bot_channel_inbound_messages (id, connection_id, message_key, chat_id, sender_id, content_text, status, ingest_order, received_at, encrypted_context, encryption_key_id, updated_at) VALUES (${inbound}::uuid, ${connection}::uuid, 'legacy-message', 'legacy-chat', 'legacy-member', 'legacy content', 'pending', 1, now(), 'test-ciphertext', 'test-key', now())`;
    await prisma.$executeRaw`INSERT INTO bot_channel_outbound_deliveries (id, connection_id, peer_session_id, inbound_message_id, conversation_id, turn_id, status, updated_at) VALUES (${delivery}::uuid, ${connection}::uuid, ${peer}::uuid, ${inbound}::uuid, ${conversation}::uuid, ${turn}::uuid, 'pending', now())`;
  }
  execFileSync("pnpm", ["exec", "prisma", "migrate", "deploy"], {
    cwd: root,
    env: environment,
    maxBuffer: 8 * 1024 * 1024,
    stdio: "pipe",
  });
  assert.equal(await prisma.botChannelConnection.count(), 0);
  assert.equal(await prisma.botChannelPeerSession.count(), 0);
  assert.equal(await prisma.botChannelInboundMessage.count(), 0);
  assert.equal(await prisma.botChannelOutboundDelivery.count(), 0);
  assert.equal(await prisma.botChannelIdentity.count(), 0);
  assert.equal(await prisma.user.count({ where: { id: owner } }), 1);
  assert.equal(
    await prisma.conversation.count({
      where: { id: conversation, ownerId: owner },
    }),
    1,
  );
  assert.deepEqual(
    await prisma.weixinConnection.findUnique({ where: { id: weixin.id } }),
    weixin,
  );
  assert.deepEqual(
    await prisma.feishuConnection.findUnique({ where: { id: feishu.id } }),
    feishu,
  );
  const columns = await prisma.$queryRaw<
    Array<{ column_name: string }>
  >`SELECT column_name FROM information_schema.columns WHERE table_name = 'bot_channel_connections' AND column_name = 'allowed_sender_id'`;
  assert.equal(
    columns.length,
    0,
    "Legacy sender restriction must be removed without shadow columns",
  );
  console.log(
    "upgrade from pre-change migrations with legacy configurations and queues: passed; users, tasks, Weixin and Feishu preserved",
  );
} finally {
  await prisma.$disconnect();
  await rm(staging, { recursive: true, force: true });
}
