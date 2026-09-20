import { readFileSync } from "node:fs"
import { cleanup, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { PersonalQuotaChart } from "./personal-quota-chart"
import { personalQuotaChartColors } from "./personal-quota-data"

afterEach(cleanup)
describe("personal quota chart presentation", () => {
  it("renders line legends as a compact row of colored dots and names without per-series totals", () => {
    const { container } = render(
      <PersonalQuotaChart
        title="Plugin calls"
        description="Activity"
        dates={["2026-09-20"]}
        rows={[
          { date: "2026-09-20", name: "Computer Use", amount: "60" },
          { date: "2026-09-20", name: "Codex App Tools", amount: "21" },
        ]}
      />
    )
    const legend = screen.getByRole("list", { name: "Plugin calls" })
    expect(legend).toHaveClass("flex", "flex-wrap", "items-center")
    const items = within(legend).getAllByRole("listitem")
    expect(items.map((item) => item.textContent)).toEqual([
      "Computer Use",
      "Codex App Tools",
    ])
    items.forEach((item, index) => {
      expect(item.querySelector("circle")).toHaveAttribute(
        "fill",
        personalQuotaChartColors[index]
      )
      expect(item.querySelector("svg")).toHaveAttribute("aria-hidden", "true")
      expect(item.querySelector("span")).toHaveClass("truncate")
    })
    expect(screen.getByText("81")).toBeVisible()
    expect(screen.getByText("81")).toHaveClass("text-2xl")
    expect(screen.getByText("81")).not.toHaveClass("text-3xl")
    expect(within(legend).queryByText("60")).not.toBeInTheDocument()
    expect(container.querySelector("dl")).not.toBeInTheDocument()
  })

  it("does not display a legend for an empty line chart", () => {
    render(
      <PersonalQuotaChart
        title="Plugin calls"
        description="Activity"
        dates={["2026-09-20"]}
        rows={[]}
      />
    )
    expect(screen.queryByRole("list")).not.toBeInTheDocument()
  })

  it("uses existing color tokens defined for both light and dark themes", () => {
    const css = readFileSync("src/index.css", "utf8")
    for (const color of personalQuotaChartColors) {
      const token = color.slice(4, -1)
      expect(css.match(new RegExp(`${token}:`, "g"))).toHaveLength(2)
    }
    expect(new Set(personalQuotaChartColors).size).toBe(5)
    const { container } = render(
      <PersonalQuotaChart
        title="History"
        description="Usage"
        dates={["2026-09-20"]}
        kind="bar"
        rows={[
          { date: "2026-09-20", name: "Model A", amount: "12610.951119" },
          { date: "2026-09-20", name: "Model B", amount: "2.80622" },
        ]}
      />
    )
    expect(container.querySelector("style")?.textContent).toContain(
      "var(--app-usage-cost-assistant)"
    )
    expect(
      container.querySelectorAll("rect[fill='var(--app-usage-cost-assistant)']")
    ).toHaveLength(1)
    expect(screen.getByText("12,611")).toBeVisible()
    expect(container.querySelector("p.text-3xl")).toHaveTextContent("12,614")
    expect(screen.getByText("3")).toBeVisible()
    expect(screen.queryByText("12,610.951119")).not.toBeInTheDocument()
  })
})
