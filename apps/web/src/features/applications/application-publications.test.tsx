import type { ReactNode } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  applicationCenterReleaseSchema,
  applicationSchema,
} from "@linksense/shared"
import { apiRequest } from "@/api/client"
import i18n from "@/i18n"
import { ApplicationPublicationCard } from "./application-publication-card"
import { ApplicationPublicationPicker } from "./application-publication-picker"

vi.mock("@/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/client")>()),
  apiRequest: vi.fn(),
}))
afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})
beforeEach(async () => {
  await i18n.changeLanguage("zh-CN")
})
const id = "11000000-0000-4000-8000-000000000001"
const now = "2026-09-16T00:00:00.000Z"
const release = applicationCenterReleaseSchema.parse({
  id,
  application_id: id,
  version_id: id,
  version_number: "1.0.0",
  name: "Reports",
  kind: "standard",
  description: null,
  usage_instructions: "",
  publisher_name: "Publisher",
  usage_modes: ["install", "service"],
  release_notes: "",
  status: "pending",
  listing_status: "draft",
  review_comment: null,
  suspension_reason: null,
  submitted_at: now,
  reviewed_at: null,
  installed_application_id: null,
})
const application = applicationSchema.parse({
  id,
  owner: { id, name: "Publisher" },
  name: "Reports",
  icon: { type: "preset", preset: "bot" },
  description: null,
  instructions: "Report",
  model: null,
  reasoning_effort: null,
  status: "active",
  is_owner: true,
  can_manage: true,
  access_source: "owner",
  capability_count: 0,
  knowledge_base_count: 0,
  mcp_server_count: 0,
  dependencies_available: true,
  capabilities: [],
  knowledge_bases: [],
  mcp_servers: [],
  created_at: now,
  updated_at: now,
})
function show(content: ReactNode) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      {content}
    </QueryClientProvider>
  )
}
describe("application publications", () => {
  it.each([
    ["approved", "published", "published"],
    ["approved", "unlisted", "unlisted"],
    ["pending", "published", "pending"],
    ["rejected", "published", "rejected"],
    ["withdrawn", "draft", "withdrawn"],
    ["pending", "suspended", "suspended"],
  ] as const)(
    "shows %s releases in %s listings as %s",
    async (status, listing_status, displayed) => {
      const onManage = vi.fn()
      render(
        <ApplicationPublicationCard
          release={{
            ...release,
            status,
            listing_status,
            review_comment: "Review reason",
            suspension_reason: "Suspension reason",
          }}
          onManage={onManage}
        />
      )
      const card = screen.getByRole("article", { name: "Reports" })
      expect(
        within(card).getByText(i18n.t(`marketplace.status.${displayed}`))
      ).toBeVisible()
      expect(
        within(card).getByText(
          listing_status === "suspended" ? "Suspension reason" : "Review reason"
        )
      ).toBeVisible()
      expect(within(card).getByText("应用")).toBeVisible()
      await userEvent.click(
        within(card).getByRole("button", { name: "管理上架" })
      )
      expect(onManage).toHaveBeenCalledOnce()
    }
  )
  it("offers only active owned applications and forwards the selected application", async () => {
    vi.mocked(apiRequest).mockResolvedValue({
      items: [
        application,
        {
          ...application,
          id: "disabled",
          name: "Disabled",
          status: "disabled",
        },
        { ...application, id: "shared", name: "Shared", is_owner: false },
      ],
      next_cursor: null,
    })
    const onSelect = vi.fn()
    show(<ApplicationPublicationPicker onClose={vi.fn()} onSelect={onSelect} />)
    expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true")
    const option = await screen.findByRole("button", { name: "Reports" })
    expect(
      screen.queryByRole("button", { name: "Disabled" })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "Shared" })
    ).not.toBeInTheDocument()
    await userEvent.click(option)
    expect(onSelect).toHaveBeenCalledWith(application)
    expect(apiRequest).toHaveBeenCalledWith(
      "/applications",
      expect.objectContaining({
        query: { scope: "owned", search: undefined, limit: 200 },
      })
    )
  })
  it("shows an empty result after retrying a failed search and supports closing", async () => {
    vi.mocked(apiRequest)
      .mockRejectedValueOnce(new Error("Offline"))
      .mockResolvedValue({ items: [], next_cursor: null })
    const onClose = vi.fn()
    show(<ApplicationPublicationPicker onClose={onClose} onSelect={vi.fn()} />)
    await userEvent.click(await screen.findByRole("button", { name: "重试" }))
    expect(
      await screen.findByText(
        i18n.t("marketplace.noPublishableApplication").replace(/[。.]+$/u, "")
      )
    ).toBeVisible()
    await userEvent.type(
      screen.getByRole("textbox", { name: "搜索应用" }),
      "report"
    )
    expect(apiRequest).toHaveBeenLastCalledWith(
      "/applications",
      expect.objectContaining({
        query: { scope: "owned", search: "report", limit: 200 },
      })
    )
    await userEvent.click(screen.getByRole("button", { name: "关闭" }))
    expect(onClose).toHaveBeenCalledOnce()
  })
})
