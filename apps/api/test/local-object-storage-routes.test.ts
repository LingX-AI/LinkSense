import Fastify from "fastify"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import { registerLocalObjectStorageRoutes } from "../src/adapters/local-object-storage-routes.js"
import { LocalFilesystemObjectStorage } from "../src/adapters/object-storage.js"
import { testConfig } from "./test-config.js"

describe("local object storage routes", () => {
  const temporaryDirectories: string[] = []

  afterEach(async () => {
    await Promise.all(
      temporaryDirectories.splice(0).map((directory) =>
        rm(directory, { recursive: true, force: true }),
      ),
    )
  })

  async function createFixture() {
    const directory = await mkdtemp(join(tmpdir(), "linksense-storage-route-"))
    temporaryDirectories.push(directory)
    const storage = new LocalFilesystemObjectStorage(
      testConfig({
        LINKSENSE_EDITION: "core",
        LINKSENSE_OBJECT_STORAGE_PROVIDER: "local-filesystem",
        LINKSENSE_USER_DATA_ROOT: directory,
      }),
    )
    await storage.ensureBucket()
    await storage.putObject("artifacts/example.txt", Buffer.from("hello"), {
      "content-type": "text/plain",
    })
    await storage.putObject(
      "artifacts/example.html",
      Buffer.from('<script src="example.js"></script>'),
      { "content-type": "text/html; charset=utf-8" },
    )
    await storage.putObject(
      "artifacts/example.js",
      Buffer.from("globalThis.compromised = true"),
      { "content-type": "text/javascript" },
    )
    const app = Fastify()
    await registerLocalObjectStorageRoutes(app, storage)
    return { app, storage }
  }

  it("serves a signed object and supports byte ranges", async () => {
    const { app, storage } = await createFixture()
    const url = await storage.presignedGetObject("artifacts/example.txt", 300)
    const path = new URL(url).pathname + new URL(url).search

    const response = await app.inject({
      method: "GET",
      url: path,
      headers: { range: "bytes=1-3" },
    })

    expect(response.statusCode).toBe(206)
    expect(response.body).toBe("ell")
    expect(response.headers["content-type"]).toContain("text/plain")
    expect(response.headers["content-range"]).toBe("bytes 1-3/5")
    await app.close()
  })

  it("does not serve an object when the signature is changed", async () => {
    const { app, storage } = await createFixture()
    const url = new URL(
      await storage.presignedGetObject("artifacts/example.txt", 300),
    )
    url.searchParams.set("signature", "0".repeat(64))

    const response = await app.inject({
      method: "GET",
      url: `${url.pathname}${url.search}`,
    })

    expect(response.statusCode).toBe(404)
    await app.close()
  })

  it.each([
    ["artifacts/example.html", "example.html"],
    ["artifacts/example.js", "example.js"],
  ])(
    "forces active content to download with a sandbox policy",
    async (key, filename) => {
      const { app, storage } = await createFixture()
      const url = new URL(await storage.presignedGetObject(key, 300))

      const response = await app.inject({
        method: "GET",
        url: `${url.pathname}${url.search}`,
      })

      expect(response.statusCode).toBe(200)
      expect(response.headers["content-disposition"]).toContain("attachment")
      expect(response.headers["content-disposition"]).toContain(filename)
      expect(response.headers["content-security-policy"]).toBe(
        "sandbox; default-src 'none'",
      )
      expect(response.headers["content-type"]).toContain(
        "application/octet-stream",
      )
      expect(response.headers["x-content-type-options"]).toBe("nosniff")
      await app.close()
    },
  )
})
