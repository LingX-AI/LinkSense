import { errorCodeSchema, type ErrorCode } from "@linksense/shared";
import { z } from "zod";

export class WebSiteToolRequestError extends Error {
  constructor(readonly code: ErrorCode, readonly statusCode: number) {
    super(code);
    this.name = "WebSiteToolRequestError";
  }
}

export function webSiteToolErrorFromApi(status: number, value: unknown): WebSiteToolRequestError {
  const body = z.object({ error_code: errorCodeSchema }).safeParse(value);
  return new WebSiteToolRequestError(body.success ? body.data.error_code : "INTERNAL_ERROR", status);
}
