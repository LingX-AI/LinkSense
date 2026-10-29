import { skillManagementFailureSchema, type SkillManagementFailure } from "@linksense/shared";

export class SkillManagementRequestError extends Error {
  constructor(
    readonly code: SkillManagementFailure["code"],
    readonly retryable: boolean,
    readonly statusCode: number,
  ) {
    super(code);
    this.name = "SkillManagementRequestError";
  }
}

export function skillManagementErrorFromApi(statusCode: number, body: unknown): SkillManagementRequestError {
  const code = body && typeof body === "object" && "error_code" in body ? body.error_code : undefined;
  const parsed = skillManagementFailureSchema.shape.code.safeParse(code);
  return new SkillManagementRequestError(parsed.success ? parsed.data : "INTERNAL_ERROR", false, statusCode);
}
