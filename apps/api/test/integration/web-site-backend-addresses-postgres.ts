import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { cp, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { z } from "zod";
import { generatedWebSiteBackendHostLabel, type WebBundleManifest } from "@linksense/shared";
import { createPrismaClient } from "../../src/db.js";
import { WebSiteBackendRepository } from "../../src/modules/web-site-backends/repository.js";
import { WebSiteRepository } from "../../src/modules/web-sites/repository.js";
import { projectSite } from "../../src/modules/web-sites/service.js";

// This check applies migrations only to an explicitly supplied, empty local
// test database. It never loads the application .env or contacts Appwrite.
const databaseUrl = z.url().parse(process.env.LINKSENSE_TEST_DATABASE_URL);
const parsed = new URL(databaseUrl);
assert(["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname));
assert(parsed.pathname.startsWith("/linksense_backend_addresses_test"));
const db = createPrismaClient(databaseUrl);
const execute = promisify(execFile);
const repo = fileURLToPath(new URL("../../../../", import.meta.url));
const migrations = join(repo, "prisma/migrations");
const before = await mkdtemp(join(tmpdir(), "linksense-before-backend-addresses-"));
const addressMigration = "20261117160000_reserve_web_site_backend_addresses";
const migrate = async (directory: string) => execute("pnpm", [
  "exec", "prisma", "migrate", "deploy", "--config", "apps/api/test/integration/prisma.config.ts",
], {
  cwd: repo, timeout: 120_000, maxBuffer: 4_000_000,
  env: { ...process.env, DATABASE_URL: databaseUrl, LINKSENSE_TEST_MIGRATIONS_PATH: directory },
});

try {
  const tables = await db.$queryRaw<Array<{ count: bigint }>>`
    SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'`;
  assert.equal(tables[0]?.count, 0n, "The test database must be empty");
  for (const entry of await readdir(migrations)) {
    if (entry < addressMigration || entry === "migration_lock.toml") {
      await cp(join(migrations, entry), join(before, entry), { recursive: true });
    }
  }
  await migrate(before);
  const owner = await db.user.create({ data: {
    email: "address-owner@example.test", name: "Address owner", role: "admin", status: "active",
  } });
  const task = await db.conversation.create({ data: {
    ownerId: owner.id, title: "Address upgrade", titleSource: "manual", archiveStatus: "active",
    workspaceRelPath: `${owner.id}/home/workspace`, runtimeGeneration: randomUUID(),
  } });
  const legacyId = randomUUID(), chosenId = randomUUID();
  await db.$executeRaw`INSERT INTO web_site_backends
    (id, owner_id, conversation_id, name, project_id, status, encrypted_credential, updated_at)
    VALUES (${legacyId}::uuid, ${owner.id}::uuid, ${task.id}::uuid, 'Legacy', 'legacy-project',
      'ready', 'preserved-test-credential', CURRENT_TIMESTAMP)`;
  await db.$executeRaw`INSERT INTO web_site_backends
    (id, owner_id, conversation_id, name, project_id, host_label, status, encrypted_credential, updated_at)
    VALUES (${chosenId}::uuid, ${owner.id}::uuid, ${task.id}::uuid, 'Chosen', 'chosen-project',
      'appointments', 'ready', 'preserved-test-credential', CURRENT_TIMESTAMP)`;
  const oldRecords = await db.$queryRaw`SELECT to_jsonb(b) AS row FROM web_site_backends b ORDER BY id`;
  await migrate(migrations);
  assert.deepEqual(await db.$queryRaw`SELECT to_jsonb(b)-'host_resolved'-'runtime_mode' AS row FROM web_site_backends b ORDER BY id`, oldRecords);
  const store = new WebSiteBackendRepository(db);
  assert.equal((await store.owned(owner.id, legacyId)).runtimeMode, null);
  assert.equal((await store.owned(owner.id, chosenId)).runtimeMode, null);
  assert.deepEqual(await store.byHostLabel(legacyId), { id: legacyId });
  assert.deepEqual(await store.byHostLabel("appointments"), { id: chosenId });
  assert.deepEqual(await store.findByHostLabel("appointments"), { id: chosenId });
  console.log("PASS: forward migration preserves existing records, credentials and UUID/custom addresses.");

  const first = await store.reserve(owner.id, task.id, "First");
  const second = await store.reserve(owner.id, task.id, "Second");
  assert.equal(first.hostLabel, generatedWebSiteBackendHostLabel(first.id));
  assert.equal(first.runtimeMode, "sandbox");
  assert.deepEqual(await store.byHostLabel(first.hostLabel!), { id: first.id });
  const lease = new Date(Date.now() + 60_000);
  await store.acquire(owner.id, first.id, lease);
  await store.acquire(owner.id, second.id, lease);
  const leaseCheck = await db.$queryRaw<Array<{ stored: Date; equal: boolean; future: boolean }>>`
    SELECT lease_until AS stored, lease_until = ${lease} AS equal,
      lease_until > ${new Date()} AS future
    FROM web_site_backends WHERE id = ${first.id}::uuid`;
  assert(leaseCheck[0]?.equal && leaseCheck[0].future, JSON.stringify({ lease, observed: leaseCheck }));
  const claims = await Promise.allSettled([
    store.setHostLabel(first.id, lease, "bookings"),
    store.setHostLabel(second.id, lease, "bookings"),
  ]);
  if (claims[0].status === "rejected" && claims[1].status === "rejected") throw claims[0].reason;
  assert.equal(claims.filter(result => result.status === "fulfilled").length, 1);
  const failed = claims.find(result => result.status === "rejected");
  assert(failed?.status === "rejected");
  assert.equal(failed.reason.code, "WEB_SITE_BACKEND_ADDRESS_TAKEN");
  const winner = claims[0]?.status === "fulfilled" ? first : second;
  const loser = winner.id === first.id ? second : first;
  await store.setHostLabel(winner.id, lease, "new-bookings", false);
  assert.equal((await store.findById(winner.id))?.hostResolved, false);
  assert.deepEqual(await store.byHostLabel("bookings"), { id: winner.id });
  await assert.rejects(store.setHostLabel(loser.id, lease, "bookings"), { code: "WEB_SITE_BACKEND_ADDRESS_TAKEN" });
  await store.setHostLabel(winner.id, lease, "bookings");
  assert.equal((await store.findById(winner.id))?.hostResolved, true);
  assert.deepEqual(await store.byHostLabel("bookings"), { id: winner.id });
  assert.equal(await store.byHostLabel("new-bookings"), null);
  await assert.rejects(store.setHostLabel(loser.id, lease, "new-bookings"), { code: "WEB_SITE_BACKEND_ADDRESS_TAKEN" });
  console.log("PASS: concurrent claims choose one backend; retired/failed addresses cannot move to another backend.");

  await store.finish(winner.id, lease);
  const newerLease = new Date(lease.getTime() + 1);
  await store.acquire(owner.id, winner.id, newerLease);
  await assert.rejects(store.setHostLabel(winner.id, lease, null), { code: "CONFLICT" });
  assert.deepEqual(await store.byHostLabel("bookings"), { id: winner.id });
  console.log("PASS: stale rollback cannot overwrite an address after losing its lease.");

  const sites = new WebSiteRepository(db);
  const manifest: WebBundleManifest = { entry_path: "index.html", files: [{
    path: "index.html", object_key: "fixture/index.html", mime_type: "text/html", size_bytes: 1, checksum_sha256: "a".repeat(64),
  }] };
  const createStatic = async (slug: string) => {
    const file = await db.conversationFile.create({ data: {
      conversationId: task.id, kind: "artifact", source: "agent_generated", status: "registered",
      filename: `${slug}.html`, mimeType: "text/html", sizeBytes: 1, storageBackend: "minio",
      minioObjectKey: "fixture/index.html", downloadable: true, downloadCardEventId: randomUUID(),
    } });
    return sites.create(owner.id, { conversation_id: task.id, file_id: file.id, name: slug, description: "" },
      { siteId: randomUUID(), releaseId: randomUUID(), slug }, task.title, manifest);
  };
  const preparedBackend = async (name: string) => {
    const backend = await store.reserve(owner.id, task.id, name);
    await db.webSiteBackend.update({ where: { id: backend.id }, data: { status: "ready" } });
    return backend;
  };
  const staticApp = await createStatic("water-original");
  await assert.rejects(store.publicBindingForSite(staticApp.site.id), { code: "WEB_SITE_NOT_FOUND" });
  const stablePath = projectSite(staticApp).url_path;
  await sites.update(owner.id, staticApp.site.id, { slug: "water-renamed" });
  assert.equal((await sites.publicSite("water-original")).site.id, staticApp.site.id);
  const backend = await preparedBackend("Water data");
  const enhanced = await sites.publish(owner.id, staticApp.site.id, task.id,
    staticApp.site.sourceFileId, randomUUID(), manifest, undefined, backend.id);
  assert.equal(enhanced.site.backendId, backend.id);
  assert.equal(enhanced.site.id, staticApp.site.id);
  assert.equal(projectSite(enhanced).url_path, stablePath);
  assert.equal((await sites.publicSiteById(staticApp.site.id)).site.currentReleaseId, enhanced.release.id);
  assert.equal((await store.publicBindingForSite(staticApp.site.id)).backend.id, backend.id);
  await assert.rejects(sites.publish(owner.id, staticApp.site.id, task.id,
    staticApp.site.sourceFileId, randomUUID(), manifest, undefined, second.id), { code: "CONFLICT" });
  console.log("PASS: pre-backend static records retain identity, stable URL and retired aliases after atomic enhancement.");

  const rollback = await createStatic("rollback");
  const rollbackBackend = await preparedBackend("Rollback data");
  await assert.rejects(sites.publish(owner.id, rollback.site.id, task.id, rollback.site.sourceFileId,
    enhanced.release.id, manifest, undefined, rollbackBackend.id));
  const unchanged = (await sites.owned(owner.id, rollback.site.id)).site;
  assert.equal(unchanged.backendId, null);
  assert.equal(unchanged.currentReleaseId, rollback.site.currentReleaseId);
  assert.equal(await db.webSiteRelease.count({ where: { siteId: rollback.site.id } }), 1);
  const rival = await createStatic("concurrent");
  const enhancementClaims = await Promise.allSettled([rollback, rival].map(page => sites.publish(owner.id, page.site.id,
    task.id, page.site.sourceFileId, randomUUID(), manifest, undefined, rollbackBackend.id)));
  assert.equal(enhancementClaims.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(await db.webSite.count({ where: { backendId: rollbackBackend.id } }), 1);
  await sites.update(owner.id, staticApp.site.id, { status: "disabled" });
  await assert.rejects(sites.publicSiteById(staticApp.site.id), { code: "WEB_SITE_NOT_FOUND" });
  await assert.rejects(sites.publicSite("water-original"), { code: "WEB_SITE_NOT_FOUND" });
  await assert.rejects(store.publicBindingForSite(staticApp.site.id), { code: "WEB_SITE_NOT_FOUND" });
  console.log("PASS: failed enhancement rolls back; concurrent bindings choose one app; disablement fences stable and retired addresses.");
} finally {
  await db.$disconnect();
  await rm(before, { recursive: true, force: true });
}
