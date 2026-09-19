import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createRequire } from "node:module";
import { setTimeout as delay } from "node:timers/promises";
import { webSiteSchema } from "@linksense/shared";
import { createPrismaClient } from "../../src/db.js";
import { testConfig } from "../test-config.js";
import { LinkSenseRedis } from "../../src/adapters/redis.js";
import { RunnerClient } from "../../src/adapters/runner.js";
import { createObjectStorage } from "../../src/adapters/object-storage.js";
import { createServices } from "../../src/services.js";
import { buildApi } from "../../src/app.js";

// All infrastructure and accounts in this test are disposable and test-owned.
// No application .env or existing database is read. --serve keeps the actual
// API and fixtures alive for browser verification until SIGINT/SIGTERM.
const execute = promisify(execFile);
const repo = fileURLToPath(new URL("../../../../", import.meta.url));
const root = await realpath(await mkdtemp(join(tmpdir(), "linksense-web-sites-")));
const containers: string[] = [];
const docker = async (...args: string[]) => (await execute("docker", args, { timeout: 30_000 })).stdout.trim();
let db: ReturnType<typeof createPrismaClient> | undefined;
let redis: LinkSenseRedis | undefined;
let services: ReturnType<typeof createServices> | undefined;
let app: Awaited<ReturnType<typeof buildApi>> | undefined;
const serve = process.argv.includes("--serve");
try {
  const password = randomUUID();
  const postgres = `linksense-web-pg-${randomUUID()}`;
  const redisName = `linksense-web-redis-${randomUUID()}`;
  await docker("run", "--rm", "--label", "com.linksense.test.disposable=true", "-d", "--name", postgres, "-p", "127.0.0.1::5432", "-e", `POSTGRES_PASSWORD=${password}`, "-e", "POSTGRES_DB=web_sites_test", "postgres:16-alpine");
  containers.push(postgres);
  await docker("run", "--rm", "--label", "com.linksense.test.disposable=true", "-d", "--name", redisName, "-p", "127.0.0.1::6379", "redis:7-alpine");
  containers.push(redisName);
  const pgPort = Number((await docker("port", postgres, "5432")).split(":").at(-1));
  const redisPort = Number((await docker("port", redisName, "6379")).split(":").at(-1));
  for (let attempt = 0; ; attempt++) {
    try { await docker("exec", postgres, "pg_isready", "-h", "127.0.0.1", "-U", "postgres"); break; }
    catch (error) { if (attempt >= 50) throw error; await delay(100); }
  }
  const databaseUrl = `postgresql://postgres:${password}@127.0.0.1:${pgPort}/web_sites_test`;
  const migrations = join(repo, "prisma/migrations");
  const hardDeleteMigration = "20260918020000_hard_delete_web_sites";
  const before = join(root, "migrations");
  const beforeHardDelete = join(root, "before-hard-delete");
  for (const entry of await readdir(migrations, { withFileTypes: true })) {
    if (entry.name === hardDeleteMigration) continue;
    await cp(join(migrations, entry.name), join(beforeHardDelete, entry.name), { recursive: true });
    if (entry.name !== "20260917180000_add_web_sites") await cp(join(migrations, entry.name), join(before, entry.name), { recursive: true });
  }
  const migrate = async (path: string) => { await execute("pnpm", ["exec", "prisma", "migrate", "deploy", "--config", "apps/api/test/integration/prisma.config.ts"], { cwd: repo, timeout: 120_000, env: { ...process.env, DATABASE_URL: databaseUrl, LINKSENSE_TEST_MIGRATIONS_PATH: path }, maxBuffer: 4_000_000 }); };
  await migrate(before);
  db = createPrismaClient(databaseUrl);
  const owner = await db.user.create({ data: { email: "web-owner@example.test", name: "站点测试", role: "admin", status: "active", preferredLocale: "zh-CN" } });
  const other = await db.user.create({ data: { email: "web-other@example.test", name: "Other", role: "user", status: "active" } });
  const task = await db.conversation.create({ data: { ownerId: owner.id, title: "网页分享功能验证", titleSource: "manual", archiveStatus: "active", workspaceRelPath: `${owner.id}/home/workspace`, runtimeGeneration: randomUUID() } });
  const legacyHtml = Buffer.from('<!doctype html><title>Existing webpage</title><button onclick="this.textContent=42">Run</button>');
  const legacy = await db.conversationFile.create({ data: { conversationId: task.id, kind: "artifact", source: "agent_generated", status: "registered", filename: "existing.html", mimeType: "text/html", sizeBytes: legacyHtml.length, storageBackend: "minio", minioObjectKey: "legacy/index.html", downloadable: true, downloadCardEventId: randomUUID() } });
  const oldTask = await db.$queryRaw`SELECT to_jsonb(c) AS row FROM conversations c WHERE id=${task.id}::uuid`;
  const oldFile = await db.$queryRaw`SELECT to_jsonb(f) AS row FROM conversation_files f WHERE id=${legacy.id}::uuid`;
  await migrate(beforeHardDelete);
  const upgradeSites = [];
  for (const status of ["published", "disabled", "deleted"]) {
    const upgradeSite = await db.webSite.create({ data: { ownerId: owner.id, conversationId: task.id, sourceTaskTitle: task.title, originFileId: randomUUID(), sourceFileId: legacy.id, name: status, slug: `upgrade-${status}`, status: status === "published" ? "published" : "disabled", currentReleaseId: randomUUID() } });
    await db.webSiteAddress.createMany({ data: [upgradeSite.slug, `${upgradeSite.slug}-old`].map(slug => ({ slug, siteId: upgradeSite.id })) });
    await db.webSiteRelease.create({ data: { id: upgradeSite.currentReleaseId, siteId: upgradeSite.id, sourceFileId: legacy.id, manifestJson: { entry_path: "index.html", files: [{ path: "index.html", object_key: "legacy/index.html", mime_type: "text/html", size_bytes: legacyHtml.length, checksum_sha256: createHash("sha256").update(legacyHtml).digest("hex") }] } } });
    if (status === "deleted") await db.$executeRaw`UPDATE web_sites SET deleted_at = CURRENT_TIMESTAMP WHERE id = ${upgradeSite.id}::uuid`;
    upgradeSites.push({ site: upgradeSite, deleted: status === "deleted" });
  }
  await migrate(migrations);
  for (const { site: upgradeSite, deleted } of upgradeSites) {
    if (deleted) {
      assert.equal(await db.webSite.count({ where: { id: upgradeSite.id } }), 0);
      assert.equal(await db.webSiteAddress.count({ where: { siteId: upgradeSite.id } }), 0);
      assert.equal(await db.webSiteRelease.count({ where: { siteId: upgradeSite.id } }), 0);
    } else {
      assert.deepEqual(await db.webSite.findUniqueOrThrow({ where: { id: upgradeSite.id } }), upgradeSite);
      assert.equal(await db.webSiteAddress.count({ where: { siteId: upgradeSite.id } }), 2);
      assert.equal(await db.webSiteRelease.count({ where: { siteId: upgradeSite.id } }), 1);
    }
  }
  assert.equal((await db.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) FROM information_schema.columns WHERE table_name='web_sites' AND column_name='deleted_at'`)[0]?.count, 0n);
  assert.deepEqual(await db.$queryRaw`SELECT to_jsonb(c) AS row FROM conversations c WHERE id=${task.id}::uuid`, oldTask);
  assert.deepEqual(await db.$queryRaw`SELECT to_jsonb(f) AS row FROM conversation_files f WHERE id=${legacy.id}::uuid`, oldFile);
  assert.equal((await db.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) FROM information_schema.table_constraints WHERE constraint_type='FOREIGN KEY' AND table_name IN ('web_sites','web_site_addresses','web_site_releases','web_artifact_bundles')`)[0]?.count, 0n);

  const publicBaseUrl = "http://localhost:19542";
  const config = testConfig({ LINKSENSE_EDITION: "core", LINKSENSE_OBJECT_STORAGE_PROVIDER: "local-filesystem", DATABASE_URL: databaseUrl, REDIS_URL: `redis://127.0.0.1:${redisPort}`, LINKSENSE_PUBLIC_BASE_URL: publicBaseUrl, LINKSENSE_USER_DATA_ROOT: join(root, "users"), LINKSENSE_RUNNER_URL: "http://127.0.0.1:1" });
  await mkdir(config.userDataRoot, { recursive: true });
  redis = new LinkSenseRedis(config);
  await redis.connect();
  const storage = createObjectStorage(config);
  await storage.ensureBucket();
  await storage.putObject("legacy/index.html", legacyHtml);
  services = createServices({ config, prisma: db, redis, runner: new RunnerClient(config), storage });
  await db.systemSetting.create({ data: { settingsJson: { system_initialized: true } } });
  app = await buildApi(services);
  const api = app;
  const token = api.jwt.sign({ sub: owner.id, email: owner.email, role: owner.role, auth_valid_after: owner.authValidAfter.toISOString() });
  const otherToken = api.jwt.sign({ sub: other.id, email: other.email, role: other.role, auth_valid_after: other.authValidAfter.toISOString() });
  const headers = { authorization: `Bearer ${token}` };
  const prefix = "/api/v1/web-sites";
  for (const { site: upgradeSite, deleted } of upgradeSites) {
    if (deleted) continue;
    assert.equal((await api.inject(`/web/${upgradeSite.slug}`)).statusCode, upgradeSite.status === "published" ? 200 : 404);
    assert.equal((await api.inject(`/web/${upgradeSite.slug}/_releases/${upgradeSite.currentReleaseId}/index.html`)).statusCode, upgradeSite.status === "published" ? 200 : 404);
    assert.equal((await api.inject({ url: `${prefix}/${upgradeSite.id}/download`, headers })).statusCode, 200);
    assert.equal((await api.inject({ method: "PATCH", url: `${prefix}/${upgradeSite.id}`, headers, payload: { name: "Upgraded site" } })).statusCode, 200);
    assert.equal((await api.inject({ method: "DELETE", url: `${prefix}/${upgradeSite.id}`, headers })).statusCode, 204);
  }
  console.log("PASS: migration purges historical tombstones and removes the obsolete column; existing published and disabled sites retain their metadata, links, downloads and management operations.");
  const createSite = async (fileId: string, slug?: string) => {
    const response = await api.inject({ method: "POST", url: prefix, headers, payload: { conversation_id: task.id, file_id: fileId, name: "山海集 · 网页分享验证", ...(slug ? { slug } : {}) } });
    assert.equal(response.statusCode, 201, response.body);
    return webSiteSchema.parse(response.json().data);
  };
  const legacySite = await createSite(legacy.id);
  assert.match(legacySite.slug, /^[a-f0-9-]{36}$/u);
  assert.equal((await api.inject(legacySite.url_path)).statusCode, 200);

  const workspace = join(config.userDataRoot, task.workspaceRelPath);
  const publicDirectory = join(workspace, "artifacts/site");
  await mkdir(join(publicDirectory, "assets"), { recursive: true });
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>山海集</title><link rel="stylesheet" href="/assets/style.css"></head><body><main><p>LINKSENSE · WEBSITE CHECK</p><h1>山海集</h1><p id="version">正在加载</p><img width="64" height="64" src="/assets/logo.svg" alt="山海标志"><button id="counter">点击 0</button><p id="data">数据加载中</p><p id="isolation">隔离检查中</p><a href="about.html">关于本期</a></main><script type="module" src="/assets/main.js"></script></body></html>`;
  await writeFile(join(publicDirectory, "index.html"), html);
  await writeFile(join(publicDirectory, "about.html"), '<!doctype html><title>关于本期</title><h1>关于本期</h1><a href="index.html">返回首页</a>');
  await writeFile(join(publicDirectory, "assets/style.css"), '@font-face{font-family:Demo;src:url("/assets/font.woff2")}body{background:#132421;color:#f6edcf;font-family:Demo,system-ui;margin:0}main{max-width:760px;margin:auto;padding:48px 24px}h1{font-size:clamp(36px,8vw,64px)}p{line-height:1.6}button{background:#e7bb6d;color:#132421;border:0;border-radius:24px;padding:12px 24px;display:block;margin:24px 0}a{color:#e7bb6d}');
  const font = createRequire(join(repo, "apps/web/package.json")).resolve("@fontsource-variable/inter/files/inter-latin-wght-normal.woff2");
  await writeFile(join(publicDirectory, "assets/font.woff2"), await readFile(font));
  await writeFile(join(publicDirectory, "assets/logo.svg"), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="30" fill="#e7bb6d"/><path d="M10 42 26 18 40 38 49 24 59 42Z" fill="#132421"/></svg>');
  await writeFile(join(publicDirectory, "data.json"), JSON.stringify({ message: "配套 JSON 数据加载成功" }));
  await writeFile(join(publicDirectory, "assets/counter.js"), 'export const label = "第一版";');
  await writeFile(join(publicDirectory, "assets/main.js"), `import {label} from "/assets/counter.js";document.querySelector('#version').textContent=label;let count=0;document.querySelector('#counter').onclick=()=>{document.querySelector('#counter').textContent='点击 '+(++count)};const data=await fetch('./data.json').then(r=>r.json());document.querySelector('#data').textContent=data.message;let protectedCount=0;try{void parent.document.body}catch{protectedCount++}try{void localStorage.length}catch{protectedCount++}document.querySelector('#isolation').textContent='隔离检查 '+protectedCount+'/2';`);
  await db.conversationTurn.create({ data: { conversationId: task.id, submittedBy: owner.id, sequenceNo: 1, codexThreadId: "qa-thread", codexTurnId: "qa-turn", status: "running", submitMode: "normal", capabilityGeneration: "a".repeat(64), capabilitiesJson: [], startedAt: new Date() } });
  const register = () => services!.files.registerArtifact({ ownerId: owner.id, conversationId: task.id, codexTurnId: "qa-turn", workspaceRelativePath: "artifacts/site/index.html", displayName: "山海集.html", mimeType: "text/html", webRootRelativePath: "artifacts/site" });
  const first = await register();
  const site = await createSite(first.file_id, "shanhai-demo");
  const initialEntry = await services.webSites.publicEntry(site.slug);
  const firstContent = await api.inject(initialEntry.path);
  assert.equal(firstContent.statusCode, 200, firstContent.body);
  assert.match(firstContent.headers["content-security-policy"]!, /sandbox allow-scripts/u);
  assert.equal((await api.inject({ url: `${prefix}/${site.id}/download`, headers: { authorization: `Bearer ${otherToken}` } })).statusCode, 404);
  assert.equal((await api.inject({ url: prefix })).statusCode, 401);
  assert.equal((await api.inject({ url: prefix, headers: { authorization: `Bearer ${otherToken}` } })).json().data.items.length, 0);
  const concurrent = await Promise.all([createSite(first.file_id), createSite(first.file_id)]);
  assert(concurrent.every(row => row.id === site.id));
  assert.equal(await db.webSite.count({ where: { originFileId: first.file_id } }), 1);
  await writeFile(join(publicDirectory, "assets/counter.js"), 'export const label = "第二版";');
  const second = await register();
  const originalModule = initialEntry.path.replace("index.html", "assets/counter.js");
  assert.match((await api.inject(originalModule)).body, /第一版/u);
  const published = await api.inject({ method: "POST", url: `${prefix}/${site.id}/releases`, headers, payload: { file_id: second.file_id } });
  assert.equal(published.statusCode, 201, published.body);
  assert.equal(published.json().data.url_path, site.url_path);
  assert.notEqual(published.json().data.release_id, site.release_id);
  assert.match((await api.inject(originalModule)).body, /第一版/u);
  const currentEntry = await services.webSites.publicEntry(site.slug);
  assert.match((await api.inject(currentEntry.path.replace("index.html", "assets/counter.js"))).body, /第二版/u);
  assert.equal((await api.inject({ method: "PATCH", url: `${prefix}/${site.id}`, headers, payload: { slug: legacySite.slug } })).statusCode, 409);
  assert.equal((await api.inject({ method: "PATCH", url: `${prefix}/${site.id}`, headers, payload: { status: "disabled" } })).statusCode, 200);
  assert.equal((await api.inject(site.url_path)).statusCode, 404);
  assert.equal((await api.inject(originalModule)).statusCode, 404);
  assert.equal((await api.inject(currentEntry.path)).statusCode, 404);
  assert.equal((await api.inject({ url: `${prefix}/${site.id}/download`, headers })).statusCode, 200);
  assert.equal((await api.inject({ method: "PATCH", url: `${prefix}/${site.id}`, headers, payload: { status: "published", slug: "shanhai-published" } })).statusCode, 200);
  assert.equal((await api.inject(site.url_path)).statusCode, 404);
  assert.equal((await api.inject("/web/shanhai-published")).statusCode, 200);
  assert.equal((await api.inject({ method: "DELETE", url: `${prefix}/${legacySite.id}`, headers })).statusCode, 204);
  assert.equal((await api.inject(legacySite.url_path)).statusCode, 404);
  assert(await db.conversationFile.findUnique({ where: { id: legacy.id } }));
  const recreated = await createSite(legacy.id, legacySite.slug);
  assert.equal(recreated.status, "published");
  assert.notEqual(recreated.id, legacySite.id);
  assert.equal(recreated.url_path, legacySite.url_path);
  assert.equal(await db.webSite.count({ where: { id: legacySite.id } }), 0);
  assert.equal(await db.webSiteAddress.count({ where: { siteId: legacySite.id } }), 0);
  assert.equal(await db.webSiteRelease.count({ where: { siteId: legacySite.id } }), 0);
  assert.equal((await api.inject(`/web/${legacySite.slug}/_releases/${legacySite.release_id}/index.html`)).statusCode, 404);
  assert.equal((await api.inject({ method: "DELETE", url: `${prefix}/${recreated.id}`, headers: { authorization: `Bearer ${otherToken}` } })).statusCode, 404);
  assert.equal((await api.inject({ method: "PATCH", url: `${prefix}/${recreated.id}`, headers, payload: { slug: "test" } })).statusCode, 200);
  assert.equal((await api.inject({ method: "DELETE", url: `${prefix}/${recreated.id}`, headers })).statusCode, 204);
  assert.equal(await db.webSiteAddress.count({ where: { slug: { in: [legacySite.slug, "test"] } } }), 0);
  const reuseForeignTask = await db.conversation.create({ data: { ownerId: other.id, title: "Reuse a deleted address", titleSource: "manual", archiveStatus: "active", workspaceRelPath: task.workspaceRelPath, runtimeGeneration: randomUUID() } });
  await storage.putObject("reuse-foreign/index.html", legacyHtml);
  const reuseForeignFile = await db.conversationFile.create({ data: { conversationId: reuseForeignTask.id, kind: "artifact", source: "agent_generated", status: "registered", filename: "index.html", mimeType: "text/html", sizeBytes: legacyHtml.length, storageBackend: "minio", minioObjectKey: "reuse-foreign/index.html", downloadable: true, downloadCardEventId: randomUUID() } });
  const reusePayload = { conversation_id: reuseForeignTask.id, file_id: reuseForeignFile.id, name: "Another publisher", slug: "test" };
  const otherHeaders = { authorization: `Bearer ${otherToken}` };
  const foreignReuse = await api.inject({ method: "POST", url: prefix, headers: otherHeaders, payload: reusePayload });
  assert.equal(foreignReuse.statusCode, 201, foreignReuse.body);
  assert.equal((await api.inject("/web/test")).statusCode, 200);
  assert.equal((await api.inject(`/web/test/_releases/${recreated.release_id}/index.html`)).statusCode, 404);
  const ownReuse = await createSite(legacy.id, legacySite.slug);
  assert.equal((await api.inject({ method: "PATCH", url: `${prefix}/${ownReuse.id}`, headers, payload: { slug: "test" } })).statusCode, 409);
  assert.equal((await api.inject({ method: "DELETE", url: `${prefix}/${foreignReuse.json().data.id}`, headers: otherHeaders })).statusCode, 204);
  assert.equal((await api.inject({ method: "PATCH", url: `${prefix}/${ownReuse.id}`, headers, payload: { slug: "test" } })).statusCode, 200);
  assert.equal((await api.inject({ method: "DELETE", url: `${prefix}/${ownReuse.id}`, headers })).statusCode, 204);
  const reuseRace = await Promise.all([
    api.inject({ method: "POST", url: prefix, headers, payload: { conversation_id: task.id, file_id: legacy.id, name: "Original publisher", slug: "test" } }),
    api.inject({ method: "POST", url: prefix, headers: otherHeaders, payload: reusePayload }),
  ]);
  assert.deepEqual(reuseRace.map(response => response.statusCode).sort(), [201, 409]);
  assert.equal(await db.webSite.count({ where: { slug: "test" } }), 1);
  assert.equal(await db.webSiteAddress.count({ where: { slug: "test" } }), 1);
  assert.equal((await api.inject("/web/test")).statusCode, 200);
  await createSite(legacy.id);
  console.log("PASS: permanent deletion releases every address; same and different owners can reuse it; old releases stay inaccessible; concurrent publishers cannot claim the same address.");
  await db.conversationTurn.updateMany({ where: { conversationId: task.id }, data: { status: "completed", completedAt: new Date() } });
  console.log("PASS: additive migration preserves existing rows; real registration/storage; owner authorization; UUID/slug; concurrent creation; immutable updates; stop/resume; rename; download; delete/recreate.");
  if (serve) {
    await api.listen({ host: "127.0.0.1", port: 19541 });
    await writeFile(join(tmpdir(), "linksense-web-sites-qa.json"), JSON.stringify({ token, taskId: task.id, fileId: first.file_id, secondFileId: second.file_id, siteId: site.id, root, apiUrl: "http://127.0.0.1:19541", publicBaseUrl }), { mode: 0o600 });
    console.log(`Browser QA ready: API 19541, frontend target 19542. State file: ${join(tmpdir(), "linksense-web-sites-qa.json")}`);
    await new Promise<void>(resolve => { process.once("SIGTERM", resolve); process.once("SIGINT", resolve); });
  }
  const newTask = await db.conversation.create({ data: { ownerId: owner.id, title: "重新制作网页", titleSource: "manual", archiveStatus: "active", workspaceRelPath: task.workspaceRelPath, runtimeGeneration: randomUUID() } });
  await db.conversationTurn.create({ data: { conversationId: newTask.id, submittedBy: owner.id, sequenceNo: 1, codexThreadId: "qa-redesign-thread", codexTurnId: "qa-redesign-turn", status: "running", submitMode: "normal", capabilityGeneration: "a".repeat(64), capabilitiesJson: [], startedAt: new Date() } });
  await writeFile(join(publicDirectory, "assets/counter.js"), 'export const label = "跨任务新版";');
  const redesigned = await services.files.registerArtifact({ ownerId: owner.id, conversationId: newTask.id, codexTurnId: "qa-redesign-turn", workspaceRelativePath: "artifacts/site/index.html", displayName: "重新设计.html", mimeType: "text/html", webRootRelativePath: "artifacts/site" });
  await db.conversationTurn.updateMany({ where: { conversationId: newTask.id }, data: { status: "completed", completedAt: new Date() } });
  const targetBefore = await db.webSite.findUniqueOrThrow({ where: { id: site.id } });
  const updateUrl = `${prefix}/${site.id}/releases`;
  assert.equal((await api.inject({ method: "POST", url: updateUrl, payload: { file_id: redesigned.file_id } })).statusCode, 401);
  assert.equal((await api.inject({ method: "POST", url: updateUrl, headers: { authorization: `Bearer ${otherToken}` }, payload: { file_id: redesigned.file_id } })).statusCode, 404);
  const foreignTask = await db.conversation.create({ data: { ownerId: other.id, title: "Other owner's source", titleSource: "manual", archiveStatus: "active", workspaceRelPath: `${other.id}/home/workspace`, runtimeGeneration: randomUUID() } });
  await storage.putObject("foreign/index.html", legacyHtml);
  const foreignFile = await db.conversationFile.create({ data: { conversationId: foreignTask.id, kind: "artifact", source: "agent_generated", status: "registered", filename: "private.html", mimeType: "text/html", sizeBytes: legacyHtml.length, storageBackend: "minio", minioObjectKey: "foreign/index.html", downloadable: true, downloadCardEventId: randomUUID() } });
  const foreignSource = await api.inject({ method: "POST", url: updateUrl, headers, payload: { file_id: foreignFile.id } });
  assert.equal(foreignSource.statusCode, 409, foreignSource.body);
  assert.equal(foreignSource.json().error_code, "WEB_SITE_SOURCE_UNAVAILABLE");
  await storage.putObject("incomplete/index.html", legacyHtml);
  const incomplete = await db.conversationFile.create({ data: { conversationId: newTask.id, kind: "artifact", source: "agent_generated", status: "registered", filename: "incomplete.html", mimeType: "text/html", sizeBytes: 1, storageBackend: "minio", minioObjectKey: "incomplete/index.html", downloadable: true, downloadCardEventId: randomUUID() } });
  const brokenUpdate = await api.inject({ method: "POST", url: updateUrl, headers, payload: { file_id: incomplete.id } });
  assert.equal(brokenUpdate.statusCode, 422, brokenUpdate.body);
  assert.deepEqual(await db.webSite.findUniqueOrThrow({ where: { id: site.id } }), targetBefore);
  assert.equal((await api.inject(`/web/${targetBefore.slug}`)).statusCode, 200);

  const crossTaskUpdate = await api.inject({ method: "POST", url: updateUrl, headers, payload: { file_id: redesigned.file_id } });
  assert.equal(crossTaskUpdate.statusCode, 201, crossTaskUpdate.body);
  const updatedSite = webSiteSchema.parse(crossTaskUpdate.json().data);
  assert.equal(updatedSite.id, site.id);
  assert.equal(updatedSite.url_path, `/web/${targetBefore.slug}`);
  assert.equal(updatedSite.name, targetBefore.name);
  assert.equal(updatedSite.description, targetBefore.description);
  assert.equal(updatedSite.conversation_id, newTask.id);
  assert.equal(updatedSite.source_task_title, newTask.title);
  assert.equal(updatedSite.source_file_id, redesigned.file_id);
  assert.equal(await db.webSite.count({ where: { sourceFileId: redesigned.file_id } }), 1);
  const crossEntry = await services.webSites.publicEntry(updatedSite.slug);
  assert.match((await api.inject(crossEntry.path.replace("index.html", "assets/counter.js"))).body, /跨任务新版/u);
  assert.equal((await api.inject(crossEntry.path.replace("index.html", "assets/style.css"))).statusCode, 200);
  assert.equal((await api.inject(crossEntry.path.replace("index.html", "assets/logo.svg"))).statusCode, 200);
  assert.equal((await api.inject({ url: `${prefix}/${site.id}/sources`, headers })).json().data.some((file: { id: string }) => file.id === redesigned.file_id), true);
  assert.equal((await api.inject({ url: `${prefix}?conversation_id=${newTask.id}`, headers })).json().data.items[0].id, site.id);

  const remainingSites = await db.webSite.findMany({ where: { conversationId: task.id } });
  await services.conversations.delete(owner.id, task.id, {});
  for (const remaining of remainingSites) {
    assert.equal((await api.inject(`/web/${remaining.slug}`)).statusCode, 404);
    const record: { conversationId: string | null; status: string } = await db.webSite.findUniqueOrThrow({ where: { id: remaining.id } });
    assert.equal(record.conversationId, null);
    assert.equal(record.status, "disabled");
    assert.equal((await api.inject({ url: `${prefix}/${remaining.id}/download`, headers })).statusCode, 200);
  }
  assert.equal((await api.inject(updatedSite.url_path)).statusCode, 200);
  assert.match((await api.inject(crossEntry.path.replace("index.html", "assets/counter.js"))).body, /跨任务新版/u);
  const retained = remainingSites[0];
  assert(retained, "A retained site from the deleted original task must be available");
  const restoreSource = await api.inject({ method: "POST", url: `${prefix}/${retained.id}/releases`, headers, payload: { file_id: redesigned.file_id } });
  assert.equal(restoreSource.statusCode, 201, restoreSource.body);
  assert.equal(restoreSource.json().data.status, "disabled");
  assert.equal(restoreSource.json().data.conversation_id, newTask.id);
  assert.equal((await api.inject(`/web/${retained.slug}`)).statusCode, 404);
  await services.conversations.delete(owner.id, newTask.id, {});
  assert.equal((await api.inject(updatedSite.url_path)).statusCode, 404);
  assert.equal((await api.inject({ url: `${prefix}/${site.id}/download`, headers })).statusCode, 200);
  console.log("PASS: cross-task replacement preserves URLs and metadata; denies foreign sites/files; failed updates preserve the live release; source lists follow the new task; old task deletion does not disable moved sites; retained sites can receive new content without republishing.");
  console.log("PASS: deleting the source task stops all shares and retains owner downloads.");
} finally {
  await services?.events.stopRecoveryMonitor();
  app?.server.closeAllConnections();
  await app?.close();
  await services?.knowledgeGovernance?.close();
  await services?.knowledgeSourceRuntime?.close();
  await services?.knowledgeRuntime?.close();
  await services?.automationScheduler.close();
  await services?.billingStatementScheduler.close();
  await services?.clawHubScheduler.close();
  await services?.feishu.close();
  await services?.botChannelRuntime.close();
  await services?.feishuRuntime.close();
  await services?.weixinRuntime.close();
  await services?.passwordResetMail.close();
  await services?.jobs.close();
  await redis?.close();
  await db?.$disconnect();
  for (const container of containers.reverse()) await docker("rm", "--force", "--volumes", container);
  await rm(root, { recursive: true, force: true });
  if (serve) await rm(join(tmpdir(), "linksense-web-sites-qa.json"), { force: true });
}
