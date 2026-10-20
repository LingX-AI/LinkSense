import sharp from "sharp"
import { describe, expect, it, vi } from "vitest"

import {
  imageGenerationProviderDefinitions,
  type ImageGenerationProvider,
} from "@linksense/shared"
import type { PrismaClient } from "../src/generated/prisma/client.js"
import { encryptJson } from "../src/lib/crypto.js"
import {
  ImageGenerationSettingsService,
  resolveProviderBaseUrl,
} from "../src/modules/system/image-generation-settings.js"
import type { ModelUsageRecorder } from "../src/modules/usage/model-usage.js"
import { testConfig } from "./test-config.js"

const ACTOR_ID = "00000000-0000-4000-8000-000000000099"
const USER_ID = "00000000-0000-4000-8000-000000000010"
const CONVERSATION_ID = "00000000-0000-4000-8000-0000000000a1"
const TURN_ID = "00000000-0000-4000-8000-0000000000b1"
const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
)

describe("ImageGenerationSettingsService", () => {
  it.each([1, 2])("names %i generated images after their scene instead of the model", async (count) => {
    const images = await Promise.all(Array.from({ length: count }, (_, index) =>
      sharp({ create: { width: 1, height: 1, channels: 3, background: { r: index * 100, g: 80, b: 40 } } }).png().toBuffer(),
    ))
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      data: images.map((image) => ({ b64_json: image.toString("base64") })),
    }), { status: 200, headers: { "content-type": "application/json" } }))
    const { service } = await configuredProviderHarness("openai_compatible", "custom-image-model", fetchMock)
    const result = await service.generate({
      ownerId: USER_ID,
      conversationId: CONVERSATION_ID,
      turnId: TURN_ID,
      request: { prompt: "A corgi sleeping on a sunny windowsill", image_name: "午后窗台上的柯基.png", count },
    })
    expect(result.images.map((image) => image.display_name)).toEqual(
      count === 1 ? ["午后窗台上的柯基.png"] : ["午后窗台上的柯基-1.png", "午后窗台上的柯基-2.png"],
    )
    expect(requestJsonBody(fetchMock)).not.toHaveProperty("image_name")
  })

  it("saves and reloads a custom address without exposing the encrypted connection key", async () => {
    const database = inMemoryDatabase()
    const service = new ImageGenerationSettingsService(
      database.prisma,
      testConfig(),
      usageRecorder(),
    )
    const settings = await service.update(
      ACTOR_ID,
      {
        expected_revision: 0,
        enabled: true,
        provider: "openai_compatible",
        base_url: "http://images.example.test:8080/custom/v1///",
        api_key: "synthetic-compatible-secret",
        model: "custom-image-model",
        price_per_image: "0.25",
      },
      {},
    )
    expect(settings).toMatchObject({
      provider: "openai_compatible",
      base_url: "http://images.example.test:8080/custom/v1",
      api_key_configured: true,
      model: "custom-image-model",
    })
    await expect(service.getAdminSettings()).resolves.toEqual(settings)
    expect(JSON.stringify(settings)).not.toContain("synthetic-compatible-secret")
    expect(JSON.stringify(database.settingsJson())).not.toContain("synthetic-compatible-secret")
    expect(JSON.stringify(database.settingsJson())).not.toContain("images.example.test")

    const updated = await service.update(
      ACTOR_ID,
      {
        expected_revision: 1,
        enabled: true,
        provider: "openai_compatible",
        base_url: "https://replacement.example.test/v1",
        model: "custom-image-model",
        price_per_image: "0.25",
      },
      {},
    )
    expect(updated).toMatchObject({
      revision: 2,
      base_url: "https://replacement.example.test/v1",
      api_key_configured: true,
    })
  })

  it.each([
    ["alibaba_bailian", "qwen-image-3.0", ""],
    ["openai", "gpt-image-2", "/images/generations"],
    ["openai_compatible", "custom-image-model", "/images/generations"],
    ["google_gemini", "gemini-3.1-flash-image", "/v1/models/gemini-3.1-flash-image:generateContent"],
    ["stability", "stable-image-core", "/v2beta/stable-image/generate/core"],
    ["fal", "fal-ai/flux/dev", "/fal-ai/flux/dev"],
    ["replicate", "black-forest-labs/flux-schnell", "/models/black-forest-labs/flux-schnell/predictions"],
    ["together", "black-forest-labs/FLUX.1-schnell", "/images/generations"],
  ] satisfies Array<[ImageGenerationProvider, string, string]>)(
    "generates images with the saved custom address and preserves the base path for %s",
    async (provider, model, endpointPath) => {
      const fetchMock = vi.fn<typeof fetch>(async () => providerGenerationResponse(provider))
      const { service, recorder } = await configuredProviderHarness(
        provider,
        model,
        fetchMock as unknown as typeof fetch,
        "http://images.example.test:8080/custom/",
      )
      const result = await service.generate({
        ownerId: USER_ID,
        conversationId: CONVERSATION_ID,
        turnId: TURN_ID,
        request: { image_name: "场景图片", prompt: "A test image", count: 1 },
      })
      expect(result).toMatchObject({
        provider,
        model,
        image_count: 1,
        images: [{ data_base64: ONE_PIXEL_PNG.toString("base64"), mime_type: "image/png" }],
      })
      expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
        `http://images.example.test:8080/custom${endpointPath}`,
      )
      expect(recorder.recordModelUsage).toHaveBeenCalledOnce()
    },
  )

  it.each(imageGenerationProviderDefinitions.filter(({ key }) => key !== "openai_compatible"))(
    "keeps pre-change encrypted $key settings usable without a stored custom address",
    async (definition) => {
      const config = testConfig()
      const providerOptions = {
        workspace_id: definition.key === "alibaba_bailian" ? "workspace" : null,
        region: definition.default_region,
      }
      const database = inMemoryDatabase({
        image_generation_settings_key_id: config.credentialKeyId,
        image_generation_settings_encrypted: encryptJson(
          {
            version: 1,
            revision: 2,
            enabled: true,
            provider: definition.key,
            providerOptions,
            apiKey: "synthetic-existing-secret",
            model: definition.default_model,
            pricePerImage: "0.25",
          },
          config.credentialMasterKey,
          config.credentialKeyId,
          "linksense:image-generation-settings:v1",
        ),
      })
      const fetchMock = vi.fn<typeof fetch>(async () => providerGenerationResponse(definition.key))
      const service = new ImageGenerationSettingsService(
        database.prisma,
        config,
        usageRecorder(),
        fetchMock as unknown as typeof fetch,
      )
      database.setActiveTurn({ id: TURN_ID, conversationId: CONVERSATION_ID, ownerId: USER_ID })
      const expectedBaseUrl = definition.base_url
        .replace("{workspace_id}", "workspace")
        .replace("{region}", definition.default_region ?? "")
      await expect(service.getAdminSettings()).resolves.toMatchObject({
        revision: 2,
        base_url: expectedBaseUrl,
        api_key_configured: true,
      })
      await service.update(ACTOR_ID, {
        expected_revision: 2,
        enabled: true,
        provider: definition.key,
        provider_options: providerOptions,
        model: definition.default_model,
        price_per_image: "0.25",
      }, {})
      await expect(service.generate({
        ownerId: USER_ID,
        conversationId: CONVERSATION_ID,
        turnId: TURN_ID,
        request: { image_name: "场景图片", prompt: "A test image" },
      })).resolves.toMatchObject({ image_count: 1, provider: definition.key })
      expect(String(fetchMock.mock.calls[0]?.[0])).toContain(expectedBaseUrl)
    },
  )

  it("forwards compatible image options and downloads URL outputs without sending the API key", async () => {
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      if (String(url).endsWith("/images/generations")) {
        return new Response(JSON.stringify({ data: [{ url: "https://output.example.test/image.png" }] }), {
          headers: { "content-type": "application/json" },
        })
      }
      expect(init?.headers).toBeUndefined()
      return new Response(ONE_PIXEL_PNG, { headers: { "content-type": "image/png" } })
    })
    const { service } = await configuredProviderHarness(
      "openai_compatible",
      "qwen-image",
      fetchMock as unknown as typeof fetch,
      "https://images.example.test/v1",
    )
    await expect(service.generate({
      ownerId: USER_ID,
      conversationId: CONVERSATION_ID,
      turnId: TURN_ID,
      request: { image_name: "场景图片", prompt: "A test image", size: "1024x768", seed: 42, negative_prompt: "blur" },
    })).resolves.toMatchObject({ provider: "openai_compatible", image_count: 1 })
    expect(requestJsonBody(fetchMock)).toEqual({
      model: "qwen-image",
      prompt: "A test image",
      size: "1024x768",
      n: 1,
      seed: 42,
      negative_prompt: "blur",
      response_format: "b64_json",
    })
    expect(fetchMock).toHaveBeenCalledWith("https://images.example.test/v1/images/generations", expect.objectContaining({
      headers: expect.objectContaining({ authorization: "Bearer openai_compatible-secret" }),
    }))
    expect(fetchMock).toHaveBeenCalledWith("https://output.example.test/image.png", expect.anything())
  })

  it("rejects a different owner before calling a compatible provider", async () => {
    const fetchMock = vi.fn()
    const { service, recorder } = await configuredProviderHarness(
      "openai_compatible",
      "custom-image-model",
      fetchMock as unknown as typeof fetch,
      "https://images.example.test/v1",
    )
    await expect(service.generate({
      ownerId: ACTOR_ID,
      conversationId: CONVERSATION_ID,
      turnId: TURN_ID,
      request: { image_name: "场景图片", prompt: "A test image" },
    })).rejects.toMatchObject({ code: "IMAGE_GENERATION_TURN_INACTIVE" })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(recorder.recordModelUsage).not.toHaveBeenCalled()
  })

  it("stores encrypted provider settings and projects built-in provider metadata", async () => {
    const database = inMemoryDatabase()
    const service = new ImageGenerationSettingsService(
      database.prisma,
      testConfig(),
      usageRecorder(),
    )

    await expect(service.getAdminSettings()).resolves.toMatchObject({
      configured: false,
      revision: 0,
      enabled: false,
      provider: null,
      api_key_configured: false,
      model: null,
      price_per_image: "0",
      providers: expect.arrayContaining([
        expect.objectContaining({
          key: "alibaba_bailian",
          default_model: "qwen-image-3.0",
        }),
        expect.objectContaining({
          key: "google_gemini",
          default_model: "gemini-3.1-flash-image",
        }),
        expect.objectContaining({
          key: "together",
          default_model: "black-forest-labs/FLUX.1-schnell",
        }),
      ]),
    })

    const settings = await service.update(
      ACTOR_ID,
      {
        expected_revision: 0,
        enabled: true,
        provider: "alibaba_bailian",
        provider_options: {
          workspace_id: "dashscope-workspace",
          region: "cn-beijing",
        },
        api_key: "dashscope-secret",
        model: "qwen-image-3.0",
        price_per_image: "0.120000",
      },
      {},
    )

    expect(settings).toMatchObject({
      configured: true,
      revision: 1,
      enabled: true,
      provider: "alibaba_bailian",
      base_url:
        "https://dashscope-workspace.cn-beijing.maas.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation",
      api_key_configured: true,
      model: "qwen-image-3.0",
      price_per_image: "0.12",
    })
    expect(JSON.stringify(settings)).not.toContain("dashscope-secret")
    expect(JSON.stringify(database.settingsJson())).not.toContain(
      "dashscope-secret",
    )
    expect(
      resolveProviderBaseUrl("alibaba_bailian", {
        workspace_id: "dashscope-workspace",
        region: "cn-beijing",
      }),
    ).toBe(settings.base_url)
    await expect(
      service.update(
        ACTOR_ID,
        {
          expected_revision: 1,
          enabled: true,
          provider: "openai",
          provider_options: { workspace_id: null, region: null },
          model: "gpt-image-2",
          price_per_image: "0.5",
        },
        {},
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" })
  })

  it("generates images through the selected provider and records image usage", async () => {
    const database = inMemoryDatabase()
    const recorder = usageRecorder()
    const pngBytes = ONE_PIXEL_PNG
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            data: [{ b64_json: pngBytes.toString("base64") }],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
    )
    const fetchImpl = fetchMock as unknown as typeof fetch
    const service = new ImageGenerationSettingsService(
      database.prisma,
      testConfig(),
      recorder,
      fetchImpl,
      () => new Date("2026-08-10T08:00:00.000Z"),
    )

    await service.update(
      ACTOR_ID,
      {
        expected_revision: 0,
        enabled: true,
        provider: "openai",
        provider_options: { workspace_id: null, region: null },
        api_key: "openai-secret",
        model: "gpt-image-2",
        price_per_image: "0.5",
      },
      {},
    )
    database.setActiveTurn({
      id: TURN_ID,
      conversationId: CONVERSATION_ID,
      ownerId: USER_ID,
    })

    await expect(
      service.generate({
        ownerId: USER_ID,
        conversationId: CONVERSATION_ID,
        turnId: TURN_ID,
        request: { image_name: "场景图片", prompt: "A clean product mockup", count: 1 },
      }),
    ).resolves.toMatchObject({
      success: true,
      provider: "openai",
      model: "gpt-image-2",
      image_count: 1,
      unit_price: "0.5",
      total_cost: "0.5",
      images: [
        {
          data_base64: pngBytes.toString("base64"),
          mime_type: "image/png",
        },
      ],
    })
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.openai.com/v1/images/generations",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: "Bearer openai-secret",
        }),
      }),
    )
    const openAiBody = requestJsonBody(fetchMock)
    expect(openAiBody).toMatchObject({
      model: "gpt-image-2",
      prompt: "A clean product mockup",
      n: 1,
    })
    expect(openAiBody).not.toHaveProperty("response_format")
    expect(recorder.recordModelUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerId: USER_ID,
        conversationId: CONVERSATION_ID,
        turnId: TURN_ID,
        workload: "image_generation",
        modelKind: "image",
        model: "gpt-image-2",
        tokenUsage: expect.objectContaining({
          totalTokens: 1,
          outputTokens: 1,
        }),
        pricing: expect.objectContaining({
          output_price_per_million: "500000",
        }),
      }),
    )
  })

  it.each(["openai", "openai_compatible"] as const)("uses %s native transparency when the configured model supports it", async (provider) => {
    const pngBytes = await testRgbaPng(
      [0, 0, 0, 0],
      [40, 80, 220, 255],
    )
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            data: [{ b64_json: pngBytes.toString("base64") }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    )
    const { service } = await configuredProviderHarness(
      provider,
      "gpt-image-1.5",
      fetchMock as unknown as typeof fetch,
    )

    const result = await service.generate({
      ownerId: USER_ID,
      conversationId: CONVERSATION_ID,
      turnId: TURN_ID,
      request: { image_name: "场景图片", prompt: "A glass sculpture with fine translucent edges",
        count: 1,
        background: "transparent",
        transparency_mode: "native",
      },
    })

    expect(result).toMatchObject({
      transparency: {
        requested: true,
        strategy: "native",
        chroma_key: null,
      },
      images: [
        {
          mime_type: "image/png",
          has_transparency: true,
          display_name: "场景图片.png",
        },
      ],
    })
    expect(requestJsonBody(fetchMock)).toMatchObject({
      model: "gpt-image-1.5",
      prompt: "A glass sculpture with fine translucent edges",
      background: "transparent",
      output_format: "png",
    })
  })

  it("falls back to validated chroma-key removal in automatic mode", async () => {
    const pngBytes = await testRgbaPng(
      [0, 255, 0, 255],
      [220, 40, 30, 255],
    )
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            data: [{ b64_json: pngBytes.toString("base64") }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    )
    const { service } = await configuredProviderHarness(
      "openai",
      "gpt-image-2",
      fetchMock as unknown as typeof fetch,
    )

    const result = await service.generate({
      ownerId: USER_ID,
      conversationId: CONVERSATION_ID,
      turnId: TURN_ID,
      request: { image_name: "场景图片", prompt: "A red product icon",
        count: 1,
        background: "transparent",
        transparency_mode: "auto",
      },
    })
    const body = requestJsonBody(fetchMock) as Record<string, unknown>
    const output = Buffer.from(result.images[0]!.data_base64, "base64")
    const corner = await sharp(output).ensureAlpha().raw().toBuffer({
      resolveWithObject: true,
    })

    expect(result.transparency).toEqual({
      requested: true,
      strategy: "chroma_key",
      chroma_key: "green",
    })
    expect(result.images[0]).toMatchObject({
      mime_type: "image/png",
      has_transparency: true,
    })
    expect(body.prompt).toContain("perfectly flat, uniform green (#00ff00)")
    expect(body).not.toHaveProperty("background")
    expect(corner.data[3]).toBe(0)
  })

  it("rejects unsupported native transparency before contacting the provider", async () => {
    const fetchMock = vi.fn()
    const { service, recorder } = await configuredProviderHarness(
      "openai",
      "gpt-image-2",
      fetchMock as unknown as typeof fetch,
    )

    await expect(
      service.generate({
        ownerId: USER_ID,
        conversationId: CONVERSATION_ID,
        turnId: TURN_ID,
        request: { image_name: "场景图片", prompt: "A fluffy cat with detailed fur",
          count: 1,
          background: "transparent",
          transparency_mode: "native",
        },
      }),
    ).rejects.toMatchObject({
      code: "IMAGE_GENERATION_TRANSPARENCY_UNSUPPORTED",
    })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(recorder.recordModelUsage).not.toHaveBeenCalled()
  })

  it("records provider usage but does not retry invalid transparent output", async () => {
    const opaquePng = await testRgbaPng(
      [20, 60, 140, 255],
      [220, 40, 30, 255],
    )
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            data: [{ b64_json: opaquePng.toString("base64") }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    )
    const { service, recorder } = await configuredProviderHarness(
      "openai",
      "gpt-image-2",
      fetchMock as unknown as typeof fetch,
    )

    await expect(
      service.generate({
        ownerId: USER_ID,
        conversationId: CONVERSATION_ID,
        turnId: TURN_ID,
        request: { image_name: "场景图片", prompt: "A red product icon",
          count: 1,
          background: "transparent",
          transparency_mode: "chroma_key",
        },
      }),
    ).rejects.toMatchObject({
      code: "IMAGE_GENERATION_TRANSPARENCY_INVALID",
    })
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(recorder.recordModelUsage).toHaveBeenCalledOnce()
  })

  it("does not classify a post-generation usage failure as retryable provider downtime", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            data: [{ b64_json: ONE_PIXEL_PNG.toString("base64") }],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
    )
    const { service, recorder } = await configuredProviderHarness(
      "openai",
      "gpt-image-2",
      fetchMock as unknown as typeof fetch,
    )
    vi.mocked(recorder.recordModelUsage).mockRejectedValueOnce(
      new Error("usage record rejected"),
    )

    await expect(
      service.generate({
        ownerId: USER_ID,
        conversationId: CONVERSATION_ID,
        turnId: TURN_ID,
        request: { image_name: "场景图片", prompt: "A clean product mockup", count: 1 },
      }),
    ).rejects.toMatchObject({ code: "IMAGE_GENERATION_RECORDING_FAILED" })
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it("uses the Alibaba Bailian request shape and preserves provider rejection details", async () => {
    const database = inMemoryDatabase()
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            code: "InvalidApiKey",
            message: "Invalid API-key provided.",
            request_id: "31f808fd-8eef-9004",
          }),
          {
            status: 401,
            statusText: "Unauthorized",
            headers: { "content-type": "application/json" },
          },
        ),
    )
    const fetchImpl = fetchMock as unknown as typeof fetch
    const service = new ImageGenerationSettingsService(
      database.prisma,
      testConfig(),
      usageRecorder(),
      fetchImpl,
    )

    await service.update(
      ACTOR_ID,
      {
        expected_revision: 0,
        enabled: true,
        provider: "alibaba_bailian",
        provider_options: {
          workspace_id: "dashscope-workspace",
          region: "cn-beijing",
        },
        api_key: "dashscope-secret",
        model: "qwen-image-3.0",
        price_per_image: "0.12",
      },
      {},
    )
    database.setActiveTurn({
      id: TURN_ID,
      conversationId: CONVERSATION_ID,
      ownerId: USER_ID,
    })

    await expect(
      service.generate({
        ownerId: USER_ID,
        conversationId: CONVERSATION_ID,
        turnId: TURN_ID,
        request: { image_name: "场景图片", prompt: "帮我生成一张狗狗看电视的图片，现实主义", count: 1 },
      }),
    ).rejects.toMatchObject({
      code: "IMAGE_GENERATION_PROVIDER_REJECTED",
      params: {
        provider_code: "InvalidApiKey",
        provider_message: "Invalid API-key provided.",
        provider_request_id: "31f808fd-8eef-9004",
      },
    })
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://dashscope-workspace.cn-beijing.maas.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: "Bearer dashscope-secret",
          "content-type": "application/json",
        }),
      }),
    )
    const [, init] = fetchMock.mock.calls[0]! as unknown as [
      string,
      RequestInit,
    ]
    expect(JSON.parse(String(init.body))).toEqual({
      model: "qwen-image-3.0",
      input: {
        messages: [
          {
            role: "user",
            content: [{ text: "帮我生成一张狗狗看电视的图片，现实主义" }],
          },
        ],
      },
      parameters: {
        prompt_extend: true,
        n: 1,
      },
    })
  })

  it("downloads the Alibaba image output from the documented content field", async () => {
    const imageUrl = "https://dashscope-result.example/generated.png"
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      if (String(input) === imageUrl) {
        return new Response(ONE_PIXEL_PNG, {
          status: 200,
          headers: { "content-type": "image/png" },
        })
      }
      return new Response(
        JSON.stringify({
          output: {
            choices: [
              {
                finish_reason: "stop",
                message: {
                  role: "assistant",
                  content: [{ image: imageUrl }],
                },
              },
            ],
          },
          usage: { output_image_count: 1 },
          request_id: "alibaba-success-request-1",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      )
    })
    const { service } = await configuredProviderHarness(
      "alibaba_bailian",
      "qwen-image-3.0",
      fetchMock as unknown as typeof fetch,
    )

    await expect(
      service.generate({
        ownerId: USER_ID,
        conversationId: CONVERSATION_ID,
        turnId: TURN_ID,
        request: { image_name: "场景图片", prompt: "帮我生成一张狗狗看电视的图片，现实主义",
          count: 1,
          size: "1024x1536",
        },
      }),
    ).resolves.toMatchObject({
      provider: "alibaba_bailian",
      model: "qwen-image-3.0",
      image_count: 1,
      images: [{ data_base64: ONE_PIXEL_PNG.toString("base64") }],
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(String(fetchMock.mock.calls[1]![0])).toBe(imageUrl)
  })

  it("maps Together dimensions and image options to its generation contract", async () => {
    const pngBytes = ONE_PIXEL_PNG
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            data: [{ b64_json: pngBytes.toString("base64") }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    )
    const { service } = await configuredProviderHarness(
      "together",
      "black-forest-labs/FLUX.1-schnell",
      fetchMock as unknown as typeof fetch,
    )

    await expect(
      service.generate({
        ownerId: USER_ID,
        conversationId: CONVERSATION_ID,
        turnId: TURN_ID,
        request: { image_name: "场景图片", prompt: "A studio portrait",
          count: 1,
          size: "1024x1536",
          negative_prompt: "blur",
          seed: 7,
        },
      }),
    ).resolves.toMatchObject({
      provider: "together",
      image_count: 1,
      images: [{ data_base64: pngBytes.toString("base64") }],
    })
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(requestJsonBody(fetchMock)).toEqual({
      model: "black-forest-labs/FLUX.1-schnell",
      prompt: "A studio portrait",
      n: 1,
      response_format: "base64",
      output_format: "png",
      width: 1024,
      height: 1536,
      negative_prompt: "blur",
      seed: 7,
    })
  })

  it("requests image-only Gemini output with the nearest supported aspect ratio", async () => {
    const pngBytes = ONE_PIXEL_PNG
    const thoughtPngBytes = Buffer.from(ONE_PIXEL_PNG)
    thoughtPngBytes[40] = thoughtPngBytes[40]! ^ 1
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      thought: true,
                      inlineData: {
                        mimeType: "image/png",
                        data: thoughtPngBytes.toString("base64"),
                      },
                    },
                    {
                      inlineData: {
                        mimeType: "image/png",
                        data: pngBytes.toString("base64"),
                      },
                    },
                  ],
                },
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    )
    const { service } = await configuredProviderHarness(
      "google_gemini",
      "gemini-3.1-flash-image",
      fetchMock as unknown as typeof fetch,
    )

    await expect(
      service.generate({
        ownerId: USER_ID,
        conversationId: CONVERSATION_ID,
        turnId: TURN_ID,
        request: { image_name: "场景图片", prompt: "A watercolor city",
          count: 1,
          size: "1024x1536",
          seed: 19,
        },
      }),
    ).resolves.toMatchObject({
      provider: "google_gemini",
      image_count: 1,
      images: [
        {
          data_base64: pngBytes.toString("base64"),
          mime_type: "image/png",
        },
      ],
    })
    const [url, init] = fetchMock.mock.calls[0]! as unknown as [
      URL,
      RequestInit,
    ]
    expect(String(url)).toBe(
      "https://generativelanguage.googleapis.com/v1/models/gemini-3.1-flash-image:generateContent",
    )
    expect(String(url)).not.toContain("key=")
    expect(new Headers(init.headers).get("x-goog-api-key")).toBe(
      "google_gemini-secret",
    )
    expect(JSON.parse(String(init.body))).toEqual({
      contents: [
        { role: "user", parts: [{ text: "A watercolor city" }] },
      ],
      generationConfig: {
        responseModalities: ["IMAGE"],
        responseFormat: {
          image: { aspectRatio: "2:3", imageSize: "2K" },
        },
        seed: 19,
      },
    })
  })

  it("uses Stability multipart fields and model-specific generation endpoint", async () => {
    const pngBytes = ONE_PIXEL_PNG
    const fetchMock = vi.fn(
      async () =>
        new Response(pngBytes, {
          status: 200,
          headers: { "content-type": "image/png" },
        }),
    )
    const { service } = await configuredProviderHarness(
      "stability",
      "stable-image-core",
      fetchMock as unknown as typeof fetch,
    )

    await expect(
      service.generate({
        ownerId: USER_ID,
        conversationId: CONVERSATION_ID,
        turnId: TURN_ID,
        request: { image_name: "场景图片", prompt: "A mountain lake",
          count: 1,
          size: "1024x1536",
          negative_prompt: "fog",
          seed: 31,
        },
      }),
    ).resolves.toMatchObject({ provider: "stability", image_count: 1 })
    const [url, init] = fetchMock.mock.calls[0]! as unknown as [
      string,
      RequestInit,
    ]
    expect(url).toBe(
      "https://api.stability.ai/v2beta/stable-image/generate/core",
    )
    expect(new Headers(init.headers).get("accept")).toBe("image/*")
    const form = init.body as FormData
    expect(form.get("prompt")).toBe("A mountain lake")
    expect(form.get("output_format")).toBe("png")
    expect(form.get("aspect_ratio")).toBe("2:3")
    expect(form.get("negative_prompt")).toBe("fog")
    expect(form.get("seed")).toBe("31")
  })

  it("uses fal custom image dimensions and downloads only declared image records", async () => {
    const pngBytes = ONE_PIXEL_PNG
    const imageUrl = "https://fal.media.example/image.png"
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      if (String(input) === imageUrl) {
        return new Response(pngBytes, {
          status: 200,
          headers: { "content-type": "image/png" },
        })
      }
      return new Response(
        JSON.stringify({
          images: [
            {
              url: imageUrl,
              content_type: "image/png",
              width: 1024,
              height: 1536,
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      )
    })
    const { service } = await configuredProviderHarness(
      "fal",
      "fal-ai/flux/dev",
      fetchMock as unknown as typeof fetch,
    )

    await expect(
      service.generate({
        ownerId: USER_ID,
        conversationId: CONVERSATION_ID,
        turnId: TURN_ID,
        request: { image_name: "场景图片", prompt: "An editorial illustration",
          count: 1,
          size: "1024x1536",
          seed: 43,
        },
      }),
    ).resolves.toMatchObject({
      provider: "fal",
      image_count: 1,
      images: [{ data_base64: pngBytes.toString("base64") }],
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(String(fetchMock.mock.calls[1]![0])).toBe(imageUrl)
    expect(requestJsonBody(fetchMock)).toEqual({
      prompt: "An editorial illustration",
      num_images: 1,
      output_format: "png",
      image_size: { width: 1024, height: 1536 },
      seed: 43,
    })
  })

  it("uses Replicate aspect ratios and ignores prediction status URLs", async () => {
    const pngBytes = ONE_PIXEL_PNG
    const imageUrl = "https://replicate.delivery/output.png"
    const predictionUrl = "https://api.replicate.com/v1/predictions/pred-1"
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      if (String(input) === imageUrl) {
        return new Response(pngBytes, {
          status: 200,
          headers: { "content-type": "image/png" },
        })
      }
      return new Response(
        JSON.stringify({
          id: "pred-1",
          status: "succeeded",
          output: [imageUrl],
          urls: {
            get: predictionUrl,
            web: "https://replicate.com/p/pred-1",
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      )
    })
    const { service } = await configuredProviderHarness(
      "replicate",
      "black-forest-labs/flux-schnell",
      fetchMock as unknown as typeof fetch,
    )

    await expect(
      service.generate({
        ownerId: USER_ID,
        conversationId: CONVERSATION_ID,
        turnId: TURN_ID,
        request: { image_name: "场景图片", prompt: "A neon train station",
          count: 1,
          size: "1024x1536",
          seed: 59,
        },
      }),
    ).resolves.toMatchObject({
      provider: "replicate",
      image_count: 1,
      images: [{ data_base64: pngBytes.toString("base64") }],
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls.map(([input]) => String(input))).not.toContain(
      predictionUrl,
    )
    const [, init] = fetchMock.mock.calls[0]! as unknown as [
      string,
      RequestInit,
    ]
    expect(new Headers(init.headers).get("prefer")).toBe("wait=60")
    expect(JSON.parse(String(init.body))).toEqual({
      input: {
        prompt: "A neon train station",
        num_outputs: 1,
        output_format: "png",
        aspect_ratio: "2:3",
        seed: 59,
      },
    })
  })

  it("preserves structured provider validation errors", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            name: "UnprocessableEntityError",
            detail: [{ msg: "image_size width is out of range" }],
            request_id: "fal-request-1",
          }),
          { status: 422, headers: { "content-type": "application/json" } },
        ),
    )
    const { service } = await configuredProviderHarness(
      "fal",
      "fal-ai/flux/dev",
      fetchMock as unknown as typeof fetch,
    )

    await expect(
      service.generate({
        ownerId: USER_ID,
        conversationId: CONVERSATION_ID,
        turnId: TURN_ID,
        request: { image_name: "场景图片", prompt: "A test image", count: 1 },
      }),
    ).rejects.toMatchObject({
      code: "IMAGE_GENERATION_PROVIDER_REJECTED",
      params: {
        provider_code: "UnprocessableEntityError",
        provider_message: "image_size width is out of range",
        provider_request_id: "fal-request-1",
      },
    })
  })

  it.each(["together", "openai_compatible"] as const)("classifies %s throttling as retryable unavailability without retrying the request", async (provider) => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            error: {
              type: "rate_limit_error",
              message: "Too many image requests.",
            },
          }),
          {
            status: 429,
            statusText: "Too Many Requests",
            headers: {
              "content-type": "application/json",
              "x-request-id": "rate-limit-request-1",
            },
          },
        ),
    )
    const { service } = await configuredProviderHarness(
      provider,
      "black-forest-labs/FLUX.1-schnell",
      fetchMock as unknown as typeof fetch,
    )

    await expect(
      service.generate({
        ownerId: USER_ID,
        conversationId: CONVERSATION_ID,
        turnId: TURN_ID,
        request: { image_name: "场景图片", prompt: "A test image", count: 1 },
      }),
    ).rejects.toMatchObject({
      code: "IMAGE_GENERATION_UNAVAILABLE",
      params: {
        provider_code: "rate_limit_error",
        provider_message: "Too many image requests.",
        provider_request_id: "rate-limit-request-1",
      },
    })
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it.each(["openai", "openai_compatible"] as const)("rejects non-image bytes returned as a successful %s image payload", async (provider) => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            data: [
              { b64_json: Buffer.from("<html>not an image</html>").toString("base64") },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    )
    const { service } = await configuredProviderHarness(
      provider,
      "gpt-image-2",
      fetchMock as unknown as typeof fetch,
    )

    await expect(
      service.generate({
        ownerId: USER_ID,
        conversationId: CONVERSATION_ID,
        turnId: TURN_ID,
        request: { image_name: "场景图片", prompt: "A test image", count: 1 },
      }),
    ).rejects.toMatchObject({ code: "IMAGE_GENERATION_OUTPUT_INVALID" })
  })

  it.each([
    ["chunked downloaded image", "image", 200, undefined],
    ["under-reported downloaded image", "image", 200, "1"],
    ["oversized declared JSON", "json", 200, String(512 * 1024 * 1024)],
    ["chunked provider JSON error", "json", 429, undefined],
    ["chunked provider text error", "text", 503, undefined],
  ] as const)("cancels a %s before consuming the full oversized body", async (_name, kind, status, contentLength) => {
    const chunkCount = kind === "image" ? 25 : 32
    const chunkSize = kind === "image" ? 1024 * 1024 : 16 * 1024
    const cancel = vi.fn()
    let emitted = 0
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (emitted === chunkCount) {
          controller.close()
          return
        }
        const prefix = kind === "json" && emitted === 0 ? '{"data":[],"padding":"' : ""
        const suffix = kind === "json" && emitted === chunkCount - 1 ? '"}' : ""
        controller.enqueue(kind === "image"
          ? new Uint8Array(chunkSize)
          : new TextEncoder().encode(`${prefix}${"x".repeat(chunkSize)}${suffix}`))
        emitted += 1
      },
      cancel,
    })
    const headers = new Headers({
      "content-type": { image: "image/png", json: "application/json", text: "text/plain" }[kind],
    })
    if (contentLength) headers.set("content-length", contentLength)
    const fetchMock = vi.fn<typeof fetch>()
    if (kind === "image") {
      fetchMock.mockResolvedValueOnce(Response.json({ data: [{ url: "https://images.example.test/large.png" }] }))
    }
    fetchMock.mockResolvedValueOnce(new Response(stream, { status, headers }))
    const { service } = await configuredProviderHarness(
      kind === "text" ? "stability" : "openai_compatible",
      kind === "text" ? "stable-image-core" : "test-image-model",
      fetchMock,
    )

    await expect(service.generate({
      ownerId: USER_ID,
      conversationId: CONVERSATION_ID,
      turnId: TURN_ID,
      request: { prompt: "A test image", count: 1 },
    })).rejects.toMatchObject({
      code: status >= 400 ? "IMAGE_GENERATION_UNAVAILABLE" : "IMAGE_GENERATION_OUTPUT_INVALID",
    })
    expect(cancel).toHaveBeenCalledOnce()
    expect(emitted).toBeLessThan(chunkCount)
    expect(fetchMock).toHaveBeenCalledTimes(kind === "image" ? 2 : 1)
  })

  it("preserves valid provider JSON with a UTF-8 byte order mark", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(
      `\uFEFF${JSON.stringify({ data: [{ b64_json: ONE_PIXEL_PNG.toString("base64") }] })}`,
      { headers: { "content-type": "application/json" } },
    ))
    const { service } = await configuredProviderHarness("openai_compatible", "test-image-model", fetchMock)
    await expect(service.generate({
      ownerId: USER_ID,
      conversationId: CONVERSATION_ID,
      turnId: TURN_ID,
      request: { prompt: "A test image", count: 1 },
    })).resolves.toMatchObject({ image_count: 1 })
  })

  it("validates Stability's provider-specific seed maximum", async () => {
    const fetchMock = vi.fn()
    const { service } = await configuredProviderHarness(
      "stability",
      "stable-image-core",
      fetchMock as unknown as typeof fetch,
    )

    await expect(
      service.generate({
        ownerId: USER_ID,
        conversationId: CONVERSATION_ID,
        turnId: TURN_ID,
        request: { image_name: "场景图片", prompt: "A test image",
          count: 1,
          seed: 4_294_967_295,
        },
      }),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      params: { field: "seed", max: 4_294_967_294 },
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

async function configuredProviderHarness(
  provider: ImageGenerationProvider,
  model: string,
  fetchImpl: typeof fetch,
  baseUrl?: string,
): Promise<{
  service: ImageGenerationSettingsService
  recorder: ModelUsageRecorder
}> {
  const database = inMemoryDatabase()
  const recorder = usageRecorder()
  const service = new ImageGenerationSettingsService(
    database.prisma,
    testConfig(),
    recorder,
    fetchImpl,
  )
  await service.update(
    ACTOR_ID,
    {
      expected_revision: 0,
      enabled: true,
      provider,
      ...(baseUrl ? { base_url: baseUrl } : {}),
      provider_options:
        provider === "alibaba_bailian"
          ? { workspace_id: "dashscope-workspace", region: "cn-beijing" }
          : { workspace_id: null, region: null },
      api_key: `${provider}-secret`,
      model,
      price_per_image: "0.25",
    },
    {},
  )
  database.setActiveTurn({
    id: TURN_ID,
    conversationId: CONVERSATION_ID,
    ownerId: USER_ID,
  })
  return { service, recorder }
}

function requestJsonBody(fetchMock: ReturnType<typeof vi.fn>): unknown {
  const [, init] = fetchMock.mock.calls[0]! as unknown as [
    string | URL,
    RequestInit,
  ]
  return JSON.parse(String(init.body)) as unknown
}

function usageRecorder(): ModelUsageRecorder {
  return {
    recordModelUsage: vi.fn(async () => ({
      recorded: true,
      usage_id: "00000000-0000-4000-8000-0000000000c1",
    })),
  }
}

async function testRgbaPng(
  background: readonly [number, number, number, number],
  foreground: readonly [number, number, number, number],
): Promise<Buffer> {
  const width = 32
  const height = 32
  const pixels = Buffer.alloc(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const color =
        x >= 8 && x < 24 && y >= 8 && y < 24 ? foreground : background
      const offset = (y * width + x) * 4
      pixels[offset] = color[0]
      pixels[offset + 1] = color[1]
      pixels[offset + 2] = color[2]
      pixels[offset + 3] = color[3]
    }
  }
  return sharp(pixels, { raw: { width, height, channels: 4 } })
    .png()
    .toBuffer()
}

function inMemoryDatabase(initialSettings: Record<string, unknown> = {}): {
  prisma: PrismaClient
  settingsJson: () => Record<string, unknown>
  setActiveTurn: (turn: {
    id: string
    conversationId: string
    ownerId: string
  }) => void
} {
  let settingsJson: Record<string, unknown> = initialSettings
  let activeTurn:
    | { id: string; conversationId: string; ownerId: string }
    | null = null
  const prisma = {
    $transaction: vi.fn(async (callback) => callback(prisma)),
    $executeRaw: vi.fn(async () => 1),
    systemSetting: {
      findUnique: vi.fn(async () => ({ settingsJson })),
      upsert: vi.fn(async ({ create, update }) => {
        settingsJson = (update?.settingsJson ?? create.settingsJson) as Record<
          string,
          unknown
        >
        return { id: create.id, settingsJson }
      }),
    },
    auditLog: {
      create: vi.fn(async ({ data }) => ({ id: "audit", ...data })),
    },
    conversationTurn: {
      findFirst: vi.fn(async ({ where }) =>
        activeTurn &&
        where.id === activeTurn.id &&
        where.conversationId === activeTurn.conversationId &&
        where.submittedBy === activeTurn.ownerId &&
        where.status === "running"
          ? { id: activeTurn.id }
          : null,
      ),
    },
  } as unknown as PrismaClient
  return {
    prisma,
    settingsJson: () => settingsJson,
    setActiveTurn: (turn) => {
      activeTurn = turn
    },
  }
}

function providerGenerationResponse(provider: ImageGenerationProvider): Response {
  if (provider === "stability") {
    return new Response(ONE_PIXEL_PNG, { headers: { "content-type": "image/png" } })
  }
  const image = { b64_json: ONE_PIXEL_PNG.toString("base64") }
  const body = provider === "google_gemini"
    ? { candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: image.b64_json } }] } }] }
    : provider === "replicate"
      ? { status: "succeeded", output: [image] }
      : { data: [image] }
  return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } })
}
