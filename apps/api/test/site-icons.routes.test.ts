import Fastify, { type FastifyRequest } from "fastify"
import { afterEach, describe, expect, it, vi } from "vitest"

import { AppError } from "../src/lib/errors.js"
import { siteIconRoutes } from "../src/modules/site-icons/routes.js"
import type { AppServices } from "../src/services.js"

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
)
const apps: Array<ReturnType<typeof Fastify>> = []

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()))
})

async function createApp(
  get: AppServices["siteIcons"]["get"],
  takeSiteIconRequest: AppServices["redis"]["takeSiteIconRequest"] = async () =>
    true,
) {
  const app = Fastify()
  apps.push(app)
  app.decorate("authenticate", async (request: FastifyRequest) => {
    if (request.headers.authorization !== "Bearer test-token") {
      throw new AppError("AUTH_REQUIRED")
    }
    request.authUser = {
      id: "10000000-0000-4000-8000-000000000001",
      email: "owner@example.test",
      name: "Owner",
      role: "user",
      status: "active",
      preferredLocale: "zh-CN",
      avatarObjectKey: null,
      authValidAfter: new Date(0),
    }
  })
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof AppError && error.code === "AUTH_REQUIRED") {
      return reply.code(401).send({ code: error.code })
    }
    return reply.code(500).send({ code: "INTERNAL_ERROR" })
  })
  await app.register(siteIconRoutes, {
    prefix: "/api/v1",
    services: {
      redis: { takeSiteIconRequest },
      siteIcons: { get },
    } as unknown as AppServices,
  })
  return app
}

describe("site icon route", () => {
  it("returns authenticated, verified icon bytes with restrictive response headers", async () => {
    const get = vi.fn(async () => ({
      data: PNG,
      mimeType: "image/png" as const,
      sizeBytes: PNG.byteLength,
    }))
    const app = await createApp(get)

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/site-icons?origin=https%3A%2F%2Fexample.com",
      headers: { authorization: "Bearer test-token" },
    })

    expect(response.statusCode).toBe(200)
    expect(response.rawPayload).toEqual(PNG)
    expect(response.headers["content-type"]).toBe("image/png")
    expect(response.headers["cache-control"]).toBe("private, max-age=86400")
    expect(response.headers["content-length"]).toBe(String(PNG.byteLength))
    expect(response.headers["content-security-policy"]).toContain(
      "sandbox; default-src 'none'",
    )
    expect(get).toHaveBeenCalledWith("https://example.com")
  })

  it("returns an empty response when the origin has no safe favicon", async () => {
    const get = vi.fn(async () => null)
    const app = await createApp(get)

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/site-icons?origin=https%3A%2F%2Fexample.com",
      headers: { authorization: "Bearer test-token" },
    })

    expect(response.statusCode).toBe(204)
    expect(response.rawPayload).toEqual(Buffer.alloc(0))
    expect(get).toHaveBeenCalledWith("https://example.com")
  })

  it("requires an authenticated caller before resolving a site icon", async () => {
    const get = vi.fn(async () => null)
    const app = await createApp(get)

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/site-icons?origin=https%3A%2F%2Fexample.com",
    })

    expect(response.statusCode).toBe(401)
    expect(get).not.toHaveBeenCalled()
  })

  it("falls back without fetching when the per-user icon budget is exhausted", async () => {
    const get = vi.fn(async () => null)
    const takeSiteIconRequest = vi.fn(async () => false)
    const app = await createApp(get, takeSiteIconRequest)

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/site-icons?origin=https%3A%2F%2Fexample.com",
      headers: { authorization: "Bearer test-token" },
    })

    expect(response.statusCode).toBe(204)
    expect(takeSiteIconRequest).toHaveBeenCalledWith(
      "10000000-0000-4000-8000-000000000001",
    )
    expect(get).not.toHaveBeenCalled()
  })

  it("falls back without fetching when the icon rate limiter is unavailable", async () => {
    const get = vi.fn(async () => null)
    const takeSiteIconRequest = vi.fn(async () => {
      throw new Error("redis_unavailable")
    })
    const app = await createApp(get, takeSiteIconRequest)

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/site-icons?origin=https%3A%2F%2Fexample.com",
      headers: { authorization: "Bearer test-token" },
    })

    expect(response.statusCode).toBe(204)
    expect(get).not.toHaveBeenCalled()
  })
})
