-- Add the LinkSense knowledge-base domain and immutable turn selection facts.
-- This migration is forward-only and additive: it does not drop, rename, or
-- rewrite existing business columns, and it intentionally creates no foreign
-- keys. Existing conversation rows receive empty JSON arrays for the newly
-- added selection state.

ALTER TABLE "conversations"
    ADD COLUMN "selected_knowledge_base_ids_json" JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE "conversation_drafts"
    ADD COLUMN "knowledge_base_ids_json" JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE "pending_requests"
    ADD COLUMN "knowledge_base_ids_json" JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE "conversation_turn_start_intents"
    ADD COLUMN "knowledge_base_ids_json" JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE "conversation_turns"
    ADD COLUMN "knowledge_base_ids_json" JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE "conversations"
    ADD CONSTRAINT "conversations_selected_knowledge_base_ids_array_check"
    CHECK (jsonb_typeof("selected_knowledge_base_ids_json") = 'array');

ALTER TABLE "conversation_drafts"
    ADD CONSTRAINT "conversation_drafts_knowledge_base_ids_array_check"
    CHECK (jsonb_typeof("knowledge_base_ids_json") = 'array');

ALTER TABLE "pending_requests"
    ADD CONSTRAINT "pending_requests_knowledge_base_ids_array_check"
    CHECK (jsonb_typeof("knowledge_base_ids_json") = 'array');

ALTER TABLE "conversation_turn_start_intents"
    ADD CONSTRAINT "conversation_turn_start_intents_knowledge_base_ids_array_check"
    CHECK (jsonb_typeof("knowledge_base_ids_json") = 'array');

ALTER TABLE "conversation_turns"
    ADD CONSTRAINT "conversation_turns_knowledge_base_ids_array_check"
    CHECK (jsonb_typeof("knowledge_base_ids_json") = 'array');

CREATE TABLE "knowledge_bases" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "owner_id" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "description" TEXT,
    "lifecycle_status" VARCHAR(32) NOT NULL DEFAULT 'active',
    "availability_status" VARCHAR(32) NOT NULL DEFAULT 'enabled',
    "storage_used_bytes" BIGINT NOT NULL DEFAULT 0,
    "storage_reserved_bytes" BIGINT NOT NULL DEFAULT 0,
    "archived_at" TIMESTAMPTZ(6),
    "archived_by" UUID,
    "disabled_at" TIMESTAMPTZ(6),
    "disabled_by" UUID,
    "disabled_reason" TEXT,
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_by" UUID,
    "deletion_reason" TEXT,
    "cleanup_status" VARCHAR(32) NOT NULL DEFAULT 'completed',
    "cleanup_error_code" VARCHAR(120),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "knowledge_bases_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "knowledge_bases_lifecycle_status_check" CHECK (
        "lifecycle_status" IN ('active', 'archived', 'deleted')
    ),
    CONSTRAINT "knowledge_bases_availability_status_check" CHECK (
        "availability_status" IN ('enabled', 'disabled')
    ),
    CONSTRAINT "knowledge_bases_storage_check" CHECK (
        "storage_used_bytes" >= 0 AND "storage_reserved_bytes" >= 0
    ),
    CONSTRAINT "knowledge_bases_archive_state_check" CHECK (
        ("lifecycle_status" = 'active' AND "archived_at" IS NULL AND "archived_by" IS NULL)
        OR ("lifecycle_status" IN ('archived', 'deleted') AND "archived_at" IS NOT NULL AND "archived_by" IS NOT NULL)
    ),
    CONSTRAINT "knowledge_bases_availability_state_check" CHECK (
        ("availability_status" = 'enabled' AND "disabled_at" IS NULL AND "disabled_by" IS NULL AND "disabled_reason" IS NULL)
        OR ("availability_status" = 'disabled' AND "disabled_at" IS NOT NULL AND "disabled_by" IS NOT NULL AND "disabled_reason" IS NOT NULL)
    ),
    CONSTRAINT "knowledge_bases_deletion_state_check" CHECK (
        ("lifecycle_status" <> 'deleted' AND "deleted_at" IS NULL AND "deleted_by" IS NULL AND "deletion_reason" IS NULL)
        OR ("lifecycle_status" = 'deleted' AND "deleted_at" IS NOT NULL AND "deleted_by" IS NOT NULL AND "deletion_reason" IS NOT NULL)
    ),
    CONSTRAINT "knowledge_bases_cleanup_status_check" CHECK (
        "cleanup_status" IN ('pending', 'running', 'failed', 'completed')
    ),
    CONSTRAINT "knowledge_bases_cleanup_error_check" CHECK (
        ("cleanup_status" = 'failed' AND "cleanup_error_code" IS NOT NULL)
        OR ("cleanup_status" <> 'failed' AND "cleanup_error_code" IS NULL)
    )
);

CREATE TABLE "knowledge_base_grants" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "knowledge_base_id" UUID NOT NULL,
    "grantee_type" VARCHAR(32) NOT NULL,
    "user_id" UUID,
    "user_group_id" UUID,
    "permission" VARCHAR(32) NOT NULL DEFAULT 'use',
    "status" VARCHAR(32) NOT NULL DEFAULT 'active',
    "granted_by" UUID NOT NULL,
    "revoked_by" UUID,
    "revoked_at" TIMESTAMPTZ(6),
    "revocation_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "knowledge_base_grants_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "knowledge_base_grants_grantee_type_check" CHECK (
        "grantee_type" IN ('user', 'user_group')
    ),
    CONSTRAINT "knowledge_base_grants_target_check" CHECK (
        ("grantee_type" = 'user' AND "user_id" IS NOT NULL AND "user_group_id" IS NULL)
        OR ("grantee_type" = 'user_group' AND "user_id" IS NULL AND "user_group_id" IS NOT NULL)
    ),
    CONSTRAINT "knowledge_base_grants_permission_check" CHECK ("permission" = 'use'),
    CONSTRAINT "knowledge_base_grants_status_check" CHECK (
        "status" IN ('active', 'revoked')
    ),
    CONSTRAINT "knowledge_base_grants_revocation_check" CHECK (
        ("status" = 'active' AND "revoked_by" IS NULL AND "revoked_at" IS NULL AND "revocation_reason" IS NULL)
        OR ("status" = 'revoked' AND "revoked_by" IS NOT NULL AND "revoked_at" IS NOT NULL)
    )
);

CREATE TABLE "knowledge_base_documents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "knowledge_base_id" UUID NOT NULL,
    "display_name" VARCHAR(260) NOT NULL,
    "normalized_display_name" VARCHAR(260) NOT NULL,
    "canonical_extension" VARCHAR(16) NOT NULL,
    "mime_type" VARCHAR(160) NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "original_sha256" VARCHAR(64) NOT NULL,
    "status" VARCHAR(32) NOT NULL DEFAULT 'processing',
    "current_version_id" UUID,
    "candidate_version_id" UUID,
    "active_processing_version_id" UUID,
    "embedding_profile_hash" VARCHAR(64),
    "segmentation_config_digest" VARCHAR(64),
    "segmentation_integrity_digest" VARCHAR(64),
    "stable_error_code" VARCHAR(120),
    "cleanup_status" VARCHAR(32) NOT NULL DEFAULT 'completed',
    "cleanup_error_code" VARCHAR(120),
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_by" UUID,
    "deletion_reason" TEXT,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "knowledge_base_documents_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "knowledge_base_documents_status_check" CHECK (
        "status" IN ('processing', 'ready', 'failed', 'deleted')
    ),
    CONSTRAINT "knowledge_base_documents_size_check" CHECK ("size_bytes" > 0),
    CONSTRAINT "knowledge_base_documents_sha_check" CHECK (
        "original_sha256" ~ '^[0-9a-f]{64}$'
    ),
    CONSTRAINT "knowledge_base_documents_hashes_check" CHECK (
        ("embedding_profile_hash" IS NULL OR "embedding_profile_hash" ~ '^[0-9a-f]{64}$')
        AND ("segmentation_config_digest" IS NULL OR "segmentation_config_digest" ~ '^[0-9a-f]{64}$')
        AND ("segmentation_integrity_digest" IS NULL OR "segmentation_integrity_digest" ~ '^[0-9a-f]{64}$')
    ),
    CONSTRAINT "knowledge_base_documents_deletion_check" CHECK (
        ("status" <> 'deleted' AND "deleted_at" IS NULL AND "deleted_by" IS NULL AND "deletion_reason" IS NULL)
        OR ("status" = 'deleted' AND "deleted_at" IS NOT NULL AND "deleted_by" IS NOT NULL AND "deletion_reason" IS NOT NULL)
    ),
    CONSTRAINT "knowledge_base_documents_cleanup_status_check" CHECK (
        "cleanup_status" IN ('pending', 'running', 'failed', 'completed')
    ),
    CONSTRAINT "knowledge_base_documents_cleanup_error_check" CHECK (
        ("cleanup_status" = 'failed' AND "cleanup_error_code" IS NOT NULL)
        OR ("cleanup_status" <> 'failed' AND "cleanup_error_code" IS NULL)
    )
);

CREATE TABLE "knowledge_base_document_versions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "knowledge_base_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "source_version_id" UUID,
    "version_number" INTEGER NOT NULL,
    "version_status" VARCHAR(32) NOT NULL DEFAULT 'processing',
    "operation_type" VARCHAR(32) NOT NULL DEFAULT 'upload',
    "processing_generation" UUID NOT NULL,
    "processing_stage" VARCHAR(32) NOT NULL DEFAULT 'validating',
    "progress_percent" INTEGER NOT NULL DEFAULT 10,
    "processing_revision" BIGINT NOT NULL DEFAULT 1,
    "stage_attempt_count" INTEGER NOT NULL DEFAULT 0,
    "stable_error_code" VARCHAR(120),
    "stable_error_params_json" JSONB,
    "retry_at" TIMESTAMPTZ(6),
    "docling_task_id" VARCHAR(200),
    "docling_result_discarded" BOOLEAN NOT NULL DEFAULT FALSE,
    "cancel_requested_at" TIMESTAMPTZ(6),
    "cancel_requested_by" UUID,
    "cancel_reason" TEXT,
    "original_filename" VARCHAR(260) NOT NULL,
    "canonical_extension" VARCHAR(16) NOT NULL,
    "mime_type" VARCHAR(160) NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "original_sha256" VARCHAR(64) NOT NULL,
    "markdown_normalization_version" INTEGER NOT NULL DEFAULT 1,
    "markdown_sha256" VARCHAR(64),
    "docling_version" VARCHAR(120),
    "parsing_config_version" VARCHAR(120),
    "checkpoint_json" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "processing_config_json" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "processing_config_digest" VARCHAR(64),
    "segmentation_config_digest" VARCHAR(64),
    "embedding_profile_hash" VARCHAR(64),
    "index_ready" BOOLEAN NOT NULL DEFAULT FALSE,
    "parent_count" INTEGER,
    "retrieval_fragment_count" INTEGER,
    "segmentation_integrity_digest" VARCHAR(64),
    "started_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "superseded_at" TIMESTAMPTZ(6),
    "cleanup_eligible_at" TIMESTAMPTZ(6),
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "knowledge_base_document_versions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "knowledge_base_document_versions_number_check" CHECK ("version_number" > 0),
    CONSTRAINT "knowledge_base_document_versions_status_check" CHECK (
        "version_status" IN ('processing', 'ready', 'failed', 'superseded', 'deleted')
    ),
    CONSTRAINT "knowledge_base_document_versions_operation_check" CHECK (
        "operation_type" IN ('upload', 'replace', 'retry', 'reprocess', 'rebuild_index')
    ),
    CONSTRAINT "knowledge_base_document_versions_stage_check" CHECK (
        "processing_stage" IN (
            'uploading', 'validating', 'queued', 'converting', 'parsing',
            'normalizing', 'segmenting', 'embedding', 'indexing',
            'activating', 'completed', 'failed'
        )
    ),
    CONSTRAINT "knowledge_base_document_versions_progress_check" CHECK (
        "progress_percent" BETWEEN 0 AND 100
    ),
    CONSTRAINT "knowledge_base_document_versions_revision_check" CHECK (
        "processing_revision" > 0 AND "stage_attempt_count" >= 0
    ),
    CONSTRAINT "knowledge_base_document_versions_size_check" CHECK ("size_bytes" > 0),
    CONSTRAINT "knowledge_base_document_versions_sha_check" CHECK (
        "original_sha256" ~ '^[0-9a-f]{64}$'
        AND ("markdown_sha256" IS NULL OR "markdown_sha256" ~ '^[0-9a-f]{64}$')
        AND ("processing_config_digest" IS NULL OR "processing_config_digest" ~ '^[0-9a-f]{64}$')
        AND ("segmentation_config_digest" IS NULL OR "segmentation_config_digest" ~ '^[0-9a-f]{64}$')
        AND ("embedding_profile_hash" IS NULL OR "embedding_profile_hash" ~ '^[0-9a-f]{64}$')
        AND ("segmentation_integrity_digest" IS NULL OR "segmentation_integrity_digest" ~ '^[0-9a-f]{64}$')
    ),
    CONSTRAINT "knowledge_base_document_versions_json_check" CHECK (
        jsonb_typeof("checkpoint_json") = 'object'
        AND jsonb_typeof("processing_config_json") = 'object'
        AND ("stable_error_params_json" IS NULL OR jsonb_typeof("stable_error_params_json") = 'object')
    ),
    CONSTRAINT "knowledge_base_document_versions_cancel_check" CHECK (
        ("cancel_requested_at" IS NULL AND "cancel_requested_by" IS NULL AND "cancel_reason" IS NULL)
        OR ("cancel_requested_at" IS NOT NULL AND "cancel_requested_by" IS NOT NULL AND "cancel_reason" IS NOT NULL)
    ),
    CONSTRAINT "knowledge_base_document_versions_counts_check" CHECK (
        ("parent_count" IS NULL OR "parent_count" >= 0)
        AND ("retrieval_fragment_count" IS NULL OR "retrieval_fragment_count" >= 0)
    )
);

CREATE TABLE "knowledge_base_objects" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "knowledge_base_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "document_version_id" UUID NOT NULL,
    "processing_generation" UUID NOT NULL,
    "object_type" VARCHAR(32) NOT NULL,
    "object_key" TEXT NOT NULL,
    "asset_reference_id" UUID,
    "mime_type" VARCHAR(160) NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "checksum_sha256" VARCHAR(64) NOT NULL,
    "lifecycle_status" VARCHAR(32) NOT NULL DEFAULT 'active',
    "cleanup_status" VARCHAR(32) NOT NULL DEFAULT 'completed',
    "cleanup_eligible_at" TIMESTAMPTZ(6),
    "cleaned_at" TIMESTAMPTZ(6),
    "cleanup_error_code" VARCHAR(120),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "knowledge_base_objects_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "knowledge_base_objects_type_check" CHECK (
        "object_type" IN ('original', 'converted', 'markdown', 'docling_json', 'asset')
    ),
    CONSTRAINT "knowledge_base_objects_asset_reference_check" CHECK (
        ("object_type" = 'asset' AND "asset_reference_id" IS NOT NULL)
        OR ("object_type" <> 'asset' AND "asset_reference_id" IS NULL)
    ),
    CONSTRAINT "knowledge_base_objects_size_check" CHECK ("size_bytes" > 0),
    CONSTRAINT "knowledge_base_objects_sha_check" CHECK (
        "checksum_sha256" ~ '^[0-9a-f]{64}$'
    ),
    CONSTRAINT "knowledge_base_objects_lifecycle_check" CHECK (
        "lifecycle_status" IN ('active', 'pending_cleanup', 'cleaned')
    ),
    CONSTRAINT "knowledge_base_objects_cleanup_status_check" CHECK (
        "cleanup_status" IN ('pending', 'running', 'failed', 'completed')
    ),
    CONSTRAINT "knowledge_base_objects_cleanup_state_check" CHECK (
        ("cleanup_status" = 'failed' AND "cleanup_error_code" IS NOT NULL AND "cleaned_at" IS NULL)
        OR ("cleanup_status" <> 'failed' AND "cleanup_error_code" IS NULL)
    ),
    CONSTRAINT "knowledge_base_objects_cleaned_state_check" CHECK (
        ("lifecycle_status" = 'cleaned' AND "cleaned_at" IS NOT NULL AND "cleanup_status" = 'completed')
        OR ("lifecycle_status" <> 'cleaned' AND "cleaned_at" IS NULL)
    )
);

CREATE TABLE "knowledge_base_cleanup_outbox" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "target_type" VARCHAR(32) NOT NULL,
    "knowledge_base_id" UUID NOT NULL,
    "document_id" UUID,
    "document_version_id" UUID,
    "object_id" UUID,
    "status" VARCHAR(32) NOT NULL DEFAULT 'pending',
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 10,
    "next_attempt_at" TIMESTAMPTZ(6),
    "last_attempt_at" TIMESTAMPTZ(6),
    "last_error_code" VARCHAR(120),
    "requested_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "knowledge_base_cleanup_outbox_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "knowledge_base_cleanup_outbox_target_type_check" CHECK (
        "target_type" IN ('knowledge_base', 'document', 'document_version', 'object')
    ),
    CONSTRAINT "knowledge_base_cleanup_outbox_target_check" CHECK (
        ("target_type" = 'knowledge_base' AND "document_id" IS NULL AND "document_version_id" IS NULL AND "object_id" IS NULL)
        OR ("target_type" = 'document' AND "document_id" IS NOT NULL AND "document_version_id" IS NULL AND "object_id" IS NULL)
        OR ("target_type" = 'document_version' AND "document_id" IS NOT NULL AND "document_version_id" IS NOT NULL AND "object_id" IS NULL)
        OR ("target_type" = 'object' AND "document_id" IS NOT NULL AND "document_version_id" IS NOT NULL AND "object_id" IS NOT NULL)
    ),
    CONSTRAINT "knowledge_base_cleanup_outbox_status_check" CHECK (
        "status" IN ('pending', 'running', 'failed', 'completed')
    ),
    CONSTRAINT "knowledge_base_cleanup_outbox_attempts_check" CHECK (
        "attempt_count" >= 0 AND "max_attempts" > 0 AND "attempt_count" <= "max_attempts"
    )
);

CREATE TABLE "knowledge_base_maintenance_tasks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "task_type" VARCHAR(32) NOT NULL,
    "scope" VARCHAR(32) NOT NULL DEFAULT 'all_documents',
    "status" VARCHAR(32) NOT NULL DEFAULT 'pending',
    "requested_by" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "confirmed_at" TIMESTAMPTZ(6) NOT NULL,
    "current_stage" VARCHAR(32),
    "total_count" BIGINT NOT NULL DEFAULT 0,
    "succeeded_count" BIGINT NOT NULL DEFAULT 0,
    "failed_count" BIGINT NOT NULL DEFAULT 0,
    "stable_error_code" VARCHAR(120),
    "started_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "knowledge_base_maintenance_tasks_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "knowledge_base_maintenance_tasks_type_check" CHECK (
        "task_type" = 'rebuild_all_vectors'
    ),
    CONSTRAINT "knowledge_base_maintenance_tasks_scope_check" CHECK (
        "scope" = 'all_documents'
    ),
    CONSTRAINT "knowledge_base_maintenance_tasks_status_check" CHECK (
        "status" IN ('pending', 'running', 'failed', 'completed')
    ),
    CONSTRAINT "knowledge_base_maintenance_tasks_counts_check" CHECK (
        "total_count" >= 0 AND "succeeded_count" >= 0 AND "failed_count" >= 0
        AND "succeeded_count" + "failed_count" <= "total_count"
    )
);

CREATE TABLE "conversation_turn_knowledge_bases" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "turn_id" UUID NOT NULL,
    "knowledge_base_id" UUID NOT NULL,
    "selection_order" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "conversation_turn_knowledge_bases_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "conversation_turn_knowledge_bases_order_check" CHECK ("selection_order" >= 0)
);

CREATE TABLE "conversation_message_knowledge_citations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "conversation_id" UUID NOT NULL,
    "turn_id" UUID NOT NULL,
    "message_id" UUID NOT NULL,
    "knowledge_base_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "document_version_id" UUID NOT NULL,
    "parent_id" VARCHAR(160) NOT NULL,
    "citation_no" INTEGER NOT NULL,
    "provenance_json" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "conversation_message_knowledge_citations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "conversation_message_knowledge_citations_number_check" CHECK ("citation_no" > 0),
    CONSTRAINT "conversation_message_knowledge_citations_provenance_check" CHECK (
        jsonb_typeof("provenance_json") = 'object'
    )
);

CREATE TABLE "conversation_message_knowledge_citation_anchors" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "message_id" UUID NOT NULL,
    "citation_id" UUID NOT NULL,
    "occurrence_no" INTEGER NOT NULL,
    "anchor_after_offset_utf16" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "conversation_message_knowledge_citation_anchors_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "conversation_message_knowledge_citation_anchors_occurrence_check" CHECK ("occurrence_no" > 0),
    CONSTRAINT "conversation_message_knowledge_citation_anchors_offset_check" CHECK ("anchor_after_offset_utf16" >= 0)
);

CREATE UNIQUE INDEX "knowledge_base_grants_active_user_key"
    ON "knowledge_base_grants"("knowledge_base_id", "user_id")
    WHERE "status" = 'active' AND "grantee_type" = 'user';

CREATE UNIQUE INDEX "knowledge_base_grants_active_group_key"
    ON "knowledge_base_grants"("knowledge_base_id", "user_group_id")
    WHERE "status" = 'active' AND "grantee_type" = 'user_group';

CREATE UNIQUE INDEX "knowledge_base_documents_active_name_key"
    ON "knowledge_base_documents"("knowledge_base_id", "normalized_display_name")
    WHERE "status" <> 'deleted';

CREATE UNIQUE INDEX "knowledge_base_documents_active_sha_key"
    ON "knowledge_base_documents"("knowledge_base_id", "original_sha256")
    WHERE "status" <> 'deleted';

CREATE UNIQUE INDEX "knowledge_base_document_versions_document_number_key"
    ON "knowledge_base_document_versions"("document_id", "version_number");

CREATE UNIQUE INDEX "knowledge_base_objects_object_key_key"
    ON "knowledge_base_objects"("object_key");

CREATE UNIQUE INDEX "knowledge_base_objects_active_asset_reference_key"
    ON "knowledge_base_objects"("document_version_id", "processing_generation", "asset_reference_id")
    WHERE "object_type" = 'asset' AND "lifecycle_status" = 'active';

CREATE UNIQUE INDEX "conversation_turn_knowledge_bases_turn_base_key"
    ON "conversation_turn_knowledge_bases"("turn_id", "knowledge_base_id");

CREATE UNIQUE INDEX "conversation_turn_knowledge_bases_turn_order_key"
    ON "conversation_turn_knowledge_bases"("turn_id", "selection_order");

CREATE UNIQUE INDEX "conversation_message_knowledge_citations_source_key"
    ON "conversation_message_knowledge_citations"("message_id", "document_version_id", "parent_id");

CREATE UNIQUE INDEX "conversation_message_knowledge_citations_number_key"
    ON "conversation_message_knowledge_citations"("message_id", "citation_no");

CREATE UNIQUE INDEX "conversation_message_knowledge_citation_anchors_occurrence_key"
    ON "conversation_message_knowledge_citation_anchors"("message_id", "occurrence_no");

CREATE UNIQUE INDEX "conversation_message_knowledge_citation_anchors_offset_key"
    ON "conversation_message_knowledge_citation_anchors"("citation_id", "anchor_after_offset_utf16");

CREATE INDEX "knowledge_bases_owner_lifecycle_updated_idx"
    ON "knowledge_bases"("owner_id", "lifecycle_status", "updated_at" DESC);
CREATE INDEX "knowledge_bases_state_updated_idx"
    ON "knowledge_bases"("lifecycle_status", "availability_status", "updated_at" DESC);
CREATE INDEX "knowledge_bases_cleanup_status_updated_idx"
    ON "knowledge_bases"("cleanup_status", "updated_at");
CREATE INDEX "knowledge_bases_name_idx" ON "knowledge_bases"("name");

CREATE INDEX "knowledge_base_grants_base_status_created_idx"
    ON "knowledge_base_grants"("knowledge_base_id", "status", "created_at");
CREATE INDEX "knowledge_base_grants_user_status_idx"
    ON "knowledge_base_grants"("grantee_type", "user_id", "status");
CREATE INDEX "knowledge_base_grants_group_status_idx"
    ON "knowledge_base_grants"("grantee_type", "user_group_id", "status");
CREATE INDEX "knowledge_base_grants_granted_by_idx" ON "knowledge_base_grants"("granted_by");
CREATE INDEX "knowledge_base_grants_revoked_by_idx" ON "knowledge_base_grants"("revoked_by");

CREATE INDEX "knowledge_base_documents_base_status_updated_idx"
    ON "knowledge_base_documents"("knowledge_base_id", "status", "updated_at" DESC);
CREATE INDEX "knowledge_base_documents_base_name_idx"
    ON "knowledge_base_documents"("knowledge_base_id", "normalized_display_name");
CREATE INDEX "knowledge_base_documents_base_sha_idx"
    ON "knowledge_base_documents"("knowledge_base_id", "original_sha256");
CREATE INDEX "knowledge_base_documents_current_version_idx" ON "knowledge_base_documents"("current_version_id");
CREATE INDEX "knowledge_base_documents_candidate_version_idx" ON "knowledge_base_documents"("candidate_version_id");
CREATE INDEX "knowledge_base_documents_processing_version_idx" ON "knowledge_base_documents"("active_processing_version_id");
CREATE INDEX "knowledge_base_documents_cleanup_status_idx" ON "knowledge_base_documents"("cleanup_status", "updated_at");

CREATE INDEX "knowledge_base_document_versions_base_status_idx"
    ON "knowledge_base_document_versions"("knowledge_base_id", "version_status", "created_at");
CREATE INDEX "knowledge_base_document_versions_document_created_idx"
    ON "knowledge_base_document_versions"("document_id", "created_at" DESC);
CREATE INDEX "knowledge_base_document_versions_source_version_idx"
    ON "knowledge_base_document_versions"("source_version_id");
CREATE INDEX "knowledge_base_document_versions_stage_retry_idx"
    ON "knowledge_base_document_versions"("processing_stage", "retry_at");
CREATE INDEX "knowledge_base_document_versions_generation_idx" ON "knowledge_base_document_versions"("processing_generation");
CREATE INDEX "knowledge_base_document_versions_docling_task_idx" ON "knowledge_base_document_versions"("docling_task_id");
CREATE INDEX "knowledge_base_document_versions_cleanup_eligible_idx" ON "knowledge_base_document_versions"("cleanup_eligible_at");

CREATE INDEX "knowledge_base_objects_base_lifecycle_idx"
    ON "knowledge_base_objects"("knowledge_base_id", "lifecycle_status", "created_at");
CREATE INDEX "knowledge_base_objects_document_lifecycle_idx"
    ON "knowledge_base_objects"("document_id", "lifecycle_status", "created_at");
CREATE INDEX "knowledge_base_objects_version_generation_type_idx"
    ON "knowledge_base_objects"("document_version_id", "processing_generation", "object_type");
CREATE INDEX "knowledge_base_objects_asset_reference_idx"
    ON "knowledge_base_objects"("document_version_id", "processing_generation", "asset_reference_id");
CREATE INDEX "knowledge_base_objects_cleanup_idx"
    ON "knowledge_base_objects"("cleanup_status", "cleanup_eligible_at");

CREATE INDEX "knowledge_base_cleanup_outbox_status_next_idx"
    ON "knowledge_base_cleanup_outbox"("status", "next_attempt_at", "created_at");
CREATE INDEX "knowledge_base_cleanup_outbox_base_status_idx"
    ON "knowledge_base_cleanup_outbox"("knowledge_base_id", "status");
CREATE INDEX "knowledge_base_cleanup_outbox_document_status_idx"
    ON "knowledge_base_cleanup_outbox"("document_id", "status");
CREATE INDEX "knowledge_base_cleanup_outbox_object_idx" ON "knowledge_base_cleanup_outbox"("object_id");

CREATE INDEX "knowledge_base_maintenance_tasks_status_created_idx"
    ON "knowledge_base_maintenance_tasks"("status", "created_at");
CREATE INDEX "knowledge_base_maintenance_tasks_requester_idx"
    ON "knowledge_base_maintenance_tasks"("requested_by", "created_at");

CREATE INDEX "conversation_turn_knowledge_bases_base_created_idx"
    ON "conversation_turn_knowledge_bases"("knowledge_base_id", "created_at");

CREATE INDEX "conversation_message_knowledge_citations_message_idx"
    ON "conversation_message_knowledge_citations"("message_id", "citation_no");
CREATE INDEX "conversation_message_knowledge_citations_turn_idx"
    ON "conversation_message_knowledge_citations"("turn_id", "created_at");
CREATE INDEX "conversation_message_knowledge_citations_version_idx"
    ON "conversation_message_knowledge_citations"("document_version_id");
CREATE INDEX "conversation_message_knowledge_citations_base_document_idx"
    ON "conversation_message_knowledge_citations"("knowledge_base_id", "document_id");

CREATE INDEX "conversation_message_knowledge_citation_anchors_message_idx"
    ON "conversation_message_knowledge_citation_anchors"("message_id", "occurrence_no");
CREATE INDEX "conversation_message_knowledge_citation_anchors_citation_idx"
    ON "conversation_message_knowledge_citation_anchors"("citation_id");
