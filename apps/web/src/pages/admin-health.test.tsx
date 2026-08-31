import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { MemoryRouter } from "react-router-dom"

import { setAccessToken } from "@/api/session"
import i18n, { type SupportedLanguage } from "@/i18n"
import { AdminPages } from "@/pages/admin-pages"

const checkedAt = "2026-07-11T08:43:00.000Z"
const healthStatus = {
  status: "unavailable",
  overall_status: "unavailable",
  readiness: "unready",
  checked_at: checkedAt,
  running_turn_count: 1,
  app_server_process_count: 2,
  concurrency_limit: 5,
  docker_resource_usage: {
    status: "available",
    checked_at: checkedAt,
    reason_code: null,
    services: [
      {
        key: "api",
        service_type: "compose",
        status: "available",
        container_count: 2,
        running_container_count: 2,
        cpu_percent: 12.5,
        memory_used_bytes: 256 * 1024 * 1024,
        memory_limit_bytes: 1024 * 1024 * 1024,
        memory_percent: 25,
        pids: 42,
        state: "running",
      },
      {
        key: "worker_pool",
        service_type: "worker_pool",
        status: "not_observed",
        container_count: 0,
        running_container_count: 0,
        cpu_percent: null,
        memory_used_bytes: null,
        memory_limit_bytes: null,
        memory_percent: null,
        pids: null,
        state: null,
      },
    ],
  },
  components: {
    api: { status: "available", checked_at: checkedAt, reason_code: null },
    database: { status: "available", checked_at: checkedAt, reason_code: null },
    running_turn_capacity: {
      status: "available",
      checked_at: checkedAt,
      reason_code: null,
    },
    running_turn_recovery: {
      status: "not_observed",
      checked_at: checkedAt,
      reason_code: "RUNNING_TURN_RECOVERY_NOT_OBSERVED",
    },
    runner: { status: "available", checked_at: checkedAt, reason_code: null },
    workspace: {
      status: "available",
      checked_at: checkedAt,
      reason_code: null,
    },
    document_parsing: {
      status: "available",
      checked_at: checkedAt,
      reason_code: null,
    },
    knowledge_search_and_indexing: {
      status: "available",
      checked_at: checkedAt,
      reason_code: null,
    },
    rerank: {
      status: "unavailable",
      checked_at: checkedAt,
      reason_code: "RERANK_UNAVAILABLE",
    },
    minio: {
      status: "unavailable",
      checked_at: checkedAt,
      reason_code: "MINIO_UNAVAILABLE",
    },
    codex_app_server: {
      status: "available",
      checked_at: checkedAt,
      reason_code: null,
    },
    codex_home: {
      status: "available",
      checked_at: checkedAt,
      reason_code: null,
    },
    codex_home_root: {
      status: "available",
      checked_at: checkedAt,
      reason_code: null,
    },
  },
}

function renderHealth() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <AdminPages page="health" />
      </QueryClientProvider>
    </MemoryRouter>
  )
}

function envelope(data: unknown) {
  return new Response(JSON.stringify({ success: true, data }), {
    status: 200,
    headers: { "content-type": "application/json" },
  })
}

describe("administrator health page", () => {
  beforeEach(() => {
    setAccessToken("health-access-token")
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const path = new URL(String(input), window.location.origin).pathname
        return Promise.resolve(
          envelope(
            path.endsWith("/admin/knowledge-maintenance/rebuild-all")
              ? null
              : healthStatus
          )
        )
      })
    )
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it.each([
    {
      language: "zh-CN",
      title: "系统健康状态",
      description: "只读查看 LinkSense 服务与受控目录的健康摘要。",
      overall: "总体状态",
      unavailable: "不可用",
      componentHealthy: "正常",
      resourceAvailable: "已观测",
      api: "API 服务",
      database: "数据库",
      runner: "Runner",
      workspace: "工作区根目录",
      capacity: "运行中 turn 容量",
      recovery: "运行中 turn 恢复",
      notObserved: "尚未观测",
      processes: "app-server 子进程",
      parsing: "知识库文档解析",
      search: "知识库检索与索引",
      rerank: "知识库检索结果重排",
      rerankReason: "检索结果重排不可用，请检查重排模型配置和服务状态。",
      resources: "服务资源占用",
      apiResource: "API 容器",
      workerResource: "Runner worker 池",
      cpuValue: "13%",
      memoryValue: "256 MB / 1 GB",
      containers: "2 / 2 个容器运行中",
      refresh: "刷新",
      hidden: ["MinIO", "Codex app-server", "CODEX_HOME 根目录"],
    },
    {
      language: "en-US",
      title: "System health",
      description:
        "Read-only summary of LinkSense services and managed directories.",
      overall: "Overall status",
      unavailable: "Unavailable",
      componentHealthy: "Healthy",
      resourceAvailable: "Observed",
      api: "API service",
      database: "Database",
      runner: "Runner",
      workspace: "Workspace root",
      capacity: "Running-turn capacity",
      recovery: "Running-turn recovery",
      notObserved: "Not observed",
      processes: "app-server processes",
      parsing: "Knowledge document parsing",
      search: "Knowledge search and indexing",
      rerank: "Knowledge result reranking",
      rerankReason:
        "Result reranking is unavailable. Check the reranking model configuration and service.",
      resources: "Service resource usage",
      apiResource: "API container",
      workerResource: "Runner worker pool",
      cpuValue: "13%",
      memoryValue: "256 MB / 1 GB",
      containers: "2 / 2 containers running",
      refresh: "Refresh",
      hidden: ["MinIO", "Codex app-server", "CODEX_HOME root"],
    },
  ] satisfies Array<{
    language: SupportedLanguage
    title: string
    description: string
    overall: string
    unavailable: string
    componentHealthy: string
    resourceAvailable: string
    api: string
    database: string
    runner: string
    workspace: string
    capacity: string
    recovery: string
    notObserved: string
    processes: string
    parsing: string
    search: string
    rerank: string
    rerankReason: string
    resources: string
    apiResource: string
    workerResource: string
    cpuValue: string
    memoryValue: string
    containers: string
    refresh: string
    hidden: string[]
  }>)(
    "hides internal infrastructure rows in $language while preserving the backend overall status",
    async ({
      language,
      title,
      description,
      overall,
      unavailable,
      componentHealthy,
      resourceAvailable,
      api,
      database,
      runner,
      workspace,
      capacity,
      recovery,
      notObserved,
      processes,
      parsing,
      search,
      rerank,
      rerankReason,
      resources,
      apiResource,
      workerResource,
      cpuValue,
      memoryValue,
      containers,
      refresh,
      hidden,
    }) => {
      await i18n.changeLanguage(language)
      renderHealth()

      expect(await screen.findByRole("heading", { name: title })).toBeVisible()
      expect(screen.getByRole("banner").closest(".health-page")).not.toBeNull()
      expect(screen.getByText(description)).toBeVisible()
      const refreshButton = screen.getByRole("button", { name: refresh })
      expect(refreshButton).toHaveClass("size-7")
      expect(refreshButton).not.toHaveClass("bg-secondary")
      expect(refreshButton).not.toHaveTextContent(refresh)
      expect(refreshButton.querySelector("svg")).toBeInTheDocument()
      const apiHeading = await screen.findByRole("heading", { name: api })
      expect(apiHeading).toBeVisible()
      expect(
        within(apiHeading.parentElement!).getByText(componentHealthy)
      ).toBeVisible()
      expect(screen.getByRole("heading", { name: database })).toBeVisible()
      expect(screen.getByRole("heading", { name: runner })).toBeVisible()
      expect(screen.getByRole("heading", { name: workspace })).toBeVisible()
      expect(screen.getByRole("heading", { name: capacity })).toBeVisible()
      expect(screen.getByRole("heading", { name: recovery })).toBeVisible()
      const notObservedBadges = screen.getAllByText(notObserved)
      expect(notObservedBadges.length).toBeGreaterThan(0)
      expect(notObservedBadges[0]!).toBeVisible()
      expect(screen.getByText(processes)).toBeVisible()
      expect(screen.getByRole("heading", { name: parsing })).toBeVisible()
      expect(screen.getByRole("heading", { name: search })).toBeVisible()
      expect(screen.getByRole("heading", { name: rerank })).toBeVisible()
      expect(screen.getByText(rerankReason)).toBeVisible()
      const resourceHeading = screen.getByRole("heading", { name: resources })
      expect(resourceHeading).toBeVisible()
      expect(
        within(resourceHeading.parentElement!).getByText(resourceAvailable)
      ).toBeVisible()
      expect(screen.getByRole("heading", { name: apiResource })).toBeVisible()
      expect(
        screen.getByRole("heading", { name: workerResource })
      ).toBeVisible()
      expect(screen.getByText(cpuValue)).toBeVisible()
      expect(screen.getByText(memoryValue)).toBeVisible()
      expect(screen.getByText(containers)).toBeVisible()
      expect(
        within(screen.getByLabelText(overall)).getByText(unavailable)
      ).toBeVisible()

      for (const hiddenLabel of hidden) {
        expect(
          screen.queryByText(hiddenLabel, { selector: "h2", exact: true })
        ).not.toBeInTheDocument()
      }
    }
  )

  it("marks docker resource meters with usage pressure levels", async () => {
    await i18n.changeLanguage("zh-CN")
    const [observedService, unobservedService] =
      healthStatus.docker_resource_usage.services
    if (!observedService || !unobservedService) {
      throw new Error("Expected docker resource fixtures")
    }
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          envelope({
            ...healthStatus,
            docker_resource_usage: {
              ...healthStatus.docker_resource_usage,
              services: [
                {
                  ...observedService,
                  key: "api",
                  cpu_percent: 12.5,
                },
                {
                  ...observedService,
                  key: "runner",
                  cpu_percent: 65,
                },
                {
                  ...observedService,
                  key: "web",
                  cpu_percent: 88,
                },
                unobservedService,
              ],
            },
          })
        )
      )
    )

    renderHealth()

    expect(await screen.findByLabelText("CPU 13%")).toHaveAttribute(
      "data-usage-level",
      "low"
    )
    expect(screen.getByLabelText("CPU 65%")).toHaveAttribute(
      "data-usage-level",
      "medium"
    )
    expect(screen.getByLabelText("CPU 88%")).toHaveAttribute(
      "data-usage-level",
      "high"
    )
    expect(screen.getByLabelText("CPU —")).toHaveAttribute(
      "data-usage-level",
      "unknown"
    )
  })

  it.each([
    {
      language: "zh-CN" as const,
      title: "访问连接安全",
      message:
        "当前使用 HTTP，登录信息、任务内容和文件在传输过程中不会被加密。核心功能可以继续使用；通过公网访问前请配置 HTTPS。",
    },
    {
      language: "en-US" as const,
      title: "Connection security",
      message:
        "This site is using HTTP, so sign-in details, conversations, and files are not encrypted in transit. Core features remain available; configure HTTPS before exposing it to the internet.",
    },
  ])(
    "shows the HTTP transport warning in $language",
    async ({ language, title, message }) => {
      await i18n.changeLanguage(language)
      vi.stubGlobal(
        "fetch",
        vi.fn(() =>
          Promise.resolve(
            envelope({
              ...healthStatus,
              components: {
                ...healthStatus.components,
                public_url: {
                  status: "warning",
                  checked_at: checkedAt,
                  reason_code: "PUBLIC_URL_INSECURE",
                },
              },
            })
          )
        )
      )

      renderHealth()

      expect(await screen.findByRole("heading", { name: title })).toBeVisible()
      expect(screen.getByText(message)).toBeVisible()
      expect(
        screen.getByText(language === "zh-CN" ? "警告" : "Warning")
      ).toBeVisible()
    }
  )

  it.each([
    {
      language: "zh-CN" as const,
      message:
        "嵌入模型输出维度与 Elasticsearch 向量索引维度不匹配，请修正配置并手动重建向量索引。",
    },
    {
      language: "en-US" as const,
      message:
        "The embedding output dimension does not match the Elasticsearch vector-index dimension. Correct the configuration and manually rebuild the vector index.",
    },
  ])(
    "shows the explicit embedding dimension mismatch reason in $language",
    async ({ language, message }) => {
      await i18n.changeLanguage(language)
      vi.stubGlobal(
        "fetch",
        vi.fn(() =>
          Promise.resolve(
            envelope({
              ...healthStatus,
              components: {
                ...healthStatus.components,
                knowledge_search_and_indexing: {
                  status: "unavailable",
                  checked_at: checkedAt,
                  reason_code: "EMBEDDING_DIMENSION_MISMATCH",
                  summary: "Generic dependency failure",
                },
              },
            })
          )
        )
      )

      renderHealth()

      expect(await screen.findByText(message)).toBeVisible()
      expect(
        screen.queryByText("Generic dependency failure")
      ).not.toBeInTheDocument()
    }
  )

  it("requires a reason and confirms the fixed deployment-wide rebuild scope", async () => {
    await i18n.changeLanguage("zh-CN")
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input), window.location.origin).pathname
      if (path.endsWith("/admin/knowledge-maintenance/rebuild-all")) {
        return Promise.resolve(
          envelope(
            init?.method === "POST"
              ? {
                  id: "rebuild-all-1",
                  status: "pending",
                  current_stage: "queued",
                  total_count: 0,
                  succeeded_count: 0,
                  failed_count: 0,
                  stable_error_code: null,
                }
              : null
          )
        )
      }
      return Promise.resolve(envelope(healthStatus))
    })
    vi.stubGlobal("fetch", fetchMock)
    const interaction = userEvent.setup()
    renderHealth()

    await interaction.click(
      await screen.findByRole("button", { name: "发起全量重建" })
    )
    expect(
      screen.getByText(/固定覆盖全部未删除文档，包括已归档知识库/)
    ).toBeVisible()
    expect(
      screen.getByText(/不会删除原始文件、Docling 解析结果或解析内容/)
    ).toBeVisible()

    const confirm = screen.getByRole("button", {
      name: "确认并开始重建",
    })
    expect(confirm).toBeDisabled()
    await interaction.type(screen.getByLabelText("操作原因"), "嵌入模型已更换")
    expect(confirm).toBeEnabled()
    await interaction.click(confirm)

    const request = fetchMock.mock.calls.find(([input, init]) => {
      const path = new URL(String(input), window.location.origin).pathname
      return (
        path.endsWith("/admin/knowledge-maintenance/rebuild-all") &&
        init?.method === "POST"
      )
    })
    expect(request).toBeDefined()
    expect(JSON.parse(String(request?.[1]?.body))).toEqual({
      reason: "嵌入模型已更换",
      confirmed: true,
    })
  })

  it("shows cleanup stage details and confirms a bounded bulk retry", async () => {
    await i18n.changeLanguage("zh-CN")
    const failedHealth = {
      ...healthStatus,
      cleanup_failure_summary: { total: 1, requires_attention: true },
      cleanup_failures: [
        {
          id: "database-runtime-01900000-0000-7000-8000-000000000099",
          conversation_id: "01900000-0000-7000-8000-000000000001",
          resource_type: "workspace",
          status: "failed",
          cleanup_stage: "stop_runtime",
          failed_at: checkedAt,
          reason_code: "CLEANUP_RUNTIME_ACTIVE",
          attempts_made: 8,
          max_attempts: 8,
        },
      ],
    }
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      void init
      const path = new URL(String(input), window.location.origin).pathname
      if (path.endsWith("/admin/health/cleanup/retry-all")) {
        return Promise.resolve(
          envelope({
            code: "CLEANUP_BULK_RETRY_REQUESTED",
            requested_count: 1,
            rejected_count: 0,
          })
        )
      }
      return Promise.resolve(
        envelope(
          path.endsWith("/admin/knowledge-maintenance/rebuild-all")
            ? null
            : failedHealth
        )
      )
    })
    vi.stubGlobal("fetch", fetchMock)
    const interaction = userEvent.setup()
    renderHealth()

    expect(await screen.findByText("已尝试 8 / 8 次")).toBeVisible()
    expect(
      screen.getByText(
        (_, element) =>
          element?.tagName === "P" &&
          element.textContent ===
            "正在安全结束目标任务运行 · 目标任务仍在运行，已保护其资源"
      )
    ).toBeVisible()
    await interaction.click(screen.getByRole("button", { name: "全部重试" }))
    expect(screen.getByText(/正在使用的目标任务会自动延后/)).toBeVisible()
    await interaction.click(screen.getByRole("button", { name: "全部重试" }))

    const request = fetchMock.mock.calls.find(([input, init]) => {
      const path = new URL(String(input), window.location.origin).pathname
      return (
        path.endsWith("/admin/health/cleanup/retry-all") &&
        init?.method === "POST"
      )
    })
    expect(request).toBeDefined()
    expect(JSON.parse(String(request?.[1]?.body))).toEqual({ confirmed: true })
  })
})
