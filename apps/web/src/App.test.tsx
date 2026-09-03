import { StrictMode, type ReactNode } from "react"
import {
  act,
  cleanup,
  createEvent,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { MemoryRouter } from "react-router-dom"

import App from "@/App"
import type { UserGroup } from "@/api/contracts"
import { setAccessToken } from "@/api/session"
import { AppProviders } from "@/app/providers"
import { clearConversationAttachmentPreviewCacheForTests } from "@/features/conversations/conversation-attachment-preview-cache"
import i18n from "@/i18n"
import { formatRelativeDate } from "@/i18n/date"
import { stableOperationId } from "@/features/conversations/operation-id"
import { nativeReconnectStorageKeyPrefix } from "@/features/conversations/native-reconnect-simulation"

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

vi.mock(
  "@/components/media/presentation-preview/presentation-preview",
  async () => {
    const React = await import("react")

    function MockPresentationPreview({
      document,
      annotationControls,
      selectionAction,
      onDownload,
      floatingContent,
    }: Readonly<{
      document: { status: "loading" | "error" | "ready" }
      annotationControls?: ReactNode
      onDownload?: () => void
      floatingContent?: ReactNode
      selectionAction?: {
        label: string
        promptLabel: string
        placeholder: string
        submitLabel: string
        onSubmit: (
          selection: {
            slideIndex: number
            slideNumber: number
            elementIds: string[]
            elements: Array<{
              elementId: string
              type: string
              text: string
              bounds: {
                x: number
                y: number
                width: number
                height: number
              }
            }>
          },
          description: string
        ) => Promise<void>
      }
    }>) {
      const [promptOpen, setPromptOpen] = React.useState(false)
      const [description, setDescription] = React.useState("")
      if (document.status !== "ready") {
        return React.createElement("div", null, document.status)
      }
      return React.createElement(
        React.Fragment,
        null,
        annotationControls,
        selectionAction
          ? React.createElement(
              "button",
              {
                type: "button",
                onClick: () => setPromptOpen(true),
              },
              selectionAction.label
            )
          : React.createElement("span", null, "模拟选中"),
        onDownload
          ? React.createElement(
              "button",
              {
                type: "button",
                onClick: onDownload,
              },
              "下载预览文档"
            )
          : null,
        promptOpen && selectionAction
          ? React.createElement(
              "form",
              {
                "aria-label": selectionAction.promptLabel,
                onSubmit: (event: React.FormEvent) => {
                  event.preventDefault()
                  const nextDescription = description.trim()
                  if (!nextDescription) return
                  setPromptOpen(false)
                  void selectionAction
                    .onSubmit(
                      {
                        slideIndex: 2,
                        slideNumber: 3,
                        elementIds: ["title-1"],
                        elements: [
                          {
                            elementId: "title-1",
                            type: "text",
                            text: "人工智能连接数据、算法与人类目标",
                            bounds: {
                              x: 120,
                              y: 80,
                              width: 520,
                              height: 90,
                            },
                          },
                        ],
                      },
                      nextDescription
                    )
                    .catch(() => {
                      setDescription(nextDescription)
                      setPromptOpen(true)
                    })
                },
              },
              React.createElement("input", {
                "aria-label": selectionAction.promptLabel,
                placeholder: selectionAction.placeholder,
                value: description,
                onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
                  setDescription(event.target.value),
              }),
              React.createElement(
                "button",
                {
                  type: "submit",
                  disabled: description.trim().length === 0,
                },
                selectionAction.submitLabel
              )
            )
          : null,
        floatingContent
      )
    }

    return {
      default: MockPresentationPreview,
      PresentationPreview: MockPresentationPreview,
    }
  }
)

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
  total_token_limit: null as string | null,
  weekly_token_limit: null as string | null,
  monthly_token_limit: null as string | null,
  token_quota: null as null | {
    total: {
      limit_tokens: string
      used_tokens: string
      remaining_tokens: string
      remaining_percentage: number
    } | null
    weekly: {
      limit_tokens: string
      used_tokens: string
      remaining_tokens: string
      remaining_percentage: number
      reset_at: string
    } | null
    monthly: {
      limit_tokens: string
      used_tokens: string
      remaining_tokens: string
      remaining_percentage: number
      reset_at: string
    } | null
  },
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

function knowledgeBaseFixture(id: string, name: string) {
  return {
    id,
    name,
    description: "用于验证连续对话中的知识库选择",
    lifecycle_status: "active",
    availability_status: "enabled",
    owner: {
      id: "10000000-0000-4000-8000-000000000002",
      name: "管理员",
    },
    is_owner: true,
    access_sources: [{ type: "owner" }],
    document_count: 1,
    ready_document_count: 1,
    storage_used_bytes: 1_024,
    storage_reserved_bytes: 0,
    storage_quota_bytes: 10_240,
    permissions: {
      view_content: true,
      update: true,
      manage_documents: true,
      manage_grants: true,
      create_grants: true,
      revoke_grants: true,
      archive: true,
      restore: false,
      delete: false,
      remove_direct_share: false,
    },
    archived_at: null,
    disabled_reason: null,
    created_at: "2026-07-11T08:00:00.000Z",
    updated_at: "2026-07-11T08:00:00.000Z",
  }
}

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

type PlanReviewFixtureDecision = "implement" | "revise" | "skip" | "exit" | null

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
  newTaskDraftStart?: Promise<void>
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
  downloadResponse?: Promise<Response>
  attachmentUploadResponse?: (
    formData: FormData,
    callIndex: number
  ) => Response | Promise<Response>
  draftPutResponse?: (body: unknown, callIndex: number) => Promise<Response>
  turnStartResponse?: () => Promise<Response>
  pendingRequestResponse?: (body: unknown) => Response | Promise<Response>
  interruptResponse?: () => Response | Promise<Response>
  regenerateResponse?: () => Response | Promise<Response>
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
  let draftInput = String(options?.conversationOverride?.draft_input ?? "")
  let draftCapabilityIds: string[] = Array.isArray(
    options?.conversationOverride?.draft_capability_ids
  )
    ? options.conversationOverride.draft_capability_ids.filter(
        (value): value is string => typeof value === "string"
      )
    : []
  let draftKnowledgeBaseIds: string[] = Array.isArray(
    options?.conversationOverride?.draft_knowledge_base_ids
  )
    ? options.conversationOverride.draft_knowledge_base_ids.filter(
        (value): value is string => typeof value === "string"
      )
    : Array.isArray(options?.conversationOverride?.selected_knowledge_base_ids)
      ? options.conversationOverride.selected_knowledge_base_ids.filter(
          (value): value is string => typeof value === "string"
        )
      : []
  let draftUpdatedAt = "2026-07-11T08:00:00.000Z"
  let pendingRequests = Array.isArray(
    options?.conversationOverride?.pending_requests
  )
    ? [...options.conversationOverride.pending_requests]
    : null
  let draftPutCalls = 0
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
          data: { items: [], next_cursor: "token-quota-refresh-cursor" },
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
      if (path === "/api/v1/conversations/prewarm" && method === "POST") {
        return json({ success: true, data: { accepted: true } }, 202)
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
      if (path === "/api/v1/conversations/c1/draft" && method === "PUT") {
        draftPutCalls += 1
        const body = requestBody as {
          input_text?: string
          priority_capability_ids?: string[]
          knowledge_base_ids?: string[]
        }
        if (options?.draftPutResponse) {
          const response = await options.draftPutResponse(
            requestBody,
            draftPutCalls
          )
          if (response.ok) {
            draftInput = body.input_text ?? ""
            draftCapabilityIds = body.priority_capability_ids ?? []
            draftKnowledgeBaseIds = body.knowledge_base_ids ?? []
            const payload = (await response.clone().json()) as {
              data?: { updated_at?: unknown }
            }
            draftUpdatedAt =
              typeof payload.data?.updated_at === "string"
                ? payload.data.updated_at
                : "2026-07-11T08:00:01.000Z"
          }
          return response
        }
        draftInput = body.input_text ?? ""
        draftCapabilityIds = body.priority_capability_ids ?? []
        draftKnowledgeBaseIds = body.knowledge_base_ids ?? []
        draftUpdatedAt = new Date(
          Date.parse(draftUpdatedAt) + 1_000
        ).toISOString()
        return json({
          success: true,
          data: {
            ...conversation.draft,
            input_text: draftInput,
            priority_capability_ids: draftCapabilityIds,
            knowledge_base_ids: draftKnowledgeBaseIds,
            updated_at: draftUpdatedAt,
          },
        })
      }
      if (
        options?.newTaskDetailResponse &&
        path === "/api/v1/conversations/drafts" &&
        method === "POST"
      ) {
        await options.newTaskDraftStart
        return json({ success: true, data: newTaskConversation }, 201)
      }
      if (
        options?.newTaskDetailResponse &&
        path === `/api/v1/conversations/${newTaskId}/draft` &&
        method === "PUT"
      ) {
        const body = requestBody as {
          input_text?: string
          priority_capability_ids?: string[]
        }
        return json({
          success: true,
          data: {
            id: "draft-new-task-1",
            conversation_id: newTaskId,
            input_text: body.input_text ?? "",
            priority_capability_ids: body.priority_capability_ids ?? [],
            updated_at: "2026-07-18T08:00:01.000Z",
          },
        })
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
        const preservesDraft =
          (requestBody as { draft_policy?: string } | undefined)
            ?.draft_policy === "preserve"
        if (!preservesDraft) {
          draftInput = ""
          draftCapabilityIds = []
          draftUpdatedAt = new Date(
            Date.parse(draftUpdatedAt) + 1_000
          ).toISOString()
        }
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
        /^\/api\/v1\/conversations\/c1\/pending-requests\/([^/]+)\/restore-draft$/u
      )
      if (restorePendingMatch && method === "POST") {
        const currentPendingRequests = pendingRequests ?? []
        const pendingRequest = currentPendingRequests.find(
          (item): item is Record<string, unknown> =>
            typeof item === "object" &&
            item !== null &&
            item.id === restorePendingMatch[1]
        )
        draftInput =
          typeof pendingRequest?.input_text === "string"
            ? pendingRequest.input_text
            : ""
        draftCapabilityIds = Array.isArray(
          pendingRequest?.priority_capability_ids
        )
          ? pendingRequest.priority_capability_ids.filter(
              (value): value is string => typeof value === "string"
            )
          : []
        draftUpdatedAt = new Date(
          Date.parse(draftUpdatedAt) + 1_000
        ).toISOString()
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
            draft: {
              ...conversation.draft,
              input_text: draftInput,
              priority_capability_ids: draftCapabilityIds,
              updated_at: draftUpdatedAt,
            },
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
            draft_input: draftInput,
            draft_capability_ids: draftCapabilityIds,
            draft_knowledge_base_ids: draftKnowledgeBaseIds,
            selected_knowledge_base_ids: draftKnowledgeBaseIds,
            draft: {
              ...conversation.draft,
              input_text: draftInput,
              priority_capability_ids: draftCapabilityIds,
              knowledge_base_ids: draftKnowledgeBaseIds,
              updated_at: draftUpdatedAt,
            },
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
      if (path === "/api/v1/credentials/effective-bindings") {
        return json({
          success: true,
          data: {
            items: [
              {
                capability_id: "p1",
                env_key: "SERVICE_API_KEY",
                effective_source: "personal",
              },
            ],
            next_cursor: null,
          },
        })
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
      if (path === "/api/v1/admin/users/token-limits" && method === "PATCH") {
        const body = requestBody as {
          user_ids: string[]
          total_token_limit?: string | null
          weekly_token_limit?: string | null
          monthly_token_limit?: string | null
        }
        const { user_ids: targetUserIds, ...tokenLimits } = body
        managedUsers = managedUsers.map((candidate) =>
          targetUserIds.includes(candidate.id)
            ? { ...candidate, ...tokenLimits }
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
        const tokenQuotaRemainingZero = url.searchParams.get(
          "token_quota_remaining_zero"
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
          tokenQuotaRemainingZero === "total" ||
          tokenQuotaRemainingZero === "weekly" ||
          tokenQuotaRemainingZero === "monthly"
            ? usersForRegistrationSource.filter(
                (managedUser) =>
                  managedUser.token_quota?.[tokenQuotaRemainingZero]
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

describe("LinkSense application", () => {
  it("redirects the removed conversations list path to a new task", async () => {
    installApiMock()
    renderApp("/conversations")

    expect(
      await screen.findByRole(
        "form",
        { name: "任务输入框" },
        { timeout: 15_000 }
      )
    ).toBeVisible()
    expect(
      screen.getByRole("heading", {
        name: "我们一起在 LinkSense 中做些什么？",
      })
    ).toBeVisible()
    expect(
      screen.queryByText("页面不存在。", { exact: true })
    ).not.toBeInTheDocument()
  }, 20_000)

  it.each([
    { status: 404, errorCode: "CONVERSATION_NOT_FOUND" },
    { status: 403, errorCode: "ACCESS_DENIED" },
  ])(
    "repairs a stale task route after a $status detail response",
    async ({ status, errorCode }) => {
      const staleConversationId = "stale-conversation"
      const { requests } = installApiMock({
        conversationDetailResponse: async (conversationId) =>
          conversationId === staleConversationId
            ? json({ success: false, error_code: errorCode }, status)
            : json({ success: true, data: conversation }),
      })

      renderApp(`/conversations/${staleConversationId}`)

      expect(
        await screen.findByRole(
          "form",
          { name: "任务输入框" },
          { timeout: 2_000 }
        )
      ).toBeVisible()
      expect(
        screen.getByRole("heading", {
          name: "我们一起在 LinkSense 中做些什么？",
        })
      ).toBeVisible()
      expect(
        screen.queryByText("请求的资源不存在或你无权访问。")
      ).not.toBeInTheDocument()
      expect(
        requests.filter(
          (request) =>
            request.path === `/api/v1/conversations/${staleConversationId}` &&
            request.method === "GET"
        )
      ).toHaveLength(1)
    }
  )

  it("fills and focuses the Composer without sending when a starter question is selected", async () => {
    const { requests } = installApiMock()
    const interaction = userEvent.setup()
    renderApp("/conversations/new")

    const composer = await screen.findByRole("textbox", { name: "任务输入框" })
    await interaction.click(
      screen.getByRole("button", { name: /分析一份文件/u })
    )

    expect(composer).toHaveValue(
      "请分析我上传的文件，提炼核心结论、关键风险和待办事项，并按重要程度整理。"
    )
    expect(composer).toHaveFocus()
    expect(
      requests.some(
        (request) => request.method === "POST" && /\/turns$/u.test(request.path)
      )
    ).toBe(false)
  })

  it("keeps one centered loading state while an existing task loads", async () => {
    let releaseConversation: ((response: Response) => void) | undefined
    const pendingConversation = new Promise<Response>((resolve) => {
      releaseConversation = resolve
    })
    const { requests } = installApiMock({
      conversationGetResponse: (callIndex) =>
        callIndex === 1
          ? pendingConversation
          : Promise.resolve(json({ success: true, data: conversation })),
    })

    renderApp()

    await waitFor(() =>
      expect(requests).toContainEqual(
        expect.objectContaining({
          path: "/api/v1/conversations/c1",
          method: "GET",
        })
      )
    )

    const loadingStates = document.querySelectorAll(".page-state-loading")
    expect(loadingStates).toHaveLength(1)
    expect(loadingStates[0]).not.toHaveClass("page-state-loading-fullscreen")
    expect(loadingStates[0]).toHaveTextContent("正在加载")
    expect(
      screen.getByRole("complementary", { name: "LinkSense 导航" })
    ).toBeVisible()

    releaseConversation?.(
      json({
        success: true,
        data: conversation,
      })
    )

    expect(
      await screen.findByRole("form", { name: "任务输入框" })
    ).toBeVisible()
  })

  it("keeps the navigation shell mounted while switching between existing tasks", async () => {
    const interaction = userEvent.setup()
    let releaseConversation: ((response: Response) => void) | undefined
    const pendingConversation = new Promise<Response>((resolve) => {
      releaseConversation = resolve
    })
    const { requests } = installApiMock({
      conversationDetailResponse: (conversationId) =>
        conversationId === "c2"
          ? pendingConversation
          : Promise.resolve(json({ success: true, data: conversation })),
    })

    renderApp()

    const sidebar = await screen.findByRole("complementary", {
      name: "LinkSense 导航",
    })
    await screen.findByRole("form", { name: "任务输入框" })
    expect(await screen.findByText("任务概览")).toBeVisible()
    await interaction.click(
      within(screen.getByRole("banner")).getByRole("button", {
        name: "关闭任务概览",
      })
    )
    expect(screen.queryByText("任务概览")).not.toBeInTheDocument()

    await interaction.click(
      within(sidebar).getByRole("button", { name: "整理项目会议纪要" })
    )

    await waitFor(() =>
      expect(requests).toContainEqual(
        expect.objectContaining({
          path: "/api/v1/conversations/c2",
          method: "GET",
        })
      )
    )

    expect(sidebar).toBeVisible()
    expect(document.querySelector(".page-state-loading-fullscreen")).toBeNull()
    const loadingWorkspace = document.querySelector(
      ".conversation-workspace-loading"
    )
    expect(loadingWorkspace).toBeInTheDocument()
    expect(
      loadingWorkspace?.querySelector(".page-state-loading")
    ).toBeInTheDocument()

    releaseConversation?.(
      json({
        success: true,
        data: {
          ...conversation,
          ...conversations[1],
          messages: [
            {
              id: "c2-message-1",
              role: "assistant",
              content: "会议纪要已加载。",
            },
          ],
          turns: [],
          running_turn: null,
          draft: {
            ...conversation.draft,
            id: "draft-c2",
            conversation_id: "c2",
          },
        },
      })
    )

    expect(
      await screen.findByText("会议纪要已加载。", { exact: true })
    ).toBeVisible()
    expect(screen.queryByText("任务概览")).not.toBeInTheDocument()
    expect(
      within(screen.getByRole("banner")).getByRole("button", {
        name: "打开任务概览",
      })
    ).toBeVisible()
    await interaction.click(
      within(screen.getByRole("banner")).getByRole("button", {
        name: "打开任务概览",
      })
    )
    expect(await screen.findByText("任务概览")).toBeVisible()
  })

  it("hides the empty-task message while a new task's first message is loading", async () => {
    let releaseNewTaskDetail: (() => void) | undefined
    const newTaskDetailReady = new Promise<void>((resolve) => {
      releaseNewTaskDetail = resolve
    })
    const { requests } = installApiMock({
      newTaskDetailResponse: async () => {
        await newTaskDetailReady
        return json({
          success: true,
          data: {
            id: "new-task-1",
            title: "未命名任务",
            archived: false,
            updated_at: "2026-07-18T08:00:02.000Z",
            draft_input: "",
            draft_capability_ids: [],
            messages: [
              {
                id: "new-task-message-1",
                role: "user",
                turn_id: "00000000-0000-4000-8000-000000000002",
                content: "生成一段欢迎语音",
              },
            ],
            attachments: [],
            artifacts: [],
            turns: [
              {
                id: "00000000-0000-4000-8000-000000000002",
                status: "running",
              },
            ],
            running_turn: {
              id: "00000000-0000-4000-8000-000000000002",
              status: "running",
            },
            pending_requests: [],
          },
        })
      },
    })
    const interaction = userEvent.setup()
    renderApp("/conversations/new")

    await interaction.type(
      await screen.findByRole("textbox", { name: "任务输入框" }),
      "生成一段欢迎语音"
    )
    await interaction.keyboard("{Enter}")

    await waitFor(() =>
      expect(requests).toContainEqual(
        expect.objectContaining({
          path: "/api/v1/conversations/new-task-1/turns",
          method: "POST",
        })
      )
    )
    expect(
      screen.queryByText("还没有任务。可以直接从输入框开始。")
    ).not.toBeInTheDocument()

    releaseNewTaskDetail?.()

    await waitFor(() =>
      expect(
        document.getElementById("conversation-message-new-task-message-1")
      ).toHaveTextContent("生成一段欢迎语音")
    )
  })

  it("shows a new task loading indicator before task creation finishes", async () => {
    let releaseNewTaskDraft: (() => void) | undefined
    const newTaskDraftStart = new Promise<void>((resolve) => {
      releaseNewTaskDraft = resolve
    })
    let releaseNewTaskTurn: (() => void) | undefined
    const newTaskTurnStart = new Promise<void>((resolve) => {
      releaseNewTaskTurn = resolve
    })
    const { requests } = installApiMock({
      newTaskDraftStart,
      newTaskTurnStart,
      conversationListResponse: () =>
        json({
          success: true,
          data: {
            items: conversations.map((item) => ({
              ...item,
              execution_status: "completed",
            })),
            next_cursor: null,
            total_count: conversations.length,
          },
        }),
      newTaskDetailResponse: async () =>
        json({
          success: true,
          data: {
            ...conversation,
            id: "new-task-1",
            title: "未命名任务",
            execution_status: "running",
            messages: [],
            turns: [
              {
                id: "00000000-0000-4000-8000-000000000002",
                status: "running",
              },
            ],
            running_turn: {
              id: "00000000-0000-4000-8000-000000000002",
              status: "running",
            },
          },
        }),
    })
    const interaction = userEvent.setup()
    renderApp("/conversations/new")

    const sidebar = await screen.findByRole(
      "complementary",
      { name: "LinkSense 导航" },
      { timeout: 5_000 }
    )
    await interaction.type(
      screen.getByRole("textbox", { name: "任务输入框" }),
      "生成一段欢迎语音"
    )
    await interaction.click(screen.getByRole("button", { name: "发送" }))

    const title = within(sidebar).getByText("未命名任务")
    const item = title.closest(".sidebar-conversation-item")
    expect(item).not.toBeNull()
    expect(
      within(item as HTMLElement).getByRole("status", { name: "执行中" })
    ).toBeVisible()
    expect(title.closest("a")).toHaveAttribute("aria-busy", "true")
    expect(
      requests.some(
        (request) =>
          request.path === "/api/v1/conversations/new-task-1/turns" &&
          request.method === "POST"
      )
    ).toBe(false)

    releaseNewTaskDraft?.()
    await waitFor(() =>
      expect(
        requests.some(
          (request) =>
            request.path === "/api/v1/conversations/new-task-1/turns" &&
            request.method === "POST"
        )
      ).toBe(true)
    )
    const detailRequestCountBeforeAdmission = requests.filter(
      (request) =>
        request.path === "/api/v1/conversations/new-task-1" &&
        request.method === "GET"
    ).length
    await act(async () => {
      releaseNewTaskTurn?.()
      await newTaskTurnStart
    })
    await waitFor(() =>
      expect(
        requests.filter(
          (request) =>
            request.path === "/api/v1/conversations/new-task-1" &&
            request.method === "GET"
        ).length
      ).toBeGreaterThan(detailRequestCountBeforeAdmission)
    )
    await act(
      () => new Promise<void>((resolve) => window.setTimeout(resolve, 50))
    )

    const persistedTitle = within(sidebar).getByText("未命名任务")
    const persistedItem = persistedTitle.closest(".sidebar-conversation-item")
    expect(persistedItem).not.toBeNull()
    expect(
      within(persistedItem as HTMLElement).getByRole("status", {
        name: "执行中",
      })
    ).toBeVisible()
    expect(persistedTitle.closest("a")).toHaveAttribute("aria-busy", "true")
  })

  it("keeps the task workspace and composer mounted when the first message creates the task", async () => {
    let releaseNewTaskDraft!: () => void
    const newTaskDraftStart = new Promise<void>((resolve) => {
      releaseNewTaskDraft = resolve
    })
    let releaseNewTaskTurn!: () => void
    const newTaskTurnStart = new Promise<void>((resolve) => {
      releaseNewTaskTurn = resolve
    })
    let releaseNewTaskModelPreference!: () => void
    const newTaskModelPreferenceStart = new Promise<void>((resolve) => {
      releaseNewTaskModelPreference = resolve
    })
    let releaseStaleNewTaskDetail!: () => void
    const staleNewTaskDetailStart = new Promise<void>((resolve) => {
      releaseStaleNewTaskDetail = resolve
    })
    let releaseHydratedNewTaskDetail!: () => void
    const hydratedNewTaskDetailStart = new Promise<void>((resolve) => {
      releaseHydratedNewTaskDetail = resolve
    })
    let resolveStaleNewTaskDetailSettled!: () => void
    const staleNewTaskDetailSettled = new Promise<void>((resolve) => {
      resolveStaleNewTaskDetailSettled = resolve
    })
    let releaseDelayedNewTaskEvent!: () => void
    const newTaskEventStreamStart = new Promise<void>((resolve) => {
      releaseDelayedNewTaskEvent = resolve
    })
    const projectedTurnId = "00000000-0000-4000-8000-000000000002"
    const turnStartedEventId = "new-task-1:2"
    const generatedTitle = "页面闪烁排查"
    const titleEventId = "new-task-1:3"
    const { requests } = installApiMock({
      newTaskDraftStart,
      newTaskTurnStart,
      newTaskModelPreferenceStart,
      newTaskEventStreamStart,
      newTaskEventStreamInitialBody: `id: ${turnStartedEventId}\nevent: turn/started\ndata: ${JSON.stringify(
        {
          id: "60000000-0000-4000-8000-000000000002",
          conversation_id: "20000000-0000-4000-8000-000000000001",
          turn_id: projectedTurnId,
          sequence_no: 2,
          event_type: "turn/started",
          visibility: "user_visible",
          payload: {
            schema_version: 2,
            source: "codex_app_server",
            method: "turn/started",
            params: {
              threadId: "native-thread-new-task-1",
              turn: {
                id: "native-turn-new-task-1",
                status: "inProgress",
              },
            },
          },
          sse_event_id: turnStartedEventId,
          created_at: "2026-07-18T08:00:02.000Z",
        }
      )}\n\n`,
      newTaskEventStreamBody: `id: ${titleEventId}\nevent: conversation.title.updated\ndata: ${JSON.stringify(
        {
          id: "60000000-0000-4000-8000-000000000003",
          conversation_id: "20000000-0000-4000-8000-000000000001",
          turn_id: null,
          sequence_no: 3,
          event_type: "conversation.title.updated",
          visibility: "user_visible",
          payload: { schema_version: 1, title: generatedTitle },
          sse_event_id: titleEventId,
          created_at: "2026-07-18T08:00:03.000Z",
        }
      )}\n\n`,
      modelPreferenceByConversation: { "new-task-1": "model-a" },
      newTaskDetailResponse: async (callIndex) => {
        const hydrated = callIndex > 1
        if (!hydrated) await staleNewTaskDetailStart
        if (hydrated) await hydratedNewTaskDetailStart
        const response = json({
          success: true,
          data: {
            id: "new-task-1",
            title: callIndex > 2 ? generatedTitle : "未命名任务",
            archived: false,
            updated_at: "2026-07-18T08:00:02.000Z",
            draft_input: "",
            draft_capability_ids: [],
            messages: hydrated
              ? [
                  {
                    id: "new-task-message-1",
                    role: "user",
                    turn_id: projectedTurnId,
                    content: "排查页面闪烁",
                    created_at: "2026-07-18T08:00:02.000Z",
                  },
                ]
              : [],
            attachments: [],
            artifacts: [],
            turns: hydrated
              ? [
                  {
                    id: projectedTurnId,
                    status: "running",
                  },
                ]
              : [],
            running_turn: hydrated
              ? {
                  id: projectedTurnId,
                  status: "running",
                }
              : null,
            pending_requests: [],
            user_input_requests: [],
          },
        })
        if (!hydrated) {
          window.setTimeout(resolveStaleNewTaskDetailSettled, 0)
        }
        return response
      },
    })
    const interaction = userEvent.setup()
    renderApp("/conversations/new")

    const composer = await screen.findByRole(
      "textbox",
      { name: "任务输入框" },
      { timeout: 15_000 }
    )
    const initialWorkspace = document.querySelector(".conversation-workspace")
    const initialScroller = document.querySelector(".conversation-scroll")
    const initialConversationColumn = document.querySelector(
      ".conversation-column"
    )
    const initialComposerShell = screen.getByRole("form", {
      name: "任务输入框",
    })
    const initialModelSelector = await screen.findByRole("button", {
      name: "选择模型与推理强度",
    })
    const initialSendButton = await screen.findByRole("button", {
      name: "发送",
    })
    expect(initialSendButton).toBeVisible()
    expect(initialSendButton).toHaveAttribute("aria-disabled", "true")
    expect(initialWorkspace).toBeInTheDocument()
    expect(initialScroller).toBeInTheDocument()
    expect(initialConversationColumn).toBeInTheDocument()
    if (!(initialScroller instanceof HTMLElement)) {
      throw new Error("conversation scroller was not mounted")
    }
    const promotionScrollTo = vi.fn()
    Object.defineProperty(initialScroller, "scrollTo", {
      configurable: true,
      value: promotionScrollTo,
    })

    await interaction.type(composer, "排查页面闪烁")
    expect(screen.getByRole("button", { name: "发送" })).toBe(initialSendButton)
    expect(initialSendButton).toHaveAttribute("aria-disabled", "false")
    await interaction.keyboard("{Enter}")

    await waitFor(() =>
      expect(requests).toContainEqual(
        expect.objectContaining({
          path: "/api/v1/conversations/drafts",
          method: "POST",
        })
      )
    )
    const optimisticUserMessage = await screen.findByRole("article", {
      name: "用户消息",
    })
    const optimisticTurnSummary = document.querySelector(
      '[data-testid^="turn-summary-"]'
    )
    const optimisticStopButton = await screen.findByRole("button", {
      name: "停止",
    })
    expect(optimisticTurnSummary).toBeInTheDocument()
    promotionScrollTo.mockClear()
    initialScroller.scrollTop = 37

    releaseNewTaskDraft()

    await waitFor(() =>
      expect(requests).toContainEqual(
        expect.objectContaining({
          path: "/api/v1/conversations/new-task-1/turns",
          method: "POST",
        })
      )
    )
    await waitFor(() =>
      expect(
        requests.filter(
          (request) =>
            request.path === "/api/v1/conversations/new-task-1" &&
            request.method === "GET"
        )
      ).toHaveLength(1)
    )
    expect(
      await screen.findByRole("button", { name: "打开任务概览" })
    ).toBeVisible()
    expect(screen.getByTestId(`turn-summary-${projectedTurnId}`)).toBe(
      optimisticTurnSummary
    )
    expect(document.querySelector(".conversation-scroll")).toBe(initialScroller)
    expect(document.querySelector(".conversation-column")).toBe(
      initialConversationColumn
    )
    expect(screen.getByRole("form", { name: "任务输入框" })).toBe(
      initialComposerShell
    )
    expect(screen.getByRole("textbox", { name: "任务输入框" })).toBe(composer)
    expect(screen.getByRole("button", { name: "选择模型与推理强度" })).toBe(
      initialModelSelector
    )
    expect(screen.getByRole("article", { name: "用户消息" })).toBe(
      optimisticUserMessage
    )
    expect(document.querySelector('[data-testid^="turn-summary-"]')).toBe(
      optimisticTurnSummary
    )
    expect(screen.getByRole("button", { name: "停止" })).toBe(
      optimisticStopButton
    )

    releaseNewTaskTurn()
    await waitFor(() =>
      expect(screen.getByTestId(`turn-summary-${projectedTurnId}`)).toBe(
        optimisticTurnSummary
      )
    )
    await waitFor(() =>
      expect(
        requests.filter(
          (request) =>
            request.path === "/api/v1/conversations/new-task-1" &&
            request.method === "GET"
        )
      ).toHaveLength(2)
    )
    expect(screen.getByRole("article", { name: "用户消息" })).toBe(
      optimisticUserMessage
    )
    expect(screen.getByRole("button", { name: "停止" })).toBe(
      optimisticStopButton
    )

    releaseHydratedNewTaskDetail()
    await waitFor(() =>
      expect(
        document.getElementById("conversation-message-new-task-message-1")
      ).toBeInTheDocument()
    )
    expect(screen.getByRole("article", { name: "用户消息" })).toBe(
      optimisticUserMessage
    )
    expect(document.querySelector('[data-testid^="turn-summary-"]')).toBe(
      optimisticTurnSummary
    )
    expect(screen.getByRole("button", { name: "停止" })).toBe(
      optimisticStopButton
    )
    releaseStaleNewTaskDetail()
    await staleNewTaskDetailSettled
    expect(screen.queryByText("任务概览")).not.toBeInTheDocument()
    await waitFor(() => {
      expect(document.querySelector(".conversation-workspace")).toBe(
        initialWorkspace
      )
      expect(
        document.getElementById("conversation-message-new-task-message-1")
      ).toBeInTheDocument()
      expect(screen.getByRole("article", { name: "用户消息" })).toBe(
        optimisticUserMessage
      )
      expect(document.querySelector('[data-testid^="turn-summary-"]')).toBe(
        optimisticTurnSummary
      )
    })
    expect(initialWorkspace).not.toHaveAttribute("data-task-overview-open")
    expect(
      document.querySelector(".page-state-loading-fullscreen")
    ).not.toBeInTheDocument()
    expect(screen.getByRole("form", { name: "任务输入框" })).toBe(
      initialComposerShell
    )
    expect(screen.getByRole("textbox", { name: "任务输入框" })).toBe(composer)
    expect(document.querySelector(".conversation-scroll")).toBe(initialScroller)
    expect(screen.getByRole("button", { name: "选择模型与推理强度" })).toBe(
      initialModelSelector
    )
    expect(screen.getByRole("article", { name: "用户消息" })).toBe(
      optimisticUserMessage
    )
    expect(initialScroller).toHaveProperty("scrollTop", 37)
    expect(promotionScrollTo).not.toHaveBeenCalled()
    expect(screen.getByRole("button", { name: "停止" })).toBe(
      optimisticStopButton
    )

    await act(async () => {
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0))
    })
    releaseDelayedNewTaskEvent()
    await screen.findByRole("heading", { name: generatedTitle })
    await waitFor(() =>
      expect(
        requests.filter(
          (request) =>
            request.path === "/api/v1/conversations/new-task-1" &&
            request.method === "GET"
        )
      ).toHaveLength(3)
    )
    expect(document.querySelector(".conversation-workspace")).toBe(
      initialWorkspace
    )
    expect(document.querySelector(".conversation-scroll")).toBe(initialScroller)
    expect(screen.getByRole("form", { name: "任务输入框" })).toBe(
      initialComposerShell
    )
    expect(screen.getByRole("textbox", { name: "任务输入框" })).toBe(composer)
    expect(screen.getByRole("button", { name: "选择模型与推理强度" })).toBe(
      initialModelSelector
    )
    expect(screen.getByRole("article", { name: "用户消息" })).toBe(
      optimisticUserMessage
    )
    expect(document.querySelector('[data-testid^="turn-summary-"]')).toBe(
      optimisticTurnSummary
    )
    expect(initialScroller).toHaveProperty("scrollTop", 37)
    expect(promotionScrollTo).not.toHaveBeenCalled()
    expect(screen.getByRole("button", { name: "停止" })).toBe(
      optimisticStopButton
    )

    await waitFor(() =>
      expect(requests).toContainEqual(
        expect.objectContaining({
          path: "/api/v1/conversations/new-task-1/model-preference",
          method: "GET",
        })
      )
    )
    expect(screen.getByRole("button", { name: "选择模型与推理强度" })).toBe(
      initialModelSelector
    )
    expect(promotionScrollTo).not.toHaveBeenCalled()

    releaseNewTaskModelPreference()
    await waitFor(() =>
      expect(initialModelSelector).toHaveTextContent("Model A")
    )
    expect(screen.getByRole("button", { name: "选择模型与推理强度" })).toBe(
      initialModelSelector
    )
    expect(screen.getByRole("article", { name: "用户消息" })).toBe(
      optimisticUserMessage
    )
    expect(document.querySelector('[data-testid^="turn-summary-"]')).toBe(
      optimisticTurnSummary
    )
    expect(screen.getByRole("button", { name: "停止" })).toBe(
      optimisticStopButton
    )

    await interaction.click(
      screen.getByRole("button", { name: "打开任务概览" })
    )
    expect(await screen.findByText("任务概览")).toBeVisible()
    expect(initialWorkspace).toHaveAttribute("data-task-overview-open", "true")
  })

  it("keeps the stop control mounted while the first task turn is being projected", async () => {
    let releaseNewTaskDraft!: () => void
    const newTaskDraftStart = new Promise<void>((resolve) => {
      releaseNewTaskDraft = resolve
    })
    let releaseTurnStartedEvent!: () => void
    const newTaskEventStreamStart = new Promise<void>((resolve) => {
      releaseTurnStartedEvent = resolve
    })
    let exposeRunningProjection = false
    const projectedTurnId = "00000000-0000-4000-8000-000000000002"
    const turnStartedEventId = "new-task-1:2"
    const { requests } = installApiMock({
      newTaskDraftStart,
      newTaskEventStreamStart,
      newTaskEventStreamBody: `id: ${turnStartedEventId}\nevent: turn/started\ndata: ${JSON.stringify(
        {
          id: "60000000-0000-4000-8000-000000000002",
          conversation_id: "20000000-0000-4000-8000-000000000001",
          turn_id: projectedTurnId,
          sequence_no: 2,
          event_type: "turn/started",
          visibility: "user_visible",
          payload: {
            schema_version: 2,
            source: "codex_app_server",
            method: "turn/started",
            params: {
              threadId: "native-thread-new-task-1",
              turn: {
                id: "native-turn-new-task-1",
                status: "inProgress",
              },
            },
          },
          sse_event_id: turnStartedEventId,
          created_at: "2026-07-18T08:00:02.000Z",
        }
      )}\n\n`,
      newTaskDetailResponse: async () =>
        json({
          success: true,
          data: {
            id: "new-task-1",
            title: "未命名任务",
            archived: false,
            updated_at: "2026-07-18T08:00:02.000Z",
            draft_input: "",
            draft_capability_ids: [],
            messages: [
              {
                id: "new-task-message-1",
                role: "user",
                turn_id: projectedTurnId,
                content: "保持停止按钮",
                created_at: "2026-07-18T08:00:02.000Z",
              },
            ],
            attachments: [],
            artifacts: [],
            turns: exposeRunningProjection
              ? [{ id: projectedTurnId, status: "running" }]
              : [],
            running_turn: exposeRunningProjection
              ? { id: projectedTurnId, status: "running" }
              : null,
            pending_requests: [],
            user_input_requests: [],
          },
        }),
    })
    const interaction = userEvent.setup()
    renderApp()

    await screen.findByRole(
      "heading",
      { name: conversations[0]!.title },
      { timeout: 15_000 }
    )
    await waitFor(() =>
      expect(requests).toContainEqual(
        expect.objectContaining({
          path: "/api/v1/conversations/c1/events",
          method: "GET",
        })
      )
    )
    const sidebar = screen.getByRole("complementary", {
      name: "LinkSense 导航",
    })
    await interaction.click(
      within(sidebar).getByRole("link", { name: "新任务" })
    )
    const composer = await screen.findByRole("textbox", { name: "任务输入框" })
    const workspace = document.querySelector(".conversation-workspace")
    const scroller = document.querySelector(".conversation-scroll")
    const composerShell = screen.getByRole("form", { name: "任务输入框" })

    await interaction.type(composer, "保持停止按钮")
    await interaction.keyboard("{Enter}")

    const optimisticMessage = await screen.findByRole("article", {
      name: "用户消息",
    })
    const optimisticSummary = document.querySelector(
      '[data-testid^="turn-summary-"]'
    )
    const stopControl = await screen.findByRole("button", { name: "停止" })
    expect(optimisticSummary).toBeInTheDocument()

    releaseNewTaskDraft()
    await waitFor(() =>
      expect(
        document.getElementById("conversation-message-new-task-message-1")
      ).toBeInTheDocument()
    )
    await act(async () => {
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0))
    })

    expect(screen.getByRole("button", { name: "停止" })).toBe(stopControl)
    expect(screen.getByRole("article", { name: "用户消息" })).toBe(
      optimisticMessage
    )
    expect(document.querySelector('[data-testid^="turn-summary-"]')).toBe(
      optimisticSummary
    )
    expect(document.querySelector(".conversation-workspace")).toBe(workspace)
    expect(document.querySelector(".conversation-scroll")).toBe(scroller)
    expect(screen.getByRole("form", { name: "任务输入框" })).toBe(composerShell)

    const detailRequestCountBeforeTurnStarted = requests.filter(
      (request) =>
        request.path === "/api/v1/conversations/new-task-1" &&
        request.method === "GET"
    ).length
    exposeRunningProjection = true
    releaseTurnStartedEvent()
    await waitFor(() =>
      expect(
        requests.filter(
          (request) =>
            request.path === "/api/v1/conversations/new-task-1" &&
            request.method === "GET"
        ).length
      ).toBeGreaterThan(detailRequestCountBeforeTurnStarted)
    )
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "停止" })).toBe(stopControl)
    )
    expect(screen.getByRole("article", { name: "用户消息" })).toBe(
      optimisticMessage
    )
    expect(document.querySelector('[data-testid^="turn-summary-"]')).toBe(
      optimisticSummary
    )
    expect(document.querySelector(".conversation-workspace")).toBe(workspace)
    expect(document.querySelector(".conversation-scroll")).toBe(scroller)
    expect(screen.getByRole("form", { name: "任务输入框" })).toBe(composerShell)
  })

  it("keeps one user message when promoted detail arrives before the turn receipt", async () => {
    let releaseNewTaskDraft!: () => void
    const newTaskDraftStart = new Promise<void>((resolve) => {
      releaseNewTaskDraft = resolve
    })
    let releaseNewTaskTurn!: () => void
    const newTaskTurnStart = new Promise<void>((resolve) => {
      releaseNewTaskTurn = resolve
    })
    const projectedTurnId = "00000000-0000-4000-8000-000000000002"
    const detailRefreshEventId = "new-task-1:2"
    const { requests } = installApiMock({
      newTaskDraftStart,
      newTaskTurnStart,
      newTaskEventStreamBody: `id: ${detailRefreshEventId}\nevent: turn/started\ndata: ${JSON.stringify(
        {
          id: "60000000-0000-4000-8000-000000000002",
          conversation_id: "20000000-0000-4000-8000-000000000001",
          turn_id: projectedTurnId,
          sequence_no: 2,
          event_type: "turn/started",
          visibility: "user_visible",
          payload: {
            schema_version: 2,
            source: "codex_app_server",
            method: "turn/started",
            params: {
              threadId: "native-thread-new-task-1",
              turn: {
                id: "native-turn-new-task-1",
                status: "inProgress",
              },
            },
          },
          sse_event_id: detailRefreshEventId,
          created_at: "2026-07-18T08:00:02.000Z",
        }
      )}\n\n`,
      newTaskDetailResponse: async () =>
        json({
          success: true,
          data: {
            id: "new-task-1",
            title: "未命名任务",
            archived: false,
            updated_at: "2026-07-18T08:00:02.000Z",
            draft_input: "",
            draft_capability_ids: [],
            messages: [
              {
                id: "new-task-message-before-receipt",
                role: "user",
                turn_id: projectedTurnId,
                content: "详情先于回执",
                created_at: "2026-07-18T08:00:02.000Z",
              },
            ],
            attachments: [],
            artifacts: [],
            turns: [{ id: projectedTurnId, status: "running" }],
            running_turn: { id: projectedTurnId, status: "running" },
            pending_requests: [],
            user_input_requests: [],
          },
        }),
    })
    const interaction = userEvent.setup()
    renderApp("/conversations/new")

    const composer = await screen.findByRole(
      "textbox",
      { name: "任务输入框" },
      { timeout: 15_000 }
    )
    await interaction.type(composer, "详情先于回执")
    await interaction.keyboard("{Enter}")
    await waitFor(() =>
      expect(requests).toContainEqual(
        expect.objectContaining({
          path: "/api/v1/conversations/drafts",
          method: "POST",
        })
      )
    )
    const optimisticUserMessage = await screen.findByRole("article", {
      name: "用户消息",
    })
    const optimisticTurnSummary = document.querySelector(
      '[data-testid^="turn-summary-"]'
    )
    expect(optimisticTurnSummary).toBeInTheDocument()

    releaseNewTaskDraft()
    await waitFor(() =>
      expect(requests).toContainEqual(
        expect.objectContaining({
          path: "/api/v1/conversations/new-task-1/turns",
          method: "POST",
        })
      )
    )
    await waitFor(() =>
      expect(
        requests.filter(
          (request) =>
            request.path === "/api/v1/conversations/new-task-1" &&
            request.method === "GET"
        )
      ).toHaveLength(1)
    )
    await waitFor(() =>
      expect(
        document.getElementById(
          "conversation-message-new-task-message-before-receipt"
        )
      ).toBeInTheDocument()
    )

    expect(screen.getAllByRole("article", { name: "用户消息" })).toHaveLength(1)
    expect(screen.getByRole("article", { name: "用户消息" })).toBe(
      optimisticUserMessage
    )
    expect(document.querySelector('[data-testid^="turn-summary-"]')).toBe(
      optimisticTurnSummary
    )

    releaseNewTaskTurn()
    await waitFor(() =>
      expect(
        requests.filter(
          (request) =>
            request.path === "/api/v1/conversations/new-task-1" &&
            request.method === "GET"
        )
      ).toHaveLength(2)
    )
    expect(screen.getByRole("article", { name: "用户消息" })).toBe(
      optimisticUserMessage
    )
    expect(document.querySelector('[data-testid^="turn-summary-"]')).toBe(
      optimisticTurnSummary
    )
  })

  it("keeps starter questions hidden while the first new-task message is being created", async () => {
    let releaseNewTaskDraft: (() => void) | undefined
    const newTaskDraftStart = new Promise<void>((resolve) => {
      releaseNewTaskDraft = resolve
    })
    installApiMock({
      newTaskDraftStart,
      newTaskDetailResponse: async () =>
        json({
          success: true,
          data: {
            id: "new-task-1",
            title: "未命名任务",
            archived: false,
            updated_at: "2026-07-18T08:00:02.000Z",
            draft_input: "",
            draft_capability_ids: [],
            messages: [],
            attachments: [],
            artifacts: [],
            turns: [],
            running_turn: null,
            pending_requests: [],
          },
        }),
    })
    const interaction = userEvent.setup()
    renderApp("/conversations/new")

    expect(
      await screen.findByRole("group", { name: "常见任务建议" })
    ).toBeVisible()
    await interaction.type(
      screen.getByRole("textbox", { name: "任务输入框" }),
      "排查页面闪烁"
    )
    await interaction.keyboard("{Enter}")

    await waitFor(() =>
      expect(
        screen.queryByRole("group", { name: "常见任务建议" })
      ).not.toBeInTheDocument()
    )

    releaseNewTaskDraft?.()
  })

  it("creates and starts a new task with the selected native Plan mode", async () => {
    const planPrompt = "先分析完整实现方案"
    const { requests } = installApiMock({
      newTaskDetailResponse: async () =>
        json({
          success: true,
          data: {
            id: "new-task-1",
            title: "未命名任务",
            archived: false,
            collaboration_mode: "plan",
            updated_at: "2026-07-18T08:00:02.000Z",
            draft_input: "",
            draft_capability_ids: [],
            messages: [],
            attachments: [],
            artifacts: [],
            turns: [
              {
                id: "00000000-0000-4000-8000-000000000002",
                status: "running",
                collaboration_mode: "plan",
              },
            ],
            running_turn: {
              id: "00000000-0000-4000-8000-000000000002",
              status: "running",
              collaboration_mode: "plan",
            },
            pending_requests: [],
            user_input_requests: [],
          },
        }),
    })
    const interaction = userEvent.setup()
    renderApp("/conversations/new")

    await interaction.click(await screen.findByRole("button", { name: "添加" }))
    await interaction.click(screen.getByRole("option", { name: /计划模式/ }))
    expect(screen.getByRole("button", { name: "退出计划模式" })).toBeVisible()
    await interaction.type(
      screen.getByRole("textbox", { name: "任务输入框" }),
      planPrompt
    )
    await interaction.keyboard("{Enter}")

    await waitFor(() => {
      expect(
        requests.find(
          (request) =>
            request.path === "/api/v1/conversations/drafts" &&
            request.method === "POST"
        )?.body
      ).toEqual({
        input_text: planPrompt,
        priority_capability_ids: [],
        knowledge_base_ids: [],
        collaboration_mode: "plan",
      })
      expect(
        requests.find(
          (request) =>
            request.path === "/api/v1/conversations/new-task-1/turns" &&
            request.method === "POST"
        )?.body
      ).toEqual({
        input_text: planPrompt,
        priority_capability_ids: [],
        knowledge_base_ids: [],
        idempotency_key: expect.any(String),
        collaboration_mode: "plan",
      })
    })
  })

  it("waits for an existing task Plan mode update before submitting", async () => {
    const planPrompt = "先形成计划，再等我确认"
    let resolveModePatch: ((response: Response) => void) | undefined
    const modePatchResponse = new Promise<Response>((resolve) => {
      resolveModePatch = resolve
    })
    const { requests } = installApiMock({
      conversationOverride: {
        collaboration_mode: "default",
        execution_status: "completed",
        draft_input: "",
        turns: [],
        running_turn: null,
        pending_requests: [],
      },
      conversationPatchResponse: async (_conversationId, body) => {
        expect(body).toEqual({ collaboration_mode: "plan" })
        return modePatchResponse
      },
    })
    const interaction = userEvent.setup()
    renderApp()

    const composer = await screen.findByRole("textbox", { name: "任务输入框" })
    await interaction.type(composer, planPrompt)
    await interaction.click(screen.getByRole("button", { name: "添加" }))
    await interaction.click(screen.getByRole("option", { name: /计划模式/ }))

    await waitFor(() =>
      expect(
        requests.some(
          (request) =>
            request.path === "/api/v1/conversations/c1" &&
            request.method === "PATCH" &&
            JSON.stringify(request.body) ===
              JSON.stringify({ collaboration_mode: "plan" })
        )
      ).toBe(true)
    )
    expect(screen.getByRole("button", { name: "发送" })).toBeDisabled()
    await interaction.keyboard("{Enter}")
    expect(
      requests.some(
        (request) =>
          request.path === "/api/v1/conversations/c1/turns" &&
          request.method === "POST"
      )
    ).toBe(false)

    resolveModePatch?.(
      json({
        success: true,
        data: {
          ...conversation,
          collaboration_mode: "plan",
          execution_status: "completed",
          draft_input: planPrompt,
          turns: [],
          running_turn: null,
          pending_requests: [],
        },
      })
    )
    expect(
      await screen.findByRole("button", { name: "退出计划模式" })
    ).toBeVisible()
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "发送" })).toBeEnabled()
    )
    await interaction.click(screen.getByRole("button", { name: "发送" }))

    await waitFor(() =>
      expect(
        requests.find(
          (request) =>
            request.path === "/api/v1/conversations/c1/turns" &&
            request.method === "POST"
        )?.body
      ).toEqual({
        input_text: planPrompt,
        priority_capability_ids: [],
        knowledge_base_ids: [],
        collaboration_mode: "plan",
        idempotency_key: expect.any(String),
      })
    )
  })

  it("renders a completed native plan and starts implementation only after confirmation", async () => {
    let decision: PlanReviewFixtureDecision = null
    const { requests } = installApiMock({
      conversationGetResponse: async () =>
        json({
          success: true,
          data: planReviewConversationFixture(decision),
        }),
      planReviewActionResponse: async (reviewId) => {
        expect(reviewId).toBe(planReviewFixtureIds.review)
        decision = "implement"
        return json(
          {
            success: true,
            data: {
              review: planReviewConversationFixture(decision).plan_reviews[0],
              turn: {
                id: planReviewFixtureIds.followUpTurn,
                status: "running",
                collaboration_mode: "default",
              },
            },
          },
          202
        )
      },
    })
    const interaction = userEvent.setup()
    renderApp()

    expect(
      await screen.findByRole("region", { name: "方案" }, { timeout: 3_000 })
    ).toHaveTextContent("完整实施计划")
    const decisionCard = screen
      .getByRole("heading", { name: "实施此计划？" })
      .closest<HTMLElement>('[data-testid="conversation-plan-decision"]')
    const blockingPanel = decisionCard?.closest<HTMLElement>(
      '[data-testid="conversation-blocking-panel"]'
    )
    expect(decisionCard).toBeVisible()
    expect(blockingPanel).not.toBeNull()
    expect(screen.getByRole("log")).toContainElement(blockingPanel ?? null)
    expect(decisionCard?.closest(".conversation-column")).not.toBeNull()
    expect(decisionCard?.closest(".conversation-bottom-stack")).toBeNull()
    expect(
      screen.queryByRole("textbox", { name: "任务输入框" })
    ).not.toBeInTheDocument()

    await interaction.click(
      screen.getByRole("button", { name: "是，实施此计划" })
    )

    await waitFor(() =>
      expect(
        requests.find(
          (request) =>
            request.path ===
              `/api/v1/conversations/c1/plan-reviews/${planReviewFixtureIds.review}/actions` &&
            request.method === "POST"
        )?.body
      ).toEqual({
        action: "implement",
        idempotency_key: expect.any(String),
      })
    )
    await waitFor(() =>
      expect(
        screen.queryByRole("heading", { name: "实施此计划？" })
      ).not.toBeInTheDocument()
    )
    expect(screen.queryByText("Implement the plan.")).not.toBeInTheDocument()
  })

  it("removes only the final answer superseded by the native Plan Stop hook", async () => {
    const supersededText = "请切换到可写工作区后重试。"
    const commentaryText = "已核对 GitHub 最近一周的数据来源。"
    const planText = "## Excel 交付计划\n\n1. 整理项目数据\n2. 生成饼图"
    let resolveRefresh: ((response: Response) => void) | undefined
    const refreshResponse = new Promise<Response>((resolve) => {
      resolveRefresh = resolve
    })
    let releaseEventStream: (() => void) | undefined
    const eventStreamStart = new Promise<void>((resolve) => {
      releaseEventStream = resolve
    })
    const initialDetail = planReviewConversationFixture(null)
    const finalDetail = planReviewConversationFixture(null)
    const sourceTurn = planReviewFixtureIds.sourceTurn
    const event = (
      sequence: number,
      method: string,
      payload: Record<string, unknown>,
      visibility: "user_visible" | "user_collapsed" = "user_visible"
    ) => {
      const eventId = `c1:${sequence}`
      return `id: ${eventId}\nevent: ${method}\ndata: ${JSON.stringify({
        id: `60000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
        conversation_id: planReviewFixtureIds.conversation,
        turn_id: sourceTurn,
        sequence_no: sequence,
        event_type: method,
        visibility,
        payload,
        sse_event_id: eventId,
        created_at: `2026-08-10T08:00:${String(sequence).padStart(2, "0")}.000Z`,
      })}\n\n`
    }
    const nativePayload = (
      method: string,
      params: Record<string, unknown>,
      local?: Record<string, unknown>
    ) => ({
      schema_version: 2,
      source: "codex_app_server",
      method,
      params,
      ...(local ? { local } : {}),
    })
    const threadId = "native-thread-plan"
    const nativeTurnId = "native-turn-plan"
    const invalidItemId = "native-invalid-final"
    const eventStreamBody = [
      event(
        31,
        "item/agentMessage/delta",
        nativePayload("item/agentMessage/delta", {
          threadId,
          turnId: nativeTurnId,
          itemId: invalidItemId,
          delta: supersededText,
        })
      ),
      event(
        32,
        "item/completed",
        nativePayload(
          "item/completed",
          {
            threadId,
            turnId: nativeTurnId,
            item: {
              id: invalidItemId,
              type: "agentMessage",
              text: supersededText,
              phase: "final_answer",
            },
          },
          { message_id: "60000000-0000-4000-8000-000000000032" }
        )
      ),
      event(
        33,
        "hook/completed",
        nativePayload(
          "hook/completed",
          {
            threadId,
            turnId: nativeTurnId,
            run: { eventName: "stop", status: "blocked" },
            supersededItemId: invalidItemId,
          },
          {
            superseded_message_id: "60000000-0000-4000-8000-000000000032",
            superseded_item_id: invalidItemId,
          }
        ),
        "user_collapsed"
      ),
      event(
        34,
        "item/completed",
        nativePayload(
          "item/completed",
          {
            threadId,
            turnId: nativeTurnId,
            item: {
              id: "native-plan-item",
              type: "plan",
              text: planText,
            },
          },
          {
            message_id: planReviewFixtureIds.planMessage,
            plan_review_id: planReviewFixtureIds.review,
          }
        )
      ),
    ].join("")

    installApiMock({
      eventStreamBody,
      eventStreamStart,
      conversationGetResponse: async (callIndex) =>
        callIndex === 1
          ? json({
              success: true,
              data: {
                ...initialDetail,
                execution_status: "running",
                messages: [
                  initialDetail.messages[0],
                  {
                    id: "60000000-0000-4000-8000-000000000030",
                    role: "assistant",
                    turn_id: sourceTurn,
                    phase: "commentary",
                    content: commentaryText,
                    created_at: "2026-08-10T08:00:30.000Z",
                  },
                ],
                turns: [
                  {
                    ...initialDetail.turns[0],
                    status: "running",
                    completed_at: null,
                  },
                ],
                running_turn: {
                  ...initialDetail.turns[0],
                  status: "running",
                  completed_at: null,
                },
                plan_reviews: [],
              },
            })
          : refreshResponse,
    })

    renderApp()

    expect(await screen.findByText(commentaryText)).toBeVisible()
    await act(async () => {
      releaseEventStream?.()
      await eventStreamStart
    })
    expect(
      await screen.findByRole("region", { name: "方案" })
    ).toHaveTextContent("Excel 交付计划")
    expect(screen.queryByText(supersededText)).not.toBeInTheDocument()

    resolveRefresh?.(
      json({
        success: true,
        data: {
          ...finalDetail,
          messages: [
            finalDetail.messages[0],
            {
              id: "60000000-0000-4000-8000-000000000030",
              role: "assistant",
              turn_id: sourceTurn,
              phase: "commentary",
              content: commentaryText,
              created_at: "2026-08-10T08:00:30.000Z",
            },
            finalDetail.messages[1],
          ],
        },
      })
    )

    expect(
      await screen.findByRole("heading", { name: "实施此计划？" })
    ).toBeVisible()
    expect(screen.queryByText(supersededText)).not.toBeInTheDocument()
  })

  it("uses the follow-up turn mode returned by a plan implementation action", async () => {
    let decision: PlanReviewFixtureDecision = null
    let resolveRefresh: ((response: Response) => void) | undefined
    const refreshResponse = new Promise<Response>((resolve) => {
      resolveRefresh = resolve
    })
    const { requests } = installApiMock({
      conversationGetResponse: async (callIndex) =>
        callIndex === 1
          ? json({
              success: true,
              data: planReviewConversationFixture(decision),
            })
          : refreshResponse,
      planReviewActionResponse: async () => {
        decision = "implement"
        return json(
          {
            success: true,
            data: {
              review: planReviewConversationFixture(decision).plan_reviews[0],
              turn: {
                id: planReviewFixtureIds.followUpTurn,
                status: "running",
                collaboration_mode: "plan",
              },
            },
          },
          202
        )
      },
    })
    const interaction = userEvent.setup()
    renderApp()

    await interaction.click(
      await screen.findByRole("button", { name: "是，实施此计划" })
    )

    expect(
      await screen.findByRole("button", { name: "退出计划模式" })
    ).toBeVisible()

    const refreshed = planReviewConversationFixture(decision)
    resolveRefresh?.(
      json({
        success: true,
        data: {
          ...refreshed,
          collaboration_mode: "plan",
          turns: refreshed.turns.map((turn) =>
            turn.id === planReviewFixtureIds.followUpTurn
              ? { ...turn, collaboration_mode: "plan" }
              : turn
          ),
          running_turn: refreshed.running_turn
            ? { ...refreshed.running_turn, collaboration_mode: "plan" }
            : null,
        },
      })
    )
    await waitFor(() =>
      expect(
        requests.filter(
          (request) =>
            request.path === "/api/v1/conversations/c1" &&
            request.method === "GET"
        )
      ).toHaveLength(2)
    )
  })

  it.each([
    {
      action: "revise" as const,
      buttonName: "否，先修改计划",
      expectedBody: {
        action: "revise",
        feedback: "请补充灰度发布和回滚验证",
        idempotency_key: expect.any(String),
      },
    },
    {
      action: "skip" as const,
      buttonName: "跳过",
      expectedBody: { action: "skip" },
    },
    {
      action: "exit" as const,
      buttonName: "退出计划模式",
      expectedBody: { action: "exit" },
    },
  ])(
    "submits the $action plan decision through its dedicated action",
    async ({ action, buttonName, expectedBody }) => {
      let decision: PlanReviewFixtureDecision = null
      const revisionFeedback = "请补充灰度发布和回滚验证"
      const { requests } = installApiMock({
        conversationGetResponse: async () =>
          json({
            success: true,
            data: planReviewConversationFixture(decision, revisionFeedback),
          }),
        planReviewActionResponse: async () => {
          decision = action
          const resolvedReview = planReviewConversationFixture(
            decision,
            revisionFeedback
          ).plan_reviews[0]
          return json(
            {
              success: true,
              data: {
                review: resolvedReview,
                turn:
                  action === "revise"
                    ? {
                        id: planReviewFixtureIds.followUpTurn,
                        status: "running",
                        collaboration_mode: "plan",
                      }
                    : null,
              },
            },
            action === "revise" ? 202 : 200
          )
        },
      })
      const interaction = userEvent.setup()
      renderApp()

      await screen.findByRole("heading", { name: "实施此计划？" })
      await interaction.click(screen.getByRole("button", { name: buttonName }))
      if (action === "revise") {
        await interaction.type(
          screen.getByRole("textbox", { name: "修改意见" }),
          revisionFeedback
        )
        await interaction.click(
          screen.getByRole("button", { name: "提交修改意见" })
        )
      }

      await waitFor(() =>
        expect(
          requests.find(
            (request) =>
              request.path ===
                `/api/v1/conversations/c1/plan-reviews/${planReviewFixtureIds.review}/actions` &&
              request.method === "POST"
          )?.body
        ).toEqual(expectedBody)
      )
    }
  )

  it("shows token usage admission errors as a plain empty-task notice", async () => {
    installApiMock({
      conversationOverride: {
        messages: [],
        turns: [],
        running_turn: null,
        execution_status: "idle",
      },
      turnStartResponse: async () =>
        json(
          {
            success: false,
            error_code: "TOKEN_LIMIT_EXCEEDED",
          },
          429
        ),
    })
    const interaction = userEvent.setup()
    const { container } = renderApp()

    await interaction.type(
      await screen.findByRole("textbox", { name: "任务输入框" }),
      "生成一段欢迎语音"
    )
    await interaction.click(screen.getByRole("button", { name: "发送" }))

    const notice = await screen.findByRole("alert")
    expect(notice).toHaveClass("conversation-empty-notice")
    expect(notice).toHaveTextContent(
      "你的可用 Token 额度已用尽，暂时不能发起新任务。"
    )
    expect(notice.querySelector(".lucide-circle-alert")).not.toBeNull()
    expect(notice.closest(".conversation-top-overlay-stack")).toBeNull()
    expect(
      container.querySelector(".conversation-top-overlay-stack")
    ).toBeNull()
  })

  it("blocks starting tasks and shows a dismissible usage card when usage is exhausted", async () => {
    const { requests } = installApiMock({
      userOverride: {
        token_quota: {
          total: null,
          weekly: {
            limit_tokens: "1000",
            used_tokens: "1000",
            remaining_tokens: "0",
            remaining_percentage: 0,
            reset_at: "2026-08-09T16:00:00.000Z",
          },
          monthly: null,
        },
      },
    })
    const interaction = userEvent.setup()
    renderApp("/conversations/new")

    const quotaTitle = await screen.findByText("Token 用量已达上限")
    const quotaCard = quotaTitle.closest<HTMLElement>(
      ".conversation-token-quota-card"
    )
    expect(quotaCard).not.toBeNull()
    expect(quotaCard).toHaveTextContent(
      "可用 Token 额度已用尽，暂时不能发起新任务或补充请求；正在运行的任务不受影响。"
    )
    expect(
      quotaCard?.closest(".conversation-token-quota-card-dock")?.parentElement
    ).toHaveClass("conversation-bottom-stack")
    expect(
      quotaCard?.closest(".conversation-token-quota-card-dock")
        ?.nextElementSibling
    ).toHaveClass("composer-shell")

    const composer = await screen.findByRole("textbox", { name: "任务输入框" })
    await interaction.type(composer, "尝试发起任务")
    const sendButton = screen.getByRole("button", { name: "发送" })
    expect(sendButton).toBeDisabled()
    expect(sendButton).toHaveAttribute("aria-disabled", "true")
    await interaction.keyboard("{Enter}")
    expect(
      requests.some(
        (request) => request.method === "POST" && /\/turns$/u.test(request.path)
      )
    ).toBe(false)

    await interaction.click(
      screen.getByRole("button", { name: "关闭用量提醒" })
    )
    expect(screen.queryByText("Token 用量已达上限")).not.toBeInTheDocument()
    expect(sendButton).toBeDisabled()
  })

  it("keeps the running plan above queued follow-ups in the bottom stack", async () => {
    const interaction = userEvent.setup()
    installApiMock({
      conversationOverride: {
        turn_file_change_counts: { "turn-1": 4 },
        pending_requests: [
          {
            id: "pending-plan-layout-1",
            sequence_no: 1,
            status: "waiting_previous_turn",
            input_text: "页面的数量加到三页吧。",
            priority_capability_ids: [],
            attachments: [],
          },
        ],
        events: [
          {
            id: "plan-event-1",
            type: "turn/plan/updated",
            turn_id: "turn-1",
            sequence_no: 12,
            created_at: "2026-07-14T08:00:12.000Z",
            payload: {
              schema_version: 2,
              source: "codex_app_server",
              method: "turn/plan/updated",
              params: {
                threadId: "thread-native-1",
                turnId: "turn-native-1",
                plan: [
                  { step: "核对现有实现", status: "completed" },
                  { step: "实现输入框上方清单", status: "inProgress" },
                  { step: "完成回归测试", status: "pending" },
                ],
              },
            },
          },
        ],
      },
    })

    const { container } = renderApp()

    const trigger = await screen.findByRole("button", {
      name: "展开执行计划",
    })
    const planCard = trigger.closest<HTMLElement>(
      ".conversation-plan-card-composer"
    )
    const workspace = container.querySelector(".conversation-workspace")
    const bottomStack = container.querySelector(".conversation-bottom-stack")
    const pendingRequests = await screen.findByRole("region", {
      name: "后续请求",
    })
    const composer = await screen.findByRole("form", { name: "任务输入框" })

    expect(planCard).toHaveAttribute("data-placement", "composer")
    expect(planCard?.parentElement).toHaveClass("conversation-plan-dock")
    expect(workspace).toContainElement(planCard)
    expect(bottomStack).toContainElement(planCard)
    expect(planCard?.closest(".conversation-top-overlay-stack")).toBeNull()
    expect(planCard?.parentElement?.nextElementSibling).toBe(pendingRequests)
    expect(pendingRequests.nextElementSibling).toBe(composer)
    expect(
      within(planCard as HTMLElement).getByText("第 2 / 3 步")
    ).toBeVisible()
    expect(
      within(planCard as HTMLElement).queryByText("4 个文件已更改")
    ).toBeNull()
    expect(screen.queryByText("实现输入框上方清单")).toBeNull()

    await interaction.hover(trigger)

    expect(
      screen.getByRole("button", { name: "收起执行计划" })
    ).toHaveAttribute("aria-expanded", "true")
    expect(await screen.findByText("实现输入框上方清单")).toBeVisible()
  })

  it("filters the Codex reasoning summary streamed for the running turn", async () => {
    const conversationId = "20000000-0000-4000-8000-000000000001"
    const turnId = "30000000-0000-4000-8000-000000000001"
    const summaryText = "Evaluating test timing reliability"
    const eventId = "c1:13"
    installApiMock({
      conversationOverride: {
        messages: [
          {
            id: "m1",
            role: "user",
            turn_id: turnId,
            content: "检查测试稳定性",
          },
        ],
        turns: [{ id: turnId, status: "running" }],
        running_turn: { id: turnId, status: "running" },
      },
      eventStreamBody: `id: ${eventId}\nevent: item/reasoning/summaryTextDelta\ndata: ${JSON.stringify(
        {
          id: "60000000-0000-4000-8000-000000000013",
          conversation_id: conversationId,
          turn_id: turnId,
          sequence_no: 13,
          event_type: "item/reasoning/summaryTextDelta",
          visibility: "user_collapsed",
          payload: {
            schema_version: 2,
            source: "codex_app_server",
            method: "item/reasoning/summaryTextDelta",
            params: {
              threadId: "thread-native-1",
              turnId: "turn-native-1",
              itemId: "reasoning-1",
              summaryIndex: 0,
              delta: summaryText,
            },
          },
          sse_event_id: eventId,
          created_at: "2026-07-15T08:00:13.000Z",
        }
      )}\n\n`,
    })

    renderApp()

    expect(await screen.findByText("正在处理", { exact: true })).toBeVisible()
    expect(screen.queryByText(summaryText, { exact: true })).toBeNull()
    expect(screen.queryByText("思考内容", { exact: true })).toBeNull()
  })

  it("renders the localized Plan output error streamed by the conversation", async () => {
    const turnId = "30000000-0000-4000-8000-000000000016"
    const eventId = "c1:16"
    let releaseEventStream: (() => void) | undefined
    const eventStreamStart = new Promise<void>((resolve) => {
      releaseEventStream = resolve
    })
    installApiMock({
      conversationOverride: {
        messages: [
          {
            id: "m1",
            role: "user",
            turn_id: turnId,
            content: "先生成计划",
          },
        ],
        turns: [{ id: turnId, status: "running" }],
        running_turn: { id: turnId, status: "running" },
      },
      eventStreamStart,
      eventStreamBody: `id: ${eventId}\nevent: conversation.error\ndata: ${JSON.stringify(
        {
          id: "60000000-0000-4000-8000-000000000016",
          conversation_id: "20000000-0000-4000-8000-000000000001",
          turn_id: turnId,
          sequence_no: 16,
          event_type: "conversation.error",
          visibility: "user_visible",
          payload: {
            schema_version: 1,
            error_code: "PLAN_OUTPUT_MISSING",
            message_key: "errors.conversation.planOutputMissing",
            retryable: true,
          },
          sse_event_id: eventId,
          created_at: "2026-08-10T08:00:16.000Z",
        }
      )}\n\n`,
    })

    renderApp()

    expect(await screen.findByText("先生成计划")).toBeVisible()
    await act(async () => {
      releaseEventStream?.()
      await eventStreamStart
    })
    expect(
      await screen.findByText("计划模式未生成可确认的计划，请重新发起请求。", {
        exact: true,
      })
    ).toBeVisible()
    expect(
      screen.queryByText("本轮执行失败。你可以调整输入后继续重试。", {
        exact: true,
      })
    ).toBeNull()
  })

  it("clears a stale missing-Plan error when the same turn projects its native Plan review", async () => {
    const turnId = "30000000-0000-4000-8000-000000000017"
    const conversationId = "20000000-0000-4000-8000-000000000001"
    let releaseEventStream: (() => void) | undefined
    const eventStreamStart = new Promise<void>((resolve) => {
      releaseEventStream = resolve
    })
    const planText =
      "# AI 演示文稿计划\n\n## 目标与范围\n规划 10 页内容。\n\n## 实施步骤\n1. 设计结构。\n\n## 验收标准\n检查页数。\n\n## 默认设定与边界\n不在计划阶段生成文件。"
    const errorEvent = `id: c1:17\nevent: conversation.error\ndata: ${JSON.stringify(
      {
        id: "60000000-0000-4000-8000-000000000017",
        conversation_id: conversationId,
        turn_id: turnId,
        sequence_no: 17,
        event_type: "conversation.error",
        visibility: "user_visible",
        payload: {
          schema_version: 1,
          error_code: "PLAN_OUTPUT_MISSING",
          message_key: "errors.conversation.planOutputMissing",
          retryable: true,
        },
        sse_event_id: "c1:17",
        created_at: "2026-08-10T08:00:17.000Z",
      }
    )}\n\n`
    const planEvent = `id: c1:18\nevent: item/completed\ndata: ${JSON.stringify(
      {
        id: "60000000-0000-4000-8000-000000000018",
        conversation_id: conversationId,
        turn_id: turnId,
        sequence_no: 18,
        event_type: "item/completed",
        visibility: "user_visible",
        payload: {
          schema_version: 2,
          source: "codex_app_server",
          method: "item/completed",
          params: {
            threadId: "thread-native-plan",
            turnId: "turn-native-plan",
            item: {
              id: "native-plan-item",
              type: "plan",
              text: planText,
            },
          },
          local: {
            message_id: "60000000-0000-4000-8000-000000000019",
            plan_review_id: "60000000-0000-4000-8000-000000000020",
          },
        },
        sse_event_id: "c1:18",
        created_at: "2026-08-10T08:00:18.000Z",
      }
    )}\n\n`
    installApiMock({
      conversationOverride: {
        messages: [
          {
            id: "m1",
            role: "user",
            turn_id: turnId,
            content: "先生成 PPT 计划",
          },
        ],
        turns: [{ id: turnId, status: "running" }],
        running_turn: { id: turnId, status: "running" },
      },
      eventStreamBody: `${errorEvent}${planEvent}`,
      eventStreamStart,
    })

    renderApp()

    expect(await screen.findByText("先生成 PPT 计划")).toBeVisible()
    await act(async () => {
      releaseEventStream?.()
      await eventStreamStart
    })
    expect(
      await screen.findByRole("region", { name: "方案" })
    ).toHaveTextContent("AI 演示文稿计划")
    expect(
      screen.queryByText("计划模式未生成可确认的计划，请重新发起请求。", {
        exact: true,
      })
    ).toBeNull()
  })

  it("starts and persists the inline reconnect simulation for a retryable response stream disconnect", async () => {
    const turnId = "30000000-0000-4000-8000-000000000002"
    const eventId = "c1:14"
    installApiMock({
      conversationOverride: {
        messages: [
          {
            id: "m1",
            role: "user",
            turn_id: turnId,
            content: "继续完成",
          },
          {
            id: "m2",
            role: "assistant",
            turn_id: turnId,
            content: "正在核对实现。",
          },
        ],
        turns: [{ id: turnId, status: "running" }],
        running_turn: { id: turnId, status: "running" },
      },
      eventStreamBody: `id: ${eventId}\nevent: error\ndata: ${JSON.stringify({
        id: "60000000-0000-4000-8000-000000000014",
        conversation_id: "20000000-0000-4000-8000-000000000001",
        turn_id: turnId,
        sequence_no: 14,
        event_type: "error",
        visibility: "user_collapsed",
        payload: {
          schema_version: 2,
          source: "codex_app_server",
          method: "error",
          params: {
            threadId: "thread-native-1",
            turnId: "turn-native-1",
            willRetry: true,
            error: {
              codexErrorInfo: {
                responseStreamDisconnected: { httpStatusCode: null },
              },
            },
          },
        },
        sse_event_id: eventId,
        created_at: "2026-07-18T08:00:14.000Z",
      })}\n\n`,
    })

    renderApp()

    expect(
      await screen.findByText("正在重新连接 1/5", { exact: true })
    ).toBeVisible()
    expect(screen.queryByText("连接正在恢复", { exact: true })).toBeNull()
    expect(
      JSON.parse(
        window.localStorage.getItem(`${nativeReconnectStorageKeyPrefix}:c1`) ??
          "null"
      )
    ).toMatchObject({
      conversationId: "c1",
      turnId,
      phase: "reconnecting",
      round: 1,
      attempt: 1,
    })
  })

  it("keeps normal thinking for retryable native errors that are not stream disconnects", async () => {
    const turnId = "30000000-0000-4000-8000-000000000002"
    const eventId = "c1:15"
    installApiMock({
      conversationOverride: {
        messages: [
          {
            id: "m1",
            role: "user",
            turn_id: turnId,
            content: "继续完成",
          },
          {
            id: "m2",
            role: "assistant",
            turn_id: turnId,
            content: "正在核对实现。",
          },
        ],
        turns: [{ id: turnId, status: "running" }],
        running_turn: { id: turnId, status: "running" },
      },
      eventStreamBody: `id: ${eventId}\nevent: error\ndata: ${JSON.stringify({
        id: "60000000-0000-4000-8000-000000000015",
        conversation_id: "20000000-0000-4000-8000-000000000001",
        turn_id: turnId,
        sequence_no: 15,
        event_type: "error",
        visibility: "user_collapsed",
        payload: {
          schema_version: 2,
          source: "codex_app_server",
          method: "error",
          params: {
            threadId: "thread-native-1",
            turnId: "turn-native-1",
            willRetry: true,
            error: { codexErrorInfo: "serverOverloaded" },
          },
        },
        sse_event_id: eventId,
        created_at: "2026-07-18T08:00:15.000Z",
      })}\n\n`,
    })

    renderApp()

    expect(await screen.findByText("正在思考", { exact: true })).toBeVisible()
    expect(screen.queryByText("正在重新连接 1/5", { exact: true })).toBeNull()
    expect(
      window.localStorage.getItem(`${nativeReconnectStorageKeyPrefix}:c1`)
    ).toBeNull()
  })

  it("interrupts an exhausted turn, stops loading, and marks the task with a red warning", async () => {
    window.localStorage.setItem(
      `${nativeReconnectStorageKeyPrefix}:c1`,
      JSON.stringify({
        version: 2,
        conversationId: "c1",
        turnId: "turn-1",
        phase: "failed",
        round: 3,
        attempt: 5,
        startedAtMs: Date.now() - 75_000,
        nextAttemptAtMs: null,
      })
    )
    const { requests } = installApiMock()

    renderApp()

    const inlineError = await screen.findByRole("alert", undefined, {
      timeout: 15_000,
    })
    expect(inlineError).toHaveTextContent(
      "stream disconnected before completion."
    )
    await waitFor(() => {
      expect(requests).toContainEqual(
        expect.objectContaining({
          path: "/api/v1/conversations/c1/turns/turn-1/interrupt",
          method: "POST",
        })
      )
    })

    const sidebar = screen.getByRole("complementary", {
      name: "LinkSense 导航",
    })
    const title = within(sidebar).getByText("活动风险评估")
    const item = title.closest(".sidebar-conversation-item")
    const link = title.closest("a")
    expect(item).toHaveAttribute("data-warning", "true")
    expect(item).not.toHaveAttribute("data-running")
    expect(link).not.toHaveAttribute("aria-busy")
    const warning = within(item as HTMLElement).getByRole("img", {
      name: "任务因流连接中断而终止",
    })
    expect(warning).toHaveClass(
      "sidebar-conversation-warning",
      "text-[var(--destructive)]"
    )
    expect(warning.querySelector(".lucide-circle-alert")).toHaveClass(
      "size-3.5"
    )
    expect(
      within(item as HTMLElement).queryByRole("status", { name: "执行中" })
    ).toBeNull()

    expect(screen.queryByRole("button", { name: "停止" })).toBeNull()
    expect(screen.getByRole("button", { name: "发送" })).toHaveAttribute(
      "aria-disabled",
      "true"
    )
    const summary = screen.getByTestId("turn-summary-turn-1")
    expect(within(summary).getByText("已中断", { exact: true })).toBeVisible()
    expect(summary.querySelector('[aria-busy="true"]')).toBeNull()
    expect(summary.querySelector(".animate-spin")).toBeNull()
    expect(summary.querySelector(".shimmer")).toBeNull()
  })

  it("derives the same operation id after a reload for the same saved draft version", async () => {
    const payload = {
      operation: "turn_steer",
      conversation_id: "c1",
      turn_id: "turn-1",
      draft_updated_at: "2026-07-11T08:00:01.000Z",
    }
    const first = await stableOperationId({ current: null }, payload)
    const afterReload = await stableOperationId({ current: null }, payload)
    const nextDraft = await stableOperationId(
      { current: null },
      { ...payload, draft_updated_at: "2026-07-11T08:00:02.000Z" }
    )

    expect(afterReload).toBe(first)
    expect(nextDraft).not.toBe(first)
    expect(first).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
    )
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

  it("renders the protected Codex-style shell and conversation controls", async () => {
    installApiMock()
    renderApp()

    expect(
      await screen.findByRole("log", undefined, { timeout: 3_000 })
    ).toBeInTheDocument()
    expect(screen.getByRole("main")).toBeInTheDocument()
    expect(
      screen.getByRole("complementary", { name: "LinkSense 导航" })
    ).toBeInTheDocument()
    expect(screen.getByRole("banner")).toBeInTheDocument()
    expect(screen.getByRole("form", { name: "任务输入框" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "添加" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "语音输入" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "停止" })).toBeInTheDocument()
  })

  it("refreshes a stale running conversation after the interrupt target is already terminal", async () => {
    const interaction = userEvent.setup()
    const { requests } = installApiMock({
      interruptResponse: () =>
        json(
          {
            success: true,
            data: { code: "TURN_INTERRUPT_NOT_ACTIVE" },
          },
          202
        ),
      conversationGetResponse: async (callIndex) =>
        json({
          success: true,
          data:
            callIndex === 1
              ? conversation
              : {
                  ...conversation,
                  execution_status: "completed",
                  running_turn: null,
                  turns: [{ id: "turn-1", status: "completed" }],
                },
        }),
    })
    renderApp()

    await interaction.click(await screen.findByRole("button", { name: "停止" }))

    await waitFor(() => {
      expect(
        requests.filter(
          (request) =>
            request.path === "/api/v1/conversations/c1" &&
            request.method === "GET"
        ).length
      ).toBeGreaterThanOrEqual(2)
    })
    expect(screen.queryByRole("button", { name: "停止" })).toBeNull()
    expect(screen.queryByRole("alert")).toBeNull()
  })

  it("keeps interrupted streamed output after terminal refresh and page remount", async () => {
    const partialText = "这段已经输出的内容需要保留。"
    const partialMessageId = "60000000-0000-4000-8000-000000000041"
    const nativeItemId = "native-interrupted-message"
    const localTurnId = "30000000-0000-4000-8000-000000000041"
    let releaseEventStream: (() => void) | undefined
    const eventStreamStart = new Promise<void>((resolve) => {
      releaseEventStream = resolve
    })
    const event = (
      sequence: number,
      eventType: string,
      payload: Record<string, unknown>
    ) => {
      const eventId = `c1:${sequence}`
      return `id: ${eventId}\nevent: ${eventType}\ndata: ${JSON.stringify({
        id: `61000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
        conversation_id: "20000000-0000-4000-8000-000000000001",
        turn_id: localTurnId,
        sequence_no: sequence,
        event_type: eventType,
        visibility: "user_visible",
        payload,
        sse_event_id: eventId,
        created_at: `2026-08-29T08:00:${String(sequence).padStart(2, "0")}.000Z`,
      })}\n\n`
    }
    const nativePayload = (
      method: string,
      params: Record<string, unknown>
    ) => ({
      schema_version: 2,
      source: "codex_app_server",
      method,
      params,
    })
    const interruptedDetail = {
      ...conversation,
      execution_status: "interrupted",
      running_turn: null,
      turns: [{ id: localTurnId, status: "interrupted" }],
      last_event_id: "c1:44",
      messages: [
        ...conversation.messages,
        {
          id: partialMessageId,
          role: "assistant",
          turn_id: localTurnId,
          content: partialText,
          created_at: "2026-08-29T08:00:41.000Z",
        },
      ],
    }
    const eventStreamBody = [
      event(
        41,
        "item/agentMessage/delta",
        nativePayload("item/agentMessage/delta", {
          threadId: "native-thread-1",
          turnId: "native-turn-1",
          itemId: nativeItemId,
          delta: partialText,
        })
      ),
      event(42, "conversation.message.completed", {
        schema_version: 1,
        message_id: partialMessageId,
        role: "assistant",
        item_id: nativeItemId,
      }),
      event(
        43,
        "turn/completed",
        nativePayload("turn/completed", {
          threadId: "native-thread-1",
          turn: { id: "native-turn-1", status: "interrupted" },
        })
      ),
    ].join("")
    const { requests } = installApiMock({
      eventStreamBody,
      eventStreamStart,
      conversationGetResponse: async (callIndex) =>
        json({
          success: true,
          data:
            callIndex === 1
              ? {
                  ...conversation,
                  turns: [{ id: localTurnId, status: "running" }],
                  running_turn: { id: localTurnId, status: "running" },
                }
              : interruptedDetail,
        }),
    })

    const firstMount = renderApp()

    await screen.findByRole("log", undefined, { timeout: 10_000 })
    await act(async () => {
      releaseEventStream?.()
      await eventStreamStart
    })
    await waitFor(
      () => {
        const messages = screen.getAllByText(partialText)
        expect(messages).toHaveLength(1)
        expect(messages[0]).toBeVisible()
      },
      { timeout: 10_000 }
    )
    await waitFor(
      () => {
        expect(
          requests.filter(
            (request) =>
              request.path === "/api/v1/conversations/c1" &&
              request.method === "GET"
          ).length
        ).toBeGreaterThanOrEqual(2)
        expect(screen.getAllByText(partialText)).toHaveLength(1)
      },
      { timeout: 10_000 }
    )

    firstMount.unmount()
    renderApp()

    await waitFor(
      () => {
        const messages = screen.getAllByText(partialText)
        expect(messages).toHaveLength(1)
        expect(messages[0]).toBeVisible()
      },
      { timeout: 10_000 }
    )
  }, 30_000)

  it("uploads all pasted files one at a time", async () => {
    let resolveFirstUpload: ((response: Response) => void) | undefined
    const firstUpload = new Promise<Response>((resolve) => {
      resolveFirstUpload = resolve
    })
    const uploadedNames: string[] = []
    const documentFile = new File(["document"], "requirements.pdf", {
      type: "application/pdf",
    })
    const imageFile = new File(["image"], "reference.png", {
      type: "image/png",
    })
    const { requests } = installApiMock({
      conversationOverride: {
        turns: [],
        running_turn: null,
        execution_status: "idle",
      },
      attachmentUploadResponse: (formData, callIndex) => {
        const file = formData.get("file")
        uploadedNames.push(file instanceof File ? file.name : "")
        if (callIndex === 1) return firstUpload
        return json({
          success: true,
          data: {
            id: `attachment-${callIndex}`,
            name: file instanceof File ? file.name : "attachment",
            kind: "attachment",
            size: file instanceof File ? file.size : 0,
          },
        })
      },
    })
    renderApp()

    const input = await screen.findByRole(
      "textbox",
      { name: "任务输入框" },
      { timeout: 10_000 }
    )
    await waitFor(
      () => expect(screen.getByLabelText("添加附件")).toBeEnabled(),
      { timeout: 10_000 }
    )
    const pasteEvent = createEvent.paste(input)
    Object.defineProperty(pasteEvent, "clipboardData", {
      configurable: true,
      value: {
        files: [documentFile, imageFile],
        items: [
          {
            kind: "file",
            type: documentFile.type,
            getAsFile: () => documentFile,
          },
        ],
      },
    })

    fireEvent(input, pasteEvent)

    await waitFor(() => expect(uploadedNames).toEqual([documentFile.name]), {
      timeout: 10_000,
    })
    expect(
      requests.filter(
        (request) =>
          request.path === "/api/v1/conversations/c1/attachments" &&
          request.method === "POST"
      )
    ).toHaveLength(1)

    resolveFirstUpload?.(
      json({
        success: true,
        data: {
          id: "attachment-1",
          name: documentFile.name,
          kind: "attachment",
          size: documentFile.size,
        },
      })
    )

    await waitFor(
      () => expect(uploadedNames).toEqual([documentFile.name, imageFile.name]),
      { timeout: 10_000 }
    )
    await waitFor(() =>
      expect(
        requests.filter(
          (request) =>
            request.path === "/api/v1/conversations/c1/attachments" &&
            request.method === "POST"
        )
      ).toHaveLength(2)
    )
  }, 20_000)

  it("skips meaningless temporary files from folder attachment uploads", async () => {
    const interaction = userEvent.setup()
    const uploadedNames: string[] = []
    const usefulFile = new File(["model"], "model.weights", {
      type: "application/octet-stream",
    })
    const macMetadata = new File(["metadata"], ".DS_Store", {
      type: "application/octet-stream",
    })
    const resourceFork = new File(["fork"], "._model.weights", {
      type: "application/octet-stream",
    })
    Object.defineProperty(usefulFile, "webkitRelativePath", {
      configurable: true,
      value: "project/model.weights",
    })
    Object.defineProperty(macMetadata, "webkitRelativePath", {
      configurable: true,
      value: "project/.DS_Store",
    })
    Object.defineProperty(resourceFork, "webkitRelativePath", {
      configurable: true,
      value: "project/__MACOSX/._model.weights",
    })
    const { requests } = installApiMock({
      conversationOverride: {
        turns: [],
        running_turn: null,
        execution_status: "idle",
      },
      attachmentUploadResponse: (formData) => {
        const file = formData.get("file")
        uploadedNames.push(file instanceof File ? file.name : "")
        return json({
          success: true,
          data: {
            id: `attachment-${uploadedNames.length}`,
            name: file instanceof File ? file.name : "attachment",
            kind: "attachment",
            size: file instanceof File ? file.size : 0,
          },
        })
      },
    })
    renderApp()

    const folderInput = await screen.findByLabelText("添加文件夹", undefined, {
      timeout: 10_000,
    })
    await waitFor(() => expect(folderInput).toBeEnabled(), { timeout: 10_000 })
    await interaction.upload(folderInput, [
      usefulFile,
      macMetadata,
      resourceFork,
    ])

    await waitFor(() => expect(uploadedNames).toEqual(["model.weights"]))
    expect(
      requests.filter(
        (request) =>
          request.path === "/api/v1/conversations/c1/attachments" &&
          request.method === "POST"
      )
    ).toHaveLength(1)
  })

  it("shows an error when every selected attachment is a temporary file", async () => {
    const interaction = userEvent.setup()
    const macMetadata = new File(["metadata"], ".DS_Store", {
      type: "application/octet-stream",
    })
    Object.defineProperty(macMetadata, "webkitRelativePath", {
      configurable: true,
      value: "project/.DS_Store",
    })
    const { requests } = installApiMock({
      conversationOverride: {
        turns: [],
        running_turn: null,
        execution_status: "idle",
      },
    })
    renderApp()

    const folderInput = await screen.findByLabelText("添加文件夹", undefined, {
      timeout: 10_000,
    })
    await waitFor(() => expect(folderInput).toBeEnabled(), { timeout: 10_000 })
    await interaction.upload(folderInput, macMetadata)

    expect(
      await screen.findByText("已跳过临时文件，请选择其他有意义的文件。")
    ).toBeInTheDocument()
    expect(
      requests.filter(
        (request) =>
          request.path === "/api/v1/conversations/c1/attachments" &&
          request.method === "POST"
      )
    ).toHaveLength(0)
  })

  it("shows the compact message rail at rest and reveals cached task messages on hover", async () => {
    const { requests } = installApiMock({
      conversationOverride: {
        messages: [
          { id: "m1", role: "user", content: "请评估活动风险" },
          {
            id: "m2",
            role: "assistant",
            content: "正在整理风险与建议。",
          },
          { id: "m3", role: "user", content: "再检查天气影响" },
          {
            id: "m4",
            role: "assistant",
            content: "已补充恶劣天气预案。",
          },
        ],
        turns: [{ id: "turn-1", status: "completed" }],
        running_turn: null,
        execution_status: "completed",
      },
    })
    const interaction = userEvent.setup()
    renderApp()

    const messageNavigation = await screen.findByRole("navigation", {
      name: "任务消息导航",
    })
    expect(within(messageNavigation).getAllByRole("button")).toHaveLength(2)
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    expect(screen.getByTestId("conversation-line-m1")).toHaveClass(
      "[--line-effect:0]"
    )

    const detailRequestCount = requests.filter(
      (request) =>
        request.path === "/api/v1/conversations/c1" && request.method === "GET"
    ).length
    await interaction.hover(
      within(messageNavigation).getByRole("button", {
        name: "请评估活动风险",
      })
    )

    const preview = screen.getByRole("dialog", {
      name: "请评估活动风险",
    })
    expect(within(preview).getByText("请评估活动风险")).toBeVisible()
    expect(within(preview).getByText("正在整理风险与建议。")).toBeVisible()
    expect(
      requests.filter(
        (request) =>
          request.path === "/api/v1/conversations/c1" &&
          request.method === "GET"
      )
    ).toHaveLength(detailRequestCount)

    await interaction.unhover(
      within(messageNavigation).getByRole("button", {
        name: "请评估活动风险",
      })
    )
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    )

    const targetMessage = screen.getAllByRole("article", {
      name: "用户消息",
    })[1]
    await interaction.click(
      within(messageNavigation).getByRole("button", {
        name: "再检查天气影响",
      })
    )
    expect(targetMessage).toHaveAttribute("id", "conversation-message-m3")
  })

  it("closes the confirmation dialog after deleting the current task", async () => {
    let conversationListRequestCount = 0
    let resolveConversationListRefresh!: (response: Response) => void
    const conversationListRefresh = new Promise<Response>((resolve) => {
      resolveConversationListRefresh = resolve
    })
    const { requests } = installApiMock({
      conversationListResponse: () => {
        conversationListRequestCount += 1
        return conversationListRequestCount === 1
          ? json({
              success: true,
              data: { items: conversations, next_cursor: null },
            })
          : conversationListRefresh
      },
    })
    const interaction = userEvent.setup()
    renderApp()

    expect(await screen.findByRole("log")).toBeInTheDocument()
    await interaction.click(screen.getByRole("button", { name: "操作" }))
    await interaction.click(
      await screen.findByRole("menuitem", { name: "删除任务" })
    )

    const dialog = await screen.findByRole("dialog", {
      name: "永久删除任务？",
    })
    const deleteButton = within(dialog).getByRole("button", { name: "删除" })
    expect(deleteButton).toHaveClass(
      "bg-destructive",
      "text-destructive-foreground"
    )
    await interaction.click(deleteButton)

    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "永久删除任务？" })
      ).not.toBeInTheDocument()
    )
    expect(
      await screen.findByRole("heading", { name: "未命名任务" })
    ).toBeVisible()
    resolveConversationListRefresh(
      json({
        success: true,
        data: { items: conversations.slice(1), next_cursor: null },
      })
    )
    expect(requests).toContainEqual(
      expect.objectContaining({
        path: "/api/v1/conversations/c1",
        method: "DELETE",
      })
    )
  })

  it("groups current task actions and leaves the task after archiving it", async () => {
    const { requests } = installApiMock()
    const interaction = userEvent.setup()
    renderApp()

    const banner = await screen.findByRole("banner")
    const title = within(banner).getByRole("heading", {
      name: conversations[0]!.title,
    })
    const titleActions = title.parentElement
    expect(titleActions).not.toBeNull()
    expect(titleActions).toHaveClass("conversation-title-actions", "gap-1")
    expect(
      titleActions?.querySelector(".conversation-title-application-icon")
    ).toBeNull()
    expect(within(banner).getAllByRole("button")).toHaveLength(3)
    expect(within(banner).getByRole("button", { name: "分享" })).toBeVisible()
    expect(
      within(banner).getByRole("button", { name: "关闭任务概览" })
    ).toBeVisible()

    const actionsButton = within(titleActions as HTMLElement).getByRole(
      "button",
      { name: "操作" }
    )
    expect(actionsButton.querySelector("svg")).toHaveClass(
      "text-[var(--app-muted)]",
      "opacity-70"
    )
    await interaction.click(actionsButton)

    const renameItem = await screen.findByRole("menuitem", {
      name: "重命名",
    })
    expect(renameItem).toBeVisible()
    const archiveItem = screen.getByRole("menuitem", { name: "归档任务" })
    const deleteItem = screen.getByRole("menuitem", { name: "删除任务" })
    expect(archiveItem).toBeVisible()
    expect(deleteItem).toBeVisible()
    for (const item of [renameItem, archiveItem]) {
      expect(item.querySelector("svg")).toHaveClass(
        "size-3.5",
        "text-[var(--app-muted)]",
        "opacity-70"
      )
    }
    expect(deleteItem.querySelector("svg")).toHaveClass(
      "size-3.5",
      "opacity-70"
    )

    await interaction.click(archiveItem)

    await waitFor(() =>
      expect(requests).toContainEqual(
        expect.objectContaining({
          path: "/api/v1/conversations/c1",
          method: "PATCH",
          body: { archive_status: "archived" },
        })
      )
    )
    expect(
      await screen.findByRole("heading", { name: "未命名任务" })
    ).toBeVisible()
  })

  it("pins and unpins the current task from the title actions menu", async () => {
    const { requests } = installApiMock()
    const interaction = userEvent.setup()
    renderApp()

    const banner = await screen.findByRole("banner")
    const actionsButton = within(banner).getByRole("button", { name: "操作" })

    await interaction.click(actionsButton)
    const pinItem = await screen.findByRole("menuitem", {
      name: "置顶任务",
    })
    expect(pinItem.querySelector('[data-icon="conversation-pin"]')).toHaveClass(
      "size-3.5",
      "text-[var(--app-muted)]",
      "opacity-70"
    )
    await interaction.click(pinItem)

    await waitFor(() =>
      expect(requests).toContainEqual(
        expect.objectContaining({
          path: "/api/v1/conversations/c1",
          method: "PATCH",
          body: { pinned: true },
        })
      )
    )

    await interaction.click(actionsButton)
    const unpinItem = await screen.findByRole("menuitem", {
      name: "取消置顶",
    })
    expect(
      unpinItem.querySelector('[data-icon="conversation-pin-filled"]')
    ).toHaveClass("size-3.5", "text-[var(--app-muted)]", "opacity-70")
    await interaction.click(unpinItem)

    await waitFor(() =>
      expect(requests).toContainEqual(
        expect.objectContaining({
          path: "/api/v1/conversations/c1",
          method: "PATCH",
          body: { pinned: false },
        })
      )
    )
  })

  it("uses a larger restore icon for an archived current task", async () => {
    installApiMock({
      conversationOverride: {
        archived: true,
        archive_status: "archived",
      },
    })
    const interaction = userEvent.setup()
    renderApp()

    const banner = await screen.findByRole("banner")
    await interaction.click(
      within(banner).getByRole("button", { name: "操作" })
    )

    const unarchiveItem = await screen.findByRole("menuitem", {
      name: "取消归档",
    })
    expect(
      unarchiveItem.querySelector('[data-icon="conversation-unarchive"]')
    ).toHaveClass("size-4", "text-[var(--app-muted)]", "opacity-70")
  })

  it("reconciles a completed turn when the event stream disconnects before the terminal event", async () => {
    let releaseCompletedDetail: (() => void) | undefined
    let listRequestCount = 0
    const completedDetailReady = new Promise<void>((resolve) => {
      releaseCompletedDetail = resolve
    })
    const { requests } = installApiMock({
      eventStreamUnavailable: true,
      conversationListResponse: () => {
        listRequestCount += 1
        return json({
          success: true,
          data: {
            items: conversations.map((item) =>
              item.id === "c1"
                ? {
                    ...item,
                    execution_status:
                      listRequestCount === 1 ? "running" : "completed",
                  }
                : item
            ),
            next_cursor: null,
          },
        })
      },
      conversationGetResponse: async (callIndex) => {
        if (callIndex === 1) {
          return json({ success: true, data: conversation })
        }

        await completedDetailReady
        return json({
          success: true,
          data: {
            ...conversation,
            execution_status: "completed",
            running_turn: null,
            turns: [{ id: "turn-1", status: "completed" }],
            messages: [
              ...conversation.messages,
              {
                id: "m3",
                role: "assistant",
                content: "任务已经完成。",
                turn_id: "turn-1",
              },
            ],
          },
        })
      },
    })
    renderApp()

    expect(
      await screen.findByRole("button", { name: "停止" }, { timeout: 3_000 })
    ).toBeInTheDocument()
    expect(
      await screen.findByText("连接正在恢复", undefined, { timeout: 3_000 })
    ).toBeVisible()

    releaseCompletedDetail?.()

    expect(
      await screen.findByText("任务已经完成。", undefined, { timeout: 3_000 })
    ).toBeVisible()
    expect(screen.getByText("用时", { exact: true })).toBeVisible()
    expect(
      screen.queryByRole("button", { name: "停止" })
    ).not.toBeInTheDocument()
    expect(screen.queryByText("连接正在恢复")).not.toBeInTheDocument()
    const sidebar = screen.getByRole("complementary", {
      name: "LinkSense 导航",
    })
    const sidebarTaskTitle = within(sidebar).getByText(conversations[0]!.title)
    const sidebarTask = sidebarTaskTitle.closest(".sidebar-conversation-item")
    expect(sidebarTask).not.toBeNull()
    await waitFor(() => {
      expect(sidebarTaskTitle.closest("a")).not.toHaveAttribute("aria-busy")
      expect(
        within(sidebarTask as HTMLElement).queryByRole("status", {
          name: "执行中",
        })
      ).not.toBeInTheDocument()
    })
    await waitFor(() => {
      expect(
        requests.filter(
          (request) =>
            request.path === "/api/v1/conversations/c1" &&
            request.method === "GET"
        ).length
      ).toBeGreaterThanOrEqual(2)
    })
    expect(
      requests.filter(
        (request) =>
          request.path === "/api/v1/conversations" && request.method === "GET"
      )
    ).toHaveLength(2)
  }, 10_000)

  it("refreshes the sidebar when the initial detail already contains a terminal turn", async () => {
    let releaseCompletedDetail: ((response: Response) => void) | undefined
    let listRequestCount = 0
    const completedDetail = new Promise<Response>((resolve) => {
      releaseCompletedDetail = resolve
    })
    const { requests } = installApiMock({
      eventStreamUnavailable: true,
      conversationListResponse: () => {
        listRequestCount += 1
        return json({
          success: true,
          data: {
            items: conversations.map((item) =>
              item.id === "c1"
                ? {
                    ...item,
                    execution_status:
                      listRequestCount === 1 ? "running" : "completed",
                  }
                : item
            ),
            next_cursor: null,
          },
        })
      },
      conversationGetResponse: async () => completedDetail,
    })
    renderApp()

    const sidebar = await screen.findByRole(
      "complementary",
      { name: "LinkSense 导航" },
      { timeout: 3_000 }
    )
    const sidebarTaskTitle = await within(sidebar).findByText(
      conversations[0]!.title
    )
    expect(sidebarTaskTitle.closest("a")).toHaveAttribute("aria-busy", "true")

    releaseCompletedDetail?.(
      json({
        success: true,
        data: {
          ...conversation,
          execution_status: "completed",
          running_turn: null,
          turns: [{ id: "turn-1", status: "completed" }],
          last_event_id: "c1:completed",
          messages: [
            ...conversation.messages,
            {
              id: "m3",
              role: "assistant",
              content: "任务已经完成。",
            },
          ],
        },
      })
    )

    expect(await screen.findByText("任务已经完成。")).toBeVisible()
    await waitFor(() => {
      expect(sidebarTaskTitle.closest("a")).not.toHaveAttribute("aria-busy")
      expect(
        within(sidebar).queryByRole("status", { name: "执行中" })
      ).not.toBeInTheDocument()
    })
    expect(
      requests.filter(
        (request) =>
          request.path === "/api/v1/conversations" && request.method === "GET"
      )
    ).toHaveLength(2)
  })

  it("does not poll conversation detail while its event stream remains connected", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { requests } = installApiMock()
    renderApp()

    expect(
      await screen.findByRole("button", { name: "停止" })
    ).toBeInTheDocument()
    await waitFor(() => {
      expect(
        requests.filter(
          (request) =>
            request.path === "/api/v1/conversations/c1" &&
            request.method === "GET"
        )
      ).toHaveLength(1)
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_500)
    })

    expect(
      requests.filter(
        (request) =>
          request.path === "/api/v1/conversations/c1" &&
          request.method === "GET"
      )
    ).toHaveLength(1)
    expect(
      requests.filter(
        (request) =>
          request.path === "/api/v1/conversations" && request.method === "GET"
      )
    ).toHaveLength(1)
  })

  it("refreshes a background running task until its completion indicator is visible", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    let listRequestCount = 0
    const { requests } = installApiMock({
      conversationListResponse: () => {
        listRequestCount += 1
        return json({
          success: true,
          data: {
            items: conversations.map((item) =>
              item.id === "c2"
                ? {
                    ...item,
                    execution_status:
                      listRequestCount === 1 ? "running" : "completed",
                    has_unread_completion: listRequestCount > 1,
                  }
                : item
            ),
            next_cursor: null,
          },
        })
      },
    })
    renderApp()

    const sidebar = await screen.findByRole("complementary", {
      name: "LinkSense 导航",
    })
    const backgroundTaskTitle = await within(sidebar).findByText(
      conversations[1]!.title
    )
    const backgroundTaskLink = backgroundTaskTitle.closest("a")
    expect(backgroundTaskLink).toHaveAttribute("aria-busy", "true")

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500)
    })

    await waitFor(() => {
      expect(backgroundTaskLink).not.toHaveAttribute("aria-busy")
      expect(
        within(sidebar).getByRole("status", {
          name: "任务已完成，尚未查看",
        })
      ).toBeVisible()
    })
    expect(
      requests.filter(
        (request) =>
          request.path === "/api/v1/conversations" && request.method === "GET"
      )
    ).toHaveLength(2)
  })

  it("keeps recent conversations as title-only rows without textual execution status", async () => {
    installApiMock()
    renderApp()
    const sidebar = await screen.findByRole("complementary", {
      name: "LinkSense 导航",
    })

    for (const item of conversations) {
      expect(await within(sidebar).findByText(item.title)).toBeVisible()
    }
    expect(sidebar.querySelector("time")).toBeNull()
    for (const status of ["执行中", "已完成", "待执行", "已中断"]) {
      expect(
        within(sidebar).queryByText(status, { exact: true })
      ).not.toBeInTheDocument()
      expect(
        within(screen.getByRole("banner")).queryByText(status, { exact: true })
      ).not.toBeInTheDocument()
    }
  })

  it("shows an unread completion dot until the user opens the completed task", async () => {
    const interaction = userEvent.setup()
    const { requests } = installApiMock({
      conversationListResponse: () =>
        json({
          success: true,
          data: {
            items: [
              conversations[0],
              { ...conversations[1], has_unread_completion: true },
            ],
            next_cursor: null,
          },
        }),
    })
    renderApp()

    const sidebar = await screen.findByRole(
      "complementary",
      { name: "LinkSense 导航" },
      { timeout: 3_000 }
    )
    const unreadDot = await within(sidebar).findByRole("status", {
      name: "任务已完成，尚未查看",
    })
    const completedTaskLink = within(sidebar)
      .getByText(conversations[1].title)
      .closest("a")
    expect(completedTaskLink).not.toBeNull()
    expect(unreadDot).toBeVisible()

    await interaction.click(completedTaskLink as HTMLAnchorElement)

    expect(
      within(sidebar).queryByRole("status", {
        name: "任务已完成，尚未查看",
      })
    ).not.toBeInTheDocument()
    await waitFor(() => {
      expect(requests).toContainEqual(
        expect.objectContaining({
          path: "/api/v1/conversations/c2",
          method: "PATCH",
          body: { completion_read: true },
        })
      )
    })
  })

  it("prioritizes the running indicator over a stale unread completion marker", async () => {
    const runningUnreadConversation = {
      ...conversations[1],
      execution_status: "running" as const,
      last_turn_status: "completed" as const,
      has_unread_completion: true,
    }
    installApiMock({
      conversationListResponse: () =>
        json({
          success: true,
          data: {
            items: [conversations[0], runningUnreadConversation],
            next_cursor: null,
          },
        }),
    })
    renderApp()

    const sidebar = await screen.findByRole(
      "complementary",
      { name: "LinkSense 导航" },
      { timeout: 3_000 }
    )
    const runningTitle = await within(sidebar).findByText(
      runningUnreadConversation.title
    )
    const runningItem = runningTitle.closest(".sidebar-conversation-item")
    const runningLink = runningTitle.closest("a")
    expect(runningItem).not.toBeNull()
    expect(runningLink).toHaveAttribute("aria-busy", "true")
    expect(
      within(runningItem as HTMLElement).getByRole("status", {
        name: "执行中",
      })
    ).toBeVisible()
    expect(
      within(runningItem as HTMLElement).queryByRole("status", {
        name: "任务已完成，尚未查看",
      })
    ).not.toBeInTheDocument()
    expect(
      within(runningItem as HTMLElement).queryByRole("status", {
        name: "任务执行失败，尚未查看",
      })
    ).not.toBeInTheDocument()
  })

  it("shows an unread failure icon until the user opens the failed task", async () => {
    const interaction = userEvent.setup()
    const failedConversation = {
      ...conversations[1],
      execution_status: "failed" as const,
      last_turn_status: "failed" as const,
      has_unread_completion: true,
    }
    const { requests } = installApiMock({
      conversationListResponse: () =>
        json({
          success: true,
          data: {
            items: [conversations[0], failedConversation],
            next_cursor: null,
          },
        }),
    })
    renderApp()

    const sidebar = await screen.findByRole(
      "complementary",
      { name: "LinkSense 导航" },
      { timeout: 3_000 }
    )
    const unreadFailure = await within(sidebar).findByRole("status", {
      name: "任务执行失败，尚未查看",
    })
    const failedTaskLink = within(sidebar)
      .getByText(failedConversation.title)
      .closest("a")
    expect(failedTaskLink).not.toBeNull()
    expect(unreadFailure).toBeVisible()
    expect(unreadFailure).toHaveClass("text-destructive")
    expect(unreadFailure.querySelector("svg")).not.toBeNull()

    await interaction.click(failedTaskLink as HTMLAnchorElement)

    expect(
      within(sidebar).queryByRole("status", {
        name: "任务执行失败，尚未查看",
      })
    ).not.toBeInTheDocument()
    await waitFor(() => {
      expect(requests).toContainEqual(
        expect.objectContaining({
          path: "/api/v1/conversations/c2",
          method: "PATCH",
          body: { completion_read: true },
        })
      )
    })
  })

  it("does not show an unread result indicator for the task that is already open", async () => {
    const { requests } = installApiMock({
      conversationListResponse: () =>
        json({
          success: true,
          data: {
            items: [
              {
                ...conversations[0],
                execution_status: "failed",
                last_turn_status: "failed",
                has_unread_completion: true,
              },
              conversations[1],
            ],
            next_cursor: null,
          },
        }),
    })
    renderApp()

    const sidebar = await screen.findByRole(
      "complementary",
      { name: "LinkSense 导航" },
      { timeout: 3_000 }
    )
    expect(
      within(sidebar).queryByRole("status", {
        name: "任务已完成，尚未查看",
      })
    ).not.toBeInTheDocument()
    expect(
      within(sidebar).queryByRole("status", {
        name: "任务执行失败，尚未查看",
      })
    ).not.toBeInTheDocument()
    await waitFor(() => {
      expect(requests).toContainEqual(
        expect.objectContaining({
          path: "/api/v1/conversations/c1",
          method: "PATCH",
          body: { completion_read: true },
        })
      )
    })
  })

  it("shows an application icon before each application-managed task title", async () => {
    const applicationName = "AISG学校政策问答助手"
    const fallbackApplicationName = "默认图标应用"
    installApiMock({
      conversationListResponse: () =>
        json({
          success: true,
          data: {
            items: [
              {
                ...conversations[0],
                title: applicationName,
                application: {
                  id: "50000000-0000-4000-8000-000000000001",
                  name: applicationName,
                  icon: { type: "preset", preset: "graduation-cap" },
                },
              },
              {
                ...conversations[1],
                title: fallbackApplicationName,
                application: {
                  id: "50000000-0000-4000-8000-000000000002",
                  name: fallbackApplicationName,
                },
              },
              conversations[2],
            ],
            next_cursor: null,
          },
        }),
    })
    renderApp()
    const sidebar = await screen.findByRole("complementary", {
      name: "LinkSense 导航",
    })
    const applicationTitle = await within(sidebar).findByText(applicationName)
    const applicationLink = applicationTitle.closest("a")
    const fallbackTitle = within(sidebar).getByText(fallbackApplicationName)
    const fallbackLink = fallbackTitle.closest("a")
    const regularTitle = within(sidebar).getByText(conversations[2]!.title)
    const regularLink = regularTitle.closest("a")

    expect(applicationLink).not.toBeNull()
    expect(fallbackLink).not.toBeNull()
    expect(regularLink).not.toBeNull()
    const applicationIcon = applicationLink!.querySelector(
      ".sidebar-conversation-application-icon"
    )
    const fallbackIcon = fallbackLink!.querySelector(
      ".sidebar-conversation-application-icon"
    )
    const presetIcon = applicationIcon?.querySelector("svg")

    expect(applicationIcon).not.toBeNull()
    expect(applicationIcon).toHaveClass(
      "bg-transparent",
      "after:border-border/60",
      "[&_svg]:size-5"
    )
    expect(applicationIcon).not.toHaveClass("bg-muted")
    expect(
      applicationIcon?.querySelector('[data-slot="avatar-fallback"]')
    ).toHaveClass("bg-transparent", "text-muted-foreground")
    expect(presetIcon).not.toBeNull()
    expect(presetIcon?.querySelectorAll("[fill]").length).toBeGreaterThan(0)
    expect(
      applicationIcon!.compareDocumentPosition(applicationTitle) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(fallbackIcon?.querySelector("svg")).not.toBeNull()
    expect(
      regularLink!.querySelector(".sidebar-conversation-application-icon")
    ).toBeNull()
  })

  it("does not expose rename actions or shortcuts for application-managed tasks", async () => {
    const applicationName = "AISG学校政策问答助手"
    const application = {
      id: "50000000-0000-4000-8000-000000000001",
      name: applicationName,
      icon: { type: "preset" as const, preset: "graduation-cap" as const },
    }
    const applicationConversation = {
      ...conversation,
      title: applicationName,
      application,
    }
    const { requests } = installApiMock({
      conversationListResponse: () =>
        json({
          success: true,
          data: {
            items: [
              {
                ...conversations[0],
                title: applicationName,
                application,
              },
              conversations[1],
              conversations[2],
            ],
            next_cursor: null,
          },
        }),
      conversationGetResponse: async () =>
        json({ success: true, data: applicationConversation }),
    })
    const interaction = userEvent.setup()
    renderApp()

    const sidebar = await screen.findByRole("complementary", {
      name: "LinkSense 导航",
    })
    const sidebarTitle = await within(sidebar).findByText(applicationName)
    const applicationLink = sidebarTitle.closest("a")
    expect(applicationLink).not.toBeNull()
    expect(applicationLink).not.toHaveAttribute("aria-keyshortcuts")

    await interaction.dblClick(sidebarTitle)
    fireEvent.keyDown(applicationLink as HTMLAnchorElement, { key: "F2" })
    expect(
      screen.queryByRole("dialog", { name: "重命名" })
    ).not.toBeInTheDocument()

    const banner = await screen.findByRole("banner")
    await interaction.click(
      within(banner).getByRole("button", { name: "操作" })
    )
    expect(
      screen.queryByRole("menuitem", { name: "重命名" })
    ).not.toBeInTheDocument()
    expect(
      await screen.findByRole("menuitem", { name: "置顶任务" })
    ).toBeVisible()
    expect(screen.getByRole("menuitem", { name: "归档任务" })).toBeVisible()
    expect(screen.getByRole("menuitem", { name: "删除任务" })).toBeVisible()
    expect(
      requests.some(
        (request) =>
          request.method === "PATCH" &&
          typeof request.body === "object" &&
          request.body !== null &&
          "title" in request.body
      )
    ).toBe(false)
  })

  it("uses faded titles, hover details, and a running indicator in compact task rows", async () => {
    const interaction = userEvent.setup()
    const longTitle =
      "请创建 artifacts/mcp-e2e-verification 中的完整任务并验证导入结果"
    const updatedAt = "2026-07-13T08:00:00.000Z"
    installApiMock({
      conversationListResponse: () =>
        json({
          success: true,
          data: {
            items: [
              {
                ...conversations[0],
                title: longTitle,
                updated_at: updatedAt,
                execution_status: "running",
              },
              {
                ...conversations[1],
                execution_status: "completed",
              },
            ],
            next_cursor: null,
          },
        }),
    })
    renderApp()
    const sidebar = await screen.findByRole("complementary", {
      name: "LinkSense 导航",
    })
    const title = await within(sidebar).findByText(longTitle)
    const item = title.closest(".sidebar-conversation-item")
    const link = title.closest("a")

    expect(item).not.toBeNull()
    expect(link).not.toBeNull()
    expect(link).toHaveClass("sidebar-conversation-link")
    expect(link).toHaveClass("min-h-9", "py-2")
    expect(link).toHaveAttribute("aria-busy", "true")
    expect(title).toHaveClass("sidebar-conversation-title-fade", "font-medium")
    expect(title).not.toHaveClass("truncate")
    expect(title).not.toHaveClass("font-semibold")
    expect(title).not.toHaveAttribute("title")
    expect(item!.querySelector("time")).toBeNull()

    const runningStatus = within(item as HTMLElement).getByRole("status", {
      name: "执行中",
    })
    expect(runningStatus).toHaveClass(
      "sidebar-conversation-running",
      "group-hover:opacity-0",
      "group-focus-within:opacity-0"
    )
    expect(runningStatus).not.toHaveClass("transition-opacity")
    expect(runningStatus.querySelector("svg")).toHaveClass(
      "size-3.5",
      "animate-spin",
      "motion-reduce:animate-none"
    )

    const completedTitle = await within(sidebar).findByText(
      conversations[1]!.title
    )
    const completedItem = completedTitle.closest(".sidebar-conversation-item")
    expect(completedItem).not.toBeNull()
    expect(
      within(completedItem as HTMLElement).queryByRole("status")
    ).not.toBeInTheDocument()

    const pinButton = within(item as HTMLElement).getByRole("button", {
      name: /^置顶任务/u,
    })
    const archiveButton = within(item as HTMLElement).getByRole("button", {
      name: /^归档任务/u,
    })
    expect(
      within(item as HTMLElement).queryByRole("button", {
        name: /^删除任务/u,
      })
    ).not.toBeInTheDocument()
    for (const button of [pinButton, archiveButton]) {
      expect(button).toHaveClass(
        "w-5",
        "transition-none",
        "hover:bg-transparent",
        "hover:text-[var(--app-text)]",
        "dark:hover:bg-transparent"
      )
      expect(button).not.toHaveClass("hover:bg-[var(--app-sidebar-active)]")
    }
    const pinIcon = pinButton.querySelector("svg")
    const archiveIcon = archiveButton.querySelector("svg")
    expect(pinIcon).toHaveClass("size-4")
    expect(pinIcon).not.toHaveClass("size-3.5")
    expect(pinIcon).toHaveAttribute("data-icon", "sidebar-pin")
    expect(archiveIcon).toHaveClass("size-3.5")
    expect(pinIcon).toHaveAttribute("stroke-width", "2")
    expect(archiveIcon).toHaveAttribute("stroke-width", "2")
    const actions = archiveButton.parentElement
    expect(actions).toContainElement(pinButton)
    expect(actions).toContainElement(archiveButton)
    expect(actions).toHaveClass(
      "gap-1",
      "opacity-0",
      "pointer-events-none",
      "group-hover:opacity-100",
      "group-hover:pointer-events-auto",
      "group-focus-within:opacity-100",
      "group-focus-within:pointer-events-auto"
    )
    expect(actions).not.toHaveClass("transition-opacity")

    await interaction.hover(link as HTMLElement)
    const preview = await screen.findByRole("dialog", { name: longTitle })
    expect(link).toHaveAttribute("data-popup-open", "")
    expect(preview).toHaveAttribute("data-slot", "hover-card-content")
    const previewTitle = within(preview).getByText(longTitle)
    const previewTime = preview.querySelector("time")
    expect(preview).toHaveClass(
      "sidebar-conversation-preview",
      "w-72",
      "flex-col",
      "items-stretch",
      "gap-2",
      "rounded-xl",
      "border",
      "border-[var(--app-border)]",
      "bg-[var(--app-popover)]",
      "p-3.5",
      "text-[var(--app-text)]",
      "shadow-md!"
    )
    expect(previewTitle).toHaveClass(
      "sidebar-conversation-preview-title",
      "line-clamp-3",
      "w-full",
      "whitespace-normal",
      "break-words"
    )
    expect(preview).not.toHaveClass("w-56")
    expect(previewTime).toHaveAttribute("datetime", updatedAt)
    expect(previewTime).toHaveClass(
      "sidebar-conversation-preview-time",
      "block",
      "w-full",
      "text-left",
      "font-medium"
    )
    expect(previewTime).not.toHaveClass("shrink-0")
    expect(previewTime).toHaveTextContent(
      formatRelativeDate(updatedAt, "zh-CN")
    )

    await interaction.unhover(link as HTMLElement)
    await waitFor(() => {
      expect(link).not.toHaveAttribute("data-popup-open")
      expect(screen.queryByRole("dialog", { name: longTitle })).toBeNull()
    })
  })

  it("closes a task hover preview after its clicked link loses hover", async () => {
    const interaction = userEvent.setup()
    installApiMock()
    renderApp()
    const sidebar = await screen.findByRole("complementary", {
      name: "LinkSense 导航",
    })
    const title = await within(sidebar).findByText(conversations[1]!.title)
    const link = title.closest("a")
    expect(link).not.toBeNull()

    await interaction.hover(link as HTMLElement)
    expect(
      await screen.findByRole("dialog", { name: conversations[1]!.title })
    ).toBeVisible()

    await interaction.click(link as HTMLElement)
    expect(link).toHaveFocus()
    await interaction.unhover(link as HTMLElement)

    await waitFor(() => {
      expect(
        screen.queryByRole("dialog", { name: conversations[1]!.title })
      ).toBeNull()
    })
  })

  it("hides actions for a focused task while another task is hovered", async () => {
    installApiMock()
    renderApp()
    const sidebar = await screen.findByRole("complementary", {
      name: "LinkSense 导航",
    })
    const focusedTitle = await within(sidebar).findByText(
      conversations[0]!.title
    )
    const hoveredTitle = await within(sidebar).findByText(
      conversations[1]!.title
    )
    const focusedItem = focusedTitle.closest(".sidebar-conversation-item")
    const hoveredItem = hoveredTitle.closest(".sidebar-conversation-item")
    const focusedLink = focusedTitle.closest("a")

    expect(focusedItem).not.toBeNull()
    expect(hoveredItem).not.toBeNull()
    expect(focusedLink).not.toBeNull()

    const focusedArchiveButton = within(focusedItem as HTMLElement).getByRole(
      "button",
      { name: /^归档任务/u }
    )
    const focusedActions = focusedArchiveButton.parentElement
    const runningStatus = within(focusedItem as HTMLElement).getByRole(
      "status",
      { name: "执行中" }
    )

    focusedLink!.focus()
    expect(document.activeElement).toBe(focusedLink)
    expect(focusedActions).toHaveClass(
      "group-focus-within:pointer-events-auto",
      "group-focus-within:opacity-100"
    )
    expect(runningStatus).toHaveClass("group-focus-within:opacity-0")

    fireEvent.mouseEnter(hoveredItem as HTMLElement)

    expect(document.activeElement).toBe(focusedLink)
    expect(focusedActions).not.toHaveClass(
      "group-focus-within:pointer-events-auto",
      "group-focus-within:opacity-100"
    )
    expect(runningStatus).not.toHaveClass("group-focus-within:opacity-0")

    fireEvent.mouseLeave(hoveredItem as HTMLElement)

    expect(focusedActions).toHaveClass(
      "group-focus-within:pointer-events-auto",
      "group-focus-within:opacity-100"
    )
    expect(runningStatus).toHaveClass("group-focus-within:opacity-0")
  })

  it("renames a recent task from its double-click dialog", async () => {
    const { requests } = installApiMock()
    const interaction = userEvent.setup()
    renderApp()
    const sidebar = await screen.findByRole("complementary", {
      name: "LinkSense 导航",
    })
    const title = await within(sidebar).findByText(conversations[0]!.title)

    await interaction.dblClick(title)
    const dialog = await screen.findByRole("dialog", { name: "重命名" })
    const titleInput = within(dialog).getByRole("textbox", { name: "任务" })
    expect(titleInput).toHaveValue(conversations[0]!.title)
    expect(titleInput).toHaveClass("font-medium")
    expect(titleInput).toHaveClass("focus-visible:bg-input/65")
    expect(titleInput).not.toHaveClass(
      "focus-visible:border-input-focus-border"
    )

    await interaction.clear(titleInput)
    await interaction.type(titleInput, "活动安全复盘")
    await interaction.click(
      within(dialog).getByRole("button", { name: "保存" })
    )

    await waitFor(() => {
      expect(
        requests.some(
          (request) =>
            request.path === "/api/v1/conversations/c1" &&
            request.method === "PATCH" &&
            JSON.stringify(request.body) ===
              JSON.stringify({ title: "活动安全复盘" })
        )
      ).toBe(true)
    })
    expect(await within(sidebar).findByText("活动安全复盘")).toBeVisible()
    expect(
      screen.queryByRole("dialog", { name: "重命名" })
    ).not.toBeInTheDocument()
  })

  it("uses the latest task title when opening the page rename dialog", async () => {
    const latestTitle = "最新的自动任务名称"
    const conversationId = "20000000-0000-4000-8000-000000000001"
    const eventId = "20000000-0000-4000-8000-000000000002"
    const sseEventId = "c1:2"
    let releaseTitleEvent!: () => void
    const eventStreamStart = new Promise<void>((resolve) => {
      releaseTitleEvent = resolve
    })
    const { requests } = installApiMock({
      conversationGetResponse: (callIndex) =>
        Promise.resolve(
          json({
            success: true,
            data: {
              ...conversation,
              title: callIndex === 1 ? conversations[0]!.title : latestTitle,
            },
          })
        ),
      eventStreamStart,
      eventStreamBody: `id: ${sseEventId}\nevent: conversation.title.updated\ndata: ${JSON.stringify(
        {
          id: eventId,
          conversation_id: conversationId,
          turn_id: null,
          sequence_no: 2,
          event_type: "conversation.title.updated",
          visibility: "user_visible",
          payload: {
            schema_version: 1,
            title: latestTitle,
          },
          sse_event_id: sseEventId,
          created_at: "2026-07-17T08:00:02.000Z",
        }
      )}\n\n`,
    })
    const interaction = userEvent.setup()
    renderApp()

    expect(
      await screen.findByRole("heading", { name: conversations[0]!.title })
    ).toBeVisible()
    const initialWorkspace = document.querySelector(".conversation-workspace")
    const initialScroller = document.querySelector(".conversation-scroll")
    const initialComposer = screen.getByRole("form", { name: "任务输入框" })
    const initialUserMessage = screen.getByRole("article", {
      name: "用户消息",
    })

    releaseTitleEvent()
    expect(
      await screen.findByRole(
        "heading",
        { name: latestTitle },
        { timeout: 10_000 }
      )
    ).toBeVisible()
    await waitFor(() =>
      expect(
        requests.filter(
          (request) =>
            request.path === "/api/v1/conversations/c1" &&
            request.method === "GET"
        )
      ).toHaveLength(2)
    )
    expect(document.querySelector(".conversation-workspace")).toBe(
      initialWorkspace
    )
    expect(document.querySelector(".conversation-scroll")).toBe(initialScroller)
    expect(screen.getByRole("form", { name: "任务输入框" })).toBe(
      initialComposer
    )
    expect(screen.getByRole("article", { name: "用户消息" })).toBe(
      initialUserMessage
    )

    const topBar = screen.getByRole("banner")
    await interaction.click(
      within(topBar).getByRole("button", { name: "操作" })
    )
    await interaction.click(
      await screen.findByRole("menuitem", { name: "重命名" })
    )

    const dialog = await screen.findByRole("dialog", { name: "重命名" })
    expect(within(dialog).getByRole("textbox", { name: "任务" })).toHaveValue(
      latestTitle
    )
  })

  it("archives recent tasks without exposing permanent deletion in row actions", async () => {
    const { requests } = installApiMock()
    const interaction = userEvent.setup()
    renderApp()
    const sidebar = await screen.findByRole("complementary", {
      name: "LinkSense 导航",
    })

    const archiveTitle = await within(sidebar).findByText(
      conversations[1]!.title
    )
    const archiveItem = archiveTitle.closest(".sidebar-conversation-item")
    expect(archiveItem).not.toBeNull()
    await interaction.click(
      within(archiveItem as HTMLElement).getByRole("button", {
        name: /^归档任务/u,
      })
    )

    await waitFor(() => {
      expect(
        requests.some(
          (request) =>
            request.path === "/api/v1/conversations/c2" &&
            request.method === "PATCH" &&
            JSON.stringify(request.body) ===
              JSON.stringify({ archive_status: "archived" })
        )
      ).toBe(true)
      expect(
        within(sidebar).queryByText(conversations[1]!.title)
      ).not.toBeInTheDocument()
    })

    const remainingTitle = within(sidebar).getByText(conversations[2]!.title)
    const remainingItem = remainingTitle.closest(".sidebar-conversation-item")
    expect(remainingItem).not.toBeNull()
    expect(
      within(remainingItem as HTMLElement).getByRole("button", {
        name: /^置顶任务/u,
      })
    ).toBeInTheDocument()
    expect(
      within(remainingItem as HTMLElement).getByRole("button", {
        name: /^归档任务/u,
      })
    ).toBeInTheDocument()
    expect(
      within(remainingItem as HTMLElement).queryByRole("button", {
        name: /^删除任务/u,
      })
    ).not.toBeInTheDocument()
    expect(
      requests.some(
        (request) =>
          request.path === "/api/v1/conversations/c3" &&
          request.method === "DELETE"
      )
    ).toBe(false)
  })

  it("moves a pinned task into the pinned list and restores it when unpinned", async () => {
    const { requests } = installApiMock()
    const interaction = userEvent.setup()
    renderApp()
    const sidebar = await screen.findByRole("complementary", {
      name: "LinkSense 导航",
    })
    const taskTitle = conversations[1]!.title

    expect(
      within(sidebar).queryByRole("heading", { name: "置顶" })
    ).not.toBeInTheDocument()
    const taskItem = (await within(sidebar).findByText(taskTitle)).closest(
      ".sidebar-conversation-item"
    )
    expect(taskItem).not.toBeNull()
    const pinButton = within(taskItem as HTMLElement).getByRole("button", {
      name: `置顶任务“${taskTitle}”`,
    })
    expect(pinButton.querySelector("svg")).toHaveAttribute(
      "data-icon",
      "sidebar-pin"
    )
    await interaction.click(pinButton)

    await waitFor(() => {
      expect(
        requests.some(
          (request) =>
            request.path === "/api/v1/conversations/c2" &&
            request.method === "PATCH" &&
            JSON.stringify(request.body) === JSON.stringify({ pinned: true })
        )
      ).toBe(true)
      const pinnedHeading = within(sidebar).getByRole("heading", {
        name: "置顶",
      })
      expect(
        within(pinnedHeading.closest("section") as HTMLElement).getByText(
          taskTitle
        )
      ).toBeVisible()
    })

    const pinnedItem = within(sidebar)
      .getByText(taskTitle)
      .closest(".sidebar-conversation-item")
    expect(pinnedItem).not.toBeNull()
    const unpinButton = within(pinnedItem as HTMLElement).getByRole("button", {
      name: `取消置顶任务“${taskTitle}”`,
    })
    expect(unpinButton.querySelector("svg")).toHaveAttribute(
      "data-icon",
      "sidebar-pin-filled"
    )
    expect(unpinButton.querySelector("svg")).toHaveClass("size-4")
    expect(unpinButton.querySelector("svg")).toHaveAttribute(
      "stroke-width",
      "0"
    )
    await interaction.click(unpinButton)

    await waitFor(() => {
      expect(
        requests.some(
          (request) =>
            request.path === "/api/v1/conversations/c2" &&
            request.method === "PATCH" &&
            JSON.stringify(request.body) === JSON.stringify({ pinned: false })
        )
      ).toBe(true)
      expect(
        within(sidebar).queryByRole("heading", { name: "置顶" })
      ).not.toBeInTheDocument()
      const taskHeading = within(sidebar).getByRole("heading", { name: "任务" })
      expect(
        within(taskHeading.closest("section") as HTMLElement).getByText(
          taskTitle
        )
      ).toBeVisible()
    })
  })

  it("renders the persisted task order without a visible drag handle", async () => {
    const orderedTasks = [
      { ...conversations[0]!, sort_order: 2 },
      { ...conversations[1]!, sort_order: 0 },
      { ...conversations[2]!, sort_order: 1 },
    ]
    installApiMock({
      conversationListResponse: () =>
        json({
          success: true,
          data: { items: orderedTasks, next_cursor: null },
        }),
    })
    renderApp()
    const sidebar = await screen.findByRole("complementary", {
      name: "LinkSense 导航",
    })
    const firstTitle = await within(sidebar).findByText(conversations[1]!.title)
    const secondTitle = within(sidebar).getByText(conversations[2]!.title)
    const thirdTitle = within(sidebar).getByText(conversations[0]!.title)
    const firstTask = firstTitle.closest(
      ".sidebar-conversation-item"
    ) as HTMLElement
    const secondTask = secondTitle.closest(
      ".sidebar-conversation-item"
    ) as HTMLElement
    const thirdTask = thirdTitle.closest(
      ".sidebar-conversation-item"
    ) as HTMLElement

    expect(
      firstTask.compareDocumentPosition(secondTask) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(
      secondTask.compareDocumentPosition(thirdTask) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    const keyboardActivator = within(firstTask).getByRole("button", {
      name: `使用键盘调整任务“${conversations[1]!.title}”，当前第 1 位`,
    })
    expect(keyboardActivator).toBeEnabled()
    expect(keyboardActivator).toHaveClass("sr-only")
    expect(keyboardActivator.querySelector("svg")).toBeNull()
    expect(firstTask).toHaveClass("cursor-grab")

    const pinButton = within(firstTask).getByRole("button", {
      name: `置顶任务“${conversations[1]!.title}”`,
    })
    fireEvent.pointerDown(pinButton, {
      button: 0,
      clientX: 10,
      clientY: 10,
      isPrimary: true,
    })
    fireEvent.pointerMove(document, { clientX: 10, clientY: 20 })
    expect(firstTask).not.toHaveAttribute("data-dragging")
    fireEvent.pointerUp(document)
  })

  it("shows an automation binding dialog instead of an inline error when unpinning", async () => {
    const task = {
      ...conversations[1]!,
      pinned_at: "2026-07-30T08:00:00.000Z",
    }
    const { requests } = installApiMock({
      conversationListResponse: () =>
        json({
          success: true,
          data: { items: [task], next_cursor: null },
        }),
      conversationPatchResponse: (_conversationId, body) => {
        if (body.pinned === false) {
          return json(
            {
              success: false,
              error_code: "AUTOMATION_TASK_IN_USE",
            },
            409
          )
        }
        throw new Error("Unexpected conversation patch")
      },
    })
    const interaction = userEvent.setup()
    renderApp()
    const sidebar = await screen.findByRole("complementary", {
      name: "LinkSense 导航",
    })
    const taskItem = (await within(sidebar).findByText(task.title)).closest(
      ".sidebar-conversation-item"
    )
    expect(taskItem).not.toBeNull()

    await interaction.click(
      within(taskItem as HTMLElement).getByRole("button", {
        name: `取消置顶任务“${task.title}”`,
      })
    )

    const dialog = await screen.findByRole("dialog", {
      name: "无法取消置顶",
    })
    expect(
      within(dialog).getByText("该任务仍关联自动化，请先删除或重新绑定自动化。")
    ).toBeVisible()
    expect(
      within(sidebar).queryByText(
        "该任务仍关联自动化，请先删除或重新绑定自动化。"
      )
    ).not.toBeInTheDocument()
    expect(
      requests.some(
        (request) =>
          request.path === `/api/v1/conversations/${task.id}` &&
          request.method === "PATCH" &&
          JSON.stringify(request.body) === JSON.stringify({ pinned: false })
      )
    ).toBe(true)

    await interaction.click(
      within(dialog).getByRole("button", { name: "知道了" })
    )
    expect(
      screen.queryByRole("dialog", { name: "无法取消置顶" })
    ).not.toBeInTheDocument()
    expect(within(sidebar).getByRole("heading", { name: "置顶" })).toBeVisible()
  })

  it("removes the task menu and loads every active conversation into the recent list", async () => {
    const lastConversation = {
      ...conversations[0],
      id: "c4",
      title: "第二页任务",
    }
    const { requests } = installApiMock({
      conversationListResponse: (query) =>
        query.get("cursor") === "next-page"
          ? json({
              success: true,
              data: { items: [lastConversation], next_cursor: null },
            })
          : json({
              success: true,
              data: { items: conversations, next_cursor: "next-page" },
            }),
    })
    renderApp()
    const sidebar = await screen.findByRole("complementary", {
      name: "LinkSense 导航",
    })

    expect(
      within(sidebar).queryByRole("link", { name: "任务" })
    ).not.toBeInTheDocument()
    expect(
      await within(sidebar).findByText(lastConversation.title)
    ).toBeVisible()

    await waitFor(() => {
      const listRequests = requests.filter(
        (request) => request.path === "/api/v1/conversations"
      )
      expect(listRequests).toHaveLength(2)
      expect(new URLSearchParams(listRequests[0]!.query).get("limit")).toBe(
        "100"
      )
      expect(new URLSearchParams(listRequests[0]!.query).get("archived")).toBe(
        "false"
      )
      expect(new URLSearchParams(listRequests[1]!.query).get("cursor")).toBe(
        "next-page"
      )
    })
  })

  it("places search, collapse, and notification controls beside the LinkSense logo", async () => {
    installApiMock()
    const interaction = userEvent.setup()
    renderApp()
    const sidebar = await screen.findByRole("complementary", {
      name: "LinkSense 导航",
    })

    const brand = within(sidebar).getByRole("img", { name: "LinkSense" })
    const searchButton = within(sidebar).getByRole("button", {
      name: "搜索",
    })
    const collapseButton = within(sidebar).getByRole("button", {
      name: "折叠侧边栏",
    })
    const notificationButton = within(sidebar).getByRole("button", {
      name: "自动化通知",
    })

    expect(brand).toHaveClass("sidebar-brand-logo")
    expect(brand).toHaveAttribute(
      "src",
      expect.stringContaining("linksense-lockup-primary.svg")
    )
    expect(brand.parentElement).not.toHaveClass(
      "text-[length:var(--app-font-18)]"
    )
    expect(brand.parentElement).not.toHaveClass(
      "text-[length:var(--app-font-15)]"
    )
    expect(brand.parentElement).toContainElement(searchButton)
    expect(brand.parentElement).toContainElement(collapseButton)
    expect(brand.parentElement).toContainElement(notificationButton)
    expect(
      searchButton.compareDocumentPosition(collapseButton) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(
      collapseButton.compareDocumentPosition(notificationButton) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(searchButton).toHaveClass(
      "sidebar-nav-item",
      "size-7",
      "bg-transparent"
    )
    expect(searchButton).toHaveTextContent("")
    expect(searchButton.querySelector(".lucide-search")).toHaveAttribute(
      "stroke-width",
      "2"
    )
    expect(collapseButton.querySelector(".lucide-panel-left")).toHaveAttribute(
      "stroke-width",
      "2"
    )
    expect(collapseButton).toHaveClass("sidebar-collapse-control")
    expect(notificationButton.querySelector(".lucide-bell")).toHaveClass(
      "size-3.5"
    )
    expect(notificationButton.querySelector(".lucide-bell")).toHaveAttribute(
      "stroke-width",
      "2"
    )
    expect(
      notificationButton.querySelector("[data-automation-unread-indicator]")
    ).not.toBeInTheDocument()

    await interaction.hover(searchButton)
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument()
    await interaction.unhover(searchButton)
    await interaction.hover(collapseButton)
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument()

    await interaction.click(searchButton)
    expect(await screen.findByRole("dialog", { name: "搜索" })).toBeVisible()
  })

  it("aligns the mobile navigation close control with the sidebar controls", async () => {
    installApiMock()
    const interaction = userEvent.setup()
    renderApp()

    await interaction.click(
      await screen.findByRole("button", { name: "打开导航" })
    )

    const sheet = await waitFor(() => {
      const content = document.querySelector('[data-slot="sheet-content"]')
      expect(content).toHaveClass("mobile-navigation-sheet")
      return content
    })
    if (!(sheet instanceof HTMLElement)) {
      throw new Error("Expected the mobile navigation sheet to render")
    }
    const closeButton = within(sheet).getByRole("button", { name: "关闭" })
    const searchButton = within(sheet).getByRole("button", { name: "搜索" })
    const notificationButton = within(sheet).getByRole("button", {
      name: "自动化通知",
    })

    expect(closeButton).toHaveClass("mobile-navigation-close")
    expect(closeButton).not.toHaveClass("bg-secondary")
    expect(searchButton.parentElement).toHaveClass("sidebar-header-actions")
    expect(notificationButton).toBeVisible()
  })

  it("does nothing when the notification bell has no unread item", async () => {
    const { requests } = installApiMock()
    const interaction = userEvent.setup()
    renderApp()
    const sidebar = await screen.findByRole(
      "complementary",
      { name: "LinkSense 导航" },
      { timeout: 3_000 }
    )
    const notificationButton = within(sidebar).getByRole("button", {
      name: "自动化通知",
    })

    await interaction.click(notificationButton)

    expect(
      screen.queryByRole("heading", { name: "自动化" })
    ).not.toBeInTheDocument()
    expect(
      requests.some(
        (request) =>
          request.path === "/api/v1/automations" && request.method === "GET"
      )
    ).toBe(false)
    expect(
      requests.some(
        (request) =>
          request.path ===
            "/api/v1/automations/completion-notifications/read" &&
          request.method === "POST"
      )
    ).toBe(false)
  })

  it("opens the first unread notification's task and clears the bell indicator", async () => {
    const completedAt = "2026-07-31T01:02:03.000Z"
    const targetConversation = {
      ...conversations[1],
      id: "30000000-0000-4000-8000-000000000001",
      title: "自动化通知对应任务",
      has_unread_completion: true,
      has_automation: true,
    }
    const { requests } = installApiMock({
      conversationListResponse: () =>
        Promise.resolve(
          json({
            success: true,
            data: {
              items: [conversations[0], targetConversation],
              next_cursor: null,
            },
          })
        ),
      conversationDetailResponse: async (conversationId) =>
        json({
          success: true,
          data: {
            ...conversation,
            ...targetConversation,
            id: conversationId,
            messages: [
              {
                id: `${conversationId}-message-1`,
                role: "assistant",
                content: "自动化通知对应任务已加载。",
              },
            ],
            turns: [],
            running_turn: null,
          },
        }),
      conversationPatchResponse: async (_conversationId, body) =>
        json({
          success: true,
          data: {
            ...targetConversation,
            has_unread_completion: body.completion_read
              ? false
              : targetConversation.has_unread_completion,
          },
        }),
      automationCompletionNotification: {
        latest_unread: {
          conversation_id: targetConversation.id,
          completed_at: completedAt,
        },
      },
    })
    const interaction = userEvent.setup()
    renderApp()
    const sidebar = await screen.findByRole("complementary", {
      name: "LinkSense 导航",
    })
    const notificationButton = await within(sidebar).findByRole("button", {
      name: "自动化通知，有已完成的未读任务",
    })
    const indicator = notificationButton.querySelector(
      "[data-automation-unread-indicator]"
    )

    expect(indicator).toBeInTheDocument()
    expect(indicator).toHaveClass("rounded-full", "bg-[var(--app-selection)]")

    await interaction.click(notificationButton)

    expect(await screen.findByText("自动化通知对应任务已加载。")).toBeVisible()
    expect(
      screen.queryByRole("heading", { name: "自动化" })
    ).not.toBeInTheDocument()
    await waitFor(() => {
      expect(
        requests.some(
          (request) =>
            request.path ===
              "/api/v1/automations/completion-notifications/read" &&
            request.method === "POST" &&
            JSON.stringify(request.body) ===
              JSON.stringify({ through: completedAt })
        )
      ).toBe(true)
      expect(
        requests.some(
          (request) =>
            request.path === `/api/v1/conversations/${targetConversation.id}` &&
            request.method === "PATCH" &&
            JSON.stringify(request.body) ===
              JSON.stringify({ completion_read: true })
        )
      ).toBe(true)
      expect(
        within(sidebar)
          .getByRole("button", { name: "自动化通知" })
          .querySelector("[data-automation-unread-indicator]")
      ).not.toBeInTheDocument()
    })
  })

  it("clears the bell indicator when the unread task is opened directly", async () => {
    const targetConversation = {
      ...conversations[0],
      execution_status: "completed",
      has_unread_completion: true,
      has_automation: true,
    }
    const { requests } = installApiMock({
      conversationListResponse: () =>
        json({
          success: true,
          data: {
            items: [targetConversation, conversations[1]],
            next_cursor: null,
          },
        }),
      automationCompletionNotification: {
        latest_unread: {
          conversation_id: targetConversation.id,
          completed_at: "2026-07-31T01:02:03.000Z",
        },
      },
    })

    renderApp()
    const sidebar = await screen.findByRole("complementary", {
      name: "LinkSense 导航",
    })
    await waitFor(() => {
      expect(
        requests.some(
          (request) =>
            request.path === `/api/v1/conversations/${targetConversation.id}` &&
            request.method === "PATCH" &&
            JSON.stringify(request.body) ===
              JSON.stringify({ completion_read: true })
        )
      ).toBe(true)
      expect(
        within(sidebar)
          .getByRole("button", { name: "自动化通知" })
          .querySelector("[data-automation-unread-indicator]")
      ).not.toBeInTheDocument()
    })
  })

  it("collapses the desktop sidebar and restores the mounted navigation", async () => {
    installApiMock()
    const interaction = userEvent.setup()
    const { container } = renderApp()
    const sidebar = await screen.findByRole("complementary", {
      name: "LinkSense 导航",
    })

    await interaction.click(
      within(sidebar).getByRole("button", { name: "折叠侧边栏" })
    )

    const shell = container.querySelector(".app-shell")
    expect(shell).toHaveAttribute("data-sidebar-collapsed", "true")
    expect(sidebar).toHaveAttribute("aria-hidden", "true")
    expect(sidebar).toHaveAttribute("inert")
    expect(
      screen.queryByRole("complementary", { name: "LinkSense 导航" })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("separator", { name: "调整侧边栏宽度" })
    ).not.toBeInTheDocument()

    const expandButton = screen.getByRole("button", { name: "展开侧边栏" })
    expect(expandButton.closest(".app-main")).toHaveAttribute(
      "data-compact-top-bar",
      "true"
    )
    expect(expandButton).toHaveAttribute("aria-controls", "app-sidebar")
    expect(expandButton).toHaveClass("sidebar-collapse-control")
    expect(expandButton.querySelector(".lucide-panel-left")).toHaveAttribute(
      "stroke-width",
      "2"
    )
    await interaction.hover(expandButton)
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument()
    await interaction.click(expandButton)

    const restoredSidebar = screen.getByRole("complementary", {
      name: "LinkSense 导航",
    })
    expect(restoredSidebar).toBe(sidebar)
    expect(shell).not.toHaveAttribute("data-sidebar-collapsed")
    expect(sidebar).not.toHaveAttribute("aria-hidden")
    expect(sidebar).not.toHaveAttribute("inert")
    expect(
      screen.getByRole("separator", { name: "调整侧边栏宽度" })
    ).toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "展开侧边栏" })
    ).not.toBeInTheDocument()
  })

  it("keeps the recent-task scrollbar on the outer sidebar edge", async () => {
    installApiMock()
    renderApp()
    const sidebar = await screen.findByRole("complementary", {
      name: "LinkSense 导航",
    })
    const taskScroller = sidebar.querySelector(".sidebar-conversation-scroll")

    expect(taskScroller).not.toBeNull()
    expect(taskScroller?.closest("section")).toHaveClass("-mr-3")
    expect(taskScroller).toHaveClass("pr-3.5")
    expect(taskScroller).not.toHaveClass("pr-0.5")
  })

  it("shows the recent-task top divider only while the list is scrolled", async () => {
    installApiMock()
    renderApp()
    const sidebar = await screen.findByRole("complementary", {
      name: "LinkSense 导航",
    })
    const taskScroller = sidebar.querySelector(".sidebar-conversation-scroll")
    const taskRegion = taskScroller?.closest(".sidebar-conversation-region")

    expect(taskScroller).not.toBeNull()
    expect(taskRegion).not.toBeNull()
    expect(taskRegion).toHaveClass("mt-2")
    expect(taskRegion).not.toHaveClass("mt-5")
    expect(taskRegion).not.toHaveAttribute("data-scrolled")

    if (!(taskScroller instanceof HTMLElement)) {
      throw new Error("Expected the recent-task scroller to render")
    }
    taskScroller.scrollTop = 24
    fireEvent.scroll(taskScroller)
    expect(taskRegion).toHaveAttribute("data-scrolled", "true")

    taskScroller.scrollTop = 0
    fireEvent.scroll(taskScroller)
    expect(taskRegion).not.toHaveAttribute("data-scrolled")
  })

  it("uses the stronger navigation typography hierarchy across app and settings shells", async () => {
    installApiMock()
    const interaction = userEvent.setup()
    renderApp()
    const sidebar = await screen.findByRole("complementary", {
      name: "LinkSense 导航",
    })

    expect(within(sidebar).getByRole("button", { name: "搜索" })).toHaveClass(
      "sidebar-nav-item",
      "size-7"
    )
    expect(
      within(sidebar).queryByRole("link", { name: "任务" })
    ).not.toBeInTheDocument()
    const newTaskLink = within(sidebar).getByRole("link", {
      name: "新任务",
    })
    const automationLink = within(sidebar).getByRole("link", {
      name: "自动化",
    })
    const pluginLink = within(sidebar).getByRole("link", {
      name: "插件中心",
    })
    const knowledgeBaseLink = within(sidebar).getByRole("link", {
      name: "文件库",
    })
    expect(automationLink).toHaveAttribute("href", "/automations")
    expect(pluginLink).toHaveAttribute("href", "/capabilities")
    expect(knowledgeBaseLink).toHaveAttribute("href", "/knowledge-bases")
    await interaction.click(
      within(sidebar).getByRole("button", { name: "反馈与帮助" })
    )
    expect(await screen.findByRole("menuitem", { name: "反馈" })).toBeVisible()
    const helpCenterLink = await screen.findByRole("menuitem", {
      name: "在新标签页打开帮助中心",
    })
    expect(helpCenterLink).toHaveAttribute(
      "href",
      "/help/user-guide/tasks/create-and-run/"
    )
    expect(helpCenterLink).toHaveAttribute("target", "_blank")
    expect(helpCenterLink).toHaveAttribute("rel", "noreferrer noopener")
    expect(
      newTaskLink.compareDocumentPosition(automationLink) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(
      automationLink.compareDocumentPosition(pluginLink) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(
      pluginLink.compareDocumentPosition(knowledgeBaseLink) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(
      within(sidebar).queryByRole("link", { name: "已归档任务" })
    ).not.toBeInTheDocument()
    expect(within(sidebar).getByRole("heading", { name: "任务" })).toHaveClass(
      "font-semibold",
      "text-[length:var(--app-ui-font-size)]"
    )
    expect(
      await within(sidebar).findByText(conversations[0]!.title)
    ).toHaveClass("font-medium", "text-[length:var(--app-ui-font-size)]")
    expect(sidebar.querySelector("time")).toBeNull()

    const accountTrigger = within(sidebar).getByRole("button", {
      name: "林晓",
    })
    expect(accountTrigger).toHaveClass("sidebar-user-button")
    expect(accountTrigger).toHaveClass("py-1.5")
    expect(accountTrigger.closest(".sidebar-account-bar")).toHaveClass("mt-1")
    expect(accountTrigger.querySelector("svg")).toBeNull()
    expect(accountTrigger.querySelector('[data-slot="avatar"]')).toHaveClass(
      "sidebar-account-avatar",
      "size-6"
    )
    expect(
      within(accountTrigger).getByText("林晓", {
        selector: "span.block.truncate",
      })
    ).toHaveClass("font-semibold", "text-[length:var(--app-ui-font-size)]")
    expect(within(accountTrigger).queryByText("管理员")).not.toBeInTheDocument()
    expect(
      within(accountTrigger).queryByText("lin@example.com")
    ).not.toBeInTheDocument()
    await interaction.click(accountTrigger)
    const settingsMenuItem = await screen.findByRole("menuitem", {
      name: "设置",
    })
    expect(screen.getByRole("menu")).toHaveClass(
      "w-[calc(var(--anchor-width)+2.25rem)]",
      "max-w-[calc(100vw-24px)]"
    )
    expect(settingsMenuItem).toHaveClass(
      "font-medium",
      "text-[length:var(--app-ui-font-size)]"
    )
    expect(
      screen.getByRole("menu").querySelector('[data-slot="avatar"]')
    ).toHaveClass("sidebar-account-avatar", "size-6")
    const menu = screen.getByRole("menu")
    const accountName = within(menu).getByText("林晓", {
      selector: "span.truncate",
    })
    expect(accountName).toHaveClass(
      "font-semibold",
      "text-[length:var(--app-ui-font-size)]"
    )
    const quotaRemaining = within(menu).getByText(
      "用量剩余：总 - · 周 - · 月 -"
    )
    expect(quotaRemaining).toHaveClass(
      "account-menu-quota",
      "text-[length:var(--app-font-11)]",
      "text-[var(--app-muted)]"
    )
    expect(accountName.parentElement).not.toContainElement(quotaRemaining)
    expect(
      quotaRemaining.compareDocumentPosition(settingsMenuItem) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()

    await interaction.click(settingsMenuItem)
    const settingsSidebar = await screen.findByRole("complementary", {
      name: "LinkSense 设置导航",
    })
    expect(
      within(settingsSidebar).getByRole("heading", { name: "个人" })
    ).toHaveClass("font-semibold")
    const generalLink = within(settingsSidebar).getByRole("link", {
      name: "常规",
    })
    const generalLabel = within(generalLink).getByText("常规")
    expect(generalLink).toHaveClass("font-medium")
    expect(generalLabel).not.toHaveClass("font-semibold")
    const settingsNavigationLinks = settingsSidebar.querySelectorAll(
      ".settings-navigation-link"
    )
    expect(settingsNavigationLinks).toHaveLength(20)
    settingsNavigationLinks.forEach((link) => {
      expect(link.querySelectorAll(":scope > span")).toHaveLength(1)
      expect(link.querySelector(":scope > span > span")).toBeNull()
    })
    expect(
      within(settingsSidebar).queryByText("界面语言")
    ).not.toBeInTheDocument()
    expect(
      within(settingsSidebar).queryByText("姓名和头像")
    ).not.toBeInTheDocument()
    expect(
      within(settingsSidebar).queryByText("管理用户账号、角色和状态")
    ).not.toBeInTheDocument()
    expect(
      within(settingsSidebar).queryByRole("link", { name: "插件" })
    ).not.toBeInTheDocument()
    expect(
      within(settingsSidebar).getByRole("link", { name: "已归档任务" })
    ).toHaveAttribute("href", "/archived")
    expect(
      within(settingsSidebar).getByRole("link", { name: "插件中心" })
    ).toHaveAttribute("href", "/admin/capabilities")
    expect(
      within(settingsSidebar).getByRole("link", { name: "知识库" })
    ).toHaveAttribute("href", "/admin/knowledge-bases")
    expect(
      within(settingsSidebar).queryByRole("link", { name: "知识库数据源" })
    ).not.toBeInTheDocument()
    expect(
      within(settingsSidebar).getByRole("link", { name: "模型设置" })
    ).toHaveAttribute("href", "/admin/models")
    expect(
      within(settingsSidebar).queryByRole("link", { name: "分享审批" })
    ).not.toBeInTheDocument()
  })

  it("returns from settings to the currently open task", async () => {
    installApiMock()
    const interaction = userEvent.setup()
    renderApp("/conversations/c1")

    expect(
      await screen.findByRole("heading", { name: "活动风险评估" })
    ).toBeVisible()

    const sidebar = await screen.findByRole("complementary", {
      name: "LinkSense 导航",
    })
    await interaction.click(
      within(sidebar).getByRole("button", { name: "林晓" })
    )
    await interaction.click(
      await screen.findByRole("menuitem", { name: "设置" })
    )

    const settingsSidebar = await screen.findByRole("complementary", {
      name: "LinkSense 设置导航",
    })
    expect(
      within(settingsSidebar).getByRole("link", { name: "返回 LinkSense" })
    ).toHaveAttribute("href", "/conversations/c1")

    await interaction.click(
      within(settingsSidebar).getByRole("link", { name: "个人资料" })
    )
    expect(
      screen.getByRole("link", { name: "返回 LinkSense" })
    ).toHaveAttribute("href", "/conversations/c1")

    await interaction.click(
      screen.getByRole("link", { name: "返回 LinkSense" })
    )
    expect(
      await screen.findByRole("heading", { name: "活动风险评估" })
    ).toBeVisible()
  })

  it("opens a compact account menu with only LinkSense account actions", async () => {
    installApiMock({
      userOverride: {
        token_quota: {
          total: null,
          weekly: {
            limit_tokens: "1000",
            used_tokens: "250",
            remaining_tokens: "750",
            remaining_percentage: 75,
            reset_at: "2026-08-09T16:00:00.000Z",
          },
          monthly: null,
        },
      },
    })
    const interaction = userEvent.setup()
    renderApp()
    const trigger = await screen.findByRole(
      "button",
      { name: "林晓" },
      { timeout: 3_000 }
    )
    await interaction.click(trigger)

    const menu = await screen.findByRole("menu")
    expect(menu).toHaveClass("w-[calc(var(--anchor-width)+2.25rem)]")
    expect(menu).not.toHaveClass("w-[260px]")
    expect(within(menu).getAllByText("林晓").length).toBeGreaterThan(0)
    expect(
      within(menu).getByText("用量剩余：总 - · 周 75% · 月 -")
    ).toBeVisible()
    expect(within(menu).queryByText("lin@example.com")).not.toBeInTheDocument()
    expect(within(menu).queryByText("管理员")).not.toBeInTheDocument()
    expect(within(menu).getByRole("menuitem", { name: "设置" })).toBeVisible()
    expect(
      within(menu).queryByRole("menuitem", { name: "个人设置" })
    ).not.toBeInTheDocument()
    expect(
      within(menu).queryByRole("menuitem", { name: "个人凭据" })
    ).not.toBeInTheDocument()
    expect(
      within(menu).queryByRole("menuitem", { name: "管理中心" })
    ).not.toBeInTheDocument()
    const signOutItem = within(menu).getByRole("menuitem", {
      name: "退出登录",
    })
    expect(signOutItem).toBeVisible()
    expect(signOutItem).toHaveAttribute("data-variant", "default")
    expect(
      screen.queryByRole("link", { name: "个人凭据" })
    ).not.toBeInTheDocument()
    expect(within(menu).queryByText("English")).not.toBeInTheDocument()
    expect(within(menu).queryByText(/宠物|主题/)).not.toBeInTheDocument()

    await interaction.keyboard("{Escape}")
    expect(screen.queryByRole("menu")).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it("requires confirmation before signing out", async () => {
    const { requests } = installApiMock()
    const interaction = userEvent.setup()
    renderApp()
    const trigger = await screen.findByRole("button", { name: "林晓" })

    await interaction.click(trigger)
    await interaction.click(
      within(await screen.findByRole("menu")).getByRole("menuitem", {
        name: "退出登录",
      })
    )

    let dialog = await screen.findByRole("dialog", { name: "退出登录？" })
    expect(dialog).toHaveTextContent(
      "退出后，你需要重新登录才能继续使用 LinkSense。"
    )
    expect(
      requests.some((request) => request.path === "/api/v1/auth/logout")
    ).toBe(false)

    await interaction.click(
      within(dialog).getByRole("button", { name: "取消" })
    )
    expect(
      screen.queryByRole("dialog", { name: "退出登录？" })
    ).not.toBeInTheDocument()
    expect(
      requests.some((request) => request.path === "/api/v1/auth/logout")
    ).toBe(false)

    await interaction.click(trigger)
    await interaction.click(
      within(await screen.findByRole("menu")).getByRole("menuitem", {
        name: "退出登录",
      })
    )
    dialog = await screen.findByRole("dialog", { name: "退出登录？" })
    await interaction.click(
      within(dialog).getByRole("button", { name: "退出登录" })
    )

    await waitFor(() =>
      expect(
        requests.some(
          (request) =>
            request.path === "/api/v1/auth/logout" && request.method === "POST"
        )
      ).toBe(true)
    )
    expect(
      await screen.findByRole("heading", { name: "登录 LinkSense" })
    ).toBeVisible()
  })

  it("uses the independent settings shell and saves language automatically from General", async () => {
    const { requests } = installApiMock()
    const interaction = userEvent.setup()
    renderApp("/settings/general")

    expect(await screen.findByRole("heading", { name: "常规" })).toBeVisible()
    expect(
      screen.getByRole("complementary", { name: "LinkSense 设置导航" })
    ).toBeVisible()
    expect(
      screen.queryByRole("complementary", { name: "LinkSense 导航" })
    ).not.toBeInTheDocument()
    expect(screen.getByRole("link", { name: /个人资料/ })).toHaveAttribute(
      "href",
      "/settings/profile"
    )
    const mobileNavigation = screen.getByRole("button", { name: /设置导航/ })
    await interaction.click(mobileNavigation)
    expect(mobileNavigation).toHaveAttribute("aria-expanded", "true")
    await interaction.keyboard("{Escape}")
    expect(mobileNavigation).toHaveAttribute("aria-expanded", "false")

    const queueAction = screen.getByRole("radio", {
      name: /排队为下一条请求/,
    })
    const steerAction = screen.getByRole("radio", {
      name: /引导当前执行/,
    })
    expect(screen.getByRole("radiogroup")).toHaveClass("sm:grid-cols-2")
    expect(queueAction).toBeChecked()
    await interaction.click(steerAction)
    await waitFor(() =>
      expect(
        requests.find(
          (request) =>
            request.path === "/api/v1/me" &&
            request.method === "PATCH" &&
            (request.body as { running_message_action?: string })
              ?.running_message_action === "steer"
        )
      ).toBeDefined()
    )
    expect(steerAction).toBeChecked()

    await chooseSelectOption(interaction, "语言", "English")
    await waitFor(() => expect(document.documentElement.lang).toBe("en-US"))
    expect(screen.getByRole("heading", { name: /^General$/u })).toBeVisible()
    expect(
      screen.getByRole("complementary", {
        name: "LinkSense settings navigation",
      })
    ).toBeVisible()
    expect(window.localStorage.getItem("linksense.language")).toBe("en-US")
    await waitFor(() =>
      expect(
        requests.find(
          (request) =>
            request.path === "/api/v1/me" &&
            request.method === "PATCH" &&
            (request.body as { preferred_locale?: string })
              ?.preferred_locale === "en-US"
        )
      ).toBeDefined()
    )
    expect(
      screen.queryByText("Language preference saved.")
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "Save" })
    ).not.toBeInTheDocument()
  })

  it("shows the profile hero, personal usage, activity, and name editor", async () => {
    const { requests } = installApiMock()
    const interaction = userEvent.setup()
    renderApp("/settings/profile")

    expect(
      await screen.findByRole("heading", { level: 1, name: "个人资料" })
    ).toBeVisible()
    expect(
      screen.getByRole("heading", { level: 2, name: "林晓" })
    ).toBeVisible()
    expect(
      screen.getByText("林", { selector: "[data-slot=avatar-fallback]" })
    ).toHaveClass("profile-hero-avatar-fallback", "text-xl", "font-semibold")
    expect(screen.getByText("lin@example.com")).toBeVisible()
    expect(await screen.findByText("累计 Token 数")).toBeVisible()
    expect(screen.getByText("12.3K")).toBeVisible()
    expect(screen.getByText("聊天总数")).toBeVisible()
    expect(screen.getByText("技能使用次数")).toBeVisible()
    expect(screen.getByText("当前连续天数")).toBeVisible()
    expect(screen.getByText("2 天")).toBeVisible()
    expect(
      screen.getByRole("group", {
        name: "最近 365 天的 Token 活动热力图",
      })
    ).toBeVisible()
    expect(screen.getByRole("heading", { name: "最常用的模型" })).toBeVisible()
    expect(screen.getByText("Model A")).toBeVisible()
    expect(screen.getByRole("heading", { name: "最常用的技能" })).toBeVisible()
    expect(screen.getByText("dashi-ppt")).toBeVisible()
    expect(
      screen.queryByRole("heading", { name: "身份资料" })
    ).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "上传新头像" })).toBeEnabled()
    const editNameButton = screen.getByRole("button", { name: "编辑名称" })
    expect(editNameButton).toHaveClass("size-6")
    await interaction.click(editNameButton)
    expect(screen.getByRole("dialog", { name: "编辑名称" })).toBeInTheDocument()
    const nameInput = screen.getByRole("textbox", { name: "名称" })
    await interaction.clear(nameInput)
    await interaction.type(nameInput, "林晓新")
    await interaction.click(screen.getByRole("button", { name: "保存" }))
    await waitFor(() =>
      expect(
        requests.find(
          (request) =>
            request.path === "/api/v1/me" &&
            request.method === "PATCH" &&
            (request.body as { name?: string })?.name === "林晓新"
        )
      ).toBeDefined()
    )
    expect(
      requests.some((request) => request.path === "/api/v1/me/usage")
    ).toBe(true)
  })

  it("rolls back an immediate language change when automatic saving fails", async () => {
    installApiMock({ languagePatchFails: true })
    const interaction = userEvent.setup()
    renderApp("/settings/general")

    expect(
      await screen.findByRole("heading", { name: /^常规$/u })
    ).toBeVisible()
    await chooseSelectOption(interaction, "语言", "English")

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "无法连接服务，请检查网络后重试。"
    )
    expect(screen.getByRole("heading", { name: /^常规$/u })).toBeVisible()
    expect(document.documentElement.lang).toBe("zh-CN")
    expect(window.localStorage.getItem("linksense.language")).toBe("zh-CN")
    expect(
      screen.queryByRole("button", { name: "保存" })
    ).not.toBeInTheDocument()
  })

  it("toggles the security password fields independently", async () => {
    installApiMock()
    const interaction = userEvent.setup()
    renderApp("/settings/security")

    expect(await screen.findByRole("heading", { name: "安全" })).toBeVisible()
    expect(
      screen.getByText("8~16 个字符，且包含大写、小写、数字和标点或符号。")
    ).toBeVisible()
    expect(screen.queryByText(/Unicode/u)).not.toBeInTheDocument()
    const currentPassword = screen.getByLabelText("当前密码")
    const newPassword = screen.getByLabelText("新密码")
    const confirmation = screen.getByLabelText("确认新密码")
    await interaction.type(currentPassword, "CurrentPass1!")
    await interaction.type(newPassword, "NextPass2!")
    await interaction.type(confirmation, "NextPass2!")

    expect(currentPassword).toHaveAttribute("type", "password")
    expect(newPassword).toHaveAttribute("type", "password")
    expect(confirmation).toHaveAttribute("type", "password")

    await interaction.click(
      screen.getByRole("button", { name: "显示当前密码" })
    )
    expect(currentPassword).toHaveAttribute("type", "text")
    expect(currentPassword).toHaveValue("CurrentPass1!")
    expect(newPassword).toHaveAttribute("type", "password")
    expect(confirmation).toHaveAttribute("type", "password")

    await interaction.click(screen.getByRole("button", { name: "显示新密码" }))
    await interaction.click(
      screen.getByRole("button", { name: "显示确认新密码" })
    )
    expect(newPassword).toHaveAttribute("type", "text")
    expect(newPassword).toHaveValue("NextPass2!")
    expect(confirmation).toHaveAttribute("type", "text")
    expect(confirmation).toHaveValue("NextPass2!")

    await interaction.click(
      screen.getByRole("button", { name: "隐藏当前密码" })
    )
    expect(currentPassword).toHaveAttribute("type", "password")
    expect(newPassword).toHaveAttribute("type", "text")
    expect(confirmation).toHaveAttribute("type", "text")
  })

  it("changes and persists the theme and UI font size from Appearance settings", async () => {
    const { requests } = installApiMock()
    const interaction = userEvent.setup()
    const { container } = renderApp("/settings/appearance")

    expect(await screen.findByRole("heading", { name: "外观" })).toBeVisible()
    expect(screen.getByRole("link", { name: /外观/ })).toHaveAttribute(
      "href",
      "/settings/appearance"
    )
    expect(
      screen.getByText("设置 LinkSense 的界面主题与基准字号。")
    ).toBeVisible()
    expect(screen.getByText("主题", { selector: "legend" })).toBeVisible()

    const uiFontSize = screen.getByRole("spinbutton", { name: "UI 字号" })
    expect(uiFontSize).toHaveValue(14)
    expect(uiFontSize).toHaveAttribute("min", "12")
    expect(uiFontSize).toHaveAttribute("max", "18")
    expect(uiFontSize).toHaveAttribute("step", "1")
    expect(uiFontSize).toHaveAttribute("data-slot", "input")
    expect(uiFontSize).toHaveClass("h-9", "w-18", "text-center")
    expect(uiFontSize).not.toHaveClass("h-10")

    await interaction.clear(uiFontSize)
    await interaction.type(uiFontSize, "12")
    expect(document.documentElement.dataset.uiFontSize).toBe("12")
    expect(
      document.documentElement.style.getPropertyValue("--app-ui-font-size")
    ).toBe("12px")
    expect(window.localStorage.getItem("linksense.uiFontSize")).toBe("12")

    await interaction.clear(uiFontSize)
    await interaction.type(uiFontSize, "19")
    await interaction.tab()
    expect(uiFontSize).toHaveValue(18)
    expect(document.documentElement.dataset.uiFontSize).toBe("18")
    expect(window.localStorage.getItem("linksense.uiFontSize")).toBe("18")

    const systemTheme = screen.getByRole("radio", { name: "系统" })
    const lightTheme = screen.getByRole("radio", { name: "浅色" })
    const darkTheme = screen.getByRole("radio", { name: "深色" })
    expect(screen.getAllByRole("radio")).toHaveLength(3)
    expect(systemTheme).toBeChecked()
    expect(
      container.querySelectorAll(
        '.appearance-theme-preview[aria-hidden="true"]'
      )
    ).toHaveLength(3)

    await interaction.click(darkTheme)
    expect(darkTheme).toBeChecked()
    expect(document.documentElement).toHaveClass("dark")
    expect(document.documentElement.dataset.themePreference).toBe("dark")
    expect(window.localStorage.getItem("linksense.theme")).toBe("dark")

    await interaction.click(lightTheme)
    expect(lightTheme).toBeChecked()
    expect(document.documentElement).not.toHaveClass("dark")
    expect(document.documentElement.dataset.theme).toBe("light")
    expect(window.localStorage.getItem("linksense.theme")).toBe("light")
    expect(
      requests.some(
        (request) => request.path === "/api/v1/me" && request.method === "PATCH"
      )
    ).toBe(false)

    expect(
      screen.queryByRole("button", { name: "保存" })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByText(/强调色|自定义字体|透明|对比度|动态效果/u)
    ).not.toBeInTheDocument()

    await act(async () => {
      await i18n.changeLanguage("en-US")
    })
    expect(screen.getByRole("heading", { name: "Appearance" })).toBeVisible()
    expect(screen.getByText("Theme", { selector: "legend" })).toBeVisible()
    expect(
      screen.getByRole("spinbutton", { name: "UI font size" })
    ).toHaveValue(18)
    expect(screen.getByRole("radio", { name: "System" })).toBeVisible()
    expect(screen.getByRole("radio", { name: "Light" })).toBeVisible()
    expect(screen.getByRole("radio", { name: "Dark" })).toBeVisible()
  })

  it("shows two fixed roles without role customization controls", async () => {
    installApiMock()
    renderApp("/admin/roles")

    expect(
      await screen.findByRole(
        "heading",
        { name: "角色与权限" },
        { timeout: 8_000 }
      )
    ).toBeVisible()
    expect(
      screen
        .getByRole("heading", { name: "角色与权限" })
        .closest(".management-page")
    ).toHaveClass("role-permission-page")
    expect(
      screen.getByRole("complementary", { name: "LinkSense 设置导航" })
    ).toBeVisible()
    expect(
      screen.queryByRole("complementary", { name: "LinkSense 导航" })
    ).not.toBeInTheDocument()
    expect(screen.getByRole("link", { name: "用户与用户组" })).toHaveAttribute(
      "href",
      "/admin/users"
    )
    expect(screen.getByRole("link", { name: "用量统计" })).toHaveAttribute(
      "href",
      "/admin/usage"
    )
    expect(
      screen.queryByText(/仅有 user 与 admin 两种固定角色/)
    ).not.toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "权限矩阵" })).toBeVisible()
    const permissionTable = screen.getByRole("table", { name: "权限矩阵" })
    const expectedPermissions = [
      "管理自己的任务",
      "管理个人资料、外观与安全设置",
      "创建、导入和管理个人插件/Skill",
      "浏览、安装、更新插件并提交上架审核",
      "管理个人凭据",
      "管理自有知识库，并使用获授权知识库",
      "管理用户与用户组",
      "审核并治理插件中心条目",
      "治理全局知识库元数据与生命周期（不自动获得正文权限）",
      "配置知识库数据源与同步",
      "配置生成、图片理解、嵌入与重排模型及 Token 单价",
      "管理产品设置与登录认证",
      "查看系统健康并执行知识库维护",
      "查看跨用户脱敏审计与任务元数据（不含正文）",
      "查看全局、用户组和用户的模型用量与费用",
    ]
    for (const permission of expectedPermissions) {
      expect(within(permissionTable).getByText(permission)).toBeVisible()
    }
    const personalKnowledgeRow = within(permissionTable)
      .getByText("管理自有知识库，并使用获授权知识库")
      .closest("tr")
    const knowledgeGovernanceRow = within(permissionTable)
      .getByText("治理全局知识库元数据与生命周期（不自动获得正文权限）")
      .closest("tr")
    if (!personalKnowledgeRow || !knowledgeGovernanceRow) {
      throw new Error("Expected knowledge permission rows")
    }
    expect(within(personalKnowledgeRow).getAllByRole("cell")).toHaveLength(3)
    expect(within(personalKnowledgeRow).getAllByText("是")).toHaveLength(2)
    expect(within(knowledgeGovernanceRow).getByText("否")).toBeVisible()
    expect(within(knowledgeGovernanceRow).getByText("是")).toBeVisible()
    expect(
      screen.getByText(
        /管理员身份本身不授予其他用户的任务正文或知识库正文访问权/
      )
    ).toBeVisible()
    expect(await screen.findByText("14 个账号")).toBeVisible()
    expect(screen.getByText("3 个账号")).toBeVisible()
    expect(
      screen.queryByRole("button", {
        name: /新增角色|创建角色|编辑角色|删除角色/,
      })
    ).not.toBeInTheDocument()

    await act(async () => {
      await i18n.changeLanguage("en-US")
    })
    expect(
      screen.getByText(
        "Manage owned knowledge bases and use shared knowledge bases"
      )
    ).toBeVisible()
    expect(
      screen.getByText(
        "View model usage and cost globally, by group, and by user"
      )
    ).toBeVisible()
    expect(
      screen.getByText(
        /does not grant access to other users' task or knowledge base content/
      )
    ).toBeVisible()
  }, 10_000)

  it("switches between users and user groups with the combined page tabs", async () => {
    installApiMock()
    const interaction = userEvent.setup()
    renderApp("/admin/users")

    expect(
      await screen.findByRole(
        "heading",
        { name: "用户与用户组" },
        { timeout: 5_000 }
      )
    ).toBeVisible()
    const tablist = screen.getByRole("tablist", {
      name: "用户与用户组管理",
    })
    expect(
      within(tablist)
        .getAllByRole("tab")
        .map((tab) => tab.textContent)
    ).toEqual(["用户", "用户组"])
    expect(screen.getByRole("tab", { name: "用户" })).toHaveAttribute(
      "aria-selected",
      "true"
    )
    expect(screen.getByRole("tab", { name: "用户组" })).toHaveAttribute(
      "aria-selected",
      "false"
    )
    expect(tablist).toHaveClass(
      "max-w-full",
      "justify-start",
      "overflow-x-auto"
    )

    await interaction.click(screen.getByRole("tab", { name: "用户组" }))

    expect(await screen.findByText("暂无用户组")).toBeVisible()
    expect(screen.getByRole("tab", { name: "用户组" })).toHaveAttribute(
      "aria-selected",
      "true"
    )
    expect(screen.getByRole("button", { name: "创建用户组" })).toBeVisible()
  })

  it("deletes a user group after an empty 204 response", async () => {
    const { requests } = installApiMock({
      userGroupsOverride: [
        {
          id: "group-1",
          name: "测试",
          description: undefined,
          member_count: 1,
        },
      ],
    })
    const interaction = userEvent.setup()
    renderApp("/admin/groups")

    const groupHeading = await screen.findByRole(
      "heading",
      { name: "测试" },
      { timeout: 3_000 }
    )
    const groupRow = groupHeading.closest("article")
    expect(groupRow).not.toBeNull()
    await interaction.click(
      within(groupRow as HTMLElement).getByRole("button", { name: "操作" })
    )
    await interaction.click(
      await screen.findByRole("menuitem", { name: "删除" })
    )
    await interaction.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "删除" })
    )

    expect(await screen.findByText("暂无用户组")).toBeVisible()
    expect(
      screen.queryByRole("heading", { name: "测试" })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByText("无法连接服务，请检查网络后重试。")
    ).not.toBeInTheDocument()
    expect(
      requests.some(
        (request) =>
          request.path === "/api/v1/admin/user-groups/group-1" &&
          request.method === "DELETE"
      )
    ).toBe(true)
  })

  it("shows a user group's member count and opens its member list", async () => {
    const { requests } = installApiMock({
      userGroupsOverride: [
        {
          id: "group-1",
          name: "IT 部门",
          description: undefined,
          member_count: 1,
          member_ids: ["user-1"],
        },
      ],
      managedUsersOverride: [
        {
          id: "user-1",
          name: "林晓",
          email: "lin@example.com",
          user_group_ids: ["group-1"],
        },
      ],
    })
    const interaction = userEvent.setup()
    renderApp("/admin/groups")

    const memberCount = await screen.findByRole(
      "button",
      { name: "查看用户组 IT 部门 的 1 名成员" },
      { timeout: 5_000 }
    )
    expect(memberCount).toHaveTextContent("成员数: 1")

    await interaction.click(memberCount)

    const dialog = await screen.findByRole("dialog", {
      name: "IT 部门的成员",
    })
    expect(within(dialog).getByText("共 1 名成员")).toBeVisible()
    expect(within(dialog).getAllByText("林晓")).toHaveLength(2)
    expect(within(dialog).getByText("lin@example.com")).toBeVisible()
    const memberList = within(dialog).getByRole("list", {
      name: "用户组成员列表",
    })
    expect(memberList).toHaveClass("divide-border/50")
    expect(memberList.parentElement).toHaveClass("border-border/50")
    expect(
      requests.some(
        (request) =>
          request.path === "/api/v1/admin/users" &&
          new URLSearchParams(request.query).get("user_group_id") === "group-1"
      )
    ).toBe(true)
  })

  it("searches and selects user group members by name or email", async () => {
    installApiMock()
    const interaction = userEvent.setup()
    renderApp("/admin/groups")

    await interaction.click(
      await screen.findByRole("button", { name: "创建用户组" })
    )
    const dialog = await screen.findByRole("dialog", { name: "创建用户组" })
    const memberTrigger = within(dialog).getByRole("button", {
      name: "选择成员",
    })

    await interaction.click(memberTrigger)
    const searchInput = await screen.findByPlaceholderText("搜索成员姓名或邮箱")
    const memberPicker = searchInput.closest('[data-slot="popover-content"]')
    if (!(memberPicker instanceof HTMLElement)) {
      throw new Error("Expected the member picker popover to be rendered.")
    }

    await interaction.type(searchInput, "林晓")
    expect(within(memberPicker).getByText("lin@example.com")).toBeVisible()

    await interaction.clear(searchInput)
    await interaction.type(searchInput, "lin@example.com")
    await interaction.click(within(memberPicker).getByText("林晓"))
    expect(memberTrigger).toHaveTextContent("林晓")

    await interaction.click(within(memberPicker).getByText("林晓"))
    expect(memberTrigger).toHaveTextContent("选择成员")
  })

  it("selects and removes a priority Skill", async () => {
    installApiMock()
    const interaction = userEvent.setup()
    renderApp()
    await interaction.click(await screen.findByRole("button", { name: "添加" }))
    expect(
      await screen.findByPlaceholderText("搜索可用插件或 Skill…")
    ).toBeInTheDocument()
    await interaction.click(screen.getByText("报告写作"))
    expect(
      screen.getByRole("button", { name: "移除 报告写作" })
    ).toBeInTheDocument()
    await interaction.click(
      screen.getByRole("button", { name: "移除 报告写作" })
    )
    expect(
      screen.queryByRole("button", { name: "移除 报告写作" })
    ).not.toBeInTheDocument()
  })

  it("automatically queues a running follow-up using the saved default", async () => {
    const { requests } = installApiMock()
    const interaction = userEvent.setup()
    renderApp()
    await interaction.type(
      await screen.findByRole("textbox", { name: "任务输入框" }),
      "补充关注雨天预案"
    )
    await interaction.keyboard("{Enter}")

    await waitFor(() =>
      expect(
        requests.find(
          (request) =>
            request.path === "/api/v1/conversations/c1/pending-requests" &&
            request.method === "POST"
        )?.body
      ).toEqual({
        input_text: "补充关注雨天预案",
        priority_capability_ids: [],
        knowledge_base_ids: [],
        collaboration_mode: "default",
        idempotency_key: expect.any(String),
      })
    )
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })

  it("blocks the composer and answers a native Plan-mode user-input request", async () => {
    const turnId = "30000000-0000-4000-8000-000000000003"
    const requestId = "30000000-0000-4000-8000-000000000005"
    const { requests } = installApiMock({
      conversationOverride: {
        collaboration_mode: "plan",
        turns: [{ id: turnId, status: "running", collaboration_mode: "plan" }],
        running_turn: {
          id: turnId,
          status: "running",
          collaboration_mode: "plan",
        },
        user_input_requests: [
          {
            id: requestId,
            conversation_id: "20000000-0000-4000-8000-000000000001",
            turn_id: turnId,
            item_id: "native-user-input-item-1",
            kind: "questions",
            questions: [
              {
                id: "scope",
                header: "范围",
                question: "请选择实施范围。",
                is_other: true,
                is_secret: false,
                options: [
                  {
                    label: "完整实现（推荐）",
                    description: "完成前后端与测试。",
                  },
                  { label: "仅做界面", description: "只增加入口。" },
                ],
              },
            ],
            status: "pending",
            auto_resolve_at: null,
            resolved_at: null,
            resolved_action: null,
            created_at: "2026-08-09T08:00:00.000Z",
            updated_at: "2026-08-09T08:00:00.000Z",
          },
        ],
      },
    })
    const interaction = userEvent.setup()
    renderApp()

    const requestCard = (
      await screen.findByRole(
        "heading",
        { name: "需要你的回答" },
        { timeout: 3_000 }
      )
    ).closest<HTMLElement>('[data-testid="conversation-user-input-request"]')
    const blockingPanel = requestCard?.closest<HTMLElement>(
      '[data-testid="conversation-blocking-panel"]'
    )
    expect(requestCard).toBeVisible()
    expect(blockingPanel).not.toBeNull()
    expect(screen.getByRole("log")).toContainElement(blockingPanel ?? null)
    expect(requestCard?.closest(".conversation-column")).not.toBeNull()
    expect(requestCard?.closest(".conversation-bottom-stack")).toBeNull()
    expect(
      screen.queryByRole("textbox", { name: "任务输入框" })
    ).not.toBeInTheDocument()
    await interaction.click(
      screen.getByRole("radio", { name: /完整实现（推荐）/ })
    )
    await interaction.click(screen.getByRole("button", { name: "提交回答" }))

    await waitFor(() =>
      expect(
        requests.find(
          (request) =>
            request.path ===
              `/api/v1/conversations/c1/user-input-requests/${requestId}/respond` &&
            request.method === "POST"
        )?.body
      ).toEqual({
        action: "accept",
        content: { scope: "完整实现（推荐）" },
      })
    )
  })

  it("restores a persisted LinkSense form after refresh when the running-turn snapshot is temporarily different", async () => {
    const requestTurnId = "30000000-0000-4000-8000-000000000013"
    const snapshotTurnId = "30000000-0000-4000-8000-000000000014"
    const requestId = "30000000-0000-4000-8000-000000000015"
    installApiMock({
      conversationOverride: {
        turns: [
          {
            id: requestTurnId,
            status: "running",
            collaboration_mode: "default",
          },
          {
            id: snapshotTurnId,
            status: "running",
            collaboration_mode: "default",
          },
        ],
        running_turn: {
          id: snapshotTurnId,
          status: "running",
          collaboration_mode: "default",
        },
        user_input_requests: [
          {
            id: requestId,
            conversation_id: "20000000-0000-4000-8000-000000000001",
            turn_id: requestTurnId,
            item_id: "linksense-form-31",
            kind: "form",
            server_name: "linksense_core",
            message: "请确认是否创建草稿。",
            requested_schema: {
              type: "object",
              properties: {
                decision: {
                  type: "string",
                  title: "审批结果",
                  oneOf: [
                    { const: "approve", title: "批准创建草稿" },
                    { const: "reject", title: "拒绝" },
                  ],
                },
              },
              required: ["decision"],
            },
            ui_hints: {},
            response_semantics: {
              kind: "approval",
              decision_field_id: "decision",
              approve_value: "approve",
              reject_value: "reject",
            },
            response_content: null,
            status: "pending",
            auto_resolve_at: "2026-08-25T01:15:00.000Z",
            resolved_at: null,
            resolved_action: null,
            created_at: "2026-08-25T01:05:00.000Z",
            updated_at: "2026-08-25T01:05:00.000Z",
          },
        ],
      },
    })

    renderApp()

    expect(
      await screen.findByRole(
        "heading",
        { name: "需要你确认信息" },
        { timeout: 3_000 }
      )
    ).toBeVisible()
    expect(screen.getByText("请确认是否创建草稿。")).toBeVisible()
    expect(
      screen.queryByRole("textbox", { name: "任务输入框" })
    ).not.toBeInTheDocument()
  })

  it("restores a queued request to the composer for editing", async () => {
    const { requests } = installApiMock({
      conversationOverride: {
        pending_requests: [
          {
            id: "pending-edit-1",
            sequence_no: 1,
            status: "waiting_previous_turn",
            input_text: "补充雨天活动预案",
            priority_capability_ids: ["s1"],
            attachments: [],
          },
        ],
      },
    })
    const interaction = userEvent.setup()
    renderApp()

    await interaction.click(
      await screen.findByRole("button", { name: "查看后续请求详情" })
    )
    await interaction.click(
      await screen.findByRole("menuitem", { name: "编辑信息" })
    )

    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: "任务输入框" })).toHaveValue(
        "补充雨天活动预案"
      )
    )
    expect(screen.getByRole("button", { name: "移除 报告写作" })).toBeVisible()
    expect(
      requests.some(
        (request) =>
          request.path ===
            "/api/v1/conversations/c1/pending-requests/pending-edit-1/restore-draft" &&
          request.method === "POST"
      )
    ).toBe(true)
    expect(screen.queryByRole("region", { name: "后续请求" })).toBeNull()
    expect(
      screen.queryByText("已将排队信息恢复到输入框，可以继续编辑。")
    ).toBeNull()
  })

  it("guides the first plain-text queued request without creating a new turn", async () => {
    const { requests } = installApiMock({
      conversationOverride: {
        pending_requests: [
          {
            id: "pending-guide-1",
            sequence_no: 1,
            status: "waiting_previous_turn",
            input_text: "优先检查 AirPods 断开后的麦克风切换。",
            priority_capability_ids: [],
            attachments: [],
          },
        ],
      },
    })
    const interaction = userEvent.setup()
    renderApp()

    await interaction.click(await screen.findByRole("button", { name: "引导" }))

    await waitFor(() =>
      expect(
        requests.some(
          (request) =>
            request.path ===
              "/api/v1/conversations/c1/pending-requests/pending-guide-1/steer" &&
            request.method === "POST"
        )
      ).toBe(true)
    )
    expect(
      requests.some(
        (request) =>
          request.path === "/api/v1/conversations/c1/turns" &&
          request.method === "POST"
      )
    ).toBe(false)
    await waitFor(() =>
      expect(screen.queryByRole("region", { name: "后续请求" })).toBeNull()
    )
    expect(screen.queryByText("已将队首后续请求引导到当前执行。")).toBeNull()
  })

  it("closes a queued request from the details menu", async () => {
    const { requests } = installApiMock({
      conversationOverride: {
        pending_requests: [
          {
            id: "pending-close-1",
            sequence_no: 1,
            status: "waiting_previous_turn",
            input_text: "不再需要的补充要求",
            priority_capability_ids: [],
            attachments: [],
          },
        ],
      },
    })
    const interaction = userEvent.setup()
    renderApp()

    await interaction.click(
      await screen.findByRole("button", { name: "查看后续请求详情" })
    )
    await interaction.click(
      await screen.findByRole("menuitem", { name: "关闭排队" })
    )

    await waitFor(() =>
      expect(
        requests.some(
          (request) =>
            request.path ===
              "/api/v1/conversations/c1/pending-requests/pending-close-1" &&
            request.method === "DELETE"
        )
      ).toBe(true)
    )
    await waitFor(() =>
      expect(screen.queryByRole("region", { name: "后续请求" })).toBeNull()
    )
    expect(
      screen.queryByText("后续请求已取消，待用附件已恢复为任务草稿附件。")
    ).toBeNull()
  })

  it("automatically guides a running follow-up when the saved default is steer", async () => {
    const { requests } = installApiMock({
      userOverride: { running_message_action: "steer" },
    })
    const interaction = userEvent.setup()
    renderApp()
    await interaction.type(
      await screen.findByRole("textbox", { name: "任务输入框" }),
      "优先补充风险阈值"
    )
    await interaction.keyboard("{Enter}")

    await waitFor(() =>
      expect(
        requests.find(
          (request) =>
            request.path === "/api/v1/conversations/c1/turns/turn-1/steer" &&
            request.method === "POST"
        )?.body
      ).toEqual({
        text: "优先补充风险阈值",
        idempotency_key: expect.any(String),
      })
    )
    expect(
      requests.some(
        (request) =>
          request.path === "/api/v1/conversations/c1/pending-requests" &&
          request.method === "POST"
      )
    ).toBe(false)
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })

  it("keeps Send visible for an attachment-only draft", async () => {
    const { requests } = installApiMock({
      conversationOverride: {
        draft_input: "",
        turns: [],
        running_turn: null,
        execution_status: "idle",
        attachments: [
          {
            id: "draft-attachment-1",
            name: "活动简报.pdf",
            kind: "attachment",
            status: "draft",
            size: 1024,
          },
        ],
      },
    })
    const interaction = userEvent.setup()
    renderApp()

    const input = await screen.findByRole(
      "textbox",
      { name: "任务输入框" },
      { timeout: 15_000 }
    )
    const send = screen.getByRole("button", { name: "发送" })
    expect(send).toBeEnabled()
    expect(send).toHaveAttribute("aria-disabled", "false")

    await interaction.type(input, "请分析附件")
    expect(screen.getByRole("button", { name: "发送" })).toBe(send)
    await waitFor(() => expect(send).toBeEnabled())
    await interaction.click(send)
    await waitFor(() =>
      expect(
        requests.find(
          (request) =>
            request.path === "/api/v1/conversations/c1/turns" &&
            request.method === "POST"
        )?.body
      ).toEqual({
        input_text: "请分析附件",
        priority_capability_ids: [],
        knowledge_base_ids: [],
        collaboration_mode: "default",
        idempotency_key: expect.any(String),
      })
    )
  })

  it("returns to the latest message immediately when sending a new turn", async () => {
    installApiMock({
      conversationOverride: {
        draft_input: "",
        execution_status: "completed",
        turns: [{ id: "turn-1", status: "completed" }],
        running_turn: null,
      },
    })
    const interaction = userEvent.setup()
    renderApp()

    const log = await screen.findByRole("log")
    Object.defineProperties(log, {
      scrollHeight: { configurable: true, get: () => 2_000 },
      clientHeight: { configurable: true, get: () => 500 },
    })
    log.scrollTop = 800
    fireEvent.wheel(log, { deltaY: -200 })
    fireEvent.scroll(log)
    const scrollToBottomButton = await screen.findByRole("button", {
      name: "回到底部",
    })
    expect(scrollToBottomButton).toBeVisible()
    expect(scrollToBottomButton).toHaveClass("size-9")

    await interaction.type(
      screen.getByRole("textbox", { name: "任务输入框" }),
      "请补充风险建议"
    )
    await interaction.click(screen.getByRole("button", { name: "发送" }))

    expect(log.scrollTop).toBe(2_000)
    expect(screen.queryByRole("button", { name: "回到底部" })).toBeNull()
  })

  it("shows the active task loading indicator immediately when sending a new turn", async () => {
    let resolveTurnStart: ((response: Response) => void) | undefined
    const pendingTurnStart = new Promise<Response>((resolve) => {
      resolveTurnStart = resolve
    })
    const { requests } = installApiMock({
      conversationOverride: {
        draft_input: "",
        execution_status: "completed",
        turns: [{ id: "turn-1", status: "completed" }],
        running_turn: null,
      },
      conversationListResponse: () =>
        json({
          success: true,
          data: {
            items: conversations.map((item) =>
              item.id === "c1"
                ? { ...item, execution_status: "completed" }
                : item
            ),
            next_cursor: null,
            total_count: conversations.length,
          },
        }),
      turnStartResponse: () => pendingTurnStart,
    })
    const interaction = userEvent.setup()
    renderApp()

    const sidebar = await screen.findByRole(
      "complementary",
      { name: "LinkSense 导航" },
      { timeout: 5_000 }
    )
    const title = await within(sidebar).findByText("活动风险评估")
    const item = title.closest(".sidebar-conversation-item")
    expect(item).not.toBeNull()
    expect(
      within(item as HTMLElement).queryByRole("status", { name: "执行中" })
    ).toBeNull()

    await interaction.type(
      screen.getByRole("textbox", { name: "任务输入框" }),
      "请补充风险建议"
    )
    await interaction.click(screen.getByRole("button", { name: "发送" }))

    expect(
      within(item as HTMLElement).getByRole("status", { name: "执行中" })
    ).toBeVisible()
    expect(title.closest("a")).toHaveAttribute("aria-busy", "true")

    const detailRequestCountBeforeAdmission = requests.filter(
      (request) =>
        request.path === "/api/v1/conversations/c1" && request.method === "GET"
    ).length
    await act(async () => {
      resolveTurnStart?.(
        json(
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
      )
      await pendingTurnStart
    })
    await waitFor(() =>
      expect(
        requests.filter(
          (request) =>
            request.path === "/api/v1/conversations/c1" &&
            request.method === "GET"
        ).length
      ).toBeGreaterThan(detailRequestCountBeforeAdmission)
    )
    await act(
      () => new Promise<void>((resolve) => window.setTimeout(resolve, 50))
    )

    expect(
      within(item as HTMLElement).getByRole("status", { name: "执行中" })
    ).toBeVisible()
    expect(title.closest("a")).toHaveAttribute("aria-busy", "true")
  })

  it("regenerates from the edited latest user message without changing the composer draft", async () => {
    const { requests } = installApiMock({
      conversationOverride: {
        draft_input: "输入框里保留的草稿",
        draft_capability_ids: [],
        execution_status: "completed",
        messages: [
          {
            id: "m1",
            role: "user",
            turn_id: "turn-1",
            created_at: "2026-07-11T08:00:00.000Z",
            updated_at: "2026-07-11T08:00:00.000Z",
            content: "请评估活动风险",
          },
          {
            id: "m2",
            role: "assistant",
            turn_id: "turn-1",
            phase: "final_answer",
            created_at: "2026-07-11T08:00:03.000Z",
            content: "原始风险评估。",
          },
        ],
        turns: [
          {
            id: "turn-1",
            status: "completed",
            started_at: "2026-07-11T08:00:00.000Z",
            completed_at: "2026-07-11T08:00:03.000Z",
          },
        ],
        running_turn: null,
        pending_requests: [],
      },
    })
    const interaction = userEvent.setup()
    renderApp()

    const userMessage = await screen.findByRole("article", { name: "用户消息" })
    const composer = screen.getByRole("textbox", { name: "任务输入框" })
    await waitFor(() => expect(composer).toHaveValue("输入框里保留的草稿"))
    await interaction.click(
      within(userMessage).getByRole("button", { name: "编辑消息" })
    )
    const editor = within(userMessage).getByRole("textbox", {
      name: "编辑消息内容",
    })
    await interaction.clear(editor)
    await interaction.type(editor, "请重新评估活动风险，并补充雨天预案")
    await interaction.click(
      within(userMessage).getByRole("button", { name: "发送" })
    )

    await waitFor(() =>
      expect(
        requests.find(
          (request) =>
            request.path ===
              "/api/v1/conversations/c1/messages/m1/regenerate" &&
            request.method === "POST"
        )?.body
      ).toEqual({
        input_text: "请重新评估活动风险，并补充雨天预案",
        idempotency_key: expect.any(String),
      })
    )
    expect(composer).toHaveValue("输入框里保留的草稿")
    expect(
      requests.some(
        (request) =>
          request.path === "/api/v1/conversations/c1/draft" &&
          request.method === "PUT"
      )
    ).toBe(false)
  })

  it("branches from an assistant message and opens the new numbered task", async () => {
    let conversationListCalls = 0
    let finishSidebarRefresh: ((response: Response) => void) | undefined
    const pendingSidebarRefresh = new Promise<Response>((resolve) => {
      finishSidebarRefresh = resolve
    })
    const { requests } = installApiMock({
      conversationListResponse: (_query, state) => {
        conversationListCalls += 1
        if (state.forkCalls === 0) {
          return json({
            success: true,
            data: {
              items: conversations,
              next_cursor: null,
              total_count: conversations.length,
            },
          })
        }
        return pendingSidebarRefresh
      },
      conversationOverride: {
        execution_status: "completed",
        messages: [
          {
            id: "m1",
            role: "user",
            turn_id: "turn-1",
            created_at: "2026-07-11T08:00:00.000Z",
            content: "请评估活动风险",
          },
          {
            id: "m2",
            role: "assistant",
            turn_id: "turn-1",
            phase: "final_answer",
            created_at: "2026-07-11T08:00:03.000Z",
            content: "原始风险评估。",
          },
        ],
        turns: [
          {
            id: "turn-1",
            status: "completed",
            started_at: "2026-07-11T08:00:00.000Z",
            completed_at: "2026-07-11T08:00:03.000Z",
          },
        ],
        running_turn: null,
        pending_requests: [],
      },
    })
    const interaction = userEvent.setup()
    renderApp()

    const assistantMessage = await screen.findByRole(
      "article",
      { name: "助手回复" },
      { timeout: 5_000 }
    )
    await interaction.click(
      within(assistantMessage).getByRole("button", { name: "分支到新聊天" })
    )

    await waitFor(() =>
      expect(
        requests.find(
          (request) =>
            request.path === "/api/v1/conversations/c1/messages/m2/fork" &&
            request.method === "POST"
        )?.body
      ).toEqual({ idempotency_key: expect.any(String) })
    )
    expect(await screen.findByText("活动风险评估(2)已加载。")).toBeVisible()
    const sidebar = screen.getByRole("complementary", {
      name: "LinkSense 导航",
    })
    expect(within(sidebar).getByText("活动风险评估(2)")).toBeVisible()
    expect(conversationListCalls).toBeGreaterThan(1)

    await interaction.click(
      within(sidebar).getByText("活动风险评估", { exact: true })
    )
    const sourceAssistantMessage = await screen.findByRole("article", {
      name: "助手回复",
    })
    await interaction.click(
      within(sourceAssistantMessage).getByRole("button", {
        name: "分支到新聊天",
      })
    )

    expect(await screen.findByText("活动风险评估(3)已加载。")).toBeVisible()
    expect(within(sidebar).getByText("活动风险评估(3)")).toBeVisible()
    const forkRequests = requests.filter(
      (request) =>
        request.path === "/api/v1/conversations/c1/messages/m2/fork" &&
        request.method === "POST"
    )
    expect(forkRequests).toHaveLength(2)
    expect(forkRequests[0]?.body).toEqual({
      idempotency_key: expect.any(String),
    })
    expect(forkRequests[1]?.body).toEqual({
      idempotency_key: expect.any(String),
    })
    expect(
      (forkRequests[1]?.body as { idempotency_key: string }).idempotency_key
    ).not.toBe(
      (forkRequests[0]?.body as { idempotency_key: string }).idempotency_key
    )

    finishSidebarRefresh?.(
      json({
        success: true,
        data: {
          items: [
            {
              ...conversations[0],
              id: "c4",
              title: "活动风险评估(2)",
              execution_status: "completed",
              updated_at: new Date().toISOString(),
            },
            ...conversations,
          ],
          next_cursor: null,
          total_count: conversations.length + 1,
        },
      })
    )
  })

  it("replaces the latest turn optimistically without waiting for regeneration admission", async () => {
    let acceptRegeneration: ((response: Response) => void) | undefined
    const regenerationAdmission = new Promise<Response>((resolve) => {
      acceptRegeneration = resolve
    })
    installApiMock({
      conversationOverride: {
        execution_status: "completed",
        messages: [
          {
            id: "m1",
            role: "user",
            turn_id: "turn-1",
            created_at: "2026-07-11T08:00:00.000Z",
            content: "原始请求",
          },
          {
            id: "m2",
            role: "assistant",
            turn_id: "turn-1",
            phase: "final_answer",
            created_at: "2026-07-11T08:00:03.000Z",
            content: "原始回复",
          },
        ],
        turns: [
          {
            id: "turn-1",
            status: "completed",
            started_at: "2026-07-11T08:00:00.000Z",
            completed_at: "2026-07-11T08:00:03.000Z",
          },
        ],
        running_turn: null,
        pending_requests: [],
      },
      regenerateResponse: () => regenerationAdmission,
    })
    const interaction = userEvent.setup()
    renderApp()

    const sourceMessage = await screen.findByRole("article", {
      name: "用户消息",
    })
    await interaction.click(
      within(sourceMessage).getByRole("button", { name: "编辑消息" })
    )
    const editor = within(sourceMessage).getByRole("textbox", {
      name: "编辑消息内容",
    })
    await interaction.clear(editor)
    await interaction.type(editor, "立即显示的新请求")
    await interaction.click(
      within(sourceMessage).getByRole("button", { name: "发送" })
    )

    await waitFor(() => {
      const optimisticMessages = screen.getAllByRole("article", {
        name: "用户消息",
      })
      expect(optimisticMessages).toHaveLength(1)
      expect(
        within(optimisticMessages[0]).getByText("立即显示的新请求")
      ).toBeVisible()
    })
    expect(screen.queryByText("原始请求")).toBeNull()
    expect(screen.queryByText("原始回复")).toBeNull()
    expect(screen.queryByRole("button", { name: "正在发送" })).toBeNull()

    await act(async () => {
      acceptRegeneration?.(
        json(
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
      )
      await regenerationAdmission
    })
  })

  it("does not restore the optimistic source message after interrupting and regenerating an edit", async () => {
    const originalContent =
      "帮我制作一个AI发展的PPT。挑一个合适的主题帮我实现就行，不用再继续追问了"
    const editedContent = "挑一个合适的主题帮我实现就行，不用再继续追问了"
    const sourceTurnId = "00000000-0000-4000-8000-000000000011"
    const editedTurnId = "00000000-0000-4000-8000-000000000012"
    let phase: "idle" | "running" | "interrupted" | "regenerated" = "idle"
    const detail = () => {
      if (phase === "idle") {
        return {
          ...conversation,
          execution_status: "idle",
          messages: [],
          turns: [],
          running_turn: null,
        }
      }
      if (phase === "regenerated") {
        return {
          ...conversation,
          execution_status: "running",
          messages: [
            {
              id: "edited-message",
              role: "user",
              turn_id: editedTurnId,
              created_at: "2026-07-11T08:01:00.000Z",
              content: editedContent,
            },
          ],
          turns: [{ id: editedTurnId, status: "running" }],
          running_turn: { id: editedTurnId, status: "running" },
        }
      }
      const status = phase === "running" ? "running" : "interrupted"
      return {
        ...conversation,
        execution_status: status,
        messages: [
          {
            id: "source-message",
            role: "user",
            turn_id: sourceTurnId,
            created_at: "2026-07-11T08:00:00.000Z",
            content: originalContent,
          },
        ],
        turns: [{ id: sourceTurnId, status }],
        running_turn:
          status === "running" ? { id: sourceTurnId, status } : null,
      }
    }
    const { requests } = installApiMock({
      conversationGetResponse: async () =>
        json({ success: true, data: detail() }),
      turnStartResponse: async () => {
        phase = "running"
        return json(
          {
            success: true,
            data: {
              turn_id: sourceTurnId,
              accepted: true,
              status: "starting",
            },
          },
          202
        )
      },
      interruptResponse: () => {
        phase = "interrupted"
        return json(
          {
            success: true,
            data: { code: "TURN_INTERRUPT_REQUESTED" },
          },
          202
        )
      },
      regenerateResponse: () => {
        phase = "regenerated"
        return json(
          {
            success: true,
            data: {
              turn_id: editedTurnId,
              accepted: true,
              status: "starting",
            },
          },
          202
        )
      },
    })
    const interaction = userEvent.setup()
    renderApp()

    const composer = await screen.findByRole("textbox", { name: "任务输入框" })
    await interaction.type(composer, originalContent)
    await interaction.click(screen.getByRole("button", { name: "发送" }))
    await waitFor(() =>
      expect(
        requests.some(
          (request) =>
            request.path === "/api/v1/conversations/c1/turns" &&
            request.method === "POST"
        )
      ).toBe(true)
    )
    const sourceMessage = await screen.findByRole("article", {
      name: "用户消息",
    })
    expect(within(sourceMessage).getByText(originalContent)).toBeVisible()

    await interaction.click(screen.getByRole("button", { name: "停止" }))
    const editButton = await within(sourceMessage).findByRole("button", {
      name: "编辑消息",
    })
    await interaction.click(editButton)
    const editor = within(sourceMessage).getByRole("textbox", {
      name: "编辑消息内容",
    })
    await interaction.clear(editor)
    await interaction.type(editor, editedContent)
    await interaction.click(
      within(sourceMessage).getByRole("button", { name: "发送" })
    )

    const userMessages = await screen.findAllByRole("article", {
      name: "用户消息",
    })
    expect(userMessages).toHaveLength(1)
    expect(within(userMessages[0]).getByText(editedContent)).toBeVisible()
    expect(
      within(userMessages[0]).queryByText(originalContent)
    ).not.toBeInTheDocument()
  })

  it("loads a persisted draft image as a thumbnail and opens the shared preview", async () => {
    const originalCreateObjectUrl = Object.getOwnPropertyDescriptor(
      URL,
      "createObjectURL"
    )
    const originalRevokeObjectUrl = Object.getOwnPropertyDescriptor(
      URL,
      "revokeObjectURL"
    )
    const createObjectURL = vi.fn(() => "blob:draft-image-preview")
    const revokeObjectURL = vi.fn()
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createObjectURL,
    })
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: revokeObjectURL,
    })

    try {
      const { requests } = installApiMock({
        conversationOverride: {
          turns: [],
          running_turn: null,
          execution_status: "idle",
          attachments: [
            {
              id: "draft-image-1",
              name: "活动现场.png",
              mime_type: "image/png",
              kind: "attachment",
              status: "draft",
              size: 1024,
            },
          ],
        },
      })
      const interaction = userEvent.setup()
      const view = renderApp()

      const preview = await screen.findByRole(
        "button",
        { name: "预览图片 活动现场.png" },
        { timeout: 3_000 }
      )
      expect(createObjectURL).toHaveBeenCalledOnce()
      expect(
        requests.some(
          (request) =>
            request.path ===
              "/api/v1/conversations/c1/attachments/draft-image-1/content" &&
            request.method === "GET"
        )
      ).toBe(true)

      await interaction.click(preview)
      expect(
        await screen.findByRole("img", { name: "活动现场.png" })
      ).toHaveAttribute("src", "blob:draft-image-preview")

      vi.useFakeTimers()
      view.unmount()
      expect(revokeObjectURL).not.toHaveBeenCalled()
      await act(async () => vi.advanceTimersByTime(2_000))
      expect(revokeObjectURL).toHaveBeenCalledWith("blob:draft-image-preview")
    } finally {
      if (originalCreateObjectUrl) {
        Object.defineProperty(URL, "createObjectURL", originalCreateObjectUrl)
      } else {
        Reflect.deleteProperty(URL, "createObjectURL")
      }
      if (originalRevokeObjectUrl) {
        Object.defineProperty(URL, "revokeObjectURL", originalRevokeObjectUrl)
      } else {
        Reflect.deleteProperty(URL, "revokeObjectURL")
      }
    }
  })

  it("waits for an in-flight autosave and submits with the advanced draft version", async () => {
    let resolveDraftSave: ((response: Response) => void) | undefined
    const { requests } = installApiMock({
      conversationOverride: {
        turns: [],
        running_turn: null,
        execution_status: "idle",
      },
      draftPutResponse: async () =>
        new Promise((resolve) => {
          resolveDraftSave = resolve
        }),
    })
    const interaction = userEvent.setup()
    renderApp()

    await interaction.type(
      await screen.findByRole("textbox", { name: "任务输入框" }),
      "提交前先保存"
    )
    await waitFor(
      () =>
        expect(
          requests.filter(
            (request) =>
              request.path === "/api/v1/conversations/c1/draft" &&
              request.method === "PUT"
          )
        ).toHaveLength(1),
      { timeout: 2_000 }
    )

    await interaction.click(screen.getByRole("button", { name: "发送" }))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(
      requests.some(
        (request) =>
          request.path === "/api/v1/conversations/c1/turns" &&
          request.method === "POST"
      )
    ).toBe(false)

    resolveDraftSave?.(
      json({
        success: true,
        data: {
          ...conversation.draft,
          input_text: "提交前先保存",
          updated_at: "2026-07-11T08:00:01.000Z",
        },
      })
    )
    await waitFor(() =>
      expect(
        requests.find(
          (request) =>
            request.path === "/api/v1/conversations/c1/turns" &&
            request.method === "POST"
        )?.body
      ).toEqual({
        input_text: "提交前先保存",
        priority_capability_ids: [],
        knowledge_base_ids: [],
        collaboration_mode: "default",
        idempotency_key: expect.any(String),
      })
    )
    expect(
      requests.find(
        (request) =>
          request.path === "/api/v1/conversations/c1/draft" &&
          request.method === "PUT"
      )?.body
    ).toEqual({
      input_text: "提交前先保存",
      priority_capability_ids: [],
      knowledge_base_ids: [],
      expected_updated_at: "2026-07-11T08:00:00.000Z",
    })
  })

  it("interrupts once without an error when Stop is clicked before the turn start receipt", async () => {
    let resolveDraftSave: ((response: Response) => void) | undefined
    let resolveTurnStart: ((response: Response) => void) | undefined
    const draftSave = new Promise<Response>((resolve) => {
      resolveDraftSave = resolve
    })
    const { requests } = installApiMock({
      conversationOverride: {
        turns: [],
        running_turn: null,
        execution_status: "idle",
      },
      draftPutResponse: async () =>
        draftSave.then((response) => response.clone()),
      turnStartResponse: async () =>
        new Promise((resolve) => {
          resolveTurnStart = resolve
        }),
    })
    const interaction = userEvent.setup()
    renderApp()

    const composer = await screen.findByRole(
      "textbox",
      { name: "任务输入框" },
      { timeout: 3_000 }
    )
    await interaction.type(composer, "立即显示这条消息")
    await interaction.click(screen.getByRole("button", { name: "发送" }))

    const optimisticUserMessage = (
      await screen.findAllByRole("article", {
        name: "用户消息",
      })
    ).find((element) => element.textContent?.includes("立即显示这条消息"))
    expect(optimisticUserMessage).toBeDefined()
    expect(
      within(optimisticUserMessage as HTMLElement).getByText("立即显示这条消息")
    ).toBeVisible()
    expect(screen.getByText("正在思考", { exact: true })).toBeVisible()
    expect(screen.queryByText("正在准备执行…")).toBeNull()
    const stop = screen.getByRole("button", { name: "停止" })
    expect(stop).toBeEnabled()
    await interaction.click(stop)
    expect(
      Array.from(
        document.querySelectorAll<HTMLButtonElement>(".send-button")
      ).map((button) => ({
        label: button.getAttribute("aria-label"),
        disabled: button.disabled,
      }))
    ).toEqual([{ label: "正在中断…", disabled: true }])
    expect(
      requests.some(
        (request) =>
          request.path.includes("/interrupt") && request.method === "POST"
      )
    ).toBe(false)
    await waitFor(() =>
      expect(
        requests.some(
          (request) =>
            request.path === "/api/v1/conversations/c1/draft" &&
            request.method === "PUT"
        )
      ).toBe(true)
    )
    expect(
      requests.some(
        (request) =>
          request.path === "/api/v1/conversations/c1/turns" &&
          request.method === "POST"
      )
    ).toBe(false)

    resolveDraftSave?.(
      json({
        success: true,
        data: {
          ...conversation.draft,
          input_text: "立即显示这条消息",
          updated_at: "2026-07-11T08:00:01.000Z",
        },
      })
    )
    await waitFor(() =>
      expect(
        requests.some(
          (request) =>
            request.path === "/api/v1/conversations/c1/turns" &&
            request.method === "POST"
        )
      ).toBe(true)
    )
    const draftRequestIndex = requests.findIndex(
      (request) =>
        request.path === "/api/v1/conversations/c1/draft" &&
        request.method === "PUT"
    )
    const turnRequestIndex = requests.findIndex(
      (request) =>
        request.path === "/api/v1/conversations/c1/turns" &&
        request.method === "POST"
    )
    expect(draftRequestIndex).toBeGreaterThanOrEqual(0)
    expect(turnRequestIndex).toBeGreaterThan(draftRequestIndex)
    expect(requests[draftRequestIndex]?.body).toEqual({
      input_text: "立即显示这条消息",
      priority_capability_ids: [],
      knowledge_base_ids: [],
      expected_updated_at: "2026-07-11T08:00:00.000Z",
    })

    resolveTurnStart?.(
      json(
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
    )

    await waitFor(() =>
      expect(
        requests.filter(
          (request) =>
            request.path ===
              "/api/v1/conversations/c1/turns/00000000-0000-4000-8000-000000000001/interrupt" &&
            request.method === "POST"
        )
      ).toHaveLength(1)
    )
    await waitFor(() => expect(composer).toHaveValue(""))
    await waitFor(() =>
      expect(
        document.querySelector('button[aria-label="正在中断…"]')
      ).toBeNull()
    )
    expect(screen.queryByRole("alert")).toBeNull()
  })

  it("queues a consecutive submission with a distinct operation", async () => {
    const { requests } = installApiMock({
      conversationOverride: {
        turns: [],
        running_turn: null,
        execution_status: "idle",
      },
    })
    const interaction = userEvent.setup()
    renderApp()

    const composer = await screen.findByRole(
      "textbox",
      { name: "任务输入框" },
      { timeout: 3_000 }
    )
    await interaction.type(composer, "第一条连续消息")
    await interaction.keyboard("{Enter}")
    await waitFor(() => expect(composer).toHaveValue(""))
    await waitFor(() => expect(composer).toBeEnabled(), { timeout: 3_000 })

    await interaction.type(composer, "紧接着发送第二条消息")
    await interaction.keyboard("{Enter}")

    await waitFor(
      () => {
        expect(
          requests.filter(
            (request) =>
              request.path === "/api/v1/conversations/c1/turns" &&
              request.method === "POST"
          )
        ).toHaveLength(1)
        expect(
          requests.filter(
            (request) =>
              request.path === "/api/v1/conversations/c1/pending-requests" &&
              request.method === "POST"
          )
        ).toHaveLength(1)
      },
      { timeout: 3_000 }
    )
    const turnRequests = requests.filter(
      (request) =>
        request.path === "/api/v1/conversations/c1/turns" &&
        request.method === "POST"
    )
    const pendingRequests = requests.filter(
      (request) =>
        request.path === "/api/v1/conversations/c1/pending-requests" &&
        request.method === "POST"
    )
    expect(turnRequests[0]?.body).toEqual({
      input_text: "第一条连续消息",
      priority_capability_ids: [],
      knowledge_base_ids: [],
      collaboration_mode: "default",
      idempotency_key: expect.any(String),
    })
    expect(pendingRequests[0]?.body).toEqual({
      input_text: "紧接着发送第二条消息",
      priority_capability_ids: [],
      knowledge_base_ids: [],
      collaboration_mode: "default",
      idempotency_key: expect.any(String),
    })
    expect(
      (turnRequests[0]?.body as { idempotency_key: string }).idempotency_key
    ).not.toBe(
      (pendingRequests[0]?.body as { idempotency_key: string }).idempotency_key
    )
  })

  it("recovers an unchanged draft version before starting a turn and saving a follow-up", async () => {
    const firstInput = "先生成一份概览"
    const followUp = "用于科普阅读"
    const { requests } = installApiMock({
      conversationOverride: {
        turns: [],
        running_turn: null,
        execution_status: "idle",
      },
      conversationGetResponse: async (callIndex) => {
        const isInitialLoad = callIndex === 1
        return json({
          success: true,
          data: {
            ...conversation,
            turns: [],
            running_turn: null,
            execution_status: "idle",
            draft_input: "",
            draft_capability_ids: [],
            draft: {
              ...conversation.draft,
              input_text: "",
              priority_capability_ids: [],
              updated_at: isInitialLoad
                ? "2026-07-11T08:00:00.000Z"
                : callIndex === 2
                  ? "2026-07-11T08:00:01.000Z"
                  : "2026-07-11T08:00:04.000Z",
            },
          },
        })
      },
      draftPutResponse: async (body, callIndex) => {
        if (callIndex === 1) {
          return json(
            {
              success: false,
              error_code: "DRAFT_VERSION_CONFLICT",
              message_key: "errors.draftVersionConflict",
            },
            409
          )
        }
        const input = body as {
          input_text: string
          priority_capability_ids: string[]
        }
        return json({
          success: true,
          data: {
            ...conversation.draft,
            input_text: input.input_text,
            priority_capability_ids: input.priority_capability_ids,
            updated_at:
              callIndex === 1
                ? "2026-07-11T08:00:01.000Z"
                : "2026-07-11T08:00:03.000Z",
          },
        })
      },
    })
    const interaction = userEvent.setup()
    renderApp()

    const composer = await screen.findByRole("textbox", {
      name: "任务输入框",
    })
    await interaction.type(composer, firstInput)
    await waitFor(() =>
      expect(
        requests.filter(
          (request) =>
            request.path === "/api/v1/conversations/c1/draft" &&
            request.method === "PUT"
        )
      ).toHaveLength(2)
    )
    await interaction.click(screen.getByRole("button", { name: "发送" }))
    await waitFor(() => expect(composer).toHaveValue(""))

    await interaction.type(composer, followUp)

    await waitFor(() => {
      const saves = requests.filter(
        (request) =>
          request.path === "/api/v1/conversations/c1/draft" &&
          request.method === "PUT"
      )
      expect(saves).toHaveLength(3)
      expect(saves[0]?.body).toEqual({
        input_text: firstInput,
        priority_capability_ids: [],
        knowledge_base_ids: [],
        expected_updated_at: "2026-07-11T08:00:00.000Z",
      })
      expect(saves[1]?.body).toEqual({
        input_text: firstInput,
        priority_capability_ids: [],
        knowledge_base_ids: [],
        expected_updated_at: "2026-07-11T08:00:01.000Z",
      })
      expect(saves[2]?.body).toEqual({
        input_text: followUp,
        priority_capability_ids: [],
        knowledge_base_ids: [],
        expected_updated_at: "2026-07-11T08:00:04.000Z",
      })
    })
    expect(
      screen.queryByText("草稿已在其他位置更新，请刷新后重试。")
    ).not.toBeInTheDocument()
  })

  it("treats an already-saved matching server draft as a successful autosave", async () => {
    const desiredDraft = "已经由同一页面保存的内容"
    const { requests } = installApiMock({
      conversationOverride: {
        turns: [],
        running_turn: null,
        execution_status: "idle",
      },
      conversationGetResponse: async (callIndex) =>
        json({
          success: true,
          data: {
            ...conversation,
            turns: [],
            running_turn: null,
            execution_status: "idle",
            draft_input: callIndex === 1 ? "" : desiredDraft,
            draft_capability_ids: [],
            draft: {
              ...conversation.draft,
              input_text: callIndex === 1 ? "" : desiredDraft,
              priority_capability_ids: [],
              knowledge_base_ids: [],
              updated_at:
                callIndex === 1
                  ? "2026-07-11T08:00:00.000Z"
                  : "2026-07-11T08:00:01.000Z",
            },
          },
        }),
      draftPutResponse: async () =>
        json(
          {
            success: false,
            error_code: "DRAFT_VERSION_CONFLICT",
            message_key: "errors.draftVersionConflict",
          },
          409
        ),
    })
    const interaction = userEvent.setup()
    renderApp()

    await interaction.type(
      await screen.findByRole("textbox", { name: "任务输入框" }),
      desiredDraft
    )
    await waitFor(() =>
      expect(
        requests.filter(
          (request) =>
            request.path === "/api/v1/conversations/c1" &&
            request.method === "GET"
        )
      ).toHaveLength(2)
    )
    await new Promise((resolve) => setTimeout(resolve, 700))

    expect(
      requests.filter(
        (request) =>
          request.path === "/api/v1/conversations/c1/draft" &&
          request.method === "PUT"
      )
    ).toHaveLength(1)
    expect(screen.queryByText("草稿内容发生冲突")).not.toBeInTheDocument()
  })

  it("merges non-overlapping local and server draft changes before retrying", async () => {
    const knowledgeBaseId = "10000000-0000-4000-8000-000000000001"
    const localDraft = "当前页面补充的内容"
    const { requests } = installApiMock({
      conversationOverride: {
        turns: [],
        running_turn: null,
        execution_status: "idle",
      },
      knowledgeBasesOverride: [
        knowledgeBaseFixture(knowledgeBaseId, "AISG Policy"),
      ],
      conversationGetResponse: async (callIndex) =>
        json({
          success: true,
          data: {
            ...conversation,
            turns: [],
            running_turn: null,
            execution_status: "idle",
            draft_input: "",
            draft_capability_ids: [],
            selected_knowledge_base_ids:
              callIndex === 1 ? [] : [knowledgeBaseId],
            draft: {
              ...conversation.draft,
              input_text: "",
              priority_capability_ids: [],
              knowledge_base_ids: callIndex === 1 ? [] : [knowledgeBaseId],
              updated_at:
                callIndex === 1
                  ? "2026-07-11T08:00:00.000Z"
                  : "2026-07-11T08:00:01.000Z",
            },
          },
        }),
      draftPutResponse: async (body, callIndex) => {
        if (callIndex === 1) {
          return json(
            {
              success: false,
              error_code: "DRAFT_VERSION_CONFLICT",
              message_key: "errors.draftVersionConflict",
            },
            409
          )
        }
        const input = body as {
          input_text: string
          priority_capability_ids: string[]
          knowledge_base_ids: string[]
        }
        return json({
          success: true,
          data: {
            ...conversation.draft,
            input_text: input.input_text,
            priority_capability_ids: input.priority_capability_ids,
            knowledge_base_ids: input.knowledge_base_ids,
            updated_at: "2026-07-11T08:00:02.000Z",
          },
        })
      },
    })
    const interaction = userEvent.setup()
    renderApp()

    const composer = await screen.findByRole("textbox", {
      name: "任务输入框",
    })
    await interaction.type(composer, localDraft)

    await waitFor(() => {
      const saves = requests.filter(
        (request) =>
          request.path === "/api/v1/conversations/c1/draft" &&
          request.method === "PUT"
      )
      expect(saves).toHaveLength(2)
      expect(saves[1]?.body).toEqual({
        input_text: localDraft,
        priority_capability_ids: [],
        knowledge_base_ids: [knowledgeBaseId],
        expected_updated_at: "2026-07-11T08:00:01.000Z",
      })
    })
    expect(composer).toHaveValue(localDraft)
    expect(
      await screen.findByRole("button", {
        name: "移除知识库 AISG Policy",
      })
    ).toBeVisible()
    expect(screen.queryByText("草稿内容发生冲突")).not.toBeInTheDocument()
  })

  it("reuses the latest saved draft version after navigating away and back", async () => {
    const { requests } = installApiMock({
      conversationOverride: {
        turns: [],
        running_turn: null,
        execution_status: "idle",
      },
    })
    const interaction = userEvent.setup()
    renderApp()

    let composer = await screen.findByRole("textbox", { name: "任务输入框" })
    await interaction.type(composer, "缓存中的草稿")
    await waitFor(() =>
      expect(
        requests.filter(
          (request) =>
            request.path === "/api/v1/conversations/c1/draft" &&
            request.method === "PUT"
        )
      ).toHaveLength(1)
    )

    const sidebar = screen.getByRole("complementary", {
      name: "LinkSense 导航",
    })
    await interaction.click(
      within(sidebar).getByText("整理项目会议纪要").closest("a") as HTMLElement
    )
    expect(await screen.findByText("整理项目会议纪要已加载。")).toBeVisible()
    await interaction.click(
      within(sidebar).getByText("活动风险评估").closest("a") as HTMLElement
    )
    composer = await screen.findByRole("textbox", { name: "任务输入框" })
    await waitFor(() => expect(composer).toHaveValue("缓存中的草稿"))
    await interaction.type(composer, "（已追加）")

    await waitFor(() => {
      const saves = requests.filter(
        (request) =>
          request.path === "/api/v1/conversations/c1/draft" &&
          request.method === "PUT"
      )
      expect(saves).toHaveLength(2)
      expect(saves[1]?.body).toEqual({
        input_text: "缓存中的草稿（已追加）",
        priority_capability_ids: [],
        knowledge_base_ids: [],
        expected_updated_at: "2026-07-11T08:00:01.000Z",
      })
    })
  })

  it("refreshes the consumed draft version while preserving the submitted knowledge-base selection", async () => {
    const knowledgeBaseId = "10000000-0000-4000-8000-000000000001"
    const firstInput = "如何使用 OneDrive"
    const followUp = "给我教程"
    const { requests } = installApiMock({
      conversationOverride: {
        turns: [],
        running_turn: null,
        execution_status: "idle",
        selected_knowledge_base_ids: [knowledgeBaseId],
      },
      knowledgeBasesOverride: [
        knowledgeBaseFixture(knowledgeBaseId, "AISG Policy"),
      ],
      conversationGetResponse: async (callIndex) =>
        json({
          success: true,
          data: {
            ...conversation,
            turns: [],
            running_turn: null,
            execution_status: "idle",
            selected_knowledge_base_ids: [knowledgeBaseId],
            draft_input: callIndex === 1 ? firstInput : "",
            draft_capability_ids: [],
            draft: {
              ...conversation.draft,
              input_text: callIndex === 1 ? firstInput : "",
              priority_capability_ids: [],
              knowledge_base_ids: callIndex === 1 ? [knowledgeBaseId] : [],
              updated_at:
                callIndex === 1
                  ? "2026-07-11T08:00:00.000Z"
                  : "2026-07-11T08:00:02.000Z",
            },
          },
        }),
      draftPutResponse: async (body) => {
        const input = body as {
          input_text: string
          priority_capability_ids: string[]
          knowledge_base_ids: string[]
        }
        return json({
          success: true,
          data: {
            ...conversation.draft,
            input_text: input.input_text,
            priority_capability_ids: input.priority_capability_ids,
            knowledge_base_ids: input.knowledge_base_ids,
            updated_at: "2026-07-11T08:00:03.000Z",
          },
        })
      },
    })
    const interaction = userEvent.setup()
    renderApp()

    const composer = await screen.findByRole("textbox", {
      name: "任务输入框",
    })
    await waitFor(() => expect(composer).toHaveValue(firstInput))
    expect(
      await screen.findByRole("button", {
        name: "移除知识库 AISG Policy",
      })
    ).toBeVisible()

    await interaction.click(screen.getByRole("button", { name: "发送" }))
    await waitFor(() => expect(composer).toHaveValue(""))

    await interaction.type(composer, followUp)

    await waitFor(() => {
      const saves = requests.filter(
        (request) =>
          request.path === "/api/v1/conversations/c1/draft" &&
          request.method === "PUT"
      )
      expect(saves).toHaveLength(1)
      expect(saves[0]?.body).toEqual({
        input_text: followUp,
        priority_capability_ids: [],
        knowledge_base_ids: [knowledgeBaseId],
        expected_updated_at: "2026-07-11T08:00:02.000Z",
      })
    })
    expect(
      screen.queryByText("草稿已在其他位置更新，请刷新后重试。")
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole("button", {
        name: "移除知识库 AISG Policy",
      })
    ).toBeVisible()
  })

  it("pauses autosave for a genuine conflict and keeps the latest local content on request", async () => {
    const otherLocationDraft = "另一处保存的内容"
    const { requests } = installApiMock({
      conversationOverride: {
        turns: [],
        running_turn: null,
        execution_status: "idle",
      },
      conversationGetResponse: async (callIndex) =>
        json({
          success: true,
          data: {
            ...conversation,
            turns: [],
            running_turn: null,
            execution_status: "idle",
            draft_input: callIndex === 1 ? "" : otherLocationDraft,
            draft_capability_ids: [],
            draft: {
              ...conversation.draft,
              input_text: callIndex === 1 ? "" : otherLocationDraft,
              priority_capability_ids: [],
              updated_at:
                callIndex === 1
                  ? "2026-07-11T08:00:00.000Z"
                  : "2026-07-11T08:00:01.000Z",
            },
          },
        }),
      draftPutResponse: async (body, callIndex) => {
        if (callIndex === 1) {
          return json(
            {
              success: false,
              error_code: "DRAFT_VERSION_CONFLICT",
              message_key: "errors.draftVersionConflict",
            },
            409
          )
        }
        const input = body as {
          input_text: string
          priority_capability_ids: string[]
          knowledge_base_ids: string[]
        }
        return json({
          success: true,
          data: {
            ...conversation.draft,
            input_text: input.input_text,
            priority_capability_ids: input.priority_capability_ids,
            knowledge_base_ids: input.knowledge_base_ids,
            updated_at: "2026-07-11T08:00:02.000Z",
          },
        })
      },
    })
    const interaction = userEvent.setup()
    renderApp()

    const composer = await screen.findByRole("textbox", { name: "任务输入框" })
    await interaction.type(composer, "当前页面的新内容")

    expect(await screen.findByText("草稿内容发生冲突")).toBeVisible()
    expect(composer).toHaveValue("当前页面的新内容")
    await interaction.type(composer, "，继续编辑")
    await new Promise((resolve) => setTimeout(resolve, 750))
    expect(
      requests.filter(
        (request) =>
          request.path === "/api/v1/conversations/c1/draft" &&
          request.method === "PUT"
      )
    ).toHaveLength(1)

    await interaction.click(
      screen.getByRole("button", { name: "保留当前内容" })
    )
    await waitFor(() => {
      const saves = requests.filter(
        (request) =>
          request.path === "/api/v1/conversations/c1/draft" &&
          request.method === "PUT"
      )
      expect(saves).toHaveLength(2)
      expect(saves[1]?.body).toEqual({
        input_text: "当前页面的新内容，继续编辑",
        priority_capability_ids: [],
        knowledge_base_ids: [],
        expected_updated_at: "2026-07-11T08:00:01.000Z",
      })
    })
    expect(screen.queryByText("草稿内容发生冲突")).not.toBeInTheDocument()
    expect(composer).toHaveValue("当前页面的新内容，继续编辑")
  })

  it("can replace local content with the latest server draft without another save", async () => {
    const serverDraft = "服务器上的最新草稿"
    const { requests } = installApiMock({
      conversationOverride: {
        turns: [],
        running_turn: null,
        execution_status: "idle",
      },
      conversationGetResponse: async (callIndex) =>
        json({
          success: true,
          data: {
            ...conversation,
            turns: [],
            running_turn: null,
            execution_status: "idle",
            draft_input: callIndex === 1 ? "" : serverDraft,
            draft_capability_ids: [],
            draft: {
              ...conversation.draft,
              input_text: callIndex === 1 ? "" : serverDraft,
              priority_capability_ids: [],
              knowledge_base_ids: [],
              updated_at:
                callIndex === 1
                  ? "2026-07-11T08:00:00.000Z"
                  : "2026-07-11T08:00:01.000Z",
            },
          },
        }),
      draftPutResponse: async () =>
        json(
          {
            success: false,
            error_code: "DRAFT_VERSION_CONFLICT",
            message_key: "errors.draftVersionConflict",
          },
          409
        ),
    })
    const interaction = userEvent.setup()
    renderApp()

    const composer = await screen.findByRole("textbox", {
      name: "任务输入框",
    })
    await interaction.type(composer, "当前页面内容")
    expect(await screen.findByText("草稿内容发生冲突")).toBeVisible()

    await interaction.click(
      screen.getByRole("button", { name: "使用最新草稿" })
    )
    await waitFor(() => expect(composer).toHaveValue(serverDraft))
    await new Promise((resolve) => setTimeout(resolve, 700))

    expect(screen.queryByText("草稿内容发生冲突")).not.toBeInTheDocument()
    expect(
      requests.filter(
        (request) =>
          request.path === "/api/v1/conversations/c1/draft" &&
          request.method === "PUT"
      )
    ).toHaveLength(1)
  })

  it("stores an attachment-only running follow-up as a pending request", async () => {
    const { requests } = installApiMock({
      conversationOverride: {
        draft_input: "",
        attachments: [
          {
            id: "draft-attachment-1",
            name: "补充材料.pdf",
            kind: "attachment",
            status: "draft",
            size: 1024,
          },
        ],
      },
    })
    const interaction = userEvent.setup()
    renderApp()

    const composer = await screen.findByRole("textbox", { name: "任务输入框" })
    await interaction.click(composer)
    await interaction.keyboard("{Enter}")
    await waitFor(() =>
      expect(
        requests.find(
          (request) =>
            request.path === "/api/v1/conversations/c1/pending-requests" &&
            request.method === "POST"
        )?.body
      ).toEqual({
        input_text: "",
        priority_capability_ids: [],
        knowledge_base_ids: [],
        collaboration_mode: "default",
        idempotency_key: expect.any(String),
      })
    )
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })

  it("keeps a queued follow-up in the composer when the pending limit is reached", async () => {
    const { requests } = installApiMock({
      conversationOverride: {
        pending_requests: Array.from({ length: 5 }, (_, index) => ({
          id: `pending-${index + 1}`,
          queue_no: index + 1,
          status: "waiting_previous_turn",
        })),
      },
    })
    const interaction = userEvent.setup()
    renderApp()
    await interaction.type(
      await screen.findByRole("textbox", { name: "任务输入框" }),
      "只补充一条文字说明"
    )
    await interaction.keyboard("{Enter}")

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "最多只能保留 5 条后续请求，请先处理已有请求。"
    )
    expect(screen.getByRole("textbox", { name: "任务输入框" })).toHaveValue(
      "只补充一条文字说明"
    )
    expect(
      requests.some(
        (request) =>
          request.path === "/api/v1/conversations/c1/pending-requests" &&
          request.method === "POST"
      )
    ).toBe(false)
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })

  it("queues a steer default follow-up with selected capabilities instead of dropping context", async () => {
    const { requests } = installApiMock({
      userOverride: { running_message_action: "steer" },
    })
    const interaction = userEvent.setup()
    renderApp()
    await interaction.click(await screen.findByRole("button", { name: "添加" }))
    await interaction.click(screen.getByText("报告写作"))
    await interaction.type(
      screen.getByRole("textbox", { name: "任务输入框" }),
      "补充新的写作要求"
    )
    await interaction.keyboard("{Enter}")

    await waitFor(() =>
      expect(
        requests.find(
          (request) =>
            request.path === "/api/v1/conversations/c1/pending-requests" &&
            request.method === "POST"
        )?.body
      ).toEqual({
        input_text: "补充新的写作要求",
        priority_capability_ids: ["s1"],
        knowledge_base_ids: [],
        collaboration_mode: "default",
        idempotency_key: expect.any(String),
      })
    )
    expect(
      await screen.findByText(
        "当前补充包含附件或指定插件/Skill，已自动排队为下一条请求。"
      )
    ).toBeVisible()
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })

  it("downloads an artifact in the current page and ignores a repeated click while pending", async () => {
    const createObjectURL = vi.fn(() => "blob:artifact-download")
    const revokeObjectURL = vi.fn()
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined)
    const open = vi.fn()
    vi.stubGlobal("open", open)
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createObjectURL,
    })
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: revokeObjectURL,
    })
    let resolveDownload: ((response: Response) => void) | undefined
    const downloadResponse = new Promise<Response>((resolve) => {
      resolveDownload = resolve
    })
    const { requests } = installApiMock({
      downloadResponse,
      conversationOverride: {
        messages: [
          ...conversation.messages,
          {
            id: "m3",
            role: "assistant",
            content: "报告已生成。",
            artifacts: [
              {
                id: "artifact-1",
                filename: "report.pdf",
                kind: "artifact",
                downloadable: true,
              },
            ],
          },
        ],
      },
    })
    renderApp()
    const assistantReplies = await screen.findAllByRole("article", {
      name: "助手回复",
    })
    const download = within(assistantReplies.at(-1)!).getByRole("button", {
      name: "下载 report.pdf",
    })
    fireEvent.click(download)
    fireEvent.click(download)

    expect(open).not.toHaveBeenCalled()
    expect(
      requests.filter(
        (request) =>
          request.path ===
            "/api/v1/conversations/c1/files/artifact-1/download" &&
          request.method === "GET"
      )
    ).toHaveLength(1)
    resolveDownload?.(
      new Response("pdf-content", {
        status: 200,
        headers: { "Content-Type": "application/pdf" },
      })
    )
    await waitFor(() => expect(click).toHaveBeenCalledTimes(1))
    expect(createObjectURL).toHaveBeenCalledOnce()
    const anchor = click.mock.instances[0] as HTMLAnchorElement
    expect(anchor.href).toBe("blob:artifact-download")
    expect(anchor.download).toBe("report.pdf")
    expect(anchor.target).toBe("")
    expect(anchor.isConnected).toBe(false)
    expect(open).not.toHaveBeenCalled()
    expect(window.location.href).toBe("http://localhost/")
    await waitFor(() => expect(download).toBeEnabled())
  })

  it("shows the reusable top notification when an artifact download fails", async () => {
    const open = vi.fn()
    vi.stubGlobal("open", open)
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined)
    installApiMock({
      downloadResponse: Promise.resolve(
        json(
          {
            success: false,
            error_code: "ARTIFACT_NOT_FOUND",
            message_key: "errors.artifactNotFound",
          },
          404
        )
      ),
      conversationOverride: {
        messages: [
          ...conversation.messages,
          {
            id: "m3",
            role: "assistant",
            content: "报告已生成。",
            artifacts: [
              {
                id: "artifact-1",
                filename: "report.pdf",
                kind: "artifact",
                downloadable: true,
              },
            ],
          },
        ],
      },
    })
    renderApp()

    const assistantReplies = await screen.findAllByRole("article", {
      name: "助手回复",
    })
    fireEvent.click(
      within(assistantReplies.at(-1)!).getByRole("button", {
        name: "下载 report.pdf",
      })
    )

    const notification = await screen.findByText("未找到该产物。")
    expect(notification.closest("[data-sonner-toast]")).not.toBeNull()
    expect(notification.closest(".conversation-top-overlay-stack")).toBeNull()
    expect(click).not.toHaveBeenCalled()
    expect(open).not.toHaveBeenCalled()
    expect(window.location.href).toBe("http://localhost/")
  })

  it("downloads an image artifact from the shared preview through the artifact download route", async () => {
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:image-artifact-download"),
    })
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    })
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined)
    const { requests } = installApiMock({
      conversationOverride: {
        messages: [
          ...conversation.messages,
          {
            id: "m3",
            role: "assistant",
            content: "图片已生成。",
            artifacts: [
              {
                id: "artifact-1",
                filename: "小狗和可乐.png",
                mime_type: "image/png",
                size_bytes: 235_520,
                kind: "artifact",
                downloadable: true,
                created_at: "2026-07-14T10:44:00.000Z",
              },
            ],
          },
        ],
      },
    })
    const interaction = userEvent.setup()
    renderApp()

    const preview = await screen.findByRole(
      "button",
      { name: "预览图片 小狗和可乐.png" },
      { timeout: 3_000 }
    )
    expect(
      requests.some(
        (request) =>
          request.path ===
            "/api/v1/conversations/c1/files/artifact-1/preview" &&
          request.method === "POST"
      )
    ).toBe(true)
    const assistantReplies = await screen.findAllByRole("article", {
      name: "助手回复",
    })
    expect(
      within(assistantReplies.at(-1)!).getByText("小狗和可乐.png")
    ).toBeVisible()
    expect(
      within(assistantReplies.at(-1)!).getByRole("button", {
        name: "下载 小狗和可乐.png",
      })
    ).toBeVisible()

    await interaction.click(preview)
    expect(
      await screen.findByRole(
        "img",
        { name: "小狗和可乐.png" },
        { timeout: 3_000 }
      )
    ).toHaveAttribute("src", "https://files.example.test/artifact-preview.png")

    const previewPane = await screen.findByRole("region", {
      name: "预览文档 小狗和可乐.png",
    })
    await interaction.click(
      within(previewPane).getByRole("button", {
        name: "下载文档 小狗和可乐.png",
      })
    )

    await waitFor(() => expect(click).toHaveBeenCalledOnce())
    expect(
      requests.filter(
        (request) =>
          request.path ===
            "/api/v1/conversations/c1/files/artifact-1/download" &&
          request.method === "GET"
      )
    ).toHaveLength(1)
    expect(
      requests.some(
        (request) =>
          request.path ===
          "/api/v1/conversations/c1/files/artifact-1/media"
      )
    ).toBe(false)
  })

  it("opens a sent XLSX attachment with the shared file preview", async () => {
    const spreadsheet = {
      id: "attachment-sheet-1",
      filename: "EdTech出差费用明细表.xlsx",
      mime_type:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      size_bytes: 54_321,
      kind: "attachment",
      status: "bound",
      turn_id: "turn-1",
      downloadable: false,
    }
    const { requests } = installApiMock({
      conversationOverride: {
        execution_status: "completed",
        running_turn: null,
        turns: [{ id: "turn-1", status: "completed" }],
        messages: conversation.messages.map((message) =>
          message.role === "user"
            ? { ...message, attachments: [spreadsheet] }
            : message
        ),
      },
    })
    const interaction = userEvent.setup()
    renderApp()

    await interaction.click(
      await screen.findByRole("button", {
        name: "预览文档 EdTech出差费用明细表.xlsx",
      })
    )

    await waitFor(() =>
      expect(
        requests.some(
          (request) =>
            request.path ===
              "/api/v1/conversations/c1/attachments/attachment-sheet-1/content" &&
            request.method === "GET"
        )
      ).toBe(true)
    )
    expect(
      requests.some(
        (request) =>
          request.path ===
          "/api/v1/conversations/c1/files/attachment-sheet-1/content"
      )
    ).toBe(false)
  })

  it("shows a PPTX selection question immediately without waiting for turn admission", async () => {
    let resolveTurnStart: ((response: Response) => void) | undefined
    const { requests } = installApiMock({
      conversationOverride: {
        execution_status: "completed",
        running_turn: null,
        turns: [{ id: "turn-1", status: "completed" }],
        draft_input: "主输入框原有草稿",
        messages: [
          ...conversation.messages,
          {
            id: "m3",
            role: "assistant",
            turn_id: "turn-1",
            phase: "final_answer",
            content: "演示文稿已生成。",
            artifacts: [
              {
                id: "70000000-0000-4000-8000-000000000001",
                filename: "ai-introduction.pptx",
                mime_type:
                  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
                size_bytes: 268_000,
                kind: "artifact",
                turn_id: "turn-1",
                downloadable: true,
                created_at: "2026-07-14T10:44:00.000Z",
              },
            ],
          },
        ],
      },
      turnStartResponse: async () =>
        new Promise((resolve) => {
          resolveTurnStart = resolve
        }),
    })
    const interaction = userEvent.setup()
    renderApp()

    await interaction.click(
      await screen.findByRole("button", {
        name: "预览演示文稿 ai-introduction.pptx",
      })
    )

    expect(
      requests.some(
        (request) =>
          request.path ===
            "/api/v1/conversations/c1/files/70000000-0000-4000-8000-000000000001/content" &&
          request.method === "GET"
      )
    ).toBe(true)

    await interaction.click(
      await screen.findByRole("button", { name: "进入文件标注模式" })
    )
    await interaction.click(
      await screen.findByRole("button", { name: "问 LinkSense" })
    )

    const composer = screen.getByRole<HTMLTextAreaElement>("textbox", {
      name: "任务输入框",
    })
    expect(composer).toHaveValue("主输入框原有草稿")

    const selectionPromptForm = await screen.findByRole("form", {
      name: "针对所选元素询问 LinkSense",
    })
    const selectionPrompt = within(selectionPromptForm).getByRole("textbox", {
      name: "针对所选元素询问 LinkSense",
    })
    await interaction.type(selectionPrompt, "改为英文")
    expect(composer).toHaveValue("主输入框原有草稿")
    await interaction.click(
      within(selectionPromptForm).getByRole("button", { name: "添加标注" })
    )

    expect(selectionPromptForm).not.toBeInTheDocument()
    await interaction.click(
      screen.getByRole("button", { name: "查看 1 条待发送标注" })
    )
    await interaction.click(
      await screen.findByRole("button", { name: "全部处理" })
    )
    const optimisticQuestion = (
      await screen.findAllByRole("article", { name: "用户消息" })
    ).at(-1)
    expect(optimisticQuestion).toBeDefined()
    const optimisticAnnotation = within(
      optimisticQuestion as HTMLElement
    ).getByRole("region", {
      name: "演示文稿注释：ai-introduction.pptx",
    })
    expect(
      within(optimisticAnnotation).getByRole("button", {
        name: "1 条注释",
      })
    ).toBeVisible()
    expect(
      within(optimisticQuestion as HTMLElement).queryByText("改为英文")
    ).not.toBeInTheDocument()

    await waitFor(() => {
      expect(
        requests.some(
          (request) =>
            request.method === "POST" &&
            request.path === "/api/v1/conversations/c1/turns"
        )
      ).toBe(true)
    })
    const turnRequest = requests.find(
      (request) =>
        request.method === "POST" &&
        request.path === "/api/v1/conversations/c1/turns"
    )
    const body = turnRequest?.body as {
      input_text?: string
      priority_capability_ids?: string[]
      draft_policy?: string
      message_display?: Record<string, unknown>
    }
    expect(body.input_text).toBeUndefined()
    expect(body.priority_capability_ids).toEqual([])
    expect(body.draft_policy).toBe("preserve")
    expect(body.message_display).toEqual({
      kind: "presentation_annotation",
      file_id: "70000000-0000-4000-8000-000000000001",
      annotations: [
        {
          request: "改为英文",
          slide_number: 3,
          elements: [
            {
              element_id: "title-1",
              type: "text",
              text: "人工智能连接数据、算法与人类目标",
              bounds: { x: 120, y: 80, width: 520, height: 90 },
            },
          ],
        },
      ],
    })
    expect(composer).toHaveValue("主输入框原有草稿")
    expect(
      requests.some(
        (request) =>
          request.path === "/api/v1/conversations/c1/draft" &&
          request.method === "PUT"
      )
    ).toBe(false)

    resolveTurnStart?.(
      json(
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
    )
  })

  it("queues a PPTX selection question while the current task is running", async () => {
    const { requests } = installApiMock({
      conversationOverride: {
        execution_status: "running",
        running_turn: { id: "turn-1", status: "running" },
        turns: [{ id: "turn-1", status: "running" }],
        draft_input: "主输入框原有草稿",
        messages: [
          ...conversation.messages,
          {
            id: "m3",
            role: "assistant",
            turn_id: "turn-1",
            phase: "final_answer",
            content: "演示文稿已生成。",
            artifacts: [
              {
                id: "70000000-0000-4000-8000-000000000001",
                filename: "ai-introduction.pptx",
                mime_type:
                  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
                size_bytes: 268_000,
                kind: "artifact",
                turn_id: "turn-1",
                downloadable: true,
                created_at: "2026-07-14T10:44:00.000Z",
              },
            ],
          },
        ],
      },
      pendingRequestResponse: (body) => {
        const request = body as { idempotency_key?: string }
        return json(
          {
            success: true,
            data: {
              id: "pending-office-1",
              queue_no: 1,
              status: "waiting_previous_turn",
              input_text: "改为英文",
              idempotency_key: request.idempotency_key,
            },
          },
          201
        )
      },
    })
    const interaction = userEvent.setup()
    renderApp()

    await interaction.click(
      await screen.findByRole("button", {
        name: "预览演示文稿 ai-introduction.pptx",
      })
    )

    await interaction.click(
      await screen.findByRole("button", { name: "进入文件标注模式" })
    )
    const askButton = await screen.findByRole("button", {
      name: "问 LinkSense",
    })
    expect(askButton).toBeEnabled()
    await interaction.click(askButton)

    const composer = screen.getByRole<HTMLTextAreaElement>("textbox", {
      name: "任务输入框",
    })
    expect(composer).toHaveValue("主输入框原有草稿")

    const selectionPromptForm = await screen.findByRole("form", {
      name: "针对所选元素询问 LinkSense",
    })
    const selectionPrompt = within(selectionPromptForm).getByRole("textbox", {
      name: "针对所选元素询问 LinkSense",
    })
    await interaction.type(selectionPrompt, "改为英文")
    await interaction.click(
      within(selectionPromptForm).getByRole("button", { name: "添加标注" })
    )

    expect(selectionPromptForm).not.toBeInTheDocument()
    await interaction.click(
      screen.getByRole("button", { name: "查看 1 条待发送标注" })
    )
    await interaction.click(
      await screen.findByRole("button", { name: "全部处理" })
    )
    expect(await screen.findByText("1 条注释")).toBeVisible()
    expect(screen.queryByText("改为英文")).not.toBeInTheDocument()

    await waitFor(() => {
      expect(
        requests.some(
          (request) =>
            request.method === "POST" &&
            request.path === "/api/v1/conversations/c1/pending-requests"
        )
      ).toBe(true)
    })
    const pendingRequest = requests.find(
      (request) =>
        request.method === "POST" &&
        request.path === "/api/v1/conversations/c1/pending-requests"
    )
    const body = pendingRequest?.body as {
      input_text?: string
      priority_capability_ids?: string[]
      draft_policy?: string
      message_display?: Record<string, unknown>
    }
    expect(body.input_text).toBeUndefined()
    expect(body.priority_capability_ids).toEqual([])
    expect(body.draft_policy).toBe("preserve")
    expect(body.message_display).toEqual({
      kind: "presentation_annotation",
      file_id: "70000000-0000-4000-8000-000000000001",
      annotations: [
        {
          request: "改为英文",
          slide_number: 3,
          elements: [
            {
              element_id: "title-1",
              type: "text",
              text: "人工智能连接数据、算法与人类目标",
              bounds: { x: 120, y: 80, width: 520, height: 90 },
            },
          ],
        },
      ],
    })
    expect(
      requests.some(
        (request) =>
          request.method === "POST" &&
          request.path === "/api/v1/conversations/c1/turns"
      )
    ).toBe(false)
    expect(composer).toHaveValue("主输入框原有草稿")
  })

  it("downloads a loaded Office preview in the current page", async () => {
    const createObjectURL = vi.fn(() => "blob:office-preview")
    const revokeObjectURL = vi.fn()
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined)
    const open = vi.fn()
    vi.stubGlobal("open", open)
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createObjectURL,
    })
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: revokeObjectURL,
    })
    installApiMock({
      conversationOverride: {
        messages: [
          ...conversation.messages,
          {
            id: "m3",
            role: "assistant",
            content: "演示文稿已生成。",
            artifacts: [
              {
                id: "artifact-1",
                filename: "ai-introduction.pptx",
                mime_type:
                  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
                size_bytes: 268_000,
                kind: "artifact",
                downloadable: true,
                created_at: "2026-07-14T10:44:00.000Z",
              },
            ],
          },
        ],
      },
    })
    const interaction = userEvent.setup()
    renderApp()

    await interaction.click(
      await screen.findByRole("button", {
        name: "预览演示文稿 ai-introduction.pptx",
      })
    )
    await interaction.click(
      await screen.findByRole("button", { name: "下载预览文档" })
    )

    expect(createObjectURL).toHaveBeenCalledOnce()
    expect(open).not.toHaveBeenCalled()
    const anchor = click.mock.instances[0] as HTMLAnchorElement
    expect(anchor.href).toBe("blob:office-preview")
    expect(anchor.download).toBe("ai-introduction.pptx")
    expect(anchor.target).toBe("")
    expect(anchor.isConnected).toBe(false)
  })

  it("exposes model selection without speed, sandbox, scheduling, or permission controls", async () => {
    installApiMock()
    renderApp()
    await screen.findByRole("form", { name: "任务输入框" })
    expect(
      await screen.findByRole("button", { name: "选择模型与推理强度" })
    ).toBeVisible()
    const forbidden =
      /速度|speed|sandbox|沙箱|执行权限|execution permission|完全访问|full access|项目区|已安排|主题/i
    expect(
      screen.queryByRole("button", { name: forbidden })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("combobox", { name: forbidden })
    ).not.toBeInTheDocument()
    expect(screen.queryByText(forbidden)).not.toBeInTheDocument()
  })

  it("keeps model selection scoped to each task when navigating between tasks", async () => {
    let releaseSecondTaskModelPreference!: () => void
    const secondTaskModelPreferenceStart = new Promise<void>((resolve) => {
      releaseSecondTaskModelPreference = resolve
    })
    const { requests } = installApiMock({
      modelPreferenceByConversation: {
        c1: "model-a",
        c2: "model-b",
      },
      modelPreferenceStart: (conversationId) =>
        conversationId === "c2"
          ? secondTaskModelPreferenceStart
          : Promise.resolve(),
    })
    const interaction = userEvent.setup()
    renderApp()

    const modelSelector = await screen.findByRole("button", {
      name: "选择模型与推理强度",
    })
    expect(modelSelector).toHaveTextContent("Model A")

    await interaction.click(
      screen.getByRole("button", { name: "整理项目会议纪要" })
    )
    await waitFor(() =>
      expect(requests).toContainEqual(
        expect.objectContaining({
          path: "/api/v1/conversations/c2/model-preference",
          method: "GET",
        })
      )
    )
    expect(
      screen.queryByRole("button", { name: "选择模型与推理强度" })
    ).not.toBeInTheDocument()

    releaseSecondTaskModelPreference()
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "选择模型与推理强度" })
      ).toHaveTextContent("Model B")
    })

    await interaction.click(
      screen.getByRole("button", { name: "选择模型与推理强度" })
    )
    await interaction.hover(
      await screen.findByRole("menuitem", { name: /^模型/ })
    )
    fireEvent.click(
      await screen.findByRole("menuitemradio", { name: "Test Model" })
    )
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "选择模型与推理强度" })
      ).toHaveTextContent("Test Model")
    })
    expect(
      requests.some(
        (request) =>
          request.path === "/api/v1/conversations/c2/model-preference" &&
          request.method === "PUT"
      )
    ).toBe(true)

    await interaction.click(
      screen.getByRole("button", { name: "活动风险评估" })
    )
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "选择模型与推理强度" })
      ).toHaveTextContent("Model A")
    })
  })

  it("uses the settings shell for administrator user management without password controls", async () => {
    const createObjectURL = vi.fn(() => "blob:user-import-template")
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createObjectURL,
    })
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    })
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined)
    const { requests } = installApiMock()
    const interaction = userEvent.setup()
    renderApp("/admin/users")
    expect(
      await screen.findByRole(
        "heading",
        { name: "用户与用户组" },
        { timeout: 5_000 }
      )
    ).toBeInTheDocument()
    expect(
      screen.getByRole("complementary", { name: "LinkSense 设置导航" })
    ).toBeInTheDocument()
    expect(
      screen.queryByRole("complementary", { name: "LinkSense 导航" })
    ).not.toBeInTheDocument()
    expect(await screen.findByText("lin@example.com")).toBeVisible()
    expect(screen.getByRole("table")).toHaveClass("user-management-table")
    expect(screen.getByRole("tab", { name: "用户" })).toHaveAttribute(
      "aria-selected",
      "true"
    )
    expect(screen.getByRole("tab", { name: "用户组" })).toHaveAttribute(
      "aria-selected",
      "false"
    )
    const userRow = screen.getByRole("row", { name: /lin@example\.com/u })
    const userCells = within(userRow).getAllByRole("cell")
    expect(userRow.querySelector('[data-slot="avatar-fallback"]')).toHaveClass(
      "text-xs",
      "font-semibold"
    )
    expect(userCells[6]).toHaveTextContent("-")
    expect(
      within(userRow).getByRole("switch", { name: "禁用用户 林晓" })
    ).toHaveAttribute("aria-disabled", "true")
    expect(
      screen.queryByRole("button", { name: /设置密码|重置密码/ })
    ).not.toBeInTheDocument()

    await interaction.click(screen.getByRole("button", { name: "导入 Excel" }))
    const importDialog = screen.getByRole("dialog", { name: "导入 Excel" })
    const importActions = importDialog.querySelector(
      '[data-slot="excel-import-actions"]'
    )
    expect(importActions).toHaveClass(
      "flex",
      "flex-col",
      "sm:flex-row",
      "sm:items-center"
    )
    expect(
      within(importDialog).getByRole("button", { name: "选择 Excel 文件" })
    ).toHaveClass("w-full", "min-w-0", "justify-start", "sm:flex-1")
    const downloadTemplate = within(importDialog).getByRole("button", {
      name: "下载 Excel 模板",
    })
    expect(downloadTemplate).toBeVisible()
    await interaction.click(downloadTemplate)
    await waitFor(() => expect(click).toHaveBeenCalledOnce())
    expect(createObjectURL).toHaveBeenCalledOnce()
    expect((click.mock.instances[0] as HTMLAnchorElement).download).toBe(
      "LinkSense-用户导入模板.xlsx"
    )
    expect(
      requests.some(
        (request) =>
          request.path === "/api/v1/admin/users/import-template.xlsx" &&
          request.method === "GET"
      )
    ).toBe(true)

    await interaction.upload(
      within(importDialog).getByLabelText("选择 Excel 文件"),
      new File([new Uint8Array([80, 75, 3, 4])], "users.xlsx", {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      })
    )
    await interaction.click(
      within(importDialog).getByRole("button", { name: "开始导入" })
    )

    const notification = await screen.findByText("导入结果")
    const notificationToast = notification.closest("[data-sonner-toast]")
    expect(notificationToast).not.toBeNull()
    expect(notification.closest('[role="dialog"]')).toBeNull()
    expect(notificationToast).toHaveTextContent("成功 2 条，跳过 0 条。")
  })

  it("uses an edit icon and toggles another user's account status", async () => {
    const { requests } = installApiMock({
      managedUsersOverride: [
        {
          id: "managed-user-1",
          name: "张宁",
          email: "zhang@example.com",
          role: "user",
          status: "active",
        },
      ],
    })
    const interaction = userEvent.setup()
    renderApp("/admin/users")

    const userRow = await screen.findByRole("row", {
      name: /zhang@example\.com/u,
    })
    const editAction = within(userRow).getByRole("button", { name: "编辑" })
    expect(editAction.querySelector("svg")).not.toBeNull()
    expect(editAction).toHaveClass("size-6", "text-muted-foreground")
    expect(within(userRow).queryByText("编辑")).not.toBeInTheDocument()

    const statusSwitch = within(userRow).getByRole("switch", {
      name: "禁用用户 张宁",
    })
    expect(statusSwitch).toBeEnabled()
    expect(statusSwitch).toBeChecked()
    await interaction.click(statusSwitch)

    await waitFor(() =>
      expect(
        requests.find(
          (request) =>
            request.path === "/api/v1/admin/users/managed-user-1" &&
            request.method === "PATCH"
        )?.body
      ).toEqual({ status: "disabled" })
    )
    const enableSwitch = await within(userRow).findByRole("switch", {
      name: "启用用户 张宁",
    })
    expect(enableSwitch).not.toBeChecked()
    expect(await screen.findByText("已禁用用户 张宁。")).toBeVisible()

    await interaction.click(enableSwitch)
    await waitFor(() =>
      expect(
        requests
          .filter(
            (request) =>
              request.path === "/api/v1/admin/users/managed-user-1" &&
              request.method === "PATCH"
          )
          .at(-1)?.body
      ).toEqual({ status: "active" })
    )
    expect(
      await within(userRow).findByRole("switch", { name: "禁用用户 张宁" })
    ).toBeChecked()
    expect(await screen.findByText("已启用用户 张宁。")).toBeVisible()
  })

  it("keeps the last enabled administrator status switch disabled", async () => {
    const { requests } = installApiMock({
      managedUsersOverride: [
        {
          id: "last-admin",
          name: "最后管理员",
          email: "last-admin@example.com",
          role: "admin",
          status: "active",
        },
      ],
      roleSummaryOverride: [
        {
          role: "user",
          active_count: 0,
          disabled_count: 0,
          total_count: 0,
        },
        {
          role: "admin",
          active_count: 1,
          disabled_count: 0,
          total_count: 1,
        },
      ],
    })
    const interaction = userEvent.setup()
    renderApp("/admin/users")

    const statusSwitch = await screen.findByRole("switch", {
      name: "禁用用户 最后管理员",
    })
    await waitFor(() =>
      expect(
        requests.some(
          (request) =>
            request.path === "/api/v1/admin/users/role-summary" &&
            request.method === "GET"
        )
      ).toBe(true)
    )
    expect(statusSwitch).toHaveAttribute("aria-disabled", "true")

    await interaction.hover(statusSwitch.parentElement as HTMLElement)
    expect(
      await screen.findByText("系统必须至少保留一个启用状态的管理员。")
    ).toBeVisible()
    expect(
      requests.some(
        (request) =>
          request.path === "/api/v1/admin/users/last-admin" &&
          request.method === "PATCH"
      )
    ).toBe(false)
  })

  it("opens model settings from its standalone administrator route", async () => {
    const { requests } = installApiMock()
    renderApp("/admin/models")

    expect(
      await screen.findByRole(
        "heading",
        { name: "模型设置" },
        { timeout: 5_000 }
      )
    ).toBeVisible()
    expect(
      await screen.findByRole(
        "heading",
        { name: "模型渠道列表" },
        { timeout: 5_000 }
      )
    ).toBeVisible()
    expect(
      screen.queryByRole("heading", { name: "模型服务" })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("tab", { name: "模型设置" })
    ).not.toBeInTheDocument()

    const settingsSidebar = screen.getByRole("complementary", {
      name: "LinkSense 设置导航",
    })
    expect(
      within(settingsSidebar).getByRole("link", { name: "模型设置" })
    ).toHaveAttribute("aria-current", "page")
    expect(
      requests.some(
        (request) =>
          request.path === "/api/v1/admin/model-provider-settings" &&
          request.method === "GET"
      )
    ).toBe(true)
    expect(
      requests.some((request) =>
        [
          "/api/v1/admin/product-settings",
          "/api/v1/admin/authentication-settings",
        ].includes(request.path)
      )
    ).toBe(false)
  })

  it("orders administrator navigation with system update last", async () => {
    installApiMock()
    renderApp("/admin/users")

    await screen.findByRole("heading", { name: "用户与用户组" })
    const administrationNavigation = await screen.findByRole("navigation", {
      name: "管理",
    })
    const links = within(administrationNavigation).getAllByRole("link")
    const usageLinkIndex = links.findIndex(
      (link) => link.getAttribute("href") === "/admin/usage"
    )
    const usersAndGroupsLinkIndex = links.findIndex(
      (link) => link.getAttribute("href") === "/admin/users"
    )
    const auditLinkIndex = links.findIndex(
      (link) => link.getAttribute("href") === "/admin/audit"
    )
    const systemUpdateLinkIndex = links.findIndex(
      (link) => link.getAttribute("href") === "/admin/system-update"
    )

    expect(usageLinkIndex).toBeGreaterThanOrEqual(0)
    expect(usersAndGroupsLinkIndex).toBeGreaterThanOrEqual(0)
    expect(systemUpdateLinkIndex).toBeGreaterThan(usageLinkIndex)
    expect(
      links.filter((link) => link.textContent === "用户与用户组")
    ).toHaveLength(1)
    expect(
      links.some((link) => link.getAttribute("href") === "/admin/groups")
    ).toBe(false)
    expect(usageLinkIndex).toBeGreaterThan(auditLinkIndex)
    expect(links.at(-1)).toHaveAttribute("href", "/admin/system-update")
  })

  it("disables the user group combobox when no groups are available", async () => {
    installApiMock({ userGroupsOverride: [] })
    const interaction = userEvent.setup()
    renderApp("/admin/users")

    await screen.findByText("lin@example.com", {}, { timeout: 5_000 })
    await interaction.click(screen.getByRole("button", { name: "编辑" }))

    const dialog = await screen.findByRole("dialog", { name: "编辑用户" })
    const groupSelector = within(dialog).getByRole("combobox", {
      name: "所属用户组",
    })
    expect(groupSelector).toBeDisabled()
    expect(groupSelector).toHaveAttribute("placeholder", "暂无数据")
    expect(within(dialog).queryByRole("checkbox")).not.toBeInTheDocument()
  })

  it("shows two user group names and reveals the complete list from the overflow badge", async () => {
    installApiMock({
      userOverride: {
        user_group_ids: [
          "group-research",
          "group-product",
          "group-marketing",
          "group-finance",
          "group-operations",
        ],
        user_groups: [
          { id: "group-research", name: "研发组" },
          { id: "group-product", name: "产品组" },
          { id: "group-marketing", name: "市场组" },
          { id: "group-finance", name: "财务组" },
          { id: "group-operations", name: "运营组" },
        ],
      },
    })
    const interaction = userEvent.setup()
    renderApp("/admin/users")

    await screen.findByText("lin@example.com", {}, { timeout: 5_000 })
    const userRow = await screen.findByRole("row", {
      name: /lin@example\.com/u,
    })
    const groupCell = within(userRow).getAllByRole("cell")[6]
    expect(groupCell).toHaveTextContent("研发组")
    expect(groupCell).toHaveTextContent("产品组")
    expect(groupCell).toHaveTextContent("+3")
    expect(within(groupCell).queryByText("市场组")).not.toBeInTheDocument()

    const overflowBadge = within(groupCell).getByLabelText("另有 3 个用户组")
    await interaction.hover(overflowBadge)

    const tooltip = await screen.findByRole("tooltip")
    expect(
      within(tooltip).getByRole("list", { name: "所属用户组" })
    ).toHaveTextContent("研发组产品组市场组财务组运营组")
  })

  it("filters and updates user groups with the dropdown multi-select", async () => {
    const { requests } = installApiMock({
      userOverride: { user_group_ids: ["group-it"] },
      userGroupsOverride: [
        {
          id: "group-it",
          name: "IT",
          description: "信息技术",
          member_count: 1,
        },
        {
          id: "group-marketing",
          name: "市场部",
          description: "品牌与市场",
          member_count: 2,
        },
      ],
    })
    const interaction = userEvent.setup()
    renderApp("/admin/users")

    await screen.findByText("lin@example.com", {}, { timeout: 5_000 })
    await interaction.click(screen.getByRole("button", { name: "编辑" }))

    const dialog = await screen.findByRole("dialog", { name: "编辑用户" })
    const groupSelector = within(dialog).getByRole("combobox", {
      name: "所属用户组",
    })
    expect(
      within(dialog).getByRole("button", { name: "移除用户组 IT" })
    ).toBeVisible()

    await interaction.click(groupSelector)
    await interaction.type(groupSelector, "市场")
    await interaction.click(
      await screen.findByRole("option", { name: /市场部/u })
    )
    expect(
      within(dialog).getByRole("button", { name: "移除用户组 市场部" })
    ).toBeVisible()

    await interaction.click(
      within(dialog).getByRole("button", { name: "移除用户组 IT" })
    )
    await interaction.click(
      within(dialog).getByRole("button", { name: "保存" })
    )

    await waitFor(() =>
      expect(
        requests.find(
          (request) =>
            request.path === "/api/v1/admin/users/user-1" &&
            request.method === "PATCH"
        )?.body
      ).toMatchObject({ user_group_ids: ["group-marketing"] })
    )
  })

  it("edits per-user token usage in million-token units", async () => {
    const { requests } = installApiMock({
      managedUsersOverride: [
        {
          total_token_limit: "7000000",
          weekly_token_limit: "2500000",
          monthly_token_limit: "500000",
        },
      ],
    })
    const interaction = userEvent.setup()
    renderApp("/admin/users")

    await screen.findByText("lin@example.com", {}, { timeout: 5_000 })
    const userRow = await screen.findByRole("row", {
      name: /lin@example\.com/u,
    })
    expect(userRow).toHaveTextContent("2.5")
    expect(userRow).toHaveTextContent("0.5")
    expect(within(userRow).getByText("7 百万 Token")).toBeVisible()

    await interaction.click(screen.getByRole("button", { name: "编辑" }))
    const dialog = await screen.findByRole("dialog", { name: "编辑用户" })
    const quotaSection = within(dialog).getByRole("region", {
      name: "个人 Token 用量",
    })
    expect(quotaSection.tagName).toBe("SECTION")
    expect(
      within(quotaSection).getByRole("heading", {
        level: 3,
        name: "个人 Token 用量",
      })
    ).toHaveClass("form-label")
    const totalQuotaInput =
      within(dialog).getByLabelText("总额度（百万 Token）")
    const weeklyQuotaInput =
      within(dialog).getByLabelText("周用量（百万 Token）")
    const monthlyQuotaInput =
      within(dialog).getByLabelText("月用量（百万 Token）")
    expect(totalQuotaInput).toHaveValue("7")
    expect(weeklyQuotaInput).toHaveValue("2.5")
    expect(monthlyQuotaInput).toHaveValue("0.5")

    await interaction.clear(totalQuotaInput)
    await interaction.type(totalQuotaInput, "8.5")
    await interaction.clear(weeklyQuotaInput)
    await interaction.type(weeklyQuotaInput, "0.75")
    await interaction.clear(monthlyQuotaInput)
    await interaction.type(monthlyQuotaInput, "1.25")
    await interaction.click(
      within(dialog).getByRole("button", { name: "保存" })
    )

    await waitFor(() =>
      expect(
        requests.find(
          (request) =>
            request.path === "/api/v1/admin/users/user-1" &&
            request.method === "PATCH"
        )?.body
      ).toMatchObject({
        total_token_limit: "8500000",
        weekly_token_limit: "750000",
        monthly_token_limit: "1250000",
      })
    )
  })

  it("shows a short hyphen for missing per-user token usage", async () => {
    installApiMock({
      managedUsersOverride: [
        {
          total_token_limit: null,
          weekly_token_limit: null,
          monthly_token_limit: null,
        },
      ],
    })
    renderApp("/admin/users")

    await screen.findByText("lin@example.com", {}, { timeout: 5_000 })
    const userRow = await screen.findByRole("row", {
      name: /lin@example\.com/u,
    })
    const cells = within(userRow).getAllByRole("cell")
    expect(cells[7]).toHaveTextContent("-")
    expect(cells[8]).toHaveTextContent("-")
    expect(cells[9]).toHaveTextContent("-")
  })

  it("shows and filters users by registration source", async () => {
    const { requests } = installApiMock({
      managedUsersOverride: [
        {
          id: "self-registered-user",
          name: "自主注册用户",
          email: "self-registered@example.com",
          registration_source: "self_registration",
        },
        {
          id: "invited-user",
          name: "受邀用户",
          email: "invited@example.com",
          registration_source: "organization_invitation",
        },
      ],
    })
    const interaction = userEvent.setup()
    renderApp("/admin/users")

    expect(await screen.findByText("self-registered@example.com")).toBeVisible()
    expect(screen.getByText("invited@example.com")).toBeVisible()
    expect(screen.getByText("自主注册")).toBeVisible()
    expect(screen.getByText("组织邀请")).toBeVisible()

    await interaction.click(screen.getByLabelText("用户来源"))
    await interaction.click(
      await screen.findByRole("option", { name: "自主注册" })
    )

    await waitFor(() =>
      expect(
        requests.some(
          (request) =>
            request.path === "/api/v1/admin/users" &&
            new URLSearchParams(request.query).get("registration_source") ===
              "self_registration"
        )
      ).toBe(true)
    )
    expect(await screen.findByText("self-registered@example.com")).toBeVisible()
    expect(screen.queryByText("invited@example.com")).toBeNull()

    await interaction.click(screen.getByLabelText("用户来源"))
    await interaction.click(
      await screen.findByRole("option", { name: "组织邀请" })
    )

    await waitFor(() =>
      expect(
        requests.some(
          (request) =>
            request.path === "/api/v1/admin/users" &&
            new URLSearchParams(request.query).get("registration_source") ===
              "organization_invitation"
        )
      ).toBe(true)
    )
    expect(await screen.findByText("invited@example.com")).toBeVisible()
    expect(screen.queryByText("self-registered@example.com")).toBeNull()
  })

  it("batch-updates total quota without changing unchecked periodic quotas", async () => {
    const { requests } = installApiMock()
    const interaction = userEvent.setup()
    renderApp("/admin/users")

    await screen.findByText("lin@example.com", {}, { timeout: 5_000 })
    await interaction.click(screen.getByLabelText("选择用户 林晓"))
    await interaction.click(
      screen.getByRole("button", { name: "批量设置用量（1）" })
    )
    const dialog = await screen.findByRole("dialog", {
      name: "批量设置用户 Token 用量",
    })
    await interaction.click(within(dialog).getByText("更新总额度"))
    await interaction.click(within(dialog).getByText("更新周用量"))
    await interaction.click(within(dialog).getByText("更新月用量"))
    const totalQuotaInput =
      within(dialog).getByLabelText("总额度（百万 Token）")
    await interaction.type(totalQuotaInput, "1.5")
    await interaction.click(
      within(dialog).getByRole("button", { name: "保存" })
    )

    await waitFor(() =>
      expect(
        requests.find(
          (request) =>
            request.path === "/api/v1/admin/users/token-limits" &&
            request.method === "PATCH"
        )?.body
      ).toEqual({
        user_ids: ["user-1"],
        total_token_limit: "1500000",
      })
    )
  })

  it("shows usage remaining percentages and filters users with no weekly remaining usage", async () => {
    const { requests } = installApiMock({
      managedUsersOverride: [
        {
          id: "weekly-exhausted-user",
          name: "周用完",
          email: "weekly-exhausted@example.com",
          weekly_token_limit: "10000000",
          monthly_token_limit: "40000000",
          token_quota: {
            total: null,
            weekly: {
              limit_tokens: "10000000",
              used_tokens: "10000000",
              remaining_tokens: "0",
              remaining_percentage: 0,
              reset_at: "2026-08-10T00:00:00.000Z",
            },
            monthly: {
              limit_tokens: "40000000",
              used_tokens: "30000000",
              remaining_tokens: "10000000",
              remaining_percentage: 25,
              reset_at: "2026-09-01T00:00:00.000Z",
            },
          },
        },
        {
          id: "weekly-remaining-user",
          name: "还有用量",
          email: "weekly-remaining@example.com",
          weekly_token_limit: "10000000",
          monthly_token_limit: "40000000",
          token_quota: {
            total: null,
            weekly: {
              limit_tokens: "10000000",
              used_tokens: "5000000",
              remaining_tokens: "5000000",
              remaining_percentage: 50,
              reset_at: "2026-08-10T00:00:00.000Z",
            },
            monthly: {
              limit_tokens: "40000000",
              used_tokens: "40000000",
              remaining_tokens: "0",
              remaining_percentage: 0,
              reset_at: "2026-09-01T00:00:00.000Z",
            },
          },
        },
      ],
    })
    const interaction = userEvent.setup()
    renderApp("/admin/users")

    const exhaustedRow = await screen.findByRole("row", {
      name: /weekly-exhausted@example\.com/u,
    })
    expect(exhaustedRow).toHaveTextContent("10")
    expect(exhaustedRow).toHaveTextContent("用量剩余 0%")
    expect(exhaustedRow).toHaveTextContent("40")
    expect(exhaustedRow).toHaveTextContent("用量剩余 25%")
    expect(
      await screen.findByText("weekly-remaining@example.com")
    ).toBeVisible()

    await interaction.click(screen.getByLabelText("用量剩余"))
    await interaction.click(
      await screen.findByRole("option", { name: "周用量剩余为 0" })
    )

    await waitFor(() =>
      expect(
        requests.some(
          (request) =>
            request.path === "/api/v1/admin/users" &&
            new URLSearchParams(request.query).get(
              "token_quota_remaining_zero"
            ) === "weekly"
        )
      ).toBe(true)
    )
    expect(
      await screen.findByText("weekly-exhausted@example.com")
    ).toBeVisible()
    expect(screen.queryByText("weekly-remaining@example.com")).toBeNull()
  })

  it("keeps user identity and actions visible without compressing the last-login column", async () => {
    const { requests } = installApiMock({
      managedUsersOverride: [
        {
          total_token_limit: "7000000",
          weekly_token_limit: "2500000",
          monthly_token_limit: "500000",
        },
      ],
    })
    const interaction = userEvent.setup()
    renderApp("/admin/users")

    await screen.findByText("lin@example.com", {}, { timeout: 5_000 })
    const table = screen.getByRole("table")
    const headerCells = within(table).getAllByRole("columnheader")
    expect(headerCells[0]).toHaveClass("user-management-selection-column")
    expect(headerCells[1]).toHaveClass("user-management-name-column")
    expect(headerCells.at(-2)).toHaveClass("user-management-last-login-column")
    expect(headerCells.at(-1)).toHaveClass("user-management-actions-column")

    const userRow = await screen.findByRole("row", {
      name: /lin@example\.com/u,
    })
    const userCells = within(userRow).getAllByRole("cell")
    expect(userCells[0]).toHaveClass("user-management-selection-column")
    expect(userCells[1]).toHaveClass("user-management-name-column")
    expect(userCells.at(-2)).toHaveClass("user-management-last-login-column")
    expect(userCells[1]?.querySelector(".table-primary")).toHaveClass(
      "truncate"
    )
    expect(userCells[1]?.querySelector(".table-secondary")).toHaveClass(
      "truncate"
    )
    const actionCell = userCells.at(-1)
    expect(actionCell).toBeDefined()
    const actionCellElement = actionCell as HTMLElement
    expect(actionCellElement).toHaveClass("user-management-actions-column")

    await interaction.click(
      within(actionCellElement).getByRole("button", {
        name: "调整 林晓 的用量",
      })
    )
    const dialog = await screen.findByRole("dialog", {
      name: "调整个人 Token 用量",
    })
    const totalQuotaInput =
      within(dialog).getByLabelText("总额度（百万 Token）")
    const weeklyQuotaInput =
      within(dialog).getByLabelText("周用量（百万 Token）")
    const monthlyQuotaInput =
      within(dialog).getByLabelText("月用量（百万 Token）")
    expect(totalQuotaInput).toHaveValue("7")
    expect(weeklyQuotaInput).toHaveValue("2.5")
    expect(monthlyQuotaInput).toHaveValue("0.5")

    await interaction.clear(totalQuotaInput)
    await interaction.type(totalQuotaInput, "8")
    await interaction.clear(weeklyQuotaInput)
    await interaction.type(weeklyQuotaInput, "0.6")
    await interaction.clear(monthlyQuotaInput)
    await interaction.click(
      within(dialog).getByRole("button", { name: "保存" })
    )

    await waitFor(() =>
      expect(
        requests.find(
          (request) =>
            request.path === "/api/v1/admin/users/user-1" &&
            request.method === "PATCH"
        )?.body
      ).toEqual({
        total_token_limit: "8000000",
        weekly_token_limit: "600000",
        monthly_token_limit: null,
      })
    )
  })

  it("hides administrator settings from regular users while keeping the settings entry", async () => {
    installApiMock({ userOverride: { role: "user" } })
    const interaction = userEvent.setup()
    renderApp("/settings/general")

    expect(await screen.findByRole("heading", { name: "常规" })).toBeVisible()
    expect(
      screen.queryByRole("heading", { name: "管理" })
    ).not.toBeInTheDocument()
    expect(screen.queryByRole("link", { name: "用户" })).not.toBeInTheDocument()
    expect(
      screen.queryByRole("link", { name: "用量统计" })
    ).not.toBeInTheDocument()
    expect(screen.getByRole("link", { name: "已归档任务" })).toHaveAttribute(
      "href",
      "/archived"
    )
    expect(
      screen.queryByRole("link", { name: "插件中心" })
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole("link", { name: "返回 LinkSense" })
    ).toHaveAttribute("href", "/conversations/new")
    expect(screen.getByRole("link", { name: "LinkSense" })).toHaveAttribute(
      "href",
      "/conversations/new"
    )

    await interaction.click(
      screen.getByRole("link", { name: "返回 LinkSense" })
    )
    const accountTrigger = await screen.findByRole("button", {
      name: "林晓",
    })
    expect(screen.getByRole("link", { name: "插件中心" })).toHaveAttribute(
      "href",
      "/capabilities"
    )
    expect(
      screen.queryByRole("link", { name: "已归档任务" })
    ).not.toBeInTheDocument()
    await interaction.click(accountTrigger)
    expect(await screen.findByRole("menuitem", { name: "设置" })).toBeVisible()
    expect(
      screen.queryByRole("menuitem", { name: "个人设置" })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("menuitem", { name: "个人凭据" })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("menuitem", { name: "管理中心" })
    ).not.toBeInTheDocument()
  })

  it("applies the configured product name across settings, the app shell, and browser metadata", async () => {
    installApiMock({
      systemName: "MOSS 工作台",
      userOverride: { role: "user" },
    })
    const interaction = userEvent.setup()
    renderApp("/settings/general")

    expect(await screen.findByRole("heading", { name: "常规" })).toBeVisible()
    expect(
      screen.getByRole("complementary", { name: "MOSS 工作台 设置导航" })
    ).toBeVisible()
    const backLink = screen.getByRole("link", { name: "返回 MOSS 工作台" })
    expect(backLink).toHaveAttribute("href", "/conversations/new")
    expect(document.title).toBe("MOSS 工作台")
    expect(document.querySelector('meta[name="description"]')).toHaveAttribute(
      "content",
      "MOSS 工作台"
    )

    await interaction.click(backLink)

    expect(
      await screen.findByRole("complementary", { name: "MOSS 工作台 导航" })
    ).toBeVisible()
    expect(
      await screen.findByPlaceholderText("描述你希望 MOSS 工作台 完成的任务…")
    ).toBeVisible()
  })

  it("redirects regular users away from administrator routes without loading admin data", async () => {
    const { requests } = installApiMock({ userOverride: { role: "user" } })
    renderApp("/admin/users")

    expect(
      await screen.findByRole("form", { name: "任务输入框" })
    ).toBeVisible()
    expect(
      requests.some((request) => request.path.startsWith("/api/v1/admin/"))
    ).toBe(false)
  })

  it("shows archived conversations in settings and keeps archived-only search", async () => {
    const archivedTask = {
      ...conversations[1],
      id: "archived-task-1",
      title: "整理项目会议纪要",
      archived: true,
      archive_status: "archived",
    }
    const { requests } = installApiMock({
      userOverride: { role: "user" },
      conversationListResponse: (query) =>
        json({
          success: true,
          data: {
            items: query.get("archived") === "true" ? [archivedTask] : [],
            next_cursor: null,
            total_count: query.get("archived") === "true" ? 1 : 0,
          },
        }),
    })
    const interaction = userEvent.setup()
    renderApp("/archived")

    expect(
      await screen.findByRole("complementary", {
        name: "LinkSense 设置导航",
      })
    ).toBeVisible()
    expect(
      screen.queryByRole("complementary", { name: "LinkSense 导航" })
    ).not.toBeInTheDocument()
    expect(screen.getByRole("link", { name: "已归档任务" })).toHaveAttribute(
      "aria-current",
      "page"
    )
    expect(screen.getByRole("heading", { name: "已归档任务" })).toBeVisible()
    expect(await screen.findByText("1 个任务")).toBeVisible()
    const searchButton = screen.getByRole("button", { name: "搜索" })
    expect(searchButton).toHaveClass("hover:bg-hover")
    expect(searchButton).not.toHaveClass("bg-secondary")
    expect(searchButton.querySelector("svg")).toHaveAttribute(
      "data-icon",
      "inline-start"
    )
    const clearButton = screen.getByRole("button", { name: "清除全部" })
    expect(clearButton).toBeEnabled()
    expect(clearButton).toHaveClass("bg-destructive/10", "text-destructive")
    expect(clearButton.querySelector("svg")).toHaveAttribute(
      "data-icon",
      "inline-start"
    )

    await interaction.click(searchButton)
    await interaction.type(
      screen.getByPlaceholderText("搜索标题、消息、附件、产物、插件或 Skill…"),
      "会议"
    )

    await waitFor(() =>
      expect(
        requests.some((request) => {
          if (request.path !== "/api/v1/conversations") return false
          const query = new URLSearchParams(request.query)
          return (
            query.get("archived") === "true" && query.get("search") === "会议"
          )
        })
      ).toBe(true)
    )
  })

  it("shows a muted delete icon and a direct unarchive text button for archived tasks", async () => {
    const archivedTask = {
      ...conversations[1],
      id: "archived-task-1",
      title: "整理项目会议纪要",
      archived: true,
      archive_status: "archived",
      updated_at: "2026-07-22T14:41:00",
    }
    const { requests } = installApiMock({
      userOverride: { role: "user" },
      conversationListResponse: (query) =>
        json({
          success: true,
          data: {
            items: query.get("archived") === "true" ? [archivedTask] : [],
            next_cursor: null,
            total_count: query.get("archived") === "true" ? 1 : 0,
          },
        }),
      conversationPatchResponse: (conversationId, body) =>
        json({
          success: true,
          data: {
            ...archivedTask,
            id: conversationId,
            archived: body.archive_status === "archived",
            archive_status: body.archive_status ?? "active",
          },
        }),
    })
    const interaction = userEvent.setup()
    renderApp("/archived")

    const deleteButton = await screen.findByRole("button", {
      name: "删除任务“整理项目会议纪要”",
    })
    const unarchiveButton = screen.getByRole("button", {
      name: "取消归档任务“整理项目会议纪要”",
    })
    expect(
      screen.queryByRole("button", { name: "操作" })
    ).not.toBeInTheDocument()
    const archivedRow = deleteButton.closest("article")
    expect(archivedRow).toHaveClass("archived-conversation-row")
    expect(screen.getByText("1 个任务")).toBeVisible()
    expect(
      within(archivedRow as HTMLElement).getByText("2026年7月22日，14:41")
    ).toHaveAttribute("datetime", "2026-07-22T14:41:00")
    expect(deleteButton).toHaveClass("hover:bg-hover")
    expect(deleteButton).not.toHaveClass(
      "bg-destructive/10",
      "text-destructive"
    )
    expect(deleteButton.querySelector("svg")).toHaveClass(
      "text-muted-foreground"
    )
    expect(deleteButton.querySelector("svg")).toHaveAttribute(
      "data-icon",
      "inline-start"
    )
    expect(unarchiveButton).toHaveClass("bg-secondary")
    expect(unarchiveButton).toHaveTextContent("取消归档")
    expect(unarchiveButton.querySelector("svg")).not.toBeInTheDocument()

    await interaction.click(deleteButton)
    const deleteDialog = await screen.findByRole("dialog", {
      name: "永久删除任务？",
    })
    await interaction.click(
      within(deleteDialog).getByRole("button", { name: "取消" })
    )

    await interaction.click(unarchiveButton)
    await waitFor(() =>
      expect(requests).toContainEqual(
        expect.objectContaining({
          path: "/api/v1/conversations/archived-task-1",
          method: "PATCH",
          body: { archive_status: "active" },
        })
      )
    )
  })

  it("confirms and clears all archived tasks without targeting active tasks", async () => {
    let archivedListRequestCount = 0
    const archivedTask = {
      ...conversations[1],
      id: "archived-task-1",
      archived: true,
      archive_status: "archived",
    }
    const { requests } = installApiMock({
      userOverride: { role: "user" },
      clearArchivedDeletedCount: 1,
      conversationListResponse: (query) => {
        if (query.get("archived") !== "true") {
          return json({
            success: true,
            data: { items: conversations, next_cursor: null },
          })
        }
        archivedListRequestCount += 1
        return json({
          success: true,
          data: {
            items: archivedListRequestCount === 1 ? [archivedTask] : [],
            next_cursor: null,
            total_count: archivedListRequestCount === 1 ? 1 : 0,
          },
        })
      },
    })
    const interaction = userEvent.setup()
    renderApp("/archived")

    const clearButton = await screen.findByRole("button", {
      name: "清除全部",
    })
    await waitFor(() => expect(clearButton).toBeEnabled())
    await interaction.click(clearButton)

    const dialog = await screen.findByRole("dialog", {
      name: "清除全部已归档任务？",
    })
    expect(within(dialog).getByText(/未归档任务不受影响/u)).toBeVisible()
    const confirmButton = within(dialog).getByRole("button", {
      name: "清除全部",
    })
    expect(confirmButton).toHaveClass(
      "bg-destructive",
      "text-destructive-foreground"
    )
    await interaction.click(confirmButton)

    await waitFor(() =>
      expect(requests).toContainEqual(
        expect.objectContaining({
          path: "/api/v1/conversations/archived",
          method: "DELETE",
        })
      )
    )
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", {
          name: "清除全部已归档任务？",
        })
      ).not.toBeInTheDocument()
    )
    expect(await screen.findByText("没有已归档任务")).toBeVisible()
    expect(await screen.findByText("已清除 1 个已归档任务。")).toBeVisible()
    expect(
      screen.queryByRole("button", { name: "搜索" })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "清除全部" })
    ).not.toBeInTheDocument()
  })

  it("creates a personal credential with multiple environment variables", async () => {
    const { requests } = installApiMock()
    const interaction = userEvent.setup()
    renderApp("/settings/credentials")

    expect(
      await screen.findByRole("heading", { name: "插件凭据" })
    ).toBeInTheDocument()
    const settingsSidebar = screen.getByRole("complementary", {
      name: "LinkSense 设置导航",
    })
    expect(
      within(settingsSidebar).getByRole("link", { name: "插件凭据" })
    ).toHaveAttribute("aria-current", "page")
    expect(
      screen.queryByRole("complementary", { name: "LinkSense 导航" })
    ).not.toBeInTheDocument()
    expect(
      await screen.findByRole("heading", { name: "插件凭据生效来源" })
    ).toBeVisible()
    expect(
      screen.getByRole("complementary", { name: "LinkSense 设置导航" })
    ).toBeVisible()
    expect(
      screen.queryByRole("complementary", { name: "LinkSense 导航" })
    ).not.toBeInTheDocument()
    await interaction.click(
      await screen.findByRole("button", { name: "新增凭据" })
    )
    await interaction.type(screen.getByLabelText("名称"), "业务系统")
    await interaction.type(screen.getByLabelText("提供方类型"), "service_api")
    await interaction.clear(screen.getByLabelText("环境变量名"))
    await interaction.type(screen.getByLabelText("环境变量名"), "API_KEY")
    await interaction.type(screen.getByLabelText("环境变量值"), "secret-one")
    await interaction.click(
      screen.getByRole("button", { name: "添加环境变量" })
    )
    const credentialDialog = screen.getByRole("dialog", { name: "新增凭据" })
    expect(credentialDialog).toHaveClass(
      "max-h-[90vh]",
      "overflow-y-auto",
      "sm:max-w-2xl"
    )
    expect(
      credentialDialog.querySelectorAll('[data-slot="credential-secret-row"]')
    ).toHaveLength(2)
    expect(
      within(credentialDialog).getAllByRole("button", {
        name: "移除此环境变量",
      })
    ).toHaveLength(2)
    const keyInputs = screen.getAllByLabelText("环境变量名")
    const valueInputs = screen.getAllByLabelText("环境变量值")
    expect(valueInputs[0]).toHaveAttribute("autocomplete", "new-password")
    await interaction.clear(keyInputs[1]!)
    await interaction.type(keyInputs[1]!, "API_SECRET")
    await interaction.type(valueInputs[1]!, "secret-two")
    await interaction.click(screen.getByRole("button", { name: "确认新增" }))

    await waitFor(() =>
      expect(
        requests.find(
          (request) =>
            request.path === "/api/v1/credentials" && request.method === "POST"
        )?.body
      ).toEqual({
        name: "业务系统",
        provider_type: "service_api",
        secret_payload: { API_KEY: "secret-one", API_SECRET: "secret-two" },
      })
    )
  })

  it("removes the public credential administration route", async () => {
    installApiMock()
    renderApp("/admin/credentials")

    expect(await screen.findByText("页面不存在")).toBeVisible()
    expect(
      screen.queryByRole("link", { name: "公共凭据" })
    ).not.toBeInTheDocument()
  })

  it("shows the redacted effective credential source for each plugin key", async () => {
    installApiMock()
    const interaction = userEvent.setup()
    renderApp("/credentials")

    await screen.findByRole("heading", { name: "插件凭据生效来源" })
    expect(
      screen.getByRole("complementary", { name: "LinkSense 设置导航" })
    ).toBeVisible()
    expect(
      screen.queryByRole("complementary", { name: "LinkSense 导航" })
    ).not.toBeInTheDocument()
    expect(
      screen
        .getByRole("combobox", { name: "插件" })
        .closest('[data-slot="field"]')
    ).toHaveClass("credential-effective-plugin-field")
    await chooseSelectOption(interaction, "插件", "业务数据")
    expect(await screen.findByText("SERVICE_API_KEY")).toBeVisible()
    expect(
      screen
        .getAllByText("个人凭据")
        .some((element) => element.dataset.slot === "badge")
    ).toBe(true)
    expect(
      screen.queryByText(/secret-one|credential-1/)
    ).not.toBeInTheDocument()
  })

  it("redirects an uninitialized system to the first-administrator wizard", async () => {
    installApiMock({ initialized: false, refreshFails: true })
    renderApp("/login")
    expect(
      await screen.findByRole("heading", { name: "初始化 LinkSense" })
    ).toBeInTheDocument()
    expect(screen.getByLabelText("管理员姓名")).toBeInTheDocument()
    expect(screen.queryByLabelText("系统名称")).not.toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "创建管理员并完成初始化" })
    ).toHaveClass("h-11", "w-full")
  })

  it("asks for the one-time credential when deployment protection is enabled", async () => {
    installApiMock({
      initialized: false,
      initializationCredentialRequired: true,
      refreshFails: true,
    })
    renderApp("/login")

    expect(await screen.findByLabelText("一次性初始化凭据")).toBeInTheDocument()
    expect(screen.getByText(/安装成功时终端显示的一次性凭据/u)).toBeVisible()
  })

  it("toggles the initialization password fields independently", async () => {
    installApiMock({ initialized: false, refreshFails: true })
    const interaction = userEvent.setup()
    renderApp("/login")

    const passwordInput = await screen.findByLabelText("新密码")
    const confirmationInput = screen.getByLabelText("确认新密码")
    await interaction.type(passwordInput, "ValidPass1!")
    await interaction.type(confirmationInput, "ValidPass1!")

    expect(passwordInput).toHaveAttribute("type", "password")
    expect(confirmationInput).toHaveAttribute("type", "password")

    const showPasswordButton = screen.getByRole("button", {
      name: "显示新密码",
    })
    expect(showPasswordButton).toHaveAttribute("aria-pressed", "false")
    await interaction.click(showPasswordButton)

    expect(passwordInput).toHaveAttribute("type", "text")
    expect(passwordInput).toHaveValue("ValidPass1!")
    expect(confirmationInput).toHaveAttribute("type", "password")
    expect(screen.getByRole("button", { name: "隐藏新密码" })).toHaveAttribute(
      "aria-pressed",
      "true"
    )

    await interaction.click(
      screen.getByRole("button", { name: "显示确认新密码" })
    )
    expect(confirmationInput).toHaveAttribute("type", "text")
    expect(confirmationInput).toHaveValue("ValidPass1!")

    await interaction.click(screen.getByRole("button", { name: "隐藏新密码" }))
    expect(passwordInput).toHaveAttribute("type", "password")
    expect(confirmationInput).toHaveAttribute("type", "text")
  })

  it("uses the taller public action size for sign-in and account recovery", async () => {
    installApiMock({ refreshFails: true })
    const loginView = renderApp("/login")

    expect(await screen.findByRole("button", { name: "登录" })).toHaveClass(
      "h-11",
      "w-full"
    )
    loginView.unmount()

    const recoveryView = renderApp("/forgot-password")
    expect(
      await screen.findByRole("button", { name: "发送安全链接" })
    ).toHaveClass("h-11", "w-full")
    recoveryView.unmount()

    window.history.replaceState(null, "", "/reset-password#token=reset-token")
    renderApp("/reset-password#token=reset-token")
    expect(
      await screen.findByRole("button", { name: "保存新密码" })
    ).toHaveClass("h-11", "w-full")
  })

  it("toggles the sign-in password visibility from the trailing eye button", async () => {
    installApiMock({ refreshFails: true })
    const interaction = userEvent.setup()
    renderApp("/login")

    const passwordInput = await screen.findByLabelText("密码")
    await interaction.type(passwordInput, "Password1!")

    expect(passwordInput).toHaveAttribute("type", "password")
    expect(passwordInput).toHaveValue("Password1!")
    const showPasswordButton = screen.getByRole("button", {
      name: "显示密码",
    })
    expect(showPasswordButton.querySelector(".lucide-eye")).not.toBeNull()
    expect(showPasswordButton).toHaveAttribute("aria-pressed", "false")

    await interaction.click(showPasswordButton)

    expect(passwordInput).toHaveAttribute("type", "text")
    expect(passwordInput).toHaveValue("Password1!")
    const hidePasswordButton = screen.getByRole("button", {
      name: "隐藏密码",
    })
    expect(hidePasswordButton.querySelector(".lucide-eye-off")).not.toBeNull()
    expect(hidePasswordButton).toHaveAttribute("aria-pressed", "true")
  })

  it("restores the account language after password sign-in in a new browser", async () => {
    const { requests } = installApiMock({
      refreshFails: true,
      initialLanguage: "en-US",
    })
    const interaction = userEvent.setup()
    renderApp("/login")

    expect(window.localStorage.getItem("linksense.language")).toBeNull()
    expect(document.documentElement.lang).toBe("zh-CN")
    await interaction.type(
      await screen.findByLabelText("邮箱"),
      "person@example.com"
    )
    await interaction.type(screen.getByLabelText("密码"), "Password1!")
    await interaction.click(screen.getByRole("button", { name: "登录" }))

    expect(
      await screen.findByRole(
        "form",
        { name: "Task composer" },
        { timeout: 5_000 }
      )
    ).toBeVisible()
    expect(document.documentElement.lang).toBe("en-US")
    expect(window.localStorage.getItem("linksense.language")).toBe("en-US")
    expect(
      requests.some(
        (request) =>
          request.path === "/api/v1/auth/login" && request.method === "POST"
      )
    ).toBe(true)
    expect(
      requests.some(
        (request) => request.path === "/api/v1/me" && request.method === "GET"
      )
    ).toBe(true)
  })

  it("shows an auto-dismiss notification after accepting a secure-link request", async () => {
    const { requests } = installApiMock()
    const interaction = userEvent.setup()
    renderApp("/forgot-password")

    await interaction.type(
      await screen.findByLabelText("邮箱"),
      "person@example.com"
    )
    await interaction.click(
      screen.getByRole("button", { name: "发送安全链接" })
    )

    const notification = await screen.findByText("安全链接请求已提交")
    const notificationToast = notification.closest("[data-sonner-toast]")
    expect(notificationToast).not.toBeNull()
    expect(notification.closest('[data-slot="alert"]')).toBeNull()
    expect(notificationToast).toHaveTextContent(
      "如果该邮箱对应可用账号，系统将发送密码设置或重置邮件。"
    )
    expect(
      requests.find(
        (request) =>
          request.path === "/api/v1/auth/forgot-password" &&
          request.method === "POST"
      )?.body
    ).toEqual({ email: "person@example.com" })
  })

  it("shows an explicit failure status when the secure-link request cannot be queued", async () => {
    installApiMock({
      forgotPasswordResponse: () =>
        json(
          {
            success: false,
            error_code: "PASSWORD_RESET_EMAIL_DELIVERY_FAILED",
            message_key: "auth.passwordReset.deliveryFailed",
            message: "The secure link could not be sent.",
          },
          503
        ),
    })
    const interaction = userEvent.setup()
    renderApp("/forgot-password")

    await interaction.type(
      await screen.findByLabelText("邮箱"),
      "person@example.com"
    )
    await interaction.click(
      screen.getByRole("button", { name: "发送安全链接" })
    )

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "安全链接发送失败"
    )
    expect(screen.getByRole("alert")).toHaveTextContent(
      "安全链接暂未发出，请稍后重试。"
    )
  })

  it("consumes a reset token from the fragment, clears the URL, and submits it from memory", async () => {
    const { requests } = installApiMock()
    const interaction = userEvent.setup()
    window.history.replaceState(
      null,
      "",
      "/reset-password?token=query-secret#token=fragment-secret"
    )
    renderApp("/reset-password?token=query-secret#token=fragment-secret")

    expect(
      await screen.findByRole("heading", { name: "设置新密码" })
    ).toBeVisible()
    expect(window.location.search).toBe("")
    expect(window.location.hash).toBe("")

    await interaction.type(screen.getByLabelText("新密码"), "ValidPass1!")
    await interaction.type(screen.getByLabelText("确认新密码"), "ValidPass1!")
    await interaction.click(screen.getByRole("button", { name: "保存新密码" }))

    await waitFor(() =>
      expect(
        requests.find(
          (request) =>
            request.path === "/api/v1/auth/reset-password" &&
            request.method === "POST"
        )?.body
      ).toEqual({ token: "fragment-secret", new_password: "ValidPass1!" })
    )
  })

  it("keeps a fragment reset token available when the app runs in StrictMode", async () => {
    const { requests } = installApiMock()
    const interaction = userEvent.setup()
    window.history.replaceState(
      null,
      "",
      "/reset-password#token=strict-mode-reset-token"
    )

    render(
      <StrictMode>
        <MemoryRouter initialEntries={["/reset-password"]}>
          <AppProviders>
            <App />
          </AppProviders>
        </MemoryRouter>
      </StrictMode>
    )

    expect(
      await screen.findByRole("heading", { name: "设置新密码" })
    ).toBeVisible()
    expect(screen.getByRole("img", { name: "LinkSense" })).toHaveClass(
      "public-brand-logo"
    )
    expect(
      screen.queryByText("密码设置链接无效或已过期，请重新申请。")
    ).not.toBeInTheDocument()
    expect(window.location.hash).toBe("")

    await interaction.type(screen.getByLabelText("新密码"), "ValidPass1!")
    await interaction.type(screen.getByLabelText("确认新密码"), "ValidPass1!")
    await interaction.click(screen.getByRole("button", { name: "保存新密码" }))

    await waitFor(() =>
      expect(
        requests.find(
          (request) =>
            request.path === "/api/v1/auth/reset-password" &&
            request.method === "POST"
        )?.body
      ).toEqual({
        token: "strict-mode-reset-token",
        new_password: "ValidPass1!",
      })
    )
  })

  it("clears but never accepts a reset token from the query string", async () => {
    installApiMock()
    window.history.replaceState({}, "", "/reset-password?token=query-secret")
    renderApp("/reset-password?token=query-secret")

    expect(
      await screen.findByText("密码设置链接无效或已过期，请重新申请。")
    ).toBeVisible()
    expect(window.location.search).toBe("")
    expect(screen.getByRole("button", { name: "保存新密码" })).toBeDisabled()
  })

  it("restores the backend-created OIDC session and clears the callback result", async () => {
    const { requests } = installApiMock()
    window.history.replaceState({}, "", "/auth/oidc/callback?result=success")
    renderApp("/auth/oidc/callback?result=success")

    await waitFor(() =>
      expect(screen.getByRole("form", { name: "任务输入框" })).toBeVisible()
    )
    expect(window.location.search).toBe("")
    expect(
      requests.some((request) => request.path === "/api/v1/auth/oidc/callback")
    ).toBe(false)
  })

  it("shows first-time OIDC users that their disabled account needs administrator approval", async () => {
    const { requests } = installApiMock({ refreshFails: true })
    window.history.replaceState(
      {},
      "",
      "/auth/oidc/callback?result=pending_approval"
    )
    renderApp("/auth/oidc/callback?result=pending_approval")

    expect(
      await screen.findByText(
        "单点登录验证成功，账号已创建并等待管理员启用。请联系管理员，启用后再重新登录。"
      )
    ).toBeVisible()
    expect(screen.getByRole("link", { name: "返回登录页" })).toHaveAttribute(
      "href",
      "/login"
    )
    expect(window.location.search).toBe("")
    expect(
      requests.some((request) => request.path === "/api/v1/auth/oidc/callback")
    ).toBe(false)
  })

  it("does not reuse an API callback path as the post-password-login destination", async () => {
    installApiMock({ refreshFails: true })
    const interaction = userEvent.setup()
    render(
      <MemoryRouter
        initialEntries={[
          {
            pathname: "/login",
            state: { from: "/api/v1/auth/oidc/callback" },
          },
        ]}
      >
        <AppProviders>
          <App />
        </AppProviders>
      </MemoryRouter>
    )

    await interaction.type(
      await screen.findByLabelText("邮箱"),
      "person@example.com"
    )
    await interaction.type(screen.getByLabelText("密码"), "Password1!")
    await interaction.click(screen.getByRole("button", { name: "登录" }))

    expect(
      await screen.findByRole("form", { name: "任务输入框" })
    ).toBeVisible()
    expect(screen.queryByText("页面不存在。")).not.toBeInTheDocument()
  })
})
