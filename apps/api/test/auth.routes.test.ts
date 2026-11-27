import Fastify from "fastify"
import { authSessionSchema, authUserSchema } from "@linksense/shared"
import { CompactSign } from "jose"
import { afterEach, describe, expect, it, vi } from "vitest"

import { AppError } from "../src/lib/errors.js"
import { sendAppError } from "../src/lib/http.js"
import {
  authRoutes,
  createAuthenticationHooks,
  projectAuthenticatedUser,
  registerAuthentication,
} from "../src/modules/auth/routes.js"
import { AuthService } from "../src/modules/auth/service.js"
import type {
  AuthPersistence,
  AuthRateLimiter,
  AuthUserRecord,
} from "../src/modules/auth/types.js"
import { authenticationPlugin } from "../src/plugins/authentication.js"

const apps: Array<ReturnType<typeof Fastify>> = []

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()))
})

describe("authentication Fastify integration", () => {
  it("rejects signed JSON arrays at the JWT verification boundary", async () => {
    const app = Fastify()
    apps.push(app)
    const secret = "s".repeat(32)
    await registerAuthentication(app, { jwtSecret: secret })
    const token = await new CompactSign(
      Buffer.from(JSON.stringify(["attacker", "role:admin"])),
    )
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .sign(Buffer.from(secret))

    expect(() => app.jwt.verify(token)).toThrow()
  })

  it("accepts an independently signed existing HS256 session without recreating it", async () => {
    const app = Fastify()
    apps.push(app)
    const secret = "s".repeat(32)
    await registerAuthentication(app, { jwtSecret: secret })
    const user = makeUser()
    const findUser = vi.fn(async () => user)
    await app.register(authenticationPlugin, {
      prisma: { user: { findUnique: findUser } } as never,
    })
    app.get("/me", {
      preHandler: app.authenticate,
      handler: async (request) => ({
        id: request.authUser?.id,
        role: request.authUser?.role,
      }),
    })
    const now = Math.floor(Date.now() / 1_000)
    const token = await new CompactSign(
      Buffer.from(JSON.stringify({
        sub: user.id,
        email: user.email,
        role: user.role,
        auth_valid_after: user.authValidAfter.toISOString(),
        iat: now - 600,
        exp: now + 600,
      })),
    )
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .sign(Buffer.from(secret))

    const response = await app.inject({
      method: "GET",
      url: "/me",
      headers: { authorization: `Bearer ${token}` },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ id: user.id, role: user.role })
    expect(findUser).toHaveBeenCalledWith({ where: { id: user.id } })
    expect(response.headers["set-cookie"]).toBeUndefined()
  })

  it("rejects unsigned admin claims before looking up a persisted user", async () => {
    const app = Fastify()
    apps.push(app)
    await registerAuthentication(app, { jwtSecret: "s".repeat(32) })
    const user = makeUser()
    const findUser = vi.fn(async () => user)
    await app.register(authenticationPlugin, {
      prisma: { user: { findUnique: findUser } } as never,
    })
    app.get("/me", {
      preHandler: app.authenticate,
      handler: async () => ({ allowed: true }),
    })
    app.setErrorHandler((error, request, reply) =>
      sendAppError(reply, request, error),
    )
    const token = [
      Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url"),
      Buffer.from(JSON.stringify({
        sub: user.id,
        email: user.email,
        role: "admin",
        auth_valid_after: user.authValidAfter.toISOString(),
      })).toString("base64url"),
      "",
    ].join(".")

    const response = await app.inject({
      method: "GET",
      url: "/me",
      headers: { authorization: `Bearer ${token}` },
    })

    expect(response.statusCode).toBe(401)
    expect(response.json()).toMatchObject({ error_code: "AUTH_REQUIRED" })
    expect(findUser).not.toHaveBeenCalled()
  })

  it("invalidates a token whose role claim no longer matches the database", async () => {
    const app = Fastify()
    apps.push(app)
    await registerAuthentication(app, { jwtSecret: "s".repeat(32) })
    const latestUser = makeUser({ role: "user" })
    const persistence = authPersistence(latestUser)
    const hooks = createAuthenticationHooks(persistence)
    app.get("/admin", {
      preHandler: async (request) => hooks.requireAdmin(request),
      handler: async () => ({ allowed: true }),
    })
    app.setErrorHandler((error, request, reply) =>
      sendAppError(reply, request, error),
    )
    await app.ready()

    const staleAdminToken = app.jwt.sign({
      sub: latestUser.id,
      email: latestUser.email,
      role: "admin",
      auth_valid_after: latestUser.authValidAfter.toISOString(),
    })
    const response = await app.inject({
      method: "GET",
      url: "/admin",
      headers: { authorization: `Bearer ${staleAdminToken}` },
    })
    expect(response.statusCode).toBe(401)
    expect(response.json()).toMatchObject({ error_code: "AUTH_SESSION_EXPIRED" })
  })

  it("rejects an otherwise valid access token issued before auth_valid_after", async () => {
    const app = Fastify()
    apps.push(app)
    await registerAuthentication(app, { jwtSecret: "s".repeat(32) })
    const latestUser = makeUser({
      authValidAfter: new Date(Date.now() + 60_000),
    })
    const hooks = createAuthenticationHooks(authPersistence(latestUser))
    app.get("/me", {
      preHandler: async (request) => hooks.authenticate(request),
      handler: async () => ({ allowed: true }),
    })
    app.setErrorHandler((error, request, reply) =>
      sendAppError(reply, request, error),
    )
    await app.ready()
    const token = app.jwt.sign({
      sub: latestUser.id,
      email: latestUser.email,
      role: latestUser.role,
      auth_valid_after: new Date(0).toISOString(),
    })
    const response = await app.inject({
      method: "GET",
      url: "/me",
      headers: { authorization: `Bearer ${token}` },
    })
    expect(response.statusCode).toBe(401)
    expect(response.json()).toMatchObject({ error_code: "AUTH_SESSION_EXPIRED" })
  })

  it("rejects a token whose auth epoch is stale even within the same JWT second", async () => {
    const app = Fastify()
    apps.push(app)
    await registerAuthentication(app, { jwtSecret: "s".repeat(32) })
    const secondBoundary = Math.floor(Date.now() / 1_000) * 1_000
    const latestUser = makeUser({
      authValidAfter: new Date(secondBoundary),
    })
    const hooks = createAuthenticationHooks(authPersistence(latestUser))
    app.get("/me", {
      preHandler: async (request) => hooks.authenticate(request),
      handler: async () => ({ allowed: true }),
    })
    app.setErrorHandler((error, request, reply) =>
      sendAppError(reply, request, error),
    )
    await app.ready()
    const token = app.jwt.sign({
      sub: latestUser.id,
      email: latestUser.email,
      role: latestUser.role,
      auth_valid_after: new Date(secondBoundary - 1).toISOString(),
    })

    const response = await app.inject({
      method: "GET",
      url: "/me",
      headers: { authorization: `Bearer ${token}` },
    })

    expect(response.statusCode).toBe(401)
    expect(response.json()).toMatchObject({ error_code: "AUTH_SESSION_EXPIRED" })
  })

  it("enforces the exact auth epoch in the production authentication plugin", async () => {
    const app = Fastify()
    apps.push(app)
    await registerAuthentication(app, { jwtSecret: "s".repeat(32) })
    const secondBoundary = Math.floor(Date.now() / 1_000) * 1_000
    const latestUser = makeUser({ authValidAfter: new Date(secondBoundary) })
    await app.register(authenticationPlugin, {
      prisma: {
        user: { findUnique: vi.fn(async () => latestUser) },
      } as never,
    })
    app.get("/me", {
      preHandler: app.authenticate,
      handler: async () => ({ allowed: true }),
    })
    app.setErrorHandler((error, request, reply) =>
      sendAppError(reply, request, error),
    )
    const token = app.jwt.sign({
      sub: latestUser.id,
      email: latestUser.email,
      role: latestUser.role,
      auth_valid_after: new Date(secondBoundary - 1).toISOString(),
    })

    const response = await app.inject({
      method: "GET",
      url: "/me",
      headers: { authorization: `Bearer ${token}` },
    })

    expect(response.statusCode).toBe(401)
    expect(response.json()).toMatchObject({ error_code: "AUTH_SESSION_EXPIRED" })
  })

  it("projects the persisted self-registration source into authenticated requests", async () => {
    const app = Fastify()
    apps.push(app)
    await registerAuthentication(app, { jwtSecret: "s".repeat(32) })
    const latestUser = {
      ...makeUser({ role: "user" }),
      accountType: "member",
      selfRegisteredAt: new Date("2026-09-01T00:00:00.000Z"),
    }
    await app.register(authenticationPlugin, {
      prisma: {
        user: { findUnique: vi.fn(async () => latestUser) },
      } as never,
    })
    app.get("/registration-source", {
      preHandler: app.authenticate,
      handler: async (request) => ({
        registrationSource: request.authUser?.registrationSource,
      }),
    })
    const token = app.jwt.sign({
      sub: latestUser.id,
      email: latestUser.email,
      role: latestUser.role,
      auth_valid_after: latestUser.authValidAfter.toISOString(),
    })

    const response = await app.inject({
      method: "GET",
      url: "/registration-source",
      headers: { authorization: `Bearer ${token}` },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      registrationSource: "self_registration",
    })
  })

  it("sets Retry-After for a merged login cooldown without account disclosure", async () => {
    const app = Fastify()
    apps.push(app)
    await registerAuthentication(app, { jwtSecret: "s".repeat(32) })
    const persistence = authPersistence(null)
    const rateLimiter = authRateLimiter()
    vi.mocked(rateLimiter.precheckLogin).mockResolvedValueOnce(42)
    const service = createService(persistence, rateLimiter)
    app.setErrorHandler((error, request, reply) =>
      sendAppError(reply, request, error),
    )
    await app.register(authRoutes, {
      prefix: "/auth",
      service,
      secureCookies: false,
    })
    const response = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "unknown@example.com", password: "candidate" },
    })
    expect(response.statusCode).toBe(429)
    expect(response.headers["retry-after"]).toBe("42")
    expect(response.json()).toMatchObject({
      error_code: "AUTH_LOGIN_RATE_LIMITED",
    })
    expect(response.body).not.toContain("unknown@example.com")
    expect(persistence.findUserByEmail).not.toHaveBeenCalled()
  })

  it("finishes the OIDC callback on the API and redirects the browser with a refresh cookie", async () => {
    const app = Fastify()
    apps.push(app)
    await registerAuthentication(app, { jwtSecret: "s".repeat(32) })
    const user = makeUser()
    const service = createService(authPersistence(user), authRateLimiter())
    vi.spyOn(service, "completeOidc").mockResolvedValueOnce({
      accessToken: "a".repeat(48),
      refreshToken: "r".repeat(48),
      accessTokenExpiresAt: new Date("2026-07-11T10:00:00.000Z"),
      refreshSessionExpiresAt: new Date("2026-10-09T08:00:00.000Z"),
      user,
    })
    await app.register(authRoutes, {
      prefix: "/auth",
      service,
      secureCookies: false,
      publicBaseUrl: "http://localhost:5173",
    })

    const response = await app.inject({
      method: "GET",
      url: "/auth/oidc/callback?code=authorization-code&state=state-value",
    })

    expect(response.statusCode).toBe(302)
    expect(response.headers.location).toBe(
      "http://localhost:5173/auth/oidc/callback?result=success",
    )
    expect(response.headers["set-cookie"]).toContain("linksense_refresh=")
    expect(response.headers["set-cookie"]).toContain("HttpOnly")
  })

  it.each([
    ["OIDC_ACCOUNT_PENDING_APPROVAL", "pending_approval"],
    ["USER_DISABLED", "disabled"],
    ["AUTH_INVALID_CREDENTIALS", "failed"],
  ] as const)(
    "redirects the OIDC callback error %s to the safe frontend result %s",
    async (errorCode, result) => {
      const app = Fastify()
      apps.push(app)
      await registerAuthentication(app, { jwtSecret: "s".repeat(32) })
      const service = createService(authPersistence(null), authRateLimiter())
      vi.spyOn(service, "completeOidc").mockRejectedValueOnce(
        new AppError(errorCode),
      )
      await app.register(authRoutes, {
        prefix: "/auth",
        service,
        secureCookies: false,
        publicBaseUrl: "http://localhost:5173",
      })

      const response = await app.inject({
        method: "GET",
        url: "/auth/oidc/callback?code=authorization-code&state=state-value",
      })

      expect(response.statusCode).toBe(302)
      expect(response.headers.location).toBe(
        `http://localhost:5173/auth/oidc/callback?result=${result}`,
      )
      expect(response.headers["set-cookie"]).toContain(
        "linksense_refresh=;",
      )
      expect(response.body).not.toContain("authorization-code")
      expect(response.body).not.toContain("state-value")
    },
  )

  it("returns a clear failure when a password reset email cannot be queued", async () => {
    const app = Fastify()
    apps.push(app)
    await registerAuthentication(app, { jwtSecret: "s".repeat(32) })
    const service = createService(
      authPersistence(makeUser()),
      authRateLimiter(),
    )
    vi.spyOn(service, "forgotPassword").mockRejectedValueOnce(
      new AppError("PASSWORD_RESET_EMAIL_DELIVERY_FAILED"),
    )
    app.setErrorHandler((error, request, reply) =>
      sendAppError(reply, request, error),
    )
    await app.register(authRoutes, {
      prefix: "/auth",
      service,
      secureCookies: false,
    })

    const response = await app.inject({
      method: "POST",
      url: "/auth/forgot-password",
      payload: { email: "person@example.com" },
    })

    expect(response.statusCode).toBe(503)
    expect(response.json()).toMatchObject({
      success: false,
      error_code: "PASSWORD_RESET_EMAIL_DELIVERY_FAILED",
      message_key: "auth.passwordReset.deliveryFailed",
    })
  })

  it("accepts registration requests with the request locale and returns a generic response", async () => {
    const app = Fastify()
    apps.push(app)
    await registerAuthentication(app, { jwtSecret: "s".repeat(32) })
    const service = createService(authPersistence(null), authRateLimiter())
    vi.spyOn(service, "requestRegistration").mockResolvedValueOnce({
      code: "REGISTRATION_REQUEST_ACCEPTED",
    })
    await app.register(authRoutes, {
      prefix: "/auth",
      service,
      secureCookies: false,
    })

    const response = await app.inject({
      method: "POST",
      url: "/auth/registration/request",
      headers: { "accept-language": "en-US" },
      payload: { email: "New.Person@Example.com" },
    })

    expect(response.statusCode).toBe(202)
    expect(response.json().data).toEqual({
      code: "REGISTRATION_REQUEST_ACCEPTED",
    })
    expect(service.requestRegistration).toHaveBeenCalledWith(
      "new.person@example.com",
      "en-US",
      expect.objectContaining({ ipAddress: "127.0.0.1" }),
    )
  })

  it("completes registration with an HttpOnly refresh cookie and no refresh token in the body", async () => {
    const app = Fastify()
    apps.push(app)
    await registerAuthentication(app, { jwtSecret: "s".repeat(32) })
    const user = makeUser({ role: "user" })
    const service = createService(authPersistence(user), authRateLimiter())
    vi.spyOn(service, "completeRegistration").mockResolvedValueOnce({
      accessToken: "a".repeat(48),
      refreshToken: "r".repeat(48),
      accessTokenExpiresAt: new Date("2026-07-11T10:00:00.000Z"),
      refreshSessionExpiresAt: new Date("2026-10-09T08:00:00.000Z"),
      user,
    })
    await app.register(authRoutes, {
      prefix: "/auth",
      service,
      secureCookies: false,
    })

    const response = await app.inject({
      method: "POST",
      url: "/auth/registration/complete",
      payload: { token: "t".repeat(48), new_password: "Password1!" },
    })

    expect(response.statusCode).toBe(200)
    expect(response.headers["set-cookie"]).toContain("HttpOnly")
    expect(response.json().data).not.toHaveProperty("refresh_token")
    expect(response.json().data.user).toMatchObject({
      email: user.email,
      role: "user",
    })
  })

  it("accepts a same-origin refresh through a public domain that differs from the canonical URL", async () => {
    const app = Fastify()
    apps.push(app)
    await registerAuthentication(app, { jwtSecret: "s".repeat(32) })
    const user = makeUser()
    const service = createService(authPersistence(user), authRateLimiter())
    vi.spyOn(service, "refresh").mockResolvedValueOnce({
      accessToken: "a".repeat(48),
      refreshToken: "r".repeat(48),
      accessTokenExpiresAt: new Date("2026-07-11T10:00:00.000Z"),
      refreshSessionExpiresAt: new Date("2026-10-01T00:00:00.000Z"),
      user,
    })
    await app.register(authRoutes, {
      prefix: "/auth",
      service,
      secureCookies: false,
      publicBaseUrl: "http://192.168.180.41:10080",
    })

    const response = await app.inject({
      method: "POST",
      url: "/auth/refresh",
      headers: {
        host: "ai-studio.aisgz.org",
        origin: "https://ai-studio.aisgz.org",
        "sec-fetch-site": "same-origin",
        cookie: `linksense_refresh=${"r".repeat(48)}`,
      },
      payload: {},
    })

    expect(response.statusCode).toBe(200)
    expect(service.refresh).toHaveBeenCalledOnce()
    expect(response.headers["set-cookie"]).toContain("Secure")
    expect(response.headers["set-cookie"]).toContain("SameSite=None")
  })

  it.each([
    { origin: "http://localhost:18172", secure: false },
    { origin: "https://localhost:18173", secure: true },
  ])("restores sessions through the local $origin entry with the correct cookie security", async ({ origin, secure }) => {
    const app = Fastify({ trustProxy: false })
    apps.push(app)
    await registerAuthentication(app, { jwtSecret: "s".repeat(32) })
    const user = makeUser()
    const service = createService(authPersistence(user), authRateLimiter())
    vi.spyOn(service, "refresh").mockResolvedValueOnce({
      accessToken: "a".repeat(48),
      refreshToken: "r".repeat(48),
      accessTokenExpiresAt: new Date("2026-07-11T10:00:00.000Z"),
      refreshSessionExpiresAt: new Date("2026-10-01T00:00:00.000Z"),
      user,
    })
    await app.register(authRoutes, {
      prefix: "/auth",
      service,
      secureCookies: false,
      publicBaseUrl: "http://localhost:18172",
    })

    const response = await app.inject({
      method: "POST",
      url: "/auth/refresh",
      headers: {
        host: new URL(origin).host,
        origin,
        "sec-fetch-site": "same-origin",
        cookie: `linksense_refresh=${"r".repeat(48)}`,
      },
      payload: {},
    })

    expect(response.statusCode).toBe(200)
    expect(service.refresh).toHaveBeenCalledOnce()
    expect(response.headers["set-cookie"]).toContain("HttpOnly")
    expect(response.headers["set-cookie"]?.includes("Secure")).toBe(secure)
    expect(response.headers["set-cookie"]).toContain(secure ? "SameSite=None" : "SameSite=Lax")
  })

  it("rejects a cross-origin production refresh before reading or rotating its cookie", async () => {
    const app = Fastify()
    apps.push(app)
    await registerAuthentication(app, { jwtSecret: "s".repeat(32) })
    const service = createService(authPersistence(makeUser()), authRateLimiter())
    const refresh = vi.spyOn(service, "refresh")
    app.setErrorHandler((error, request, reply) =>
      sendAppError(reply, request, error),
    )
    await app.register(authRoutes, {
      prefix: "/auth",
      service,
      secureCookies: true,
      publicBaseUrl: "https://linksense.example",
    })

    const response = await app.inject({
      method: "POST",
      url: "/auth/refresh",
      headers: {
        host: "linksense.example",
        origin: "https://evil.example",
        "sec-fetch-site": "cross-site",
        cookie: `linksense_refresh=${"r".repeat(48)}`,
      },
      payload: {},
    })

    expect(response.statusCode).toBe(403)
    expect(response.json()).toMatchObject({
      error_code: "AUTH_CROSS_ORIGIN_REQUEST_FORBIDDEN",
    })
    expect(refresh).not.toHaveBeenCalled()
  })

  it("keeps origin validation for refresh cookies over HTTP", async () => {
    const app = Fastify()
    apps.push(app)
    await registerAuthentication(app, { jwtSecret: "s".repeat(32) })
    const service = createService(authPersistence(makeUser()), authRateLimiter())
    const refresh = vi.spyOn(service, "refresh")
    app.setErrorHandler((error, request, reply) =>
      sendAppError(reply, request, error),
    )
    await app.register(authRoutes, {
      prefix: "/auth",
      service,
      secureCookies: false,
      publicBaseUrl: "http://linksense.example",
    })

    const response = await app.inject({
      method: "POST",
      url: "/auth/refresh",
      headers: {
        host: "linksense.example",
        origin: "http://evil.example",
        "sec-fetch-site": "cross-site",
        cookie: `linksense_refresh=${"r".repeat(48)}`,
      },
      payload: {},
    })

    expect(response.statusCode).toBe(403)
    expect(response.json()).toMatchObject({
      error_code: "AUTH_CROSS_ORIGIN_REQUEST_FORBIDDEN",
    })
    expect(refresh).not.toHaveBeenCalled()
  })

  it("rejects browser requests without origin evidence but permits a non-browser internal client", async () => {
    const app = Fastify()
    apps.push(app)
    await registerAuthentication(app, { jwtSecret: "s".repeat(32) })
    const user = makeUser()
    const service = createService(authPersistence(user), authRateLimiter())
    const refresh = vi.spyOn(service, "refresh").mockResolvedValue({
      accessToken: "a".repeat(48),
      refreshToken: "r".repeat(48),
      accessTokenExpiresAt: new Date("2026-07-11T10:00:00.000Z"),
      refreshSessionExpiresAt: new Date("2026-10-01T00:00:00.000Z"),
      user,
    })
    app.setErrorHandler((error, request, reply) =>
      sendAppError(reply, request, error),
    )
    await app.register(authRoutes, {
      prefix: "/auth",
      service,
      secureCookies: true,
      publicBaseUrl: "https://linksense.example",
    })

    const browserResponse = await app.inject({
      method: "POST",
      url: "/auth/refresh",
      headers: {
        "accept-language": "en-US",
        "user-agent": "Mozilla/5.0 Safari/605.1.15",
        cookie: `linksense_refresh=${"r".repeat(48)}`,
      },
      payload: {},
    })
    expect(browserResponse.statusCode).toBe(403)
    expect(browserResponse.json()).toMatchObject({
      error_code: "AUTH_CROSS_ORIGIN_REQUEST_FORBIDDEN",
      message_key: "errors.auth.crossOriginRequestForbidden",
      message: expect.stringContaining("origin"),
    })

    const internalResponse = await app.inject({
      method: "POST",
      url: "/auth/refresh",
      headers: { cookie: `linksense_refresh=${"r".repeat(48)}` },
      payload: {},
    })
    expect(internalResponse.statusCode).toBe(200)
    expect(refresh).toHaveBeenCalledOnce()
  })

  it("rejects logout when Origin and Referer do not both match the application", async () => {
    const app = Fastify()
    apps.push(app)
    await registerAuthentication(app, { jwtSecret: "s".repeat(32) })
    const service = createService(authPersistence(makeUser()), authRateLimiter())
    const logout = vi.spyOn(service, "logout")
    app.setErrorHandler((error, request, reply) =>
      sendAppError(reply, request, error),
    )
    await app.register(authRoutes, {
      prefix: "/auth",
      service,
      secureCookies: true,
      publicBaseUrl: "https://linksense.example",
    })

    const response = await app.inject({
      method: "POST",
      url: "/auth/logout",
      headers: {
        host: "linksense.example",
        origin: "https://linksense.example",
        referer: "https://evil.example/attack",
        "sec-fetch-site": "same-origin",
        cookie: `linksense_refresh=${"r".repeat(48)}`,
      },
      payload: {},
    })

    expect(response.statusCode).toBe(403)
    expect(response.json()).toMatchObject({
      error_code: "AUTH_CROSS_ORIGIN_REQUEST_FORBIDDEN",
    })
    expect(logout).not.toHaveBeenCalled()
  })

  it("rejects a legacy browser origin whose scheme differs from the request", async () => {
    const app = Fastify()
    apps.push(app)
    await registerAuthentication(app, { jwtSecret: "s".repeat(32) })
    const service = createService(authPersistence(makeUser()), authRateLimiter())
    const refresh = vi.spyOn(service, "refresh")
    app.setErrorHandler((error, request, reply) =>
      sendAppError(reply, request, error),
    )
    await app.register(authRoutes, {
      prefix: "/auth",
      service,
      secureCookies: false,
      publicBaseUrl: "http://linksense.example",
    })

    const response = await app.inject({
      method: "POST",
      url: "/auth/refresh",
      headers: {
        host: "linksense.example",
        origin: "https://linksense.example",
        cookie: `linksense_refresh=${"r".repeat(48)}`,
      },
      payload: {},
    })

    expect(response.statusCode).toBe(403)
    expect(response.json()).toMatchObject({
      error_code: "AUTH_CROSS_ORIGIN_REQUEST_FORBIDDEN",
    })
    expect(refresh).not.toHaveBeenCalled()
  })

  it("sets a secure refresh cookie when a trusted proxy reports HTTPS", async () => {
    const app = Fastify({ trustProxy: true })
    apps.push(app)
    await registerAuthentication(app, { jwtSecret: "s".repeat(32) })
    const user = makeUser()
    const service = createService(
      authPersistence(user),
      authRateLimiter(),
      true,
    )
    await app.register(authRoutes, {
      prefix: "/auth",
      service,
      secureCookies: false,
      publicBaseUrl: "http://192.168.180.41:10080",
    })

    const response = await app.inject({
      method: "POST",
      url: "/auth/login",
      headers: {
        host: "ai-studio.aisgz.org",
        "x-forwarded-proto": "https",
      },
      payload: { email: user.email, password: "Password1!" },
    })

    expect(response.statusCode).toBe(200)
    expect(response.headers["set-cookie"]).toContain("Secure")
    expect(response.headers["set-cookie"]).toContain("SameSite=None")
  })

  it("returns snake_case users and keeps refresh tokens in an HttpOnly cookie", async () => {
    const app = Fastify()
    apps.push(app)
    await registerAuthentication(app, { jwtSecret: "s".repeat(32) })
    const user = makeUser()
    const persistence = authPersistence(user)
    const rateLimiter = authRateLimiter()
    const service = createService(persistence, rateLimiter, true)
    await app.register(authRoutes, {
      prefix: "/auth",
      service,
      secureCookies: false,
    })
    const response = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: user.email, password: "Password1!" },
    })
    expect(response.statusCode).toBe(200)
    expect(response.headers["set-cookie"]).toContain("HttpOnly")
    expect(response.headers["set-cookie"]).toContain("SameSite=Lax")
    expect(response.headers["set-cookie"]).not.toContain("Secure")
    const body = response.json()
    expect(authSessionSchema.parse(body.data)).toEqual(body.data)
    expect(body.data.user).toMatchObject({
      avatar_object_key: null,
      preferred_locale: "zh-CN",
      last_login_method: "password",
    })
    expect(body.data.user).not.toHaveProperty("avatarObjectKey")
    expect(body.data.user).not.toHaveProperty("passwordHash")
    expect(body.data.user).not.toHaveProperty("registration_source")
    expect(body.data).not.toHaveProperty("refresh_token")
  })

  it("exports the same stable projection for initialization responses", () => {
    const projected = projectAuthenticatedUser(makeUser())
    expect(authUserSchema.parse(projected)).toEqual(projected)
    expect(projected).toEqual(
      expect.objectContaining({
        id: expect.any(String),
        avatar_object_key: null,
        preferred_locale: "zh-CN",
        password_updated_at: "2026-07-01T00:00:00.000Z",
      }),
    )
    expect(projected).not.toHaveProperty("auth_valid_after")
  })
})

function createService(
  persistence: AuthPersistence,
  rateLimiter: AuthRateLimiter,
  verifyResult = false,
) {
  return new AuthService({
    persistence,
    rateLimiter,
    accessTokens: {
      issue: vi.fn(async () => ({
        token: "a".repeat(48),
        expiresAt: new Date("2026-07-11T10:00:00.000Z"),
      })),
    },
    mail: {
      status: vi.fn(async () => "available" as const),
      sendPasswordReset: vi.fn(async () => undefined),
      sendRegistration: vi.fn(async () => undefined),
    },
    readProductName: vi.fn(async () => "LinkSense"),
    audit: { write: vi.fn(async () => undefined) },
    passwordHasher: {
      hash: vi.fn(async () => "hash"),
      verify: vi.fn(async () => verifyResult),
      dummyHash: vi.fn(async () => "dummy"),
    },
    config: {
      nodeEnv: "test",
      publicBaseUrl: "https://linksense.example",
      passwordReset: {
        emailLimit: 3,
        emailWindowSeconds: 900,
        ipLimit: 20,
        ipWindowSeconds: 3_600,
        tokenTtlMinutes: 30,
      },
      invalidAuthTokenRetentionDays: 90,
      oidc: { status: "not_configured" },
      teams: { status: "not_configured" },
      smtp: { status: "configured" },
    },
    now: () => new Date("2026-07-11T08:00:00.000Z"),
    createId: () => crypto.randomUUID(),
    createOpaqueToken: () => "r".repeat(48),
  })
}

function authRateLimiter(): AuthRateLimiter {
  return {
    loginKeys: vi.fn(() => ({
      ipWindow: "ip-window",
      ipCooldown: "ip-cooldown",
      emailWindow: "email-window",
      emailCooldown: "email-cooldown",
    })),
    precheckLogin: vi.fn(async () => 0),
    recordLoginFailure: vi.fn(async () => 0),
    clearEmailLoginState: vi.fn(async () => undefined),
    takePasswordResetRequest: vi.fn(async () => true),
    takeRegistrationRequest: vi.fn(async () => true),
  }
}

function authPersistence(user: AuthUserRecord | null): AuthPersistence {
  return {
    getBootstrapState: vi.fn(async () => ({ initialized: false })),
    getRegistrationState: vi.fn(async () => ({ enabled: false })),
    initializeAdmin: vi.fn(async () => ({ status: "already_initialized" as const })),
    findUserByEmail: vi.fn(async () => user),
    findUserById: vi.fn(async () => user),
    findOrCreateDisabledExternalUser: vi.fn(async (input) => ({
      user:
        user ??
        makeUser({
          id: input.id,
          email: input.email,
          name: input.name,
          role: "user",
          status: "disabled",
          passwordHash: null,
          passwordUpdatedAt: null,
          authValidAfter: input.now,
          createdAt: input.now,
          updatedAt: input.now,
        }),
      created: user === null,
    })),
    createRefreshSession: vi.fn(async () => true),
    rotateRefreshSession: vi.fn(async () => ({ status: "invalid" as const })),
    revokeRefreshSession: vi.fn(async () => undefined),
    changePassword: vi.fn(async () => ({ status: "invalid" as const })),
    createPasswordResetToken: vi.fn(async () => undefined),
    invalidatePasswordResetToken: vi.fn(async () => undefined),
    resetPassword: vi.fn(async () => ({ status: "invalid" as const })),
    createRegistrationToken: vi.fn(async () => ({ status: "created" as const })),
    invalidateRegistrationToken: vi.fn(async () => undefined),
    completeRegistration: vi.fn(async () => ({ status: "invalid" as const })),
    recordExternalLogin: vi.fn(async () => null),
    cleanupInvalidTokens: vi.fn(async () => ({
      refreshTokens: 0,
      passwordResetTokens: 0,
      registrationTokens: 0,
    })),
  }
}

function makeUser(overrides: Partial<AuthUserRecord> = {}): AuthUserRecord {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    email: "person@example.com",
    name: "Person",
    avatarObjectKey: null,
    role: "admin",
    status: "active",
    passwordHash: "real-hash",
    preferredLocale: "zh-CN",
    runningMessageAction: "queue",
    lastLoginAt: null,
    lastLoginMethod: null,
    passwordUpdatedAt: new Date("2026-07-01T00:00:00.000Z"),
    authValidAfter: new Date("2026-07-01T00:00:00.000Z"),
    createdAt: new Date("2026-07-01T00:00:00.000Z"),
    updatedAt: new Date("2026-07-01T00:00:00.000Z"),
    ...overrides,
  }
}
