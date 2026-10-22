import type { CredentialService } from "../credentials/service.js";
import { AppError } from "../../lib/errors.js";

export function declaredApplicationCredentialKeys(value: unknown): string[] {
  if (!value || typeof value !== "object" || !("declared_environment_keys" in value) || !Array.isArray(value.declared_environment_keys)) return [];
  return value.declared_environment_keys.filter((key): key is string => typeof key === "string" && /^[A-Za-z_][A-Za-z0-9_]*$/u.test(key));
}

export type ApplicationCredentialResolver = Pick<CredentialService, "resolveForCapability">;
export async function validateApplicationCredentials(
  resolver: ApplicationCredentialResolver | undefined, ownerId: string,
  capabilities: ReadonlyArray<{ id: string; type: string; riskSummaryJson: unknown }>,
): Promise<void> {
  for (const capability of capabilities) {
    if (capability.type !== "plugin") continue;
    const keys = declaredApplicationCredentialKeys(capability.riskSummaryJson);
    if (keys.length && (!resolver || !(await resolver.resolveForCapability(ownerId, capability.id, keys)).ok)) throw new AppError("APPLICATION_DEPENDENCY_UNAVAILABLE");
  }
}
