import { Readable } from "node:stream"

import type { FastifyReply, FastifyRequest } from "fastify"
import {
  type Locale,
  type VoiceTranscriptionRequest,
  type VoiceTranscriptionStreamEvent,
} from "@linksense/shared"

import { AppError, errorDetails } from "../../lib/errors.js"
import { ok } from "../../lib/http.js"
import { resolveLocale } from "../../lib/locale.js"
import type { VoiceTranscription } from "./service.js"

type SendVoiceTranscriptionOptions = {
  request: FastifyRequest
  reply: FastifyReply
  body: VoiceTranscriptionRequest
  service: VoiceTranscription
  defaultLocale: Locale
  preferredLocale?: Locale | null
}

export async function sendVoiceTranscription({
  request,
  reply,
  body,
  service,
  defaultLocale,
  preferredLocale,
}: SendVoiceTranscriptionOptions) {
  const abortController = new AbortController()
  const abort = () => abortController.abort()
  request.raw.once("aborted", abort)
  reply.raw.once("close", abort)

  const input = {
    audioDataUrl: body.audio_data_url,
    ...(body.language ? { language: body.language } : {}),
    signal: abortController.signal,
  }

  if (!body.stream) {
    try {
      const text = await service.transcribe(input)
      return reply.send(ok({ text }, request))
    } finally {
      request.raw.off("aborted", abort)
      reply.raw.off("close", abort)
    }
  }

  const events = async function* () {
    let transcript = ""
    try {
      for await (const delta of service.stream(input)) {
        transcript += delta
        yield encodeVoiceTranscriptionEvent({ type: "delta", text: delta })
      }

      const text = transcript.trim()
      if (!text) {
        throw new AppError("VOICE_TRANSCRIPTION_FAILED", undefined, 502)
      }
      yield encodeVoiceTranscriptionEvent({ type: "done", text })
    } catch {
      const locale = resolveLocale(request, preferredLocale, defaultLocale)
      const details = errorDetails("VOICE_TRANSCRIPTION_FAILED", locale)
      yield encodeVoiceTranscriptionEvent({
        type: "error",
        error_code: "VOICE_TRANSCRIPTION_FAILED",
        message_key: "errors.composer.voiceTranscriptionFailed",
        message: details.message,
      })
    } finally {
      request.raw.off("aborted", abort)
      reply.raw.off("close", abort)
    }
  }

  return reply
    .headers({
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store, no-transform",
      "x-accel-buffering": "no",
    })
    .send(Readable.from(events()))
}

function encodeVoiceTranscriptionEvent(
  event: VoiceTranscriptionStreamEvent,
): string {
  return `${JSON.stringify(event)}\n`
}
