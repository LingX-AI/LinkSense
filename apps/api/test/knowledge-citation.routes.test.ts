import { Readable } from "node:stream"

import Fastify from "fastify"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { KnowledgeCitationReadService } from "../src/modules/knowledge/citation-read.js"
import { knowledgeCitationRoutes } from "../src/modules/knowledge/citation-routes.js"

const ACTOR = {
  id: "00000000-0000-4000-8000-000000000001",
  role: "user" as const,
  status: "active" as const,
}
const CITATION_ID = "00000000-0000-4000-8000-000000000002"
const ASSET_ID = "00000000-0000-4000-8000-000000000003"
const apps: Array<ReturnType<typeof Fastify>> = []

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()))
})

describe("knowledge citation routes", () => {
  it("streams a citation-authorized asset with private safe headers", async () => {
    const getAsset = vi.fn(async () => ({
      filename: "portrait.png",
      mimeType: "image/png",
      sizeBytes: 3n,
      stream: Readable.from("png"),
    }))
    const app = Fastify()
    apps.push(app)
    await app.register(knowledgeCitationRoutes, {
      service: { getAsset } as unknown as KnowledgeCitationReadService,
      publicBaseUrl: "https://linksense.example.test",
      resolveActor: vi.fn(async () => ACTOR),
    })
    await app.ready()

    const response = await app.inject({
      method: "GET",
      url: `/${CITATION_ID}/assets/${ASSET_ID}`,
    })

    expect(response.statusCode).toBe(200)
    expect(response.rawPayload).toEqual(Buffer.from("png"))
    expect(response.headers["cache-control"]).toBe("private, no-store")
    expect(response.headers["content-type"]).toBe("image/png")
    expect(response.headers["content-disposition"]).toContain("inline")
    expect(response.headers["content-security-policy"]).toBe(
      "default-src 'none'; sandbox",
    )
    expect(response.headers["x-content-type-options"]).toBe("nosniff")
    expect(getAsset).toHaveBeenCalledWith(ACTOR, CITATION_ID, ASSET_ID)
  })
})
