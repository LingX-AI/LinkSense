import { describe, expect, it, vi } from "vitest";
import { webSiteBackendConfigureSchema } from "@linksense/shared";
import { AppwriteClient } from "../src/modules/web-site-backends/appwrite.js";
import { WebSiteBackendService } from "../src/modules/web-site-backends/service.js";
import { WebSiteService } from "../src/modules/web-sites/service.js";
import { backendFixture, backendId } from "./web-site-backends.fixture.js";
import { ownerId, taskId } from "./web-sites.fixture.js";

describe("self-hosted Appwrite backend", () => {
  it("uses native short-lived console authentication and revokes it after provisioning", async () => {
    const { config } = backendFixture();
    const fetcher = vi.fn<typeof fetch>(async (url) => {
      const path = new URL(String(url)).pathname;
      return path.endsWith("/sessions/email") ? Response.json({ secret: "" }, { headers: { "set-cookie": "a_session_console=test-console-session; Path=/; HttpOnly" } })
        : Response.json(path.endsWith("/keys") ? { secret: "test-project-management-key" } : path === "/v1/teams" ? { total: 1, teams: [{ $id: "organization" }] } : {});
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
    expect(first.url).toBe(`https://${backendId}.apps.example.net`);
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

  it.each([undefined, null])("rejects adding a backend to a historical static site with backendId=%s", async (originalBackendId) => {
    const fixture = backendFixture();
    if (originalBackendId === undefined) delete fixture.site.row.site.backendId;
    else fixture.site.row.site.backendId = originalBackendId;
    await expect(fixture.sites.publish(
      ownerId, fixture.site.row.site.id, fixture.site.source.file.id, backendId,
    )).rejects.toThrow("CONFLICT");
    expect(fixture.site.row.site.backendId).toBe(originalBackendId);
    expect(fixture.site.store.publish).not.toHaveBeenCalled();
  });

  it("keeps existing site management usable when the optional backend configuration is removed", async () => {
    const fixture = backendFixture();
    const disabled = new WebSiteBackendService(fixture.store, fixture.site.storage, { ...fixture.config, appwrite: null });
    const sites = new WebSiteService(fixture.site.store, fixture.site.storage, disabled);
    const listed = await sites.list(ownerId, { limit: 20 });
    expect(listed.items[0]).toMatchObject({ backend_id: backendId, url_path: "/web/sample" });
    await expect(sites.publicEntry("sample")).rejects.toThrow("WEB_SITE_BACKEND_NOT_CONFIGURED");
    fixture.site.store.update.mockImplementation(async (_owner, _id, input) => {
      if (input.status) fixture.site.row.site.status = input.status;
      return fixture.site.row;
    });
    await expect(sites.update(ownerId, listed.items[0]!.id, { status: "disabled" })).resolves.toMatchObject({ backend_id: backendId, status: "disabled" });
  });
});
