ALTER TABLE "applications"
  ADD COLUMN "kind" VARCHAR(32) NOT NULL DEFAULT 'standard',
  ADD COLUMN "interactive_package_id" UUID;

ALTER TABLE "applications"
  ADD CONSTRAINT "applications_kind_package_check"
  CHECK (
    ("kind" = 'standard' AND "interactive_package_id" IS NULL)
    OR
    ("kind" = 'interactive' AND "interactive_package_id" IS NOT NULL)
  );

CREATE INDEX "applications_kind_status_updated_idx"
  ON "applications" ("kind", "status", "updated_at" DESC);

CREATE INDEX "applications_interactive_package_idx"
  ON "applications" ("interactive_package_id");

CREATE TABLE "interactive_application_packages" (
  "id" UUID NOT NULL,
  "application_id" UUID NOT NULL,
  "version" VARCHAR(80) NOT NULL,
  "manifest_json" JSONB NOT NULL,
  "archive_sha256" VARCHAR(64) NOT NULL,
  "file_count" INTEGER NOT NULL,
  "expanded_bytes" INTEGER NOT NULL,
  "created_by" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "interactive_application_packages_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "interactive_application_packages_archive_sha256_check"
    CHECK ("archive_sha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "interactive_application_packages_file_count_check"
    CHECK ("file_count" > 0),
  CONSTRAINT "interactive_application_packages_expanded_bytes_check"
    CHECK ("expanded_bytes" > 0)
);

CREATE UNIQUE INDEX "interactive_application_packages_application_version_key"
  ON "interactive_application_packages" ("application_id", "version");

CREATE INDEX "interactive_application_packages_application_created_idx"
  ON "interactive_application_packages" ("application_id", "created_at" DESC);

CREATE INDEX "interactive_application_packages_created_by_idx"
  ON "interactive_application_packages" ("created_by");

CREATE TABLE "interactive_application_assets" (
  "id" UUID NOT NULL,
  "package_id" UUID NOT NULL,
  "path" TEXT NOT NULL,
  "object_key" TEXT NOT NULL,
  "content_type" VARCHAR(160) NOT NULL,
  "byte_size" INTEGER NOT NULL,
  "sha256" VARCHAR(64) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "interactive_application_assets_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "interactive_application_assets_path_check"
    CHECK ("path" <> '' AND "path" !~ '(^|/)\.\.?(/|$)'),
  CONSTRAINT "interactive_application_assets_byte_size_check"
    CHECK ("byte_size" >= 0),
  CONSTRAINT "interactive_application_assets_sha256_check"
    CHECK ("sha256" ~ '^[0-9a-f]{64}$')
);

CREATE UNIQUE INDEX "interactive_application_assets_package_path_key"
  ON "interactive_application_assets" ("package_id", "path");

CREATE UNIQUE INDEX "interactive_application_assets_object_key_key"
  ON "interactive_application_assets" ("object_key");

CREATE INDEX "interactive_application_assets_package_created_idx"
  ON "interactive_application_assets" ("package_id", "created_at");

CREATE TABLE "interactive_application_runtime_tickets" (
  "id" UUID NOT NULL,
  "token_hash" VARCHAR(64) NOT NULL,
  "owner_id" UUID NOT NULL,
  "application_id" UUID NOT NULL,
  "package_id" UUID NOT NULL,
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "interactive_application_runtime_tickets_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "interactive_application_runtime_tickets_hash_check"
    CHECK ("token_hash" ~ '^[0-9a-f]{64}$')
);

CREATE UNIQUE INDEX "interactive_application_runtime_tickets_hash_key"
  ON "interactive_application_runtime_tickets" ("token_hash");

CREATE INDEX "interactive_application_runtime_tickets_owner_expires_idx"
  ON "interactive_application_runtime_tickets" ("owner_id", "expires_at");

CREATE INDEX "interactive_app_runtime_tickets_app_package_expires_idx"
  ON "interactive_application_runtime_tickets" (
    "application_id",
    "package_id",
    "expires_at"
  );

CREATE INDEX "interactive_application_runtime_tickets_expires_idx"
  ON "interactive_application_runtime_tickets" ("expires_at");

ALTER TABLE "conversations"
  ADD COLUMN "interactive_application_package_id" UUID;

CREATE INDEX "conversations_interactive_package_owner_updated_idx"
  ON "conversations" (
    "interactive_application_package_id",
    "owner_id",
    "updated_at" DESC
  );
