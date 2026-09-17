import { readVerifiedInteractiveAsset } from "./interactive-asset-integrity.js";
import { assertInteractiveDependenciesReady } from "./interactive-dependencies.js";
import type { InteractiveApplicationAssetStore } from "./service.js";
import { isDeepStrictEqual } from "node:util";
import { lstat } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { applicationVersionInputSchema, applicationVersionNumberSchema, applicationVersionStatus, type ApplicationVersionInput, type ApplicationPublication, type ApplicationDistributionSettings } from "@linksense/shared";
import { Prisma, type PrismaClient, type ApplicationVersion } from "../../generated/prisma/client.js";
import { AppError } from "../../lib/errors.js";
import { hashPackageDirectory, listPackageDirectoryFiles } from "../../lib/package-directory-integrity.js";
import { stageAtomicDirectoryReplacement } from "../capabilities/importer.js";
import { publishedApplicationDefinitionSchema, publishedCapabilitySchema, type PublishedApplicationDefinition, type PublishedCapability } from "./published-definition.js";

export class ApplicationPublicationService {
  constructor(private readonly prisma: PrismaClient, private readonly capabilityRoot: string, private readonly assets?: Pick<InteractiveApplicationAssetStore, "get">) {}

  async get(applicationId: string): Promise<ApplicationPublication> {
    const application = await this.prisma.application.findUniqueOrThrow({ where: { id: applicationId } });
    const version = application.publishedVersionId
      ? await this.prisma.applicationVersion.findUnique({ where: { id: application.publishedVersionId } }) : null;
    return {
      version_id: version?.id ?? null,
      version_number: version?.versionLabel ?? null,
      usage_instructions: application.usageInstructions,
    };
  }

  async settings(applicationId: string): Promise<ApplicationDistributionSettings> {
    const application = await this.prisma.application.findUniqueOrThrow({ where: { id: applicationId } });
    const versions = await this.prisma.applicationVersion.findMany({ where: { applicationId }, orderBy: { versionNumber: "desc" } });
    const highest = highestVersion(versions);
    const package_ = application.interactivePackageId ? await this.prisma.interactiveApplicationPackage.findUnique({ where: { id: application.interactivePackageId }, select: { version: true } }) : null;
    const packageVersion = applicationVersionNumberSchema.safeParse(package_?.version);
    return {
      version_number: highest ?? (packageVersion.success ? packageVersion.data : "1.0.0"),
      highest_version_number: highest,
      usage_instructions: versions[0]?.assetsReady ? this.parseDefinition(versions[0].definitionJson).usageInstructions : application.usageInstructions,
    };
  }

  async readVersion(applicationId: string, versionId: string): Promise<PublishedApplicationDefinition> {
    const version = await this.prisma.applicationVersion.findFirst({ where: { id: versionId, applicationId, assetsReady: true } });
    if (!version) throw new AppError("APPLICATION_DEPENDENCY_UNAVAILABLE");
    return publishedApplicationDefinitionSchema.parse(version.definitionJson);
  }

  parseDefinition(value: unknown): PublishedApplicationDefinition {
    return publishedApplicationDefinitionSchema.parse(value);
  }

  async verifyVersion(applicationId: string, versionId: string): Promise<void> {
    const definition = await this.readVersion(applicationId, versionId);
    for (const capability of definition.capabilities) {
      const path = await verifiedApplicationPackagePath(this.capabilityRoot, capability.storagePath);
      if (await hashPackageDirectory(path) !== capability.contentSha256) throw new AppError("APPLICATION_DEPENDENCY_UNAVAILABLE");
    }
    if (definition.interactivePackageId) {
      const package_ = await this.prisma.interactiveApplicationPackage.findFirst({ where: { id: definition.interactivePackageId, applicationId } });
      if (!package_) throw new AppError("APPLICATION_DEPENDENCY_UNAVAILABLE");
      if (!this.assets) throw new AppError("INTERNAL_ERROR");
      const assets = await this.prisma.interactiveApplicationAsset.findMany({ where: { packageId: package_.id } });
      if (assets.length !== package_.fileCount) throw new AppError("APPLICATION_DEPENDENCY_UNAVAILABLE");
      for (const asset of assets) await readVerifiedInteractiveAsset(this.assets, asset);
    }
  }

  async capture(ownerId: string, applicationId: string, input: ApplicationVersionInput, options: {
    runtimeInstructions?: string;
    conversionVersionId?: string;
    complete: (tx: Prisma.TransactionClient, version: ApplicationVersion) => Promise<void>;
  }): Promise<ApplicationPublication> {
    const { runtimeInstructions, conversionVersionId } = options;
    const parsed = conversionVersionId ? { ...input, version_number: applicationVersionNumberSchema.parse(input.version_number) } : applicationVersionInputSchema.parse(input);
    const application = await this.prisma.application.findFirst({ where: { id: applicationId, ownerId, status: conversionVersionId ? { not: "deleted" } : "active" } });
    if (!application) throw new AppError("APPLICATION_NOT_FOUND");
    if (application.kind === "interactive" && application.interactivePackageId) {
      const package_ = await this.prisma.interactiveApplicationPackage.findFirst({ where: { id: application.interactivePackageId, applicationId } });
      if (!package_) throw new AppError("APPLICATION_DEPENDENCY_UNAVAILABLE");
      await assertInteractiveDependenciesReady(this.prisma, ownerId, package_.manifestJson, application.interactiveDependencyBindings);
    }
    if (!conversionVersionId) assertVersionNotLower(parsed.version_number, await this.prisma.applicationVersion.findMany({ where: { applicationId }, select: { versionLabel: true } }));
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
        instructions: runtimeInstructions ?? application.instructions, usageInstructions: parsed.usage_instructions,
        model: application.model, reasoningEffort: application.reasoningEffort,
        interactivePackageId: application.interactivePackageId,
        capabilities: snapshots, knowledgeBaseIds: knowledge.map(binding => binding.knowledgeBaseId),
        mcpServerIds: mcp.map(binding => binding.mcpServerId),
      });
      const saved = await this.prisma.$transaction(async tx => {
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
        const latest = await tx.applicationVersion.findFirst({ where: { applicationId }, orderBy: { versionNumber: "desc" } });
        let version: ApplicationVersion;
        if (conversionVersionId) {
          const changed = await tx.applicationVersion.updateMany({ where: { id: conversionVersionId, applicationId, assetsReady: false }, data: { definitionJson: definition, assetsReady: true } });
          if (changed.count !== 1) throw new AppError("CONFLICT");
          version = await tx.applicationVersion.findUniqueOrThrow({ where: { id: conversionVersionId } });
        } else {
          assertVersionNotLower(parsed.version_number, await tx.applicationVersion.findMany({ where: { applicationId }, select: { versionLabel: true } }));
          if (latest?.assetsReady && latest.versionLabel === parsed.version_number && sameApplicationContent(this.parseDefinition(latest.definitionJson), definition)) {
            version = latest;
          } else {
            version = await tx.applicationVersion.create({ data: { id: versionId, applicationId, versionNumber: (latest?.versionNumber ?? 0) + 1, versionLabel: parsed.version_number, definitionJson: definition, assetsReady: true, createdBy: ownerId } });
          }
        }
        await options.complete(tx, version);
        return version;
      });
      committed = saved.id === versionId;
      if (committed) for (const replacement of replacements) await replacement.commit();
      return { version_id: saved.id, version_number: saved.versionLabel, usage_instructions: parsed.usage_instructions };
    } finally {
      if (!committed) for (const replacement of replacements.reverse()) await replacement.rollback();
    }
  }
}

function highestVersion(versions: ReadonlyArray<{ versionLabel: string }>): string | null {
  return versions.reduce<string | null>((highest, version) => applicationVersionStatus(version.versionLabel, highest) === "new" ? version.versionLabel : highest, null);
}

function assertVersionNotLower(value: string, versions: ReadonlyArray<{ versionLabel: string }>): void {
  const highest = highestVersion(versions);
  if (applicationVersionStatus(value, highest) === "lower") throw new AppError("APPLICATION_VERSION_TOO_LOW", { version: highest });
}

function sameApplicationContent(left: PublishedApplicationDefinition, right: PublishedApplicationDefinition): boolean {
  const comparable = (definition: PublishedApplicationDefinition) => ({ ...definition,
    capabilities: definition.capabilities.map(capability => ({ ...capability, storagePath: "", revision: "" })),
  });
  return isDeepStrictEqual(comparable(left), comparable(right));
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
