import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter } from "react-router-dom"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  applicationSchema,
  publicKnowledgeSettingsSchema,
  supportedLocales,
  type PublicKnowledgeSettings,
} from "@linksense/shared"
import i18n from "@/i18n"
import { getPublicKnowledgeManagement, setPublicKnowledgeEnabled } from "./api"
import { PublicKnowledgeApplicationCard } from "./application-card"

vi.mock("./api", async (original) => ({
  ...(await original<typeof import("./api")>()),
  getPublicKnowledgeManagement: vi.fn(),
  setPublicKnowledgeEnabled: vi.fn(),
}))
vi.mock("./settings-form", () => ({
  PublicKnowledgeSettingsForm: ({
    initial,
    onSaved,
  }: {
    initial: PublicKnowledgeSettings
    onSaved: (result: typeof management) => void
  }) => (
    <button
      onClick={() =>
        onSaved({
          ...management,
          settings: { ...initial, name: "Edited assistant" },
        })
      }
    >
      Save fixture
    </button>
  ),
}))
const id = "00000000-0000-4000-8000-000000000001",
  timestamp = "2026-11-05T00:00:00Z"
const application = applicationSchema.parse({
  id,
  owner: { id, name: "Creator" },
  name: "Website assistant",
  kind: "public_knowledge",
  icon: { type: "preset", preset: "bot" },
  description: "Public knowledge",
  instructions: "Use evidence",
  model: "model",
  reasoning_effort: "medium",
  status: "active",
  is_owner: true,
  can_manage: true,
  access_source: "owner",
  capability_count: 2,
  knowledge_base_count: 1,
  mcp_server_count: 0,
  dependencies_available: true,
  capabilities: [],
  knowledge_bases: [],
  mcp_servers: [],
  created_at: timestamp,
  updated_at: timestamp,
})
const management = {
  application_id: id,
  public_id: "public-application-identifier-1234",
  version_number: "1.0.0",
  settings: publicKnowledgeSettingsSchema.parse({
    name: application.name,
    instructions: "Use evidence",
    model: "model",
    reasoning_effort: "medium",
    knowledge_base_ids: [id],
    allowed_origins: ["https://example.test"],
  }),
}
const clients: QueryClient[] = []
afterEach(() => {
  cleanup()
  clients.splice(0).forEach((client) => client.clear())
  vi.resetAllMocks()
})
function show(status: "active" | "disabled" = "active", owner = true) {
  vi.mocked(getPublicKnowledgeManagement).mockResolvedValue(management)
  vi.mocked(setPublicKnowledgeEnabled).mockResolvedValue(management)
  const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    }),
    onDelete = vi.fn(),
    onFeedback = vi.fn()
  clients.push(client)
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <PublicKnowledgeApplicationCard
          application={{ ...application, status, is_owner: owner }}
          onDelete={onDelete}
          onFeedback={onFeedback}
        />
      </MemoryRouter>
    </QueryClientProvider>
  )
  return { onDelete, onFeedback, client, user: userEvent.setup() }
}
async function open(user: ReturnType<typeof userEvent.setup>) {
  await user.click(
    screen.getByRole("button", {
      name: i18n.t("common.moreActionsNamed", { name: application.name }),
    })
  )
  await screen.findByRole("menu")
}
describe("public application card actions", () => {
  it.each(supportedLocales)(
    "offers separate actions in the corner menu in %s",
    async (locale) => {
      await i18n.changeLanguage(locale)
      const { user } = show()
      expect(screen.queryByText("管理问答应用")).not.toBeInTheDocument()
      await open(user)
      for (const label of [
        "common.edit",
        "common.disable",
        "publicKnowledge.logs",
        "applications.usage.action",
        "publicKnowledge.embedAction",
        "common.delete",
      ])
        expect(
          screen.getByRole("menuitem", { name: i18n.t(label) })
        ).toBeVisible()
      expect(
        screen.getByRole("menuitem", { name: i18n.t("publicKnowledge.logs") })
      ).toHaveAttribute(
        "href",
        `/capabilities/applications/${id}/public-knowledge`
      )
      expect(
        screen.getByRole("menuitem", {
          name: i18n.t("applications.usage.action"),
        })
      ).toHaveAttribute(
        "href",
        `/capabilities/applications/${id}/public-knowledge/usage`
      )
    }
  )
  it.each(["active", "disabled"] as const)(
    "uses the public status endpoint for an %s application",
    async (status) => {
      await i18n.changeLanguage("zh-CN")
      const { user } = show(status)
      await open(user)
      await user.click(
        screen.getByRole("menuitem", {
          name: i18n.t(
            status === "active" ? "common.disable" : "common.enable"
          ),
        })
      )
      await waitFor(() =>
        expect(setPublicKnowledgeEnabled).toHaveBeenCalledWith(
          id,
          status !== "active"
        )
      )
    }
  )
  it("loads current settings into the editor and refreshes the saved application", async () => {
    await i18n.changeLanguage("zh-CN")
    const { user, onFeedback, client } = show()
    await open(user)
    await user.click(
      screen.getByRole("menuitem", { name: i18n.t("common.edit") })
    )
    expect(
      await screen.findByRole("dialog", {
        name: i18n.t("publicKnowledge.edit"),
      })
    ).toBeVisible()
    vi.mocked(getPublicKnowledgeManagement).mockResolvedValue({
      ...management,
      settings: { ...management.settings, name: "Edited assistant" },
    })
    await user.click(
      await screen.findByRole("button", { name: "Save fixture" })
    )
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    )
    expect(
      client.getQueryData(["applications", "public-knowledge", id])
    ).toMatchObject({ settings: { name: "Edited assistant" } })
    expect(onFeedback).toHaveBeenCalledWith(i18n.t("publicKnowledge.published"))
  })
  it("hands deletion to the existing confirmation flow", async () => {
    const { user, onDelete } = show()
    await open(user)
    await user.click(
      screen.getByRole("menuitem", { name: i18n.t("common.delete") })
    )
    expect(onDelete).toHaveBeenCalledWith(application)
  })
  it("reports a failed status update", async () => {
    const { user, onFeedback } = show()
    vi.mocked(setPublicKnowledgeEnabled).mockRejectedValue(
      new Error("Failed status update")
    )
    await open(user)
    await user.click(
      screen.getByRole("menuitem", { name: i18n.t("common.disable") })
    )
    await waitFor(() =>
      expect(onFeedback).toHaveBeenCalledWith(expect.any(String), true)
    )
  })
  it("hides management actions from a non-owner", () => {
    show("active", false)
    expect(
      screen.queryByRole("button", {
        name: i18n.t("common.moreActionsNamed", { name: application.name }),
      })
    ).not.toBeInTheDocument()
  })
})
