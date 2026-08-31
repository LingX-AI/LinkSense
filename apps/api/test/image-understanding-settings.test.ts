import { describe, expect, it, vi } from "vitest"

import type { ManagedModelKind } from "@linksense/shared"

import type { PrismaClient } from "../src/generated/prisma/client.js"
import { AppError } from "../src/lib/errors.js"
import type {
  ManagedModelRuntimeSettingsReader,
  ResolvedManagedModelRuntime,
} from "../src/modules/system/model-provider-settings.js"
import {
  ImageUnderstandingSettingsService,
  type ImageUnderstandingConfigurationProbe,
} from "../src/modules/system/image-understanding-settings.js"
import { testConfig } from "./test-config.js"

const ACTOR_ID = "00000000-0000-4000-8000-000000000099"

describe("ImageUnderstandingSettingsService", () => {
  it("stores only the selected image-capable chat model and resolves its channel at runtime", async () => {
    const database = inMemoryDatabase()
    const probe: ImageUnderstandingConfigurationProbe = {
      probe: vi.fn(async () => undefined),
    }
    const service = new ImageUnderstandingSettingsService(
      database.prisma,
      testConfig(),
      probe,
      modelRuntimeReader()
    )

    const saved = await service.update(
      ACTOR_ID,
      {
        expected_revision: 0,
        enabled: true,
        model: "gemini-2.5-flash",
      },
      {}
    )

    expect(probe.probe).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "google",
        baseUrl: "https://models.example.test/v1beta",
        model: "gemini-2.5-flash",
        apiKey: "channel-secret",
        thinkingStrategy: "google_zero_budget",
      })
    )
    expect(saved).toMatchObject({
      configured: true,
      enabled: true,
      revision: 1,
      provider: "google",
      model: "gemini-2.5-flash",
      api_key_configured: true,
      thinking_strategy: "google_zero_budget",
    })
    expect(JSON.stringify(database.settingsJson())).not.toContain(
      "channel-secret"
    )
    expect(JSON.stringify(database.settingsJson())).not.toContain(
      "models.example.test"
    )
    await expect(service.getReferencedModelIds()).resolves.toEqual(
      new Set(["gemini-2.5-flash"])
    )

    const snapshot = await service.getSnapshot()
    await expect(service.resolveRuntime(snapshot)).resolves.toMatchObject({
      provider: "google",
      model: "gemini-2.5-flash",
      apiKey: "channel-secret",
    })

    await service.update(
      ACTOR_ID,
      {
        expected_revision: 1,
        enabled: false,
        model: "gemini-2.5-flash",
      },
      {}
    )
    await expect(service.resolveRuntime(snapshot)).rejects.toMatchObject({
      code: "KNOWLEDGE_IMAGE_MODEL_CONFIGURATION_CHANGED",
    })
  })

  it("rejects a non-image model and does not persist it", async () => {
    const database = inMemoryDatabase()
    const reader = modelRuntimeReader({ supportsImageInput: false })
    const service = new ImageUnderstandingSettingsService(
      database.prisma,
      testConfig(),
      { probe: vi.fn(async () => undefined) },
      reader
    )
    await expect(
      service.update(
        ACTOR_ID,
        {
          expected_revision: 0,
          enabled: true,
          model: "gemini-2.5-flash",
        },
        {}
      )
    ).rejects.toMatchObject({
      code: "IMAGE_UNDERSTANDING_MODEL_VALIDATION_FAILED",
    })
    expect(database.settingsJson()).toEqual({})
  })

  it("reports that the selected image model was deleted when resolving a new processing snapshot", async () => {
    const database = inMemoryDatabase()
    const availableReader = modelRuntimeReader()
    const service = new ImageUnderstandingSettingsService(
      database.prisma,
      testConfig(),
      { probe: vi.fn(async () => undefined) },
      availableReader
    )
    await service.update(
      ACTOR_ID,
      {
        expected_revision: 0,
        enabled: true,
        model: "gemini-2.5-flash",
      },
      {}
    )

    const missingReader: ManagedModelRuntimeSettingsReader = {
      resolveManagedModel: vi.fn(async () => {
        throw new AppError("MODEL_SELECTION_INVALID")
      }),
    }
    const reloaded = new ImageUnderstandingSettingsService(
      database.prisma,
      testConfig(),
      { probe: vi.fn(async () => undefined) },
      missingReader
    )
    const snapshot = await reloaded.getSnapshot()

    await expect(reloaded.resolveRuntime(snapshot)).rejects.toMatchObject({
      code: "KNOWLEDGE_IMAGE_MODEL_NOT_FOUND",
    })
  })

  it("does not persist when the live image probe fails", async () => {
    const database = inMemoryDatabase()
    const service = new ImageUnderstandingSettingsService(
      database.prisma,
      testConfig(),
      {
        probe: vi.fn(async () => {
          throw new Error("provider rejected image input")
        }),
      },
      modelRuntimeReader()
    )

    await expect(
      service.update(
        ACTOR_ID,
        {
          expected_revision: 0,
          enabled: true,
          model: "gemini-2.5-flash",
        },
        {}
      )
    ).rejects.toMatchObject({
      code: "IMAGE_UNDERSTANDING_MODEL_VALIDATION_FAILED",
    })
    expect(database.settingsJson()).toEqual({})
    expect(database.upsert).not.toHaveBeenCalled()
  })
})

function modelRuntimeReader(
  options: { supportsImageInput?: boolean } = {}
): ManagedModelRuntimeSettingsReader {
  const runtime: ResolvedManagedModelRuntime = {
    revision: 5,
    model: {
      id: "gemini-2.5-flash",
      display_name: "Gemini 2.5 Flash",
      enabled: true,
      kind: "chat",
      input_price_per_million: "0",
      cached_input_price_per_million: "0",
      output_price_per_million: "0",
      supports_image_input: options.supportsImageInput ?? true,
      context_window: null,
      supported_reasoning_efforts: ["medium"],
      default_reasoning_effort: "medium",
    },
    channel: {
      id: "channel-1",
      name: "Google",
      provider: "google",
      providerProject: null,
      providerLocation: null,
      baseUrl: "https://models.example.test/v1beta",
      protocolMode: "native_responses",
      apiKey: "channel-secret",
    },
  }
  return {
    resolveManagedModel: vi.fn(
      async (modelId: string, expectedKind?: ManagedModelKind) => {
        if (
          modelId !== runtime.model.id ||
          (expectedKind && expectedKind !== runtime.model.kind)
        ) {
          throw new AppError("MODEL_SELECTION_INVALID")
        }
        return runtime
      }
    ),
  }
}

function inMemoryDatabase(): {
  prisma: PrismaClient
  settingsJson: () => Record<string, unknown>
  upsert: ReturnType<typeof vi.fn>
} {
  let settingsJson: Record<string, unknown> = {}
  const findUnique = vi.fn(async () =>
    Object.keys(settingsJson).length === 0 ? null : { settingsJson }
  )
  const upsert = vi.fn(
    async (input: {
      create: { settingsJson: Record<string, unknown> }
      update: { settingsJson: Record<string, unknown> }
    }) => {
      settingsJson =
        Object.keys(settingsJson).length === 0
          ? { ...input.create.settingsJson }
          : { ...input.update.settingsJson }
      return { settingsJson }
    }
  )
  const transactionClient = {
    $executeRaw: vi.fn(async () => 1),
    systemSetting: { findUnique, upsert },
    auditLog: { create: vi.fn(async () => ({ id: "audit-id" })) },
  }
  const prisma = {
    systemSetting: { findUnique },
    $transaction: vi.fn(
      async (
        callback: (client: typeof transactionClient) => Promise<unknown>
      ) => callback(transactionClient)
    ),
  } as unknown as PrismaClient
  return {
    prisma,
    settingsJson: () => ({ ...settingsJson }),
    upsert,
  }
}
