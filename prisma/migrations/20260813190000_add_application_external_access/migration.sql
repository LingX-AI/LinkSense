ALTER TABLE "users"
  ADD COLUMN "account_type" VARCHAR(32) NOT NULL DEFAULT 'member';

CREATE INDEX "users_account_type_status_idx"
  ON "users"("account_type", "status");

CREATE TABLE "application_mcp_servers" (
    "id" UUID NOT NULL,
    "application_id" UUID NOT NULL,
    "mcp_server_id" UUID NOT NULL,
    "mcp_server_name_snapshot" VARCHAR(160) NOT NULL,
    "selection_order" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "application_mcp_servers_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "application_mcp_servers_selection_order_check"
      CHECK ("selection_order" >= 0)
);

CREATE UNIQUE INDEX "application_mcp_servers_application_server_key"
  ON "application_mcp_servers"("application_id", "mcp_server_id");
CREATE UNIQUE INDEX "application_mcp_servers_application_order_key"
  ON "application_mcp_servers"("application_id", "selection_order");
CREATE INDEX "application_mcp_servers_server_created_idx"
  ON "application_mcp_servers"("mcp_server_id", "created_at");

CREATE TABLE "application_credential_bindings" (
    "id" UUID NOT NULL,
    "application_id" UUID NOT NULL,
    "capability_id" UUID NOT NULL,
    "env_key" VARCHAR(120) NOT NULL,
    "encrypted_value" TEXT NOT NULL,
    "encryption_key_id" VARCHAR(120) NOT NULL,
    "status" VARCHAR(32) NOT NULL DEFAULT 'active',
    "created_by" UUID NOT NULL,
    "updated_by" UUID,
    "last_used_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "application_credential_bindings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "application_credential_bindings_status_check"
      CHECK ("status" IN ('active', 'disabled')),
    CONSTRAINT "application_credential_bindings_env_key_check"
      CHECK ("env_key" ~ '^[A-Za-z_][A-Za-z0-9_]*$')
);

CREATE UNIQUE INDEX "application_credential_bindings_application_capability_env_key"
  ON "application_credential_bindings"("application_id", "capability_id", "env_key");
CREATE INDEX "application_credential_bindings_application_status_idx"
  ON "application_credential_bindings"("application_id", "status");
CREATE INDEX "application_credential_bindings_capability_status_idx"
  ON "application_credential_bindings"("capability_id", "status");
CREATE INDEX "application_credential_bindings_created_by_idx"
  ON "application_credential_bindings"("created_by");
CREATE INDEX "application_credential_bindings_updated_by_idx"
  ON "application_credential_bindings"("updated_by");

CREATE TABLE "application_external_access" (
    "id" UUID NOT NULL,
    "application_id" UUID NOT NULL,
    "public_id" VARCHAR(64) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "auth_mode" VARCHAR(32) NOT NULL DEFAULT 'required',
    "app_id" VARCHAR(80),
    "app_secret_hash" VARCHAR(64),
    "credential_version" INTEGER NOT NULL DEFAULT 1,
    "allowed_origins_json" JSONB NOT NULL DEFAULT '[]',
    "created_by" UUID NOT NULL,
    "updated_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "application_external_access_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "application_external_access_auth_mode_check"
      CHECK ("auth_mode" IN ('required', 'public')),
    CONSTRAINT "application_external_access_credential_version_check"
      CHECK ("credential_version" > 0),
    CONSTRAINT "application_external_access_auth_credentials_check"
      CHECK (
        ("auth_mode" = 'required' AND "app_id" IS NOT NULL AND "app_secret_hash" IS NOT NULL)
        OR ("auth_mode" = 'public')
      )
);

CREATE UNIQUE INDEX "application_external_access_application_key"
  ON "application_external_access"("application_id");
CREATE UNIQUE INDEX "application_external_access_public_key"
  ON "application_external_access"("public_id");
CREATE UNIQUE INDEX "application_external_access_app_id_key"
  ON "application_external_access"("app_id");
CREATE INDEX "application_external_access_enabled_public_idx"
  ON "application_external_access"("enabled", "public_id");
CREATE INDEX "application_external_access_created_by_idx"
  ON "application_external_access"("created_by");
CREATE INDEX "application_external_access_updated_by_idx"
  ON "application_external_access"("updated_by");

CREATE TABLE "application_embed_tickets" (
    "id" UUID NOT NULL,
    "external_access_id" UUID NOT NULL,
    "credential_version" INTEGER NOT NULL,
    "ticket_hash" VARCHAR(64) NOT NULL,
    "origin" TEXT NOT NULL,
    "external_subject" VARCHAR(320),
    "external_tenant" VARCHAR(240),
    "display_name" VARCHAR(120),
    "resume_session_id" UUID,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "consumed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "application_embed_tickets_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "application_embed_tickets_credential_version_check"
      CHECK ("credential_version" > 0)
);

CREATE UNIQUE INDEX "application_embed_tickets_hash_key"
  ON "application_embed_tickets"("ticket_hash");
CREATE INDEX "application_embed_tickets_access_expires_idx"
  ON "application_embed_tickets"("external_access_id", "expires_at");
CREATE INDEX "application_embed_tickets_expiry_state_idx"
  ON "application_embed_tickets"("expires_at", "consumed_at");
CREATE INDEX "application_embed_tickets_resume_session_idx"
  ON "application_embed_tickets"("resume_session_id");

CREATE TABLE "application_external_sessions" (
    "id" UUID NOT NULL,
    "external_access_id" UUID NOT NULL,
    "application_id" UUID NOT NULL,
    "runtime_principal_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "external_subject" VARCHAR(320),
    "external_tenant" VARCHAR(240),
    "display_name" VARCHAR(120),
    "origin" TEXT NOT NULL,
    "status" VARCHAR(32) NOT NULL DEFAULT 'active',
    "credential_version" INTEGER NOT NULL,
    "absolute_expires_at" TIMESTAMPTZ(6) NOT NULL,
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ(6),
    "revoke_reason" VARCHAR(80),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "application_external_sessions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "application_external_sessions_status_check"
      CHECK ("status" IN ('active', 'revoked', 'expired')),
    CONSTRAINT "application_external_sessions_credential_version_check"
      CHECK ("credential_version" > 0)
);

CREATE UNIQUE INDEX "application_external_sessions_conversation_key"
  ON "application_external_sessions"("conversation_id");
CREATE UNIQUE INDEX "application_external_sessions_runtime_principal_key"
  ON "application_external_sessions"("runtime_principal_id");
CREATE INDEX "application_external_sessions_access_state_expiry_idx"
  ON "application_external_sessions"("external_access_id", "status", "absolute_expires_at");
CREATE INDEX "application_external_sessions_application_state_updated_idx"
  ON "application_external_sessions"("application_id", "status", "updated_at" DESC);
CREATE INDEX "application_external_sessions_principal_state_idx"
  ON "application_external_sessions"("runtime_principal_id", "status");
CREATE INDEX "application_external_sessions_external_identity_idx"
  ON "application_external_sessions"("external_subject", "external_tenant");

CREATE TABLE "application_external_refresh_tokens" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "family_id" UUID NOT NULL,
    "parent_token_id" UUID,
    "replaced_by_token_id" UUID,
    "rotation_request_id" UUID,
    "token_hash" VARCHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "revoke_reason" VARCHAR(80),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "application_external_refresh_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "application_external_refresh_tokens_hash_key"
  ON "application_external_refresh_tokens"("token_hash");
CREATE INDEX "application_external_refresh_tokens_session_expires_idx"
  ON "application_external_refresh_tokens"("session_id", "expires_at");
CREATE INDEX "application_external_refresh_tokens_family_created_idx"
  ON "application_external_refresh_tokens"("family_id", "created_at");
CREATE INDEX "application_external_refresh_tokens_parent_idx"
  ON "application_external_refresh_tokens"("parent_token_id");
CREATE INDEX "application_external_refresh_tokens_replaced_idx"
  ON "application_external_refresh_tokens"("replaced_by_token_id");
CREATE INDEX "application_external_refresh_tokens_rotation_request_idx"
  ON "application_external_refresh_tokens"("rotation_request_id");
CREATE INDEX "application_external_refresh_tokens_revoked_idx"
  ON "application_external_refresh_tokens"("revoked_at");
