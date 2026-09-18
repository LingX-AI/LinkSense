import { validateApplicationCredentials, type ApplicationCredentialResolver } from "./runtime-credentials.js";
import { isApplicationVersionUpdate } from "./runtime-installation-projection.js";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { lock } from "proper-lockfile";
import {
  applicationDistributionChannelSchema, applicationInstallationUpdateSchema,
  type ApplicationInstallInput, type ApplicationInstallationUpdate,
} from "@linksense/shared";
import { Prisma, type PrismaClient, type ApplicationInstallation } from "../../generated/prisma/client.js";
import { AppError } from "../../lib/errors.js";
import { hashPackageDirectory } from "../../lib/package-directory-integrity.js";
import { stageAtomicDirectoryReplacement } from "../capabilities/importer.js";
import { verifiedApplicationPackagePath, type ApplicationPublicationService } from "./publication-service.js";
import { readApplicationDistributionAccess } from "./distribution-repository.js";
import { requireApplicationDistributionVersion } from "./distribution-policy.js";
import { installedApplicationBaselineSchema, type InstalledApplicationBaseline } from "./installation-merge.js";
import type { PublishedApplicationDefinition } from "./published-definition.js";
import type { ApplicationRuntimeGate } from "./runtime-gate.js";
import { activateApplicationInstallation } from "./runtime-installation-service.js";

export class ApplicationInstallationService {
  constructor(private readonly prisma: PrismaClient, private readonly capabilityRoot: string,
    private readonly publications: ApplicationPublicationService, private readonly gate?: ApplicationRuntimeGate, private readonly credentials?: ApplicationCredentialResolver) {}

  async install(ownerId: string, sourceId: string, input: ApplicationInstallInput): Promise<string> {
    const access = await readApplicationDistributionAccess(this.prisma, ownerId, sourceId);
    const versionId = requireApplicationDistributionVersion(access, input.channel, "install", input.version_id);
    const existing = await this.prisma.applicationInstallation.findFirst({ where: { ownerId, sourceApplicationId: sourceId } });
    if (existing) {
      if (existing.installedVersionId === versionId) return existing.applicationId;
      return this.update(ownerId, existing.applicationId, versionId, input.channel);
    }
    const definition = await this.publications.readVersion(sourceId, versionId);
    if (definition.kind === "interactive") throw new AppError("FORBIDDEN");
    const id = randomUUID();
    const staged = await this.stage(ownerId, id, definition);
    let committed = false;
    try {
      await this.prisma.$transaction(async tx => {
        await tx.$queryRaw(Prisma.sql`SELECT id FROM users WHERE id = ${ownerId}::uuid FOR UPDATE`);
        await tx.$queryRaw(Prisma.sql`SELECT id FROM applications WHERE id = ${sourceId}::uuid FOR SHARE`);
        requireApplicationDistributionVersion(await readApplicationDistributionAccess(tx, ownerId, sourceId), input.channel, "install", versionId);
        if (await tx.applicationInstallation.findFirst({ where: { ownerId, sourceApplicationId: sourceId } })) throw new AppError("CONFLICT");
        await tx.application.create({ data: {
          id, ownerId, name: input.name, kind: definition.kind, iconPreset: definition.iconPreset, iconObjectKey: definition.iconObjectKey,
          instructions: definition.instructions, usageInstructions: definition.usageInstructions, description: definition.description,
          model: definition.model, reasoningEffort: definition.reasoningEffort,
          status: requiresSetup(definition) ? "disabled" : "active",
        } });
        await staged.save(tx);
        await tx.applicationInstallation.create({ data: {
          applicationId: id, ownerId, sourceApplicationId: sourceId, channel: input.channel,
          installedVersionId: versionId, baselineJson: this.baseline(definition, staged.mapping),
        } });
        await this.activateCopy(tx, ownerId, id, { ...definition, name: input.name }, staged.mapping, [], [], input.channel, versionId);
      });
      committed = true;
      await staged.commit();
      return id;
    } finally { if (!committed) await staged.rollback(); }
  }

  async previewUpdate(ownerId: string, applicationId: string): Promise<ApplicationInstallationUpdate> {
    const installation = await this.requireInstallation(ownerId, applicationId);
    const latest = await this.latest(ownerId, installation);
    const current = await this.prisma.application.findFirst({ where: { id: applicationId, ownerId, status: { not: "deleted" } } });
    if (!current) throw new AppError("APPLICATION_NOT_FOUND");
    const definition = latest ? await this.publications.readVersion(installation.sourceApplicationId, latest.id) : null;
    const [knowledge, mcp] = await Promise.all([
      this.prisma.applicationKnowledgeBase.count({ where: { applicationId } }), this.prisma.applicationMcpServer.count({ where: { applicationId } }),
    ]);
    return applicationInstallationUpdateSchema.parse({
      current_version_id: installation.installedVersionId, latest_version_id: latest?.id ?? null,
      latest_version_number: latest?.versionLabel ?? null, update_available: latest?.updateAvailable ?? false,
      release_notes: latest?.releaseNotes ?? null, preserved_fields: [],
      setup_required: definition ? knowledge < definition.knowledgeBaseIds.length || mcp < definition.mcpServerIds.length : false,
    });
  }

  async update(ownerId: string, applicationId: string, expectedVersionId: string, channel?: "direct" | "center"): Promise<string> {
    await this.requireInstallation(ownerId, applicationId);
    if (!this.gate) throw new AppError("INTERNAL_ERROR");
    return this.gate.change(ownerId, applicationId, () => this.updateWithFileLock(ownerId, applicationId, expectedVersionId, channel));
  }

  private async updateWithFileLock(ownerId: string, applicationId: string, expectedVersionId: string, channel?: "direct" | "center"): Promise<string> {
    await this.requireInstallation(ownerId, applicationId);
    const directory = join(this.capabilityRoot, "application-installations", applicationId);
    await mkdir(directory, { recursive: true });
    const releaseLock = await lock(directory, { retries: 0, stale: 120_000, update: 10_000 });
    try { return await this.updateLocked(ownerId, applicationId, expectedVersionId, channel); }
    finally { await releaseLock(); }
  }

  private async updateLocked(ownerId: string, applicationId: string, expectedVersionId: string, channel?: "direct" | "center"): Promise<string> {
    const currentInstallation = await this.requireInstallation(ownerId, applicationId);
    const installation = { ...currentInstallation, channel: channel ?? currentInstallation.channel };
    const latest = await this.latest(ownerId, installation);
    if (!latest || latest.id !== expectedVersionId || !latest.updateAvailable) throw new AppError("CONFLICT");
    const current = await this.prisma.application.findFirst({ where: { id: applicationId, ownerId, status: { not: "deleted" } } });
    if (!current) throw new AppError("APPLICATION_NOT_FOUND");
    const baseline = installedApplicationBaselineSchema.parse(installation.baselineJson);
    const definition = await this.publications.readVersion(installation.sourceApplicationId, latest.id);
    const previous = await this.publications.readVersion(installation.sourceApplicationId, installation.installedVersionId);
    const [knowledge, mcp] = await Promise.all([
      this.prisma.applicationKnowledgeBase.findMany({ where: { applicationId }, orderBy: { selectionOrder: "asc" } }),
      this.prisma.applicationMcpServer.findMany({ where: { applicationId }, orderBy: { selectionOrder: "asc" } }),
    ]);
    const knowledgeIds = mapCopyResourceBindings(previous.knowledgeBaseIds, knowledge.map(item => item.knowledgeBaseId), definition.knowledgeBaseIds);
    const mcpIds = mapCopyResourceBindings(previous.mcpServerIds, mcp.map(item => item.mcpServerId), definition.mcpServerIds);
    const staged = await this.stage(ownerId, applicationId, definition, baseline);
    let committed = false;
    try {
      await this.prisma.$transaction(async tx => {
        await tx.$queryRaw(Prisma.sql`SELECT id FROM applications WHERE id IN (${applicationId}::uuid, ${installation.sourceApplicationId}::uuid) ORDER BY id FOR UPDATE`);
        requireApplicationDistributionVersion(await readApplicationDistributionAccess(tx, ownerId, installation.sourceApplicationId), applicationDistributionChannelSchema.parse(installation.channel), "install", latest.id);
        const actual = await tx.application.findUnique({ where: { id: applicationId } });
        const installed = await tx.applicationInstallation.findUnique({ where: { applicationId } });
        if (!isDeepStrictEqual(actual, current) || installed?.installedVersionId !== installation.installedVersionId) throw new AppError("CONFLICT");
        if (!isDeepStrictEqual(knowledge, await tx.applicationKnowledgeBase.findMany({ where: { applicationId }, orderBy: { selectionOrder: "asc" } })) ||
          !isDeepStrictEqual(mcp, await tx.applicationMcpServer.findMany({ where: { applicationId }, orderBy: { selectionOrder: "asc" } }))) throw new AppError("CONFLICT");
        await validateApplicationCredentials(this.credentials, ownerId, definition.capabilities.map(snapshot => ({ ...snapshot, id: staged.mapping.find(item => item.sourceId === snapshot.id)!.installedId })));
        const [availableKnowledge, availableMcp] = await Promise.all([
          tx.knowledgeBase.count({ where: { id: { in: knowledgeIds }, ownerId, lifecycleStatus: "active", availabilityStatus: "enabled" } }),
          tx.mcpServer.count({ where: { id: { in: mcpIds }, ownerId, status: "active" } }),
        ]);
        if (availableKnowledge !== knowledgeIds.length || availableMcp !== mcpIds.length) throw new AppError("APPLICATION_DEPENDENCY_UNAVAILABLE");
        await staged.save(tx);
        await tx.applicationKnowledgeBase.deleteMany({ where: { applicationId, knowledgeBaseId: { notIn: knowledgeIds } } });
        await tx.applicationMcpServer.deleteMany({ where: { applicationId, mcpServerId: { notIn: mcpIds } } });
        for (const [selectionOrder, knowledgeBaseId] of knowledgeIds.entries()) {
          await tx.applicationKnowledgeBase.updateMany({ where: { applicationId, knowledgeBaseId }, data: { selectionOrder } });
        }
        for (const [selectionOrder, mcpServerId] of mcpIds.entries()) {
          await tx.applicationMcpServer.updateMany({ where: { applicationId, mcpServerId }, data: { selectionOrder } });
        }
        await tx.application.update({ where: { id: applicationId }, data: {
          name: definition.name, description: definition.description, iconPreset: definition.iconPreset, iconObjectKey: definition.iconObjectKey, instructions: definition.instructions, model: definition.model,
          reasoningEffort: definition.reasoningEffort, usageInstructions: definition.usageInstructions,
        } });
        await tx.applicationInstallation.update({ where: { applicationId }, data: {
          installedVersionId: latest.id, channel: installation.channel, baselineJson: this.baseline(definition, staged.mapping),
        } });
        await this.activateCopy(tx, ownerId, applicationId, definition, staged.mapping, knowledgeIds, mcpIds, installation.channel, latest.id);
      });
      committed = true;
      await staged.commit();
      return applicationId;
    } finally { if (!committed) await staged.rollback(); }
  }

  async latest(ownerId: string, installation: ApplicationInstallation): Promise<{ id: string; versionLabel: string; releaseNotes: string | null; updateAvailable: boolean } | null> {
    let versionId: string;
    try {
      versionId = requireApplicationDistributionVersion(await readApplicationDistributionAccess(this.prisma, ownerId, installation.sourceApplicationId), applicationDistributionChannelSchema.parse(installation.channel), "install");
    } catch (error) {
      if (error instanceof AppError && ["FORBIDDEN", "APPLICATION_NOT_FOUND", "APPLICATION_DEPENDENCY_UNAVAILABLE"].includes(error.code)) return null;
      throw error;
    }
    const version = await this.prisma.applicationVersion.findFirst({ where: { id: versionId, applicationId: installation.sourceApplicationId, assetsReady: true } });
    if (!version) return null;
    const release = installation.channel === "center" ? await this.prisma.applicationRelease.findFirst({ where: { applicationId: installation.sourceApplicationId, versionId, status: "approved" }, orderBy: { submittedAt: "desc" }, select: { releaseNotes: true } }) : null;
    const installedVersion = await this.prisma.applicationVersion.findFirst({ where: { id: installation.installedVersionId, applicationId: installation.sourceApplicationId }, select: { versionNumber: true, versionLabel: true } });
    if (!installedVersion) throw new AppError("APPLICATION_DEPENDENCY_UNAVAILABLE");
    return { id: version.id, versionLabel: version.versionLabel, releaseNotes: release?.releaseNotes ?? null, updateAvailable: isApplicationVersionUpdate(installedVersion, version) };
  }

  private async requireInstallation(ownerId: string, applicationId: string): Promise<ApplicationInstallation> {
    const installation = await this.prisma.applicationInstallation.findFirst({ where: { applicationId, ownerId } });
    if (!installation) throw new AppError("APPLICATION_NOT_FOUND");
    return installation;
  }

  private async activateCopy(tx: Prisma.TransactionClient, ownerId: string, applicationId: string,
    definition: PublishedApplicationDefinition, mapping: InstalledApplicationBaseline["capabilities"],
    knowledgeBaseIds: string[], mcpServerIds: string[], channel: string, sourceVersionId: string): Promise<void> {
    const latest = await tx.applicationVersion.findFirst({ where: { applicationId }, orderBy: { versionNumber: "desc" } });
    const sourceVersion = await tx.applicationVersion.findUniqueOrThrow({ where: { id: sourceVersionId } });
    const version = await tx.applicationVersion.create({ data: {
      id: randomUUID(), applicationId, purpose: "installation", versionNumber: (latest?.versionNumber ?? 0) + 1, versionLabel: sourceVersion.versionLabel,
      createdBy: ownerId, assetsReady: true, definitionJson: { ...definition, knowledgeBaseIds, mcpServerIds,
        capabilities: definition.capabilities.map(snapshot => {
          const local = mapping.find(item => item.sourceId === snapshot.id);
          if (!local) throw new AppError("APPLICATION_DEPENDENCY_UNAVAILABLE");
          return { ...snapshot, id: local.installedId };
        }),
      },
    } });
    await activateApplicationInstallation(tx, ownerId, applicationId, version.id, channel);
  }

  private baseline(definition: PublishedApplicationDefinition, capabilities: InstalledApplicationBaseline["capabilities"]): InstalledApplicationBaseline {
    return installedApplicationBaselineSchema.parse({ name: definition.name, instructions: definition.instructions,
      model: definition.model, reasoningEffort: definition.reasoningEffort, capabilities, interactivePackageId: null,
      requiredKnowledgeBases: definition.knowledgeBaseIds.length, requiredMcpServers: definition.mcpServerIds.length });
  }

  private async stage(ownerId: string, applicationId: string, definition: PublishedApplicationDefinition,
    baseline?: InstalledApplicationBaseline) {
    if (definition.kind === "interactive" || definition.interactivePackageId) throw new AppError("FORBIDDEN");
    const replacements: Awaited<ReturnType<typeof stageAtomicDirectoryReplacement>>[] = [];
    const releases: Array<() => Promise<void>> = [];
    const mapping: InstalledApplicationBaseline["capabilities"] = [];
    const capabilities: Prisma.CapabilityCreateManyInput[] = [];
    const currentBindings = baseline ? await this.prisma.applicationCapability.findMany({ where: { applicationId }, orderBy: { selectionOrder: "asc" } }) : [];
    const bound = new Map<string, { id: string; name: string; type: string }>();
    const updated: Array<{ id: string; before: Date; data: Prisma.CapabilityUpdateManyMutationInput }> = [];
    const rollback = async () => {
      try { for (const replacement of replacements.reverse()) await replacement.rollback(); }
      finally { for (const release of releases.reverse()) await release(); }
    };
    try {
      for (const snapshot of definition.capabilities) {
        const old = baseline?.capabilities.find(item => item.sourceId === snapshot.id);
        const own = old ? await this.prisma.capability.findFirst({ where: { id: old.installedId, ownerId, status: { not: "deleted" } } }) : null;
        const id = own?.id ?? randomUUID();
        const target = own ? await verifiedApplicationPackagePath(this.capabilityRoot, own.storagePath) : join(this.capabilityRoot, "application-installations", applicationId, id);
        if (own) releases.push(await lock(target, { retries: 0, stale: 120_000, update: 10_000 }));
        const localHash = own ? await hashPackageDirectory(target) : null;
        mapping.push({ sourceId: snapshot.id, installedId: id, contentSha256: snapshot.contentSha256 });
        bound.set(id, { id, name: snapshot.name, type: snapshot.type });
        const data = { name: snapshot.name, description: snapshot.description, manifestJson: snapshot.manifestJson ?? Prisma.DbNull, riskSummaryJson: snapshot.riskSummaryJson ?? Prisma.DbNull };
        if (localHash === snapshot.contentSha256 && own) { updated.push({ id, before: own.updatedAt, data }); continue; }
        const path = await verifiedApplicationPackagePath(this.capabilityRoot, snapshot.storagePath);
        if (await hashPackageDirectory(path) !== snapshot.contentSha256) throw new AppError("APPLICATION_DEPENDENCY_UNAVAILABLE");
        const replacement = await stageAtomicDirectoryReplacement(path, own ? dirname(target) : target);
        replacements.push(replacement);
        if (await hashPackageDirectory(replacement.currentDirectory) !== snapshot.contentSha256) throw new AppError("APPLICATION_DEPENDENCY_UNAVAILABLE");
        if (own) updated.push({ id, before: own.updatedAt, data });
        else capabilities.push({ ...data, id, ownerId, installedBy: ownerId, type: snapshot.type, slug: `${snapshot.name.slice(0, 140)}-${id}`, sourceType: "local", status: "active", storagePath: relative(this.capabilityRoot, replacement.currentDirectory).split(sep).join("/") });
      }
      if (bound.size > 50) throw new AppError("VALIDATION_ERROR");
      return {
        mapping,
        save: async (tx: Prisma.TransactionClient): Promise<void> => {
          const actualBindings = await tx.applicationCapability.findMany({ where: { applicationId }, orderBy: { selectionOrder: "asc" } });
          if (!isDeepStrictEqual(actualBindings, currentBindings)) throw new AppError("CONFLICT");
          if (capabilities.length) await tx.capability.createMany({ data: capabilities });
          for (const item of updated) {
            const result = await tx.capability.updateMany({ where: { id: item.id, ownerId, updatedAt: item.before }, data: item.data });
            if (result.count !== 1) throw new AppError("CONFLICT");
          }
          await tx.applicationCapability.deleteMany({ where: { applicationId } });
          if (bound.size) await tx.applicationCapability.createMany({ data: [...bound.values()].map((item, selectionOrder) => ({ applicationId, capabilityId: item.id, capabilityNameSnapshot: item.name, capabilityTypeSnapshot: item.type, selectionOrder })) });
        },
        commit: async (): Promise<void> => { try { for (const replacement of replacements) await replacement.commit(); } finally { for (const release of releases.reverse()) await release(); } },
        rollback,
      };
    } catch (error) { await rollback(); throw error; }
  }
}

function requiresSetup(definition: PublishedApplicationDefinition): boolean {
  return definition.knowledgeBaseIds.length > 0 || definition.mcpServerIds.length > 0 || definition.capabilities.some(item => {
    const risk = item.riskSummaryJson;
    return typeof risk === "object" && risk !== null && !Array.isArray(risk) && (risk.requires_credentials === true || (Array.isArray(risk.declared_environment_keys) && risk.declared_environment_keys.length > 0));
  });
}

/** Keep the user's resource identities and credentials, replacing the app's selection. */
export function mapCopyResourceBindings(previous: readonly string[], configured: readonly string[], incoming: readonly string[]): string[] {
  const mappings = new Map(previous.flatMap((id, index) => configured[index] ? [[id, configured[index]] as const] : []));
  const added = configured.slice(previous.length);
  return incoming.map(id => {
    const target = mappings.get(id) ?? added.shift();
    if (!target) throw new AppError("APPLICATION_DEPENDENCY_UNAVAILABLE");
    return target;
  });
}
