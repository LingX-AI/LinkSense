import { connectionFailureCodeSchema, type ErrorCode } from "@linksense/shared";

export class ConnectionRequestError extends Error {
  constructor(
    readonly code: string,
    readonly retryable: boolean,
    readonly statusCode: number,
  ) {
    super(code);
  }
}
export function connectionErrorFromApi(status: number, value: unknown): ConnectionRequestError {
  const code =
    typeof value === "object" && value !== null && "error_code" in value
      ? value.error_code
      : undefined;
  const known = connectionFailureCodeSchema.safeParse(code);
  if (known.success)
    return new ConnectionRequestError(
      known.data,
      status >= 500 && known.data !== "CONNECTION_NOT_CONFIGURED",
      status,
    );
  const forbidden: readonly ErrorCode[] = ["AUTH_REQUIRED", "FORBIDDEN", "ACCESS_DENIED"];
  if (typeof code === "string" && forbidden.some((value) => value === code))
    return new ConnectionRequestError("CONNECTION_ACCESS_DENIED", false, 403);
  return new ConnectionRequestError(
    "CONNECTION_UNAVAILABLE",
    status >= 500,
    status >= 500 ? 503 : 400,
  );
}
