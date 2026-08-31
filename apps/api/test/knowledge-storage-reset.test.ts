import { describe, expect, it, vi } from "vitest"

import {
  getKnowledgeStorageResetConfirmation,
  parseKnowledgeStorageResetArguments,
  parseKnowledgeStorageResetEnvironment,
  resetKnowledgeExternalStorage,
  validateKnowledgeStorageResetTargets,
  type KnowledgeBucketResetClient,
  type KnowledgeIndexResetClient,
} from "../src/operations/knowledge-storage-reset.js"

const targets = {
  primaryBucket: "linksense-files",
  knowledgeBucket: "linksense-knowledge",
  elasticsearchIndex: "linksense-knowledge",
}

describe("knowledge external storage reset safety", () => {
  it.each([
    [{ ...targets, knowledgeBucket: "" }],
    [{ ...targets, knowledgeBucket: "*" }],
    [{ ...targets, knowledgeBucket: "linksense-files" }],
    [{ ...targets, knowledgeBucket: "data" }],
    [{ ...targets, elasticsearchIndex: "" }],
    [{ ...targets, elasticsearchIndex: "*" }],
    [{ ...targets, elasticsearchIndex: "_all" }],
    [{ ...targets, elasticsearchIndex: ".security" }],
  ])("rejects an empty, wildcard, shared, or dangerous target", (value) => {
    expect(() => validateKnowledgeStorageResetTargets(value)).toThrow()
  })

  it("accepts only the explicit plan or execute command forms", () => {
    expect(parseKnowledgeStorageResetArguments(["--plan"])).toEqual({
      mode: "plan",
    })
    expect(parseKnowledgeStorageResetArguments(["--", "--plan"])).toEqual({
      mode: "plan",
    })
    expect(
      parseKnowledgeStorageResetArguments([
        "--execute",
        "--confirm",
        "exact",
      ]),
    ).toEqual({ mode: "execute", confirmation: "exact" })
    expect(() => parseKnowledgeStorageResetArguments([])).toThrow()
    expect(() =>
      parseKnowledgeStorageResetArguments(["--execute"]),
    ).toThrow()
    expect(() =>
      parseKnowledgeStorageResetArguments([
        "--execute",
        "--confirm",
        "exact",
        "--index",
        "*",
      ]),
    ).toThrow()
  })

  it("requires every destructive target and credential explicitly from the environment", () => {
    const environment = resetEnvironment()
    expect(parseKnowledgeStorageResetEnvironment(environment)).toMatchObject({
      targets,
      minio: {
        endpoint: "minio.internal",
        port: 9000,
        useSsl: true,
      },
      elasticsearch: {
        url: "https://elasticsearch.internal:9200/",
      },
    })

    delete environment.MINIO_KNOWLEDGE_BUCKET
    expect(() =>
      parseKnowledgeStorageResetEnvironment(environment),
    ).toThrow("MINIO_KNOWLEDGE_BUCKET")
  })

  it("plans without contacting or mutating either external service", async () => {
    const { minio, elasticsearch } = clients()

    await expect(
      resetKnowledgeExternalStorage({
        targets,
        command: { mode: "plan" },
        minio,
        elasticsearch,
      }),
    ).resolves.toEqual({
      executed: false,
      knowledgeBucket: targets.knowledgeBucket,
      elasticsearchIndex: targets.elasticsearchIndex,
      requiredConfirmation:
        "DELETE-KNOWLEDGE-EXTERNAL-STORAGE::linksense-knowledge::linksense-knowledge",
    })
    expect(minio.bucketExists).not.toHaveBeenCalled()
    expect(elasticsearch.ping).not.toHaveBeenCalled()
  })

  it("rejects an inexact confirmation before contacting either service", async () => {
    const { minio, elasticsearch } = clients()

    await expect(
      resetKnowledgeExternalStorage({
        targets,
        command: { mode: "execute", confirmation: "DELETE EVERYTHING" },
        minio,
        elasticsearch,
      }),
    ).rejects.toThrow("confirmation does not match")
    expect(minio.bucketExists).not.toHaveBeenCalled()
    expect(elasticsearch.ping).not.toHaveBeenCalled()
  })

  it("deletes every object version, delete marker, incomplete upload, and only the exact index", async () => {
    const versionListings = [
      [
        { name: "original/a.pdf", versionId: "version-a" },
        { name: "derived/b.json", versionId: "delete-marker-b" },
        { name: "unversioned/c.md" },
      ],
      [
        { name: "original/a.pdf", versionId: "version-a" },
        { name: "derived/b.json", versionId: "delete-marker-b" },
        { name: "unversioned/c.md" },
      ],
      [],
    ]
    const incompleteListings = [
      [{ key: "partial/a" }],
      [{ key: "partial/a" }],
      [],
    ]
    const { minio, elasticsearch } = clients({
      objectVersionListings: versionListings,
      incompleteUploadListings: incompleteListings,
      indexExists: [true, false],
    })

    await expect(
      resetKnowledgeExternalStorage({
        targets,
        command: {
          mode: "execute",
          confirmation: getKnowledgeStorageResetConfirmation(targets),
        },
        minio,
        elasticsearch,
      }),
    ).resolves.toEqual({
      executed: true,
      knowledgeBucket: "linksense-knowledge",
      elasticsearchIndex: "linksense-knowledge",
      deletedObjectVersions: 3,
      deletedIncompleteUploads: 1,
      deletedElasticsearchIndex: true,
    })

    expect(minio.removeObjectVersions).toHaveBeenCalledWith(
      "linksense-knowledge",
      versionListings[1],
    )
    expect(minio.removeIncompleteUpload).toHaveBeenCalledWith(
      "linksense-knowledge",
      "partial/a",
    )
    expect(elasticsearch.deleteIndex).toHaveBeenCalledWith(
      "linksense-knowledge",
    )
    expect(minio.removeObjectVersions).not.toHaveBeenCalledWith(
      "linksense-files",
      expect.anything(),
    )
  })

  it("is safely repeatable when the exact index is already absent and the bucket is empty", async () => {
    const { minio, elasticsearch } = clients({
      objectVersionListings: [[], [], []],
      incompleteUploadListings: [[], [], []],
      indexExists: [false],
    })

    await expect(
      resetKnowledgeExternalStorage({
        targets,
        command: {
          mode: "execute",
          confirmation: getKnowledgeStorageResetConfirmation(targets),
        },
        minio,
        elasticsearch,
      }),
    ).resolves.toMatchObject({
      executed: true,
      deletedObjectVersions: 0,
      deletedIncompleteUploads: 0,
      deletedElasticsearchIndex: false,
    })
    expect(elasticsearch.deleteIndex).not.toHaveBeenCalled()
  })

  it("does not touch Elasticsearch when MinIO rejects an object-version deletion", async () => {
    const { minio, elasticsearch } = clients({
      objectVersionListings: [
        [{ name: "a", versionId: "version-a" }],
        [{ name: "a", versionId: "version-a" }],
      ],
      incompleteUploadListings: [[], []],
      removeErrors: [{ error: { code: "AccessDenied" } }],
      indexExists: [true],
    })

    await expect(
      resetKnowledgeExternalStorage({
        targets,
        command: {
          mode: "execute",
          confirmation: getKnowledgeStorageResetConfirmation(targets),
        },
        minio,
        elasticsearch,
      }),
    ).rejects.toThrow("rejected an object-version deletion")
    expect(elasticsearch.deleteIndex).not.toHaveBeenCalled()
  })

  it("fails closed on malformed bucket enumeration before any deletion", async () => {
    const { minio, elasticsearch } = clients({
      objectVersionListings: [[{ versionId: "orphan-version" }]],
      incompleteUploadListings: [[]],
      indexExists: [true],
    })

    await expect(
      resetKnowledgeExternalStorage({
        targets,
        command: {
          mode: "execute",
          confirmation: getKnowledgeStorageResetConfirmation(targets),
        },
        minio,
        elasticsearch,
      }),
    ).rejects.toThrow("invalid object version")
    expect(minio.removeObjectVersions).not.toHaveBeenCalled()
    expect(elasticsearch.deleteIndex).not.toHaveBeenCalled()
  })
})

function clients(
  options: {
    objectVersionListings?: Array<
      Array<{ name?: string; versionId?: string }>
    >
    incompleteUploadListings?: Array<Array<{ key?: string }>>
    removeErrors?: Array<{ error?: unknown }>
    indexExists?: boolean[]
  } = {},
): {
  minio: KnowledgeBucketResetClient
  elasticsearch: KnowledgeIndexResetClient
} {
  let versionListing = 0
  let incompleteListing = 0
  let indexCheck = 0
  const objectVersionListings = options.objectVersionListings ?? [[], [], []]
  const incompleteUploadListings =
    options.incompleteUploadListings ?? [[], [], []]
  const indexExists = options.indexExists ?? [true, false]

  return {
    minio: {
      bucketExists: vi.fn(async () => true),
      listObjectVersions: vi.fn(() =>
        iterable(objectVersionListings[versionListing++] ?? []),
      ),
      removeObjectVersions: vi.fn(
        async () => options.removeErrors ?? [],
      ),
      listIncompleteUploads: vi.fn(() =>
        iterable(incompleteUploadListings[incompleteListing++] ?? []),
      ),
      removeIncompleteUpload: vi.fn(async () => undefined),
    },
    elasticsearch: {
      ping: vi.fn(async () => undefined),
      indexExists: vi.fn(
        async () => indexExists[indexCheck++] ?? false,
      ),
      deleteIndex: vi.fn(async () => undefined),
    },
  }
}

async function* iterable<T>(items: readonly T[]): AsyncIterable<T> {
  yield* items
}

function resetEnvironment(): NodeJS.ProcessEnv {
  return {
    MINIO_ENDPOINT: "minio.internal",
    MINIO_PORT: "9000",
    MINIO_USE_SSL: "true",
    MINIO_REGION: "us-east-1",
    MINIO_ACCESS_KEY: "knowledge-reset-access",
    MINIO_SECRET_KEY: "knowledge-reset-secret",
    MINIO_BUCKET: targets.primaryBucket,
    MINIO_KNOWLEDGE_BUCKET: targets.knowledgeBucket,
    LINKSENSE_KB_ELASTICSEARCH_URL:
      "https://elasticsearch.internal:9200",
    LINKSENSE_KB_ELASTICSEARCH_USERNAME: "knowledge-reset",
    LINKSENSE_KB_ELASTICSEARCH_PASSWORD: "knowledge-reset-password",
    LINKSENSE_KB_ELASTICSEARCH_INDEX: targets.elasticsearchIndex,
  }
}
