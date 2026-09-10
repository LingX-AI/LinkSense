import { createHash } from "node:crypto"
import { Readable } from "node:stream"

import { describe, expect, it, vi } from "vitest"

import {
  KnowledgeObjectStore,
  type KnowledgeObjectStorageClient,
} from "../src/modules/knowledge-processing/object-store.js"

const knowledgeBaseId = "10000000-0000-4000-8000-000000000001"
const documentId = "20000000-0000-4000-8000-000000000001"
const versionId = "30000000-0000-4000-8000-000000000001"
const objectId = "40000000-0000-4000-8000-000000000001"

describe("KnowledgeObjectStore", () => {
  it("lists only isolated objects inside the managed knowledge namespace", async () => {
    const client = createClient()
    const cutoff = new Date("2026-07-21T00:00:00.000Z")
    const managedKey = `knowledge-bases/${knowledgeBaseId}/documents/${documentId}/versions/${versionId}/display_markdown/${objectId}.md`
    client.listObjectsV2.mockReturnValueOnce(
      objectStream([
        { name: managedKey, lastModified: new Date("2026-07-20T00:00:00.000Z") },
        {
          name: `knowledge-bases/${knowledgeBaseId}/documents/${documentId}/versions/${versionId}/display_markdown/40000000-0000-4000-8000-000000000002.md`,
          lastModified: new Date("2026-07-22T00:00:00.000Z"),
        },
        { name: "unmanaged/private", lastModified: new Date("2026-07-20T00:00:00.000Z") },
      ]),
    )
    const store = createStore(client)

    await expect(store.listManagedObjectsOlderThan(cutoff)).resolves.toEqual([
      { key: managedKey, lastModified: new Date("2026-07-20T00:00:00.000Z") },
    ])
  })

  it("verifies every required knowledge-bucket permission with an isolated probe", async () => {
    const client = createClient()
    const probe = configureHealthyProbe(client)
    const store = createStore(client, {
      createProbeId: () => "00000000-0000-4000-8000-000000000001",
    })

    await expect(store.health()).resolves.toBeUndefined()

    expect(client.bucketExists).toHaveBeenCalledWith("knowledge-test")
    expect(probe.key).toMatch(
      /^_linksense-health\/knowledge-object-store\/[a-f0-9-]+$/u,
    )
    expect(client.putObject).toHaveBeenCalledWith(
      "knowledge-test",
      probe.key,
      expect.any(Readable),
      probe.bytes.length,
      { "content-type": "application/octet-stream" },
    )
    expect(client.statObject).toHaveBeenCalledWith("knowledge-test", probe.key)
    expect(client.getPartialObject).toHaveBeenCalledWith(
      "knowledge-test",
      probe.key,
      2,
      7,
    )
    expect(client.listObjectsV2).toHaveBeenCalledWith(
      "knowledge-test",
      probe.key,
      true,
    )
    expect(client.removeObject).toHaveBeenCalledWith(
      "knowledge-test",
      probe.key,
    )
  })

  it.each([
    "bucket",
    "put",
    "stat",
    "range",
    "list",
    "delete",
  ] as const)(
    "returns one stable redacted error and always cleans up when %s permission fails",
    async (failure) => {
      const client = createClient()
      configureHealthyProbe(client)
      if (failure === "bucket") client.bucketExists.mockResolvedValueOnce(false)
      if (failure === "put") {
        client.putObject.mockRejectedValueOnce(new Error("put denied"))
      }
      if (failure === "stat") client.statObject.mockResolvedValueOnce({ size: 0 })
      if (failure === "range") {
        client.getPartialObject.mockResolvedValueOnce(Readable.from("wrong"))
      }
      if (failure === "list") {
        client.listObjectsV2.mockReturnValueOnce(objectStream([]))
      }
      if (failure === "delete") {
        client.removeObject.mockRejectedValueOnce(new Error("delete denied"))
      }
      const store = createStore(client, {
        createProbeId: () => "private-probe-id",
      })

      const error = await store.health().catch((caught: unknown) => caught)

      expect(error).toMatchObject({
        code: "KNOWLEDGE_OBJECT_STORAGE_UNAVAILABLE",
        retryable: true,
      })
      expect(client.removeObject).toHaveBeenCalledOnce()
      const serialized = JSON.stringify(error)
      expect(serialized).not.toContain("private-probe-id")
      expect(serialized).not.toContain("test-access-key")
      expect(serialized).not.toContain("test-secret-key")
    },
  )

  it("coalesces concurrent probes and reuses the short successful health cache", async () => {
    const client = createClient()
    configureHealthyProbe(client)
    let releaseBucket!: (exists: boolean) => void
    client.bucketExists.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          releaseBucket = resolve
        }),
    )
    let now = 1_000
    let probeId = 0
    const store = createStore(client, {
      cacheTtlMs: 100,
      now: () => now,
      createProbeId: () => `probe-${probeId += 1}`,
    })

    const first = store.health()
    const second = store.health()
    expect(first).toBe(second)
    expect(client.bucketExists).toHaveBeenCalledOnce()

    releaseBucket(true)
    await Promise.all([first, second])
    expect(client.putObject).toHaveBeenCalledOnce()

    await store.health()
    expect(client.putObject).toHaveBeenCalledOnce()

    now += 101
    await store.health()
    expect(client.putObject).toHaveBeenCalledTimes(2)
    expect(client.removeObject).toHaveBeenCalledTimes(2)
  })

  it("removes a newly written object when post-write verification fails", async () => {
    const client = createClient()
    client.statObject
      .mockRejectedValueOnce({ code: "NoSuchKey" })
      .mockResolvedValueOnce({ size: 4 })
    const store = createStore(client)

    await expect(
      store.putImmutable({
        identity: {
          knowledgeBaseId,
          documentId,
          versionId,
          objectType: "original",
          objectId,
          extension: "txt",
        },
        stream: Readable.from("hello"),
        size: 5,
        contentType: "text/plain",
      }),
    ).rejects.toMatchObject({
      code: "KNOWLEDGE_OBJECT_STORAGE_UNAVAILABLE",
    })
    expect(client.removeObject).toHaveBeenCalledWith(
      "knowledge-test",
      `knowledge-bases/${knowledgeBaseId}/documents/${documentId}/versions/${versionId}/original/${objectId}.txt`,
    )
  })

  it("also attempts cleanup when the upload itself fails", async () => {
    const client = createClient()
    client.statObject.mockRejectedValueOnce({ code: "NoSuchKey" })
    client.putObject.mockRejectedValueOnce(new Error("upload interrupted"))
    const store = createStore(client)

    await expect(
      store.putImmutable({
        identity: {
          knowledgeBaseId,
          documentId,
          versionId,
          objectType: "original",
          objectId,
        },
        stream: Readable.from("hello"),
        size: 5,
        contentType: "text/plain",
      }),
    ).rejects.toMatchObject({
      code: "KNOWLEDGE_OBJECT_STORAGE_UNAVAILABLE",
    })
    expect(client.removeObject).toHaveBeenCalledOnce()
  })

  it("contains source stream errors during an immutable upload", async () => {
    const client = createClient()
    client.statObject.mockRejectedValueOnce({ code: "NoSuchKey" })
    client.putObject.mockImplementation(async (_bucket, _key, stream) => {
      await readStream(stream)
    })
    const stream = new Readable({
      read() { this.destroy(new Error("source disconnected")) },
    })
    await expect(createStore(client).putImmutable({
      identity: { knowledgeBaseId, documentId, versionId, objectType: "original", objectId },
      stream, size: 5, contentType: "text/plain",
    })).rejects.toMatchObject({ code: "KNOWLEDGE_OBJECT_STORAGE_UNAVAILABLE" })
    expect(stream.destroyed).toBe(true)
    expect(client.removeObject).toHaveBeenCalledOnce()
  })

  it("stops the source when storage rejects before consuming an upload", async () => {
    const client = createClient()
    client.statObject.mockRejectedValueOnce({ code: "NoSuchKey" })
    client.putObject.mockRejectedValueOnce(new Error("storage unavailable"))
    const stream = new Readable({ read() {} })
    await expect(createStore(client).putImmutable({
      identity: { knowledgeBaseId, documentId, versionId, objectType: "original", objectId },
      stream, size: 5, contentType: "text/plain",
    })).rejects.toMatchObject({ code: "KNOWLEDGE_OBJECT_STORAGE_UNAVAILABLE" })
    expect(stream.destroyed).toBe(true)
  })

  it.each(["hello", ""])("hashes a complete immutable upload including empty data: %j", async (value) => {
    const client = createClient()
    client.statObject.mockRejectedValueOnce({ code: "NoSuchKey" }).mockResolvedValueOnce({ size: value.length })
    client.putObject.mockImplementation(async (_bucket, _key, stream) => {
      // MinIO does not consume the source for a declared zero-byte upload.
      if (value.length) expect(await readStream(stream)).toEqual(Buffer.from(value))
    })
    await expect(createStore(client).putImmutable({
      identity: { knowledgeBaseId, documentId, versionId, objectType: "original", objectId },
      stream: Readable.from(value), size: value.length, contentType: "text/plain",
    })).resolves.toMatchObject({ size: value.length, sha256: createHash("sha256").update(value).digest("hex") })
    expect(client.removeObject).not.toHaveBeenCalled()
  })

  it("verifies that an immutable artifact exists with its exact size and SHA", async () => {
    const client = createClient()
    const bytes = Buffer.from("valid artifact")
    client.statObject.mockResolvedValueOnce({ size: bytes.length })
    client.getObject.mockResolvedValueOnce(Readable.from(bytes))
    const store = createStore(client)
    const key = `knowledge-bases/${knowledgeBaseId}/documents/${documentId}/versions/${versionId}/display_markdown/${objectId}.md`

    await expect(
      store.verifyIntegrity({
        key,
        expectedSha256: createHash("sha256").update(bytes).digest("hex"),
        expectedSizeBytes: BigInt(bytes.length),
      }),
    ).resolves.toBe(true)
  })

  it.each([
    {
      name: "missing",
      prepare(client: ReturnType<typeof createClient>) {
        client.statObject.mockRejectedValueOnce({ code: "NoSuchKey" })
      },
    },
    {
      name: "corrupted",
      prepare(client: ReturnType<typeof createClient>) {
        client.statObject.mockResolvedValueOnce({ size: 5 })
        client.getObject.mockResolvedValueOnce(Readable.from("wrong"))
      },
    },
  ])("rejects a $name immutable artifact", async ({ prepare }) => {
    const client = createClient()
    prepare(client)
    const store = createStore(client)
    const key = `knowledge-bases/${knowledgeBaseId}/documents/${documentId}/versions/${versionId}/display_markdown/${objectId}.md`

    await expect(
      store.verifyIntegrity({
        key,
        expectedSha256: createHash("sha256").update("hello").digest("hex"),
        expectedSizeBytes: 5,
      }),
    ).resolves.toBe(false)
  })

  it("surfaces temporary artifact verification failures as retryable storage errors", async () => {
    const client = createClient()
    client.statObject.mockRejectedValueOnce(new Error("temporary outage"))
    const store = createStore(client)
    const key = `knowledge-bases/${knowledgeBaseId}/documents/${documentId}/versions/${versionId}/display_markdown/${objectId}.md`

    await expect(
      store.verifyIntegrity({
        key,
        expectedSha256: createHash("sha256").update("hello").digest("hex"),
        expectedSizeBytes: 5,
      }),
    ).rejects.toMatchObject({
      code: "KNOWLEDGE_OBJECT_STORAGE_UNAVAILABLE",
      retryable: true,
    })
  })

  it("accepts an empty immutable display Markdown artifact", async () => {
    const client = createClient()
    const bytes = Buffer.alloc(0)
    client.statObject.mockResolvedValueOnce({ size: 0 })
    client.getObject.mockResolvedValueOnce(Readable.from(bytes))
    const store = createStore(client)
    const key = `knowledge-bases/${knowledgeBaseId}/documents/${documentId}/versions/${versionId}/display_markdown/${objectId}.md`

    await expect(
      store.verifyIntegrity({
        key,
        expectedSha256: createHash("sha256").update(bytes).digest("hex"),
        expectedSizeBytes: 0,
      }),
    ).resolves.toBe(true)
  })
})

function createClient() {
  return {
    bucketExists: vi.fn<KnowledgeObjectStorageClient["bucketExists"]>(
      async () => true,
    ),
    putObject: vi.fn<KnowledgeObjectStorageClient["putObject"]>(
      async () => undefined,
    ),
    getObject: vi.fn<KnowledgeObjectStorageClient["getObject"]>(
      async () => Readable.from([]),
    ),
    getPartialObject: vi.fn<KnowledgeObjectStorageClient["getPartialObject"]>(
      async () => Readable.from([]),
    ),
    statObject: vi.fn<KnowledgeObjectStorageClient["statObject"]>(),
    removeObject: vi.fn<KnowledgeObjectStorageClient["removeObject"]>(
      async () => undefined,
    ),
    listObjectsV2: vi.fn<
      NonNullable<KnowledgeObjectStorageClient["listObjectsV2"]>
    >(() => objectStream([])),
  }
}

function configureHealthyProbe(client: ReturnType<typeof createClient>) {
  const state: { key: string; bytes: Buffer<ArrayBufferLike> } = {
    key: "",
    bytes: Buffer.alloc(0),
  }
  client.putObject.mockImplementation(
    async (_bucket, key, stream, declaredSize) => {
      const bytes = await readStream(stream)
      if (bytes.length !== declaredSize) throw new Error("invalid test probe size")
      state.key = key
      state.bytes = bytes
    },
  )
  client.statObject.mockImplementation(async (_bucket, key) => {
    if (key !== state.key) throw { code: "NoSuchKey" }
    return { size: state.bytes.length }
  })
  client.getPartialObject.mockImplementation(
    async (_bucket, key, offset, length) => {
      if (key !== state.key) throw { code: "NoSuchKey" }
      return Readable.from(state.bytes.subarray(offset, offset + length))
    },
  )
  client.listObjectsV2.mockImplementation((_bucket, prefix) =>
    objectStream(state.key.startsWith(prefix) ? [{ name: state.key }] : []),
  )
  return state
}

async function readStream(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}

async function* objectStream(
  values: Array<{ name?: string; lastModified?: Date }>,
) {
  yield* values
}

function createStore(
  client: ReturnType<typeof createClient>,
  healthOptions: ConstructorParameters<typeof KnowledgeObjectStore>[2] = {},
) {
  return new KnowledgeObjectStore(
    {
      endpoint: "minio.example.test",
      port: 9000,
      useSsl: true,
      accessKey: "test-access-key",
      secretKey: "test-secret-key",
      bucket: "knowledge-test",
    },
    client as unknown as KnowledgeObjectStorageClient,
    healthOptions,
  )
}
