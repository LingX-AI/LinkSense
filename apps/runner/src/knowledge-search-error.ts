export type KnowledgeSearchErrorCode =
  | "KNOWLEDGE_SEARCH_INVALID"
  | "KNOWLEDGE_SEARCH_FORBIDDEN"
  | "KNOWLEDGE_SEARCH_UNAVAILABLE"
  | "KNOWLEDGE_NO_AVAILABLE_BASES"

export class KnowledgeSearchRequestError extends Error {
  constructor(
    readonly code: KnowledgeSearchErrorCode,
    readonly retryable: boolean,
    readonly statusCode: number,
  ) {
    super(code)
    this.name = "KnowledgeSearchRequestError"
  }
}

export function knowledgeSearchErrorFromApi(
  statusCode: number,
  responseBody: unknown,
): KnowledgeSearchRequestError {
  const value = asRecord(responseBody)
  const apiCode = typeof value.error_code === "string" ? value.error_code : null
  switch (apiCode) {
    case "VALIDATION_ERROR":
      return new KnowledgeSearchRequestError(
        "KNOWLEDGE_SEARCH_INVALID",
        false,
        400,
      )
    case "AUTH_REQUIRED":
    case "FORBIDDEN":
    case "ACCESS_DENIED":
      return new KnowledgeSearchRequestError(
        "KNOWLEDGE_SEARCH_FORBIDDEN",
        false,
        403,
      )
    case "KNOWLEDGE_NO_AVAILABLE_BASES":
      return new KnowledgeSearchRequestError(
        "KNOWLEDGE_NO_AVAILABLE_BASES",
        false,
        409,
      )
    default:
      return new KnowledgeSearchRequestError(
        "KNOWLEDGE_SEARCH_UNAVAILABLE",
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
