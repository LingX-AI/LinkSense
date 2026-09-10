import { createHash, randomUUID } from "node:crypto"
import { Readable, Transform } from "node:stream"
import { pipeline } from "node:stream/promises"

import { Client } from "minio"
import { z } from "zod"

import { KnowledgeProcessingError } from "./errors.js"

const HEALTH_PROBE_PREFIX = "_linksense-health/knowledge-object-store/"
const HEALTH_PROBE_BYTES = Buffer.from("linksense-minio-health-v1", "utf8")
const HEALTH_PROBE_RANGE_OFFSET = 2
const HEALTH_PROBE_RANGE_LENGTH = 7
const DEFAULT_HEALTH_CACHE_TTL_MS = 5_000

export const knowledgeObjectTypeSchema = z.enum([
  "original",
  "docling_bundle",
  "display_markdown",
  "docling_json",
  "hybrid_chunks",
  "image_projection",
  "retrieval_manifest",
  "asset",
])

export type KnowledgeObjectType = z.infer<typeof knowledgeObjectTypeSchema>

export type KnowledgeObjectIdentity = {
  knowledgeBaseId: string
  documentId: string
  versionId: string
  objectType: KnowledgeObjectType
  objectId?: string
  extension?: string
}

export interface KnowledgeObjectStorageClient {
  bucketExists(bucket: string): Promise<boolean>
  putObject(
    bucket: string,
    key: string,
    stream: Readable,
    size: number,
    metadata?: Record<string, string>,
  ): Promise<unknown>
  getObject(bucket: string, key: string): Promise<Readable>
  getPartialObject(
    bucket: string,
    key: string,
    offset: number,
    length: number,
  ): Promise<Readable>
  statObject(bucket: string, key: string): Promise<{ size: number }>
  removeObject(bucket: string, key: string): Promise<void>
  listObjectsV2?(
    bucket: string,
    prefix: string,
    recursive: boolean,
  ): AsyncIterable<{ name?: string; lastModified?: Date }>
}

export type KnowledgeObjectStoreConfig = {
  endpoint: string
  port: number
  useSsl: boolean
  accessKey: string
  secretKey: string
  bucket: string
}

export class KnowledgeObjectStore {
  private readonly client: KnowledgeObjectStorageClient
  private healthCacheExpiresAt = 0
  private healthInFlight: Promise<void> | undefined

  constructor(
    private readonly config: KnowledgeObjectStoreConfig,
    client?: KnowledgeObjectStorageClient,
    private readonly healthOptions: {
      cacheTtlMs?: number
      now?: () => number
      createProbeId?: () => string
    } = {},
  ) {
    this.client =
      client ??
      new Client({
        endPoint: config.endpoint,
        port: config.port,
        useSSL: config.useSsl,
        accessKey: config.accessKey,
        secretKey: config.secretKey,
      })
  }

  health(): Promise<void> {
    if (this.healthCacheExpiresAt > this.now()) return Promise.resolve()
    if (this.healthInFlight) return this.healthInFlight

    const inFlight = this.runHealthProbe()
      .then(() => {
        this.healthCacheExpiresAt =
          this.now() +
          Math.max(0, this.healthOptions.cacheTtlMs ?? DEFAULT_HEALTH_CACHE_TTL_MS)
      })
      .finally(() => {
        if (this.healthInFlight === inFlight) this.healthInFlight = undefined
      })
    this.healthInFlight = inFlight
    return inFlight
  }

  private async runHealthProbe(): Promise<void> {
    const probeKey = `${HEALTH_PROBE_PREFIX}${(this.healthOptions.createProbeId ?? randomUUID)()}`
    let failed = false
    try {
      if (!(await this.client.bucketExists(this.config.bucket))) {
        throw new Error("knowledge bucket is unavailable")
      }
      await this.client.putObject(
        this.config.bucket,
        probeKey,
        Readable.from(HEALTH_PROBE_BYTES),
        HEALTH_PROBE_BYTES.length,
        { "content-type": "application/octet-stream" },
      )
      const stored = await this.client.statObject(this.config.bucket, probeKey)
      if (stored.size !== HEALTH_PROBE_BYTES.length) {
        throw new Error("knowledge health object size is invalid")
      }

      const range = await this.client.getPartialObject(
        this.config.bucket,
        probeKey,
        HEALTH_PROBE_RANGE_OFFSET,
        HEALTH_PROBE_RANGE_LENGTH,
      )
      const rangeBytes = await readBoundedStream(range, HEALTH_PROBE_RANGE_LENGTH)
      const expectedRange = HEALTH_PROBE_BYTES.subarray(
        HEALTH_PROBE_RANGE_OFFSET,
        HEALTH_PROBE_RANGE_OFFSET + HEALTH_PROBE_RANGE_LENGTH,
      )
      if (!rangeBytes.equals(expectedRange)) {
        throw new Error("knowledge health range is invalid")
      }

      const listObjectsV2 = this.client.listObjectsV2
      if (!listObjectsV2) {
        throw new Error("knowledge health listing is unavailable")
      }
      let listed = false
      for await (const item of listObjectsV2.call(
        this.client,
        this.config.bucket,
        probeKey,
        true,
      )) {
        if (item.name === probeKey) {
          listed = true
          break
        }
      }
      if (!listed) {
        throw new Error("knowledge health object is not listed")
      }
    } catch {
      failed = true
    } finally {
      try {
        await this.client.removeObject(this.config.bucket, probeKey)
      } catch {
        failed = true
      }
    }

    if (failed) {
      throw new KnowledgeProcessingError("KNOWLEDGE_OBJECT_STORAGE_UNAVAILABLE", {
        retryable: true,
      })
    }
  }

  private now(): number {
    return (this.healthOptions.now ?? Date.now)()
  }

  async putImmutable(input: {
    identity: KnowledgeObjectIdentity
    stream: Readable
    size: number
    contentType: string
  }): Promise<{ key: string; sha256: string; size: number }> {
    const key = buildKnowledgeObjectKey(input.identity)
    await this.assertMissing(key)
    const hash = createHash("sha256")
    const hashingStream = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        hash.update(chunk)
        callback(null, chunk)
      },
    })
    const controller = new AbortController()
    const transfer = pipeline(input.stream, hashingStream, { signal: controller.signal })
    try {
      await Promise.all([
        transfer,
        this.client.putObject(
          this.config.bucket,
          key,
          hashingStream,
          input.size,
          { "content-type": input.contentType },
        ),
      ])
      const stored = await this.client.statObject(this.config.bucket, key)
      if (stored.size !== input.size) {
        throw new Error("stored size does not match")
      }
      return { key, sha256: hash.digest("hex"), size: stored.size }
    } catch (error) {
      // A rejected upload must stop its source; source errors must reject the
      // operation instead of escaping from an unobserved pipe EventEmitter.
      controller.abort()
      await transfer.catch(() => undefined)
      // The key is immutable and fully known before upload. A failed multipart
      // completion or post-write verification must not leave an unregistered
      // object consuming quota outside the durable object manifest.
      await this.client
        .removeObject(this.config.bucket, key)
        .catch(() => undefined)
      throw new KnowledgeProcessingError(
        "KNOWLEDGE_OBJECT_STORAGE_UNAVAILABLE",
        { cause: error, retryable: true },
      )
    } finally {
      hashingStream.destroy()
    }
  }

  getStream(key: string): Promise<Readable> {
    assertManagedKnowledgeObjectKey(key)
    return this.client.getObject(this.config.bucket, key)
  }

  getRangeStream(key: string, offset: number, length: number): Promise<Readable> {
    assertManagedKnowledgeObjectKey(key)
    if (!Number.isSafeInteger(offset) || offset < 0) {
      throw new KnowledgeProcessingError(
        "KNOWLEDGE_OBJECT_STORAGE_UNAVAILABLE",
      )
    }
    if (!Number.isSafeInteger(length) || length <= 0) {
      throw new KnowledgeProcessingError(
        "KNOWLEDGE_OBJECT_STORAGE_UNAVAILABLE",
      )
    }
    return this.client.getPartialObject(
      this.config.bucket,
      key,
      offset,
      length,
    )
  }

  async verifyIntegrity(input: {
    key: string
    expectedSha256: string
    expectedSizeBytes: bigint | number
  }): Promise<boolean> {
    try {
      assertManagedKnowledgeObjectKey(input.key)
    } catch {
      return false
    }
    const expectedSha256 = z
      .string()
      .regex(/^[a-f0-9]{64}$/u)
      .safeParse(input.expectedSha256)
    const expectedSize = Number(input.expectedSizeBytes)
    if (
      !expectedSha256.success ||
      !Number.isSafeInteger(expectedSize) ||
      expectedSize < 0
    ) {
      return false
    }
    try {
      const stored = await this.client.statObject(
        this.config.bucket,
        input.key,
      )
      if (stored.size !== expectedSize) return false
      const stream = await this.client.getObject(this.config.bucket, input.key)
      const hash = createHash("sha256")
      let actualSize = 0
      for await (const chunk of stream) {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        actualSize += bytes.length
        if (actualSize > expectedSize) {
          stream.destroy()
          return false
        }
        hash.update(bytes)
      }
      return (
        actualSize === expectedSize &&
        hash.digest("hex") === expectedSha256.data
      )
    } catch (error) {
      if (isMissingObjectError(error)) return false
      throw new KnowledgeProcessingError(
        "KNOWLEDGE_OBJECT_STORAGE_UNAVAILABLE",
        { cause: error, retryable: true },
      )
    }
  }

  async remove(key: string): Promise<void> {
    assertManagedKnowledgeObjectKey(key)
    await this.client.removeObject(this.config.bucket, key)
  }

  async listManagedObjectsOlderThan(
    cutoff: Date,
    limit = 100,
  ): Promise<Array<{ key: string; lastModified: Date }>> {
    if (!Number.isSafeInteger(limit) || limit <= 0) {
      return []
    }
    const result: Array<{ key: string; lastModified: Date }> = []
    for await (const item of this.iterateManagedObjectsOlderThan(cutoff)) {
      result.push(item)
      if (result.length >= limit) break
    }
    return result
  }

  /**
   * Streams the complete isolated namespace. MinIO performs its own paged
   * listing, while callers decide how many actual orphan candidates to handle;
   * registered objects therefore cannot consume the orphan batch forever.
   */
  async *iterateManagedObjectsOlderThan(
    cutoff: Date,
  ): AsyncIterable<{ key: string; lastModified: Date }> {
    if (!this.client.listObjectsV2) return
    const stream = this.client.listObjectsV2(
      this.config.bucket,
      "knowledge-bases/",
      true,
    )
    for await (const item of stream) {
      if (
        typeof item.name !== "string" ||
        !(item.lastModified instanceof Date) ||
        !Number.isFinite(item.lastModified.getTime()) ||
        item.lastModified > cutoff
      ) {
        continue
      }
      try {
        assertManagedKnowledgeObjectKey(item.name)
      } catch {
        continue
      }
      yield { key: item.name, lastModified: item.lastModified }
    }
  }

  private async assertMissing(key: string): Promise<void> {
    try {
      await this.client.statObject(this.config.bucket, key)
      throw new KnowledgeProcessingError(
        "KNOWLEDGE_OBJECT_STORAGE_UNAVAILABLE",
      )
    } catch (error) {
      if (error instanceof KnowledgeProcessingError) throw error
      if (!isMissingObjectError(error)) {
        throw new KnowledgeProcessingError(
          "KNOWLEDGE_OBJECT_STORAGE_UNAVAILABLE",
          { cause: error, retryable: true },
        )
      }
    }
  }
}

export function buildKnowledgeObjectKey(input: KnowledgeObjectIdentity): string {
  const knowledgeBaseId = z.string().uuid().parse(input.knowledgeBaseId)
  const documentId = z.string().uuid().parse(input.documentId)
  const versionId = z.string().uuid().parse(input.versionId)
  const objectType = knowledgeObjectTypeSchema.parse(input.objectType)
  const objectId = z.string().uuid().parse(input.objectId ?? randomUUID())
  const extension = input.extension
    ? `.${input.extension.toLowerCase().replace(/[^a-z0-9]/gu, "")}`
    : ""
  return [
    "knowledge-bases",
    knowledgeBaseId,
    "documents",
    documentId,
    "versions",
    versionId,
    objectType,
    `${objectId}${extension}`,
  ].join("/")
}

export function assertManagedKnowledgeObjectKey(key: string): void {
  const parts = key.split("/")
  if (
    parts.length !== 8 ||
    parts[0] !== "knowledge-bases" ||
    parts[2] !== "documents" ||
    parts[4] !== "versions" ||
    !knowledgeObjectTypeSchema.safeParse(parts[6]).success ||
    !z.string().uuid().safeParse(parts[1]).success ||
    !z.string().uuid().safeParse(parts[3]).success ||
    !z.string().uuid().safeParse(parts[5]).success ||
    !/^[a-f0-9-]{36}(?:\.[a-z0-9]+)?$/u.test(parts[7] ?? "")
  ) {
    throw new KnowledgeProcessingError(
      "KNOWLEDGE_OBJECT_STORAGE_UNAVAILABLE",
    )
  }
}

function isMissingObjectError(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false
  const code = Reflect.get(value, "code")
  return code === "NoSuchKey" || code === "NotFound" || code === "NoSuchObject"
}

async function readBoundedStream(
  stream: Readable,
  maximumBytes: number,
): Promise<Buffer> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of stream) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += bytes.length
    if (size > maximumBytes) {
      stream.destroy()
      throw new Error("knowledge health response exceeds its fixed bound")
    }
    chunks.push(bytes)
  }
  return Buffer.concat(chunks, size)
}
