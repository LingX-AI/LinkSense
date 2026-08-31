const PACKAGE_ERROR_CODES = new Set([
  "INVALID_PACKAGE",
  "IMPORT_FAILED",
  "VALIDATION_ERROR",
])

export type SkillCreatorErrorCode =
  | "SKILL_PACKAGE_INVALID"
  | "SKILL_NAME_CONFLICT"
  | "SKILL_INSTALL_PREVIEW_INVALID"
  | "SKILL_INSTALL_CONFIRMATION_REQUIRED"
  | "SKILL_INSTALL_SYNC_FAILED"
  | "SKILL_CREATOR_FORBIDDEN"
  | "SKILL_CREATOR_TURN_INACTIVE"
  | "SKILL_CREATOR_UNAVAILABLE"

export class SkillCreatorRequestError extends Error {
  constructor(
    readonly code: SkillCreatorErrorCode,
    readonly retryable: boolean,
    readonly statusCode: number,
  ) {
    super(code)
    this.name = "SkillCreatorRequestError"
  }
}

export function skillCreatorErrorFromApi(
  statusCode: number,
  responseBody: unknown,
): SkillCreatorRequestError {
  const value = asRecord(responseBody)
  const apiCode = typeof value.error_code === "string" ? value.error_code : null
  if (apiCode && PACKAGE_ERROR_CODES.has(apiCode)) {
    return new SkillCreatorRequestError("SKILL_PACKAGE_INVALID", false, 400)
  }
  switch (apiCode) {
    case "CONFLICT":
      return new SkillCreatorRequestError("SKILL_NAME_CONFLICT", false, 409)
    case "SKILL_CREATOR_PREVIEW_INVALID":
      return new SkillCreatorRequestError(
        "SKILL_INSTALL_PREVIEW_INVALID",
        false,
        409,
      )
    case "SKILL_CREATOR_CONFIRMATION_REQUIRED":
      return new SkillCreatorRequestError(
        "SKILL_INSTALL_CONFIRMATION_REQUIRED",
        false,
        409,
      )
    case "CAPABILITY_HOME_SYNC_FAILED":
      return new SkillCreatorRequestError(
        "SKILL_INSTALL_SYNC_FAILED",
        true,
        503,
      )
    case "AUTH_REQUIRED":
    case "ACCESS_DENIED":
      return new SkillCreatorRequestError(
        "SKILL_CREATOR_FORBIDDEN",
        false,
        403,
      )
    case "FORBIDDEN":
      return new SkillCreatorRequestError(
        "SKILL_CREATOR_TURN_INACTIVE",
        false,
        409,
      )
    default:
      return new SkillCreatorRequestError(
        "SKILL_CREATOR_UNAVAILABLE",
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
