import { randomUUID } from "node:crypto";
import type { Readable } from "node:stream";

import {
  knowledgeDocumentFormats,
  knowledgeFilePreviewFormats,
  knowledgeDocumentRebuildBatchSize,
  type KnowledgeBaseGrantRevocationResult,
  uuidSchema,
} from "@linksense/shared";

import { AppError } from "../../lib/errors.js";
import { normalizeKnowledgeDirectoryPath } from "./directory-path.js";
import {
  haveSameKnowledgeDocumentIds,
  runKnowledgeDocumentExclusiveMutation,
} from "./document-mutation.js";
import type { KnowledgeMaintenanceGate } from "./maintenance.js";
import type {
  KnowledgeActor,
  KnowledgeAssetFile,
  KnowledgeBaseAccessRecord,
  KnowledgeBaseGrantViewRecord,
  KnowledgeBaseRecord,
  KnowledgeDocumentAccessAdapter,
  KnowledgeDocumentEvent,
  KnowledgeDocumentEventSink,
  KnowledgeDocumentIngestionAdapter,
  KnowledgeDocumentRecord,
  KnowledgeDocumentSearchabilityCriteria,
  KnowledgeDocumentUploadConflictOptions,
  KnowledgeDocumentVersionRecord,
  KnowledgeDocumentWithProcessing,
  KnowledgeEventSource,
  KnowledgeOriginalFile,
  KnowledgeProcessingCommand,
  KnowledgeProcessingRequestOperation,
  KnowledgeProcessingScheduler,
  KnowledgeStore,
} from "./types.js";

const DEFAULT_MAX_FILE_SIZE_BYTES = 200 * 1024 * 1024;
const DEFAULT_STORAGE_QUOTA_BYTES = 10n * 1024n * 1024n * 1024n;

export interface KnowledgeServiceOptions {
  store: KnowledgeStore;
  ingestionAdapter: KnowledgeDocumentIngestionAdapter;
  scheduler: KnowledgeProcessingScheduler;
  documentAccessAdapter?: KnowledgeDocumentAccessAdapter;
  eventSource?: KnowledgeEventSource;
  eventSink?: KnowledgeDocumentEventSink;
  maintenanceGate?: Pick<
    KnowledgeMaintenanceGate,
    "assertAvailable" | "assertDocumentRebuildAvailable"
  >;
  currentEmbeddingProfileHash?: string | (() => string | undefined);
  maxFileSizeBytes?: number;
  maxFilesPerBatch?: number;
  storageQuotaBytes?: bigint;
  now?: () => Date;
  createId?: () => string;
}

export interface KnowledgeBaseView {
  id: string;
  name: string;
  description: string | null;
  source_type: KnowledgeBaseRecord["sourceType"];
  source_sync: null;
  lifecycle_status: KnowledgeBaseRecord["lifecycleStatus"];
  availability_status: KnowledgeBaseRecord["availabilityStatus"];
  owner: { id: string; name: string };
  is_owner: boolean;
  access_sources: Array<{
    type: "owner" | "direct" | "user_group";
    id?: string;
    name?: string;
  }>;
  document_count: number;
  ready_document_count: number;
  storage_used_bytes: number;
  storage_reserved_bytes: number;
  storage_quota_bytes: number;
  permissions: {
    view_content: boolean;
    update: boolean;
    manage_documents: boolean;
    manage_grants: boolean;
    create_grants: boolean;
    revoke_grants: boolean;
    archive: boolean;
    restore: boolean;
    delete: boolean;
    remove_direct_share: boolean;
  };
  archived_at: string | null;
  disabled_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface KnowledgeGrantView {
  id: string;
  knowledge_base_id: string;
  target_type: "user" | "user_group";
  target: {
    id: string;
    name: string;
    email_hint: string | null;
  };
  status: "active" | "revoked";
  can_revoke: boolean;
  created_at: string;
  updated_at: string;
  revoked_at: string | null;
}

export interface KnowledgeDocumentView {
  id: string;
  knowledge_base_id: string;
  display_name: string;
  canonical_extension: (typeof knowledgeDocumentFormats)[number];
  mime_type: string;
  size_bytes: number;
  status: KnowledgeDocumentRecord["status"];
  current_version_id: string | null;
  searchable: boolean;
  rebuild_required: boolean;
  processing: {
    operation: "upload" | "replace" | "retry" | "reprocess" | "rebuild";
    processing_generation: string;
    stage: KnowledgeDocumentVersionRecord["processingStage"];
    progress_percent: number;
    revision: number;
    stable_error_code: string | null;
    retry_at: string | null;
    retry_attempt: number;
    cancellable: boolean;
  } | null;
  candidate_failure: {
    operation: "upload" | "replace" | "retry" | "reprocess" | "rebuild";
    processing_generation: string;
    revision: number;
    stable_error_code: string;
    retryable: true;
  } | null;
  preview: {
    parsed: true;
    original_supported: boolean;
    renderer: "file" | null;
  };
  created_at: string;
  updated_at: string;
}

export type KnowledgeBaseEntryView =
  | {
      id: string;
      knowledge_base_id: string;
      parent_entry_id: string | null;
      entry_type: "folder";
      name: string;
      path?: string[];
      document: null;
      updated_at: string;
    }
  | {
      id: string;
      knowledge_base_id: string;
      parent_entry_id: string | null;
      entry_type: "document";
      name: string;
      path?: string[];
      document: KnowledgeDocumentView;
      updated_at: string;
    };

export interface KnowledgeSelectionResult {
  requested_ids: string[];
  usable_ids: string[];
  unavailable_ids: string[];
}

export interface KnowledgeDocumentRebuildBatchResult {
  items: Array<
    | {
        document_id: string;
        status: "accepted";
        document: KnowledgeDocumentView;
      }
    | {
        document_id: string;
        status: "rejected";
        error_code: string;
      }
  >;
  next_cursor: string | null;
}

export class KnowledgeService {
  readonly #store: KnowledgeStore;
  readonly #ingestionAdapter: KnowledgeDocumentIngestionAdapter;
  readonly #scheduler: KnowledgeProcessingScheduler;
  readonly #documentAccessAdapter: KnowledgeDocumentAccessAdapter | undefined;
  readonly #eventSource: KnowledgeEventSource | undefined;
  readonly #eventSink: KnowledgeDocumentEventSink | undefined;
  readonly #maintenanceGate:
    | Pick<
        KnowledgeMaintenanceGate,
        "assertAvailable" | "assertDocumentRebuildAvailable"
      >
    | undefined;
  readonly #maxFileSizeBytes: number;
  readonly #maxFilesPerBatch: number;
  readonly #currentEmbeddingProfileHash:
    string | (() => string | undefined) | undefined;
  readonly #storageQuotaBytes: bigint;
  readonly #now: () => Date;
  readonly #createId: () => string;

  constructor(options: KnowledgeServiceOptions) {
    this.#store = options.store;
    this.#ingestionAdapter = options.ingestionAdapter;
    this.#scheduler = options.scheduler;
    this.#documentAccessAdapter = options.documentAccessAdapter;
    this.#eventSource = options.eventSource;
    this.#eventSink = options.eventSink;
    this.#maintenanceGate = options.maintenanceGate;
    this.#currentEmbeddingProfileHash = options.currentEmbeddingProfileHash;
    this.#maxFileSizeBytes =
      options.maxFileSizeBytes ?? DEFAULT_MAX_FILE_SIZE_BYTES;
    this.#maxFilesPerBatch = options.maxFilesPerBatch ?? 100;
    this.#storageQuotaBytes =
      options.storageQuotaBytes ?? DEFAULT_STORAGE_QUOTA_BYTES;
    this.#now = options.now ?? (() => new Date());
    this.#createId = options.createId ?? randomUUID;
  }

  getUploadLimits(actor: KnowledgeActor): {
    max_file_size_bytes: number;
    max_files_per_batch: number;
    storage_quota_bytes: number;
  } {
    assertActiveActor(actor);
    return {
      max_file_size_bytes: this.#maxFileSizeBytes,
      max_files_per_batch: this.#maxFilesPerBatch,
      storage_quota_bytes: safeBigIntNumber(this.#storageQuotaBytes),
    };
  }

  async listKnowledgeBases(
    actor: KnowledgeActor,
    input: {
      scope: "all" | "mine" | "shared";
      lifecycleStatus?: "all" | "active" | "archived";
      search?: string;
      cursor?: string;
      limit: number;
    },
  ): Promise<{ items: KnowledgeBaseView[]; next_cursor: string | null }> {
    assertActiveActor(actor);
    const result = await this.#store.listAccessibleKnowledgeBases({
      actorId: actor.id,
      scope: input.scope,
      lifecycleStatus: input.lifecycleStatus ?? "active",
      ...(input.search === undefined ? {} : { search: input.search }),
      ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
      limit: input.limit,
      searchability: this.#searchabilityCriteria(),
    });
    return {
      items: result.items.map((value) => this.#knowledgeBaseView(actor, value)),
      next_cursor: result.nextCursor,
    };
  }

  async getKnowledgeBase(
    actor: KnowledgeActor,
    knowledgeBaseId: string,
  ): Promise<KnowledgeBaseView> {
    assertActiveActor(actor);
    const access = await this.#requireAccess(actor, knowledgeBaseId);
    if (
      access.knowledgeBase.availabilityStatus === "disabled" &&
      access.knowledgeBase.ownerId !== actor.id
    ) {
      throw new AppError("KNOWLEDGE_BASE_DISABLED");
    }
    return this.#knowledgeBaseView(actor, access);
  }

  async createKnowledgeBase(
    actor: KnowledgeActor,
    input: {
      name: string;
      description?: string | null;
      sourceType?: KnowledgeBaseRecord["sourceType"];
    },
  ): Promise<KnowledgeBaseView> {
    assertActiveActor(actor);
    const now = this.#now();
    const id = this.#createId();
    await this.#store.transaction(async (store) => {
      await store.createKnowledgeBase({
        id,
        ownerId: actor.id,
        name: input.name.trim(),
        description: normalizeNullableText(input.description),
        sourceType: input.sourceType ?? "local",
        now,
      });
      await store.writeAudit(
        auditInput(actor, "knowledge_base.created", "knowledge_base", id, {
          lifecycle_status: "active",
        }),
      );
    });
    return this.getKnowledgeBase(actor, id);
  }

  async updateKnowledgeBase(
    actor: KnowledgeActor,
    knowledgeBaseId: string,
    input: { name?: string; description?: string | null },
  ): Promise<KnowledgeBaseView> {
    assertActiveActor(actor);
    const now = this.#now();
    await this.#store.transaction(async (store) => {
      await requireOwnedWritableBase(store, actor, knowledgeBaseId);
      await store.updateKnowledgeBase(knowledgeBaseId, {
        ...(input.name === undefined ? {} : { name: input.name.trim() }),
        ...(input.description === undefined
          ? {}
          : { description: normalizeNullableText(input.description) }),
        now,
      });
      await store.writeAudit(
        auditInput(
          actor,
          "knowledge_base.updated",
          "knowledge_base",
          knowledgeBaseId,
          {
            changed_fields: Object.keys(input),
          },
        ),
      );
    });
    return this.getKnowledgeBase(actor, knowledgeBaseId);
  }

  async archiveKnowledgeBase(
    actor: KnowledgeActor,
    knowledgeBaseId: string,
  ): Promise<KnowledgeBaseView> {
    assertActiveActor(actor);
    const now = this.#now();
    await this.#store.transaction(async (store) => {
      await store.lockKnowledgeBase(knowledgeBaseId);
      const base = await requireEnabledOwnedBase(store, actor, knowledgeBaseId);
      if (base.lifecycleStatus !== "active") {
        throw new AppError("KNOWLEDGE_BASE_NOT_ACTIVE");
      }
      await store.archiveKnowledgeBase({
        id: knowledgeBaseId,
        actorId: actor.id,
        now,
      });
      await store.writeAudit(
        auditInput(
          actor,
          "knowledge_base.archived",
          "knowledge_base",
          knowledgeBaseId,
          {
            lifecycle_status: "archived",
          },
        ),
      );
    });
    return this.getKnowledgeBase(actor, knowledgeBaseId);
  }

  async restoreKnowledgeBase(
    actor: KnowledgeActor,
    knowledgeBaseId: string,
  ): Promise<KnowledgeBaseView> {
    assertActiveActor(actor);
    const now = this.#now();
    await this.#store.transaction(async (store) => {
      await store.lockKnowledgeBase(knowledgeBaseId);
      const base = await requireEnabledOwnedBase(store, actor, knowledgeBaseId);
      if (base.lifecycleStatus !== "archived") {
        throw new AppError("CONFLICT");
      }
      await store.restoreKnowledgeBase({ id: knowledgeBaseId, now });
      await store.writeAudit(
        auditInput(
          actor,
          "knowledge_base.restored",
          "knowledge_base",
          knowledgeBaseId,
          {
            lifecycle_status: "active",
          },
        ),
      );
    });
    return this.getKnowledgeBase(actor, knowledgeBaseId);
  }

  async deleteKnowledgeBase(
    actor: KnowledgeActor,
    knowledgeBaseId: string,
    reason: string,
  ): Promise<void> {
    assertActiveActor(actor);
    const base = await requireEnabledOwnedBase(
      this.#store,
      actor,
      knowledgeBaseId,
    );
    if (base.lifecycleStatus !== "archived") {
      throw new AppError("KNOWLEDGE_BASE_ARCHIVE_REQUIRED");
    }
    const applicationUsages =
      await this.#store.listKnowledgeBaseApplicationUsages(knowledgeBaseId);
    if (applicationUsages.length > 0) {
      throw new AppError("KNOWLEDGE_BASE_IN_USE", {
        usages: applicationUsages.map((application) => ({
          type: "application",
          resource_id: application.id,
          name: application.name,
          status: application.status,
        })),
      });
    }
    await this.#assertMaintenanceAvailable();
    const now = this.#now();
    const documentIds =
      await this.#store.listUndeletedDocumentIds(knowledgeBaseId);
    await runKnowledgeDocumentExclusiveMutation({
      scheduler: this.#scheduler,
      documentIds,
      operation: async (signal, orderedDocumentIds) => {
        if (signal.aborted) throw new AppError("KNOWLEDGE_DOCUMENT_BUSY");
        await this.#store.transaction(async (store) => {
          await store.lockKnowledgeBase(knowledgeBaseId);
          const currentBase = await requireEnabledOwnedBase(
            store,
            actor,
            knowledgeBaseId,
          );
          if (currentBase.lifecycleStatus !== "archived") {
            throw new AppError("KNOWLEDGE_BASE_ARCHIVE_REQUIRED");
          }
          const currentApplicationUsages =
            await store.listKnowledgeBaseApplicationUsages(knowledgeBaseId);
          if (currentApplicationUsages.length > 0) {
            throw new AppError("KNOWLEDGE_BASE_IN_USE", {
              usages: currentApplicationUsages.map((application) => ({
                type: "application",
                resource_id: application.id,
                name: application.name,
                status: application.status,
              })),
            });
          }
          const currentDocumentIds =
            await store.listUndeletedDocumentIds(knowledgeBaseId);
          if (
            signal.aborted ||
            !haveSameKnowledgeDocumentIds(
              currentDocumentIds,
              orderedDocumentIds,
            )
          ) {
            throw new AppError("KNOWLEDGE_DOCUMENT_BUSY");
          }
          await store.deleteKnowledgeBase({
            id: knowledgeBaseId,
            actorId: actor.id,
            reason,
            now,
          });
          await store.writeAudit(
            auditInput(
              actor,
              "knowledge_base.deleted",
              "knowledge_base",
              knowledgeBaseId,
              { reason },
            ),
          );
        });
        this.#scheduler.abortActiveDocumentMutations(orderedDocumentIds);
      },
    });
  }

  async searchShareTargets(
    actor: KnowledgeActor,
    input: {
      knowledgeBaseId?: string;
      type: "user" | "group";
      search: string;
      cursor?: string;
      limit: number;
    },
  ): Promise<{
    items: Array<{
      id: string;
      type: "user" | "group";
      name: string;
      secondary_label: string | null;
    }>;
    next_cursor: string | null;
  }> {
    assertActiveActor(actor);
    const canViewFullEmail = input.knowledgeBaseId !== undefined;
    if (input.knowledgeBaseId !== undefined) {
      await requireOwnedWritableBase(this.#store, actor, input.knowledgeBaseId);
    }
    const result = await this.#store.searchShareTargets({
      type: input.type,
      search: input.search,
      ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
      limit: input.limit,
    });
    return {
      items: result.items
        .filter((item) => item.id !== actor.id || item.type !== "user")
        .map((item) => ({
          id: item.id,
          type: item.type,
          name: item.name,
          secondary_label:
            item.email === null
              ? null
              : canViewFullEmail
                ? item.email
                : maskEmail(item.email),
        })),
      next_cursor: result.nextCursor,
    };
  }

  async listGrants(
    actor: KnowledgeActor,
    knowledgeBaseId: string,
    input: { cursor?: string; limit: number },
  ): Promise<{ items: KnowledgeGrantView[]; next_cursor: string | null }> {
    assertActiveActor(actor);
    const base = await this.#store.findKnowledgeBase(knowledgeBaseId);
    if (base === null || base.lifecycleStatus === "deleted") {
      throw new AppError("KNOWLEDGE_BASE_NOT_FOUND");
    }
    if (base.availabilityStatus !== "enabled") {
      throw new AppError("KNOWLEDGE_BASE_DISABLED");
    }
    if (base.ownerId !== actor.id) {
      throw new AppError("KNOWLEDGE_BASE_ACCESS_DENIED");
    }
    const grants = await this.#store.listGrants({
      knowledgeBaseId,
      ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
      limit: input.limit,
    });
    return {
      items: grants.items.map((grant) => grantView(actor, base, grant)),
      next_cursor: grants.nextCursor,
    };
  }

  async createGrant(
    actor: KnowledgeActor,
    knowledgeBaseId: string,
    input: { targetType: "user" | "user_group"; targetId: string },
  ): Promise<KnowledgeGrantView> {
    assertActiveActor(actor);
    const now = this.#now();
    const grantId = this.#createId();
    const created = await this.#store.transaction(async (store) => {
      await store.lockKnowledgeBase(knowledgeBaseId);
      const base = await requireOwnedWritableBase(
        store,
        actor,
        knowledgeBaseId,
      );
      if (input.targetType === "user") {
        if (
          input.targetId === base.ownerId ||
          !(await store.isActiveUser(input.targetId))
        ) {
          throw new AppError("KNOWLEDGE_BASE_GRANT_TARGET_INVALID");
        }
      } else if (!(await store.groupExists(input.targetId))) {
        throw new AppError("KNOWLEDGE_BASE_GRANT_TARGET_INVALID");
      }
      if (
        (await store.findActiveGrantForTarget({
          knowledgeBaseId,
          targetType: input.targetType,
          targetId: input.targetId,
        })) !== null
      ) {
        throw new AppError("KNOWLEDGE_BASE_GRANT_CONFLICT");
      }
      await store.createGrant({
        id: grantId,
        knowledgeBaseId,
        targetType: input.targetType,
        targetId: input.targetId,
        actorId: actor.id,
        now,
      });
      await store.writeAudit(
        auditInput(
          actor,
          "knowledge_base.grant_created",
          "knowledge_base_grant",
          grantId,
          {
            knowledge_base_id: knowledgeBaseId,
            target_type: input.targetType,
            target_id: input.targetId,
          },
        ),
      );
      const withTarget = await store.findGrantView(grantId);
      if (withTarget === null) throw new AppError("INTERNAL_ERROR");
      return { base, grant: withTarget };
    });
    return grantView(actor, created.base, created.grant);
  }

  async revokeGrant(
    actor: KnowledgeActor,
    knowledgeBaseId: string,
    grantId: string,
    reason?: string,
  ): Promise<KnowledgeBaseGrantRevocationResult> {
    assertActiveActor(actor);
    const now = this.#now();
    return this.#store.transaction(async (store) => {
      await store.lockKnowledgeBase(knowledgeBaseId);
      const base = await store.findKnowledgeBase(knowledgeBaseId);
      if (base === null || base.lifecycleStatus === "deleted") {
        throw new AppError("KNOWLEDGE_BASE_NOT_FOUND");
      }
      const grant = await store.findGrant(grantId);
      if (
        grant === null ||
        grant.knowledgeBaseId !== knowledgeBaseId ||
        grant.status !== "active"
      ) {
        throw new AppError("NOT_FOUND");
      }
      const recipientRemovingDirectGrant =
        grant.granteeType === "user" && grant.userId === actor.id;
      const owner = base.ownerId === actor.id;
      if (base.availabilityStatus !== "enabled") {
        throw new AppError("KNOWLEDGE_BASE_DISABLED");
      }
      if (!recipientRemovingDirectGrant && !owner) {
        throw new AppError("KNOWLEDGE_BASE_ACCESS_DENIED");
      }
      await store.revokeGrant({
        id: grantId,
        actorId: actor.id,
        reason: normalizeNullableText(reason),
        now,
      });
      const targetId = grant.userId ?? grant.userGroupId;
      if (targetId === null) throw new AppError("INTERNAL_ERROR");
      let remainingAccess: KnowledgeBaseGrantRevocationResult["remaining_access"];
      if (grant.granteeType === "user") {
        remainingAccess = await remainingUserAccess(
          store,
          knowledgeBaseId,
          targetId,
        );
      } else {
        const summary = await store.summarizeGroupMemberRemainingAccess({
          knowledgeBaseId,
          ownerId: base.ownerId,
          groupId: targetId,
        });
        remainingAccess = {
          subject_type: "user_group",
          member_access: summary.memberAccess,
          source_types: summary.sourceTypes,
        };
      }
      await store.writeAudit(
        auditInput(
          actor,
          recipientRemovingDirectGrant
            ? "knowledge_base.direct_grant_removed"
            : "knowledge_base.grant_revoked",
          "knowledge_base_grant",
          grantId,
          {
            knowledge_base_id: knowledgeBaseId,
            target_type: grant.granteeType,
            target_id: grant.userId ?? grant.userGroupId,
            ...(reason === undefined ? {} : { reason }),
          },
        ),
      );
      return {
        revoked_grant_id: grantId,
        target_type: grant.granteeType,
        target_id: targetId,
        remaining_access: remainingAccess,
      };
    });
  }

  async listDocuments(
    actor: KnowledgeActor,
    knowledgeBaseId: string,
    input: {
      search?: string;
      status?: "processing" | "ready" | "failed";
      cursor?: string;
      limit: number;
    },
  ): Promise<{
    items: KnowledgeDocumentView[];
    next_cursor: string | null;
    has_processing_documents: boolean;
  }> {
    assertActiveActor(actor);
    const access = await this.#requireContentAccess(actor, knowledgeBaseId);
    const owner = access.knowledgeBase.ownerId === actor.id;
    if (!owner && input.status !== undefined && input.status !== "ready") {
      throw new AppError("KNOWLEDGE_BASE_ACCESS_DENIED");
    }
    const [result, hasProcessingDocuments] = await Promise.all([
      this.#store.listDocuments({
        knowledgeBaseId,
        includeOwnerOnlyStates: owner,
        ...(input.search === undefined ? {} : { search: input.search }),
        ...(input.status === undefined ? {} : { status: input.status }),
        ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
        limit: input.limit,
      }),
      owner
        ? this.#store.hasProcessingDocuments(knowledgeBaseId)
        : Promise.resolve(false),
    ]);
    return {
      items: result.items.map((item) =>
        this.#documentView(owner ? item : recipientSafeDocument(item)),
      ),
      next_cursor: result.nextCursor,
      has_processing_documents: hasProcessingDocuments,
    };
  }

  async listDirectoryEntries(
    actor: KnowledgeActor,
    knowledgeBaseId: string,
    input: {
      parentEntryId?: string;
      view?: "directory" | "flat";
      cursor?: string;
      limit: number;
    },
  ): Promise<{
    breadcrumbs: Array<{ id: string; name: string }>;
    items: KnowledgeBaseEntryView[];
    next_cursor: string | null;
  }> {
    assertActiveActor(actor);
    const access = await this.#requireContentAccess(actor, knowledgeBaseId);
    const owner = access.knowledgeBase.ownerId === actor.id;
    const result =
      input.view === "flat"
        ? await this.#store.listFlatDirectoryEntries({
            knowledgeBaseId,
            includeOwnerOnlyStates: owner,
            ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
            limit: input.limit,
          })
        : await this.#store.listDirectoryEntries({
            knowledgeBaseId,
            parentEntryId: input.parentEntryId ?? null,
            includeOwnerOnlyStates: owner,
            ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
            limit: input.limit,
          });
    return {
      breadcrumbs: result.breadcrumbs.map((entry) => ({
        id: entry.id,
        name: entry.name,
      })),
      items: result.items.map(({ entry, document, path }) => {
        if (entry.entryType === "folder") {
          return {
            id: entry.id,
            knowledge_base_id: entry.knowledgeBaseId,
            parent_entry_id: entry.parentEntryId,
            entry_type: "folder" as const,
            name: entry.name,
            ...(path === undefined ? {} : { path }),
            document: null,
            updated_at: entry.updatedAt.toISOString(),
          };
        }
        if (document === null) throw new AppError("INTERNAL_ERROR");
        return {
          id: entry.id,
          knowledge_base_id: entry.knowledgeBaseId,
          parent_entry_id: entry.parentEntryId,
          entry_type: "document" as const,
          name: entry.name,
          ...(path === undefined ? {} : { path }),
          document: this.#documentView(
            owner ? document : recipientSafeDocument(document),
          ),
          updated_at: entry.updatedAt.toISOString(),
        };
      }),
      next_cursor: result.nextCursor,
    };
  }

  async listDocumentsForAuthorizedApplicationTurn(
    knowledgeBaseId: string,
    input: {
      status: "ready";
      cursor?: string;
      limit: number;
    },
  ): Promise<{ items: KnowledgeDocumentView[]; next_cursor: string | null }> {
    const result = await this.#store.listDocuments({
      knowledgeBaseId,
      includeOwnerOnlyStates: false,
      status: input.status,
      ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
      limit: input.limit,
    });
    return {
      items: result.items.map((item) =>
        this.#documentView(recipientSafeDocument(item)),
      ),
      next_cursor: result.nextCursor,
    };
  }

  async getDocument(
    actor: KnowledgeActor,
    knowledgeBaseId: string,
    documentId: string,
    documentVersionId?: string,
  ): Promise<KnowledgeDocumentView> {
    const access = await this.#requireContentAccess(actor, knowledgeBaseId);
    const value = await requireDocument(
      this.#store,
      knowledgeBaseId,
      documentId,
    );
    if (documentVersionId !== undefined) {
      const { version } = await this.#requireReadableDocumentVersion(
        knowledgeBaseId,
        documentId,
        documentVersionId,
        access.knowledgeBase.ownerId === actor.id,
      );
      return this.#documentView(value, version);
    }
    if (
      access.knowledgeBase.ownerId !== actor.id &&
      value.document.status !== "ready"
    ) {
      throw new AppError("KNOWLEDGE_DOCUMENT_NOT_FOUND");
    }
    return this.#documentView(
      access.knowledgeBase.ownerId === actor.id
        ? value
        : recipientSafeDocument(value),
    );
  }

  async uploadDocument(
    actor: KnowledgeActor,
    knowledgeBaseId: string,
    input: {
      filename: string;
      declaredMimeType: string;
      stream: Readable;
      ocrEnabled?: boolean;
      relativePath?: string;
      parentEntryId?: string;
      sourceItemId?: string;
    } & KnowledgeDocumentUploadConflictOptions,
  ): Promise<KnowledgeDocumentView> {
    assertActiveActor(actor);
    await requireOwnedWritableBase(this.#store, actor, knowledgeBaseId);
    await this.#assertMaintenanceAvailable();
    assertValidUploadConflictOptions(input);
    const directoryPath = normalizeKnowledgeDirectoryPath(
      input.relativePath ?? input.filename,
      input.filename,
    );
    if (
      (input.parentEntryId !== undefined &&
        !uuidSchema.safeParse(input.parentEntryId).success) ||
      (input.sourceItemId !== undefined &&
        !uuidSchema.safeParse(input.sourceItemId).success)
    ) {
      throw new AppError("VALIDATION_ERROR");
    }
    if (
      input.ocrEnabled !== undefined &&
      typeof input.ocrEnabled !== "boolean"
    ) {
      throw new AppError("VALIDATION_ERROR");
    }
    const ocrEnabled = input.ocrEnabled ?? false;
    const pathDocumentIdBeforeUpload: string | null =
      input.conflictResolution === "replace_path"
        ? await this.#store.findDocumentIdAtPath({
            knowledgeBaseId,
            parentEntryId: input.parentEntryId ?? null,
            segments: directoryPath.segments,
          })
        : null;
    const documentId =
      input.replaceDocumentId ?? pathDocumentIdBeforeUpload ?? this.#createId();
    const versionId = this.#createId();
    const processingGeneration = this.#createId();
    const storageReservationId = this.#createId();
    const storageReservationLeaseToken = this.#createId();
    const ingestion = await this.#ingestionAdapter.registerUpload({
      knowledgeBaseId,
      documentId,
      documentVersionId: versionId,
      processingGeneration,
      filename: input.filename,
      declaredMimeType: input.declaredMimeType,
      stream: input.stream,
      maxSizeBytes: this.#maxFileSizeBytes,
      reserveStorage: async ({ sizeBytes, objectKeys }) => {
        const reservation = await this.#store.transaction((store) =>
          store.reserveStorage({
            reservationId: storageReservationId,
            reservationLeaseToken: storageReservationLeaseToken,
            knowledgeBaseId,
            documentId,
            documentVersionId: versionId,
            actorId: actor.id,
            sizeBytes,
            objectKeys,
            storageQuotaBytes: this.#storageQuotaBytes,
            now: this.#now(),
          }),
        );
        if (reservation.status === "quota_exceeded") {
          throw new AppError("KNOWLEDGE_STORAGE_QUOTA_EXCEEDED");
        }
      },
      heartbeatStorageReservation: () =>
        this.#store.transaction((store) =>
          store.heartbeatStorageReservation({
            reservationId: storageReservationId,
            reservationLeaseToken: storageReservationLeaseToken,
            knowledgeBaseId,
            now: this.#now(),
          }),
        ),
      releaseStorageReservation: (sizeBytes) =>
        this.#store.transaction((store) =>
          store.releaseStorageReservation({
            reservationId: storageReservationId,
            reservationLeaseToken: storageReservationLeaseToken,
            knowledgeBaseId,
            sizeBytes,
            now: this.#now(),
          }),
        ),
    });
    const now = this.#now();
    let result;
    try {
      result = await this.#store.transaction(async (store) => {
        const registration = await store.registerDocumentUpload({
          knowledgeBaseId,
          actorId: actor.id,
          documentId,
          versionId,
          processingGeneration,
          ocrEnabled,
          storageReservationId,
          storageReservationLeaseToken,
          ingestion,
          entry: {
            parentEntryId: input.parentEntryId ?? null,
            segments: directoryPath.segments,
            ...(input.sourceItemId === undefined
              ? {}
              : { sourceItemId: input.sourceItemId }),
          },
          ...(input.conflictResolution === "replace"
            ? {
                conflictResolution: "replace" as const,
                replaceDocumentId: input.replaceDocumentId,
              }
            : input.conflictResolution === "replace_path"
              ? {
                  conflictResolution: "replace_path" as const,
                  pathDocumentIdBeforeUpload,
                }
              : input.conflictResolution === "keep_both"
                ? { conflictResolution: "keep_both" as const }
                : {}),
          storageQuotaBytes: this.#storageQuotaBytes,
          now,
        });
        await store.writeAudit(
          auditInput(
            actor,
            registration.status === "registered"
              ? "knowledge_document.upload_registered"
              : "knowledge_document.upload_rejected",
            "knowledge_base",
            knowledgeBaseId,
            {
              result: registration.status,
              size_bytes: ingestion.original.sizeBytes.toString(),
              canonical_extension: ingestion.canonicalExtension,
              ocr_enabled: ocrEnabled,
            },
          ),
        );
        return registration;
      });
    } catch (error) {
      if (await this.#discardUpload(knowledgeBaseId, ingestion.original)) {
        await this.#releaseStorageReservationBestEffort(
          storageReservationId,
          storageReservationLeaseToken,
          knowledgeBaseId,
          ingestion.original.sizeBytes,
        );
      }
      throw error;
    }
    if (result.status !== "registered") {
      if (await this.#discardUpload(knowledgeBaseId, ingestion.original)) {
        await this.#releaseStorageReservationBestEffort(
          storageReservationId,
          storageReservationLeaseToken,
          knowledgeBaseId,
          ingestion.original.sizeBytes,
        );
      }
      switch (result.status) {
        case "duplicate":
          throw new AppError("KNOWLEDGE_DOCUMENT_DUPLICATE", {
            existing_document_id: result.existingDocumentId,
          });
        case "name_conflict":
          throw new AppError("KNOWLEDGE_DOCUMENT_NAME_CONFLICT", {
            existing_document_id: result.existingDocumentId,
            display_name: result.displayName,
          });
        case "quota_exceeded":
          throw new AppError("KNOWLEDGE_STORAGE_QUOTA_EXCEEDED");
        case "processing_conflict":
          throw new AppError("KNOWLEDGE_DOCUMENT_PROCESSING_CONFLICT");
        case "replace_target_not_found":
          throw new AppError("KNOWLEDGE_DOCUMENT_NOT_FOUND");
      }
    }
    const value = result.value;
    const processing = value.processingVersion;
    if (processing === null) throw new AppError("INTERNAL_ERROR");
    await this.#enqueueOrFail(actor, value.document, processing);
    return this.#documentView(value);
  }

  async retryDocument(
    actor: KnowledgeActor,
    knowledgeBaseId: string,
    documentId: string,
  ): Promise<KnowledgeDocumentView> {
    return this.#startDocumentOperation(
      actor,
      knowledgeBaseId,
      documentId,
      "retry",
    );
  }

  async reprocessDocument(
    actor: KnowledgeActor,
    knowledgeBaseId: string,
    documentId: string,
  ): Promise<KnowledgeDocumentView> {
    return this.#startDocumentOperation(
      actor,
      knowledgeBaseId,
      documentId,
      "reprocess",
    );
  }

  async rebuildDocument(
    actor: KnowledgeActor,
    knowledgeBaseId: string,
    documentId: string,
  ): Promise<KnowledgeDocumentView> {
    return this.#startDocumentOperation(
      actor,
      knowledgeBaseId,
      documentId,
      "rebuild_index",
    );
  }

  async renameDocument(
    actor: KnowledgeActor,
    knowledgeBaseId: string,
    documentId: string,
    input: {
      displayName: string;
      relativePath?: string;
      sourceItemId?: string;
    },
  ): Promise<KnowledgeDocumentView> {
    assertActiveActor(actor);
    await requireOwnedWritableBase(this.#store, actor, knowledgeBaseId);
    const displayName = normalizeDocumentDisplayName(input.displayName);
    const directoryPath =
      input.relativePath === undefined
        ? undefined
        : normalizeKnowledgeDirectoryPath(input.relativePath, displayName);
    if (
      input.sourceItemId !== undefined &&
      (!uuidSchema.safeParse(input.sourceItemId).success ||
        directoryPath === undefined)
    ) {
      throw new AppError("VALIDATION_ERROR");
    }
    const result = await this.#store.transaction(async (store) => {
      const renamed = await store.renameDocument({
        knowledgeBaseId,
        documentId,
        actorId: actor.id,
        displayName,
        normalizedDisplayName: displayName.toLocaleLowerCase("und"),
        ...(directoryPath === undefined
          ? {}
          : {
              directoryTarget: {
                parentEntryId: null,
                segments: directoryPath.segments,
                ...(input.sourceItemId === undefined
                  ? {}
                  : { sourceItemId: input.sourceItemId }),
              },
            }),
        now: this.#now(),
      });
      if (renamed.status === "not_found") {
        throw new AppError("KNOWLEDGE_DOCUMENT_NOT_FOUND");
      }
      if (renamed.status === "name_conflict") {
        throw new AppError("KNOWLEDGE_DOCUMENT_NAME_CONFLICT", {
          existing_document_id: renamed.existingDocumentId,
          display_name: displayName,
        });
      }
      await store.writeAudit(
        auditInput(
          actor,
          "knowledge_document.renamed",
          "knowledge_document",
          documentId,
          {
            knowledge_base_id: knowledgeBaseId,
          },
        ),
      );
      return renamed.value;
    });
    return this.#documentView(result);
  }

  async rebuildDocuments(
    actor: KnowledgeActor,
    knowledgeBaseId: string,
    documentIds?: string[],
    afterDocumentId?: string,
  ): Promise<KnowledgeDocumentRebuildBatchResult> {
    assertActiveActor(actor);
    await requireOwnedWritableBase(this.#store, actor, knowledgeBaseId);
    await this.#assertMaintenanceAvailable();
    if (documentIds !== undefined && afterDocumentId !== undefined) {
      throw new AppError("VALIDATION_ERROR");
    }
    const page =
      documentIds === undefined
        ? await this.#store.listRebuildableDocumentPage({
            knowledgeBaseId,
            afterDocumentId: afterDocumentId ?? null,
            limit: knowledgeDocumentRebuildBatchSize,
          })
        : {
            documentIds: boundedUniqueRebuildIds(documentIds),
            nextCursor: null,
          };
    if (page.documentIds.length > knowledgeDocumentRebuildBatchSize) {
      throw new AppError("INTERNAL_ERROR");
    }
    const items = await mapWithConcurrency(
      page.documentIds,
      4,
      async (documentId) => {
        try {
          return {
            document_id: documentId,
            status: "accepted" as const,
            document: await this.#startDocumentOperation(
              actor,
              knowledgeBaseId,
              documentId,
              "retry_failed_or_rebuild_index",
            ),
          };
        } catch (error) {
          return {
            document_id: documentId,
            status: "rejected" as const,
            error_code:
              error instanceof AppError ? error.code : "INTERNAL_ERROR",
          };
        }
      },
    );
    return { items, next_cursor: page.nextCursor };
  }

  async cancelDocumentProcessing(
    actor: KnowledgeActor,
    knowledgeBaseId: string,
    documentId: string,
    reason: string,
  ): Promise<KnowledgeDocumentView> {
    assertActiveActor(actor);
    await requireOwnedWritableBase(this.#store, actor, knowledgeBaseId);
    const before = await requireDocument(
      this.#store,
      knowledgeBaseId,
      documentId,
    );
    const active = before.processingVersion;
    const result = await this.#store.transaction(async (store) => {
      const cancelled = await store.cancelProcessing({
        knowledgeBaseId,
        documentId,
        actorId: actor.id,
        reason,
        now: this.#now(),
      });
      if (cancelled.status === "not_found") {
        throw new AppError("KNOWLEDGE_DOCUMENT_NOT_FOUND");
      }
      if (cancelled.status === "not_cancellable") {
        throw new AppError("KNOWLEDGE_PROCESSING_CANCEL_NOT_ALLOWED");
      }
      await store.writeAudit(
        auditInput(
          actor,
          "knowledge_document.processing_cancelled",
          "knowledge_document",
          documentId,
          {
            knowledge_base_id: knowledgeBaseId,
            reason,
          },
        ),
      );
      return cancelled.value;
    });
    if (active !== null) {
      await this.#cancelSchedulerBestEffort({
        operation: active.operationType,
        knowledgeBaseId,
        documentId,
        documentVersionId: active.id,
        processingGeneration: active.processingGeneration,
        requestedBy: actor.id,
      });
    }
    return this.#documentView(result);
  }

  async deleteDocument(
    actor: KnowledgeActor,
    knowledgeBaseId: string,
    documentId: string,
    reason: string,
  ): Promise<void> {
    assertActiveActor(actor);
    await requireOwnedWritableBase(this.#store, actor, knowledgeBaseId);
    await this.#assertMaintenanceAvailable();
    const deletion = await runKnowledgeDocumentExclusiveMutation({
      scheduler: this.#scheduler,
      documentIds: [documentId],
      operation: async (signal) => {
        if (signal.aborted) throw new AppError("KNOWLEDGE_DOCUMENT_BUSY");
        const committed = await this.#store.transaction(async (store) => {
          await store.lockKnowledgeBase(knowledgeBaseId);
          await requireOwnedWritableBase(store, actor, knowledgeBaseId);
          const before = await requireDocument(
            store,
            knowledgeBaseId,
            documentId,
          );
          const eventVersion = await this.#eventVersion(before);
          if (signal.aborted) throw new AppError("KNOWLEDGE_DOCUMENT_BUSY");
          const result = await store.deleteDocument({
            knowledgeBaseId,
            documentId,
            actorId: actor.id,
            reason,
            now: this.#now(),
          });
          if (result.status === "not_found") {
            throw new AppError("KNOWLEDGE_DOCUMENT_NOT_FOUND");
          }
          if (result.status === "processing_conflict") {
            throw new AppError("KNOWLEDGE_DOCUMENT_PROCESSING_CONFLICT");
          }
          await store.writeAudit(
            auditInput(
              actor,
              "knowledge_document.deleted",
              "knowledge_document",
              documentId,
              {
                knowledge_base_id: knowledgeBaseId,
                reason,
              },
            ),
          );
          return { before, eventVersion };
        });
        this.#scheduler.abortActiveDocumentMutations([documentId]);
        return committed;
      },
    });
    if (deletion.before.processingVersion !== null) {
      await this.#cancelSchedulerBestEffort({
        operation: deletion.before.processingVersion.operationType,
        knowledgeBaseId,
        documentId,
        documentVersionId: deletion.before.processingVersion.id,
        processingGeneration:
          deletion.before.processingVersion.processingGeneration,
        requestedBy: actor.id,
      });
    }
    if (deletion.eventVersion !== null) {
      await this.#publishDocumentEventBestEffort(
        knowledgeBaseId,
        documentId,
        deletion.eventVersion,
      );
    }
  }

  async getParsedContent(
    actor: KnowledgeActor,
    knowledgeBaseId: string,
    documentId: string,
    documentVersionId?: string,
  ): Promise<{
    document_id: string;
    document_version_id: string;
    markdown: string;
  }> {
    const access = await this.#requireContentAccess(actor, knowledgeBaseId);
    const owner = access.knowledgeBase.ownerId === actor.id;
    const { document, versionId } =
      documentVersionId === undefined
        ? await this.#requireReadyDocument(knowledgeBaseId, documentId, owner)
        : await this.#requireReadableDocumentVersion(
            knowledgeBaseId,
            documentId,
            documentVersionId,
            owner,
          );
    const adapter = this.#requireDocumentAccessAdapter();
    const content = await adapter.getParsedContent({
      knowledgeBaseId,
      documentId: document.id,
      documentVersionId: versionId,
    });
    return {
      document_id: document.id,
      document_version_id: versionId,
      markdown: content.markdown,
    };
  }

  async getParsedContentChunk(
    actor: KnowledgeActor,
    knowledgeBaseId: string,
    documentId: string,
    documentVersionId: string,
    input: {
      byteOffset: number;
      maxBytes: number;
      verifyIntegrity: boolean;
    },
  ): Promise<{
    markdown: string;
    byteStart: number;
    byteEnd: number;
    totalBytes: number;
    complete: boolean;
  }> {
    await this.#requireContentAccess(actor, knowledgeBaseId);
    const current = await this.#requireReadyDocument(
      knowledgeBaseId,
      documentId,
    );
    if (current.versionId !== documentVersionId) {
      throw new AppError("KNOWLEDGE_DOCUMENT_NOT_FOUND");
    }
    return this.#requireDocumentAccessAdapter().getParsedContentChunk({
      knowledgeBaseId,
      documentId: current.document.id,
      documentVersionId,
      byteOffset: input.byteOffset,
      maxBytes: input.maxBytes,
      verifyIntegrity: input.verifyIntegrity,
    });
  }

  async getParsedContentChunkForAuthorizedApplicationTurn(
    knowledgeBaseId: string,
    documentId: string,
    documentVersionId: string,
    input: {
      byteOffset: number;
      maxBytes: number;
      verifyIntegrity: boolean;
    },
  ) {
    const current = await this.#requireReadyDocument(
      knowledgeBaseId,
      documentId,
    );
    if (current.versionId !== documentVersionId) {
      throw new AppError("KNOWLEDGE_DOCUMENT_NOT_FOUND");
    }
    return this.#requireDocumentAccessAdapter().getParsedContentChunk({
      knowledgeBaseId,
      documentId: current.document.id,
      documentVersionId,
      byteOffset: input.byteOffset,
      maxBytes: input.maxBytes,
      verifyIntegrity: input.verifyIntegrity,
    });
  }

  async downloadOriginal(
    actor: KnowledgeActor,
    knowledgeBaseId: string,
    documentId: string,
    documentVersionId?: string,
  ): Promise<KnowledgeOriginalFile> {
    const resolved = await this.#openOriginal(
      actor,
      knowledgeBaseId,
      documentId,
      documentVersionId,
      "original",
    );
    await this.#writeOriginalReadAudit(
      actor,
      "knowledge_document.original_downloaded",
      knowledgeBaseId,
      documentId,
      resolved,
    );
    return resolved.file;
  }

  async getOriginalPreview(
    actor: KnowledgeActor,
    knowledgeBaseId: string,
    documentId: string,
    documentVersionId?: string,
  ): Promise<KnowledgeOriginalFile> {
    const resolved = await this.#openOriginal(
      actor,
      knowledgeBaseId,
      documentId,
      documentVersionId,
      "preview",
    );
    await this.#writeOriginalReadAudit(
      actor,
      "knowledge_document.original_previewed",
      knowledgeBaseId,
      documentId,
      resolved,
    );
    return resolved.file;
  }

  async #openOriginal(
    actor: KnowledgeActor,
    knowledgeBaseId: string,
    documentId: string,
    documentVersionId: string | undefined,
    purpose: "original" | "preview",
  ): Promise<{
    file: KnowledgeOriginalFile;
    documentVersionId: string;
    canonicalExtension: string;
  }> {
    const access = await this.#requireContentAccess(actor, knowledgeBaseId);
    const owner = access.knowledgeBase.ownerId === actor.id;
    const resolved =
      documentVersionId === undefined
        ? await this.#requireReadyDocument(knowledgeBaseId, documentId, owner)
        : await this.#requireReadableDocumentVersion(
            knowledgeBaseId,
            documentId,
            documentVersionId,
            owner,
          );
    const canonicalExtension =
      resolved.version?.canonicalExtension ??
      resolved.document.canonicalExtension;
    if (purpose === "preview" && !isFilePreviewFormat(canonicalExtension)) {
      throw new AppError("KNOWLEDGE_PREVIEW_UNSUPPORTED");
    }
    const input = {
      actorId: actor.id,
      knowledgeBaseId,
      documentId,
      documentVersionId: resolved.versionId,
    };
    const adapter = this.#requireDocumentAccessAdapter();
    const file = await adapter.getOriginal(input);
    return {
      file,
      documentVersionId: resolved.versionId,
      canonicalExtension,
    };
  }

  async #writeOriginalReadAudit(
    actor: KnowledgeActor,
    action:
      | "knowledge_document.original_downloaded"
      | "knowledge_document.original_previewed",
    knowledgeBaseId: string,
    documentId: string,
    resolved: {
      file?: KnowledgeOriginalFile;
      documentVersionId: string;
      canonicalExtension: string;
    },
  ): Promise<void> {
    try {
      await this.#store.writeAudit(
        auditInput(actor, action, "knowledge_document", documentId, {
          knowledge_base_id: knowledgeBaseId,
          document_version_id: resolved.documentVersionId,
          canonical_extension: resolved.canonicalExtension,
        }),
      );
    } catch (error) {
      resolved.file?.stream.destroy();
      throw error;
    }
  }

  async getAsset(
    actor: KnowledgeActor,
    knowledgeBaseId: string,
    documentId: string,
    documentVersionId: string,
    assetReferenceId: string,
  ): Promise<KnowledgeAssetFile> {
    const access = await this.#requireContentAccess(actor, knowledgeBaseId);
    await this.#requireReadableDocumentVersion(
      knowledgeBaseId,
      documentId,
      documentVersionId,
      access.knowledgeBase.ownerId === actor.id,
    );
    return this.#requireDocumentAccessAdapter().getAsset({
      actorId: actor.id,
      knowledgeBaseId,
      documentId,
      documentVersionId,
      assetReferenceId,
    });
  }

  async subscribeEvents(
    actor: KnowledgeActor,
    knowledgeBaseId: string,
    signal: AbortSignal,
  ): Promise<AsyncIterable<KnowledgeDocumentEvent>> {
    await this.#requireContentAccess(actor, knowledgeBaseId);
    if (this.#eventSource === undefined) {
      throw new AppError("KNOWLEDGE_PROCESSING_UNAVAILABLE");
    }
    return this.#eventSource.subscribe({
      actorId: actor.id,
      knowledgeBaseId,
      signal,
    });
  }

  async resolveUsableKnowledgeBaseIds(
    actor: KnowledgeActor,
    requestedIds: string[],
  ): Promise<KnowledgeSelectionResult> {
    assertActiveActor(actor);
    const requested = uniqueIds(requestedIds);
    const usable = await this.#store.resolveUsableKnowledgeBaseIds(
      actor.id,
      requested,
    );
    const usableSet = new Set(usable);
    return {
      requested_ids: requested,
      usable_ids: usable,
      unavailable_ids: requested.filter((id) => !usableSet.has(id)),
    };
  }

  async persistTurnKnowledgeBaseSnapshot(
    turnId: string,
    knowledgeBaseIds: string[],
  ): Promise<void> {
    await this.#store.transaction((store) =>
      store.persistTurnKnowledgeBaseSnapshot({
        turnId,
        knowledgeBaseIds: uniqueIds(knowledgeBaseIds),
        now: this.#now(),
      }),
    );
  }

  async getTurnRetrievalScope(
    actor: KnowledgeActor,
    locator: { turnId?: string; codexTurnId?: string },
  ): Promise<KnowledgeSelectionResult> {
    assertActiveActor(actor);
    const [requested, usable] = await Promise.all([
      this.#store.getTurnKnowledgeBaseIds(locator),
      this.#store.resolveUsableKnowledgeBaseIds(actor.id),
    ]);
    const usableSet = new Set(usable);
    return {
      requested_ids: requested,
      // Selection controls focus and ordering, never resource authorization.
      usable_ids: uniqueIds([
        ...requested.filter((id) => usableSet.has(id)),
        ...usable,
      ]),
      unavailable_ids: requested.filter((id) => !usableSet.has(id)),
    };
  }

  async #startDocumentOperation(
    actor: KnowledgeActor,
    knowledgeBaseId: string,
    documentId: string,
    operation: KnowledgeProcessingRequestOperation,
  ): Promise<KnowledgeDocumentView> {
    assertActiveActor(actor);
    await requireOwnedWritableBase(this.#store, actor, knowledgeBaseId);
    const now = this.#now();
    const processingGeneration = this.#createId();
    const result = await this.#store.transaction(async (store) => {
      const prepared = await store.prepareProcessing({
        knowledgeBaseId,
        documentId,
        actorId: actor.id,
        operation,
        newVersionId: this.#createId(),
        processingGeneration,
        now,
      });
      if (prepared.status === "not_found") {
        throw new AppError("KNOWLEDGE_DOCUMENT_NOT_FOUND");
      }
      if (prepared.status === "processing_conflict") {
        throw new AppError("KNOWLEDGE_DOCUMENT_PROCESSING_CONFLICT");
      }
      if (prepared.status === "invalid_state") {
        throw new AppError("CONFLICT");
      }
      const processingOperation =
        prepared.value.processingVersion?.operationType;
      if (processingOperation === undefined) {
        throw new AppError("INTERNAL_ERROR");
      }
      if (processingOperation === "rebuild_index") {
        await this.#maintenanceGate?.assertDocumentRebuildAvailable();
      } else {
        await this.#assertMaintenanceAvailable();
      }
      await store.writeAudit(
        auditInput(
          actor,
          `knowledge_document.${processingOperation}`,
          "knowledge_document",
          documentId,
          {
            knowledge_base_id: knowledgeBaseId,
          },
        ),
      );
      return prepared.value;
    });
    if (result.processingVersion === null) throw new AppError("INTERNAL_ERROR");
    await this.#enqueueOrFail(actor, result.document, result.processingVersion);
    return this.#documentView(result);
  }

  async #enqueueOrFail(
    actor: KnowledgeActor,
    document: KnowledgeDocumentRecord,
    version: KnowledgeDocumentVersionRecord,
  ): Promise<void> {
    const command: KnowledgeProcessingCommand = {
      operation: version.operationType,
      knowledgeBaseId: document.knowledgeBaseId,
      documentId: document.id,
      documentVersionId: version.id,
      processingGeneration: version.processingGeneration,
      requestedBy: actor.id,
    };
    try {
      await this.#scheduler.enqueue(command);
    } catch {
      await this.#store.transaction(async (store) => {
        await store.markProcessingEnqueueFailed({
          knowledgeBaseId: document.knowledgeBaseId,
          documentId: document.id,
          versionId: version.id,
          processingGeneration: version.processingGeneration,
          stableErrorCode: "KNOWLEDGE_PROCESSING_UNAVAILABLE",
          now: this.#now(),
        });
        await store.writeAudit(
          auditInput(
            actor,
            "knowledge_document.enqueue_failed",
            "knowledge_document",
            document.id,
            {
              knowledge_base_id: document.knowledgeBaseId,
              stable_error_code: "KNOWLEDGE_PROCESSING_UNAVAILABLE",
            },
          ),
        );
      });
      throw new AppError("KNOWLEDGE_PROCESSING_UNAVAILABLE", {
        document_id: document.id,
      });
    }
  }

  async #cancelSchedulerBestEffort(
    command: KnowledgeProcessingCommand,
  ): Promise<void> {
    try {
      await this.#scheduler.cancel(command);
    } catch {
      // The persisted cancellation/deletion is authoritative. The worker must
      // reject late results by generation and entity state.
    }
  }

  async #discardUpload(
    knowledgeBaseId: string,
    object: Parameters<
      KnowledgeDocumentIngestionAdapter["discardRegisteredUpload"]
    >[0]["object"],
  ): Promise<boolean> {
    try {
      await this.#ingestionAdapter.discardRegisteredUpload({
        knowledgeBaseId,
        object,
      });
      return true;
    } catch {
      // The durable reservation retains quota for an object that could not be
      // discarded. Expiry reconciliation releases it only after this exact key
      // has been removed or confirmed absent.
      return false;
    }
  }

  async #releaseStorageReservationBestEffort(
    reservationId: string,
    reservationLeaseToken: string,
    knowledgeBaseId: string,
    sizeBytes: bigint,
  ): Promise<void> {
    try {
      await this.#store.transaction((store) =>
        store.releaseStorageReservation({
          reservationId,
          reservationLeaseToken,
          knowledgeBaseId,
          sizeBytes,
          now: this.#now(),
        }),
      );
    } catch {
      // A failed release remains visible in storage_reserved_bytes instead of
      // silently admitting another object beyond the hard quota boundary.
    }
  }

  async #assertMaintenanceAvailable(): Promise<void> {
    await this.#maintenanceGate?.assertAvailable();
  }

  async #eventVersion(
    value: KnowledgeDocumentWithProcessing,
  ): Promise<KnowledgeDocumentVersionRecord | null> {
    if (value.processingVersion !== null) return value.processingVersion;
    const versionId =
      value.document.currentVersionId ?? value.document.candidateVersionId;
    return versionId === null
      ? null
      : this.#store.findDocumentVersion(versionId);
  }

  async #publishDocumentEventBestEffort(
    knowledgeBaseId: string,
    documentId: string,
    version: KnowledgeDocumentVersionRecord,
  ): Promise<void> {
    await this.#eventSink
      ?.publish({
        knowledgeBaseId,
        documentId,
        documentVersionId: version.id,
        processingGeneration: version.processingGeneration,
      })
      .catch(() => undefined);
  }

  #documentView(
    value: KnowledgeDocumentWithProcessing,
    exactVersion?: KnowledgeDocumentVersionRecord,
  ): KnowledgeDocumentView {
    return documentView(value, exactVersion, this.#searchabilityCriteria());
  }

  #searchabilityCriteria(): KnowledgeDocumentSearchabilityCriteria {
    const currentEmbeddingProfileHash = resolveCurrentEmbeddingProfileHash(
      this.#currentEmbeddingProfileHash,
    );
    return {
      ...(currentEmbeddingProfileHash === undefined
        ? {}
        : { currentEmbeddingProfileHash }),
    };
  }

  async #requireAccess(
    actor: KnowledgeActor,
    knowledgeBaseId: string,
  ): Promise<KnowledgeBaseAccessRecord> {
    const base = await this.#store.findKnowledgeBase(knowledgeBaseId);
    if (base === null || base.lifecycleStatus === "deleted") {
      throw new AppError("KNOWLEDGE_BASE_NOT_FOUND");
    }
    const access = await this.#store.findKnowledgeBaseAccess(
      knowledgeBaseId,
      actor.id,
      this.#searchabilityCriteria(),
    );
    if (access === null) throw new AppError("KNOWLEDGE_BASE_ACCESS_DENIED");
    return access;
  }

  async #requireContentAccess(
    actor: KnowledgeActor,
    knowledgeBaseId: string,
  ): Promise<KnowledgeBaseAccessRecord> {
    assertActiveActor(actor);
    const access = await this.#requireAccess(actor, knowledgeBaseId);
    if (access.knowledgeBase.availabilityStatus !== "enabled") {
      throw new AppError("KNOWLEDGE_BASE_DISABLED");
    }
    return access;
  }

  async #requireReadyDocument(
    knowledgeBaseId: string,
    documentId: string,
    allowNonReadyCurrent = false,
  ): Promise<{
    document: KnowledgeDocumentRecord;
    versionId: string;
    version?: KnowledgeDocumentVersionRecord;
  }> {
    const value = await requireDocument(
      this.#store,
      knowledgeBaseId,
      documentId,
    );
    if (
      (!allowNonReadyCurrent && value.document.status !== "ready") ||
      value.document.currentVersionId === null
    ) {
      throw new AppError("KNOWLEDGE_DOCUMENT_CONTENT_NOT_READY");
    }
    const version =
      value.document.status === "ready"
        ? undefined
        : await this.#store.findDocumentVersion(
            value.document.currentVersionId,
          );
    if (
      version !== undefined &&
      (version === null || version.versionStatus !== "ready")
    ) {
      throw new AppError("KNOWLEDGE_DOCUMENT_CONTENT_NOT_READY");
    }
    return {
      document: value.document,
      versionId: value.document.currentVersionId,
      ...(version === undefined || version === null ? {} : { version }),
    };
  }

  async #requireReadableDocumentVersion(
    knowledgeBaseId: string,
    documentId: string,
    documentVersionId: string,
    allowNonReadyDocument = false,
  ): Promise<{
    document: KnowledgeDocumentRecord;
    versionId: string;
    version: KnowledgeDocumentVersionRecord;
  }> {
    const value = await requireDocument(
      this.#store,
      knowledgeBaseId,
      documentId,
    );
    const version = await this.#store.findDocumentVersion(documentVersionId);
    if (
      version === null ||
      (!allowNonReadyDocument && value.document.status !== "ready") ||
      version.knowledgeBaseId !== knowledgeBaseId ||
      version.documentId !== documentId ||
      (version.versionStatus !== "ready" &&
        version.versionStatus !== "superseded")
    ) {
      throw new AppError("KNOWLEDGE_DOCUMENT_NOT_FOUND");
    }
    return { document: value.document, versionId: version.id, version };
  }

  #requireDocumentAccessAdapter(): KnowledgeDocumentAccessAdapter {
    if (this.#documentAccessAdapter === undefined) {
      throw new AppError("KNOWLEDGE_PREVIEW_UNAVAILABLE");
    }
    return this.#documentAccessAdapter;
  }

  #knowledgeBaseView(
    actor: KnowledgeActor,
    access: KnowledgeBaseAccessRecord,
  ): KnowledgeBaseView {
    const base = access.knowledgeBase;
    const owner = base.ownerId === actor.id;
    const enabled = base.availabilityStatus === "enabled";
    const redacted = !enabled;
    return {
      id: base.id,
      name: base.name,
      description: redacted ? null : base.description,
      source_type: base.sourceType,
      source_sync: null,
      lifecycle_status: base.lifecycleStatus,
      availability_status: base.availabilityStatus,
      owner: access.owner,
      is_owner: owner,
      access_sources: (redacted
        ? access.accessSources.filter((source) => source.type === "owner")
        : access.accessSources
      ).map((source) => {
        switch (source.type) {
          case "owner":
            return { type: "owner" as const };
          case "direct_share":
            return { type: "direct" as const, id: source.grantId };
          case "user_group":
            return {
              type: "user_group" as const,
              id: source.groupId,
              name: source.groupName,
            };
        }
      }),
      document_count: redacted ? 0 : access.documentCount,
      ready_document_count: redacted ? 0 : access.searchableDocumentCount,
      storage_used_bytes: redacted
        ? 0
        : safeBigIntNumber(base.storageUsedBytes),
      storage_reserved_bytes: redacted
        ? 0
        : safeBigIntNumber(base.storageReservedBytes),
      storage_quota_bytes: safeBigIntNumber(this.#storageQuotaBytes),
      permissions: {
        view_content: enabled,
        update: owner && enabled && base.lifecycleStatus === "active",
        manage_documents: owner && enabled && base.lifecycleStatus === "active",
        manage_grants: owner && enabled,
        create_grants: owner && enabled && base.lifecycleStatus === "active",
        revoke_grants: owner && enabled,
        archive: owner && enabled && base.lifecycleStatus === "active",
        restore: owner && enabled && base.lifecycleStatus === "archived",
        delete: owner && enabled && base.lifecycleStatus === "archived",
        remove_direct_share:
          enabled &&
          !owner &&
          access.accessSources.some((source) => source.type === "direct_share"),
      },
      archived_at: base.archivedAt?.toISOString() ?? null,
      disabled_reason: owner ? base.disabledReason : null,
      created_at: base.createdAt.toISOString(),
      updated_at: base.updatedAt.toISOString(),
    };
  }
}

function assertActiveActor(actor: KnowledgeActor): void {
  if (actor.status !== "active") throw new AppError("USER_DISABLED");
}

async function requireOwnedBase(
  store: KnowledgeStore,
  actor: KnowledgeActor,
  knowledgeBaseId: string,
): Promise<KnowledgeBaseRecord> {
  const base = await store.findKnowledgeBase(knowledgeBaseId);
  if (base === null || base.lifecycleStatus === "deleted") {
    throw new AppError("KNOWLEDGE_BASE_NOT_FOUND");
  }
  if (base.ownerId !== actor.id)
    throw new AppError("KNOWLEDGE_BASE_ACCESS_DENIED");
  return base;
}

async function requireOwnedWritableBase(
  store: KnowledgeStore,
  actor: KnowledgeActor,
  knowledgeBaseId: string,
): Promise<KnowledgeBaseRecord> {
  const base = await requireEnabledOwnedBase(store, actor, knowledgeBaseId);
  if (base.lifecycleStatus !== "active") {
    throw new AppError("KNOWLEDGE_BASE_NOT_ACTIVE");
  }
  return base;
}

async function requireEnabledOwnedBase(
  store: KnowledgeStore,
  actor: KnowledgeActor,
  knowledgeBaseId: string,
): Promise<KnowledgeBaseRecord> {
  const base = await requireOwnedBase(store, actor, knowledgeBaseId);
  if (base.availabilityStatus !== "enabled") {
    throw new AppError("KNOWLEDGE_BASE_DISABLED");
  }
  return base;
}

async function requireDocument(
  store: KnowledgeStore,
  knowledgeBaseId: string,
  documentId: string,
): Promise<KnowledgeDocumentWithProcessing> {
  const value = await store.findDocument(knowledgeBaseId, documentId);
  if (value === null) throw new AppError("KNOWLEDGE_DOCUMENT_NOT_FOUND");
  return value;
}

function recipientSafeDocument(
  value: KnowledgeDocumentWithProcessing,
): KnowledgeDocumentWithProcessing {
  return {
    document: value.document,
    processingVersion: null,
    failedCandidateVersion: null,
  };
}

function documentView(
  value: KnowledgeDocumentWithProcessing,
  exactVersion: KnowledgeDocumentVersionRecord | undefined,
  searchability: KnowledgeDocumentSearchabilityCriteria,
): KnowledgeDocumentView {
  const extension =
    exactVersion?.canonicalExtension ?? value.document.canonicalExtension;
  if (
    !knowledgeDocumentFormats.includes(
      extension as (typeof knowledgeDocumentFormats)[number],
    )
  ) {
    throw new AppError("INTERNAL_ERROR");
  }
  const processing =
    exactVersion === undefined ? value.processingVersion : null;
  const failedCandidate =
    exactVersion === undefined ? (value.failedCandidateVersion ?? null) : null;
  const hasCurrentEmbeddingProfile =
    searchability.currentEmbeddingProfileHash === undefined ||
    value.document.embeddingProfileHash ===
      searchability.currentEmbeddingProfileHash;
  return {
    id: value.document.id,
    knowledge_base_id: value.document.knowledgeBaseId,
    display_name: exactVersion?.originalFilename ?? value.document.displayName,
    canonical_extension: extension as (typeof knowledgeDocumentFormats)[number],
    mime_type: exactVersion?.mimeType ?? value.document.mimeType,
    size_bytes: safeBigIntNumber(
      exactVersion?.sizeBytes ?? value.document.sizeBytes,
    ),
    status: value.document.status,
    current_version_id: value.document.currentVersionId,
    searchable:
      value.document.status === "ready" &&
      value.document.currentVersionId !== null &&
      hasCurrentEmbeddingProfile,
    rebuild_required:
      value.document.status === "ready" &&
      value.document.currentVersionId !== null &&
      !hasCurrentEmbeddingProfile,
    processing:
      processing === null
        ? null
        : {
            operation:
              processing.operationType === "rebuild_index"
                ? "rebuild"
                : processing.operationType,
            processing_generation: processing.processingGeneration,
            stage: processing.processingStage,
            progress_percent: processing.progressPercent,
            revision: safeBigIntNumber(processing.processingRevision),
            stable_error_code: processing.stableErrorCode,
            retry_at: processing.retryAt?.toISOString() ?? null,
            retry_attempt: processing.stageAttemptCount,
            cancellable:
              processing.progressPercent < 98 &&
              [
                "queued",
                "parsing",
                "chunking",
                "parenting",
                "embedding",
                "indexing",
              ].includes(processing.processingStage),
          },
    candidate_failure:
      failedCandidate === null || failedCandidate.stableErrorCode === null
        ? null
        : {
            operation:
              failedCandidate.operationType === "rebuild_index"
                ? "rebuild"
                : failedCandidate.operationType,
            processing_generation: failedCandidate.processingGeneration,
            revision: safeBigIntNumber(failedCandidate.processingRevision),
            stable_error_code: failedCandidate.stableErrorCode,
            retryable: true,
          },
    preview: previewCapabilities(extension),
    created_at: (
      exactVersion?.createdAt ?? value.document.createdAt
    ).toISOString(),
    updated_at: (
      exactVersion?.updatedAt ?? value.document.updatedAt
    ).toISOString(),
  };
}

function resolveCurrentEmbeddingProfileHash(
  value: string | (() => string | undefined) | undefined,
): string | undefined {
  return typeof value === "function" ? value() : value;
}

function previewCapabilities(
  extension: string,
): KnowledgeDocumentView["preview"] {
  if (isFilePreviewFormat(extension)) {
    return {
      parsed: true,
      original_supported: true,
      renderer: "file",
    };
  }
  return { parsed: true, original_supported: false, renderer: null };
}

function isFilePreviewFormat(extension: string): boolean {
  return knowledgeFilePreviewFormats.some((format) => format === extension);
}

function grantView(
  actor: KnowledgeActor,
  base: KnowledgeBaseRecord,
  grant: KnowledgeBaseGrantViewRecord,
): KnowledgeGrantView {
  const targetId = grant.userId ?? grant.userGroupId;
  if (targetId === null) throw new AppError("INTERNAL_ERROR");
  return {
    id: grant.id,
    knowledge_base_id: grant.knowledgeBaseId,
    target_type: grant.granteeType,
    target: {
      id: targetId,
      name: grant.targetName,
      email_hint:
        grant.targetEmail === null ? null : maskEmail(grant.targetEmail),
    },
    status: grant.status,
    can_revoke:
      grant.status === "active" &&
      (base.ownerId === actor.id ||
        actor.role === "admin" ||
        (grant.granteeType === "user" && grant.userId === actor.id)),
    created_at: grant.createdAt.toISOString(),
    updated_at: grant.updatedAt.toISOString(),
    revoked_at: grant.revokedAt?.toISOString() ?? null,
  };
}

async function remainingUserAccess(
  store: KnowledgeStore,
  knowledgeBaseId: string,
  userId: string,
): Promise<
  Extract<
    KnowledgeBaseGrantRevocationResult["remaining_access"],
    { subject_type: "user" }
  >
> {
  if (!(await store.isActiveUser(userId))) {
    return { subject_type: "user", has_access: false, source_types: [] };
  }
  const access = await store.findKnowledgeBaseAccess(knowledgeBaseId, userId);
  if (access === null) {
    return { subject_type: "user", has_access: false, source_types: [] };
  }
  const available = new Set(
    access.accessSources.map((source) => {
      switch (source.type) {
        case "owner":
          return "owner" as const;
        case "direct_share":
          return "direct" as const;
        case "user_group":
          return "user_group" as const;
      }
    }),
  );
  const sourceTypes = (["owner", "direct", "user_group"] as const).filter(
    (source) => available.has(source),
  );
  return {
    subject_type: "user",
    has_access: sourceTypes.length > 0,
    source_types: sourceTypes,
  };
}

function auditInput(
  actor: KnowledgeActor,
  action: string,
  targetType: string,
  targetId: string,
  metadata: Record<string, unknown>,
) {
  return {
    actorId: actor.id,
    action,
    targetType,
    targetId,
    result: "success" as const,
    metadata,
    ipAddress: actor.ipAddress ?? null,
    userAgent: actor.userAgent ?? null,
  };
}

function assertValidUploadConflictOptions(input: {
  conflictResolution?: unknown;
  replaceDocumentId?: unknown;
}): asserts input is KnowledgeDocumentUploadConflictOptions {
  const valid =
    input.conflictResolution === "replace"
      ? uuidSchema.safeParse(input.replaceDocumentId).success
      : (input.conflictResolution === undefined ||
          input.conflictResolution === "keep_both" ||
          input.conflictResolution === "replace_path") &&
        input.replaceDocumentId === undefined;
  if (!valid) throw new AppError("VALIDATION_ERROR");
}

function normalizeNullableText(
  value: string | null | undefined,
): string | null {
  if (value === undefined || value === null) return null;
  const normalized = value.trim();
  return normalized.length === 0 ? null : normalized;
}

function normalizeDocumentDisplayName(value: string): string {
  const normalized = value.normalize("NFKC").trim();
  const characters = Array.from(normalized);
  if (
    characters.length === 0 ||
    characters.length > 260 ||
    normalized === "." ||
    normalized === ".." ||
    characters.some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return (
        codePoint < 32 ||
        codePoint === 127 ||
        character === "/" ||
        character === "\\"
      );
    })
  ) {
    throw new AppError("VALIDATION_ERROR");
  }
  return normalized;
}

function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (local === undefined || domain === undefined) return "***";
  const first = local.at(0) ?? "*";
  return `${first}***@${domain}`;
}

function uniqueIds(ids: string[]): string[] {
  return [...new Set(ids)];
}

function boundedUniqueRebuildIds(ids: string[]): string[] {
  const unique = uniqueIds(ids);
  if (unique.length < 1 || unique.length > knowledgeDocumentRebuildBatchSize) {
    throw new AppError("VALIDATION_ERROR");
  }
  return unique;
}

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  operation: (value: T) => Promise<R>,
): Promise<R[]> {
  const result = new Array<R>(values.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      const value = values[index];
      if (value !== undefined) result[index] = await operation(value);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, () =>
      worker(),
    ),
  );
  return result;
}

function safeBigIntNumber(value: bigint): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 0) {
    throw new AppError("INTERNAL_ERROR");
  }
  return result;
}
