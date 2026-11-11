import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { publicKnowledgeSettingsSchema } from "@linksense/shared"
import { ApiError } from "@/api/client"
import i18n from "@/i18n"
import {
  getPublicKnowledgeManagement,
  getPublicKnowledgeConversations,
  getPublicKnowledgeDetail,
} from "./api"
import { PublicKnowledgeManagementPage } from "./management-page"
import { PublicKnowledgeEmbedPage } from "./embed-page"

vi.mock("./api", async (original) => ({
  ...(await original<typeof import("./api")>()),
  getPublicKnowledgeManagement: vi.fn(),
  getPublicKnowledgeConversations: vi.fn(),
  getPublicKnowledgeDetail: vi.fn(),
}))
const applicationId = "00000000-0000-4000-8000-000000000001",
  conversationId = "00000000-0000-4000-8000-000000000002",
  visitorId = "00000000-0000-4000-8000-000000000003"
const settings = publicKnowledgeSettingsSchema.parse({
  name: "Website assistant",
  instructions: "Use website evidence",
  model: "review-model",
  reasoning_effort: "medium",
  knowledge_base_ids: [visitorId],
  allowed_origins: ["https://website.example.test"],
})
const conversation = {
  id: conversationId,
  visitor_id: visitorId,
  title: "Website deployment question",
  created_at: "2026-11-05T00:00:00Z",
  updated_at: "2026-11-05T00:00:00Z",
}
const clients: QueryClient[] = []
beforeEach(async () => {
  await i18n.changeLanguage("zh-CN")
})
afterEach(() => {
  cleanup()
  clients.splice(0).forEach((client) => client.clear())
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})
function show(configuration = settings, embed = false) {
  vi.mocked(getPublicKnowledgeManagement).mockResolvedValue({
    application_id: applicationId,
    public_id: "public-application-identifier-1234",
    version_number: "1.0.0",
    icon: { type: "preset", preset: "bot" } as const,
    settings: configuration,
  })
  vi.mocked(getPublicKnowledgeConversations).mockResolvedValue({
    items: [conversation],
    next_cursor: null,
  })
  vi.mocked(getPublicKnowledgeDetail).mockResolvedValue({
    conversation,
    events: [],
    turns: [
      {
        id: visitorId,
        input_text: "Can I deploy this product?",
        output_text: "Supports private deployment [1]",
        status: "completed",
        model: "review-model",
        application_version: "1.0.0",
        duration_ms: 1200,
        created_at: conversation.created_at,
        error_code: null,
        citations: [
          {
            number: 1,
            knowledge_base_id: visitorId,
            document_id: conversationId,
            document_version_id: applicationId,
            title: "Deployment evidence",
            page_numbers: [],
            excerpt: "Website source passage",
          },
        ],
      },
    ],
  })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  clients.push(client)
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/applications/${applicationId}`]}>
        <Routes>
          <Route
            path="/applications/:applicationId"
            element={
              embed ? (
                <PublicKnowledgeEmbedPage />
              ) : (
                <PublicKnowledgeManagementPage />
              )
            }
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
}
describe("public conversation inspection", () => {
  it("builds embedding code for the selected allowed website", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          { success: false, error_code: "RUNNER_UNAVAILABLE" },
          { status: 503 }
        )
      )
    )
    const origin = "https://second-website.example.test"
    show(
      {
        ...settings,
        allowed_origins: [settings.allowed_origins[0] ?? "", origin],
      },
      true
    )
    const user = userEvent.setup()
    const code = await screen.findByRole("textbox", {
      name: i18n.t("publicKnowledge.embed"),
    })
    expect(code).toHaveProperty("value", expect.stringContaining("allow-forms"))
    expect(code).toHaveProperty(
      "value",
      expect.stringContaining(
        encodeURIComponent(settings.allowed_origins[0] ?? "")
      )
    )
    await user.click(
      screen.getByRole("combobox", {
        name: i18n.t("publicKnowledge.embedWebsite"),
      })
    )
    await user.click(await screen.findByRole("option", { name: origin }))
    expect(code).toHaveProperty(
      "value",
      expect.stringContaining(encodeURIComponent(origin))
    )
  })
  it("lets a creator select a conversation, inspect evidence and search saved messages", async () => {
    show()
    const user = userEvent.setup()
    await user.click(
      await screen.findByRole("button", {
        name: /Website deployment question/u,
      })
    )
    expect(
      await screen.findByText("Supports private deployment [1]")
    ).toBeVisible()
    expect(screen.getByText("Website source passage")).toBeVisible()
    expect(screen.getByText("review-model")).toBeVisible()
    expect(getPublicKnowledgeDetail).toHaveBeenCalledWith(
      applicationId,
      conversationId,
      expect.any(AbortSignal)
    )
    await user.type(
      screen.getByRole("textbox", { name: i18n.t("publicKnowledge.search") }),
      "deployment"
    )
    await waitFor(() =>
      expect(getPublicKnowledgeConversations).toHaveBeenLastCalledWith(
        applicationId,
        expect.objectContaining({ search: "deployment" }),
        expect.any(AbortSignal)
      )
    )
    expect(screen.queryByText("Website source passage")).not.toBeInTheDocument()
  })
  it("keeps conversation content inaccessible when management permission is denied", async () => {
    vi.mocked(getPublicKnowledgeManagement).mockRejectedValueOnce(
      new ApiError({ status: 403, errorCode: "FORBIDDEN" })
    )
    show()
    expect(
      await screen.findByRole("button", { name: i18n.t("common.retry") })
    ).toBeVisible()
    expect(getPublicKnowledgeConversations).not.toHaveBeenCalled()
    expect(getPublicKnowledgeDetail).not.toHaveBeenCalled()
    expect(screen.queryByText("Website source passage")).not.toBeInTheDocument()
  })
})
