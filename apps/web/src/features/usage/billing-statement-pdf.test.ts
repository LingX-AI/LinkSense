import { afterEach, describe, expect, it, vi } from "vitest"

const renderedPageTexts = vi.hoisted(() => [] as string[])
const html2canvas = vi.hoisted(() =>
  vi.fn(async (page: HTMLElement) => {
    renderedPageTexts.push(page.textContent ?? "")
    return { toDataURL: () => "data:image/jpeg;base64,test" }
  })
)
const addImage = vi.hoisted(() => vi.fn())
const addPage = vi.hoisted(() => vi.fn())
const output = vi.hoisted(() =>
  vi.fn(() => new Blob(["pdf"], { type: "application/pdf" }))
)
vi.mock("html2canvas-pro", () => ({ default: html2canvas }))
vi.mock("jspdf", () => ({
  jsPDF: class JsPdfMock {
    addImage = addImage
    addPage = addPage
    output = output
  },
}))

import { createBillingStatementPdf } from "./billing-statement-pdf"

describe("billing statement PDF", () => {
  afterEach(() => {
    html2canvas.mockClear()
    addImage.mockClear()
    addPage.mockClear()
    output.mockClear()
    renderedPageTexts.length = 0
  })

  it("reserves the final page for the summary and removes off-screen render nodes", async () => {
    const models = Array.from({ length: 11 }, (_, index) => ({
      model_id: `model-${index}`,
      display_name: `Model ${index}`,
      token_usage: {
        total_tokens: "100",
        input_tokens: "70",
        cached_input_tokens: "10",
        output_tokens: "30",
        reasoning_output_tokens: "5",
      },
      cost: {
        currency: "CNY" as const,
        total_cost: "0.1",
        input_cost: "0.04",
        cached_input_cost: "0.01",
        output_cost: "0.05",
        unpriced_tokens: "0",
      },
      pricing: {
        mode: "uniform" as const,
        input_price_per_million: "1",
        cached_input_price_per_million: "0.1",
        output_price_per_million: "2",
      },
    }))
    const before = document.body.childElementCount

    const blob = await createBillingStatementPdf({
      statement: {
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
        total_cost: "1.1",
        unpriced_tokens: "0",
        generated_at: "2026-07-31T16:05:00.000Z",
        models,
      },
      productName: "LinkSense",
      language: "zh-CN",
      labels: labels(),
    })

    expect(blob.type).toBe("application/pdf")
    expect(html2canvas).toHaveBeenCalledTimes(2)
    expect(addImage).toHaveBeenCalledTimes(2)
    expect(addPage).toHaveBeenCalledOnce()
    expect(output).toHaveBeenCalledWith("blob")
    expect(renderedPageTexts[0]).not.toContain("本期合计")
    expect(renderedPageTexts[1]).toContain("本期合计")
    expect(document.body.childElementCount).toBe(before)
  })
})

function labels() {
  return {
    statement: "月度账单",
    accountStatement: "模型用量对账单",
    statementNumber: "账单编号",
    billingPeriod: "账单周期",
    generatedAt: "生成时间",
    currency: "币种",
    model: "模型",
    inputTokens: "输入",
    cachedTokens: "缓存",
    outputTokens: "输出",
    totalTokens: "总计",
    pricePerMillion: "单价",
    amount: "金额",
    mixedPricing: "多种单价",
    inputShort: "输入",
    cachedShort: "缓存",
    outputShort: "输出",
    totalAmount: "本期合计",
    unpricedNote: "{{tokens}} 未计价",
    page: "第 {{current}} / {{total}} 页",
    footer: "自动生成",
  }
}
