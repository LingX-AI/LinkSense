import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerPublicAppGateway } from "../src/modules/web-site-backends/sandbox-gateway.js";
import { registerWebSiteBackendGateway } from "../src/modules/web-site-backends/gateway.js";
import { WebSiteVisitorSessions } from "../src/modules/web-site-backends/visitor-sessions.js";
import { AppError, normalizeError } from "../src/lib/errors.js";
import { backendFixture, backendId } from "./web-site-backends.fixture.js";
import { ownerId, taskId, siteId } from "./web-sites.fixture.js";
import { testConfig } from "./test-config.js";

function visitorRedisFixture() {
  const values = new Map<string, string>();
  const redis = {
    get: vi.fn(async (key: string) => values.get(key) ?? null),
    eval: vi.fn(async (script: string, _count: number, key: string, ...args: unknown[]) => {
      if (script.includes("INCR")) {
        const count = Number(values.get(key) ?? 0) + 1;
        values.set(key, String(count)); return count;
      }
      if ((values.get(key) ?? "") !== args[0]) return 0;
      values.set(key, String(args[1])); return 1;
    }),
  };
  return { values, redis };
}
const apps: Array<ReturnType<typeof Fastify>> = [];
afterEach(async () => { await Promise.all(apps.splice(0).map(app => app.close())); });
function setup() {
  const fixture = backendFixture();
  fixture.row.runtimeMode = "sandbox";
  const redis = visitorRedisFixture();
  const sessions = new WebSiteVisitorSessions(redis.redis, fixture.config);
  const app = Fastify();
  apps.push(app);
  registerPublicAppGateway(app, fixture.service, fixture.sites, sessions, fixture.config);
  registerWebSiteBackendGateway(app, fixture.service, fixture.sites);
  app.setErrorHandler((error, _request, reply) => {
    const normalized = normalizeError(error);
    return reply.code(normalized.code === "FORBIDDEN" ? 403 : normalized.code === "AUTH_REQUIRED" ? 401
      : normalized.code === "WEB_SITE_NOT_FOUND" ? 404 : normalized.code === "CONFLICT" ? 409 : 400)
      .send({ error_code: normalized.code });
  });
  const host = new URL(fixture.config.publicBaseUrl).host;
  const url = `/app/${fixture.row.hostLabel}`;
  const open = async (cookie?: string) => {
    const response = await app.inject({ url, headers: { host, ...(cookie ? { cookie } : {}) } });
    expect(response.statusCode).toBe(200);
    const match = /<script type="application\/json" id="app-config">(.*?)<\/script>/u.exec(response.body);
    const packet = JSON.parse(match![1]!) as { capability: string; path: string };
    return { response, packet, cookie: cookie ?? String(response.headers["set-cookie"]).split(";")[0]! };
  };
  const rpc = async (access: Awaited<ReturnType<typeof open>>, input: unknown, headers: Record<string, string> = {}) =>
    app.inject({ method: "POST", url: `${url}/_rpc`, payload: JSON.stringify(input),
      headers: { host, cookie: access.cookie, origin: new URL(fixture.config.publicBaseUrl).origin,
        "x-linksense-app-capability": access.packet.capability, "content-type": "application/json", ...headers } });
  return { ...fixture, ...redis, sessions, app, host, url, open, rpc };
}

describe("same-host public dynamic applications", () => {
  it("serves a static application's stable address without preparing a backend or visitor session", async () => {
    const f = setup();
    delete f.site.row.site.backendId;
    const response = await f.app.inject({ url: `/app/s/${siteId}`, headers: { host: f.host } });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain(`src="/web/sample/_releases/${f.site.row.release.id}/index.html"`);
    expect(response.body).not.toContain("allow-same-origin");
    expect(response.headers["set-cookie"]).toBeUndefined();
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["x-robots-tag"]).toBe("noindex, nofollow");
    expect(response.body).toContain('sandbox="allow-scripts allow-modals allow-downloads allow-forms"');
    expect(f.store.publicBinding).not.toHaveBeenCalled();
    expect(f.store.reserve).not.toHaveBeenCalled();
    expect(f.fetcher).not.toHaveBeenCalled();
    expect((await f.app.inject({ url: `/app/id/${siteId}`, headers: { host: f.host } })).statusCode).toBe(404);
    expect((await f.app.inject({ url: `/app/s/${siteId}/_rpc`, method: "POST", headers: { host: f.host } })).statusCode).toBe(404);
  });

  it("serves a static application from its slug address exactly like its stable id address", async () => {
    const f = setup();
    delete f.site.row.site.backendId;
    const stable = await f.app.inject({ url: `/app/s/${siteId}`, headers: { host: f.host } });
    const slug = await f.app.inject({ url: "/app/s/sample", headers: { host: f.host } });
    expect(slug.statusCode).toBe(200);
    expect(slug.body).toBe(stable.body);
    expect(f.site.store.publicSite).toHaveBeenCalledWith("sample");
    expect(f.site.store.publicSiteById).toHaveBeenCalledWith(siteId);
  });

  it("rejects unknown and malformed slug addresses", async () => {
    const f = setup();
    delete f.site.row.site.backendId;
    f.site.store.publicSite.mockRejectedValueOnce(new AppError("WEB_SITE_NOT_FOUND"));
    expect((await f.app.inject({ url: "/app/s/unknown-slug", headers: { host: f.host } })).statusCode).toBe(404);
    expect((await f.app.inject({ url: "/app/s/Bad_Slug", headers: { host: f.host } })).statusCode).toBe(404);
    expect(f.site.store.publicSiteById).not.toHaveBeenCalled();
  });

  it("returns the branded LinkSense 404 page for a missing site address opened as a document", async () => {
    const f = setup();
    delete f.site.row.site.backendId;
    f.site.store.publicSite.mockRejectedValueOnce(new AppError("WEB_SITE_NOT_FOUND"));
    const response = await f.app.inject({
      url: "/app/s/water-reminde",
      headers: { host: f.host, accept: "text/html,application/xhtml+xml", "sec-fetch-dest": "document" },
    });
    expect(response.statusCode).toBe(404);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.headers["content-security-policy"]).toContain("sandbox");
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body).toContain("LinkSense");
    expect(response.body).toContain("404");
    // RPC and non-document requests keep the JSON error.
    const rpc = await f.app.inject({
      url: "/app/s/missing/_rpc", method: "POST", payload: {},
      headers: { host: f.host, accept: "text/html", "content-type": "application/json" },
    });
    expect(rpc.headers["content-type"]).toContain("application/json");
    expect(rpc.body).not.toContain("LinkSense");
  });

  it("keeps a dynamic application's stable address and sessions after renaming its backend alias", async () => {
    const f = setup();
    const stable = `/app/s/${siteId}`;
    const first = await f.app.inject({ url: stable, headers: { host: f.host } });
    expect(first.statusCode).toBe(200);
    const packet = JSON.parse(/id="app-config">(.*?)<\/script>/u.exec(first.body)![1]!) as { capability: string; endpoint: string };
    expect(packet.endpoint).toBe(`${stable}/_rpc`);
    await f.service.prepare(ownerId, taskId, f.row.name, backendId, "renamed-water");
    const alias = await f.app.inject({ url: `${f.url}?view=today`, headers: { host: f.host } });
    expect(alias.statusCode).toBe(302);
    expect(alias.headers.location).toBe(`${stable}?view=today`);
    f.site.store.publicSiteById.mockClear();
    const response = await f.app.inject({ method: "POST", url: `${stable}/_rpc`, payload: { path: "/account", method: "GET" },
      headers: { host: f.host, cookie: String(first.headers["set-cookie"]).split(";")[0]!,
        origin: f.config.publicBaseUrl, "x-linksense-app-capability": packet.capability } });
    expect(response.statusCode).toBe(200);
    expect(f.site.store.publicSiteById).not.toHaveBeenCalled();
    f.disable();
    expect((await f.app.inject({ url: stable, headers: { host: f.host } })).statusCode).toBe(404);
    expect((await f.app.inject({ url: f.url, headers: { host: f.host } })).statusCode).toBe(404);
  });

  it("rejects stable-address requests with a mismatched backend binding, host or embedded destination", async () => {
    const f = setup(), url = `/app/s/${siteId}`;
    expect((await f.app.inject({ url, headers: { host: "evil.example.test" } })).statusCode).toBe(404);
    expect((await f.app.inject({ url, headers: { host: f.host, "sec-fetch-dest": "iframe" } })).statusCode).toBe(403);
    vi.spyOn(f.store, "publicBinding").mockResolvedValueOnce({ backend: f.row, siteId: "40000000-0000-4000-8000-000000000002" });
    expect((await f.app.inject({ url, headers: { host: f.host } })).statusCode).toBe(404);
    expect(f.fetcher).not.toHaveBeenCalled();
  });
  it("requires only Appwrite credentials, while keeping an absent backend disabled", () => {
    expect(testConfig().appwrite).toBeNull();
    const config = testConfig({ LINKSENSE_APPWRITE_ENDPOINT: "http://backend.internal/v1",
      LINKSENSE_APPWRITE_ADMIN_EMAIL: "operator@example.test", LINKSENSE_APPWRITE_ADMIN_PASSWORD: "test-password" });
    expect(config.appwrite?.appsBaseUrl).toBeNull();
  });
  it("prepares sandbox addresses with no public application domain while retaining legacy mode", async () => {
    const f = backendFixture(null);
    f.row.runtimeMode = "sandbox";
    expect((await f.service.inspect(ownerId, backendId)).url).toBe(`${f.config.publicBaseUrl}/app/${f.row.hostLabel}`);
    expect(f.service.matchHost("alpha.example.test")).toBeUndefined();
    expect(f.service.isAppHost("alpha.example.test")).toBe(false);
    f.row.runtimeMode = null;
    await expect(f.service.inspect(ownerId, backendId)).rejects.toMatchObject({ code: "WEB_SITE_BACKEND_NOT_CONFIGURED" });
  });
  it("serves a trusted unembeddable shell, with only opaque untrusted code in its iframe", async () => {
    const f = setup(), access = await f.open();
    expect(access.response.body).toContain('sandbox="allow-scripts allow-downloads allow-forms"');
    expect(access.response.body).not.toContain("allow-same-origin");
    expect(access.response.headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(access.response.headers["content-security-policy"]).toContain("script-src 'sha256-");
    expect(access.packet.path).toContain("/web/");
    expect(access.response.headers["content-security-policy"]).toContain(
      `frame-src ${f.config.publicBaseUrl}${access.packet.path.slice(0, access.packet.path.lastIndexOf("/") + 1)}`,
    );
    expect(access.response.headers["set-cookie"]).toContain("HttpOnly; SameSite=Lax");
    expect((await f.app.inject({ url: f.url, headers: { host: f.host, "sec-fetch-dest": "iframe" } })).statusCode).toBe(403);
    expect((await f.app.inject({ url: f.url, headers: { host: "evil.example.test" } })).statusCode).toBe(404);
    expect(await f.service.inspect(ownerId, backendId)).toMatchObject({
      runtime_mode: "sandbox", url: `${f.config.publicBaseUrl}${f.url}`, sdk_url: `${f.config.publicBaseUrl}/app/_sdk/v1.js`,
    });
  });
  it("keeps visitor sessions encrypted on the server, restores them after reload and strips platform credentials", async () => {
    const f = setup(), access = await f.open();
    f.fetcher.mockResolvedValueOnce(Response.json({ $id: "visitor", secret: "private-session", providerAccessToken: "private-oauth" },
      { status: 201, headers: { "set-cookie": "a_session_ls-test-project=private-session; Path=/" } }));
    const login = await f.rpc(access, { path: "/account/sessions/email", method: "POST",
      body: { email: "visitor@example.test", password: "test-password" } }, { authorization: "Bearer platform-token", "x-appwrite-key": "injected" });
    expect(login.statusCode).toBe(201);
    expect(login.json()).toEqual({ $id: "visitor" });
    expect(login.headers["set-cookie"]).toBeUndefined();
    expect([...f.values.values()].join(" ")).not.toContain("private-session");
    const reloaded = await f.open(access.cookie);
    await f.rpc(reloaded, { path: "/account", method: "GET" });
    const headers = new Headers(f.fetcher.mock.calls.at(-1)?.[1]?.headers);
    expect(headers.get("cookie")).toBe("a_session_ls-test-project=private-session");
    expect(headers.get("x-appwrite-project")).toBe(f.row.projectId);
    expect(headers.has("authorization")).toBe(false);
    expect(headers.has("x-appwrite-key")).toBe(false);
    expect(headers.has("x-appwrite-session")).toBe(false);
    f.fetcher.mockResolvedValueOnce(new Response(null, { status: 204 }));
    expect((await f.rpc(reloaded, { path: "/account/sessions/current", method: "DELETE" })).statusCode).toBe(204);
    await f.rpc(reloaded, { path: "/account", method: "GET" });
    expect(new Headers(f.fetcher.mock.calls.at(-1)?.[1]?.headers).has("cookie")).toBe(false);
  });
  it.each(["null", "https://evil.example.test", ""])("rejects CSRF origin %s before contacting Appwrite", async origin => {
    const f = setup(), access = await f.open();
    expect((await f.rpc(access, { path: "/account", method: "GET" }, { origin })).statusCode).toBe(403);
    expect(f.fetcher).not.toHaveBeenCalled();
  });
  it("rejects missing, forged, other-visitor, other-app and old-site capabilities", async () => {
    const f = setup(), access = await f.open(), other = await f.open();
    for (const capability of ["", "forged", other.packet.capability,
      f.sessions.capability("70000000-0000-4000-8000-000000000001", siteId, access.cookie.split("=")[1]!),
      f.sessions.capability(backendId, "70000000-0000-4000-8000-000000000002", access.cookie.split("=")[1]!)]) {
      expect((await f.rpc(access, { path: "/account", method: "GET" },
        { "x-linksense-app-capability": capability })).statusCode).toBe(403);
    }
    expect(f.fetcher).not.toHaveBeenCalled();
  });
  it("does not serialize an application name as executable shell markup", async () => {
    const f = setup();
    f.site.row.site.name = '</title><script>alert("injected")</script>';
    const access = await f.open();
    expect(access.response.body).not.toContain('</title><script>alert("injected")');
    expect(access.response.body).toContain("&lt;/title&gt;");
  });
  it.each([
    "/project/keys", "/account/jwts", "/account/tokens/email", "/account/sessions",
    "/account?project=another-app", "/account?jwt=secret", "/../account", "/%2e%2e/account",
    "//evil.example.test/account", "/tablesdb/another/tables/data/rows?project=another",
  ])("rejects privileged paths and alternate routing: %s", async path => {
    const f = setup(), access = await f.open();
    expect((await f.rpc(access, { path, method: "POST" })).statusCode).not.toBe(200);
    expect(f.fetcher).not.toHaveBeenCalled();
  });
  it.each([{ project: "another-app" }, { mode: "admin" }])(
    "rejects Appwrite routing overrides in a JSON body: %j", async fields => {
      const f = setup(), access = await f.open();
      expect((await f.rpc(access, { path: "/tablesdb/app/tables/notes/rows", method: "POST",
        body: { rowId: "unique()", data: { text: "a note" }, ...fields } })).statusCode).toBe(403);
      expect(f.fetcher).not.toHaveBeenCalled();
    },
  );
  it("allows reserved field names inside app data and encoded characters in native queries", async () => {
    const f = setup(), access = await f.open();
    const data = { project: "business project", mode: "business mode" };
    expect((await f.rpc(access, { path: "/tablesdb/app/tables/notes/rows", method: "POST",
      body: { rowId: "unique()", data } })).statusCode).toBe(200);
    const query = new URLSearchParams({ "queries[]": JSON.stringify({ method: "search", attribute: "text", values: ["a/b"] }) });
    expect((await f.rpc(access, { path: `/tablesdb/app/tables/notes/rows?${query}`, method: "GET" })).statusCode).toBe(200);
    expect(JSON.parse(String(f.fetcher.mock.calls[0]?.[1]?.body)).data).toEqual(data);
  });
  it("cannot execute the sandbox app as unsandboxed content on its former possible subdomain", async () => {
    const f = setup();
    expect((await f.app.inject({ url: "/", headers: { host: `${f.row.hostLabel}.apps.example.net` } })).statusCode).toBe(404);
  });
  it("uploads a real multipart file with only the pinned visitor identity", async () => {
    const f = setup(), access = await f.open();
    const result = await f.app.inject({ method: "POST", url: `${f.url}/_rpc/upload/images/unique()`,
      headers: { host: f.host, cookie: access.cookie, origin: f.config.publicBaseUrl,
        "x-linksense-app-capability": access.packet.capability, "x-linksense-file-name": "photo.png",
        "x-linksense-file-type": "image/png", "content-type": "application/octet-stream" },
      payload: Buffer.from("image-content") });
    expect(result.statusCode).toBe(200);
    const body = f.fetcher.mock.calls[0]?.[1]?.body;
    expect(body).toBeInstanceOf(FormData);
    const form = body as FormData;
    expect(form.get("fileId")).toBe("unique()");
    expect(await (form.get("file") as Blob).text()).toBe("image-content");
  });
  it("splits uploads exceeding Appwrite's five-MiB chunk limit and pins the returned file ID", async () => {
    const f = setup(), access = await f.open();
    f.fetcher.mockResolvedValueOnce(Response.json({ $id: "native-file-id" }));
    const response = await f.app.inject({ method: "POST", url: `${f.url}/_rpc/upload/images/unique()`,
      headers: { host: f.host, cookie: access.cookie, origin: f.config.publicBaseUrl,
        "x-linksense-app-capability": access.packet.capability, "x-linksense-file-name": "large.png",
        "x-linksense-file-type": "image/png", "content-type": "application/octet-stream" },
      payload: Buffer.alloc(6 * 1024 * 1024) });
    expect(response.statusCode).toBe(200);
    expect(f.fetcher).toHaveBeenCalledTimes(2);
    const first = f.fetcher.mock.calls[0]?.[1], second = f.fetcher.mock.calls[1]?.[1];
    expect((first?.body as FormData).get("fileId")).toBe("unique()");
    expect(((first?.body as FormData).get("file") as Blob).size).toBe(5 * 1024 * 1024);
    expect((second?.body as FormData).get("fileId")).toBe("native-file-id");
    expect(new Headers(second?.headers).get("x-appwrite-id")).toBe("native-file-id");
    expect(new Headers(second?.headers).get("content-range")).toBe("bytes 5242880-6291455/6291456");
  });
  it("preserves file bytes even when the file advertises a JSON content type", async () => {
    const f = setup(), access = await f.open();
    f.fetcher.mockResolvedValueOnce(new Response("not-valid-json", { headers: { "content-type": "application/json" } }));
    const result = await f.rpc(access, { path: "/storage/buckets/uploads/files/file/download", method: "GET" });
    expect(result.statusCode).toBe(200);
    expect(result.body).toBe("not-valid-json");
    expect(result.headers["content-security-policy"]).toContain("sandbox");
  });
  it("sanitizes function headers, rejects async replay, and keeps upstream failures private", async () => {
    const f = setup(), access = await f.open();
    expect((await f.rpc(access, { path: "/functions/approval/executions", method: "POST", body: { async: true } })).statusCode).toBe(400);
    await f.rpc(access, { path: "/functions/approval/executions", method: "POST",
      body: { headers: { authorization: "Bearer stolen", "x-appwrite-key": "stolen", "x-business": "kept" } } });
    expect(JSON.parse(String(f.fetcher.mock.calls[0]?.[1]?.body))).toEqual({ async: false, headers: { "x-business": "kept" } });
    f.fetcher.mockResolvedValueOnce(Response.json({ message: "private upstream details" }, { status: 500 }));
    const failed = await f.rpc(access, { path: "/account", method: "GET" });
    expect(failed.body).not.toContain("private upstream details");
  });
  it("revokes the shell, existing capabilities and in-flight data after disabling an application", async () => {
    const f = setup(), access = await f.open();
    f.fetcher.mockImplementationOnce(async () => { f.disable(); return Response.json({ private_data: "hidden" }); });
    const pending = await f.rpc(access, { path: "/account", method: "GET" });
    expect(pending.statusCode).toBe(404);
    expect(pending.body).not.toContain("hidden");
    expect((await f.app.inject({ url: f.url, headers: { host: f.host } })).statusCode).toBe(404);
    expect((await f.rpc(access, { path: "/account", method: "GET" })).statusCode).toBe(404);
  });
  it("keeps the sandbox address stable through inspection and renames without native hostname changes", async () => {
    const f = setup();
    await f.service.prepare(ownerId, taskId, "Appointments", backendId, "appointments");
    expect((await f.service.inspect(ownerId, backendId)).url).toBe(`${f.config.publicBaseUrl}/app/appointments`);
    expect(f.fetcher).not.toHaveBeenCalled();
  });
});

describe("public-app session isolation", () => {
  it("expires capabilities and rejects altered ciphertext", () => {
    const f = setup();
    const now = vi.spyOn(Date, "now");
    try {
      now.mockReturnValue(1_000);
      const token = f.sessions.capability(backendId, siteId, "visitor");
      now.mockReturnValue(31 * 24 * 60 * 60 * 1000);
      expect(() => f.sessions.authorize(token, backendId, siteId, "visitor")).toThrow("FORBIDDEN");
      expect(() => f.sessions.authorize(`${token}changed`, backendId, siteId, "visitor")).toThrow("FORBIDDEN");
    } finally { now.mockRestore(); }
  });
  it("separates app and visitor sessions and rejects stale writes across API workers", async () => {
    const f = setup(), visitor = "test-visitor", otherBackend = "70000000-0000-4000-8000-000000000001";
    const old = await f.sessions.read(backendId, visitor);
    await f.sessions.save(backendId, visitor, old, "a_session=test");
    await expect(f.sessions.save(backendId, visitor, old, "stale-login")).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await f.sessions.read(backendId, visitor)).cookie).toBe("a_session=test");
    expect((await f.sessions.read(otherBackend, visitor)).cookie).toBe("");
    expect((await f.sessions.read(backendId, "another-visitor")).cookie).toBe("");
    const secondWorker = new WebSiteVisitorSessions(f.redis, f.config);
    expect((await secondWorker.read(backendId, visitor)).cookie).toBe("a_session=test");
    await expect(new WebSiteVisitorSessions(f.redis, { ...f.config, credentialMasterKey: "wrong" }).read(backendId, visitor))
      .rejects.toMatchObject({ code: "WEB_SITE_BACKEND_UNAVAILABLE" });
  });
});
