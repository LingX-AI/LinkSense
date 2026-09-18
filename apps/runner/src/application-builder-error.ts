import { z } from "zod";

export const applicationBuilderFailureSchema = z.object({
  code: z.enum(["APPLICATION_DEVELOPMENT_FORBIDDEN", "APPLICATION_DEVELOPMENT_TURN_INACTIVE", "APPLICATION_DEVELOPMENT_UNAVAILABLE", "APPLICATION_DEVELOPMENT_INVALID", "APPLICATION_PACKAGE_INVALID", "APPLICATION_ICON_UPLOAD_INVALID", "APPLICATION_DEVELOPMENT_NOT_FOUND", "APPLICATION_DEVELOPMENT_SOURCE_CHANGED", "APPLICATION_DEPENDENCY_UNAVAILABLE", "CONFLICT"]),
  retryable: z.boolean(),
});
export class ApplicationBuilderRequestError extends Error {
  constructor(readonly code: z.infer<typeof applicationBuilderFailureSchema>["code"], readonly retryable: boolean, readonly statusCode: number) { super(code); this.name = "ApplicationBuilderRequestError"; }
}
export function applicationBuilderErrorFromApi(statusCode: number, body: unknown): ApplicationBuilderRequestError {
  const parsed = z.object({ error_code: z.string() }).safeParse(body);
  const code = parsed.success ? parsed.data.error_code : "";
  if (["AUTH_REQUIRED", "FORBIDDEN", "ACCESS_DENIED", "USER_DISABLED"].includes(code)) return new ApplicationBuilderRequestError("APPLICATION_DEVELOPMENT_FORBIDDEN", false, 403);
  const known = applicationBuilderFailureSchema.shape.code.safeParse(code);
  return new ApplicationBuilderRequestError(known.success ? known.data : statusCode >= 500 ? "APPLICATION_DEVELOPMENT_UNAVAILABLE" : "APPLICATION_DEVELOPMENT_INVALID", statusCode >= 500, statusCode >= 500 ? 503 : statusCode);
}
