-- LinkSense initial PostgreSQL schema.
-- This migration is additive only: it creates extensions, tables, checks, and
-- indexes. It intentionally contains no foreign keys, destructive DDL, or
-- data-rewrite statements.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "citext";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" CITEXT NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "avatar_object_key" TEXT,
    "role" VARCHAR(32) NOT NULL,
    "status" VARCHAR(32) NOT NULL,
    "password_hash" TEXT,
    "preferred_locale" VARCHAR(16),
    "last_login_at" TIMESTAMPTZ(6),
    "last_login_method" VARCHAR(32),
    "password_updated_at" TIMESTAMPTZ(6),
    "auth_valid_after" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "users_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "users_role_check" CHECK ("role" IN ('user', 'admin')),
    CONSTRAINT "users_status_check" CHECK ("status" IN ('active', 'disabled')),
    CONSTRAINT "users_last_login_method_check" CHECK (
        "last_login_method" IS NULL OR "last_login_method" IN ('password', 'oidc', 'teams')
    ),
    CONSTRAINT "users_preferred_locale_check" CHECK (
        "preferred_locale" IS NULL OR "preferred_locale" IN ('zh-CN', 'en-US')
    ),
    CONSTRAINT "users_password_state_check" CHECK (
        ("password_hash" IS NULL AND "password_updated_at" IS NULL)
        OR ("password_hash" IS NOT NULL AND "password_updated_at" IS NOT NULL)
    ),
    CONSTRAINT "users_auth_valid_after_check" CHECK ("auth_valid_after" >= "created_at")
);

CREATE TABLE "user_groups" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(120) NOT NULL,
    "description" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "user_groups_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "user_group_members" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "user_group_id" UUID NOT NULL,
    "status" VARCHAR(32) NOT NULL,
    "created_by" UUID,
    "revoked_by" UUID,
    "revoked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "user_group_members_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "user_group_members_status_check" CHECK ("status" IN ('active', 'revoked')),
    CONSTRAINT "user_group_members_revocation_check" CHECK (
        ("status" = 'revoked' AND "revoked_at" IS NOT NULL)
        OR ("status" = 'active' AND "revoked_at" IS NULL AND "revoked_by" IS NULL)
    )
);

CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "family_id" UUID NOT NULL,
    "parent_token_id" UUID,
    "replaced_by_token_id" UUID,
    "token_hash" TEXT NOT NULL,
    "user_agent" TEXT,
    "ip_address" INET,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "revoke_reason" VARCHAR(80),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "refresh_tokens_parent_not_self_check" CHECK (
        "parent_token_id" IS NULL OR "parent_token_id" <> "id"
    ),
    CONSTRAINT "refresh_tokens_replacement_not_self_check" CHECK (
        "replaced_by_token_id" IS NULL OR "replaced_by_token_id" <> "id"
    ),
    CONSTRAINT "refresh_tokens_expiry_check" CHECK ("expires_at" > "created_at"),
    CONSTRAINT "refresh_tokens_revoked_at_check" CHECK (
        "revoked_at" IS NULL OR "revoked_at" >= "created_at"
    )
);

CREATE TABLE "password_reset_tokens" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "consumed_at" TIMESTAMPTZ(6),
    "request_ip" INET,
    "request_user_agent" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "password_reset_tokens_expiry_check" CHECK ("expires_at" > "created_at"),
    CONSTRAINT "password_reset_tokens_consumed_at_check" CHECK (
        "consumed_at" IS NULL OR "consumed_at" >= "created_at"
    )
);

CREATE TABLE "capabilities" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "type" VARCHAR(32) NOT NULL,
    "scope" VARCHAR(32) NOT NULL,
    "owner_id" UUID,
    "name" VARCHAR(160) NOT NULL,
    "slug" VARCHAR(180) NOT NULL,
    "description" TEXT,
    "source_type" VARCHAR(32) NOT NULL,
    "logo_object_key" TEXT,
    "storage_path" TEXT NOT NULL,
    "manifest_json" JSONB,
    "risk_summary_json" JSONB,
    "status" VARCHAR(32) NOT NULL,
    "installed_by" UUID NOT NULL,
    "approved_by" UUID,
    "approved_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "capabilities_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "capabilities_type_check" CHECK ("type" IN ('plugin', 'skill')),
    CONSTRAINT "capabilities_scope_check" CHECK ("scope" IN ('personal', 'shared', 'global')),
    CONSTRAINT "capabilities_owner_check" CHECK (
        ("scope" IN ('personal', 'shared') AND "owner_id" IS NOT NULL)
        OR ("scope" = 'global' AND "owner_id" IS NULL)
    ),
    CONSTRAINT "capabilities_source_type_check" CHECK ("source_type" IN ('local', 'url')),
    CONSTRAINT "capabilities_status_check" CHECK ("status" IN ('active', 'disabled', 'failed')),
    CONSTRAINT "capabilities_approval_pair_check" CHECK (
        ("approved_by" IS NULL AND "approved_at" IS NULL)
        OR ("scope" = 'shared' AND "approved_by" IS NOT NULL AND "approved_at" IS NOT NULL)
    ),
    CONSTRAINT "capabilities_manifest_object_check" CHECK (
        "manifest_json" IS NULL OR jsonb_typeof("manifest_json") = 'object'
    ),
    CONSTRAINT "capabilities_risk_summary_object_check" CHECK (
        "risk_summary_json" IS NULL OR jsonb_typeof("risk_summary_json") = 'object'
    )
);

CREATE TABLE "capability_grants" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "capability_id" UUID NOT NULL,
    "grantee_type" VARCHAR(32) NOT NULL,
    "user_id" UUID,
    "user_group_id" UUID,
    "grant_kind" VARCHAR(40) NOT NULL,
    "status" VARCHAR(32) NOT NULL,
    "granted_by" UUID NOT NULL,
    "approval_request_id" UUID,
    "revoked_by" UUID,
    "revoked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "capability_grants_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "capability_grants_grantee_type_check" CHECK (
        "grantee_type" IN ('user', 'user_group', 'all_users')
    ),
    CONSTRAINT "capability_grants_grantee_check" CHECK (
        ("grantee_type" = 'user' AND "user_id" IS NOT NULL AND "user_group_id" IS NULL)
        OR ("grantee_type" = 'user_group' AND "user_id" IS NULL AND "user_group_id" IS NOT NULL)
        OR ("grantee_type" = 'all_users' AND "user_id" IS NULL AND "user_group_id" IS NULL)
    ),
    CONSTRAINT "capability_grants_kind_check" CHECK (
        "grant_kind" IN (
            'owner', 'direct_share', 'group_share', 'school_share',
            'admin_user_grant', 'admin_group_grant', 'global'
        )
    ),
    CONSTRAINT "capability_grants_kind_target_check" CHECK (
        ("grantee_type" = 'user' AND "grant_kind" IN ('owner', 'direct_share', 'admin_user_grant'))
        OR ("grantee_type" = 'user_group' AND "grant_kind" IN ('group_share', 'admin_group_grant'))
        OR ("grantee_type" = 'all_users' AND "grant_kind" IN ('school_share', 'global'))
    ),
    CONSTRAINT "capability_grants_status_check" CHECK ("status" IN ('active', 'revoked')),
    CONSTRAINT "capability_grants_revocation_check" CHECK (
        ("status" = 'active' AND "revoked_at" IS NULL AND "revoked_by" IS NULL)
        OR ("status" = 'revoked' AND "revoked_at" IS NOT NULL)
    )
);

CREATE TABLE "capability_share_requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "capability_id" UUID NOT NULL,
    "requester_id" UUID NOT NULL,
    "target_type" VARCHAR(32) NOT NULL,
    "user_group_id" UUID,
    "status" VARCHAR(32) NOT NULL,
    "reviewer_id" UUID,
    "review_comment" TEXT,
    "reviewed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "capability_share_requests_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "capability_share_requests_target_type_check" CHECK (
        "target_type" IN ('user_group', 'all_users')
    ),
    CONSTRAINT "capability_share_requests_target_check" CHECK (
        ("target_type" = 'user_group' AND "user_group_id" IS NOT NULL)
        OR ("target_type" = 'all_users' AND "user_group_id" IS NULL)
    ),
    CONSTRAINT "capability_share_requests_status_check" CHECK (
        "status" IN ('pending', 'approved', 'rejected', 'cancelled', 'revoked')
    ),
    CONSTRAINT "capability_share_requests_review_time_check" CHECK (
        "reviewed_at" IS NULL OR "reviewed_at" >= "created_at"
    )
);

CREATE TABLE "capability_user_preferences" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "capability_id" UUID NOT NULL,
    "status" VARCHAR(32) NOT NULL,
    "disabled_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "capability_user_preferences_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "capability_user_preferences_status_check" CHECK (
        "status" IN ('enabled', 'disabled')
    ),
    CONSTRAINT "capability_user_preferences_disabled_at_check" CHECK (
        ("status" = 'disabled' AND "disabled_at" IS NOT NULL)
        OR ("status" = 'enabled' AND "disabled_at" IS NULL)
    )
);

CREATE TABLE "credentials" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "scope" VARCHAR(32) NOT NULL,
    "owner_id" UUID,
    "name" VARCHAR(160) NOT NULL,
    "provider_type" VARCHAR(80) NOT NULL,
    "encrypted_payload" TEXT NOT NULL,
    "encryption_key_id" VARCHAR(120) NOT NULL,
    "status" VARCHAR(32) NOT NULL,
    "created_by" UUID NOT NULL,
    "updated_by" UUID,
    "last_used_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "credentials_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "credentials_scope_check" CHECK ("scope" IN ('personal', 'school')),
    CONSTRAINT "credentials_owner_check" CHECK (
        ("scope" = 'personal' AND "owner_id" IS NOT NULL)
        OR ("scope" = 'school' AND "owner_id" IS NULL)
    ),
    CONSTRAINT "credentials_status_check" CHECK ("status" IN ('active', 'disabled'))
);

CREATE TABLE "credential_bindings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "credential_id" UUID NOT NULL,
    "capability_id" UUID NOT NULL,
    "binding_scope" VARCHAR(32) NOT NULL,
    "user_id" UUID,
    "env_key" VARCHAR(120) NOT NULL,
    "status" VARCHAR(32) NOT NULL,
    "created_by" UUID NOT NULL,
    "revoked_by" UUID,
    "revoked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "credential_bindings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "credential_bindings_scope_check" CHECK (
        "binding_scope" IN ('personal', 'school')
    ),
    CONSTRAINT "credential_bindings_user_check" CHECK (
        ("binding_scope" = 'personal' AND "user_id" IS NOT NULL)
        OR ("binding_scope" = 'school' AND "user_id" IS NULL)
    ),
    CONSTRAINT "credential_bindings_status_check" CHECK ("status" IN ('active', 'revoked')),
    CONSTRAINT "credential_bindings_revocation_check" CHECK (
        ("status" = 'active' AND "revoked_at" IS NULL AND "revoked_by" IS NULL)
        OR ("status" = 'revoked' AND "revoked_at" IS NOT NULL)
    )
);

CREATE TABLE "conversations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "owner_id" UUID NOT NULL,
    "title" VARCHAR(240) NOT NULL,
    "title_source" VARCHAR(32) NOT NULL,
    "archive_status" VARCHAR(32) NOT NULL,
    "archived_at" TIMESTAMPTZ(6),
    "workspace_rel_path" TEXT NOT NULL,
    "codex_home_rel_path" TEXT NOT NULL,
    "codex_thread_id" TEXT,
    "agents_template_version" VARCHAR(80),
    "last_turn_status" VARCHAR(32),
    "last_run_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "conversations_title_source_check" CHECK (
        "title_source" IN ('generated', 'fallback', 'manual')
    ),
    CONSTRAINT "conversations_archive_status_check" CHECK (
        "archive_status" IN ('active', 'archived')
    ),
    CONSTRAINT "conversations_archive_time_check" CHECK (
        ("archive_status" = 'active' AND "archived_at" IS NULL)
        OR ("archive_status" = 'archived' AND "archived_at" IS NOT NULL)
    ),
    CONSTRAINT "conversations_last_turn_status_check" CHECK (
        "last_turn_status" IS NULL
        OR "last_turn_status" IN ('running', 'completed', 'failed', 'interrupted')
    )
);

CREATE TABLE "conversation_drafts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "conversation_id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "input_text" TEXT NOT NULL,
    "priority_capability_ids_json" JSONB NOT NULL DEFAULT '[]'::jsonb,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "conversation_drafts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "conversation_drafts_priority_ids_array_check" CHECK (
        jsonb_typeof("priority_capability_ids_json") = 'array'
    )
);

CREATE TABLE "pending_requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "conversation_id" UUID NOT NULL,
    "queue_no" BIGINT NOT NULL,
    "submitted_by" UUID NOT NULL,
    "input_text" TEXT NOT NULL,
    "priority_capability_ids_json" JSONB NOT NULL DEFAULT '[]'::jsonb,
    "status" VARCHAR(32) NOT NULL,
    "block_code" VARCHAR(120),
    "idempotency_key" VARCHAR(120),
    "last_start_checked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "pending_requests_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "pending_requests_queue_no_check" CHECK ("queue_no" > 0),
    CONSTRAINT "pending_requests_status_check" CHECK (
        "status" IN ('waiting_previous_turn', 'blocked_overload', 'blocked_preflight')
    ),
    CONSTRAINT "pending_requests_block_code_check" CHECK (
        ("status" = 'blocked_preflight' AND "block_code" IS NOT NULL)
        OR ("status" <> 'blocked_preflight' AND "block_code" IS NULL)
    ),
    CONSTRAINT "pending_requests_priority_ids_array_check" CHECK (
        jsonb_typeof("priority_capability_ids_json") = 'array'
    )
);

CREATE TABLE "conversation_turns" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "conversation_id" UUID NOT NULL,
    "sequence_no" INTEGER NOT NULL,
    "submitted_by" UUID NOT NULL,
    "codex_thread_id" TEXT NOT NULL,
    "codex_turn_id" TEXT NOT NULL,
    "status" VARCHAR(32) NOT NULL,
    "submit_mode" VARCHAR(32) NOT NULL,
    "idempotency_key" VARCHAR(120),
    "started_at" TIMESTAMPTZ(6) NOT NULL,
    "completed_at" TIMESTAMPTZ(6),
    "interrupt_requested_at" TIMESTAMPTZ(6),
    "interrupted_at" TIMESTAMPTZ(6),
    "error_code" VARCHAR(120),
    "error_message" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "conversation_turns_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "conversation_turns_sequence_no_check" CHECK ("sequence_no" > 0),
    CONSTRAINT "conversation_turns_status_check" CHECK (
        "status" IN ('running', 'completed', 'failed', 'interrupted')
    ),
    CONSTRAINT "conversation_turns_submit_mode_check" CHECK (
        "submit_mode" IN ('normal', 'next_turn', 'manual_retry')
    ),
    CONSTRAINT "conversation_turns_timestamps_check" CHECK (
        ("completed_at" IS NULL OR "completed_at" >= "started_at")
        AND ("interrupt_requested_at" IS NULL OR "interrupt_requested_at" >= "started_at")
        AND (
            "interrupted_at" IS NULL
            OR ("interrupt_requested_at" IS NOT NULL AND "interrupted_at" >= "interrupt_requested_at")
        )
    ),
    CONSTRAINT "conversation_turns_terminal_state_check" CHECK (
        ("status" = 'running' AND "completed_at" IS NULL AND "interrupted_at" IS NULL AND "error_code" IS NULL)
        OR ("status" = 'completed' AND "completed_at" IS NOT NULL AND "interrupted_at" IS NULL AND "error_code" IS NULL)
        OR ("status" = 'failed' AND "completed_at" IS NOT NULL AND "interrupted_at" IS NULL AND "error_code" IS NOT NULL)
        OR (
            "status" = 'interrupted'
            AND "completed_at" IS NULL
            AND "interrupt_requested_at" IS NOT NULL
            AND "interrupted_at" IS NOT NULL
            AND "error_code" IS NULL
        )
    )
);

CREATE TABLE "conversation_messages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "conversation_id" UUID NOT NULL,
    "turn_id" UUID,
    "sequence_no" INTEGER NOT NULL,
    "role" VARCHAR(32) NOT NULL,
    "content_text" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "conversation_messages_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "conversation_messages_sequence_no_check" CHECK ("sequence_no" > 0),
    CONSTRAINT "conversation_messages_role_check" CHECK ("role" IN ('user', 'assistant'))
);

CREATE TABLE "conversation_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "conversation_id" UUID NOT NULL,
    "turn_id" UUID,
    "sequence_no" BIGINT NOT NULL,
    "event_type" VARCHAR(120) NOT NULL,
    "visibility" VARCHAR(32) NOT NULL,
    "payload_json" JSONB NOT NULL,
    "sse_event_id" VARCHAR(160) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "conversation_events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "conversation_events_sequence_no_check" CHECK ("sequence_no" > 0),
    CONSTRAINT "conversation_events_visibility_check" CHECK (
        "visibility" IN ('user_visible', 'user_collapsed', 'internal_sanitized')
    ),
    CONSTRAINT "conversation_events_payload_object_check" CHECK (
        jsonb_typeof("payload_json") = 'object'
    )
);

CREATE TABLE "conversation_files" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "conversation_id" UUID NOT NULL,
    "draft_id" UUID,
    "pending_request_id" UUID,
    "turn_id" UUID,
    "kind" VARCHAR(32) NOT NULL,
    "source" VARCHAR(32) NOT NULL,
    "status" VARCHAR(32) NOT NULL,
    "filename" VARCHAR(260) NOT NULL,
    "mime_type" VARCHAR(160),
    "size_bytes" BIGINT NOT NULL,
    "checksum_sha256" VARCHAR(64),
    "storage_backend" VARCHAR(32) NOT NULL,
    "workspace_relative_path" TEXT,
    "minio_object_key" TEXT,
    "downloadable" BOOLEAN NOT NULL,
    "download_card_event_id" UUID,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "conversation_files_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "conversation_files_kind_check" CHECK ("kind" IN ('attachment', 'artifact')),
    CONSTRAINT "conversation_files_source_check" CHECK (
        "source" IN ('user_upload', 'agent_generated', 'system_generated')
    ),
    CONSTRAINT "conversation_files_status_check" CHECK (
        "status" IN ('draft', 'pending', 'bound', 'registered')
    ),
    CONSTRAINT "conversation_files_kind_status_check" CHECK (
        ("kind" = 'attachment' AND "status" IN ('draft', 'pending', 'bound'))
        OR ("kind" = 'artifact' AND "status" = 'registered')
    ),
    CONSTRAINT "conversation_files_size_check" CHECK ("size_bytes" >= 0),
    CONSTRAINT "conversation_files_checksum_check" CHECK (
        "checksum_sha256" IS NULL OR "checksum_sha256" ~ '^[0-9a-fA-F]{64}$'
    ),
    CONSTRAINT "conversation_files_storage_backend_check" CHECK (
        "storage_backend" IN ('workspace', 'minio')
    ),
    CONSTRAINT "conversation_files_storage_location_check" CHECK (
        ("storage_backend" = 'workspace' AND "workspace_relative_path" IS NOT NULL AND "minio_object_key" IS NULL)
        OR ("storage_backend" = 'minio' AND "workspace_relative_path" IS NULL AND "minio_object_key" IS NOT NULL)
    ),
    CONSTRAINT "conversation_files_draft_binding_check" CHECK (
        "kind" <> 'attachment' OR "status" <> 'draft'
        OR ("draft_id" IS NOT NULL AND "pending_request_id" IS NULL AND "turn_id" IS NULL)
    ),
    CONSTRAINT "conversation_files_pending_binding_check" CHECK (
        "kind" <> 'attachment' OR "status" <> 'pending'
        OR ("draft_id" IS NULL AND "pending_request_id" IS NOT NULL AND "turn_id" IS NULL)
    ),
    CONSTRAINT "conversation_files_bound_binding_check" CHECK (
        "kind" <> 'attachment' OR "status" <> 'bound'
        OR ("draft_id" IS NULL AND "pending_request_id" IS NULL AND "turn_id" IS NOT NULL)
    ),
    CONSTRAINT "conversation_files_attachment_storage_check" CHECK (
        "kind" <> 'attachment'
        OR ("storage_backend" = 'workspace' AND "downloadable" = FALSE)
    ),
    CONSTRAINT "conversation_files_artifact_binding_check" CHECK (
        "kind" <> 'artifact' OR ("draft_id" IS NULL AND "pending_request_id" IS NULL)
    ),
    CONSTRAINT "conversation_files_downloadable_check" CHECK (
        "downloadable" = FALSE
        OR (
            "kind" = 'artifact'
            AND "storage_backend" = 'minio'
            AND "minio_object_key" IS NOT NULL
            AND "download_card_event_id" IS NOT NULL
        )
    )
);

CREATE TABLE "retained_artifacts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "original_file_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "minio_object_key" TEXT NOT NULL,
    "mime_type" VARCHAR(160),
    "size_bytes" BIGINT NOT NULL,
    "checksum_sha256" VARCHAR(64),
    "artifact_created_at" TIMESTAMPTZ(6) NOT NULL,
    "conversation_deleted_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "retained_artifacts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "retained_artifacts_size_check" CHECK ("size_bytes" >= 0),
    CONSTRAINT "retained_artifacts_checksum_check" CHECK (
        "checksum_sha256" IS NULL OR "checksum_sha256" ~ '^[0-9a-fA-F]{64}$'
    ),
    CONSTRAINT "retained_artifacts_time_check" CHECK (
        "conversation_deleted_at" >= "artifact_created_at"
        AND "created_at" >= "conversation_deleted_at"
    )
);

CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "actor_id" UUID,
    "action" VARCHAR(160) NOT NULL,
    "target_type" VARCHAR(80),
    "target_id" VARCHAR(160),
    "result" VARCHAR(32) NOT NULL,
    "metadata_json" JSONB,
    "ip_address" INET,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "audit_logs_result_check" CHECK ("result" IN ('success', 'failure', 'rejected')),
    CONSTRAINT "audit_logs_metadata_object_check" CHECK (
        "metadata_json" IS NULL OR jsonb_typeof("metadata_json") = 'object'
    )
);

CREATE TABLE "system_settings" (
    "id" UUID NOT NULL DEFAULT '00000000-0000-4000-8000-000000000001'::uuid,
    "settings_json" JSONB NOT NULL,
    "updated_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "system_settings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "system_settings_singleton_id_check" CHECK (
        "id" = '00000000-0000-4000-8000-000000000001'::uuid
    ),
    CONSTRAINT "system_settings_json_object_check" CHECK (
        jsonb_typeof("settings_json") = 'object'
    )
);

-- Ordinary unique indexes.
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
CREATE UNIQUE INDEX "user_groups_name_key" ON "user_groups"("name");
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");
CREATE UNIQUE INDEX "password_reset_tokens_token_hash_key" ON "password_reset_tokens"("token_hash");
CREATE UNIQUE INDEX "capabilities_owner_slug_type_key" ON "capabilities"("owner_id", "slug", "type");
CREATE UNIQUE INDEX "capability_user_preferences_user_capability_key"
    ON "capability_user_preferences"("user_id", "capability_id");
CREATE UNIQUE INDEX "conversations_workspace_rel_path_key" ON "conversations"("workspace_rel_path");
CREATE UNIQUE INDEX "conversations_codex_home_rel_path_key" ON "conversations"("codex_home_rel_path");
CREATE UNIQUE INDEX "conversations_codex_thread_id_key" ON "conversations"("codex_thread_id");
CREATE UNIQUE INDEX "conversation_drafts_conversation_id_key" ON "conversation_drafts"("conversation_id");
CREATE UNIQUE INDEX "pending_requests_conversation_queue_key" ON "pending_requests"("conversation_id", "queue_no");
CREATE UNIQUE INDEX "conversation_turns_conversation_sequence_key"
    ON "conversation_turns"("conversation_id", "sequence_no");
CREATE UNIQUE INDEX "conversation_turns_codex_turn_id_key" ON "conversation_turns"("codex_turn_id");
CREATE UNIQUE INDEX "conversation_messages_conversation_sequence_key"
    ON "conversation_messages"("conversation_id", "sequence_no");
CREATE UNIQUE INDEX "conversation_events_conversation_sequence_key"
    ON "conversation_events"("conversation_id", "sequence_no");
CREATE UNIQUE INDEX "conversation_events_sse_event_id_key" ON "conversation_events"("sse_event_id");
CREATE UNIQUE INDEX "retained_artifacts_original_file_id_key" ON "retained_artifacts"("original_file_id");
CREATE UNIQUE INDEX "retained_artifacts_minio_object_key_key" ON "retained_artifacts"("minio_object_key");

-- Conditional uniqueness required by active/revoked lifecycles and nullable targets.
CREATE UNIQUE INDEX "user_group_members_active_key"
    ON "user_group_members"("user_id", "user_group_id")
    WHERE "status" = 'active';

CREATE UNIQUE INDEX "capabilities_global_slug_type_key"
    ON "capabilities"("slug", "type")
    WHERE "scope" = 'global';

CREATE UNIQUE INDEX "capability_grants_active_user_key"
    ON "capability_grants"("capability_id", "user_id", "grant_kind")
    WHERE "status" = 'active' AND "grantee_type" = 'user';

CREATE UNIQUE INDEX "capability_grants_active_group_key"
    ON "capability_grants"("capability_id", "user_group_id", "grant_kind")
    WHERE "status" = 'active' AND "grantee_type" = 'user_group';

CREATE UNIQUE INDEX "capability_grants_active_all_users_key"
    ON "capability_grants"("capability_id", "grant_kind")
    WHERE "status" = 'active' AND "grantee_type" = 'all_users';

CREATE UNIQUE INDEX "credential_bindings_active_personal_key"
    ON "credential_bindings"("capability_id", "user_id", "env_key")
    WHERE "binding_scope" = 'personal' AND "status" = 'active';

CREATE UNIQUE INDEX "credential_bindings_active_school_key"
    ON "credential_bindings"("capability_id", "env_key")
    WHERE "binding_scope" = 'school' AND "status" = 'active';

CREATE UNIQUE INDEX "pending_requests_idempotency_key"
    ON "pending_requests"("conversation_id", "idempotency_key")
    WHERE "idempotency_key" IS NOT NULL;

CREATE UNIQUE INDEX "conversation_turns_idempotency_key"
    ON "conversation_turns"("conversation_id", "idempotency_key")
    WHERE "idempotency_key" IS NOT NULL;

CREATE UNIQUE INDEX "conversation_turns_one_running_key"
    ON "conversation_turns"("conversation_id")
    WHERE "status" = 'running';

-- Logical-reference and query-path indexes. No index below creates a relation.
CREATE INDEX "users_status_role_idx" ON "users"("status", "role");
CREATE INDEX "users_last_login_at_idx" ON "users"("last_login_at");
CREATE INDEX "user_groups_created_by_idx" ON "user_groups"("created_by");
CREATE INDEX "user_group_members_group_status_idx" ON "user_group_members"("user_group_id", "status");
CREATE INDEX "user_group_members_user_status_idx" ON "user_group_members"("user_id", "status");
CREATE INDEX "user_group_members_created_by_idx" ON "user_group_members"("created_by");
CREATE INDEX "user_group_members_revoked_by_idx" ON "user_group_members"("revoked_by");
CREATE INDEX "refresh_tokens_user_expires_idx" ON "refresh_tokens"("user_id", "expires_at");
CREATE INDEX "refresh_tokens_family_created_idx" ON "refresh_tokens"("family_id", "created_at");
CREATE INDEX "refresh_tokens_parent_idx" ON "refresh_tokens"("parent_token_id");
CREATE INDEX "refresh_tokens_replaced_by_idx" ON "refresh_tokens"("replaced_by_token_id");
CREATE INDEX "refresh_tokens_revoked_at_idx" ON "refresh_tokens"("revoked_at");
CREATE INDEX "password_reset_tokens_user_state_idx"
    ON "password_reset_tokens"("user_id", "consumed_at", "expires_at");
CREATE INDEX "capabilities_type_status_idx" ON "capabilities"("type", "status");
CREATE INDEX "capabilities_scope_status_idx" ON "capabilities"("scope", "status");
CREATE INDEX "capabilities_owner_id_idx" ON "capabilities"("owner_id");
CREATE INDEX "capabilities_installed_by_idx" ON "capabilities"("installed_by");
CREATE INDEX "capabilities_approved_by_idx" ON "capabilities"("approved_by");
CREATE INDEX "capabilities_name_idx" ON "capabilities"("name");
CREATE INDEX "capability_grants_capability_id_idx" ON "capability_grants"("capability_id");
CREATE INDEX "capability_grants_user_status_idx"
    ON "capability_grants"("grantee_type", "user_id", "status");
CREATE INDEX "capability_grants_group_status_idx"
    ON "capability_grants"("grantee_type", "user_group_id", "status");
CREATE INDEX "capability_grants_granted_by_idx" ON "capability_grants"("granted_by");
CREATE INDEX "capability_grants_approval_request_idx" ON "capability_grants"("approval_request_id");
CREATE INDEX "capability_grants_revoked_by_idx" ON "capability_grants"("revoked_by");
CREATE INDEX "capability_share_requests_status_created_idx"
    ON "capability_share_requests"("status", "created_at");
CREATE INDEX "capability_share_requests_requester_idx"
    ON "capability_share_requests"("requester_id", "status", "created_at");
CREATE INDEX "capability_share_requests_capability_idx"
    ON "capability_share_requests"("capability_id", "status");
CREATE INDEX "capability_share_requests_group_idx" ON "capability_share_requests"("user_group_id");
CREATE INDEX "capability_share_requests_reviewer_idx" ON "capability_share_requests"("reviewer_id");
CREATE INDEX "capability_user_preferences_user_status_idx"
    ON "capability_user_preferences"("user_id", "status");
CREATE INDEX "capability_user_preferences_capability_idx"
    ON "capability_user_preferences"("capability_id");
CREATE INDEX "credentials_scope_owner_status_idx" ON "credentials"("scope", "owner_id", "status");
CREATE INDEX "credentials_provider_type_idx" ON "credentials"("provider_type");
CREATE INDEX "credentials_created_by_idx" ON "credentials"("created_by");
CREATE INDEX "credentials_updated_by_idx" ON "credentials"("updated_by");
CREATE INDEX "credential_bindings_credential_status_idx"
    ON "credential_bindings"("credential_id", "status");
CREATE INDEX "credential_bindings_capability_status_idx"
    ON "credential_bindings"("capability_id", "status");
CREATE INDEX "credential_bindings_user_status_idx" ON "credential_bindings"("user_id", "status");
CREATE INDEX "credential_bindings_created_by_idx" ON "credential_bindings"("created_by");
CREATE INDEX "credential_bindings_revoked_by_idx" ON "credential_bindings"("revoked_by");
CREATE INDEX "conversations_owner_archive_updated_idx"
    ON "conversations"("owner_id", "archive_status", "updated_at" DESC);
CREATE INDEX "conversations_last_run_at_idx" ON "conversations"("last_run_at");
CREATE INDEX "conversation_drafts_owner_id_idx" ON "conversation_drafts"("owner_id");
CREATE INDEX "conversation_drafts_updated_at_idx" ON "conversation_drafts"("updated_at");
CREATE INDEX "pending_requests_conversation_status_queue_idx"
    ON "pending_requests"("conversation_id", "status", "queue_no");
CREATE INDEX "pending_requests_submitted_by_idx" ON "pending_requests"("submitted_by");
CREATE INDEX "conversation_turns_conversation_created_idx"
    ON "conversation_turns"("conversation_id", "created_at");
CREATE INDEX "conversation_turns_conversation_status_sequence_idx"
    ON "conversation_turns"("conversation_id", "status", "sequence_no");
CREATE INDEX "conversation_turns_submitted_by_idx" ON "conversation_turns"("submitted_by");
CREATE INDEX "conversation_messages_conversation_created_idx"
    ON "conversation_messages"("conversation_id", "created_at");
CREATE INDEX "conversation_messages_turn_id_idx" ON "conversation_messages"("turn_id");
CREATE INDEX "conversation_events_conversation_created_idx"
    ON "conversation_events"("conversation_id", "created_at");
CREATE INDEX "conversation_events_turn_created_idx" ON "conversation_events"("turn_id", "created_at");
CREATE INDEX "conversation_events_event_type_idx" ON "conversation_events"("event_type");
CREATE INDEX "conversation_files_conversation_kind_created_idx"
    ON "conversation_files"("conversation_id", "kind", "created_at");
CREATE INDEX "conversation_files_draft_id_idx" ON "conversation_files"("draft_id");
CREATE INDEX "conversation_files_pending_request_id_idx" ON "conversation_files"("pending_request_id");
CREATE INDEX "conversation_files_turn_id_idx" ON "conversation_files"("turn_id");
CREATE INDEX "conversation_files_minio_object_key_idx" ON "conversation_files"("minio_object_key");
CREATE INDEX "conversation_files_download_card_event_idx" ON "conversation_files"("download_card_event_id");
CREATE INDEX "conversation_files_created_by_idx" ON "conversation_files"("created_by");
CREATE INDEX "retained_artifacts_conversation_id_idx" ON "retained_artifacts"("conversation_id");
CREATE INDEX "retained_artifacts_owner_id_idx" ON "retained_artifacts"("owner_id");
CREATE INDEX "retained_artifacts_deleted_at_idx" ON "retained_artifacts"("conversation_deleted_at");
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");
CREATE INDEX "audit_logs_actor_id_idx" ON "audit_logs"("actor_id");
CREATE INDEX "audit_logs_action_idx" ON "audit_logs"("action");
CREATE INDEX "audit_logs_target_idx" ON "audit_logs"("target_type", "target_id");
CREATE INDEX "system_settings_updated_by_idx" ON "system_settings"("updated_by");

-- JSONB GIN indexes for structured operational and audit metadata.
CREATE INDEX "capabilities_manifest_json_gin_idx"
    ON "capabilities" USING GIN ("manifest_json" jsonb_path_ops);
CREATE INDEX "capabilities_risk_summary_json_gin_idx"
    ON "capabilities" USING GIN ("risk_summary_json" jsonb_path_ops);
CREATE INDEX "conversation_events_payload_json_gin_idx"
    ON "conversation_events" USING GIN ("payload_json" jsonb_path_ops);
CREATE INDEX "audit_logs_metadata_json_gin_idx"
    ON "audit_logs" USING GIN ("metadata_json" jsonb_path_ops);

-- Trigram indexes support mixed Chinese/English substring search without
-- choosing a language-specific PostgreSQL full-text dictionary.
CREATE INDEX "users_name_trgm_idx" ON "users" USING GIN ("name" gin_trgm_ops);
CREATE INDEX "users_email_trgm_idx" ON "users" USING GIN (("email"::text) gin_trgm_ops);
CREATE INDEX "capabilities_name_trgm_idx" ON "capabilities" USING GIN ("name" gin_trgm_ops);
CREATE INDEX "conversations_title_trgm_idx" ON "conversations" USING GIN ("title" gin_trgm_ops);
CREATE INDEX "conversation_messages_content_trgm_idx"
    ON "conversation_messages" USING GIN ("content_text" gin_trgm_ops);
CREATE INDEX "conversation_files_filename_trgm_idx"
    ON "conversation_files" USING GIN ("filename" gin_trgm_ops);
CREATE INDEX "conversation_turns_error_message_trgm_idx"
    ON "conversation_turns" USING GIN ("error_message" gin_trgm_ops);
