import { afterEach, describe, expect, it, vi } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"
import cookie from "@fastify/cookie"
import jwt from "@fastify/jwt"
import { ClientError } from "openid-client"
import type { PrismaClient } from "../src/generated/prisma/client.js"
import { authenticationPlugin } from "../src/plugins/authentication.js"
import { socialAuthRoutes } from "../src/modules/social-auth/routes.js"
import { AppError } from "../src/lib/errors.js"
import type { AuthService } from "../src/modules/auth/service.js"
import type { SocialAuthService } from "../src/modules/social-auth/service.js"
import type { SocialSettingsService } from "../src/modules/social-auth/settings.js"

const applications: FastifyInstance[] = []
afterEach(async () => {
  await Promise.all(applications.splice(0).map((app) => app.close()))
})
const userId = "00000000-0000-4000-8000-000000000001"
async function fixture() {
  const app = Fastify()
  applications.push(app)
  await app.register(cookie)
  await app.register(jwt, {
    secret: "test-only-social-auth-secret",
    sign: { expiresIn: 300 },
  })
  const date = new Date("2026-09-21T00:00:00Z")
  const user = {
    id: userId,
    email: "member@example.test",
    name: "Member",
    role: "user" as "user" | "admin",
    status: "active",
    authValidAfter: date,
    preferredLocale: null,
    avatarObjectKey: null,
  }
  await app.register(authenticationPlugin, {
    prisma: {
      user: { findUnique: async () => user },
    } as unknown as PrismaClient,
  })
  app.setErrorHandler((error, _request, reply) =>
    reply
      .code(
        error instanceof AppError
          ? error.code === "FORBIDDEN"
            ? 403
            : 401
          : 400,
      )
      .send({ error: error instanceof AppError ? error.code : "invalid" }),
  )
  const settings = {
    getAdminSettings: vi
      .fn<SocialSettingsService["getAdminSettings"]>()
      .mockResolvedValue([]),
    update: vi.fn<SocialSettingsService["update"]>().mockResolvedValue([]),
  }
  const service = {
    start: vi
      .fn<SocialAuthService["start"]>()
      .mockResolvedValue("https://accounts.google.com/authorize"),
    complete: vi
      .fn<SocialAuthService["complete"]>()
      .mockResolvedValue({
        result: "success",
        provider: "google",
        account: { userId, authValidAfter: date.toISOString() },
      }),
    sendVerification: vi
      .fn<SocialAuthService["sendVerification"]>()
      .mockResolvedValue(),
    verifyEmail: vi.fn<SocialAuthService["verifyEmail"]>(),
  }
  const auth = {
    createSocialSession: vi.fn<AuthService["createSocialSession"]>(),
    getCurrentUser: vi.fn<AuthService["getCurrentUser"]>(),
  }
  auth.createSocialSession.mockResolvedValue({
    accessToken: "access-not-in-url",
    refreshToken: "refresh-only-in-cookie",
    accessTokenExpiresAt: date,
    refreshSessionExpiresAt: date,
    user: {
      ...user,
      status: "active",
      role: "user",
      runningMessageAction: "queue",
      preferredLocale: null,
      passwordUpdatedAt: null,
      lastLoginAt: null,
      lastLoginMethod: null,
      createdAt: date,
      updatedAt: date,
    },
  })
  const repository = {
    list: vi.fn(async () => []),
    unlink: vi.fn(async () => {}),
  }
  await app.register(socialAuthRoutes, {
    settings,
    service,
    repository,
    auth,
    publicBaseUrl: "https://app.example.test",
  })
  const token = () =>
    app.jwt.sign({
      sub: userId,
      email: user.email,
      role: user.role,
      auth_valid_after: date.toISOString(),
    })
  return { app, settings, service, repository, auth, user, token }
}

describe("social authentication routes", () => {
  it("creates a GitHub session after a successful GET callback without exposing tokens", async () => {
    const f = await fixture()
    f.service.complete.mockResolvedValue({
      result: "success",
      provider: "github",
      account: {
        userId,
        authValidAfter: new Date("2026-09-21T00:00:00Z").toISOString(),
      },
    })
    const response = await f.app.inject({
      url: "/api/v1/auth/social/github/callback?state=state&code=github-code",
      headers: { cookie: "linksense_social_flow=browser-proof" },
    })
    expect(response.statusCode).toBe(303)
    expect(response.headers.location).toBe(
      "https://app.example.test/auth/social/callback?result=success",
    )
    expect(f.service.complete).toHaveBeenCalledWith(
      "github",
      { state: "state", code: "github-code" },
      "browser-proof",
      expect.any(Object),
    )
    expect(f.auth.createSocialSession).toHaveBeenCalledWith(
      userId,
      "github",
      expect.any(Object),
      "2026-09-21T00:00:00.000Z",
    )
    expect(response.headers["set-cookie"]?.toString()).toContain(
      "linksense_refresh=refresh-only-in-cookie",
    )
  })
  it("allows public provider discovery but rejects anonymous and ordinary-user admin writes", async () => {
    const f = await fixture()
    expect(
      (await f.app.inject("/api/v1/auth/social/providers")).statusCode,
    ).toBe(200)
    expect(
      (await f.app.inject("/api/v1/admin/social-authentication-settings"))
        .statusCode,
    ).toBe(401)
    expect(
      (
        await f.app.inject({
          method: "PUT",
          url: "/api/v1/admin/social-authentication-settings/google",
          headers: { authorization: `Bearer ${f.token()}` },
          payload: { expected_revision: 0, enabled: false, client_id: "" },
        })
      ).statusCode,
    ).toBe(403)
    expect(f.settings.update).not.toHaveBeenCalled()
    f.user.role = "admin"
    expect(
      (
        await f.app.inject({
          method: "PUT",
          url: "/api/v1/admin/social-authentication-settings/google",
          headers: { authorization: `Bearer ${f.token()}` },
          payload: { expected_revision: 0, enabled: false, client_id: "" },
        })
      ).statusCode,
    ).toBe(200)
  })
  it("rejects cross-origin starts and unauthenticated binding", async () => {
    const f = await fixture()
    expect(
      (
        await f.app.inject({
          method: "POST",
          url: "/api/v1/auth/social/google/start",
          headers: {
            origin: "https://attacker.example",
            "sec-fetch-site": "cross-site",
          },
        })
      ).statusCode,
    ).toBe(401)
    expect(
      (
        await f.app.inject({
          method: "POST",
          url: "/api/v1/auth/social/google/link",
        })
      ).statusCode,
    ).toBe(401)
    expect(f.service.start).not.toHaveBeenCalled()
  })
  it("sets a secure HttpOnly flow cookie and returns the provider authorization URL", async () => {
    const f = await fixture()
    const response = await f.app.inject({
      method: "POST",
      url: "/api/v1/auth/social/google/start",
    })
    expect(response.statusCode).toBe(200)
    const setCookie = response.headers["set-cookie"]?.toString() ?? ""
    expect(setCookie).toContain("HttpOnly")
    expect(setCookie).toContain("Secure")
    expect(setCookie).toContain("SameSite=None")
    expect(response.json().data.authorization_url).toBe(
      "https://accounts.google.com/authorize",
    )
  })
  it("accepts Apple form_post without leaking tokens into the redirect", async () => {
    const f = await fixture()
    const response = await f.app.inject({
      method: "POST",
      url: "/api/v1/auth/social/apple/callback",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        cookie: "linksense_social_flow=browser-proof",
      },
      payload: "state=state&code=apple-code&user=%7B%7D",
    })
    expect(response.statusCode).toBe(303)
    expect(response.headers.location).toBe(
      "https://app.example.test/auth/social/callback?result=success",
    )
    expect(response.headers["set-cookie"]?.toString()).toContain(
      "linksense_refresh=refresh-only-in-cookie",
    )
    expect(response.headers.location).not.toContain("access")
    expect(f.service.complete).toHaveBeenCalledWith(
      "apple",
      { state: "state", code: "apple-code", user: "{}" },
      "browser-proof",
      expect.any(Object),
    )
  })
  it("rejects duplicate callback parameters and does not replace the session on authorization failure", async () => {
    const f = await fixture()
    const duplicate = await f.app.inject({
      method: "POST",
      url: "/api/v1/auth/social/apple/callback",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: "state=first&state=second",
    })
    expect(duplicate.statusCode).toBe(401)
    expect(f.service.complete).not.toHaveBeenCalled()
    f.service.complete.mockRejectedValue(new Error("provider internal details"))
    const response = await f.app.inject(
      "/api/v1/auth/social/google/callback?state=state&code=code",
    )
    expect(response.headers.location).toContain("result=failed")
    expect(response.headers["set-cookie"]?.toString()).not.toContain(
      "linksense_refresh",
    )
    expect(response.body).not.toContain("provider internal details")
  })
  it("records safe callback diagnostics without logging credentials or provider errors", async () => {
    const f = await fixture()
    const warn = vi.fn()
    f.app.addHook("onRequest", async (request) => {
      request.log.warn = warn
    })
    f.service.complete.mockRejectedValue(new Error("secret-provider-response"))
    await f.app.inject({
      url: "/api/v1/auth/social/github/callback?state=secret-state&code=secret-code",
      headers: { cookie: "linksense_social_flow=secret-cookie" },
    })
    expect(warn).toHaveBeenCalledWith(
      {
        event: "social_callback_failed",
        provider: "github",
        stage: "complete",
        result: "failed",
        error_type: "unexpected",
        has_flow_cookie: true,
      },
      "Social authentication callback failed",
    )
    expect(JSON.stringify(warn.mock.calls)).not.toContain("secret-")
  })
  it.each([
    {
      code: "OAUTH_INVALID_RESPONSE",
      cause: 'unexpected "iss" (issuer) response parameter value',
      expectedCode: "OAUTH_INVALID_RESPONSE",
      expectedReason: "issuer_mismatch",
    },
    {
      code: "secret-code",
      cause: "secret-provider-response",
      expectedCode: "unknown",
      expectedReason: "other",
    },
  ])("allowlists protocol diagnostics: $expectedReason", async (test) => {
    const f = await fixture()
    const warn = vi.fn()
    f.app.addHook("onRequest", async (request) => {
      request.log.warn = warn
    })
    const error = new ClientError("secret-message", {
      cause: new Error(test.cause),
    })
    error.code = test.code
    f.service.complete.mockRejectedValue(error)
    const response = await f.app.inject(
      "/api/v1/auth/social/github/callback?state=secret-state&code=secret-code",
    )
    expect(response.headers.location).toContain("result=failed")
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        error_type: "oauth_protocol",
        protocol_code: test.expectedCode,
        protocol_reason: test.expectedReason,
      }),
      "Social authentication callback failed",
    )
    expect(JSON.stringify(warn.mock.calls)).not.toContain("secret-")
  })
  it("scopes account deletion to the authenticated user, never a requested user ID", async () => {
    const f = await fixture()
    const response = await f.app.inject({
      method: "DELETE",
      url: "/api/v1/me/social-accounts/google?user_id=another-user",
      headers: { authorization: `Bearer ${f.token()}` },
    })
    expect(response.statusCode).toBe(204)
    expect(f.repository.unlink).toHaveBeenCalledWith(
      userId,
      "google",
      expect.any(Object),
    )
  })
})
