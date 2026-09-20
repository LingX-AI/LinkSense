import type { ApplicationDevelopmentSummary } from "@linksense/shared"
import { cleanup, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import i18n from "@/i18n"
import { ApplicationDevelopmentSummaryContent } from "./application-development-summary"

const development: ApplicationDevelopmentSummary = {
  id: "10000000-0000-4000-8000-000000000001",
  conversation_id: null,
  name: "Research draft",
  description: "Research description\nFull details remain available.",
  icon: { type: "preset", preset: "book-open" },
  capability_count: 2,
  knowledge_base_count: 1,
  mcp_server_count: 0,
  has_changes: true,
  updated_at: "2026-09-18T06:25:00Z",
}

afterEach(async () => {
  cleanup()
  await i18n.changeLanguage("zh-CN")
})

describe("development summary hierarchy", () => {
  it.each(["zh-CN", "en-US", "fr-FR"])(
    "groups the draft with compact typography and secondary metadata in %s",
    async (locale) => {
      await i18n.changeLanguage(locale)
      render(
        <ApplicationDevelopmentSummaryContent
          development={development}
          published
        />
      )
      const section = screen.getByRole("region", {
        name: i18n.t("applicationDevelopment.catalog.draftDetails"),
      })
      expect(section.querySelector('[data-slot="card"]')).toHaveAttribute(
        "data-appearance",
        "soft"
      )
      expect(
        within(section).getByRole("heading", {
          name: development.name,
          level: 4,
        })
      ).toHaveClass("text-sm", "font-medium")
      const description = within(section).getByText(
        /Full details remain available/
      )
      expect(description).toHaveClass(
        "text-xs",
        "leading-5",
        "text-muted-foreground",
        "whitespace-pre-wrap",
        "wrap-anywhere"
      )
      expect(description).not.toHaveClass("line-clamp-2", "truncate")
      expect(
        within(section).getByText(
          i18n.t("applicationDevelopment.catalog.newDevelopment")
        )
      ).toHaveClass("font-normal")
      expect(section.querySelector("time")).toHaveAttribute(
        "dateTime",
        development.updated_at
      )
      expect(section.querySelector("time")).toHaveClass(
        "text-xs",
        "tabular-nums"
      )
      expect(
        section.querySelector('[data-slot="card-header"]')
      ).toContainElement(section.querySelector("time"))
      const counts = within(section).getByRole("list", {
        name: i18n.t("applications.details.resources"),
      })
      expect(description.parentElement).toContainElement(counts)
      expect(counts).toHaveTextContent(
        i18n.t("applications.card.capabilityCount", { count: 2 })
      )
      expect(counts).toHaveTextContent(
        i18n.t("applications.card.knowledgeBaseCount", { count: 1 })
      )
      expect(counts).toHaveTextContent(
        i18n.t("applications.card.mcpServerCount", { count: 0 })
      )
      expect(
        within(section).getByText(
          i18n.t("applicationDevelopment.catalog.unpublishedHint")
        )
      ).toHaveClass("text-xs", "leading-5", "text-muted-foreground")
    }
  )

  it("keeps standalone drafts readable with long names and missing description or icon", () => {
    const name = "VeryLongUnbrokenApplicationName".repeat(20)
    render(
      <ApplicationDevelopmentSummaryContent
        development={{
          ...development,
          name,
          description: null,
          icon: undefined,
        }}
      />
    )
    expect(screen.getByRole("heading", { name, level: 4 })).toHaveClass(
      "wrap-anywhere"
    )
    expect(screen.getByText(i18n.t("applications.noDescription"))).toBeVisible()
    expect(
      screen.getByText(i18n.t("applicationDevelopment.publish.draft"))
    ).toBeVisible()
    expect(
      screen.queryByText(
        i18n.t("applicationDevelopment.catalog.unpublishedHint")
      )
    ).not.toBeInTheDocument()
    expect(
      document.querySelector('[data-application-icon-preset="bot"]')
    ).not.toBeNull()
    expect(
      document.querySelector('[data-application-icon-preset="bot"] svg')
    ).toHaveClass("size-full")
  })
})
