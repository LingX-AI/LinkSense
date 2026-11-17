-- AlterTable
ALTER TABLE "conversations" ADD COLUMN     "desktop_device_id" UUID,
ADD COLUMN     "execution_target" VARCHAR(16) NOT NULL DEFAULT 'cloud';

-- CreateTable
CREATE TABLE "desktop_devices" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "platform" VARCHAR(32) NOT NULL,
    "arch" VARCHAR(32) NOT NULL,
    "app_version" VARCHAR(40) NOT NULL,
    "capabilities_json" JSONB NOT NULL DEFAULT '{}',
    "token_hash" VARCHAR(64) NOT NULL,
    "auth_valid_after" TIMESTAMPTZ(6) NOT NULL,
    "last_seen_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "desktop_devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "desktop_device_pairings" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "code_hash" VARCHAR(64) NOT NULL,
    "auth_valid_after" TIMESTAMPTZ(6) NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "consumed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "desktop_device_pairings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "local_computer_sessions" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "device_id" UUID NOT NULL,
    "status" VARCHAR(24) NOT NULL,
    "grant_scope" VARCHAR(24) NOT NULL,
    "expires_at" TIMESTAMPTZ(6),
    "ended_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "local_computer_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "computer_permission_grants" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "conversation_id" UUID,
    "device_id" UUID,
    "capability" VARCHAR(48) NOT NULL,
    "scope" VARCHAR(24) NOT NULL,
    "target_json" JSONB,
    "expires_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "computer_permission_grants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "desktop_devices_token_hash_key" ON "desktop_devices"("token_hash");

-- CreateIndex
CREATE INDEX "desktop_devices_owner_revoked_idx" ON "desktop_devices"("owner_id", "revoked_at");

-- CreateIndex
CREATE UNIQUE INDEX "desktop_pairings_code_hash_key" ON "desktop_device_pairings"("code_hash");

-- CreateIndex
CREATE INDEX "desktop_pairings_owner_expiry_idx" ON "desktop_device_pairings"("owner_id", "expires_at");

-- CreateIndex
CREATE INDEX "local_computer_sessions_conversation_status_idx" ON "local_computer_sessions"("conversation_id", "status");

-- CreateIndex
CREATE INDEX "computer_grants_owner_conversation_idx" ON "computer_permission_grants"("owner_id", "conversation_id", "revoked_at");

-- CreateIndex
CREATE INDEX "computer_grants_owner_device_idx" ON "computer_permission_grants"("owner_id", "device_id", "revoked_at");
