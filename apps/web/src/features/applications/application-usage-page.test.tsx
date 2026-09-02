import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { MemoryRouter, Route, Routes } from "react-router-dom"

import { setAccessToken } from "@/api/session"
import { ApplicationUsagePage } from "@/features/applications/application-usage-page"
import i18n from "@/i18n"

const APPLICATION_ID = "50000000-0000-4000-8000-000000000001"

const report = {
  application: { id: APPLICATION_ID, name: "研究助手" },
  range: "all",
  generated_at: "2026-09-02T03:00:00.000Z",
  period: {
    from: null,
    to: "2026-09-02T03:00:00.000Z",
    time_zone: "Asia/Shanghai",
  },
  token_coverage: {
    started_at: "2026-08-01T00:00:00.000Z",
    complete_for_period: false,
  },
  active_user_count: 2,
  totals: metrics(3, 5, 6, "1200", "1.2"),
  token_trend: {
    granularity: "day",
    points: [
      {
        period_start: "2026-09-01",
        token_usage: tokens("500"),
        cost: cost("0.5"),
        workloads: [workload("assistant_response", 3, "500", "0.5")],
      },
      {
        period_start: "2026-09-02",
        token_usage: tokens("700"),
        cost: cost("0.7"),
        workloads: [workload("assistant_response", 3, "700", "0.7")],
      },
    ],
  },
  workloads: [workload("assistant_response", 6, "1200", "1.2")],
  models: [
    {
      model_id: "gpt-5.6-terra",
      display_name: "GPT 5.6 Terra",
      model_kind: "generation",
      workload_types: ["assistant_response"],
      measurement_methods: ["provider"],
      request_count: 6,
      turn_count: 5,
      token_usage: tokens("1200"),
      cost: cost("1.2"),
    },
  ],
}

describe("application usage page", () => {
  beforeEach(async () => {
    setAccessToken("application-usage-token")
    await i18n.changeLanguage("zh-CN")
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = new URL(String(input), window.location.origin)
        if (url.pathname === `/api/v1/applications/${APPLICATION_ID}/usage`) {
          const range = url.searchParams.get("range") ?? "all"
          return Promise.resolve(
            envelope({
              ...report,
              range,
              token_coverage: {
                ...report.token_coverage,
                complete_for_period: range !== "all",
              },
            })
          )
        }
        return Promise.resolve(envelope(null, 404))
      })
    )
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it("shows owner-safe totals, trends, model details, and period filtering", async () => {
    const interaction = userEvent.setup()
    renderPage()

    expect(
      await screen.findByRole("heading", { name: "应用用量" })
    ).toBeVisible()
    expect(await screen.findByText(/研究助手/u)).toBeVisible()
    expectMetric("使用人数", "2")
    expectMetric("任务数", "3")
    expectMetric("轮次数", "5")
    expectMetric("模型调用数", "6")
    expect(screen.getAllByText("1.2K").length).toBeGreaterThan(0)
    expect(screen.getAllByText("¥1.20").length).toBeGreaterThan(0)
    expect(
      screen.getByText("Token 与费用数据仅覆盖采集开始后的调用")
    ).toBeVisible()
    expect(
      screen.getByRole("img", { name: "所选周期的 Token 使用趋势图" })
    ).toBeVisible()
    expect(
      screen.getByRole("img", { name: "所选周期的模型费用趋势图" })
    ).toBeVisible()

    const modelTable = screen.getByRole("table", { name: "模型明细" })
    expect(within(modelTable).getByText("GPT 5.6 Terra")).toBeVisible()
    expect(within(modelTable).getByText("gpt-5.6-terra")).toBeVisible()
    expect(screen.queryByText(/example\.test/u)).not.toBeInTheDocument()

    await interaction.click(screen.getByRole("tab", { name: "按用途" }))
    const workloadTable = screen.getByRole("table", { name: "模型用途用量" })
    expect(within(workloadTable).getByText("AI 回答")).toBeVisible()
    expect(within(workloadTable).getByText("供应商返回")).toBeVisible()

    const rangeSelect = screen.getByRole("combobox", { name: "统计周期" })
    await interaction.click(rangeSelect)
    await interaction.click(
      await screen.findByRole("option", { name: "最近 7 天" })
    )
    await waitFor(() =>
      expect(
        vi
          .mocked(fetch)
          .mock.calls.some(([input]) =>
            String(input).includes(
              `/api/v1/applications/${APPLICATION_ID}/usage?range=7d`
            )
          )
      ).toBe(true)
    )
    expect(
      screen.queryByText("Token 与费用数据仅覆盖采集开始后的调用")
    ).not.toBeInTheDocument()
  })

  it("renders the new application-specific copy in English", async () => {
    await i18n.changeLanguage("en-US")
    renderPage()

    expect(
      await screen.findByRole("heading", { name: "Application usage" })
    ).toBeVisible()
    expect(await screen.findByText("Active users")).toBeVisible()
    expect(screen.getByText("Back to applications")).toBeVisible()
  })
})

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter
        initialEntries={[`/capabilities/applications/${APPLICATION_ID}/usage`]}
      >
        <Routes>
          <Route
            path="/capabilities/applications/:applicationId/usage"
            element={<ApplicationUsagePage />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

function expectMetric(label: string, value: string) {
  const card = screen
    .getAllByText(label)
    .find((element) => element.closest('[data-slot="card"]'))
    ?.closest('[data-slot="card"]')
  if (!(card instanceof HTMLElement)) {
    throw new Error(`Expected metric card for ${label}`)
  }
  expect(within(card).getByText(value)).toBeVisible()
}

function metrics(
  taskCount: number,
  turnCount: number,
  requestCount: number,
  totalTokens: string,
  totalCost: string
) {
  return {
    task_count: taskCount,
    turn_count: turnCount,
    request_count: requestCount,
    token_usage: tokens(totalTokens),
    cost: cost(totalCost),
  }
}

function tokens(totalTokens: string) {
  const total = BigInt(totalTokens)
  return {
    total_tokens: total.toString(),
    input_tokens: (total - 300n).toString(),
    cached_input_tokens: "300",
    output_tokens: "300",
    reasoning_output_tokens: "100",
  }
}

function cost(totalCost: string) {
  return {
    currency: "CNY",
    total_cost: totalCost,
    input_cost: "0.7",
    cached_input_cost: "0.1",
    output_cost: "0.4",
    unpriced_tokens: "0",
  }
}

function workload(
  workloadType: "assistant_response",
  requestCount: number,
  totalTokens: string,
  totalCost: string
) {
  return {
    workload: workloadType,
    request_count: requestCount,
    measurement_methods: ["provider"],
    token_usage: tokens(totalTokens),
    cost: cost(totalCost),
  }
}

function envelope(data: unknown, status = 200) {
  return new Response(
    JSON.stringify({
      success: status >= 200 && status < 300,
      data,
      request_id: "application-usage-request",
    }),
    { status, headers: { "content-type": "application/json" } }
  )
}
