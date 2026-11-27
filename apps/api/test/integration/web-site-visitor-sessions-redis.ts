import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { Redis } from "ioredis";
import { WebSiteVisitorSessions, visitorSessionSeconds } from "../../src/modules/web-site-backends/visitor-sessions.js";
import { testConfig } from "../test-config.js";

// A dedicated Unix-socket Redis process; no configured application Redis is read or modified.
const root = await mkdtemp("/tmp/linksense-app-redis-");
const socket = join(root, "redis.sock");
const server = spawn("redis-server", ["--port", "0", "--unixsocket", socket, "--save", "", "--appendonly", "no", "--dir", root], { stdio: "ignore" });
const client = new Redis({ path: socket, lazyConnect: true, maxRetriesPerRequest: 1, enableOfflineQueue: false, retryStrategy: () => null });
try {
  await new Promise<void>((resolve, reject) => { server.once("spawn", resolve); server.once("error", reject); });
  for (let attempt = 0; ; attempt++) {
    if (await stat(socket).then(() => true, () => false)) break;
    assert(attempt < 100, "Isolated Redis did not become ready");
    await delay(25);
  }
  await client.connect();
  const config = testConfig(), first = new WebSiteVisitorSessions(client, config), second = new WebSiteVisitorSessions(client, config);
  const a = randomUUID(), b = randomUUID(), visitor = randomUUID(), site = randomUUID();
  const original = await first.read(a, visitor);
  await first.save(a, visitor, original, "a_session_test=private-session");
  assert.equal((await second.read(a, visitor)).cookie, "a_session_test=private-session");
  await assert.rejects(second.save(a, visitor, original, "stale-login"), { code: "CONFLICT" });
  assert.equal((await first.read(b, visitor)).cookie, "");
  assert.equal((await first.read(a, randomUUID())).cookie, "");
  const capability = first.capability(a, site, visitor);
  second.authorize(capability, a, site, visitor);
  assert.throws(() => second.authorize(capability, b, site, visitor), { code: "FORBIDDEN" });
  assert.throws(() => second.authorize(capability, a, site, randomUUID()), { code: "FORBIDDEN" });
  const keys = await client.keys("linksense:public-app:session:*");
  assert.equal(keys.length, 1);
  const key = keys[0]!;
  assert(!(await client.get(key))!.includes("private-session"));
  assert((await client.ttl(key)) > 0 && (await client.ttl(key)) <= visitorSessionSeconds);
  await second.save(a, visitor, await second.read(a, visitor), "");
  assert.equal((await first.read(a, visitor)).cookie, "");
  for (let index = 0; index < 180; index++) await first.admit(a, "fixture-ip");
  await assert.rejects(second.admit(a, "fixture-ip"), { code: "APPLICATION_EXTERNAL_RATE_LIMITED" });
  console.log("PASS: real Redis encryption, cross-worker sessions, compare-and-set, app/visitor capabilities, TTL, logout and distributed rate admission.");
} finally {
  client.disconnect();
  const exited = new Promise<void>(resolve => server.once("exit", () => resolve()));
  if (server.exitCode === null && server.kill("SIGTERM")) await exited;
  await rm(root, { recursive: true, force: true });
}
