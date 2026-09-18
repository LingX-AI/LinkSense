import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter, useLocation } from "react-router-dom"
import { afterEach, describe, expect, it, vi } from "vitest"
import { applicationDevelopmentSchema } from "@linksense/shared"
import { apiRequest } from "@/api/client"
import i18n from "@/i18n"
import { ApplicationDevelopmentCard } from "./application-development-card"

vi.mock("@/api/client", async (original) => ({
  ...(await original<typeof import("@/api/client")>()),
  apiRequest: vi.fn(),
}))
const id = "11000000-0000-4000-8000-000000000001"
const taskId = "11000000-0000-4000-8000-000000000002"
afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})
function Location() {
  return <div data-testid="location">{useLocation().pathname}</div>
}
function show() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const invalidate = vi.spyOn(client, "invalidateQueries")
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/applications"]}>
        <ApplicationDevelopmentCard
          development={{
            id,
            conversation_id: null,
            name: "Retained application",
            capability_count: 2,
            knowledge_base_count: 1,
            mcp_server_count: 3,
            has_changes: true,
            updated_at: "2026-09-17T00:00:00Z",
          }}
        />
        <Location />
      </MemoryRouter>
    </QueryClientProvider>
  )
  return { invalidate }
}
describe("retained application card", () => {
  it("shows standalone draft details without requesting a published application", async () => {
    await i18n.changeLanguage("zh-CN")
    show()
    await userEvent.click(
      screen.getByRole("button", {
        name: i18n.t("applications.details.open", {
          name: "Retained application",
        }),
      })
    )
    const dialog = await screen.findByRole("dialog")
    expect(within(dialog).getByText("Retained application")).toBeVisible()
    expect(dialog).toHaveTextContent(
      i18n.t("applicationDevelopment.publish.draft")
    )
    expect(dialog).toHaveTextContent("2026-09-17")
    expect(dialog).toHaveTextContent(
      i18n.t("applications.card.capabilityCount", { count: 2 })
    )
    expect(dialog).toHaveTextContent(
      i18n.t("applications.card.knowledgeBaseCount", { count: 1 })
    )
    expect(dialog).toHaveTextContent(
      i18n.t("applications.card.mcpServerCount", { count: 3 })
    )
    expect(apiRequest).not.toHaveBeenCalled()
  })
  it("edits a draft directly from its card and refreshes the application list", async () => {
    await i18n.changeLanguage("zh-CN")
    const draft = applicationDevelopmentSchema.parse({
      id,
      conversation_id: null,
      name: "Retained application",
      directory: "applications/draft",
      application_id: null,
      preview_application_id: null,
      preview_conversation_id: null,
      preview_current: true,
      revision: 1,
      source_hash: "a".repeat(64),
      installed_source_hash: null,
      source_error: null,
      manifest: null,
      diagnostics: [],
      updated_at: "2026-09-17T00:00:00Z",
    })
    vi.mocked(apiRequest).mockResolvedValue(draft)
    const { invalidate } = show()
    await userEvent.click(
      screen.getByRole("button", {
        name: i18n.t("common.moreActionsNamed", { name: draft.name }),
      })
    )
    await userEvent.click(
      await screen.findByRole("menuitem", {
        name: i18n.t("applications.editMetadata"),
      })
    )
    const dialog = await screen.findByRole("dialog", {
      name: i18n.t("applications.editMetadata"),
    })
    await userEvent.click(
      within(dialog).getByRole("button", {
        name: i18n.t("applications.iconPresets.book-open"),
      })
    )
    await userEvent.click(
      within(dialog).getByRole("button", { name: i18n.t("common.save") })
    )
    await waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith(
        `/application-developments/${id}/metadata`,
        expect.objectContaining({
          method: "PATCH",
          body: {
            source_hash: draft.source_hash,
            name: draft.name,
            description: null,
            icon: { type: "preset", preset: "book-open" },
          },
        })
      )
    )
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["applications"] })
    expect(screen.getByTestId("location")).toHaveTextContent("/applications")
  })
  it.each(["zh-CN", "en-US"])(
    "reopens a detached draft through the API and navigates to its new task in %s",
    async (locale) => {
      await i18n.changeLanguage(locale)
      vi.mocked(apiRequest).mockResolvedValue({ conversation_id: taskId })
      const { invalidate } = show()
      expect(
        screen.queryByRole("button", {
          name: i18n.t("applicationDevelopment.catalog.continueDevelopment"),
        })
      ).not.toBeInTheDocument()
      await userEvent.click(
        screen.getByRole("button", {
          name: i18n.t("common.moreActionsNamed", {
            name: "Retained application",
          }),
        })
      )
      await userEvent.click(
        await screen.findByRole("menuitem", {
          name: i18n.t("applicationDevelopment.catalog.continueDevelopment"),
        })
      )
      expect(apiRequest).toHaveBeenCalledWith(
        `/application-developments/${id}/resume`,
        expect.objectContaining({ method: "POST" })
      )
      await waitFor(() =>
        expect(screen.getByTestId("location")).toHaveTextContent(
          `/conversations/${taskId}`
        )
      )
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ["applications"] })
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ["conversations"] })
    }
  )
  it("confirms deletion in the application list and invalidates the app and task caches", async () => {
    await i18n.changeLanguage("zh-CN")
    vi.mocked(apiRequest).mockResolvedValue({ success: true })
    const { invalidate } = show()
    const interaction = userEvent.setup()
    await interaction.click(
      screen.getByRole("button", {
        name: i18n.t("common.moreActionsNamed", {
          name: "Retained application",
        }),
      })
    )
    const deleteDraft = await screen.findByRole("menuitem", {
      name: i18n.t("applicationDevelopment.catalog.deleteDraft"),
    })
    expect(deleteDraft).toHaveAttribute("data-variant", "default")
    const menu = screen.getByRole("menu")
    const groups = within(menu).getAllByRole("group")
    expect(groups).toHaveLength(2)
    expect(within(groups[0]).getAllByRole("menuitem")).toHaveLength(2)
    expect(within(groups[1]).getAllByRole("menuitem")).toEqual([deleteDraft])
    expect(within(menu).getAllByRole("separator")).toHaveLength(1)
    await interaction.click(deleteDraft)
    const dialog = screen.getByRole("dialog")
    expect(dialog).toHaveTextContent(
      i18n.t("applicationDevelopment.catalog.deleteDraftDescription")
    )
    expect(apiRequest).not.toHaveBeenCalled()
    await interaction.click(
      within(dialog).getByRole("button", { name: i18n.t("common.delete") })
    )
    expect(apiRequest).toHaveBeenCalledWith(
      `/application-developments/${id}`,
      expect.objectContaining({ method: "DELETE" })
    )
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    )
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ["application-development"],
    })
    expect(screen.getByTestId("location")).toHaveTextContent("/applications")
  })
  it("prevents duplicate opens while pending and keeps the card usable after an error", async () => {
    await i18n.changeLanguage("en-US")
    let rejectRequest: (error: Error) => void = () => {
      throw new Error("request not started")
    }
    vi.mocked(apiRequest).mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectRequest = reject
        })
    )
    show()
    const menu = screen.getByRole("button", {
      name: i18n.t("common.moreActionsNamed", { name: "Retained application" }),
    })
    await userEvent.click(menu)
    await userEvent.click(
      await screen.findByRole("menuitem", {
        name: i18n.t("applicationDevelopment.catalog.continueDevelopment"),
      })
    )
    expect(menu).toBeDisabled()
    rejectRequest(new Error("Failed"))
    await waitFor(() => expect(menu).toBeEnabled())
    expect(screen.getByRole("alert")).toBeVisible()
    expect(screen.getByTestId("location")).toHaveTextContent("/applications")
  })
})
