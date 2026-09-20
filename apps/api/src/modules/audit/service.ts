import type { PrismaClient } from "../../generated/prisma/client.js";

export type AuditContext = {
  actorId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
};

export type AuditEntry = AuditContext & {
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  result: "success" | "rejected" | "failed";
  metadata?: Record<string, string | number | boolean | null>;
};

const AUDIT_METADATA_KEYS: Readonly<Record<string, readonly string[]>> = {
  application_embed_ticket_issued: [
    "application_id",
    "auth_mode",
    "authenticated_subject",
  ],
  application_installed: ["source_application_id", "channel", "version_id"],
  application_installation_updated: ["version_id"],
  application_share_modes_updated: ["can_install", "can_use_service"],
  application_published: ["version_number"],
  application_external_access_created: [
    "application_id",
    "enabled",
    "auth_mode",
    "allowed_origin_count",
    "credentials_generated",
  ],
  application_external_access_updated: [
    "application_id",
    "enabled",
    "auth_mode",
    "allowed_origin_count",
    "credentials_generated",
  ],
  application_external_secret_rotated: ["application_id"],
  application_external_session_renewed: ["application_id"],
  application_external_session_revoked: ["application_id"],
  external_application_session_id_updated: [
    "application_id",
    "session_id_configured",
  ],
  application_external_session_started: [
    "application_id",
    "resumed",
    "authenticated_subject",
  ],
  automation_created: ["conversation_id", "frequency", "status"],
  automation_deleted: ["conversation_id", "frequency", "status"],
  automation_dispatch_failed: [
    "conversation_id",
    "frequency",
    "status",
    "error_code",
  ],
  automation_dispatched: ["conversation_id", "frequency", "status"],
  automation_updated: ["conversation_id", "frequency", "status"],
  artifact_download_link_issued: [
    "conversation_id",
    "link_expires_at",
    "link_ttl_seconds",
  ],
  artifact_download_link_rejected: [
    "conversation_id",
    "reason_code",
    "error_code",
  ],
  audit_exported: ["row_count", "format", "view"],
  usage_exported: ["row_count", "format", "range"],
  capability_configuration_updated: ["capability_id", "changed_keys"],
  capability_deleted: ["capability_id", "capability_type"],
  capability_home_sync_failed: [
    "operation",
    "source_type",
    "error_code",
    "recovery",
  ],
  capability_home_publication_deferred: ["reason_code"],
  capability_install_failed: ["source_type", "error_code"],
  capability_installed: ["capability_id", "capability_type", "source_type"],
  capability_logo_updated: ["capability_id", "logo_present"],
  capability_preference_updated: ["capability_id", "status"],
  capability_update_failed: ["source_type", "error_code"],
  capability_updated: ["capability_id", "capability_type", "source_type"],
  cleanup_retry_requested: ["resource_type", "attempts_made", "reason_code"],
  cleanup_bulk_retry_requested: ["requested_count", "rejected_count"],
  codex_thread_recovery_failed: ["reason_code"],
  codex_thread_recovery_request_failed: ["reason_code"],
  codex_turn_projection_recovery_failed: ["reason_code"],
  conversation_artifact_registered: [
    "conversation_id",
    "turn_id",
    "file_id",
    "mime_type",
    "size_bytes",
  ],
  conversation_attachment_uploaded: [
    "conversation_id",
    "file_id",
    "mime_type",
    "size_bytes",
  ],
  conversation_deleted: [
    "file_count",
    "retained_artifact_count",
    "retained_artifact_ids",
    "total_size_bytes",
  ],
  conversation_staged_attachment_removed: ["conversation_id", "file_id"],
  conversation_pending_request_cancelled: ["conversation_id"],
  conversation_pending_request_cancelled_user_disabled: [
    "conversation_id",
    "pending_request_id",
  ],
  conversation_pending_request_created: ["conversation_id", "queue_no"],
  conversation_pending_requests_reordered: [
    "conversation_id",
    "pending_request_ids",
  ],
  conversation_pending_request_steered: ["conversation_id", "turn_id"],
  conversation_turn_completed: ["conversation_id"],
  conversation_turn_failed: ["conversation_id"],
  conversation_turn_interrupted: ["conversation_id"],
  conversation_turn_interrupt_requested: ["conversation_id"],
  conversation_turn_started: ["conversation_id", "submit_mode"],
  conversation_turn_steered: ["conversation_id"],
  credential_binding_ambiguous: ["capability_id", "env_key", "binding_count"],
  credential_bound: ["capability_id", "env_key"],
  credential_created: ["credential_type"],
  credential_deleted: ["revoked_binding_count"],
  credential_unbound: ["capability_id", "env_key"],
  credential_updated: ["credential_type"],
  credential_usage_commit_failed: ["conversation_id", "reason_code"],
  credential_used: ["capability_id", "env_key"],
  file_cleanup_enqueue_failed: [
    "conversation_id",
    "file_id",
    "resource_type",
    "reason_code",
  ],
  feedback_submitted: ["image_count", "content_length"],
  feedback_replied: ["image_count", "content_length"],
  feedback_deleted: ["image_count"],
  invalid_auth_tokens_cleaned: [
    "refresh_token_count",
    "password_reset_token_count",
  ],
  mcp_server_connection_tested: ["result"],
  mcp_server_credential_used: [],
  mcp_server_created: ["auth_type", "transport_security"],
  mcp_server_deleted: [],
  mcp_server_updated: ["credential_rotated", "status"],
  "knowledge_base.admin_archived": ["reason", "lifecycle_status"],
  "knowledge_base.admin_disabled": ["reason", "availability_status"],
  "knowledge_base.admin_enabled": ["reason", "availability_status"],
  "knowledge_base.admin_force_deleted": ["reason", "lifecycle_status"],
  "knowledge_base.admin_grant_revoked": [
    "knowledge_base_id",
    "target_type",
    "target_id",
    "reason",
  ],
  "knowledge_base.archived": ["lifecycle_status"],
  "knowledge_base.cleanup_retried": [
    "reason",
    "retried_count",
    "cleanup_target_type",
    "cleanup_target_id",
  ],
  "knowledge_base.created": ["lifecycle_status"],
  "knowledge_base.deleted": ["reason"],
  "knowledge_base.direct_grant_removed": [
    "knowledge_base_id",
    "target_type",
    "target_id",
    "reason",
  ],
  "knowledge_base.grant_created": [
    "knowledge_base_id",
    "target_type",
    "target_id",
  ],
  "knowledge_base.grant_revoked": [
    "knowledge_base_id",
    "target_type",
    "target_id",
    "reason",
  ],
  "knowledge_base.maintenance_rebuild_requested": [
    "reason",
    "confirmed_at",
    "scope",
  ],
  "knowledge_base.maintenance_rebuild_completed": [
    "scope",
    "total_count",
    "succeeded_count",
    "failed_count",
  ],
  "knowledge_base.maintenance_rebuild_failed": [
    "scope",
    "total_count",
    "succeeded_count",
    "failed_count",
    "stable_error_code",
  ],
  "knowledge_base.owner_transferred": [
    "reason",
    "previous_owner_id",
    "new_owner_id",
  ],
  "knowledge_base.restored": ["lifecycle_status"],
  "knowledge_base.updated": ["changed_fields"],
  "knowledge_document.deleted": ["knowledge_base_id", "reason"],
  "knowledge_document.enqueue_failed": [
    "knowledge_base_id",
    "stable_error_code",
  ],
  "knowledge_document.original_downloaded": [
    "knowledge_base_id",
    "document_version_id",
    "canonical_extension",
  ],
  "knowledge_document.original_previewed": [
    "knowledge_base_id",
    "document_version_id",
    "canonical_extension",
  ],
  "knowledge_document.processing_cancelled": ["knowledge_base_id", "reason"],
  "knowledge_document.rebuild_index": ["knowledge_base_id"],
  "knowledge_document.reprocess": ["knowledge_base_id"],
  "knowledge_document.retry": ["knowledge_base_id"],
  "knowledge_document.upload_registered": [
    "result",
    "size_bytes",
    "canonical_extension",
  ],
  "knowledge_document.upload_rejected": [
    "result",
    "size_bytes",
    "canonical_extension",
  ],
  maintenance_job_payload_discarded: ["reason_code"],
  marketplace_listing_resumed: [],
  marketplace_listing_status_updated: ["status"],
  marketplace_listing_suspended: ["reason"],
  marketplace_release_reviewed: ["listing_id", "release_number", "decision"],
  marketplace_release_submitted: [
    "listing_id",
    "release_number",
    "capability_id",
    "content_sha256",
  ],
  marketplace_release_withdrawn: ["listing_id", "release_number"],
  password_change_rejected: ["error_code"],
  password_setup_or_reset_delivery_failed: [
    "capability",
    "error_code",
    "reason_code",
  ],
  password_setup_or_reset_rejected: ["error_code"],
  password_setup_or_reset_requested: ["accepted_at"],
  password_setup_or_reset_unavailable: [
    "capability",
    "capability_status",
    "observed_at",
  ],
  password_token_rejected: ["error_code"],
  product_settings_updated: ["changed_keys"],
  system_initialization_rejected: [
    "error_code",
    "requested_at",
    "request_source",
  ],
  system_initialized: ["role", "initialized_at"],
  user_admin_self_change_rejected: [
    "operation",
    "error_code",
    "requested_at",
    "active_administrator_count",
  ],
  user_avatar_replaced: ["replaced_existing_avatar"],
  user_created: ["role", "status", "user_group_count"],
  user_disabled: [
    "role",
    "status",
    "authentication_invalidated",
    "cancelled_pending_request_count",
    "weekly_credit_limit_changed",
  ],
  user_email_change_rejected: ["error_code"],
  user_email_changed: [
    "role",
    "status",
    "authentication_invalidated",
    "previous_address_sha256",
    "new_address_sha256",
    "session_revoked_count",
    "reset_link_invalidated_count",
    "cancelled_pending_request_count",
    "weekly_credit_limit_changed",
  ],
  user_enabled: [
    "role",
    "status",
    "authentication_invalidated",
    "cancelled_pending_request_count",
    "weekly_credit_limit_changed",
  ],
  user_group_created: ["member_count"],
  user_group_deleted: [
    "member_record_count",
    "knowledge_base_grant_record_count",
  ],
  user_group_updated: [],
  user_last_enabled_admin_change_rejected: [
    "operation",
    "requested_change",
    "error_code",
    "requested_at",
    "active_administrator_count",
    "active_admin_count",
    "affected_admin_count",
    "is_batch",
  ],
  user_password_changed: ["method"],
  user_profile_updated: ["name_changed", "locale_changed"],
  user_signed_in: ["login_method"],
  user_updated: [
    "role",
    "status",
    "authentication_invalidated",
    "cancelled_pending_request_count",
    "weekly_credit_limit_changed",
  ],
  quota_settings_updated: [],
  member_credit_quotas_reset: ["updated_user_count"],
  member_credit_limits_applied: ["updated_user_count"],
  users_credit_limits_updated: [
    "user_count",
    "weekly_credit_limit_changed",
  ],
  users_imported: ["row_count"],
  bot_channel_connected: ["provider"],
  bot_channel_disconnected: ["provider"],
  feishu_connection_created: ["domain", "status"],
  feishu_connection_deleted: ["domain", "status"],
  weixin_connection_created: ["application_id", "status"],
  weixin_connection_deleted: ["application_id", "status"],
  weixin_connection_reconnected: ["application_id", "status"],
  weixin_connection_updated: ["application_id", "status"],
};

export class AuditService {
  constructor(private readonly prisma: PrismaClient) {}

  async write(entry: AuditEntry): Promise<void> {
    const metadata = sanitizeAuditMetadata(entry.action, entry.metadata ?? {});

    await this.prisma.auditLog.create({
      data: {
        actorId: entry.actorId ?? null,
        action: entry.action,
        targetType: entry.targetType ?? null,
        targetId: entry.targetId ?? null,
        result: entry.result === "failed" ? "failure" : entry.result,
        metadataJson: metadata,
        ipAddress: entry.ipAddress ?? null,
        userAgent: entry.userAgent ?? null,
      },
    });
  }
}

export function sanitizeAuditMetadata(
  action: string,
  metadata: Record<string, unknown>,
): Record<string, string | number | boolean | null> {
  const allowedKeys = new Set(AUDIT_METADATA_KEYS[action] ?? []);
  return Object.fromEntries(
    Object.entries(metadata).flatMap(([key, value]) => {
      if (!allowedKeys.has(key)) return [];
      if (
        value === null ||
        ["string", "number", "boolean"].includes(typeof value)
      ) {
        return [[key, value as string | number | boolean | null]];
      }
      return [];
    }),
  );
}
