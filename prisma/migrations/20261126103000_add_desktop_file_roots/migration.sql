CREATE TABLE "desktop_file_roots" (
  "id" UUID NOT NULL,
  "owner_id" UUID NOT NULL,
  "device_id" UUID NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "mode" VARCHAR(16) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  "revoked_at" TIMESTAMPTZ(6),
  CONSTRAINT "desktop_file_roots_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "desktop_file_roots_owner_device_idx" ON "desktop_file_roots"("owner_id", "device_id", "revoked_at");
