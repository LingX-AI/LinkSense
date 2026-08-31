export type KnowledgeProcessingErrorCode =
  | "KNOWLEDGE_PROCESSING_CANCELLED"
  | "KNOWLEDGE_EXTERNAL_SERVICE_UNAVAILABLE"
  | "KNOWLEDGE_EXTERNAL_SERVICE_AUTHENTICATION_FAILED"
  | "KNOWLEDGE_EXTERNAL_RESPONSE_INVALID"
  | "KNOWLEDGE_DOCLING_CONTRACT_INCOMPATIBLE"
  | "KNOWLEDGE_DOCLING_CHUNKER_UNAVAILABLE"
  | "KNOWLEDGE_DOCLING_TASK_NOT_FOUND"
  | "KNOWLEDGE_DOCLING_RESULT_INVALID"
  | "KNOWLEDGE_DOCLING_RESULT_UNSAFE"
  | "KNOWLEDGE_OFFICE_CONVERSION_FAILED"
  | "KNOWLEDGE_OFFICE_CONVERTER_UNAVAILABLE"
  | "KNOWLEDGE_DOCUMENT_STRUCTURE_INVALID"
  | "KNOWLEDGE_DOCUMENT_COVERAGE_INVALID"
  | "KNOWLEDGE_IMAGE_POSITION_INVALID"
  | "KNOWLEDGE_IMAGE_MODEL_NOT_FOUND"
  | "KNOWLEDGE_IMAGE_MODEL_CONFIGURATION_CHANGED"
  | "KNOWLEDGE_IMAGE_MODEL_OUTPUT_INVALID"
  | "KNOWLEDGE_IMAGE_MODEL_THINKING_NOT_DISABLED"
  | "KNOWLEDGE_IMAGE_MODEL_UNAVAILABLE"
  | "KNOWLEDGE_DOCUMENT_BUSY"
  | "KNOWLEDGE_STORAGE_QUOTA_EXCEEDED"
  | "KNOWLEDGE_EMBEDDING_RESPONSE_INVALID"
  | "KNOWLEDGE_EMBEDDING_CONFIGURATION_CHANGED"
  | "EMBEDDING_INPUT_TOO_LARGE"
  | "EMBEDDING_DIMENSION_MISMATCH"
  | "KNOWLEDGE_RETRIEVAL_PARAMETERS_INVALID"
  | "KNOWLEDGE_ELASTICSEARCH_CONTRACT_INCOMPATIBLE"
  | "KNOWLEDGE_ELASTICSEARCH_OPERATION_FAILED"
  | "KNOWLEDGE_RERANK_RESPONSE_INVALID"
  | "KNOWLEDGE_OBJECT_STORAGE_UNAVAILABLE";

export type KnowledgeProcessingErrorOptions = {
  retryable?: boolean;
  cause?: unknown;
};

/**
 * Stable, deliberately content-free error crossing the processing boundary.
 * Third-party response bodies and endpoints must stay in restricted diagnostics.
 */
export class KnowledgeProcessingError extends Error {
  readonly code: KnowledgeProcessingErrorCode;
  readonly retryable: boolean;

  constructor(
    code: KnowledgeProcessingErrorCode,
    options: KnowledgeProcessingErrorOptions = {},
  ) {
    super(code, { cause: options.cause });
    this.name = "KnowledgeProcessingError";
    this.code = code;
    this.retryable = options.retryable ?? false;
  }
}

export function isKnowledgeProcessingError(
  value: unknown,
): value is KnowledgeProcessingError {
  return value instanceof KnowledgeProcessingError;
}

export function toKnowledgeProcessingError(
  value: unknown,
  fallback: KnowledgeProcessingErrorCode,
  retryable = false,
): KnowledgeProcessingError {
  if (isKnowledgeProcessingError(value)) return value;
  return new KnowledgeProcessingError(fallback, {
    cause: value,
    retryable,
  });
}
