import fastifyCookie from "@fastify/cookie"
import fastifyJwt from "@fastify/jwt"
import {
  accessTokenClaimsSchema,
  authSessionSchema,
  authUserSchema,
  forgotPasswordInputSchema,
  initializeSystemResultSchema,
  localLoginInputSchema,
  registrationRequestInputSchema,
  type AuthSession as PublicAuthSession,
  type AuthUser,
} from "@linksense/shared"
import type {
  FastifyInstance,
  FastifyPluginAsync,
  FastifyRequest,
  preHandlerHookHandler,
} from "fastify"
import { z } from "zod"

import { ACCESS_TOKEN_TTL_SECONDS } from "../../config.js"
import { AppError, normalizeError } from "../../lib/errors.js"
import { ok } from "../../lib/http.js"
import { resolveLocale } from "../../lib/locale.js"
import type { AuthService } from "./service.js"
import { LoginRateLimitedError } from "./service.js"
import type {
  AuthPersistence,
  AuthenticatedUser,
  SessionMetadata,
} from "./types.js"

const REFRESH_COOKIE = "linksense_refresh"
const emptyBodySchema = z.strictObject({}).default({})
const changePasswordBodySchema = z.strictObject({
  current_password: z.string().min(1).max(1_024),
  new_password: z.string().min(1).max(1_024),
})
const resetPasswordBodySchema = z.strictObject({
  token: z.string().min(32).max(16_384),
  new_password: z.string().min(1).max(1_024),
})
const completeRegistrationBodySchema = z.strictObject({
  token: z.string().min(32).max(16_384),
  new_password: z.string().min(1).max(1_024),
})
const teamsBodySchema = z.strictObject({ token: z.string().min(32).max(65_536) })

export type AuthRoutesOptions = {
  service: AuthService
  secureCookies: boolean
  publicBaseUrl?: string
  authenticate?: preHandlerHookHandler
  getAuthenticatedUser?: (
    request: FastifyRequest,
  ) => AuthenticatedUser | Promise<AuthenticatedUser>
  refreshCookieName?: string
}

export const authRoutes: FastifyPluginAsync<AuthRoutesOptions> = async (
  app,
  options,
) => {
  const cookieName = options.refreshCookieName ?? REFRESH_COOKIE

  app.post("/login", async (request, reply) => {
    const body = localLoginInputSchema.parse(request.body)
    try {
      const session = await options.service.login(
        body.email,
        body.password,
        requestMetadata(request),
      )
      setRefreshCookie(
        reply,
        cookieName,
        session.refreshToken,
        requestUsesSecureCookies(request, options.secureCookies),
      )
      return reply.send(ok(publicSession(session), request))
    } catch (error) {
      if (error instanceof LoginRateLimitedError) {
        reply.header("retry-after", String(error.retryAfterSeconds))
      }
      throw error
    }
  })

  app.post("/refresh", async (request, reply) => {
    emptyBodySchema.parse(request.body ?? {})
    assertCookieRequestOrigin(request)
    const refreshToken = request.cookies[cookieName]
    if (!refreshToken) throw new AppError("AUTH_SESSION_EXPIRED")
    const session = await options.service.refresh(
      refreshToken,
      requestMetadata(request),
    )
    setRefreshCookie(
      reply,
      cookieName,
      session.refreshToken,
      requestUsesSecureCookies(request, options.secureCookies),
    )
    return reply.send(ok(publicSession(session), request))
  })

  app.post("/logout", async (request, reply) => {
    emptyBodySchema.parse(request.body ?? {})
    assertCookieRequestOrigin(request)
    await options.service.logout(request.cookies[cookieName] ?? null)
    clearRefreshCookie(
      reply,
      cookieName,
      requestUsesSecureCookies(request, options.secureCookies),
    )
    return reply.code(204).send()
  })

  app.post("/forgot-password", async (request, reply) => {
    const body = forgotPasswordInputSchema.parse(request.body)
    const result = await options.service.forgotPassword(
      body.email,
      requestMetadata(request),
    )
    return reply.code(202).send(ok(result, request))
  })

  app.post("/registration/request", async (request, reply) => {
    const body = registrationRequestInputSchema.parse(request.body)
    const result = await options.service.requestRegistration(
      body.email,
      resolveLocale(request),
      requestMetadata(request),
    )
    return reply.code(202).send(ok(result, request))
  })

  app.post("/registration/complete", async (request, reply) => {
    const body = completeRegistrationBodySchema.parse(request.body)
    const session = await options.service.completeRegistration(
      body.token,
      body.new_password,
      requestMetadata(request),
    )
    setRefreshCookie(
      reply,
      cookieName,
      session.refreshToken,
      requestUsesSecureCookies(request, options.secureCookies),
    )
    return reply.send(ok(publicSession(session), request))
  })

  app.post("/reset-password", async (request, reply) => {
    const body = resetPasswordBodySchema.parse(request.body)
    await options.service.resetPassword(
      body.token,
      body.new_password,
      auditContext(request),
    )
    return reply.send(ok({ password_reset: true }, request))
  })

  app.post(
    "/change-password",
    { preHandler: options.authenticate ?? missingAuthenticationHook },
    async (request, reply) => {
      const body = changePasswordBodySchema.parse(request.body)
      const user = await resolveAuthenticatedUser(request, options)
      await options.service.changePassword(
        user.id,
        body.current_password,
        body.new_password,
        auditContext(request),
      )
      clearRefreshCookie(
        reply,
        cookieName,
        requestUsesSecureCookies(request, options.secureCookies),
      )
      return reply.send(ok({ password_changed: true }, request))
    },
  )

  app.get("/oidc/start", async (_request, reply) => {
    const result = await options.service.startOidc()
    return reply.redirect(result.authorizationUrl)
  })

  app.get("/oidc/callback", async (request, reply) => {
    try {
      const query = z.record(z.string(), z.string()).parse(request.query)
      const callbackUrl = new URL("https://linksense.invalid/auth/oidc/callback")
      for (const [key, value] of Object.entries(query)) {
        callbackUrl.searchParams.set(key, value)
      }
      const session = await options.service.completeOidc(
        callbackUrl,
        requestMetadata(request),
      )
      setRefreshCookie(
        reply,
        cookieName,
        session.refreshToken,
        requestUsesSecureCookies(request, options.secureCookies),
      )
      return reply.redirect(
        oidcCallbackLocation(options.publicBaseUrl, "success"),
      )
    } catch (error) {
      clearRefreshCookie(
        reply,
        cookieName,
        requestUsesSecureCookies(request, options.secureCookies),
      )
      const normalized = normalizeError(error)
      const result =
        normalized.code === "OIDC_ACCOUNT_PENDING_APPROVAL"
          ? "pending_approval"
          : normalized.code === "USER_DISABLED"
            ? "disabled"
            : "failed"
      return reply.redirect(oidcCallbackLocation(options.publicBaseUrl, result))
    }
  })

  app.post("/teams/exchange", async (request, reply) => {
    const body = teamsBodySchema.parse(request.body)
    const session = await options.service.exchangeTeamsToken(
      body.token,
      requestMetadata(request),
    )
    setRefreshCookie(
      reply,
      cookieName,
      session.refreshToken,
      requestUsesSecureCookies(request, options.secureCookies),
    )
    return reply.send(ok(publicSession(session), request))
  })
}

export const systemInitializationRoutes: FastifyPluginAsync<{
  service: AuthService
}> = async (app, { service }) => {
  app.get("/bootstrap", async (request, reply) => {
    return reply.send(ok(await service.bootstrap(), request))
  })
  app.post("/initialize", async (request, reply) => {
    const result = await service.initialize(request.body, auditContext(request))
    return reply
      .code(201)
      .send(
        ok(
          initializeSystemResultSchema.parse({
            user: projectAuthenticatedUser(result.user),
          }),
          request,
        ),
      )
  })
}

export type AuthenticationRegistrationOptions = {
  jwtSecret: string
  cookieSecret?: string
}

export const authenticationRegistrationPlugin: FastifyPluginAsync<
  AuthenticationRegistrationOptions
> = async (app, options) => {
  await registerAuthentication(app, options)
}

export async function registerAuthentication(
  app: FastifyInstance,
  options: AuthenticationRegistrationOptions,
): Promise<void> {
  await app.register(fastifyCookie, {
    ...(options.cookieSecret ? { secret: options.cookieSecret } : {}),
  })
  await app.register(fastifyJwt, {
    secret: options.jwtSecret,
    sign: { expiresIn: ACCESS_TOKEN_TTL_SECONDS },
  })
}

export function createAuthenticationHooks(persistence: AuthPersistence) {
  const authenticate = async (request: FastifyRequest): Promise<AuthenticatedUser> => {
    let claims
    try {
      claims = accessTokenClaimsSchema.parse(await request.jwtVerify())
    } catch {
      throw new AppError("AUTH_SESSION_EXPIRED")
    }
    const user = await persistence.findUserById(claims.sub)
    if (!user || user.status !== "active") throw new AppError("AUTH_SESSION_EXPIRED")
    if (
      claims.auth_valid_after !== user.authValidAfter.toISOString() ||
      claims.email !== user.email ||
      claims.role !== user.role
    ) {
      throw new AppError("AUTH_SESSION_EXPIRED")
    }
    return stripPasswordFields(user)
  }
  const requireAdmin = async (request: FastifyRequest) => {
    const user = await authenticate(request)
    if (user.role !== "admin" || user.status !== "active") {
      throw new AppError("FORBIDDEN")
    }
    return user
  }
  return { authenticate, requireAdmin }
}

function publicSession(
  session: Awaited<ReturnType<AuthService["login"]>>,
): PublicAuthSession {
  return authSessionSchema.parse({
    access_token: session.accessToken,
    access_token_expires_at: session.accessTokenExpiresAt.toISOString(),
    refresh_session_expires_at: session.refreshSessionExpiresAt.toISOString(),
    user: projectAuthenticatedUser(session.user),
  })
}

export function setRefreshCookie(
  reply: Parameters<typeof clearRefreshCookie>[0],
  name: string,
  token: string,
  secure: boolean,
): void {
  reply.setCookie(name, token, {
    httpOnly: true,
    sameSite: secure ? "none" : "lax",
    secure,
    path: "/api/v1/auth",
    maxAge: 90 * 24 * 60 * 60,
  })
}

function clearRefreshCookie(
  reply: import("fastify").FastifyReply,
  name: string,
  secure: boolean,
): void {
  reply.clearCookie(name, {
    httpOnly: true,
    sameSite: secure ? "none" : "lax",
    secure,
    path: "/api/v1/auth",
  })
}

function oidcCallbackLocation(
  publicBaseUrl: string | undefined,
  result: "success" | "pending_approval" | "disabled" | "failed",
): string {
  const path = "/auth/oidc/callback"
  const url = new URL(path, publicBaseUrl ?? "https://linksense.invalid")
  url.searchParams.set("result", result)
  return publicBaseUrl ? url.toString() : `${url.pathname}${url.search}`
}

export function assertCookieRequestOrigin(request: FastifyRequest): void {
  const fetchSite = request.headers["sec-fetch-site"]
  if (fetchSite !== undefined && fetchSite !== "same-origin") {
    throw new AppError("AUTH_CROSS_ORIGIN_REQUEST_FORBIDDEN")
  }
  const sources = [request.headers.origin, request.headers.referer].filter(
    (source): source is string => typeof source === "string" && source.length > 0,
  )
  if (sources.length === 0) {
    const userAgent = request.headers["user-agent"] ?? ""
    const fetchSite = request.headers["sec-fetch-site"]
    // Non-browser service clients do not get ambient cookies and may omit browser
    // origin headers. Real browsers always expose a browser UA and/or Fetch
    // Metadata, so rejecting that shape retains CSRF protection without breaking
    // internal health and integration clients.
    if (fetchSite !== undefined || isBrowserUserAgent(userAgent)) {
      throw new AppError("AUTH_CROSS_ORIGIN_REQUEST_FORBIDDEN")
    }
    return
  }

  const requestHost = normalizeRequestHost(request.headers.host)
  if (!requestHost) {
    throw new AppError("AUTH_CROSS_ORIGIN_REQUEST_FORBIDDEN")
  }

  try {
    const sourceUrls = sources.map((source) => new URL(source))
    const sourceOrigin = sourceUrls[0]?.origin
    const sourcesDisagree = sourceUrls.some(
      (source) => source.origin !== sourceOrigin,
    )
    const sourceHostDiffers = sourceUrls.some(
      (source) => source.host !== requestHost,
    )
    if (sourcesDisagree || sourceHostDiffers) {
      throw new AppError("AUTH_CROSS_ORIGIN_REQUEST_FORBIDDEN")
    }

    // Fetch Metadata is authoritative in modern browsers and already includes
    // the scheme in its same-origin calculation. Older browsers do not send it,
    // so retain an exact scheme comparison using Fastify's proxy-aware protocol.
    if (fetchSite === undefined) {
      const requestOrigin = new URL(`${request.protocol}://${requestHost}`).origin
      if (sourceOrigin !== requestOrigin) {
        throw new AppError("AUTH_CROSS_ORIGIN_REQUEST_FORBIDDEN")
      }
    }
  } catch (error) {
    if (error instanceof AppError) throw error
    throw new AppError("AUTH_CROSS_ORIGIN_REQUEST_FORBIDDEN")
  }
}

function requestUsesSecureCookies(
  request: FastifyRequest,
  configuredSecureCookies: boolean,
): boolean {
  if (configuredSecureCookies || request.protocol === "https") return true
  if (request.headers["sec-fetch-site"] !== "same-origin") return false

  const requestHost = normalizeRequestHost(request.headers.host)
  if (!requestHost) return false
  const sources = [request.headers.origin, request.headers.referer].filter(
    (source): source is string => typeof source === "string" && source.length > 0,
  )
  if (sources.length === 0) return false

  try {
    return sources.every((source) => {
      const url = new URL(source)
      return url.protocol === "https:" && url.host === requestHost
    })
  } catch {
    return false
  }
}

function normalizeRequestHost(value: string | undefined): string | undefined {
  if (!value) return undefined
  try {
    const url = new URL(`http://${value}`)
    if (
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    ) {
      return undefined
    }
    return url.host
  } catch {
    return undefined
  }
}

function isBrowserUserAgent(value: string): boolean {
  return /(?:Mozilla\/|Chrome\/|Chromium\/|Safari\/|Firefox\/|Edg\/|OPR\/)/u.test(
    value,
  )
}

function requestMetadata(request: FastifyRequest): SessionMetadata {
  return {
    ipAddress: request.ip || null,
    userAgent: sanitizeUserAgent(request.headers["user-agent"]),
  }
}

function auditContext(request: FastifyRequest) {
  return {
    ipAddress: request.ip || null,
    userAgent: sanitizeUserAgent(request.headers["user-agent"]),
  }
}

function sanitizeUserAgent(value: string | undefined): string | null {
  if (!value) return null
  return value
}

async function resolveAuthenticatedUser(
  request: FastifyRequest,
  options: AuthRoutesOptions,
) {
  if (!options.getAuthenticatedUser) throw new AppError("AUTH_REQUIRED")
  return options.getAuthenticatedUser(request)
}

async function missingAuthenticationHook(): Promise<never> {
  throw new AppError("AUTH_REQUIRED")
}

function stripPasswordFields(user: Awaited<ReturnType<AuthPersistence["findUserById"]>>) {
  if (!user) throw new AppError("AUTH_SESSION_EXPIRED")
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    avatarObjectKey: user.avatarObjectKey,
    role: user.role,
    status: user.status,
    preferredLocale: user.preferredLocale,
    runningMessageAction: user.runningMessageAction,
    lastLoginAt: user.lastLoginAt,
    lastLoginMethod: user.lastLoginMethod,
    passwordUpdatedAt: user.passwordUpdatedAt,
    authValidAfter: user.authValidAfter,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  }
}

export function projectAuthenticatedUser(user: AuthenticatedUser): AuthUser {
  return authUserSchema.parse({
    id: user.id,
    email: user.email,
    name: user.name,
    avatar_object_key: user.avatarObjectKey,
    role: user.role,
    status: user.status,
    preferred_locale: user.preferredLocale,
    running_message_action: user.runningMessageAction,
    last_login_at: user.lastLoginAt?.toISOString() ?? null,
    last_login_method: user.lastLoginMethod,
    password_updated_at: user.passwordUpdatedAt?.toISOString() ?? null,
    created_at: user.createdAt.toISOString(),
    updated_at: user.updatedAt.toISOString(),
  })
}
