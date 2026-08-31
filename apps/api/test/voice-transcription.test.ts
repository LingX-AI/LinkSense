import Fastify, { type FastifyRequest } from "fastify"
import cors from "@fastify/cors"
import {
  MAX_VOICE_AUDIO_DATA_URL_BYTES,
  VOICE_TRANSCRIPTION_REQUEST_BODY_LIMIT_BYTES,
  type Locale,
} from "@linksense/shared"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  DashScopeAsrClient,
  DashScopeAsrError,
} from "../src/adapters/dashscope-asr.js"
import { AppError } from "../src/lib/errors.js"
import { sendAppError } from "../src/lib/http.js"
import { voiceTranscriptionRoutes } from "../src/modules/voice/routes.js"
import {
  VoiceTranscriptionService,
  type VoiceTranscription,
  type VoiceTranscriptionInput,
} from "../src/modules/voice/service.js"

const AUDIO_DATA_URL = "data:audio/webm;codecs=opus;base64,UklGRg=="
const USER_ID = "10000000-0000-4000-8000-000000000001"
const apps: Array<ReturnType<typeof Fastify>> = []

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()))
})

describe("DashScope ASR adapter", () => {
  it.each([
    ["zh-CN", "zh"],
    ["en-US", "en"],
  ] as const)(
    "streams transcript deltas and maps %s to %s",
    async (locale, language) => {
      const fetchMock = vi.fn(
        async (...request: [string | URL | Request, RequestInit?]) => {
          void request
          return sseResponse([
            'data: {"choices":[{"delta":{"content":"Link"}}]}',
            'data: {"choices":[{"delta":{"content":"Sense"}}]}',
            "data: [DONE]",
          ])
        },
      )
      const client = dashScopeClient(fetchMock)

      await expect(
        collect(
          client.streamTranscription({
            audioDataUrl: AUDIO_DATA_URL,
            language: locale,
          }),
        ),
      ).resolves.toEqual(["Link", "Sense"])

      expect(fetchMock).toHaveBeenCalledWith(
        "https://dashscope.example.test/compatible-mode/v1/chat/completions",
        expect.objectContaining({
          method: "POST",
          headers: {
            Authorization: "Bearer dashscope-secret",
            "Content-Type": "application/json",
            Accept: "text/event-stream",
          },
        }),
      )
      const request = fetchMock.mock.calls[0]?.[1]
      const payload = JSON.parse(String(request?.body)) as Record<
        string,
        unknown
      >
      expect(payload).toMatchObject({
        model: "qwen3-asr-flash",
        stream: true,
        asr_options: { enable_itn: true, language },
        messages: [
          {
            role: "user",
            content: [
              {
                type: "input_audio",
                input_audio: { data: AUDIO_DATA_URL },
              },
            ],
          },
        ],
      })
    },
  )

  it("maps the 30-second boundary to a stable timeout without exposing fetch details", async () => {
    const fetchMock = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        rejectWhenAborted(init?.signal),
    )
    const client = dashScopeClient(fetchMock, 5)

    const error = await collect(
      client.streamTranscription({ audioDataUrl: AUDIO_DATA_URL }),
    ).then(
      () => undefined,
      (reason: unknown) => reason,
    )

    expect(error).toBeInstanceOf(DashScopeAsrError)
    expect(error).toMatchObject({ reason: "timeout" })
    expect((error as Error).message).toBe("dashscope_asr_timeout")
  })

  it("redacts an upstream response body from the adapter error", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response('{"error":{"message":"provider-secret-detail"}}', {
          status: 500,
        }),
    )
    const client = dashScopeClient(fetchMock)

    const error = await collect(
      client.streamTranscription({ audioDataUrl: AUDIO_DATA_URL }),
    ).then(
      () => undefined,
      (reason: unknown) => reason,
    )

    expect(error).toBeInstanceOf(DashScopeAsrError)
    expect(error).toMatchObject({ reason: "upstream" })
    expect(JSON.stringify(error)).not.toContain("provider-secret-detail")
    expect((error as Error).message).not.toContain("provider-secret-detail")
  })

  it("propagates caller cancellation to the upstream request", async () => {
    const fetchMock = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        rejectWhenAborted(init?.signal),
    )
    const client = dashScopeClient(fetchMock)
    const controller = new AbortController()
    const transcription = collect(
      client.streamTranscription({
        audioDataUrl: AUDIO_DATA_URL,
        signal: controller.signal,
      }),
    )

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    controller.abort()

    await expect(transcription).rejects.toMatchObject({ reason: "aborted" })
    expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(true)
  })
})

describe("voice transcription service", () => {
  it("maps provider timeouts to the stable API error and 504 status", async () => {
    const service = new VoiceTranscriptionService({
      async *streamTranscription() {
        yield* []
        throw new DashScopeAsrError("timeout")
      },
    })

    await expect(
      service.transcribe({ audioDataUrl: AUDIO_DATA_URL }),
    ).rejects.toMatchObject({
      code: "VOICE_TRANSCRIPTION_FAILED",
      statusOverride: 504,
    })
  })

  it("maps a missing provider key to a stable unavailable response", async () => {
    const service = new VoiceTranscriptionService({
      async *streamTranscription() {
        yield* []
        throw new DashScopeAsrError("not_configured")
      },
    })

    await expect(
      service.transcribe({ audioDataUrl: AUDIO_DATA_URL }),
    ).rejects.toMatchObject({
      code: "VOICE_TRANSCRIPTION_FAILED",
      statusOverride: 503,
    })
  })
})

describe("voice transcription route", () => {
  it("requires authentication before invoking the service", async () => {
    const { app, stream, transcribe, assertCanStartTask } =
      await voiceRouteFixture({
      authenticated: false,
      })

    const response = await app.inject({
      method: "POST",
      url: "/voice/transcriptions",
      payload: { audio_data_url: AUDIO_DATA_URL },
    })

    expect(response.statusCode).toBe(401)
    expect(response.json()).toMatchObject({ error_code: "AUTH_REQUIRED" })
    expect(assertCanStartTask).not.toHaveBeenCalled()
    expect(stream).not.toHaveBeenCalled()
    expect(transcribe).not.toHaveBeenCalled()
  })

  it("rejects exhausted token quota before invoking the service", async () => {
    const { app, stream, transcribe, assertCanStartTask } =
      await voiceRouteFixture({
        assertCanStartTask: async () => {
          throw new AppError("TOKEN_LIMIT_EXCEEDED")
        },
      })

    const response = await app.inject({
      method: "POST",
      url: "/voice/transcriptions",
      payload: { audio_data_url: AUDIO_DATA_URL },
    })

    expect(response.statusCode).toBe(429)
    expect(response.json()).toMatchObject({
      error_code: "TOKEN_LIMIT_EXCEEDED",
    })
    expect(assertCanStartTask).toHaveBeenCalledOnce()
    expect(assertCanStartTask).toHaveBeenCalledWith(USER_ID)
    expect(stream).not.toHaveBeenCalled()
    expect(transcribe).not.toHaveBeenCalled()
  })

  it("forwards stable NDJSON delta and done events", async () => {
    const { app, stream, assertCanStartTask } = await voiceRouteFixture({
      stream: async function* () {
        yield "Link"
        yield "Sense"
      },
    })

    const response = await app.inject({
      method: "POST",
      url: "/voice/transcriptions",
      headers: { origin: "https://web.example.test" },
      payload: {
        audio_data_url: AUDIO_DATA_URL,
        language: "zh-CN",
      },
    })

    expect(response.statusCode).toBe(200)
    expect(response.headers["content-type"]).toContain("application/x-ndjson")
    expect(response.headers["access-control-allow-origin"]).toBe(
      "https://web.example.test",
    )
    expect(assertCanStartTask).toHaveBeenCalledWith(USER_ID)
    expect(parseNdjson(response.body)).toEqual([
      { type: "delta", text: "Link" },
      { type: "delta", text: "Sense" },
      { type: "done", text: "LinkSense" },
    ])
    expect(stream).toHaveBeenCalledWith(
      expect.objectContaining({
        audioDataUrl: AUDIO_DATA_URL,
        language: "zh-CN",
        signal: expect.any(AbortSignal),
      }),
    )
  })

  it("returns a JSON success envelope when streaming is disabled", async () => {
    const { app, transcribe } = await voiceRouteFixture({
      transcribe: async () => "识别结果",
    })

    const response = await app.inject({
      method: "POST",
      url: "/voice/transcriptions",
      payload: {
        audio_data_url: AUDIO_DATA_URL,
        language: "zh-CN",
        stream: false,
      },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      success: true,
      data: { text: "识别结果" },
    })
    expect(transcribe).toHaveBeenCalledWith(
      expect.objectContaining({
        audioDataUrl: AUDIO_DATA_URL,
        language: "zh-CN",
      }),
    )
  })

  it("localizes and redacts an upstream stream failure", async () => {
    const { app } = await voiceRouteFixture({
      defaultLocale: "en-US",
      preferredLocale: null,
      stream: async function* () {
        yield* []
        throw new Error("provider-secret-detail")
      },
    })

    const response = await app.inject({
      method: "POST",
      url: "/voice/transcriptions",
      payload: { audio_data_url: AUDIO_DATA_URL },
    })

    expect(response.statusCode).toBe(200)
    expect(parseNdjson(response.body)).toEqual([
      {
        type: "error",
        error_code: "VOICE_TRANSCRIPTION_FAILED",
        message_key: "errors.composer.voiceTranscriptionFailed",
        message: "Speech-to-text failed. Try again or enter the text manually.",
      },
    ])
    expect(response.body).not.toContain("provider-secret-detail")
  })

  it("rejects unsupported audio and encoded Data URLs above 10 MiB", async () => {
    const { app, stream } = await voiceRouteFixture()

    const unsupported = await app.inject({
      method: "POST",
      url: "/voice/transcriptions",
      payload: { audio_data_url: "data:audio/unknown;base64,UklGRg==" },
    })
    const oversized = await app.inject({
      method: "POST",
      url: "/voice/transcriptions",
      payload: {
        audio_data_url: `data:audio/webm;base64,${"A".repeat(
          MAX_VOICE_AUDIO_DATA_URL_BYTES,
        )}`,
      },
    })

    expect(unsupported.statusCode).toBe(400)
    expect(unsupported.json()).toMatchObject({
      error_code: "VALIDATION_ERROR",
    })
    expect(oversized.statusCode).toBe(400)
    expect(oversized.json()).toMatchObject({ error_code: "VALIDATION_ERROR" })
    expect(stream).not.toHaveBeenCalled()
  })

  it("returns 413 before buffering a request above the voice route body limit", async () => {
    const { app, stream } = await voiceRouteFixture({ defaultLocale: "en-US" })

    const response = await app.inject({
      method: "POST",
      url: "/voice/transcriptions",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({
        audio_data_url: "A".repeat(
          VOICE_TRANSCRIPTION_REQUEST_BODY_LIMIT_BYTES,
        ),
      }),
    })

    expect(response.statusCode).toBe(413)
    expect(response.json()).toMatchObject({
      error_code: "VALIDATION_ERROR",
      message: "The request is invalid. Check the input and try again.",
    })
    expect(stream).not.toHaveBeenCalled()
  })
})

function dashScopeClient(
  fetchMock: ReturnType<typeof vi.fn>,
  timeoutMs = 1_000,
) {
  return new DashScopeAsrClient({
    apiKey: "dashscope-secret",
    baseUrl: "https://dashscope.example.test/compatible-mode/v1/",
    model: "qwen3-asr-flash",
    timeoutMs,
    fetchImpl: fetchMock as unknown as typeof fetch,
  })
}

function sseResponse(lines: string[]) {
  return new Response(`${lines.join("\n")}\n`, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  })
}

function rejectWhenAborted(signal?: AbortSignal | null): Promise<Response> {
  return new Promise((_resolve, reject) => {
    const rejectAbort = () =>
      reject(new DOMException("provider-secret-abort-detail", "AbortError"))
    if (signal?.aborted) rejectAbort()
    else signal?.addEventListener("abort", rejectAbort, { once: true })
  })
}

async function collect(iterable: AsyncIterable<string>): Promise<string[]> {
  const values: string[] = []
  for await (const value of iterable) values.push(value)
  return values
}

function parseNdjson(body: string): unknown[] {
  return body
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as unknown)
}

type VoiceRouteFixtureOptions = {
  authenticated?: boolean
  preferredLocale?: Locale | null
  defaultLocale?: Locale
  stream?: (input: VoiceTranscriptionInput) => AsyncIterable<string>
  transcribe?: (input: VoiceTranscriptionInput) => Promise<string>
  assertCanStartTask?: (userId: string) => Promise<void>
}

async function voiceRouteFixture(options: VoiceRouteFixtureOptions = {}) {
  const app = Fastify()
  apps.push(app)
  await app.register(cors, { origin: "https://web.example.test" })
  app.decorate("authenticate", async (request: FastifyRequest) => {
    if (options.authenticated === false) throw new AppError("AUTH_REQUIRED")
    request.authUser = {
      id: USER_ID,
      email: "member@example.test",
      name: "Member",
      role: "user",
      status: "active",
      preferredLocale: options.preferredLocale ?? null,
      avatarObjectKey: null,
      authValidAfter: new Date(0),
    }
  })
  app.setErrorHandler((error, request, reply) =>
    sendAppError(reply, request, error, request.authUser?.preferredLocale),
  )

  const stream = vi.fn(
    options.stream ??
      async function* () {
        yield "默认识别结果"
      },
  )
  const transcribe = vi.fn(options.transcribe ?? (async () => "默认识别结果"))
  const assertCanStartTask = vi.fn(
    options.assertCanStartTask ?? (async () => undefined),
  )
  const service: VoiceTranscription = { stream, transcribe }
  await app.register(voiceTranscriptionRoutes, {
    prefix: "/voice",
    service,
    tokenLimits: { assertCanStartTask },
    defaultLocale: options.defaultLocale ?? "zh-CN",
  })
  return { app, stream, transcribe, assertCanStartTask }
}
