import { Readable } from "node:stream";

import Fastify, { type FastifyRequest } from "fastify";
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
    const obsolete = await app.inject({ method: "POST", url: `/api/v1/applications/${APPLICATION_ID}/publish`, headers, payload: { usage_instructions: "Configure your account." } });
    expect(obsolete.statusCode).toBe(404);
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

  it("creates a private conversation only after resolving current access and runtime", async () => {
    const { app, service, createConversation } =
      await applicationRouteFixture();

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/applications/${APPLICATION_ID}/conversations`,
      headers: { authorization: "Bearer internal-user" },
    });

    expect(response.statusCode, response.body).toBe(201);
    expect(service.resolveRuntime).toHaveBeenCalledWith(
      USER_ID,
      APPLICATION_ID,
      undefined,
      "direct",
    );
    expect(createConversation).toHaveBeenCalledWith(USER_ID, {
      id: APPLICATION_ID,
      name: "Finance assistant",
      kind: "standard",
      interactivePackageId: null,
      channel: "direct",
    });
    expect(response.json()).toMatchObject({
      success: true,
      data: { conversation_id: CONVERSATION_ID },
    });
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
    const freshSdk = await app.inject("/api/v1/interactive-app-runtime/sdk/v1.js?v=1.1.0");
    expect(freshSdk.statusCode).toBe(200);
    expect(freshSdk.body).toContain('version: "1.1.0"');
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
    getPublication: vi.fn(async () => ({ version_id: null, version_number: null, usage_instructions: "" })),
    distributionSettings: vi.fn(async () => ({ version_number: "1.0.0", highest_version_number: null, usage_instructions: "" })),
    share: vi.fn(async () => ({ version_id: APPLICATION_ID, version_number: "1.0.0", usage_instructions: "Configure your account." })),
    install: vi.fn(async () => ({ id: APPLICATION_ID })),
    list: vi.fn(async () => []),
    get: vi.fn(),
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
