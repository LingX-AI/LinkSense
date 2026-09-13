import App from "@/App"
import type { UserGroup } from "@/api/contracts"
import { setAccessToken } from "@/api/session"
import { AppProviders } from "@/app/providers"
import { clearConversationAttachmentPreviewCacheForTests } from "@/features/conversations/conversation-attachment-preview-cache"
import { writeLocalConversationDraft } from "@/features/conversations/conversation-local-draft"
import i18n from "@/i18n"
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router-dom"
import { afterEach, beforeAll, beforeEach, vi } from "vitest"

const originalCreateObjectUrl = Object.getOwnPropertyDescriptor(
  URL,
  "createObjectURL"
)

const originalRevokeObjectUrl = Object.getOwnPropertyDescriptor(
  URL,
  "revokeObjectURL"
)

function restoreUrlMethod(
  name: "createObjectURL" | "revokeObjectURL",
  descriptor: PropertyDescriptor | undefined
) {
  if (descriptor) Object.defineProperty(URL, name, descriptor)
  else Reflect.deleteProperty(URL, name)
}

const user = {
  id: "user-1",
  name: "林晓",
  email: "lin@example.com",
  role: "admin",
  status: "active",
  language: "zh-CN",
  running_message_action: "queue" as "steer" | "queue",
  avatar_url: null,
  registration_source: "organization_invitation" as
    "self_registration" | "organization_invitation",
  user_group_ids: [] as string[],
  user_groups: [] as Array<{ id: string; name: string }>,
  total_credit_limit: null as string | null,
  weekly_credit_limit: null as string | null,
  monthly_credit_limit: null as string | null,
  credit_quota: null as null | {
    total: {
      limit_credits: string
      used_credits: string
      remaining_credits: string
      remaining_percentage: number
    } | null
    weekly: {
      limit_credits: string
      used_credits: string
      remaining_credits: string
      remaining_percentage: number
      reset_at: string
    } | null
    monthly: {
      limit_credits: string
      used_credits: string
      remaining_credits: string
      remaining_percentage: number
      reset_at: string
    } | null
  },
}

function seedLocalDraft(
  conversationId: string,
  draft: {
    input?: string
    capabilityIds?: readonly string[]
    knowledgeBaseIds?: readonly string[]
  }
) {
  writeLocalConversationDraft(window.localStorage, user.id, conversationId, {
    input: draft.input ?? "",
    capabilityIds: draft.capabilityIds ?? [],
    knowledgeBaseIds: draft.knowledgeBaseIds ?? [],
  })
}

function authenticationSession(
  accessToken: string,
  language: "zh-CN" | "en-US",
  userOverride: Partial<typeof user> | undefined,
  loginMethod: "password" | "oidc" | "teams" = "password"
) {
  return {
    access_token: accessToken,
    access_token_expires_at: "2099-01-01T00:00:00.000Z",
    refresh_session_expires_at: "2099-03-01T00:00:00.000Z",
    user: {
      id: "00000000-0000-4000-8000-000000000001",
      email: userOverride?.email ?? user.email,
      name: userOverride?.name ?? user.name,
      avatar_object_key: null,
      role: userOverride?.role ?? user.role,
      status: userOverride?.status ?? user.status,
      preferred_locale: language,
      running_message_action:
        userOverride?.running_message_action ?? user.running_message_action,
      last_login_at: "2026-08-31T08:00:00.000Z",
      last_login_method: loginMethod,
      password_updated_at: "2026-08-01T08:00:00.000Z",
      created_at: "2026-08-01T08:00:00.000Z",
      updated_at: "2026-08-31T08:00:00.000Z",
    },
  }
}

const personalUsageProfile = {
  generated_at: "2026-07-27T12:00:00.000Z",
  activity_period: {
    from: "2025-07-28",
    to: "2026-07-27",
    time_zone: "Asia/Shanghai",
  },
  token_coverage: {
    started_at: "2026-07-01T00:00:00.000Z",
  },
  metrics: {
    task_count: 12,
    turn_count: 34,
    request_count: 36,
    skill_usage_count: 3,
    token_usage: {
      total_tokens: "12345",
      input_tokens: "9000",
      cached_input_tokens: "1200",
      output_tokens: "3345",
      reasoning_output_tokens: "900",
    },
  },
  peak_daily_tokens: "3500",
  active_days: 18,
  current_streak_days: 2,
  longest_streak_days: 7,
  daily_activity: [
    { date: "2026-07-26", total_tokens: "2000" },
    { date: "2026-07-27", total_tokens: "3500" },
  ],
  models: [
    {
      model_id: "model-a",
      display_name: "Model A",
      model_kind: "generation",
      request_count: 24,
      turn_count: 24,
      token_usage: {
        total_tokens: "10000",
        input_tokens: "7000",
        cached_input_tokens: "1000",
        output_tokens: "3000",
        reasoning_output_tokens: "800",
      },
    },
  ],
  skills: [
    {
      skill_id: "40000000-0000-4000-8000-000000000001",
      name: "dashi-ppt",
      usage_count: 3,
    },
  ],
}

const conversations = [
  {
    id: "c1",
    title: "活动风险评估",
    archived: false,
    category_id: null as string | null,
    pinned_at: null as string | null,
    sort_order: null as number | null,
    updated_at: new Date().toISOString(),
    execution_status: "running",
    has_unread_completion: false,
    has_automation: false,
  },
  {
    id: "c2",
    title: "整理项目会议纪要",
    archived: false,
    category_id: null as string | null,
    pinned_at: null as string | null,
    sort_order: null as number | null,
    updated_at: new Date(Date.now() - 86_400_000).toISOString(),
    execution_status: "completed",
    has_unread_completion: false,
    has_automation: false,
  },
  {
    id: "c3",
    title: "比较三份项目方案",
    archived: false,
    category_id: null as string | null,
    pinned_at: null as string | null,
    sort_order: null as number | null,
    updated_at: new Date(Date.now() - 4 * 86_400_000).toISOString(),
    execution_status: "interrupted",
    has_unread_completion: false,
    has_automation: false,
  },
]

const conversation = {
  ...conversations[0],
  draft_input: "",
  draft_capability_ids: [],
  draft: {
    id: "draft-1",
    conversation_id: "c1",
    input_text: "",
    priority_capability_ids: [],
    created_at: "2026-07-11T08:00:00.000Z",
    updated_at: "2026-07-11T08:00:00.000Z",
  },
  messages: [
    { id: "m1", role: "user", content: "请评估活动风险" },
    { id: "m2", role: "assistant", content: "正在整理风险与建议。" },
  ],
  attachments: [],
  artifacts: [],
  turns: [{ id: "turn-1", status: "running" }],
  running_turn: { id: "turn-1", status: "running" },
  pending_requests: [],
  loaded_capabilities: [],
  used_capabilities: [],
}

const capabilities = [
  {
    id: "p1",
    name: "业务数据",
    slug: "business-data",
    type: "plugin",
    description: "读取授权的业务数据",
    status: "active",
    source_type: "local",
    marketplace_listing_id: null,
    marketplace_release_id: null,
    logo_url: null,
    has_logo: false,
    manifest: {},
    risk_summary: {
      declared_environment_keys: ["SERVICE_API_KEY"],
    },
    preference_status: "enabled",
    is_owner: true,
    can_manage: true,
    can_govern: true,
    created_at: "2026-07-19T00:00:00.000Z",
    updated_at: "2026-07-19T00:00:00.000Z",
  },
  {
    id: "s1",
    name: "报告写作",
    slug: "report-writing",
    type: "skill",
    description: "组织结构化报告",
    status: "active",
    source_type: "local",
    marketplace_listing_id: null,
    marketplace_release_id: null,
    logo_url: null,
    has_logo: false,
    manifest: {},
    risk_summary: { declared_environment_keys: [] },
    preference_status: "enabled",
    is_owner: true,
    can_manage: true,
    can_govern: true,
    created_at: "2026-07-19T00:00:00.000Z",
    updated_at: "2026-07-19T00:00:00.000Z",
  },
]

const personalAvailableCapabilities = capabilities

const personalManagedCapabilities = capabilities.filter(
  (capability) => capability.id === "s1"
)

type CapabilityFixture = (typeof capabilities)[number]

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

const planReviewFixtureIds = {
  conversation: "10000000-0000-4000-8000-000000000001",
  sourceTurn: "10000000-0000-4000-8000-000000000002",
  planMessage: "10000000-0000-4000-8000-000000000003",
  review: "10000000-0000-4000-8000-000000000004",
  followUpTurn: "10000000-0000-4000-8000-000000000005",
} as const

export type PlanReviewFixtureDecision =
  "implement" | "revise" | "skip" | "exit" | null

function planReviewConversationFixture(
  decision: PlanReviewFixtureDecision,
  revisionFeedback = "请补充回滚方案"
) {
  const resolved = decision !== null
  const startsTurn = decision === "implement" || decision === "revise"
  const followUpMessage =
    decision === "implement" ? "Implement the plan." : revisionFeedback
  return {
    id: "c1",
    title: "计划确认测试",
    archived: false,
    category_id: null as string | null,
    has_unread_completion: false,
    collaboration_mode:
      decision === "implement" || decision === "exit" ? "default" : "plan",
    execution_status: startsTurn ? "running" : "completed",
    updated_at: "2026-08-09T12:00:00.000Z",
    draft_input: "",
    draft_capability_ids: [],
    messages: [
      {
        id: "10000000-0000-4000-8000-000000000006",
        role: "user",
        turn_id: planReviewFixtureIds.sourceTurn,
        content: "请先规划完整实现方案",
        created_at: "2026-08-09T11:58:00.000Z",
      },
      {
        id: planReviewFixtureIds.planMessage,
        role: "assistant",
        turn_id: planReviewFixtureIds.sourceTurn,
        phase: "final_answer",
        content: "## 完整实施计划\n\n1. 实现状态机\n2. 完成回归验证",
        created_at: "2026-08-09T11:59:00.000Z",
      },
      ...(startsTurn
        ? [
            {
              id: "10000000-0000-4000-8000-000000000007",
              role: "user",
              turn_id: planReviewFixtureIds.followUpTurn,
              content: followUpMessage,
              created_at: "2026-08-09T12:00:00.000Z",
            },
          ]
        : []),
    ],
    attachments: [],
    artifacts: [],
    turns: [
      {
        id: planReviewFixtureIds.sourceTurn,
        status: "completed",
        collaboration_mode: "plan",
        started_at: "2026-08-09T11:58:00.000Z",
        completed_at: "2026-08-09T11:59:00.000Z",
      },
      ...(startsTurn
        ? [
            {
              id: planReviewFixtureIds.followUpTurn,
              status: "running",
              collaboration_mode: decision === "implement" ? "default" : "plan",
              started_at: "2026-08-09T12:00:00.000Z",
            },
          ]
        : []),
    ],
    running_turn: startsTurn
      ? {
          id: planReviewFixtureIds.followUpTurn,
          status: "running",
          collaboration_mode: decision === "implement" ? "default" : "plan",
          started_at: "2026-08-09T12:00:00.000Z",
        }
      : null,
    pending_requests: [],
    user_input_requests: [],
    plan_reviews: [
      {
        id: planReviewFixtureIds.review,
        conversation_id: planReviewFixtureIds.conversation,
        source_turn_id: planReviewFixtureIds.sourceTurn,
        plan_message_id: planReviewFixtureIds.planMessage,
        status: resolved ? "resolved" : "pending",
        decision,
        follow_up_turn_id: startsTurn
          ? planReviewFixtureIds.followUpTurn
          : null,
        resolved_at: resolved ? "2026-08-09T12:00:00.000Z" : null,
        created_at: "2026-08-09T11:59:00.000Z",
        updated_at: resolved
          ? "2026-08-09T12:00:00.000Z"
          : "2026-08-09T11:59:00.000Z",
      },
    ],
  }
}

function capabilityPreviewResponse() {
  return json(
    {
      success: true,
      data: {
        preview_token: "00000000-0000-4000-8000-000000000099",
        expires_at: "2026-07-11T12:00:00.000Z",
        operation: "install",
        capability_id: null,
        source: {
          source_type: "local",
          import_kind: "manual_skill",
          source_url: null,
          filename: null,
        },
        type: "skill",
        name: "运营报告",
        description: "整理运营报告",
        manifest: { name: "运营报告", format: "SKILL.md" },
        declared_capabilities: ["mcp_server", "environment_variables"],
        declared_environment_keys: ["SERVICE_API_KEY"],
        risk_summary: {
          contains_mcp_server: true,
          contains_scripts: false,
          contains_external_connections: false,
          requires_environment_variables: true,
          requires_credentials: true,
          contains_dependency_download_commands: false,
          declared_environment_keys: ["SERVICE_API_KEY"],
          dependency_commands: [],
        },
        has_logo: false,
        skill_content_preview: "# Instructions",
        skill_content_truncated: false,
      },
    },
    202
  )
}

function installApiMock(options?: {
  conversationSourcesResponse?: () => Response | Promise<Response>
  initialized?: boolean
  initializationCredentialRequired?: boolean
  systemName?: string
  refreshFails?: boolean
  initialLanguage?: "zh-CN" | "en-US"
  languagePatchFails?: boolean
  conversationOverride?: Record<string, unknown>
  conversationGetResponse?: (callIndex: number) => Promise<Response>
  conversationDetailResponse?: (
    conversationId: string,
    callIndex: number
  ) => Promise<Response>
  newTaskCreationStart?: Promise<void>
  newTaskDetailResponse?: (callIndex: number) => Promise<Response>
  newTaskEventStreamInitialBody?: string
  newTaskEventStreamBody?: string
  newTaskEventStreamStart?: Promise<void>
  newTaskModelPreferenceStart?: Promise<void>
  modelPreferenceStart?: (conversationId: string) => Promise<void>
  newTaskTurnStart?: Promise<void>
  eventStreamUnavailable?: boolean
  eventStreamBody?: string
  eventStreamStart?: Promise<void>
  backgroundEventStreams?: Record<
    string,
    { body: string; start?: Promise<void> }
  >
  downloadResponse?: Promise<Response>
  attachmentUploadResponse?: (
    formData: FormData,
    callIndex: number
  ) => Response | Promise<Response>
  turnStartResponse?: () => Promise<Response>
  pendingRequestResponse?: (body: unknown) => Response | Promise<Response>
  userInputResponse?: (body: unknown) => Response | Promise<Response>
  interruptResponse?: () => Response | Promise<Response>
  regenerateResponse?: () => Response | Promise<Response>
  forkStart?: Promise<void>
  forkResponse?: () => Response | undefined
  planReviewActionResponse?: (
    reviewId: string,
    body: unknown
  ) => Response | Promise<Response>
  userOverride?: Partial<typeof user>
  managedUsersOverride?: Array<Partial<typeof user>>
  roleSummaryOverride?: Array<{
    role: "user" | "admin"
    active_count: number
    disabled_count: number
    total_count: number
  }>
  capabilitiesOverride?: CapabilityFixture[]
  capabilityConfirmOverride?: CapabilityFixture
  knowledgeBasesOverride?: Record<string, unknown>[]
  userGroupsOverride?: UserGroup[]
  modelPreferenceByConversation?: Record<string, string>
  conversationListResponse?: (
    query: URLSearchParams,
    state: { forkCalls: number }
  ) => Response | Promise<Response>
  conversationPatchResponse?: (
    conversationId: string,
    body: Record<string, unknown>
  ) => Response | Promise<Response>
  clearArchivedResponse?: () => Response | Promise<Response>
  clearArchivedDeletedCount?: number
  forgotPasswordResponse?: () => Response | Promise<Response>
  personalUsageOverride?: Record<string, unknown>
  automationCompletionNotification?: {
    latest_unread: {
      conversation_id: string
      completed_at: string
    } | null
  }
}) {
  const requests: {
    path: string
    method: string
    query: string
    body?: unknown
  }[] = []
  let currentLanguage = options?.initialLanguage ?? "zh-CN"
  let currentRunningMessageAction =
    options?.userOverride?.running_message_action ?? user.running_message_action
  let pendingRequests = Array.isArray(
    options?.conversationOverride?.pending_requests
  )
    ? [...options.conversationOverride.pending_requests]
    : null
  let attachmentUploadCalls = 0
  let conversationGetCalls = 0
  let newTaskGetCalls = 0
  let forkCalls = 0
  let currentConversations = conversations.map((item) => ({ ...item }))
  let userGroups = [...(options?.userGroupsOverride ?? [])]
  let managedUsers = (
    options?.managedUsersOverride ?? [options?.userOverride ?? {}]
  ).map((managedUser) => ({ ...user, ...managedUser }))
  const modelPreferenceByConversation = {
    ...(options?.modelPreferenceByConversation ?? {}),
  }
  let newTaskModel = "test-model"
  let automationCompletionNotification =
    options?.automationCompletionNotification ?? {
      latest_unread: null,
    }
  const newTaskId = "new-task-1"
  const newTaskConversation = {
    id: newTaskId,
    title: "未命名任务",
    archived: false,
    category_id: null as string | null,
    updated_at: "2026-07-18T08:00:00.000Z",
    draft_input: "",
    draft_capability_ids: [],
    messages: [],
    attachments: [],
    artifacts: [],
    turns: [],
    running_turn: null,
    pending_requests: [],
  }
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), window.location.origin)
      const path = url.pathname
      const method = init?.method ?? "GET"
      const requestBody =
        typeof init?.body === "string"
          ? (JSON.parse(init.body) as unknown)
          : undefined
      requests.push({ path, method, query: url.search, body: requestBody })

      if (
        /^\/api\/v1\/conversations\/[^/]+\/sources$/.test(path) &&
        method === "GET"
      ) {
        if (options?.conversationSourcesResponse)
          return options.conversationSourcesResponse()
        return json({ success: true, data: { items: [] } })
      }

      if (path === "/api/v1/system/bootstrap") {
        return json({
          success: true,
          data: {
            initialized: options?.initialized ?? true,
            initialization_credential_required:
              options?.initializationCredentialRequired ?? false,
            system_name: options?.systemName ?? "LinkSense",
            default_language: "zh-CN",
            teams_sso: { status: "not_configured" },
            oidc: { status: "not_configured" },
          },
        })
      }
      if (path === "/api/v1/auth/refresh") {
        if (options?.refreshFails)
          return json(
            { success: false, error_code: "AUTH_SESSION_EXPIRED" },
            401
          )
        return json({
          success: true,
          data: authenticationSession(
            "test-access-token-that-is-long-enough",
            currentLanguage,
            options?.userOverride
          ),
        })
      }
      if (path === "/api/v1/auth/login") {
        return json({
          success: true,
          data: authenticationSession(
            "password-access-token-that-is-long-enough",
            currentLanguage,
            options?.userOverride
          ),
        })
      }
      if (path === "/api/v1/auth/oidc/callback") {
        return json({
          success: true,
          data: authenticationSession(
            "oidc-access-token-that-is-long-enough",
            currentLanguage,
            options?.userOverride,
            "oidc"
          ),
        })
      }
      if (path === "/api/v1/auth/forgot-password") {
        if (options?.forgotPasswordResponse) {
          return options.forgotPasswordResponse()
        }
        return json(
          {
            success: true,
            data: { code: "PASSWORD_RESET_REQUEST_ACCEPTED" },
          },
          202
        )
      }
      if (path.endsWith("/model-preference")) {
        const scopedPreference = path.match(
          /^\/api\/v1\/conversations\/([^/]+)\/model-preference$/u
        )
        if (
          method === "GET" &&
          scopedPreference?.[1] === newTaskId &&
          options?.newTaskModelPreferenceStart
        ) {
          await options.newTaskModelPreferenceStart
        }
        if (method === "GET" && scopedPreference) {
          await options?.modelPreferenceStart?.(scopedPreference[1])
        }
        const selectedModel = scopedPreference
          ? (modelPreferenceByConversation[scopedPreference[1]] ?? newTaskModel)
          : newTaskModel
        const selectedReasoningEffort =
          typeof requestBody === "object" &&
          requestBody !== null &&
          "selected_reasoning_effort" in requestBody &&
          typeof requestBody.selected_reasoning_effort === "string"
            ? requestBody.selected_reasoning_effort
            : "medium"
        if (
          method === "PUT" &&
          typeof requestBody === "object" &&
          requestBody !== null &&
          "selected_model" in requestBody &&
          typeof requestBody.selected_model === "string"
        ) {
          newTaskModel = requestBody.selected_model
          if (scopedPreference) {
            modelPreferenceByConversation[scopedPreference[1]] =
              requestBody.selected_model
          }
        }
        const responseModel =
          method === "PUT" &&
          typeof requestBody === "object" &&
          requestBody !== null &&
          "selected_model" in requestBody &&
          typeof requestBody.selected_model === "string"
            ? requestBody.selected_model
            : selectedModel
        return json({
          success: true,
          data: {
            configured: true,
            models: [
              {
                id: "test-model",
                display_name: "Test Model",
                enabled: true,
                context_window: null,
                supported_reasoning_efforts: ["medium", "high"],
                default_reasoning_effort: "medium",
              },
              {
                id: "model-a",
                display_name: "Model A",
                enabled: true,
                context_window: null,
                supported_reasoning_efforts: ["medium", "high"],
                default_reasoning_effort: "medium",
              },
              {
                id: "model-b",
                display_name: "Model B",
                enabled: true,
                context_window: null,
                supported_reasoning_efforts: ["medium", "high"],
                default_reasoning_effort: "medium",
              },
            ],
            default_model: "test-model",
            selected_model: responseModel,
            selected_reasoning_effort: selectedReasoningEffort,
          },
        })
      }
      if (path === "/api/v1/me/usage") {
        return json({
          success: true,
          data: options?.personalUsageOverride ?? personalUsageProfile,
        })
      }
      if (path === "/api/v1/completion-notifications" && method === "GET") {
        return json({
          success: true,
          data: { items: [], next_cursor: "credit-quota-refresh-cursor" },
        })
      }
      if (
        path === "/api/v1/automations/completion-notifications" &&
        method === "GET"
      ) {
        return json({
          success: true,
          data: automationCompletionNotification,
        })
      }
      if (
        path === "/api/v1/automations/completion-notifications/read" &&
        method === "POST"
      ) {
        automationCompletionNotification = {
          latest_unread: null,
        }
        return json({
          success: true,
          data: automationCompletionNotification,
        })
      }
      if (path === "/api/v1/automations/pinned-tasks" && method === "GET") {
        return json({ success: true, data: { items: [] } })
      }
      if (path === "/api/v1/automations" && method === "GET") {
        return json({ success: true, data: { items: [] } })
      }
      if (path === "/api/v1/me") {
        if (method === "PATCH" && typeof init?.body === "string") {
          const body = requestBody as {
            preferred_locale?: string
            running_message_action?: "steer" | "queue"
          }
          if (body.preferred_locale && options?.languagePatchFails) {
            return json(
              {
                success: false,
                error_code: "NETWORK_UNAVAILABLE",
                message_key: "errors.networkUnavailable",
              },
              503
            )
          }
          if (
            body.preferred_locale === "zh-CN" ||
            body.preferred_locale === "en-US"
          ) {
            currentLanguage = body.preferred_locale
          }
          if (body.running_message_action)
            currentRunningMessageAction = body.running_message_action
        }
        return json({
          success: true,
          data: {
            ...user,
            ...options?.userOverride,
            language: currentLanguage,
            running_message_action: currentRunningMessageAction,
          },
        })
      }
      if (path === "/api/v1/task-categories" && method === "GET")
        return json({ success: true, data: [] })
      if (path === "/api/v1/conversations/prewarm" && method === "POST") {
        return json(
          {
            success: true,
            data: {
              accepted: true,
              conversation_id: "71000000-0000-4000-8000-000000000001",
            },
          },
          202
        )
      }
      if (path === "/api/v1/conversations/c1/events") {
        if (options?.eventStreamUnavailable) {
          return json(
            {
              success: false,
              error_code: "EVENT_STREAM_UNAVAILABLE",
            },
            503
          )
        }
        return new Response(
          new ReadableStream({
            start(controller) {
              const enqueueEventStreamBody = () => {
                if (options?.eventStreamBody) {
                  controller.enqueue(
                    new TextEncoder().encode(options.eventStreamBody)
                  )
                }
              }
              if (options?.eventStreamStart) {
                return options.eventStreamStart.then(enqueueEventStreamBody)
              }
              enqueueEventStreamBody()
            },
          }),
          {
            status: 200,
            headers: { "Content-Type": "text/event-stream" },
          }
        )
      }
      if (
        /^\/api\/v1\/conversations\/[^/]+\/turns\/[^/]+\/interrupt$/u.test(
          path
        ) &&
        method === "POST"
      ) {
        if (options?.interruptResponse) return options.interruptResponse()
        return json(
          {
            success: true,
            data: { code: "TURN_INTERRUPT_REQUESTED" },
          },
          202
        )
      }
      if (
        /^\/api\/v1\/conversations\/[^/]+\/messages\/[^/]+\/regenerate$/u.test(
          path
        ) &&
        method === "POST"
      ) {
        if (options?.regenerateResponse) return options.regenerateResponse()
        return json(
          {
            success: true,
            data: {
              turn_id: "00000000-0000-4000-8000-000000000099",
              accepted: true,
              status: "starting",
            },
          },
          202
        )
      }
      if (
        /^\/api\/v1\/conversations\/[^/]+\/messages\/[^/]+\/fork$/u.test(
          path
        ) &&
        method === "POST"
      ) {
        if (options?.forkStart) await options.forkStart
        const forkResponse = options?.forkResponse?.()
        if (forkResponse) return forkResponse
        forkCalls += 1
        const forkedConversation = {
          ...conversations[0],
          id: `c${forkCalls + 3}`,
          title: `活动风险评估(${forkCalls + 1})`,
          execution_status: "completed",
          updated_at: new Date().toISOString(),
        }
        currentConversations = [forkedConversation, ...currentConversations]
        return json({ success: true, data: forkedConversation }, 201)
      }
      const conversationEventsMatch = path.match(
        /^\/api\/v1\/conversations\/([^/]+)\/events$/u
      )
      if (conversationEventsMatch) {
        const backgroundStream =
          options?.backgroundEventStreams?.[conversationEventsMatch[1] ?? ""]
        if (backgroundStream) {
          return new Response(
            new ReadableStream({
              start(controller) {
                const enqueue = () =>
                  controller.enqueue(
                    new TextEncoder().encode(backgroundStream.body)
                  )
                return backgroundStream.start
                  ? backgroundStream.start.then(enqueue)
                  : enqueue()
              },
            }),
            {
              status: 200,
              headers: { "Content-Type": "text/event-stream" },
            }
          )
        }
        if (
          conversationEventsMatch[1] === newTaskId &&
          (options?.newTaskEventStreamInitialBody ||
            options?.newTaskEventStreamBody)
        ) {
          return new Response(
            new ReadableStream({
              start(controller) {
                if (options.newTaskEventStreamInitialBody) {
                  controller.enqueue(
                    new TextEncoder().encode(
                      options.newTaskEventStreamInitialBody
                    )
                  )
                }
                const enqueueEventStreamBody = () => {
                  if (!options.newTaskEventStreamBody) return
                  controller.enqueue(
                    new TextEncoder().encode(options.newTaskEventStreamBody)
                  )
                }
                if (
                  options.newTaskEventStreamBody &&
                  options.newTaskEventStreamStart
                ) {
                  return options.newTaskEventStreamStart.then(
                    enqueueEventStreamBody
                  )
                }
                enqueueEventStreamBody()
              },
            }),
            {
              status: 200,
              headers: { "Content-Type": "text/event-stream" },
            }
          )
        }
        return new Response(null, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        })
      }
      if (
        path === "/api/v1/conversations/c1/attachments" &&
        method === "POST"
      ) {
        attachmentUploadCalls += 1
        const formData = init?.body
        if (formData instanceof FormData && options?.attachmentUploadResponse) {
          return options.attachmentUploadResponse(
            formData,
            attachmentUploadCalls
          )
        }
        const file = formData instanceof FormData ? formData.get("file") : null
        return json({
          success: true,
          data: {
            id: `attachment-${attachmentUploadCalls}`,
            name: file instanceof File ? file.name : "attachment",
            kind: "attachment",
            size: file instanceof File ? file.size : 0,
          },
        })
      }
      if (path === "/api/v1/conversations" && method === "POST") {
        await options?.newTaskCreationStart
        return json({ success: true, data: newTaskConversation }, 201)
      }
      if (
        options?.newTaskDetailResponse &&
        path === `/api/v1/conversations/${newTaskId}/turns` &&
        method === "POST"
      ) {
        await options.newTaskTurnStart
        return json(
          {
            success: true,
            data: {
              turn_id: "00000000-0000-4000-8000-000000000002",
              accepted: true,
              status: "starting",
            },
          },
          202
        )
      }
      if (
        options?.newTaskDetailResponse &&
        path === `/api/v1/conversations/${newTaskId}` &&
        method === "GET"
      ) {
        newTaskGetCalls += 1
        return options.newTaskDetailResponse(newTaskGetCalls)
      }
      if (
        options?.newTaskDetailResponse &&
        path === `/api/v1/conversations/${newTaskId}/events`
      ) {
        return new Response(null, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        })
      }
      if (
        /^\/api\/v1\/conversations\/c1\/user-input-requests\/[^/]+\/respond$/u.test(
          path
        ) &&
        method === "POST"
      ) {
        if (options?.userInputResponse) return options.userInputResponse(requestBody)
        return json({ success: true, data: null })
      }
      const planReviewActionMatch = path.match(
        /^\/api\/v1\/conversations\/c1\/plan-reviews\/([^/]+)\/actions$/u
      )
      if (planReviewActionMatch && method === "POST") {
        if (options?.planReviewActionResponse) {
          const reviewId = planReviewActionMatch[1]
          if (!reviewId) {
            return json({ success: false, error_code: "VALIDATION_ERROR" }, 400)
          }
          return options.planReviewActionResponse(reviewId, requestBody)
        }
        return json({ success: false, error_code: "CONFLICT" }, 409)
      }
      const pendingSteerMatch = path.match(
        /^\/api\/v1\/conversations\/c1\/pending-requests\/([^/]+)\/steer$/u
      )
      if (pendingSteerMatch && method === "POST") {
        const currentPendingRequests = pendingRequests ?? []
        pendingRequests = currentPendingRequests.filter(
          (item) =>
            typeof item !== "object" ||
            item === null ||
            item.id !== pendingSteerMatch[1]
        )
        return json({ success: true, data: null })
      }
      if (
        (path === "/api/v1/conversations/c1/turns" ||
          path === "/api/v1/conversations/c1/pending-requests" ||
          path.endsWith("/steer")) &&
        method === "POST"
      ) {
        if (path === "/api/v1/conversations/c1/turns") {
          if (options?.turnStartResponse) {
            return options.turnStartResponse()
          }
          return json(
            {
              success: true,
              data: {
                turn_id: "00000000-0000-4000-8000-000000000001",
                accepted: true,
                status: "starting",
              },
            },
            202
          )
        }
        if (
          path === "/api/v1/conversations/c1/pending-requests" &&
          options?.pendingRequestResponse
        ) {
          return options.pendingRequestResponse(requestBody)
        }
        return json(
          { success: true, data: null },
          path.includes("pending") ? 201 : 202
        )
      }
      const restorePendingMatch = path.match(
        /^\/api\/v1\/conversations\/c1\/pending-requests\/([^/]+)\/restore-input$/u
      )
      if (restorePendingMatch && method === "POST") {
        const currentPendingRequests = pendingRequests ?? []
        const pendingRequest = currentPendingRequests.find(
          (item): item is Record<string, unknown> =>
            typeof item === "object" &&
            item !== null &&
            item.id === restorePendingMatch[1]
        )
        const restoredInput =
          typeof pendingRequest?.input_text === "string"
            ? pendingRequest.input_text
            : ""
        const restoredCapabilityIds = Array.isArray(
          pendingRequest?.priority_capability_ids
        )
          ? pendingRequest.priority_capability_ids.filter(
              (value): value is string => typeof value === "string"
            )
          : []
        const restoredKnowledgeBaseIds = Array.isArray(
          pendingRequest?.knowledge_base_ids
        )
          ? pendingRequest.knowledge_base_ids.filter(
              (value): value is string => typeof value === "string"
            )
          : []
        pendingRequests = currentPendingRequests.filter(
          (item) =>
            typeof item !== "object" ||
            item === null ||
            item.id !== restorePendingMatch[1]
        )
        return json({
          success: true,
          data: {
            pending_request_id: restorePendingMatch[1],
            input_text: restoredInput,
            priority_capability_ids: restoredCapabilityIds,
            knowledge_base_ids: restoredKnowledgeBaseIds,
          },
        })
      }
      if (
        /^\/api\/v1\/conversations\/c1\/pending-requests\/[^/]+$/u.test(path) &&
        method === "DELETE"
      ) {
        const pendingRequestId = path.split("/").at(-1)
        if (pendingRequests && pendingRequestId) {
          pendingRequests = pendingRequests.filter(
            (item) =>
              typeof item !== "object" ||
              item === null ||
              item.id !== pendingRequestId
          )
        }
        return new Response(null, { status: 204 })
      }
      if (path === "/api/v1/conversations/archived" && method === "DELETE") {
        if (options?.clearArchivedResponse) {
          return options.clearArchivedResponse()
        }
        const deletedCount =
          options?.clearArchivedDeletedCount ??
          currentConversations.filter((item) => item.archived).length
        currentConversations = currentConversations.filter(
          (item) => !item.archived
        )
        return json({
          success: true,
          data: { deleted_count: deletedCount },
        })
      }
      if (path === "/api/v1/conversations/order" && method === "PUT") {
        const body = requestBody as {
          group: "pinned" | "recent"
          conversation_ids: string[]
        }
        const sortOrders = new Map(
          body.conversation_ids.map((id, sortOrder) => [id, sortOrder])
        )
        currentConversations = currentConversations.map((item) =>
          sortOrders.has(item.id)
            ? { ...item, sort_order: sortOrders.get(item.id) ?? null }
            : item
        )
        return json({
          success: true,
          data: body,
        })
      }
      if (
        path.startsWith("/api/v1/conversations/") &&
        !path.slice("/api/v1/conversations/".length).includes("/") &&
        method === "PATCH"
      ) {
        const conversationId = path.slice("/api/v1/conversations/".length)
        const body = requestBody as {
          title?: string
          archive_status?: "active" | "archived"
          pinned?: boolean
          completion_read?: true
        }
        if (options?.conversationPatchResponse) {
          return options.conversationPatchResponse(conversationId, body)
        }
        const current = currentConversations.find(
          (item) => item.id === conversationId
        )
        if (!current) {
          return json(
            { success: false, error_code: "CONVERSATION_NOT_FOUND" },
            404
          )
        }
        const next = {
          ...current,
          title: body.title ?? current.title,
          archived:
            body.archive_status === undefined
              ? current.archived
              : body.archive_status === "archived",
          archive_status:
            body.archive_status ?? (current.archived ? "archived" : "active"),
          pinned_at:
            body.archive_status === "archived"
              ? null
              : body.pinned === undefined
                ? current.pinned_at
                : body.pinned
                  ? new Date(
                      Date.parse(current.updated_at) + 1_000
                    ).toISOString()
                  : null,
          sort_order:
            body.archive_status !== undefined || body.pinned !== undefined
              ? null
              : current.sort_order,
          has_unread_completion: body.completion_read
            ? false
            : current.has_unread_completion,
          updated_at: new Date(
            Date.parse(current.updated_at) + 1_000
          ).toISOString(),
        }
        currentConversations = currentConversations.map((item) =>
          item.id === conversationId ? next : item
        )
        return json({ success: true, data: next })
      }
      if (
        path.startsWith("/api/v1/conversations/") &&
        !path.slice("/api/v1/conversations/".length).includes("/") &&
        method === "DELETE"
      ) {
        const conversationId = path.slice("/api/v1/conversations/".length)
        currentConversations = currentConversations.filter(
          (item) => item.id !== conversationId
        )
        return new Response(null, { status: 204 })
      }
      if (path === "/api/v1/conversations/c1") {
        conversationGetCalls += 1
        if (options?.conversationGetResponse) {
          return options.conversationGetResponse(conversationGetCalls)
        }
        const currentConversation =
          currentConversations.find((item) => item.id === "c1") ?? conversation
        return json({
          success: true,
          data: {
            ...conversation,
            ...currentConversation,
            ...options?.conversationOverride,
            ...(pendingRequests ? { pending_requests: pendingRequests } : {}),
          },
        })
      }
      const conversationDetailMatch = path.match(
        /^\/api\/v1\/conversations\/([^/]+)$/u
      )
      if (conversationDetailMatch && method === "GET") {
        const conversationId = conversationDetailMatch[1]
        conversationGetCalls += 1
        if (options?.conversationDetailResponse) {
          return options.conversationDetailResponse(
            conversationId,
            conversationGetCalls
          )
        }
        const currentConversation = currentConversations.find(
          (item) => item.id === conversationId
        )
        if (!currentConversation) {
          return json(
            { success: false, error_code: "CONVERSATION_NOT_FOUND" },
            404
          )
        }
        return json({
          success: true,
          data: {
            ...conversation,
            ...currentConversation,
            messages: [
              {
                id: `${conversationId}-message-1`,
                role: "assistant",
                content: `${currentConversation.title}已加载。`,
              },
            ],
            turns: [],
            running_turn: null,
            draft: {
              ...conversation.draft,
              id: `draft-${conversationId}`,
              conversation_id: conversationId,
            },
          },
        })
      }
      if (path === "/api/v1/conversations/c1/files/artifact-1/download") {
        if (options?.downloadResponse) return options.downloadResponse
        if (method === "GET") {
          return new Response("downloaded-file", {
            status: 200,
            headers: { "Content-Type": "application/octet-stream" },
          })
        }
        return json({
          success: true,
          data: {
            url: "https://files.example.test/report.pdf",
            filename: "report.pdf",
          },
        })
      }
      if (path === "/api/v1/conversations/c1/files/artifact-1/preview") {
        return json({
          success: true,
          data: {
            url: "https://files.example.test/artifact-preview.png",
            expires_at: "2099-07-14T10:49:00.000Z",
            filename: "小狗和可乐.png",
          },
        })
      }
      if (
        path === "/api/v1/conversations/c1/files/artifact-1/content" ||
        path ===
          "/api/v1/conversations/c1/files/70000000-0000-4000-8000-000000000001/content"
      ) {
        return new Response(new Uint8Array([0x50, 0x4b, 0x03, 0x04]), {
          status: 200,
          headers: {
            "Content-Type":
              "application/vnd.openxmlformats-officedocument.presentationml.presentation",
          },
        })
      }
      if (
        path === "/api/v1/conversations/c1/attachments/draft-image-1/content"
      ) {
        return new Response("image-bytes", {
          status: 200,
          headers: { "Content-Type": "image/png" },
        })
      }
      if (
        path ===
        "/api/v1/conversations/c1/attachments/attachment-sheet-1/content"
      ) {
        return new Response(new Uint8Array([0x50, 0x4b, 0x03, 0x04]), {
          status: 200,
          headers: {
            "Content-Type":
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          },
        })
      }
      if (path === "/api/v1/conversations") {
        if (options?.conversationListResponse) {
          return options.conversationListResponse(url.searchParams, {
            forkCalls,
          })
        }
        const archived = url.searchParams.get("archived") === "true"
        const items = currentConversations.filter(
          (item) => item.archived === archived
        )
        return json({
          success: true,
          data: {
            items,
            next_cursor: null,
            total_count: items.length,
          },
        })
      }
      if (path === "/api/v1/knowledge-bases" && method === "GET") {
        return json({
          success: true,
          data: {
            items: options?.knowledgeBasesOverride ?? [],
            next_cursor: null,
          },
        })
      }
      if (path === "/api/v1/capabilities") {
        if (method === "POST") {
          return capabilityPreviewResponse()
        }
        if (url.searchParams.get("view") === "managed") {
          return json({
            success: true,
            data: {
              items:
                options?.capabilitiesOverride ?? personalManagedCapabilities,
              next_cursor: null,
            },
          })
        }
        return json({
          success: true,
          data: {
            items:
              options?.capabilitiesOverride ?? personalAvailableCapabilities,
            next_cursor: null,
          },
        })
      }
      if (
        path === "/api/v1/capabilities/s1/skill-content" &&
        method === "GET"
      ) {
        return json({
          success: true,
          data: {
            content: "# 报告结构\n\n请先汇总数据。",
          },
        })
      }
      if (
        path ===
        "/api/v1/capabilities/imports/00000000-0000-4000-8000-000000000099/confirm"
      ) {
        return json(
          {
            success: true,
            data: {
              ...(options?.capabilityConfirmOverride ?? {
                ...capabilities[1],
                id: "s2",
                name: "运营报告",
                slug: "operations-report",
              }),
            },
          },
          201
        )
      }
      if (path === "/api/v1/credentials/bindings") {
        return json({ success: true, data: { items: [], next_cursor: null } })
      }
      if (path === "/api/v1/credentials/plugin-configurations") {
        return json({ success: true, data: { items: [] } })
      }
      if (path === "/api/v1/credentials") {
        if (method === "POST") {
          const body = requestBody as {
            name: string
            provider_type: string
          }
          return json(
            {
              success: true,
              data: {
                id: "credential-1",
                name: body.name,
                provider_type: body.provider_type,
                status: "active",
                last_used_at: null,
                created_at: "2026-07-19T00:00:00.000Z",
                updated_at: "2026-07-19T00:00:00.000Z",
              },
            },
            201
          )
        }
        return json({ success: true, data: { items: [], next_cursor: null } })
      }
      if (path === "/api/v1/admin/users/credit-limits" && method === "PATCH") {
        const body = requestBody as {
          user_ids: string[]
          total_credit_limit?: string | null
          weekly_credit_limit?: string | null
          monthly_credit_limit?: string | null
        }
        const { user_ids: targetUserIds, ...creditLimits } = body
        managedUsers = managedUsers.map((candidate) =>
          targetUserIds.includes(candidate.id)
            ? { ...candidate, ...creditLimits }
            : candidate
        )
        return json({
          success: true,
          data: {
            items: managedUsers.filter((candidate) =>
              targetUserIds.includes(candidate.id)
            ),
            next_cursor: null,
          },
        })
      }
      if (path.startsWith("/api/v1/admin/users/") && method === "PATCH") {
        const managedUserId = path.split("/").at(-1)
        const managedUser =
          managedUsers.find((candidate) => candidate.id === managedUserId) ??
          managedUsers[0] ??
          user
        const updatedUser = {
          ...managedUser,
          ...(requestBody as Record<string, unknown>),
        }
        managedUsers = managedUsers.map((candidate) =>
          candidate.id === managedUserId ? updatedUser : candidate
        )
        return json({
          success: true,
          data: updatedUser,
        })
      }
      if (
        path === "/api/v1/admin/users/import-template.xlsx" &&
        method === "GET"
      ) {
        return new Response(new Uint8Array([80, 75, 3, 4]), {
          status: 200,
          headers: {
            "content-type":
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          },
        })
      }
      if (path === "/api/v1/admin/users/import" && method === "POST") {
        return json({
          success: true,
          data: {
            imported_count: 2,
            skipped_count: 0,
            errors: [],
          },
        })
      }
      if (path === "/api/v1/admin/users") {
        const userGroupId = url.searchParams.get("user_group_id")
        const registrationSource = url.searchParams.get("registration_source")
        const creditQuotaRemainingZero = url.searchParams.get(
          "credit_quota_remaining_zero"
        )
        const usersForGroup = userGroupId
          ? managedUsers.filter((managedUser) =>
              managedUser.user_group_ids.includes(userGroupId)
            )
          : managedUsers
        const usersForRegistrationSource = registrationSource
          ? usersForGroup.filter(
              (managedUser) =>
                managedUser.registration_source === registrationSource
            )
          : usersForGroup
        const filteredUsers =
          creditQuotaRemainingZero === "total" ||
          creditQuotaRemainingZero === "weekly" ||
          creditQuotaRemainingZero === "monthly"
            ? usersForRegistrationSource.filter(
                (managedUser) =>
                  managedUser.credit_quota?.[creditQuotaRemainingZero]
                    ?.remaining_percentage === 0
              )
            : usersForRegistrationSource
        return json({
          success: true,
          data: {
            items: filteredUsers,
            next_cursor: null,
          },
        })
      }
      if (path === "/api/v1/admin/users/role-summary") {
        return json({
          success: true,
          data: {
            items: options?.roleSummaryOverride ?? [
              {
                role: "user",
                active_count: 12,
                disabled_count: 2,
                total_count: 14,
              },
              {
                role: "admin",
                active_count: 3,
                disabled_count: 0,
                total_count: 3,
              },
            ],
          },
        })
      }
      if (path === "/api/v1/admin/model-provider-settings") {
        return json({
          success: true,
          data: {
            configured: true,
            revision: 2,
            providers: [
              {
                id: "provider-a",
                name: "Primary channel",
                provider: "openai",
                provider_project: null,
                provider_location: null,
                base_url: "https://models.example.test/v1",
                protocol_mode: "native_responses",
                api_key_configured: true,
                models: [
                  {
                    id: "model-a",
                    display_name: "Model A",
                    enabled: true,
                    kind: "chat",
                    input_price_per_million: "0",
                    cached_input_price_per_million: "0",
                    output_price_per_million: "0",
                    supports_image_input: false,
                    context_window: null,
                    supported_reasoning_efforts: ["medium", "high"],
                    default_reasoning_effort: "medium",
                  },
                ],
              },
            ],
            default_model: "model-a",
          },
        })
      }
      if (path === "/api/v1/admin/image-understanding-settings") {
        return json({
          success: true,
          data: {
            configured: false,
            enabled: false,
            revision: 0,
            provider: null,
            base_url: null,
            api_key_configured: false,
            model: null,
            project: null,
            location: null,
            thinking_policy: "disabled_required",
            thinking_strategy: null,
          },
        })
      }
      if (
        path.startsWith("/api/v1/admin/user-groups/") &&
        method === "DELETE"
      ) {
        const groupId = path.slice("/api/v1/admin/user-groups/".length)
        userGroups = userGroups.filter((group) => group.id !== groupId)
        return new Response(null, { status: 204 })
      }
      if (path === "/api/v1/admin/user-groups") {
        return json({
          success: true,
          data: { items: userGroups, next_cursor: null },
        })
      }
      return json({ success: true, data: null })
    }
  )
  vi.stubGlobal("fetch", fetchMock)
  return { fetchMock, requests }
}

function renderApp(route = "/conversations/c1") {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <AppProviders>
        <App />
      </AppProviders>
    </MemoryRouter>
  )
}

async function chooseSelectOption(
  interaction: ReturnType<typeof userEvent.setup>,
  label: string,
  option: string
) {
  await interaction.click(screen.getByRole("combobox", { name: label }))
  await interaction.click(await screen.findByRole("option", { name: option }))
}

export {
  authenticationSession,
  capabilities,
  capabilityPreviewResponse,
  chooseSelectOption,
  conversation,
  conversations,
  installApiMock,
  json,
  originalCreateObjectUrl,
  originalRevokeObjectUrl,
  personalAvailableCapabilities,
  personalManagedCapabilities,
  personalUsageProfile,
  planReviewConversationFixture,
  planReviewFixtureIds,
  renderApp,
  restoreUrlMethod,
  seedLocalDraft,
  user,
}

export function setupApplicationTests() {
  beforeAll(async () => {
    // Load real lazy routes before assertions so each domain is independent of
    // whichever application test happened to warm the module graph first.
    await import("@/pages/conversation-pages")
  })

  beforeEach(async () => {
    setAccessToken(null)
    window.localStorage.clear()
    window.sessionStorage.clear()
    document.documentElement.classList.remove("dark")
    delete document.documentElement.dataset.theme
    delete document.documentElement.dataset.themePreference
    delete document.documentElement.dataset.uiFontSize
    document.documentElement.style.removeProperty("--app-ui-font-size")
    document.documentElement.style.colorScheme = ""
    await i18n.changeLanguage("zh-CN")
  })

  afterEach(() => {
    cleanup()
    clearConversationAttachmentPreviewCacheForTests()
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    restoreUrlMethod("createObjectURL", originalCreateObjectUrl)
    restoreUrlMethod("revokeObjectURL", originalRevokeObjectUrl)
    window.history.replaceState(null, "", "/")
  })
}
