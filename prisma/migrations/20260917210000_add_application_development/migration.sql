-- Additive migration: existing applications and package versions remain unchanged.
ALTER TABLE "applications" ADD COLUMN "development_only" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "application_developments" (
  "id" UUID NOT NULL,
  "owner_id" UUID NOT NULL,
  "conversation_id" UUID NOT NULL,
  "name" VARCHAR(160) NOT NULL,
  "directory" VARCHAR(500) NOT NULL,
  "application_id" UUID,
  "preview_application_id" UUID,
  "preview_conversation_id" UUID,
  "revision" INTEGER NOT NULL DEFAULT 0,
  "installed_version" INTEGER NOT NULL DEFAULT 0,
  "source_hash" VARCHAR(64),
  "installed_source_hash" VARCHAR(64),
  "source_error" VARCHAR(80),
  "diagnostics_json" JSONB NOT NULL DEFAULT '[]',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "application_developments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "application_developments_revision_check" CHECK ("revision" >= 0 AND "installed_version" >= 0),
  CONSTRAINT "application_developments_diagnostics_check" CHECK (jsonb_typeof("diagnostics_json") = 'array' AND jsonb_array_length("diagnostics_json") <= 20)
);
CREATE UNIQUE INDEX "application_developments_conversation_key" ON "application_developments"("conversation_id");
CREATE UNIQUE INDEX "application_developments_application_key" ON "application_developments"("application_id");
CREATE UNIQUE INDEX "application_developments_preview_application_key" ON "application_developments"("preview_application_id");
CREATE INDEX "application_developments_owner_updated_idx" ON "application_developments"("owner_id", "updated_at" DESC);
