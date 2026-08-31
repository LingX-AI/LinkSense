import type { FastifyReply, FastifyRequest } from "fastify"

import type { JsonValue, Locale } from "@linksense/shared"

import { AppError, errorDetails, normalizeError } from "./errors.js"
import { resolveLocale } from "./locale.js"

export function ok<T>(data: T, request?: FastifyRequest | string) {
  const requestId = typeof request === "string" ? request : request?.id
  return {
    success: true as const,
    data,
    ...(requestId ? { request_id: requestId } : {}),
  }
}

export function accepted<T>(data: T, request?: FastifyRequest) {
  return ok(data, request)
}

export function errorEnvelope(
  errorCode: string,
  messageKey: string,
  message: string,
  params?: Record<string, JsonValue>,
  requestId?: string,
) {
  return {
    success: false as const,
    error_code: errorCode,
    message_key: messageKey,
    message,
    ...(params ? { params } : {}),
    ...(requestId ? { request_id: requestId } : {}),
  }
}

export function sendAppError(
  reply: FastifyReply,
  request: FastifyRequest,
  error: unknown,
  preferredLocale?: string | null,
) {
  const appError = normalizeError(error)
  const locale: Locale = resolveLocale(request, preferredLocale)
  const details = errorDetails(appError.code, locale)
  return reply.code(appError.statusOverride ?? details.status).send({
    success: false,
    error_code: appError.code,
    message_key: details.messageKey,
    message: details.message,
    ...(appError.params ? { params: appError.params as Record<string, JsonValue> } : {}),
    request_id: request.id,
  })
}

export function assertNever(value: never): never {
  throw new AppError("INTERNAL_ERROR", { value: String(value) })
}
