import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { MemoryRouter, Route, Routes } from "react-router-dom"

import { apiRequest } from "@/api/client"
import i18n from "@/i18n"
import { SharedConversationPage } from "@/pages/shared-conversation-page"

vi.mock("@/api/client", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/api/client")>()
  return { ...original, apiRequest: vi.fn() }
})

const CONVERSATION_ID = "20000000-0000-4000-8000-000000000001"
const SHARE_ID = "30000000-0000-4000-8000-000000000001"

describe("SharedConversationPage", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en-US")
    vi.mocked(apiRequest).mockResolvedValue({
      id: SHARE_ID,
      conversation_id: CONVERSATION_ID,
      title: "Fix the flashing page",
      url_path: `/share/${SHARE_ID}`,
      created_at: "2026-09-03T04:00:00.000Z",
      updated_at: "2026-09-03T04:00:00.000Z",
      snapshot: {
        id: CONVERSATION_ID,
        title: "Fix the flashing page",
        updated_at: "2026-09-03T04:00:00.000Z",
        has_unread_completion: false,
        has_automation: false,
        collaboration_mode: "default",
        messages: [
          {
            id: "40000000-0000-4000-8000-000000000000",
            role: "user",
            content: "Please fix the layout.",
            content_text: "Please fix the layout.",
            turn_id: "50000000-0000-4000-8000-000000000001",
          },
          {
            id: "40000000-0000-4000-8000-000000000002",
            role: "assistant",
            content: "Inspecting internal state.",
            content_text: "Inspecting internal state.",
            turn_id: "50000000-0000-4000-8000-000000000001",
            phase: "commentary",
          },
          {
            id: "40000000-0000-4000-8000-000000000001",
            role: "assistant",
            content: "The issue is fixed.",
            content_text: "The issue is fixed.",
            turn_id: "50000000-0000-4000-8000-000000000001",
            phase: "final_answer",
          },
        ],
        turns: [
          {
            id: "50000000-0000-4000-8000-000000000001",
            status: "completed",
            model: "gpt-public-secret",
          },
        ],
        activities: [
          {
            id: "activity-secret",
            turn_id: "50000000-0000-4000-8000-000000000001",
            type: "tool_completed",
            label: "Internal tool call",
          },
        ],
        user_input_requests: [],
      },
    })
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it("renders the read-only task and only the Continue in LinkSense action", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[`/share/${SHARE_ID}`]}>
          <Routes>
            <Route
              path="/share/:shareId"
              element={<SharedConversationPage />}
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    )

    expect(await screen.findByText("The issue is fixed.")).toBeVisible()
    expect(
      screen.queryByText("Inspecting internal state.")
    ).not.toBeInTheDocument()
    expect(screen.queryByText("Internal tool call")).not.toBeInTheDocument()
    expect(screen.queryByText("gpt-public-secret")).not.toBeInTheDocument()
    const continueLink = screen.getByRole("link", {
      name: "Continue in LinkSense",
    })
    expect(continueLink).toHaveAttribute("href", "/")
    const messageRegion = screen.getByRole("log")
    expect(messageRegion).toHaveClass("conversation-scroll-embedded")
    expect(messageRegion.parentElement).toHaveClass("shared-conversation-main")
    expect(document.querySelector('[data-icon="flag"]')).toBeNull()
    expect(apiRequest).toHaveBeenCalledWith(
      `/shared-conversations/${SHARE_ID}`,
      expect.objectContaining({ skipRefresh: true })
    )
  })
})
