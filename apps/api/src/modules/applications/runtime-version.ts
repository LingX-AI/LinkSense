import { Prisma, type Application } from "../../generated/prisma/client.js";
import { AppError } from "../../lib/errors.js";
import type { ApplicationRuntimeConfiguration } from "./service.js";
import { publishedApplicationDefinitionSchema } from "./published-definition.js";

/** The caller holds the conversation lock. Access grants are checked in the same transaction. */
export async function assertApplicationRuntimeCurrent(
  tx: Prisma.TransactionClient,
  ownerId: string,
  runtime: ApplicationRuntimeConfiguration,
): Promise<Application> {
  await tx.$queryRaw(Prisma.sql`SELECT id FROM applications WHERE id = ${runtime.applicationId}::uuid FOR SHARE`);
  const application = await tx.application.findFirst({ where: { id: runtime.applicationId, ownerId: runtime.applicationOwnerId, status: "active" } });
  if (!application) throw new AppError("CONFLICT");
  const installed = await tx.applicationRuntimeInstallation.findUnique({ where: { ownerId_applicationId: { ownerId, applicationId: application.id } } });
  if (!installed || installed.versionId !== runtime.applicationVersionId) throw new AppError("APPLICATION_INSTALLATION_REQUIRED");
  if (runtime.applicationVersionId !== null) {
    // Shared availability may advance; only an explicit installation changes
    // this user's selected resources. Admission and installation share a gate.
    const version = await tx.applicationVersion.findFirst({ where: { id: runtime.applicationVersionId, applicationId: application.id, assetsReady: true } });
    if (!version) throw new AppError("APPLICATION_DEPENDENCY_UNAVAILABLE");
    const definition = publishedApplicationDefinitionSchema.parse(version.definitionJson);
    if (definition.instructions !== runtime.instructions || definition.model !== runtime.model || definition.reasoningEffort !== runtime.reasoningEffort || definition.interactivePackageId !== runtime.interactivePackageId ||
      JSON.stringify(definition.capabilities) !== JSON.stringify(runtime.publishedCapabilities) ||
      JSON.stringify(definition.capabilities.map(capability => capability.id)) !== JSON.stringify(runtime.capabilityIds) ||
      JSON.stringify(definition.knowledgeBaseIds) !== JSON.stringify(runtime.knowledgeBaseIds) ||
      JSON.stringify(definition.mcpServerIds) !== JSON.stringify(runtime.mcpServerIds)) throw new AppError("CONFLICT");
    return application;
  }
  throw new AppError("APPLICATION_INSTALLATION_REQUIRED");
}
