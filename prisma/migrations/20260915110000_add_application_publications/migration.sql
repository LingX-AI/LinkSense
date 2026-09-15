BEGIN;

-- Keep all applications, grants, embed credentials and external-session IDs.
-- Existing definitions are captured by the offline asset conversion before the
-- upgraded API starts. No application is silently granted copy permission.
ALTER TABLE "applications"
  ADD COLUMN "usage_instructions" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "published_version_id" UUID,
  ADD COLUMN "allow_copy" BOOLEAN NOT NULL DEFAULT FALSE;
CREATE TABLE "application_versions" (
  "id" UUID NOT NULL,
  "application_id" UUID NOT NULL,
  "version_number" INTEGER NOT NULL,
  "definition_json" JSONB NOT NULL,
  "assets_ready" BOOLEAN NOT NULL DEFAULT FALSE,
  "created_by" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "application_versions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "application_versions_number_check" CHECK ("version_number" > 0),
  CONSTRAINT "application_versions_definition_check" CHECK (jsonb_typeof("definition_json") = 'object' AND octet_length("definition_json"::text) <= 2097152)
);
CREATE UNIQUE INDEX "application_versions_application_number_key" ON "application_versions" ("application_id", "version_number");
CREATE INDEX "application_versions_created_by_idx" ON "application_versions" ("created_by");
ALTER TABLE "conversations" ADD COLUMN "application_version_id" UUID;

INSERT INTO "application_versions" ("id", "application_id", "version_number", "definition_json", "created_by")
SELECT gen_random_uuid(), "id", 1, jsonb_build_object('conversionRequired', true), "owner_id"
FROM "applications" WHERE "status" <> 'deleted';
UPDATE "applications" AS application SET "published_version_id" = version."id"
FROM "application_versions" AS version WHERE version."application_id" = application."id";
UPDATE "conversations" AS conversation SET "application_version_id" = application."published_version_id"
FROM "applications" AS application WHERE conversation."application_id" = application."id";

COMMIT;
