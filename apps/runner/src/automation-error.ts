import { errorCodeSchema, type AutomationToolFailure } from "@linksense/shared";
import { z } from "zod";

export class AutomationRequestError extends Error {
  constructor(
    readonly code: AutomationToolFailure["code"],
    readonly retryable: boolean,
    readonly statusCode: number,
  ) {
    super(code);
    this.name = "AutomationRequestError";
  }
}

export function automationErrorFromApi(
  status: number,
  value: unknown,
): AutomationRequestError {
  const body = z.object({ error_code: errorCodeSchema }).safeParse(value);
  return new AutomationRequestError(
    body.success ? body.data.error_code : "INTERNAL_ERROR",
    status >= 500,
    status >= 500 ? 503 : status,
  );
}
