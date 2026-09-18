import cors from "@fastify/cors"
import Fastify from "fastify"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import {
  createApiCorsOptions,
  sseCorsHeaders,
} from "../src/lib/cors.js"

const publicOrigin = "https://linksense.example.test"
const app = Fastify()

beforeAll(async () => {
  await app.register(cors, createApiCorsOptions(publicOrigin))
  await app.ready()
})

afterAll(() => app.close())

describe("API CORS preflight", () => {
  it.each([
    ["PUT", "/api/v1/conversations/conversation-1/draft"],
    ["PATCH", "/api/v1/admin/user-groups/group-1"],
    ["DELETE", "/api/v1/admin/user-groups/group-1"],
  ])(
    "allows the browser to send %s requests from the configured web origin",
    async (method, url) => {
      const response = await app.inject({
        method: "OPTIONS",
        url,
        headers: {
          origin: publicOrigin,
          "access-control-request-method": method,
          "access-control-request-headers": "authorization,content-type,x-linksense-client-build",
        },
      })

      expect(response.statusCode).toBe(204)
      expect(response.headers["access-control-allow-origin"]).toBe(publicOrigin)
      expect(response.headers["access-control-allow-credentials"]).toBe("true")
      expect(response.headers["access-control-allow-methods"]?.split(/,\s*/u)).toContain(
        method,
      )
      expect(
        response.headers["access-control-allow-headers"]
          ?.toLowerCase()
          .split(/,\s*/u),
      ).toEqual(expect.arrayContaining(["authorization", "content-type", "x-linksense-client-build"]))
      expect(response.headers["access-control-expose-headers"]).toBe("x-linksense-build")
    },
  )

  it("does not allow an unconfigured web origin", async () => {
    const response = await app.inject({
      method: "OPTIONS",
      url: "/api/v1/preflight-target",
      headers: {
        origin: "https://untrusted.example.test",
        "access-control-request-method": "DELETE",
      },
    })

    expect(response.headers["access-control-allow-origin"]).toBeUndefined()
  })
})

describe("SSE CORS headers", () => {
  it("returns credentialed CORS headers only for the configured web origin", () => {
    expect(sseCorsHeaders(publicOrigin, `${publicOrigin}/app`)).toEqual({
      "access-control-allow-origin": publicOrigin,
      "access-control-allow-credentials": "true",
      "access-control-expose-headers": "x-linksense-build",
      vary: "Origin",
    })
  })

  it.each([undefined, "https://untrusted.example.test"])(
    "does not reflect an absent or unconfigured origin: %s",
    (origin) => {
      expect(sseCorsHeaders(origin, publicOrigin)).toEqual({})
    },
  )
})
