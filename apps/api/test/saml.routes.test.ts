import { afterEach, describe, expect, it, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import pino from "pino";
import type { PrismaClient } from "../src/generated/prisma/client.js";
import { authenticationPlugin } from "../src/plugins/authentication.js";
import { samlRoutes } from "../src/modules/saml/routes.js";
import type { SamlProtocol } from "../src/modules/saml/protocol.js";
import type { SamlSettingsService } from "../src/modules/saml/settings.js";
import type { AuthService } from "../src/modules/auth/service.js";
import { AppError } from "../src/lib/errors.js";
import { SENSITIVE_REQUEST_LOG_PATHS } from "../src/app.js";
import { createApiCorsOptions } from "../src/lib/cors.js";
import { registerClientBuildGuard } from "../src/plugins/client-build.js";

const apps: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});
async function fixture(role: "admin" | "user" = "admin") {
  const app = Fastify();
  apps.push(app);
  await app.register(
    cors,
    createApiCorsOptions("https://linksense.example.test"),
  );
  registerClientBuildGuard(app, "a".repeat(64));
  await app.register(cookie);
  await app.register(jwt, {
    secret: "test-only-saml-jwt-secret-not-for-deployment",
    sign: { expiresIn: 300 },
  });
  const now = new Date("2026-09-22T08:00:00Z");
  const user = {
    id: "00000000-0000-4000-8000-000000000001",
    email: "member@example.test",
    name: "Member",
    role,
    status: "active" as const,
    authValidAfter: now,
    preferredLocale: null,
    avatarObjectKey: null,
    runningMessageAction: "queue" as const,
    passwordUpdatedAt: null,
    lastLoginAt: null,
    lastLoginMethod: null,
    createdAt: now,
    updatedAt: now,
  };
  await app.register(authenticationPlugin, {
    prisma: {
      user: { findUnique: async () => user },
    } as unknown as PrismaClient,
  });
  app.setErrorHandler((error, _request, reply) =>
    reply
      .code(
        error instanceof AppError
          ? error.code === "FORBIDDEN"
            ? 403
            : error.code === "AUTH_REQUIRED"
              ? 401
              : 400
          : 400,
      )
      .send({
        error: error instanceof AppError ? error.code : "VALIDATION_ERROR",
      }),
  );
  const protocol = {
    available: vi.fn<SamlProtocol["available"]>().mockResolvedValue(true),
    start: vi
      .fn<SamlProtocol["start"]>()
      .mockResolvedValue("https://idp.example.test/sso"),
    complete: vi
      .fn<SamlProtocol["complete"]>()
      .mockResolvedValue({ email: user.email }),
    metadata: vi
      .fn<SamlProtocol["metadata"]>()
      .mockResolvedValue('<EntityDescriptor entityID="test"/>'),
  };
  const settings = {
    getAdminSettings: vi.fn<SamlSettingsService["getAdminSettings"]>(),
    update: vi.fn<SamlSettingsService["update"]>(),
  };
  const auth = {
    loginSaml: vi.fn<AuthService["loginSaml"]>().mockResolvedValue({
      accessToken: "never-in-redirect",
      refreshToken: "refresh-cookie-only",
      accessTokenExpiresAt: now,
      refreshSessionExpiresAt: now,
      user,
    }),
  };
  await app.register(samlRoutes, {
    protocol,
    settings,
    auth,
    publicBaseUrl: "https://linksense.example.test",
  });
  const token = app.jwt.sign({
    sub: user.id,
    role,
    email: user.email,
    auth_valid_after: now.toISOString(),
  });
  return { app, protocol, settings, auth, token };
}
const payload = new URLSearchParams({
  SAMLResponse: "dGVzdA==",
  RelayState: "r".repeat(43),
}).toString();
const browserCookie = `linksense_saml_flow=${"b".repeat(43)}`;
describe("SAML routes", () => {
  it.each(["GET", "PUT"] as const)(
    "protects %s settings from anonymous and non-admin users",
    async (method) => {
      const f = await fixture("user");
      const url = "/api/v1/admin/saml-authentication-settings";
      expect((await f.app.inject({ method, url })).statusCode).toBe(401);
      expect(
        (
          await f.app.inject({
            method,
            url,
            headers: { authorization: `Bearer ${f.token}` },
          })
        ).statusCode,
      ).toBe(403);
      expect(f.settings.getAdminSettings).not.toHaveBeenCalled();
      expect(f.settings.update).not.toHaveBeenCalled();
    },
  );
  it("allows administrators to read settings and rejects invalid updates", async () => {
    const f = await fixture();
    expect(
      (
        await f.app.inject({
          url: "/api/v1/admin/saml-authentication-settings",
          headers: { authorization: `Bearer ${f.token}` },
        })
      ).statusCode,
    ).toBe(200);
    expect(f.settings.getAdminSettings).toHaveBeenCalledOnce();
    expect(
      (
        await f.app.inject({
          method: "PUT",
          url: "/api/v1/admin/saml-authentication-settings",
          headers: { authorization: `Bearer ${f.token}` },
          payload: { enabled: true },
        })
      ).statusCode,
    ).toBe(400);
    expect(f.settings.update).not.toHaveBeenCalled();
  });
  it("binds same-origin login starts to a Secure HttpOnly cross-site callback cookie", async () => {
    const f = await fixture();
    const rejected = await f.app.inject({
      method: "POST",
      url: "/api/v1/auth/saml/start",
      headers: { "sec-fetch-site": "cross-site" },
    });
    expect(rejected.statusCode).toBe(400);
    expect(f.protocol.start).not.toHaveBeenCalled();
    const started = await f.app.inject({
      method: "POST",
      url: "/api/v1/auth/saml/start",
      headers: {
        host: "linksense.example.test",
        origin: "https://linksense.example.test",
        "sec-fetch-site": "same-origin",
      },
    });
    expect(started.statusCode).toBe(200);
    expect(started.headers["set-cookie"]).toEqual(
      expect.stringContaining("HttpOnly; Secure; SameSite=None"),
    );
    expect(started.headers["cache-control"]).toBe("no-store");
    expect(started.json()).toMatchObject({
      data: { authorization_url: "https://idp.example.test/sso" },
    });
  });
  it("accepts IdP form POSTs, issues a refresh cookie and redirects without tokens", async () => {
    const f = await fixture();
    const response = await f.app.inject({
      method: "POST",
      url: "/api/v1/auth/saml/acs",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        cookie: browserCookie,
        "sec-fetch-site": "cross-site",
        origin: "https://idp.example.test",
      },
      payload,
    });
    expect(response.statusCode).toBe(303);
    expect(response.headers.location).toBe(
      "https://linksense.example.test/auth/saml/callback?result=success",
    );
    expect(response.headers["set-cookie"]).toEqual(
      expect.arrayContaining([
        expect.stringContaining("linksense_refresh=refresh-cookie-only"),
        expect.stringContaining("linksense_saml_flow=;"),
      ]),
    );
    expect(JSON.stringify(response.headers)).not.toContain("never-in-redirect");
    expect(f.auth.loginSaml).toHaveBeenCalledWith(
      { email: "member@example.test" },
      expect.any(Object),
    );
  });
  it.each(["EXTERNAL_ACCOUNT_PENDING_APPROVAL", "USER_DISABLED"] as const)(
    "maps %s without creating a session cookie",
    async (code) => {
      const f = await fixture();
      f.auth.loginSaml.mockRejectedValue(new AppError(code));
      const response = await f.app.inject({
        method: "POST",
        url: "/api/v1/auth/saml/acs",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          cookie: browserCookie,
        },
        payload,
      });
      expect(response.headers.location).toContain(
        code === "USER_DISABLED"
          ? "result=disabled"
          : "result=pending_approval",
      );
      expect(String(response.headers["set-cookie"])).not.toContain(
        "linksense_refresh",
      );
    },
  );
  it("rejects absent browser cookies, duplicate fields, oversized payloads and unverified identities", async () => {
    const f = await fixture();
    const missing = await f.app.inject({
      method: "POST",
      url: "/api/v1/auth/saml/acs",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload,
    });
    expect(missing.headers.location).toContain("result=failed");
    expect(f.protocol.complete).not.toHaveBeenCalled();
    for (const invalid of [
      payload + "&RelayState=other",
      "SAMLResponse=" + "a".repeat(400_001),
    ]) {
      const response = await f.app.inject({
        method: "POST",
        url: "/api/v1/auth/saml/acs",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          cookie: browserCookie,
        },
        payload: invalid,
      });
      expect(response.statusCode).toBe(400);
    }
    f.protocol.complete.mockRejectedValue(
      new Error("internal assertion contents and private details"),
    );
    const failed = await f.app.inject({
      method: "POST",
      url: "/api/v1/auth/saml/acs",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        cookie: browserCookie,
      },
      payload,
    });
    expect(failed.headers.location).toContain("result=failed");
    expect(failed.body).not.toContain("internal assertion");
    expect(f.auth.loginSaml).not.toHaveBeenCalled();
  });
  it("exposes only availability and downloadable public metadata", async () => {
    const f = await fixture();
    const status = await f.app.inject("/api/v1/auth/saml/status");
    expect(status.json().data).toEqual({ enabled: true });
    const metadata = await f.app.inject("/api/v1/auth/saml/metadata");
    expect(metadata.headers["content-type"]).toContain(
      "application/samlmetadata+xml",
    );
    expect(metadata.headers["content-disposition"]).toContain("attachment");
    expect(metadata.body).toBe('<EntityDescriptor entityID="test"/>');
  });
  it("redacts SAML assertions, relay state and signing private keys from structured logs", () => {
    let output = "";
    const logger = pino(
      {
        redact: {
          paths: [...SENSITIVE_REQUEST_LOG_PATHS],
          censor: "[Redacted]",
        },
      },
      {
        write: (chunk: string) => {
          output += chunk;
        },
      },
    );
    logger.info({
      req: {
        body: {
          SAMLResponse: "assertion-private-data",
          RelayState: "relay-secret",
          signing_private_key: "private-key-secret",
        },
      },
    });
    expect(output).not.toMatch(
      /assertion-private-data|relay-secret|private-key-secret/u,
    );
    expect(output).toContain("[Redacted]");
  });
});
