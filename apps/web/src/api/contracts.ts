import {
  INTERACTIVE_APPLICATION_FILE_SOURCE,
  conversationStartingTurnSchema,
  skillDisplayNameSchema,
  currentUserCreditQuotaTotalSchema,
  creditLimitValueSchema,
  applicationUnavailableReasonSchema,
  applicationUsageReportSchema as sharedApplicationUsageReportSchema,
  authSessionSchema as sharedAuthSessionSchema,
  authUserSchema as sharedAuthUserSchema,
  applicationConversationSchema as sharedApplicationConversationSchema,
  applicationGrantSchema as sharedApplicationGrantSchema,
  applicationIconSchema as sharedApplicationIconSchema,
  applicationSchema as sharedApplicationSchema,
  applicationShareTargetSchema as sharedApplicationShareTargetSchema,
  automationCompletionNotificationSchema as sharedAutomationCompletionNotificationSchema,
  automationCreateInputSchema as sharedAutomationCreateInputSchema,
  automationListSchema as sharedAutomationListSchema,
  automationPinnedConversationListSchema as sharedAutomationPinnedConversationListSchema,
  automationRunNowInputSchema as sharedAutomationRunNowInputSchema,
  automationRunNowResultSchema as sharedAutomationRunNowResultSchema,
  automationSchema as sharedAutomationSchema,
  automationUpdateInputSchema as sharedAutomationUpdateInputSchema,
  archivedConversationClearResultSchema as sharedArchivedConversationClearResultSchema,
  authenticationSettingsSchema as sharedAuthenticationSettingsSchema,
  authenticationSettingsUpdateResultSchema as sharedAuthenticationSettingsUpdateResultSchema,
  registrationAvailabilitySchema as sharedRegistrationAvailabilitySchema,
  registrationSettingsSchema as sharedRegistrationSettingsSchema,
  capabilityRiskSummarySchema as sharedCapabilityRiskSummarySchema,
  conversationEventSchema,
  conversationCollaborationModeSchema,
  conversationApplicationDevelopmentRoleSchema,
  conversationHistoryPageSchema,
  conversationOrderResultSchema as sharedConversationOrderResultSchema,
  conversationPlanReviewSchema as sharedConversationPlanReviewSchema,
  conversationUserInputRequestSchema,
  executionConcurrencySettingsSchema as sharedExecutionConcurrencySettingsSchema,
  imageGenerationSettingsSchema as sharedImageGenerationSettingsSchema,
  imageUnderstandingSettingsSchema as sharedImageUnderstandingSettingsSchema,
  voiceTranscriptionSettingsSchema as sharedVoiceTranscriptionSettingsSchema,
  initializeSystemResultSchema as sharedInitializeSystemResultSchema,
  knowledgeModelSettingsSchema as sharedKnowledgeModelSettingsSchema,
  maintenanceStatusSchema as sharedMaintenanceStatusSchema,
  marketplaceCatalogItemSchema as sharedMarketplaceCatalogItemSchema,
  marketplaceListingSchema as sharedMarketplaceListingSchema,
  marketplaceReleaseSchema as sharedMarketplaceReleaseSchema,
  mcpServerSchema as sharedMcpServerSchema,
  mcpServerTestResultSchema as sharedMcpServerTestResultSchema,
  modelPreferenceSchema as sharedModelPreferenceSchema,
  modelProviderSettingsSchema as sharedModelProviderSettingsSchema,
  personalizationSettingsSchema as sharedPersonalizationSettingsSchema,
  personalUsageProfileSchema as sharedPersonalUsageProfileSchema,
  resetMemoriesResultSchema as sharedResetMemoriesResultSchema,
  publicKnowledgeCitationSchema,
  resolveOrganizationDisplayName,
  runnerCodexEventSchema,
  runnerCodexItemSchema,
  runnerNativeIdSchema,
  runnerCodexSubAgentDetailSchema,
  runnerCodexSubAgentSummariesSchema,
  threadGoalSchema as sharedThreadGoalSchema,
  usageAnalyticsReportSchema as sharedUsageAnalyticsReportSchema,
  billingStatementDetailSchema as sharedBillingStatementDetailSchema,
  billingStatementListSchema as sharedBillingStatementListSchema,
  clawHubSecurityStatusSchema as sharedClawHubSecurityStatusSchema,
  clawHubSkillCatalogItemSchema as sharedClawHubSkillCatalogItemSchema,
  clawHubSkillCatalogSortSchema as sharedClawHubSkillCatalogSortSchema,
  completionNotificationFeedSchema as sharedCompletionNotificationFeedSchema,
  feishuConnectionListSchema as sharedFeishuConnectionListSchema,
  feishuConnectionSchema as sharedFeishuConnectionSchema,
  feishuRegistrationSessionSchema as sharedFeishuRegistrationSessionSchema,
  weixinConnectionListSchema as sharedWeixinConnectionListSchema,
  weixinConnectionSchema as sharedWeixinConnectionSchema,
  weixinLoginSessionSchema as sharedWeixinLoginSessionSchema,
  userMessageCapabilitySchema,
  userMessageDisplaySchema,
  officeAnnotationDisplaySchema,
  uuidSchema,
  type AuthenticationSettings as SharedAuthenticationSettings,
  type AuthSession as SharedAuthSession,
  type AuthUser as SharedAuthUser,
  type RegistrationSettings as SharedRegistrationSettings,
  type ExecutionConcurrencySettings as SharedExecutionConcurrencySettings,
  type Application as SharedApplication,
  type ApplicationUsageReport as SharedApplicationUsageReport,
  type ApplicationGrant as SharedApplicationGrant,
  type ApplicationShareTarget as SharedApplicationShareTarget,
  type Automation as SharedAutomation,
  type AutomationCompletionNotification as SharedAutomationCompletionNotification,
  type AutomationCreateInput as SharedAutomationCreateInput,
  type AutomationRunNowInput as SharedAutomationRunNowInput,
  type AutomationRunNowResult as SharedAutomationRunNowResult,
  type AutomationSchedule as SharedAutomationSchedule,
  type AutomationUpdateInput as SharedAutomationUpdateInput,
  type ImageGenerationSettings as SharedImageGenerationSettings,
  type ImageUnderstandingSettings as SharedImageUnderstandingSettings,
  type VoiceTranscriptionSettings as SharedVoiceTranscriptionSettings,
  type KnowledgeModelSettings as SharedKnowledgeModelSettings,
  type MaintenanceStatus as SharedMaintenanceStatus,
  type ModelPreference as SharedModelPreference,
  type ModelProviderSettings as SharedModelProviderSettings,
  type ReasoningEffort as SharedReasoningEffort,
  type PersonalizationSettings as SharedPersonalizationSettings,
  type PersonalUsageProfile as SharedPersonalUsageProfile,
  type McpServer as SharedMcpServer,
  type McpServerTestResult as SharedMcpServerTestResult,
  type RunnerCodexEvent,
  type RunnerCodexItem,
  type RunnerCodexSubAgentDetail,
  type RunnerCodexSubAgentSummaries,
  type RunnerCodexSubAgentSummary,
  type ThreadGoal as SharedThreadGoal,
  type UsageAnalyticsReport as SharedUsageAnalyticsReport,
  type BillingStatementDetail as SharedBillingStatementDetail,
  type BillingStatementList as SharedBillingStatementList,
  type ClawHubSkillCatalogItem as SharedClawHubSkillCatalogItem,
  type ClawHubSkillCatalogSort as SharedClawHubSkillCatalogSort,
  type CompletionNotification as SharedCompletionNotification,
  type CompletionNotificationFeed as SharedCompletionNotificationFeed,
  type FeishuConnection as SharedFeishuConnection,
  type FeishuRegistrationSession as SharedFeishuRegistrationSession,
  type WeixinConnection as SharedWeixinConnection,
  type WeixinLoginSession as SharedWeixinLoginSession,
} from "@linksense/shared"
import { z } from "zod"

export const supportedLanguageSchema = z.enum(["zh-CN", "en-US"])
export type SupportedLanguage = z.infer<typeof supportedLanguageSchema>

export const maintenanceStatusSchema = sharedMaintenanceStatusSchema
export type MaintenanceStatus = SharedMaintenanceStatus

export const archivedConversationClearResultSchema =
  sharedArchivedConversationClearResultSchema
export const completionNotificationFeedSchema =
  sharedCompletionNotificationFeedSchema
export type CompletionNotification = SharedCompletionNotification
export type CompletionNotificationFeed = SharedCompletionNotificationFeed
export const weixinConnectionSchema = sharedWeixinConnectionSchema
export const weixinConnectionListSchema = sharedWeixinConnectionListSchema
export const weixinLoginSessionSchema = sharedWeixinLoginSessionSchema
export type WeixinConnection = SharedWeixinConnection
export type WeixinLoginSession = SharedWeixinLoginSession
export const feishuConnectionSchema = sharedFeishuConnectionSchema
export const feishuConnectionListSchema = sharedFeishuConnectionListSchema
export const feishuRegistrationSessionSchema =
  sharedFeishuRegistrationSessionSchema
export type FeishuConnection = SharedFeishuConnection
export type FeishuRegistrationSession = SharedFeishuRegistrationSession

export const applicationSchema = sharedApplicationSchema
export const applicationGrantSchema = sharedApplicationGrantSchema
export const applicationShareTargetSchema = sharedApplicationShareTargetSchema
export const applicationConversationSchema = sharedApplicationConversationSchema
export const applicationUsageReportSchema = sharedApplicationUsageReportSchema
export type Application = SharedApplication
export type ApplicationUsageReport = SharedApplicationUsageReport
export type ApplicationGrant = SharedApplicationGrant
export type ApplicationShareTarget = SharedApplicationShareTarget

export const automationSchema = sharedAutomationSchema
export const automationListSchema = sharedAutomationListSchema
export const automationPinnedConversationListSchema =
  sharedAutomationPinnedConversationListSchema
export const automationCompletionNotificationSchema =
  sharedAutomationCompletionNotificationSchema
export const automationCreateInputSchema = sharedAutomationCreateInputSchema
export const automationRunNowInputSchema = sharedAutomationRunNowInputSchema
export const automationRunNowResultSchema = sharedAutomationRunNowResultSchema
export const automationUpdateInputSchema = sharedAutomationUpdateInputSchema
export type Automation = SharedAutomation
export type AutomationCompletionNotification =
  SharedAutomationCompletionNotification
export type AutomationCreateInput = SharedAutomationCreateInput
export type AutomationRunNowInput = SharedAutomationRunNowInput
export type AutomationRunNowResult = SharedAutomationRunNowResult
export type AutomationUpdateInput = SharedAutomationUpdateInput
export type AutomationSchedule = SharedAutomationSchedule

export const runningMessageActionSchema = z.enum(["steer", "queue"])
export type RunningMessageAction = z.infer<typeof runningMessageActionSchema>

export const userRoleSchema = z.enum(["user", "admin"])
export const userStatusSchema = z.enum(["active", "disabled"])

const userGroupSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
})

const userCreditQuotaTotalUsageSchema = currentUserCreditQuotaTotalSchema

const userCreditQuotaPeriodUsageSchema = userCreditQuotaTotalUsageSchema.extend(
  {
    reset_at: z.string(),
  }
)

const userCreditQuotaUsageSchema = z.strictObject({
  total: userCreditQuotaTotalUsageSchema.nullable(),
  weekly: userCreditQuotaPeriodUsageSchema.nullable(),
  monthly: userCreditQuotaPeriodUsageSchema.nullable(),
})

export const userSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    email: z.string(),
    role: userRoleSchema,
    status: userStatusSchema,
    avatar_url: z.string().nullable().optional(),
    preferred_locale: supportedLanguageSchema.nullable().optional(),
    language: supportedLanguageSchema.nullable().optional(),
    running_message_action: runningMessageActionSchema.optional(),
    total_credit_limit: creditLimitValueSchema.nullable().optional(),
    weekly_credit_limit: creditLimitValueSchema.nullable().optional(),
    monthly_credit_limit: creditLimitValueSchema.nullable().optional(),
    credit_quota: userCreditQuotaUsageSchema.nullable().optional(),
    last_login_method: z.string().nullable().optional(),
    login_method: z.string().nullable().optional(),
    created_at: z.string().optional(),
    updated_at: z.string().optional(),
    last_login_at: z.string().nullable().optional(),
    password_updated_at: z.string().nullable().optional(),
    registration_source: z.enum([
      "self_registration",
      "organization_invitation",
    ]),
    group_count: z.number().optional(),
    user_group_ids: z.array(z.string()).optional(),
    user_groups: z.array(userGroupSummarySchema).default([]),
    personal_plugin_count: z.number().optional(),
    personal_skill_count: z.number().optional(),
    personal_credential_count: z.number().optional(),
  })
  .passthrough()
  .transform((value) => ({
    ...value,
    avatar_url: value.avatar_url ?? null,
    language: value.language ?? value.preferred_locale ?? null,
    login_method: value.login_method ?? value.last_login_method ?? null,
    running_message_action: value.running_message_action ?? "queue",
    weekly_credit_limit: value.weekly_credit_limit ?? null,
    monthly_credit_limit: value.monthly_credit_limit ?? null,
  }))

export type User = z.infer<typeof userSchema>

export const usageAnalyticsReportSchema = sharedUsageAnalyticsReportSchema
export type UsageAnalyticsReport = SharedUsageAnalyticsReport

export const billingStatementListSchema = sharedBillingStatementListSchema
export const billingStatementDetailSchema = sharedBillingStatementDetailSchema
export type BillingStatementList = SharedBillingStatementList
export type BillingStatementDetail = SharedBillingStatementDetail

export const personalUsageProfileSchema = sharedPersonalUsageProfileSchema
export type PersonalUsageProfile = SharedPersonalUsageProfile

export const modelPreferenceSchema = sharedModelPreferenceSchema
export type ModelPreference = SharedModelPreference
export type ReasoningEffort = SharedReasoningEffort

export const modelProviderSettingsSchema = sharedModelProviderSettingsSchema
export const modelProviderSettingsUpdateResultSchema = z.strictObject({
  code: z.literal("SYSTEM_SETTINGS_UPDATED"),
  settings: modelProviderSettingsSchema,
})
export type ModelProviderSettings = SharedModelProviderSettings

export const personalizationSettingsSchema = sharedPersonalizationSettingsSchema
export const resetMemoriesResultSchema = sharedResetMemoriesResultSchema
export type PersonalizationSettings = SharedPersonalizationSettings

export const mcpServerSchema = sharedMcpServerSchema
export const mcpServerTestResultSchema = sharedMcpServerTestResultSchema
export type McpServer = SharedMcpServer
export type McpServerTestResult = SharedMcpServerTestResult

export const imageUnderstandingSettingsSchema =
  sharedImageUnderstandingSettingsSchema
export const imageUnderstandingSettingsUpdateResultSchema = z.strictObject({
  code: z.literal("SYSTEM_SETTINGS_UPDATED"),
  settings: imageUnderstandingSettingsSchema,
})
export type ImageUnderstandingSettings = SharedImageUnderstandingSettings

export const imageGenerationSettingsSchema = sharedImageGenerationSettingsSchema
export const imageGenerationSettingsUpdateResultSchema = z.strictObject({
  code: z.literal("SYSTEM_SETTINGS_UPDATED"),
  settings: imageGenerationSettingsSchema,
})
export type ImageGenerationSettings = SharedImageGenerationSettings

export const voiceTranscriptionSettingsSchema =
  sharedVoiceTranscriptionSettingsSchema
export const voiceTranscriptionSettingsUpdateResultSchema = z.strictObject({
  code: z.literal("SYSTEM_SETTINGS_UPDATED"),
  settings: voiceTranscriptionSettingsSchema,
})
export type VoiceTranscriptionSettings = SharedVoiceTranscriptionSettings

export const knowledgeModelSettingsSchema = sharedKnowledgeModelSettingsSchema
export const knowledgeModelSettingsUpdateResultSchema = z.strictObject({
  code: z.literal("SYSTEM_SETTINGS_UPDATED"),
  settings: knowledgeModelSettingsSchema,
})
export type KnowledgeModelSettings = SharedKnowledgeModelSettings

export const roleSummarySchema = z.object({
  role: userRoleSchema,
  active_count: z.number().int().nonnegative(),
  disabled_count: z.number().int().nonnegative(),
  total_count: z.number().int().nonnegative(),
})

export type RoleSummary = z.infer<typeof roleSummarySchema>

const integrationStatusSchema = z
  .object({
    status: z.string(),
    message_key: z.string().optional(),
    checked_at: z.string().optional(),
  })
  .passthrough()

export const bootstrapSchema = z
  .object({
    initialized: z.boolean().optional(),
    initialization_credential_required: z.boolean().optional(),
    is_initialized: z.boolean().optional(),
    system_initialized: z.boolean().optional(),
    system_name: z.string().optional(),
    organization_display_name: z.string().optional(),
    logo_url: z.string().min(1).nullable().optional(),
    logo_updated_at: z.string().nullable().optional(),
    default_language: supportedLanguageSchema.optional(),
    default_locale: supportedLanguageSchema.optional(),
    oidc: integrationStatusSchema.optional(),
    teams_sso: integrationStatusSchema.optional(),
    password_email: integrationStatusSchema.optional(),
    registration: sharedRegistrationAvailabilitySchema.optional(),
    smtp: integrationStatusSchema.optional(),
    auth: z
      .object({
        password: integrationStatusSchema.optional(),
        oidc: integrationStatusSchema.optional(),
        teams: integrationStatusSchema.optional(),
      })
      .optional(),
    maintenance_id: z.uuid().nullable().optional(),
    maintenance: maintenanceStatusSchema.optional(),
  })
  .passthrough()
  .transform((value) => ({
    ...value,
    initialized:
      value.initialized ??
      value.is_initialized ??
      value.system_initialized ??
      false,
    initialization_credential_required:
      value.initialization_credential_required ?? false,
    system_name: resolveOrganizationDisplayName(
      value.system_name ?? value.organization_display_name
    ),
    logo_url: value.logo_url ?? null,
    logo_updated_at: value.logo_updated_at ?? null,
    default_language: value.default_language ?? value.default_locale ?? "zh-CN",
    oidc: value.oidc ?? value.auth?.oidc,
    teams_sso: value.teams_sso ?? value.auth?.teams,
    password_email: value.password_email ?? value.smtp ?? value.auth?.password,
  }))

export type BootstrapStatus = z.infer<typeof bootstrapSchema>

export const registrationSettingsSchema = sharedRegistrationSettingsSchema
export const registrationSettingsUpdateResultSchema = z.strictObject({
  code: z.literal("SYSTEM_SETTINGS_UPDATED"),
  settings: registrationSettingsSchema,
})
export type RegistrationSettings = SharedRegistrationSettings

export const executionConcurrencySettingsSchema =
  sharedExecutionConcurrencySettingsSchema
export const executionConcurrencySettingsUpdateResultSchema = z.strictObject({
  code: z.literal("SYSTEM_SETTINGS_UPDATED"),
  settings: executionConcurrencySettingsSchema,
})
export type ExecutionConcurrencySettings = SharedExecutionConcurrencySettings

export const authUserSchema = sharedAuthUserSchema
export const authSessionSchema = sharedAuthSessionSchema
export const initializeSystemResultSchema = sharedInitializeSystemResultSchema
export type AuthUser = SharedAuthUser
export type AuthSession = SharedAuthSession
export type AccessSession = Pick<AuthSession, "access_token"> &
  Partial<Pick<AuthSession, "access_token_expires_at" | "user">>

export const conversationFileSchema = z
  .object({
    id: z.string(),
    name: z.string().optional(),
    filename: z.string().optional(),
    mime_type: z.string().nullable().optional(),
    size: z.number().optional(),
    size_bytes: z.number().optional(),
    kind: z.enum(["attachment", "artifact"]).optional(),
    source: z.string().optional(),
    pending_request_id: z.string().nullable().optional(),
    turn_id: z.string().nullable().optional(),
    status: z.string().optional(),
    created_at: z.string().optional(),
    download_available: z.boolean().optional(),
    downloadable: z.boolean().optional(),
  })
  .passthrough()
  .refine((value) => Boolean(value.name ?? value.filename), {
    message: "file_name_required",
  })
  .transform((value) => ({
    ...value,
    name: value.name ?? value.filename ?? "",
    size: value.size ?? value.size_bytes,
    download_available: value.download_available ?? value.downloadable ?? false,
  }))

export type ConversationFile = z.infer<typeof conversationFileSchema>

export const nativeMessagePhaseSchema = z.enum(["commentary", "final_answer"])
export type NativeMessagePhase = z.infer<typeof nativeMessagePhaseSchema>
export const nativeMessageOutputKindSchema = z.enum(["agent_message", "plan"])
export type NativeMessageOutputKind = z.infer<
  typeof nativeMessageOutputKindSchema
>

export const conversationMessageSchema = z
  .object({
    id: z.string(),
    role: z.enum(["user", "assistant", "system"]),
    content: z.string().optional(),
    content_text: z.string().optional(),
    display: userMessageDisplaySchema.nullable().optional(),
    selected_capabilities: z.array(userMessageCapabilitySchema).optional(),
    selected_knowledge_base_ids: z.array(z.string()).optional(),
    application: z
      .object({
        id: z.string(),
        name: z.string(),
      })
      .nullable()
      .optional(),
    knowledge_citations: z.array(publicKnowledgeCitationSchema).optional(),
    turn_id: z.string().nullable().optional(),
    sequence_no: z.number().int().positive().optional(),
    created_at: z.string().optional(),
    item_id: z.string().optional(),
    phase: nativeMessagePhaseSchema.nullable().optional(),
    output_kind: nativeMessageOutputKindSchema.optional(),
    usage_type: z.literal("steer_current_turn").optional(),
    event_sequence_no: z.number().int().nonnegative().optional(),
    streaming: z.boolean().optional(),
    attachments: z.array(conversationFileSchema).optional(),
    artifacts: z.array(conversationFileSchema).optional(),
  })
  .passthrough()
  .transform((value) => ({
    ...value,
    content: value.content ?? value.content_text ?? "",
  }))

export type ConversationMessage = z.infer<typeof conversationMessageSchema> & {
  /** Local submission feedback, cleared when the server accepts the message. */
  delivery_status?: "sending"
  /** Client-only identity retained while a streamed message becomes persisted. */
  client_render_key?: string
}

export const threadGoalSchema = sharedThreadGoalSchema
export type ThreadGoal = SharedThreadGoal

export const conversationPlanReviewSchema = sharedConversationPlanReviewSchema
export type ConversationPlanReview = z.infer<
  typeof conversationPlanReviewSchema
>

export const turnSchema = z
  .object({
    id: z.string(),
    status: z.enum(["running", "completed", "failed", "interrupted"]),
    task_kind: z.enum(["turn", "goal", "compact"]).optional(),
    collaboration_mode: conversationCollaborationModeSchema.optional(),
    started_at: z.string().optional(),
    completed_at: z.string().nullable().optional(),
    interrupt_requested_at: z.string().nullable().optional(),
    interrupted_at: z.string().nullable().optional(),
    error_code: z.string().nullable().optional(),
    error_message: z.string().nullable().optional(),
    model: z.string().nullable().optional(),
    reasoning_effort: z
      .enum(["minimal", "low", "medium", "high", "xhigh", "max", "ultra"])
      .nullable()
      .optional(),
    reconnecting: z.boolean().optional(),
  })
  .passthrough()

export type ConversationTurn = z.infer<typeof turnSchema>

export const turnStartReceiptSchema = z.strictObject({
  turn_id: z.string().uuid(),
  accepted: z.literal(true),
  status: z.enum(["starting", "running"]),
})

export type TurnStartReceipt = z.infer<typeof turnStartReceiptSchema>

export const conversationPlanReviewActionResultSchema = z.strictObject({
  review: conversationPlanReviewSchema,
  turn: turnSchema.nullable(),
})

export type ConversationPlanReviewActionResult = z.infer<
  typeof conversationPlanReviewActionResultSchema
>

export const conversationActivitySchema = z
  .object({
    id: z.string(),
    turn_id: z.string().nullable().optional(),
    item_id: z.string().optional(),
    type: z.string(),
    action: z.string().optional(),
    label: z.string().optional(),
    message_key: z.string().optional(),
    capability_name: z.string().optional(),
    status: z.string().optional(),
    created_at: z.string().optional(),
    sequence_no: z.number().int().nonnegative().optional(),
  })
  .passthrough()
  .transform((value) => ({
    ...value,
    type:
      value.action ??
      (value.type === "conversation.capability.attached"
        ? "capability_attached"
        : value.type === "conversation.system_capability.used"
          ? "system_capability_used"
          : value.type.includes(".tool.")
            ? value.type.endsWith(".completed")
              ? "tool_completed"
              : "tool_started"
            : value.type.includes(".step.")
              ? value.type.endsWith(".completed")
                ? "step_completed"
                : "step_started"
              : value.type.includes(".capability.")
                ? "capability_use"
                : value.type === "conversation.reconnect"
                  ? "reconnecting"
                  : value.type === "conversation.error"
                    ? "error"
                    : value.type),
  }))

export type ConversationActivity = z.infer<typeof conversationActivitySchema>

export type NativeCodexItem = RunnerCodexItem
export type NativeSubAgentDetail = RunnerCodexSubAgentDetail
export type NativeSubAgentSummary = RunnerCodexSubAgentSummary
export type NativeSubAgentSummaries = RunnerCodexSubAgentSummaries

const nativeCodexLocalSchema = z.strictObject({
  message_id: uuidSchema.optional(),
  user_input_request_id: uuidSchema.optional(),
  plan_review_id: uuidSchema.optional(),
  superseded_message_id: uuidSchema.optional(),
  superseded_item_id: runnerNativeIdSchema.optional(),
})

type NativeCodexPayloadForEvent<Event extends RunnerCodexEvent> =
  Event extends RunnerCodexEvent
    ? {
        schema_version: 2
        source: "codex_app_server"
        method: Event["method"]
        params: Event["params"]
        local?: z.infer<typeof nativeCodexLocalSchema>
      }
    : never

export type NativeCodexPayload = NativeCodexPayloadForEvent<RunnerCodexEvent>

export const nativeCodexPayloadSchema = z
  .strictObject({
    schema_version: z.literal(2),
    source: z.literal("codex_app_server"),
    method: z.string().min(1),
    params: z.unknown(),
    local: nativeCodexLocalSchema.optional(),
  })
  .transform((payload, context): NativeCodexPayload => {
    const event = runnerCodexEventSchema.safeParse({
      method: payload.method,
      visibility: "user_visible",
      params: payload.params,
    })
    if (!event.success) {
      for (const issue of event.error.issues) {
        context.addIssue({
          ...issue,
          path: ["params", ...issue.path.slice(1)],
        })
      }
      return z.NEVER
    }
    return {
      schema_version: payload.schema_version,
      source: payload.source,
      method: event.data.method,
      params: event.data.params,
      ...(payload.local ? { local: payload.local } : {}),
    } as NativeCodexPayload
  })

export { runnerCodexItemSchema as nativeCodexItemSchema }
export { runnerCodexSubAgentDetailSchema as nativeSubAgentDetailSchema }
export { runnerCodexSubAgentSummariesSchema as nativeSubAgentSummariesSchema }

export const conversationEventRecordSchema = conversationEventSchema

export type ConversationEventRecord = z.infer<
  typeof conversationEventRecordSchema
>

export const conversationTimelineEventSchema = z.object({
  id: z.string(),
  type: z.string(),
  turn_id: z.string().nullable(),
  payload: z.unknown(),
  created_at: z.string(),
  sequence_no: z.number().int().nonnegative(),
})

export type ConversationEvent = z.infer<typeof conversationTimelineEventSchema>

function toConversationTimelineEvent(
  event: ConversationEventRecord
): ConversationEvent {
  return {
    id: event.sse_event_id,
    type: event.event_type,
    turn_id: event.turn_id,
    payload: event.payload,
    created_at: event.created_at,
    sequence_no: event.sequence_no,
  }
}

const conversationTimelineEventInputSchema = z.union([
  conversationTimelineEventSchema,
  conversationEventRecordSchema.transform(toConversationTimelineEvent),
])

export function getNativeCodexPayload(event: {
  type?: string
  event_type?: string
  payload?: unknown
}): NativeCodexPayload | null {
  const parsed = nativeCodexPayloadSchema.safeParse(event.payload)
  if (!parsed.success) return null
  const eventType = event.type ?? event.event_type
  return !eventType || eventType === parsed.data.method ? parsed.data : null
}

export const pendingRequestSchema = z
  .object({
    id: z.string(),
    sequence_no: z.number().optional(),
    queue_no: z.number().optional(),
    status: z.string(),
    block_code: z.string().nullable().optional(),
    created_at: z.string().optional(),
    input_text: z.string().optional(),
    display: officeAnnotationDisplaySchema.nullable().optional(),
    priority_capability_ids: z.array(z.string()).optional(),
    knowledge_base_ids: z.array(z.string()).optional(),
    collaboration_mode: conversationCollaborationModeSchema.optional(),
    attachments: z.array(conversationFileSchema).optional(),
    attachment_count: z.number().optional(),
  })
  .passthrough()
  .transform((value) => ({
    ...value,
    sequence_no: value.sequence_no ?? value.queue_no ?? 1,
    priority_capability_ids: value.priority_capability_ids ?? [],
    attachments: value.attachments ?? [],
  }))

export type PendingRequest = z.infer<typeof pendingRequestSchema>

export type ConversationUserInputRequest = z.infer<
  typeof conversationUserInputRequestSchema
>

export const capabilitySummarySchema = z
  .strictObject({
    id: z.string(),
    name: z.string(),
    display_name: skillDisplayNameSchema.optional(),
    slug: z.string(),
    type: z.enum(["plugin", "skill"]),
    description: z.string().nullable(),
    status: z.enum(["active", "disabled", "failed"]),
    source_type: z.enum(["local", "url", "marketplace", "clawhub", "builtin"]),
    builtin_key: z.string().nullable().optional(),
    is_builtin: z.boolean().optional(),
    marketplace_listing_id: z.string().nullable(),
    marketplace_release_id: z.string().nullable(),
    logo_url: z.string().nullable(),
    is_owner: z.boolean(),
    can_manage: z.boolean(),
    can_govern: z.boolean(),
    can_select: z.boolean().optional(),
    can_delete: z.boolean().optional(),
    has_logo: z.boolean(),
    preference_status: z.enum(["enabled", "disabled"]),
    manifest: z.record(z.string(), z.unknown()).nullable(),
    risk_summary: sharedCapabilityRiskSummarySchema.nullable(),
    created_at: z.string().nullable(),
    updated_at: z.string().nullable(),
  })
  .superRefine((value, context) => {
    const builtIn = value.source_type === "builtin"
    if (
      builtIn !==
      (value.builtin_key !== null && value.builtin_key !== undefined)
    ) {
      context.addIssue({
        code: "custom",
        path: ["builtin_key"],
        message: "capability_builtin_origin_is_invalid",
      })
    }
    if (
      (builtIn &&
        (value.is_builtin === false ||
          value.can_manage ||
          value.can_select === true ||
          value.can_delete === true)) ||
      (!builtIn && value.is_builtin === true)
    ) {
      context.addIssue({
        code: "custom",
        path: ["is_builtin"],
        message: "capability_builtin_permissions_are_invalid",
      })
    }
  })
  .transform((value) => ({
    ...value,
    builtin_key: value.builtin_key ?? null,
    is_builtin: value.is_builtin ?? value.source_type === "builtin",
    can_select:
      value.can_select ??
      (value.source_type !== "builtin" &&
        value.status === "active" &&
        value.preference_status === "enabled"),
    can_delete:
      value.can_delete ?? (value.source_type !== "builtin" && value.can_manage),
    personally_disabled: value.preference_status === "disabled",
  }))

export type CapabilitySummary = z.infer<typeof capabilitySummarySchema>

export const capabilitySkillContentSchema = z.strictObject({
  content: z.string().max(1_000_000),
})

export type CapabilitySkillContent = z.infer<
  typeof capabilitySkillContentSchema
>

const localCapabilityImportSourceSchema = z.strictObject({
  source_type: z.literal("local"),
  import_kind: z.enum(["manual_skill", "zip", "skill_edit"]),
  source_url: z.null(),
  filename: z.string().nullable(),
})

const clawHubCapabilityImportSourceSchema = z.strictObject({
  source_type: z.literal("clawhub"),
  import_kind: z.literal("remote_files"),
  skill_id: uuidSchema,
  owner_handle: z.string().trim().min(1),
  slug: z.string().trim().min(1),
  version: z.string().trim().min(1),
  security_status: sharedClawHubSecurityStatusSchema,
  security_has_warnings: z.boolean(),
  canonical_url: z.url().nullable(),
})

export const capabilityImportPreviewSchema = z.strictObject({
  preview_token: z.string().min(1),
  expires_at: z.string(),
  operation: z.enum(["install", "update"]),
  capability_id: z.string().nullable(),
  source: z.discriminatedUnion("source_type", [
    localCapabilityImportSourceSchema,
    clawHubCapabilityImportSourceSchema,
  ]),
  type: z.enum(["plugin", "skill"]),
  name: z.string(),
  display_name: skillDisplayNameSchema.optional(),
  description: z.string().nullable(),
  manifest: z.record(z.string(), z.unknown()),
  declared_capabilities: z.array(z.string()),
  declared_environment_keys: z.array(z.string()),
  risk_summary: sharedCapabilityRiskSummarySchema,
  has_logo: z.boolean(),
  skill_content_preview: z.string().max(200_000).nullable(),
  skill_content_truncated: z.boolean(),
})

export type CapabilityImportPreview = z.infer<
  typeof capabilityImportPreviewSchema
>

export const conversationModelContextUsageSchema = z
  .object({
    used_tokens: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    model_context_window: z
      .number()
      .int()
      .nonnegative()
      .max(Number.MAX_SAFE_INTEGER)
      .nullable(),
    updated_at: z.string(),
  })
  .passthrough()

export const conversationOrderResultSchema = sharedConversationOrderResultSchema

export const pendingRequestRestoreResultSchema = z
  .object({
    pending_request_id: z.string(),
    input_text: z.string(),
    priority_capability_ids: z.array(z.string()),
    knowledge_base_ids: z.array(z.string()),
  })
  .passthrough()

export const conversationForkSourceSchema = z.discriminatedUnion("available", [
  z.strictObject({
    available: z.literal(true),
    conversation_id: z.string(),
    message_id: z.string(),
    title: z.string(),
    boundary_sequence_no: z.number().int().positive(),
  }),
  z.strictObject({
    available: z.literal(false),
    boundary_sequence_no: z.number().int().positive(),
  }),
])

export type ConversationForkSource = z.infer<
  typeof conversationForkSourceSchema
>

export const conversationSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    title_source: z.enum(["generated", "fallback", "manual"]).optional(),
    archived: z.boolean().optional(),
    archive_status: z.enum(["active", "archived"]).optional(),
    pinned_at: z.string().nullable().optional(),
    project_id: z.string().uuid().nullable(),
    sort_order: z.number().int().nonnegative().nullable().optional(),
    updated_at: z.string(),
    created_at: z.string().optional(),
    last_run_at: z.string().nullable().optional(),
    execution_status: z
      .enum([
        "idle",
        "running",
        "pending",
        "completed",
        "failed",
        "interrupted",
      ])
      .optional(),
    has_unread_completion: z.boolean().default(false),
    needs_attention: z.boolean().optional(),
    has_automation: z.boolean().default(false),
    application_development_role: conversationApplicationDevelopmentRoleSchema
      .nullable()
      .optional(),
    collaboration_mode: conversationCollaborationModeSchema.default("default"),
    fork_source: conversationForkSourceSchema.nullable().optional(),
    selected_knowledge_base_ids: z.array(z.string()).optional(),
    application: z
      .object({
        id: z.string(),
        name: z.string(),
        kind: z.enum(["standard", "interactive"]).default("standard"),
        package_id: z.string().uuid().nullable().default(null),
        icon: sharedApplicationIconSchema.optional(),
        available: z.boolean().optional(),
        unavailable_reason: applicationUnavailableReasonSchema
          .nullable()
          .optional(),
      })
      .nullable()
      .optional(),
    goal: threadGoalSchema.nullable().optional(),
    messages: z.array(conversationMessageSchema).optional(),
    history: conversationHistoryPageSchema.optional(),
    attachments: z.array(conversationFileSchema).optional(),
    artifacts: z.array(conversationFileSchema).optional(),
    turns: z.array(turnSchema).optional(),
    running_turn: turnSchema.nullable().optional(),
    starting_turn: conversationStartingTurnSchema.nullable().optional(),
    pending_requests: z.array(pendingRequestSchema).optional(),
    user_input_requests: z.array(conversationUserInputRequestSchema).optional(),
    plan_reviews: z.array(conversationPlanReviewSchema).optional(),
    available_capabilities: z.array(capabilitySummarySchema).optional(),
    loaded_capabilities: z.array(capabilitySummarySchema).optional(),
    priority_capabilities: z.array(capabilitySummarySchema).optional(),
    used_capabilities: z.array(capabilitySummarySchema).optional(),
    activities: z.array(conversationActivitySchema).optional(),
    events: z.array(conversationTimelineEventInputSchema).optional(),
    model_context_usage: conversationModelContextUsageSchema
      .nullable()
      .optional(),
    turn_file_change_counts: z
      .record(z.string(), z.number().int().nonnegative())
      .optional(),
    last_event_id: z.string().optional(),
  })
  .passthrough()
  .transform((value) => ({
    ...value,
    title:
      value.title_source === "fallback" && value.title === "未命名对话"
        ? "未命名任务"
        : value.title_source === "fallback" &&
            value.title === "Untitled conversation"
          ? "Untitled task"
          : value.title,
    archived: value.archived ?? value.archive_status === "archived",
    user_input_requests: value.user_input_requests ?? [],
  }))

export type Conversation = z.infer<typeof conversationSchema>

const conversationDetailPayloadSchema = z
  .object({
    conversation: conversationSchema,
    starting_turn: conversationStartingTurnSchema.nullable().optional(),
    goal: threadGoalSchema.nullable().optional(),
    messages: z.array(conversationMessageSchema).default([]),
    history: conversationHistoryPageSchema.optional(),
    turns: z.array(turnSchema).default([]),
    pending_requests: z.array(pendingRequestSchema).default([]),
    user_input_requests: z
      .array(conversationUserInputRequestSchema)
      .default([]),
    plan_reviews: z.array(conversationPlanReviewSchema).default([]),
    files: z.array(conversationFileSchema).default([]),
    events: z.array(conversationEventRecordSchema).default([]),
    model_context_usage: conversationModelContextUsageSchema
      .nullable()
      .optional(),
    last_event_id: z.string().optional(),
    activities: z.array(conversationActivitySchema).default([]),
    turn_file_change_counts: z
      .record(z.string(), z.number().int().nonnegative())
      .default({}),
  })
  .passthrough()
  .transform((value) => {
    const runningTurn = [...value.turns]
      .reverse()
      .find((turn) => turn.status === "running")
    const nativeMessageMetadata = new Map<
      string,
      {
        item_id: string
        phase?: NativeMessagePhase | null
        output_kind: NativeMessageOutputKind
        event_sequence_no: number
      }
    >()
    const completedMessageMetadata = new Map<
      string,
      {
        event_sequence_no: number
        usage_type?: "steer_current_turn"
      }
    >()
    const planMessageIds = new Set(
      value.plan_reviews.map((review) => review.plan_message_id)
    )
    for (const event of value.events) {
      if (event.event_type === "conversation.message.completed") {
        completedMessageMetadata.set(event.payload.message_id, {
          event_sequence_no: event.sequence_no,
          ...(event.payload.usage_type
            ? { usage_type: event.payload.usage_type }
            : {}),
        })
      }
      const native = getNativeCodexPayload(event)
      if (native?.method !== "item/completed") continue
      const item = native.params.item
      const messageId = native.local?.message_id
      if (
        !messageId ||
        (item?.type !== "agentMessage" && item?.type !== "plan")
      ) {
        continue
      }
      nativeMessageMetadata.set(messageId, {
        item_id: item.id,
        phase: item.type === "plan" ? "final_answer" : item.phase,
        output_kind: item.type === "plan" ? "plan" : "agent_message",
        event_sequence_no: event.sequence_no,
      })
    }
    const messagesWithMetadata = value.messages.map((message) => {
      const metadata = nativeMessageMetadata.get(message.id)
      const completedMetadata = completedMessageMetadata.get(message.id)
      return {
        ...message,
        item_id: message.item_id ?? metadata?.item_id,
        phase: message.phase ?? metadata?.phase,
        output_kind:
          message.output_kind ??
          metadata?.output_kind ??
          (planMessageIds.has(message.id) ? "plan" : undefined),
        usage_type: message.usage_type ?? completedMetadata?.usage_type,
        event_sequence_no:
          message.event_sequence_no ??
          metadata?.event_sequence_no ??
          completedMetadata?.event_sequence_no,
      }
    })
    const turnById = new Map(value.turns.map((turn) => [turn.id, turn]))
    const assistantMessagesByTurn = new Map<
      string,
      typeof messagesWithMetadata
    >()
    for (const message of messagesWithMetadata) {
      if (message.role !== "assistant" || !message.turn_id) continue
      const messages = assistantMessagesByTurn.get(message.turn_id) ?? []
      messages.push(message)
      assistantMessagesByTurn.set(message.turn_id, messages)
    }
    const artifactMessageIdByTurn = new Map<string, string>()
    for (const [turnId, messages] of assistantMessagesByTurn) {
      const agentMessages = messages.filter(
        (message) => message.output_kind !== "plan"
      )
      const explicitFinal = [...agentMessages]
        .reverse()
        .find((message) => message.phase === "final_answer")
      const fallbackFinal =
        !explicitFinal && turnById.get(turnId)?.status !== "running"
          ? [...agentMessages].reverse().find((message) => !message.phase)
          : undefined
      const artifactOwner = explicitFinal ?? fallbackFinal
      if (artifactOwner) artifactMessageIdByTurn.set(turnId, artifactOwner.id)
    }
    const messages = messagesWithMetadata.map((message) => ({
      ...message,
      attachments:
        message.role === "user" && message.turn_id
          ? value.files.filter(
              (file) =>
                file.kind !== "artifact" && file.turn_id === message.turn_id
            )
          : message.attachments,
      artifacts:
        message.role === "assistant" &&
        message.turn_id &&
        artifactMessageIdByTurn.get(message.turn_id) === message.id
          ? value.files.filter(
              (file) =>
                file.kind === "artifact" && file.turn_id === message.turn_id
            )
          : message.artifacts,
    }))
    const attachedArtifactIds = new Set(
      messages.flatMap(
        (message) => message.artifacts?.map((file) => file.id) ?? []
      )
    )
    return conversationSchema.parse({
      ...value.conversation,
      goal: value.goal ?? value.conversation.goal ?? null,
      messages,
      history: value.history,
      turns: value.turns,
      running_turn: runningTurn ?? null,
      starting_turn: value.starting_turn,
      pending_requests: value.pending_requests.map((request) => ({
        ...request,
        attachments: value.files.filter(
          (file) =>
            file.kind !== "artifact" && file.pending_request_id === request.id
        ),
      })),
      user_input_requests: value.user_input_requests,
      plan_reviews: value.plan_reviews,
      attachments: value.files.filter(
        (file) =>
          file.kind !== "artifact" &&
          file.status === "staged" &&
          file.source !== INTERACTIVE_APPLICATION_FILE_SOURCE
      ),
      artifacts: value.files.filter(
        (file) => file.kind === "artifact" && !attachedArtifactIds.has(file.id)
      ),
      activities: value.activities,
      events: value.events.map(toConversationTimelineEvent),
      model_context_usage:
        value.model_context_usage ??
        value.conversation.model_context_usage ??
        null,
      turn_file_change_counts: value.turn_file_change_counts,
      last_event_id:
        value.last_event_id ??
        value.events.at(-1)?.sse_event_id ??
        value.events.at(-1)?.id,
    })
  })

export const conversationDetailSchema = z.union([
  conversationDetailPayloadSchema,
  conversationSchema,
])

export const credentialSchema = z
  .strictObject({
    id: z.string(),
    name: z.string(),
    provider_type: z.string(),
    secret_keys: z.array(z.string()).default([]),
    status: z.enum(["active", "disabled"]),
    created_at: z.string(),
    updated_at: z.string(),
    last_used_at: z.string().nullable(),
  })
  .transform((value) => ({
    ...value,
    type: value.provider_type,
  }))

export type Credential = z.infer<typeof credentialSchema>

export const credentialBindingSchema = z.strictObject({
  id: z.string(),
  capability_id: z.string(),
  credential_id: z.string(),
  env_key: z.string(),
  credential_key: z.string(),
  status: z.enum(["active", "revoked"]),
  created_at: z.string(),
  updated_at: z.string(),
})

export type CredentialBinding = z.infer<typeof credentialBindingSchema>

export const userGroupSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    description: z.string().nullable().optional(),
    member_count: z.number().optional(),
    member_ids: z.array(z.string()).optional(),
    created_at: z.string().optional(),
    updated_at: z.string().optional(),
  })
  .passthrough()
  .transform((value) => ({
    ...value,
    description: value.description ?? undefined,
  }))

export type UserGroup = z.infer<typeof userGroupSchema>

export const marketplaceListingSchema = sharedMarketplaceListingSchema
export const marketplaceReleaseSchema = sharedMarketplaceReleaseSchema
export const marketplaceCatalogItemSchema = sharedMarketplaceCatalogItemSchema

export const marketplacePublicationSchema = z.strictObject({
  listing: marketplaceListingSchema,
  current_release: marketplaceReleaseSchema.nullable(),
  latest_release: marketplaceReleaseSchema,
  install_count: z.number().int().nonnegative(),
})

export const marketplaceReviewDetailSchema = z.strictObject({
  listing: marketplaceListingSchema,
  release: marketplaceReleaseSchema,
  files: z.array(z.string()),
  skill_content: z.string().nullable(),
})

export type MarketplaceListing = z.infer<typeof marketplaceListingSchema>
export type MarketplaceRelease = z.infer<typeof marketplaceReleaseSchema>
export type MarketplaceCatalogItem = z.infer<
  typeof marketplaceCatalogItemSchema
>
export type MarketplacePublication = z.infer<
  typeof marketplacePublicationSchema
>
export type MarketplaceReviewDetail = z.infer<
  typeof marketplaceReviewDetailSchema
>

export const clawHubSkillCatalogItemSchema = sharedClawHubSkillCatalogItemSchema
export type ClawHubSkillCatalogItem = SharedClawHubSkillCatalogItem
export const clawHubSkillCatalogSortSchema = sharedClawHubSkillCatalogSortSchema
export type ClawHubSkillCatalogSort = SharedClawHubSkillCatalogSort
export const clawHubSkillCatalogPageSchema = z.strictObject({
  items: z.array(clawHubSkillCatalogItemSchema),
  next_cursor: z.string().nullable(),
  total_count: z.number().int().nonnegative(),
})
export type ClawHubSkillCatalogPage = z.infer<
  typeof clawHubSkillCatalogPageSchema
>

export const auditRecordSchema = z
  .object({
    id: z.string(),
    action: z.string(),
    actor_name: z.string().optional(),
    actor_email: z.string().optional(),
    actor_id: z.string().nullable().optional(),
    target_type: z.string().nullable().optional(),
    target_id: z.string().nullable().optional(),
    result: z.string().optional(),
    error_code: z.string().nullable().optional(),
    source_ip: z.string().nullable().optional(),
    ip_address: z.string().nullable().optional(),
    user_agent: z.string().nullable().optional(),
    created_at: z.string(),
    metadata: z.record(z.string(), z.unknown()).nullable().optional(),
  })
  .passthrough()
  .transform((value) => ({
    ...value,
    actor_name: value.actor_name ?? value.actor_id ?? undefined,
    source_ip: value.source_ip ?? value.ip_address ?? null,
    metadata: value.metadata ?? undefined,
  }))

export type AuditRecord = z.infer<typeof auditRecordSchema>

export const auditConversationMetadataSchema = z.object({
  conversation_id: z.string(),
  owner_id: z.string(),
  owner_name: z.string().nullable(),
  owner_email: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  last_run_at: z.string().nullable(),
  execution_status: z.enum([
    "idle",
    "running",
    "pending",
    "completed",
    "failed",
    "interrupted",
  ]),
  plugin_names: z.array(z.string()),
  skill_names: z.array(z.string()),
  attachment_count: z.number().nonnegative(),
  attachment_size_bytes: z.number().nonnegative(),
  artifact_count: z.number().nonnegative(),
  artifact_size_bytes: z.number().nonnegative(),
  execution_duration_ms: z.number().nonnegative(),
  error_type: z.string().nullable(),
  error_code: z.string().nullable(),
  runner_status: z.string(),
  archive_status: z.enum(["active", "archived"]),
})

export type AuditConversationMetadata = z.infer<
  typeof auditConversationMetadataSchema
>

export const retainedArtifactSummarySchema = z.object({
  conversation_id: z.string(),
  owner_id: z.string(),
  owner_name: z.string().nullable().optional(),
  owner_email: z.string().nullable().optional(),
  artifact_count: z.number().int().nonnegative(),
  total_size_bytes: z.number().nonnegative(),
  checksum_present: z.boolean(),
  first_artifact_created_at: z.string().nullable().optional(),
  last_artifact_created_at: z.string().nullable().optional(),
  conversation_deleted_at: z.string(),
})

export type RetainedArtifactSummary = z.infer<
  typeof retainedArtifactSummarySchema
>

export const productSettingsSchema = z
  .object({
    system_name: z.string().optional(),
    organization_display_name: z.string().optional(),
    logo_url: z.string().min(1).nullable().optional(),
    logo_updated_at: z.string().nullable().optional(),
    default_language: supportedLanguageSchema.optional(),
    default_locale: supportedLanguageSchema.optional(),
    deployment: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough()
  .refine(
    (value) => Boolean(value.system_name ?? value.organization_display_name),
    {
      message: "system_name_required",
    }
  )
  .transform((value) => ({
    ...value,
    system_name: resolveOrganizationDisplayName(
      value.system_name ?? value.organization_display_name
    ),
    logo_url: value.logo_url ?? null,
    logo_updated_at: value.logo_updated_at ?? null,
    default_language: value.default_language ?? value.default_locale ?? "zh-CN",
  }))

export type ProductSettings = z.infer<typeof productSettingsSchema>

export const authenticationSettingsSchema = sharedAuthenticationSettingsSchema
export const authenticationSettingsUpdateResultSchema =
  sharedAuthenticationSettingsUpdateResultSchema
export type AuthenticationSettings = SharedAuthenticationSettings

export const healthComponentSchema = z
  .object({
    key: z.string(),
    status: z.enum([
      "healthy",
      "warning",
      "unavailable",
      "not_configured",
      "available",
      "degraded",
      "not_observed",
    ]),
    checked_at: z.string().optional(),
    summary: z.string().optional(),
    reason_code: z.string().nullable().optional(),
    message_key: z.string().optional(),
  })
  .passthrough()
  .transform((value) => ({
    ...value,
    reported_status: value.status,
    status: value.status === "available" ? ("healthy" as const) : value.status,
  }))

export const cleanupFailureSchema = z
  .object({
    id: z.string(),
    conversation_id: z.string().optional(),
    resource_type: z.string(),
    status: z.literal("failed"),
    cleanup_stage: z
      .enum([
        "reconcile",
        "stop_runtime",
        "delete_workspace",
        "delete_control",
        "verify_absent",
      ])
      .optional(),
    failed_at: z.string(),
    reason_code: z.string(),
    attempts_made: z.number().int().nonnegative(),
    max_attempts: z.number().int().positive(),
  })
  .passthrough()

export const runningTurnRecoveryStatusSchema = z
  .object({
    outcome: z.enum(["not_started", "running", "succeeded", "failed"]),
    last_attempt_at: z.string().nullable(),
    last_success_at: z.string().nullable(),
    last_failure_at: z.string().nullable(),
    reason_code: z.string().nullable(),
  })
  .strict()

const dockerResourceStatusSchema = z.enum([
  "available",
  "unavailable",
  "not_observed",
])

const dockerResourceServiceUsageSchema = z
  .object({
    key: z.string().min(1).max(80),
    service_type: z.enum(["compose", "worker_pool"]),
    status: dockerResourceStatusSchema,
    container_count: z.number().int().nonnegative(),
    running_container_count: z.number().int().nonnegative(),
    cpu_percent: z.number().nonnegative().nullable(),
    memory_used_bytes: z.number().int().nonnegative().nullable(),
    memory_limit_bytes: z.number().int().nonnegative().nullable(),
    memory_percent: z.number().nonnegative().nullable(),
    pids: z.number().int().nonnegative().nullable(),
    state: z.string().max(120).nullable(),
  })
  .strict()

const dockerResourceUsageSchema = z
  .object({
    status: dockerResourceStatusSchema,
    checked_at: z.string(),
    reason_code: z.string().nullable(),
    services: z.array(dockerResourceServiceUsageSchema),
  })
  .strict()

export const healthSchema = z.preprocess(
  (input) => {
    if (!input || typeof input !== "object" || Array.isArray(input))
      return input
    const value = input as Record<string, unknown>
    const rawComponents = value.components
    const components =
      rawComponents &&
      typeof rawComponents === "object" &&
      !Array.isArray(rawComponents)
        ? Object.entries(rawComponents).map(([key, component]) => ({
            key,
            ...(component &&
            typeof component === "object" &&
            !Array.isArray(component)
              ? component
              : { status: "unavailable" }),
          }))
        : rawComponents
    return {
      ...value,
      overall_status: value.overall_status ?? value.status,
      components,
    }
  },
  z
    .object({
      overall_status: z.string(),
      components: z.array(healthComponentSchema),
      running_turn_count: z.number().optional(),
      redis_running_turn_count: z.number().optional(),
      runner_running_turn_count: z.number().optional(),
      observed_unresolved_running_turn_slot_count: z.number().optional(),
      running_turn_recovery: runningTurnRecoveryStatusSchema.optional(),
      app_server_process_count: z.number().optional(),
      concurrency_limit: z.number().optional(),
      docker_resource_usage: dockerResourceUsageSchema.optional(),
      cleanup_failures: z.array(cleanupFailureSchema).optional(),
      cleanup_failure_summary: z
        .object({
          total: z.number().int().nonnegative(),
          requires_attention: z.boolean(),
        })
        .optional(),
    })
    .passthrough()
)

export type HealthStatus = z.infer<typeof healthSchema>

export const importResultSchema = z
  .object({
    imported_count: z.number().default(0),
    skipped_count: z.number().default(0),
    errors: z
      .array(
        z
          .object({
            row: z.number().optional(),
            error_code: z.string().optional(),
            message: z.string().optional(),
          })
          .passthrough()
      )
      .default([]),
  })
  .passthrough()

export type ImportResult = z.infer<typeof importResultSchema>

export const sseEventSchema = conversationEventRecordSchema.transform(
  toConversationTimelineEvent
)

export const conversationEventHistoryPageSchema = z.strictObject({
  items: z.array(sseEventSchema),
  next_cursor: z.string().nullable(),
})

export type ConversationEventHistoryPage = z.infer<
  typeof conversationEventHistoryPageSchema
>

export function paginatedSchema<T extends z.ZodType>(itemSchema: T) {
  return z
    .object({
      items: z.array(itemSchema),
      next_cursor: z.string().nullable().optional(),
      total_count: z.number().int().nonnegative().optional(),
    })
    .passthrough()
}

export type Paginated<T> = {
  items: T[]
  next_cursor?: string | null
  total_count?: number
}
