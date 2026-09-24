-- Additive migration: no existing data, fields or constraints are changed.
-- Historical-data preservation was explicitly approved for this migration.
CREATE TABLE "user_connections" (
  "id" UUID NOT NULL,
  "owner_id" UUID NOT NULL,
  "provider" VARCHAR(32) NOT NULL,
  "status" VARCHAR(32) NOT NULL DEFAULT 'disconnected',
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "account_name" VARCHAR(320),
  "encrypted_payload" TEXT,
  "encryption_key_id" VARCHAR(120),
  "revision" INTEGER NOT NULL DEFAULT 0,
  "connected_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "user_connections_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "user_connections_provider_check" CHECK ("provider" IN ('onedrive', 'sharepoint')),
  CONSTRAINT "user_connections_status_check" CHECK ("status" IN ('connected', 'reconnect_required', 'disconnected')),
  CONSTRAINT "user_connections_payload_check" CHECK (("encrypted_payload" IS NULL) = ("encryption_key_id" IS NULL))
);
CREATE UNIQUE INDEX "user_connections_owner_provider_key" ON "user_connections"("owner_id", "provider");
