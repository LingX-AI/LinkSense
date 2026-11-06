import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter, Routes, Route } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { publicKnowledgeSettingsSchema } from "@linksense/shared"
import i18n from "@/i18n"
import { getPublicKnowledgeManagement, getPublicKnowledgeUsage } from "./api"
import { PublicKnowledgeUsagePage } from "./usage-page"
vi.mock("./api", async (original) => ({
  ...(await original<typeof import("./api")>()),
  getPublicKnowledgeManagement: vi.fn(),
  getPublicKnowledgeUsage: vi.fn(),
}))
const id = "00000000-0000-4000-8000-000000000001"
const clients: QueryClient[] = []
beforeEach(async () => {
  await i18n.changeLanguage("zh-CN")
  vi.mocked(getPublicKnowledgeManagement).mockResolvedValue({
    application_id: id,
    public_id: "public-application-identifier-1234",
    version_number: "1.0.0",
    settings: publicKnowledgeSettingsSchema.parse({
      name: "Website assistant",
      instructions: "Use evidence",
      model: "model",
      reasoning_effort: "medium",
      knowledge_base_ids: [id],
      allowed_origins: ["https://example.test"],
    }),
  })
  vi.mocked(getPublicKnowledgeUsage).mockResolvedValue({
    visitors: 12,
    conversations: 15,
    questions: 25,
    statuses: {
      queued: 1,
      running: 2,
      completed: 20,
      failed: 1,
      interrupted: 1,
    },
    average_duration_ms: 1500,
  })
})
afterEach(() => {
  cleanup()
  clients.splice(0).forEach((client) => client.clear())
  vi.resetAllMocks()
})
function show() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  clients.push(client)
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/applications/${id}`]}>
        <Routes>
          <Route
            path="/applications/:applicationId"
            element={<PublicKnowledgeUsagePage />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
  return userEvent.setup()
}
describe("public Q&A usage", () => {
  it("shows public visitor, question, status and completion metrics", async () => {
    show()
    expect(
      await screen.findByRole("heading", {
        name: i18n.t("publicKnowledge.usageVisitors"),
      })
    ).toBeVisible()
    expect(screen.getByText("25")).toBeVisible()
    expect(screen.getByText("90.9%")).toBeVisible()
    expect(screen.getByText("1.5 秒")).toBeVisible()
    expect(screen.getByRole("row", { name: "正在回答 2" })).toBeVisible()
    expect(getPublicKnowledgeUsage).toHaveBeenCalledWith(
      id,
      expect.objectContaining({
        from: expect.stringMatching(/Z$/u),
        to: expect.stringMatching(/Z$/u),
      }),
      expect.any(AbortSignal)
    )
  })
  it("changes date bounds and blocks reversed dates without showing stale usage", async () => {
    const user = show()
    await screen.findByText("25")
    const from = screen.getByLabelText(i18n.t("publicKnowledge.from")),
      to = screen.getByLabelText(i18n.t("publicKnowledge.to"))
    await user.clear(from)
    await user.type(from, "2026-12-01")
    await user.clear(to)
    await user.type(to, "2026-11-01")
    expect(await screen.findByRole("alert")).toHaveTextContent(
      i18n.t("publicKnowledge.invalidDates")
    )
    expect(screen.queryByText("25")).not.toBeInTheDocument()
  })
  it("shows empty usage as zero with no invented completion time", async () => {
    vi.mocked(getPublicKnowledgeUsage).mockResolvedValue({
      visitors: 0,
      conversations: 0,
      questions: 0,
      statuses: {
        queued: 0,
        running: 0,
        completed: 0,
        failed: 0,
        interrupted: 0,
      },
      average_duration_ms: null,
    })
    show()
    await screen.findByRole("table")
    expect(screen.getAllByText("—")).toHaveLength(2)
  })
  it("shows an error and can reload failed usage", async () => {
    vi.mocked(getPublicKnowledgeUsage).mockRejectedValueOnce(
      new Error("Usage unavailable")
    )
    const user = show()
    const retry = await screen.findByRole("button", {
      name: i18n.t("common.retry"),
    })
    await user.click(retry)
    await waitFor(() => expect(screen.getByText("25")).toBeVisible())
  })
})
