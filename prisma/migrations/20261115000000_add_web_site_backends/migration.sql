CREATE TABLE "web_site_backends" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "name" VARCHAR(128) NOT NULL,
    "project_id" VARCHAR(36) NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'preparing',
    "encrypted_credential" TEXT,
    "lease_until" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "web_site_backends_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "web_site_backends_project_key" ON "web_site_backends"("project_id");
CREATE UNIQUE INDEX "web_site_backends_source_name_key" ON "web_site_backends"("owner_id", "conversation_id", "name");
CREATE INDEX "web_site_backends_owner_idx" ON "web_site_backends"("owner_id", "updated_at");
ALTER TABLE "web_sites" ADD COLUMN "backend_id" UUID;
CREATE UNIQUE INDEX "web_sites_backend_key" ON "web_sites"("backend_id");
