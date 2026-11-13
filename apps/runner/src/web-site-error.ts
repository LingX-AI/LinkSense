import { z } from "zod";

export const webSiteFailureSchema = z.object({
  code: z.enum([
    "WEB_SITE_FORBIDDEN",
    "WEB_SITE_TURN_INACTIVE",
    "WEB_SITE_UNAVAILABLE",
    "WEB_SITE_INVALID",
    "WEB_SITE_NOT_FOUND",
    "WEB_SITE_SLUG_TAKEN",
    "WEB_SITE_SOURCE_UNAVAILABLE",
    "WEB_SITE_RESOURCES_MISSING",
    "WEB_SITE_BUNDLE_INVALID",
    "CONFLICT",
  ]),
  retryable: z.boolean(),
});

export class WebSiteRequestError extends Error {
  constructor(
    readonly code: z.infer<typeof webSiteFailureSchema>["code"],
    readonly retryable: boolean,
    readonly statusCode: number,
  ) {
    super(code);
    this.name = "WebSiteRequestError";
  }
}

export function webSiteErrorFromApi(statusCode: number, body: unknown): WebSiteRequestError {
  const parsed = z.object({ error_code: z.string() }).safeParse(body);
  const code = parsed.success ? parsed.data.error_code : "";
  if (["AUTH_REQUIRED", "FORBIDDEN", "ACCESS_DENIED", "USER_DISABLED"].includes(code)) {
    return new WebSiteRequestError("WEB_SITE_FORBIDDEN", false, 403);
  }
  const known = webSiteFailureSchema.shape.code.safeParse(code);
  return new WebSiteRequestError(
    known.success ? known.data : statusCode >= 500 ? "WEB_SITE_UNAVAILABLE" : "WEB_SITE_INVALID",
    statusCode >= 500,
    statusCode >= 500 ? 503 : statusCode,
  );
}
