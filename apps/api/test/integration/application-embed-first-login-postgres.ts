import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";

import { createPrismaClient } from "../../src/db.js";
import type { Prisma } from "../../src/generated/prisma/client.js";
import { sha256 } from "../../src/lib/crypto.js";
import { ApplicationExternalAccessService } from "../../src/modules/application-embed/service.js";

// This command owns a disposable database and never loads the application's .env.
const execute = promisify(execFile);
const repositoryRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const container = `linksense-embed-identity-test-${randomUUID()}`;
const docker = async (...args: string[]): Promise<string> =>
  (await execute("docker", args, { timeout: 30_000 })).stdout.trim();
let started = false;
let database: ReturnType<typeof createPrismaClient> | undefined;

try {
  const password = randomUUID();
  await docker("run", "--rm", "--detach", "--name", container,
    "--label", "com.linksense.test.disposable=true", "--publish", "127.0.0.1::5432",
    "--env", "POSTGRES_DB=embed_identity_test", "--env", `POSTGRES_PASSWORD=${password}`, "postgres:16-alpine");
  started = true;
  const port = Number((await docker("port", container, "5432")).split(":").at(-1));
  assert(Number.isInteger(port) && port > 0);
  for (let attempt = 0; ; attempt++) {
    try { await docker("exec", container, "pg_isready", "-h", "127.0.0.1", "-U", "postgres"); break; }
    catch (error) { if (attempt >= 50) throw error; await delay(100); }
  }
  const databaseUrl = `postgresql://postgres:${password}@127.0.0.1:${port}/embed_identity_test`;
  await execute("pnpm", ["exec", "prisma", "migrate", "deploy", "--config", "apps/api/test/integration/prisma.config.ts"], {
    cwd: repositoryRoot, timeout: 120_000, maxBuffer: 4_000_000,
    env: { ...process.env, DATABASE_URL: databaseUrl, LINKSENSE_TEST_MIGRATIONS_PATH: `${repositoryRoot}/prisma/migrations` },
  });
  database = createPrismaClient(databaseUrl);
  const store = database;
  const ownerId = randomUUID();
  const application = await store.application.create({ data: { ownerId, name: "Identity concurrency fixture", instructions: "Synthetic fixture" } });
  await store.applicationRuntimeInstallation.create({ data: { ownerId, applicationId: application.id, versionId: randomUUID(), channel: "owner" } });
  const origin = "https://partner.example.test";
  const appId = `lsa_${randomUUID()}`;
  const appSecret = `lss_${randomUUID()}`;
  const access = await store.applicationExternalAccess.create({ data: {
    applicationId: application.id, publicId: `app_${randomUUID()}`, appId, appSecretHash: sha256(appSecret),
    authMode: "required", enabled: true, allowedOriginsJson: [origin], createdBy: ownerId,
  } });
  const subject = "concurrent-first-login";
  let arrivals = 0;
  let release: () => void = () => undefined;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  let barrierTimer: ReturnType<typeof setTimeout> | undefined;
  const delegate = new Proxy(store.applicationExternalSession, {
    get(target, property) {
      if (property === "findFirst") return async (args: Prisma.ApplicationExternalSessionFindFirstArgs) => {
        const found = await target.findFirst(args);
        if (args.where?.externalSubject === subject && found === null) {
          arrivals++;
          // The timeout also releases a serialized implementation's sole read.
          barrierTimer ??= setTimeout(release, 500);
          if (arrivals === 2) release();
          await barrier;
        }
        return found;
      };
      const value: unknown = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const racingStore = new Proxy(store, {
    get(target, property) {
      if (property === "applicationExternalSession") return delegate;
      const value: unknown = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const service = new ApplicationExternalAccessService(racingStore,
    { client: { eval: async () => 1 } } as never, { write: async () => undefined } as never, {} as never,
    "https://linksense.example.test", randomUUID(), "fixture",
    async (principalId, app, reservedId = randomUUID()) => store.conversation.create({ data: {
      id: reservedId, ownerId: principalId, applicationId: app.id, applicationNameSnapshot: app.name,
      title: app.name, titleSource: "manual", archiveStatus: "active", runtimeGeneration: randomUUID(),
      workspaceRelPath: `${principalId}/workspace`,
    }, select: { id: true } }), async () => undefined);
  const login = async () => {
    const ticket = await service.issueAuthenticatedTicket({ appId, appSecret, origin, externalSubject: subject, externalTenant: "tenant" }, { ipAddress: "192.0.2.10" });
    return service.exchangeTicket(ticket.ticket, origin, async (_claims, seconds) => ({ token: randomUUID(), expiresAt: new Date(Date.now() + seconds * 1_000) }), {});
  };
  try {
    const results = await Promise.all([login(), login()]);
    const sessions = await store.applicationExternalSession.findMany({ where: { externalAccessId: access.id, externalSubject: subject, externalTenant: "tenant" } });
    console.log(JSON.stringify({ sessions: sessions.length, principals: new Set(sessions.map(row => row.runtimePrincipalId)).size, conversations: new Set(sessions.map(row => row.conversationId)).size }));
    assert.equal(sessions.length, 1, "concurrent first login must preserve a single authenticated runtime identity");
    assert.equal(results[0]?.session_id, results[1]?.session_id);
  } finally { clearTimeout(barrierTimer); }
} finally {
  await database?.$disconnect();
  if (started) await docker("rm", "--force", "--volumes", container);
}
