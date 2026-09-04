import type { FastifyPluginAsync } from "fastify"
import {
  VOICE_TRANSCRIPTION_REQUEST_BODY_LIMIT_BYTES,
  voiceTranscriptionAvailabilitySchema,
  voiceTranscriptionRequestSchema,
  type Locale,
  type VoiceTranscriptionAvailability,
} from "@linksense/shared"

import { AppError, errorDetails } from "../../lib/errors.js"
import { errorEnvelope, ok } from "../../lib/http.js"
import { resolveLocale } from "../../lib/locale.js"
import { sendVoiceTranscription } from "./http.js"
import type { VoiceTranscription } from "./service.js"

type VoiceTranscriptionRoutesOptions = {
  service: VoiceTranscription
  availability: {
    getAvailability(): Promise<VoiceTranscriptionAvailability>
  }
  rateLimits: {
    assertAllowed(userId: string): Promise<void>
  }
  tokenLimits: {
    assertCanStartTask(userId: string): Promise<void>
  }
  defaultLocale: Locale
}

export const voiceTranscriptionRoutes: FastifyPluginAsync<
  VoiceTranscriptionRoutesOptions
> = async (
  app,
  { service, availability, rateLimits, tokenLimits, defaultLocale },
) => {
  app.setErrorHandler((error, request, reply) => {
    if (
      error instanceof AppError &&
      error.code === "VOICE_TRANSCRIPTION_RATE_LIMITED"
    ) {
      const locale = resolveLocale(
        request,
        request.authUser?.preferredLocale,
        defaultLocale,
      )
      const details = errorDetails(error.code, locale)
      const retryAfterSeconds = Number(error.params?.retry_after_seconds)
      if (Number.isSafeInteger(retryAfterSeconds) && retryAfterSeconds > 0) {
        reply.header("retry-after", String(retryAfterSeconds))
      }
      return reply
        .code(details.status)
        .send(
          errorEnvelope(
            error.code,
            details.messageKey,
            details.message,
            error.params,
            request.id,
          ),
        )
    }
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

  app.get(
    "/transcriptions/status",
    { preHandler: app.authenticate },
    async (request, reply) => {
      if (!request.authUser?.id) throw new AppError("AUTH_REQUIRED")
      return reply.send(
        ok(
          voiceTranscriptionAvailabilitySchema.parse(
          await availability.getAvailability(),
          ),
          request,
        ),
      )
    },
  )

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
      await rateLimits.assertAllowed(userId)
      return sendVoiceTranscription({
        request,
        reply,
        body,
        service,
        defaultLocale,
        preferredLocale: request.authUser?.preferredLocale ?? null,
      })
    },
  )
}

function isBodyTooLargeError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "FST_ERR_CTP_BODY_TOO_LARGE"
  )
}
