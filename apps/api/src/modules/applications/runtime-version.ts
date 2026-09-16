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
  if (runtime.applicationVersionId !== null) {
    // A publication arriving during admission does not invalidate this start.
    // Its immutable resources were resolved when the request began; the next
    // execution resolves the latest release instead of reusing a task pin.
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
  // A draft and an independent copy run only in their owner's personal environment.
  if (application.ownerId !== ownerId) throw new AppError("APPLICATION_NOT_FOUND");
  const [capabilities, knowledge, mcp] = await Promise.all([
    tx.applicationCapability.findMany({ where: { applicationId: application.id }, orderBy: { selectionOrder: "asc" }, select: { capabilityId: true } }),
    tx.applicationKnowledgeBase.findMany({ where: { applicationId: application.id }, orderBy: { selectionOrder: "asc" }, select: { knowledgeBaseId: true } }),
    tx.applicationMcpServer.findMany({ where: { applicationId: application.id }, orderBy: { selectionOrder: "asc" }, select: { mcpServerId: true } }),
  ]);
  if (application.updatedAt.getTime() !== runtime.applicationUpdatedAt.getTime() ||
    (runtime.kind === "standard" && application.instructions !== runtime.instructions) ||
    application.kind !== runtime.kind || application.model !== runtime.model || application.reasoningEffort !== runtime.reasoningEffort ||
    (runtime.kind === "standard" && (
      JSON.stringify(capabilities.map(binding => binding.capabilityId)) !== JSON.stringify(runtime.capabilityIds) ||
      JSON.stringify(knowledge.map(binding => binding.knowledgeBaseId)) !== JSON.stringify(runtime.knowledgeBaseIds) ||
      JSON.stringify(mcp.map(binding => binding.mcpServerId)) !== JSON.stringify(runtime.mcpServerIds)))) throw new AppError("CONFLICT");
  return application;
}
