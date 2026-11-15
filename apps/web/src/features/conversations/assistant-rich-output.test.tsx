import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  parseRichOutput,
  richOutputComponents,
  richOutputMarkdownToText,
  type PublicKnowledgeCitation,
  type RichOutput,
} from "@linksense/shared"
import AssistantRichOutput from "./assistant-rich-output"
import {
  AssistantMarkdown,
  ConversationContentPolicyProvider,
} from "./conversation-thread"
import { richOutputMessages } from "./rich-output-messages"
import i18n, { supportedLanguages } from "@/i18n"

function source(
  elements: RichOutput["spec"]["elements"],
  title = "Research result",
  children = Object.keys(elements)
): string {
  return JSON.stringify({
    version: 1,
    summary: "Readable summary",
    spec: {
      root: "result",
      elements: {
        result: {
          type: "Panel",
          props: { title },
          children,
        },
        ...elements,
      },
    },
  })
}
function readingSource() {
  return source(
    {
      views: {
        type: "Tabs",
        props: {
          title: "Report views",
          tabs: [
            { id: "summary", label: "Summary" },
            { id: "notes", label: "Preparation" },
          ],
        },
        children: ["summary", "notes"],
      },
      summary: { type: "Text", props: { text: "Summary visible on open" } },
      notes: {
        type: "Details",
        props: { title: "Check the handoff" },
        children: ["checklist"],
      },
      checklist: {
        type: "Checklist",
        props: {
          title: "Review",
          items: [
            {
              id: "input",
              label: "Verify the input",
              detail: "Use the original source.",
            },
            { id: "result", label: "Check the result" },
          ],
        },
      },
    },
    "Handoff",
    ["views"]
  )
}
const research = source({
  finding: {
    type: "Callout",
    props: { title: "Finding", text: "Verified conclusion", tone: "info" },
  },
  evidence: {
    type: "Evidence",
    props: {
      title: "Source evidence",
      detail: "Verified excerpt",
      citations: [1, 99],
    },
  },
})
const policyCitation: PublicKnowledgeCitation = {
  citation_id: "10000000-0000-4000-8000-000000000031",
  citation_no: 1,
  summary: {
    knowledge_base_name: "Policy library",
    document_name: "Policy.pdf",
    title_path: ["Policy", "Pilot requirements"],
    page_numbers: [2, 4],
  },
  anchors: [{ occurrence_no: 1, after_offset_utf16: 0 }],
}

const researchMarkdown = `\`\`\`json-render\n${research}\n\`\`\``

const data = source({
  numbers: {
    type: "Metric",
    props: { label: "Count", value: 0, unit: "items" },
  },
  chart: {
    type: "Chart",
    props: {
      title: "Trend",
      kind: "line",
      unit: "items",
      points: [
        { id: "a", label: "First", value: 0 },
        { id: "b", label: "Missing", value: null },
        { id: "c", label: "Last", value: -2 },
      ],
    },
  },
})
const expanded = source({
  facts: {
    type: "KeyValue",
    props: {
      title: "File facts",
      items: [
        { id: "count", label: "Count", value: 0 },
        { id: "owner", label: "Owner", value: null },
      ],
    },
  },
  history: {
    type: "Timeline",
    props: {
      title: "History",
      items: [
        {
          id: "start",
          time: "Morning, UTC+8",
          title: "Observed",
          detail: "Recorded evidence",
        },
        { id: "later", title: "Follow-up", detail: "Time unknown" },
      ],
    },
  },
  steps: {
    type: "Steps",
    props: {
      title: "Proposed steps",
      items: [
        { id: "inspect", title: "Inspect", detail: "Read the input" },
        { id: "verify", title: "Verify", detail: "Check the result" },
      ],
    },
  },
  metric: {
    type: "Metric",
    props: {
      label: "Resolved",
      value: 12,
      unit: "items",
      period: "November",
      comparison: { label: "Compared with October", change: 2, unit: "items" },
    },
  },
})

beforeEach(async () => {
  await i18n.changeLanguage("en-US")
})
afterEach(cleanup)

describe("assistant rich output", () => {
  it("selects tabs by keyboard, expands independently and keeps temporary checks through view changes", async () => {
    const user = userEvent.setup()
    render(<AssistantRichOutput source={readingSource()} />)
    const tabs = await screen.findByRole("tablist", { name: "Report views" })
    const summary = within(tabs).getByRole("tab", { name: "Summary" })
    const preparation = within(tabs).getByRole("tab", { name: "Preparation" })
    expect(screen.getByRole("tabpanel", { name: "Summary" })).toHaveTextContent(
      "Summary visible on open"
    )
    expect(
      screen.queryByRole("button", { name: "Check the handoff" })
    ).not.toBeInTheDocument()

    await user.tab()
    expect(summary).toHaveFocus()
    await user.keyboard("{ArrowRight}")
    expect(preparation).toHaveFocus()
    expect(summary).toHaveAttribute("aria-selected", "true")
    await user.keyboard("{Enter}")
    expect(preparation).toHaveAttribute("aria-selected", "true")
    const panel = screen.getByRole("tabpanel", { name: "Preparation" })
    const details = within(panel).getByRole("button", {
      name: "Check the handoff",
    })
    expect(details).toHaveAttribute("aria-expanded", "false")
    expect(within(panel).queryByRole("checkbox")).not.toBeInTheDocument()
    await user.click(details)
    expect(details).toHaveAttribute("aria-expanded", "true")

    const verify = within(panel).getByRole("checkbox", {
      name: "Verify the input",
    })
    const check = within(panel).getByRole("checkbox", {
      name: "Check the result",
    })
    expect(verify).not.toBeChecked()
    expect(verify).toHaveAccessibleDescription("Use the original source.")
    await user.tab()
    expect(verify).toHaveFocus()
    await user.keyboard(" ")
    expect(verify).toBeChecked()
    expect(check).not.toBeChecked()
    await user.click(within(panel).getByText("Check the result"))
    expect(check).toBeChecked()

    await user.click(details)
    expect(details).toHaveFocus()
    expect(within(panel).queryByRole("checkbox")).not.toBeInTheDocument()
    await user.click(summary)
    await user.click(preparation)
    await user.click(details)
    expect(verify).toBeChecked()
    expect(check).toBeChecked()
    await user.click(check)
    expect(check).not.toBeChecked()
  })

  it("starts a fresh card unchecked and includes every hidden item in a read-only copy", async () => {
    const user = userEvent.setup()
    const input = readingSource()
    const { rerender } = render(<AssistantRichOutput source={input} />)
    await user.click(await screen.findByRole("tab", { name: "Preparation" }))
    await user.click(screen.getByRole("button", { name: "Check the handoff" }))
    await user.click(screen.getByRole("checkbox", { name: "Verify the input" }))
    rerender(<AssistantRichOutput source={input} textOnly />)
    const snapshot = screen.getByText(/Readable summary/)
    expect(snapshot).toHaveTextContent("Summary visible on open")
    expect(snapshot).toHaveTextContent("Use the original source.")
    expect(snapshot).toHaveTextContent("- Verify the input")
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument()
    rerender(<AssistantRichOutput source={input} />)
    await user.click(await screen.findByRole("tab", { name: "Preparation" }))
    await user.click(screen.getByRole("button", { name: "Check the handoff" }))
    expect(
      screen.getByRole("checkbox", { name: "Verify the input" })
    ).not.toBeChecked()
  })

  it("presents metadata, ordered events and proposed steps with semantic lists and no execution controls", async () => {
    render(<AssistantRichOutput source={expanded} />)
    const facts = await screen.findByRole("region", { name: "File facts" })
    expect(facts.querySelector("dl dt")).toHaveTextContent("Count")
    expect(within(facts).getByText("0")).toBeVisible()
    expect(within(facts).getByText("No data")).toBeVisible()
    const events = within(
      screen.getByRole("region", { name: "History" })
    ).getAllByRole("listitem")
    expect(events[0]).toHaveTextContent("Morning, UTC+8")
    expect(events[1]).toHaveTextContent("Time unknown")
    expect(
      within(
        screen.getByRole("region", { name: "Proposed steps" })
      ).getAllByRole("listitem")
    ).toHaveLength(2)
    expect(screen.getByText("November")).toBeVisible()
    expect(screen.getByText("+2 items")).toBeVisible()
    expect(screen.queryByRole("button")).not.toBeInTheDocument()
  })

  it.each(["KeyValue", "Timeline", "Steps"] as const)(
    "shows a useful empty state for %s",
    async (type) => {
      render(
        <AssistantRichOutput
          source={source({
            empty: { type, props: { title: "Empty", items: [] } },
          })}
        />
      )
      expect(
        await screen.findByText("There is no data to display.")
      ).toBeVisible()
    }
  )

  it("renders research through json-render and expands evidence using existing controls", async () => {
    const user = userEvent.setup()
    render(
      <AssistantRichOutput
        source={research}
        renderCitation={(number) =>
          number === 1 ? <a href="#verified">Verified source</a> : null
        }
      />
    )
    expect(await screen.findByText("Verified conclusion")).toBeVisible()
    expect(screen.queryByText("Verified excerpt")).not.toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Source evidence" }))
    expect(screen.getByText("Verified excerpt")).toBeVisible()
    expect(
      screen.getByRole("link", { name: "Verified source" })
    ).toHaveAttribute("href", "#verified")
  })

  it("keeps option choices local and isolates state between result blocks", async () => {
    const user = userEvent.setup()
    const comparison = source({
      choice: {
        type: "Comparison",
        props: {
          title: "Choose a direction",
          options: [
            {
              id: "a",
              title: "Pilot",
              description: "Pilot details",
              benefits: ["Fast feedback"],
              tradeoffs: ["Limited scope"],
            },
            {
              id: "b",
              title: "Full",
              description: "Full details",
              benefits: ["Broad coverage"],
              tradeoffs: ["More work"],
            },
          ],
        },
      },
    })
    render(
      <>
        <AssistantRichOutput source={comparison} />
        <AssistantRichOutput source={comparison} />
      </>
    )
    const groups = await screen.findAllByRole("radiogroup", {
      name: "Choose a direction",
    })
    await user.click(within(groups[0]!).getByRole("radio", { name: "Full" }))
    expect(screen.getByText("Full details")).toBeVisible()
    expect(screen.getByText("Pilot details")).toBeVisible()
    expect(
      within(groups[1]!).getByRole("radio", { name: "Pilot" })
    ).toBeChecked()
  })

  it("sorts raw numeric values, preserves row identity and leaves missing values last", async () => {
    const user = userEvent.setup()
    render(
      <AssistantRichOutput
        source={source({
          table: {
            type: "DataTable",
            props: {
              title: "Values",
              columns: [
                { id: "name", label: "Name" },
                { id: "count", label: "Count" },
              ],
              rows: [
                { id: "ten", values: ["Ten", 10] },
                { id: "two", values: ["Two", 2] },
                { id: "missing", values: ["Missing", null] },
              ],
            },
          },
        })}
      />
    )
    const table = await screen.findByRole("table", { name: "Values" })
    const row = within(table).getByText("Ten").closest("tr")
    const count = within(table).getByRole("button", { name: "Count" })
    await user.click(count)
    expect(
      within(table)
        .getAllByRole("row")
        .slice(1)
        .map((item) => item.textContent)
    ).toEqual(["Two2", "Ten10", "MissingNo data"])
    expect(count.closest("th")).toHaveAttribute("aria-sort", "ascending")
    expect(count).toHaveFocus()
    expect(within(table).getByText("Ten").closest("tr")).toBe(row)
    await user.click(count)
    expect(
      within(table)
        .getAllByRole("row")
        .slice(1)
        .map((item) => item.textContent)
    ).toEqual(["Ten10", "Two2", "MissingNo data"])
    expect(table.querySelectorAll("[aria-sort]")).toHaveLength(1)
  })

  it("offers a chart's exact values as a table without converting missing values to zero", async () => {
    const user = userEvent.setup()
    render(<AssistantRichOutput source={data} />)
    expect(
      await screen.findByText(
        "Missing values remain empty and are not counted as zero."
      )
    ).toBeVisible()
    await user.click(screen.getByRole("button", { name: "Data table" }))
    const table = screen.getByRole("table", { name: "Trend" })
    expect(within(table).getByText("No data")).toBeVisible()
    expect(within(table).getByText("0")).toBeVisible()
    expect(within(table).getByText("-2")).toBeVisible()
    expect(screen.getByRole("button", { name: "Data table" })).toHaveAttribute(
      "aria-pressed",
      "true"
    )
  })

  it("sorts typed dates, shows column units and filters only the current table snapshot", async () => {
    const user = userEvent.setup()
    render(
      <AssistantRichOutput
        source={source({
          table: {
            type: "DataTable",
            props: {
              title: "Records",
              filterable: true,
              columns: [
                { id: "name", label: "Name", type: "text" },
                { id: "count", label: "Count", type: "number", unit: "items" },
                { id: "date", label: "Date", type: "date" },
              ],
              rows: [
                { id: "later", values: ["Later", 10, "2026-11-14"] },
                { id: "earlier", values: ["Earlier", 2, "2026-01-02"] },
                { id: "unknown", values: ["Unknown", null, null] },
              ],
            },
          },
        })}
      />
    )
    const table = await screen.findByRole("table", { name: "Records" })
    expect(
      within(table).getByRole("button", { name: "Count (items)" })
    ).toBeVisible()
    const date = within(table).getByRole("button", { name: "Date" })
    await user.click(date)
    expect(within(table).getAllByRole("row")[1]).toHaveTextContent("Earlier")
    await user.click(date)
    expect(within(table).getAllByRole("row")[1]).toHaveTextContent("Later")
    expect(within(table).getAllByRole("row")[3]).toHaveTextContent("Unknown")
    const filter = screen.getByRole("searchbox", { name: "Filter Records" })
    await user.type(filter, "2026-01-02")
    expect(within(table).getAllByRole("row")).toHaveLength(2)
    expect(screen.getByText("Showing 1 of 3 rows")).toBeVisible()
    await user.clear(filter)
    await user.type(filter, "no-match")
    expect(screen.getByText("No matching data.")).toBeVisible()
    expect(screen.getByText("Showing 0 of 3 rows")).toBeVisible()
    expect(filter).toHaveFocus()
    await user.click(screen.getByRole("button", { name: "Clear" }))
    expect(filter).toHaveFocus()
    expect(within(table).getAllByRole("row")).toHaveLength(4)
    expect(date.closest("th")).toHaveAttribute("aria-sort", "descending")
  })

  it.each([
    { kind: "bar", stacked: false },
    { kind: "bar", stacked: true },
    { kind: "line" },
  ])(
    "shows every series in an exact table for a $kind chart ($stacked)",
    async (variant) => {
      const user = userEvent.setup()
      render(
        <AssistantRichOutput
          source={source({
            chart: {
              type: "Chart",
              props: {
                title: "Comparison",
                unit: "items",
                ...variant,
                series: [
                  { id: "category", label: "Actual" },
                  { id: "target", label: "Target" },
                ],
                points: [
                  { id: "first", label: "First", values: [0, null] },
                  { id: "last", label: "Last", values: [-2, 3] },
                ],
              },
            },
          })}
        />
      )
      const legend = await screen.findByRole("list", { name: "Data series" })
      expect(within(legend).getAllByRole("listitem")).toHaveLength(2)
      expect(
        screen.getByRole("group", { name: "Comparison (items)" })
      ).toBeVisible()
      await user.click(screen.getByRole("button", { name: "Data table" }))
      const table = screen.getByRole("table", { name: "Comparison" })
      expect(
        within(table).getByRole("button", { name: "Actual (items)" })
      ).toBeVisible()
      expect(
        within(table).getByRole("button", { name: "Target (items)" })
      ).toBeVisible()
      expect(within(table).getByText("0")).toBeVisible()
      expect(within(table).getByText("No data")).toBeVisible()
      expect(within(table).getByText("-2")).toBeVisible()
      expect(within(table).getByText("3")).toBeVisible()
    }
  )

  it("handles empty charts, unknown catalog versions, bad JSON and hostile props without executing them", async () => {
    const { rerender } = render(
      <AssistantRichOutput
        source={source({
          chart: {
            type: "Chart",
            props: { title: "Empty", kind: "bar", unit: "items", points: [] },
          },
        })}
      />
    )
    expect(
      await screen.findByText("There is no data to display.")
    ).toBeVisible()
    for (const invalid of [
      "{",
      research.replace('"version":1', '"version":2'),
      research.replace('"tone":"info"', '"tone":"info","onClick":"alert(1)"'),
    ]) {
      rerender(<AssistantRichOutput source={invalid} />)
      expect(screen.getByRole("status")).toHaveTextContent(
        "cannot be displayed"
      )
      expect(
        screen.queryByTestId("assistant-rich-output")
      ).not.toBeInTheDocument()
    }
  })

  it("renders prose and multiple rich blocks after streaming completes, preserving ordinary JSON examples", async () => {
    const content = `Before\n\n\`\`\`json-render\n${research}\n\`\`\`\n\nBetween\n\n\`\`\`json-render\n${data}\n\`\`\`\n\nAfter`
    const { rerender } = render(
      <AssistantMarkdown content={content} streaming />
    )
    expect(
      screen.queryByTestId("assistant-rich-output")
    ).not.toBeInTheDocument()
    expect(screen.getAllByRole("status")).toHaveLength(2)
    rerender(<AssistantMarkdown content={content} />)
    expect(await screen.findAllByTestId("assistant-rich-output")).toHaveLength(
      2
    )
    expect(screen.getByText("Before")).toBeVisible()
    expect(screen.getByText("Between")).toBeVisible()
    expect(screen.getByText("After")).toBeVisible()
    rerender(<AssistantMarkdown content={`\`\`\`json\n${research}\n\`\`\``} />)
    expect(
      screen.queryByTestId("assistant-rich-output")
    ).not.toBeInTheDocument()
    expect(document.querySelector("pre code")).toHaveTextContent('"version":1')
  })

  it("shows the recorded document and location with a keyboard-accessible preview link", async () => {
    const user = userEvent.setup()
    render(
      <AssistantMarkdown
        content={researchMarkdown}
        citations={[policyCitation]}
      />,
      { wrapper: MemoryRouter }
    )
    const panel = await screen.findByRole("region", { name: "Research result" })
    const disclosure = within(panel).getByRole("button", {
      name: "Source evidence",
    })
    expect(within(panel).queryByRole("link")).not.toBeInTheDocument()
    disclosure.focus()
    await user.keyboard("{Enter}")
    const sourceLink = within(panel).getByRole("link", { name: /Policy\.pdf/u })
    expect(sourceLink).toHaveAttribute(
      "href",
      `/knowledge-citations/${policyCitation.citation_id}`
    )
    expect(sourceLink).toHaveTextContent("Policy library")
    expect(sourceLink).toHaveTextContent("Policy / Pilot requirements")
    expect(sourceLink).toHaveTextContent("Pages 2, 4")
    expect(within(panel).getAllByRole("link")).toHaveLength(1)
    expect(within(panel).queryByText("99")).not.toBeInTheDocument()
    await user.tab()
    expect(sourceLink).toHaveFocus()
  })

  it("keeps an older document-level citation readable and omits a missing citation", async () => {
    const user = userEvent.setup()
    const { rerender } = render(
      <AssistantMarkdown
        content={researchMarkdown}
        citations={[
          {
            ...policyCitation,
            summary: {
              ...policyCitation.summary,
              title_path: [],
              page_numbers: [],
            },
          },
        ]}
      />,
      { wrapper: MemoryRouter }
    )
    const panel = await screen.findByRole("region", { name: "Research result" })
    await user.click(
      within(panel).getByRole("button", { name: "Source evidence" })
    )
    expect(
      within(panel).getByRole("link", { name: /Policy\.pdf/u })
    ).toHaveTextContent("Document-level source")

    rerender(<AssistantMarkdown content={researchMarkdown} />)
    expect(within(panel).queryByRole("list")).not.toBeInTheDocument()
    expect(within(panel).getByText("Verified excerpt")).toBeVisible()
  })

  it("projects the evidence block as text without its private source metadata", () => {
    render(
      <ConversationContentPolicyProvider richOutputTextOnly>
        <AssistantMarkdown
          content={researchMarkdown}
          citations={[policyCitation]}
        />
      </ConversationContentPolicyProvider>,
      { wrapper: MemoryRouter }
    )
    expect(screen.getByText(/Verified excerpt/u)).toBeVisible()
    expect(
      screen.queryByRole("link", { name: /Policy\.pdf/u })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByText(/Policy\.pdf|Policy library|Pilot requirements/u)
    ).not.toBeInTheDocument()
  })

  it.each([{ textOnly: true }, { richOutputTextOnly: true }])(
    "uses a text snapshot for restricted/share presentation (%j)",
    async (policy) => {
      render(
        <ConversationContentPolicyProvider {...policy}>
          <AssistantMarkdown
            content={`Before\n\n\`\`\`json-render\n${data}\n\`\`\`\n\nAfter`}
          />
        </ConversationContentPolicyProvider>
      )
      expect(await screen.findByText(/Readable summary/)).toBeVisible()
      expect(
        screen.queryByRole("button", { name: "Data table" })
      ).not.toBeInTheDocument()
      expect(
        screen.queryByTestId("assistant-rich-output")
      ).not.toBeInTheDocument()
    }
  )

  it.each([{ textOnly: true }, { richOutputTextOnly: true }])(
    "preserves all new content in restricted/share snapshots (%j)",
    async (policy) => {
      render(
        <ConversationContentPolicyProvider {...policy}>
          <AssistantMarkdown
            content={`\`\`\`json-render\n${expanded}\n\`\`\``}
          />
        </ConversationContentPolicyProvider>
      )
      const snapshot = await screen.findByText(/Readable summary/)
      for (const detail of [
        "Count: 0",
        "Owner: —",
        "Morning, UTC+8",
        "Recorded evidence",
        "1. Inspect",
        "2. Verify",
        "Compared with October: +2 items",
      ]) {
        expect(snapshot).toHaveTextContent(detail)
      }
      expect(
        screen.queryByTestId("assistant-rich-output")
      ).not.toBeInTheDocument()
    }
  )

  it("copies readable data without exposing invalid rich output payloads", () => {
    const copied = richOutputMarkdownToText(
      `Before\n\n\`\`\`json-render\n${data}\n\`\`\`\n\nAfter`,
      "text"
    )
    expect(copied).toContain("First: 0 items")
    expect(copied).toContain("Missing: —")
    expect(copied).not.toContain('"elements"')
    expect(richOutputMarkdownToText("Old plain Markdown", "text")).toBe(
      "Old plain Markdown"
    )
    expect(
      richOutputMarkdownToText("```json-render\nbad JSON\n```", "text")
    ).toBe("")
    expect(Object.keys(richOutputComponents)).toHaveLength(17)
    expect(parseRichOutput(data)).not.toBeNull()
  })

  it.each(supportedLanguages)(
    "provides all fixed messages and Chinese fallback in %s",
    (locale) => {
      const fallback = i18n.cloneInstance({ forkResourceStore: true })
      const keys = Object.keys(richOutputMessages["zh-CN"])
      expect(Object.keys(richOutputMessages[locale])).toEqual(keys)
      for (const key of keys) {
        expect(
          i18n.t(`richOutput.${key}`, { lng: locale, column: "Name" })
        ).not.toContain("richOutput.")
      }
      if (locale !== "zh-CN")
        fallback.removeResourceBundle(locale, "translation")
      expect(fallback.t("richOutput.invalid", { lng: locale })).toBe(
        richOutputMessages["zh-CN"].invalid
      )
      expect(
        i18n.t("richOutput.sort", { lng: locale, column: "Name" })
      ).toContain("Name")
      expect(
        i18n.t("richOutput.filter", { lng: locale, title: "Records" })
      ).toContain("Records")
      const rowCount = i18n.t("richOutput.rowCount", {
        lng: locale,
        shown: 3,
        total: 8,
      })
      expect(rowCount).toContain("3")
      expect(rowCount).toContain("8")
      for (const key of keys) {
        expect(
          (
            richOutputMessages[locale][
              key as keyof (typeof richOutputMessages)["zh-CN"]
            ].match(/\{\{\w+\}\}/gu) ?? []
          ).sort()
        ).toEqual(
          (
            richOutputMessages["zh-CN"][
              key as keyof (typeof richOutputMessages)["zh-CN"]
            ].match(/\{\{\w+\}\}/gu) ?? []
          ).sort()
        )
      }
    }
  )
})
