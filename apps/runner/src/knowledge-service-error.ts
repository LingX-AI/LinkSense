import type {
  KnowledgeDocumentToolFailure,
} from "@linksense/shared"

export type KnowledgeDocumentToolErrorCode =
  KnowledgeDocumentToolFailure["code"]

export class KnowledgeServiceRequestError extends Error {
  constructor(
    readonly code: KnowledgeDocumentToolErrorCode,
    readonly retryable: boolean,
    readonly statusCode: number,
  ) {
    super(code)
    this.name = "KnowledgeServiceRequestError"
  }
}

export function knowledgeServiceErrorFromApi(
  operation: "list" | "markdown",
  statusCode: number,
  responseBody: unknown,
): KnowledgeServiceRequestError {
  const value = asRecord(responseBody)
  const apiCode = typeof value.error_code === "string" ? value.error_code : null
  if (apiCode === "KNOWLEDGE_NO_AVAILABLE_BASES") {
    return new KnowledgeServiceRequestError(
      "KNOWLEDGE_NO_AVAILABLE_BASES",
      false,
      409,
    )
  }
  if (apiCode === "VALIDATION_ERROR") {
    return new KnowledgeServiceRequestError(
      operation === "list"
        ? "KNOWLEDGE_DOCUMENT_LIST_INVALID"
        : "KNOWLEDGE_DOCUMENT_MARKDOWN_INVALID",
      false,
      400,
    )
  }
  if (
    apiCode === "AUTH_REQUIRED" ||
    apiCode === "FORBIDDEN" ||
    apiCode === "ACCESS_DENIED" ||
    apiCode === "KNOWLEDGE_BASE_NOT_FOUND" ||
    apiCode === "KNOWLEDGE_BASE_ACCESS_DENIED" ||
    apiCode === "KNOWLEDGE_BASE_DISABLED"
  ) {
    return new KnowledgeServiceRequestError(
      operation === "list"
        ? "KNOWLEDGE_DOCUMENT_LIST_FORBIDDEN"
        : "KNOWLEDGE_DOCUMENT_MARKDOWN_FORBIDDEN",
      false,
      403,
    )
  }
  if (
    operation === "markdown" &&
    apiCode === "KNOWLEDGE_DOCUMENT_NOT_FOUND"
  ) {
    return new KnowledgeServiceRequestError(
      "KNOWLEDGE_DOCUMENT_MARKDOWN_NOT_FOUND",
      false,
      404,
    )
  }
  return new KnowledgeServiceRequestError(
    operation === "list"
      ? "KNOWLEDGE_DOCUMENT_LIST_UNAVAILABLE"
      : "KNOWLEDGE_DOCUMENT_MARKDOWN_UNAVAILABLE",
    statusCode >= 500,
    statusCode >= 500 ? 503 : 400,
  )
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}
