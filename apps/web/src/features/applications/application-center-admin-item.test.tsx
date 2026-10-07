import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  applicationCenterReleaseSchema,
  supportedLocales,
} from "@linksense/shared"
import { apiRequest } from "@/api/client"
import i18n from "@/i18n"
import { ApplicationCenterAdminItem } from "./application-center-admin-item"
import { useAdminApplicationReleases } from "./application-distribution-queries"
import { ListCard } from "@/components/ui/list-card"
import { EmptyState, ErrorState } from "@/components/feedback/page-state"
import { getErrorMessage } from "@/api/error-message"
import "@/index.css"

vi.mock("@/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/client")>()),
  apiRequest: vi.fn(),
}))

afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

const release = applicationCenterReleaseSchema.parse({
  id: "11000000-0000-4000-8000-000000000001",
  application_id: "11000000-0000-4000-8000-000000000002",
  version_id: "11000000-0000-4000-8000-000000000003",
  version_number: "1.1.1",
  name: "Research",
  kind: "standard",
  description: "Research and summarize a topic",
  usage_instructions: "Enter a topic",
  publisher_name: "Publisher",
  usage_modes: ["install", "service"],
  release_notes: "Improved research summaries",
  status: "pending",
  listing_status: "draft",
  review_comment: null,
  suspension_reason: null,
  submitted_at: "2026-09-18T00:00:00Z",
  reviewed_at: null,
  installed_application_id: null,
})

function ReviewListHarness() {
  const query = useAdminApplicationReleases()
  if (query.error)
    return (
      <ErrorState
        message={getErrorMessage(query.error, i18n.t)}
        onRetry={() => void query.refetch()}
      />
    )
  if (query.data?.items.length === 0)
    return <EmptyState title={i18n.t("marketplace.reviewsEmpty")} />
  return (
    <ListCard>
      {query.data?.items.map((item) => (
        <ApplicationCenterAdminItem key={item.id} item={item} scope="reviews" />
      ))}
    </ListCard>
  )
}

function show() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <ReviewListHarness />
    </QueryClientProvider>
  )
}

describe("application approval cards", () => {
  it.each(supportedLocales)(
    "requires a comment for removal and keeps approval and restoration comments optional in %s",
    async (locale) => {
      await i18n.changeLanguage(locale)
      for (const [status, listingStatus, required] of [
        ["pending", "draft", false],
        ["approved", "published", true],
        ["approved", "suspended", false],
      ] as const) {
        const current = { ...release, status, listing_status: listingStatus }
        vi.mocked(apiRequest).mockImplementation(async (path) =>
          path === "/admin/application-center"
            ? { items: [current] }
            : {
                release: current,
                instructions: "Review instructions",
                capabilities: [],
                knowledge_base_count: 0,
                mcp_server_count: 0,
                interactive_files: [],
              }
        )
        const view = show()
        await userEvent.click(
          await screen.findByRole("button", {
            name: i18n.t("applications.distribution.review"),
          })
        )
        const dialog = await screen.findByRole("dialog")
        await within(dialog).findByText("Review instructions")
        const comment = within(dialog).getByRole("textbox", {
          name: i18n.t("applications.distribution.reviewComment"),
        })
        const label = comment
          .closest('[data-slot="field"]')
          ?.querySelector('[data-slot="field-label"]')
        if (required) {
          const indicator = label?.querySelector('span[aria-hidden="true"]')
          expect(indicator).toHaveTextContent("*")
          expect(indicator).toHaveClass("text-destructive")
          expect(comment).toHaveAttribute("aria-required", "true")
        } else {
          expect(label).not.toHaveTextContent("*")
          expect(comment).not.toHaveAttribute("aria-required", "true")
        }
        view.unmount()
      }
    }
  )

  it("localizes listing actions with Chinese fallback for missing resources", () => {
    const fallback = i18n.cloneInstance({ forkResourceStore: true })
    fallback.removeResourceBundle("en-US", "translation")
    for (const [key, chinese, english] of [
      ["suspend", "下架应用", "Unlist application"],
      ["resume", "重新上架", "Relist application"],
    ]) {
      const path = `applications.distribution.${key}`
      expect(i18n.t(path, { lng: "zh-CN" })).toBe(chinese)
      expect(i18n.t(path, { lng: "en-US" })).toBe(english)
      expect(fallback.t(path, { lng: "en-US" })).toBe(chinese)
    }
  })
  it.each(["zh-CN", "en-US", "de-DE"])(
    "uses the compact Skill governance list layout and translated metadata in %s",
    async (locale) => {
      await i18n.changeLanguage(locale)
      expect(i18n.resolvedLanguage).toBe(locale === "de-DE" ? "zh-CN" : locale)
      vi.mocked(apiRequest).mockResolvedValue({ items: [release] })
      show()

      const card = await screen.findByRole("article", { name: release.name })
      expect(card).toHaveClass("marketplace-governance-item")
      expect(card.closest('[data-slot="card"]')).toHaveClass("gap-0", "py-0")
      expect(card.querySelector(".capability-logo")).toBeInTheDocument()
      expect(
        card.querySelector('[data-application-icon-preset="bot"]')
      ).toBeInTheDocument()
      const artwork = card.querySelector(
        '[data-application-icon-preset="bot"] svg'
      )
      expect(artwork).toBeInstanceOf(SVGElement)
      if (!(artwork instanceof SVGElement)) throw new Error("Missing artwork")
      expect(getComputedStyle(artwork).width).toBe("32px")
      expect(getComputedStyle(artwork).height).toBe("32px")
      expect(
        within(card).getByRole("heading", { name: release.name })
      ).toBeVisible()
      expect(
        within(card).getByText(i18n.t("applications.details.kinds.standard"))
      ).toBeVisible()
      expect(within(card).getByText("v1.1.1")).toBeVisible()
      expect(
        within(card).getByText("Research and summarize a topic")
      ).toBeVisible()
      expect(
        within(card).getByText(i18n.t("marketplace.status.pending"))
      ).toBeVisible()
      expect(
        within(card).queryByText(i18n.t("marketplace.status.draft"))
      ).not.toBeInTheDocument()
      for (const mode of release.usage_modes) {
        expect(
          within(card).getByText(
            i18n.t(`applications.distribution.modes.${mode}`)
          )
        ).toBeVisible()
      }
      expect(
        within(card).queryByText(release.release_notes)
      ).not.toBeInTheDocument()
      expect(card.querySelector('[data-slot="card-footer"]')).toBeNull()
      expect(
        within(card)
          .getByText(
            i18n.t("marketplace.byPublisher", {
              publisher: release.publisher_name,
            })
          )
          .closest(".marketplace-governance-meta")
      ).not.toBeNull()
      expect(
        within(card)
          .getByRole("button", {
            name: i18n.t("applications.distribution.review"),
          })
          .closest(".marketplace-governance-action")
      ).not.toBeNull()
    }
  )

  it("opens the selected list item with complete release notes", async () => {
    await i18n.changeLanguage("zh-CN")
    const selected = {
      ...release,
      id: "11000000-0000-4000-8000-000000000004",
      name: "A second release",
      kind: "interactive" as const,
      description: null,
      release_notes: "Detailed release notes. ".repeat(80),
    }
    vi.mocked(apiRequest).mockImplementation(async (path) =>
      path === "/admin/application-center"
        ? { items: [release, selected] }
        : {
            release: selected,
            instructions: "Review the application instructions",
            capabilities: [],
            knowledge_base_count: 0,
            mcp_server_count: 0,
            interactive_files: [],
          }
    )
    show()
    const card = await screen.findByRole("article", { name: selected.name })
    expect(screen.getAllByRole("article")).toHaveLength(2)
    expect(screen.getAllByRole("separator")).toHaveLength(1)
    expect(
      within(card).getByText(i18n.t("applications.noDescription"))
    ).toBeVisible()
    expect(
      within(card).getByText(i18n.t("applications.details.kinds.interactive"))
    ).toBeVisible()
    await userEvent.click(
      within(card).getByRole("button", {
        name: i18n.t("applications.distribution.review"),
      })
    )
    const dialog = await screen.findByRole("dialog")
    expect(dialog).toHaveClass(
      "flex",
      "flex-col",
      "max-h-[85dvh]",
      "overflow-hidden"
    )
    expect(dialog).not.toHaveClass("overflow-y-auto")
    const body = dialog.querySelector('[data-slot="dialog-body"]')
    const header = dialog.querySelector<HTMLDivElement>(
      '[data-slot="dialog-header"]'
    )
    const footer = dialog.querySelector<HTMLDivElement>(
      '[data-slot="dialog-footer"]'
    )
    expect(body).toHaveClass(
      "min-h-0",
      "flex-1",
      "overflow-y-auto",
      "overscroll-contain"
    )
    expect(header).toHaveClass("shrink-0")
    expect(footer).toHaveClass("shrink-0", "flex-row", "flex-wrap")
    expect(header?.parentElement).toBe(dialog)
    expect(footer?.parentElement).toBe(dialog)
    expect(body).not.toContainElement(header)
    expect(body).not.toContainElement(footer)
    expect(body).toContainElement(
      within(dialog).getByRole("textbox", {
        name: i18n.t("applications.distribution.reviewComment"),
      })
    )
    expect(
      await within(dialog).findByText(selected.release_notes.trim())
    ).toBeVisible()
    expect(body).toContainElement(
      within(dialog).getByText(selected.release_notes.trim())
    )
    expect(footer).toContainElement(
      within(dialog).getByRole("button", {
        name: i18n.t("applications.distribution.approve"),
      })
    )
    expect(
      within(dialog).getByText(selected.release_notes.trim())
    ).not.toHaveClass("line-clamp-2")
    expect(apiRequest).toHaveBeenCalledWith(
      `/admin/application-center/${selected.id}`,
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    )
  })

  it.each([
    { status: "approved", listing_status: "published", displayed: "published" },
    { status: "approved", listing_status: "suspended", displayed: "unlisted" },
    { status: "approved", listing_status: "unlisted", displayed: "unlisted" },
    { status: "rejected", listing_status: "draft", displayed: "rejected" },
    { status: "withdrawn", listing_status: "unlisted", displayed: "withdrawn" },
  ] as const)(
    "preserves $status / $listing_status states and the review entry",
    async (states) => {
      await i18n.changeLanguage("zh-CN")
      vi.mocked(apiRequest).mockResolvedValue({
        items: [{ ...release, ...states }],
      })
      show()
      const card = await screen.findByRole("article", { name: release.name })
      const status = within(card).getByText(
        i18n.t(`marketplace.status.${states.displayed}`)
      )
      expect(status).toBeVisible()
      expect(status.closest(".marketplace-governance-title-row")).not.toBeNull()
      expect(
        within(card)
          .getByText(i18n.t("applications.distribution.modes.service"))
          .closest(".marketplace-governance-meta")
      ).not.toBeNull()
      expect(
        within(card).queryByText(i18n.t("marketplace.status.approved"))
      ).not.toBeInTheDocument()
      expect(
        within(card).queryByText(/^(已停用|Suspended)$/)
      ).not.toBeInTheDocument()
      expect(
        within(card).getByRole("button", {
          name: i18n.t("applications.distribution.review"),
        })
      ).toBeEnabled()
    }
  )

  it.each(["zh-CN", "en-US", "de-DE"])(
    "shows an approved application as unlisted after administrator removal and published after restoration in %s",
    async (locale) => {
      await i18n.changeLanguage(locale)
      let current = applicationCenterReleaseSchema.parse({
        ...release,
        status: "approved",
        listing_status: "published",
      })
      vi.mocked(apiRequest).mockImplementation(async (path, options) => {
        if (options?.method === "PATCH") {
          current = {
            ...current,
            listing_status:
              current.listing_status === "published"
                ? "suspended"
                : "published",
          }
          return {}
        }
        if (path === "/admin/application-center") return { items: [current] }
        return {
          release: current,
          instructions: "Review instructions",
          capabilities: [],
          knowledge_base_count: 0,
          mcp_server_count: 0,
          interactive_files: [],
        }
      })
      show()
      const card = await screen.findByRole("article", { name: release.name })
      const openReview = async () => {
        await userEvent.click(
          within(card).getByRole("button", {
            name: i18n.t("applications.distribution.review"),
          })
        )
        return screen.findByRole("dialog")
      }
      const dialog = await openReview()
      await userEvent.type(
        within(dialog).getByRole("textbox", {
          name: i18n.t("applications.distribution.reviewComment"),
        }),
        "Review required"
      )
      await userEvent.click(
        await within(dialog).findByRole("button", {
          name: i18n.t("applications.distribution.suspend"),
        })
      )
      const unlistedLabel = locale === "en-US" ? "Unlisted" : "已下架"
      expect(await within(card).findByText(unlistedLabel)).toBeVisible()
      expect(
        within(card).queryByText(i18n.t("marketplace.status.approved"))
      ).not.toBeInTheDocument()
      expect(
        within(card).queryByText(/^(已停用|Suspended)$/)
      ).not.toBeInTheDocument()
      expect(apiRequest).toHaveBeenCalledWith(
        `/admin/application-center/applications/${release.application_id}/status`,
        expect.objectContaining({
          method: "PATCH",
          body: { status: "suspended", reason: "Review required" },
        })
      )
      await waitFor(() =>
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
      )
      const restoreDialog = await openReview()
      await userEvent.click(
        await within(restoreDialog).findByRole("button", {
          name: i18n.t("applications.distribution.resume"),
        })
      )
      expect(
        await within(card).findByText(i18n.t("marketplace.status.published"))
      ).toBeVisible()
      expect(within(card).queryByText(unlistedLabel)).not.toBeInTheDocument()
      expect(apiRequest).toHaveBeenCalledWith(
        `/admin/application-center/applications/${release.application_id}/status`,
        expect.objectContaining({
          method: "PATCH",
          body: { status: "published", reason: "" },
        })
      )
    }
  )

  it("keeps the empty state after retrying a failed request", async () => {
    await i18n.changeLanguage("zh-CN")
    vi.mocked(apiRequest)
      .mockRejectedValueOnce(new Error("Unavailable"))
      .mockResolvedValue({ items: [] })
    show()
    await userEvent.click(
      await screen.findByRole("button", { name: i18n.t("common.retry") })
    )
    expect(
      await screen.findByText(
        i18n.t("marketplace.reviewsEmpty").replace(/[。.]+$/u, "")
      )
    ).toBeVisible()
    expect(screen.queryByRole("article")).not.toBeInTheDocument()
  })
})
