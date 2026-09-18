-- Additive only: existing task files and sharing records remain unchanged.
CREATE TABLE "web_artifact_bundles" (
  "file_id" UUID NOT NULL PRIMARY KEY,
  "owner_id" UUID NOT NULL,
  "conversation_id" UUID NOT NULL,
  "manifest_json" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "web_artifact_bundles_manifest_check" CHECK (jsonb_typeof(manifest_json) = 'object' AND pg_column_size(manifest_json) <= 2097152)
);
CREATE INDEX "web_artifact_bundles_conversation_idx" ON "web_artifact_bundles"("conversation_id");
CREATE TABLE "web_sites" (
  "id" UUID NOT NULL PRIMARY KEY,
  "owner_id" UUID NOT NULL,
  "conversation_id" UUID,
  "source_task_title" VARCHAR(240) NOT NULL,
  "origin_file_id" UUID NOT NULL,
  "source_file_id" UUID NOT NULL,
  "name" VARCHAR(240) NOT NULL,
  "description" VARCHAR(1000) NOT NULL DEFAULT '',
  "slug" VARCHAR(80) NOT NULL,
  "status" VARCHAR(32) NOT NULL,
  "current_release_id" UUID NOT NULL,
  "deleted_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "web_sites_status_check" CHECK (status IN ('published', 'disabled')),
  CONSTRAINT "web_sites_slug_check" CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(slug) >= 3)
);
CREATE INDEX "web_sites_origin_file_idx" ON "web_sites"("origin_file_id");
CREATE UNIQUE INDEX "web_sites_slug_key" ON "web_sites"("slug");
CREATE INDEX "web_sites_owner_updated_idx" ON "web_sites"("owner_id", "updated_at" DESC, "id");
CREATE INDEX "web_sites_conversation_idx" ON "web_sites"("conversation_id");
CREATE TABLE "web_site_addresses" (
  "slug" VARCHAR(80) NOT NULL PRIMARY KEY,
  "site_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "web_site_addresses_site_idx" ON "web_site_addresses"("site_id");
CREATE TABLE "web_site_releases" (
  "id" UUID NOT NULL PRIMARY KEY,
  "site_id" UUID NOT NULL,
  "source_file_id" UUID NOT NULL,
  "manifest_json" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "web_site_releases_manifest_check" CHECK (jsonb_typeof(manifest_json) = 'object' AND pg_column_size(manifest_json) <= 2097152)
);
CREATE INDEX "web_site_releases_site_created_idx" ON "web_site_releases"("site_id", "created_at" DESC);
