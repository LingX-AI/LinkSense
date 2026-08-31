import type { CurrentUserInfoFailure } from "@linksense/shared"

export type CurrentUserInfoErrorCode = CurrentUserInfoFailure["code"]

export class CurrentUserInfoRequestError extends Error {
  constructor(
    readonly code: CurrentUserInfoErrorCode,
    readonly retryable: boolean,
    readonly statusCode: number,
  ) {
    super(code)
    this.name = "CurrentUserInfoRequestError"
  }
}

export function currentUserInfoErrorFromApi(
  statusCode: number,
  responseBody: unknown,
): CurrentUserInfoRequestError {
  const value = asRecord(responseBody)
  const apiCode = typeof value.error_code === "string" ? value.error_code : null
  if (
    apiCode === "AUTH_REQUIRED" ||
    apiCode === "FORBIDDEN" ||
    apiCode === "ACCESS_DENIED"
  ) {
    return new CurrentUserInfoRequestError(
      "CURRENT_USER_FORBIDDEN",
      false,
      403,
    )
  }
  if (apiCode === "VALIDATION_ERROR") {
    return new CurrentUserInfoRequestError("CURRENT_USER_INVALID", false, 400)
  }
  return new CurrentUserInfoRequestError(
    "CURRENT_USER_UNAVAILABLE",
    statusCode >= 500,
    statusCode >= 500 ? 503 : 400,
  )
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}
