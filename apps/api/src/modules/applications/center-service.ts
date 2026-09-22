import {
  applicationCenterReleaseSchema, applicationCenterReviewInputSchema, applicationCenterStatusInputSchema,
  applicationCenterSubmissionInputSchema, applicationUsageModesSchema,
  type ApplicationCenterRelease, type ApplicationCenterSubmissionInput,
} from "@linksense/shared";
import type { z } from "zod";
import type { ApplicationRelease } from "../../generated/prisma/client.js";
import { AppError } from "../../lib/errors.js";
import type { RequestActor } from "../capabilities/types.js";
import type { AuditContext, AuditService } from "../audit/service.js";
import { ApplicationDistributionRepository } from "./distribution-repository.js";
import type { ApplicationPublicationService } from "./publication-service.js";
import type { ApplicationService } from "./service.js";
import { allowedApplicationUsageModes, assertApplicationUsageModes } from "./distribution-policy.js";
import { projectServiceInstallation } from "./runtime-installation-projection.js";

export class ApplicationCenterService {
  constructor(private readonly repository: ApplicationDistributionRepository, private readonly publications: ApplicationPublicationService, private readonly audit: Pick<AuditService, "write">,
    private readonly applications: Pick<ApplicationService, "captureDistributionVersion">) {}

  async catalog(actor: RequestActor, search?: string): Promise<ApplicationCenterRelease[]> {
    assertOrganizationActor(actor);
    return this.project(actor.id, await this.repository.catalog(search));
  }

  async ownPublications(actor: RequestActor): Promise<ApplicationCenterRelease[]> {
    assertOrganizationActor(actor);
    return this.project(actor.id, await this.repository.ownPublications(actor.id));
  }

  async ownReleases(actor: RequestActor, applicationId: string): Promise<ApplicationCenterRelease[]> {
    assertOrganizationActor(actor);
    const application = await this.repository.prisma.application.findFirst({ where: { id: applicationId, ownerId: actor.id, status: { not: "deleted" } }, select: { id: true } });
    if (!application) throw new AppError("FORBIDDEN");
    return this.project(actor.id, await this.repository.prisma.applicationRelease.findMany({ where: { applicationId }, orderBy: { submittedAt: "desc" }, take: 100 }));
  }

  async submit(actor: RequestActor, applicationId: string, input: ApplicationCenterSubmissionInput, context: AuditContext): Promise<ApplicationCenterRelease> {
    assertOrganizationActor(actor);
    const parsed = applicationCenterSubmissionInputSchema.parse(input);
    const owned = await this.repository.prisma.application.findFirst({ where: { id: applicationId, ownerId: actor.id, status: "active" }, select: { id: true, kind: true } });
    if (!owned) throw new AppError("FORBIDDEN");
    assertApplicationUsageModes(owned.kind, parsed.usage_modes);
    let release: ApplicationRelease | null = null;
    await this.applications.captureDistributionVersion(actor, applicationId, parsed, async (tx, version) => {
      release = await this.repository.submit(tx, actor.id, applicationId, version.id, parsed);
    });
    if (!release) throw new AppError("INTERNAL_ERROR");
    const saved: ApplicationRelease = release;
    await this.record(actor, context, "application_center_submitted", saved.id);
    return this.projectOne(actor.id, saved);
  }

  async adminReleases(actor: RequestActor): Promise<ApplicationCenterRelease[]> {
    assertAdmin(actor);
    return this.project(actor.id, await this.repository.prisma.applicationRelease.findMany({ orderBy: { submittedAt: "desc" }, take: 200 }));
  }

  async detail(actor: RequestActor, releaseId: string): Promise<{
    release: ApplicationCenterRelease;
    instructions: string;
    capabilities: Array<{ name: string; type: "plugin" | "skill" }>;
    knowledge_base_count: number;
    mcp_server_count: number;
    interactive_files: string[];
  }> {
    assertAdmin(actor);
    const { release } = await this.repository.release(releaseId);
    const definition = await this.publications.readVersion(release.applicationId, release.versionId);
    const assets = definition.interactivePackageId ? await this.repository.prisma.interactiveApplicationAsset.findMany({ where: { packageId: definition.interactivePackageId }, select: { path: true }, orderBy: { path: "asc" } }) : [];
    return {
      release: await this.projectOne(actor.id, release), instructions: definition.instructions,
      capabilities: definition.capabilities.map(item => ({ name: item.name, type: item.type })),
      knowledge_base_count: definition.knowledgeBaseIds.length, mcp_server_count: definition.mcpServerIds.length,
      interactive_files: assets.map(asset => asset.path),
    };
  }

  async review(actor: RequestActor, releaseId: string, input: z.infer<typeof applicationCenterReviewInputSchema>, context: AuditContext): Promise<void> {
    assertAdmin(actor);
    const parsed = applicationCenterReviewInputSchema.parse(input);
    const { release } = await this.repository.release(releaseId);
    if (parsed.decision === "approved") await this.publications.verifyVersion(release.applicationId, release.versionId);
    await this.repository.review(actor.id, releaseId, parsed.decision, parsed.comment);
    await this.record(actor, context, `application_center_${parsed.decision}`, releaseId);
  }

  async withdraw(actor: RequestActor, releaseId: string, context: AuditContext): Promise<void> {
    assertOrganizationActor(actor);
    await this.repository.withdraw(actor.id, releaseId);
    await this.record(actor, context, "application_center_withdrawn", releaseId);
  }

  async setStatus(actor: RequestActor, applicationId: string, input: z.infer<typeof applicationCenterStatusInputSchema>, context: AuditContext): Promise<void> {
    if (actor.role === "admin") assertAdmin(actor);
    else assertOrganizationActor(actor);
    const parsed = applicationCenterStatusInputSchema.parse(input);
    await this.repository.setStatus(actor.id, actor.role === "admin", applicationId, parsed.status, parsed.reason);
    await this.record(actor, context, `application_center_${parsed.status}`, applicationId);
  }

  private async projectOne(actorId: string, release: ApplicationRelease): Promise<ApplicationCenterRelease> {
    const items = await this.project(actorId, [release]);
    const item = items[0];
    if (!item) throw new AppError("NOT_FOUND");
    return item;
  }

  private async project(actorId: string, releases: ApplicationRelease[]): Promise<ApplicationCenterRelease[]> {
    const runtimeInstallations = await this.repository.prisma.applicationRuntimeInstallation.findMany({ where: { ownerId: actorId, applicationId: { in: releases.map(item => item.applicationId) } } });
    const installedVersions = await this.repository.prisma.applicationVersion.findMany({ where: { id: { in: runtimeInstallations.map(item => item.versionId) }, assetsReady: true } });
    const [versions, listings, installations] = await Promise.all([
      this.repository.prisma.applicationVersion.findMany({ where: { id: { in: releases.map(item => item.versionId) }, assetsReady: true } }),
      this.repository.prisma.applicationListing.findMany({ where: { id: { in: releases.map(item => item.listingId) } } }),
      this.repository.prisma.applicationInstallation.findMany({ where: { ownerId: actorId, sourceApplicationId: { in: releases.map(item => item.applicationId) } } }),
    ]);
    const copyVersions = await this.repository.prisma.applicationVersion.findMany({ where: { id: { in: installations.map(item => item.installedVersionId) }, assetsReady: true } });
    const versionById = new Map(versions.map(item => [item.id, item]));
    const listingById = new Map(listings.map(item => [item.id, item]));
    const installedBySource = new Map(installations.map(item => [item.sourceApplicationId, item.applicationId]));
    return releases.map(release => {
      const version = versionById.get(release.versionId);
      const listing = listingById.get(release.listingId);
      if (!version || !listing) throw new AppError("APPLICATION_DEPENDENCY_UNAVAILABLE");
      const definition = this.publications.parseDefinition(version.definitionJson);
      return applicationCenterReleaseSchema.parse({
        id: release.id, application_id: release.applicationId, version_id: release.versionId, version_number: version.versionLabel,
        name: release.name, kind: definition.kind, description: release.description, usage_instructions: definition.usageInstructions,
        publisher_name: release.publisherName, usage_modes: allowedApplicationUsageModes(definition.kind, applicationUsageModesSchema.parse(release.usageModes)), release_notes: release.releaseNotes,
        status: release.status, listing_status: listing.status, review_comment: release.reviewComment, suspension_reason: listing.suspensionReason,
        submitted_at: release.submittedAt.toISOString(), reviewed_at: release.reviewedAt?.toISOString() ?? null,
        installed_application_id: installedBySource.get(release.applicationId) ?? null,
        copy_installation: projectServiceInstallation(copyVersions.find(item => item.id === installations.find(copy => copy.sourceApplicationId === release.applicationId)?.installedVersionId), version),
        service_installation: projectServiceInstallation(installedVersions.find(item => item.id === runtimeInstallations.find(selected => selected.applicationId === release.applicationId)?.versionId), version),
      });
    });
  }

  private async record(actor: RequestActor, context: AuditContext, action: string, targetId: string): Promise<void> {
    await this.audit.write({ ...context, actorId: actor.id, action, targetType: "application_distribution", targetId, result: "success" });
  }
}

function assertOrganizationActor(actor: RequestActor): void {
  if (actor.status !== "active") throw new AppError("USER_DISABLED");
  if (actor.registrationSource === "self_registration") throw new AppError("FORBIDDEN");
}
function assertAdmin(actor: RequestActor): void {
  // Registration origin controls member access, not an explicitly granted admin role.
  if (actor.status !== "active") throw new AppError("USER_DISABLED");
  if (actor.role !== "admin") throw new AppError("FORBIDDEN");
}
