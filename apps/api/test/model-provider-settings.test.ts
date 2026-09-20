import { describe, expect, it, vi } from "vitest"

import type { PrismaClient } from "../src/generated/prisma/client.js"
import { encryptJson } from "../src/lib/crypto.js"
import {
  ModelProviderSettingsService,
  parseOpenAiCompatibleModelContextWindows,
} from "../src/modules/system/model-provider-settings.js"
import { testConfig } from "./test-config.js"

const ACTOR_ID = "00000000-0000-4000-8000-000000000099"
const USER_ID = "00000000-0000-4000-8000-000000000010"
const CONVERSATION_A_ID = "00000000-0000-4000-8000-0000000000a1"
const CONVERSATION_B_ID = "00000000-0000-4000-8000-0000000000b1"

describe("ModelProviderSettingsService", () => {
  it("keeps existing version 9 settings usable with task-model extraction at the lowest supported effort", async () => {
    const config = testConfig();
    const database = inMemoryDatabase({
      model_provider_settings_key_id: config.credentialKeyId,
      model_provider_settings_encrypted: encryptJson({ version: 9, revision: 4, defaultModel: "existing", titleModel: "existing", providers: [{
        id: "existing-channel", name: null, provider: "openai_compatible", providerProject: null, providerLocation: null, baseUrl: "https://existing.example/v1", protocolMode: "native_responses", apiKey: "existing-key", models: [pricedModel("existing", ["high", "minimal", "medium"], "high")],
      }] }, config.credentialMasterKey, config.credentialKeyId, "linksense:model-provider-settings:v1"),
    });
    const service = new ModelProviderSettingsService(database.prisma, config);
    expect((await service.getAdminSettings()).memory_extraction_model).toBeNull();
    await expect(service.resolveRuntimeForSelection("existing", "high")).resolves.toMatchObject({ model: "existing", reasoningEffort: "high", provider: { memoryExtraction: { model: "existing", reasoningEffort: "minimal", apiKey: "existing-key" } } });
    expect(JSON.stringify(await service.getAdminSettings())).not.toContain("existing-key");
  });

  it("resolves a dedicated extraction channel and preserves it across unrelated settings updates", async () => {
    const database = inMemoryDatabase();
    const service = new ModelProviderSettingsService(database.prisma, testConfig());
    const providers = [
      provider("task", "https://task.example.test/v1", [pricedModel("task-model", ["high", "low"], "high")], "native_responses", "task-key"),
      provider("memory", "https://memory.example.test/v1", [pricedModel("memory-model", ["high", "minimal", "low"], "high")], "chat_completions_bridge", "memory-key"),
    ];
    const saved = await service.update(ACTOR_ID, { expected_revision: 0, providers, default_model: "task-model", memory_extraction_model: "memory-model" }, {});
    expect(saved.memory_extraction_model).toBe("memory-model");
    await expect(service.resolveRuntimeForSelection("task-model", "high")).resolves.toMatchObject({
      model: "task-model", reasoningEffort: "high", provider: { memoryExtraction: {
        model: "memory-model", reasoningEffort: "minimal", baseUrl: "https://memory.example.test/v1", apiKey: "memory-key", protocolMode: "chat_completions_bridge",
      } },
    });
    const reloaded = new ModelProviderSettingsService(database.prisma, testConfig());
    await reloaded.update(ACTOR_ID, { expected_revision: 1, providers, default_model: "task-model" }, {});
    expect((await reloaded.getAdminSettings()).memory_extraction_model).toBe("memory-model");
    await expect(reloaded.deleteProvider(ACTOR_ID, { expected_revision: 2, provider_id: "memory" }, {})).rejects.toMatchObject({ code: "MODEL_IN_USE_BY_SYSTEM_SETTING" });
    await reloaded.update(ACTOR_ID, { expected_revision: 2, providers, default_model: "task-model", memory_extraction_model: null }, {});
    await expect(reloaded.resolveRuntimeForSelection("task-model", "high")).resolves.toMatchObject({ provider: { memoryExtraction: { model: "task-model", reasoningEffort: "low", apiKey: "task-key" } } });
  });

  it("allows a hidden chat model for memory extraction and protects its reference during edits and deletion", async () => {
    const database = inMemoryDatabase()
    const service = new ModelProviderSettingsService(database.prisma, testConfig())
    const taskModel = pricedModel("task-model", ["low", "high"], "high")
    const memoryModel = { ...pricedModel("memory-model", ["low"], "low"), enabled: false }
    const models = [taskModel, memoryModel]
    const providers = [provider("main", "https://models.example.test/v1", models, "native_responses", "test-key")]
    await service.update(ACTOR_ID, {
      expected_revision: 0, providers, default_model: taskModel.id, memory_extraction_model: memoryModel.id,
    }, {})

    await expect(service.resolveRuntimeForSelection(taskModel.id, "high")).resolves.toMatchObject({
      provider: { memoryExtraction: { model: memoryModel.id, reasoningEffort: "low" } },
    })
    await expect(service.deleteModel(ACTOR_ID, {
      expected_revision: 1, model_id: memoryModel.id,
    }, {})).rejects.toMatchObject({ code: "MODEL_IN_USE_BY_SYSTEM_SETTING" })
    await expect(service.update(ACTOR_ID, {
      expected_revision: 1,
      providers: [provider("main", "https://models.example.test/v1", [taskModel], "native_responses", "test-key")],
      default_model: taskModel.id,
    }, {})).rejects.toMatchObject({ code: "MODEL_IN_USE_BY_SYSTEM_SETTING" })
    expect((await service.getAdminSettings()).revision).toBe(1)

    await service.update(ACTOR_ID, {
      expected_revision: 1, providers, default_model: taskModel.id, memory_extraction_model: null,
    }, {})
    await expect(service.deleteModel(ACTOR_ID, {
      expected_revision: 2, model_id: memoryModel.id,
    }, {})).resolves.toMatchObject({ revision: 3, memory_extraction_model: null })
  })

  it("rejects a selected memory model whose channel has no credentials even when it is hidden from conversations", async () => {
    const service = new ModelProviderSettingsService(inMemoryDatabase().prisma, testConfig())
    const providers = [
      provider("task", "https://task.example.test/v1", [pricedModel("task-model", ["low"], "low")], "native_responses", "test-key"),
      provider("memory", "https://memory.example.test/v1", [{ ...pricedModel("memory-model", ["low"], "low"), enabled: false }]),
    ]
    await expect(service.update(ACTOR_ID, {
      expected_revision: 0, providers, default_model: "task-model", memory_extraction_model: "memory-model",
    }, {})).rejects.toMatchObject({ code: "VALIDATION_ERROR" })
    expect((await service.getAdminSettings()).configured).toBe(false)
  })

  it("persists an empty channel, returns no selectable models, and supports adding its first model later", async () => {
    const database = inMemoryDatabase()
    const metadataClient = { readContextWindows: vi.fn(async () => new Map<string, number>()) }
    const service = new ModelProviderSettingsService(database.prisma, testConfig(), metadataClient)
    const emptyChannel = provider("empty", "https://models.example.test/v1", [], "native_responses", "test-channel-key")
    const saved = await service.update(ACTOR_ID, {
      expected_revision: 0, providers: [emptyChannel], default_model: null, title_model: null,
    }, {})
    expect(saved).toMatchObject({ revision: 1, providers: [{ id: "empty", models: [], api_key_configured: true }], default_model: null, title_model: null })
    expect(metadataClient.readContextWindows).not.toHaveBeenCalled()
    const reloaded = new ModelProviderSettingsService(database.prisma, testConfig(), metadataClient)
    await expect(reloaded.getAdminSettings()).resolves.toEqual(saved)
    await expect(reloaded.getPreference(USER_ID)).resolves.toEqual({ configured: false, models: [], default_model: null, selected_model: null, selected_reasoning_effort: null })
    await expect(reloaded.resolveRuntime(USER_ID)).rejects.toMatchObject({ code: "MODEL_PROVIDER_NOT_CONFIGURED" })
    await expect(reloaded.resolveTaskTitleModel()).resolves.toBeNull()
    await reloaded.update(ACTOR_ID, {
      expected_revision: 1,
      providers: [provider("empty", emptyChannel.base_url, [pricedModel("first", ["medium"], "medium")])],
      default_model: "first", title_model: "first",
    }, {})
    await expect(reloaded.getPreference(USER_ID)).resolves.toMatchObject({ configured: true, models: [{ id: "first" }], selected_model: "first" })
    await expect(reloaded.resolveRuntime(USER_ID)).resolves.toMatchObject({ model: "first", provider: { apiKey: "test-channel-key" } })
  })

  it("deletes an empty channel while retaining another empty channel", async () => {
    const database = inMemoryDatabase()
    const service = new ModelProviderSettingsService(database.prisma, testConfig())
    await service.update(ACTOR_ID, {
      expected_revision: 0,
      providers: [provider("first", "https://first.example.test/v1", []), provider("second", "https://second.example.test/v1", [])],
      default_model: null, title_model: null,
    }, {})
    const next = await service.deleteProvider(ACTOR_ID, { expected_revision: 1, provider_id: "second" }, {})
    expect(next.providers.map((channel) => channel.id)).toEqual(["first"])
    await expect(service.getPreference(USER_ID)).resolves.toMatchObject({ configured: false, models: [] })
  })

  it("persists channel and model order and returns enabled chat models in that order without changing selections", async () => {
    const database = inMemoryDatabase()
    const metadataClient = {
      readContextWindows: vi.fn(async () => new Map<string, number>()),
    }
    const service = new ModelProviderSettingsService(
      database.prisma,
      testConfig(),
      metadataClient,
    )
    const alpha = pricedModel("alpha", ["medium"], "medium")
    const beta = pricedModel("beta", ["medium"], "medium")
    const hidden = {
      ...pricedModel("hidden", ["medium"], "medium"),
      enabled: false,
    }
    const gamma = pricedModel("gamma", ["medium"], "medium")
    const firstChannel = provider(
      "first", "https://first.example.test/v1", [alpha, hidden, beta],
      "native_responses", "first-test-key",
    )
    const secondChannel = provider(
      "second", "https://second.example.test/v1", [gamma],
      "native_responses", "second-test-key",
    )
    await service.update(ACTOR_ID, {
      expected_revision: 0,
      providers: [firstChannel, secondChannel],
      default_model: "alpha",
      title_model: "hidden",
    }, {})
    await service.updatePreference(USER_ID, {
      selected_model: "beta", selected_reasoning_effort: "medium",
    }, {})
    await service.update(ACTOR_ID, {
      expected_revision: 1,
      providers: [
        provider("second", secondChannel.base_url, [gamma]),
        {
          ...provider("first", firstChannel.base_url, [beta, hidden, alpha]),
          models: [
            beta,
            {
              id: "embedding", display_name: "Embedding", kind: "embedding",
              enabled: true, input_price_per_million: "0",
            },
            hidden,
            alpha,
          ],
        },
      ],
      default_model: "alpha",
      title_model: "hidden",
    }, {})
    const reloaded = new ModelProviderSettingsService(
      database.prisma, testConfig(), metadataClient,
    )
    const persisted = await reloaded.getAdminSettings()
    expect(persisted.providers.map((channel) => channel.id)).toEqual([
      "second", "first",
    ])
    expect(persisted.providers.flatMap((channel) =>
      channel.models.map((model) => model.id),
    )).toEqual(["gamma", "beta", "embedding", "hidden", "alpha"])
    const preference = await reloaded.getPreference(USER_ID)
    expect(preference.models.map((model) => model.id)).toEqual([
      "gamma", "beta", "alpha",
    ])
    expect(preference).toMatchObject({
      default_model: "alpha", selected_model: "beta",
      selected_reasoning_effort: "medium",
    })
    expect(persisted.title_model).toBe("hidden")
    await expect(reloaded.resolveRuntime(USER_ID)).resolves.toMatchObject({
      model: "beta",
      provider: { baseUrl: firstChannel.base_url, apiKey: "first-test-key" },
    })
  })

  it("reads common OpenAI-compatible model context window fields", () => {
    expect(
      parseOpenAiCompatibleModelContextWindows({
        data: [
          { id: "vllm", max_model_len: 150_000 },
          { id: "context-window", context_window: 258_400 },
          { id: "context-length", context_length: 128_000 },
          { id: "max-context-length", max_context_length: 64_000 },
          { id: "unknown" },
        ],
      })
    ).toEqual(
      new Map([
        ["vllm", 150_000],
        ["context-window", 258_400],
        ["context-length", 128_000],
        ["max-context-length", 64_000],
      ])
    )
  })

  it("encrypts channel keys, preserves them by provider id, and routes each model through its channel", async () => {
    const database = inMemoryDatabase()
    const service = new ModelProviderSettingsService(
      database.prisma,
      testConfig()
    )

    const first = await service.update(
      ACTOR_ID,
      {
        expected_revision: 0,
        providers: [
          provider(
            "provider-a",
            "https://models-a.example.test/v1/",
            [
              pricedModel("model-a", ["low", "medium"], "medium", {
                input_price_per_million: "10",
                cached_input_price_per_million: "2",
                output_price_per_million: "20",
              }),
            ],
            "responses_tool_compat",
            "provider-a-secret"
          ),
          provider(
            "provider-b",
            "https://models-b.example.test/v1/",
            [pricedModel("model-b", ["medium", "high"], "high")],
            "chat_completions_bridge",
            "provider-b-secret"
          ),
        ],
        default_model: "model-a",
      },
      {}
    )

    expect(first).toEqual({
      memory_extraction_model: null,
      configured: true,
      revision: 1,
      providers: [
        {
          id: "provider-a",
          name: "provider-a channel",
          provider: "openai_compatible",
          provider_project: null,
          provider_location: null,
          base_url: "https://models-a.example.test/v1",
          protocol_mode: "responses_tool_compat",
          api_key_configured: true,
          models: [
            pricedModel("model-a", ["low", "medium"], "medium", {
              input_price_per_million: "10",
              cached_input_price_per_million: "2",
              output_price_per_million: "20",
            }),
          ],
        },
        {
          id: "provider-b",
          name: "provider-b channel",
          provider: "openai_compatible",
          provider_project: null,
          provider_location: null,
          base_url: "https://models-b.example.test/v1",
          protocol_mode: "chat_completions_bridge",
          api_key_configured: true,
          models: [pricedModel("model-b", ["medium", "high"], "high")],
        },
      ],
      default_model: "model-a",
      title_model: "model-a",
    })
    expect(JSON.stringify(first)).not.toContain("provider-a-secret")
    expect(JSON.stringify(first)).not.toContain("provider-b-secret")
    expect(JSON.stringify(database.settingsJson())).not.toContain("secret")

    await service.update(
      ACTOR_ID,
      {
        expected_revision: 1,
        providers: [
          provider(
            "provider-a",
            "https://models-a-2.example.test/v1",
            [
              pricedModel("model-a", ["medium", "high"], "high", {
                input_price_per_million: "10",
                cached_input_price_per_million: "2",
                output_price_per_million: "20",
              }),
            ],
            "responses_tool_compat"
          ),
          provider(
            "provider-b",
            "https://models-b.example.test/v1",
            [pricedModel("model-b", ["medium", "high"], "high")],
            "chat_completions_bridge"
          ),
        ],
        default_model: "model-a",
      },
      {}
    )

    await expect(service.resolveRuntime(USER_ID)).resolves.toMatchObject({
      model: "model-a",
      reasoningEffort: "high",
      provider: {
        revision: 2,
        baseUrl: "https://models-a-2.example.test/v1",
        protocolMode: "responses_tool_compat",
        apiKey: "provider-a-secret",
      },
    })
    await expect(service.resolveTaskTitleModel()).resolves.toMatchObject({
      model: {
        id: "model-a",
        kind: "chat",
        input_price_per_million: "10",
        cached_input_price_per_million: "2",
        output_price_per_million: "20",
      },
      channel: {
        baseUrl: "https://models-a-2.example.test/v1",
        apiKey: "provider-a-secret",
      },
    })
    expect(database.auditCreate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          metadataJson: expect.objectContaining({
            api_key_replaced: false,
          }),
        }),
      })
    )
    await service.updatePreference(
      USER_ID,
      { selected_model: "model-b", selected_reasoning_effort: "medium" },
      {}
    )
    await expect(service.resolveRuntime(USER_ID)).resolves.toMatchObject({
      model: "model-b",
      provider: {
        revision: 2,
        baseUrl: "https://models-b.example.test/v1",
        protocolMode: "chat_completions_bridge",
        apiKey: "provider-b-secret",
      },
    })
  })

  it("keeps model settings independent from quota settings", async () => {
    const database = inMemoryDatabase()
    const service = new ModelProviderSettingsService(
      database.prisma,
      testConfig()
    )

    const settings = await service.update(
      ACTOR_ID,
      {
        expected_revision: 0,
        providers: [
          provider(
            "provider-a",
            "https://models.example.test/v1",
            [model("model-a", ["medium"], "medium")],
            "native_responses",
            "provider-secret"
          ),
        ],
        default_model: "model-a",
      },
      {}
    )

    expect(settings).not.toHaveProperty("credit_limits")
    expect(settings).not.toHaveProperty("token_limits")
    await expect(service.getAdminSettings()).resolves.toEqual(settings)

  })

  it("detects vLLM model context windows from the OpenAI-compatible model list", async () => {
    const database = inMemoryDatabase()
    const metadataClient = {
      readContextWindows: vi.fn(async () => new Map([["model-a", 150_000]])),
    }
    const service = new ModelProviderSettingsService(
      database.prisma,
      testConfig(),
      metadataClient
    )

    const settings = await service.update(
      ACTOR_ID,
      {
        expected_revision: 0,
        providers: [
          provider(
            "provider-a",
            "https://models.example.test/v1/",
            [pricedModel("model-a", ["medium"], "medium")],
            "native_responses",
            "provider-secret"
          ),
        ],
        default_model: "model-a",
      },
      {}
    )

    expect(metadataClient.readContextWindows).toHaveBeenCalledWith({
      baseUrl: "https://models.example.test/v1",
      apiKey: "provider-secret",
    })
    expect(settings.providers[0]?.models[0]).toMatchObject({
      id: "model-a",
      context_window: 150_000,
    })
    await expect(service.resolveRuntime(USER_ID)).resolves.toMatchObject({
      provider: {
        modelContextWindow: 150_000,
      },
    })
    await expect(service.getPreference(USER_ID)).resolves.toMatchObject({
      models: [{ id: "model-a", context_window: 150_000 }],
    })
  })

  it("keeps an existing context window when metadata probing is unavailable", async () => {
    const database = inMemoryDatabase()
    const metadataClient = {
      readContextWindows: vi
        .fn()
        .mockResolvedValueOnce(new Map([["model-a", 150_000]]))
        .mockRejectedValueOnce(new Error("metadata unavailable")),
    }
    const service = new ModelProviderSettingsService(
      database.prisma,
      testConfig(),
      metadataClient
    )

    await service.update(
      ACTOR_ID,
      {
        expected_revision: 0,
        providers: [
          provider(
            "provider-a",
            "https://models.example.test/v1",
            [pricedModel("model-a", ["medium"], "medium")],
            "native_responses",
            "provider-secret"
          ),
        ],
        default_model: "model-a",
      },
      {}
    )

    await expect(
      service.update(
        ACTOR_ID,
        {
          expected_revision: 1,
          providers: [
            provider(
              "provider-a",
              "https://models.example.test/v1",
              [pricedModel("model-a", ["medium"], "medium")]
            ),
          ],
          default_model: "model-a",
        },
        {}
      )
    ).resolves.toMatchObject({
      providers: [{ models: [{ id: "model-a", context_window: 150_000 }] }],
    })
  })

  it("stores one account-wide preference and falls back when that model is disabled", async () => {
    const database = inMemoryDatabase()
    const service = new ModelProviderSettingsService(
      database.prisma,
      testConfig()
    )
    await service.update(
      ACTOR_ID,
      {
        expected_revision: 0,
        providers: [
          provider(
            "provider-a",
            "https://models.example.test/v1",
            [
              model("model-a", ["medium"], "medium"),
              model("model-b", ["low", "high"], "low"),
            ],
            "native_responses",
            "provider-secret"
          ),
        ],
        default_model: "model-a",
      },
      {}
    )

    await expect(
      service.updatePreference(
        USER_ID,
        { selected_model: "model-b", selected_reasoning_effort: "high" },
        {}
      )
    ).resolves.toMatchObject({
      selected_model: "model-b",
      selected_reasoning_effort: "high",
    })
    expect(database.userState()).toMatchObject({
      preferredModel: "model-b",
      preferredReasoningEffort: "high",
    })

    await service.update(
      ACTOR_ID,
      {
        expected_revision: 1,
        providers: [
          provider("provider-a", "https://models.example.test/v1", [
            model("model-a", ["medium"], "medium"),
            { ...model("model-b", ["high"], "high"), enabled: false },
          ]),
        ],
        default_model: "model-a",
      },
      {}
    )

    await expect(service.getPreference(USER_ID)).resolves.toMatchObject({
      selected_model: "model-a",
      selected_reasoning_effort: "medium",
    })
    await expect(
      service.updatePreference(
        USER_ID,
        { selected_model: "model-b", selected_reasoning_effort: "high" },
        {}
      )
    ).rejects.toMatchObject({ code: "MODEL_SELECTION_INVALID" })
  })

  it("resolves a disabled source model through its exact configured transition channel", async () => {
    const database = inMemoryDatabase()
    const service = new ModelProviderSettingsService(
      database.prisma,
      testConfig()
    )
    const disabledSourceModel = {
      ...pricedModel("gpt-5.6-luna", ["high"], "high", {
        input_price_per_million: "10",
        cached_input_price_per_million: "2",
        output_price_per_million: "20",
      }),
      enabled: false,
      context_window: 200_000,
    }
    await service.update(
      ACTOR_ID,
      {
        expected_revision: 0,
        providers: [
          provider(
            "provider-gpt-source",
            "https://gpt-source.example.test/v1",
            [disabledSourceModel],
            "native_responses",
            "gpt-source-secret"
          ),
          provider(
            "provider-qwen-target",
            "https://qwen-target.example.test/v1",
            [pricedModel("qwen3.8-27b", ["medium"], "medium")],
            "chat_completions_bridge",
            "qwen-target-secret"
          ),
        ],
        default_model: "qwen3.8-27b",
        title_model: "qwen3.8-27b",
      },
      {}
    )

    await expect(
      service.resolveModelTransitionRuntime("gpt-5.6-luna")
    ).resolves.toEqual({
      model: "gpt-5.6-luna",
      provider: {
        revision: 1,
        baseUrl: "https://gpt-source.example.test/v1",
        protocolMode: "native_responses",
        apiKey: "gpt-source-secret",
        pricing: {
          input_price_per_million: "10",
          cached_input_price_per_million: "2",
          output_price_per_million: "20",
        },
        modelContextWindow: 200_000,
      },
    })
    await expect(
      service.resolveRuntimeForSelection("gpt-5.6-luna", "high")
    ).rejects.toMatchObject({ code: "MODEL_SELECTION_INVALID" })
    await expect(
      service.resolveModelTransitionRuntime("removed-model")
    ).rejects.toMatchObject({ code: "MODEL_SELECTION_INVALID" })
  })

  it("updates only one model availability immediately and moves the default model", async () => {
    const database = inMemoryDatabase()
    const service = new ModelProviderSettingsService(
      database.prisma,
      testConfig()
    )
    await service.update(
      ACTOR_ID,
      {
        expected_revision: 0,
        providers: [
          provider(
            "provider-a",
            "https://models.example.test/v1",
            [
              model("model-a", ["medium"], "medium"),
              model("model-b", ["high"], "high"),
            ],
            "native_responses",
            "provider-secret"
          ),
        ],
        default_model: "model-a",
        title_model: "model-b",
      },
      {}
    )

    const updated = await service.updateModelAvailability(
      ACTOR_ID,
      {
        expected_revision: 1,
        model_id: "model-a",
        enabled: false,
      },
      { userAgent: "model-settings-test" }
    )

    expect(updated).toMatchObject({
      revision: 2,
      default_model: "model-b",
      providers: [
        {
          base_url: "https://models.example.test/v1",
          models: [
            { id: "model-a", enabled: false },
            { id: "model-b", enabled: true },
          ],
        },
      ],
    })
    await expect(service.resolveRuntime(USER_ID)).resolves.toMatchObject({
      model: "model-b",
      provider: { apiKey: "provider-secret", revision: 2 },
    })
    expect(database.auditCreate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "model_provider_model_availability_updated",
          metadataJson: expect.objectContaining({
            revision: 2,
            enabled_model_count: 1,
            model_enabled: false,
            api_key_replaced: false,
          }),
          userAgent: "model-settings-test",
        }),
      })
    )
  })

  it("keeps one chat model available in the composer and rejects stale visibility updates", async () => {
    const database = inMemoryDatabase()
    const service = new ModelProviderSettingsService(
      database.prisma,
      testConfig()
    )
    await service.update(
      ACTOR_ID,
      {
        expected_revision: 0,
        providers: [
          provider(
            "provider-a",
            "https://models.example.test/v1",
            [model("model-a", ["medium"], "medium")],
            "native_responses",
            "provider-secret"
          ),
        ],
        default_model: "model-a",
      },
      {}
    )

    await expect(
      service.updateModelAvailability(
        ACTOR_ID,
        {
          expected_revision: 1,
          model_id: "model-a",
          enabled: false,
        },
        {}
      )
    ).rejects.toMatchObject({ code: "LAST_ENABLED_MODEL_REQUIRED" })
    await expect(
      service.updateModelAvailability(
        ACTOR_ID,
        {
          expected_revision: 0,
          model_id: "model-a",
          enabled: false,
        },
        {}
      )
    ).rejects.toMatchObject({ code: "CONFLICT" })
    await expect(service.getAdminSettings()).resolves.toMatchObject({
      revision: 1,
      default_model: "model-a",
      providers: [{ models: [{ id: "model-a", enabled: true }] }],
    })
  })

  it("rejects conversation visibility updates for non-chat models", async () => {
    const database = inMemoryDatabase()
    const service = new ModelProviderSettingsService(
      database.prisma,
      testConfig()
    )
    await service.update(
      ACTOR_ID,
      {
        expected_revision: 0,
        providers: [
          {
            id: "provider-a",
            name: "provider-a channel",
            provider: "openai_compatible",
            provider_project: null,
            provider_location: null,
            base_url: "https://models.example.test/v1",
            protocol_mode: "native_responses",
            api_key: "provider-secret",
            models: [
              pricedModel("model-a", ["medium"], "medium"),
              {
                id: "embedding-model",
                display_name: "Embedding Model",
                enabled: true,
                kind: "embedding",
                input_price_per_million: "0.14",
              },
            ],
          },
        ],
        default_model: "model-a",
      },
      {}
    )

    await expect(
      service.updateModelAvailability(
        ACTOR_ID,
        {
          expected_revision: 1,
          model_id: "embedding-model",
          enabled: false,
        },
        {}
      )
    ).rejects.toMatchObject({ code: "MODEL_SELECTION_INVALID" })
  })

  it("keeps using a task title model after it is hidden from the composer", async () => {
    const database = inMemoryDatabase()
    const service = new ModelProviderSettingsService(
      database.prisma,
      testConfig()
    )
    const providers = [
      provider(
        "provider-a",
        "https://models.example.test/v1",
        [
          model("model-a", ["medium"], "medium"),
          model("model-b", ["high"], "high"),
        ],
        "native_responses",
        "provider-secret"
      ),
    ]
    await service.update(
      ACTOR_ID,
      {
        expected_revision: 0,
        providers,
        default_model: "model-a",
        title_model: "model-b",
      },
      {}
    )

    await expect(
      service.updateModelAvailability(
        ACTOR_ID,
        { expected_revision: 1, model_id: "model-b", enabled: false },
        {}
      )
    ).resolves.toMatchObject({
      revision: 2,
      title_model: "model-b",
      providers: [
        {
          models: [
            { id: "model-a", enabled: true },
            { id: "model-b", enabled: false },
          ],
        },
      ],
    })
    await expect(service.getPreference(USER_ID)).resolves.toMatchObject({
      models: [{ id: "model-a" }],
      default_model: "model-a",
      selected_model: "model-a",
    })
    await expect(service.resolveTaskTitleModel()).resolves.toMatchObject({
      model: { id: "model-b", enabled: false, kind: "chat" },
      channel: { id: "provider-a" },
    })
    await expect(
      service.deleteModel(
        ACTOR_ID,
        { expected_revision: 2, model_id: "model-b" },
        {}
      )
    ).rejects.toMatchObject({ code: "MODEL_IN_USE_BY_SYSTEM_SETTING" })
  })

  it("deletes one persisted model immediately and moves the default model", async () => {
    const database = inMemoryDatabase()
    const service = new ModelProviderSettingsService(
      database.prisma,
      testConfig()
    )
    await service.update(
      ACTOR_ID,
      {
        expected_revision: 0,
        providers: [
          provider(
            "provider-a",
            "https://models.example.test/v1",
            [
              model("model-a", ["medium"], "medium"),
              model("model-b", ["high"], "high"),
            ],
            "native_responses",
            "provider-secret"
          ),
        ],
        default_model: "model-a",
        title_model: "model-b",
      },
      {}
    )

    const updated = await service.deleteModel(
      ACTOR_ID,
      { expected_revision: 1, model_id: "model-a" },
      { userAgent: "model-settings-delete-test" }
    )

    expect(updated).toMatchObject({
      revision: 2,
      default_model: "model-b",
      providers: [
        {
          id: "provider-a",
          models: [{ id: "model-b", enabled: true }],
        },
      ],
    })
    await expect(service.resolveRuntime(USER_ID)).resolves.toMatchObject({
      model: "model-b",
      provider: { apiKey: "provider-secret", revision: 2 },
    })
    expect(database.auditCreate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "model_provider_model_deleted",
          targetType: "model_provider_model",
          targetId: "model-a",
          metadataJson: expect.objectContaining({
            revision: 2,
            provider_id: "provider-a",
            model_count: 1,
            enabled_model_count: 1,
            default_model: "model-b",
          }),
          userAgent: "model-settings-delete-test",
        }),
      })
    )
  })

  it("deletes one persisted model channel immediately and moves the default model", async () => {
    const database = inMemoryDatabase()
    const service = new ModelProviderSettingsService(
      database.prisma,
      testConfig()
    )
    await service.update(
      ACTOR_ID,
      {
        expected_revision: 0,
        providers: [
          provider(
            "provider-a",
            "https://models-a.example.test/v1",
            [model("model-a", ["medium"], "medium")],
            "native_responses",
            "provider-a-secret"
          ),
          provider(
            "provider-b",
            "https://models-b.example.test/v1",
            [model("model-b", ["high"], "high")],
            "responses_tool_compat",
            "provider-b-secret"
          ),
        ],
        default_model: "model-a",
        title_model: "model-b",
      },
      {}
    )

    const updated = await service.deleteProvider(
      ACTOR_ID,
      { expected_revision: 1, provider_id: "provider-a" },
      { userAgent: "model-channel-delete-test" }
    )

    expect(updated).toMatchObject({
      revision: 2,
      default_model: "model-b",
      providers: [
        {
          id: "provider-b",
          models: [{ id: "model-b", enabled: true }],
        },
      ],
    })
    await expect(service.resolveRuntime(USER_ID)).resolves.toMatchObject({
      model: "model-b",
      provider: {
        baseUrl: "https://models-b.example.test/v1",
        apiKey: "provider-b-secret",
        revision: 2,
      },
    })
    expect(database.auditCreate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "model_provider_deleted",
          targetType: "model_provider",
          targetId: "provider-a",
          metadataJson: expect.objectContaining({
            revision: 2,
            deleted_model_count: 1,
            provider_count: 1,
            model_count: 1,
            default_model: "model-b",
          }),
          userAgent: "model-channel-delete-test",
        }),
      })
    )
  })

  it("keeps system-referenced models usable when hidden but protects them from deletion", async () => {
    const database = inMemoryDatabase()
    const service = new ModelProviderSettingsService(
      database.prisma,
      testConfig()
    )
    service.registerReferenceReader({
      getReferencedModelIds: vi.fn().mockResolvedValue(new Set(["model-b"])),
    })
    await service.update(
      ACTOR_ID,
      {
        expected_revision: 0,
        providers: [
          provider(
            "provider-a",
            "https://models-a.example.test/v1",
            [model("model-a", ["medium"], "medium")],
            "native_responses",
            "provider-a-secret"
          ),
          provider(
            "provider-b",
            "https://models-b.example.test/v1",
            [
              model("model-b", ["medium"], "medium"),
              model("model-c", ["medium"], "medium"),
            ],
            "native_responses",
            "provider-b-secret"
          ),
        ],
        default_model: "model-a",
      },
      {}
    )

    await expect(
      service.updateModelAvailability(
        ACTOR_ID,
        { expected_revision: 1, model_id: "model-b", enabled: false },
        {}
      )
    ).resolves.toMatchObject({
      revision: 2,
      providers: expect.arrayContaining([
        expect.objectContaining({
          id: "provider-b",
          models: expect.arrayContaining([
            expect.objectContaining({ id: "model-b", enabled: false }),
          ]),
        }),
      ]),
    })
    await expect(
      service.resolveManagedModel("model-b", "chat")
    ).resolves.toMatchObject({
      revision: 2,
      model: { id: "model-b", enabled: false },
      channel: { id: "provider-b" },
    })
    await expect(
      service.deleteModel(
        ACTOR_ID,
        { expected_revision: 2, model_id: "model-b" },
        {}
      )
    ).rejects.toMatchObject({ code: "MODEL_IN_USE_BY_SYSTEM_SETTING" })
    await expect(
      service.deleteProvider(
        ACTOR_ID,
        { expected_revision: 2, provider_id: "provider-b" },
        {}
      )
    ).rejects.toMatchObject({ code: "MODEL_IN_USE_BY_SYSTEM_SETTING" })
    await expect(service.getAdminSettings()).resolves.toMatchObject({
      revision: 2,
      providers: [
        { id: "provider-a" },
        {
          id: "provider-b",
          models: [
            { id: "model-b", enabled: false },
            { id: "model-c", enabled: true },
          ],
        },
      ],
    })
  })

  it("rejects deleting the last model channel and stale revisions", async () => {
    const database = inMemoryDatabase()
    const service = new ModelProviderSettingsService(
      database.prisma,
      testConfig()
    )
    await service.update(
      ACTOR_ID,
      {
        expected_revision: 0,
        providers: [
          provider(
            "provider-a",
            "https://models-a.example.test/v1",
            [model("model-a", ["medium"], "medium")],
            "native_responses",
            "provider-a-secret"
          ),
          provider(
            "provider-b",
            "https://models-b.example.test/v1",
            [model("model-b", ["medium"], "medium")],
            "native_responses",
            "provider-b-secret"
          ),
        ],
        default_model: "model-a",
      },
      {}
    )

    await expect(
      service.deleteProvider(
        ACTOR_ID,
        { expected_revision: 0, provider_id: "provider-a" },
        {}
      )
    ).rejects.toMatchObject({ code: "CONFLICT" })

    const singleProviderDatabase = inMemoryDatabase()
    const singleProviderService = new ModelProviderSettingsService(
      singleProviderDatabase.prisma,
      testConfig()
    )
    await singleProviderService.update(
      ACTOR_ID,
      {
        expected_revision: 0,
        providers: [
          provider(
            "provider-a",
            "https://models.example.test/v1",
            [model("model-a", ["medium"], "medium")],
            "native_responses",
            "provider-secret"
          ),
        ],
        default_model: "model-a",
      },
      {}
    )
    await expect(
      singleProviderService.deleteProvider(
        ACTOR_ID,
        { expected_revision: 1, provider_id: "provider-a" },
        {}
      )
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" })
  })

  it("rejects deleting a channel's only model, the last enabled model, and stale revisions", async () => {
    const database = inMemoryDatabase()
    const service = new ModelProviderSettingsService(
      database.prisma,
      testConfig()
    )
    await service.update(
      ACTOR_ID,
      {
        expected_revision: 0,
        providers: [
          provider(
            "provider-a",
            "https://models.example.test/v1",
            [
              model("model-a", ["medium"], "medium"),
              { ...model("model-b", ["high"], "high"), enabled: false },
            ],
            "native_responses",
            "provider-secret"
          ),
        ],
        default_model: "model-a",
      },
      {}
    )

    await expect(
      service.deleteModel(
        ACTOR_ID,
        { expected_revision: 1, model_id: "model-a" },
        {}
      )
    ).rejects.toMatchObject({ code: "LAST_ENABLED_MODEL_REQUIRED" })
    await expect(
      service.deleteModel(
        ACTOR_ID,
        { expected_revision: 0, model_id: "model-b" },
        {}
      )
    ).rejects.toMatchObject({ code: "CONFLICT" })

    const singleModelDatabase = inMemoryDatabase()
    const singleModelService = new ModelProviderSettingsService(
      singleModelDatabase.prisma,
      testConfig()
    )
    await singleModelService.update(
      ACTOR_ID,
      {
        expected_revision: 0,
        providers: [
          provider(
            "provider-a",
            "https://models.example.test/v1",
            [model("model-a", ["medium"], "medium")],
            "native_responses",
            "provider-secret"
          ),
        ],
        default_model: "model-a",
      },
      {}
    )
    await expect(
      singleModelService.deleteModel(
        ACTOR_ID,
        { expected_revision: 1, model_id: "model-a" },
        {}
      )
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" })
  })

  it("updates only the selected task model and restores another task from its latest turn", async () => {
    const database = inMemoryDatabase()
    database.addConversation(CONVERSATION_A_ID)
    database.addConversation(CONVERSATION_B_ID)
    database.addTurn(CONVERSATION_A_ID, "model-a", 1)
    database.addTurn(CONVERSATION_B_ID, "model-b", 1)
    const service = new ModelProviderSettingsService(
      database.prisma,
      testConfig()
    )
    await service.update(
      ACTOR_ID,
      {
        expected_revision: 0,
        providers: [
          provider(
            "provider-a",
            "https://models.example.test/v1",
            [
              model("model-a", ["medium"], "medium"),
              model("model-b", ["medium"], "medium"),
              model("model-c", ["medium"], "medium"),
            ],
            "native_responses",
            "provider-secret"
          ),
        ],
        default_model: "model-a",
      },
      {}
    )

    await expect(
      service.getPreference(USER_ID, CONVERSATION_A_ID)
    ).resolves.toMatchObject({ selected_model: "model-a" })
    await expect(
      service.getPreference(USER_ID, CONVERSATION_B_ID)
    ).resolves.toMatchObject({ selected_model: "model-b" })

    await service.updatePreference(
      USER_ID,
      {
        selected_model: "model-c",
        selected_reasoning_effort: "medium",
      },
      {},
      CONVERSATION_A_ID
    )

    await expect(
      service.resolveRuntime(USER_ID, CONVERSATION_A_ID)
    ).resolves.toMatchObject({ model: "model-c" })
    await expect(
      service.resolveRuntime(USER_ID, CONVERSATION_B_ID)
    ).resolves.toMatchObject({ model: "model-b" })
    expect(database.conversationModel(CONVERSATION_A_ID)).toBe("model-c")
    expect(database.conversationModel(CONVERSATION_B_ID)).toBeNull()
  })

  it("uses the administrator-configured reasoning efforts at runtime", async () => {
    const config = testConfig()
    const database = inMemoryDatabase({
      model_provider_settings_encrypted: encryptJson(
        {
          version: 2,
          revision: 4,
          baseUrl: "https://models.example.test/v1",
          protocolMode: "native_responses",
          apiKey: "provider-secret",
          models: [model("gpt-5.6-sol", ["minimal"], "minimal")],
          defaultModel: "gpt-5.6-sol",
        },
        config.credentialMasterKey,
        config.credentialKeyId,
        "linksense:model-provider-settings:v1"
      ),
      model_provider_settings_key_id: config.credentialKeyId,
    })
    const service = new ModelProviderSettingsService(database.prisma, config)

    await expect(service.getPreference(USER_ID)).resolves.toMatchObject({
      selected_model: "gpt-5.6-sol",
      selected_reasoning_effort: "minimal",
      models: [
        {
          id: "gpt-5.6-sol",
          supported_reasoning_efforts: ["minimal"],
          default_reasoning_effort: "minimal",
        },
      ],
    })
    await expect(service.resolveRuntime(USER_ID)).resolves.toMatchObject({
      model: "gpt-5.6-sol",
      reasoningEffort: "minimal",
    })
    await expect(
      service.updatePreference(
        USER_ID,
        {
          selected_model: "gpt-5.6-sol",
          selected_reasoning_effort: "ultra",
        },
        {}
      )
    ).rejects.toMatchObject({ code: "MODEL_SELECTION_INVALID" })
    await expect(
      service.updatePreference(
        USER_ID,
        {
          selected_model: "gpt-5.6-sol",
          selected_reasoning_effort: "minimal",
        },
        {}
      )
    ).resolves.toMatchObject({
      selected_reasoning_effort: "minimal",
    })
    await expect(service.resolveRuntime(USER_ID)).resolves.toMatchObject({
      reasoningEffort: "minimal",
    })
  })

  it("persists an administrator-selected reasoning effort list", async () => {
    const database = inMemoryDatabase()
    const service = new ModelProviderSettingsService(
      database.prisma,
      testConfig()
    )

    await expect(
      service.update(
        ACTOR_ID,
        {
          expected_revision: 0,
          providers: [
            provider(
              "provider-a",
              "https://models.example.test/v1",
              [model("unknown-model", ["minimal"], "minimal")],
              "native_responses",
              "provider-secret"
            ),
          ],
          default_model: "unknown-model",
        },
        {}
      )
    ).resolves.toMatchObject({
      providers: [
        {
          models: [
            {
              supported_reasoning_efforts: ["minimal"],
              default_reasoning_effort: "minimal",
            },
          ],
        },
      ],
    })
  })

  it("preserves an administrator-selected GPT default reasoning effort", async () => {
    const database = inMemoryDatabase()
    const service = new ModelProviderSettingsService(
      database.prisma,
      testConfig()
    )

    await expect(
      service.update(
        ACTOR_ID,
        {
          expected_revision: 0,
          providers: [
            provider(
              "provider-a",
              "https://models.example.test/v1",
              [model("gpt-5.6-sol", ["high"], "high")],
              "native_responses",
              "provider-secret"
            ),
          ],
          default_model: "gpt-5.6-sol",
        },
        {}
      )
    ).resolves.toMatchObject({
      providers: [
        {
          models: [
            {
              id: "gpt-5.6-sol",
              supported_reasoning_efforts: ["high"],
              default_reasoning_effort: "high",
            },
          ],
        },
      ],
    })
    await expect(service.resolveRuntime(USER_ID)).resolves.toMatchObject({
      model: "gpt-5.6-sol",
      reasoningEffort: "high",
    })
  })

  it("reads version 1 encrypted settings as native Responses without a database migration", async () => {
    const config = testConfig()
    const database = inMemoryDatabase({
      model_provider_settings_encrypted: encryptJson(
        {
          version: 1,
          revision: 7,
          baseUrl: "https://legacy-models.example.test/v1",
          apiKey: "legacy-provider-secret",
          models: [model("legacy-model", ["medium"], "medium")],
          defaultModel: "legacy-model",
        },
        config.credentialMasterKey,
        config.credentialKeyId,
        "linksense:model-provider-settings:v1"
      ),
      model_provider_settings_key_id: config.credentialKeyId,
    })
    const service = new ModelProviderSettingsService(database.prisma, config)

    await expect(service.getAdminSettings()).resolves.toMatchObject({
      configured: true,
      revision: 7,
      providers: [
        {
          id: "provider-1",
          name: null,
          base_url: "https://legacy-models.example.test/v1",
          protocol_mode: "native_responses",
          api_key_configured: true,
        },
      ],
    })
    await expect(service.resolveRuntime(USER_ID)).resolves.toMatchObject({
      provider: {
        revision: 7,
        protocolMode: "native_responses",
        apiKey: "legacy-provider-secret",
      },
    })
  })

  it("migrates version 3 channels without names and persists an administrator rename", async () => {
    const config = testConfig()
    const database = inMemoryDatabase({
      model_provider_settings_encrypted: encryptJson(
        {
          version: 3,
          revision: 8,
          providers: [
            {
              id: "provider-a",
              baseUrl: "https://models.example.test/v1",
              protocolMode: "native_responses",
              apiKey: "provider-secret",
              models: [model("model-a", ["medium"], "medium")],
            },
          ],
          defaultModel: "model-a",
        },
        config.credentialMasterKey,
        config.credentialKeyId,
        "linksense:model-provider-settings:v1"
      ),
      model_provider_settings_key_id: config.credentialKeyId,
    })
    const service = new ModelProviderSettingsService(database.prisma, config)

    await expect(service.getAdminSettings()).resolves.toMatchObject({
      revision: 8,
      providers: [{ id: "provider-a", name: null }],
    })

    await expect(
      service.update(
        ACTOR_ID,
        {
          expected_revision: 8,
          providers: [
            {
              ...provider("provider-a", "https://models.example.test/v1", [
                model("model-a", ["medium"], "medium"),
              ]),
              name: "Production channel",
            },
          ],
          default_model: "model-a",
        },
        {}
      )
    ).resolves.toMatchObject({
      revision: 9,
      providers: [{ id: "provider-a", name: "Production channel" }],
    })
    await expect(service.resolveRuntime(USER_ID)).resolves.toMatchObject({
      provider: {
        baseUrl: "https://models.example.test/v1",
        apiKey: "provider-secret",
      },
    })
  })

  it("moves version 6 per-model service providers onto lossless split channels", async () => {
    const config = testConfig()
    const database = inMemoryDatabase({
      model_provider_settings_encrypted: encryptJson(
        {
          version: 6,
          revision: 9,
          providers: [
            {
              id: "mixed-channel",
              name: "Mixed channel",
              baseUrl: "https://models.example.test/v1",
              protocolMode: "native_responses",
              apiKey: "provider-secret",
              models: [
                {
                  ...legacyV6PricedModel("openai-model", ["medium"], "medium"),
                  provider: "openai",
                  provider_project: null,
                  provider_location: null,
                },
                {
                  ...legacyV6PricedModel("alibaba-model", ["medium"], "medium"),
                  provider: "alibaba",
                  provider_project: null,
                  provider_location: null,
                },
              ],
            },
          ],
          defaultModel: "openai-model",
        },
        config.credentialMasterKey,
        config.credentialKeyId,
        "linksense:model-provider-settings:v1"
      ),
      model_provider_settings_key_id: config.credentialKeyId,
    })
    const service = new ModelProviderSettingsService(database.prisma, config)

    const settings = await service.getAdminSettings()
    expect(settings).toMatchObject({
      revision: 9,
      default_model: "openai-model",
    })
    expect(settings.providers).toHaveLength(2)
    expect(settings.providers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          provider: "openai",
          models: [expect.objectContaining({ id: "openai-model" })],
        }),
        expect.objectContaining({
          provider: "alibaba",
          models: [expect.objectContaining({ id: "alibaba-model" })],
        }),
      ])
    )
    for (const migratedModel of settings.providers.flatMap(
      (provider) => provider.models
    )) {
      expect(migratedModel).not.toHaveProperty("provider")
      expect(migratedModel).not.toHaveProperty("provider_project")
      expect(migratedModel).not.toHaveProperty("provider_location")
    }
  })

  it("imports legacy knowledge and image model definitions into the unified catalog once", async () => {
    const config = testConfig()
    const initialSettings = {
      model_provider_settings_encrypted: encryptJson(
        {
          version: 5,
          revision: 4,
          providers: [
            {
              id: "provider-a",
              name: "Conversation models",
              baseUrl: "https://models.example.test/v1",
              protocolMode: "native_responses",
              apiKey: "conversation-secret",
              models: [
                {
                  ...model("chat-model", ["medium"], "medium"),
                  input_price_per_million: "10",
                  cached_input_price_per_million: "2",
                  output_price_per_million: "20",
                },
              ],
            },
          ],
          defaultModel: "chat-model",
        },
        config.credentialMasterKey,
        config.credentialKeyId,
        "linksense:model-provider-settings:v1"
      ),
      model_provider_settings_key_id: config.credentialKeyId,
      knowledge_model_settings_encrypted: encryptJson(
        {
          version: 2,
          revision: 3,
          embedding: {
            baseUrl: "https://knowledge.example.test",
            apiKey: "embedding-secret",
            model: "embedding-model",
            pricing: { input_price_per_million: "0.14" },
          },
          rerank: {
            enabled: true,
            baseUrl: "https://knowledge.example.test/v1",
            apiKey: "reranker-secret",
            model: "reranker-model",
            pricing: { input_price_per_million: "0.28" },
          },
        },
        config.credentialMasterKey,
        config.credentialKeyId,
        "linksense:knowledge-model-settings:v1"
      ),
      knowledge_model_settings_key_id: config.credentialKeyId,
      image_understanding_settings_encrypted: encryptJson(
        {
          version: 1,
          revision: 2,
          enabled: true,
          provider: "alibaba",
          baseUrl: "https://multimodal.example.test/v1",
          apiKey: "image-secret",
          model: "image-chat-model",
          project: null,
          location: null,
        },
        config.credentialMasterKey,
        config.credentialKeyId,
        "linksense:image-understanding-settings:v1"
      ),
      image_understanding_settings_key_id: config.credentialKeyId,
    }
    const database = inMemoryDatabase(initialSettings)
    const service = new ModelProviderSettingsService(database.prisma, config)

    const first = await service.getAdminSettings()
    expect(first).toMatchObject({
      revision: 5,
      default_model: "chat-model",
    })
    expect(first.providers.flatMap((provider) => provider.models)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "chat-model", kind: "chat" }),
        expect.objectContaining({
          id: "embedding-model",
          kind: "embedding",
          input_price_per_million: "0.14",
        }),
        expect.objectContaining({
          id: "reranker-model",
          kind: "reranker",
          input_price_per_million: "0.28",
        }),
        expect.objectContaining({
          id: "image-chat-model",
          kind: "chat",
          supports_image_input: true,
        }),
      ])
    )
    expect(first.providers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          provider: "alibaba",
          models: expect.arrayContaining([
            expect.objectContaining({ id: "image-chat-model" }),
          ]),
        }),
      ])
    )

    const reloaded = new ModelProviderSettingsService(database.prisma, config)
    await expect(reloaded.getAdminSettings()).resolves.toMatchObject({
      revision: 5,
    })
  })

  it("rejects adding a new model channel without its own API key", async () => {
    const database = inMemoryDatabase()
    const service = new ModelProviderSettingsService(
      database.prisma,
      testConfig()
    )

    await expect(
      service.update(
        ACTOR_ID,
        {
          expected_revision: 0,
          providers: [
            provider("provider-a", "https://models.example.test/v1", [
              model("model-a", ["medium"], "medium"),
            ]),
          ],
          default_model: "model-a",
        },
        {}
      )
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" })
  })

  it("requires an API key for a disabled model selected for task auto naming", async () => {
    const database = inMemoryDatabase()
    const service = new ModelProviderSettingsService(
      database.prisma,
      testConfig()
    )
    const disabledTitleModel = {
      ...pricedModel("model-title", ["medium"], "medium"),
      enabled: false,
    }

    await expect(
      service.update(
        ACTOR_ID,
        {
          expected_revision: 0,
          providers: [
            provider(
              "provider-default",
              "https://default-models.example.test/v1",
              [pricedModel("model-default", ["medium"], "medium")],
              "native_responses",
              "default-provider-secret"
            ),
            provider("provider-title", "https://title-models.example.test/v1", [
              disabledTitleModel,
            ]),
          ],
          default_model: "model-default",
          title_model: "model-title",
        },
        {}
      )
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" })
  })
})

function provider(
  id: string,
  baseUrl: string,
  models: ReturnType<typeof model>[],
  protocolMode:
    | "native_responses"
    | "responses_tool_compat"
    | "chat_completions_bridge" = "native_responses",
  apiKey?: string
) {
  return {
    id,
    name: `${id} channel`,
    provider: "openai_compatible" as const,
    provider_project: null,
    provider_location: null,
    base_url: baseUrl,
    protocol_mode: protocolMode,
    ...(apiKey ? { api_key: apiKey } : {}),
    models,
  }
}

function model(
  id: string,
  efforts: Array<
    "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | "ultra"
  >,
  defaultEffort:
    "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | "ultra"
) {
  return {
    id,
    display_name: id.toUpperCase(),
    enabled: true,
    supported_reasoning_efforts: efforts,
    default_reasoning_effort: defaultEffort,
  }
}

function pricedModel(
  id: string,
  efforts: Array<
    "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | "ultra"
  >,
  defaultEffort:
    "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | "ultra",
  pricing = {
    input_price_per_million: "0",
    cached_input_price_per_million: "0",
    output_price_per_million: "0",
  }
) {
  return {
    ...model(id, efforts, defaultEffort),
    kind: "chat" as const,
    supports_image_input: false,
    context_window: null,
    ...pricing,
  }
}

function legacyV6PricedModel(
  ...args: Parameters<typeof pricedModel>
): Omit<ReturnType<typeof pricedModel>, "context_window"> {
  const value = { ...pricedModel(...args) } as Record<string, unknown>
  delete value.context_window
  return value as Omit<ReturnType<typeof pricedModel>, "context_window">
}

function inMemoryDatabase(initialSettingsJson: Record<string, unknown> = {}): {
  prisma: PrismaClient
  auditCreate: ReturnType<typeof vi.fn>
  settingsJson: () => Record<string, unknown>
  addConversation: (id: string) => void
  addTurn: (conversationId: string, model: string, sequenceNo: number) => void
  conversationModel: (id: string) => string | null | undefined
  userState: () => {
    preferredModel: string | null
    preferredReasoningEffort: string | null
  }
} {
  let settingsJson: Record<string, unknown> = initialSettingsJson
  const user = {
    id: USER_ID,
    status: "active",
    preferredModel: null as string | null,
    preferredReasoningEffort: null as string | null,
  }
  const conversations = new Map<
    string,
    { id: string; ownerId: string; preferredModel: string | null }
  >()
  const turns: Array<{
    conversationId: string
    model: string
    sequenceNo: number
  }> = []
  const auditCreate = vi.fn(async () => undefined)
  const systemSetting = {
    findUnique: vi.fn(async () => ({ settingsJson })),
    upsert: vi.fn(
      async (input: { update: { settingsJson: Record<string, unknown> } }) => {
        settingsJson = { ...input.update.settingsJson }
        return { settingsJson }
      }
    ),
  }
  const userRepository = {
    findFirst: vi.fn(
      async (input: { where: { id: string; status: string } }) =>
        input.where.id === user.id && input.where.status === user.status
          ? { ...user }
          : null
    ),
    update: vi.fn(
      async (input: {
        data: {
          preferredModel: string
          preferredReasoningEffort: string
        }
      }) => {
        user.preferredModel = input.data.preferredModel
        user.preferredReasoningEffort = input.data.preferredReasoningEffort
        return { ...user }
      }
    ),
  }
  const conversationRepository = {
    findFirst: vi.fn(
      async (input: { where: { id: string; ownerId: string } }) => {
        const conversation = conversations.get(input.where.id)
        return conversation?.ownerId === input.where.ownerId
          ? { ...conversation }
          : null
      }
    ),
    update: vi.fn(
      async (input: {
        where: { id: string }
        data: { preferredModel: string }
      }) => {
        const conversation = conversations.get(input.where.id)
        if (!conversation) throw new Error("conversation not found")
        conversation.preferredModel = input.data.preferredModel
        return { ...conversation }
      }
    ),
  }
  const conversationTurnRepository = {
    findFirst: vi.fn(
      async (input: {
        where: { conversationId: string }
        orderBy: { sequenceNo: "desc" }
      }) =>
        turns
          .filter((turn) => turn.conversationId === input.where.conversationId)
          .sort((left, right) => right.sequenceNo - left.sequenceNo)
          .at(0) ?? null
    ),
  }
  const transaction = {
    $executeRaw: vi.fn(async () => undefined),
    $queryRaw: vi.fn(async () => [{ id: USER_ID }]),
    systemSetting,
    user: userRepository,
    conversation: conversationRepository,
    conversationTurn: conversationTurnRepository,
    auditLog: { create: auditCreate },
  }
  const prisma = {
    systemSetting,
    user: userRepository,
    conversation: conversationRepository,
    conversationTurn: conversationTurnRepository,
    $transaction: vi.fn(async (action: (tx: typeof transaction) => unknown) =>
      action(transaction)
    ),
  } as unknown as PrismaClient
  return {
    prisma,
    auditCreate,
    settingsJson: () => settingsJson,
    addConversation: (id: string) => {
      conversations.set(id, {
        id,
        ownerId: USER_ID,
        preferredModel: null,
      })
    },
    addTurn: (
      conversationId: string,
      selectedModel: string,
      sequenceNo: number
    ) => {
      turns.push({ conversationId, model: selectedModel, sequenceNo })
    },
    conversationModel: (id: string) => conversations.get(id)?.preferredModel,
    userState: () => ({
      preferredModel: user.preferredModel,
      preferredReasoningEffort: user.preferredReasoningEffort,
    }),
  }
}
