import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const minio = vi.hoisted(() => ({
  bucketExists: vi.fn(),
  makeBucket: vi.fn(),
  putObject: vi.fn(),
  presignedGetObject: vi.fn(),
  constructorOptions: [] as unknown[],
}))

vi.mock("minio", () => ({
  Client: class {
    constructor(options: unknown) {
      minio.constructorOptions.push(options)
    }

    bucketExists = minio.bucketExists
    makeBucket = minio.makeBucket
    putObject = minio.putObject
    presignedGetObject = minio.presignedGetObject
  },
}))

import {
  LocalFilesystemObjectStorage,
  MinioObjectStorage,
} from "../src/adapters/object-storage.js"
import { testConfig } from "./test-config.js"

describe("MinioObjectStorage deployment boundary", () => {
  beforeEach(() => {
    minio.bucketExists.mockReset()
    minio.makeBucket.mockReset()
    minio.putObject.mockReset()
    minio.presignedGetObject.mockReset()
    minio.constructorOptions.length = 0
  })

  it("encodes non-ASCII object metadata before sending HTTP headers", async () => {
    minio.putObject.mockResolvedValue(undefined)
    const storage = new MinioObjectStorage(testConfig())
    const data = Buffer.from("png")

    await storage.putObject("users/user-id/avatars/avatar.png", data, {
      "content-type": "image/png",
      "original-filename": "截图.png",
    })

    expect(minio.putObject).toHaveBeenCalledWith(
      "linksense-files",
      "users/user-id/avatars/avatar.png",
      data,
      data.byteLength,
      {
        "content-type": "image/png",
        "original-filename": "%E6%88%AA%E5%9B%BE.png",
      },
    )
  })

  it("accepts a bucket provisioned by the external deployment", async () => {
    minio.bucketExists.mockResolvedValue(true)
    const storage = new MinioObjectStorage(testConfig())

    await expect(storage.ensureBucket()).resolves.toBeUndefined()
    expect(minio.bucketExists).toHaveBeenCalledWith("linksense-files")
    expect(minio.makeBucket).not.toHaveBeenCalled()
  })

  it("fails startup instead of creating a missing bucket", async () => {
    minio.bucketExists.mockResolvedValue(false)
    const storage = new MinioObjectStorage(testConfig())

    await expect(storage.ensureBucket()).rejects.toThrow(
      "MINIO_BUCKET_NOT_FOUND",
    )
    expect(minio.makeBucket).not.toHaveBeenCalled()
  })

  it("reports a removed external bucket as unhealthy", async () => {
    minio.bucketExists.mockResolvedValue(false)
    const storage = new MinioObjectStorage(testConfig())

    await expect(storage.health()).rejects.toThrow("MINIO_BUCKET_NOT_FOUND")
  })

  it("signs browser URLs with the public endpoint instead of the container endpoint", async () => {
    minio.presignedGetObject.mockResolvedValue(
      "http://localhost:9000/linksense-files/artifacts/example.png?signed=true",
    )
    const storage = new MinioObjectStorage(
      testConfig({
        MINIO_ENDPOINT: "host.docker.internal",
        MINIO_PORT: "9000",
        MINIO_PUBLIC_URL: "http://localhost:9000",
      }),
    )

    await expect(
      storage.presignedGetObject("artifacts/example.png", 300),
    ).resolves.toBe(
      "http://localhost:9000/linksense-files/artifacts/example.png?signed=true",
    )
    expect(minio.constructorOptions).toEqual([
      {
        endPoint: "host.docker.internal",
        port: 9000,
        useSSL: false,
        accessKey: "test-access",
        secretKey: "test-secret",
        region: "us-east-1",
      },
      {
        endPoint: "localhost",
        port: 9000,
        useSSL: false,
        accessKey: "test-access",
        secretKey: "test-secret",
        region: "us-east-1",
      },
    ])
    expect(minio.presignedGetObject).toHaveBeenCalledWith(
      "linksense-files",
      "artifacts/example.png",
      300,
    )
  })
})

describe("LocalFilesystemObjectStorage development boundary", () => {
  const temporaryDirectories: string[] = []

  afterEach(async () => {
    await Promise.all(
      temporaryDirectories.splice(0).map((directory) =>
        rm(directory, { recursive: true, force: true }),
      ),
    )
  })

  async function createStorage() {
    const directory = await mkdtemp(join(tmpdir(), "linksense-storage-"))
    temporaryDirectories.push(directory)
    const storage = new LocalFilesystemObjectStorage(
      testConfig({
        LINKSENSE_EDITION: "core",
        LINKSENSE_OBJECT_STORAGE_PROVIDER: "local-filesystem",
        LINKSENSE_USER_DATA_ROOT: directory,
      }),
    )
    await storage.ensureBucket()
    return storage
  }

  it("persists objects, metadata, and byte ranges", async () => {
    const storage = await createStorage()
    await storage.putObject("artifacts/example.txt", Buffer.from("hello"), {
      "content-type": "text/plain",
    })

    expect(await storage.getObjectSize("artifacts/example.txt")).toBe(5)
    expect(await storage.getObjectContentType("artifacts/example.txt")).toBe(
      "text/plain",
    )
    await expect(
      streamText(await storage.getObjectStream("artifacts/example.txt")),
    ).resolves.toBe("hello")
    await expect(
      streamText(
        await storage.getObjectRangeStream("artifacts/example.txt", 1, 3),
      ),
    ).resolves.toBe("ell")
  })

  it("rejects path traversal keys", async () => {
    const storage = await createStorage()

    await expect(
      storage.putObject("../outside.txt", Buffer.from("no")),
    ).rejects.toThrow("LOCAL_OBJECT_STORAGE_KEY_INVALID")
  })

  it("creates signed browser URLs and rejects tampering", async () => {
    const storage = await createStorage()
    const signedUrl = new URL(
      await storage.presignedGetObject("artifacts/example.txt", 300),
    )
    const input = {
      key: signedUrl.searchParams.get("key") ?? "",
      expires: Number(signedUrl.searchParams.get("expires")),
      signature: signedUrl.searchParams.get("signature") ?? "",
    }

    expect(signedUrl.origin).toBe("https://linksense.example.test")
    expect(signedUrl.pathname).toBe("/api/v1/development/object-storage")
    expect(() => storage.authorizePresignedGet(input)).not.toThrow()
    expect(() =>
      storage.authorizePresignedGet({ ...input, key: "artifacts/other.txt" }),
    ).toThrow("LOCAL_OBJECT_STORAGE_SIGNATURE_INVALID")
  })
})

async function streamText(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks).toString("utf8")
}
