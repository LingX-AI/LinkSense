import { publishedApplicationDefinitionSchema } from "./published-definition.js";
import { applicationUsageModesSchema, type ApplicationCenterSubmissionInput } from "@linksense/shared";
import { Prisma, type PrismaClient, type ApplicationRelease, type ApplicationListing } from "../../generated/prisma/client.js";
import { AppError } from "../../lib/errors.js";
import { mergeApplicationUsageModes, type ApplicationDistributionAccess } from "./distribution-policy.js";

export type ApplicationDistributionDatabase = Pick<Prisma.TransactionClient,
  "application" | "applicationGrant" | "applicationVersion" | "applicationListing" | "applicationRelease" | "applicationInstallation" | "user" | "userGroupMember">;

/** List screens and task projections resolve permissions in bounded batches. */
export async function readApplicationDistributionAccessBatch(db: ApplicationDistributionDatabase, actorId: string, applicationIds: readonly string[]): Promise<Map<string, ApplicationDistributionAccess>> {
  if (applicationIds.length === 0) return new Map();
  const [actor, applications] = await Promise.all([
    db.user.findFirst({ where: { id: actorId, status: "active" }, select: { selfRegisteredAt: true } }),
    db.application.findMany({ where: { id: { in: [...applicationIds] }, status: { not: "deleted" } } }),
  ]);
  if (!actor) return new Map();
  const organizationMember = actor.selfRegisteredAt === null;
  const groups = organizationMember ? await db.userGroupMember.findMany({ where: { userId: actorId, status: "active" }, select: { userGroupId: true } }) : [];
  const [grants, listings] = await Promise.all([
    organizationMember ? db.applicationGrant.findMany({ where: { applicationId: { in: [...applicationIds] }, status: "active", OR: [
      { granteeType: "user", userId: actorId }, { granteeType: "user_group", userGroupId: { in: groups.map(group => group.userGroupId) } },
    ] }, select: { applicationId: true, usageModes: true } }) : Promise.resolve([]),
    organizationMember ? db.applicationListing.findMany({ where: { applicationId: { in: [...applicationIds] } } }) : Promise.resolve([]),
  ]);
  const releases = await db.applicationRelease.findMany({ where: { id: { in: listings.flatMap(listing => listing.currentReleaseId ? [listing.currentReleaseId] : []) }, status: "approved" } });
  const releaseById = new Map(releases.map(release => [release.id, release]));
  const listingByApp = new Map(listings.map(listing => [listing.applicationId, listing]));
  return new Map(applications.map(application => {
    const listing = listingByApp.get(application.id);
    const release = listing?.currentReleaseId ? releaseById.get(listing.currentReleaseId) : undefined;
    return [application.id, {
      actorId, ownerId: application.ownerId, organizationMember,
      applicationKind: application.kind,
      applicationStatus: application.status === "active" ? "active" : "disabled",
      publishedVersionId: application.publishedVersionId,
      directModes: mergeApplicationUsageModes(grants.filter(grant => grant.applicationId === application.id).map(grant => applicationUsageModesSchema.parse(grant.usageModes))),
      center: listing && release && release.applicationId === application.id && release.listingId === listing.id ? {
        status: listing.status === "published" ? "published" : listing.status === "unlisted" ? "unlisted" : listing.status === "suspended" ? "suspended" : "draft",
        versionId: release.versionId, usageModes: applicationUsageModesSchema.parse(release.usageModes),
      } : null,
    }];
  }));
}

export async function readApplicationDistributionAccess(db: ApplicationDistributionDatabase, actorId: string, applicationId: string): Promise<ApplicationDistributionAccess> {
  const [actor, application] = await Promise.all([
    db.user.findFirst({ where: { id: actorId, status: "active" }, select: { selfRegisteredAt: true } }),
    db.application.findFirst({ where: { id: applicationId, status: { not: "deleted" } } }),
  ]);
  if (!actor || !application) throw new AppError("APPLICATION_NOT_FOUND");
  const organizationMember = actor.selfRegisteredAt === null;
  const groups = organizationMember ? await db.userGroupMember.findMany({ where: { userId: actorId, status: "active" }, select: { userGroupId: true } }) : [];
  const [grants, listing] = await Promise.all([
    organizationMember ? db.applicationGrant.findMany({ where: { applicationId, status: "active", OR: [
      { granteeType: "user", userId: actorId },
      { granteeType: "user_group", userGroupId: { in: groups.map(group => group.userGroupId) } },
    ] }, select: { usageModes: true } }) : Promise.resolve([]),
    organizationMember ? db.applicationListing.findUnique({ where: { applicationId } }) : Promise.resolve(null),
  ]);
  const release = listing?.currentReleaseId ? await db.applicationRelease.findFirst({ where: { id: listing.currentReleaseId, listingId: listing.id, applicationId, status: "approved" } }) : null;
  return {
    actorId, ownerId: application.ownerId, organizationMember,
    applicationKind: application.kind,
    applicationStatus: application.status === "active" ? "active" : "disabled",
    publishedVersionId: application.publishedVersionId,
    directModes: mergeApplicationUsageModes(grants.map(grant => applicationUsageModesSchema.parse(grant.usageModes))),
    center: listing && release ? {
      status: listing.status === "published" ? "published" : listing.status === "unlisted" ? "unlisted" : listing.status === "suspended" ? "suspended" : "draft",
      versionId: release.versionId, usageModes: applicationUsageModesSchema.parse(release.usageModes),
    } : null,
  };
}

export class ApplicationDistributionRepository {
  constructor(readonly prisma: PrismaClient) {}

  async ownPublications(ownerId: string): Promise<ApplicationRelease[]> {
    const applications = await this.prisma.application.findMany({
      where: { ownerId, status: { not: "deleted" } }, select: { id: true },
    });
    if (!applications.length) return [];
    return this.prisma.applicationRelease.findMany({
      where: { applicationId: { in: applications.map(application => application.id) } },
      distinct: ["applicationId"],
      orderBy: [{ submittedAt: "desc" }, { id: "desc" }],
      take: 200,
    });
  }

  async release(id: string): Promise<{ release: ApplicationRelease; listing: ApplicationListing }> {
    const release = await this.prisma.applicationRelease.findUnique({ where: { id } });
    if (!release) throw new AppError("NOT_FOUND");
    const listing = await this.prisma.applicationListing.findUnique({ where: { id: release.listingId } });
    if (!listing) throw new AppError("NOT_FOUND");
    return { release, listing };
  }

  async catalog(search?: string): Promise<ApplicationRelease[]> {
    const listings = await this.prisma.applicationListing.findMany({ where: { status: "published" }, select: { currentReleaseId: true, applicationId: true }, take: 200, orderBy: { updatedAt: "desc" } });
    const applications = await this.prisma.application.findMany({ where: { id: { in: listings.map(item => item.applicationId) }, status: "active" }, select: { id: true } });
    const available = new Set(applications.map(item => item.id));
    return this.prisma.applicationRelease.findMany({ where: {
      id: { in: listings.flatMap(item => item.currentReleaseId && available.has(item.applicationId) ? [item.currentReleaseId] : []) }, status: "approved",
      ...(search ? { OR: [{ name: { contains: search, mode: "insensitive" } }, { description: { contains: search, mode: "insensitive" } }] } : {}),
    }, orderBy: { submittedAt: "desc" } });
  }

  async submit(tx: Prisma.TransactionClient, ownerId: string, applicationId: string, versionId: string, input: ApplicationCenterSubmissionInput): Promise<ApplicationRelease> {
      const application = await tx.application.findFirst({ where: { id: applicationId, ownerId, status: "active" } });
      const version = await tx.applicationVersion.findFirst({ where: { id: versionId, applicationId, assetsReady: true } });
      const owner = await tx.user.findFirst({ where: { id: ownerId, status: "active", selfRegisteredAt: null }, select: { name: true } });
      if (!application || !version || !owner) throw new AppError("FORBIDDEN");
      const listing = await tx.applicationListing.upsert({ where: { applicationId }, create: { applicationId, publisherId: ownerId }, update: {} });
      if (listing.status === "suspended") throw new AppError("FORBIDDEN");
      if (await tx.applicationRelease.findFirst({ where: { listingId: listing.id, status: "pending" }, select: { id: true } })) throw new AppError("CONFLICT");
      const definition = publishedApplicationDefinitionSchema.parse(version.definitionJson);
      return tx.applicationRelease.create({ data: {
        listingId: listing.id, applicationId, versionId: version.id, name: definition.name,
        description: definition.description, publisherName: owner.name,
        usageModes: input.usage_modes, releaseNotes: input.release_notes,
      } });
  }

  async review(reviewerId: string, releaseId: string, decision: "approved" | "rejected", comment: string): Promise<void> {
    const { release } = await this.release(releaseId);
    await this.prisma.$transaction(async tx => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM applications WHERE id = ${release.applicationId}::uuid FOR UPDATE`);
      const current = await tx.applicationRelease.findUnique({ where: { id: releaseId } });
      const listing = await tx.applicationListing.findUnique({ where: { id: release.listingId } });
      const application = await tx.application.findFirst({ where: { id: release.applicationId, status: "active" } });
      if (!application || current?.status !== "pending" || !listing || listing.status === "suspended") throw new AppError("CONFLICT");
      await tx.applicationRelease.update({ where: { id: releaseId }, data: { status: decision, reviewerId, reviewComment: comment || null, reviewedAt: new Date() } });
      if (decision === "approved") await tx.applicationListing.update({ where: { id: listing.id }, data: { currentReleaseId: releaseId, status: listing.status === "unlisted" ? "unlisted" : "published" } });
    });
  }

  async withdraw(ownerId: string, releaseId: string): Promise<void> {
    const { release, listing } = await this.release(releaseId);
    if (listing.publisherId !== ownerId) throw new AppError("FORBIDDEN");
    await this.prisma.$transaction(async tx => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM applications WHERE id = ${release.applicationId}::uuid FOR UPDATE`);
      const result = await tx.applicationRelease.updateMany({ where: { id: releaseId, status: "pending" }, data: { status: "withdrawn" } });
      if (result.count !== 1) throw new AppError("CONFLICT");
    });
  }

  async setStatus(actorId: string, admin: boolean, applicationId: string, status: "published" | "unlisted" | "suspended", reason: string): Promise<void> {
    await this.prisma.$transaction(async tx => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM applications WHERE id = ${applicationId}::uuid FOR UPDATE`);
      const listing = await tx.applicationListing.findUnique({ where: { applicationId } });
      if (!listing || (!admin && listing.publisherId !== actorId)) throw new AppError("FORBIDDEN");
      if (!admin && (status === "suspended" || listing.status === "suspended")) throw new AppError("FORBIDDEN");
      if (status === "published" && !listing.currentReleaseId) throw new AppError("CONFLICT");
      await tx.applicationListing.update({ where: { id: listing.id }, data: { status, suspensionReason: status === "suspended" ? reason : null } });
    });
  }
}
