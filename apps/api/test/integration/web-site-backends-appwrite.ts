import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { z } from "zod";
import { webSiteBackendConfigureSchema } from "@linksense/shared";
import { createPrismaClient } from "../../src/db.js";
import { testConfig } from "../test-config.js";
import { LinkSenseRedis } from "../../src/adapters/redis.js";
import { RunnerClient } from "../../src/adapters/runner.js";
import { createObjectStorage } from "../../src/adapters/object-storage.js";
import { createServices } from "../../src/services.js";
import { buildApi } from "../../src/app.js";
import { sha256 } from "../../src/modules/web-sites/resources.js";

// Only disposable LS containers and a deliberately configured local Appwrite
// instance are used. Credentials are read from a private file, never arguments.
const credentialsFile = z.string().min(1).parse(process.env.LINKSENSE_TEST_APPWRITE_CREDENTIALS_FILE);
const credentialInfo = await lstat(credentialsFile);
assert(credentialInfo.isFile() && (credentialInfo.mode & 0o077) === 0, "Appwrite test credentials must be a private regular file");
const credentials = z.object({ endpoint: z.url(), email: z.email(), password: z.string().min(8) })
  .parse(JSON.parse(await readFile(credentialsFile, "utf8")));
assert(["127.0.0.1", "localhost", "appwrite.localhost"].includes(new URL(credentials.endpoint).hostname));
if (process.env.LINKSENSE_TEST_APPWRITE_TRACE === "1") {
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    try {
      const response = await nativeFetch(input, init);
      if (init?.method !== "GET" || !response.ok) console.log("Appwrite", init?.method ?? "GET", new URL(String(input)).pathname, response.status);
      if (!response.ok) {
        const body = z.object({ type: z.string().regex(/^[a-z_]+$/u) }).safeParse(await response.clone().json().catch(() => ({})));
        if (body.success) console.log("Appwrite error type:", body.data.type);
      }
      return response;
    } catch (error) {
      const diagnostic = z.object({ name: z.string(), cause: z.object({ code: z.string() }).optional() }).safeParse(error);
      console.log("Appwrite transport failed:", diagnostic.success ? diagnostic.data : "unknown transport error");
      throw error;
    }
  };
}
process.env.LOG_LEVEL = "silent";
const execute = promisify(execFile);
const repo = fileURLToPath(new URL("../../../../", import.meta.url));
const root = await realpath(await mkdtemp(join(tmpdir(), "linksense-dynamic-app-test-")));
const containers: string[] = [];
const docker = async (...args: string[]) => (await execute("docker", args, { timeout: 120_000, maxBuffer: 2_000_000 })).stdout.trim();
let db: ReturnType<typeof createPrismaClient> | undefined;
let redis: LinkSenseRedis | undefined;
let services: ReturnType<typeof createServices> | undefined;
let app: Awaited<ReturnType<typeof buildApi>> | undefined;
const keep = process.argv.includes("--serve");
try {
  const password = randomUUID();
  const envFile = join(root, "postgres.env");
  await writeFile(envFile, `POSTGRES_PASSWORD=${password}\nPOSTGRES_DB=dynamic_app_test\n`, { mode: 0o600 });
  for (const [image, port, extra] of [
    ["postgres:17-alpine", "5432", ["--env-file", envFile]],
    ["redis:7-alpine", "6379", []],
  ] as const) {
    const name = `linksense-dynamic-${randomUUID()}`;
    await docker("run", "--rm", "-d", "--name", name, "--label", "com.linksense.test.disposable=true", "-p", `127.0.0.1::${port}`, ...extra, image);
    containers.push(name);
  }
  const [pg, cache] = containers;
  assert(pg && cache);
  for (let attempt = 0; ; attempt++) {
    try { await docker("exec", pg, "pg_isready", "-U", "postgres"); break; }
    catch (error) { if (attempt === 60) throw error; await delay(100); }
  }
  const pgPort = Number((await docker("port", pg, "5432")).split(":").at(-1));
  const redisPort = Number((await docker("port", cache, "6379")).split(":").at(-1));
  const databaseUrl = `postgresql://postgres:${password}@127.0.0.1:${pgPort}/dynamic_app_test`;
  const migrations = join(repo, "prisma/migrations");
  const before = join(root, "before-backends");
  for (const entry of await readdir(migrations)) {
    if (entry < "20261115000000_add_web_site_backends" || entry === "migration_lock.toml") await cp(join(migrations, entry), join(before, entry), { recursive: true });
  }
  const migrate = async (directory: string) => execute("pnpm", ["exec", "prisma", "migrate", "deploy", "--config", "apps/api/test/integration/prisma.config.ts"], {
    cwd: repo, timeout: 120_000, maxBuffer: 4_000_000,
    env: { ...process.env, DATABASE_URL: databaseUrl, LINKSENSE_TEST_MIGRATIONS_PATH: directory },
  });
  await migrate(before);
  db = createPrismaClient(databaseUrl);
  const owner = await db.user.create({ data: { email: "publisher@example.test", name: "Publisher", role: "admin", status: "active" } });
  const other = await db.user.create({ data: { email: "other@example.test", name: "Other", role: "user", status: "active" } });
  const task = await db.conversation.create({ data: { ownerId: owner.id, title: "Dynamic application", titleSource: "manual", archiveStatus: "active", workspaceRelPath: `${owner.id}/home/workspace`, runtimeGeneration: randomUUID(), codexThreadId: "dynamic-test" } });
  const legacyHtml = Buffer.from("<!doctype html><title>Existing static site</title><p>Preserved</p>");
  const legacyFile = await db.conversationFile.create({ data: { conversationId: task.id, kind: "artifact", source: "agent_generated", status: "registered", filename: "old.html", mimeType: "text/html", sizeBytes: legacyHtml.length, storageBackend: "minio", minioObjectKey: "legacy/index.html", downloadable: true, downloadCardEventId: randomUUID() } });
  const oldSite = randomUUID(), oldRelease = randomUUID();
  const manifest = { entry_path: "index.html", files: [{ path: "index.html", object_key: "legacy/index.html", mime_type: "text/html", size_bytes: legacyHtml.length, checksum_sha256: sha256(legacyHtml) }] };
  await db.$executeRaw`INSERT INTO web_sites (id, owner_id, conversation_id, source_task_title, origin_file_id, source_file_id, name, slug, status, current_release_id, updated_at) VALUES (${oldSite}::uuid, ${owner.id}::uuid, ${task.id}::uuid, 'Legacy', ${legacyFile.id}::uuid, ${legacyFile.id}::uuid, 'Legacy', 'legacy-dynamic-upgrade', 'published', ${oldRelease}::uuid, CURRENT_TIMESTAMP)`;
  await db.$executeRaw`INSERT INTO web_site_addresses (slug,site_id) VALUES ('legacy-dynamic-upgrade', ${oldSite}::uuid)`;
  await db.$executeRaw`INSERT INTO web_site_releases (id,site_id,source_file_id,manifest_json) VALUES (${oldRelease}::uuid,${oldSite}::uuid,${legacyFile.id}::uuid,${JSON.stringify(manifest)}::jsonb)`;
  const oldRecord = await db.$queryRaw`SELECT to_jsonb(s) AS row FROM web_sites s WHERE id=${oldSite}::uuid`;
  await migrate(migrations);
  assert.deepEqual(await db.$queryRaw`SELECT to_jsonb(s)-'backend_id' AS row FROM web_sites s WHERE id=${oldSite}::uuid`, oldRecord);
  const config = testConfig({
    LINKSENSE_EDITION: "core", LINKSENSE_OBJECT_STORAGE_PROVIDER: "local-filesystem",
    DATABASE_URL: databaseUrl, REDIS_URL: `redis://127.0.0.1:${redisPort}`,
    LINKSENSE_PUBLIC_BASE_URL: "http://localhost:19563", LINKSENSE_DYNAMIC_APPS_BASE_URL: "http://apps.localhost:19563",
    LINKSENSE_APPWRITE_ENDPOINT: credentials.endpoint, LINKSENSE_APPWRITE_ADMIN_EMAIL: credentials.email,
    LINKSENSE_APPWRITE_ADMIN_PASSWORD: credentials.password, LINKSENSE_USER_DATA_ROOT: join(root, "users"),
  });
  await mkdir(config.userDataRoot, { recursive: true });
  redis = new LinkSenseRedis(config); await redis.connect();
  const storage = createObjectStorage(config); await storage.ensureBucket(); await storage.putObject("legacy/index.html", legacyHtml);
  services = createServices({ config, prisma: db, redis, runner: new RunnerClient(config), storage });
  await db.systemSetting.create({ data: { settingsJson: { system_initialized: true } } });
  app = await buildApi(services);
  assert.equal((await app.inject("/web/legacy-dynamic-upgrade")).statusCode, 200);
  assert.match((await app.inject(`/web/legacy-dynamic-upgrade/_releases/${oldRelease}/index.html`)).body, /Existing static site.*Preserved/su);
  console.log("PASS: upgrade preserves pre-change static records, links and assets.");

  // A persisted pre-sandbox reservation must keep the native origin throughout recovery.
  const legacyBackendId = randomUUID();
  await db.webSiteBackend.create({ data: { id: legacyBackendId, ownerId: owner.id,
    conversationId: task.id, name: "Appointments", projectId: `ls-${legacyBackendId.replaceAll("-", "")}`,
    hostLabel: legacyBackendId.replaceAll("-", "").slice(0, 12), hostResolved: true, runtimeMode: null } });
  await db.webSiteBackendAddress.create({ data: { label: legacyBackendId.replaceAll("-", "").slice(0, 12), backendId: legacyBackendId } });
  const backend = await services.webSiteBackends.prepare(owner.id, task.id, "Appointments", legacyBackendId);
  assert.equal((await services.webSiteBackends.prepare(owner.id, task.id, "Appointments")).id, backend.id);
  await assert.rejects(services.webSiteBackends.inspect(other.id, backend.id));
  const change = (input: unknown) => {
    const parsed = webSiteBackendConfigureSchema.parse({ backend_id: backend.id, change: input });
    return services!.webSiteBackends.configure(owner.id, backend.id, parsed.change);
  };
  await change({ action: "create_table", id: "appointments", name: "Appointments", client_create: false,
    columns: [{ key: "slot", type: "string", size: 100, required: true }, { key: "approved", type: "boolean", required: true }],
    indexes: [{ key: "one_per_slot", type: "unique", columns: ["slot"] }] });
  const visitors = [];
  for (const name of ["visitor-a", "visitor-b", "approver"]) {
    const headers = { "content-type": "application/json", "x-appwrite-project": backend.project_id };
    const email = `${name}-${randomUUID()}@example.test`, password = `${randomUUID()}aA1!`, userId = randomUUID();
    let response = await fetch(`${credentials.endpoint}/account`, { method: "POST", headers, body: JSON.stringify({ userId, email, password }) });
    assert.equal(response.status, 201, "visitor registration");
    response = await fetch(`${credentials.endpoint}/account/sessions/email`, { method: "POST", headers, body: JSON.stringify({ email, password }) });
    assert.equal(response.status, 201, "visitor login");
    const cookie = response.headers.getSetCookie().find(value => value.startsWith(`a_session_${backend.project_id}=`))?.split(";")[0];
    assert(cookie);
    visitors.push({ id: userId, cookie, email, password });
    await response.body?.cancel();
  }
  const [first, second, approver] = visitors;
  assert(first && second && approver);
  const source = join(root, "function");
  await mkdir(source);
  await writeFile(join(source, "package.json"), '{"type":"module"}');
  await writeFile(join(source, "main.js"), `export default async ({ req, res }) => {
    let stage = "account";
    try {
    const endpoint = process.env.APPWRITE_FUNCTION_API_ENDPOINT;
    const project = process.env.APPWRITE_FUNCTION_PROJECT_ID;
    const jwt = req.headers["x-appwrite-user-jwt"];
    if (!jwt) return res.json({ error: "authentication_required" }, 401);
    const account = await fetch(endpoint + "/account", { headers: { "x-appwrite-project": project, "x-appwrite-jwt": jwt } });
    if (!account.ok) return res.json({ error: "authentication_required" }, 401);
    const user = await account.json();
    stage = "body";
    const input = req.bodyJson;
    const headers = { "content-type": "application/json", "x-appwrite-project": project, "x-appwrite-key": req.headers["x-appwrite-key"] };
    let response;
    stage = "data";
    if (input.operation === "approve") {
      if (user.$id !== ${JSON.stringify(approver.id)}) return res.json({ error: "forbidden" }, 403);
      if (typeof input.row_id !== "string" || !/^[a-zA-Z0-9-]{1,36}$/.test(input.row_id)) return res.json({ error: "invalid_row" }, 400);
      response = await fetch(endpoint + "/tablesdb/app/tables/appointments/rows/" + input.row_id, { method: "PATCH", headers, body: JSON.stringify({ data: { approved: true } }) });
    } else {
      if (typeof input.slot !== "string" || !input.slot.length || input.slot.length > 100) return res.json({ error: "invalid_slot" }, 400);
      response = await fetch(endpoint + "/tablesdb/app/tables/appointments/rows", { method: "POST", headers, body: JSON.stringify({ rowId: "unique()", data: { slot: input.slot, approved: false }, permissions: ['read("user:' + user.$id + '")'] }) });
    }
    if (!response.ok) return res.json({ error: "request_rejected" }, response.status);
    return res.json(await response.json());
    } catch (error) { return res.json({ stage, error: error.name }, 500); }
  };`);
  const archive = join(root, "code.tar.gz");
  await execute("tar", ["-czf", archive, "-C", source, "main.js", "package.json"], { env: { ...process.env, COPYFILE_DISABLE: "1" } });
  const code = await readFile(archive), objectKey = `dynamic-test/${randomUUID()}.tar.gz`;
  await storage.putObject(objectKey, code);
  const codeFile = await db.conversationFile.create({ data: { conversationId: task.id, kind: "artifact", source: "agent_generated", status: "registered", filename: "code.tar.gz", mimeType: "application/gzip", sizeBytes: code.length, storageBackend: "minio", minioObjectKey: objectKey, checksumSha256: sha256(code), downloadable: true, downloadCardEventId: randomUUID() } });
  await change({ action: "create_function", id: "appointments", name: "Appointments", entrypoint: "main.js", scopes: ["rows.read", "rows.write"] });
  const deployment = z.object({ $id: z.string() }).parse(await change({ action: "deploy_function", function_id: "appointments", file_id: codeFile.id }));
  for (let attempt = 0; ; attempt++) {
    const state = await change({ action: "inspect", path: `/functions/appointments/deployments/${deployment.$id}` });
    if (state.status === "ready") break;
    assert.notEqual(state.status, "failed", "native function build failed");
    assert(attempt < 600, "native function build timed out");
    await delay(500);
  }
  await change({ action: "activate_function", function_id: "appointments", deployment_id: deployment.$id });
  await services.webSiteBackends.assertPublishable(owner.id, backend.id);
  const frontendKey = `dynamic-test/${randomUUID()}.html`;
  const frontend = Buffer.from('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Appointments</title><main><h1>Appointments</h1><p id="state">Checking session</p><form id="login"><label>Email <input name="email" type="email" autocomplete="username" required></label><label>Password <input name="password" type="password" autocomplete="current-password" required></label><button>Sign in</button></form><form id="book"><label>Slot <input name="slot" required></label><button>Book</button></form><pre id="result"></pre></main><script>const base="/appwrite/v1";async function session(){const r=await fetch(base+"/account");document.querySelector("#state").textContent=r.ok?"Signed in":"Signed out"}session();document.querySelector("#login").onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target);await fetch(base+"/account/sessions/email",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(Object.fromEntries(f))});await session()};document.querySelector("#book").onsubmit=async e=>{e.preventDefault();const r=await fetch(base+"/functions/appointments/executions",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({body:JSON.stringify({slot:new FormData(e.target).get("slot")}),async:false})});document.querySelector("#result").textContent=JSON.stringify(await r.json(),null,2)};</script></html>');
  await storage.putObject(frontendKey, frontend);
  const file = await db.conversationFile.create({ data: { conversationId: task.id, kind: "artifact", source: "agent_generated", status: "registered", filename: "appointments.html", mimeType: "text/html", sizeBytes: frontend.length, storageBackend: "minio", minioObjectKey: frontendKey, checksumSha256: sha256(frontend), downloadable: true, downloadCardEventId: randomUUID() } });
  const publication = { conversation_id: task.id, file_id: file.id, name: "Appointments", description: "", backend_id: backend.id };
  await db.webSiteBackend.update({ where: { id: backend.id }, data: { leaseUntil: new Date(Date.now() + 60_000) } });
  await assert.rejects(services.webSites.create(owner.id, publication), { code: "WEB_SITE_BACKEND_PENDING" });
  await db.webSiteBackend.update({ where: { id: backend.id }, data: { leaseUntil: new Date(Date.now() - 60_000) } });
  const site = await services.webSites.create(owner.id, publication);
  console.log("PASS: active configuration leases block publication; expired leases allow recovery.");
  const headers = (visitor = first) => ({ host: new URL(backend.origin).host, cookie: visitor.cookie });
  const appwriteConfig = config.appwrite;
  assert(appwriteConfig);
  const httpBaseUrl = appwriteConfig.appsBaseUrl;
  assert(httpBaseUrl);
  appwriteConfig.appsBaseUrl = httpBaseUrl.replace(/^http:/u, "https:");
  try {
    const host = new URL(backend.origin).host;
    const login = await app.inject({
      method: "POST", url: "/appwrite/v1/account/sessions/email", headers: { host },
      payload: { email: first.email, password: first.password },
    });
    assert.equal(login.statusCode, 201, "HTTPS visitor login through the gateway");
    const cookies = login.headers["set-cookie"];
    assert(Array.isArray(cookies) && cookies.length > 0);
    assert(cookies.every(cookie => cookie.startsWith("__Host-") && cookie.includes("; Secure") && !cookie.includes("Domain=")));
    const cookie = cookies.map(value => value.split(";")[0]).join("; ");
    assert.equal((await app.inject({ url: "/appwrite/v1/account", headers: { host, cookie } })).statusCode, 200);
    assert.equal((await app.inject({ url: "/appwrite/v1/account", headers: { host, cookie: first.cookie } })).statusCode, 401);
    const logout = await app.inject({ method: "DELETE", url: "/appwrite/v1/account/sessions/current", headers: { host, cookie } });
    assert.equal(logout.statusCode, 204);
    assert.equal((await app.inject({ url: "/appwrite/v1/account", headers: { host, cookie } })).statusCode, 401);
  } finally { appwriteConfig.appsBaseUrl = httpBaseUrl; }
  console.log("PASS: HTTPS session names round-trip through Appwrite; raw parent-domain cookies are ignored.");
  const run = async (visitor: typeof first, input: unknown) => {
    const response = await app!.inject({ method: "POST", url: "/appwrite/v1/functions/appointments/executions", headers: headers(visitor), payload: { body: JSON.stringify(input), async: false } });
    assert.equal(response.statusCode, 201, "native execution endpoint");
    return z.object({ responseStatusCode: z.number(), responseBody: z.string() }).parse(response.json());
  };
  const results = await Promise.all([run(first, { slot: "09:00" }), run(second, { slot: "09:00" })]);
  assert.deepEqual(results.map(result => result.responseStatusCode).sort(), [200, 409], JSON.stringify(results.map(result => result.responseBody)));
  const winner = results[0]?.responseStatusCode === 200 ? first : second, loser = winner === first ? second : first;
  const booking = z.object({ $id: z.string(), approved: z.literal(false) }).parse(JSON.parse(results.find(result => result.responseStatusCode === 200)!.responseBody));
  const rowPath = `/appwrite/v1/tablesdb/app/tables/appointments/rows/${booking.$id}`;
  assert.equal((await app.inject({ url: rowPath, headers: headers(winner) })).statusCode, 200);
  assert.equal((await app.inject({ url: rowPath, headers: headers(loser) })).statusCode, 404);
  assert.equal((await run(winner, { operation: "approve", row_id: booking.$id })).responseStatusCode, 403);
  assert.equal((await run(approver, { operation: "approve", row_id: booking.$id })).responseStatusCode, 200);
  assert.equal((await app.inject({ url: rowPath, headers: headers(winner) })).json().approved, true);
  assert.equal((await app.inject({ method: "POST", url: "/appwrite/v1/tablesdb/app/tables/appointments/rows", headers: headers(winner), payload: { rowId: "unique()", data: { slot: "forged", approved: true } } })).statusCode, 401);
  console.log("PASS: real visitor sessions, private records, concurrent uniqueness and privileged approval functions.");
  await change({ action: "create_bucket", id: "uploads", name: "Uploads", extensions: ["txt"] });
  const upload = new FormData();
  upload.set("fileId", "unique()");
  upload.set("file", new Blob(["private visitor file"], { type: "text/plain" }), "note.txt");
  upload.set("permissions[0]", `read("user:${first.id}")`);
  const uploadRequest = new Request("https://upload.example.test", { method: "POST", body: upload });
  const uploaded = await app.inject({
    method: "POST", url: "/appwrite/v1/storage/buckets/uploads/files",
    headers: { ...headers(first), "content-type": uploadRequest.headers.get("content-type")! },
    payload: Buffer.from(await uploadRequest.arrayBuffer()),
  });
  assert.equal(uploaded.statusCode, 201, "private file upload");
  const uploadId = z.object({ $id: z.string() }).parse(uploaded.json()).$id;
  const uploadPath = `/appwrite/v1/storage/buckets/uploads/files/${uploadId}/view`;
  assert.equal((await app.inject({ url: uploadPath, headers: headers(first) })).body, "private visitor file");
  assert([401, 403, 404].includes((await app.inject({ url: uploadPath, headers: headers(second) })).statusCode));
  console.log("PASS: real file upload, persistence and per-visitor download permissions.");
  const secondFrontendKey = `dynamic-test/${randomUUID()}.html`;
  const secondFrontend = Buffer.from(frontend.toString().replace("<h1>Appointments</h1>", "<h1>Appointments v2</h1>"));
  await storage.putObject(secondFrontendKey, secondFrontend);
  const nextFile = await db.conversationFile.create({ data: { conversationId: task.id, kind: "artifact", source: "agent_generated", status: "registered", filename: "appointments-v2.html", mimeType: "text/html", sizeBytes: secondFrontend.length, storageBackend: "minio", minioObjectKey: secondFrontendKey, checksumSha256: sha256(secondFrontend), downloadable: true, downloadCardEventId: randomUUID() } });
  const updated = await services.webSites.publish(owner.id, site.id, nextFile.id);
  assert.equal(updated.url, site.url);
  assert.match((await app.inject({ url: "/", headers: headers(winner) })).body, /Appointments v2/u);
  assert.equal((await app.inject({ url: rowPath, headers: headers(winner) })).json().approved, true);
  await services.webSites.update(owner.id, site.id, { status: "disabled" });
  for (const url of ["/", "/appwrite/v1/account", rowPath, uploadPath]) assert.equal((await app.inject({ url, headers: headers(winner) })).statusCode, 404);
  await services.webSites.update(owner.id, site.id, { status: "published" });
  assert.equal((await app.inject({ url: rowPath, headers: headers(winner) })).json().approved, true);
  await db.user.update({ where: { id: owner.id }, data: { status: "disabled" } });
  assert.equal((await app.inject({ url: rowPath, headers: headers(winner) })).statusCode, 404);
  await db.user.update({ where: { id: owner.id }, data: { status: "active" } });
  console.log("PASS: updates retain URLs/accounts/data; disabling and owner suspension fence existing sessions.");
  const hosted = await services.webSiteBackends.prepare(owner.id, task.id, "Sandbox accounts");
  assert.equal(hosted.runtime_mode, "sandbox");
  await services.webSiteBackends.configure(owner.id, hosted.id, webSiteBackendConfigureSchema.parse({
    backend_id: hosted.id, change: { action: "create_table", id: "notes", name: "Notes",
      columns: [{ key: "text", type: "string", size: 100 }] },
  }).change);
  await services.webSiteBackends.configure(owner.id, hosted.id, webSiteBackendConfigureSchema.parse({
    backend_id: hosted.id, change: { action: "create_bucket", id: "uploads", name: "Uploads",
      extensions: ["txt"], maximum_file_size: 20 * 1024 * 1024 },
  }).change);
  const hostedHtml = Buffer.from(`<!doctype html><html><meta charset="utf-8"><title>Sandbox</title><script src="${hosted.sdk_url}"></script><p>Sandbox SDK integration</p></html>`);
  const hostedKey = `dynamic-test/${randomUUID()}.html`;
  await storage.putObject(hostedKey, hostedHtml);
  const hostedFile = await db.conversationFile.create({ data: { conversationId: task.id, kind: "artifact",
    source: "agent_generated", status: "registered", filename: "sandbox.html", mimeType: "text/html",
    sizeBytes: hostedHtml.length, storageBackend: "minio", minioObjectKey: hostedKey,
    checksumSha256: sha256(hostedHtml), downloadable: true, downloadCardEventId: randomUUID() } });
  const hostedSite = await services.webSites.create(owner.id, {
    conversation_id: task.id, file_id: hostedFile.id, name: "Sandbox accounts", description: "", backend_id: hosted.id,
  });
  assert.equal(hostedSite.url, `${config.publicBaseUrl}/app/s/${hostedSite.id}`);
  const hostedUrl = new URL(hostedSite.url!), hostedRpc = `${hostedUrl.pathname}/_rpc`;
  const hostedAccess = async (cookie?: string) => {
    const shell = await app!.inject({ url: hostedUrl.pathname, headers: { host: hostedUrl.host, ...(cookie ? { cookie } : {}) } });
    assert.equal(shell.statusCode, 200);
    const packet = z.object({ capability: z.string() }).parse(JSON.parse(/id="app-config">(.*?)<\/script>/u.exec(shell.body)![1]!));
    const browserCookie = cookie ?? z.array(z.string()).parse(shell.headers["set-cookie"])[0]!.split(";")[0]!;
    return { cookie: browserCookie, capability: packet.capability };
  };
  const hostedRequest = (access: Awaited<ReturnType<typeof hostedAccess>>, path: string, method = "GET", body?: unknown) =>
    app!.inject({ method: "POST", url: hostedRpc, headers: { host: hostedUrl.host, origin: hostedUrl.origin,
      cookie: access.cookie, "x-linksense-app-capability": access.capability },
      payload: { path, method, ...(body !== undefined ? { body } : {}) } });
  const hostedVisitor = await hostedAccess();
  const hostedEmail = `${randomUUID()}@example.test`, hostedPassword = `${randomUUID()}aA1!`;
  assert.equal((await hostedRequest(hostedVisitor, "/account", "POST", { userId: randomUUID(), email: hostedEmail, password: hostedPassword })).statusCode, 201);
  const hostedLogin = await hostedRequest(hostedVisitor, "/account/sessions/email", "POST", { email: hostedEmail, password: hostedPassword });
  assert.equal(hostedLogin.statusCode, 201);
  assert(!Object.hasOwn(hostedLogin.json(), "secret"));
  assert.equal(hostedLogin.headers["set-cookie"], undefined);
  const hostedAccount = z.object({ $id: z.string() }).parse((await hostedRequest(hostedVisitor, "/account")).json());
  const hostedNote = await hostedRequest(hostedVisitor, "/tablesdb/app/tables/notes/rows", "POST",
    { rowId: "unique()", data: { text: "persisted" }, permissions: [`read("user:${hostedAccount.$id}")`] });
  assert.equal(hostedNote.statusCode, 201);
  const hostedNoteId = z.object({ $id: z.string() }).parse(hostedNote.json()).$id;
  assert.equal((await hostedRequest(await hostedAccess(hostedVisitor.cookie), `/tablesdb/app/tables/notes/rows/${hostedNoteId}`)).statusCode, 200);
  const hostedOther = await hostedAccess();
  assert.equal((await hostedRequest(hostedOther, "/account/sessions/anonymous", "POST", {})).statusCode, 201);
  assert.equal((await hostedRequest(hostedOther, `/tablesdb/app/tables/notes/rows/${hostedNoteId}`)).statusCode, 404);
  const hostedUpload = await app.inject({ method: "POST", url: `${hostedRpc}/upload/uploads/unique()`,
    headers: { host: hostedUrl.host, origin: hostedUrl.origin, cookie: hostedVisitor.cookie,
      "x-linksense-app-capability": hostedVisitor.capability, "x-linksense-file-name": "large.txt",
      "x-linksense-file-type": "text/plain", "content-type": "application/octet-stream" },
    payload: Buffer.alloc(6 * 1024 * 1024, "x") });
  assert.equal(hostedUpload.statusCode, 201);
  const hostedFileId = z.object({ $id: z.string() }).parse(hostedUpload.json()).$id;
  assert.equal((await hostedRequest(hostedVisitor, `/storage/buckets/uploads/files/${hostedFileId}/download`)).rawPayload.length, 6 * 1024 * 1024);
  assert([401, 403, 404].includes((await hostedRequest(hostedOther, `/storage/buckets/uploads/files/${hostedFileId}/download`)).statusCode));
  assert.equal((await hostedRequest(hostedVisitor, "/account/sessions/current", "DELETE")).statusCode, 204);
  assert.equal((await hostedRequest(hostedVisitor, "/account")).statusCode, 401);
  assert.equal((await app.inject({ url: rowPath, headers: headers(winner) })).json().approved, true);
  await services.webSites.update(owner.id, hostedSite.id, { status: "disabled" });
  assert.equal((await hostedRequest(hostedOther, "/account")).statusCode, 404);
  console.log("PASS: sandbox registration/login, server-held session, reload, private rows/files, chunked uploads, logout, revocation and legacy coexistence.");
  if (keep) {
    await app.listen({ host: "127.0.0.1", port: 19563 });
    await writeFile(join(root, "browser-fixture.json"), JSON.stringify({ url: backend.origin, visitors }), { mode: 0o600 });
    console.log(`Browser fixture: ${root}/browser-fixture.json`);
    await new Promise<void>(resolve => { process.once("SIGINT", resolve); process.once("SIGTERM", resolve); });
  }
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
  for (const name of containers.reverse()) await docker("rm", "-f", name).catch(() => {});
  await rm(root, { recursive: true, force: true });
}
