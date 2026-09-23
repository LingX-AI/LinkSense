import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { PersonalQuotaReport } from "@linksense/shared"
import i18n from "@/i18n"
import { setAccessToken } from "@/api/session"
import PersonalQuotaPage from "./personal-quota-page"

vi.mock("@/app/auth-state", () => ({
  useAuth: () => ({ user: { id: "10000000-0000-4000-8000-000000000001" } }),
}))
function fixture(): PersonalQuotaReport {
  return {
    overview: {
      limit: "1000",
      used: "250.000001",
      remaining: "749.999999",
      reset_at: "2026-09-20T16:00:00Z",
      time_zone: "Asia/Shanghai",
    },
    analytics: {
      generated_at: "2026-09-20T02:00:00Z",
      range: "7d",
      time_zone: "UTC",
      dates: ["2026-09-20"],
      credits: [
        {
          date: "2026-09-20",
          model: "model-a",
          workload: "assistant_response",
          credits: "12.000001",
        },
      ],
      tasks: [
        {
          id: "10000000-0000-4000-8000-000000000002",
          title: "测试任务",
          credits: "12.000001",
          breakdown: [
            {
              model: "model-a",
              workload: "assistant_response",
              credits: "12.000001",
            },
          ],
        },
      ],
      tools: [],
      skills: [],
      messages: [],
    },
  }
}
const envelope = (data: PersonalQuotaReport) =>
  new Response(JSON.stringify({ success: true, data }), {
    headers: { "content-type": "application/json" },
  })
function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <PersonalQuotaPage />
      </QueryClientProvider>
    </MemoryRouter>
  )
}
beforeEach(async () => {
  setAccessToken("test-token")
  await i18n.changeLanguage("zh-CN")
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("personal quota page", () => {
  it("reveals additional tasks without losing the current ranking", async () => {
    const data = fixture()
    data.analytics.tasks = Array.from({ length: 11 }, (_, index) => ({
      id: `10000000-0000-4000-8000-${String(index + 10).padStart(12, "0")}`,
      title: `Task ${index + 1}`,
      credits: String(11 - index),
      breakdown: [],
    }))
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => envelope(data))
    )
    const user = userEvent.setup()
    mount()
    await screen.findByText("749")
    await user.click(screen.getByRole("tab", { name: "分析" }))
    expect(
      screen.queryByRole("button", { name: "Task 11" })
    ).not.toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "显示更多" }))
    expect(screen.getByRole("button", { name: "Task 11" })).toBeVisible()
    expect(
      screen.queryByRole("button", { name: "显示更多" })
    ).not.toBeInTheDocument()
  })
  it.each(["zh-CN", "en-US", "de-DE"])(
    "renders whole credits in %s",
    async (language) => {
      await i18n.changeLanguage(language)
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => envelope(fixture()))
      )
      mount()
      expect(await screen.findByText("749")).toBeVisible()
      expect(
        screen.getByRole("tab", {
          name: language === "en-US" ? "Overview" : "概览",
        })
      ).toBeVisible()
      expect(screen.getByRole("progressbar")).toHaveAttribute(
        "aria-valuenow",
        "25"
      )
      expect(screen.getByText(/Asia\/Shanghai/)).toBeVisible()
    }
  )
  it("switches range and grouping and expands task details", async () => {
    const urls: string[] = []
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        urls.push(String(url))
        return envelope(fixture())
      })
    )
    const user = userEvent.setup()
    mount()
    await screen.findByText("749")
    await user.click(screen.getByRole("tab", { name: "分析" }))
    expect(await screen.findByText("消费历史")).toBeVisible()
    expect(screen.getAllByText("所选周期内暂无记录")).toHaveLength(3)
    const modelGrouping = screen.getByRole("button", { name: "按模型" })
    expect(modelGrouping.parentElement).toHaveAttribute(
      "data-appearance",
      "segmented"
    )
    expect(modelGrouping.parentElement).toHaveClass(
      "rounded-lg",
      "bg-muted/50",
      "p-0.5"
    )
    expect(screen.getByRole("button", { name: "7 天" })).toHaveClass(
      "aria-pressed:bg-muted/50",
      "data-pressed:bg-muted/50"
    )
    expect(modelGrouping.parentElement).toHaveAttribute("data-size", "sm")
    await user.click(modelGrouping)
    expect(modelGrouping).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByText("model-a", { selector: "dt" })).toBeVisible()
    const taskTrigger = screen.getByRole("button", { name: "测试任务" })
    expect(taskTrigger.closest("tr")).toHaveClass(
      "has-aria-expanded:bg-transparent",
      "has-aria-expanded:[&>td]:bg-muted/50",
      "[&>td:first-child]:rounded-l-lg",
      "[&>td:last-child]:rounded-r-lg"
    )
    expect(taskTrigger.closest("table")).toHaveClass(
      "border-separate",
      "border-spacing-0"
    )
    expect(taskTrigger).not.toHaveClass(
      "hover:bg-hover",
      "aria-expanded:bg-muted",
      "hover:bg-[var(--app-hover-subtle)]",
      "aria-expanded:bg-[var(--app-hover-subtle)]"
    )
    expect(taskTrigger.querySelector("svg")).toHaveClass(
      "text-muted-foreground"
    )
    await user.click(taskTrigger)
    const openTask = screen.getByRole("link", { name: "打开任务" })
    expect(openTask).toHaveAttribute(
      "href",
      "/conversations/10000000-0000-4000-8000-000000000002"
    )
    expect(openTask).toHaveClass("px-0")
    expect(openTask.closest('[data-slot="collapsible-content"]')).toHaveClass(
      "pl-8"
    )
    await user.click(screen.getByRole("button", { name: "30 天" }))
    await waitFor(() =>
      expect(urls.some((url) => url.includes("range=30d"))).toBe(true)
    )
  })
  it("shows real consumption without a progress bar for unlimited members", async () => {
    const data = fixture()
    data.overview.limit = null
    data.overview.remaining = null
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => envelope(data))
    )
    mount()
    expect(await screen.findByText("250")).toBeVisible()
    const unlimited = screen.getAllByText("不限额")
    expect(unlimited).toHaveLength(2)
    expect(unlimited[0]).toHaveClass("text-2xl")
    expect(unlimited[0]).not.toHaveClass("text-4xl")
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument()
  })
  it("retries a failed report", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({ success: false, error_code: "INTERNAL_ERROR" }),
            { status: 500 }
          )
        )
        .mockImplementation(async () => envelope(fixture()))
    )
    const user = userEvent.setup()
    mount()
    await user.click(await screen.findByRole("button", { name: "重试" }))
    expect(await screen.findByText("749")).toBeVisible()
  })
  it("shows loading while pending", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => {}))
    )
    mount()
    expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true")
  })
})
