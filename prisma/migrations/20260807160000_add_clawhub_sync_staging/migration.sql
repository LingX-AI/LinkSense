BEGIN;

CREATE TABLE "clawhub_skill_sync_staging" (
  "run_id" UUID NOT NULL,
  "owner_handle" VARCHAR(240) NOT NULL,
  "slug" VARCHAR(240) NOT NULL,
  "display_name" VARCHAR(1000) NOT NULL,
  "summary" TEXT,
  "topics_json" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "tags_json" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "download_count" INTEGER NOT NULL DEFAULT 0,
  "install_count" INTEGER NOT NULL DEFAULT 0,
  "star_count" INTEGER NOT NULL DEFAULT 0,
  "comment_count" INTEGER NOT NULL DEFAULT 0,
  "version_count" INTEGER NOT NULL DEFAULT 0,
  "latest_version" VARCHAR(240),
  "latest_version_created_at" TIMESTAMPTZ(6),
  "latest_version_changelog" TEXT,
  "latest_version_license" VARCHAR(240),
  "owner_display_name" VARCHAR(500),
  "owner_image_url" TEXT,
  "metadata_json" JSONB,
  "source_metadata_json" JSONB NOT NULL,
  "moderation_verdict" VARCHAR(32),
  "moderation_reason_codes_json" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "moderation_summary" TEXT,
  "moderation_engine_version" VARCHAR(120),
  "moderation_updated_at" TIMESTAMPTZ(6),
  "is_suspicious" BOOLEAN NOT NULL DEFAULT FALSE,
  "is_malware_blocked" BOOLEAN NOT NULL DEFAULT FALSE,
  "security_status" VARCHAR(32) NOT NULL DEFAULT 'unverified',
  "security_has_warnings" BOOLEAN NOT NULL DEFAULT FALSE,
  "security_checked_at" TIMESTAMPTZ(6),
  "file_count" INTEGER NOT NULL DEFAULT 0,
  "total_file_bytes" BIGINT NOT NULL DEFAULT 0,
  "canonical_url" TEXT,
  "search_text" TEXT NOT NULL,
  "source_created_at" TIMESTAMPTZ(6) NOT NULL,
  "source_updated_at" TIMESTAMPTZ(6) NOT NULL,
  "seen_at" TIMESTAMPTZ(6) NOT NULL,
  "staged_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "clawhub_skill_sync_staging_pkey"
    PRIMARY KEY ("run_id", "owner_handle", "slug"),
  CONSTRAINT "clawhub_skill_sync_staging_topics_array_check"
    CHECK (jsonb_typeof("topics_json") = 'array'),
  CONSTRAINT "clawhub_skill_sync_staging_tags_object_check"
    CHECK (jsonb_typeof("tags_json") = 'object'),
  CONSTRAINT "clawhub_skill_sync_staging_metadata_object_check"
    CHECK ("metadata_json" IS NULL OR jsonb_typeof("metadata_json") = 'object'),
  CONSTRAINT "clawhub_skill_sync_staging_source_metadata_object_check"
    CHECK (jsonb_typeof("source_metadata_json") = 'object'),
  CONSTRAINT "clawhub_skill_sync_staging_moderation_reasons_array_check"
    CHECK (jsonb_typeof("moderation_reason_codes_json") = 'array'),
  CONSTRAINT "clawhub_skill_sync_staging_stats_check"
    CHECK (
      "download_count" >= 0
      AND "install_count" >= 0
      AND "star_count" >= 0
      AND "comment_count" >= 0
      AND "version_count" >= 0
      AND "file_count" >= 0
      AND "total_file_bytes" >= 0
    ),
  CONSTRAINT "clawhub_skill_sync_staging_security_status_check"
    CHECK ("security_status" IN ('clean', 'suspicious', 'malicious', 'unverified'))
);

COMMIT;
