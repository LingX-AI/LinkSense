import Fastify from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { registerWebSiteBackendGateway } from "../src/modules/web-site-backends/gateway.js";
import { normalizeError } from "../src/lib/errors.js";
import { sha256 } from "../src/modules/web-sites/resources.js";
import { backendFixture, backendId } from "./web-site-backends.fixture.js";

const open: ReturnType<typeof Fastify>[] = [];
afterEach(async () => { await Promise.all(open.splice(0).map(app => app.close())); });
function setup(appsBaseUrl?: string) {
  const fixture = backendFixture(appsBaseUrl);
  const app = Fastify();
  open.push(app);
  registerWebSiteBackendGateway(app, fixture.service, fixture.sites);
  app.setErrorHandler((error, _request, reply) => {
    const normalized = normalizeError(error);
    return reply.code(normalized.code === "FORBIDDEN" ? 403 : 404).send({ error_code: normalized.code });
  });
  app.get("/api/v1/platform", () => ({ private_platform: true }));
  const host = new URL(fixture.service.origin(backendId)).host;
  return { ...fixture, app, host };
}

describe("public application gateway", () => {
  it("serves generated applications on an isolated origin while protecting platform routes", async () => {
    const { app, host } = setup();
    const page = await app.inject({ url: "/", headers: { host } });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain("<title>Sample</title>");
    expect(page.headers["content-security-policy"]).toContain("connect-src 'self'");
    expect(page.headers["content-security-policy"]).not.toContain("sandbox");
    expect(page.headers["x-frame-options"]).toBe("DENY");
    expect((await app.inject({ url: "/api/v1/platform", headers: { host } })).statusCode).toBe(404);
    expect((await app.inject({ url: "/api/v1/platform", headers: { host: "linksense.example.test" } })).json()).toEqual({ private_platform: true });
    expect((await app.inject({ url: "/api/v1/platform", headers: { host: "invalid.apps.example.net" } })).statusCode).toBe(404);
  });

  it("pins projects and strips platform authentication before forwarding native API requests", async () => {
    const { app, host, fetcher } = setup();
    const response = await app.inject({
      url: "/appwrite/v1/account", headers: {
        host, authorization: "Bearer linksense-session",
        cookie: "__Host-a_session_ls-test-project=visitor-session; linksense=platform-session",
      },
    });
    expect(response.statusCode).toBe(200);
    const headers = new Headers(fetcher.mock.calls[0]?.[1]?.headers);
    expect(headers.get("x-appwrite-project")).toBe("ls-test-project");
    expect(headers.get("cookie")).toBe("a_session_ls-test-project=visitor-session");
    expect(headers.has("authorization")).toBe(false);
    expect(headers.has("x-appwrite-key")).toBe(false);
  });

  it("ignores parent-domain session cookies and translates only host-prefixed HTTPS cookies", async () => {
    const { app, host, fetcher } = setup();
    await app.inject({ url: "/appwrite/v1/account", headers: {
      host, cookie: "a_session_ls-test-project=parent-attacker; __Host-a_session_ls-test-project=visitor-session",
    } });
    expect(new Headers(fetcher.mock.calls[0]?.[1]?.headers).get("cookie")).toBe("a_session_ls-test-project=visitor-session");
    fetcher.mockClear();
    await app.inject({ url: "/appwrite/v1/account", headers: { host, cookie: "a_session_ls-test-project=parent-attacker" } });
    expect(new Headers(fetcher.mock.calls[0]?.[1]?.headers).has("cookie")).toBe(false);
  });

  it("issues and expires HTTPS sessions with a host-prefixed cookie name", async () => {
    const { app, host, fetcher } = setup();
    fetcher.mockResolvedValueOnce(Response.json({}, {
      headers: { "set-cookie": "a_session_ls-test-project=; Domain=backend.example.test; Max-Age=0; Path=/" },
    }));
    const response = await app.inject({ method: "DELETE", url: "/appwrite/v1/account/sessions/current", headers: { host } });
    expect(response.headers["set-cookie"]).toEqual([
      "__Host-a_session_ls-test-project=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax; Secure",
    ]);
  });

  it("keeps native session cookie names usable for local HTTP development", async () => {
    const { app, host, fetcher } = setup("http://apps.localhost");
    fetcher.mockResolvedValueOnce(Response.json({}, { headers: { "set-cookie": "a_session_ls-test-project=visitor; Path=/" } }));
    const response = await app.inject({ url: "/appwrite/v1/account", headers: { host, cookie: "a_session_ls-test-project=visitor" } });
    expect(new Headers(fetcher.mock.calls[0]?.[1]?.headers).get("cookie")).toBe("a_session_ls-test-project=visitor");
    expect(response.headers["set-cookie"]).toEqual(["a_session_ls-test-project=visitor; Path=/; HttpOnly; SameSite=Lax"]);
  });

  it("preserves the entry directory and serves directory indexes with working relative assets", async () => {
    const { app, host, site } = setup();
    site.manifest.entry_path = "pages/index.html";
    site.manifest.files = ([
      ["pages/index.html", '<!doctype html><title>Nested</title><script src="./app.js"></script>'],
      ["pages/app.js", 'document.title = "Working";'],
      ["pages/settings/index.html", "<!doctype html><title>Settings</title>"],
    ] as const).map(([path, contents]) => {
      const data = Buffer.from(contents);
      const key = `nested/${path}`;
      site.objects.set(key, data);
      return { path, object_key: key, mime_type: path.endsWith(".js") ? "application/javascript" : "text/html", size_bytes: data.length, checksum_sha256: sha256(data) };
    });
    const root = await app.inject({ url: "/?invite=preserved", headers: { host } });
    expect(root.statusCode).toBe(302);
    expect(root.headers.location).toBe("/pages/index.html?invite=preserved");
    const page = await app.inject({ url: root.headers.location!, headers: { host } });
    expect(page.statusCode).toBe(200);
    const script = new URL("./app.js", `https://${host}${root.headers.location}`);
    expect((await app.inject({ url: script.pathname, headers: { host } })).body).toContain('document.title = "Working"');
    expect((await app.inject({ url: "/pages/settings/", headers: { host } })).body).toContain("<title>Settings</title>");
  });

  it.each([
    { url: "/appwrite/v1/account", extra: { "x-appwrite-project": "console" } },
    { url: "/appwrite/v1/account", extra: { "x-appwrite-key": "private-key" } },
    { url: "/appwrite/v1/account?project=another-app", extra: {} },
    { url: "/appwrite/v1/account?key=private-key", extra: {} },
    { url: "/appwrite/v1/project/keys", extra: {} },
    { url: "/appwrite/v1/graphql", extra: {} },
    { url: "/appwrite/v1/account", extra: { origin: "https://other.example.test" } },
  ])("rejects project, privilege and origin bypasses: $url $extra", async ({ url, extra }) => {
    const { app, host, fetcher } = setup();
    expect((await app.inject({ url, headers: { host, ...extra } })).statusCode).toBe(403);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("keeps visitor cookies host-only and forwards request bodies without LS parsing", async () => {
    const { app, host, fetcher } = setup();
    fetcher.mockResolvedValueOnce(Response.json({ userId: "visitor" }, {
      headers: { "set-cookie": "a_session_ls-test-project=visitor; Domain=backend.example.test; Path=/; SameSite=None" },
    }));
    const response = await app.inject({
      method: "POST", url: "/appwrite/v1/account/sessions/email",
      headers: { host, "content-type": "application/json" }, payload: { email: "visitor@example.test", password: "visitor-password" },
    });
    expect(response.statusCode).toBe(200);
    expect(String(response.headers["set-cookie"])).not.toContain("Domain=");
    expect(String(response.headers["set-cookie"])).toContain("SameSite=Lax");
    expect(String(response.headers["set-cookie"])).toContain("HttpOnly");
    expect(String(response.headers["set-cookie"])).toContain("__Host-a_session_ls-test-project=visitor;");
    expect(Buffer.from(fetcher.mock.calls[0]?.[1]?.body as Uint8Array).toString()).toContain("visitor@example.test");
  });

  it("revokes pages and old-session API requests immediately after disabling the site", async () => {
    const { app, host, disable, fetcher } = setup();
    disable();
    for (const url of ["/", "/appwrite/v1/account", "/appwrite/v1/tablesdb/app/tables/appointments/rows"]) {
      expect((await app.inject({ url, headers: { host, cookie: "a_session_ls-test-project=old-session" } })).statusCode).toBe(404);
    }
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("discards an in-flight backend response if the application is disabled before it completes", async () => {
    const { app, host, disable, fetcher } = setup();
    fetcher.mockImplementationOnce(async () => {
      disable();
      return Response.json({ private_data: "must-not-escape" }, {
        headers: { "set-cookie": "a_session_ls-test-project=new-session; Path=/" },
      });
    });
    const response = await app.inject({ url: "/appwrite/v1/account", headers: { host } });
    expect(response.statusCode).toBe(404);
    expect(response.body).not.toContain("must-not-escape");
    expect(response.headers["set-cookie"]).toBeUndefined();
  });

  it("routes the deployment gateway prefix without exposing LS platform routes", async () => {
    const { app, host } = setup();
    expect((await app.inject({ url: "/api/v1/public-app-gateway/", headers: { host } })).statusCode).toBe(200);
    expect((await app.inject({ url: "/api/v1/public-app-gateway/api/v1/platform", headers: { host } })).statusCode).toBe(404);
  });

  it("renders uploaded active content in an opaque sandbox", async () => {
    const { app, host, fetcher } = setup();
    fetcher.mockResolvedValueOnce(new Response("<svg><script>unsafe()</script></svg>", { headers: { "content-type": "image/svg+xml" } }));
    const response = await app.inject({ url: "/appwrite/v1/storage/buckets/images/files/logo/view", headers: { host } });
    expect(response.headers["content-security-policy"]).toBe("sandbox; default-src 'none'; frame-ancestors 'none'");
  });

  it("does not permit asynchronous execution or caller-injected Appwrite identity headers", async () => {
    const { app, host, fetcher } = setup();
    const rejected = await app.inject({ method: "POST", url: "/appwrite/v1/functions/approval/executions", headers: { host }, payload: { async: true } });
    expect(rejected.statusCode).not.toBe(200);
    expect(fetcher).not.toHaveBeenCalled();
    for (const query of ["async=true", "scheduledAt=2099-01-01T00%3A00%3A00Z"]) {
      const response = await app.inject({ method: "POST", url: `/appwrite/v1/functions/approval/executions?${query}`, headers: { host }, payload: { body: "{}" } });
      expect(response.statusCode).not.toBe(200);
      expect(fetcher).not.toHaveBeenCalled();
    }
    await app.inject({ method: "POST", url: "/appwrite/v1/functions/approval/executions", headers: { host }, payload: {
      body: "{}", headers: { "x-appwrite-user-id": "forged", "content-type": "application/json" },
    } });
    expect(JSON.parse(Buffer.from(fetcher.mock.calls[0]?.[1]?.body as Uint8Array).toString())).toMatchObject({
      async: false, headers: { "content-type": "application/json" },
    });
    fetcher.mockClear();
    const invalid = await app.inject({ method: "POST", url: "/appwrite/v1/functions/approval/executions", headers: { host }, payload: {
      body: "{}", headers: { "x-custom": "invalid\r\nheader" },
    } });
    expect(invalid.json().error_code).toBe("VALIDATION_ERROR");
    expect(fetcher).not.toHaveBeenCalled();
  });
});
