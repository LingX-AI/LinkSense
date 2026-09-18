import type { ApplicationDistributionChannel, ApplicationUsageMode } from "@linksense/shared";
import { AppError } from "../../lib/errors.js";

export interface ApplicationDistributionAccess {
  applicationKind: string;
  actorId: string;
  organizationMember: boolean;
  ownerId: string;
  applicationStatus: "active" | "disabled" | "deleted";
  publishedVersionId: string | null;
  directModes: readonly ApplicationUsageMode[];
  center: {
    status: "draft" | "published" | "unlisted" | "suspended";
    versionId: string;
    usageModes: readonly ApplicationUsageMode[];
  } | null;
}

export function mergeApplicationUsageModes(grants: ReadonlyArray<readonly ApplicationUsageMode[]>): ApplicationUsageMode[] {
  return (["install", "service"] as const).filter(mode => grants.some(grant => grant.includes(mode)));
}

/** Existing tasks use the owner's installation regardless of their original entry point. */
export function applicationRuntimeChannel(access: Pick<ApplicationDistributionAccess, "actorId" | "ownerId">, channel: ApplicationDistributionChannel): ApplicationDistributionChannel {
  return access.actorId === access.ownerId ? "direct" : channel;
}

export function isApplicationCenterUnavailable(access: ApplicationDistributionAccess): boolean {
  return access.organizationMember && Boolean(access.center?.usageModes.includes("service")) &&
    (access.center?.status === "suspended" || access.center?.status === "unlisted");
}

export function applicationModesForChannel(access: ApplicationDistributionAccess, channel: ApplicationDistributionChannel): ApplicationUsageMode[] {
  if (access.applicationStatus !== "active") return [];
  if (channel === "direct") {
    if (access.actorId === access.ownerId) return allowedApplicationUsageModes(access.applicationKind, ["install", "service"]);
    return access.organizationMember && access.publishedVersionId ? allowedApplicationUsageModes(access.applicationKind, access.directModes) : [];
  }
  if (!access.organizationMember || access.center?.status !== "published") return [];
  return allowedApplicationUsageModes(access.applicationKind, access.center.usageModes);
}

export function allowedApplicationUsageModes(kind: string, modes: readonly ApplicationUsageMode[]): ApplicationUsageMode[] {
  return modes.filter(mode => kind !== "interactive" || mode === "service");
}

export function assertApplicationUsageModes(kind: string, modes: readonly ApplicationUsageMode[]): void {
  if (kind === "interactive" && modes.includes("install")) throw new AppError("VALIDATION_ERROR");
}

/** A center launch always uses the approved release, including for its publisher. */
export function requireApplicationDistributionVersion(
  access: ApplicationDistributionAccess,
  channel: ApplicationDistributionChannel,
  mode: ApplicationUsageMode,
  expectedVersionId?: string,
): string {
  if (!applicationModesForChannel(access, channel).includes(mode)) throw new AppError("FORBIDDEN");
  const versionId = channel === "center" ? access.center?.versionId : access.publishedVersionId;
  if (!versionId) throw new AppError("APPLICATION_DEPENDENCY_UNAVAILABLE");
  if (expectedVersionId && versionId !== expectedVersionId) throw new AppError("CONFLICT");
  return versionId;
}
