import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import dayjs from "dayjs"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { MemoryRouter } from "react-router-dom"

import { setAccessToken } from "@/api/session"
import { TooltipProvider } from "@/components/ui/tooltip"
import appStyles from "@/index.css?raw"
import { AdminPages } from "@/pages/admin-pages"
import i18n from "@/i18n"

function envelope(data: unknown) {
  return new Response(JSON.stringify({ success: true, data }), {
    status: 200,
    headers: { "content-type": "application/json" },
  })
}

function renderAudit() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <AdminPages page="audit" />
        </TooltipProvider>
      </QueryClientProvider>
    </MemoryRouter>
  )
}

async function chooseDate(
  interaction: ReturnType<typeof userEvent.setup>,
  label: string,
  value: string
) {
  await interaction.click(screen.getByLabelText(label))
  await waitFor(() =>
    expect(document.querySelector("button[data-day]")).not.toBeNull()
  )
  const targetTimestamp = dayjs(value).valueOf()
  let dayButton: HTMLButtonElement | undefined

  for (let attempt = 0; attempt < 24 && !dayButton; attempt += 1) {
    const visibleDayButtons = Array.from(
      document.querySelectorAll<HTMLButtonElement>("button[data-day]")
    )
    dayButton = visibleDayButtons.find(
      (button) =>
        button.dataset.day &&
        dayjs(button.dataset.day).format("YYYY-MM-DD") === value
    )
    if (dayButton) break

    const visibleTimestamps = visibleDayButtons
      .map((button) => dayjs(button.dataset.day).valueOf())
      .filter(Number.isFinite)
    const navigationButton = document.querySelector<HTMLButtonElement>(
      targetTimestamp < Math.min(...visibleTimestamps)
        ? ".rdp-button_previous"
        : ".rdp-button_next"
    )
    expect(navigationButton).not.toBeNull()
    await interaction.click(navigationButton!)
  }

  expect(dayButton).toBeDefined()
  expect(dayButton).toBeEnabled()
  expect(dayButton).not.toHaveAttribute("aria-disabled", "true")
  fireEvent.click(dayButton!)
}

describe("administrator audit metadata", () => {
  beforeEach(async () => {
    setAccessToken("audit-access-token")
    await i18n.changeLanguage("zh-CN")
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:audit"),
    })
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    })
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
      () => undefined
    )
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it("does not render the user-agent column or value", async () => {
    const userAgent =
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36"
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          envelope({
            items: [
              {
                id: "audit-with-user-agent",
                action: "user_profile_updated",
                actor_name: "One.Liu",
                target_type: "user",
                target_id: "user-1",
                result: "success",
                source_ip: "127.0.0.1",
                user_agent: userAgent,
                created_at: "2026-07-13T02:07:00.000Z",
              },
            ],
            next_cursor: null,
          })
        )
      )
    )
    renderAudit()

    expect(await screen.findByText("已更新个人资料")).toBeVisible()
    expect(
      screen.queryByRole("columnheader", { name: "User-Agent" })
    ).not.toBeInTheDocument()
    expect(screen.queryByText(userAgent)).not.toBeInTheDocument()
  })

  it("keeps the details action on the right and shows every safe audit field", async () => {
    const userAgent = "Mozilla/5.0 audit-detail-test"
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          envelope({
            items: [
              {
                id: "audit-detail-1",
                action: "conversation_turn_completed",
                actor_name: "One.Liu",
                actor_id: "10000000-0000-4000-8000-000000000001",
                target_type: "conversation_turn",
                target_id: "turn-1",
                result: "success",
                ip_address: "192.0.2.10",
                user_agent: userAgent,
                metadata: {
                  conversation_id: "conversation-1",
                  submit_mode: "user",
                  size_bytes: 0,
                  resumed: false,
                },
                created_at: "2026-07-13T02:07:00.000Z",
              },
            ],
            next_cursor: null,
          })
        )
      )
    )
    const interaction = userEvent.setup()
    renderAudit()

    const detailsButton = await screen.findByRole("button", { name: "详情" })
    expect(screen.getByText("任务轮次已完成")).toBeVisible()
    expect(screen.getByText("任务轮次")).toBeVisible()
    expect(screen.getByText("成功")).toBeVisible()
    expect(screen.getByRole("columnheader", { name: "操作" })).toHaveClass(
      "audit-details-actions-column"
    )
    expect(detailsButton.closest("td")).toHaveClass(
      "audit-details-actions-column"
    )
    expect(appStyles).toMatch(
      /\.audit-details-table\s+td\.audit-details-actions-column\s*\{[^}]*vertical-align:\s*middle;/u
    )

    await interaction.click(detailsButton)

    const dialog = screen.getByRole("dialog", { name: "审计日志详情" })
    expect(dialog).toHaveClass("overflow-hidden")
    expect(dialog).not.toHaveClass("overflow-y-auto")
    expect(
      within(dialog)
        .getByRole("heading", { name: "审计日志详情" })
        .closest('[data-slot="audit-detail-dialog-header"]')
    ).toHaveClass("shrink-0")
    expect(
      dialog.querySelector('[data-slot="audit-detail-dialog-body"]')
    ).toHaveClass("min-h-0", "overflow-y-auto")
    expect(within(dialog).getByText("audit-detail-1")).toBeVisible()
    expect(
      within(dialog).getByText("conversation_turn_completed")
    ).toBeVisible()
    expect(within(dialog).getByText("conversation_turn")).toBeVisible()
    expect(within(dialog).getByText("One.Liu")).toBeVisible()
    expect(
      within(dialog).getByText("10000000-0000-4000-8000-000000000001")
    ).toBeVisible()
    expect(within(dialog).getByText("turn-1")).toBeVisible()
    expect(within(dialog).getByText("192.0.2.10")).toBeVisible()
    expect(within(dialog).getByText(userAgent)).toBeVisible()
    expect(within(dialog).getByText("conversation_id")).toBeVisible()
    expect(within(dialog).getByText("conversation-1")).toBeVisible()
    expect(within(dialog).getByText("size_bytes")).toBeVisible()
    expect(within(dialog).getByText("0")).toBeVisible()
    expect(within(dialog).getByText("resumed")).toBeVisible()
    expect(within(dialog).getByText("false")).toBeVisible()

    await interaction.click(
      within(dialog).getByRole("button", { name: "关闭" })
    )
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })

  it("uses neutral runtime identifiers for internal audit metadata", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          envelope({
            items: [
              {
                id: "audit-runtime-failure",
                action: "codex_thread_recovery_failed",
                target_type: "codex_turn",
                target_id: "turn-1",
                result: "failure",
                error_code: "CODEX_TURN_FAILED",
                created_at: "2026-07-13T02:07:00.000Z",
              },
            ],
            next_cursor: null,
          })
        )
      )
    )
    renderAudit()

    expect(await screen.findByText("运行线程恢复失败")).toBeVisible()
    expect(screen.getByText("运行轮次")).toBeVisible()
    expect(screen.getByText("RUNTIME_TURN_FAILED")).toBeVisible()
    expect(screen.queryByText(/codex/iu)).not.toBeInTheDocument()
  })

  it("renders audit values in English and preserves unknown codes as fallbacks", async () => {
    await i18n.changeLanguage("en-US")
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          envelope({
            items: [
              {
                id: "localized-audit",
                action: "credential_used",
                target_type: "credential",
                target_id: "credential-1",
                result: "success",
                created_at: "2026-07-13T02:07:00.000Z",
              },
              {
                id: "future-audit",
                action: "future_event",
                target_type: "future_target",
                result: "future_result",
                created_at: "2026-07-13T02:08:00.000Z",
              },
            ],
            next_cursor: null,
          })
        )
      )
    )

    renderAudit()

    expect(await screen.findByText("Credential used")).toBeVisible()
    expect(screen.getByText("Credential")).toBeVisible()
    expect(screen.getByText("Success")).toBeVisible()
    expect(screen.getByText("future_event")).toBeVisible()
    expect(screen.getByText("future_target")).toBeVisible()
    expect(screen.getByText("future_result")).toBeVisible()
  })

  it("sends every filter to the server and issues only one filtered export request", async () => {
    let resolveExport: ((response: Response) => void) | undefined
    const exportResponse = new Promise<Response>((resolve) => {
      resolveExport = resolve
    })
    const requestedUrls: string[] = []
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = new URL(String(input), window.location.origin)
      requestedUrls.push(url.toString())
      if (url.pathname.endsWith("/export.csv")) return exportResponse
      return Promise.resolve(
        envelope({
          items: [
            {
              id: "audit-1",
              action: "conversation_created",
              actor_id: "user-1",
              target_type: null,
              target_id: null,
              result: "success",
              ip_address: "192.0.2.1",
              created_at: "2026-07-11T00:00:00.000Z",
            },
          ],
          next_cursor: null,
        })
      )
    })
    vi.stubGlobal("fetch", fetchMock)
    const interaction = userEvent.setup()
    renderAudit()

    expect(screen.queryByText(/此页只展示跨用户元数据/)).not.toBeInTheDocument()
    expect(await screen.findByText("已创建任务")).toBeVisible()
    expect(
      screen.queryByText("服务返回了无法识别的数据，请联系管理员。")
    ).not.toBeInTheDocument()
    await interaction.type(screen.getByLabelText("搜索"), "user-1")
    const actionFilter = screen.getByRole("combobox", { name: "动作" })
    await interaction.click(actionFilter)
    await interaction.type(actionFilter, "已创建任务")
    const actionOption = (
      await screen.findByText("conversation_created")
    ).closest('[role="option"]')
    expect(actionOption).not.toBeNull()
    await interaction.click(actionOption!)
    await interaction.click(screen.getByRole("combobox", { name: "结果" }))
    await interaction.click(await screen.findByRole("option", { name: "失败" }))
    await chooseDate(interaction, "开始日期", "2026-07-01")
    expect(screen.getByLabelText("开始日期")).toHaveTextContent("2026年7月1日")
    await chooseDate(interaction, "结束日期", "2026-07-31")
    expect(screen.getByLabelText("结束日期")).toHaveTextContent("2026年7月31日")
    for (const label of ["开始日期", "结束日期"]) {
      const date = screen.getByLabelText(label)
      expect(date.closest(".form-field")).toHaveClass("flex-[1_1_240px]")
      expect(date.closest(".audit-filters")).toHaveClass("flex", "flex-wrap")
      expect(date.closest(".audit-filters")).not.toHaveClass("filter-row")
    }

    await waitFor(() => {
      const lastListUrl = [...requestedUrls]
        .reverse()
        .find((url) => !url.includes("export.csv"))
      expect(lastListUrl).toContain("search=user-1")
      expect(lastListUrl).toContain("action=conversation_created")
      expect(lastListUrl).toContain("result=failure")
      expect(lastListUrl).toContain("date_from=2026-07-01")
      expect(lastListUrl).toContain("date_to=2026-07-31")
    })

    const exportButton = screen.getByRole("button", { name: "导出 CSV" })
    fireEvent.click(exportButton)
    fireEvent.click(exportButton)

    expect(
      requestedUrls.filter((url) => url.includes("/admin/audit/export.csv"))
    ).toHaveLength(1)
    const exportUrl = requestedUrls.find((url) =>
      url.includes("/admin/audit/export.csv")
    )!
    expect(exportUrl).toContain("search=user-1")
    expect(exportUrl).toContain("result=failure")
    expect(exportUrl).not.toContain("cursor=")

    resolveExport?.(
      new Response('"created_at","actor_id"\r\n"2026-07-11","user-1"', {
        status: 200,
        headers: { "content-type": "text/csv" },
      })
    )
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "导出 CSV" })).toBeEnabled()
    )
  })

  it("shows the three redacted audit data surfaces without rendering conversation titles", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = new URL(String(input), window.location.origin)
      if (url.pathname.endsWith("/conversations")) {
        return Promise.resolve(
          envelope({
            items: [
              {
                conversation_id: "conversation-1",
                title: "不得展示的敏感标题",
                owner_id: "user-1",
                owner_name: "林晓",
                owner_email: "lin@example.com",
                created_at: "2026-07-11T00:00:00.000Z",
                updated_at: "2026-07-11T00:02:00.000Z",
                last_run_at: "2026-07-11T00:01:00.000Z",
                execution_status: "completed",
                plugin_names: ["业务数据"],
                skill_names: ["报告写作"],
                attachment_count: 1,
                attachment_size_bytes: 1024,
                artifact_count: 2,
                artifact_size_bytes: 2048,
                execution_duration_ms: 1500,
                error_type: null,
                error_code: null,
                runner_status: "initialized",
                archive_status: "active",
              },
              {
                conversation_id: "conversation-empty-capabilities",
                owner_id: "user-3",
                owner_name: "空插件用户",
                owner_email: "empty@example.com",
                created_at: "2026-07-11T00:03:00.000Z",
                updated_at: "2026-07-11T00:03:00.000Z",
                last_run_at: "2026-07-11T00:03:00.000Z",
                execution_status: "completed",
                plugin_names: [],
                skill_names: [],
                attachment_count: 0,
                attachment_size_bytes: 0,
                artifact_count: 0,
                artifact_size_bytes: 0,
                execution_duration_ms: 500,
                error_type: null,
                error_code: null,
                runner_status: "initialized",
                archive_status: "active",
              },
            ],
            next_cursor: null,
          })
        )
      }
      if (url.pathname.endsWith("/retained-artifacts")) {
        return Promise.resolve(
          envelope({
            items: [
              {
                conversation_id: "deleted-conversation-1",
                owner_id: "user-2",
                owner_name: "周明",
                owner_email: "zhou@example.com",
                artifact_count: 3,
                total_size_bytes: 4096,
                checksum_present: true,
                first_artifact_created_at: "2026-07-09T00:00:00.000Z",
                last_artifact_created_at: "2026-07-09T00:05:00.000Z",
                conversation_deleted_at: "2026-07-10T00:00:00.000Z",
              },
            ],
          })
        )
      }
      return Promise.resolve(
        envelope({
          items: [
            {
              id: "audit-1",
              action: "conversation_created",
              result: "success",
              created_at: "2026-07-11T00:00:00.000Z",
            },
          ],
          next_cursor: null,
        })
      )
    })
    vi.stubGlobal("fetch", fetchMock)
    const interaction = userEvent.setup()
    renderAudit()

    expect(
      await screen.findByRole("heading", { name: "审计日志" })
    ).toBeVisible()
    expect(await screen.findByText("已创建任务")).toBeVisible()
    const auditTabs = screen.getByRole("tablist", { name: "审计数据范围" })
    expect(auditTabs).toHaveClass("rounded-none", "bg-transparent")
    for (const tab of within(auditTabs).getAllByRole("tab")) {
      expect(tab).toHaveClass("rounded-xl", "font-medium")
    }
    await interaction.click(screen.getByRole("tab", { name: "任务执行元数据" }))
    expect(await screen.findByText("conversation-1")).toBeVisible()
    expect(screen.getByText("林晓")).toBeVisible()
    expect(screen.queryByText("不得展示的敏感标题")).not.toBeInTheDocument()
    const pluginSummary = screen.getByText("插件: 业务数据")
    const skillSummary = screen.getByText("Skill: 报告写作")
    expect(pluginSummary).toHaveClass("table-secondary", "truncate")
    expect(skillSummary).toHaveClass("table-secondary", "truncate")
    expect(pluginSummary.closest("td")).toHaveClass(
      "audit-conversation-capabilities-column"
    )
    expect(
      screen.getByRole("columnheader", { name: "使用的插件/Skill" })
    ).toHaveClass("audit-conversation-capabilities-column")
    expect(appStyles).toMatch(
      /\.audit-conversation-capabilities-column\s*\{[^}]*width:\s*360px;[^}]*min-width:\s*360px;[^}]*max-width:\s*360px;/u
    )
    expect(screen.getByText("附件 1 个 · 1 kB")).toHaveClass("table-secondary")
    expect(screen.getByText("产物 2 个 · 2 kB")).toHaveClass("table-secondary")
    expect(screen.getByText("插件: -")).toBeVisible()
    expect(screen.getByText("Skill: -")).toBeVisible()
    expect(screen.getByRole("columnheader", { name: "操作" })).toHaveClass(
      "audit-details-actions-column"
    )

    await interaction.click(screen.getAllByRole("button", { name: "详情" })[0]!)
    const conversationDialog = screen.getByRole("dialog", {
      name: "任务执行详情",
    })
    expect(within(conversationDialog).getByText("conversation-1")).toBeVisible()
    expect(within(conversationDialog).getByText("user-1")).toBeVisible()
    expect(
      within(conversationDialog).getByText("lin@example.com")
    ).toBeVisible()
    expect(within(conversationDialog).getByText("业务数据")).toBeVisible()
    expect(within(conversationDialog).getByText("报告写作")).toBeVisible()
    expect(within(conversationDialog).getByText("1.5秒")).toBeVisible()
    expect(within(conversationDialog).getByText("1 kB")).toBeVisible()
    expect(within(conversationDialog).getByText("2 kB")).toBeVisible()
    await interaction.click(
      within(conversationDialog).getByRole("button", { name: "关闭" })
    )

    await interaction.click(screen.getByRole("tab", { name: "已删除任务产物" }))
    expect(await screen.findByText("deleted-conversation-1")).toBeVisible()
    expect(screen.getByText("4 kB")).toBeVisible()
    expect(screen.getByRole("columnheader", { name: "操作" })).toHaveClass(
      "audit-details-actions-column"
    )
    await interaction.click(screen.getByRole("button", { name: "详情" }))
    const retainedDialog = screen.getByRole("dialog", {
      name: "已删除任务产物详情",
    })
    expect(within(retainedDialog).getByText("user-2")).toBeVisible()
    expect(within(retainedDialog).getByText("周明")).toBeVisible()
    expect(within(retainedDialog).getByText("zhou@example.com")).toBeVisible()
    expect(within(retainedDialog).getByText("3")).toBeVisible()
    expect(within(retainedDialog).getByText("4 kB")).toBeVisible()
    expect(within(retainedDialog).getByText("是")).toBeVisible()
    await interaction.click(
      within(retainedDialog).getByRole("button", { name: "关闭" })
    )
    expect(screen.getByRole("button", { name: "导出 CSV" })).toBeEnabled()
  })
})
