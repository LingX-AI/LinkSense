-- Add the exact image projection checkpoint and the optional image-understanding
-- processing stage. This is a forward-only, non-destructive migration: no
-- existing rows, objects or knowledge content are deleted.

BEGIN;

ALTER TABLE "knowledge_base_document_versions"
    DROP CONSTRAINT "knowledge_base_document_versions_stage_check",
    DROP CONSTRAINT "knowledge_base_document_versions_failed_stage_check",
    DROP CONSTRAINT "knowledge_base_document_versions_sha_check",
    DROP CONSTRAINT "knowledge_base_document_versions_artifact_pairs_check",
    ADD COLUMN "image_projection_object_id" UUID,
    ADD COLUMN "image_projection_sha256" VARCHAR(64),
    ADD COLUMN "image_understanding_config_digest" VARCHAR(64),
    ADD CONSTRAINT "knowledge_base_document_versions_stage_check" CHECK (
        "processing_stage" IN (
            'uploading', 'validating', 'queued', 'parsing', 'chunking',
            'image_understanding', 'parenting', 'embedding', 'indexing',
            'activating', 'completed', 'failed'
        )
    ),
    ADD CONSTRAINT "knowledge_base_document_versions_failed_stage_check" CHECK (
        "failed_stage" IS NULL OR "failed_stage" IN (
            'parsing', 'chunking', 'image_understanding', 'parenting',
            'embedding', 'indexing', 'activating'
        )
    ),
    ADD CONSTRAINT "knowledge_base_document_versions_sha_check" CHECK (
        "original_sha256" ~ '^[0-9a-f]{64}$'
        AND ("docling_bundle_sha256" IS NULL OR "docling_bundle_sha256" ~ '^[0-9a-f]{64}$')
        AND ("display_markdown_sha256" IS NULL OR "display_markdown_sha256" ~ '^[0-9a-f]{64}$')
        AND ("docling_json_sha256" IS NULL OR "docling_json_sha256" ~ '^[0-9a-f]{64}$')
        AND ("hybrid_chunks_sha256" IS NULL OR "hybrid_chunks_sha256" ~ '^[0-9a-f]{64}$')
        AND ("image_projection_sha256" IS NULL OR "image_projection_sha256" ~ '^[0-9a-f]{64}$')
        AND ("retrieval_manifest_sha256" IS NULL OR "retrieval_manifest_sha256" ~ '^[0-9a-f]{64}$')
        AND ("processing_config_digest" IS NULL OR "processing_config_digest" ~ '^[0-9a-f]{64}$')
        AND ("parser_config_digest" IS NULL OR "parser_config_digest" ~ '^[0-9a-f]{64}$')
        AND ("chunking_config_digest" IS NULL OR "chunking_config_digest" ~ '^[0-9a-f]{64}$')
        AND ("image_understanding_config_digest" IS NULL OR "image_understanding_config_digest" ~ '^[0-9a-f]{64}$')
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
        AND ((
            "image_projection_object_id" IS NULL
            AND "image_projection_sha256" IS NULL
            AND "image_understanding_config_digest" IS NULL
          ) OR (
            "image_projection_object_id" IS NOT NULL
            AND "image_projection_sha256" IS NOT NULL
            AND "image_understanding_config_digest" IS NOT NULL
          ))
        AND (("retrieval_manifest_object_id" IS NULL AND "retrieval_manifest_sha256" IS NULL)
          OR ("retrieval_manifest_object_id" IS NOT NULL AND "retrieval_manifest_sha256" IS NOT NULL))
    );

ALTER TABLE "knowledge_base_objects"
    DROP CONSTRAINT "knowledge_base_objects_type_check",
    ADD CONSTRAINT "knowledge_base_objects_type_check" CHECK (
        "object_type" IN (
            'original', 'docling_bundle', 'display_markdown', 'docling_json',
            'hybrid_chunks', 'image_projection', 'retrieval_manifest', 'asset'
        )
    );

COMMIT;
