import { describe, expect, it, vi } from "vitest";
import { webSiteBackendConfigureSchema, webSiteBackendPrepareSchema } from "@linksense/shared";
import { AppwriteClient } from "../src/modules/web-site-backends/appwrite.js";
import { WebSiteBackendService, appHostLabel } from "../src/modules/web-site-backends/service.js";
import { WebSiteService } from "../src/modules/web-sites/service.js";
import { backendFixture, backendId } from "./web-site-backends.fixture.js";
import { ownerId, taskId, siteId } from "./web-sites.fixture.js";

describe("self-hosted Appwrite backend", () => {
  it("uses native short-lived console authentication and revokes it after provisioning", async () => {
    const { config } = backendFixture();
    const fetcher = vi.fn<typeof fetch>(async (url) => {
      const path = new URL(String(url)).pathname;
      return path.endsWith("/sessions/email") ? Response.json({ secret: "" }, { headers: { "set-cookie": "a_session_console=test-console-session; Path=/; HttpOnly" } })
        : Response.json(path.endsWith("/keys") ? { secret: "test-project-management-key" }
          : path === "/v1/teams" ? { total: 1, teams: [{ $id: "organization" }] }
          : path === "/v1/project/platforms/web" ? { hostname: "app.example.test" } : {});
    });
    const client = new AppwriteClient(config.appwrite!, fetcher);
    await expect(client.provision("ls-app", "App", "https://app.example.test")).resolves.toBe("test-project-management-key");
    expect(fetcher.mock.calls.map(([url]) => new URL(String(url)).pathname)).toEqual([
      "/v1/account/sessions/email", "/v1/teams", "/v1/organization/projects", "/v1/organization/projects/ls-app/keys",
      "/v1/project/platforms/web", "/v1/tablesdb", "/v1/account/sessions/current",
    ]);
    const keyHeaders = new Headers(fetcher.mock.calls[3]?.[1]?.headers);
    expect(keyHeaders.has("x-appwrite-mode")).toBe(false);
    expect(keyHeaders.get("x-appwrite-session")).toBe("test-console-session");
    expect(keyHeaders.get("x-appwrite-organization")).toBe("organization");
    const platformHeaders = new Headers(fetcher.mock.calls[4]?.[1]?.headers);
    expect(platformHeaders.get("x-appwrite-key")).toBe("test-project-management-key");
    expect(platformHeaders.has("x-appwrite-session")).toBe(false);
    expect(JSON.parse(String(fetcher.mock.calls[3]?.[1]?.body)).keyId).toBe("ls-app");
    expect(JSON.parse(String(fetcher.mock.calls[4]?.[1]?.body)).platformId).toBe("ls-app");
    expect(fetcher.mock.calls[0]?.[1]?.body).toContain('"duration":300');
    expect(fetcher.mock.calls.at(-1)?.[1]?.method).toBe("DELETE");
  });

  it("cleans up console sessions and redacts provider failures", async () => {
    const { config } = backendFixture();
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ secret: "" }, { headers: { "set-cookie": "a_session_console=test-console-session; HttpOnly" } }))
      .mockResolvedValueOnce(Response.json({ total: 1, teams: [{ $id: "organization" }] }))
      .mockResolvedValueOnce(Response.json({ message: "private infrastructure and secret" }, { status: 500 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const client = new AppwriteClient(config.appwrite!, fetcher);
    await expect(client.provision("ls-app", "App", "https://app.example.test")).rejects.toThrow("WEB_SITE_BACKEND_UNAVAILABLE");
    expect(fetcher.mock.calls.at(-1)?.[1]?.method).toBe("DELETE");
  });

  it("reconciles a platform left by failed provisioning before returning the recovered backend", async () => {
    const { config } = backendFixture();
    const fetcher = vi.fn<typeof fetch>(async (url, init) => {
      const path = new URL(String(url)).pathname;
      if (path.endsWith("/sessions/email")) return Response.json({}, { headers: { "set-cookie": "a_session_console=test-console-session; HttpOnly" } });
      if (path === "/v1/teams") return Response.json({ total: 1, teams: [{ $id: "organization" }] });
      if (path.endsWith("/keys")) return Response.json({ secret: "test-project-management-key" });
      if (path === "/v1/project/platforms/web") return Response.json({}, { status: 409 });
      if (path === "/v1/project/platforms/ls-app" && init?.method === "GET") return Response.json({ hostname: "old.example.test" });
      return Response.json({});
    });
    const client = new AppwriteClient(config.appwrite!, fetcher);
    await client.provision("ls-app", "App", "https://new.example.test");
    const update = fetcher.mock.calls.find(([url, init]) =>
      new URL(String(url)).pathname === "/v1/projects/ls-app/platforms/ls-app" && init?.method === "PUT");
    expect(update).toBeDefined();
    expect(JSON.parse(String(update?.[1]?.body))).toMatchObject({ hostname: "new.example.test" });
    expect(new Headers(update?.[1]?.headers).get("x-appwrite-session")).toBe("test-console-session");
    expect(fetcher.mock.calls.at(-1)?.[1]?.method).toBe("DELETE");
  });

  it("restores only the current address while keeping a failed rename's backend ready", async () => {
    const fixture = backendFixture();
    vi.mocked(fixture.store.acquire).mockImplementationOnce(async (_owner, _id, lease) => {
      fixture.row.hostLabel = "latest-address";
      fixture.row.leaseUntil = lease;
    });
    vi.spyOn(fixture.service.requiredClient(), "setPlatformHostname").mockRejectedValue(new Error("upstream failure"));
    await expect(fixture.service.prepare(ownerId, taskId, "Appointments", backendId, "appointments"))
      .rejects.toThrow("upstream failure");
    expect(fixture.row.hostLabel).toBe("latest-address");
    expect(fixture.row.status).toBe("ready");
    expect(fixture.row.leaseUntil).toBeNull();
  });

  it.each([false, true])("recovers the actual platform origin after a rename response is lost (applied=%s)", async applied => {
    const fixture = backendFixture();
    const previous = appHostLabel(backendId);
    vi.spyOn(fixture.service.requiredClient(), "setPlatformHostname").mockRejectedValue(new Error("response lost"));
    await expect(fixture.service.prepare(ownerId, taskId, "Appointments", backendId, "appointments"))
      .rejects.toThrow("response lost");
    expect(fixture.row.hostResolved).toBe(false);
    vi.mocked(fixture.store.findByHostLabel).mockImplementation(async label =>
      [previous, "appointments"].includes(label) ? { id: backendId } : null);
    const actual = applied ? "appointments" : previous;
    fixture.fetcher.mockResolvedValueOnce(Response.json({ hostname: `${actual}.apps.example.net` }));
    await expect(fixture.service.inspect(ownerId, backendId)).resolves.toMatchObject({
      origin: `https://${actual}.apps.example.net`,
    });
    expect(fixture.row.hostResolved).toBe(true);
    expect(fixture.row.hostLabel).toBe(actual);
  });

  it("renames a backend to a chosen address and moves its web platform", async () => {
    const fixture = backendFixture();
    const setPlatformHostname = vi.spyOn(fixture.service.requiredClient(), "setPlatformHostname").mockResolvedValue();
    const result = await fixture.service.prepare(ownerId, taskId, "Appointments", backendId, "appointments");
    expect(result.origin).toBe("https://appointments.apps.example.net");
    expect(result.endpoint).toBe("https://appointments.apps.example.net/appwrite/v1");
    expect(fixture.row.hostLabel).toBe("appointments");
    expect(setPlatformHostname).toHaveBeenCalledWith(fixture.row.projectId, "appointments.apps.example.net");
  });

  it("refuses an address another backend owns without touching the platform", async () => {
    const fixture = backendFixture();
    vi.mocked(fixture.store.findByHostLabel).mockResolvedValue({ id: "70000000-0000-4000-8000-000000000009" });
    const setPlatformHostname = vi.spyOn(fixture.service.requiredClient(), "setPlatformHostname");
    await expect(fixture.service.prepare(ownerId, taskId, "Appointments", backendId, "appointments"))
      .rejects.toMatchObject({ code: "WEB_SITE_BACKEND_ADDRESS_TAKEN" });
    expect(fixture.row.hostLabel).toBe(appHostLabel(backendId));
    expect(setPlatformHostname).not.toHaveBeenCalled();
  });

  it("restores the previous address when the platform rename fails", async () => {
    const fixture = backendFixture();
    vi.spyOn(fixture.service.requiredClient(), "setPlatformHostname").mockRejectedValue(new Error("upstream failure"));
    await expect(fixture.service.prepare(ownerId, taskId, "Appointments", backendId, "appointments")).rejects.toThrow("upstream failure");
    expect(fixture.row.hostLabel).toBe(appHostLabel(backendId));
  });

  it("keeps historical backend origins usable without reprovisioning their Appwrite platforms", async () => {
    const fixture = backendFixture();
    fixture.row.hostLabel = null;
    fixture.row.hostResolved = false;
    const origin = `https://${backendId}.apps.example.net`;
    fixture.fetcher.mockResolvedValueOnce(Response.json({ hostname: new URL(origin).hostname }));
    await expect(fixture.service.inspect(ownerId, backendId)).resolves.toMatchObject({ origin, endpoint: `${origin}/appwrite/v1` });
    await expect(fixture.service.prepare(ownerId, taskId, "Appointments", backendId)).resolves.toMatchObject({ origin });
    expect((await fixture.sites.list(ownerId, { limit: 20 })).items[0]?.url).toBe(origin);
    expect((await fixture.sites.publicEntry("sample")).url).toBe(origin);
    expect(fixture.fetcher).toHaveBeenCalledOnce();
    expect(fixture.fetcher.mock.calls[0]?.[1]?.method).toBe("GET");
  });

  it("keeps a short host created before host labels were persisted without changing its native platform", async () => {
    const fixture = backendFixture();
    fixture.row.hostLabel = null;
    fixture.row.hostResolved = false;
    const origin = `https://${appHostLabel(backendId)}.apps.example.net`;
    fixture.fetcher.mockResolvedValueOnce(Response.json({ hostname: new URL(origin).hostname }));
    await expect(fixture.service.inspect(ownerId, backendId)).resolves.toMatchObject({ origin });
    expect(fixture.row.hostLabel).toBe(appHostLabel(backendId));
    expect(fixture.row.hostResolved).toBe(true);
    await expect(fixture.service.originFor(backendId)).resolves.toBe(origin);
    expect(fixture.fetcher).toHaveBeenCalledOnce();
  });

  it("shares host resolution across historical deliveries of the same backend", async () => {
    const fixture = backendFixture();
    fixture.row.hostLabel = null;
    fixture.row.hostResolved = false;
    const { site } = fixture.site.row;
    fixture.site.store.conversationDeliveries.mockResolvedValue([
      { id: site.id, name: site.name, slug: site.slug, status: site.status, backend_id: backendId,
        source_file_id: fixture.site.source.file.id, turn_id: "70000000-0000-4000-8000-000000000001" },
      { id: site.id, name: site.name, slug: site.slug, status: site.status, backend_id: backendId,
        source_file_id: "30000000-0000-4000-8000-000000000002", turn_id: "70000000-0000-4000-8000-000000000002" },
    ]);
    fixture.fetcher.mockResolvedValueOnce(Response.json({ hostname: `${backendId}.apps.example.net` }));
    const deliveries = await fixture.sites.conversationDeliveries(ownerId, taskId, fixture.config.publicBaseUrl);
    expect(deliveries).toHaveLength(2);
    expect(deliveries.every(delivery => delivery.url === `https://${backendId}.apps.example.net`)).toBe(true);
    expect(fixture.fetcher).toHaveBeenCalledOnce();
    expect(fixture.store.acquire).toHaveBeenCalledOnce();
  });

  it("leaves an unresolved historical backend retryable if its native platform cannot be read", async () => {
    const fixture = backendFixture();
    fixture.row.hostLabel = null;
    fixture.row.hostResolved = false;
    fixture.fetcher.mockResolvedValueOnce(Response.json({}, { status: 503 }));
    await expect(fixture.service.inspect(ownerId, backendId)).rejects.toThrow("WEB_SITE_BACKEND_UNAVAILABLE");
    expect(fixture.row.hostResolved).toBe(false);
    expect(fixture.row.leaseUntil).toBeNull();
    fixture.fetcher.mockResolvedValueOnce(Response.json({ hostname: `${backendId}.apps.example.net` }));
    await expect(fixture.service.inspect(ownerId, backendId)).resolves.toMatchObject({ origin: `https://${backendId}.apps.example.net` });
  });

  it.each(["foreign.apps.example.net", "appointments.other.example.net", "70000000-0000-4000-8000-000000000001.apps.example.net"])(
    "rejects a native platform hostname outside this backend's reserved origins: %s", async hostname => {
      const fixture = backendFixture();
      fixture.row.hostLabel = null;
      fixture.row.hostResolved = false;
      fixture.fetcher.mockResolvedValueOnce(Response.json({ hostname }));
      await expect(fixture.service.inspect(ownerId, backendId)).rejects.toThrow("WEB_SITE_BACKEND_UNAVAILABLE");
      expect(fixture.row.hostLabel).toBeNull();
      expect(fixture.row.hostResolved).toBe(false);
      expect(fixture.row.leaseUntil).toBeNull();
    },
  );

  it("rejects renaming a backend with an active lease before changing its address", async () => {
    const fixture = backendFixture();
    fixture.row.leaseUntil = new Date(Date.now() + 60_000);
    const previous = fixture.row.hostLabel;
    const update = vi.spyOn(fixture.service.requiredClient(), "setPlatformHostname").mockResolvedValue();
    await expect(fixture.service.prepare(ownerId, taskId, "Appointments", backendId, "appointments"))
      .rejects.toMatchObject({ code: "CONFLICT" });
    expect(fixture.row.hostLabel).toBe(previous);
    expect(update).not.toHaveBeenCalled();
  });

  it.each(["ready", "preparing"] as const)("serializes address changes while a %s backend is being prepared", async status => {
    const fixture = backendFixture();
    fixture.row.status = status;
    if (status === "preparing") fixture.row.encryptedCredential = null;
    let markStarted = () => {};
    let releaseUpdate = () => {};
    const started = new Promise<void>(resolve => { markStarted = resolve; });
    const release = new Promise<void>(resolve => { releaseUpdate = resolve; });
    const update = vi.spyOn(fixture.service.requiredClient(), "setPlatformHostname").mockImplementation(async () => {
      markStarted();
      await release;
    });
    vi.spyOn(fixture.service.requiredClient(), "provision").mockImplementation(async () => {
      markStarted();
      await release;
      return "test-project-management-key";
    });
    const first = fixture.service.prepare(ownerId, taskId, "Appointments", backendId, "appointments");
    await started;
    try {
      await expect(fixture.service.prepare(ownerId, taskId, "Appointments", backendId, "bookings"))
        .rejects.toMatchObject({ code: "CONFLICT" });
      expect(fixture.row.hostLabel).toBe("appointments");
    } finally {
      releaseUpdate();
      await first;
    }
    expect(fixture.row.leaseUntil).toBeNull();
    expect(update).toHaveBeenCalledTimes(status === "ready" ? 1 : 0);
  });

  it("rejects addresses that are not DNS labels or that mimic generated hosts", () => {
    for (const address of ["600000000000", "appointments app", "-appointments", "appointments-", "a".repeat(31), "ab"]) {
      expect(webSiteBackendPrepareSchema.safeParse({ name: "Appointments", address }).success).toBe(false);
    }
    expect(webSiteBackendPrepareSchema.parse({ name: "Appointments", address: "Appointments" }).address).toBe("appointments");
  });

  it("reuses prepared backends and encrypts newly provisioned credentials", async () => {
    const fixture = backendFixture();
    const provision = vi.spyOn(fixture.service.requiredClient(), "provision").mockResolvedValue("test-new-project-key");
    await fixture.service.prepare(ownerId, taskId, "Appointments");
    expect(provision).not.toHaveBeenCalled();
    fixture.row.status = "failed";
    fixture.row.encryptedCredential = null;
    const result = await fixture.service.prepare(ownerId, taskId, "Appointments", backendId);
    expect(result).toMatchObject({ id: backendId, status: "ready", database_id: "app" });
    expect(JSON.stringify(result)).not.toContain("test-new-project-key");
    expect(fixture.row.encryptedCredential).not.toContain("test-new-project-key");
    expect(fixture.service.key(fixture.row)).toBe("test-new-project-key");
    expect(fixture.store.acquire).toHaveBeenCalledOnce();
  });

  it("rejects foreign owners before configuring resources", async () => {
    const fixture = backendFixture();
    await expect(fixture.service.configure("other-owner", backendId, { action: "inspect", path: "/functions" })).rejects.toThrow("WEB_SITE_NOT_FOUND");
    expect(fixture.fetcher).not.toHaveBeenCalled();
  });

  it("redacts native variables and logs without losing resource or schema identifiers", async () => {
    const fixture = backendFixture();
    fixture.fetcher.mockResolvedValueOnce(Response.json({
      $id: "approval", vars: [{ key: "PRIVATE_TOKEN", value: "private-test-value" }],
      functions: [{ $id: "nested", variables: [{ secret: "private-test-value" }], logs: "private-test-value" }],
      columns: [{ key: "slot", type: "string" }],
    }));
    const result = await fixture.service.configure(ownerId, backendId, { action: "inspect", path: "/functions/approval" });
    expect(result).toEqual({ $id: "approval", functions: [{ $id: "nested" }], columns: [{ key: "slot", type: "string" }] });
    expect(JSON.stringify(result)).not.toContain("private-test-value");
  });

  it("creates private row-scoped tables without broad read or write grants", async () => {
    const fixture = backendFixture();
    const input = webSiteBackendConfigureSchema.parse({
      backend_id: backendId, change: {
        action: "create_table", id: "appointments", name: "Appointments",
        columns: [{ key: "slot", type: "string", size: 100, required: true }],
        indexes: [{ key: "one_booking", type: "unique", columns: ["slot"] }],
      },
    });
    await fixture.service.configure(ownerId, backendId, input.change);
    expect(JSON.parse(String(fixture.fetcher.mock.calls[0]?.[1]?.body))).toMatchObject({
      rowSecurity: true, permissions: ['create("users")'],
      indexes: [{ key: "one_booking", type: "unique", attributes: ["slot"] }],
    });
  });

  it("blocks publication until native function builds and database indexes are ready", async () => {
    const fixture = backendFixture();
    fixture.fetcher.mockResolvedValueOnce(Response.json({
      total: 1, functions: [{ deploymentId: "", latestDeploymentId: "new", latestDeploymentStatus: "building" }],
    }));
    await expect(fixture.service.assertPublishable(ownerId, backendId)).rejects.toThrow("WEB_SITE_BACKEND_PENDING");
    fixture.fetcher.mockResolvedValueOnce(Response.json({ total: 0, functions: [] }))
      .mockResolvedValueOnce(Response.json({ total: 1, tables: [{ columns: [], indexes: [{ status: "processing" }] }] }));
    await expect(fixture.service.assertPublishable(ownerId, backendId)).rejects.toThrow("WEB_SITE_BACKEND_PENDING");
  });

  it("checks backend readiness before restoring a disabled dynamic application", async () => {
    const fixture = backendFixture();
    fixture.site.row.site.status = "disabled";
    fixture.fetcher.mockResolvedValueOnce(Response.json({
      total: 1, functions: [{ deploymentId: "", latestDeploymentId: "draft", latestDeploymentStatus: "building" }],
    }));
    await expect(fixture.sites.update(ownerId, fixture.site.row.site.id, { status: "published" })).rejects.toThrow("WEB_SITE_BACKEND_PENDING");
    expect(fixture.site.store.update).not.toHaveBeenCalled();
    await fixture.sites.update(ownerId, fixture.site.row.site.id, { status: "published" });
    expect(fixture.site.store.update).toHaveBeenCalledOnce();
  });

  it("blocks replacement and restoration during an active configuration lease, then accepts an expired lease", async () => {
    const fixture = backendFixture();
    const id = fixture.site.row.site.id;
    fixture.row.leaseUntil = new Date(Date.now() + 60_000);
    await expect(fixture.sites.publish(ownerId, id, fixture.site.source.file.id)).rejects.toThrow("WEB_SITE_BACKEND_PENDING");
    await expect(fixture.sites.update(ownerId, id, { status: "published" })).rejects.toThrow("WEB_SITE_BACKEND_PENDING");
    expect(fixture.site.store.publish).not.toHaveBeenCalled();
    expect(fixture.site.store.update).not.toHaveBeenCalled();
    expect(fixture.fetcher).not.toHaveBeenCalled();
    fixture.row.leaseUntil = new Date(Date.now() - 60_000);
    await expect(fixture.sites.publish(ownerId, id, fixture.site.source.file.id)).resolves.toMatchObject({ backend_id: backendId });
  });

  it.each(["create", "publish", "restore"] as const)(
    "keeps backend configuration excluded throughout %s readiness and publication",
    async (operation) => {
      const fixture = backendFixture();
      let configurationError: unknown;
      fixture.fetcher.mockImplementationOnce(async () => {
        try {
          await fixture.service.configure(ownerId, backendId, { action: "inspect", path: "/functions" });
        } catch (error) {
          configurationError = error;
        }
        return Response.json({ total: 0, functions: [] });
      });
      if (operation === "create") {
        await fixture.sites.create(ownerId, {
          conversation_id: taskId, file_id: fixture.site.source.file.id,
          name: "Sample", description: "", backend_id: backendId,
        });
      } else if (operation === "publish") {
        await fixture.sites.publish(ownerId, fixture.site.row.site.id, fixture.site.source.file.id);
      } else {
        fixture.site.row.site.status = "disabled";
        await fixture.sites.update(ownerId, fixture.site.row.site.id, { status: "published" });
      }
      expect(configurationError).toMatchObject({ code: "CONFLICT" });
      expect(fixture.row.leaseUntil).toBeNull();
      await expect(fixture.service.configure(ownerId, backendId, {
        action: "inspect", path: "/functions",
      })).resolves.toBeDefined();
    },
  );

  it("stages code without activating it and only activates a ready native deployment", async () => {
    const fixture = backendFixture();
    fixture.site.objects.set("source/code.tar.gz", Buffer.from("code"));
    await fixture.service.configure(ownerId, backendId, { action: "deploy_function", function_id: "approval", file_id: fixture.site.source.file.id });
    expect((fixture.fetcher.mock.calls[0]?.[1]?.body as FormData).get("activate")).toBe("false");
    fixture.fetcher.mockResolvedValueOnce(Response.json({ status: "building" }));
    await expect(fixture.service.configure(ownerId, backendId, { action: "activate_function", function_id: "approval", deployment_id: "draft" })).rejects.toThrow("WEB_SITE_BACKEND_PENDING");
    expect(fixture.fetcher).toHaveBeenCalledTimes(2);
    fixture.fetcher.mockResolvedValueOnce(Response.json({ status: "ready" }));
    await fixture.service.configure(ownerId, backendId, { action: "activate_function", function_id: "approval", deployment_id: "draft" });
    expect(fixture.fetcher.mock.calls.at(-1)?.[1]?.method).toBe("PATCH");
  });

  it("serves stable dynamic links while updates preserve the original backend", async () => {
    const fixture = backendFixture();
    const first = await fixture.sites.create(ownerId, { conversation_id: taskId, file_id: fixture.site.source.file.id, name: "App", description: "", backend_id: backendId });
    const second = await fixture.sites.publish(ownerId, first.id, fixture.site.source.file.id);
    expect(first.url).toBe(`https://${appHostLabel(backendId)}.apps.example.net`);
    expect(second.url).toBe(first.url);
    expect(second.backend_id).toBe(backendId);
    const entry = await fixture.sites.publicEntry("sample");
    expect(entry.url).toBe(first.url);
  });

  it("finds and inspects the existing backend from another owned conversation without provisioning", async () => {
    const fixture = backendFixture();
    const conversationId = "20000000-0000-4000-8000-000000000002";
    const turnId = "70000000-0000-4000-8000-000000000001";
    const page = await fixture.sites.toolForOwner(ownerId, conversationId, turnId, {
      operation: "list", search: "Sample", limit: 20,
    }, fixture.config.publicBaseUrl);
    const existing = page.items[0];
    if (!existing?.backend_id) throw new Error("Expected an existing dynamic application");

    const backend = await fixture.sites.toolForOwner(ownerId, conversationId, turnId, {
      operation: "inspect_backend", backend_id: existing.backend_id,
    }, fixture.config.publicBaseUrl);

    expect(backend).toMatchObject({ id: backendId, project_id: fixture.row.projectId, origin: existing.url });
    expect(fixture.site.store.assertActiveTurn).toHaveBeenCalledWith(ownerId, conversationId, turnId);
    expect(fixture.store.reserve).not.toHaveBeenCalled();
    expect(fixture.fetcher).not.toHaveBeenCalled();
  });

  it.each([undefined, null])("rejects adding a legacy origin backend to a static site with backendId=%s", async (originalBackendId) => {
    const fixture = backendFixture();
    if (originalBackendId === undefined) delete fixture.site.row.site.backendId;
    else fixture.site.row.site.backendId = originalBackendId;
    await expect(fixture.sites.publish(
      ownerId, fixture.site.row.site.id, fixture.site.source.file.id, backendId,
    )).rejects.toThrow("CONFLICT");
    expect(fixture.site.row.site.backendId).toBe(originalBackendId);
    expect(fixture.site.store.publish).not.toHaveBeenCalled();
  });

  it.each([undefined, null])("adds a sandbox backend to an existing static application with backendId=%s", async originalBackendId => {
    const f = backendFixture();
    f.row.runtimeMode = "sandbox";
    if (originalBackendId === undefined) delete f.site.row.site.backendId;
    else f.site.row.site.backendId = originalBackendId;
    f.site.store.publish.mockImplementation(async () => ({
      ...f.site.row, site: { ...f.site.row.site, backendId },
    }));
    const before = (await f.sites.list(ownerId, { limit: 20 })).items[0];
    const result = await f.sites.publish(ownerId, f.site.row.site.id, f.site.source.file.id, backendId);
    expect(result).toMatchObject({ id: before!.id, backend_id: backendId, url_path: before!.url_path });
    expect(result.url).toBe(new URL(before!.url_path, f.config.publicBaseUrl).href);
    expect(f.site.store.publish).toHaveBeenCalledWith(ownerId, before!.id, taskId, f.site.source.file.id,
      expect.any(String), f.site.manifest, expect.any(Date), backendId);
    expect(f.row.leaseUntil).toBeNull();
  });

  it("does not read or publish static artifacts when the requested backend belongs to another owner", async () => {
    const f = backendFixture();
    f.row.runtimeMode = "sandbox";
    f.site.row.site.backendId = null;
    await expect(f.sites.publish(ownerId, siteId, f.site.source.file.id,
      "60000000-0000-4000-8000-000000000099")).rejects.toMatchObject({ code: "WEB_SITE_NOT_FOUND" });
    expect(f.site.store.source).not.toHaveBeenCalled();
    expect(f.site.store.publish).not.toHaveBeenCalled();
    expect(f.fetcher).not.toHaveBeenCalled();
  });

  it("leaves a static application's current release unchanged when its new backend resources are not ready", async () => {
    const f = backendFixture();
    f.row.runtimeMode = "sandbox";
    f.site.row.site.backendId = null;
    const previousRelease = f.site.row.site.currentReleaseId;
    f.fetcher.mockResolvedValue(Response.json({
      total: 1, functions: [{ deploymentId: "", latestDeploymentId: "", latestDeploymentStatus: "building" }],
    }));
    await expect(f.sites.publish(ownerId, siteId, f.site.source.file.id, backendId))
      .rejects.toMatchObject({ code: "WEB_SITE_BACKEND_PENDING" });
    expect(f.site.row.site.backendId).toBeNull();
    expect(f.site.row.site.currentReleaseId).toBe(previousRelease);
    expect(f.site.store.publish).not.toHaveBeenCalled();
    expect(f.row.leaseUntil).toBeNull();
  });

  it("keeps existing site management usable when the optional backend configuration is removed", async () => {
    const fixture = backendFixture();
    const disabled = new WebSiteBackendService(fixture.store, fixture.site.storage, { ...fixture.config, appwrite: null });
    const sites = new WebSiteService(fixture.site.store, fixture.site.storage, disabled);
    const listed = await sites.list(ownerId, { limit: 20 });
    expect(listed.items[0]).toMatchObject({ backend_id: backendId, url_path: `/app/id/${siteId}` });
    await expect(sites.publicEntry("sample")).rejects.toThrow("WEB_SITE_BACKEND_NOT_CONFIGURED");
    fixture.site.store.update.mockImplementation(async (_owner, _id, input) => {
      if (input.status) fixture.site.row.site.status = input.status;
      return fixture.site.row;
    });
    await expect(sites.update(ownerId, listed.items[0]!.id, { status: "disabled" })).resolves.toMatchObject({ backend_id: backendId, status: "disabled" });
  });
});
