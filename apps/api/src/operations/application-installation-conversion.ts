import { randomUUID } from "node:crypto";
import { applicationVersionNumberSchema, interactiveApplicationManifestSchema } from "@linksense/shared";
import { Prisma, type PrismaClient } from "../generated/prisma/client.js";
import { ApplicationPublicationService } from "../modules/applications/publication-service.js";
import { interactiveApplicationBaseInstructions, interactiveApplicationRuntimeInstructions } from "../modules/applications/service.js";

export const installationMigrationName = "20260918130000_application_runtime_installations";

/** Offline, resumable upgrade of live legacy configurations. Existing distribution
 * pointers and admitted turn history are never advanced by this operation. */
export async function convertApplicationInstallations(input: {
  prisma: PrismaClient; capabilityRoot: string; apply: boolean;
}): Promise<{ owners: number; consumers: number; debug: number; applied: boolean }> {
  const { prisma } = input;
  if (await prisma.conversationTurn.count({ where: { status: "running" } }) || await prisma.conversationTurnStartIntent.count()) throw new Error("MIGRATION_ACTIVE_TASKS");
  const [migration] = await prisma.$queryRaw<Array<{ finished_at: Date }>>(Prisma.sql`SELECT finished_at FROM _prisma_migrations WHERE migration_name = ${installationMigrationName} AND finished_at IS NOT NULL AND rolled_back_at IS NULL`);
  if (!migration) throw new Error("MIGRATION_SCHEMA_REQUIRED");
  const cutoff = migration.finished_at;
  const applications = await prisma.application.findMany({ where: { createdAt: { lte: cutoff }, status: { not: "deleted" }, }, orderBy: { id: "asc" } });
  const publications = new ApplicationPublicationService(prisma, input.capabilityRoot);
  let owners = 0, consumers = 0, debug = 0;
  for (const application of applications) {
    const selected = await prisma.applicationRuntimeInstallation.findUnique({ where: { ownerId_applicationId: { ownerId: application.ownerId, applicationId: application.id } } });
    if (selected && selected.updatedAt >= cutoff) continue;
    const [test] = application.developmentOnly ? await prisma.$queryRaw<Array<{ interactiveApplicationPackageId: string | null }>>(Prisma.sql`
      SELECT c.interactive_application_package_id AS "interactiveApplicationPackageId" FROM conversations c
      WHERE c.application_id = ${application.id}::uuid AND c.owner_id = ${application.ownerId}::uuid
        AND EXISTS (SELECT 1 FROM conversation_turns t WHERE t.conversation_id = c.id)
      ORDER BY c.updated_at DESC, c.id LIMIT 1
    `) : [];
    if (application.developmentOnly && !test) continue;
    if (application.developmentOnly) debug++; else owners++;
    if (!input.apply) continue;
    const latest = await prisma.applicationVersion.findFirst({ where: { applicationId: application.id }, orderBy: { versionNumber: "desc" } });
    const pending = await prisma.applicationVersion.findFirst({ where: { applicationId: application.id, assetsReady: false }, orderBy: { versionNumber: "desc" } });
    const packageId = test?.interactiveApplicationPackageId ?? application.interactivePackageId;
    const page = packageId ? await prisma.interactiveApplicationPackage.findUniqueOrThrow({ where: { id: packageId } }) : null;
    const pageVersion = applicationVersionNumberSchema.safeParse(page?.version);
    const versionLabel = application.developmentOnly ? "0.0.0" : pageVersion.success ? pageVersion.data : latest?.versionLabel ?? "1.0.0";
    const copy = await prisma.applicationInstallation.findUnique({ where: { applicationId: application.id } });
    let instructions = application.instructions;
    if (page && !copy) {
      const manifest = interactiveApplicationManifestSchema.parse(page.manifestJson);
      instructions = interactiveApplicationRuntimeInstructions(manifest.instructions ?? interactiveApplicationBaseInstructions(manifest.name), manifest);
    }
    const versionId = pending?.id ?? randomUUID();
    if (!pending) await prisma.applicationVersion.create({ data: {
      id: versionId, applicationId: application.id, versionLabel, versionNumber: (latest?.versionNumber ?? 0) + 1,
      purpose: application.developmentOnly ? "debug" : copy ? "installation" : "release", assetsReady: false, createdBy: application.ownerId, definitionJson: {},
    } });
    await publications.capture(application.ownerId, application.id, { version_number: versionLabel, usage_instructions: application.usageInstructions }, {
      conversionVersionId: versionId, purpose: application.developmentOnly ? "debug" : copy ? "installation" : "release", runtimeInstructions: instructions,
      ...(application.developmentOnly && packageId !== application.interactivePackageId ? { interactiveUpdate: {
        packageId: packageId!, name: application.name, description: application.description, iconPreset: application.iconPreset, iconObjectKey: application.iconObjectKey,
        capabilityIds: (await prisma.applicationCapability.findMany({ where: { applicationId: application.id }, orderBy: { selectionOrder: "asc" } })).map(item => item.capabilityId),
        knowledgeBaseIds: (await prisma.applicationKnowledgeBase.findMany({ where: { applicationId: application.id }, orderBy: { selectionOrder: "asc" } })).map(item => item.knowledgeBaseId),
        mcpServerIds: (await prisma.applicationMcpServer.findMany({ where: { applicationId: application.id }, orderBy: { selectionOrder: "asc" } })).map(item => item.mcpServerId),
      } } : {}),
      complete: async (tx, version) => {
        await tx.applicationRuntimeInstallation.upsert({
          where: { ownerId_applicationId: { ownerId: application.ownerId, applicationId: application.id } },
          create: { ownerId: application.ownerId, applicationId: application.id, versionId: version.id, channel: "direct" },
          update: { versionId: version.id },
        });
      },
    });
  }
  // Existing service users with no admitted snapshot used the shared version.
  // Only pre-upgrade tasks qualify; opening a new card never creates an install.
  const tasks = await prisma.conversation.findMany({ where: { createdAt: { lte: cutoff }, applicationId: { in: applications.filter(item => !item.developmentOnly).map(item => item.id) } }, orderBy: [{ updatedAt: "desc" }, { id: "asc" }], distinct: ["ownerId", "applicationId"] });
  for (const task of tasks) {
    if (!task.applicationId || await prisma.applicationRuntimeInstallation.findUnique({ where: { ownerId_applicationId: { ownerId: task.ownerId, applicationId: task.applicationId } } })) continue;
    const app = applications.find(item => item.id === task.applicationId)!;
    const center = task.applicationChannel === "center" ? await prisma.applicationRelease.findFirst({ where: { applicationId: app.id, status: "approved" }, orderBy: { reviewedAt: "desc" } }) : null;
    // Before snapshots existed, admitted service tasks read the creator's live
    // configuration. Preserve that upgrade-time configuration; execution still
    // rechecks grants, listing status and external-session authorization.
    const ownerSelection = await prisma.applicationRuntimeInstallation.findUnique({ where: { ownerId_applicationId: { ownerId: app.ownerId, applicationId: app.id } } });
    const versionId = task.applicationVersionId ?? center?.versionId ?? app.publishedVersionId ?? ownerSelection?.versionId;
    if (!versionId && !input.apply) { if (task.ownerId !== app.ownerId) consumers++; continue; }
    if (!versionId) throw new Error("MIGRATION_APPLICATION_VERSION_UNRESOLVED");
    await publications.readVersion(app.id, versionId);
    consumers++;
    if (input.apply) await prisma.applicationRuntimeInstallation.create({ data: { ownerId: task.ownerId, applicationId: app.id, versionId, channel: task.applicationChannel ?? "direct" } });
  }
  return { owners, consumers, debug, applied: input.apply };
}
