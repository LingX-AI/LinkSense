import { createHash } from "node:crypto"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Readable } from "node:stream"

import { afterEach, describe, expect, it, vi } from "vitest"

import type { IndexedParentDocument } from "../src/modules/knowledge-processing/elasticsearch.js"
import type { HybridChunkResult } from "../src/modules/knowledge-processing/docling-hybrid.js"
import type { BuiltKnowledgeParent } from "../src/modules/knowledge-processing/parent-builder.js"
import { buildKnowledgeObjectKey } from "../src/modules/knowledge-processing/object-store.js"
import { PrismaMinioKnowledgePipelineWorkspace } from "../src/modules/knowledge-processing/workspace.js"
import { createImageUnderstandingSnapshot } from "../src/modules/system/image-understanding-settings.js"

const BASE_ID = "10000000-0000-4000-8000-000000000001"
const DOCUMENT_ID = "20000000-0000-4000-8000-000000000001"
const VERSION_ID = "30000000-0000-4000-8000-000000000001"
const OLD_VERSION_ID = "30000000-0000-4000-8000-000000000002"
const GENERATION = "40000000-0000-4000-8000-000000000001"
const OTHER_GENERATION = "40000000-0000-4000-8000-000000000002"
const REQUESTED_BY = "70000000-0000-4000-8000-000000000001"
const EMPTY_SHA256 = createHash("sha256").update("").digest("hex")

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) =>
      rm(path, { recursive: true, force: true }),
    ),
  )
  vi.useRealTimers()
})

describe("PrismaMinioKnowledgePipelineWorkspace immutable artifacts", () => {
  it("persists the Docling bundle, empty display Markdown, and JSON as explicit immutable artifacts", async () => {
    const fixture = workspaceFixture()
    const archivePath = await temporaryFile("docling.zip", "zip")
    const doclingJsonBytes = Buffer.from(
      JSON.stringify({ version: "1.10.0", body: { children: [] } }),
      "utf8",
    )

    await fixture.workspace.saveParsedArtifacts({
      job: job(),
      result: {
        officialMarkdown: "",
        safeMarkdown: "",
        markdownBytes: Buffer.alloc(0),
        doclingJson: { version: "1.10.0", body: { children: [] } },
        doclingJsonBytes,
        assets: [],
        archivePath,
      },
    })

    expect(fixture.state.version).toMatchObject({
      doclingVersion: "1.10.0",
      parserConfigDigest: job().parserConfigDigest,
      chunkingConfigDigest: job().chunking.configDigest,
      embeddingProfileHash: job().embeddingProfileHash,
      displayMarkdownSha256: EMPTY_SHA256,
      hybridChunksObjectId: null,
      retrievalManifestObjectId: null,
      indexIntegrityDigest: null,
      parentCount: null,
      childCount: null,
      indexReady: false,
    })
    const artifactTypes = fixture.state.objects.map((object) => object.objectType)
    expect(artifactTypes).toEqual([
      "docling_bundle",
      "display_markdown",
      "docling_json",
    ])
    const display = fixture.state.objects.find(
      (object) => object.objectType === "display_markdown",
    )
    expect(display).toMatchObject({
      sizeBytes: 0,
      checksumSha256: EMPTY_SHA256,
      processingGeneration: GENERATION,
    })
    expect(display?.objectKey).toContain("/display_markdown/")
    expect(fixture.objectStore.putImmutable).toHaveBeenCalledTimes(3)

    await expect(fixture.workspace.hasParsedArtifacts(job())).resolves.toBe(true)
  })

  it("does not upload a second parsed suite after all immutable artifact digests pass verification", async () => {
    const fixture = workspaceFixture()
    const archivePath = await temporaryFile("docling.zip", "zip")
    const input = {
      job: job(),
      result: {
        officialMarkdown: "# Title",
        safeMarkdown: "# Title",
        markdownBytes: Buffer.from("# Title"),
        doclingJson: { version: "1.10.0" },
        doclingJsonBytes: Buffer.from('{"version":"1.10.0"}'),
        assets: [],
        archivePath,
      },
    }

    await fixture.workspace.saveParsedArtifacts(input)
    await fixture.workspace.saveParsedArtifacts(input)

    expect(fixture.objectStore.putImmutable).toHaveBeenCalledTimes(3)
    expect(fixture.state.objects).toHaveLength(3)
  })

  it("validates Hybrid JSON before persistence and round-trips the accepted artifact", async () => {
    const fixture = workspaceFixture()
    const valid = hybridChunks()

    await expect(
      fixture.workspace.saveHybridChunks(job(), {
        ...valid,
        chunks: [{ ...valid.chunks[0]!, chunkIndex: 1 }],
      }),
    ).rejects.toBeDefined()
    expect(fixture.objectStore.putImmutable).not.toHaveBeenCalled()

    await fixture.workspace.saveHybridChunks(job(), valid)

    expect(fixture.state.version).toMatchObject({
      chunkerVersion: "docling-serve-1.36.0-hybrid",
      chunkingConfigDigest: job().chunking.configDigest,
      childCount: 1,
      retrievalManifestObjectId: null,
      parentCount: null,
      indexReady: false,
    })
    expect(fixture.state.objects).toHaveLength(1)
    expect(fixture.state.objects[0]).toMatchObject({
      objectType: "hybrid_chunks",
      processingGeneration: GENERATION,
    })
    await expect(fixture.workspace.loadHybridChunks(job())).resolves.toEqual(
      valid,
    )
  })

  it("validates retrieval-manifest JSON before persistence and records exact parent and child counts", async () => {
    const fixture = workspaceFixture()
    const valid = retrievalManifest()

    await expect(
      fixture.workspace.saveRetrievalManifest(job(), [
        { ...valid[0]!, childIds: ["different-child"] },
      ]),
    ).rejects.toBeDefined()
    expect(fixture.objectStore.putImmutable).not.toHaveBeenCalled()

    await fixture.workspace.saveRetrievalManifest(job(), valid)

    expect(fixture.state.version).toMatchObject({
      retrievalManifestSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      chunkingConfigDigest: job().chunking.configDigest,
      parentCount: 1,
      childCount: 1,
      indexIntegrityDigest: null,
      indexReady: false,
    })
    expect(fixture.state.objects[0]).toMatchObject({
      objectType: "retrieval_manifest",
      processingGeneration: GENERATION,
    })
    await expect(
      fixture.workspace.loadRetrievalManifest(job()),
    ).resolves.toEqual(valid)
  })

  it("loads the immutable manifest for a vector-only rebuild after image settings change", async () => {
    const fixture = workspaceFixture()
    const valid = retrievalManifest()
    await fixture.workspace.saveRetrievalManifest(job(), valid)
    const rebuildJob = {
      ...job(),
      operation: "rebuild_index" as const,
      imageUnderstanding: {
        ...job().imageUnderstanding,
        revision: job().imageUnderstanding.revision + 1,
        config_digest: "b".repeat(64),
      },
    }

    await expect(
      fixture.workspace.loadRetrievalManifest(rebuildJob),
    ).resolves.toEqual(valid)

    const checkpoint = await fixture.workspace.saveEmbeddedIndexCheckpoint(
      rebuildJob,
      indexedParents(),
    )
    await expect(
      fixture.workspace.readCandidateIndexCheckpoint(rebuildJob),
    ).resolves.toMatchObject({
      embeddingProfileHash: rebuildJob.embeddingProfileHash,
      indexIntegrityDigest: checkpoint.outputHash,
    })

    Object.assign(fixture.state.document, {
      status: "processing",
      currentVersionId: VERSION_ID,
    })
    Object.assign(fixture.state.version, {
      versionStatus: "ready",
      operationType: "rebuild_index",
      processingStage: "activating",
      progressPercent: 98,
    })
    await expect(
      fixture.workspace.prepareActivation(rebuildJob),
    ).resolves.toMatchObject({
      embeddingProfileHash: rebuildJob.embeddingProfileHash,
      indexIntegrityDigest: checkpoint.outputHash,
    })
    await expect(
      fixture.workspace.finalizeActivation(rebuildJob),
    ).resolves.toBeUndefined()
    expect(fixture.state.document).toMatchObject({
      status: "ready",
      embeddingProfileHash: rebuildJob.embeddingProfileHash,
    })
    expect(fixture.state.version).toMatchObject({
      processingStage: "completed",
      stableErrorCode: null,
      indexReady: true,
    })
  })

  it("loads the immutable manifest retained from the previous generation for an in-place rebuild", async () => {
    const fixture = workspaceFixture()
    const valid = retrievalManifest()
    await fixture.workspace.saveRetrievalManifest(job(), valid)
    fixture.state.version.processingGeneration = OTHER_GENERATION

    await expect(
      fixture.workspace.loadRetrievalManifest({
        ...job(),
        operation: "rebuild_index",
        processingGeneration: OTHER_GENERATION,
      }),
    ).resolves.toEqual(valid)
  })

  it.each([
    {
      name: "Hybrid",
      save: async (
        workspace: PrismaMinioKnowledgePipelineWorkspace,
        value: ReturnType<typeof job>,
      ) => workspace.saveHybridChunks(value, hybridChunks()),
      load: (
        workspace: PrismaMinioKnowledgePipelineWorkspace,
        value: ReturnType<typeof job>,
      ) => workspace.loadHybridChunks(value),
    },
    {
      name: "retrieval manifest",
      save: async (
        workspace: PrismaMinioKnowledgePipelineWorkspace,
        value: ReturnType<typeof job>,
      ) => workspace.saveRetrievalManifest(value, retrievalManifest()),
      load: (
        workspace: PrismaMinioKnowledgePipelineWorkspace,
        value: ReturnType<typeof job>,
      ) => workspace.loadRetrievalManifest(value),
    },
  ])(
    "fails closed when the $name artifact bytes no longer match its immutable digest",
    async ({ save, load }) => {
      const fixture = workspaceFixture()
      await save(fixture.workspace, job())
      const [object] = fixture.state.objects
      fixture.state.bytes.set(object!.objectKey, Buffer.from('{"corrupt":true}'))

      await expect(load(fixture.workspace, job())).rejects.toMatchObject({
        code: "KNOWLEDGE_DOCUMENT_STRUCTURE_INVALID",
      })
    },
  )

  it.each([
    {
      name: "Hybrid",
      save: async (workspace: PrismaMinioKnowledgePipelineWorkspace) =>
        workspace.saveHybridChunks(job(), hybridChunks()),
      load: (workspace: PrismaMinioKnowledgePipelineWorkspace) =>
        workspace.loadHybridChunks({
          ...job(),
          processingGeneration: OTHER_GENERATION,
        }),
    },
    {
      name: "retrieval manifest",
      save: async (workspace: PrismaMinioKnowledgePipelineWorkspace) =>
        workspace.saveRetrievalManifest(job(), retrievalManifest()),
      load: (workspace: PrismaMinioKnowledgePipelineWorkspace) =>
        workspace.loadRetrievalManifest({
          ...job(),
          processingGeneration: OTHER_GENERATION,
        }),
    },
  ])(
    "fails closed instead of reading a $name artifact from another processing generation",
    async ({ save, load }) => {
      const fixture = workspaceFixture()
      await save(fixture.workspace)

      await expect(load(fixture.workspace)).rejects.toMatchObject({
        code: "KNOWLEDGE_DOCUMENT_STRUCTURE_INVALID",
      })
    },
  )

  it("uses explicit manifest counts, index digest, and prior-current pointer for activation", async () => {
    const fixture = workspaceFixture()
    const manifest = retrievalManifest()
    await fixture.workspace.saveRetrievalManifest(job(), manifest)
    const indexed = indexedParents()

    const checkpoint = await fixture.workspace.saveEmbeddedIndexCheckpoint(
      job(),
      indexed,
    )
    expect(checkpoint).toMatchObject({
      configDigest: job().embeddingProfileHash,
      outputHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
    })
    expect(fixture.state.version).toMatchObject({
      parentCount: 1,
      childCount: 1,
      embeddingProfileHash: job().embeddingProfileHash,
      indexIntegrityDigest: checkpoint.outputHash,
      indexReady: false,
    })

    Object.assign(fixture.state.document, {
      status: "ready",
      currentVersionId: OLD_VERSION_ID,
    })
    Object.assign(fixture.state.version, {
      processingStage: "activating",
      progressPercent: 98,
    })

    await expect(fixture.workspace.prepareActivation(job())).resolves.toEqual({
      parentCount: 1,
      childCount: 1,
      embeddingProfileHash: job().embeddingProfileHash,
      indexIntegrityDigest: checkpoint.outputHash,
    })
    expect(fixture.state.version).toMatchObject({
      activationPreviousCurrentVersionId: OLD_VERSION_ID,
      indexReady: false,
    })
  })
})

function job() {
  return {
    operation: "upload" as const,
    knowledgeBaseId: BASE_ID,
    documentId: DOCUMENT_ID,
    documentVersionId: VERSION_ID,
    processingGeneration: GENERATION,
    requestedBy: REQUESTED_BY,
    sourceFormat: "pdf",
    ocrEnabled: false,
    startStage: "parsing" as const,
    parserConfigDigest: "a".repeat(64),
    chunking: {
      tokenizer: "/models/tokenizers/Qwen3-Embedding-4B",
      childMaxTokens: 768,
      parentMaxTokens: 3_000,
      embeddingMaxInputTokens: 8_192,
      configDigest: "c".repeat(64),
    },
    imageUnderstanding: createImageUnderstandingSnapshot(null),
    embeddingProfileHash: "d".repeat(64),
  }
}

function hybridChunks(): HybridChunkResult {
  return {
    filename: "manual.json",
    chunks: [
      {
        chunkIndex: 0,
        text: "# Security\n\nUse MFA.",
        rawText: "Use MFA.",
        numTokens: 4,
        headings: ["Security"],
        captions: [],
        docItems: ["#/texts/0"],
        pageNumbers: [1],
        metadata: {},
      },
    ],
  }
}

function retrievalManifest(): BuiltKnowledgeParent[] {
  const hybrid = hybridChunks().chunks[0]!
  const child = {
    chunkIndex: hybrid.chunkIndex,
    text: hybrid.text,
    rawText: hybrid.rawText,
    numTokens: hybrid.numTokens,
    headings: hybrid.headings,
    captions: hybrid.captions,
    docItems: hybrid.docItems,
    pageNumbers: hybrid.pageNumbers,
    childId: `${VERSION_ID}:0:${"e".repeat(24)}`,
    contentHash: "e".repeat(64),
  }
  return [
    {
      parentId: "80000000-0000-5000-8000-000000000001",
      parentOrder: 0,
      titlePath: ["Security"],
      pageNumbers: [1],
      parentText: "# Security\n\nUse MFA.",
      contentHash: "f".repeat(64),
      childIds: [child.childId],
      childCount: 1,
      estimatedTokens: 4,
      children: [child],
    },
  ]
}

function indexedParents(): IndexedParentDocument[] {
  const [parent] = retrievalManifest()
  const [child] = parent!.children
  return [
    {
      parentId: parent!.parentId,
      parentOrder: 0,
      knowledgeBaseId: BASE_ID,
      documentId: DOCUMENT_ID,
      documentVersionId: VERSION_ID,
      embeddingProfileHash: job().embeddingProfileHash,
      titlePath: parent!.titlePath,
      parentText: parent!.parentText,
      pageNumbers: parent!.pageNumbers,
      contentHash: parent!.contentHash,
      childIds: parent!.childIds,
      childCount: 1,
      children: [
        {
          childId: child!.childId,
          order: 0,
          text: child!.text,
          rawText: child!.rawText,
          titlePath: child!.headings,
          captions: child!.captions,
          docItems: child!.docItems,
          pageNumbers: child!.pageNumbers,
          numTokens: child!.numTokens,
          contentHash: child!.contentHash,
          vector: [0.1, 0.2],
        },
      ],
    },
  ]
}

async function temporaryFile(filename: string, contents: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "linksense-workspace-test-"))
  temporaryDirectories.push(directory)
  const path = join(directory, filename)
  await writeFile(path, contents)
  return path
}

type StoredObject = {
  id: string
  knowledgeBaseId: string
  documentId: string
  documentVersionId: string
  processingGeneration: string
  objectType: string
  objectKey: string
  assetReferenceId: string | null
  mimeType: string
  sizeBytes: number
  checksumSha256: string
  lifecycleStatus: string
  cleanupStatus: string
}

function workspaceFixture() {
  const state = {
    base: {
      id: BASE_ID,
      lifecycleStatus: "active",
      availabilityStatus: "enabled",
      storageUsedBytes: 0n,
      storageReservedBytes: 0n,
    },
    document: {
      id: DOCUMENT_ID,
      status: "processing",
      currentVersionId: null as string | null,
      activeProcessingVersionId: VERSION_ID,
    },
    version: {
      id: VERSION_ID,
      knowledgeBaseId: BASE_ID,
      documentId: DOCUMENT_ID,
      processingGeneration: GENERATION,
      sourceVersionId: null,
      originalFilename: "manual.pdf",
      mimeType: "application/pdf",
      originalSha256: "9".repeat(64),
      versionStatus: "processing",
      operationType: "upload",
      cancelRequestedAt: null,
      processingStage: "parsing",
      progressPercent: 0,
      activationPreviousCurrentVersionId: null as string | null,
      processingRevision: 0,
    } as Record<string, unknown>,
    reservation: null as Record<string, unknown> | null,
    objects: [] as StoredObject[],
    bytes: new Map<string, Buffer>(),
  }

  const objectStore = {
    putImmutable: vi.fn(
      async (input: {
        identity: Parameters<typeof buildKnowledgeObjectKey>[0]
        stream: Readable
        size: number
      }) => {
        const bytes = await readAll(input.stream)
        const key = buildKnowledgeObjectKey(input.identity)
        if (state.bytes.has(key) || bytes.length !== input.size) {
          throw new Error("immutable object conflict")
        }
        state.bytes.set(key, bytes)
        return { key, size: bytes.length, sha256: sha256(bytes) }
      },
    ),
    verifyIntegrity: vi.fn(
      async (input: {
        key: string
        expectedSha256: string
        expectedSizeBytes: number | bigint
      }) => {
        const bytes = state.bytes.get(input.key)
        return Boolean(
          bytes &&
            BigInt(bytes.length) === BigInt(input.expectedSizeBytes) &&
            sha256(bytes) === input.expectedSha256,
        )
      },
    ),
    getStream: vi.fn(async (key: string) => {
      const bytes = state.bytes.get(key)
      if (!bytes) throw new Error("missing object")
      return Readable.from(bytes)
    }),
    remove: vi.fn(async (key: string) => {
      state.bytes.delete(key)
    }),
  }

  const versionInScope = (where: Record<string, unknown>) =>
    where.id === VERSION_ID &&
    (where.knowledgeBaseId === undefined || where.knowledgeBaseId === BASE_ID) &&
    (where.documentId === undefined || where.documentId === DOCUMENT_ID) &&
    (where.processingGeneration === undefined ||
      where.processingGeneration === state.version.processingGeneration)

  const objectInScope = (object: StoredObject, where: Record<string, unknown>) =>
    Object.entries(where).every(([key, expected]) => {
      if (key === "id") return object.id === expected
      if (key === "knowledgeBaseId") return object.knowledgeBaseId === expected
      if (key === "documentId") return object.documentId === expected
      if (key === "documentVersionId") {
        return object.documentVersionId === expected
      }
      if (key === "processingGeneration") {
        return object.processingGeneration === expected
      }
      if (key === "objectType") return object.objectType === expected
      if (key === "lifecycleStatus") return object.lifecycleStatus === expected
      if (key === "checksumSha256") return object.checksumSha256 === expected
      return true
    })

  const applyCounterUpdate = (
    target: { storageUsedBytes: bigint; storageReservedBytes: bigint },
    data: Record<string, unknown>,
  ) => {
    for (const field of ["storageUsedBytes", "storageReservedBytes"] as const) {
      const update = data[field]
      if (typeof update === "bigint") target[field] = update
      if (typeof update === "object" && update !== null) {
        const increment = Reflect.get(update, "increment")
        const decrement = Reflect.get(update, "decrement")
        if (typeof increment === "bigint") target[field] += increment
        if (typeof decrement === "bigint") target[field] -= decrement
      }
    }
  }

  const transaction = {
    $queryRaw: vi.fn(async () => []),
    $queryRawUnsafe: vi.fn(async () => []),
    knowledgeBase: {
      findUnique: vi.fn(async () => ({ ...state.base })),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        applyCounterUpdate(state.base, data)
        return { ...state.base }
      }),
      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { storageReservedBytes?: { gte: bigint } }
          data: Record<string, unknown>
        }) => {
          if (
            where.storageReservedBytes &&
            state.base.storageReservedBytes < where.storageReservedBytes.gte
          ) {
            return { count: 0 }
          }
          applyCounterUpdate(state.base, data)
          return { count: 1 }
        },
      ),
    },
    knowledgeBaseDocument: {
      findUnique: vi.fn(async () => ({ ...state.document })),
      update: vi.fn(
        async ({ data }: { data: Record<string, unknown> }) => {
          Object.assign(state.document, data)
          return { ...state.document }
        },
      ),
    },
    knowledgeBaseDocumentVersion: {
      findFirst: vi.fn(
        async ({ where }: { where: Record<string, unknown> }) =>
          versionInScope(where) ? { ...state.version } : null,
      ),
      findUnique: vi.fn(
        async ({ where }: { where: { id: string } }) =>
          where.id === VERSION_ID ? { ...state.version } : null,
      ),
      findUniqueOrThrow: vi.fn(async () => ({ ...state.version })),
      update: vi.fn(
        async ({ data }: { data: Record<string, unknown> }) => {
          const revision = data.processingRevision
          const next = { ...data }
          delete next.processingRevision
          Object.assign(state.version, next)
          if (
            typeof revision === "object" &&
            revision !== null &&
            Reflect.get(revision, "increment") === 1
          ) {
            state.version.processingRevision =
              Number(state.version.processingRevision) + 1
          }
          return { ...state.version }
        },
      ),
    },
    knowledgeBaseObject: {
      findFirst: vi.fn(
        async ({ where }: { where: Record<string, unknown> }) =>
          state.objects.find((object) => objectInScope(object, where)) ?? null,
      ),
      findMany: vi.fn(async () => []),
      count: vi.fn(
        async ({ where }: { where: { objectKey: { in: string[] } } }) =>
          state.objects.filter((object) =>
            where.objectKey.in.includes(object.objectKey),
          ).length,
      ),
      createMany: vi.fn(
        async ({ data }: { data: StoredObject[] }) => {
          state.objects.push(...data)
          return { count: data.length }
        },
      ),
    },
    knowledgeBaseStorageReservation: {
      findUnique: vi.fn(async () =>
        state.reservation ? { ...state.reservation } : null,
      ),
      create: vi.fn(
        async ({ data }: { data: Record<string, unknown> }) => {
          state.reservation = { cleanupStartedAt: null, ...data }
          return { ...state.reservation }
        },
      ),
      update: vi.fn(
        async ({ data }: { data: Record<string, unknown> }) => {
          if (!state.reservation) throw new Error("missing reservation")
          Object.assign(state.reservation, data)
          return { ...state.reservation }
        },
      ),
      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where: {
            leaseToken: string
            cleanupStartedAt?: null
            leaseExpiresAt?: { gt: Date }
          }
          data: Record<string, unknown>
        }) => {
          if (
            !state.reservation ||
            state.reservation.leaseToken !== where.leaseToken ||
            (where.cleanupStartedAt === null &&
              state.reservation.cleanupStartedAt !== null) ||
            (where.leaseExpiresAt &&
              state.reservation.leaseExpiresAt instanceof Date &&
              state.reservation.leaseExpiresAt <= where.leaseExpiresAt.gt)
          ) {
            return { count: 0 }
          }
          Object.assign(state.reservation, data)
          return { count: 1 }
        },
      ),
      delete: vi.fn(async () => {
        const reservation = state.reservation
        state.reservation = null
        return reservation
      }),
    },
    conversationMessageKnowledgeCitation: {
      count: vi.fn(async () => 0),
    },
    knowledgeSourceItem: { findFirst: vi.fn(async () => null) },
    knowledgeBaseEntry: { findFirst: vi.fn(async () => null) },
  }

  const prisma = {
    knowledgeBaseDocumentVersion: transaction.knowledgeBaseDocumentVersion,
    knowledgeBaseObject: transaction.knowledgeBaseObject,
    $transaction: async <T>(
      work: (value: typeof transaction) => Promise<T>,
    ): Promise<T> => work(transaction),
  }

  return {
    state,
    objectStore,
    workspace: new PrismaMinioKnowledgePipelineWorkspace(
      prisma as never,
      objectStore as never,
      10_737_418_240n,
    ),
  }
}

async function readAll(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}

function sha256(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex")
}
