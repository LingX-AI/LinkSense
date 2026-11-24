import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import type { ApplicationEmbedAccessTokenClaims } from "@linksense/shared";

import { createObjectStorage } from "../../src/adapters/object-storage.js";
import { LinkSenseRedis } from "../../src/adapters/redis.js";
import { createPrismaClient } from "../../src/db.js";
import type { Prisma } from "../../src/generated/prisma/client.js";
import { sha256 } from "../../src/lib/crypto.js";
import { assertExecutionPrincipalActive } from "../../src/lib/execution-principal.js";
import {
  ApplicationExternalAccessService,
  type ApplicationEmbedAccessTokenIssuer,
} from "../../src/modules/application-embed/service.js";
import { AuditService } from "../../src/modules/audit/service.js";
import { testConfig } from "../test-config.js";

const execute = promisify(execFile);
const repositoryRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const container = `linksense-embed-identity-test-${randomUUID()}`;
const databaseName = "linksense_embed_identity_test";
const origin = "https://partner.example.test";
const appId = `lsa_${randomUUID()}`;
const appSecret = `lss_${randomUUID()}`;
const metadata = { ipAddress: "192.0.2.10" };
type Database = ReturnType<typeof createPrismaClient>;
type FinalizeInitialization = (tx: Prisma.TransactionClient) => Promise<void>;
type Exchange = Awaited<ReturnType<ApplicationExternalAccessService["exchangeTicket"]>>;

const docker = async (
  args: string[],
  env?: NodeJS.ProcessEnv,
): Promise<string> => (await execute("docker", args, { env, timeout: 30_000 })).stdout.trim();

async function waitFor(description: string, predicate: () => Promise<boolean>): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await predicate()) return;
    await delay(20);
  }
  assert.fail(`Timed out waiting for ${description}`);
}

function latch<Value = void>() {
  let resolve: (value: Value) => void = () => undefined;
  const promise = new Promise<Value>((complete) => { resolve = complete; });
  return { promise, resolve };
}

async function verifySessions(databaseUrl: string): Promise<void> {
  const config = testConfig({ LINKSENSE_EDITION: "core", LINKSENSE_OBJECT_STORAGE_PROVIDER: "local-filesystem" });
  const redis = new LinkSenseRedis(config);
  redis.client.eval = async () => 1;
  const storage = createObjectStorage(config);
  const clients: Database[] = [];
  const client = (name: string): Database => {
    const url = new URL(databaseUrl);
    url.searchParams.set("application_name", name);
    const db = createPrismaClient(url.toString());
    clients.push(db);
    return db;
  };
  const store = client("linksense-embed-test-fixture");
  const names = ["linksense-embed-test-api-first", "linksense-embed-test-api-second"] as const;
  const firstClient = client(names[0]);
  const secondClient = client(names[1]);
  try {
    const owner = await store.user.create({
      data: { name: "Embed fixture owner", email: "embed-owner@example.test", role: "user", status: "active" },
    });
    const application = await store.application.create({
      data: { ownerId: owner.id, name: "Embedded application", instructions: "Test fixture." },
    });
    const version = await store.applicationVersion.create({
      data: { applicationId: application.id, createdBy: owner.id, versionNumber: 1, versionLabel: "1.0.0", definitionJson: {}, assetsReady: true },
    });
    await store.applicationRuntimeInstallation.create({
      data: { ownerId: owner.id, applicationId: application.id, versionId: version.id, channel: "owner" },
    });
    const access = await store.applicationExternalAccess.create({
      data: {
        applicationId: application.id, publicId: `app_${randomUUID()}`, appId, appSecretHash: sha256(appSecret),
        authMode: "required", enabled: true, allowedOriginsJson: [origin], createdBy: owner.id,
      },
    });
    const writeConversation = (tx: Prisma.TransactionClient, principalId: string, id: string) => tx.conversation.create({
      data: {
        id, ownerId: principalId, applicationId: application.id, applicationNameSnapshot: application.name,
        title: application.name, titleSource: "fallback", archiveStatus: "active", runtimeGeneration: randomUUID(),
        workspaceRelPath: `${principalId}/workspace`,
      },
    });
    const createService = (
      db: Database,
      beforeWrite?: (principalId: string, conversationId: string) => Promise<void>,
    ) => new ApplicationExternalAccessService(
      db, redis, new AuditService(db), storage, config.publicBaseUrl,
      config.credentialMasterKey, config.credentialKeyId,
      async (principalId, app, reservedId = randomUUID(), finalizeInitialization?: FinalizeInitialization) => {
        await assertExecutionPrincipalActive(db, principalId);
        await db.applicationRuntimeInstallation.findUniqueOrThrow({
          where: { ownerId_applicationId: { ownerId: principalId, applicationId: app.id } },
        });
        await beforeWrite?.(principalId, reservedId);
        return db.$transaction(async (tx) => {
          await finalizeInitialization?.(tx);
          return writeConversation(tx, principalId, reservedId);
        });
      },
      async () => { assert.fail("Unexpected conversation cleanup"); },
    );
    const firstService = createService(firstClient);
    const secondService = createService(secondClient);
    const claimsByToken = new Map<string, ApplicationEmbedAccessTokenClaims>();
    const issueToken: ApplicationEmbedAccessTokenIssuer = async (claims, ttl) => {
      const token = randomUUID();
      const iat = Math.floor(Date.now() / 1_000);
      claimsByToken.set(token, { ...claims, iat, exp: iat + ttl });
      return { token, expiresAt: new Date(Date.now() + ttl * 1_000) };
    };
    const subject = "same-external-user";
    const issueTicket = async (externalSubject?: string, externalTenant?: string) =>
      (await firstService.issueAuthenticatedTicket(
        {
          appId, appSecret, origin,
          ...(externalSubject === undefined ? {} : { externalSubject }),
          ...(externalTenant === undefined ? {} : { externalTenant }),
        },
        metadata,
      )).ticket;
    const exchange = (service: ApplicationExternalAccessService, ticket: string) =>
      service.exchangeTicket(ticket, origin, issueToken, {});
    const verify = async (response: Exchange) => {
      const claims = claimsByToken.get(response.access_token);
      assert(claims);
      const session = await secondService.verifyAccessToken(claims);
      assert.equal(session.sessionId, response.session_id);
      const { items } = await secondService.listSessionConversations(session);
      assert.deepEqual(items.map(({ id, current }) => [id, current]), [[session.conversationId, true]]);
      return session;
    };
    const assertTicketConsumed = (ticket: string) =>
      assert.rejects(exchange(secondService, ticket), { code: "APPLICATION_EMBED_TICKET_INVALID" });
    const sessionsFor = (externalSubject: string | null, externalTenant: string | null) =>
      store.applicationExternalSession.findMany({
        where: { externalAccessId: access.id, applicationId: application.id, externalSubject, externalTenant },
      });
    const raceLogin = async (tenant?: string) => {
      const [firstTicket, secondTicket] = await Promise.all([issueTicket(subject, tenant), issueTicket(subject, tenant)]);
      const start = latch();
      const exchanges = Promise.all([
        start.promise.then(() => exchange(firstService, firstTicket)),
        start.promise.then(() => exchange(secondService, secondTicket)),
      ]);
      const [, results] = await Promise.all([
        store.$transaction(async (tx) => {
          await tx.$executeRaw`LOCK TABLE application_external_sessions IN SHARE MODE`;
          start.resolve();
          await waitFor("both API instances to reach PostgreSQL's login write barrier", async () => {
            const [waiting] = await store.$queryRaw<Array<{ count: number }>>`
              SELECT count(DISTINCT application_name)::integer AS count
              FROM pg_stat_activity
              WHERE datname = current_database() AND wait_event_type = 'Lock'
                AND application_name IN (${names[0]}, ${names[1]})`;
            return waiting?.count === names.length;
          });
        }).finally(start.resolve),
        exchanges,
      ]);
      const sessions = await sessionsFor(subject, tenant ?? null);
      assert.equal(sessions.length, 1, `parallel first logins must create one session for tenant ${tenant ?? "(none)"}`);
      const [session] = sessions;
      assert(session);
      for (const response of results) {
        const userSession = await verify(response);
        assert.equal(userSession.sessionId, session.id);
        assert.equal(userSession.ownerId, session.runtimePrincipalId);
        assert.equal(userSession.conversationId, session.conversationId);
      }
      await assertTicketConsumed(firstTicket);
      return session;
    };

    const noTenant = await raceLogin();
    const withTenant = await raceLogin("tenant-a");
    const anotherTenant = await verify(await exchange(secondService, await issueTicket(subject, "tenant-b")));
    assert.equal(new Set([noTenant.runtimePrincipalId, withTenant.runtimePrincipalId, anotherTenant.ownerId]).size, 3);
    const [installations, conversations] = await Promise.all([
      store.applicationRuntimeInstallation.findMany({ where: { applicationId: application.id, ownerId: { not: owner.id } } }),
      store.conversation.findMany({ where: { applicationId: application.id } }),
    ]);
    const owners = [noTenant.runtimePrincipalId, withTenant.runtimePrincipalId, anotherTenant.ownerId].sort();
    assert.deepEqual(installations.map((item) => item.ownerId).sort(), owners);
    assert.deepEqual(conversations.map((item) => item.ownerId).sort(), owners);
    console.log("PASS: concurrent authenticated exchanges share one runtime per identity; null and distinct tenants stay isolated.");

    const oldOwnerId = randomUUID();
    const oldConversation = await writeConversation(store, oldOwnerId, randomUUID());
    const oldInstallation = await store.applicationRuntimeInstallation.create({
      data: { ownerId: oldOwnerId, applicationId: application.id, versionId: version.id, channel: "direct" },
    });
    const oldSession = await store.applicationExternalSession.create({
      data: {
        externalAccessId: access.id, applicationId: application.id, runtimePrincipalId: oldOwnerId,
        externalSubject: "returning-user", conversationId: oldConversation.id, origin,
        credentialVersion: access.credentialVersion, status: "expired", absoluteExpiresAt: new Date("2026-08-01T00:00:00Z"),
      },
    });
    const returning = await verify(await exchange(secondService, await issueTicket("returning-user")));
    assert.equal(returning.sessionId, oldSession.id);
    assert.equal(returning.ownerId, oldOwnerId);
    assert.equal(returning.conversationId, oldConversation.id);
    assert.deepEqual(await store.conversation.findUnique({ where: { id: oldConversation.id } }), oldConversation);
    assert.deepEqual(await store.applicationRuntimeInstallation.findUnique({
      where: { ownerId_applicationId: { ownerId: oldOwnerId, applicationId: application.id } },
    }), oldInstallation);
    console.log("PASS: returning identity reuses the pre-change session, runtime installation and task.");

    const verifyRecovery = async (expired: boolean) => {
      const externalSubject = expired ? "expired-initializer" : "failed-initializer";
      const [initialTicket, nextTicket] = await Promise.all([issueTicket(externalSubject), issueTicket(externalSubject)]);
      const entered = latch<{ ownerId: string; conversationId: string }>();
      const finish = latch();
      const failure = new Error("Fixture workspace is unavailable");
      const initializer = createService(firstClient, async (ownerId, conversationId) => {
        entered.resolve({ ownerId, conversationId });
        await finish.promise;
        if (!expired) throw failure;
      });
      const original = exchange(initializer, initialTicket);
      let retry: Promise<Exchange> | undefined;
      let attempt: Awaited<typeof entered.promise>;
      try {
        attempt = await Promise.race([
          entered.promise,
          original.then(() => assert.fail("Initializer returned before workspace preparation")),
        ]);
        await assertTicketConsumed(initialTicket);
        if (expired) {
          const pending = await store.applicationExternalSession.update({
            where: { runtimePrincipalId: attempt.ownerId },
            data: { initializationExpiresAt: new Date(0) },
          });
          assert.equal(pending.initializationExpiresAt?.getTime(), 0);
        }
        retry = exchange(secondService, nextTicket);
        if (expired) {
          const successor = await verify(await retry);
          assert.notEqual(successor.ownerId, attempt.ownerId, "A retry must take over before the expired attempt resumes");
        } else {
          await waitFor("the second request to consume its own ticket", async () => Boolean(
            (await store.applicationEmbedTicket.findUnique({ where: { ticketHash: sha256(nextTicket) } }))?.consumedAt,
          ));
        }
      } finally {
        finish.resolve();
        await Promise.allSettled([original, retry]);
      }
      if (expired) await assert.rejects(original, { code: "CONFLICT" });
      else await assert.rejects(original, (error: unknown) => error === failure);
      const next = await verify(await retry);
      assert.notEqual(next.ownerId, attempt.ownerId);
      assert.notEqual(next.conversationId, attempt.conversationId);
      assert.equal((await sessionsFor(externalSubject, null)).length, 1);
      assert.equal(await store.applicationRuntimeInstallation.count({ where: { ownerId: attempt.ownerId } }), 0);
      assert.equal(await store.conversation.count({ where: { ownerId: attempt.ownerId } }), 0);
      const cleanup = await store.runtimeCleanupOutbox.findUniqueOrThrow({
        where: { conversationId: attempt.conversationId },
      });
      assert.equal(cleanup.ownerId, attempt.ownerId);
      assert.equal(cleanup.serviceSessionId, application.id);
      assert.equal(cleanup.removeServiceEnvironment, true);
    };
    await verifyRecovery(false);
    await verifyRecovery(true);
    console.log("PASS: retries recover from failed or expired initialization; a stale attempt cannot overwrite the successor.");

    const [anonymousTicket, otherAnonymousTicket] = await Promise.all([issueTicket(), issueTicket()]);
    const [anonymous, otherAnonymous] = await Promise.all([
      exchange(firstService, anonymousTicket).then(verify),
      exchange(secondService, otherAnonymousTicket).then(verify),
    ]);
    assert.notEqual(anonymous.ownerId, otherAnonymous.ownerId);
    await store.applicationExternalAccess.update({ where: { id: access.id }, data: { authMode: "public" } });
    const [publicSession, otherPublicSession] = await Promise.all([
      firstService.createPublicSession(appId, origin, metadata, {}),
      secondService.createPublicSession(appId, origin, metadata, {}),
    ]);
    assert.notEqual(publicSession.session_id, otherPublicSession.session_id);
    const publicOwners = await Promise.all([publicSession, otherPublicSession].map(async (session) => {
      const verified = await firstService.verifyPublicSession(appId, session.session_id, origin);
      assert.notEqual(verified.ownerId, anonymous.ownerId);
      assert.notEqual(verified.ownerId, otherAnonymous.ownerId);
      return verified.ownerId;
    }));
    assert.notEqual(publicOwners[0], publicOwners[1]);
    console.log("PASS: anonymous ticket and public sessions remain independent.");
  } finally {
    redis.client.disconnect();
    await Promise.all(clients.map((db) => db.$disconnect()));
  }
}

let started = false;
try {
  let databaseUrl = process.env.LINKSENSE_TEST_DATABASE_URL;
  if (databaseUrl) {
    const target = new URL(databaseUrl);
    assert.equal(target.protocol, "postgresql:");
    assert.equal(target.hostname, "127.0.0.1");
    assert.equal(target.pathname, `/${databaseName}`);
    assert.equal(target.search, "");
    const candidate = createPrismaClient(databaseUrl);
    try {
      const [existing] = await candidate.$queryRaw<Array<{ count: number }>>`
        SELECT count(*)::integer AS count FROM information_schema.tables WHERE table_schema = 'public'`;
      assert.equal(existing?.count, 0, "LINKSENSE_TEST_DATABASE_URL must point to an empty, disposable database");
    } finally {
      await candidate.$disconnect();
    }
  } else {
    const password = randomUUID();
    await docker([
      "run", "--rm", "--detach", "--name", container, "--label", "com.linksense.test.disposable=true",
      "--publish", "127.0.0.1::5432", "--env", `POSTGRES_DB=${databaseName}`, "--env", "POSTGRES_PASSWORD", "postgres:16-alpine",
    ], { ...process.env, POSTGRES_PASSWORD: password });
    started = true;
    const port = Number((await docker(["port", container, "5432"])).split(":").at(-1));
    assert(Number.isInteger(port) && port > 0);
    await waitFor("the disposable PostgreSQL container", async () => {
      try { await docker(["exec", container, "pg_isready", "-h", "127.0.0.1", "-U", "postgres"]); return true; }
      catch { return false; }
    });
    databaseUrl = `postgresql://postgres:${password}@127.0.0.1:${port}/${databaseName}`;
  }
  await execute("pnpm", ["exec", "prisma", "migrate", "deploy", "--config", "apps/api/test/integration/prisma.config.ts"], {
    cwd: repositoryRoot, timeout: 120_000, maxBuffer: 4_000_000,
    env: { ...process.env, DATABASE_URL: databaseUrl, LINKSENSE_TEST_MIGRATIONS_PATH: `${repositoryRoot}/prisma/migrations` },
  });
  await verifySessions(databaseUrl);
} finally {
  if (started) await docker(["rm", "--force", "--volumes", container]);
}
