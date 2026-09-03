import { beforeEach, describe, expect, it, vi } from "vitest"

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

import { MinioObjectStorage } from "../src/adapters/object-storage.js"
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
