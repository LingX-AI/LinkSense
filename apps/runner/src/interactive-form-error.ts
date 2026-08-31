export type InteractiveFormRequestErrorCode =
  | "INTERACTIVE_FORM_FORBIDDEN"
  | "INTERACTIVE_FORM_TURN_INACTIVE"
  | "INTERACTIVE_FORM_INVALID"
  | "INTERACTIVE_FORM_UNAVAILABLE"

export class InteractiveFormRequestError extends Error {
  constructor(
    readonly code: InteractiveFormRequestErrorCode,
    readonly retryable: boolean,
    readonly statusCode: number,
  ) {
    super(code)
    this.name = "InteractiveFormRequestError"
  }
}
