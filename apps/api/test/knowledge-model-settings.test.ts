import { describe, expect, it, vi } from "vitest"

import type { ManagedModelKind } from "@linksense/shared"

import type { PrismaClient } from "../src/generated/prisma/client.js"
import { encryptJson } from "../src/lib/crypto.js"
import { AppError } from "../src/lib/errors.js"
import { KnowledgeProcessingError } from "../src/modules/knowledge-processing/errors.js"
import type {
  ManagedModelRuntimeSettingsReader,
  ResolvedManagedModelRuntime,
} from "../src/modules/system/model-provider-settings.js"
import { KnowledgeModelSettingsService } from "../src/modules/system/knowledge-model-settings.js"
import { testConfig } from "./test-config.js"

const ACTOR_ID = "00000000-0000-4000-8000-000000000099"

describe("KnowledgeModelSettingsService", () => {
  it("stores only existing model references and resolves channel credentials at runtime", async () => {
    const database = inMemoryDatabase()
    const modelSettings = modelRuntimeReader()
    const probe = { probe: vi.fn(async () => undefined) }
    const service = new KnowledgeModelSettingsService(
      database.prisma,
      testConfig(),
      probe,
      modelSettings
    )

    await expect(service.getAdminSettings()).resolves.toMatchObject({
      revision: 0,
      embedding: {
        configured: false,
        model: null,
        dimensions: 8,
        maximum_input_tokens: 8192,
      },
      rerank: { enabled: false, model: null, timeout_ms: 60000 },
    })

    const saved = await service.update(
      ACTOR_ID,
      {
        expected_revision: 0,
        embedding: { model: "embedding-v2" },
        rerank: { enabled: true, model: "rerank-v3" },
      },
      { userAgent: "knowledge-model-settings-test" }
    )

    expect(saved).toMatchObject({
      revision: 1,
      embedding: { configured: true, model: "embedding-v2" },
      rerank: { enabled: true, model: "rerank-v3" },
    })
    expect(probe.probe).toHaveBeenCalledWith(
      expect.objectContaining({
        embedding: expect.objectContaining({
          baseUrl: "https://models.example.test/v1",
          apiKey: "channel-secret",
          model: "embedding-v2",
          pricing: {
            input_price_per_million: "1.25",
            cached_input_price_per_million: "1.25",
            output_price_per_million: "0",
          },
        }),
        rerank: expect.objectContaining({
          baseUrl: "https://models.example.test/v1",
          apiKey: "channel-secret",
          model: "rerank-v3",
          pricing: {
            input_price_per_million: "2",
            cached_input_price_per_million: "2",
            output_price_per_million: "0",
          },
        }),
      })
    )
    expect(JSON.stringify(database.settingsJson())).not.toContain(
      "channel-secret"
    )
    expect(JSON.stringify(database.settingsJson())).not.toContain(
      "models.example.test"
    )
    await expect(service.getReferencedModelIds()).resolves.toEqual(
      new Set(["embedding-v2", "rerank-v3"])
    )
  })

  it("reads legacy endpoint settings as references while runtime comes from model channels", async () => {
    const database = inMemoryDatabase()
    const config = testConfig()
    database.replaceSettingsJson({
      knowledge_model_settings_encrypted: encryptJson(
        {
          version: 2,
          revision: 7,
          embedding: {
            baseUrl: "https://legacy-embedding.example.test",
            apiKey: "legacy-secret",
            model: "embedding-v2",
            pricing: {
              input_price_per_million: "9",
              cached_input_price_per_million: "9",
              output_price_per_million: "9",
            },
          },
          rerank: {
            enabled: true,
            baseUrl: "https://legacy-rerank.example.test/v1",
            apiKey: "legacy-secret",
            model: "rerank-v3",
            pricing: {
              input_price_per_million: "9",
              cached_input_price_per_million: "9",
              output_price_per_million: "9",
            },
            maximumInputTokens: 4096,
            timeoutMs: 30000,
          },
        },
        config.credentialMasterKey,
        config.credentialKeyId,
        "linksense:knowledge-model-settings:v1"
      ),
      knowledge_model_settings_key_id: config.credentialKeyId,
    })
    const service = new KnowledgeModelSettingsService(
      database.prisma,
      config,
      { probe: vi.fn(async () => undefined) },
      modelRuntimeReader()
    )

    await expect(service.getAdminSettings()).resolves.toMatchObject({
      revision: 7,
      embedding: { model: "embedding-v2" },
      rerank: { enabled: true, model: "rerank-v3" },
    })
    await expect(service.resolveRuntime()).resolves.toMatchObject({
      embedding: {
        baseUrl: "https://models.example.test/v1",
        pricing: { input_price_per_million: "1.25" },
      },
      rerank: {
        baseUrl: "https://models.example.test/v1",
        pricing: { input_price_per_million: "2" },
      },
    })
  })

  it("does not persist when a selected model is invalid or the live probe fails", async () => {
    const database = inMemoryDatabase()
    const invalidReader: ManagedModelRuntimeSettingsReader = {
      resolveManagedModel: vi.fn(async () => {
        throw new AppError("MODEL_SELECTION_INVALID")
      }),
    }
    const invalidService = new KnowledgeModelSettingsService(
      database.prisma,
      testConfig(),
      { probe: vi.fn(async () => undefined) },
      invalidReader
    )
    await expect(
      invalidService.update(ACTOR_ID, initialUpdate(0), {})
    ).rejects.toMatchObject({ code: "KNOWLEDGE_MODEL_VALIDATION_FAILED" })
    expect(database.settingsJson()).toEqual({})

    const failedProbeService = new KnowledgeModelSettingsService(
      database.prisma,
      testConfig(),
      {
        probe: vi.fn(async () => {
          throw new KnowledgeProcessingError(
            "KNOWLEDGE_EXTERNAL_SERVICE_AUTHENTICATION_FAILED"
          )
        }),
      },
      modelRuntimeReader()
    )
    await expect(
      failedProbeService.update(ACTOR_ID, initialUpdate(0), {})
    ).rejects.toMatchObject({ code: "KNOWLEDGE_MODEL_AUTHENTICATION_FAILED" })
    expect(database.settingsJson()).toEqual({})
  })

  it("rejects stale revisions", async () => {
    const database = inMemoryDatabase()
    const service = new KnowledgeModelSettingsService(
      database.prisma,
      testConfig(),
      { probe: vi.fn(async () => undefined) },
      modelRuntimeReader()
    )
    await service.update(ACTOR_ID, initialUpdate(0), {})
    await expect(
      service.update(ACTOR_ID, initialUpdate(0), {})
    ).rejects.toMatchObject({ code: "CONFLICT" })
  })
})

function initialUpdate(expectedRevision: number) {
  return {
    expected_revision: expectedRevision,
    embedding: { model: "embedding-v2" },
    rerank: { enabled: true, model: "rerank-v3" },
  } as const
}

function modelRuntimeReader(): ManagedModelRuntimeSettingsReader {
  const models: Record<string, ResolvedManagedModelRuntime> = {
    "embedding-v2": {
      revision: 4,
      model: {
        id: "embedding-v2",
        display_name: "Embedding V2",
        enabled: true,
        kind: "embedding",
        input_price_per_million: "1.25",
      },
      channel: {
        id: "channel-1",
        name: "Knowledge",
        provider: "openai_compatible",
        providerProject: null,
        providerLocation: null,
        baseUrl: "https://models.example.test/v1",
        protocolMode: "native_responses",
        apiKey: "channel-secret",
      },
    },
    "rerank-v3": {
      revision: 4,
      model: {
        id: "rerank-v3",
        display_name: "Rerank V3",
        enabled: true,
        kind: "reranker",
        input_price_per_million: "2",
      },
      channel: {
        id: "channel-1",
        name: "Knowledge",
        provider: "openai_compatible",
        providerProject: null,
        providerLocation: null,
        baseUrl: "https://models.example.test/v1",
        protocolMode: "native_responses",
        apiKey: "channel-secret",
      },
    },
  }
  return {
    resolveManagedModel: vi.fn(
      async (modelId: string, expectedKind?: ManagedModelKind) => {
        const runtime = models[modelId]
        if (!runtime || (expectedKind && runtime.model.kind !== expectedKind)) {
          throw new AppError("MODEL_SELECTION_INVALID")
        }
        return runtime
      }
    ),
  }
}

function inMemoryDatabase() {
  let settingsJson: Record<string, unknown> = {}
  const auditCreate = vi.fn(async () => ({}))
  const prisma = {
    systemSetting: {
      findUnique: vi.fn(async () => ({ settingsJson })),
      upsert: vi.fn(
        async (input: {
          create: { settingsJson: Record<string, unknown> }
          update: { settingsJson: Record<string, unknown> }
        }) => {
          settingsJson = input.update.settingsJson ?? input.create.settingsJson
          return { settingsJson }
        }
      ),
    },
    auditLog: { create: auditCreate },
    $executeRaw: vi.fn(async () => 1),
    $transaction: vi.fn(async (operation: (tx: unknown) => Promise<unknown>) =>
      operation(prisma)
    ),
  }
  return {
    prisma: prisma as unknown as PrismaClient,
    settingsJson: () => settingsJson,
    replaceSettingsJson: (value: Record<string, unknown>) => {
      settingsJson = value
    },
  }
}
