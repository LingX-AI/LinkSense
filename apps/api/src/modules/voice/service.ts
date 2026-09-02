import type { Locale } from "@linksense/shared"

import { DashScopeAsrError } from "../../adapters/dashscope-asr.js"
import { AppError } from "../../lib/errors.js"

export type VoiceTranscriptionInput = {
  audioDataUrl: string
  language?: Locale
  signal?: AbortSignal
}

export interface VoiceTranscription {
  stream(input: VoiceTranscriptionInput): AsyncIterable<string>
  transcribe(input: VoiceTranscriptionInput): Promise<string>
}

export interface VoiceTranscriptionProvider {
  streamTranscription(input: VoiceTranscriptionInput): AsyncIterable<string>
}

export interface VoiceTranscriptionRateLimitStore {
  takeVoiceTranscriptionRequest(
    userId: string,
  ): Promise<{ allowed: boolean; retryAfterSeconds: number }>
  takeApplicationEmbedVoiceTranscriptionRequest(
    sessionId: string,
  ): Promise<{ allowed: boolean; retryAfterSeconds: number }>
}

export class VoiceTranscriptionRateLimiter {
  constructor(private readonly store: VoiceTranscriptionRateLimitStore) {}

  async assertAllowed(userId: string): Promise<void> {
    const admission = await this.store.takeVoiceTranscriptionRequest(userId)
    if (admission.allowed) return
    throw new AppError("VOICE_TRANSCRIPTION_RATE_LIMITED", {
      retry_after_seconds: admission.retryAfterSeconds,
    })
  }

  async assertApplicationEmbedSessionAllowed(sessionId: string): Promise<void> {
    const admission =
      await this.store.takeApplicationEmbedVoiceTranscriptionRequest(sessionId)
    if (admission.allowed) return
    throw new AppError("VOICE_TRANSCRIPTION_RATE_LIMITED", {
      retry_after_seconds: admission.retryAfterSeconds,
    })
  }
}

export class VoiceTranscriptionService implements VoiceTranscription {
  constructor(private readonly client: VoiceTranscriptionProvider) {}

  async *stream(input: VoiceTranscriptionInput): AsyncGenerator<string> {
    try {
      for await (const delta of this.client.streamTranscription(input)) {
        if (delta) yield delta
      }
    } catch (error) {
      throw mapTranscriptionError(error)
    }
  }

  async transcribe(input: VoiceTranscriptionInput): Promise<string> {
    let transcript = ""
    for await (const delta of this.stream(input)) transcript += delta
    const text = transcript.trim()
    if (!text) throw new AppError("VOICE_TRANSCRIPTION_FAILED", undefined, 502)
    return text
  }
}

function mapTranscriptionError(error: unknown) {
  if (!(error instanceof DashScopeAsrError)) {
    return new AppError("VOICE_TRANSCRIPTION_FAILED", undefined, 502)
  }

  if (error.reason === "not_configured") {
    return new AppError("VOICE_TRANSCRIPTION_FAILED", undefined, 503)
  }
  if (error.reason === "timeout") {
    return new AppError("VOICE_TRANSCRIPTION_FAILED", undefined, 504)
  }
  return new AppError("VOICE_TRANSCRIPTION_FAILED", undefined, 502)
}
