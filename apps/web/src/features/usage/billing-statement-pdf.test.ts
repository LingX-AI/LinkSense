import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const renderedPageTexts = vi.hoisted(() => [] as string[])
const html2canvas = vi.hoisted(() =>
  vi.fn(async (page: HTMLElement) => {
    renderedPageTexts.push(page.textContent ?? "")
    const footer = page.querySelector("footer")
    const content = footer?.previousElementSibling
    if (!footer || !content) throw new Error("Missing PDF content or footer")
    expect(content.getBoundingClientRect().bottom).toBeLessThanOrEqual(
      footer.getBoundingClientRect().top - 20
    )
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

describe.each(["zh-CN", "en-US"] as const)(
  "billing statement PDF (%s)",
  (language) => {
    beforeEach(() => {
      // jsdom has no layout engine. Supply measured geometry at the DOM boundary:
      // ten 54px rows already cross the footer, as in the reported export.
      vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
        function (this: Element) {
          const page = this.closest("section")
          if (!page)
            throw new Error("Measurement node must be attached to a page")
          const rows = Array.from(page.querySelectorAll("tbody tr"))
          const tableBottom =
            240 + rows.reduce((height, row) => height + rowHeight(row), 0)
          if (this.tagName === "FOOTER") return new DOMRect(0, 750, 1007, 14)
          if (this.tagName === "TBODY")
            return new DOMRect(0, 240, 1007, tableBottom - 240)
          if (this.tagName === "TR")
            return new DOMRect(0, 240, 1007, rowHeight(this))
          if (this.tagName === "TABLE")
            return new DOMRect(0, 210, 1007, tableBottom - 210)
          return new DOMRect(
            0,
            tableBottom,
            1007,
            page.textContent?.includes(
              labels(language).unpricedNote.split("{{tokens}}")[1]
            )
              ? 110
              : 80
          )
        }
      )
    })

    afterEach(() => {
      vi.restoreAllMocks()
      html2canvas.mockClear()
      addImage.mockClear()
      addPage.mockClear()
      output.mockClear()
      renderedPageTexts.length = 0
    })

    it.each([
      { count: 0, height: 54, unpriced: "0", pageCount: 1 },
      { count: 7, height: 54, unpriced: "0", pageCount: 1 },
      { count: 8, height: 54, unpriced: "0", pageCount: 2 },
      { count: 11, height: 54, unpriced: "0", pageCount: 2 },
      { count: 1, height: 450, unpriced: "100", pageCount: 2 },
      { count: 9, height: 54, unpriced: "0", pageCount: 2 },
      { count: 23, height: 54, unpriced: "0", pageCount: 3 },
      { count: 7, height: 54, unpriced: "100", pageCount: 2 },
      { count: 7, height: 100, unpriced: "100", pageCount: 2 },
    ])(
      "keeps $count rows of height $height and unpriced=$unpriced clear of the footer",
      async ({ count, height, unpriced, pageCount }) => {
        const before = document.body.childElementCount
        const input = pdfInput(count, height, unpriced, language)
        const blob = await createBillingStatementPdf(input)

        expect(blob.type).toBe("application/pdf")
        expect(html2canvas).toHaveBeenCalledTimes(pageCount)
        expect(addImage).toHaveBeenCalledTimes(pageCount)
        expect(addPage).toHaveBeenCalledTimes(pageCount - 1)
        expect(output).toHaveBeenCalledWith("blob")
        for (const [index, text] of renderedPageTexts.entries()) {
          expect(text).toContain(
            labels(language)
              .page.replace("{{current}}", String(index + 1))
              .replace("{{total}}", String(pageCount))
          )
          if (index < pageCount - 1)
            expect(text).not.toContain(labels(language).totalAmount)
        }
        expect(renderedPageTexts.at(-1)).toContain(labels(language).totalAmount)
        const renderedModels = html2canvas.mock.calls.flatMap(([page]) =>
          Array.from(
            page.querySelectorAll("tbody tr"),
            (row) => row.firstElementChild?.textContent
          )
        )
        expect(renderedModels).toEqual(
          input.statement.models.map(
            (model) => `${model.display_name}\n${model.model_id}`
          )
        )
        expect(document.body.childElementCount).toBe(before)
      }
    )

    it("waits for fonts before measuring and cleans up if measurement fails", async () => {
      const before = document.body.childElementCount
      let resolveFonts: () => void = () => {
        throw new Error("Font promise is not initialized")
      }
      const ready = new Promise<void>((resolve) => {
        resolveFonts = resolve
      })
      const originalFonts = Object.getOwnPropertyDescriptor(document, "fonts")
      Object.defineProperty(document, "fonts", {
        configurable: true,
        value: { ready },
      })
      try {
        const exporting = createBillingStatementPdf(
          pdfInput(1, 600, "0", language)
        )
        await vi.waitFor(() =>
          expect(document.body.childElementCount).toBe(before + 1)
        )
        expect(Element.prototype.getBoundingClientRect).not.toHaveBeenCalled()
        resolveFonts()
        await expect(exporting).rejects.toThrow(
          "exceeds the printable page area"
        )
        expect(html2canvas).not.toHaveBeenCalled()
        expect(document.body.childElementCount).toBe(before)
      } finally {
        if (originalFonts)
          Object.defineProperty(document, "fonts", originalFonts)
        else Reflect.deleteProperty(document, "fonts")
      }
    })

    it("removes render nodes and does not output a partial PDF when rendering fails", async () => {
      const before = document.body.childElementCount
      html2canvas.mockRejectedValueOnce(new Error("Canvas render failed"))
      await expect(
        createBillingStatementPdf(pdfInput(11, 54, "0", language))
      ).rejects.toThrow("Canvas render failed")
      expect(output).not.toHaveBeenCalled()
      expect(document.body.childElementCount).toBe(before)
    })
  }
)

function labels(language: "zh-CN" | "en-US") {
  if (language === "en-US")
    return {
      statement: "Monthly statement",
      accountStatement: "Model usage statement",
      statementNumber: "Statement number",
      billingPeriod: "Billing period",
      generatedAt: "Generated at",
      currency: "Currency",
      model: "Model",
      inputTokens: "Input tokens",
      cachedTokens: "Cached tokens",
      outputTokens: "Output tokens",
      totalTokens: "Total tokens",
      pricePerMillion: "Price per million tokens",
      amount: "Amount",
      mixedPricing: "Multiple prices",
      inputShort: "Input",
      cachedShort: "Cached",
      outputShort: "Output",
      totalAmount: "Total amount",
      unpricedNote: "{{tokens}} unpriced tokens",
      page: "Page {{current}} / {{total}}",
      footer:
        "Automatically generated from pricing snapshots recorded at the time of usage.",
    }
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

function rowHeight(row: Element): number {
  return Number(row.textContent?.match(/height=(\d+)/)?.[1] ?? 54)
}

function pdfInput(
  count: number,
  height: number,
  unpriced: string,
  language: "zh-CN" | "en-US"
): Parameters<typeof createBillingStatementPdf>[0] {
  const models = Array.from({ length: count }, (_, index) => ({
    model_id: `model-${index}`,
    display_name: `Model ${index} height=${height}`,
    token_usage: {
      total_tokens: "100",
      input_tokens: "70",
      cached_input_tokens: "10",
      output_tokens: "30",
      reasoning_output_tokens: "5",
    },
    cost: {
      currency: "USD" as const,
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
  return {
    statement: {
      id: "00000000-0000-4000-8000-000000000901",
      statement_number: "LS-202607",
      period: {
        month: "2026-07",
        from: "2026-06-30T16:00:00.000Z",
        to_exclusive: "2026-07-31T16:00:00.000Z",
        time_zone: "Asia/Shanghai",
      },
      currency: "USD",
      status: "generated",
      total_cost: "1.1",
      unpriced_tokens: unpriced,
      generated_at: "2026-07-31T16:05:00.000Z",
      models,
    },
    productName: "LinkSense",
    language,
    labels: labels(language),
  }
}
