import { createHash } from "node:crypto"
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { PassThrough, Readable } from "node:stream"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const minio = vi.hoisted(() => ({
  bucketExists: vi.fn(),
  makeBucket: vi.fn(),
  putObject: vi.fn(),
  presignedGetObject: vi.fn(),
  getObject: vi.fn(),
  removeObjects: vi.fn(),
  newPostPolicy: vi.fn(),
  presignedPostPolicy: vi.fn(),
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
    getObject = minio.getObject
    removeObjects = minio.removeObjects
    newPostPolicy = minio.newPostPolicy
    presignedPostPolicy = minio.presignedPostPolicy
  },
}))

import {
  LocalFilesystemObjectStorage,
  MinioObjectStorage,
} from "../src/adapters/object-storage.js"
import { testConfig } from "./test-config.js"

class FakePostPolicy {
  bucket?: string
  key?: string
  contentType?: string
  contentLengthRange?: [number, number]
  expires?: Date

  setBucket(bucket: string): void {
    this.bucket = bucket
  }

  setKey(key: string): void {
    this.key = key
  }

  setContentType(contentType: string): void {
    this.contentType = contentType
  }

  setContentLengthRange(minimum: number, maximum: number): void {
    this.contentLengthRange = [minimum, maximum]
  }

  setExpires(expires: Date): void {
    this.expires = expires
  }
}

describe("MinioObjectStorage deployment boundary", () => {
  beforeEach(() => {
    minio.bucketExists.mockReset()
    minio.makeBucket.mockReset()
    minio.putObject.mockReset()
    minio.presignedGetObject.mockReset()
    minio.getObject.mockReset()
    minio.removeObjects.mockReset()
    minio.newPostPolicy.mockReset()
    minio.presignedPostPolicy.mockReset()
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
        transport: { request: expect.any(Function) },
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

  it("streams an exact-size upload through the MinIO client", async () => {
    let uploaded = Buffer.alloc(0)
    minio.putObject.mockImplementation(async (
      _bucket: string,
      _key: string,
      stream: Readable,
      size: number,
      metadata: Record<string, string>,
    ) => {
      expect(typeof stream.pipe).toBe("function")
      const chunks: Buffer[] = []
      for await (const chunk of stream) chunks.push(Buffer.from(chunk))
      uploaded = Buffer.concat(chunks)
      expect(size).toBe(uploaded.byteLength)
      expect(metadata).toEqual({ "content-type": "application/octet-stream" })
    })
    const storage = new MinioObjectStorage(testConfig())

    await storage.putObjectStream(
      "desktop-artifacts/example.zip",
      Readable.from([Buffer.from("artifact")]),
      8,
      { "content-type": "application/octet-stream" },
    )

    expect(uploaded.toString("utf8")).toBe("artifact")
    expect(minio.putObject).toHaveBeenCalledWith(
      "linksense-files",
      "desktop-artifacts/example.zip",
      expect.anything(),
      8,
      { "content-type": "application/octet-stream" },
    )
  })

  it("rejects MinIO stream uploads whose byte length differs from the declared size", async () => {
    minio.putObject.mockImplementation(async (
      _bucket: string,
      _key: string,
      stream: Readable,
    ) => {
      for await (const chunk of stream) {
        if (!Buffer.isBuffer(chunk)) throw new Error("expected streamed bytes")
      }
    })
    const storage = new MinioObjectStorage(testConfig())

    await expect(
      storage.putObjectStream(
        "desktop-artifacts/short.bin",
        Readable.from([Buffer.from("abc")]),
        8,
      ),
    ).rejects.toThrow("OBJECT_STORAGE_STREAM_SIZE_MISMATCH")
    await expect(
      storage.putObjectStream(
        "desktop-artifacts/long.bin",
        Readable.from([Buffer.from("abcdef")]),
        4,
      ),
    ).rejects.toThrow("OBJECT_STORAGE_STREAM_SIZE_MISMATCH")
    await expect(
      storage.putObjectStream(
        "desktop-artifacts/empty.bin",
        Readable.from([]),
        4,
      ),
    ).rejects.toThrow("OBJECT_STORAGE_STREAM_SIZE_MISMATCH")
  })

  it("rejects zero or non-integer stream sizes before calling MinIO", async () => {
    const storage = new MinioObjectStorage(testConfig())

    await expect(
      storage.putObjectStream(
        "desktop-artifacts/empty.bin",
        Readable.from([]),
        0,
      ),
    ).rejects.toThrow("OBJECT_STORAGE_STREAM_SIZE_INVALID")
    await expect(
      storage.putObjectStream(
        "desktop-artifacts/fractional.bin",
        Readable.from([Buffer.from("ab")]),
        1.5,
      ),
    ).rejects.toThrow("OBJECT_STORAGE_STREAM_SIZE_INVALID")
    expect(minio.putObject).not.toHaveBeenCalled()
  })

  it("aborts a MinIO stream upload when the caller signal is aborted", async () => {
    minio.putObject.mockImplementation(async (
      _bucket: string,
      _key: string,
      stream: Readable,
    ) => {
      for await (const chunk of stream) {
        if (!Buffer.isBuffer(chunk)) throw new Error("expected streamed bytes")
      }
    })
    const storage = new MinioObjectStorage(testConfig())
    const controller = new AbortController()
    const source = new PassThrough()
    const upload = storage.putObjectStream(
      "desktop-artifacts/aborted.bin",
      source,
      64,
      {},
      controller.signal,
    )
    source.write(Buffer.from("partial"))
    controller.abort()

    await expect(upload).rejects.toMatchObject({ name: "AbortError" })
  })

  it("preserves the raw MinIO stream without a signal and cancels it with one", async () => {
    const storage = new MinioObjectStorage(testConfig())
    const plain = new PassThrough()
    minio.getObject.mockResolvedValueOnce(plain)

    await expect(
      storage.getObjectStream("desktop-artifacts/example.zip"),
    ).resolves.toBe(plain)

    const cancellable = new PassThrough()
    const aborted = new Promise<Error>((resolve) => {
      cancellable.once("error", resolve)
    })
    minio.getObject.mockResolvedValueOnce(cancellable)
    const controller = new AbortController()

    await expect(
      storage.getObjectStream(
        "desktop-artifacts/example.zip",
        controller.signal,
      ),
    ).resolves.toBe(cancellable)

    controller.abort()

    expect(cancellable.destroyed).toBe(true)
    await expect(aborted).resolves.toMatchObject({ name: "AbortError" })
    expect(minio.getObject).toHaveBeenCalledWith(
      "linksense-files",
      "desktop-artifacts/example.zip",
    )
  })

  it("rejects a MinIO read before requesting it when the signal is already aborted", async () => {
    const storage = new MinioObjectStorage(testConfig())

    await expect(
      storage.getObjectStream("desktop-artifacts/example.zip", AbortSignal.abort()),
    ).rejects.toMatchObject({ name: "AbortError" })
    expect(minio.getObject).not.toHaveBeenCalled()
  })

  it("surfaces a partial batch delete failure and permits a retry of the exact keys", async () => {
    const keys = ["artifacts/report/index.html", "artifacts/report/style.css"]
    minio.removeObjects
      .mockResolvedValueOnce([{ Code: "AccessDenied", Key: keys[1] }])
      .mockResolvedValueOnce([])
    const storage = new MinioObjectStorage(testConfig())

    await expect(storage.removeObjects(keys, AbortSignal.timeout(1_000)))
      .rejects.toThrow("OBJECT_STORAGE_BATCH_DELETE_FAILED")
    await expect(storage.removeObjects(keys, AbortSignal.timeout(1_000))).resolves.toBeUndefined()
    expect(minio.removeObjects.mock.calls).toEqual([
      ["linksense-files", keys], ["linksense-files", keys],
    ])
  })

  it("binds POST policies to the exact key, size, type, and expiry", async () => {
    const policy = new FakePostPolicy()
    const fixture = {
      postURL: "http://localhost:9000/linksense-files",
      formData: {
        key: "desktop-artifacts/example.zip",
        "Content-Type": "application/octet-stream",
        policy: "fixture-policy",
        "x-amz-signature": "fixture-signature",
      },
    }
    minio.newPostPolicy.mockReturnValue(policy)
    minio.presignedPostPolicy.mockResolvedValue(fixture)
    const storage = new MinioObjectStorage(
      testConfig({ MINIO_PUBLIC_URL: "http://localhost:9000" }),
    )
    const expiresAt = new Date("2030-01-01T00:00:00.000Z")

    await expect(
      storage.presignedPostObject(
        "desktop-artifacts/example.zip",
        4096,
        expiresAt,
      ),
    ).resolves.toEqual({ url: fixture.postURL, fields: fixture.formData })

    expect(policy).toMatchObject({
      bucket: "linksense-files",
      key: "desktop-artifacts/example.zip",
      contentType: "application/octet-stream",
      contentLengthRange: [4096, 4096],
      expires: expiresAt,
    })
    expect(minio.presignedPostPolicy).toHaveBeenCalledWith(policy)
    expect(minio.constructorOptions[1]).toMatchObject({
      endPoint: "localhost",
      port: 9000,
      useSSL: false,
    })
  })

  it("rejects invalid POST policy sizes and expiries before signing", async () => {
    const storage = new MinioObjectStorage(testConfig())
    const expiresAt = new Date("2030-01-01T00:00:00.000Z")

    await expect(
      storage.presignedPostObject("desktop-artifacts/example.zip", 0, expiresAt),
    ).rejects.toThrow("MINIO_POST_POLICY_INVALID")
    await expect(
      storage.presignedPostObject(
        "desktop-artifacts/example.zip",
        1024,
        new Date(Number.NaN),
      ),
    ).rejects.toThrow("MINIO_POST_POLICY_INVALID")
    expect(minio.newPostPolicy).not.toHaveBeenCalled()
    expect(minio.presignedPostPolicy).not.toHaveBeenCalled()
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

  it("persists exact-size streams and removes temporary files", async () => {
    const storage = await createStorage()
    await storage.putObjectStream(
      "artifacts/streamed.bin",
      Readable.from([Buffer.from("hello"), Buffer.from(" world")]),
      11,
      { "content-type": "application/octet-stream" },
    )

    expect(await storage.getObjectSize("artifacts/streamed.bin")).toBe(11)
    expect(await storage.getObjectContentType("artifacts/streamed.bin")).toBe(
      "application/octet-stream",
    )
    await expect(
      streamText(await storage.getObjectStream("artifacts/streamed.bin")),
    ).resolves.toBe("hello world")
    expect(
      (await readdir(join(storage.objectRoot, "artifacts"))).filter((name) =>
        name.endsWith(".tmp"),
      ),
    ).toEqual([])
  })

  it("cleans a crashed stream's temporary data for its exact key without deleting the completed object", async () => {
    const storage = await createStorage()
    const key = "desktop-artifact-staging/fixture"
    await storage.putObject(key, Buffer.from("completed"))
    const uploadDirectory = (objectKey: string) =>
      join(storage.objectRoot, "..", ".stream-uploads", createHash("sha256").update(objectKey).digest("hex"))
    const stale = uploadDirectory(key)
    const unrelated = uploadDirectory(`${key}-other`)
    for (const directory of [stale, unrelated]) {
      await mkdir(join(directory, "write-crashed"), { recursive: true })
      await writeFile(join(directory, "write-crashed", "content"), "partial")
    }
    await storage.removeIncompleteUpload(key, AbortSignal.timeout(2_000))

    await expect(readdir(stale)).rejects.toMatchObject({ code: "ENOENT" })
    await expect(readdir(unrelated)).resolves.toEqual(["write-crashed"])
    await expect(streamText(await storage.getObjectStream(key))).resolves.toBe("completed")
  })

  it("keeps existing content when a streamed write has the wrong length", async () => {
    const storage = await createStorage()
    const objectKey = "artifacts/example.txt"
    await storage.putObject(objectKey, Buffer.from("original"), {
      "content-type": "text/plain",
    })

    await expect(
      storage.putObjectStream(
        objectKey,
        Readable.from([Buffer.from("short")]),
        11,
      ),
    ).rejects.toThrow("OBJECT_STORAGE_STREAM_SIZE_MISMATCH")
    await expect(
      storage.putObjectStream(
        objectKey,
        Readable.from([Buffer.from("longer than ten")]),
        5,
      ),
    ).rejects.toThrow("OBJECT_STORAGE_STREAM_SIZE_MISMATCH")

    await expect(streamText(await storage.getObjectStream(objectKey))).resolves.toBe(
      "original",
    )
    expect(await storage.getObjectContentType(objectKey)).toBe("text/plain")
    expect(
      (await readdir(join(storage.objectRoot, "artifacts"))).filter((name) =>
        name.endsWith(".tmp"),
      ),
    ).toEqual([])
  })

  it("rejects zero declared sizes and empty streams without creating an object", async () => {
    const storage = await createStorage()

    await expect(
      storage.putObjectStream("artifacts/empty.bin", Readable.from([]), 0),
    ).rejects.toThrow("LOCAL_OBJECT_STORAGE_STREAM_SIZE_INVALID")
    await expect(
      storage.putObjectStream("artifacts/empty.bin", Readable.from([]), 1),
    ).rejects.toThrow("OBJECT_STORAGE_STREAM_SIZE_MISMATCH")
    await expect(
      storage.getObjectSize("artifacts/empty.bin"),
    ).rejects.toMatchObject({ code: "ENOENT" })
  })

  it("keeps existing content and removes temporary files when a streamed write is aborted", async () => {
    const storage = await createStorage()
    const objectKey = "artifacts/example.txt"
    await storage.putObject(objectKey, Buffer.from("original"), {
      "content-type": "text/plain",
    })
    const controller = new AbortController()
    const source = new PassThrough()
    const upload = storage.putObjectStream(
      objectKey,
      source,
      1024,
      {},
      controller.signal,
    )
    source.write(Buffer.from("partial"))
    controller.abort()

    await expect(upload).rejects.toMatchObject({ name: "AbortError" })
    await expect(streamText(await storage.getObjectStream(objectKey))).resolves.toBe(
      "original",
    )
    expect(await storage.getObjectContentType(objectKey)).toBe("text/plain")
    expect(
      (await readdir(join(storage.objectRoot, "artifacts"))).filter((name) =>
        name.endsWith(".tmp"),
      ),
    ).toEqual([])
  })

  it("rejects path traversal keys", async () => {
    const storage = await createStorage()

    await expect(
      storage.putObject("../outside.txt", Buffer.from("no")),
    ).rejects.toThrow("LOCAL_OBJECT_STORAGE_KEY_INVALID")
    await expect(
      storage.putObjectStream(
        "../outside.txt",
        Readable.from([Buffer.from("no")]),
        2,
      ),
    ).rejects.toThrow("LOCAL_OBJECT_STORAGE_KEY_INVALID")
  })

  it("keeps the existing object and metadata when a write or delete is already cancelled", async () => {
    const storage = await createStorage()
    const objectKey = "artifacts/example.txt"
    await storage.putObject(objectKey, Buffer.from("original"), { "content-type": "text/plain" })
    const signal = AbortSignal.abort()

    await expect(storage.putObject(objectKey, Buffer.from("replacement"), {}, signal))
      .rejects.toMatchObject({ name: "AbortError" })
    await expect(storage.removeObject(objectKey, signal))
      .rejects.toMatchObject({ name: "AbortError" })
    await expect(streamText(await storage.getObjectStream(objectKey))).resolves.toBe("original")
    expect(await storage.getObjectContentType(objectKey)).toBe("text/plain")
  })

  it("rejects local reads when the signal is already aborted", async () => {
    const storage = await createStorage()
    await storage.putObject("artifacts/example.txt", Buffer.from("hello"))

    await expect(
      storage.getObjectStream("artifacts/example.txt", AbortSignal.abort()),
    ).rejects.toMatchObject({ name: "AbortError" })
  })

  it("cancels an in-flight local read when its signal is aborted", async () => {
    const storage = await createStorage()
    await storage.putObject("artifacts/example.txt", Buffer.from("hello"))
    const controller = new AbortController()
    const stream = await storage.getObjectStream(
      "artifacts/example.txt",
      controller.signal,
    )
    const aborted = new Promise<Error>((resolve) => {
      stream.once("error", resolve)
    })

    controller.abort()

    expect(stream.destroyed).toBe(true)
    await expect(aborted).resolves.toMatchObject({ name: "AbortError" })
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
