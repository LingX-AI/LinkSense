import type { TFunction } from "i18next"

import { ApiError } from "@/api/client"
import {
  containsInternalPlatformName,
  getPublicRuntimeMessage,
} from "@/lib/public-copy"

const errorCodeToKey: Record<string, string> = {
  NETWORK_UNAVAILABLE: "errors.networkUnavailable",
  API_RESPONSE_INVALID: "errors.invalidResponse",
  AUTH_INVALID_CREDENTIALS: "errors.authInvalidCredentials",
  OIDC_ACCOUNT_PENDING_APPROVAL: "auth.oidcAccountPendingApproval",
  EXTERNAL_ACCOUNT_PENDING_APPROVAL: "auth.externalAccountPendingApproval",
  AUTH_LOGIN_RATE_LIMITED: "errors.authRateLimited",
  AUTH_LOGIN_PROTECTION_UNAVAILABLE: "errors.authProtectionUnavailable",
  AUTH_SESSION_EXPIRED: "errors.sessionExpired",
  PASSWORD_POLICY_VIOLATION: "errors.passwordPolicy",
  PASSWORD_EMAIL_UNAVAILABLE: "errors.passwordEmailUnavailable",
  PASSWORD_RESET_EMAIL_DELIVERY_FAILED: "errors.passwordResetDeliveryFailed",
  PASSWORD_RESET_PROTECTION_UNAVAILABLE:
    "errors.passwordResetProtectionUnavailable",
  PASSWORD_RESET_TOKEN_INVALID_OR_EXPIRED: "errors.passwordResetInvalid",
  SYSTEM_CONCURRENCY_LIMIT_REACHED: "errors.concurrencyLimit",
  CONVERSATION_OVERLOADED: "errors.concurrencyLimit",
  PENDING_REQUEST_LIMIT_REACHED: "errors.pendingLimit",
  PENDING_REQUEST_NOT_QUEUE_HEAD: "errors.pendingNotHead",
  TURN_INTERRUPT_REQUEST_FAILED: "errors.interruptFailed",
  TURN_STEER_REQUEST_FAILED: "errors.conversation.steerRequestFailed",
  TURN_STEER_REQUEST_UNCERTAIN: "errors.conversation.steerRequestUncertain",
  CONVERSATION_COMPACTION_UNAVAILABLE:
    "errors.conversation.compactionUnavailable",
  PLAN_REVIEW_PENDING: "errors.conversation.planReviewPending",
  PLAN_REVIEW_UNAVAILABLE: "errors.conversation.planReviewUnavailable",
  CREDENTIAL_BINDING_CONFLICT: "errors.credentialConflict",
  CREDENTIAL_BINDING_REQUIRED: "errors.credentialRequired",
  MCP_SERVER_NOT_FOUND: "errors.notFound",
  MCP_INSECURE_HTTP_ACKNOWLEDGEMENT_REQUIRED:
    "errors.mcp.insecureHttpAcknowledgementRequired",
  MCP_CREDENTIAL_REQUIRED: "errors.mcp.credentialRequired",
  MCP_DESTINATION_FORBIDDEN: "errors.mcp.destinationForbidden",
  MCP_CONNECTION_FAILED: "errors.mcp.connectionFailed",
  AVATAR_UPLOAD_INVALID: "errors.avatarInvalid",
  FEEDBACK_SUBMISSION_INVALID: "errors.feedback.submissionInvalid",
  FEEDBACK_SUBMISSION_FAILED: "errors.feedback.submissionFailed",
  APPLICATION_ICON_UPLOAD_INVALID: "errors.applicationIconInvalid",
  CAPABILITY_LOGO_UPLOAD_INVALID: "errors.capabilityLogoInvalid",
  PRODUCT_LOGO_UPLOAD_INVALID: "errors.productLogoInvalid",
  KNOWLEDGE_BASE_NOT_FOUND: "errors.notFound",
  KNOWLEDGE_BASE_ACCESS_DENIED: "errors.forbidden",
  KNOWLEDGE_DOCUMENT_NOT_FOUND: "errors.notFound",
  KNOWLEDGE_BASE_FORBIDDEN: "errors.forbidden",
  KNOWLEDGE_BASE_ARCHIVE_REQUIRED: "errors.knowledge.archiveRequired",
  KNOWLEDGE_BASE_IN_USE: "errors.knowledge.inUse",
  KNOWLEDGE_BASE_NOT_ARCHIVED: "errors.knowledge.archiveRequired",
  KNOWLEDGE_BASE_ARCHIVED: "errors.knowledge.archived",
  KNOWLEDGE_BASE_DISABLED: "errors.knowledge.disabled",
  KNOWLEDGE_BASE_QUOTA_EXCEEDED: "errors.knowledge.quotaExceeded",
  KNOWLEDGE_DOCUMENT_DUPLICATE: "errors.knowledge.duplicate",
  KNOWLEDGE_DOCUMENT_NAME_CONFLICT: "errors.knowledge.nameConflict",
  KNOWLEDGE_DOCUMENT_ACTION_CONFLICT: "errors.knowledge.actionConflict",
  KNOWLEDGE_DOCUMENT_ACTIVATING: "errors.knowledge.activating",
  KNOWLEDGE_DOCUMENT_FORMAT_UNSUPPORTED: "errors.knowledge.unsupportedFormat",
  KNOWLEDGE_DOCUMENT_TOO_LARGE: "errors.knowledge.fileTooLarge",
  KNOWLEDGE_DOCUMENT_PROCESSING_FAILED: "errors.knowledge.processingFailed",
  KNOWLEDGE_PREVIEW_UNAVAILABLE: "errors.knowledge.previewUnavailable",
  KNOWLEDGE_EMBEDDING_CONFIGURATION_INVALID:
    "errors.knowledge.embeddingConfiguration",
  KNOWLEDGE_MODEL_VALIDATION_FAILED: "errors.knowledgeModel.validationFailed",
  KNOWLEDGE_MODEL_AUTHENTICATION_FAILED:
    "errors.knowledgeModel.authenticationFailed",
  KNOWLEDGE_MODEL_SERVICE_UNAVAILABLE:
    "errors.knowledgeModel.serviceUnavailable",
  KNOWLEDGE_MODEL_RESPONSE_INVALID: "errors.knowledgeModel.responseInvalid",
  KNOWLEDGE_MODEL_NOT_CONFIGURED: "errors.knowledgeModel.notConfigured",
  KNOWLEDGE_SOURCE_NOT_CONFIGURED: "errors.knowledgeSource.notConfigured",
  KNOWLEDGE_SOURCE_CREDENTIAL_VALIDATION_FAILED:
    "errors.knowledgeSource.credentialValidationFailed",
  KNOWLEDGE_SOURCE_URL_INVALID: "errors.knowledgeSource.urlInvalid",
  KNOWLEDGE_SOURCE_FOLDER_NOT_FOUND: "errors.knowledgeSource.folderNotFound",
  KNOWLEDGE_SOURCE_ALREADY_CONNECTED: "errors.knowledgeSource.alreadyConnected",
  KNOWLEDGE_SOURCE_NOT_FOUND: "errors.knowledgeSource.notFound",
  KNOWLEDGE_SOURCE_SYNC_UNAVAILABLE: "errors.knowledgeSource.syncUnavailable",
  KNOWLEDGE_SOURCE_ITEM_SYNC_FAILED: "errors.knowledgeSource.itemSyncFailed",
  INVALID_PACKAGE: "errors.invalidPackage",
  IMPORT_FAILED: "errors.importFailed",
  CAPABILITY_HOME_SYNC_FAILED: "errors.capabilityHomeSyncFailed",
  CLAWHUB_SKILL_NOT_FOUND: "errors.clawhub.skillNotFound",
  CLAWHUB_SKILL_NOT_INSTALLABLE: "errors.clawhub.skillNotInstallable",
  CLAWHUB_SKILL_ALREADY_INSTALLED: "errors.clawhub.skillAlreadyInstalled",
  CLAWHUB_SERVICE_UNAVAILABLE: "errors.clawhub.serviceUnavailable",
  CLAWHUB_INSTALL_PREVIEW_BUSY: "errors.clawhub.installPreviewBusy",
  CLAWHUB_INSTALL_PREVIEW_RATE_LIMITED:
    "errors.clawhub.installPreviewRateLimited",
  CLAWHUB_INSTALL_PREVIEW_QUOTA_EXCEEDED:
    "errors.clawhub.installPreviewQuotaExceeded",
  CLAWHUB_PACKAGE_INTEGRITY_FAILED: "errors.clawhub.packageIntegrityFailed",
  ATTACHMENT_UPLOAD_INVALID: "errors.attachmentInvalid",
  ATTACHMENT_TEMPORARY_FILE_SKIPPED: "errors.attachmentTemporaryFileSkipped",
  FILE_LIMIT_EXCEEDED: "errors.fileLimitExceeded",
  ARTIFACT_NOT_FOUND: "errors.artifactNotFound",
  DOWNLOAD_FORBIDDEN: "errors.downloadForbidden",
  RUNNER_UNAVAILABLE: "errors.runnerUnavailable",
  TOKEN_LIMIT_EXCEEDED: "errors.tokenLimitExceeded",
  LAST_ENABLED_ADMIN_REQUIRED: "errors.lastAdminRequired",
  MODEL_IN_USE_BY_SYSTEM_SETTING: "errors.modelProvider.inUseBySystemSetting",
  MODEL_MANAGEMENT_DISABLED: "errors.modelProvider.managementDisabled",
  LAST_ENABLED_MODEL_REQUIRED: "errors.lastModelRequired",
  ADMIN_SELF_PRIVILEGE_CHANGE_FORBIDDEN: "errors.adminSelfChangeForbidden",
  ADMIN_SELF_ROLE_OR_STATUS_CHANGE_FORBIDDEN: "errors.adminSelfChangeForbidden",
  USER_EMAIL_ALREADY_EXISTS: "errors.emailExists",
  SYSTEM_SETTINGS_INVALID: "errors.settingsInvalid",
  DEPLOYMENT_SETTING_READ_ONLY: "errors.deploymentReadOnly",
  PRODUCT_SETTING_UNKNOWN: "errors.settingsInvalid",
  SYSTEM_ALREADY_INITIALIZED: "errors.systemAlreadyInitialized",
  SYSTEM_INITIALIZATION_CREDENTIAL_INVALID:
    "errors.systemInitializationCredentialInvalid",
  CODEX_TURN_FAILED: "errors.codexTurnFailed",
  USER_DISABLED: "errors.userDisabled",
  CONFLICT: "errors.conflict",
  INTERNAL_ERROR: "errors.unknown",
  TEAMS_SSO_NOT_CONFIGURED: "auth.teamsNotConfigured",
  TEAMS_SSO_FAILED: "errors.teamsFailed",
  VOICE_TRANSCRIPTION_FAILED: "errors.composer.voiceTranscriptionFailed",
  VOICE_TRANSCRIPTION_RATE_LIMITED:
    "errors.composer.voiceTranscriptionRateLimited",
  VOICE_TRANSCRIPTION_TIMEOUT: "conversation.voiceTimeout",
  VOICE_TRANSCRIPTION_NO_CONTENT: "conversation.voiceNoContent",
  VOICE_AUDIO_TOO_LARGE: "conversation.voiceTooLarge",
  VOICE_AUDIO_INVALID: "conversation.voiceRecordingFailed",
  AUTH_REQUIRED: "errors.sessionExpired",
  FORBIDDEN: "errors.forbidden",
  ACCESS_DENIED: "errors.forbidden",
  NOT_FOUND: "errors.notFound",
  CONVERSATION_NOT_FOUND: "errors.notFound",
  CONVERSATION_ORDER_CONFLICT: "errors.conversationOrderConflict",
  AUTOMATION_NOT_FOUND: "errors.automationNotFound",
  AUTOMATION_LIMIT_REACHED: "errors.automationLimitReached",
  AUTOMATION_TASK_NOT_PINNED: "errors.automationTaskNotPinned",
  AUTOMATION_TASK_IN_USE: "errors.automationTaskInUse",
  AUTOMATION_EMPTY_RESULT: "errors.automation.emptyResult",
  AUTOMATION_EXPIRED: "errors.automation.expired",
  CAPABILITY_NOT_FOUND: "errors.notFound",
  CREDENTIAL_NOT_FOUND: "errors.notFound",
  VALIDATION_ERROR: "errors.validation",
}

export function getErrorMessage(
  error: unknown,
  t: TFunction,
  translationParams: Record<string, string | number> = {}
) {
  if (error instanceof ApiError) {
    const reason = getErrorReason(error, t)
    const messageKeys = [
      error.messageKey,
      errorCodeToKey[error.errorCode],
    ].filter((key): key is string => Boolean(key))
    for (const key of messageKeys) {
      const translated = t(key, translationParams)
      if (translated !== key) {
        return withReason(translated, reason, t)
      }
    }
    if (error.message && error.message !== error.errorCode) {
      return withReason(
        getPublicRuntimeMessage(
          error.message,
          t("errors.unknown", translationParams)
        ),
        reason,
        t
      )
    }
  }
  return t("errors.unknown", translationParams)
}

function getErrorReason(error: ApiError, t: TFunction): string | null {
  const reasonCode = error.params?.reason_code
  if (typeof reasonCode === "string" && reasonCode.length > 0) {
    const key = `errors.importReasons.${reasonCode}`
    const translated = t(key, error.params)
    if (translated !== key) return translated
  }
  const reason = error.params?.reason
  if (typeof reason !== "string" || !reason.trim()) return null
  const trimmedReason = reason.trim().slice(0, 500)
  return containsInternalPlatformName(trimmedReason) ? null : trimmedReason
}

function withReason(message: string, reason: string | null, t: TFunction) {
  return reason ? t("errors.withReason", { message, reason }) : message
}
