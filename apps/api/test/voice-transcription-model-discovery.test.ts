import { describe, expect, it, vi } from "vitest"

import type { PrismaClient } from "../src/generated/prisma/client.js"
import { encryptJson } from "../src/lib/crypto.js"
import { discoverVoiceTranscriptionModels } from "../src/modules/system/voice-transcription-model-discovery.js"
import { VoiceTranscriptionSettingsService } from "../src/modules/system/voice-transcription-settings.js"
import { testConfig } from "./test-config.js"

const draft = {
  provider: "openai_compatible",
  provider_options: { api_version: null },
  base_url: "https://speech.example.test/v1",
  api_key: "synthetic-voice-key",
} as const

describe("voice transcription model discovery", () => {
  it("fetches and deduplicates compatible models without exposing the key", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({ data: [{ id: "whisper-1" }, { id: "whisper-1" }, { id: "custom-asr" }] }),
    )
    const result = await discoverVoiceTranscriptionModels(draft, fetcher)
    expect(result.models.map((model) => model.id)).toEqual(["whisper-1", "custom-asr"])
    expect(String(fetcher.mock.calls[0]?.[0])).toBe(`${draft.base_url}/models`)
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
      redirect: "manual",
      headers: { authorization: `Bearer ${draft.api_key}` },
    })
    expect(JSON.stringify(result)).not.toContain(draft.api_key)
  })

  it("reads Deepgram's speech catalog using the configured endpoint", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        stt: [
          { name: "general", canonical_name: "nova-3-general", batch: true },
          { name: "general", canonical_name: "nova-3-general", batch: true },
          { name: "general", canonical_name: "streaming-only", batch: false },
        ],
        tts: [{ name: "aura" }],
      }),
    )
    const result = await discoverVoiceTranscriptionModels(
      { ...draft, provider: "deepgram", base_url: "https://speech.example.test/deepgram" },
      fetcher,
    )
    expect(result.models.map((model) => model.id)).toEqual(["nova-3-general"])
    expect(String(fetcher.mock.calls[0]?.[0])).toBe("https://speech.example.test/deepgram/v1/models")
    expect(fetcher.mock.calls[0]?.[1]?.headers).toMatchObject({ authorization: `Token ${draft.api_key}` })
  })

  it.each(["azure_openai", "assemblyai", "elevenlabs", "revai", "gladia", "fal"] as const)(
    "keeps %s manual when no compatible catalog is implemented",
    async (provider) => {
      const fetcher = vi.fn<typeof fetch>()
      await expect(discoverVoiceTranscriptionModels({ ...draft, provider }, fetcher)).resolves.toEqual({
        status: "manual_required", models: [], truncated: false,
      })
      expect(fetcher).not.toHaveBeenCalled()
    },
  )

  it.each([401, 403, 500, 302])("redacts HTTP %i failures", async (status) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(draft.api_key, { status }))
    await expect(discoverVoiceTranscriptionModels(draft, fetcher)).rejects.toMatchObject({
      code: "MODEL_PROVIDER_DISCOVERY_FAILED",
    })
  })

  it("keeps manual entry when the endpoint is absent and bounds malformed or oversized responses", async () => {
    const absent = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 404 }))
    await expect(discoverVoiceTranscriptionModels(draft, absent)).resolves.toEqual({
      status: "manual_required", models: [], truncated: false,
    })
    for (const response of [
      Response.json({ data: "invalid" }),
      new Response("x", { headers: { "content-length": "3000000" } }),
    ]) {
      await expect(discoverVoiceTranscriptionModels(draft, vi.fn<typeof fetch>().mockResolvedValue(response)))
        .rejects.toMatchObject({ code: "MODEL_PROVIDER_DISCOVERY_FAILED" })
    }
    const never = vi.fn<typeof fetch>().mockImplementation(() => new Promise<Response>(() => undefined))
    await expect(discoverVoiceTranscriptionModels(draft, never, AbortSignal.timeout(10)))
      .rejects.toMatchObject({ code: "MODEL_PROVIDER_DISCOVERY_FAILED" })
  })

  it("limits large catalog results and signals truncation", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({
      data: Array.from({ length: 101 }, (_, index) => ({ id: `speech-${index}` })),
    }))
    const result = await discoverVoiceTranscriptionModels(draft, fetcher)
    expect(result.models).toHaveLength(100)
    expect(result.truncated).toBe(true)
  })
})

describe("saved transcription discovery credentials", () => {
  function fixture(enabled = true, withoutModel = false) {
    const config = testConfig({ LINKSENSE_ADMIN_MODEL_MANAGEMENT_ENABLED: String(enabled) })
    const settingsJson = {
      voice_transcription_settings_key_id: config.credentialKeyId,
      voice_transcription_settings_encrypted: encryptJson({
        version: 1, revision: 1, enabled: !withoutModel, provider: "openai_compatible",
        providerOptions: { api_version: null }, baseUrl: draft.base_url,
        apiKey: "saved-voice-secret", model: withoutModel ? null : "whisper-1",
      }, config.credentialMasterKey, config.credentialKeyId, "linksense:voice-transcription-settings:v1"),
    }
    const findUnique = vi.fn().mockResolvedValue({ settingsJson })
    const prisma = { systemSetting: { findUnique } } as unknown as PrismaClient
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ data: [{ id: "whisper-1" }] }))
    return { service: new VoiceTranscriptionSettingsService(prisma, config, async () => "", fetcher), fetcher, findUnique }
  }

  it("discovers models using an existing disabled configuration without a selected model", async () => {
    const { service } = fixture(true, true)
    await expect(service.discover({
      provider: draft.provider,
      base_url: draft.base_url,
    })).resolves.toMatchObject({ models: [{ id: "whisper-1" }] })
  })

  it.each([draft.base_url, "https://SPEECH.example.test:443/v1/"])(
    "uses the saved key only for the matching provider and address %s",
    async (baseUrl) => {
      const { service, fetcher } = fixture()
      const savedDraft = { provider: draft.provider, base_url: baseUrl, provider_options: draft.provider_options }
      await expect(service.discover(savedDraft)).resolves.toMatchObject({ models: [{ id: "whisper-1" }] })
      expect(fetcher.mock.calls[0]?.[1]?.headers).toMatchObject({ authorization: "Bearer saved-voice-secret" })
      await expect(service.discover({ ...savedDraft, base_url: "https://other.example.test/v1" })).rejects.toMatchObject({
        code: "MODEL_PROVIDER_CREDENTIAL_REQUIRED",
      })
      expect(fetcher).toHaveBeenCalledTimes(1)
    },
  )

  it.each([
    { provider: "openai" as const },
    { provider_options: { api_version: "changed" } },
    { base_url: "https://speech.example.test/other" },
  ])("does not reuse a saved key after the connection changes: %j", async (change) => {
    const { service, fetcher } = fixture()
    const savedDraft = { provider: draft.provider, base_url: draft.base_url, provider_options: draft.provider_options }
    await expect(service.discover({ ...savedDraft, ...change })).rejects.toMatchObject({
      code: "MODEL_PROVIDER_CREDENTIAL_REQUIRED",
    })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it("uses a supplied replacement key without reading the stored configuration", async () => {
    const { service, fetcher, findUnique } = fixture()
    await service.discover({ ...draft, base_url: "https://other.example.test/v1" })
    expect(findUnique).not.toHaveBeenCalled()
    expect(fetcher.mock.calls[0]?.[1]?.headers).toMatchObject({ authorization: `Bearer ${draft.api_key}` })
  })

  it("does not read saved credentials when model management is disabled", async () => {
    const { service, findUnique } = fixture(false)
    await expect(service.discover(draft)).rejects.toMatchObject({ code: "MODEL_MANAGEMENT_DISABLED" })
    expect(findUnique).not.toHaveBeenCalled()
  })
})
