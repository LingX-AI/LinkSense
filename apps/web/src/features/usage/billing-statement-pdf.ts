import type { BillingStatementDetail } from "@/api/contracts"
import type { SupportedLanguage } from "@/i18n"
import { formatCnyCost, formatIntegerCount } from "@/lib/usage-number"

export type BillingPdfLabels = {
  statement: string
  accountStatement: string
  statementNumber: string
  billingPeriod: string
  generatedAt: string
  currency: string
  model: string
  inputTokens: string
  cachedTokens: string
  outputTokens: string
  totalTokens: string
  pricePerMillion: string
  amount: string
  mixedPricing: string
  inputShort: string
  cachedShort: string
  outputShort: string
  totalAmount: string
  unpricedNote: string
  page: string
  footer: string
}

type Language = SupportedLanguage
const footerContentGap = 24

export async function createBillingStatementPdf(input: {
  statement: BillingStatementDetail
  productName: string
  language: Language
  labels: BillingPdfLabels
}): Promise<Blob> {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import("html2canvas-pro"),
    import("jspdf"),
  ])
  const measurement = buildPage({
    ...input,
    rows: input.statement.models,
    pageIndex: 0,
    pageCount: 1,
  })
  document.body.append(measurement.page)
  let pages: BillingStatementDetail["models"][]
  try {
    // Measure after fonts load: translated labels and model names can wrap.
    await document.fonts?.ready
    const contentHeight =
      measurement.footer.getBoundingClientRect().top -
      footerContentGap -
      measurement.body.getBoundingClientRect().top
    const summaryHeight =
      measurement.summary.getBoundingClientRect().bottom -
      measurement.table.getBoundingClientRect().bottom
    pages = paginateRows(
      input.statement.models,
      Array.from(
        measurement.body.rows,
        (row) => row.getBoundingClientRect().height
      ),
      contentHeight,
      summaryHeight
    )
  } finally {
    measurement.page.remove()
  }
  const pdf = new jsPDF({
    orientation: "landscape",
    unit: "mm",
    format: "a4",
    compress: true,
  })

  for (const [index, rows] of pages.entries()) {
    const { page } = buildPage({
      ...input,
      rows,
      pageIndex: index,
      pageCount: pages.length,
    })
    document.body.append(page)
    try {
      await document.fonts?.ready
      const canvas = await html2canvas(page, {
        backgroundColor: "#ffffff",
        scale: 2,
        logging: false,
        useCORS: true,
      })
      if (index > 0) pdf.addPage("a4", "landscape")
      pdf.addImage(canvas.toDataURL("image/jpeg", 0.94), "JPEG", 0, 0, 297, 210)
    } finally {
      page.remove()
    }
  }

  return pdf.output("blob")
}

function buildPage(input: {
  statement: BillingStatementDetail
  productName: string
  language: Language
  labels: BillingPdfLabels
  rows: BillingStatementDetail["models"]
  pageIndex: number
  pageCount: number
}) {
  const page = element("section", {
    position: "fixed",
    left: "-10000px",
    top: "0",
    width: "1123px",
    height: "794px",
    boxSizing: "border-box",
    padding: "52px 58px 44px",
    background: "#fff",
    color: "#171717",
    fontFamily:
      '"Noto Sans SC Variable", "Noto Sans SC", Inter, Arial, sans-serif',
  })
  const header = element("header", {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    paddingBottom: "25px",
    borderBottom: "2px solid #171717",
  })
  const brand = element("div")
  brand.append(
    textElement("div", input.productName, {
      fontSize: "24px",
      fontWeight: "700",
      letterSpacing: "-0.4px",
    }),
    textElement("div", input.labels.accountStatement, {
      marginTop: "5px",
      color: "#737373",
      fontSize: "12px",
      letterSpacing: "1.5px",
      textTransform: "uppercase",
    })
  )
  header.append(
    brand,
    textElement("div", input.labels.statement, {
      fontSize: "30px",
      fontWeight: "700",
      letterSpacing: "-0.8px",
    })
  )
  page.append(header)

  const facts = element("div", {
    display: "grid",
    gridTemplateColumns: "1.2fr 1.3fr 1.3fr 0.7fr",
    gap: "28px",
    padding: "22px 0 25px",
  })
  facts.append(
    fact(input.labels.statementNumber, input.statement.statement_number),
    fact(
      input.labels.billingPeriod,
      formatPeriod(
        input.statement.period.from,
        input.statement.period.to_exclusive,
        input.language
      )
    ),
    fact(
      input.labels.generatedAt,
      new Intl.DateTimeFormat(input.language, {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: input.statement.period.time_zone,
      }).format(new Date(input.statement.generated_at))
    ),
    fact(input.labels.currency, input.statement.currency)
  )
  page.append(facts)

  const table = element("table", {
    width: "100%",
    borderCollapse: "collapse",
    tableLayout: "fixed",
    fontSize: "10px",
  })
  const colgroup = document.createElement("colgroup")
  for (const width of [25, 11, 11, 11, 11, 21, 10]) {
    const col = document.createElement("col")
    col.style.width = `${width}%`
    colgroup.append(col)
  }
  table.append(colgroup)
  const head = document.createElement("thead")
  const headRow = document.createElement("tr")
  ;[
    input.labels.model,
    input.labels.inputTokens,
    input.labels.cachedTokens,
    input.labels.outputTokens,
    input.labels.totalTokens,
    input.labels.pricePerMillion,
    input.labels.amount,
  ].forEach((label, index) =>
    headRow.append(
      cell("th", label, {
        padding: "9px 8px",
        borderTop: "1px solid #a3a3a3",
        borderBottom: "1px solid #a3a3a3",
        color: "#525252",
        fontSize: "9px",
        fontWeight: "600",
        textAlign: index === 0 ? "left" : "right",
        whiteSpace: "normal",
      })
    )
  )
  head.append(headRow)
  table.append(head)
  const body = document.createElement("tbody")
  for (const model of input.rows) {
    const row = document.createElement("tr")
    const modelName = model.display_name
      ? `${model.display_name}\n${model.model_id}`
      : model.model_id
    const price =
      model.pricing.mode === "mixed"
        ? input.labels.mixedPricing
        : [
            `${input.labels.inputShort} ${formatPrice(model.pricing.input_price_per_million, input.language)}`,
            `${input.labels.cachedShort} ${formatPrice(model.pricing.cached_input_price_per_million, input.language)}`,
            `${input.labels.outputShort} ${formatPrice(model.pricing.output_price_per_million, input.language)}`,
          ].join("  ·  ")
    const values = [
      modelName,
      formatIntegerCount(model.token_usage.input_tokens, input.language),
      formatIntegerCount(model.token_usage.cached_input_tokens, input.language),
      formatIntegerCount(model.token_usage.output_tokens, input.language),
      formatIntegerCount(model.token_usage.total_tokens, input.language),
      price,
      formatCnyCost(model.cost.total_cost, input.language),
    ]
    values.forEach((value, index) =>
      row.append(
        cell("td", value, {
          height: "39px",
          padding: "7px 8px",
          borderBottom: "1px solid #e5e5e5",
          textAlign: index === 0 ? "left" : "right",
          whiteSpace: index === 0 ? "pre-line" : "normal",
          overflowWrap: "anywhere",
          verticalAlign: "middle",
          color: index === 0 ? "#171717" : "#404040",
          fontWeight: index === 6 ? "600" : "400",
        })
      )
    )
    body.append(row)
  }
  table.append(body)
  page.append(table)

  const summary = element("div", { display: "flow-root" })
  const isLastPage = input.pageIndex === input.pageCount - 1
  if (isLastPage) {
    const total = element("div", {
      display: "flex",
      justifyContent: "flex-end",
      alignItems: "baseline",
      gap: "28px",
      marginTop: "19px",
      paddingTop: "17px",
      borderTop: "2px solid #171717",
    })
    total.append(
      textElement("span", input.labels.totalAmount, {
        color: "#525252",
        fontSize: "11px",
        textTransform: "uppercase",
        letterSpacing: "1px",
      }),
      textElement(
        "strong",
        formatCnyCost(input.statement.total_cost, input.language),
        { fontSize: "25px", fontWeight: "700" }
      )
    )
    summary.append(total)
    if (input.statement.unpriced_tokens !== "0") {
      summary.append(
        textElement(
          "p",
          input.labels.unpricedNote.replace(
            "{{tokens}}",
            formatIntegerCount(input.statement.unpriced_tokens, input.language)
          ),
          { marginTop: "10px", color: "#737373", fontSize: "9px" }
        )
      )
    }
  }
  if (isLastPage) page.append(summary)
  const footer = element("footer", {
    position: "absolute",
    left: "58px",
    right: "58px",
    bottom: "30px",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-end",
    gap: "24px",
    lineHeight: "1.4",
    color: "#8a8a8a",
    fontSize: "9px",
  })
  footer.append(
    textElement("span", input.labels.footer),
    textElement(
      "span",
      input.labels.page
        .replace("{{current}}", String(input.pageIndex + 1))
        .replace("{{total}}", String(input.pageCount)),
      { flexShrink: "0", whiteSpace: "nowrap" }
    )
  )
  page.append(footer)
  return { page, table, body, summary, footer }
}

function fact(label: string, value: string) {
  const container = element("div")
  container.append(
    textElement("div", label, {
      color: "#737373",
      fontSize: "9px",
      fontWeight: "600",
      letterSpacing: "0.7px",
      textTransform: "uppercase",
    }),
    textElement("div", value, {
      marginTop: "5px",
      fontSize: "11px",
      fontWeight: "500",
    })
  )
  return container
}

function formatPeriod(from: string, toExclusive: string, language: Language) {
  const formatter = new Intl.DateTimeFormat(language, {
    year: "numeric",
    month: "short",
    day: "2-digit",
  })
  const to = new Date(new Date(toExclusive).getTime() - 1)
  return `${formatter.format(new Date(from))} — ${formatter.format(to)}`
}

function formatPrice(value: string | null, language: Language) {
  return value === null
    ? "—"
    : `¥${Number(value).toLocaleString(language, { maximumFractionDigits: 6 })}`
}

function paginateRows<T>(
  rows: T[],
  rowHeights: number[],
  contentHeight: number,
  summaryHeight: number
): T[][] {
  const pages: T[][] = []
  let page: T[] = []
  let usedHeight = 0
  for (const [index, row] of rows.entries()) {
    const height = rowHeights[index]
    if (height === undefined || height > contentHeight) {
      throw new Error("Billing statement row exceeds the printable page area")
    }
    if (usedHeight + height > contentHeight && page.length > 0) {
      pages.push(page)
      page = []
      usedHeight = 0
    }
    page.push(row)
    usedHeight += height
  }

  // Keep the total and the optional unpriced note together on the last page.
  if (usedHeight + summaryHeight > contentHeight) {
    const lastRow = page.pop()
    const lastHeight = rowHeights.at(-1) ?? 0
    if (lastRow !== undefined && lastHeight + summaryHeight <= contentHeight) {
      if (page.length > 0) pages.push(page)
      page = [lastRow]
    } else {
      if (lastRow !== undefined) page.push(lastRow)
      if (page.length > 0) pages.push(page)
      page = []
    }
  }
  pages.push(page)
  return pages
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  styles: Partial<CSSStyleDeclaration> = {}
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  Object.assign(node.style, styles)
  return node
}

function textElement<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  value: string,
  styles: Partial<CSSStyleDeclaration> = {}
) {
  const node = element(tag, styles)
  node.textContent = value
  return node
}

function cell<K extends "th" | "td">(
  tag: K,
  value: string,
  styles: Partial<CSSStyleDeclaration>
) {
  return textElement(tag, value, styles)
}
