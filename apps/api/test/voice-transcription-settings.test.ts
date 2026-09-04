import { describe, expect, it, vi } from "vitest"

import type { PrismaClient } from "../src/generated/prisma/client.js"
import { createVoiceTranscriptionRunner } from "../src/adapters/voice-transcription-provider.js"
import { VoiceTranscriptionSettingsService } from "../src/modules/system/voice-transcription-settings.js"
import { testConfig } from "./test-config.js"

const ACTOR_ID = "00000000-0000-4000-8000-000000000099"
const AUDIO_DATA_URL = "data:audio/wav;base64,UklGRg=="

describe("VoiceTranscriptionSettingsService", () => {
  it("stores credentials encrypted and applies saved settings to later requests", async () => {
    const database = inMemoryDatabase()
    const runner = vi.fn(async () => "识别结果")
    const service = new VoiceTranscriptionSettingsService(
      database.prisma,
      testConfig(),
      runner,
    )

    await expect(service.getAdminSettings()).resolves.toMatchObject({
      configured: false,
      revision: 0,
      enabled: false,
      provider: null,
      base_url: null,
      api_key_configured: false,
      model: null,
      providers: expect.arrayContaining([
        expect.objectContaining({
          key: "dashscope",
          default_model: "qwen3-asr-flash",
        }),
        expect.objectContaining({
          key: "openai_compatible",
          default_model: "whisper-1",
        }),
        expect.objectContaining({ key: "deepgram", default_model: "nova-3" }),
      ]),
    })
    await expect(service.getAvailability()).resolves.toEqual({
      available: false,
    })

    const settings = await service.update(
      ACTOR_ID,
      {
        expected_revision: 0,
        enabled: true,
        provider: "openai_compatible",
        provider_options: { api_version: null },
        base_url: "https://speech.example.test/v1/",
        api_key: "speech-secret",
        model: "whisper-1",
      },
      { ipAddress: "127.0.0.1", userAgent: "vitest" },
    )

    expect(settings).toMatchObject({
      configured: true,
      revision: 1,
      enabled: true,
      provider: "openai_compatible",
      base_url: "https://speech.example.test/v1",
      api_key_configured: true,
      model: "whisper-1",
    })
    expect(JSON.stringify(settings)).not.toContain("speech-secret")
    expect(JSON.stringify(database.settingsJson())).not.toContain(
      "speech-secret",
    )
    await expect(service.getAvailability()).resolves.toEqual({
      available: true,
    })

    await expect(
      collect(service.streamTranscription({ audioDataUrl: AUDIO_DATA_URL })),
    ).resolves.toEqual(["识别结果"])
    expect(runner).toHaveBeenLastCalledWith(
      expect.objectContaining({
        provider: "openai_compatible",
        baseUrl: "https://speech.example.test/v1",
        apiKey: "speech-secret",
        model: "whisper-1",
      }),
      expect.objectContaining({ audioDataUrl: AUDIO_DATA_URL }),
    )

    await service.update(
      ACTOR_ID,
      {
        expected_revision: 1,
        enabled: true,
        provider: "groq",
        provider_options: { api_version: null },
        base_url: "https://groq.example.test/openai/v1",
        api_key: "groq-secret",
        model: "whisper-large-v3-turbo",
      },
      {},
    )
    await collect(service.streamTranscription({ audioDataUrl: AUDIO_DATA_URL }))
    expect(runner).toHaveBeenLastCalledWith(
      expect.objectContaining({
        provider: "groq",
        apiKey: "groq-secret",
        model: "whisper-large-v3-turbo",
      }),
      expect.any(Object),
    )
  })

  it("clears credentials when a disabled configuration switches provider", async () => {
    const database = inMemoryDatabase()
    const service = new VoiceTranscriptionSettingsService(
      database.prisma,
      testConfig(),
      async () => "unused",
    )
    await service.update(
      ACTOR_ID,
      {
        expected_revision: 0,
        enabled: true,
        provider: "openai",
        provider_options: { api_version: null },
        base_url: "https://api.openai.com/v1",
        api_key: "openai-secret",
        model: "gpt-4o-mini-transcribe",
      },
      {},
    )

    const switched = await service.update(
      ACTOR_ID,
      {
        expected_revision: 1,
        enabled: false,
        provider: "deepgram",
        provider_options: { api_version: null },
        base_url: "https://api.deepgram.com",
        model: "nova-3",
      },
      {},
    )
    expect(switched).toMatchObject({
      revision: 2,
      provider: "deepgram",
      configured: false,
      api_key_configured: false,
    })
    await expect(
      service.update(
        ACTOR_ID,
        {
          expected_revision: 2,
          enabled: true,
          provider: "deepgram",
          provider_options: { api_version: null },
          base_url: "https://api.deepgram.com",
          model: "nova-3",
        },
        {},
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" })
  })
})

describe("voice transcription provider adapter", () => {
  it("calls an OpenAI-compatible transcription endpoint without retrying", async () => {
    const fetchMock = vi.fn(
      async (...request: [string | URL | Request, RequestInit?]) => {
        void request
        return Response.json({ text: "LinkSense transcription" })
      },
    )
    const runner = createVoiceTranscriptionRunner(fetchMock)

    await expect(
      runner(
        {
          provider: "openai_compatible",
          providerOptions: { api_version: null },
          baseUrl: "https://speech.example.test/v1",
          apiKey: "compatible-secret",
          model: "whisper-1",
        },
        {
          audioDataUrl: AUDIO_DATA_URL,
          language: "en-US",
        },
      ),
    ).resolves.toBe("LinkSense transcription")

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(String(url)).toBe("https://speech.example.test/v1/audio/transcriptions")
    expect(new Headers(init?.headers).get("authorization")).toBe(
      "Bearer compatible-secret",
    )
    expect(init?.body).toBeInstanceOf(FormData)
    expect((init?.body as FormData).get("language")).toBe("en")
  })

  it("rewrites fixed provider endpoints to the administrator Base URL", async () => {
    const fetchMock = vi.fn(
      async (...request: [string | URL | Request, RequestInit?]) => {
        void request
        return Response.json({
          metadata: { duration: 1 },
          results: {
            channels: [
              {
                detected_language: "zh",
                alternatives: [
                  { transcript: "自定义地址", words: [] },
                ],
              },
            ],
          },
        })
      },
    )
    const runner = createVoiceTranscriptionRunner(fetchMock)

    await expect(
      runner(
        {
          provider: "deepgram",
          providerOptions: { api_version: null },
          baseUrl: "https://speech-gateway.example.test/deepgram",
          apiKey: "deepgram-secret",
          model: "nova-3",
        },
        { audioDataUrl: AUDIO_DATA_URL, language: "zh-CN" },
      ),
    ).resolves.toBe("自定义地址")

    const [requestUrl, init] = fetchMock.mock.calls[0]!
    const url = new URL(String(requestUrl))
    expect(url.origin + url.pathname).toBe(
      "https://speech-gateway.example.test/deepgram/v1/listen",
    )
    expect(url.searchParams.get("model")).toBe("nova-3")
    expect(url.searchParams.get("language")).toBe("zh")
    expect(new Headers(init?.headers).get("authorization")).toBe(
      "Token deepgram-secret",
    )
  })
})

async function collect(iterable: AsyncIterable<string>): Promise<string[]> {
  const values: string[] = []
  for await (const value of iterable) values.push(value)
  return values
}

function inMemoryDatabase(): {
  prisma: PrismaClient
  settingsJson: () => Record<string, unknown>
} {
  let settingsJson: Record<string, unknown> = {}
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
  } as unknown as PrismaClient
  return { prisma, settingsJson: () => settingsJson }
}
