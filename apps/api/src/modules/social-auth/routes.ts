import {
  socialEmailCompleteSchema,
  socialEmailInputSchema,
  socialProviderSchema,
  updateSocialProviderSchema,
  type SocialCallbackResult,
} from "@linksense/shared"
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify"
import { z } from "zod"
import { randomToken } from "../../lib/crypto.js"
import { AppError } from "../../lib/errors.js"
import { ok } from "../../lib/http.js"
import { resolveLocale } from "../../lib/locale.js"
import { assertCookieRequestOrigin, setRefreshCookie } from "../auth/routes.js"
import type { AuthService } from "../auth/service.js"
import type { SocialAuthService, SocialCompletion } from "./service.js"
import { SocialFailure, type SocialRepository } from "./repository.js"
import type { SocialSettingsService } from "./settings.js"

const FLOW_COOKIE = "linksense_social_flow"
const PENDING_COOKIE = "linksense_social_pending"
const COOKIE_PATH = "/api/v1/auth/social"
const providerParams = z.strictObject({ provider: socialProviderSchema })
const parameters = z.record(z.string().max(128), z.string().max(16_384))
type Options = {
  service: Pick<
    SocialAuthService,
    "start" | "complete" | "sendVerification" | "verifyEmail"
  >
  settings: Pick<SocialSettingsService, "getAdminSettings" | "update">
  repository: Pick<SocialRepository, "list" | "unlink">
  auth: Pick<AuthService, "createSocialSession" | "getCurrentUser">
  publicBaseUrl: string
}

export const socialAuthRoutes: FastifyPluginAsync<Options> = async (
  app,
  options,
) => {
  const secure = new URL(options.publicBaseUrl).protocol === "https:"
  const cookieOptions = {
    path: COOKIE_PATH,
    httpOnly: true,
    secure,
    sameSite: secure ? ("none" as const) : ("lax" as const),
    maxAge: 900,
  }
  app.addHook("onSend", async (_request, reply) => {
    reply
      .header("cache-control", "no-store")
      .header("referrer-policy", "no-referrer")
  })
  app.addContentTypeParser(
    "application/x-www-form-urlencoded",
    { parseAs: "string", bodyLimit: 32_768 },
    (_request, body, done) => {
      try {
        const values = new URLSearchParams(String(body))
        const result: Record<string, string> = {}
        for (const [key, value] of values) {
          if (Object.hasOwn(result, key)) throw new Error("duplicate parameter")
          Object.defineProperty(result, key, { value, enumerable: true })
        }
        done(null, parameters.parse(result))
      } catch {
        done(new AppError("SOCIAL_AUTH_FAILED"))
      }
    },
  )

  app.get("/api/v1/auth/social/providers", async (request) => {
    const settings = await options.settings.getAdminSettings()
    return ok(
      settings
        .filter((provider) => provider.enabled)
        .map((provider) => provider.provider),
      request,
    )
  })
  app.post("/api/v1/auth/social/:provider/start", async (request, reply) => {
    assertCookieRequestOrigin(request)
    const { provider } = providerParams.parse(request.params)
    const browser = randomToken()
    const url = await options.service.start(provider, browser, null, request.ip)
    reply
      .setCookie(FLOW_COOKIE, browser, cookieOptions)
      .clearCookie(PENDING_COOKIE, cookieOptions)
    return ok({ authorization_url: url }, request)
  })
  app.post(
    "/api/v1/auth/social/:provider/link",
    { preHandler: app.authenticate },
    async (request, reply) => {
      assertCookieRequestOrigin(request)
      const { provider } = providerParams.parse(request.params)
      const actor = await options.auth.getCurrentUser(actorId(request))
      const browser = randomToken()
      const url = await options.service.start(
        provider,
        browser,
        { id: actor.id, authValidAfter: actor.authValidAfter.toISOString() },
        request.ip,
      )
      reply
        .setCookie(FLOW_COOKIE, browser, cookieOptions)
        .clearCookie(PENDING_COOKIE, cookieOptions)
      return ok({ authorization_url: url }, request)
    },
  )
  const accept = async (
    result: SocialCompletion,
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<SocialCallbackResult> => {
    if (result.result === "verify_email") {
      reply.setCookie(PENDING_COOKIE, result.pending, cookieOptions)
      reply.setCookie(
        FLOW_COOKIE,
        request.cookies[FLOW_COOKIE] ?? "",
        cookieOptions,
      )
    } else {
      if (result.result === "success") {
        const session = await options.auth.createSocialSession(
          result.account.userId,
          result.provider,
          metadata(request),
          result.account.authValidAfter,
        )
        setRefreshCookie(
          reply,
          "linksense_refresh",
          session.refreshToken,
          secure,
        )
      }
      reply
        .clearCookie(FLOW_COOKIE, cookieOptions)
        .clearCookie(PENDING_COOKIE, cookieOptions)
    }
    return result.result
  }
  app.route({
    method: ["GET", "POST"],
    url: "/api/v1/auth/social/:provider/callback",
    bodyLimit: 32_768,
    handler: async (request, reply) => {
      let result: SocialCallbackResult
      try {
        const { provider } = providerParams.parse(request.params)
        if ((provider === "apple") !== (request.method === "POST"))
          throw new SocialFailure("failed")
        const values = parameters.parse(
          request.method === "POST" ? request.body : request.query,
        )
        result = await accept(
          await options.service.complete(
            provider,
            values,
            request.cookies[FLOW_COOKIE] ?? "",
            metadata(request),
          ),
          request,
          reply,
        )
      } catch (error) {
        result = callbackFailure(error)
        // A failed authorization must not log the user out of their existing session.
        reply
          .clearCookie(FLOW_COOKIE, cookieOptions)
          .clearCookie(PENDING_COOKIE, cookieOptions)
      }
      const destination = new URL(
        "/auth/social/callback",
        options.publicBaseUrl,
      )
      destination.searchParams.set("result", result)
      return reply.code(303).redirect(destination.toString())
    },
  })
  app.post("/api/v1/auth/social/registration/email", async (request, reply) => {
    assertCookieRequestOrigin(request)
    const { email } = socialEmailInputSchema.parse(request.body)
    await options.service.sendVerification(
      request.cookies[PENDING_COOKIE] ?? "",
      request.cookies[FLOW_COOKIE] ?? "",
      email,
      resolveLocale(request),
      request.ip,
    )
    return reply.code(202).send(ok({ sent: true }, request))
  })
  app.post(
    "/api/v1/auth/social/registration/complete",
    async (request, reply) => {
      assertCookieRequestOrigin(request)
      const { token } = socialEmailCompleteSchema.parse(request.body)
      let result: SocialCallbackResult
      try {
        result = await accept(
          await options.service.verifyEmail(
            token,
            request.cookies[PENDING_COOKIE] ?? "",
            request.cookies[FLOW_COOKIE] ?? "",
            metadata(request),
          ),
          request,
          reply,
        )
      } catch (error) {
        result = callbackFailure(error)
      }
      return ok({ result }, request)
    },
  )
  app.get(
    "/api/v1/me/social-accounts",
    { preHandler: app.authenticate },
    async (request) =>
      ok(await options.repository.list(actorId(request)), request),
  )
  app.delete(
    "/api/v1/me/social-accounts/:provider",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { provider } = providerParams.parse(request.params)
      await options.repository.unlink(
        actorId(request),
        provider,
        metadata(request),
      )
      return reply.code(204).send()
    },
  )
  app.get(
    "/api/v1/admin/social-authentication-settings",
    { preHandler: app.requireAdmin },
    async (request) => ok(await options.settings.getAdminSettings(), request),
  )
  app.put(
    "/api/v1/admin/social-authentication-settings/:provider",
    { preHandler: app.requireAdmin },
    async (request) => {
      const { provider } = providerParams.parse(request.params)
      return ok(
        await options.settings.update(
          provider,
          updateSocialProviderSchema.parse(request.body),
          actorId(request),
          metadata(request),
        ),
        request,
      )
    },
  )
}
function actorId(request: FastifyRequest): string {
  if (!request.authUser) throw new AppError("AUTH_REQUIRED")
  return request.authUser.id
}
function metadata(request: FastifyRequest) {
  return {
    ipAddress: request.ip,
    userAgent: request.headers["user-agent"] ?? null,
  }
}
function callbackFailure(error: unknown): SocialCallbackResult {
  return error instanceof SocialFailure
    ? error.result
    : error instanceof AppError && error.code === "USER_DISABLED"
      ? "disabled"
      : "failed"
}
