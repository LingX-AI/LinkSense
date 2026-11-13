import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  parseRichOutput,
  richOutputComponents,
  richOutputMarkdownToText,
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
  title = "Research result"
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
          children: Object.keys(elements),
        },
        ...elements,
      },
    },
  })
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

beforeEach(async () => {
  await i18n.changeLanguage("en-US")
})
afterEach(cleanup)

describe("assistant rich output", () => {
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

  it("resolves only citations already supplied with the answer", async () => {
    const user = userEvent.setup()
    render(
      <AssistantMarkdown
        content={`\`\`\`json-render\n${research}\n\`\`\``}
        citations={[
          {
            citation_id: "10000000-0000-4000-8000-000000000031",
            citation_no: 1,
            summary: {
              knowledge_base_name: "Policy library",
              document_name: "Policy.pdf",
              title_path: ["Policy"],
              page_numbers: [1],
            },
            anchors: [],
          },
        ]}
      />,
      { wrapper: MemoryRouter }
    )
    const panel = await screen.findByRole("region", { name: "Research result" })
    await user.click(
      within(panel).getByRole("button", { name: "Source evidence" })
    )
    expect(within(panel).getAllByRole("link")).toHaveLength(1)
    expect(within(panel).getByRole("link")).toHaveTextContent("1")
    expect(within(panel).queryByText("99")).not.toBeInTheDocument()
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
    expect(Object.keys(richOutputComponents)).toHaveLength(9)
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
    }
  )
})
