import type { Readable } from "node:stream";

import type { FastifyRequest } from "fastify";

export type KnowledgeActor = {
  id: string;
  role: "user" | "admin";
  status: "active" | "disabled";
  ipAddress?: string;
  userAgent?: string;
};

export type ResolveKnowledgeActor = (
  request: FastifyRequest,
) => KnowledgeActor | Promise<KnowledgeActor>;

export type KnowledgeBaseLifecycleStatus = "active" | "archived" | "deleted";
export type KnowledgeBaseAvailabilityStatus = "enabled" | "disabled";
export type KnowledgeCleanupStatus =
  "pending" | "running" | "failed" | "completed";
export type KnowledgeAccessSource =
  | { type: "owner" }
  | { type: "direct_share"; grantId: string }
  | {
      type: "user_group";
      grantId: string;
      groupId: string;
      groupName: string;
    };

export interface KnowledgeBaseRecord {
  id: string;
  ownerId: string;
  name: string;
  description: string | null;
  sourceType: "local" | "sharepoint";
  lifecycleStatus: KnowledgeBaseLifecycleStatus;
  availabilityStatus: KnowledgeBaseAvailabilityStatus;
  storageUsedBytes: bigint;
  storageReservedBytes: bigint;
  archivedAt: Date | null;
  archivedBy: string | null;
  disabledAt: Date | null;
  disabledBy: string | null;
  disabledReason: string | null;
  deletedAt: Date | null;
  deletedBy: string | null;
  deletionReason: string | null;
  cleanupStatus: KnowledgeCleanupStatus;
  cleanupErrorCode: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface KnowledgeBaseAccessRecord {
  knowledgeBase: KnowledgeBaseRecord;
  owner: { id: string; name: string };
  accessSources: KnowledgeAccessSource[];
  documentCount: number;
  searchableDocumentCount: number;
}

export interface KnowledgeDocumentSearchabilityCriteria {
  currentEmbeddingProfileHash?: string;
}

export interface KnowledgeBaseGrantRecord {
  id: string;
  knowledgeBaseId: string;
  granteeType: "user" | "user_group";
  userId: string | null;
  userGroupId: string | null;
  permission: "use";
  status: "active" | "revoked";
  grantedBy: string;
  revokedBy: string | null;
  revokedAt: Date | null;
  revocationReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface KnowledgeBaseGrantViewRecord extends KnowledgeBaseGrantRecord {
  targetName: string;
  targetEmail: string | null;
}

export type KnowledgeGrantAccessSourceType = "owner" | "direct" | "user_group";

export interface KnowledgeGroupMemberAccessSummary {
  memberAccess: "none" | "some" | "all";
  sourceTypes: KnowledgeGrantAccessSourceType[];
}

export type KnowledgeDocumentStatus =
  "processing" | "ready" | "failed" | "deleted";
export type KnowledgeDocumentVersionStatus =
  "processing" | "ready" | "failed" | "superseded" | "deleted";
export type KnowledgeProcessingOperation =
  "upload" | "replace" | "retry" | "reprocess" | "rebuild_index";
export type KnowledgeProcessingRequestOperation =
  "retry" | "reprocess" | "rebuild_index" | "retry_failed_or_rebuild_index";
export type KnowledgeProcessingStage =
  | "uploading"
  | "validating"
  | "queued"
  | "parsing"
  | "chunking"
  | "image_understanding"
  | "parenting"
  | "embedding"
  | "indexing"
  | "activating"
  | "completed"
  | "failed";

export interface KnowledgeDocumentRecord {
  id: string;
  knowledgeBaseId: string;
  displayName: string;
  normalizedDisplayName: string;
  canonicalExtension: string;
  mimeType: string;
  sizeBytes: bigint;
  originalSha256: string;
  status: KnowledgeDocumentStatus;
  currentVersionId: string | null;
  candidateVersionId: string | null;
  activeProcessingVersionId: string | null;
  embeddingProfileHash: string | null;
  chunkingConfigDigest: string | null;
  retrievalManifestSha256: string | null;
  indexIntegrityDigest: string | null;
  stableErrorCode: string | null;
  cleanupStatus: KnowledgeCleanupStatus;
  cleanupErrorCode: string | null;
  deletedAt: Date | null;
  deletedBy: string | null;
  deletionReason: string | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface KnowledgeDocumentVersionRecord {
  id: string;
  knowledgeBaseId: string;
  documentId: string;
  sourceVersionId: string | null;
  versionNumber: number;
  versionStatus: KnowledgeDocumentVersionStatus;
  operationType: KnowledgeProcessingOperation;
  processingGeneration: string;
  processingStage: KnowledgeProcessingStage;
  progressPercent: number;
  processingRevision: bigint;
  stageAttemptCount: number;
  stableErrorCode: string | null;
  stableErrorParamsJson: Record<string, unknown> | null;
  failedStage: KnowledgeProcessingStage | null;
  retryAt: Date | null;
  cancelRequestedAt: Date | null;
  cancelRequestedBy: string | null;
  cancelReason: string | null;
  originalFilename: string;
  canonicalExtension: string;
  mimeType: string;
  sizeBytes: bigint;
  originalSha256: string;
  doclingBundleObjectId: string | null;
  doclingBundleSha256: string | null;
  displayMarkdownObjectId: string | null;
  displayMarkdownSha256: string | null;
  doclingJsonObjectId: string | null;
  doclingJsonSha256: string | null;
  hybridChunksObjectId: string | null;
  hybridChunksSha256: string | null;
  imageProjectionObjectId: string | null;
  imageProjectionSha256: string | null;
  retrievalManifestObjectId: string | null;
  retrievalManifestSha256: string | null;
  doclingVersion: string | null;
  parsedAssetCount: number | null;
  chunkerVersion: string | null;
  parserConfigDigest: string | null;
  chunkingConfigDigest: string | null;
  imageUnderstandingConfigDigest: string | null;
  processingConfigJson: Record<string, unknown>;
  processingConfigDigest: string | null;
  embeddingProfileHash: string | null;
  indexReady: boolean;
  indexIntegrityDigest: string | null;
  activationPreviousCurrentVersionId: string | null;
  parentCount: number | null;
  childCount: number | null;
  startedAt: Date | null;
  completedAt: Date | null;
  supersededAt: Date | null;
  cleanupEligibleAt: Date | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface KnowledgeDocumentWithProcessing {
  document: KnowledgeDocumentRecord;
  processingVersion: KnowledgeDocumentVersionRecord | null;
  failedCandidateVersion?: KnowledgeDocumentVersionRecord | null;
}

export interface KnowledgeBaseEntryRecord {
  id: string;
  knowledgeBaseId: string;
  parentEntryId: string | null;
  entryType: "folder" | "document";
  name: string;
  normalizedName: string;
  documentId: string | null;
  sourceItemId: string | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export type KnowledgeBaseEntryWithDocument = {
  entry: KnowledgeBaseEntryRecord;
  document: KnowledgeDocumentWithProcessing | null;
  path?: string[];
};

export interface KnowledgeObjectRecord {
  id: string;
  knowledgeBaseId: string;
  documentId: string;
  documentVersionId: string;
  processingGeneration: string;
  objectType:
    | "original"
    | "docling_bundle"
    | "display_markdown"
    | "docling_json"
    | "hybrid_chunks"
    | "retrieval_manifest"
    | "asset";
  objectKey: string;
  assetReferenceId: string | null;
  mimeType: string;
  sizeBytes: bigint;
  checksumSha256: string;
  lifecycleStatus: "active" | "pending_cleanup" | "cleaned";
  cleanupStatus: KnowledgeCleanupStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface KnowledgeAuditInput {
  actorId: string | null;
  action: string;
  targetType?: string;
  targetId?: string;
  result: "success" | "failure" | "rejected";
  metadata?: Record<string, unknown>;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface KnowledgeShareTargetRecord {
  id: string;
  type: "user" | "group";
  name: string;
  email: string | null;
}

export interface RegisteredKnowledgeObject {
  id: string;
  objectKey: string;
  mimeType: string;
  sizeBytes: bigint;
  checksumSha256: string;
}

export interface KnowledgeDocumentIngestionResult {
  original: RegisteredKnowledgeObject;
  originalFilename: string;
  displayName: string;
  normalizedDisplayName: string;
  canonicalExtension: string;
  canonicalMimeType: string;
}

export type KnowledgeDocumentUploadConflictOptions =
  | {
      conflictResolution: "replace";
      replaceDocumentId: string;
    }
  | {
      conflictResolution: "replace_path";
      replaceDocumentId?: never;
    }
  | {
      conflictResolution?: "keep_both";
      replaceDocumentId?: never;
    };

export interface KnowledgeDocumentIngestionAdapter {
  registerUpload(input: {
    knowledgeBaseId: string;
    documentId: string;
    documentVersionId: string;
    processingGeneration: string;
    filename: string;
    declaredMimeType: string;
    stream: Readable;
    maxSizeBytes: number;
    reserveStorage(input: {
      sizeBytes: bigint;
      objectKeys: readonly string[];
    }): Promise<void>;
    heartbeatStorageReservation(): Promise<void>;
    releaseStorageReservation(sizeBytes: bigint): Promise<void>;
  }): Promise<KnowledgeDocumentIngestionResult>;
  discardRegisteredUpload(input: {
    knowledgeBaseId: string;
    object: RegisteredKnowledgeObject;
  }): Promise<void>;
}

export type KnowledgeProcessingCommand = {
  operation: KnowledgeProcessingOperation;
  knowledgeBaseId: string;
  documentId: string;
  documentVersionId: string;
  processingGeneration: string;
  requestedBy: string;
};

export interface KnowledgeProcessingScheduler {
  enqueue(command: KnowledgeProcessingCommand): Promise<void>;
  cancel(command: KnowledgeProcessingCommand): Promise<void>;
  runDocumentExclusiveMutation<T>(
    documentId: string,
    operation: (signal: AbortSignal) => Promise<T>,
  ): Promise<T>;
  abortActiveDocumentMutations(documentIds: readonly string[]): void;
}

export interface KnowledgeOriginalFile {
  filename: string;
  mimeType: string;
  sizeBytes: bigint;
  stream: Readable;
}

export interface KnowledgeAssetFile {
  filename: string;
  mimeType: string;
  sizeBytes: bigint;
  stream: Readable;
}

export interface KnowledgeDocumentAccessAdapter {
  getParsedContent(input: {
    knowledgeBaseId: string;
    documentId: string;
    documentVersionId: string;
  }): Promise<{ markdown: string }>;
  getParsedContentChunk(input: {
    knowledgeBaseId: string;
    documentId: string;
    documentVersionId: string;
    byteOffset: number;
    maxBytes: number;
    verifyIntegrity: boolean;
  }): Promise<{
    markdown: string;
    byteStart: number;
    byteEnd: number;
    totalBytes: number;
    complete: boolean;
  }>;
  getOriginal(input: {
    actorId: string;
    knowledgeBaseId: string;
    documentId: string;
    documentVersionId: string;
  }): Promise<KnowledgeOriginalFile>;
  getAsset(input: {
    actorId: string;
    knowledgeBaseId: string;
    documentId: string;
    documentVersionId: string;
    assetReferenceId: string;
  }): Promise<KnowledgeAssetFile>;
}

export interface KnowledgeDocumentEvent {
  type: "knowledge_document_processing_updated" | "knowledge_document_deleted";
  knowledge_base_id: string;
  document_id: string;
  processing_generation: string | null;
  status: KnowledgeDocumentStatus;
  stage: KnowledgeProcessingStage | null;
  progress_percent: number | null;
  revision: number;
  retry_at: string | null;
  retry_attempt: number;
  stable_error_code: string | null;
  updated_at: string;
}

export interface KnowledgeEventSource {
  subscribe(input: {
    actorId: string;
    knowledgeBaseId: string;
    signal: AbortSignal;
  }): AsyncIterable<KnowledgeDocumentEvent>;
}

export interface KnowledgeDocumentEventSink {
  publish(input: {
    knowledgeBaseId: string;
    documentId: string;
    documentVersionId: string;
    processingGeneration: string;
  }): Promise<void>;
}

export type RegisterDocumentUploadInput = {
  knowledgeBaseId: string;
  actorId: string;
  documentId: string;
  versionId: string;
  processingGeneration: string;
  ocrEnabled: boolean;
  storageReservationId: string;
  storageReservationLeaseToken: string;
  ingestion: KnowledgeDocumentIngestionResult;
  entry: {
    parentEntryId: string | null;
    segments: string[];
    sourceItemId?: string;
  };
  storageQuotaBytes: bigint;
  now: Date;
} & (
  | {
      conflictResolution: "replace";
      replaceDocumentId: string;
      pathDocumentIdBeforeUpload?: never;
    }
  | {
      conflictResolution: "replace_path";
      replaceDocumentId?: never;
      pathDocumentIdBeforeUpload: string | null;
    }
  | {
      conflictResolution?: "keep_both";
      replaceDocumentId?: never;
      pathDocumentIdBeforeUpload?: never;
    }
);

export type RegisterDocumentUploadResult =
  | { status: "registered"; value: KnowledgeDocumentWithProcessing }
  | { status: "duplicate"; existingDocumentId: string }
  | {
      status: "name_conflict";
      existingDocumentId: string;
      displayName: string;
    }
  | { status: "quota_exceeded" }
  | { status: "replace_target_not_found" }
  | { status: "processing_conflict" };

export type ReserveKnowledgeStorageResult =
  { status: "reserved" } | { status: "quota_exceeded" };

export type PrepareKnowledgeProcessingResult =
  | { status: "prepared"; value: KnowledgeDocumentWithProcessing }
  | { status: "not_found" }
  | { status: "processing_conflict" }
  | { status: "invalid_state" };

export type CancelKnowledgeProcessingResult =
  | { status: "cancelled"; value: KnowledgeDocumentWithProcessing }
  | { status: "not_found" }
  | { status: "not_cancellable" };

export type DeleteKnowledgeDocumentResult =
  | { status: "deleted" }
  | { status: "not_found" }
  | { status: "processing_conflict" };

export type RenameKnowledgeDocumentResult =
  | { status: "renamed"; value: KnowledgeDocumentWithProcessing }
  | { status: "not_found" }
  | { status: "name_conflict"; existingDocumentId: string };

export type KnowledgeBaseApplicationUsageRecord = {
  id: string;
  name: string;
  status: "active" | "disabled";
};

export interface KnowledgeStore {
  transaction<T>(work: (store: KnowledgeStore) => Promise<T>): Promise<T>;
  lockKnowledgeBase(id: string): Promise<void>;
  listUndeletedDocumentIds(knowledgeBaseId: string): Promise<string[]>;
  hasProcessingDocuments(knowledgeBaseId: string): Promise<boolean>;
  listKnowledgeBaseApplicationUsages(
    knowledgeBaseId: string,
  ): Promise<KnowledgeBaseApplicationUsageRecord[]>;

  findKnowledgeBase(id: string): Promise<KnowledgeBaseRecord | null>;
  findKnowledgeBaseAccess(
    id: string,
    actorId: string,
    searchability?: KnowledgeDocumentSearchabilityCriteria,
  ): Promise<KnowledgeBaseAccessRecord | null>;
  listAccessibleKnowledgeBases(input: {
    actorId: string;
    scope: "all" | "mine" | "shared";
    lifecycleStatus: "active" | "archived";
    search?: string;
    cursor?: string;
    limit: number;
    searchability?: KnowledgeDocumentSearchabilityCriteria;
  }): Promise<{
    items: KnowledgeBaseAccessRecord[];
    nextCursor: string | null;
  }>;
  createKnowledgeBase(input: {
    id: string;
    ownerId: string;
    name: string;
    description: string | null;
    sourceType: KnowledgeBaseRecord["sourceType"];
    now: Date;
  }): Promise<KnowledgeBaseRecord>;
  updateKnowledgeBase(
    id: string,
    input: { name?: string; description?: string | null; now: Date },
  ): Promise<KnowledgeBaseRecord>;
  archiveKnowledgeBase(input: {
    id: string;
    actorId: string;
    now: Date;
  }): Promise<KnowledgeBaseRecord>;
  restoreKnowledgeBase(input: {
    id: string;
    now: Date;
  }): Promise<KnowledgeBaseRecord>;
  deleteKnowledgeBase(input: {
    id: string;
    actorId: string;
    reason: string;
    now: Date;
  }): Promise<KnowledgeBaseRecord>;

  listActiveGroupIds(userId: string): Promise<string[]>;
  isActiveUser(id: string): Promise<boolean>;
  groupExists(id: string): Promise<boolean>;
  listGrants(input: {
    knowledgeBaseId: string;
    cursor?: string;
    limit: number;
  }): Promise<{
    items: KnowledgeBaseGrantViewRecord[];
    nextCursor: string | null;
  }>;
  findGrant(id: string): Promise<KnowledgeBaseGrantRecord | null>;
  findGrantView(id: string): Promise<KnowledgeBaseGrantViewRecord | null>;
  findActiveGrantForTarget(input: {
    knowledgeBaseId: string;
    targetType: "user" | "user_group";
    targetId: string;
  }): Promise<KnowledgeBaseGrantRecord | null>;
  createGrant(input: {
    id: string;
    knowledgeBaseId: string;
    targetType: "user" | "user_group";
    targetId: string;
    actorId: string;
    now: Date;
  }): Promise<KnowledgeBaseGrantRecord>;
  summarizeGroupMemberRemainingAccess(input: {
    knowledgeBaseId: string;
    ownerId: string;
    groupId: string;
  }): Promise<KnowledgeGroupMemberAccessSummary>;
  revokeGrant(input: {
    id: string;
    actorId: string;
    reason: string | null;
    now: Date;
  }): Promise<KnowledgeBaseGrantRecord>;
  searchShareTargets(input: {
    type: "user" | "group";
    search: string;
    cursor?: string;
    limit: number;
  }): Promise<{
    items: KnowledgeShareTargetRecord[];
    nextCursor: string | null;
  }>;

  listDocuments(input: {
    knowledgeBaseId: string;
    includeOwnerOnlyStates: boolean;
    search?: string;
    status?: Exclude<KnowledgeDocumentStatus, "deleted">;
    cursor?: string;
    limit: number;
  }): Promise<{
    items: KnowledgeDocumentWithProcessing[];
    nextCursor: string | null;
  }>;
  listDirectoryEntries(input: {
    knowledgeBaseId: string;
    parentEntryId: string | null;
    includeOwnerOnlyStates: boolean;
    cursor?: string;
    limit: number;
  }): Promise<{
    breadcrumbs: KnowledgeBaseEntryRecord[];
    items: KnowledgeBaseEntryWithDocument[];
    nextCursor: string | null;
  }>;
  listFlatDirectoryEntries(input: {
    knowledgeBaseId: string;
    includeOwnerOnlyStates: boolean;
    cursor?: string;
    limit: number;
  }): Promise<{
    breadcrumbs: KnowledgeBaseEntryRecord[];
    items: KnowledgeBaseEntryWithDocument[];
    nextCursor: string | null;
  }>;
  findDocumentIdAtPath(input: {
    knowledgeBaseId: string;
    parentEntryId: string | null;
    segments: string[];
  }): Promise<string | null>;
  findDocument(
    knowledgeBaseId: string,
    documentId: string,
  ): Promise<KnowledgeDocumentWithProcessing | null>;
  findDocumentVersion(
    id: string,
  ): Promise<KnowledgeDocumentVersionRecord | null>;
  renameDocument(input: {
    knowledgeBaseId: string;
    documentId: string;
    actorId: string;
    displayName: string;
    normalizedDisplayName: string;
    directoryTarget?: {
      parentEntryId: string | null;
      segments: string[];
      sourceItemId?: string;
    };
    now: Date;
  }): Promise<RenameKnowledgeDocumentResult>;
  listRebuildableDocumentPage(input: {
    knowledgeBaseId: string;
    afterDocumentId: string | null;
    limit: number;
  }): Promise<{ documentIds: string[]; nextCursor: string | null }>;
  reserveStorage(input: {
    reservationId: string;
    reservationLeaseToken: string;
    knowledgeBaseId: string;
    documentId: string;
    documentVersionId: string;
    actorId: string;
    sizeBytes: bigint;
    objectKeys: readonly string[];
    storageQuotaBytes: bigint;
    now: Date;
  }): Promise<ReserveKnowledgeStorageResult>;
  heartbeatStorageReservation(input: {
    reservationId: string;
    reservationLeaseToken: string;
    knowledgeBaseId: string;
    now: Date;
  }): Promise<void>;
  releaseStorageReservation(input: {
    reservationId: string;
    reservationLeaseToken: string;
    knowledgeBaseId: string;
    sizeBytes: bigint;
    now: Date;
  }): Promise<void>;
  registerDocumentUpload(
    input: RegisterDocumentUploadInput,
  ): Promise<RegisterDocumentUploadResult>;
  markProcessingEnqueueFailed(input: {
    knowledgeBaseId: string;
    documentId: string;
    versionId: string;
    processingGeneration: string;
    stableErrorCode: string;
    now: Date;
  }): Promise<void>;
  prepareProcessing(input: {
    knowledgeBaseId: string;
    documentId: string;
    actorId: string;
    operation: KnowledgeProcessingRequestOperation;
    newVersionId: string;
    processingGeneration: string;
    now: Date;
  }): Promise<PrepareKnowledgeProcessingResult>;
  cancelProcessing(input: {
    knowledgeBaseId: string;
    documentId: string;
    actorId: string;
    reason: string;
    now: Date;
  }): Promise<CancelKnowledgeProcessingResult>;
  deleteDocument(input: {
    knowledgeBaseId: string;
    documentId: string;
    actorId: string;
    reason: string;
    now: Date;
  }): Promise<DeleteKnowledgeDocumentResult>;
  /** Omit requestedIds to resolve all current access; an explicit array filters it. */
  resolveUsableKnowledgeBaseIds(
    actorId: string,
    requestedIds?: string[],
  ): Promise<string[]>;
  persistTurnKnowledgeBaseSnapshot(input: {
    turnId: string;
    knowledgeBaseIds: string[];
    now: Date;
  }): Promise<void>;
  getTurnKnowledgeBaseIds(input: {
    turnId?: string;
    codexTurnId?: string;
  }): Promise<string[]>;
  writeAudit(input: KnowledgeAuditInput): Promise<void>;
}
