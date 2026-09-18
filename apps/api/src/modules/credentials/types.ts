import type { CapabilityRecord, RequestActor } from "../capabilities/types.js";

export type { RequestActor };

export interface CredentialRecord {
  id: string;
  ownerId: string;
  name: string;
  providerType: string;
  encryptedPayload: string;
  encryptionKeyId: string;
  status: "active" | "disabled";
  createdBy: string;
  updatedBy: string | null;
  lastUsedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CredentialBindingRecord {
  id: string;
  credentialId: string;
  capabilityId: string;
  userId: string;
  envKey: string;
  credentialKey: string;
  status: "active" | "revoked";
  createdBy: string;
  revokedBy: string | null;
  revokedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateCredentialRecordInput {
  id?: string;
  ownerId: string;
  name: string;
  providerType: string;
  encryptedPayload: string;
  encryptionKeyId: string;
  status: "active" | "disabled";
  createdBy: string;
  updatedBy: string | null;
}

export interface UpdateCredentialRecordInput {
  name?: string;
  providerType?: string;
  encryptedPayload?: string;
  encryptionKeyId?: string;
  status?: "active" | "disabled";
  updatedBy: string;
  lastUsedAt?: Date;
}

export interface CreateCredentialBindingRecordInput {
  id?: string;
  credentialId: string;
  capabilityId: string;
  userId: string;
  envKey: string;
  credentialKey: string;
  status: "active";
  createdBy: string;
}

export interface CredentialAuditInput {
  actorId: string | null;
  action: string;
  targetType: "credential" | "credential_binding";
  targetId: string;
  result: "success" | "failure" | "rejected";
  metadata?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
}

export interface CredentialStore {
  readRuntimeSnapshot(userId: string, capabilityIds: string[]): Promise<CredentialRuntimeSnapshot>;
  transaction<T>(work: (store: CredentialStore) => Promise<T>): Promise<T>;
  lockCapability(id: string): Promise<void>;
  lockCredential(id: string): Promise<void>;
  findCredential(id: string): Promise<CredentialRecord | null>;
  listCredentials(): Promise<CredentialRecord[]>;
  createCredential(
    input: CreateCredentialRecordInput,
  ): Promise<CredentialRecord>;
  updateCredential(
    id: string,
    input: UpdateCredentialRecordInput,
  ): Promise<CredentialRecord>;
  markCredentialUsed(id: string, at: Date): Promise<void>;
  deleteCredentialGraph(id: string): Promise<void>;

  findBinding(id: string): Promise<CredentialBindingRecord | null>;
  listBindings(input?: {
    capabilityId?: string;
    credentialId?: string;
    userId?: string;
    envKey?: string;
    credentialKey?: string;
    status?: "active" | "revoked";
  }): Promise<CredentialBindingRecord[]>;
  createBinding(
    input: CreateCredentialBindingRecordInput,
  ): Promise<CredentialBindingRecord>;
  revokeBinding(
    id: string,
    actorId: string,
    at: Date,
  ): Promise<CredentialBindingRecord>;

  findCapability(id: string): Promise<CapabilityRecord | null>;
  canUserUseCapability(userId: string, capabilityId: string): Promise<boolean>;
  writeAudit(input: CredentialAuditInput): Promise<void>;
}

export interface CredentialRuntimeSnapshot {
  capabilities: CapabilityRecord[];
  bindings: CredentialBindingRecord[];
  credentials: CredentialRecord[];
}

export interface CredentialResolutionRequest {
  capabilityId: string;
  requiredEnvironmentKeys?: string[];
}

export interface CredentialView {
  id: string;
  name: string;
  provider_type: string;
  secret_keys: string[];
  status: "active" | "disabled";
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CredentialBindingView {
  id: string;
  credential_id: string;
  capability_id: string;
  env_key: string;
  credential_key: string;
  status: "active" | "revoked";
  created_at: string;
  updated_at: string;
}

export type CredentialResolutionBlockCode =
  "required_credential_unavailable" | "credential_binding_ambiguous";

/**
 * Internal-only receipt returned by preflight resolution. The caller must keep
 * this out of API responses and commit it only after app-server has accepted
 * the turn start request.
 */
export interface CredentialUsageReceipt {
  userId: string;
  capabilityId: string;
  credentialIds: string[];
}

export type CredentialResolution =
  | {
      ok: true;
      environment: Record<string, string>;
      usageReceipt: CredentialUsageReceipt;
    }
  | { ok: false; blockCode: CredentialResolutionBlockCode };
