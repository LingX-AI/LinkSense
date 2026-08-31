import type { ErrorCode, JsonValue, Locale } from "@linksense/shared"
import { getErrorCatalogEntry } from "@linksense/shared"
import { ZodError } from "zod"

import { translateError } from "./i18n.js"

export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly params?: Record<string, JsonValue>,
    readonly statusOverride?: number,
  ) {
    super(code)
    this.name = "AppError"
  }
}

export function errorDetails(code: ErrorCode, locale: Locale) {
  const entry = getErrorCatalogEntry(code)
  return {
    status: entry.http_status,
    messageKey: entry.message_key,
    message: translateError(code, locale),
  }
}

export function normalizeError(error: unknown): AppError {
  if (error instanceof AppError) return error
  if (error instanceof ZodError) return new AppError("VALIDATION_ERROR")
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "FST_ERR_CTP_BODY_TOO_LARGE"
  ) {
    return new AppError("VALIDATION_ERROR", undefined, 413)
  }
  return new AppError("INTERNAL_ERROR")
}
