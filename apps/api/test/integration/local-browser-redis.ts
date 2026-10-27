import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { Redis } from "ioredis";
import { LocalBrowserService } from "../../src/modules/local-browser/service.js";
import { RedisBrowserStore } from "../../src/modules/local-browser/store.js";

const directory = await mkdtemp(path.join(tmpdir(), "lsbr-"));
const socket = path.join(directory, "redis.sock");
const server = spawn(
  "redis-server",
  [
    "--port",
    "0",
    "--unixsocket",
    socket,
    "--unixsocketperm",
    "700",
    "--save",
    "",
    "--appendonly",
    "no",
  ],
  { stdio: ["ignore", "pipe", "pipe"] },
);
const clients: Redis[] = [];
try {
  await new Promise<void>((resolve, reject) => {
    const deadline = setTimeout(
      () => reject(new Error("Redis fixture startup timed out")),
      5000,
    );
    server.once("error", (error) => {
      clearTimeout(deadline);
      reject(error);
    });
    server.stdout.on("data", (chunk: Buffer) => {
      if (
        chunk.toString().toLowerCase().includes("ready to accept connections")
      ) {
        clearTimeout(deadline);
        resolve();
      }
    });
  });
  const firstClient = new Redis(socket, { maxRetriesPerRequest: 0 });
  const secondClient = new Redis(socket, { maxRetriesPerRequest: 0 });
  clients.push(firstClient, secondClient);
  const endpoint = "https://linksense.example/api/v1/local-browser";
  const first = new LocalBrowserService(
    new RedisBrowserStore(firstClient),
    endpoint,
  );
  const second = new LocalBrowserService(
    new RedisBrowserStore(secondClient),
    endpoint,
  );
  const owner = "10000000-0000-4000-8000-000000000001";
  const task = "20000000-0000-4000-8000-000000000001";
  const pairing = await first.pairing(owner, "2026-01-01T00:00:00.000Z");
  const credential = await second.pair(pairing.code);
  await assert.rejects(first.pair(pairing.code));
  const connection = await first.connect(owner, credential, "chrome");
  assert.equal((await second.status(owner)).connection_id, connection);
  const running = second.execute(owner, task, {
    action: "open",
    url: "https://example.test",
  });
  let command = null;
  for (let attempt = 0; attempt < 100 && !command; attempt++) {
    command = await first.next(owner, connection);
    if (!command) await delay(10);
  }
  assert.ok(command);
  assert.equal(await first.next(owner, connection), null);
  assert.deepEqual(await first.execute(owner, task, { action: "tabs" }), {
    ok: false,
    code: "LOCAL_BROWSER_BUSY",
    retryable: false,
    help_path: "/settings/general#browser-extension",
  });
  await first.reply(owner, connection, {
    id: command.id,
    result: { ok: true, browser: "local", data: { tab_id: 1 } },
  });
  assert.deepEqual(await running, {
    ok: true,
    browser: "local",
    data: { tab_id: 1 },
  });
  const replacement = await second.connect(owner, credential, "edge");
  assert.equal(await first.maintain(owner, connection), false);
  await first.disconnect(owner, connection);
  assert.equal((await first.status(owner)).connection_id, replacement);
  await second.revoke(owner);
  assert.deepEqual(await first.status(owner), { connected: false });
  assert.equal(await first.authenticate(credential), null);
  process.stdout.write(
    "PASS: two API instances share pairing, single-delivery commands, locks, connection generations and revocation through real Redis\n",
  );
} finally {
  await Promise.all(clients.map((client) => client.quit()));
  if (server.exitCode === null) {
    const closed = once(server, "exit");
    server.kill("SIGTERM");
    await closed;
  }
  await rm(directory, { recursive: true, force: true });
}
