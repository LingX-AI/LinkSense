import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { MemoryRouter } from "react-router-dom"

const downloadBlob = vi.hoisted(() => vi.fn())
vi.mock("@/lib/download-blob", () => ({ downloadBlob }))
const createBillingStatementPdf = vi.hoisted(() =>
  vi.fn(async () => new Blob(["pdf"], { type: "application/pdf" }))
)
vi.mock("@/features/usage/billing-statement-pdf", () => ({
  createBillingStatementPdf,
}))

import { setAccessToken } from "@/api/session"
import i18n from "@/i18n"
import { UsageAnalyticsPage } from "@/pages/admin-usage-page"

const report = {
  range: "all",
  generated_at: "2026-07-27T12:00:00.000Z",
  period: {
    from: null,
    to: "2026-07-27T12:00:00.000Z",
    time_zone: "UTC",
  },
  token_coverage: {
    started_at: "2026-07-27T00:00:00.000Z",
    complete_for_period: false,
  },
  group_semantics: "current_membership_coverage",
  totals: metrics(3, 6, "1200"),
  token_trend: {
    granularity: "day",
    points: [
      {
        period_start: "2026-07-25",
        token_usage: metrics(0, 0, "300").token_usage,
        cost: costForTokens("300"),
        workloads: [workload("assistant_response", 1, "300")],
      },
      {
        period_start: "2026-07-26",
        token_usage: metrics(0, 0, "400").token_usage,
        cost: costForTokens("400"),
        workloads: [workload("assistant_response", 1, "400")],
      },
      {
        period_start: "2026-07-27",
        token_usage: metrics(0, 0, "500").token_usage,
        cost: costForTokens("500"),
        workloads: [workload("assistant_response", 1, "500")],
      },
    ],
  },
  workloads: [
    workload("assistant_response", 5, "1000"),
    workload("document_embedding", 1, "200", "estimated"),
    workload("task_title_generation", 1, "0"),
  ],
  models: [
    model("gpt-5.6-sol", "GPT 5.6 Sol", 5, "1000"),
    model(
      "embedding-v1",
      "Embedding V1",
      1,
      "200",
      "embedding",
      "document_embedding",
      "estimated"
    ),
  ],
  applications: [
    {
      application_id: "50000000-0000-4000-8000-000000000001",
      application_name: "知识助手",
      is_unattributed: false,
      metrics: metrics(2, 4, "800"),
      models: [model("gpt-5.6-sol", "GPT 5.6 Sol", 4, "800")],
    },
    {
      application_id: null,
      application_name: "Unattributed",
      is_unattributed: true,
      metrics: metrics(1, 2, "400"),
      models: [model("gpt-5.6-terra", "GPT 5.6 Terra", 2, "400")],
    },
  ],
  groups: [
    {
      group_id: "40000000-0000-4000-8000-000000000001",
      group_name: "研发组",
      is_ungrouped: false,
      member_count: 1,
      metrics: metrics(2, 4, "800"),
      models: [model("gpt-5.6-sol", "GPT 5.6 Sol", 4, "800")],
    },
    {
      group_id: "40000000-0000-4000-8000-000000000002",
      group_name: "试点组",
      is_ungrouped: false,
      member_count: 1,
      metrics: metrics(2, 4, "800"),
      models: [model("gpt-5.6-sol", "GPT 5.6 Sol", 4, "800")],
    },
    {
      group_id: null,
      group_name: "Ungrouped",
      is_ungrouped: true,
      member_count: 1,
      metrics: metrics(1, 2, "400"),
      models: [model("gpt-5.6-terra", "GPT 5.6 Terra", 2, "400")],
    },
  ],
  users: [
    {
      user_id: "10000000-0000-4000-8000-000000000001",
      name: "林一",
      email: "lin@example.test",
      role: "user",
      status: "active",
      groups: [
        {
          id: "40000000-0000-4000-8000-000000000001",
          name: "研发组",
        },
        {
          id: "40000000-0000-4000-8000-000000000002",
          name: "试点组",
        },
      ],
      metrics: metrics(2, 4, "800"),
      models: [model("gpt-5.6-sol", "GPT 5.6 Sol", 4, "800")],
    },
    {
      user_id: "10000000-0000-4000-8000-000000000002",
      name: "王二",
      email: "wang@example.test",
      role: "admin",
      status: "disabled",
      groups: [],
      metrics: metrics(1, 2, "400"),
      models: [model("gpt-5.6-terra", "GPT 5.6 Terra", 2, "400")],
    },
  ],
}

describe("administrator usage analytics page", () => {
  it("does not filter user rows while composing a Chinese name", async () => {
    renderUsagePage()
    await userEvent.click(await screen.findByRole("tab", { name: "按用户" }))
    const input = screen.getByRole("textbox", { name: "搜索用户姓名或邮箱" })
    const table = screen.getByRole("table", { name: "用户用量" })
    fireEvent.compositionStart(input)
    fireEvent.input(input, { target: { value: "lin" }, isComposing: true })
    expect(input).toHaveValue("lin")
    await act(async () => {})
    expect(within(table).getByText("wang@example.test")).toBeVisible()
    fireEvent.input(input, { target: { value: "林" }, isComposing: true })
    fireEvent.compositionEnd(input, { data: "林" })
    expect(input).toHaveValue("林")
    await waitFor(() =>
      expect(
        within(table).queryByText("wang@example.test")
      ).not.toBeInTheDocument()
    )
    expect(within(table).getByText("lin@example.test")).toBeVisible()
  })

  beforeEach(async () => {
    downloadBlob.mockReset()
    createBillingStatementPdf.mockClear()
    setAccessToken("usage-access-token")
    await i18n.changeLanguage("zh-CN")
    stubUsageReport(report)
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it("shows totals and model token composition, then drills into groups and users", async () => {
    const interaction = userEvent.setup()
    renderUsagePage()

    expect(
      await screen.findByRole("heading", { name: "用量统计" })
    ).toBeVisible()
    expect(screen.queryByText("Token 数据覆盖范围")).not.toBeInTheDocument()
    expect(await screen.findByText("1.2K")).toBeVisible()
    expect(screen.getByLabelText("¥1.20")).toBeVisible()
    expect(screen.queryByText(/codex/iu)).not.toBeInTheDocument()
    expect(
      screen.getByRole("img", { name: "所选周期的 Token 使用趋势图" })
    ).toBeVisible()
    expect(
      screen.getByRole("img", { name: "所选周期的模型费用趋势图" })
    ).toBeVisible()
    const tokenTrendCard = screen
      .getByText("Token 使用趋势")
      .closest('[data-slot="card"]')
    const costTrendCard = screen
      .getByText("费用趋势")
      .closest('[data-slot="card"]')
    if (!tokenTrendCard || !costTrendCard) {
      throw new Error("Expected usage trend cards")
    }
    const tokenAssistantLegend = tokenTrendCard.querySelector(
      '[data-metric="tokens"][data-workload="assistant_response"]'
    )
    const tokenRerankLegend = tokenTrendCard.querySelector(
      '[data-metric="tokens"][data-workload="rerank"]'
    )
    const costAssistantLegend = costTrendCard.querySelector(
      '[data-metric="cost"][data-workload="assistant_response"]'
    )
    expect(tokenAssistantLegend).toHaveClass(
      "bg-[var(--app-usage-token-assistant)]"
    )
    expect(tokenAssistantLegend).toHaveAttribute("data-has-values", "true")
    expect(tokenRerankLegend).toHaveAttribute("data-has-values", "false")
    expect(costAssistantLegend).toHaveClass(
      "bg-[var(--app-usage-cost-assistant)]"
    )
    expect(costAssistantLegend).toHaveAttribute("data-has-values", "true")
    const globalModels = screen.getByRole("table", { name: "模型明细" })
    expect(globalModels.parentElement).toHaveClass("rounded-card", "border")
    expect(globalModels.closest('[data-slot="card"]')).toBeNull()
    const modelName = within(globalModels).getByText("GPT 5.6 Sol")
    expect(modelName).toBeVisible()
    expect(modelName).toHaveClass("font-normal")
    const modelRow = modelName.closest("tr")
    if (!modelRow) throw new Error("Expected model usage table row")
    for (const cell of within(modelRow).getAllByRole("cell").slice(1)) {
      expect(cell).toHaveClass("font-normal")
    }
    expect(within(globalModels).getByText("1K")).toBeVisible()
    expect(within(globalModels).getByText("缓存输入 Token")).toBeVisible()
    expect(within(globalModels).getByText("推理输出 Token")).toBeVisible()
    expect(screen.getByText(/费用单位：人民币（元）。/u)).toBeVisible()
    expect(
      globalModels.querySelectorAll('span[data-slot="currency-symbol"]').length
    ).toBe(0)

    await interaction.click(screen.getByRole("tab", { name: "按用途" }))
    const workloadTable = screen.getByRole("table", { name: "模型用途用量" })
    expect(within(workloadTable).getByText("文档向量化")).toBeVisible()
    expect(within(workloadTable).getByText("任务自动命名")).toBeVisible()
    expect(within(workloadTable).getByText("本地估算")).toBeVisible()
    expect(workloadTable).not.toHaveTextContent("¥")

    await interaction.click(screen.getByRole("tab", { name: "按模型" }))

    await interaction.click(screen.getByRole("tab", { name: "按应用" }))
    const applicationTable = screen.getByRole("table", { name: "应用用量" })
    expect(within(applicationTable).getByText("知识助手")).toBeVisible()
    expect(within(applicationTable).getByText("未关联应用")).toBeVisible()
    await interaction.click(
      within(applicationTable).getByRole("button", { name: "知识助手" })
    )
    expect(screen.getAllByText("知识助手").length).toBeGreaterThan(1)

    const rangeSelect = screen.getByRole("combobox", { name: "统计周期" })
    expect(rangeSelect).toHaveTextContent("全部时间")
    await interaction.click(rangeSelect)
    await interaction.click(
      await screen.findByRole("option", { name: "最近 7 天" })
    )
    expect(rangeSelect).toHaveTextContent("最近 7 天")
    await waitFor(() => {
      expect(
        vi
          .mocked(fetch)
          .mock.calls.some(([input]) =>
            String(input).includes("/api/v1/admin/usage?range=7d")
          )
      ).toBe(true)
    })

    await interaction.click(screen.getByRole("tab", { name: "按用户组" }))
    expect(screen.getByText(/用户组行不能相加得到全局总量/)).toBeVisible()
    const groupTable = screen.getByRole("table", { name: "用户组用量" })
    await interaction.click(
      within(groupTable).getByRole("button", { name: "试点组" })
    )
    expect(screen.getAllByText("试点组").length).toBeGreaterThan(1)
    for (const table of screen.getAllByRole("table")) {
      expect(table).not.toHaveTextContent("¥")
    }

    await interaction.click(screen.getByRole("tab", { name: "按用户" }))
    await interaction.type(
      screen.getByRole("textbox", { name: "搜索用户姓名或邮箱" }),
      "wang"
    )
    const userTable = screen.getByRole("table", { name: "用户用量" })
    expect(within(userTable).queryByText("lin@example.test")).toBeNull()
    expect(within(userTable).getByText("wang@example.test")).toBeVisible()
    expect(screen.getAllByText("未分组用户").length).toBeGreaterThan(0)
    for (const table of screen.getAllByRole("table")) {
      expect(table).not.toHaveTextContent("¥")
    }
  })

  it("sorts every usage breakdown table from clickable column headers", async () => {
    const interaction = userEvent.setup()
    renderUsagePage()

    const modelTable = await screen.findByRole("table", {
      name: "模型明细",
    })
    await interaction.click(
      within(modelTable).getByRole("button", {
        name: "按总 Token升序排序",
      })
    )
    for (const button of within(modelTable).getAllByRole("button")) {
      expect(button).toHaveClass("text-sm", "font-medium")
    }
    expect(tableColumnText(modelTable, 2)).toEqual(["200", "1K"])
    expect(
      within(modelTable).getByRole("columnheader", {
        name: "总 Token",
      })
    ).toHaveAttribute("aria-sort", "ascending")
    await interaction.click(
      within(modelTable).getByRole("button", {
        name: "按总 Token降序排序",
      })
    )
    expect(tableColumnText(modelTable, 2)).toEqual(["1K", "200"])

    await interaction.click(screen.getByRole("tab", { name: "按用途" }))
    const workloadTable = screen.getByRole("table", { name: "模型用途用量" })
    await interaction.click(
      within(workloadTable).getByRole("button", {
        name: "按总 Token升序排序",
      })
    )
    expect(tableColumnText(workloadTable, 0)).toEqual([
      "任务自动命名",
      "文档向量化",
      "AI 回答",
    ])

    await interaction.click(screen.getByRole("tab", { name: "按应用" }))
    const applicationTable = screen.getByRole("table", { name: "应用用量" })
    await interaction.click(
      within(applicationTable).getByRole("button", {
        name: "按任务数升序排序",
      })
    )
    expect(tableColumnText(applicationTable, 0)).toEqual([
      "未关联应用",
      "知识助手",
    ])

    await interaction.click(screen.getByRole("tab", { name: "按用户组" }))
    const groupTable = screen.getByRole("table", { name: "用户组用量" })
    await interaction.click(
      within(groupTable).getByRole("button", {
        name: "按总 Token升序排序",
      })
    )
    expect(tableColumnText(groupTable, 4)).toEqual(["400", "800", "800"])

    await interaction.click(screen.getByRole("tab", { name: "按用户" }))
    const userTable = screen.getByRole("table", { name: "用户用量" })
    await interaction.click(
      within(userTable).getByRole("button", {
        name: "按任务数升序排序",
      })
    )
    expect(tableColumnText(userTable, 0)[0]).toContain("王二")
    await interaction.click(
      within(userTable).getByRole("button", {
        name: "按任务数降序排序",
      })
    )
    expect(tableColumnText(userTable, 0)[0]).toContain("林一")
  })

  it("exports the current reporting range as an Excel workbook", async () => {
    const interaction = userEvent.setup()
    renderUsagePage()

    const rangeSelect = await screen.findByRole("combobox", {
      name: "统计周期",
    })
    await interaction.click(rangeSelect)
    await interaction.click(
      await screen.findByRole("option", { name: "最近 7 天" })
    )
    const exportButton = await screen.findByRole("button", {
      name: "导出 Excel",
    })
    await interaction.click(exportButton)

    await waitFor(() => {
      expect(
        vi
          .mocked(fetch)
          .mock.calls.some(([input]) =>
            String(input).includes(
              "/api/v1/admin/usage/export.xlsx?range=7d&time_zone="
            )
          )
      ).toBe(true)
    })
    expect(downloadBlob).toHaveBeenCalledWith(
      expect.any(Blob),
      expect.stringMatching(/^LinkSense-用量统计-\d{4}-\d{2}-\d{2}\.xlsx$/u)
    )
    expect(exportButton).toBeEnabled()
  })

  it("shows a custom calendar range and includes it in the analytics query", async () => {
    const interaction = userEvent.setup()
    renderUsagePage()

    const rangeSelect = await screen.findByRole("combobox", {
      name: "统计周期",
    })
    await interaction.click(rangeSelect)
    await interaction.click(
      await screen.findByRole("option", { name: "自定义范围" })
    )

    expect(screen.getByLabelText("开始日期")).toBeVisible()
    expect(screen.getByLabelText("结束日期")).toBeVisible()
    await waitFor(() => {
      const customRequest = vi
        .mocked(fetch)
        .mock.calls.map(([input]) => String(input))
        .find((url) => url.includes("range=custom"))
      expect(customRequest).toBeDefined()
      expect(customRequest).toMatch(/date_from=\d{4}-\d{2}-\d{2}/u)
      expect(customRequest).toMatch(/date_to=\d{4}-\d{2}-\d{2}/u)
      expect(customRequest).toContain("time_zone=")
    })
  })

  it("renders the Token trend and custom range labels in English", async () => {
    await i18n.changeLanguage("en-US")
    const interaction = userEvent.setup()
    renderUsagePage()

    expect(await screen.findByText("Token usage trend")).toBeVisible()
    expect(screen.getByRole("button", { name: "Export Excel" })).toBeVisible()
    expect(screen.queryByText(/codex/iu)).not.toBeInTheDocument()
    const rangeSelect = screen.getByRole("combobox", {
      name: "Reporting period",
    })
    await interaction.click(rangeSelect)
    expect(
      await screen.findByRole("option", { name: "Custom range" })
    ).toBeVisible()
    expect(
      screen.getByText(
        /Costs retain full precision for storage and aggregation/
      )
    ).toBeVisible()
    expect(screen.getByText(/Cost unit: CNY \(yuan\)\./u)).toBeVisible()
  })

  it("allocates sub-cent differences so two-decimal details match their total", async () => {
    const interaction = userEvent.setup()
    stubUsageReport(roundingReport())
    renderUsagePage()

    const modelTable = await screen.findByRole("table", {
      name: "模型明细",
    })
    expect(tableColumnText(modelTable, 3)).toEqual(["0.00", "0.01"])
    expect(screen.getByText(/费用以完整精度保存和汇总/)).toBeVisible()

    await interaction.click(screen.getByRole("tab", { name: "按用户" }))
    const userTable = screen.getByRole("table", { name: "用户用量" })
    expect(tableColumnText(userTable, 5)).toEqual(["0.00", "0.01"])

    await interaction.type(
      screen.getByRole("textbox", { name: "搜索用户姓名或邮箱" }),
      "wang"
    )
    expect(tableColumnText(userTable, 5)).toEqual(["0.01"])
  })

  it.each([0, 1, 30])(
    "keeps the preview header and footer outside the scroll area with %i model rows",
    async (modelCount) => {
      const interaction = userEvent.setup()
      const statement = billingStatementFixture()
      const model = statement.models[0]
      if (!model) throw new Error("Expected a billing model fixture")
      statement.models = Array.from({ length: modelCount }, (_, index) => ({
        ...model,
        model_id: `model-${index}`,
      }))
      const statementSummary = structuredClone(statement)
      delete (statementSummary as { models?: unknown }).models
      vi.stubGlobal(
        "fetch",
        vi.fn((request: RequestInfo | URL) => {
          const url = String(request)
          const data = url.includes("/bills/00000000-")
            ? statement
            : url.includes("/bills")
              ? {
                  generated_at: "2026-08-01T00:05:00.000Z",
                  current_period: {
                    period: {
                      month: "2026-08",
                      from: "2026-07-31T16:00:00.000Z",
                      to_exclusive: "2026-08-31T16:00:00.000Z",
                      time_zone: "Asia/Shanghai",
                    },
                    expected_generation_at: "2026-08-31T16:05:00.000Z",
                  },
                  statements: [statementSummary],
                }
              : report
          return Promise.resolve(
            new Response(JSON.stringify({ success: true, data }), {
              status: 200,
              headers: { "content-type": "application/json" },
            })
          )
        })
      )

      const { container } = renderUsagePage()
      await screen.findByRole("heading", { name: "用量统计" })
      expect(
        screen.getByRole("banner").closest(".management-page")
      ).toHaveAttribute("data-content-width", "wide")
      await interaction.click(screen.getByRole("tab", { name: "账单" }))
      expect(
        screen.getByRole("banner").closest(".management-page")
      ).toHaveAttribute("data-content-width", "standard")

      expect(await screen.findByText("月度账单")).toBeVisible()
      expect(screen.getByText("账单将在自然月结束后自动生成。")).toBeVisible()
      expect(screen.getByText("2026年7月")).toBeVisible()
      expect(screen.getByText("¥1.23")).toBeVisible()
      expect(screen.queryByText("已生成")).not.toBeInTheDocument()
      expect(screen.getByRole("button", { name: "在线预览" })).toBeVisible()
      await interaction.click(screen.getByRole("button", { name: "在线预览" }))
      expect(
        await screen.findByRole("heading", { name: "账单明细" })
      ).toBeVisible()
      if (modelCount > 0)
        expect(screen.getAllByText("GPT 5.6 Sol")[0]).toBeVisible()
      const dialog = container.ownerDocument.querySelector(
        '[data-slot="dialog-content"]'
      )
      expect(dialog?.querySelector("table")).toHaveClass("table-fixed")
      expect(dialog?.querySelector("table")).toHaveClass("text-[13px]")
      expect(dialog?.querySelector('[class*="overflow-x-auto"]')).toBeNull()
      if (!(dialog instanceof HTMLElement))
        throw new Error("Expected billing dialog")
      const dialogElement = dialog
      const scrollArea = within(dialogElement).getByRole("region", {
        name: "账单明细",
      })
      const header = dialog.querySelector('[data-slot="dialog-header"]')
      const footer = dialog.querySelector('[data-slot="dialog-footer"]')
      if (
        !(header instanceof HTMLElement) ||
        !(footer instanceof HTMLElement)
      ) {
        throw new Error("Expected billing dialog header and footer")
      }
      expect(dialog).toHaveClass(
        "flex",
        "flex-col",
        "overflow-hidden",
        "max-h-[88dvh]"
      )
      expect(dialog).not.toHaveClass("overflow-y-auto")
      expect(scrollArea).toHaveClass("min-h-0", "overflow-y-auto")
      expect(scrollArea).toHaveAttribute("tabindex", "0")
      expect(header?.parentElement).toBe(dialog)
      expect(footer?.parentElement).toBe(dialog)
      expect(header).toHaveClass("shrink-0")
      expect(footer).toHaveClass("shrink-0")
      expect(scrollArea).not.toContainElement(header)
      expect(scrollArea).not.toContainElement(footer)
      expect(scrollArea.querySelectorAll("tbody tr")).toHaveLength(modelCount)
      expect(footer).toContainElement(
        within(dialogElement).getByRole("button", { name: "导出 PDF" })
      )
      expect(footer).toHaveTextContent("¥1.23")
      await interaction.click(
        within(dialogElement).getByRole("button", { name: "导出 PDF" })
      )
      await waitFor(() => expect(createBillingStatementPdf).toHaveBeenCalled())
      expect(downloadBlob).toHaveBeenCalledWith(
        expect.any(Blob),
        "LS-202607-账单.pdf"
      )
    }
  )

  it("provides English billing and PDF labels", async () => {
    await i18n.changeLanguage("en-US")

    expect(i18n.t("usage.sections.billing")).toBe("Billing")
    expect(i18n.t("usage.billing.current.description")).toBe(
      "The statement is generated automatically after the calendar month closes."
    )
    expect(i18n.t("usage.billing.history.title")).toBe("Monthly statements")
    expect(i18n.t("usage.billing.preview.action")).toBe("Preview online")
    expect(i18n.t("usage.billing.export.action")).toBe("Export PDF")
    expect(i18n.t("usage.billing.pdf.statement")).toBe("Monthly Statement")
  })
})

function billingStatementFixture() {
  return {
    id: "00000000-0000-4000-8000-000000000901",
    statement_number: "LS-202607",
    period: {
      month: "2026-07",
      from: "2026-06-30T16:00:00.000Z",
      to_exclusive: "2026-07-31T16:00:00.000Z",
      time_zone: "Asia/Shanghai",
    },
    currency: "CNY",
    status: "generated",
    total_cost: "1.23",
    unpriced_tokens: "0",
    generated_at: "2026-07-31T16:05:00.000Z",
    models: [
      {
        model_id: "gpt-5.6-sol",
        display_name: "GPT 5.6 Sol",
        token_usage: {
          total_tokens: "1200",
          input_tokens: "800",
          cached_input_tokens: "200",
          output_tokens: "400",
          reasoning_output_tokens: "100",
        },
        cost: {
          currency: "CNY",
          total_cost: "1.23",
          input_cost: "0.4",
          cached_input_cost: "0.03",
          output_cost: "0.8",
          unpriced_tokens: "0",
        },
        pricing: {
          mode: "uniform",
          input_price_per_million: "5",
          cached_input_price_per_million: "0.5",
          output_price_per_million: "15",
        },
      },
    ],
  }
}

function stubUsageReport(data: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ success: true, data }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      )
    )
  )
}

function tableColumnText(table: HTMLElement, columnIndex: number): string[] {
  return within(table)
    .getAllByRole("row")
    .slice(1)
    .map(
      (row) =>
        within(row).getAllByRole("cell")[columnIndex]?.textContent?.trim() ?? ""
    )
}

function roundingReport() {
  const costs = [exactCost("0.005"), exactCost("0.007")]
  return {
    ...report,
    totals: { ...report.totals, cost: exactCost("0.012") },
    models: report.models.map((item, index) => ({
      ...item,
      cost: costs[index],
    })),
    workloads: report.workloads.map((item, index) => ({
      ...item,
      cost: costs[index] ?? exactCost("0"),
    })),
    users: report.users.map((user, index) => ({
      ...user,
      metrics: { ...user.metrics, cost: costs[index] },
      models: user.models.map((item) => ({
        ...item,
        cost: costs[index],
      })),
    })),
  }
}

function exactCost(totalCost: string) {
  return {
    currency: "CNY" as const,
    total_cost: totalCost,
    input_cost: totalCost,
    cached_input_cost: "0",
    output_cost: "0",
    unpriced_tokens: "0",
  }
}

function renderUsagePage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <UsageAnalyticsPage />
      </QueryClientProvider>
    </MemoryRouter>
  )
}

function metrics(taskCount: number, turnCount: number, totalTokens: string) {
  const total = BigInt(totalTokens)
  return {
    task_count: taskCount,
    turn_count: turnCount,
    request_count: turnCount,
    token_usage: {
      total_tokens: total.toString(),
      input_tokens: ((total * 2n) / 3n).toString(),
      cached_input_tokens: (total / 6n).toString(),
      output_tokens: (total / 3n).toString(),
      reasoning_output_tokens: (total / 12n).toString(),
    },
    cost: costForTokens(totalTokens),
  }
}

function model(
  modelId: string,
  displayName: string,
  turnCount: number,
  totalTokens: string,
  modelKind: "generation" | "embedding" | "rerank" = "generation",
  workloadType:
    | "assistant_response"
    | "task_title_generation"
    | "document_embedding"
    | "query_embedding"
    | "rerank" = "assistant_response",
  measurementMethod: "provider" | "estimated" = "provider"
) {
  return {
    model_id: modelId,
    display_name: displayName,
    model_kind: modelKind,
    workload_types: [workloadType],
    measurement_methods: [measurementMethod],
    request_count: turnCount,
    turn_count: turnCount,
    token_usage: metrics(0, 0, totalTokens).token_usage,
    cost: costForTokens(totalTokens),
  }
}

function workload(
  workloadType:
    | "assistant_response"
    | "task_title_generation"
    | "document_embedding"
    | "query_embedding"
    | "rerank",
  requestCount: number,
  totalTokens: string,
  measurementMethod: "provider" | "estimated" = "provider"
) {
  return {
    workload: workloadType,
    request_count: requestCount,
    measurement_methods: [measurementMethod],
    token_usage: metrics(0, 0, totalTokens).token_usage,
    cost: costForTokens(totalTokens),
  }
}

function costForTokens(totalTokens: string) {
  const total = BigInt(totalTokens)
  const whole = total / 1000n
  const fraction = (total % 1000n)
    .toString()
    .padStart(3, "0")
    .replace(/0+$/u, "")
  const totalCost = fraction === "" ? whole.toString() : `${whole}.${fraction}`
  return {
    currency: "CNY" as const,
    total_cost: totalCost,
    input_cost: totalCost,
    cached_input_cost: "0",
    output_cost: "0",
    unpriced_tokens: "0",
  }
}
