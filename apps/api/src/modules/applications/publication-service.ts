import { isDeepStrictEqual } from "node:util";
import { lstat } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { type PublishApplicationInput, type ApplicationPublication } from "@linksense/shared";
import { Prisma, type PrismaClient } from "../../generated/prisma/client.js";
import { AppError } from "../../lib/errors.js";
import { hashPackageDirectory, listPackageDirectoryFiles } from "../../lib/package-directory-integrity.js";
import { stageAtomicDirectoryReplacement } from "../capabilities/importer.js";
import { publishedApplicationDefinitionSchema, publishedCapabilitySchema, type PublishedApplicationDefinition, type PublishedCapability } from "./published-definition.js";

export class ApplicationPublicationService {
  constructor(private readonly prisma: PrismaClient, private readonly capabilityRoot: string) {}

  async get(applicationId: string): Promise<ApplicationPublication> {
    const application = await this.prisma.application.findUniqueOrThrow({ where: { id: applicationId } });
    const version = application.publishedVersionId
      ? await this.prisma.applicationVersion.findUnique({ where: { id: application.publishedVersionId } }) : null;
    return {
      version_id: version?.id ?? null,
      version_number: version?.versionNumber ?? null,
      allow_copy: application.allowCopy,
      usage_instructions: application.usageInstructions,
    };
  }

  async readVersion(applicationId: string, versionId: string): Promise<PublishedApplicationDefinition> {
    const version = await this.prisma.applicationVersion.findFirst({ where: { id: versionId, applicationId, assetsReady: true } });
    if (!version) throw new AppError("APPLICATION_DEPENDENCY_UNAVAILABLE");
    return publishedApplicationDefinitionSchema.parse(version.definitionJson);
  }

  async publish(ownerId: string, applicationId: string, input: PublishApplicationInput, runtimeInstructions?: string, conversionVersionId?: string): Promise<ApplicationPublication> {
    const application = await this.prisma.application.findFirst({ where: { id: applicationId, ownerId, status: conversionVersionId ? { not: "deleted" } : "active" } });
    if (!application) throw new AppError("APPLICATION_NOT_FOUND");
    const [bindings, knowledge, mcp] = await Promise.all([
      this.prisma.applicationCapability.findMany({ where: { applicationId }, orderBy: { selectionOrder: "asc" } }),
      this.prisma.applicationKnowledgeBase.findMany({ where: { applicationId }, orderBy: { selectionOrder: "asc" } }),
      this.prisma.applicationMcpServer.findMany({ where: { applicationId }, orderBy: { selectionOrder: "asc" } }),
    ]);
    const sourceStatus = conversionVersionId ? { in: ["active", "disabled"] } : "active";
    const sources = await this.prisma.capability.findMany({ where: { id: { in: bindings.map(binding => binding.capabilityId) }, ownerId, status: sourceStatus } });
    if (sources.length !== bindings.length) throw new AppError("APPLICATION_DEPENDENCY_UNAVAILABLE");
    const versionId = conversionVersionId ?? randomUUID();
    const replacements: Awaited<ReturnType<typeof stageAtomicDirectoryReplacement>>[] = [];
    const snapshots: PublishedCapability[] = [];
    let committed = false;
    try {
      for (const binding of bindings) {
        const source = sources.find(candidate => candidate.id === binding.capabilityId);
        if (!source) throw new AppError("APPLICATION_DEPENDENCY_UNAVAILABLE");
        const sourcePath = await verifiedApplicationPackagePath(this.capabilityRoot, source.storagePath);
        await listPackageDirectoryFiles(sourcePath);
        const replacement = await stageAtomicDirectoryReplacement(sourcePath, join(this.capabilityRoot, "application-versions", versionId, source.id));
        replacements.push(replacement);
        snapshots.push(publishedCapabilitySchema.parse({
          id: source.id, type: source.type, name: source.name,
          description: source.description, sourceType: source.sourceType,
          marketplaceListingId: source.marketplaceListingId ?? null, marketplaceReleaseId: source.marketplaceReleaseId ?? null,
          storagePath: relative(this.capabilityRoot, replacement.currentDirectory).split(sep).join("/"),
          revision: source.updatedAt.toISOString(), contentSha256: await hashPackageDirectory(replacement.currentDirectory),
          manifestJson: source.manifestJson, riskSummaryJson: source.riskSummaryJson,
        }));
      }
      const definition = publishedApplicationDefinitionSchema.parse({
        schemaVersion: 1, name: application.name, kind: application.kind,
        instructions: runtimeInstructions ?? application.instructions, usageInstructions: input.usage_instructions,
        model: application.model, reasoningEffort: application.reasoningEffort,
        interactivePackageId: application.interactivePackageId,
        capabilities: snapshots, knowledgeBaseIds: knowledge.map(binding => binding.knowledgeBaseId),
        mcpServerIds: mcp.map(binding => binding.mcpServerId),
      });
      await this.prisma.$transaction(async tx => {
        const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT id FROM applications WHERE id = ${applicationId}::uuid AND owner_id = ${ownerId}::uuid AND status = ${application.status} FOR UPDATE`);
        if (rows.length !== 1) throw new AppError("CONFLICT");
        const currentApplication = await tx.application.findFirst({ where: { id: applicationId, ownerId } });
        const [currentBindings, currentKnowledge, currentMcp] = await Promise.all([
          tx.applicationCapability.findMany({ where: { applicationId }, orderBy: { selectionOrder: "asc" } }),
          tx.applicationKnowledgeBase.findMany({ where: { applicationId }, orderBy: { selectionOrder: "asc" } }),
          tx.applicationMcpServer.findMany({ where: { applicationId }, orderBy: { selectionOrder: "asc" } }),
        ]);
        if (!isDeepStrictEqual(application, currentApplication) || !isDeepStrictEqual(bindings, currentBindings) || !isDeepStrictEqual(knowledge, currentKnowledge) || !isDeepStrictEqual(mcp, currentMcp)) throw new AppError("CONFLICT");
        const currentSources = await tx.capability.findMany({ where: { id: { in: sources.map(source => source.id) }, ownerId, status: sourceStatus }, select: { id: true, updatedAt: true } });
        if (currentSources.length !== sources.length || sources.some(source => !currentSources.some(current => current.id === source.id && current.updatedAt.getTime() === source.updatedAt.getTime()))) throw new AppError("CONFLICT");
        const latest = await tx.applicationVersion.findFirst({ where: { applicationId }, orderBy: { versionNumber: "desc" }, select: { versionNumber: true } });
        if (conversionVersionId) {
          const changed = await tx.applicationVersion.updateMany({ where: { id: conversionVersionId, applicationId, assetsReady: false }, data: { definitionJson: definition, assetsReady: true } });
          if (changed.count !== 1) throw new AppError("CONFLICT");
        } else {
          await tx.applicationVersion.create({ data: { id: versionId, applicationId, versionNumber: (latest?.versionNumber ?? 0) + 1, definitionJson: definition, assetsReady: true, createdBy: ownerId } });
        }
        await tx.application.update({ where: { id: applicationId, ownerId }, data: { publishedVersionId: versionId, usageInstructions: input.usage_instructions, allowCopy: input.allow_copy } });
      });
      committed = true;
      for (const replacement of replacements) await replacement.commit();
      return await this.get(applicationId);
    } finally {
      if (!committed) for (const replacement of replacements.reverse()) await replacement.rollback();
    }
  }
}

export function applicationPackagePath(root: string, storedPath: string): string {
  const absoluteRoot = resolve(root);
  const candidate = resolve(absoluteRoot, storedPath);
  const within = relative(absoluteRoot, candidate);
  if (!within || within === ".." || within.startsWith(`..${sep}`) || isAbsolute(within)) throw new AppError("APPLICATION_DEPENDENCY_UNAVAILABLE");
  return candidate;
}

export async function verifiedApplicationPackagePath(root: string, storedPath: string): Promise<string> {
  const path = applicationPackagePath(root, storedPath);
  let current = resolve(root);
  for (const segment of relative(current, path).split(sep)) {
    current = join(current, segment);
    const entry = await lstat(current);
    if (!entry.isDirectory() || entry.isSymbolicLink()) throw new AppError("APPLICATION_DEPENDENCY_UNAVAILABLE");
  }
  return path;
}
