import type { FastifyRequest } from "fastify";
import type {
  CapabilityRiskSummary as SharedCapabilityRiskSummary,
} from "@linksense/shared";

export type UserRole = "admin" | "user";

export interface RequestActor {
  id: string;
  role: UserRole;
  status: "active" | "disabled";
  registrationSource?: "self_registration" | "organization_invitation";
  ipAddress?: string;
  userAgent?: string;
}

export type ResolveRequestActor = (
  request: FastifyRequest,
) => RequestActor | Promise<RequestActor>;

export type CapabilityType = "plugin" | "skill";
export type CapabilityStatus = "active" | "disabled" | "failed";
export type CapabilitySourceType =
  | "local"
  | "url"
  | "marketplace"
  | "clawhub";

export interface CapabilityRecord {
  id: string;
  type: CapabilityType;
  ownerId: string;
  name: string;
  slug: string;
  description: string | null;
  sourceType: CapabilitySourceType;
  marketplaceListingId: string | null;
  marketplaceReleaseId: string | null;
  logoObjectKey: string | null;
  storagePath: string;
  manifestJson: Record<string, unknown> | null;
  riskSummaryJson: Record<string, unknown> | null;
  status: CapabilityStatus;
  installedBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CapabilityPreferenceRecord {
  id: string;
  userId: string;
  capabilityId: string;
  status: "enabled" | "disabled";
  disabledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type CapabilityRiskSummary = SharedCapabilityRiskSummary;

export interface PreparedLogo {
  bytes: Buffer;
  filename: string;
  contentType: string;
}

export interface PreparedCapabilityPackage {
  stagingDirectory: string;
  packageRoot: string;
  type: CapabilityType;
  name: string;
  description: string | null;
  manifest: Record<string, unknown>;
  riskSummary: CapabilityRiskSummary;
  logo: PreparedLogo | null;
}

export interface RemoteCapabilityFile {
  path: string;
  bytes: Buffer;
  size: number;
  sha256: string;
}

export interface ClawHubCapabilityOrigin {
  skillId: string;
  ownerHandle: string;
  slug: string;
  version: string;
  securityStatus: "clean" | "suspicious" | "malicious" | "unverified";
  securityHasWarnings: boolean;
  canonicalUrl: string;
}

export type CapabilityImportSource =
  | {
      kind: "manual_skill";
      name: string;
      description?: string | null;
      skillMarkdown: string;
    }
  | { kind: "zip"; bytes: Buffer; filename: string };

export interface CapabilityAuditInput {
  actorId: string | null;
  action: string;
  targetType?: string;
  targetId?: string;
  result: "success" | "failure" | "rejected";
  metadata?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
}

export interface CreateCapabilityRecordInput {
  id: string;
  type: CapabilityType;
  ownerId: string;
  name: string;
  slug: string;
  description: string | null;
  sourceType: CapabilitySourceType;
  marketplaceListingId: string | null;
  marketplaceReleaseId: string | null;
  logoObjectKey: string | null;
  storagePath: string;
  manifestJson: Record<string, unknown>;
  riskSummaryJson: CapabilityRiskSummary;
  status: "active";
  installedBy: string;
}

export interface UpdateCapabilityRecordInput {
  name?: string;
  slug?: string;
  description?: string | null;
  status?: CapabilityStatus;
  logoObjectKey?: string | null;
  storagePath?: string;
  manifestJson?: Record<string, unknown>;
  riskSummaryJson?: CapabilityRiskSummary;
  sourceType?: CapabilitySourceType;
  marketplaceListingId?: string | null;
  marketplaceReleaseId?: string | null;
}

export interface CreateClawHubInstallationInput {
  userId: string;
  clawHubSkillId: string;
  capabilityId: string;
  installedVersion: string;
  sourceSecurityStatus: ClawHubCapabilityOrigin["securityStatus"];
  sourceSecurityHasWarnings: boolean;
  contentSha256: string;
}

export interface CapabilityStore {
  transaction<T>(work: (store: CapabilityStore) => Promise<T>): Promise<T>;
  lockCapability(id: string): Promise<void>;
  lockSkillNameRegistry(): Promise<void>;
  findCapability(id: string): Promise<CapabilityRecord | null>;
  listCapabilities(): Promise<CapabilityRecord[]>;
  createCapability(
    input: CreateCapabilityRecordInput,
  ): Promise<CapabilityRecord>;
  updateCapability(
    id: string,
    input: UpdateCapabilityRecordInput,
  ): Promise<CapabilityRecord>;
  recordMarketplaceInstall(listingId: string): Promise<void>;
  createClawHubInstallation(
    input: CreateClawHubInstallationInput,
  ): Promise<void>;
  deleteCapabilityGraph(id: string): Promise<void>;

  listPreferences(userId: string): Promise<CapabilityPreferenceRecord[]>;
  upsertPreference(
    userId: string,
    capabilityId: string,
    status: CapabilityPreferenceRecord["status"],
    disabledAt: Date | null,
  ): Promise<CapabilityPreferenceRecord>;

  writeAudit(input: CapabilityAuditInput): Promise<void>;
}

export interface CapabilityLogoStore {
  put(objectKey: string, bytes: Buffer, contentType: string): Promise<void>;
  remove(objectKey: string): Promise<void>;
  presignGet(objectKey: string, expiresSeconds: number): Promise<string>;
  enqueueRemoval?(objectKey: string): Promise<void>;
}

export interface CapabilityPackageCleanup {
  enqueueDirectoryRemoval?(absolutePath: string): Promise<void>;
}
