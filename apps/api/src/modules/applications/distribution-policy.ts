import type { ApplicationDistributionChannel, ApplicationUsageMode } from "@linksense/shared";
import { AppError } from "../../lib/errors.js";

export interface ApplicationDistributionAccess {
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

export function applicationModesForChannel(access: ApplicationDistributionAccess, channel: ApplicationDistributionChannel): ApplicationUsageMode[] {
  if (access.applicationStatus !== "active") return [];
  if (channel === "direct") {
    if (access.actorId === access.ownerId) return ["install", "service"];
    return access.organizationMember && access.publishedVersionId ? [...access.directModes] : [];
  }
  if (!access.organizationMember || access.center?.status !== "published") return [];
  return [...access.center.usageModes];
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
