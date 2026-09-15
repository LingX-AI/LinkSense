import { randomUUID, createHash } from "node:crypto";
import { buffer } from "node:stream/consumers";
import { join, relative, sep } from "node:path";
import type { CopyApplicationInput } from "@linksense/shared";
import { Prisma, type PrismaClient } from "../../generated/prisma/client.js";
import { AppError } from "../../lib/errors.js";
import { hashPackageDirectory } from "../../lib/package-directory-integrity.js";
import { stageAtomicDirectoryReplacement } from "../capabilities/importer.js";
import { verifiedApplicationPackagePath, type ApplicationPublicationService } from "./publication-service.js";
import type { InteractiveApplicationAssetStore } from "./service.js";

/** A copy has new resource identities and never retains the author's connection bindings. */
export class ApplicationCopyService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly capabilityRoot: string,
    private readonly publications: ApplicationPublicationService,
    private readonly assets: InteractiveApplicationAssetStore,
  ) {}

  async copy(ownerId: string, sourceId: string, input: CopyApplicationInput): Promise<string> {
    const source = await this.prisma.application.findFirst({ where: { id: sourceId, status: "active" } });
    if (!source || !source.publishedVersionId || (!source.allowCopy && source.ownerId !== ownerId)) throw new AppError("FORBIDDEN");
    const definition = await this.publications.readVersion(sourceId, source.publishedVersionId);
    const id = randomUUID();
    const replacements: Awaited<ReturnType<typeof stageAtomicDirectoryReplacement>>[] = [];
    const copiedCapabilities: Prisma.CapabilityCreateManyInput[] = [];
    const boundCapabilities: Array<{ id: string; name: string; type: string }> = [];
    const uploadedKeys: string[] = [];
    const packageId = definition.interactivePackageId ? randomUUID() : null;
    const sourcePackage = definition.interactivePackageId
      ? await this.prisma.interactiveApplicationPackage.findFirst({ where: { id: definition.interactivePackageId, applicationId: sourceId } }) : null;
    if (packageId && !sourcePackage) throw new AppError("APPLICATION_DEPENDENCY_UNAVAILABLE");
    const copiedAssets: Prisma.InteractiveApplicationAssetCreateManyInput[] = [];
    let committed = false;
    try {
      for (const capability of definition.capabilities) {
        const existing = await this.prisma.capability.findMany({ where: { ownerId, type: capability.type, name: capability.name, status: "active" } });
        if (existing.length) {
          const same = existing.length === 1 ? existing[0] : undefined;
          if (!same || await hashPackageDirectory(await verifiedApplicationPackagePath(this.capabilityRoot, same.storagePath)) !== capability.contentSha256) throw new AppError("CONFLICT");
          boundCapabilities.push({ id: same.id, name: same.name, type: same.type });
          continue;
        }
        const capabilityId = randomUUID();
        boundCapabilities.push({ id: capabilityId, name: capability.name, type: capability.type });
        const sourcePath = await verifiedApplicationPackagePath(this.capabilityRoot, capability.storagePath);
        if (await hashPackageDirectory(sourcePath) !== capability.contentSha256) throw new AppError("APPLICATION_DEPENDENCY_UNAVAILABLE");
        const replacement = await stageAtomicDirectoryReplacement(sourcePath, join(this.capabilityRoot, capabilityId));
        replacements.push(replacement);
        if (await hashPackageDirectory(replacement.currentDirectory) !== capability.contentSha256) throw new AppError("APPLICATION_DEPENDENCY_UNAVAILABLE");
        copiedCapabilities.push({
          id: capabilityId, ownerId, installedBy: ownerId, type: capability.type,
          name: capability.name, slug: `${capability.name.slice(0, 140)}-${capabilityId}`, description: capability.description,
          sourceType: "local", status: "active",
          storagePath: relative(this.capabilityRoot, replacement.currentDirectory).split(sep).join("/"),
          manifestJson: capability.manifestJson ?? Prisma.JsonNull,
          riskSummaryJson: capability.riskSummaryJson ?? Prisma.JsonNull,
        });
      }
      if (sourcePackage && packageId) {
        const sourceAssets = await this.prisma.interactiveApplicationAsset.findMany({ where: { packageId: sourcePackage.id } });
        if (sourceAssets.length !== sourcePackage.fileCount) throw new AppError("APPLICATION_DEPENDENCY_UNAVAILABLE");
        for (const asset of sourceAssets) {
          const bytes = await buffer(await this.assets.get(asset.objectKey));
          if (bytes.length !== asset.byteSize || createHash("sha256").update(bytes).digest("hex") !== asset.sha256) throw new AppError("APPLICATION_DEPENDENCY_UNAVAILABLE");
          const assetId = randomUUID();
          const objectKey = `applications/${ownerId}/${id}/packages/${packageId}/${assetId}`;
          await this.assets.put(objectKey, bytes, asset.contentType); uploadedKeys.push(objectKey);
          copiedAssets.push({ id: assetId, packageId, path: asset.path, objectKey, contentType: asset.contentType, byteSize: bytes.length, sha256: asset.sha256 });
        }
      }
      await this.prisma.$transaction(async tx => {
        await tx.$queryRaw(Prisma.sql`SELECT id FROM users WHERE id = ${ownerId}::uuid FOR UPDATE`);
        await tx.$queryRaw(Prisma.sql`SELECT id FROM applications WHERE id = ${sourceId}::uuid FOR SHARE`);
        const current = await tx.application.findFirst({ where: { id: sourceId, status: "active", publishedVersionId: source.publishedVersionId } });
        if (!current || (!current.allowCopy && current.ownerId !== ownerId)) throw new AppError("FORBIDDEN");
        const actor = await tx.user.findFirst({ where: { id: ownerId, status: "active" }, select: { selfRegisteredAt: true } });
        if (!actor) throw new AppError("USER_DISABLED");
        if (source.ownerId !== ownerId) {
          if (actor.selfRegisteredAt) throw new AppError("FORBIDDEN");
          const groups = await tx.userGroupMember.findMany({ where: { userId: ownerId, status: "active" }, select: { userGroupId: true } });
          const grant = await tx.applicationGrant.findFirst({ where: { applicationId: sourceId, status: "active", OR: [
            { granteeType: "user", userId: ownerId }, { granteeType: "user_group", userGroupId: { in: groups.map(group => group.userGroupId) } },
          ] } });
          if (!grant) throw new AppError("FORBIDDEN");
        }
        const currentCapabilities = await tx.capability.findMany({ where: { ownerId, status: "active", OR: boundCapabilities.map(capability => ({ name: capability.name, type: capability.type })) } });
        for (const capability of boundCapabilities) {
          const matches = currentCapabilities.filter(current => current.name === capability.name && current.type === capability.type);
          const wasCreated = copiedCapabilities.some(created => created.id === capability.id);
          if (wasCreated ? matches.length !== 0 : matches.length !== 1 || matches[0]?.id !== capability.id) throw new AppError("CONFLICT");
        }
        await tx.application.create({ data: {
          id, ownerId, name: input.name, kind: definition.kind, iconPreset: source.iconPreset,
          instructions: definition.instructions, usageInstructions: definition.usageInstructions,
          description: source.description, model: definition.model, reasoningEffort: definition.reasoningEffort,
          interactivePackageId: packageId,
          status: definition.mcpServerIds.length || definition.knowledgeBaseIds.length ? "disabled" : "active",
        } });
        if (copiedCapabilities.length) await tx.capability.createMany({ data: copiedCapabilities });
        if (boundCapabilities.length) {
          await tx.applicationCapability.createMany({ data: boundCapabilities.map((capability, selectionOrder) => ({
            applicationId: id, capabilityId: capability.id, capabilityNameSnapshot: capability.name,
            capabilityTypeSnapshot: capability.type, selectionOrder,
          })) });
        }
        if (sourcePackage && packageId) {
          await tx.interactiveApplicationPackage.create({ data: {
            id: packageId, applicationId: id, version: sourcePackage.version, manifestJson: sourcePackage.manifestJson ?? Prisma.JsonNull,
            archiveSha256: sourcePackage.archiveSha256, fileCount: sourcePackage.fileCount,
            expandedBytes: sourcePackage.expandedBytes, createdBy: ownerId,
          } });
          await tx.interactiveApplicationAsset.createMany({ data: copiedAssets });
        }
      });
      committed = true;
      for (const replacement of replacements) await replacement.commit();
      return id;
    } finally {
      if (!committed) {
        for (const replacement of replacements.reverse()) await replacement.rollback();
        for (const key of uploadedKeys) await this.assets.remove(key);
      }
    }
  }
}
