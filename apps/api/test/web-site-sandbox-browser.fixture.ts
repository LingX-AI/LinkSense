import Fastify from "fastify";
import { randomUUID } from "node:crypto";
import { createServer } from "node:net";
import type { WebSiteBackend } from "../src/generated/prisma/client.js";
import { LocalFilesystemObjectStorage } from "../src/adapters/object-storage.js";
import { AppError, normalizeError } from "../src/lib/errors.js";
import { publishedResourcePolicy } from "../src/modules/web-sites/routes.js";
import type { WebSiteBackendStore } from "../src/modules/web-site-backends/repository.js";
import { WebSiteBackendService } from "../src/modules/web-site-backends/service.js";
import { registerPublicAppGateway } from "../src/modules/web-site-backends/sandbox-gateway.js";
import { WebSiteVisitorSessions } from "../src/modules/web-site-backends/visitor-sessions.js";
import { testConfig } from "./test-config.js";

/** Real gateway, SDK and CSP; only persistence and the upstream Appwrite API are fixtures. */
export async function createSandboxBrowserFixture() {
  const listener = createServer();
  await new Promise<void>(resolve => listener.listen(0, "127.0.0.1", resolve));
  const address = listener.address();
  if (!address || typeof address === "string") throw new Error("Missing fixture address");
  const port = address.port;
  await new Promise<void>((resolve, reject) => listener.close(error => error ? reject(error) : resolve()));
  const origin = `http://127.0.0.1:${port}`;
  const config = testConfig({ LINKSENSE_EDITION: "core", LINKSENSE_OBJECT_STORAGE_PROVIDER: "local-filesystem",
    LINKSENSE_PUBLIC_BASE_URL: origin, LINKSENSE_APPWRITE_ENDPOINT: "http://backend.internal/v1",
    LINKSENSE_APPWRITE_ADMIN_EMAIL: "operator@example.test", LINKSENSE_APPWRITE_ADMIN_PASSWORD: "fixture-password" });
  const rows: WebSiteBackend[] = ["alpha", "beta"].map((name, index) => ({
    id: `60000000-0000-4000-8000-00000000000${index + 1}`, name, hostLabel: name,
    ownerId: "10000000-0000-4000-8000-000000000001", conversationId: "20000000-0000-4000-8000-000000000001",
    projectId: `ls-${name}`, runtimeMode: "sandbox", status: "ready", hostResolved: true,
    encryptedCredential: null, leaseUntil: null, createdAt: new Date(), updatedAt: new Date(),
  }));
  const disabled = new Set<string>(), values = new Map<string, string>(), sessions = new Map<string, string>();
  const data = new Map<string, unknown[]>(), files = new Map<string, Blob>();
  const find = (id: string) => { const row = rows.find(item => item.id === id); if (!row) throw new AppError("WEB_SITE_NOT_FOUND"); return row; };
  const store: WebSiteBackendStore = {
    reserve: async () => rows[0]!, owned: async (_owner, id) => find(id), findById: async id => find(id),
    findByHostLabel: async label => { const row = rows.find(item => item.hostLabel === label); return row ? { id: row.id } : null; },
    byHostLabel: async label => { const row = rows.find(item => item.hostLabel === label); return row ? { id: row.id } : null; },
    setHostLabel: async () => {}, acquire: async () => {}, finish: async () => {},
    publicBinding: async id => {
      const backend = find(id);
      if (disabled.has(backend.name)) throw new AppError("WEB_SITE_NOT_FOUND");
      return { backend, siteId: `40000000-0000-4000-8000-00000000000${rows.indexOf(backend) + 1}` };
    },
    source: async () => { throw new Error("Unused fixture operation"); },
  };
  const backends = new WebSiteBackendService(store, new LocalFilesystemObjectStorage(config), config, async (input, init) => {
    const url = new URL(String(input)), headers = new Headers(init?.headers), project = headers.get("x-appwrite-project")!;
    const cookie = headers.get("cookie") ?? "";
    const visitor = sessions.get(`${project}:${cookie}`);
    const path = url.pathname.slice("/v1".length), method = init?.method ?? "GET";
    if (path === "/account" && method === "POST") return Response.json({ $id: "registered" }, { status: 201 });
    if (/^\/account\/sessions\/(?:anonymous|email)$/u.test(path)) {
      const token = randomUUID(), id = `${project}-${token.slice(0, 8)}`;
      sessions.set(`${project}:a_session_${project}=${token}`, id);
      return Response.json({ $id: id, secret: "must-stay-server-side" }, {
        status: 201, headers: { "set-cookie": `a_session_${project}=${token}; Path=/; HttpOnly` },
      });
    }
    if (!visitor) return Response.json({ message: "Authentication required" }, { status: 401 });
    if (path === "/account/sessions/current" && method === "DELETE") {
      sessions.delete(`${project}:${cookie}`); return new Response(null, { status: 204 });
    }
    if (path === "/account") return Response.json({ $id: visitor, name: project });
    if (path.endsWith("/executions")) return Response.json({ responseStatusCode: 200, responseBody: JSON.stringify({ project, visitor }) });
    if (path.endsWith("/files") && init?.body instanceof FormData) {
      files.set(`${project}:${visitor}`, init.body.get("file") as Blob);
      return Response.json({ $id: "file" }, { status: 201 });
    }
    if (path.endsWith("/download")) return new Response(files.get(`${project}:${visitor}`) ?? "missing");
    const key = `${project}:${visitor}`;
    if (method === "POST") {
      const item = JSON.parse(String(init?.body)) as { data: unknown };
      data.set(key, [...(data.get(key) ?? []), item.data]); return Response.json(item.data, { status: 201 });
    }
    return Response.json({ rows: data.get(key) ?? [] });
  });
  const sessionStore = new WebSiteVisitorSessions({
    get: async key => values.get(key) ?? null,
    eval: async (script, _keys, key, ...args) => {
      if (script.includes("INCR")) return 1;
      if ((values.get(key) ?? "") !== args[0]) return 0;
      values.set(key, String(args[1])); return 1;
    },
  }, config);
  const app = Fastify();
  registerPublicAppGateway(app, backends, {
    applicationEntry: async (_owner, id) => {
      const row = rows.find((_item, index) => id === `40000000-0000-4000-8000-00000000000${index + 1}`);
      if (!row) throw new AppError("WEB_SITE_NOT_FOUND");
      const releasePath = `/web/${row.name}/_releases/40000000-0000-4000-8000-000000000001/`;
      return { title: row.name, path: `${releasePath}index.html`, releasePath };
    },
  }, sessionStore, config);
  app.setErrorHandler((error, _request, reply) => {
    const value = normalizeError(error);
    return reply.code(value.code === "AUTH_REQUIRED" ? 401 : value.code === "FORBIDDEN" ? 403 : 404).send({ error_code: value.code });
  });
  // Simulate the existing immutable public-resource endpoint with its real security policy.
  app.get("/web/:name/_releases/:id/index.html", async (_request, reply) => reply
    .header("access-control-allow-origin", "*").header("content-security-policy", publishedResourcePolicy(origin))
    .type("text/html").send(`<!doctype html><html lang="en"><meta charset="utf-8"><title>Sandbox fixture</title>
<script src="${origin}/app/_sdk/v1.js"></script><body><h1>Public app fixture</h1><p id="status">Loading</p><a href="index.html">Next page</a>
<a href="/web/beta/_releases/40000000-0000-4000-8000-000000000001/index.html" data-other-release>Other application release</a>
<form id="login-form"><button id="login" type="submit">Anonymous login</button></form><button id="get">Current visitor</button>
<button id="create">Create row</button><button id="list">Load rows</button>
<button id="upload">Upload file</button><button id="download">Download file</button>
<button id="upload-json">Upload JSON file</button>
<button id="execute">Run function</button><button id="logout">Logout</button><pre id="result"></pre>
<script>
const result = document.getElementById("result");
const actions = {
login: () => LinkSenseApp.account.anonymous(), get: () => LinkSenseApp.account.get(),
create: () => LinkSenseApp.tables.create("notes", { text: "saved-note" }),
list: () => LinkSenseApp.tables.list("notes"),
upload: () => LinkSenseApp.storage.upload("uploads", new File(["file-content"], "sample.txt", {type:"text/plain"})),
"upload-json": () => LinkSenseApp.storage.upload("uploads", new File([' { "a": 1 } '], "sample.json", {type:"application/json"})),
download: async () => ({text: await (await LinkSenseApp.storage.download("uploads", "file")).text()}),
execute: () => LinkSenseApp.functions.execute("business"),
logout: () => LinkSenseApp.account.logout()
};
for (const [name, action] of Object.entries(actions)) {
  const handler = async (event) => {
    event.preventDefault();
    try { result.textContent = JSON.stringify(await action()) || "done"; } catch (error) { result.textContent = error.code || error.message; }
  };
  if (name === "login") document.getElementById("login-form").onsubmit = handler;
  else document.getElementById(name).onclick = handler;
}
LinkSenseApp.ready().then(() => { document.getElementById("status").textContent = "Ready"; })
.catch(error => { document.getElementById("status").textContent = error.message; });
</script></body></html>`));
  await app.listen({ host: "127.0.0.1", port });
  return { app, origin, disable: (name: string) => { disabled.add(name); } };
}
if (process.argv.includes("--serve")) {
  const fixture = await createSandboxBrowserFixture();
  console.log(`Sandbox browser fixture: ${fixture.origin}/app/alpha`);
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => {
    void fixture.app.close().then(() => process.exit(0)).catch(() => process.exit(1));
  });
}
