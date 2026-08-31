BEGIN;

ALTER TABLE "capabilities"
  DROP CONSTRAINT "capabilities_source_type_check";

ALTER TABLE "capabilities"
  ADD CONSTRAINT "capabilities_source_type_check"
  CHECK ("source_type" IN ('local', 'url', 'marketplace', 'clawhub'));

CREATE TABLE "clawhub_sync_runs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "status" VARCHAR(32) NOT NULL,
  "trigger" VARCHAR(32) NOT NULL,
  "listed_count" INTEGER NOT NULL DEFAULT 0,
  "detail_count" INTEGER NOT NULL DEFAULT 0,
  "unavailable_count" INTEGER NOT NULL DEFAULT 0,
  "error_code" VARCHAR(120),
  "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finished_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "clawhub_sync_runs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "clawhub_sync_runs_status_check"
    CHECK ("status" IN ('running', 'succeeded', 'failed')),
  CONSTRAINT "clawhub_sync_runs_trigger_check"
    CHECK ("trigger" IN ('startup', 'scheduled')),
  CONSTRAINT "clawhub_sync_runs_counts_check"
    CHECK (
      "listed_count" >= 0
      AND "detail_count" >= 0
      AND "unavailable_count" >= 0
    ),
  CONSTRAINT "clawhub_sync_runs_completion_check"
    CHECK (
      ("status" = 'running' AND "finished_at" IS NULL AND "error_code" IS NULL)
      OR
      ("status" = 'succeeded' AND "finished_at" IS NOT NULL AND "error_code" IS NULL)
      OR
      ("status" = 'failed' AND "finished_at" IS NOT NULL AND "error_code" IS NOT NULL)
    )
);

CREATE INDEX "clawhub_sync_runs_status_started_idx"
  ON "clawhub_sync_runs"("status", "started_at");
CREATE INDEX "clawhub_sync_runs_finished_idx"
  ON "clawhub_sync_runs"("finished_at" DESC);

CREATE TABLE "clawhub_skills" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
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
  "owner_handle" VARCHAR(240) NOT NULL,
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
  "available" BOOLEAN NOT NULL DEFAULT FALSE,
  "unavailable_at" TIMESTAMPTZ(6),
  "last_seen_sync_run_id" UUID NOT NULL,
  "last_seen_at" TIMESTAMPTZ(6) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "clawhub_skills_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "clawhub_skills_owner_slug_key" UNIQUE ("owner_handle", "slug"),
  CONSTRAINT "clawhub_skills_topics_array_check"
    CHECK (jsonb_typeof("topics_json") = 'array'),
  CONSTRAINT "clawhub_skills_tags_object_check"
    CHECK (jsonb_typeof("tags_json") = 'object'),
  CONSTRAINT "clawhub_skills_metadata_object_check"
    CHECK ("metadata_json" IS NULL OR jsonb_typeof("metadata_json") = 'object'),
  CONSTRAINT "clawhub_skills_source_metadata_object_check"
    CHECK (jsonb_typeof("source_metadata_json") = 'object'),
  CONSTRAINT "clawhub_skills_moderation_reasons_array_check"
    CHECK (jsonb_typeof("moderation_reason_codes_json") = 'array'),
  CONSTRAINT "clawhub_skills_stats_check"
    CHECK (
      "download_count" >= 0
      AND "install_count" >= 0
      AND "star_count" >= 0
      AND "comment_count" >= 0
      AND "version_count" >= 0
      AND "file_count" >= 0
      AND "total_file_bytes" >= 0
    ),
  CONSTRAINT "clawhub_skills_security_status_check"
    CHECK ("security_status" IN ('clean', 'suspicious', 'malicious', 'unverified')),
  CONSTRAINT "clawhub_skills_availability_check"
    CHECK (
      ("available" = TRUE AND "unavailable_at" IS NULL)
      OR
      ("available" = FALSE)
    )
);

CREATE INDEX "clawhub_skills_available_download_slug_idx"
  ON "clawhub_skills"("available", "download_count" DESC, "slug");
CREATE INDEX "clawhub_skills_available_updated_slug_idx"
  ON "clawhub_skills"("available", "source_updated_at" DESC, "slug");
CREATE INDEX "clawhub_skills_last_seen_run_idx"
  ON "clawhub_skills"("last_seen_sync_run_id");
CREATE INDEX "clawhub_skills_search_text_trgm_idx"
  ON "clawhub_skills" USING GIN ("search_text" gin_trgm_ops);

CREATE TABLE "clawhub_skill_installations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "clawhub_skill_id" UUID NOT NULL,
  "capability_id" UUID NOT NULL,
  "installed_version" VARCHAR(240) NOT NULL,
  "source_security_status" VARCHAR(32) NOT NULL,
  "source_security_has_warnings" BOOLEAN NOT NULL,
  "content_sha256" VARCHAR(64) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "clawhub_skill_installations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "clawhub_skill_installations_user_skill_key"
    UNIQUE ("user_id", "clawhub_skill_id"),
  CONSTRAINT "clawhub_skill_installations_capability_key"
    UNIQUE ("capability_id"),
  CONSTRAINT "clawhub_skill_installations_security_status_check"
    CHECK ("source_security_status" IN ('clean', 'suspicious', 'malicious', 'unverified')),
  CONSTRAINT "clawhub_skill_installations_content_sha256_check"
    CHECK ("content_sha256" ~ '^[0-9a-f]{64}$')
);

CREATE INDEX "clawhub_skill_installations_skill_created_idx"
  ON "clawhub_skill_installations"("clawhub_skill_id", "created_at");
CREATE INDEX "clawhub_skill_installations_user_created_idx"
  ON "clawhub_skill_installations"("user_id", "created_at" DESC);

COMMIT;
