import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { publicKnowledgeSettingsSchema } from "@linksense/shared";
import {
  publicKnowledgeVisitorRoutes,
  publicKnowledgeManagementRoutes,
} from "../src/modules/public-knowledge/routes.js";
import type { PublicKnowledgeService } from "../src/modules/public-knowledge/service.js";
import { AppError, normalizeError } from "../src/lib/errors.js";
import { registerMaintenanceGuard } from "../src/app.js";

const publicId = "public-application-identifier-1234",
  appId = "00000000-0000-4000-8000-000000000001",
  conversationId = "00000000-0000-4000-8000-000000000002";
describe("public knowledge HTTP boundary", () => {
  it("blocks anonymous public requests during maintenance without trying the owner's login", async () => {
    const app = Fastify(),
      authenticate = vi.fn(async () => {
        throw new AppError("AUTH_REQUIRED");
      });
    app.decorate("authenticate", authenticate);
    app.setErrorHandler((error, _request, reply) =>
      reply.code(503).send({ error_code: normalizeError(error).code }),
    );
    registerMaintenanceGuard(app, {
      getMaintenanceStatus: async () => ({
        enabled: true,
        active: true,
        reason: "",
        start_at: null,
        end_at: null,
      }),
    });
    app.post(`/api/v1/public-knowledge/${publicId}/sessions`, async () => ({
      success: true,
    }));
    try {
      for (const headers of [
        {},
        { authorization: "Bearer owner-admin-session" },
      ]) {
        const result = await app.inject({
          method: "POST",
          url: `/api/v1/public-knowledge/${publicId}/sessions`,
          headers,
        });
        expect(result.statusCode).toBe(503);
        expect(result.json().error_code).toBe("SYSTEM_MAINTENANCE_ACTIVE");
      }
      expect(authenticate).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
  async function fixture(authenticated = false) {
    const service = {
      closeEventStreams: vi.fn(),
      save: vi.fn(async () => ({})),
      visitorEvents: vi.fn(async function* () {
        yield ": ready\n\n";
      }),
      publicConfiguration: vi.fn(async () => ({
        name: '<script>alert("x")</script>',
        description: null,
        icon: { type: "preset", preset: "globe-2" },
        retention_days: 30,
      })),
      startSession: vi.fn(),
      createConversation: vi.fn(),
      ask: vi.fn(),
      listOwnerConversations: vi.fn(),
      ownerDetail: vi.fn(),
      visitorDetail: vi.fn(),
      setEnabled: vi.fn(async () => ({ enabled: false })),
      usage: vi.fn(async () => ({ questions: 0 })),
    };
    const app = Fastify();
    app.setErrorHandler((error, _request, reply) => {
      const normalized = normalizeError(error);
      reply
        .code(
          normalized.code === "AUTH_REQUIRED"
            ? 401
            : normalized.code === "FORBIDDEN"
              ? 403
              : 400,
        )
        .send({ error_code: normalized.code });
    });
    await app.register(publicKnowledgeVisitorRoutes, {
      service: service as unknown as PublicKnowledgeService,
      developmentAssets: false,
      prefix: "/public",
    });
    await app.register(publicKnowledgeManagementRoutes, {
      service: service as unknown as PublicKnowledgeService,
      prefix: "/owner",
      resolveActor: () => {
        if (authenticated) return { id: appId, role: "user", status: "active" };
        throw new AppError("AUTH_REQUIRED");
      },
    });
    return { app, service };
  }
  it.each(["POST", "PUT"] as const)("accepts a selected or uploaded logo through the authenticated %s endpoint", async (method) => {
    const { app, service } = await fixture(true);
    const settings = publicKnowledgeSettingsSchema.parse({
      name: "Website", instructions: "Use evidence", model: "model", reasoning_effort: "medium",
      knowledge_base_ids: [appId], allowed_origins: ["https://website.example"],
    });
    const url = method === "POST" ? "/owner/public-knowledge" : `/owner/${appId}/public-knowledge`;
    try {
      for (const icon of [
        { type: "preset", preset: "globe-2" },
        { type: "upload", filename: "website.png", mime_type: "image/png", data_base64: "AAAA".repeat(20_000) },
      ]) {
        const response = await app.inject({ method, url, payload: { ...settings, icon } });
        expect(response.statusCode).toBe(method === "POST" ? 201 : 200);
        expect(service.save).toHaveBeenLastCalledWith(
          { id: appId, role: "user", status: "active" },
          { ...settings, icon },
          ...(method === "POST" ? [] : [appId]),
        );
      }
      service.save.mockClear();
      for (const icon of [
        { type: "custom", url: "https://example.test/foreign.png", fallback_preset: "bot" },
        { type: "upload", filename: "unsafe.svg", mime_type: "image/svg+xml", data_base64: "AAAA" },
      ]) expect((await app.inject({ method, url, payload: { ...settings, icon } })).statusCode).toBe(400);
      expect(service.save).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });
  it("requires visitor credentials and validates questions before dispatch", async () => {
    const { app, service } = await fixture();
    try {
      expect(
        (
          await app.inject({
            method: "GET",
            url: `/public/${publicId}/conversations/${conversationId}`,
          })
        ).statusCode,
      ).toBe(401);
      expect(
        (
          await app.inject({
            method: "POST",
            url: `/public/${publicId}/conversations/${conversationId}/turns`,
            headers: { authorization: "Bearer test-token" },
            payload: { input_text: "a".repeat(4001), request_id: appId },
          })
        ).statusCode,
      ).toBe(400);
      expect(
        (
          await app.inject({
            method: "POST",
            url: `/public/${publicId}/conversations/${conversationId}/turns`,
            headers: { authorization: "Bearer test-token" },
            payload: {
              input_text: "Question",
              request_id: appId,
              model: "override",
            },
          })
        ).statusCode,
      ).toBe(400);
      expect(service.ask).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
  it("does not allow an anonymous visitor into creator inspection", async () => {
    const { app, service } = await fixture();
    try {
      expect(
        (
          await app.inject({
            method: "GET",
            url: `/owner/${appId}/public-knowledge/conversations`,
          })
        ).statusCode,
      ).toBe(401);
      expect(
        (
          await app.inject({
            method: "GET",
            url: `/owner/${appId}/public-knowledge/conversations/${conversationId}`,
            headers: { authorization: "Bearer anonymous-token" },
          })
        ).statusCode,
      ).toBe(401);
      expect(service.ownerDetail).not.toHaveBeenCalled();
      for (const route of [
        { method: "POST" as const, url: "/owner/public-knowledge", payload: {} },
        { method: "PUT" as const, url: `/owner/${appId}/public-knowledge`, payload: {} },
      ]) expect((await app.inject(route)).statusCode).toBe(401);
      expect(service.save).not.toHaveBeenCalled();
      for (const route of [
        {
          method: "PATCH" as const,
          url: `/owner/${appId}/public-knowledge/status`,
          payload: { enabled: false },
        },
        {
          method: "GET" as const,
          url: `/owner/${appId}/public-knowledge/usage`,
        },
      ])
        expect((await app.inject(route)).statusCode).toBe(401);
      expect(service.setEnabled).not.toHaveBeenCalled();
      expect(service.usage).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
  it("escapes frame metadata and restricts its parent without exposing private configuration", async () => {
    const { app } = await fixture();
    try {
      const result = await app.inject(
        `/public/frame/${publicId}?parent_origin=https%3A%2F%2Fwebsite.example&locale=ja-JP`,
      );
      expect(result.statusCode).toBe(200);
      expect(result.headers["content-security-policy"]).toContain(
        "frame-ancestors https://website.example",
      );
      expect(result.headers["content-security-policy"]).not.toContain(
        "script-src 'self' 'unsafe-inline'",
      );
      expect(result.body).toContain('lang="ja-JP"');
      expect(result.body).not.toContain('<script>alert("x")</script>');
      expect(result.body).toContain("/assets/public-knowledge-app.js");
      expect(result.body).toContain('&quot;icon&quot;:{&quot;type&quot;:&quot;preset&quot;,&quot;preset&quot;:&quot;globe-2&quot;}');
      expect(result.headers["cache-control"]).toBe("private, no-store");
    } finally {
      await app.close();
    }
  });
});
