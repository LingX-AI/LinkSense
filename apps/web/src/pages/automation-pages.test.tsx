import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { setAccessToken } from "@/api/session"
import { ThemeProvider } from "@/app/theme-context"
import { notify } from "@/components/feedback/notification"
import { NotificationCenter } from "@/components/feedback/notification-toast"
import i18n from "@/i18n"
import { AutomationPage } from "@/pages/automation-pages"

const AUTOMATION_ID = "20000000-0000-4000-8000-000000000001"
const CONVERSATION_ID = "30000000-0000-4000-8000-000000000001"
const TURN_ID = "40000000-0000-4000-8000-000000000001"
const NOW = "2026-07-30T00:00:00.000Z"

function mockDesktopSplitLayout() {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: 1_600,
  })
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function getBoundingClientRect(this: HTMLElement) {
      const width = this.classList.contains("conversation-presentation-layout")
        ? 1_200
        : 0
      return {
        x: 0,
        y: 0,
        top: 0,
        right: width,
        bottom: 800,
        left: 0,
        width,
        height: 800,
        toJSON: () => ({}),
      }
    }
  )
}

beforeEach(async () => {
  setAccessToken("automation-page-access-token")
  await i18n.changeLanguage("zh-CN")
})

afterEach(() => {
  notify.dismiss()
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("AutomationPage", () => {
  it("shows an empty-result failure instead of presenting the last run as successful", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = new URL(String(input), window.location.origin).pathname
        const method = init?.method ?? "GET"
        if (path === "/api/v1/automations" && method === "GET") {
          return envelope({
            items: [
              {
                ...automationFixture({
                  frequency: "daily",
                  interval: 1,
                  time: "09:00",
                  time_zone: "Asia/Shanghai",
                }),
                last_run_at: "2026-07-30T00:30:00.000Z",
                last_run_status: "failed",
                last_error_code: "AUTOMATION_EMPTY_RESULT",
              },
            ],
          })
        }
        if (path === "/api/v1/automations/pinned-tasks" && method === "GET") {
          return envelope({ items: [] })
        }
        throw new Error(`Unexpected request: ${method} ${path}`)
      })
    )

    renderPage()

    expect(await screen.findByText("上次执行失败：未产出内容")).toBeVisible()
    expect(screen.getByText("上次执行失败：未产出内容")).toHaveClass(
      "text-destructive"
    )
  })

  it("creates one reusable pinned task with an hourly cadence", async () => {
    const requests: Array<{ path: string; method: string; body?: unknown }> = []
    let automations: unknown[] = []
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = new URL(String(input), window.location.origin).pathname
        const method = init?.method ?? "GET"
        const body = init?.body ? JSON.parse(String(init.body)) : undefined
        requests.push({ path, method, body })
        if (path === "/api/v1/automations" && method === "GET") {
          return envelope({ items: automations })
        }
        if (path === "/api/v1/automations/pinned-tasks" && method === "GET") {
          return envelope({
            items: [
              {
                id: CONVERSATION_ID,
                title: "Existing pinned task",
                pinned_at: NOW,
              },
            ],
          })
        }
        if (path === "/api/v1/automations" && method === "POST") {
          const creation = body as {
            instruction: unknown
            schedule: Record<string, unknown>
            title: unknown
          }
          automations = [
            {
              ...automationFixture(creation.schedule),
              instruction: String(creation.instruction),
              title: String(creation.title),
            },
          ]
          return envelope(automations[0], 201)
        }
        throw new Error(`Unexpected request: ${method} ${path}`)
      })
    )
    mockDesktopSplitLayout()
    const interaction = userEvent.setup()
    renderPage()

    const workspace = await screen.findByTestId("automation-workspace")
    const splitLayout = workspace.closest(".conversation-office-layout")
    expect(splitLayout).not.toHaveAttribute("data-has-office-preview")
    await interaction.click(
      await screen.findByRole("button", { name: "新建自动化" })
    )
    const editor = await screen.findByRole("complementary", {
      name: "新建自动化",
    })
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    expect(editor).toHaveClass("office-preview-pane", "automation-editor-pane")
    expect(editor).toHaveAttribute("data-mode", "create")
    expect(editor.parentElement).toBe(splitLayout)
    expect(splitLayout).toHaveAttribute("data-has-office-preview", "true")
    expect(
      screen.getByRole("separator", {
        name: "调整自动化编辑区域宽度",
      })
    ).toBeVisible()
    await interaction.type(
      within(editor).getByLabelText("自动化标题"),
      "每小时简报"
    )
    await interaction.type(
      within(editor).getByLabelText("自动化指令"),
      "总结最近的重要更新。"
    )
    expect(document.querySelector('input[type="time"]')).toBeNull()
    expect(within(editor).getByRole("group", { name: "时间" })).toBeVisible()
    expect(
      within(editor).getByRole("button", { name: "时间 09:00" })
    ).toBeVisible()
    expect(
      within(editor).queryByRole("combobox", { name: "小时" })
    ).not.toBeInTheDocument()
    expect(
      within(editor).queryByRole("combobox", { name: "分钟" })
    ).not.toBeInTheDocument()
    await interaction.click(
      within(editor).getByRole("combobox", { name: "重复" })
    )
    await interaction.click(await screen.findByRole("option", { name: "每周" }))
    await interaction.click(
      within(editor).getByRole("button", { name: "开启于" })
    )
    await interaction.click(
      await screen.findByRole("menuitemcheckbox", { name: "周二" })
    )
    expect(
      within(editor).getByRole("button", { name: "开启于" })
    ).toHaveTextContent("周一、周二")
    const weekdaysLabel = within(editor).getByText("开启于")
    const timeLabel = within(editor).getByText("时间")
    expect(
      Boolean(
        weekdaysLabel.compareDocumentPosition(timeLabel) &
        Node.DOCUMENT_POSITION_FOLLOWING
      )
    ).toBe(true)
    await interaction.click(
      within(editor).getByRole("combobox", { name: "重复" })
    )
    await interaction.click(await screen.findByRole("option", { name: "每月" }))
    expect(
      within(editor).getByRole("combobox", { name: "日期" })
    ).toHaveTextContent("1 日")
    await interaction.click(
      within(editor).getByRole("combobox", { name: "日期" })
    )
    await interaction.click(
      await screen.findByRole("option", { name: "15 日" })
    )
    expect(
      within(editor).getByRole("combobox", { name: "日期" })
    ).toHaveTextContent("15 日")
    const expiresCheckbox = within(editor).getByRole("checkbox", {
      name: /设置到期日期/u,
    })
    expect(expiresCheckbox.closest("label")).not.toHaveClass(
      "has-data-checked:bg-input/30"
    )
    expect(expiresCheckbox).toHaveClass("mt-0.5")
    expect(expiresCheckbox).not.toBeChecked()
    expect(within(editor).queryByText("选择到期日期")).not.toBeInTheDocument()
    await interaction.click(expiresCheckbox)
    expect(expiresCheckbox).toBeChecked()
    expect(within(editor).getByText("选择到期日期")).toBeVisible()
    await interaction.click(expiresCheckbox)
    expect(expiresCheckbox).not.toBeChecked()
    expect(within(editor).queryByText("选择到期日期")).not.toBeInTheDocument()
    expect(within(editor).queryByText("高级选项")).not.toBeInTheDocument()
    expect(
      within(editor).getByRole("checkbox", {
        name: /指定模型和推理强度/u,
      })
    ).toHaveClass("mt-0.5")
    await interaction.click(
      within(editor).getByRole("button", { name: "新建任务" })
    )
    await interaction.click(
      within(editor).getByRole("combobox", { name: "重复" })
    )
    const hourlyOption = await screen.findByRole("option", { name: "每小时" })
    expect(
      screen.queryByRole("option", { name: "每年" })
    ).not.toBeInTheDocument()
    await interaction.click(hourlyOption)
    expect(within(editor).queryByLabelText("每隔")).not.toBeInTheDocument()
    await interaction.clear(within(editor).getByLabelText("在第几分钟"))
    await interaction.type(within(editor).getByLabelText("在第几分钟"), "15")
    await interaction.click(
      within(editor).getByRole("button", { name: "创建" })
    )

    await waitFor(() => {
      const request = requests.find(
        (candidate) =>
          candidate.path === "/api/v1/automations" &&
          candidate.method === "POST"
      )
      expect(request?.body).toMatchObject({
        title: "每小时简报",
        instruction: "总结最近的重要更新。",
        target: { mode: "new_task" },
        schedule: {
          frequency: "hourly",
          interval: 1,
          minute: 15,
          time_zone: expect.any(String),
        },
        expires_on: null,
      })
      expect(request?.body).not.toHaveProperty("notification")
    })
    expect(
      screen.queryByRole("complementary", { name: "新建自动化" })
    ).not.toBeInTheDocument()
    expect(splitLayout).not.toHaveAttribute("data-has-office-preview")
    expect(await screen.findByText("每小时简报")).toBeVisible()
    expect(screen.getByText(/第 15 分钟执行/)).toBeVisible()
  }, 10_000)

  it("shows only the pinned tasks returned by the target endpoint", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = new URL(String(input), window.location.origin).pathname
        const method = init?.method ?? "GET"
        if (path === "/api/v1/automations" && method === "GET") {
          return envelope({ items: [] })
        }
        if (path === "/api/v1/automations/pinned-tasks" && method === "GET") {
          return envelope({
            items: [
              {
                id: CONVERSATION_ID,
                title: "Only pinned task",
                pinned_at: NOW,
              },
            ],
          })
        }
        throw new Error(`Unexpected request: ${method} ${path}`)
      })
    )
    const interaction = userEvent.setup()
    renderPage()

    await interaction.click(
      await screen.findByRole("button", { name: "新建自动化" })
    )
    const editor = await screen.findByRole("complementary", {
      name: "新建自动化",
    })
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    await interaction.click(
      within(editor).getByRole("combobox", { name: "任务" })
    )

    expect(
      await screen.findByRole("option", { name: "Only pinned task" })
    ).toBeVisible()
    expect(screen.queryByText("通知")).not.toBeInTheDocument()
  })

  it("filters by status and keeps row actions in the more menu", async () => {
    const requests: Array<{ path: string; method: string; body?: unknown }> = []
    let automations = [
      {
        ...automationFixture({
          frequency: "daily",
          interval: 1,
          time: "09:00",
          time_zone: "Asia/Shanghai",
        }),
        title: "运行中的自动化",
        instruction: "生成每日简报。",
      },
      {
        ...automationFixture({
          frequency: "weekly",
          interval: 1,
          weekdays: [1],
          time: "10:00",
          time_zone: "Asia/Shanghai",
        }),
        id: "20000000-0000-4000-8000-000000000002",
        title: "已暂停自动化",
        instruction: "整理每周计划。",
        status: "paused",
        next_run_at: null,
      },
    ]
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = new URL(String(input), window.location.origin).pathname
        const method = init?.method ?? "GET"
        const body = init?.body ? JSON.parse(String(init.body)) : undefined
        requests.push({ path, method, body })

        if (path === "/api/v1/automations" && method === "GET") {
          return envelope({ items: automations })
        }
        if (
          path === "/api/v1/automations/20000000-0000-4000-8000-000000000002" &&
          method === "PATCH"
        ) {
          automations = automations.map((automation) =>
            automation.id === "20000000-0000-4000-8000-000000000002"
              ? {
                  ...automation,
                  status: "active",
                  next_run_at: "2026-08-03T02:00:00.000Z",
                }
              : automation
          )
          return envelope(automations[1])
        }
        throw new Error(`Unexpected request: ${method} ${path}`)
      })
    )
    const interaction = userEvent.setup()
    renderPage()

    expect(await screen.findByText("运行中的自动化")).toBeVisible()
    expect(screen.getByText("已暂停自动化")).toBeVisible()
    expect(
      screen.queryByText("按设定周期在同一个置顶任务中自动执行指令。")
    ).not.toBeInTheDocument()

    const activeRow = screen
      .getByText("运行中的自动化")
      .closest('[role="listitem"]')
    expect(activeRow).not.toBeNull()
    expect(activeRow).not.toHaveTextContent("生成每日简报。")
    expect(activeRow).not.toHaveTextContent("上次运行")
    expect(activeRow).not.toHaveTextContent("任务：")
    expect(activeRow?.className).not.toMatch(/\bbg-/)
    expect(screen.getByText("运行中的自动化")).toHaveClass("text-sm")
    expect(screen.getByText(/09:00 执行/).parentElement).toHaveClass("text-xs")
    const activeStatusButton = screen.getByRole("button", {
      name: "暂停 运行中的自动化",
    })
    const pausedStatusButton = screen.getByRole("button", {
      name: "恢复 已暂停自动化",
    })
    expect(activeStatusButton).toBeVisible()
    expect(pausedStatusButton).toBeVisible()
    expect(activeStatusButton).not.toHaveAttribute("title")

    await interaction.hover(activeStatusButton)
    expect(await screen.findByRole("tooltip")).toHaveTextContent("暂停")
    await interaction.unhover(activeStatusButton)
    await waitFor(() => {
      expect(screen.queryByRole("tooltip")).not.toBeInTheDocument()
    })

    await interaction.hover(pausedStatusButton)
    expect(await screen.findByRole("tooltip")).toHaveTextContent("恢复")
    await interaction.unhover(pausedStatusButton)
    await waitFor(() => {
      expect(screen.queryByRole("tooltip")).not.toBeInTheDocument()
    })

    await interaction.click(screen.getByRole("tab", { name: "已暂停" }))

    expect(screen.queryByText("运行中的自动化")).not.toBeInTheDocument()
    expect(screen.getByText("已暂停自动化")).toBeVisible()

    await interaction.click(
      screen.getByRole("button", {
        name: "已暂停自动化的更多操作",
      })
    )

    expect(
      await screen.findByRole("menuitem", { name: "立即执行" })
    ).toBeVisible()
    expect(
      await screen.findByRole("menuitem", { name: "打开任务" })
    ).toBeVisible()
    expect(screen.getByRole("menuitem", { name: "编辑" })).toBeVisible()
    expect(screen.getByRole("menuitem", { name: "删除" })).toBeVisible()
    expect(
      screen.queryByRole("menuitem", { name: "恢复" })
    ).not.toBeInTheDocument()
    await interaction.keyboard("{Escape}")
    await interaction.click(
      screen.getByRole("button", { name: "恢复 已暂停自动化" })
    )

    await waitFor(() => {
      expect(
        requests.find(
          (request) =>
            request.path.endsWith("20000000-0000-4000-8000-000000000002") &&
            request.method === "PATCH"
        )?.body
      ).toEqual({ status: "active" })
    })
    const emptyTitle = await screen.findByText("当前没有已暂停的自动化")

    expect(emptyTitle).toBeVisible()
    expect(emptyTitle).toHaveClass(
      "text-[length:var(--app-font-13)]",
      "font-normal",
      "text-muted-foreground"
    )
    expect(emptyTitle.closest("[data-slot='empty']")).toHaveClass("empty-state")
    expect(
      screen.queryByRole("button", { name: "查看全部" })
    ).not.toBeInTheDocument()
  })

  it("immediately runs an automation from the more menu", async () => {
    const requests: Array<{ path: string; method: string; body?: unknown }> = []
    let resolveRun!: (response: Response) => void
    const runResponse = new Promise<Response>((resolve) => {
      resolveRun = resolve
    })
    const automation = {
      ...automationFixture({
        frequency: "daily",
        interval: 1,
        time: "09:00",
        time_zone: "Asia/Shanghai",
      }),
      title: "立即执行测试",
    }
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = new URL(String(input), window.location.origin).pathname
        const method = init?.method ?? "GET"
        const body = init?.body ? JSON.parse(String(init.body)) : undefined
        requests.push({ path, method, body })
        if (path === "/api/v1/automations" && method === "GET") {
          return envelope({ items: [automation] })
        }
        if (
          path === `/api/v1/automations/${AUTOMATION_ID}/run` &&
          method === "POST"
        ) {
          return runResponse
        }
        throw new Error(`Unexpected request: ${method} ${path}`)
      })
    )
    const success = vi.spyOn(notify, "success")
    const interaction = userEvent.setup()
    renderPage()

    await interaction.click(
      await screen.findByRole("button", {
        name: "立即执行测试的更多操作",
      })
    )
    await interaction.click(
      await screen.findByRole("menuitem", { name: "立即执行" })
    )

    const runLoading = await screen.findByText("正在执行自动化…")
    expect(runLoading.closest("[data-sonner-toast]")).not.toBeNull()
    await waitFor(() => {
      expect(
        requests.find(
          (request) =>
            request.path === `/api/v1/automations/${AUTOMATION_ID}/run` &&
            request.method === "POST"
        )?.body
      ).toEqual({
        request_id: expect.stringMatching(
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
        ),
      })
    })
    resolveRun(envelope({ status: "started", turn_id: TURN_ID }, 202))
    expect(await screen.findByText("已开始执行“立即执行测试”。")).toBeVisible()
    expect(success).toHaveBeenCalledWith("已开始执行“立即执行测试”。", {
      id: `automation-run-now-${AUTOMATION_ID}`,
    })
  })

  it("edits an automation in the same full-height split pane used by file previews", async () => {
    const requests: Array<{ path: string; method: string; body?: unknown }> = []
    let automation = {
      ...automationFixture({
        frequency: "daily",
        interval: 1,
        time: "09:00",
        time_zone: "Asia/Shanghai",
      }),
      title: "待编辑自动化",
      instruction: "生成每日简报。",
    }
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = new URL(String(input), window.location.origin).pathname
        const method = init?.method ?? "GET"
        const body = init?.body
          ? (JSON.parse(String(init.body)) as Record<string, unknown>)
          : undefined
        requests.push({ path, method, body })

        if (path === "/api/v1/automations" && method === "GET") {
          return envelope({ items: [automation] })
        }
        if (path === "/api/v1/automations/pinned-tasks" && method === "GET") {
          return envelope({
            items: [
              {
                id: CONVERSATION_ID,
                title: "待编辑自动化",
                pinned_at: NOW,
              },
            ],
          })
        }
        if (
          path === `/api/v1/automations/${AUTOMATION_ID}` &&
          method === "PATCH" &&
          body
        ) {
          automation = {
            ...automation,
            title: String(body.title),
            instruction: String(body.instruction),
            schedule: body.schedule as Record<string, unknown>,
          }
          return envelope(automation)
        }
        throw new Error(`Unexpected request: ${method} ${path}`)
      })
    )
    mockDesktopSplitLayout()
    const interaction = userEvent.setup()
    renderPage()

    expect(await screen.findByText("待编辑自动化")).toBeVisible()
    const workspace = screen.getByTestId("automation-workspace")
    const splitLayout = workspace.closest(".conversation-office-layout")
    expect(splitLayout).not.toHaveAttribute("data-has-office-preview")

    await openAutomationEditor(interaction, "待编辑自动化")

    const editor = await screen.findByRole("complementary", {
      name: "编辑自动化",
    })
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    expect(editor).toHaveClass("office-preview-pane", "automation-editor-pane")
    expect(editor).toHaveAttribute("data-mode", "edit")
    expect(editor.parentElement).toBe(splitLayout)
    expect(splitLayout).toHaveAttribute("data-has-office-preview", "true")
    expect(
      screen.getByRole("separator", {
        name: "调整自动化编辑区域宽度",
      })
    ).toBeVisible()
    expect(
      within(editor).getByRole("textbox", { name: "自动化标题" })
    ).toHaveValue("待编辑自动化")
    expect(
      within(editor).getByRole("textbox", { name: "自动化指令" })
    ).toHaveClass("max-h-80", "overflow-y-auto")

    await interaction.click(
      within(editor).getByRole("button", { name: "关闭" })
    )
    await waitFor(() => {
      expect(
        screen.queryByRole("complementary", { name: "编辑自动化" })
      ).not.toBeInTheDocument()
    })
    expect(splitLayout).not.toHaveAttribute("data-has-office-preview")
    expect(
      screen.queryByRole("separator", {
        name: "调整自动化编辑区域宽度",
      })
    ).not.toBeInTheDocument()

    await openAutomationEditor(interaction, "待编辑自动化")
    const reopenedEditor = await screen.findByRole("complementary", {
      name: "编辑自动化",
    })
    const titleInput = within(reopenedEditor).getByRole("textbox", {
      name: "自动化标题",
    })
    await interaction.clear(titleInput)
    await interaction.type(titleInput, "更新后的自动化")
    await interaction.click(
      within(reopenedEditor).getByRole("button", { name: "保存" })
    )

    await waitFor(() => {
      expect(
        requests.find(
          (request) =>
            request.path === `/api/v1/automations/${AUTOMATION_ID}` &&
            request.method === "PATCH"
        )?.body
      ).toMatchObject({
        title: "更新后的自动化",
        instruction: "生成每日简报。",
        target: {
          mode: "existing_task",
          conversation_id: CONVERSATION_ID,
        },
      })
    })
    expect(
      screen.queryByRole("complementary", { name: "编辑自动化" })
    ).not.toBeInTheDocument()
    expect(await screen.findByText("更新后的自动化")).toBeVisible()
  })

  it("shows save progress and updates the cached list without refetching", async () => {
    const originalAutomation = {
      ...automationFixture({
        frequency: "daily",
        interval: 1,
        time: "09:00",
        time_zone: "Asia/Shanghai",
      }),
      title: "等待保存的自动化",
      instruction: "生成每日简报。",
    }
    let automationListRequests = 0
    let pinnedTaskRequests = 0
    let resolvePatch!: (response: Response) => void
    const patchResponse = new Promise<Response>((resolve) => {
      resolvePatch = resolve
    })
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = new URL(String(input), window.location.origin).pathname
        const method = init?.method ?? "GET"
        if (path === "/api/v1/automations" && method === "GET") {
          automationListRequests += 1
          return envelope({ items: [originalAutomation] })
        }
        if (path === "/api/v1/automations/pinned-tasks" && method === "GET") {
          pinnedTaskRequests += 1
          return envelope({
            items: [
              {
                id: CONVERSATION_ID,
                title: originalAutomation.conversation.title,
                pinned_at: NOW,
              },
            ],
          })
        }
        if (
          path === `/api/v1/automations/${AUTOMATION_ID}` &&
          method === "PATCH"
        ) {
          return patchResponse
        }
        throw new Error(`Unexpected request: ${method} ${path}`)
      })
    )
    const interaction = userEvent.setup()
    renderPage()

    expect(await screen.findByText("等待保存的自动化")).toBeVisible()
    await openAutomationEditor(interaction, "等待保存的自动化")
    const editor = await screen.findByRole("complementary", {
      name: "编辑自动化",
    })
    const titleInput = within(editor).getByRole("textbox", {
      name: "自动化标题",
    })
    await interaction.clear(titleInput)
    await interaction.type(titleInput, "保存完成的自动化")
    const saveButton = within(editor).getByRole("button", { name: "保存" })
    await interaction.click(saveButton)

    await waitFor(() => {
      expect(saveButton).toBeDisabled()
      expect(saveButton).toHaveAttribute("aria-busy", "true")
      expect(
        saveButton.querySelector('[data-slot="spinner"]')
      ).toBeInTheDocument()
    })
    expect(within(editor).getByRole("button", { name: "关闭" })).toBeDisabled()
    expect(within(editor).getByRole("button", { name: "取消" })).toBeDisabled()

    resolvePatch(
      envelope({
        ...originalAutomation,
        title: "保存完成的自动化",
        updated_at: "2026-07-30T00:01:00.000Z",
      })
    )

    await waitFor(() => {
      expect(
        screen.queryByRole("complementary", { name: "编辑自动化" })
      ).not.toBeInTheDocument()
    })
    expect(await screen.findByText("保存完成的自动化")).toBeVisible()
    expect(automationListRequests).toBe(1)
    expect(pinnedTaskRequests).toBe(1)
  })

  it("pauses an active automation from the row status button", async () => {
    const requests: Array<{ path: string; method: string; body?: unknown }> = []
    let automation = {
      ...automationFixture({
        frequency: "daily",
        interval: 1,
        time: "09:00",
        time_zone: "Asia/Shanghai",
      }),
      title: "运行中的自动化",
      next_run_at: "2026-07-30T01:15:00.000Z" as string | null,
    }
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = new URL(String(input), window.location.origin).pathname
        const method = init?.method ?? "GET"
        const body = init?.body ? JSON.parse(String(init.body)) : undefined
        requests.push({ path, method, body })

        if (path === "/api/v1/automations" && method === "GET") {
          return envelope({ items: [automation] })
        }
        if (
          path === `/api/v1/automations/${AUTOMATION_ID}` &&
          method === "PATCH"
        ) {
          automation = {
            ...automation,
            status: "paused",
            next_run_at: null,
          }
          return envelope(automation)
        }
        throw new Error(`Unexpected request: ${method} ${path}`)
      })
    )
    const interaction = userEvent.setup()
    renderPage()

    await interaction.click(
      await screen.findByRole("button", { name: "暂停 运行中的自动化" })
    )

    await waitFor(() => {
      expect(
        requests.find(
          (request) =>
            request.path === `/api/v1/automations/${AUTOMATION_ID}` &&
            request.method === "PATCH"
        )?.body
      ).toEqual({ status: "paused" })
    })
    expect(
      await screen.findByRole("button", { name: "恢复 运行中的自动化" })
    ).toBeVisible()
    expect(
      screen.getByText("运行中的自动化").closest('[role="listitem"]')
    ).toHaveTextContent("已暂停")
  })

  it("localizes the status filters and action menu in English", async () => {
    await i18n.changeLanguage("en-US")
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = new URL(String(input), window.location.origin).pathname
        const method = init?.method ?? "GET"
        if (path === "/api/v1/automations" && method === "GET") {
          return envelope({
            items: [
              {
                ...automationFixture({
                  frequency: "daily",
                  interval: 1,
                  time: "09:00",
                  time_zone: "Asia/Shanghai",
                }),
                title: "Daily brief",
              },
            ],
          })
        }
        throw new Error(`Unexpected request: ${method} ${path}`)
      })
    )
    const interaction = userEvent.setup()
    renderPage()

    expect(await screen.findByRole("tab", { name: "All" })).toBeVisible()
    expect(screen.getByRole("tab", { name: "Active" })).toBeVisible()
    expect(screen.getByRole("tab", { name: "Paused" })).toBeVisible()
    expect(
      screen.getByRole("button", { name: "Pause Daily brief" })
    ).toBeVisible()

    await interaction.click(
      screen.getByRole("button", {
        name: "More actions for Daily brief",
      })
    )

    expect(
      await screen.findByRole("menuitem", { name: "Run now" })
    ).toBeVisible()
    expect(
      await screen.findByRole("menuitem", { name: "Open task" })
    ).toBeVisible()
    expect(screen.getByRole("menuitem", { name: "Edit" })).toBeVisible()
    expect(
      screen.queryByRole("menuitem", { name: "Pause" })
    ).not.toBeInTheDocument()
    expect(screen.getByRole("menuitem", { name: "Delete" })).toBeVisible()
  })
})

async function openAutomationEditor(
  interaction: ReturnType<typeof userEvent.setup>,
  automationName: string
) {
  await interaction.click(
    screen.getByRole("button", {
      name: `${automationName}的更多操作`,
    })
  )
  await interaction.click(await screen.findByRole("menuitem", { name: "编辑" }))
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <ThemeProvider>
      <MemoryRouter>
        <QueryClientProvider client={queryClient}>
          <AutomationPage />
        </QueryClientProvider>
      </MemoryRouter>
      <NotificationCenter />
    </ThemeProvider>
  )
}

function envelope(data: unknown, status = 200) {
  return new Response(JSON.stringify({ success: true, data }), {
    status,
    headers: { "content-type": "application/json" },
  })
}

function automationFixture(schedule: Record<string, unknown>) {
  return {
    id: AUTOMATION_ID,
    title: "每两小时简报",
    instruction: "总结最近的重要更新。",
    status: "active",
    conversation: {
      id: CONVERSATION_ID,
      title: "每两小时简报",
      pinned_at: NOW,
    },
    schedule,
    next_run_at: "2026-07-30T01:15:00.000Z",
    expires_on: null,
    last_run_at: null,
    last_run_status: null,
    last_error_code: null,
    model_preference: null,
    created_at: NOW,
    updated_at: NOW,
  }
}
