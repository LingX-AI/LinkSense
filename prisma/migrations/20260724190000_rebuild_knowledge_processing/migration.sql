-- Rebuild the knowledge-processing persistence contract around immutable
-- Docling artifacts, explicit external-task attempts and page-level citations.
--
-- DATA LOSS: the product owner explicitly approved treating the knowledge
-- domain as new. This migration removes all knowledge bases, documents,
-- versions, grants, stored-object metadata, processing/maintenance state and
-- knowledge citations. Users, conversations and ordinary message content are
-- preserved. Knowledge selections embedded in conversation state are reset.

BEGIN;

TRUNCATE TABLE
    "conversation_message_knowledge_citation_anchors",
    "conversation_message_knowledge_citations",
    "conversation_turn_knowledge_bases",
    "knowledge_base_storage_reservations",
    "knowledge_base_cleanup_outbox",
    "knowledge_base_maintenance_tasks",
    "knowledge_base_objects",
    "knowledge_base_document_versions",
    "knowledge_base_document_tombstones",
    "knowledge_base_documents",
    "knowledge_base_grants",
    "knowledge_base_tombstones",
    "knowledge_bases";

UPDATE "conversations"
SET "selected_knowledge_base_ids_json" = '[]'::jsonb
WHERE "selected_knowledge_base_ids_json" <> '[]'::jsonb;

UPDATE "conversation_drafts"
SET "knowledge_base_ids_json" = '[]'::jsonb
WHERE "knowledge_base_ids_json" <> '[]'::jsonb;

UPDATE "pending_requests"
SET "knowledge_base_ids_json" = '[]'::jsonb
WHERE "knowledge_base_ids_json" <> '[]'::jsonb;

UPDATE "conversation_turn_start_intents"
SET "knowledge_base_ids_json" = '[]'::jsonb
WHERE "knowledge_base_ids_json" <> '[]'::jsonb;

UPDATE "conversation_turns"
SET "knowledge_base_ids_json" = '[]'::jsonb
WHERE "knowledge_base_ids_json" <> '[]'::jsonb;

ALTER TABLE "knowledge_base_documents"
    DROP CONSTRAINT "knowledge_base_documents_hashes_check",
    DROP COLUMN "segmentation_config_digest",
    DROP COLUMN "segmentation_integrity_digest",
    ADD COLUMN "chunking_config_digest" VARCHAR(64),
    ADD COLUMN "retrieval_manifest_sha256" VARCHAR(64),
    ADD COLUMN "index_integrity_digest" VARCHAR(64),
    ADD CONSTRAINT "knowledge_base_documents_hashes_check" CHECK (
        ("embedding_profile_hash" IS NULL OR "embedding_profile_hash" ~ '^[0-9a-f]{64}$')
        AND ("chunking_config_digest" IS NULL OR "chunking_config_digest" ~ '^[0-9a-f]{64}$')
        AND ("retrieval_manifest_sha256" IS NULL OR "retrieval_manifest_sha256" ~ '^[0-9a-f]{64}$')
        AND ("index_integrity_digest" IS NULL OR "index_integrity_digest" ~ '^[0-9a-f]{64}$')
    );

DROP INDEX "knowledge_base_document_versions_docling_task_idx";

ALTER TABLE "knowledge_base_document_versions"
    DROP CONSTRAINT "knowledge_base_document_versions_stage_check",
    DROP CONSTRAINT "knowledge_base_document_versions_sha_check",
    DROP CONSTRAINT "knowledge_base_document_versions_json_check",
    DROP CONSTRAINT "knowledge_base_document_versions_counts_check",
    DROP COLUMN "docling_task_id",
    DROP COLUMN "docling_result_discarded",
    DROP COLUMN "markdown_normalization_version",
    DROP COLUMN "markdown_sha256",
    DROP COLUMN "parsing_config_version",
    DROP COLUMN "checkpoint_json",
    DROP COLUMN "segmentation_config_digest",
    DROP COLUMN "retrieval_fragment_count",
    DROP COLUMN "segmentation_integrity_digest",
    ADD COLUMN "failed_stage" VARCHAR(32),
    ADD COLUMN "docling_bundle_object_id" UUID,
    ADD COLUMN "docling_bundle_sha256" VARCHAR(64),
    ADD COLUMN "display_markdown_object_id" UUID,
    ADD COLUMN "display_markdown_sha256" VARCHAR(64),
    ADD COLUMN "docling_json_object_id" UUID,
    ADD COLUMN "docling_json_sha256" VARCHAR(64),
    ADD COLUMN "hybrid_chunks_object_id" UUID,
    ADD COLUMN "hybrid_chunks_sha256" VARCHAR(64),
    ADD COLUMN "retrieval_manifest_object_id" UUID,
    ADD COLUMN "retrieval_manifest_sha256" VARCHAR(64),
    ADD COLUMN "chunker_version" VARCHAR(120),
    ADD COLUMN "parsed_asset_count" INTEGER,
    ADD COLUMN "parser_config_digest" VARCHAR(64),
    ADD COLUMN "chunking_config_digest" VARCHAR(64),
    ADD COLUMN "child_count" INTEGER,
    ADD COLUMN "index_integrity_digest" VARCHAR(64),
    ADD COLUMN "activation_previous_current_version_id" UUID,
    ADD CONSTRAINT "knowledge_base_document_versions_stage_check" CHECK (
        "processing_stage" IN (
            'uploading', 'validating', 'queued', 'parsing', 'chunking',
            'parenting', 'embedding', 'indexing', 'activating', 'completed',
            'failed'
        )
    ),
    ADD CONSTRAINT "knowledge_base_document_versions_failed_stage_check" CHECK (
        "failed_stage" IS NULL OR "failed_stage" IN (
            'parsing', 'chunking', 'parenting', 'embedding', 'indexing',
            'activating'
        )
    ),
    ADD CONSTRAINT "knowledge_base_document_versions_sha_check" CHECK (
        "original_sha256" ~ '^[0-9a-f]{64}$'
        AND ("docling_bundle_sha256" IS NULL OR "docling_bundle_sha256" ~ '^[0-9a-f]{64}$')
        AND ("display_markdown_sha256" IS NULL OR "display_markdown_sha256" ~ '^[0-9a-f]{64}$')
        AND ("docling_json_sha256" IS NULL OR "docling_json_sha256" ~ '^[0-9a-f]{64}$')
        AND ("hybrid_chunks_sha256" IS NULL OR "hybrid_chunks_sha256" ~ '^[0-9a-f]{64}$')
        AND ("retrieval_manifest_sha256" IS NULL OR "retrieval_manifest_sha256" ~ '^[0-9a-f]{64}$')
        AND ("processing_config_digest" IS NULL OR "processing_config_digest" ~ '^[0-9a-f]{64}$')
        AND ("parser_config_digest" IS NULL OR "parser_config_digest" ~ '^[0-9a-f]{64}$')
        AND ("chunking_config_digest" IS NULL OR "chunking_config_digest" ~ '^[0-9a-f]{64}$')
        AND ("embedding_profile_hash" IS NULL OR "embedding_profile_hash" ~ '^[0-9a-f]{64}$')
        AND ("index_integrity_digest" IS NULL OR "index_integrity_digest" ~ '^[0-9a-f]{64}$')
    ),
    ADD CONSTRAINT "knowledge_base_document_versions_artifact_pairs_check" CHECK (
        (("docling_bundle_object_id" IS NULL AND "docling_bundle_sha256" IS NULL)
          OR ("docling_bundle_object_id" IS NOT NULL AND "docling_bundle_sha256" IS NOT NULL))
        AND (("display_markdown_object_id" IS NULL AND "display_markdown_sha256" IS NULL)
          OR ("display_markdown_object_id" IS NOT NULL AND "display_markdown_sha256" IS NOT NULL))
        AND (("docling_json_object_id" IS NULL AND "docling_json_sha256" IS NULL)
          OR ("docling_json_object_id" IS NOT NULL AND "docling_json_sha256" IS NOT NULL))
        AND (("hybrid_chunks_object_id" IS NULL AND "hybrid_chunks_sha256" IS NULL)
          OR ("hybrid_chunks_object_id" IS NOT NULL AND "hybrid_chunks_sha256" IS NOT NULL))
        AND (("retrieval_manifest_object_id" IS NULL AND "retrieval_manifest_sha256" IS NULL)
          OR ("retrieval_manifest_object_id" IS NOT NULL AND "retrieval_manifest_sha256" IS NOT NULL))
    ),
    ADD CONSTRAINT "knowledge_base_document_versions_json_check" CHECK (
        jsonb_typeof("processing_config_json") = 'object'
        AND ("stable_error_params_json" IS NULL OR jsonb_typeof("stable_error_params_json") = 'object')
    ),
    ADD CONSTRAINT "knowledge_base_document_versions_counts_check" CHECK (
        ("parsed_asset_count" IS NULL OR "parsed_asset_count" >= 0)
        AND
        ("parent_count" IS NULL OR "parent_count" >= 0)
        AND ("child_count" IS NULL OR "child_count" >= 0)
    );

CREATE TABLE "knowledge_base_processing_attempts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "knowledge_base_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "document_version_id" UUID NOT NULL,
    "processing_generation" UUID NOT NULL,
    "task_kind" VARCHAR(32) NOT NULL,
    "processing_stage" VARCHAR(32) NOT NULL,
    "attempt_no" INTEGER NOT NULL,
    "task_id" VARCHAR(200) NOT NULL,
    "status" VARCHAR(32) NOT NULL DEFAULT 'active',
    "stable_error_code" VARCHAR(120),
    "submitted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(6),
    "failed_at" TIMESTAMPTZ(6),
    "discarded_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "knowledge_base_processing_attempts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "knowledge_base_processing_attempts_kind_stage_check" CHECK (
        ("task_kind" = 'convert' AND "processing_stage" = 'parsing')
        OR ("task_kind" = 'hybrid_chunk' AND "processing_stage" = 'chunking')
    ),
    CONSTRAINT "knowledge_base_processing_attempts_number_check" CHECK (
        "attempt_no" > 0
    ),
    CONSTRAINT "knowledge_base_processing_attempts_status_check" CHECK (
        "status" IN ('active', 'completed', 'failed', 'discarded')
    ),
    CONSTRAINT "knowledge_base_processing_attempts_terminal_state_check" CHECK (
        ("status" = 'active'
          AND "completed_at" IS NULL
          AND "failed_at" IS NULL
          AND "discarded_at" IS NULL
          AND "stable_error_code" IS NULL)
        OR ("status" = 'completed'
          AND "completed_at" IS NOT NULL
          AND "failed_at" IS NULL
          AND "discarded_at" IS NULL
          AND "stable_error_code" IS NULL)
        OR ("status" = 'failed'
          AND "completed_at" IS NULL
          AND "failed_at" IS NOT NULL
          AND "discarded_at" IS NULL
          AND "stable_error_code" IS NOT NULL)
        OR ("status" = 'discarded'
          AND "completed_at" IS NULL
          AND "failed_at" IS NULL
          AND "discarded_at" IS NOT NULL
          AND "stable_error_code" IS NULL)
    )
);

CREATE UNIQUE INDEX "kb_processing_attempts_version_gen_kind_no_key"
    ON "knowledge_base_processing_attempts"(
        "document_version_id", "processing_generation", "task_kind", "attempt_no"
    );
CREATE UNIQUE INDEX "kb_processing_attempts_kind_task_key"
    ON "knowledge_base_processing_attempts"("task_kind", "task_id");
CREATE UNIQUE INDEX "kb_processing_attempts_one_active_key"
    ON "knowledge_base_processing_attempts"(
        "document_version_id", "processing_generation", "task_kind"
    )
    WHERE "status" = 'active';
CREATE INDEX "kb_processing_attempts_active_lookup_idx"
    ON "knowledge_base_processing_attempts"(
        "document_version_id", "processing_generation", "task_kind", "status"
    );
CREATE INDEX "kb_processing_attempts_status_updated_idx"
    ON "knowledge_base_processing_attempts"("status", "updated_at");

ALTER TABLE "knowledge_base_objects"
    DROP CONSTRAINT "knowledge_base_objects_type_check",
    DROP CONSTRAINT "knowledge_base_objects_size_check",
    ADD CONSTRAINT "knowledge_base_objects_size_check" CHECK ("size_bytes" >= 0),
    ADD CONSTRAINT "knowledge_base_objects_type_check" CHECK (
        "object_type" IN (
            'original', 'docling_bundle', 'display_markdown', 'docling_json',
            'hybrid_chunks', 'retrieval_manifest', 'asset'
        )
    );

ALTER TABLE "conversation_message_knowledge_citations"
    DROP CONSTRAINT "conversation_message_knowledge_citations_provenance_check",
    DROP COLUMN "provenance_json",
    ADD COLUMN "title_path" VARCHAR(500)[] NOT NULL DEFAULT ARRAY[]::VARCHAR(500)[],
    ADD COLUMN "matched_child_ids" VARCHAR(160)[] NOT NULL DEFAULT ARRAY[]::VARCHAR(160)[],
    ADD COLUMN "page_numbers" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
    ADD CONSTRAINT "conversation_message_knowledge_citations_title_path_check" CHECK (
        cardinality("title_path") <= 64
        AND array_position("title_path", NULL) IS NULL
    ),
    ADD CONSTRAINT "conversation_message_knowledge_citations_children_check" CHECK (
        cardinality("matched_child_ids") <= 1000
        AND array_position("matched_child_ids", NULL) IS NULL
    ),
    ADD CONSTRAINT "conversation_message_knowledge_citations_pages_check" CHECK (
        cardinality("page_numbers") <= 1000
        AND array_position("page_numbers", NULL) IS NULL
        AND 0 < ALL("page_numbers")
    );

COMMIT;
