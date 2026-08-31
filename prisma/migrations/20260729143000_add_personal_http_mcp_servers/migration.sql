CREATE TABLE "mcp_servers" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "server_key" VARCHAR(40) NOT NULL,
    "url" TEXT NOT NULL,
    "auth_type" VARCHAR(32) NOT NULL,
    "api_key_header" VARCHAR(120),
    "encrypted_credential" TEXT,
    "encryption_key_id" VARCHAR(120),
    "status" VARCHAR(32) NOT NULL DEFAULT 'active',
    "required" BOOLEAN NOT NULL DEFAULT false,
    "startup_timeout_seconds" INTEGER NOT NULL DEFAULT 10,
    "tool_timeout_seconds" INTEGER NOT NULL DEFAULT 60,
    "insecure_http_acknowledged" BOOLEAN NOT NULL DEFAULT false,
    "last_test_status" VARCHAR(32),
    "last_test_error_code" VARCHAR(120),
    "last_tested_at" TIMESTAMPTZ(6),
    "last_used_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "mcp_servers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "mcp_servers_owner_server_key_key"
    ON "mcp_servers"("owner_id", "server_key");
CREATE INDEX "mcp_servers_owner_status_updated_idx"
    ON "mcp_servers"("owner_id", "status", "updated_at" DESC);

ALTER TABLE "conversation_turns"
    ADD COLUMN "mcp_generation" VARCHAR(64) NOT NULL DEFAULT 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    ADD COLUMN "mcp_servers_json" JSONB NOT NULL DEFAULT '[]';

ALTER TABLE "conversation_turn_start_intents"
    ADD COLUMN "mcp_generation" VARCHAR(64) NOT NULL DEFAULT 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    ADD COLUMN "mcp_servers_json" JSONB NOT NULL DEFAULT '[]',
    ADD COLUMN "mcp_credential_usage_receipts_json" JSONB NOT NULL DEFAULT '[]';
