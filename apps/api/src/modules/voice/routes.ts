import { Readable } from "node:stream"

import type { FastifyPluginAsync } from "fastify"
import {
  VOICE_TRANSCRIPTION_REQUEST_BODY_LIMIT_BYTES,
  voiceTranscriptionRequestSchema,
  type Locale,
  type VoiceTranscriptionStreamEvent,
} from "@linksense/shared"

import { AppError, errorDetails } from "../../lib/errors.js"
import { errorEnvelope, ok } from "../../lib/http.js"
import { resolveLocale } from "../../lib/locale.js"
import type { VoiceTranscription } from "./service.js"

type VoiceTranscriptionRoutesOptions = {
  service: VoiceTranscription
  tokenLimits: {
    assertCanStartTask(userId: string): Promise<void>
  }
  defaultLocale: Locale
}

export const voiceTranscriptionRoutes: FastifyPluginAsync<
  VoiceTranscriptionRoutesOptions
> = async (app, { service, tokenLimits, defaultLocale }) => {
  app.setErrorHandler((error, request, reply) => {
    if (!isBodyTooLargeError(error)) throw error

    const locale = resolveLocale(
      request,
      request.authUser?.preferredLocale,
      defaultLocale,
    )
    const details = errorDetails("VALIDATION_ERROR", locale)
    return reply
      .code(413)
      .send(
        errorEnvelope(
          "VALIDATION_ERROR",
          details.messageKey,
          details.message,
          undefined,
          request.id,
        ),
      )
  })

  app.post(
    "/transcriptions",
    {
      bodyLimit: VOICE_TRANSCRIPTION_REQUEST_BODY_LIMIT_BYTES,
      preHandler: app.authenticate,
    },
    async (request, reply) => {
      const userId = request.authUser?.id
      if (!userId) throw new AppError("AUTH_REQUIRED")
      await tokenLimits.assertCanStartTask(userId)

      const body = voiceTranscriptionRequestSchema.parse(request.body)
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
            yield encodeEvent({ type: "delta", text: delta })
          }

          const text = transcript.trim()
          if (!text) {
            throw new AppError("VOICE_TRANSCRIPTION_FAILED", undefined, 502)
          }
          yield encodeEvent({ type: "done", text })
        } catch {
          const locale = resolveLocale(
            request,
            request.authUser?.preferredLocale,
            defaultLocale,
          )
          const details = errorDetails("VOICE_TRANSCRIPTION_FAILED", locale)
          yield encodeEvent({
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
    },
  )
}

function encodeEvent(event: VoiceTranscriptionStreamEvent): string {
  return `${JSON.stringify(event)}\n`
}

function isBodyTooLargeError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "FST_ERR_CTP_BODY_TOO_LARGE"
  )
}
