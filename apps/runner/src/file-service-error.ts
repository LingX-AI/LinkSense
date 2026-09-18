const SAFE_API_ERROR_CODES = new Set([
  "WEB_SITE_BUNDLE_INVALID",
  "WEB_SITE_RESOURCES_MISSING",
  "ARTIFACT_NOT_FOUND",
  "ARTIFACT_REGISTRATION_INVALID",
  "CONFLICT",
  "FILE_LIMIT_EXCEEDED",
  "FORBIDDEN",
  "INTERNAL_ERROR",
])

export type FileServiceErrorCode =
  | "WEB_SITE_BUNDLE_INVALID"
  | "WEB_SITE_RESOURCES_MISSING"
  | "ARTIFACT_NOT_FOUND"
  | "ARTIFACT_REGISTRATION_BUSY"
  | "ARTIFACT_REGISTRATION_FAILED"
  | "ARTIFACT_REGISTRATION_INVALID"
  | "ARTIFACT_REGISTRATION_UNAVAILABLE"
  | "FILE_LIMIT_EXCEEDED"
  | "FILE_SERVICE_FORBIDDEN"
  | "FILE_SERVICE_TURN_INACTIVE"

export class FileServiceRequestError extends Error {
  constructor(
    readonly code: FileServiceErrorCode,
    readonly retryable: boolean,
    readonly statusCode: number,
  ) {
    super(code)
    this.name = "FileServiceRequestError"
  }
}

export function fileServiceErrorFromApi(
  statusCode: number,
  responseBody: unknown,
): FileServiceRequestError {
  const value = asRecord(responseBody)
  const apiCode =
    typeof value.error_code === "string" &&
    SAFE_API_ERROR_CODES.has(value.error_code)
      ? value.error_code
      : null

  switch (apiCode) {
    case "WEB_SITE_BUNDLE_INVALID":
    case "WEB_SITE_RESOURCES_MISSING":
      return new FileServiceRequestError(apiCode, false, 422)
    case "ARTIFACT_NOT_FOUND":
      return new FileServiceRequestError("ARTIFACT_NOT_FOUND", false, 404)
    case "ARTIFACT_REGISTRATION_INVALID":
      return new FileServiceRequestError(
        "ARTIFACT_REGISTRATION_INVALID",
        false,
        400,
      )
    case "FILE_LIMIT_EXCEEDED":
      return new FileServiceRequestError("FILE_LIMIT_EXCEEDED", false, 413)
    case "FORBIDDEN":
      return new FileServiceRequestError(
        "FILE_SERVICE_TURN_INACTIVE",
        false,
        409,
      )
    case "CONFLICT":
      return new FileServiceRequestError(
        "ARTIFACT_REGISTRATION_BUSY",
        true,
        409,
      )
    case "INTERNAL_ERROR":
      return new FileServiceRequestError(
        "ARTIFACT_REGISTRATION_UNAVAILABLE",
        true,
        503,
      )
    default:
      return new FileServiceRequestError(
        statusCode >= 500
          ? "ARTIFACT_REGISTRATION_UNAVAILABLE"
          : "ARTIFACT_REGISTRATION_FAILED",
        statusCode >= 500,
        statusCode >= 500 ? 503 : 400,
      )
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}
