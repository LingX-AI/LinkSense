import { isApplicationVersionUpdate } from "./runtime-installation-projection.js";
import type { ApplicationDistributionChannel } from "@linksense/shared";
import { Prisma, type PrismaClient } from "../../generated/prisma/client.js";
import { AppError } from "../../lib/errors.js";
import { requireApplicationDistributionVersion } from "./distribution-policy.js";
import { readApplicationDistributionAccess } from "./distribution-repository.js";
import type { ApplicationPublicationService } from "./publication-service.js";
import type { ApplicationRuntimeGate } from "./runtime-gate.js";
import { assertApplicationChangeCurrent } from "./runtime-gate.js";

/** Availability belongs to channels; the selected installation belongs to a user. */
export class ApplicationRuntimeInstallationService {
  constructor(private readonly prisma: PrismaClient, private readonly publications: ApplicationPublicationService,
    readonly gate: ApplicationRuntimeGate) {}

  async install(ownerId: string, applicationId: string, channel: ApplicationDistributionChannel, versionId: string, validateResources: () => Promise<void>): Promise<void> {
    requireApplicationDistributionVersion(await readApplicationDistributionAccess(this.prisma, ownerId, applicationId), channel, "service", versionId);
    await this.gate.change(ownerId, applicationId, async assertCurrent => {
      requireApplicationDistributionVersion(await readApplicationDistributionAccess(this.prisma, ownerId, applicationId), channel, "service", versionId);
      await this.publications.verifyVersion(applicationId, versionId);
      await validateResources();
      await this.prisma.$transaction(async tx => {
        await tx.$queryRaw(Prisma.sql`SELECT id FROM applications WHERE id = ${applicationId}::uuid FOR SHARE`);
        requireApplicationDistributionVersion(await readApplicationDistributionAccess(tx, ownerId, applicationId), channel, "service", versionId);
        const current = await tx.applicationRuntimeInstallation.findUnique({ where: { ownerId_applicationId: { ownerId, applicationId } } });
        if (current?.versionId === versionId) return;
        const target = await tx.applicationVersion.findFirst({ where: { id: versionId, applicationId, assetsReady: true, purpose: "release" } });
        const previous = current ? await tx.applicationVersion.findUnique({ where: { id: current.versionId } }) : null;
        if (!target) throw new AppError("APPLICATION_DEPENDENCY_UNAVAILABLE");
        if (previous && !isApplicationVersionUpdate(previous, target)) throw new AppError("APPLICATION_VERSION_TOO_LOW", { version: previous.versionLabel });
        assertCurrent();
        await activateApplicationInstallation(tx, ownerId, applicationId, versionId, channel);
      });
    });
  }

  /** External visitors follow the creator only at an idle task-start boundary. */
  async refreshExternal(
    ownerId: string,
    applicationId: string,
    validateResources: (versionId: string) => Promise<void>,
  ): Promise<{ previousVersionId: string | null; versionId: string } | null> {
    const available = await readExternalTarget(this.prisma, ownerId, applicationId);
    if (!available || !requiresUpdate(available)) return null;
    try {
      return await this.gate.change(ownerId, applicationId, async assertCurrent => {
        const prepared = await readExternalTarget(this.prisma, ownerId, applicationId);
        if (!prepared) throw new AppError("APPLICATION_EMBED_SESSION_EXPIRED");
        if (!requiresUpdate(prepared)) return null;
        await this.publications.verifyVersion(applicationId, prepared.target.id);
        await validateResources(prepared.target.id);
        return this.prisma.$transaction(async tx => {
          // Publication takes an exclusive lock on this row. Do not install a
          // release that changed while its assets and credentials were checked.
          await tx.$queryRaw(Prisma.sql`SELECT id FROM applications WHERE id = ${applicationId}::uuid FOR SHARE`);
          const current = await readExternalTarget(tx, ownerId, applicationId);
          if (!current) throw new AppError("APPLICATION_EMBED_SESSION_EXPIRED");
          if (current.target.id !== prepared.target.id || current.installed?.id !== prepared.installed?.id) throw new AppError("CONFLICT");
          assertCurrent();
          await activateApplicationInstallation(tx, ownerId, applicationId, prepared.target.id, "external");
          return { previousVersionId: prepared.installed?.id ?? null, versionId: prepared.target.id };
        });
      }, false, { waitForReaders: false });
    } catch (error) {
      // A running task (including pending admission or unfinished native work)
      // keeps its version. The caller still needs a start lease, so an update
      // held by another request continues to block this new start.
      if (error instanceof AppError && error.code === "APPLICATION_RUNTIME_BUSY") return null;
      throw error;
    }
  }
}

type ExternalTargetDatabase = Pick<Prisma.TransactionClient,
  "applicationExternalSession" | "applicationExternalAccess" | "application" | "applicationRuntimeInstallation" | "applicationVersion">;
type ExternalTarget = {
  installed: { id: string; versionLabel: string; versionNumber: number } | null;
  target: { id: string; versionLabel: string; versionNumber: number };
};

async function readExternalTarget(db: ExternalTargetDatabase, ownerId: string, applicationId: string): Promise<ExternalTarget | null> {
  // Session identity is authoritative. Older installed records may have a
  // direct channel; their existing tasks and workspace must still update.
  const session = await db.applicationExternalSession.findUnique({ where: { runtimePrincipalId: ownerId },
    select: { applicationId: true, externalAccessId: true, status: true, absoluteExpiresAt: true, credentialVersion: true } });
  if (!session) return null;
  if (session.applicationId !== applicationId || session.status !== "active" || session.absoluteExpiresAt.getTime() <= Date.now()) throw new AppError("APPLICATION_EMBED_SESSION_EXPIRED");
  const access = await db.applicationExternalAccess.findFirst({ where: { id: session.externalAccessId, applicationId, enabled: true }, select: { id: true, credentialVersion: true } });
  if (!access || access.credentialVersion !== session.credentialVersion) throw new AppError("APPLICATION_EXTERNAL_ACCESS_DISABLED");
  const application = await db.application.findFirst({ where: { id: applicationId, status: "active", developmentOnly: false }, select: { id: true, ownerId: true } });
  if (!application) throw new AppError("APPLICATION_EXTERNAL_ACCESS_DISABLED");
  const [source, selected] = await Promise.all([
    db.applicationRuntimeInstallation.findUnique({ where: { ownerId_applicationId: { ownerId: application.ownerId, applicationId } } }),
    db.applicationRuntimeInstallation.findUnique({ where: { ownerId_applicationId: { ownerId, applicationId } } }),
  ]);
  if (!source) throw new AppError("APPLICATION_PUBLICATION_REQUIRED");
  const target = await db.applicationVersion.findFirst({ where: { id: source.versionId, applicationId, assetsReady: true, purpose: { not: "debug" } }, select: { id: true, versionLabel: true, versionNumber: true } });
  const installed = selected ? await db.applicationVersion.findUnique({ where: { id: selected.versionId }, select: { id: true, versionLabel: true, versionNumber: true } }) : null;
  if (!target || (selected && !installed)) throw new AppError("APPLICATION_DEPENDENCY_UNAVAILABLE");
  return { target, installed };
}

function requiresUpdate({ installed, target }: ExternalTarget): boolean {
  return !installed || (installed.id !== target.id && isApplicationVersionUpdate(installed, target));
}

export async function activateApplicationInstallation(tx: Prisma.TransactionClient, ownerId: string, applicationId: string,
  versionId: string, channel: string): Promise<void> {
  assertApplicationChangeCurrent();
  await tx.applicationRuntimeInstallation.upsert({
    where: { ownerId_applicationId: { ownerId, applicationId } },
    create: { ownerId, applicationId, versionId, channel },
    update: { versionId, channel },
  });
}
