import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { I18nextProvider } from "react-i18next"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { ApplicationIcon } from "@linksense/shared"
import { Button } from "@/components/ui/button"
import i18n from "@/i18n"
import { enUS } from "@/i18n/en-US"
import { zhCN } from "@/i18n/zh-CN"
import {
  ApplicationCard,
  ApplicationCardResources,
  ApplicationCardModel,
} from "./application-card"

afterEach(cleanup)

const id = "11000000-0000-4000-8000-000000000001"
const name = "Research assistant"
const icon = { type: "preset", preset: "sparkles" } satisfies ApplicationIcon

function showCard({
  name: cardName = name,
  kind = "standard",
  status = "active",
  developing = false,
  description = "A research assistant",
  model = null,
  version,
  onDetails = vi.fn(),
  onUse = vi.fn(),
}: {
  name?: string
  kind?: "standard" | "interactive"
  status?: "active" | "disabled"
  developing?: boolean
  description?: string | null
  model?: string | null
  version?: string
  onDetails?: () => void
  onUse?: () => void
} = {}) {
  return render(
    <ApplicationCard
      id={id}
      name={cardName}
      kind={kind}
      icon={icon}
      version={version}
      status={status}
      developing={developing}
      description={description}
      onOpenDetails={onDetails}
      footer={i18n.t("applications.createdByMe")}
      actions={
        <Button onClick={onUse} disabled={status === "disabled"}>
          {i18n.t("applications.distribution.useService")}
        </Button>
      }
    >
      <ApplicationCardResources
        capability_count={2}
        knowledge_base_count={1}
        mcp_server_count={0}
      />
      <ApplicationCardModel model={model} />
    </ApplicationCard>
  )
}

describe("application card presentation", () => {
  it.each(["zh-CN", "en-US"])(
    "groups the name, resources, status and footer without changing their data in %s",
    async (language) => {
      await i18n.changeLanguage(language)
      showCard({ kind: "interactive", version: "1.2.3", model: "gpt-5.6-luna" })
      const card = screen.getByRole("article", { name })
      const title = within(card).getByRole("heading", { name })
      const header = title.closest('[data-slot="card-header"]')
      expect(header).toHaveTextContent(i18n.t("applications.interactiveApp"))
      expect(header).toHaveTextContent("v1.2.3")
      expect(header).toHaveTextContent(i18n.t("applications.status.active"))
      const status = within(card).getByText(
        i18n.t("applications.status.active")
      )
      expect(
        title.closest('[data-slot="application-card-title-row"]')
      ).not.toContainElement(status)
      expect(
        card.querySelector('[data-slot="application-card-metadata"]')
      ).toContainElement(status)
      expect(title).not.toContainElement(status)
      expect(
        title.compareDocumentPosition(status) & Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy()
      expect(
        card.querySelector('[data-slot="card-content"]')
      ).not.toContainElement(status)
      expect(header).not.toHaveTextContent(i18n.t("applications.createdByMe"))
      const resources = within(card).getByRole("list", {
        name: i18n.t("applications.details.resources"),
      })
      expect(
        within(resources)
          .getAllByRole("listitem")
          .map((item) => item.textContent)
      ).toEqual([
        i18n.t("applications.card.capabilityCount", { count: 2 }),
        i18n.t("applications.card.knowledgeBaseCount", { count: 1 }),
        i18n.t("applications.card.mcpServerCount", { count: 0 }),
      ])
      expect(resources).not.toHaveTextContent("gpt-5.6-luna")
      const model = within(card).getByText("gpt-5.6-luna")
      expect(model.closest('[data-slot="card-content"]')).not.toBeNull()
      expect(model.closest('[data-slot="card-header"]')).toBeNull()
      const owner = within(card).getByText(i18n.t("applications.createdByMe"))
      const footer = owner.closest('[data-slot="card-footer"]')
      expect(footer).toHaveClass("border-t")
      expect(
        within(card)
          .getByRole("button", {
            name: i18n.t("applications.distribution.useService"),
          })
          .closest('[data-slot="card-footer"]')
      ).toBe(footer)
    }
  )

  it.each(["zh-CN", "en-US"])(
    "groups neutral development and enabled statuses below the name and overlays the original icon in %s",
    async (language) => {
      await i18n.changeLanguage(language)
      showCard({ kind: "interactive", developing: true, version: "1.2.3" })
      const card = screen.getByRole("article", { name })
      const title = within(card).getByRole("heading", { name })
      const row = title.closest('[data-slot="application-card-title-row"]')
      const developing = within(card).getByText(
        i18n.t("applicationDevelopment.publish.draft")
      )
      const enabled = within(card).getByText(
        i18n.t("applications.status.active")
      )
      expect(row).not.toContainElement(developing)
      expect(row).not.toContainElement(enabled)
      const metadata = card.querySelector(
        '[data-slot="application-card-metadata"]'
      )
      expect(metadata).toHaveTextContent(i18n.t("applications.interactiveApp"))
      expect(metadata).toHaveTextContent("v1.2.3")
      expect(metadata).toContainElement(developing)
      expect(metadata).toContainElement(enabled)
      expect(metadata).toHaveClass("flex-wrap", "gap-x-2")
      expect(row?.querySelector('[data-slot="badge"]')).toBeNull()
      expect(
        developing.closest('[data-slot="application-card-development-status"]')
      ).not.toHaveClass("text-application-create-accent")
      expect(
        enabled.closest('[data-slot="application-card-status"]')
      ).toHaveClass("text-muted-foreground", "font-normal", "gap-x-2")
      const dots = card.querySelectorAll(
        '[data-slot="application-card-status"] [aria-hidden="true"]'
      )
      expect(dots).toHaveLength(2)
      for (const dot of dots) {
        expect(dot).toHaveTextContent("·")
        expect(dot).not.toHaveClass("rounded-full")
      }
      expect(row).toHaveClass("min-w-0")
      const overlay = card.querySelector<HTMLElement>(
        '[data-slot="application-card-development-overlay"]'
      )
      expect(overlay).toHaveAttribute("aria-hidden", "true")
      expect(overlay).toHaveClass(
        "pointer-events-none",
        "absolute",
        "right-0",
        "bottom-0",
        "size-6",
        "bg-card/80"
      )
      expect(overlay?.querySelector("svg.lucide-code-xml")).toBeInTheDocument()
      expect(card.querySelector("svg.lucide-construction")).toBeNull()
      const tile = card.querySelector('[data-slot="application-card-icon"]')
      expect(tile).toContainElement(overlay)
      expect(
        tile?.querySelector('[data-application-icon-preset="sparkles"]')
      ).toBeInTheDocument()
      expect(
        card.querySelector('[data-slot="card-content"]')
      ).not.toHaveTextContent(i18n.t("applicationDevelopment.publish.draft"))
    }
  )

  it.each(["active", "disabled"] as const)(
    "does not mark an unchanged %s application as in development",
    async (status) => {
      await i18n.changeLanguage("zh-CN")
      showCard({ status })
      const card = screen.getByRole("article", { name })
      expect(
        card.querySelector('[data-slot="application-card-development-overlay"]')
      ).toBeNull()
      expect(within(card).queryByText("开发中")).not.toBeInTheDocument()
      expect(
        card.querySelector('[data-slot="application-card-metadata"]')
      ).toHaveTextContent(i18n.t(`applications.status.${status}`))
      expect(
        within(card).getAllByText(i18n.t(`applications.status.${status}`))
      ).toHaveLength(1)
    }
  )

  it("keeps the card flat on hover and preserves independent detail and action buttons", async () => {
    await i18n.changeLanguage("zh-CN")
    const onDetails = vi.fn()
    const onUse = vi.fn()
    showCard({ onDetails, onUse })
    const user = userEvent.setup()
    const card = screen.getByRole("article", { name })
    await user.hover(card)
    expect(card).toHaveClass("shadow-none")
    expect(card.className).not.toMatch(/(?:hover|group-hover):[^\s]*shadow/)
    expect(
      card.querySelector('[data-slot="application-card-icon"]')
    ).toHaveClass("rounded-lg")
    const details = screen.getByRole("button", {
      name: i18n.t("applications.details.open", { name }),
    })
    await user.click(details)
    expect(onDetails).toHaveBeenCalledWith({ id, name, trigger: details })
    await user.click(
      screen.getByRole("button", {
        name: i18n.t("applications.distribution.useService"),
      })
    )
    expect(onUse).toHaveBeenCalledOnce()
    expect(onDetails).toHaveBeenCalledOnce()
  })

  it.each([
    ["zh-CN", "普通应用"],
    ["en-US", "Standard application"],
  ])(
    "renders an existing standard app with no description, model or version in %s",
    async (language, kindLabel) => {
      await i18n.changeLanguage(language)
      showCard({ status: "disabled", description: null })
      const card = screen.getByRole("article", { name })
      expect(within(card).getByText(kindLabel)).toBeVisible()
      expect(
        within(card).getByText(i18n.t("applications.noDescription"))
      ).toBeVisible()
      expect(
        within(card).getByText(i18n.t("applications.status.disabled"))
      ).toBeVisible()
      expect(
        within(card).getByRole("button", {
          name: i18n.t("applications.distribution.useService"),
        })
      ).toBeDisabled()
      expect(
        card.querySelector('[data-slot="application-card-model"]')
      ).toBeNull()
      expect(within(card).getByRole("list")).toHaveTextContent("MCP 0")
    }
  )

  it("contains long descriptions and model names without discarding the original values", async () => {
    await i18n.changeLanguage("en-US")
    const model = "provider/" + "long-model-name-".repeat(12)
    const description =
      "A long description without whitespace: " + "application".repeat(80)
    showCard({ model, description })
    expect(screen.getByText(description)).toHaveClass(
      "line-clamp-2",
      "wrap-anywhere"
    )
    expect(screen.getByText(model)).toHaveAttribute("title", model)
    expect(screen.getByText(model)).toHaveClass("truncate", "min-w-0")
  })

  it("lets a long application name use two lines above compact statuses and keeps details accessible", async () => {
    await i18n.changeLanguage("zh-CN")
    const longName = "交互式资源匹配与研究报告生成应用"
    const onDetails = vi.fn()
    showCard({ name: longName, developing: true, onDetails })
    const heading = screen.getByRole("heading", { name: longName })
    expect(heading).toHaveClass("line-clamp-2", "wrap-anywhere")
    expect(heading).toHaveAttribute("title", longName)
    const details = screen.getByRole("button", {
      name: i18n.t("applications.details.open", { name: longName }),
    })
    expect(within(details).getByText(longName)).toHaveClass(
      "line-clamp-2",
      "whitespace-normal"
    )
    expect(within(details).getByText(longName)).not.toHaveClass("truncate")
    const row = heading.closest('[data-slot="application-card-title-row"]')
    expect(row).not.toHaveTextContent("开发中")
    expect(row).not.toHaveTextContent("已启用")
    expect(row?.querySelectorAll('[data-slot="badge"]')).toHaveLength(0)
    await userEvent.click(details)
    expect(onDetails).toHaveBeenCalledWith({
      id,
      name: longName,
      trigger: details,
    })
  })

  it("provides both languages and renders Chinese when the English card translations are missing", async () => {
    expect(Object.keys(zhCN.applications.card)).toEqual(
      Object.keys(enUS.applications.card)
    )
    const fallback = i18n.cloneInstance({ forkResourceStore: true })
    fallback.removeResourceBundle("en-US", "translation")
    await fallback.changeLanguage("en-US")
    render(
      <I18nextProvider i18n={fallback}>
        <ApplicationCard
          id={id}
          name={name}
          kind="standard"
          icon={icon}
          description={null}
          developing
          status="active"
          footer={null}
          actions={null}
        />
        <ApplicationCardResources
          capability_count={0}
          knowledge_base_count={0}
          mcp_server_count={0}
        />
      </I18nextProvider>
    )
    expect(screen.getByRole("list", { name: "应用资源" })).toHaveTextContent(
      "插件 / Skill 0"
    )
    expect(screen.getByText("普通应用")).toBeVisible()
    expect(
      screen
        .getByText("草稿")
        .closest('[data-slot="application-card-metadata"]')
    ).toContainElement(screen.getByText("已启用"))
    for (const key of Object.keys(zhCN.applications.card)) {
      const path = `applications.card.${key}`
      expect(i18n.t(path, { lng: "zh-CN", count: 1 })).not.toBe(path)
      expect(i18n.t(path, { lng: "en-US", count: 1 })).not.toBe(path)
      expect(fallback.t(path, { count: 1 })).toBe(
        i18n.t(path, { lng: "zh-CN", count: 1 })
      )
    }
  })
})
