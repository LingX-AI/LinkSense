import type { FastifyPluginAsync, FastifyRequest } from "fastify"
import fastifyPlugin from "fastify-plugin"
import { accessTokenClaimsSchema } from "@linksense/shared"

import type { PrismaClient } from "../generated/prisma/client.js"
import { AppError } from "../lib/errors.js"

export type AuthUser = {
  id: string
  email: string
  name: string
  role: "user" | "admin"
  status: "active"
  preferredLocale: "zh-CN" | "en-US" | null
  avatarObjectKey: string | null
  registrationSource?: "self_registration" | "organization_invitation"
  authValidAfter: Date
}

export type AuthenticatedRequest = FastifyRequest & { authUser: AuthUser }

declare module "fastify" {
  interface FastifyInstance {
    authenticate(request: FastifyRequest): Promise<void>
    requireAdmin(request: FastifyRequest): Promise<void>
  }

  interface FastifyRequest {
    authUser?: AuthUser
  }
}

const authenticationPluginImplementation: FastifyPluginAsync<{
  prisma: PrismaClient
}> = async (app, { prisma }) => {
    app.decorate("authenticate", async (request: FastifyRequest) => {
      if (request.authUser) return
      let claims
      try {
        claims = accessTokenClaimsSchema.parse(await request.jwtVerify())
      } catch {
        throw new AppError("AUTH_REQUIRED")
      }
      const user = await prisma.user.findUnique({ where: { id: claims.sub } })
      if (!user || user.status !== "active" || user.accountType !== "member") {
        throw new AppError("AUTH_SESSION_EXPIRED")
      }
      if (
        claims.auth_valid_after !== user.authValidAfter.toISOString() ||
        claims.email !== user.email ||
        claims.role !== user.role
      ) {
        throw new AppError("AUTH_SESSION_EXPIRED")
      }
      if (user.role !== "user" && user.role !== "admin") {
        throw new AppError("AUTH_REQUIRED")
      }
      const locale =
        user.preferredLocale === "zh-CN" || user.preferredLocale === "en-US"
          ? user.preferredLocale
          : null
      request.authUser = {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        status: "active",
        preferredLocale: locale,
        avatarObjectKey: user.avatarObjectKey,
        registrationSource: user.selfRegisteredAt
          ? "self_registration"
          : "organization_invitation",
        authValidAfter: user.authValidAfter,
      }
    })

    app.decorate("requireAdmin", async (request: FastifyRequest) => {
      await app.authenticate(request)
      if (request.authUser?.role !== "admin") throw new AppError("FORBIDDEN")
    })
}

export const authenticationPlugin = fastifyPlugin(authenticationPluginImplementation)
