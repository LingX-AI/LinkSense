import type { CredentialService } from "../credentials/service.js";
import { AppError } from "../../lib/errors.js";

export type ApplicationCredentialResolver = Pick<CredentialService, "resolveForCapability">;
export async function validateApplicationCredentials(
  resolver: ApplicationCredentialResolver | undefined, ownerId: string,
  capabilities: ReadonlyArray<{ id: string; type: string; riskSummaryJson: unknown }>,
): Promise<void> {
  for (const capability of capabilities) {
    if (capability.type !== "plugin") continue;
    const risk = capability.riskSummaryJson;
    if (!risk || typeof risk !== "object" || !("declared_environment_keys" in risk) || !Array.isArray(risk.declared_environment_keys)) continue;
    const keys = risk.declared_environment_keys.filter((value): value is string => typeof value === "string" && /^[A-Za-z_][A-Za-z0-9_]*$/u.test(value));
    if (keys.length && (!resolver || !(await resolver.resolveForCapability(ownerId, capability.id, keys)).ok)) throw new AppError("APPLICATION_DEPENDENCY_UNAVAILABLE");
  }
}
