import { Readable } from "node:stream";

import Fastify, { type FastifyRequest } from "fastify";
import multipart from "@fastify/multipart";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createContentSecurityPolicy,
  registerResponseSecurityHeaders,
} from "../src/app.js";
import { AppError } from "../src/lib/errors.js";
import { sendAppError } from "../src/lib/http.js";
import {
  applicationRoutes,
  interactiveApplicationRuntimeRoutes,
} from "../src/modules/applications/routes.js";
import type { ApplicationService } from "../src/modules/applications/service.js";

const USER_ID = "10000000-0000-4000-8000-000000000001";
const TARGET_USER_ID = "10000000-0000-4000-8000-000000000003";
const TARGET_GROUP_ID = "10000000-0000-4000-8000-000000000004";
const APPLICATION_ID = "20000000-0000-4000-8000-000000000001";
const GRANT_ID = "20000000-0000-4000-8000-000000000002";
const CONVERSATION_ID = "30000000-0000-4000-8000-000000000001";
const apps: Array<ReturnType<typeof Fastify>> = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("internal application routes", () => {
  it("validates an edit and its release together before publishing a standard application", async () => {
    const { app, service } = await applicationRouteFixture();
    const url = `/api/v1/applications/${APPLICATION_ID}/edit-and-publish`;
    const payload = { changes: { name: "Updated review", instructions: "Review carefully." }, release: { version_number: "1.2.4", usage_instructions: "Existing guide" } };
    expect((await app.inject({ method: "POST", url, payload })).statusCode).toBe(401);
    const headers = { authorization: "Bearer internal-user" };
    for (const invalid of [{ ...payload, release: { version_number: "1.2" } }, { ...payload, changes: {} }, { ...payload, owner_id: TARGET_USER_ID }]) {
      expect((await app.inject({ method: "POST", url, headers, payload: invalid })).statusCode).toBe(400);
    }
    expect(service.update).not.toHaveBeenCalled();
    const result = await app.inject({ method: "POST", url, headers, payload });
    expect(result.statusCode, result.body).toBe(200);
    expect(service.update).toHaveBeenCalledWith(expect.objectContaining({ id: USER_ID }), APPLICATION_ID, payload.changes, expect.any(Object), payload.release);
    service.update.mockRejectedValueOnce(new AppError("APPLICATION_NOT_FOUND"));
    expect((await app.inject({ method: "POST", url, headers, payload })).statusCode).toBe(404);
  });

  it("accepts a validated release with an updated ZIP and rejects malformed or duplicate release fields", async () => {
    const { app, service } = await applicationRouteFixture();
    const url = `/api/v1/applications/${APPLICATION_ID}/interactive-package`;
    expect((await app.inject({ method: "POST", url })).statusCode).toBe(401);
    async function upload(releases: string[], target = url) {
      const body = new FormData();
      body.append("dependencies", JSON.stringify({ bindings: [] }));
      for (const release of releases) body.append("release", release);
      body.append("file", new Blob(["zip-bytes"], { type: "application/zip" }), "app.zip");
      const request = new Request("http://localhost", { method: "POST", body });
      return app.inject({ method: "POST", url: target, headers: { authorization: "Bearer internal-user", "content-type": request.headers.get("content-type") ?? "" }, payload: Buffer.from(await request.arrayBuffer()) });
    }
    const release = { version_number: "1.2.3", usage_instructions: "Existing guide" };
    const result = await upload([JSON.stringify(release)]);
    expect(result.statusCode, result.body).toBe(200);
    expect(service.updateInteractivePackage).toHaveBeenCalledWith(expect.objectContaining({ id: USER_ID }), APPLICATION_ID, Buffer.from("zip-bytes"), expect.any(Object), [], { release });
    for (const values of [["{"], [JSON.stringify({ version_number: "1.2" })], [JSON.stringify(release), JSON.stringify(release)]]) {
      expect((await upload(values)).statusCode).toBe(400);
    }
    expect((await upload([JSON.stringify(release)], "/api/v1/applications/interactive-import")).statusCode).toBe(400);
    expect(service.updateInteractivePackage).toHaveBeenCalledOnce();
  });
  it("authenticates publication readiness, validates the application id and never caches task status", async () => {
    const { app, service } = await applicationRouteFixture();
    const url = `/api/v1/applications/${APPLICATION_ID}/publication-readiness`;
    const headers = { authorization: "Bearer internal-user" };
    expect((await app.inject({ method: "GET", url })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/api/v1/applications/invalid/publication-readiness", headers })).statusCode).toBe(400);
    expect(service.publicationReadiness).not.toHaveBeenCalled();
    const response = await app.inject({ method: "GET", url, headers });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(response.json().data).toEqual({ has_active_tasks: false });
    expect(service.publicationReadiness).toHaveBeenCalledWith(expect.objectContaining({ id: USER_ID }), APPLICATION_ID);
    service.publicationReadiness.mockRejectedValueOnce(new AppError("APPLICATION_NOT_FOUND"));
    expect((await app.inject({ method: "GET", url, headers })).statusCode).toBe(404);
  });
  it("authenticates the owned catalog and validates development filters without accepting another owner", async () => {
    const { app, service } = await applicationRouteFixture();
    const url = "/api/v1/applications/catalog";
    expect((await app.inject({ method: "GET", url })).statusCode).toBe(401);
    const headers = { authorization: "Bearer internal-user" };
    for (const query of [`owner_id=${TARGET_USER_ID}`, "state=shared", "limit=201", "search=", "scope=all"]) {
      expect((await app.inject({ method: "GET", url: `${url}?${query}`, headers })).statusCode).toBe(400);
    }
    expect(service.catalog).not.toHaveBeenCalled();
    const response = await app.inject({ method: "GET", url: `${url}?state=developing&search=Draft&limit=25`, headers });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(response.json().data).toEqual({ items: [], next_cursor: null });
    expect(service.catalog).toHaveBeenCalledWith(expect.objectContaining({ id: USER_ID }), { state: "developing", search: "Draft", limit: 25 });
    for (const state of ["standard", "interactive"]) {
      const filtered = await app.inject({ method: "GET", url: `${url}?state=${state}&search=Report&limit=10&cursor=next-page`, headers });
      expect(filtered.statusCode).toBe(200);
      expect(service.catalog).toHaveBeenLastCalledWith(expect.objectContaining({ id: USER_ID }), { state, search: "Report", limit: 10, cursor: "next-page" });
    }
    service.catalog.mockRejectedValueOnce(new AppError("FORBIDDEN"));
    expect((await app.inject({ method: "GET", url, headers })).statusCode).toBe(403);
  });
  it("authenticates and validates read-only details requests and passes the viewing channel", async () => {
    const { app, service } = await applicationRouteFixture();
    const url = `/api/v1/applications/${APPLICATION_ID}/details`;
    expect((await app.inject({ method: "GET", url })).statusCode).toBe(401);
    const headers = { authorization: "Bearer internal-user" };
    for (const invalid of [`${url}?channel=invalid`, `${url}?owner_id=${TARGET_USER_ID}`, "/api/v1/applications/invalid/details"]) {
      expect((await app.inject({ method: "GET", url: invalid, headers })).statusCode).toBe(400);
    }
    expect(service.details).not.toHaveBeenCalled();
    for (const channel of ["direct", "center"]) {
      const response = await app.inject({ method: "GET", url: channel === "direct" ? url : `${url}?channel=center`, headers });
      expect(response.statusCode).toBe(200);
      expect(response.headers["cache-control"]).toBe("private, no-store");
      expect(service.details).toHaveBeenLastCalledWith(expect.objectContaining({ id: USER_ID }), APPLICATION_ID, channel);
    }
    service.details.mockRejectedValueOnce(new AppError("APPLICATION_NOT_FOUND"));
    expect((await app.inject({ method: "GET", url, headers })).statusCode).toBe(404);
  });
  it("validates resource type and UUID cursors before listing declaration resources", async () => {
    const { app, service } = await applicationRouteFixture();
    const headers = { authorization: "Bearer internal-user" };
    for (const query of ["type=skill&cursor=invalid", "type=unknown", "type=skill&owner_id=other"]) {
      expect((await app.inject({ method: "GET", url: `/api/v1/applications/interactive-dependency-options?${query}`, headers })).statusCode).toBe(400);
    }
    expect(service.interactiveDependencyOptions).not.toHaveBeenCalled();
    const response = await app.inject({ method: "GET", url: `/api/v1/applications/interactive-dependency-options?type=skill&search=Review&cursor=${APPLICATION_ID}`, headers });
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual({ items: [], next_cursor: null });
    expect(service.interactiveDependencyOptions).toHaveBeenCalledWith(expect.objectContaining({ id: USER_ID }), "skill", "Review", APPLICATION_ID);
  });
  it.each([true, false])("accepts optional mapping fields before or after the ZIP (field first: %s)", async fieldFirst => {
    const { app, service } = await applicationRouteFixture();
    const bindings = [{ type: "skill", id: TARGET_USER_ID, resource_id: null }];
    const form = new FormData();
    if (fieldFirst) form.append("dependencies", JSON.stringify({ bindings }));
    form.append("file", new Blob(["zip-bytes"], { type: "application/zip" }), "app.zip");
    if (!fieldFirst) form.append("dependencies", JSON.stringify({ bindings }));
    const upload = new Request("http://localhost", { method: "POST", body: form });
    const response = await app.inject({ method: "POST", url: "/api/v1/applications/interactive-import", headers: { authorization: "Bearer internal-user", "content-type": upload.headers.get("content-type") ?? "" }, payload: Buffer.from(await upload.arrayBuffer()) });
    expect(response.statusCode, response.body).toBe(201);
    expect(service.importInteractive).toHaveBeenCalledWith(expect.objectContaining({ id: USER_ID }), Buffer.from("zip-bytes"), expect.any(Object), bindings);
  });
  it("returns parsed application information with the resource preview without importing", async () => {
    const { app, service } = await applicationRouteFixture();
    const url = "/api/v1/applications/interactive-import/preview";
    expect((await app.inject({ method: "POST", url })).statusCode).toBe(401);
    expect(service.previewInteractiveDependencies).not.toHaveBeenCalled();
    const form = new FormData();
    form.append("file", new Blob(["zip"], { type: "application/zip" }), "app.zip");
    const upload = new Request("http://localhost", { method: "POST", body: form });
    const response = await app.inject({ method: "POST", url, headers: { authorization: "Bearer internal-user", "content-type": upload.headers.get("content-type") ?? "" }, payload: Buffer.from(await upload.arrayBuffer()) });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().data).toEqual({ items: [], application: { name: "Review", description: "Review requests", version: "1.2.3" } });
    expect(service.importInteractive).not.toHaveBeenCalled();
    expect(service.previewInteractiveDependencies).toHaveBeenCalledWith(expect.objectContaining({ id: USER_ID }), Buffer.from("zip"), undefined);
  });
  it("authenticates dependency endpoints and validates mappings before changing the application", async () => {
    const { app, service } = await applicationRouteFixture();
    for (const url of [`/api/v1/applications/${APPLICATION_ID}/interactive-dependencies`, "/api/v1/applications/interactive-dependency-options?type=skill"]) {
      expect((await app.inject({ method: "GET", url })).statusCode).toBe(401);
    }
    const headers = { authorization: "Bearer internal-user" };
    const read = await app.inject({ method: "GET", url: `/api/v1/applications/${APPLICATION_ID}/interactive-dependencies`, headers });
    expect(read.statusCode).toBe(200);
    const invalid = await app.inject({ method: "PATCH", url: `/api/v1/applications/${APPLICATION_ID}/interactive-dependencies`, headers, payload: { bindings: [{ type: "skill", id: "slug", resource_id: null }] } });
    expect(invalid.statusCode).toBe(400); expect(service.updateInteractiveDependencies).not.toHaveBeenCalled();
    const valid = await app.inject({ method: "PATCH", url: `/api/v1/applications/${APPLICATION_ID}/interactive-dependencies`, headers, payload: { bindings: [] } });
    expect(valid.statusCode).toBe(200);
    expect(service.updateInteractiveDependencies).toHaveBeenCalledWith(expect.objectContaining({ id: USER_ID }), APPLICATION_ID, [], expect.any(Object));
  });
  it("rejects malformed mapping JSON and permits uploads without a mapping field", async () => {
    const { app, service } = await applicationRouteFixture();
    for (const value of ["not-json", undefined]) {
      const form = new FormData();
      form.append("file", new Blob(["zip"], { type: "application/zip" }), "app.zip");
      if (value) form.append("dependencies", value);
      const upload = new Request("http://localhost", { method: "POST", body: form });
      const response = await app.inject({ method: "POST", url: "/api/v1/applications/interactive-import", headers: { authorization: "Bearer internal-user", "content-type": upload.headers.get("content-type") ?? "" }, payload: Buffer.from(await upload.arrayBuffer()) });
      expect(response.statusCode, response.body).toBe(value ? 400 : 201);
    }
    expect(service.importInteractive).toHaveBeenCalledOnce();
  });
  it("accepts an omitted usage guide without relaxing version or length validation", async () => {
    const { app, service } = await applicationRouteFixture();
    const headers = { authorization: "Bearer internal-user" };
    const response = await app.inject({ method: "POST", url: `/api/v1/applications/${APPLICATION_ID}/share`, headers, payload: { version_number: "1.0.0", target: null } });
    expect(response.statusCode).toBe(200);
    expect(service.share).toHaveBeenCalledWith(expect.objectContaining({ id: USER_ID }), APPLICATION_ID, { version_number: "1.0.0", usage_instructions: "", target: null }, expect.any(Object));
    for (const payload of [{ target: null }, { version_number: "1.0.0", target: null, usage_instructions: "x".repeat(20_001) }]) {
      const invalid = await app.inject({ method: "POST", url: `/api/v1/applications/${APPLICATION_ID}/share`, headers, payload });
      expect(invalid.statusCode).toBe(400);
    }
    expect(service.share).toHaveBeenCalledOnce();
  });
  it("authenticates publication and installation routes and rejects credential fields", async () => {
    const { app, service } = await applicationRouteFixture();
    for (const [method, suffix] of [["GET", "publication"], ["GET", "distribution/settings"], ["POST", "share"], ["POST", "install"]] as const) {
      const response = await app.inject({ method, url: `/api/v1/applications/${APPLICATION_ID}/${suffix}` });
      expect(response.statusCode).toBe(401);
    }
    const headers = { authorization: "Bearer internal-user" };
    const read = await app.inject({ method: "GET", url: `/api/v1/applications/${APPLICATION_ID}/publication`, headers });
    expect(read.statusCode).toBe(200);
    expect(service.getPublication).toHaveBeenCalledWith(expect.objectContaining({ id: USER_ID }), APPLICATION_ID);
    const settings = await app.inject({ method: "GET", url: `/api/v1/applications/${APPLICATION_ID}/distribution/settings`, headers });
    expect(settings.statusCode).toBe(200);
    expect(service.distributionSettings).toHaveBeenCalledWith(expect.objectContaining({ id: USER_ID }), APPLICATION_ID);
    const missingVersion = await app.inject({ method: "POST", url: `/api/v1/applications/${APPLICATION_ID}/publish`, headers, payload: { usage_instructions: "Configure your account." } });
    expect(missingVersion.statusCode).toBe(400);
    const shared = await app.inject({ method: "POST", url: `/api/v1/applications/${APPLICATION_ID}/share`, headers, payload: { version_number: "1.0.0", usage_instructions: "Configure your account.", target: null } });
    expect(shared.statusCode).toBe(200);
    expect(service.share).toHaveBeenCalledWith(expect.objectContaining({ id: USER_ID }), APPLICATION_ID, { version_number: "1.0.0", usage_instructions: "Configure your account.", target: null }, expect.any(Object));
    const denied = await app.inject({ method: "POST", url: `/api/v1/applications/${APPLICATION_ID}/install`, headers, payload: { name: "Copy", credential_id: GRANT_ID } });
    expect(denied.statusCode).toBe(400); expect(service.install).not.toHaveBeenCalled();
    const copied = await app.inject({ method: "POST", url: `/api/v1/applications/${APPLICATION_ID}/install`, headers, payload: { name: "Copy", channel: "direct", version_id: APPLICATION_ID } });
    expect(copied.statusCode).toBe(201);
    expect(service.install).toHaveBeenCalledWith(expect.objectContaining({ id: USER_ID }), APPLICATION_ID, { name: "Copy", channel: "direct", version_id: APPLICATION_ID }, expect.any(Object));
  });

  it("returns an owner-scoped application usage report", async () => {
    const { app, usageAnalytics } = await applicationRouteFixture();

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/applications/${APPLICATION_ID}/usage?range=7d&time_zone=Asia%2FShanghai`,
      headers: { authorization: "Bearer internal-user" },
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(response.json()).toMatchObject({
      success: true,
      data: { active_user_count: 2 },
    });
    expect(usageAnalytics.applicationReport).toHaveBeenCalledWith(
      USER_ID,
      APPLICATION_ID,
      { range: "7d", time_zone: "Asia/Shanghai" },
    );
  });

  it("requires an authenticated organization user", async () => {
    const { app, service } = await applicationRouteFixture();

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/applications",
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ error_code: "AUTH_REQUIRED" });
    expect(service.list).not.toHaveBeenCalled();
  });

  it("does not expose an anonymous public application endpoint", async () => {
    const { app } = await applicationRouteFixture();

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/public/applications/${APPLICATION_ID}`,
    });

    expect(response.statusCode).toBe(404);
  });

  it("forwards the requested application share target type", async () => {
    const { app, service } = await applicationRouteFixture();

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/applications/share-targets?type=user_group&search=finance&limit=25",
      headers: { authorization: "Bearer internal-user" },
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(service.searchShareTargets).toHaveBeenCalledWith(
      expect.objectContaining({ id: USER_ID }),
      { type: "user_group", search: "finance", limit: 25 },
    );
  });

  it("delegates application authorization and runtime resolution to conversation creation", async () => {
    const { app, service, createConversation } =
      await applicationRouteFixture();

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/applications/${APPLICATION_ID}/conversations`,
      headers: { authorization: "Bearer internal-user" },
    });

    expect(response.statusCode, response.body).toBe(201);
    expect(service.resolveRuntime).not.toHaveBeenCalled();
    expect(createConversation).toHaveBeenCalledWith(USER_ID, {
      id: APPLICATION_ID,
      channel: "direct",
    });
    expect(response.json()).toMatchObject({
      success: true,
      data: { conversation_id: CONVERSATION_ID },
    });
  });

  it("returns the creation service's access denial without creating a successful task response", async () => {
    const { app, createConversation, service } = await applicationRouteFixture();
    createConversation.mockRejectedValueOnce(new AppError("FORBIDDEN"));
    const response = await app.inject({ method: "POST", url: `/api/v1/applications/${APPLICATION_ID}/conversations`, headers: { authorization: "Bearer internal-user" }, payload: { channel: "center" } });
    expect(response.statusCode).toBe(403);
    expect(createConversation).toHaveBeenCalledExactlyOnceWith(USER_ID, { id: APPLICATION_ID, channel: "center" });
    expect(service.resolveRuntime).not.toHaveBeenCalled();
  });

  it("issues a short-lived package-bound runtime URL", async () => {
    const { app, service } = await applicationRouteFixture();
    service.createInteractiveRuntimeTicket.mockResolvedValueOnce({
      token: "a".repeat(43),
      expiresAt: new Date("2026-08-25T01:00:00.000Z"),
      manifest: {
        schema_version: 1,
        id: "research-workbench",
        name: "Research workbench",
        version: "1.0.0",
        sdk_version: 1,
      },
    });

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/applications/${APPLICATION_ID}/interactive-runtime-token`,
      headers: { authorization: "Bearer internal-user" },
      payload: {
        package_id: "40000000-0000-4000-8000-000000000001",
      },
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({
      success: true,
      data: {
        runtime_url: expect.stringMatching(
          /^\/api\/v1\/interactive-app-runtime\/.+\/index\.html$/u,
        ),
        manifest: {
          id: "research-workbench",
          version: "1.0.0",
        },
      },
    });
  });

  it("serves a package-bound runtime without inherited browser restrictions while protecting other routes", async () => {
    const app = Fastify();
    apps.push(app);
    registerResponseSecurityHeaders(app);
    app.get("/ordinary-page", async () => "<!doctype html><title>Host</title>");
    app.setErrorHandler((error, request, reply) =>
      sendAppError(reply, request, error),
    );
    const service = {
      getInteractiveAssetForTicket: vi.fn(async () => ({
        data: Readable.from(Buffer.from("<!doctype html><title>App</title>")),
        contentType: "text/html; charset=utf-8",
        byteSize: 33,
        etag: "a".repeat(64),
      })),
    };
    await app.register(interactiveApplicationRuntimeRoutes, {
      prefix: "/api/v1/interactive-app-runtime",
      service: service as unknown as ApplicationService,
    });
    const token = "a".repeat(43);

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/interactive-app-runtime/${token}/index.html`,
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(response.headers["content-security-policy"]).toBeUndefined();
    expect(response.headers["x-frame-options"]).toBeUndefined();
    expect(response.headers["permissions-policy"]).toBeUndefined();
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(service.getInteractiveAssetForTicket).toHaveBeenCalledWith(
      token,
      "index.html",
    );

    const sdk = await app.inject("/api/v1/interactive-app-runtime/sdk/v1.js");
    expect(sdk.statusCode).toBe(200);
    expect(sdk.headers["cache-control"]).toBe("no-cache");
    const freshSdk = await app.inject("/api/v1/interactive-app-runtime/sdk/v1.js?v=1.2.0");
    expect(freshSdk.statusCode).toBe(200);
    expect(freshSdk.body).toContain('version: "1.2.0"');
    expect(freshSdk.body).toContain('request("files.upload", { file })');
    expect(sdk.headers["content-security-policy"]).toBeUndefined();

    const ordinary = await app.inject("/ordinary-page");
    expect(ordinary.headers["content-security-policy"]).toBe(
      createContentSecurityPolicy(),
    );
    expect(ordinary.headers["x-frame-options"]).toBe("SAMEORIGIN");
    expect(ordinary.headers["permissions-policy"]).toBe(
      "camera=(), microphone=(self), geolocation=()",
    );

    service.getInteractiveAssetForTicket.mockRejectedValueOnce(
      new AppError("FORBIDDEN"),
    );
    const denied = await app.inject(
      `/api/v1/interactive-app-runtime/${token}/index.html`,
    );
    expect(denied.statusCode).toBe(403);
    expect(denied.body).not.toContain("<!doctype html>");

    service.getInteractiveAssetForTicket.mockClear();
    const invalid = await app.inject(
      "/api/v1/interactive-app-runtime/invalid/index.html",
    );
    expect(invalid.statusCode).toBe(400);
    expect(service.getInteractiveAssetForTicket).not.toHaveBeenCalled();
  });

  it("validates and wires the complete owner management lifecycle", async () => {
    const { app, service } = await applicationRouteFixture();
    service.create.mockResolvedValueOnce({ id: APPLICATION_ID });
    service.update.mockResolvedValueOnce({ id: APPLICATION_ID });
    service.revokeGrant.mockResolvedValueOnce({
      code: "APPLICATION_GRANT_REVOKED",
    });
    service.delete.mockResolvedValueOnce(undefined);

    const createResponse = await app.inject({
      method: "POST",
      url: "/api/v1/applications",
      headers: { authorization: "Bearer internal-user" },
      payload: {
        name: "  Finance assistant  ",
        description: "Internal finance guidance",
        instructions: "Use approved internal sources.",
        model: "gpt-5.6-terra",
        reasoning_effort: "medium",
        capability_ids: [],
        knowledge_base_ids: [],
      },
    });
    expect(createResponse.statusCode, createResponse.body).toBe(201);
    expect(service.create).toHaveBeenCalledWith(
      expect.objectContaining({ id: USER_ID, status: "active" }),
      expect.objectContaining({
        name: "Finance assistant",
        model: "gpt-5.6-terra",
        reasoning_effort: "medium",
      }),
      expect.objectContaining({ ipAddress: expect.any(String) }),
    );

    const updateResponse = await app.inject({
      method: "PATCH",
      url: `/api/v1/applications/${APPLICATION_ID}`,
      headers: { authorization: "Bearer internal-user" },
      payload: {
        instructions: "Use the latest approved internal sources.",
        status: "disabled",
      },
    });
    expect(updateResponse.statusCode, updateResponse.body).toBe(200);
    expect(service.update).toHaveBeenCalledWith(
      expect.objectContaining({ id: USER_ID }),
      APPLICATION_ID,
      {
        instructions: "Use the latest approved internal sources.",
        status: "disabled",
      },
      expect.any(Object),
    );

    const directGrantResponse = await app.inject({
      method: "POST",
      url: `/api/v1/applications/${APPLICATION_ID}/share`,
      headers: { authorization: "Bearer internal-user" },
      payload: { version_number: "1.0.0", usage_instructions: "Use this application.", target: { grantee_type: "user", user_id: TARGET_USER_ID, usage_modes: ["service"] } },
    });
    expect(directGrantResponse.statusCode, directGrantResponse.body).toBe(200);
    expect(service.share).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ id: USER_ID }),
      APPLICATION_ID,
      { version_number: "1.0.0", usage_instructions: "Use this application.", target: { grantee_type: "user", user_id: TARGET_USER_ID, usage_modes: ["service"] } },
      expect.any(Object),
    );

    const groupGrantResponse = await app.inject({
      method: "POST",
      url: `/api/v1/applications/${APPLICATION_ID}/share`,
      headers: { authorization: "Bearer internal-user" },
      payload: {
        version_number: "1.0.0", usage_instructions: "Use this application.", target: {
        grantee_type: "user_group",
        user_group_id: TARGET_GROUP_ID,
        usage_modes: ["install", "service"],
        },
      },
    });
    expect(groupGrantResponse.statusCode, groupGrantResponse.body).toBe(200);
    expect(service.share).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ id: USER_ID }),
      APPLICATION_ID,
      { version_number: "1.0.0", usage_instructions: "Use this application.", target: { grantee_type: "user_group", user_group_id: TARGET_GROUP_ID, usage_modes: ["install", "service"] } },
      expect.any(Object),
    );

    const revokeResponse = await app.inject({
      method: "DELETE",
      url: `/api/v1/applications/${APPLICATION_ID}/grants/${GRANT_ID}`,
      headers: { authorization: "Bearer internal-user" },
    });
    expect(revokeResponse.statusCode, revokeResponse.body).toBe(200);
    expect(service.revokeGrant).toHaveBeenCalledWith(
      expect.objectContaining({ id: USER_ID }),
      APPLICATION_ID,
      GRANT_ID,
      expect.any(Object),
    );

    const deleteResponse = await app.inject({
      method: "DELETE",
      url: `/api/v1/applications/${APPLICATION_ID}`,
      headers: { authorization: "Bearer internal-user" },
    });
    expect(deleteResponse.statusCode, deleteResponse.body).toBe(204);
    expect(service.delete).toHaveBeenCalledWith(
      expect.objectContaining({ id: USER_ID }),
      APPLICATION_ID,
      expect.any(Object),
    );
  });
});

async function applicationRouteFixture() {
  const app = Fastify();
  await app.register(multipart);
  apps.push(app);
  app.decorate("authenticate", async (request: FastifyRequest) => {
    if (request.headers.authorization !== "Bearer internal-user") {
      throw new AppError("AUTH_REQUIRED");
    }
    request.authUser = {
      id: USER_ID,
      email: "member@example.test",
      name: "Member",
      role: "user",
      status: "active",
      preferredLocale: "zh-CN",
      avatarObjectKey: null,
      authValidAfter: new Date(0),
    };
  });
  app.setErrorHandler((error, request, reply) =>
    sendAppError(reply, request, error),
  );
  const service = {
    importInteractive: vi.fn(async () => ({ id: APPLICATION_ID })),
    updateInteractivePackage: vi.fn(async () => ({ id: APPLICATION_ID })),
    previewInteractiveDependencies: vi.fn(async () => ({ items: [], application: { name: "Review", description: "Review requests", version: "1.2.3" } })),
    interactiveDependencies: vi.fn(async () => ({ items: [] })),
    interactiveDependencyOptions: vi.fn(async () => ({ items: [], next_cursor: null })),
    updateInteractiveDependencies: vi.fn(async () => ({ id: APPLICATION_ID })),
    getPublication: vi.fn(async () => ({ version_id: null, version_number: null, usage_instructions: "" })),
    distributionSettings: vi.fn(async () => ({ version_number: "1.0.0", highest_version_number: null, usage_instructions: "" })),
    publicationReadiness: vi.fn(async () => ({ has_active_tasks: false })),
    share: vi.fn(async () => ({ version_id: APPLICATION_ID, version_number: "1.0.0", usage_instructions: "Configure your account." })),
    install: vi.fn(async () => ({ id: APPLICATION_ID })),
    list: vi.fn(async () => []),
    catalog: vi.fn(async () => ({ items: [], next_cursor: null })),
    get: vi.fn(),
    details: vi.fn(async () => ({ id: APPLICATION_ID, resources: [] })),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    listGrants: vi.fn(async () => []),
    revokeGrant: vi.fn(),
    searchShareTargets: vi.fn(async () => []),
    resolveRuntime: vi.fn(async () => ({
      interactivePackageId: null as string | null,
      applicationId: APPLICATION_ID,
      applicationOwnerId: "10000000-0000-4000-8000-000000000002",
      applicationName: "Finance assistant",
      applicationUpdatedAt: new Date("2026-07-27T00:00:00.000Z"),
      instructions: "Use the finance workflow.",
      model: "gpt-5.6-terra",
      reasoningEffort: "medium" as const,
      capabilityIds: [],
      knowledgeBaseIds: [],
    })),
    createInteractiveRuntimeTicket: vi.fn(),
  };
  const createConversation = vi.fn(async () => ({ id: CONVERSATION_ID }));
  const usageAnalytics = {
    applicationReport: vi.fn(async () => ({ active_user_count: 2 })),
  };
  await app.register(
    async (scope) => {
      scope.addHook("preHandler", app.authenticate);
      await scope.register(applicationRoutes, {
        service: service as unknown as ApplicationService,
        usageAnalytics: usageAnalytics as never,
        createConversation,
      });
    },
    { prefix: "/api/v1/applications" },
  );
  return { app, service, usageAnalytics, createConversation };
}
