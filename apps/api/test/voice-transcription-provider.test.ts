import { supportedLocales } from "@linksense/shared"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  createVoiceTranscriptionRunner,
  type VoiceTranscriptionRuntime,
} from "../src/adapters/voice-transcription-provider.js"
import { VoiceAudioNormalizationError } from "../src/adapters/voice-audio-normalizer.js"

const runtime: VoiceTranscriptionRuntime = {
  provider: "openai_compatible",
  providerOptions: { api_version: null },
  baseUrl: "https://speech.example.test/v1/",
  apiKey: "test-transcription-key",
  model: "Qwen3-ASR-1.7B",
}
const input = { audioDataUrl: "data:audio/webm;base64,AQIDBA==" }
const wave = Buffer.from("normalized audio")

afterEach(() => vi.useRealTimers())

describe("voice transcription runtime", () => {
  it.each(["Qwen3-ASR-1.7B", "whisper-1"])("uses JSON without timestamps for %s and preserves the configured gateway", async (model) => {
    const normalize = vi.fn(async () => wave)
    const fetchMock = vi.fn(async (...request: [string | URL | Request, RequestInit?]) => {
      void request
      return Response.json({ text: "  识别结果  ", usage: { seconds: 1 } })
    })
    const runner = createVoiceTranscriptionRunner(fetchMock, normalize)
    await expect(runner({ ...runtime, model }, input)).resolves.toBe("识别结果")
    expect(normalize).toHaveBeenCalledWith(expect.objectContaining(input))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe("https://speech.example.test/v1/audio/transcriptions")
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer test-transcription-key")
    const form = getForm(init)
    expect([...form.keys()].sort()).toEqual(["file", "model", "response_format"])
    expect(form.get("model")).toBe(model)
    expect(form.get("response_format")).toBe("json")
  })

  it.each(supportedLocales)("passes the ISO language code for %s", async (language) => {
    const fetchMock = vi.fn(async (...request: [string | URL | Request, RequestInit?]) => {
      void request
      return Response.json({ text: "recognized" })
    })
    await createVoiceTranscriptionRunner(fetchMock, async () => wave)(runtime, { ...input, language })
    expect(getForm(fetchMock.mock.calls[0]![1]).get("language")).toBe(language.split("-")[0])
  })

  it.each([401, 403, 429, 500])("does not retry or expose upstream content on HTTP %s", async (status) => {
    const fetchMock = vi.fn(async () => new Response("private provider details", { status }))
    const runner = createVoiceTranscriptionRunner(fetchMock, async () => wave)
    await expect(runner(runtime, input)).rejects.toMatchObject({ reason: "upstream", message: "voice_transcription_upstream" })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it.each(["not JSON", JSON.stringify({ result: "missing text" }), JSON.stringify({ text: 42 }), "x".repeat(256 * 1024 + 1)])("rejects malformed or oversized upstream responses", async (body) => {
    const fetchMock = vi.fn(async () => new Response(body))
    await expect(createVoiceTranscriptionRunner(fetchMock, async () => wave)(runtime, input)).rejects.toMatchObject({ reason: "upstream" })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("keeps empty transcription available to the existing no-content handler", async () => {
    const fetchMock = vi.fn(async () => Response.json({ text: "   " }))
    await expect(createVoiceTranscriptionRunner(fetchMock, async () => wave)(runtime, input)).resolves.toBe("")
  })

  it.each(["invalid_audio", "unavailable", "too_long", "busy"] as const)("does not contact a provider when normalization fails: %s", async (reason) => {
    const fetchMock = vi.fn()
    const runner = createVoiceTranscriptionRunner(fetchMock, async () => { throw new VoiceAudioNormalizationError(reason) })
    await expect(runner(runtime, input)).rejects.toMatchObject({ reason: "upstream" })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("maps a conversion timeout to the existing transcription timeout", async () => {
    const fetchMock = vi.fn()
    const runner = createVoiceTranscriptionRunner(fetchMock, async () => { throw new VoiceAudioNormalizationError("timeout") })
    await expect(runner(runtime, input)).rejects.toMatchObject({ reason: "timeout" })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("does not normalize or send already cancelled requests", async () => {
    const fetchMock = vi.fn()
    const normalize = vi.fn(async () => wave)
    await expect(createVoiceTranscriptionRunner(fetchMock, normalize)(runtime, { ...input, signal: AbortSignal.abort() })).rejects.toMatchObject({ reason: "aborted" })
    expect(normalize).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("applies the same 30-second deadline to conversion and provider execution", async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn()
    const normalize = vi.fn(async ({ signal }: { signal?: AbortSignal }) => {
      if (!signal) throw new Error("missing cancellation signal")
      await new Promise<void>((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true }))
      return wave
    })
    const assertion = expect(createVoiceTranscriptionRunner(fetchMock, normalize)(runtime, input)).rejects.toMatchObject({ reason: "timeout" })
    await vi.advanceTimersByTimeAsync(30_000)
    await assertion
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("preserves DashScope's native protocol while submitting normalized WAV", async () => {
    const fetchMock = vi.fn(async (...request: [string | URL | Request, RequestInit?]) => {
      void request
      return new Response('data: {"choices":[{"delta":{"content":"recognized"}}]}\n\ndata: [DONE]\n\n')
    })
    const runner = createVoiceTranscriptionRunner(fetchMock, async () => wave)
    await expect(runner({ ...runtime, provider: "dashscope" }, input)).resolves.toBe("recognized")
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe("https://speech.example.test/v1/chat/completions")
    expect(JSON.parse(String(init?.body))).toMatchObject({
      stream: true,
      messages: [{ role: "user", content: [{ type: "input_audio", input_audio: { data: `data:audio/wav;base64,${wave.toString("base64")}` } }] }],
    })
  })
})

function getForm(init?: RequestInit): FormData {
  if (!(init?.body instanceof FormData)) throw new Error("expected multipart audio request")
  return init.body
}
