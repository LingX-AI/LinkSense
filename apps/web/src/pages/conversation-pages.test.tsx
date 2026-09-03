import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom"

import { setAccessToken } from "@/api/session"
import i18n from "@/i18n"
import {
  ArchivedConversationListPage,
  ConversationPage,
} from "@/pages/conversation-pages"

const authMock = vi.hoisted(() => ({
  runningMessageAction: "queue" as "queue" | "steer",
}))

vi.mock("@/app/auth-state", () => ({
  useAuth: () => ({
    user: {
      id: "user-1",
      running_message_action: authMock.runningMessageAction,
    },
  }),
}))

function envelope(data: unknown) {
  return new Response(JSON.stringify({ success: true, data }), {
    status: 200,
    headers: { "content-type": "application/json" },
  })
}

function errorEnvelope(status: number, errorCode: string) {
  return new Response(
    JSON.stringify({ success: false, error_code: errorCode }),
    {
      status,
      headers: { "content-type": "application/json" },
    }
  )
}

function activeKnowledgeBase(id: string, name: string) {
  return {
    id,
    name,
    description: "保修和退换政策",
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
    created_at: "2026-07-22T00:00:00.000Z",
    updated_at: "2026-07-22T00:00:00.000Z",
  }
}

function modelPreference() {
  return {
    configured: true,
    default_model: "model-a",
    selected_model: "model-a",
    selected_reasoning_effort: "medium",
    models: [
      {
        id: "model-a",
        display_name: "Model A",
        enabled: true,
        supported_reasoning_efforts: ["medium", "high"],
        default_reasoning_effort: "medium",
      },
    ],
  }
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })
  return { promise, resolve, reject }
}

function conversation(id: string, title: string) {
  return {
    id,
    title,
    archived: true,
    archive_status: "archived",
    updated_at: "2026-07-11T00:00:00.000Z",
  }
}

function renderArchivedConversations() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })

  return render(
    <MemoryRouter initialEntries={["/archived"]}>
      <QueryClientProvider client={queryClient}>
        <ArchivedConversationListPage />
      </QueryClientProvider>
    </MemoryRouter>
  )
}

function ConversationPageWithNewTaskShortcut() {
  const navigate = useNavigate()

  return (
    <>
      <button type="button" onClick={() => navigate("/conversations/new")}>
        测试新建任务
      </button>
      <ConversationPage />
    </>
  )
}

describe("archived conversation pagination", () => {
  beforeEach(async () => {
    setAccessToken("archived-conversations-access-token")
    await i18n.changeLanguage("zh-CN")
  })

  afterEach(() => {
    authMock.runningMessageAction = "queue"
    cleanup()
    setAccessToken(null)
    vi.unstubAllGlobals()
  })

  it.each([
    {
      name: "没有数据",
      page: { items: [], next_cursor: null },
      expectedContent: /没有已归档/,
      expectedSummary: "0 个任务",
      showsArchivedActions: false,
    },
    {
      name: "数据只有一页",
      page: {
        items: [conversation("conversation-1", "一页内的对话")],
        next_cursor: null,
      },
      expectedContent: "一页内的对话",
      expectedSummary: "1 个任务",
      showsArchivedActions: true,
    },
  ])(
    "$name时不显示分页操作",
    async ({
      page,
      expectedContent,
      expectedSummary,
      showsArchivedActions,
    }) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(() => Promise.resolve(envelope(page)))
      )

      renderArchivedConversations()

      expect(await screen.findByText(expectedContent)).toBeVisible()
      expect(screen.getByText(expectedSummary)).toBeVisible()
      expect(
        screen.queryByRole("button", { name: "上一页" })
      ).not.toBeInTheDocument()
      expect(
        screen.queryByRole("button", { name: "下一页" })
      ).not.toBeInTheDocument()
      const searchButton = screen.queryByRole("button", { name: "搜索" })
      const clearButton = screen.queryByRole("button", { name: "清除全部" })
      if (showsArchivedActions) {
        expect(searchButton).toBeVisible()
        expect(clearButton).toBeVisible()
      } else {
        expect(searchButton).not.toBeInTheDocument()
        expect(clearButton).not.toBeInTheDocument()
      }
    }
  )

  it("将全部归档任务放在同一卡片中并用分隔线分组", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          envelope({
            items: [
              conversation("conversation-1", "优化测试主管面试评语"),
              conversation("conversation-2", "写文章"),
              conversation("conversation-3", "排查 Docker Compose 启动失败"),
            ],
            next_cursor: null,
            total_count: 3,
          })
        )
      )
    )

    renderArchivedConversations()

    const list = await screen.findByRole("list", { name: "已归档任务" })
    expect(list).toHaveAttribute("data-slot", "card")
    expect(within(list).getAllByRole("listitem")).toHaveLength(3)
    expect(list.querySelectorAll('[data-slot="separator"]')).toHaveLength(2)
    expect(within(list).queryByRole("link")).not.toBeInTheDocument()
    expect(
      within(list).getAllByRole("button", { name: /取消归档任务/u })
    ).toHaveLength(3)
  })

  it("有多页数据时显示分页操作，并在最后一页保留返回入口", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = new URL(String(input), window.location.origin)
        const page = url.searchParams.has("cursor")
          ? {
              items: [conversation("conversation-2", "第二页对话")],
              next_cursor: null,
            }
          : {
              items: [conversation("conversation-1", "第一页对话")],
              next_cursor: "cursor-2",
            }
        return Promise.resolve(envelope(page))
      })
    )
    const interaction = userEvent.setup()

    renderArchivedConversations()

    expect(await screen.findByText("第一页对话")).toBeVisible()
    expect(screen.getByRole("button", { name: "上一页" })).toBeDisabled()
    const nextButton = screen.getByRole("button", { name: "下一页" })
    expect(nextButton).toBeEnabled()

    await interaction.click(nextButton)

    expect(await screen.findByText("第二页对话")).toBeVisible()
    expect(screen.getByRole("button", { name: "上一页" })).toBeEnabled()
    expect(screen.getByRole("button", { name: "下一页" })).toBeDisabled()
  })
})

describe("conversation knowledge base snapshots", () => {
  beforeEach(async () => {
    setAccessToken("conversation-knowledge-token")
    await i18n.changeLanguage("zh-CN")
  })

  afterEach(() => {
    authMock.runningMessageAction = "queue"
    cleanup()
    setAccessToken(null)
    vi.unstubAllGlobals()
  })

  it("shows a Goal card immediately, waits for native timing, and yields to a fast completion", async () => {
    const conversationId = "conversation-native-goal"
    const objective = "完整实现目标功能"
    const goalResponse = createDeferred<Response>()
    const goalAttachment = {
      id: "attachment-native-goal",
      name: "goal-brief.pdf",
      mime_type: "application/pdf",
      size: 2_048,
      kind: "attachment",
      draft_id: "draft-native-goal",
      turn_id: null,
      status: "draft",
      download_available: false,
    }
    let goalCompleted = false
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const path = new URL(url, window.location.origin).pathname
      if (url.includes("/events")) {
        return Promise.resolve(
          new Response("", {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          })
        )
      }
      if (path.endsWith("/conversations/prewarm")) {
        return Promise.resolve(envelope({ accepted: true }))
      }
      if (path.endsWith("/model-preference")) {
        return Promise.resolve(envelope(modelPreference()))
      }
      if (path.endsWith("/capabilities")) {
        return Promise.resolve(envelope({ items: [], next_cursor: null }))
      }
      if (path.endsWith("/knowledge-bases/search-capability")) {
        return Promise.resolve(
          envelope({
            status: "available",
            reason_code: null,
            checked_at: "2026-08-06T03:00:00.000Z",
          })
        )
      }
      if (path.endsWith("/knowledge-bases")) {
        return Promise.resolve(envelope({ items: [], next_cursor: null }))
      }
      if (
        path.endsWith(`/conversations/${conversationId}/draft`) &&
        init?.method === "PUT"
      ) {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>
        return Promise.resolve(
          envelope({
            ...body,
            updated_at: "2026-08-06T03:00:01.000Z",
          })
        )
      }
      if (
        path.endsWith(`/conversations/${conversationId}/goal`) &&
        init?.method === "POST"
      ) {
        return goalResponse.promise
      }
      if (path.endsWith(`/conversations/${conversationId}`)) {
        return Promise.resolve(
          envelope({
            id: conversationId,
            title: "原生目标",
            archived: false,
            updated_at: "2026-08-06T03:00:00.000Z",
            execution_status: goalCompleted ? "completed" : "idle",
            selected_knowledge_base_ids: [],
            draft: {
              input_text: "",
              priority_capability_ids: [],
              knowledge_base_ids: [],
              updated_at: "2026-08-06T03:00:00.000Z",
            },
            goal: goalCompleted
              ? {
                  thread_id: "codex-thread-goal",
                  objective,
                  status: "complete",
                  token_budget: null,
                  tokens_used: 512,
                  time_used_seconds: 10,
                  created_at: "2026-08-06T03:00:01.000Z",
                  updated_at: "2026-08-06T03:00:11.000Z",
                }
              : null,
            messages: [],
            turns: [],
            pending_requests: [],
            attachments: goalCompleted ? [] : [goalAttachment],
            artifacts: [],
          })
        )
      }
      return Promise.resolve(new Response(null, { status: 404 }))
    })
    vi.stubGlobal("fetch", fetchMock)
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })
    const interaction = userEvent.setup()

    render(
      <MemoryRouter initialEntries={[`/conversations/${conversationId}`]}>
        <QueryClientProvider client={queryClient}>
          <Routes>
            <Route
              path="/conversations/:conversationId"
              element={<ConversationPage />}
            />
          </Routes>
        </QueryClientProvider>
      </MemoryRouter>
    )

    const composer = await screen.findByRole("textbox", { name: "任务输入框" })
    expect(
      await screen.findByRole("button", { name: "移除附件 goal-brief.pdf" })
    ).toBeVisible()
    await interaction.click(screen.getByRole("button", { name: "添加" }))
    await interaction.click(screen.getByRole("option", { name: /目标/ }))
    await interaction.type(composer, objective)
    await interaction.click(screen.getByRole("button", { name: "发送" }))
    expect(
      screen.queryByRole("button", { name: "移除附件 goal-brief.pdf" })
    ).not.toBeInTheDocument()
    const optimisticGoalRegion = await screen.findByRole("region", {
      name: "目标状态",
    })
    expect(optimisticGoalRegion).toHaveTextContent("进行中的目标")
    expect(within(optimisticGoalRegion).getByText(objective)).toBeVisible()
    expect(goalCompleted).toBe(false)
    expect(
      within(optimisticGoalRegion).queryByRole("button", {
        name: "查看目标详情",
      })
    ).toBeNull()

    await waitFor(() => {
      const goalCall = fetchMock.mock.calls.find(([request, requestInit]) => {
        const requestPath = new URL(String(request), window.location.origin)
          .pathname
        return (
          requestPath.endsWith(`/conversations/${conversationId}/goal`) &&
          requestInit?.method === "POST"
        )
      })
      expect(goalCall).toBeDefined()
      const body = JSON.parse(String(goalCall?.[1]?.body)) as {
        objective: string
        priority_capability_ids: string[]
        knowledge_base_ids: string[]
        idempotency_key: string
      }
      expect(body).toMatchObject({
        objective,
        priority_capability_ids: [],
        knowledge_base_ids: [],
      })
      expect(body).not.toHaveProperty("token_budget")
      expect(body.idempotency_key).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
      )
    })
    goalResponse.resolve(
      envelope({
        turn_id: "40000000-0000-4000-8000-000000000001",
        accepted: true,
        status: "starting",
      })
    )
    expect(await screen.findByText("goal-brief.pdf")).toBeVisible()
    const goalRegion = await screen.findByRole("region", { name: "目标状态" })
    expect(goalRegion).toHaveTextContent("进行中的目标")
    expect(within(goalRegion).getByText(objective)).toBeVisible()
    expect(
      within(goalRegion).queryByRole("button", { name: "查看目标详情" })
    ).toBeNull()

    goalCompleted = true
    await queryClient.invalidateQueries({
      queryKey: ["conversation", conversationId],
    })

    await waitFor(() => {
      expect(screen.queryByRole("region", { name: "目标状态" })).toBeNull()
    })
  })

  it("keeps a second pause authoritative when an older active refresh finishes late", async () => {
    const conversationId = "conversation-repeat-goal-pause"
    const staleActiveRefresh = createDeferred<Response>()
    const now = new Date().toISOString()
    let conversationGetCount = 0
    let pauseCount = 0
    const goal = (status: "active" | "paused", timeUsedSeconds: number) => ({
      thread_id: "codex-thread-repeat-pause",
      objective: "完成可重复暂停的目标",
      status,
      token_budget: null,
      tokens_used: 800,
      time_used_seconds: timeUsedSeconds,
      created_at: now,
      updated_at: now,
    })
    const detail = (status: "active" | "paused") => ({
      id: conversationId,
      title: "重复暂停目标",
      archived: false,
      updated_at: now,
      execution_status: "running",
      selected_knowledge_base_ids: [],
      draft: {
        input_text: "",
        priority_capability_ids: [],
        knowledge_base_ids: [],
        updated_at: now,
      },
      goal: goal(status, status === "active" ? 20 : 21),
      messages: [],
      turns: [],
      running_turn: null,
      pending_requests: [],
      attachments: [],
      artifacts: [],
    })
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const path = new URL(url, window.location.origin).pathname
      if (url.includes("/events")) {
        return Promise.resolve(
          new Response("", {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          })
        )
      }
      if (path.endsWith("/conversations/prewarm")) {
        return Promise.resolve(envelope({ accepted: true }))
      }
      if (path.endsWith("/model-preference")) {
        return Promise.resolve(envelope(modelPreference()))
      }
      if (path.endsWith("/capabilities")) {
        return Promise.resolve(envelope({ items: [], next_cursor: null }))
      }
      if (path.endsWith("/knowledge-bases/search-capability")) {
        return Promise.resolve(
          envelope({
            status: "available",
            reason_code: null,
            checked_at: now,
          })
        )
      }
      if (path.endsWith("/knowledge-bases")) {
        return Promise.resolve(envelope({ items: [], next_cursor: null }))
      }
      if (
        path.endsWith(`/conversations/${conversationId}/goal`) &&
        init?.method === "PATCH"
      ) {
        pauseCount += 1
        return Promise.resolve(envelope(goal("paused", 20 + pauseCount)))
      }
      if (
        path.endsWith(`/conversations/${conversationId}/goal/resume`) &&
        init?.method === "POST"
      ) {
        return Promise.resolve(
          envelope({
            turn_id: "40000000-0000-4000-8000-000000000002",
            accepted: true,
            status: "running",
          })
        )
      }
      if (path.endsWith(`/conversations/${conversationId}`)) {
        conversationGetCount += 1
        if (conversationGetCount === 3) return staleActiveRefresh.promise
        return Promise.resolve(envelope(detail("active")))
      }
      if (path.endsWith("/conversations")) {
        return Promise.resolve(
          envelope({ items: [], next_cursor: null, total_count: 0 })
        )
      }
      return Promise.resolve(new Response(null, { status: 404 }))
    })
    vi.stubGlobal("fetch", fetchMock)
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })
    const interaction = userEvent.setup()

    render(
      <MemoryRouter initialEntries={[`/conversations/${conversationId}`]}>
        <QueryClientProvider client={queryClient}>
          <Routes>
            <Route
              path="/conversations/:conversationId"
              element={<ConversationPage />}
            />
          </Routes>
        </QueryClientProvider>
      </MemoryRouter>
    )

    await interaction.click(
      await screen.findByRole("button", { name: "暂停目标" })
    )
    expect(await screen.findByText("已暂停的目标")).toBeVisible()

    await interaction.click(screen.getByRole("button", { name: "继续目标" }))
    expect(
      await screen.findByRole("button", { name: "暂停目标" })
    ).toBeVisible()

    void queryClient.invalidateQueries({
      queryKey: ["conversation", conversationId],
      exact: true,
    })
    await waitFor(() => expect(conversationGetCount).toBe(3))

    await interaction.click(screen.getByRole("button", { name: "暂停目标" }))
    expect(await screen.findByText("已暂停的目标")).toBeVisible()

    staleActiveRefresh.resolve(envelope(detail("active")))

    await new Promise((resolve) => window.setTimeout(resolve, 20))
    await waitFor(() => expect(pauseCount).toBe(2))
    expect(screen.getByText("已暂停的目标")).toBeVisible()
    expect(screen.queryByRole("button", { name: "暂停目标" })).toBeNull()
  })

  it("hides the native Goal card after completion and shows the completion marker under the reply", async () => {
    const conversationId = "conversation-completed-goal"
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      const path = new URL(url, window.location.origin).pathname
      if (url.includes("/events")) {
        return Promise.resolve(
          new Response("", {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          })
        )
      }
      if (path.endsWith("/conversations/prewarm")) {
        return Promise.resolve(envelope({ accepted: true }))
      }
      if (path.endsWith("/model-preference")) {
        return Promise.resolve(envelope(modelPreference()))
      }
      if (path.endsWith("/capabilities")) {
        return Promise.resolve(envelope({ items: [], next_cursor: null }))
      }
      if (path.endsWith("/knowledge-bases/search-capability")) {
        return Promise.resolve(
          envelope({
            status: "available",
            reason_code: null,
            checked_at: "2026-08-06T03:00:00.000Z",
          })
        )
      }
      if (path.endsWith("/knowledge-bases")) {
        return Promise.resolve(envelope({ items: [], next_cursor: null }))
      }
      if (path.endsWith(`/conversations/${conversationId}`)) {
        return Promise.resolve(
          envelope({
            id: conversationId,
            title: "原生目标完成态",
            archived: false,
            updated_at: "2026-08-06T03:00:30.000Z",
            execution_status: "completed",
            selected_knowledge_base_ids: [],
            draft: {
              input_text: "",
              priority_capability_ids: [],
              knowledge_base_ids: [],
              updated_at: "2026-08-06T03:00:30.000Z",
            },
            goal: {
              thread_id: "codex-thread-goal",
              objective: "帮我写一篇介绍美国的文章",
              status: "complete",
              token_budget: null,
              tokens_used: 1_280,
              time_used_seconds: 30,
              created_at: "2026-08-06T03:00:00.000Z",
              updated_at: "2026-08-06T03:00:30.000Z",
            },
            messages: [
              {
                id: "message-user-completed-goal",
                role: "user",
                turn_id: "turn-completed-goal",
                content: "帮我写一篇介绍美国的文章",
                created_at: "2026-08-06T03:00:00.000Z",
              },
              {
                id: "message-assistant-completed-goal",
                role: "assistant",
                turn_id: "turn-completed-goal",
                phase: "final_answer",
                content: "美国文章完成",
                created_at: "2026-08-06T03:00:30.000Z",
              },
            ],
            turns: [
              {
                id: "turn-completed-goal",
                status: "completed",
                started_at: "2026-08-06T03:00:00.000Z",
                completed_at: "2026-08-06T03:00:30.000Z",
              },
            ],
            running_turn: null,
            pending_requests: [],
            attachments: [],
            artifacts: [],
          })
        )
      }
      return Promise.resolve(new Response(null, { status: 404 }))
    })
    vi.stubGlobal("fetch", fetchMock)
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })

    render(
      <MemoryRouter initialEntries={[`/conversations/${conversationId}`]}>
        <QueryClientProvider client={queryClient}>
          <Routes>
            <Route
              path="/conversations/:conversationId"
              element={<ConversationPage />}
            />
          </Routes>
        </QueryClientProvider>
      </MemoryRouter>
    )

    expect(await screen.findByText("美国文章完成")).toBeVisible()
    expect(screen.queryByRole("region", { name: "目标状态" })).toBeNull()
    expect(
      within(screen.getByRole("article", { name: "助手回复" })).getByText(
        "已在 30s 内达成目标"
      )
    ).toBeVisible()
  })

  it("consumes submitted Skills and attachments immediately, keeps them hidden across stale refetches, and restores them only after failure", async () => {
    const turnResponse = createDeferred<Response>()
    const retryTurnResponse = createDeferred<Response>()
    let turnAttempts = 0
    let successfulTurnCreated = false
    const draftInput = "发送后立即清空"
    const selectedSkill = {
      id: "skill-immediate-clear",
      name: "dashi-ppt",
      slug: "dashi-ppt",
      type: "skill",
      description: "制作演示文稿",
      status: "active",
      source_type: "local",
      builtin_key: null,
      is_builtin: false,
      marketplace_listing_id: null,
      marketplace_release_id: null,
      logo_url: null,
      is_owner: true,
      can_manage: true,
      can_govern: true,
      can_select: true,
      can_delete: true,
      has_logo: false,
      preference_status: "enabled",
      manifest: {},
      risk_summary: {},
      created_at: "2026-07-22T00:00:00.000Z",
      updated_at: "2026-07-22T00:00:00.000Z",
    }
    const imageAttachment = {
      id: "attachment-immediate-clear",
      name: "invoice.png",
      mime_type: "image/png",
      size: 1_024,
      kind: "attachment",
      draft_id: "draft-immediate-clear",
      turn_id: null,
      status: "draft",
      download_available: false,
    }
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const path = new URL(url, window.location.origin).pathname
      if (url.includes("/events")) {
        return Promise.resolve(
          new Response("", {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          })
        )
      }
      if (path.endsWith("/conversations/prewarm")) {
        return Promise.resolve(envelope({ accepted: true }))
      }
      if (path.endsWith("/model-preference")) {
        return Promise.resolve(envelope(modelPreference()))
      }
      if (path.endsWith("/capabilities")) {
        return Promise.resolve(
          envelope({ items: [selectedSkill], next_cursor: null })
        )
      }
      if (path.endsWith("/knowledge-bases/search-capability")) {
        return Promise.resolve(
          envelope({
            status: "available",
            reason_code: null,
            checked_at: "2026-07-22T00:00:00.000Z",
          })
        )
      }
      if (path.endsWith("/knowledge-bases")) {
        return Promise.resolve(envelope({ items: [], next_cursor: null }))
      }
      if (
        path.endsWith("/conversations/conversation-immediate-clear/draft") &&
        init?.method === "PUT"
      ) {
        const body = JSON.parse(String(init.body)) as {
          input_text: string
          priority_capability_ids: string[]
          knowledge_base_ids: string[]
        }
        return Promise.resolve(
          envelope({
            ...body,
            updated_at: "2026-07-22T00:00:01.000Z",
          })
        )
      }
      if (
        path.endsWith("/conversations/conversation-immediate-clear/turns") &&
        init?.method === "POST"
      ) {
        turnAttempts += 1
        return turnAttempts === 1
          ? turnResponse.promise
          : retryTurnResponse.promise
      }
      if (path.endsWith("/conversations/conversation-immediate-clear")) {
        return Promise.resolve(
          envelope({
            id: "conversation-immediate-clear",
            title: "立即清空输入框",
            archived: false,
            updated_at: "2026-07-22T00:00:00.000Z",
            execution_status: "idle",
            selected_knowledge_base_ids: [],
            draft: {
              input_text: successfulTurnCreated ? "" : draftInput,
              priority_capability_ids: successfulTurnCreated
                ? []
                : [selectedSkill.id],
              knowledge_base_ids: [],
              updated_at: successfulTurnCreated
                ? "2026-07-22T00:00:02.000Z"
                : "2026-07-22T00:00:00.000Z",
            },
            messages: [],
            turns: [],
            pending_requests: [],
            attachments: successfulTurnCreated ? [] : [imageAttachment],
            artifacts: [],
          })
        )
      }
      return Promise.resolve(new Response(null, { status: 404 }))
    })
    vi.stubGlobal("fetch", fetchMock)
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })
    const interaction = userEvent.setup()

    render(
      <MemoryRouter
        initialEntries={["/conversations/conversation-immediate-clear"]}
      >
        <QueryClientProvider client={queryClient}>
          <Routes>
            <Route
              path="/conversations/:conversationId"
              element={<ConversationPage />}
            />
          </Routes>
        </QueryClientProvider>
      </MemoryRouter>
    )

    const composer = await screen.findByRole("textbox", { name: "任务输入框" })
    await waitFor(() => expect(composer).toHaveValue(draftInput))
    const removeImageButton = await screen.findByRole("button", {
      name: "移除附件 invoice.png",
    })
    expect(removeImageButton).toBeVisible()
    expect(
      await screen.findByRole("button", { name: "移除 dashi-ppt" })
    ).toBeVisible()
    const sendButton = screen.getByRole("button", { name: "发送" })
    await waitFor(() => expect(sendButton).toBeEnabled())

    await interaction.click(sendButton)

    expect(composer).toHaveValue("")
    expect(
      screen.queryByRole("button", { name: "移除附件 invoice.png" })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "移除 dashi-ppt" })
    ).not.toBeInTheDocument()
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([request, requestInit]) =>
            String(request).endsWith(
              "/api/v1/conversations/conversation-immediate-clear/turns"
            ) && requestInit?.method === "POST"
        )
      ).toBe(true)
    )

    await queryClient.invalidateQueries({
      queryKey: ["conversation", "conversation-immediate-clear"],
      exact: true,
    })
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.filter(([request, requestInit]) => {
          const path = new URL(String(request), window.location.origin).pathname
          return (
            path.endsWith("/conversations/conversation-immediate-clear") &&
            requestInit?.method !== "PUT" &&
            requestInit?.method !== "POST"
          )
        })
      ).toHaveLength(2)
    )
    expect(
      screen.queryByRole("button", { name: "移除附件 invoice.png" })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "移除 dashi-ppt" })
    ).not.toBeInTheDocument()

    turnResponse.resolve(errorEnvelope(503, "RUNTIME_TURN_FAILED"))

    await waitFor(() => expect(composer).toHaveValue(draftInput))
    expect(
      await screen.findByRole("button", { name: "移除附件 invoice.png" })
    ).toBeVisible()
    expect(
      await screen.findByRole("button", { name: "移除 dashi-ppt" })
    ).toBeVisible()

    const retrySendButton = screen.getByRole("button", { name: "发送" })
    await waitFor(() => expect(retrySendButton).toBeEnabled())
    await interaction.click(retrySendButton)
    expect(composer).toHaveValue("")
    expect(
      screen.queryByRole("button", { name: "移除附件 invoice.png" })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "移除 dashi-ppt" })
    ).not.toBeInTheDocument()
    await waitFor(() => expect(turnAttempts).toBe(2))

    successfulTurnCreated = true
    retryTurnResponse.resolve(
      envelope({
        turn_id: "40000000-0000-4000-8000-000000000001",
        accepted: true,
        status: "starting",
      })
    )

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.filter(([request, requestInit]) => {
          const path = new URL(String(request), window.location.origin).pathname
          return (
            path.endsWith("/conversations/conversation-immediate-clear") &&
            requestInit?.method !== "PUT" &&
            requestInit?.method !== "POST"
          )
        })
      ).toHaveLength(3)
    )
    await waitFor(() => expect(composer).toHaveValue(""))
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "移除附件 invoice.png" })
      ).not.toBeInTheDocument()
    )
    expect(
      screen.queryByRole("button", { name: "移除 dashi-ppt" })
    ).not.toBeInTheDocument()
  })

  it("ignores a stale draft version conflict after switching to a new task", async () => {
    const conversationId = "conversation-stale-draft-conflict"
    const draftResponse = createDeferred<Response>()
    const draftInput = "发送后立刻新建任务"
    let draftSaveAttempts = 0
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const path = new URL(url, window.location.origin).pathname
      if (url.includes("/events")) {
        return Promise.resolve(
          new Response("", {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          })
        )
      }
      if (path.endsWith("/conversations/prewarm")) {
        return Promise.resolve(envelope({ accepted: true }))
      }
      if (path.endsWith("/model-preference")) {
        return Promise.resolve(envelope(modelPreference()))
      }
      if (path.endsWith("/capabilities")) {
        return Promise.resolve(envelope({ items: [], next_cursor: null }))
      }
      if (path.endsWith("/knowledge-bases/search-capability")) {
        return Promise.resolve(
          envelope({
            status: "available",
            reason_code: null,
            checked_at: "2026-08-13T00:00:00.000Z",
          })
        )
      }
      if (path.endsWith("/knowledge-bases")) {
        return Promise.resolve(envelope({ items: [], next_cursor: null }))
      }
      if (
        path.endsWith(`/conversations/${conversationId}/draft`) &&
        init?.method === "PUT"
      ) {
        draftSaveAttempts += 1
        if (draftSaveAttempts === 1) {
          return draftResponse.promise
        }
        const body = JSON.parse(String(init.body)) as {
          input_text: string
          priority_capability_ids: string[]
          knowledge_base_ids: string[]
        }
        return Promise.resolve(
          envelope({
            ...body,
            updated_at: "2026-08-13T00:00:01.000Z",
          })
        )
      }
      if (
        path.endsWith(`/conversations/${conversationId}/turns`) &&
        init?.method === "POST"
      ) {
        return Promise.resolve(
          envelope({
            turn_id: "40000000-0000-4000-8000-000000000001",
            accepted: true,
            status: "starting",
          })
        )
      }
      if (path.endsWith(`/conversations/${conversationId}`)) {
        return Promise.resolve(
          envelope({
            id: conversationId,
            title: "快速切换任务",
            archived: false,
            updated_at: "2026-08-13T00:00:00.000Z",
            execution_status: "idle",
            selected_knowledge_base_ids: [],
            draft: {
              input_text: "",
              priority_capability_ids: [],
              knowledge_base_ids: [],
              updated_at: "2026-08-13T00:00:00.000Z",
            },
            messages: [],
            turns: [],
            pending_requests: [],
            attachments: [],
            artifacts: [],
          })
        )
      }
      return Promise.resolve(new Response(null, { status: 404 }))
    })
    vi.stubGlobal("fetch", fetchMock)
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })
    const interaction = userEvent.setup()

    render(
      <MemoryRouter initialEntries={[`/conversations/${conversationId}`]}>
        <QueryClientProvider client={queryClient}>
          <Routes>
            <Route
              path="/conversations/new"
              element={<ConversationPageWithNewTaskShortcut />}
            />
            <Route
              path="/conversations/:conversationId"
              element={<ConversationPageWithNewTaskShortcut />}
            />
          </Routes>
        </QueryClientProvider>
      </MemoryRouter>
    )

    const composer = await screen.findByRole("textbox", { name: "任务输入框" })
    await waitFor(() => expect(composer).toHaveValue(""))
    await interaction.type(composer, draftInput)
    await interaction.click(screen.getByRole("button", { name: "发送" }))
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([request, requestInit]) =>
            String(request).endsWith(
              `/api/v1/conversations/${conversationId}/draft`
            ) && requestInit?.method === "PUT"
        )
      ).toBe(true)
    )

    await interaction.click(
      screen.getByRole("button", { name: "测试新建任务" })
    )
    const newComposer = await screen.findByRole("textbox", {
      name: "任务输入框",
    })
    await waitFor(() => expect(newComposer).toHaveValue(""))

    await act(async () => {
      draftResponse.resolve(errorEnvelope(409, "DRAFT_VERSION_CONFLICT"))
      await draftResponse.promise
    })
    await waitFor(() => expect(queryClient.isMutating()).toBe(0))

    expect(
      screen.queryByText("草稿已在其他位置更新，请刷新后重试。")
    ).not.toBeInTheDocument()
    expect(newComposer).toHaveValue("")
    expect(screen.getByRole("button", { name: "发送" })).toHaveAttribute(
      "aria-disabled",
      "true"
    )
    expect(
      fetchMock.mock.calls.filter(
        ([request, requestInit]) =>
          String(request).endsWith(
            `/api/v1/conversations/${conversationId}/turns`
          ) && requestInit?.method === "POST"
      )
    ).toHaveLength(0)
  })

  it("queues a rapid follow-up while the accepted turn is still projecting", async () => {
    authMock.runningMessageAction = "steer"
    const conversationId = "conversation-starting-follow-up"
    const firstTurnId = "40000000-0000-4000-8000-000000000088"
    const firstInput = "第一条消息"
    const followUpInput = "紧接着发送的第二条消息"
    const projectionRefresh = createDeferred<Response>()
    let draftSaveAttempts = 0
    let detailAttempts = 0
    let turnStartAttempts = 0
    let pendingRequestBody: unknown = null
    const detail = () => ({
      id: conversationId,
      title: "启动阶段连续发送",
      archived: false,
      updated_at: "2026-08-14T00:00:00.000Z",
      execution_status: "idle",
      selected_knowledge_base_ids: [],
      draft: {
        input_text: "",
        priority_capability_ids: [],
        knowledge_base_ids: [],
        updated_at: "2026-08-14T00:00:00.000Z",
      },
      messages: [],
      turns: [],
      running_turn: null,
      pending_requests: [],
      attachments: [],
      artifacts: [],
    })
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const path = new URL(url, window.location.origin).pathname
      if (url.includes("/events")) {
        return Promise.resolve(
          new Response("", {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          })
        )
      }
      if (path.endsWith("/conversations/prewarm")) {
        return Promise.resolve(envelope({ accepted: true }))
      }
      if (path.endsWith("/model-preference")) {
        return Promise.resolve(envelope(modelPreference()))
      }
      if (path.endsWith("/capabilities")) {
        return Promise.resolve(envelope({ items: [], next_cursor: null }))
      }
      if (path.endsWith("/knowledge-bases/search-capability")) {
        return Promise.resolve(
          envelope({
            status: "available",
            reason_code: null,
            checked_at: "2026-08-14T00:00:00.000Z",
          })
        )
      }
      if (path.endsWith("/knowledge-bases")) {
        return Promise.resolve(envelope({ items: [], next_cursor: null }))
      }
      if (
        path.endsWith(`/conversations/${conversationId}/draft`) &&
        init?.method === "PUT"
      ) {
        draftSaveAttempts += 1
        const body = JSON.parse(String(init.body)) as {
          input_text: string
          priority_capability_ids: string[]
          knowledge_base_ids: string[]
        }
        return Promise.resolve(
          envelope({
            ...body,
            updated_at: `2026-08-14T00:00:0${draftSaveAttempts}.000Z`,
          })
        )
      }
      if (
        path.endsWith(`/conversations/${conversationId}/turns`) &&
        init?.method === "POST"
      ) {
        turnStartAttempts += 1
        return Promise.resolve(
          envelope({
            turn_id: firstTurnId,
            accepted: true,
            status: "starting",
          })
        )
      }
      if (
        path.endsWith(`/conversations/${conversationId}/pending-requests`) &&
        init?.method === "POST"
      ) {
        pendingRequestBody = JSON.parse(String(init.body))
        return Promise.resolve(envelope({}))
      }
      if (path.endsWith(`/conversations/${conversationId}`)) {
        detailAttempts += 1
        return detailAttempts === 1
          ? Promise.resolve(envelope(detail()))
          : projectionRefresh.promise
      }
      if (path.endsWith("/conversations")) {
        return Promise.resolve(envelope({ items: [], next_cursor: null }))
      }
      return Promise.resolve(new Response(null, { status: 404 }))
    })
    vi.stubGlobal("fetch", fetchMock)
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })
    const interaction = userEvent.setup()

    render(
      <MemoryRouter initialEntries={[`/conversations/${conversationId}`]}>
        <QueryClientProvider client={queryClient}>
          <Routes>
            <Route
              path="/conversations/:conversationId"
              element={<ConversationPage />}
            />
          </Routes>
        </QueryClientProvider>
      </MemoryRouter>
    )

    const composer = await screen.findByRole("textbox", { name: "任务输入框" })
    await waitFor(() => expect(composer).toHaveValue(""))
    await interaction.type(composer, firstInput)
    await interaction.keyboard("{Enter}")

    await waitFor(() => expect(turnStartAttempts).toBe(1))
    expect(await screen.findByText("正在思考", { exact: true })).toBeVisible()
    await waitFor(() => expect(queryClient.isMutating()).toBe(0))
    await waitFor(() => expect(detailAttempts).toBeGreaterThan(1))
    expect(composer).toHaveValue("")
    expect(screen.getByRole("button", { name: "停止" })).toBeVisible()
    expect(
      screen.queryByRole("button", { name: "发送" })
    ).not.toBeInTheDocument()

    await interaction.type(composer, followUpInput)
    const sendButton = screen.getByRole("button", { name: "发送" })
    expect(sendButton.querySelector(".animate-spin")).toBeNull()
    await waitFor(() => expect(sendButton).toBeEnabled())
    await interaction.click(sendButton)

    await waitFor(() =>
      expect(pendingRequestBody).toMatchObject({
        input_text: followUpInput,
        priority_capability_ids: [],
        knowledge_base_ids: [],
      })
    )
    expect(turnStartAttempts).toBe(1)
    expect(
      fetchMock.mock.calls.filter(
        ([request, requestInit]) =>
          String(request).includes("/steer") && requestInit?.method === "POST"
      )
    ).toHaveLength(0)
    expect(
      screen.queryByText("当前状态与此操作冲突，请刷新后重试。")
    ).not.toBeInTheDocument()

    await act(async () => {
      projectionRefresh.resolve(envelope(detail()))
      await projectionRefresh.promise
    })
  })

  it("saves the submitted snapshot when a queued follow-up meets a draft version conflict", async () => {
    const conversationId = "conversation-running-follow-up-conflict"
    const runningTurnId = "40000000-0000-4000-8000-000000000099"
    const followUpInput = "第二条快速追问"
    let draftSaveAttempts = 0
    let pendingRequestBody: unknown = null
    const detail = (draftUpdatedAt = "2026-08-13T00:00:00.000Z") => ({
      id: conversationId,
      title: "连续发送任务",
      archived: false,
      updated_at: draftUpdatedAt,
      execution_status: "running",
      selected_knowledge_base_ids: [],
      draft: {
        input_text: "",
        priority_capability_ids: [],
        knowledge_base_ids: [],
        updated_at: draftUpdatedAt,
      },
      messages: [
        {
          id: "message-running-follow-up",
          role: "user",
          content: "第一条消息",
          turn_id: runningTurnId,
          created_at: "2026-08-13T00:00:00.000Z",
        },
      ],
      turns: [
        {
          id: runningTurnId,
          status: "running",
          collaboration_mode: "default",
          started_at: "2026-08-13T00:00:00.000Z",
        },
      ],
      running_turn: {
        id: runningTurnId,
        status: "running",
        collaboration_mode: "default",
        started_at: "2026-08-13T00:00:00.000Z",
      },
      pending_requests: [],
      attachments: [],
      artifacts: [],
    })
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const path = new URL(url, window.location.origin).pathname
      if (url.includes("/events")) {
        return Promise.resolve(
          new Response("", {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          })
        )
      }
      if (path.endsWith("/conversations/prewarm")) {
        return Promise.resolve(envelope({ accepted: true }))
      }
      if (path.endsWith("/model-preference")) {
        return Promise.resolve(envelope(modelPreference()))
      }
      if (path.endsWith("/capabilities")) {
        return Promise.resolve(envelope({ items: [], next_cursor: null }))
      }
      if (path.endsWith("/knowledge-bases/search-capability")) {
        return Promise.resolve(
          envelope({
            status: "available",
            reason_code: null,
            checked_at: "2026-08-13T00:00:00.000Z",
          })
        )
      }
      if (path.endsWith("/knowledge-bases")) {
        return Promise.resolve(envelope({ items: [], next_cursor: null }))
      }
      if (
        path.endsWith(`/conversations/${conversationId}/draft`) &&
        init?.method === "PUT"
      ) {
        draftSaveAttempts += 1
        if (draftSaveAttempts === 1) {
          return Promise.resolve(errorEnvelope(409, "DRAFT_VERSION_CONFLICT"))
        }
        const body = JSON.parse(String(init.body)) as {
          input_text: string
          priority_capability_ids: string[]
          knowledge_base_ids: string[]
        }
        return Promise.resolve(
          envelope({
            ...body,
            updated_at: "2026-08-13T00:00:02.000Z",
          })
        )
      }
      if (
        path.endsWith(`/conversations/${conversationId}/pending-requests`) &&
        init?.method === "POST"
      ) {
        pendingRequestBody = JSON.parse(String(init.body))
        return Promise.resolve(envelope({}))
      }
      if (path.endsWith(`/conversations/${conversationId}`)) {
        const timestamp =
          draftSaveAttempts > 0
            ? "2026-08-13T00:00:01.000Z"
            : "2026-08-13T00:00:00.000Z"
        return Promise.resolve(envelope(detail(timestamp)))
      }
      return Promise.resolve(new Response(null, { status: 404 }))
    })
    vi.stubGlobal("fetch", fetchMock)
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })
    const interaction = userEvent.setup()

    render(
      <MemoryRouter initialEntries={[`/conversations/${conversationId}`]}>
        <QueryClientProvider client={queryClient}>
          <Routes>
            <Route
              path="/conversations/:conversationId"
              element={<ConversationPage />}
            />
          </Routes>
        </QueryClientProvider>
      </MemoryRouter>
    )

    const composer = await screen.findByRole("textbox", { name: "任务输入框" })
    await waitFor(() => expect(composer).toHaveValue(""))
    expect(screen.getByRole("button", { name: "停止" })).toBeVisible()
    expect(
      screen.queryByRole("button", { name: "发送" })
    ).not.toBeInTheDocument()
    await interaction.type(composer, followUpInput)
    const sendButton = screen.getByRole("button", { name: "发送" })
    expect(sendButton).toBeEnabled()
    expect(
      screen.queryByRole("button", { name: "停止" })
    ).not.toBeInTheDocument()
    await interaction.click(sendButton)

    await waitFor(() =>
      expect(pendingRequestBody).toMatchObject({
        input_text: followUpInput,
        priority_capability_ids: [],
        knowledge_base_ids: [],
      })
    )
    expect(
      screen.queryByText("草稿已在其他位置更新，请刷新后重试。")
    ).not.toBeInTheDocument()
    await waitFor(() => expect(composer).toHaveValue(""))
    expect(draftSaveAttempts).toBe(2)
  })

  it("shows a pending attachment chip while an uploaded file request is in flight", async () => {
    const conversationId = "conversation-upload-pending"
    const uploadResponse = createDeferred<Response>()
    let uploadCompleted = false
    const uploadedAttachment = {
      id: "attachment-upload-pending",
      name: "ui-ux-pro-max.zip",
      mime_type: "application/zip",
      size: 5_242_880,
      kind: "attachment",
      draft_id: "draft-upload-pending",
      turn_id: null,
      status: "draft",
      download_available: false,
    }
    const detail = () => ({
      id: conversationId,
      title: "上传附件可见",
      archived: false,
      updated_at: "2026-08-13T00:00:00.000Z",
      execution_status: "idle",
      selected_knowledge_base_ids: [],
      draft: {
        input_text: "",
        priority_capability_ids: [],
        knowledge_base_ids: [],
        updated_at: "2026-08-13T00:00:00.000Z",
      },
      messages: [],
      turns: [],
      running_turn: null,
      pending_requests: [],
      attachments: uploadCompleted ? [uploadedAttachment] : [],
      artifacts: [],
    })
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const path = new URL(url, window.location.origin).pathname
      if (url.includes("/events")) {
        return Promise.resolve(
          new Response("", {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          })
        )
      }
      if (path.endsWith("/conversations/prewarm")) {
        return Promise.resolve(envelope({ accepted: true }))
      }
      if (path.endsWith("/model-preference")) {
        return Promise.resolve(envelope(modelPreference()))
      }
      if (path.endsWith("/capabilities")) {
        return Promise.resolve(envelope({ items: [], next_cursor: null }))
      }
      if (path.endsWith("/knowledge-bases/search-capability")) {
        return Promise.resolve(
          envelope({
            status: "available",
            reason_code: null,
            checked_at: "2026-08-13T00:00:00.000Z",
          })
        )
      }
      if (path.endsWith("/knowledge-bases")) {
        return Promise.resolve(envelope({ items: [], next_cursor: null }))
      }
      if (
        path.endsWith(`/conversations/${conversationId}/attachments`) &&
        init?.method === "POST"
      ) {
        return uploadResponse.promise
      }
      if (path.endsWith(`/conversations/${conversationId}`)) {
        return Promise.resolve(envelope(detail()))
      }
      return Promise.resolve(new Response(null, { status: 404 }))
    })
    vi.stubGlobal("fetch", fetchMock)
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })
    const interaction = userEvent.setup()

    render(
      <MemoryRouter initialEntries={[`/conversations/${conversationId}`]}>
        <QueryClientProvider client={queryClient}>
          <Routes>
            <Route
              path="/conversations/:conversationId"
              element={<ConversationPage />}
            />
          </Routes>
        </QueryClientProvider>
      </MemoryRouter>
    )

    expect(await screen.findByText("上传附件可见")).toBeVisible()

    await interaction.upload(
      screen.getByLabelText("添加附件"),
      new File(["zip"], "ui-ux-pro-max.zip", { type: "application/zip" })
    )

    const pendingChip = await screen.findByRole("status", {
      name: "正在上传附件 ui-ux-pro-max.zip",
    })
    expect(within(pendingChip).getByText("ui-ux-pro-max.zip")).toBeVisible()
    expect(pendingChip.querySelector(".attachment-chip-spinner")).not.toBeNull()
    expect(
      screen.queryByRole("button", { name: "移除附件 ui-ux-pro-max.zip" })
    ).not.toBeInTheDocument()

    uploadCompleted = true
    await act(async () => {
      uploadResponse.resolve(envelope(uploadedAttachment))
      await uploadResponse.promise
    })

    await waitFor(() =>
      expect(
        screen.queryByRole("status", {
          name: "正在上传附件 ui-ux-pro-max.zip",
        })
      ).not.toBeInTheDocument()
    )
    expect(
      screen.getByRole("button", { name: "移除附件 ui-ux-pro-max.zip" })
    ).toBeVisible()
  })

  it("clears all attachments with one atomic request and blocks other composer writes until it finishes", async () => {
    const conversationId = "conversation-clear-attachments"
    const clearResponse = createDeferred<Response>()
    let clearCompleted = false
    let draftWriteWhileClearPending = false
    const draftUpdates: Array<Record<string, unknown>> = []
    const attachments = ["一.pdf", "二.pdf", "三.pdf", "四.pdf"].map(
      (name, index) => ({
        id: `30000000-0000-4000-8000-00000000000${index + 1}`,
        name,
        mime_type: "application/pdf",
        size: 1_024 + index,
        kind: "attachment",
        draft_id: "40000000-0000-4000-8000-000000000001",
        turn_id: null,
        status: "draft",
        download_available: false,
      })
    )
    const detail = () => ({
      id: conversationId,
      title: "批量清理附件",
      archived: false,
      updated_at: "2026-08-13T00:00:00.000Z",
      execution_status: "idle",
      selected_knowledge_base_ids: [],
      draft: {
        input_text: "",
        priority_capability_ids: [],
        knowledge_base_ids: [],
        updated_at: "2026-08-13T00:00:00.000Z",
      },
      messages: [],
      turns: [],
      running_turn: null,
      pending_requests: [],
      attachments: clearCompleted ? [] : attachments,
      artifacts: [],
    })
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const path = new URL(url, window.location.origin).pathname
      if (url.includes("/events")) {
        return Promise.resolve(
          new Response("", {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          })
        )
      }
      if (path.endsWith("/conversations/prewarm")) {
        return Promise.resolve(envelope({ accepted: true }))
      }
      if (path.endsWith("/model-preference")) {
        return Promise.resolve(envelope(modelPreference()))
      }
      if (path.endsWith("/capabilities")) {
        return Promise.resolve(envelope({ items: [], next_cursor: null }))
      }
      if (path.endsWith("/knowledge-bases/search-capability")) {
        return Promise.resolve(
          envelope({
            status: "available",
            reason_code: null,
            checked_at: "2026-08-13T00:00:00.000Z",
          })
        )
      }
      if (path.endsWith("/knowledge-bases")) {
        return Promise.resolve(envelope({ items: [], next_cursor: null }))
      }
      if (
        path.endsWith(`/conversations/${conversationId}/attachments`) &&
        init?.method === "DELETE"
      ) {
        return clearResponse.promise
      }
      if (
        path.endsWith(`/conversations/${conversationId}/draft`) &&
        init?.method === "PUT"
      ) {
        draftWriteWhileClearPending ||= !clearCompleted
        const body = JSON.parse(String(init.body)) as Record<string, unknown>
        draftUpdates.push(body)
        return Promise.resolve(
          envelope({
            input_text: body.input_text,
            priority_capability_ids: body.priority_capability_ids,
            knowledge_base_ids: body.knowledge_base_ids,
            updated_at: "2026-08-13T00:00:01.000Z",
          })
        )
      }
      if (path.endsWith(`/conversations/${conversationId}`)) {
        return Promise.resolve(envelope(detail()))
      }
      return Promise.resolve(new Response(null, { status: 404 }))
    })
    vi.stubGlobal("fetch", fetchMock)
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })
    const interaction = userEvent.setup()

    render(
      <MemoryRouter initialEntries={[`/conversations/${conversationId}`]}>
        <QueryClientProvider client={queryClient}>
          <Routes>
            <Route
              path="/conversations/:conversationId"
              element={<ConversationPage />}
            />
          </Routes>
        </QueryClientProvider>
      </MemoryRouter>
    )

    expect(await screen.findByText("批量清理附件")).toBeVisible()
    const send = screen.getByRole("button", { name: "发送" })
    expect(send).toBeEnabled()
    expect(send).toHaveAttribute("aria-disabled", "false")
    await interaction.hover(
      screen.getByRole("button", { name: "查看全部 4 个附件" })
    )
    await interaction.click(
      await screen.findByRole("button", { name: "清除全部" })
    )

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.filter(([request, requestInit]) => {
          const path = new URL(String(request), window.location.origin).pathname
          return (
            path.endsWith(`/conversations/${conversationId}/attachments`) &&
            requestInit?.method === "DELETE"
          )
        })
      ).toHaveLength(1)
    )
    expect(screen.getByRole("button", { name: "发送" })).toBe(send)
    expect(send).toBeDisabled()
    expect(send).toHaveAttribute("aria-disabled", "true")
    await interaction.type(
      screen.getByRole("textbox", { name: "任务输入框" }),
      "清理完成后继续"
    )
    expect(screen.getByRole("button", { name: "发送" })).toBe(send)
    expect(send).toBeDisabled()
    await new Promise((resolve) => window.setTimeout(resolve, 650))
    expect(draftUpdates).toHaveLength(0)

    const clearCall = fetchMock.mock.calls.find(([request, requestInit]) => {
      const path = new URL(String(request), window.location.origin).pathname
      return (
        path.endsWith(`/conversations/${conversationId}/attachments`) &&
        requestInit?.method === "DELETE"
      )
    })
    expect(JSON.parse(String(clearCall?.[1]?.body))).toEqual({
      file_ids: attachments.map((file) => file.id),
    })

    clearCompleted = true
    await act(async () => {
      clearResponse.resolve(new Response(null, { status: 204 }))
      await clearResponse.promise
    })
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "查看全部 4 个附件" })
      ).not.toBeInTheDocument()
    )
    await waitFor(() => expect(draftUpdates).toHaveLength(1))
    expect(draftWriteWhileClearPending).toBe(false)
    expect(draftUpdates[0]).toMatchObject({
      input_text: "清理完成后继续",
    })
    const attachmentDeleteCalls = fetchMock.mock.calls.filter(
      ([request, requestInit]) => {
        const path = new URL(String(request), window.location.origin).pathname
        const attachmentPath = `/conversations/${conversationId}/attachments`
        return (
          (path.endsWith(attachmentPath) ||
            path.includes(`${attachmentPath}/`)) &&
          requestInit?.method === "DELETE"
        )
      }
    )
    expect(attachmentDeleteCalls).toHaveLength(1)
    expect(
      new URL(
        String(attachmentDeleteCalls[0]?.[0]),
        window.location.origin
      ).pathname.endsWith(`/conversations/${conversationId}/attachments`)
    ).toBe(true)
    expect(screen.queryByText(/当前状态与此操作冲突/)).not.toBeInTheDocument()
  })

  it("starts an application task from the Composer slash menu", async () => {
    const applicationId = "30000000-0000-4000-8000-000000000001"
    const conversationId = "30000000-0000-4000-8000-000000000002"
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const path = new URL(url, window.location.origin).pathname
      if (path.endsWith("/conversations/prewarm")) {
        return Promise.resolve(envelope({ accepted: true }))
      }
      if (path.endsWith("/model-preference")) {
        return Promise.resolve(envelope(modelPreference()))
      }
      if (path.endsWith("/capabilities")) {
        return Promise.resolve(envelope({ items: [], next_cursor: null }))
      }
      if (path.endsWith("/knowledge-bases/search-capability")) {
        return Promise.resolve(
          envelope({
            status: "available",
            reason_code: null,
            checked_at: "2026-07-30T00:00:00.000Z",
          })
        )
      }
      if (path.endsWith("/knowledge-bases")) {
        return Promise.resolve(envelope({ items: [], next_cursor: null }))
      }
      if (path.endsWith("/applications") && init?.method === "GET") {
        return Promise.resolve(
          envelope({
            items: [
              {
                id: applicationId,
                owner: {
                  id: "30000000-0000-4000-8000-000000000003",
                  name: "管理员",
                },
                name: "运营分析助手",
                icon: { type: "preset", preset: "sparkles" },
                description: "分析运营数据",
                instructions: "分析运营数据",
                model: null,
                reasoning_effort: null,
                status: "active",
                is_owner: false,
                can_manage: false,
                access_source: "direct",
                capability_count: 0,
                knowledge_base_count: 0,
                mcp_server_count: 0,
                dependencies_available: true,
                capabilities: [],
                knowledge_bases: [],
                mcp_servers: [],
                created_at: "2026-07-30T00:00:00.000Z",
                updated_at: "2026-07-30T00:00:00.000Z",
              },
            ],
            next_cursor: null,
          })
        )
      }
      if (
        path.endsWith(`/applications/${applicationId}/conversations`) &&
        init?.method === "POST"
      ) {
        return Promise.resolve(envelope({ conversation_id: conversationId }))
      }
      return Promise.resolve(new Response(null, { status: 404 }))
    })
    vi.stubGlobal("fetch", fetchMock)
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })
    const interaction = userEvent.setup()

    render(
      <MemoryRouter initialEntries={["/conversations/new"]}>
        <QueryClientProvider client={queryClient}>
          <Routes>
            <Route path="/conversations/new" element={<ConversationPage />} />
            <Route
              path="/conversations/:conversationId"
              element={<div>已进入应用任务</div>}
            />
          </Routes>
        </QueryClientProvider>
      </MemoryRouter>
    )

    const composer = await screen.findByRole("textbox", { name: "任务输入框" })
    await interaction.type(composer, "/")
    await interaction.click(screen.getByRole("option", { name: /应用列表/ }))
    await interaction.click(
      await screen.findByRole("option", { name: /运营分析助手/ })
    )

    expect(await screen.findByText("已进入应用任务")).toBeVisible()
    expect(
      fetchMock.mock.calls.some(
        ([request, requestInit]) =>
          String(request).endsWith(
            `/api/v1/applications/${applicationId}/conversations`
          ) && requestInit?.method === "POST"
      )
    ).toBe(true)
  })

  it("waits for an off-page selected knowledge base before sending its ordered id snapshot", async () => {
    const knowledgeBaseId = "10000000-0000-4000-8000-000000000001"
    const pagedKnowledgeBaseId = "10000000-0000-4000-8000-000000000009"
    const knowledgeBase = (id: string, name: string) => ({
      id,
      name,
      description: "保修和退换政策",
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
      created_at: "2026-07-22T00:00:00.000Z",
      updated_at: "2026-07-22T00:00:00.000Z",
    })
    const selectedKnowledgeBaseResponse = createDeferred<Response>()
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const path = new URL(url, window.location.origin).pathname
      if (url.includes("/events")) {
        return Promise.resolve(
          new Response("", {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          })
        )
      }
      if (url.endsWith("/api/v1/conversations/prewarm")) {
        return Promise.resolve(envelope({ accepted: true }))
      }
      if (path.endsWith("/model-preference")) {
        return Promise.resolve(envelope(modelPreference()))
      }
      if (url.includes("/api/v1/capabilities")) {
        return Promise.resolve(envelope({ items: [], next_cursor: null }))
      }
      if (path.endsWith(`/knowledge-bases/${knowledgeBaseId}`)) {
        return selectedKnowledgeBaseResponse.promise
      }
      if (path.endsWith("/knowledge-bases")) {
        return Promise.resolve(
          envelope({
            items: [knowledgeBase(pagedKnowledgeBaseId, "当前分页知识库")],
            next_cursor: "10000000-0000-4000-8000-000000000010",
          })
        )
      }
      if (
        url.endsWith("/api/v1/conversations/conversation-knowledge/turns") &&
        init?.method === "POST"
      ) {
        return Promise.resolve(
          envelope({
            turn_id: "40000000-0000-4000-8000-000000000001",
            accepted: true,
            status: "starting",
          })
        )
      }
      if (url.includes("/api/v1/conversations/conversation-knowledge")) {
        return Promise.resolve(
          envelope({
            id: "conversation-knowledge",
            title: "知识库问答",
            archived: false,
            updated_at: "2026-07-22T00:00:00.000Z",
            execution_status: "idle",
            selected_knowledge_base_ids: [knowledgeBaseId],
            draft: {
              input_text: "保修期多久？",
              priority_capability_ids: [],
              knowledge_base_ids: [knowledgeBaseId],
              updated_at: "2026-07-22T00:00:00.000Z",
            },
            messages: [],
            turns: [],
            pending_requests: [],
            attachments: [],
            artifacts: [],
          })
        )
      }
      return Promise.resolve(new Response(null, { status: 404 }))
    })
    vi.stubGlobal("fetch", fetchMock)
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })
    const interaction = userEvent.setup()

    render(
      <MemoryRouter initialEntries={["/conversations/conversation-knowledge"]}>
        <QueryClientProvider client={queryClient}>
          <Routes>
            <Route
              path="/conversations/:conversationId"
              element={<ConversationPage />}
            />
          </Routes>
        </QueryClientProvider>
      </MemoryRouter>
    )

    const composer = await screen.findByRole("textbox", { name: "任务输入框" })
    await waitFor(() => expect(composer).toHaveValue("保修期多久？"))
    const sendButton = screen.getByRole("button", { name: "发送" })
    await waitFor(() => expect(sendButton).toBeDisabled())

    await interaction.click(sendButton)
    await interaction.click(composer)
    await interaction.keyboard("{Enter}")
    expect(
      fetchMock.mock.calls.filter(
        ([input, init]) =>
          String(input).endsWith(
            "/api/v1/conversations/conversation-knowledge/turns"
          ) && init?.method === "POST"
      )
    ).toHaveLength(0)

    selectedKnowledgeBaseResponse.resolve(
      envelope(knowledgeBase(knowledgeBaseId, "售后知识库"))
    )
    expect(
      await screen.findByRole("button", { name: "移除知识库 售后知识库" })
    ).toBeVisible()
    await waitFor(() => expect(sendButton).toBeEnabled())
    await interaction.click(sendButton)

    await waitFor(() => {
      const turnCall = fetchMock.mock.calls.find(
        ([input, init]) =>
          String(input).endsWith(
            "/api/v1/conversations/conversation-knowledge/turns"
          ) && init?.method === "POST"
      )
      expect(turnCall).toBeDefined()
      expect(JSON.parse(String(turnCall?.[1]?.body))).toMatchObject({
        input_text: "保修期多久？",
        priority_capability_ids: [],
        knowledge_base_ids: [knowledgeBaseId],
      })
    })
    expect(
      screen.getByRole("button", { name: "移除知识库 售后知识库" })
    ).toBeVisible()
  })

  it("keeps a successfully verified selection when the knowledge-base list fails", async () => {
    const knowledgeBaseId = "12000000-0000-4000-8000-000000000001"
    const knowledgeBase = activeKnowledgeBase(knowledgeBaseId, "售后知识库")
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const path = new URL(url, window.location.origin).pathname
      if (url.includes("/events")) {
        return Promise.resolve(
          new Response("", {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          })
        )
      }
      if (path.endsWith("/conversations/prewarm")) {
        return Promise.resolve(envelope({ accepted: true }))
      }
      if (path.endsWith("/model-preference")) {
        return Promise.resolve(envelope(modelPreference()))
      }
      if (path.endsWith("/capabilities")) {
        return Promise.resolve(envelope({ items: [], next_cursor: null }))
      }
      if (path.endsWith("/knowledge-bases/search-capability")) {
        return Promise.resolve(
          envelope({
            status: "available",
            reason_code: null,
            checked_at: "2026-07-22T00:00:00.000Z",
          })
        )
      }
      if (path.endsWith(`/knowledge-bases/${knowledgeBaseId}`)) {
        return Promise.resolve(envelope(knowledgeBase))
      }
      if (path.endsWith("/knowledge-bases")) {
        return Promise.resolve(
          errorEnvelope(503, "KNOWLEDGE_BASE_LIST_UNAVAILABLE")
        )
      }
      if (
        path.endsWith("/conversations/conversation-list-failure/draft") &&
        init?.method === "PUT"
      ) {
        const body = JSON.parse(String(init.body)) as {
          input_text: string
          priority_capability_ids: string[]
          knowledge_base_ids: string[]
        }
        return Promise.resolve(
          envelope({
            ...body,
            updated_at: "2026-07-22T00:00:01.000Z",
          })
        )
      }
      if (
        path.endsWith("/conversations/conversation-list-failure/turns") &&
        init?.method === "POST"
      ) {
        return Promise.resolve(
          envelope({
            turn_id: "42000000-0000-4000-8000-000000000001",
            accepted: true,
            status: "starting",
          })
        )
      }
      if (path.endsWith("/conversations/conversation-list-failure")) {
        return Promise.resolve(
          envelope({
            id: "conversation-list-failure",
            title: "知识库列表故障",
            archived: false,
            updated_at: "2026-07-22T00:00:00.000Z",
            execution_status: "idle",
            selected_knowledge_base_ids: [knowledgeBaseId],
            draft: {
              input_text: "保修期多久？",
              priority_capability_ids: [],
              knowledge_base_ids: [knowledgeBaseId],
              updated_at: "2026-07-22T00:00:00.000Z",
            },
            messages: [],
            turns: [],
            pending_requests: [],
            attachments: [],
            artifacts: [],
          })
        )
      }
      return Promise.resolve(new Response(null, { status: 404 }))
    })
    vi.stubGlobal("fetch", fetchMock)
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })
    const interaction = userEvent.setup()

    render(
      <MemoryRouter
        initialEntries={["/conversations/conversation-list-failure"]}
      >
        <QueryClientProvider client={queryClient}>
          <Routes>
            <Route
              path="/conversations/:conversationId"
              element={<ConversationPage />}
            />
          </Routes>
        </QueryClientProvider>
      </MemoryRouter>
    )

    const selectedChip = await screen.findByRole("button", {
      name: "移除知识库 售后知识库",
    })
    expect(selectedChip.closest(".knowledge-base-chip")).not.toHaveAttribute(
      "data-unavailable"
    )
    const sendButton = screen.getByRole("button", { name: "发送" })
    await waitFor(() => expect(sendButton).toBeEnabled())
    await interaction.click(sendButton)

    await waitFor(() => {
      const turnCall = fetchMock.mock.calls.find(
        ([request, requestInit]) =>
          String(request).endsWith(
            "/api/v1/conversations/conversation-list-failure/turns"
          ) && requestInit?.method === "POST"
      )
      expect(turnCall).toBeDefined()
      expect(JSON.parse(String(turnCall?.[1]?.body))).toMatchObject({
        input_text: "保修期多久？",
        knowledge_base_ids: [knowledgeBaseId],
      })
    })
  })

  it.each([
    {
      name: "只提交仍然可用的交集",
      includeActive: true,
      expectedKnowledgeBaseIds: ["11000000-0000-4000-8000-000000000001"],
    },
    {
      name: "有效交集为空时仍正常提交",
      includeActive: false,
      expectedKnowledgeBaseIds: [] as string[],
    },
  ])("$name", async ({ includeActive, expectedKnowledgeBaseIds }) => {
    const activeId = "11000000-0000-4000-8000-000000000001"
    const archivedId = "11000000-0000-4000-8000-000000000002"
    const disabledId = "11000000-0000-4000-8000-000000000003"
    const revokedId = "11000000-0000-4000-8000-000000000004"
    const selectedIds = [
      ...(includeActive ? [activeId] : []),
      archivedId,
      disabledId,
      revokedId,
    ]
    const knowledgeBase = (
      id: string,
      name: string,
      overrides: Record<string, unknown> = {}
    ) => ({
      id,
      name,
      description: null,
      lifecycle_status: "active",
      availability_status: "enabled",
      owner: {
        id: "11000000-0000-4000-8000-000000000010",
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
      created_at: "2026-07-22T00:00:00.000Z",
      updated_at: "2026-07-22T00:00:00.000Z",
      ...overrides,
    })
    const active = knowledgeBase(activeId, "有效知识库")
    const archived = knowledgeBase(archivedId, "已归档库", {
      lifecycle_status: "archived",
      archived_at: "2026-07-22T01:00:00.000Z",
    })
    const disabled = knowledgeBase(disabledId, "已停用库", {
      availability_status: "disabled",
      disabled_reason: "治理停用",
    })
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const path = new URL(url, window.location.origin).pathname
      if (url.includes("/events")) {
        return Promise.resolve(
          new Response("", {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          })
        )
      }
      if (path.endsWith("/conversations/prewarm")) {
        return Promise.resolve(envelope({ accepted: true }))
      }
      if (path.endsWith("/model-preference")) {
        return Promise.resolve(envelope(modelPreference()))
      }
      if (path.endsWith("/capabilities")) {
        return Promise.resolve(envelope({ items: [], next_cursor: null }))
      }
      if (path.endsWith("/knowledge-bases/search-capability")) {
        return Promise.resolve(
          envelope({
            status: "available",
            reason_code: null,
            checked_at: "2026-07-22T00:00:00.000Z",
          })
        )
      }
      if (path.endsWith(`/knowledge-bases/${archivedId}`)) {
        return Promise.resolve(envelope(archived))
      }
      if (path.endsWith(`/knowledge-bases/${disabledId}`)) {
        return Promise.resolve(envelope(disabled))
      }
      if (path.endsWith(`/knowledge-bases/${revokedId}`)) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              success: false,
              error: {
                code: "KNOWLEDGE_BASE_ACCESS_DENIED",
                message: "Forbidden",
              },
            }),
            {
              status: 403,
              headers: { "content-type": "application/json" },
            }
          )
        )
      }
      if (path.endsWith("/knowledge-bases")) {
        return Promise.resolve(envelope({ items: [active], next_cursor: null }))
      }
      if (
        path.endsWith("/conversations/conversation-valid-intersection/draft") &&
        init?.method === "PUT"
      ) {
        const body = JSON.parse(String(init.body)) as {
          input_text: string
          priority_capability_ids: string[]
          knowledge_base_ids: string[]
        }
        return Promise.resolve(
          envelope({
            ...body,
            updated_at: "2026-07-22T00:00:01.000Z",
          })
        )
      }
      if (
        path.endsWith("/conversations/conversation-valid-intersection/turns") &&
        init?.method === "POST"
      ) {
        return Promise.resolve(
          envelope({
            turn_id: "41000000-0000-4000-8000-000000000001",
            accepted: true,
            status: "starting",
          })
        )
      }
      if (path.endsWith("/conversations/conversation-valid-intersection")) {
        return Promise.resolve(
          envelope({
            id: "conversation-valid-intersection",
            title: "权限变化测试",
            archived: false,
            updated_at: "2026-07-22T00:00:00.000Z",
            execution_status: "idle",
            selected_knowledge_base_ids: selectedIds,
            draft: {
              input_text: "查询当前可用资料",
              priority_capability_ids: [],
              knowledge_base_ids: selectedIds,
              updated_at: "2026-07-22T00:00:00.000Z",
            },
            messages: [],
            turns: [],
            pending_requests: [],
            attachments: [],
            artifacts: [],
          })
        )
      }
      return Promise.resolve(new Response(null, { status: 404 }))
    })
    vi.stubGlobal("fetch", fetchMock)
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })
    const interaction = userEvent.setup()

    render(
      <MemoryRouter
        initialEntries={["/conversations/conversation-valid-intersection"]}
      >
        <QueryClientProvider client={queryClient}>
          <Routes>
            <Route
              path="/conversations/:conversationId"
              element={<ConversationPage />}
            />
          </Routes>
        </QueryClientProvider>
      </MemoryRouter>
    )

    expect(
      await screen.findByRole("button", { name: "移除知识库 已归档库" })
    ).toBeVisible()
    expect(
      screen
        .getByRole("button", { name: "移除知识库 已归档库" })
        .closest(".knowledge-base-chip")
    ).toHaveTextContent("已归档库 · 知识库已不可用")
    expect(
      screen
        .getByRole("button", { name: "移除知识库 已停用库" })
        .closest(".knowledge-base-chip")
    ).toHaveTextContent("已停用库 · 知识库已不可用")

    await interaction.click(screen.getByRole("button", { name: "发送" }))

    await waitFor(() => {
      const turnCall = fetchMock.mock.calls.find(
        ([request, requestInit]) =>
          String(request).endsWith(
            "/api/v1/conversations/conversation-valid-intersection/turns"
          ) && requestInit?.method === "POST"
      )
      expect(turnCall).toBeDefined()
      expect(JSON.parse(String(turnCall?.[1]?.body))).toMatchObject({
        input_text: "查询当前可用资料",
        knowledge_base_ids: expectedKnowledgeBaseIds,
      })
    })
  })

  it.each([
    {
      name: "创建者",
      isOwner: true,
      accessSource: "owner",
      expectedLabel: "AISG Policy",
      model: "model-a",
    },
    {
      name: "组织内共享用户",
      isOwner: false,
      accessSource: "direct",
      expectedLabel: "应用托管知识库",
      model: "model-a",
    },
    {
      name: "未固定模型的应用用户",
      isOwner: true,
      accessSource: "owner",
      expectedLabel: "AISG Policy",
      model: null,
    },
  ])(
    "为$name正确显示应用会话的知识库标识",
    async ({ isOwner, accessSource, expectedLabel, model }) => {
      const interaction = userEvent.setup()
      const applicationId = "50000000-0000-4000-8000-000000000001"
      const knowledgeBaseId = "50000000-0000-4000-8000-000000000002"
      const conversationId = "conversation-application-knowledge"
      const fetchMock = vi.fn((input: RequestInfo | URL) => {
        const url = String(input)
        const path = new URL(url, window.location.origin).pathname
        if (url.includes("/events")) {
          return Promise.resolve(
            new Response("", {
              status: 200,
              headers: { "content-type": "text/event-stream" },
            })
          )
        }
        if (path.endsWith("/conversations/prewarm")) {
          return Promise.resolve(envelope({ accepted: true }))
        }
        if (
          path.endsWith(`/conversations/${conversationId}/model-preference`)
        ) {
          return Promise.resolve(envelope(modelPreference()))
        }
        if (path.endsWith(`/applications/${applicationId}`)) {
          return Promise.resolve(
            envelope({
              id: applicationId,
              owner: {
                id: "50000000-0000-4000-8000-000000000003",
                name: "应用创建者",
              },
              name: "AISG学校政策问答助手",
              icon: { type: "preset", preset: "bot" },
              description: null,
              instructions: isOwner ? "仅根据应用知识库回答。" : null,
              model,
              reasoning_effort: model === null ? null : "medium",
              status: "active",
              is_owner: isOwner,
              can_manage: isOwner,
              access_source: accessSource,
              capability_count: 0,
              knowledge_base_count: 1,
              mcp_server_count: 0,
              dependencies_available: true,
              capabilities: [],
              knowledge_bases: isOwner
                ? [
                    {
                      id: knowledgeBaseId,
                      name: "AISG Policy",
                      lifecycle_status: "active",
                      availability_status: "enabled",
                      available: true,
                      updated_at: "2026-07-28T00:00:00.000Z",
                    },
                  ]
                : [],
              mcp_servers: [],
              created_at: "2026-07-28T00:00:00.000Z",
              updated_at: "2026-07-28T00:00:00.000Z",
            })
          )
        }
        if (path.endsWith(`/conversations/${conversationId}`)) {
          return Promise.resolve(
            envelope({
              id: conversationId,
              title: "应用知识库问答",
              archived: false,
              updated_at: "2026-07-28T00:00:00.000Z",
              execution_status: "completed",
              application: {
                id: applicationId,
                name: "AISG学校政策问答助手",
              },
              selected_knowledge_base_ids: [],
              draft: {
                input_text: "",
                priority_capability_ids: [],
                knowledge_base_ids: [],
                updated_at: "2026-07-28T00:00:00.000Z",
              },
              messages: [
                {
                  id: "application-message-user",
                  role: "user",
                  turn_id: "application-turn",
                  content: "如何修改 O365 密码？",
                  selected_knowledge_base_ids: [knowledgeBaseId],
                  application: {
                    id: applicationId,
                    name: "AISG学校政策问答助手",
                  },
                  created_at: "2026-07-28T00:00:00.000Z",
                },
                {
                  id: "application-message-assistant",
                  role: "assistant",
                  turn_id: "application-turn",
                  content: "请按照学校政策页面中的步骤操作。",
                  created_at: "2026-07-28T00:00:01.000Z",
                },
              ],
              turns: [
                {
                  id: "application-turn",
                  status: "completed",
                  started_at: "2026-07-28T00:00:00.000Z",
                  completed_at: "2026-07-28T00:00:01.000Z",
                },
              ],
              pending_requests: [],
              attachments: [],
              artifacts: [],
            })
          )
        }
        return Promise.resolve(new Response(null, { status: 404 }))
      })
      vi.stubGlobal("fetch", fetchMock)
      const queryClient = new QueryClient({
        defaultOptions: {
          queries: { retry: false },
          mutations: { retry: false },
        },
      })

      render(
        <MemoryRouter initialEntries={[`/conversations/${conversationId}`]}>
          <QueryClientProvider client={queryClient}>
            <Routes>
              <Route
                path="/conversations/:conversationId"
                element={
                  <ConversationPage
                    headerActions={
                      <button type="button" aria-label="隐藏聊天" />
                    }
                  />
                }
              />
            </Routes>
          </QueryClientProvider>
        </MemoryRouter>
      )

      expect(await screen.findByText(expectedLabel)).toBeVisible()
      const managedLabel = "此任务由应用“AISG学校政策问答助手”管理"
      expect(screen.queryByText(managedLabel)).toBeNull()
      const managedInfoButton = screen.getByRole("button", {
        name: managedLabel,
      })
      const taskTitle = screen.getByRole("heading", {
        name: "应用知识库问答",
      })
      const hideChatButton = screen.getByRole("button", { name: "隐藏聊天" })
      const taskOverviewButton = screen.getByRole("button", {
        name: /^(打开|关闭)任务概览$/u,
      })
      expect(
        taskOverviewButton.compareDocumentPosition(hideChatButton) &
          Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy()
      const titleActions = taskTitle.closest(".conversation-title-actions")
      const applicationIcon = titleActions?.querySelector(
        ".conversation-title-application-icon"
      )

      expect(managedInfoButton).toHaveClass(
        "conversation-application-info-trigger"
      )
      expect(managedInfoButton.closest(".conversation-title-actions")).toBe(
        titleActions
      )
      expect(applicationIcon).not.toBeNull()
      if (!applicationIcon) {
        throw new Error("Expected the application logo before the task title")
      }
      expect(applicationIcon.querySelector("svg")).toBeInTheDocument()
      expect(
        applicationIcon.compareDocumentPosition(taskTitle) &
          Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy()
      expect(
        taskTitle.compareDocumentPosition(managedInfoButton) &
          Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy()
      expect(document.querySelector(".conversation-application-notice")).toBe(
        null
      )

      await interaction.hover(managedInfoButton)

      const managedTitle = await screen.findByText(managedLabel)
      const managedCard = managedTitle.closest(
        ".conversation-application-info-card"
      )
      expect(managedTitle).toHaveClass("conversation-application-info-title")
      expect(managedCard).not.toBeNull()
      expect(managedCard).toHaveTextContent(managedLabel)
      expect(managedCard).toHaveTextContent(
        model === null
          ? "插件、Skill、知识库和指令"
          : "模型、插件、Skill 和知识库由应用创建者维护"
      )
      expect(managedCard?.closest(".conversation-top-bar")).toBeNull()
      expect(document.querySelector(".conversation-top-notice")).toBeNull()
      expect(screen.queryByText("知识库已不可用")).toBeNull()
      expect(
        fetchMock.mock.calls.some(([request]) =>
          String(request).endsWith(`/api/v1/applications/${applicationId}`)
        )
      ).toBe(true)
      if (!isOwner) {
        expect(screen.queryByText("AISG Policy")).toBeNull()
      }
      if (model === null) {
        await waitFor(() =>
          expect(
            fetchMock.mock.calls.some(([request]) =>
              String(request).endsWith(
                `/api/v1/conversations/${conversationId}/model-preference`
              )
            )
          ).toBe(true)
        )
        expect(
          await screen.findByRole("button", { name: "选择模型与推理强度" })
        ).toBeVisible()
      } else {
        expect(
          screen.queryByRole("button", { name: "选择模型与推理强度" })
        ).toBeNull()
      }
    }
  )
})
