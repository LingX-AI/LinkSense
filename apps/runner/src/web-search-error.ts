import { errorCatalog, webSearchFailureCodeSchema, type WebSearchFailure } from "@linksense/shared"

export class WebSearchRequestError extends Error {
  readonly statusCode: number
  readonly retryable: boolean
  constructor(readonly code: WebSearchFailure["code"]) {
    super(code)
    this.name = "WebSearchRequestError"
    this.statusCode = errorCatalog[code].http_status
    this.retryable = ["WEB_SEARCH_TIMEOUT", "WEB_SEARCH_RATE_LIMITED", "WEB_SEARCH_UNAVAILABLE"].includes(code)
  }
}

export function webSearchErrorFromApi(body: unknown): WebSearchRequestError {
  const value = body !== null && typeof body === "object" && "error_code" in body ? body.error_code : undefined
  const code = webSearchFailureCodeSchema.safeParse(value)
  return new WebSearchRequestError(code.success ? code.data : value === "VALIDATION_ERROR" ? "WEB_SEARCH_INVALID"
    : ["AUTH_REQUIRED", "FORBIDDEN", "ACCESS_DENIED"].includes(String(value)) ? "WEB_SEARCH_FORBIDDEN" : "WEB_SEARCH_UNAVAILABLE")
}
