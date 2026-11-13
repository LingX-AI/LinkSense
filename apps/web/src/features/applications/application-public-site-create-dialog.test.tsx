import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { I18nextProvider } from "react-i18next"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import i18n from "@/i18n"
import { localConversationDraftStorageKey } from "@/features/conversations/conversation-local-draft"
import { ApplicationPublicSiteCreateDialog } from "./application-public-site-create-dialog"

vi.mock("@/app/auth-state", () => ({
  useAuth: () => ({ user: { id: "user-1" } }),
}))

beforeEach(() => {
  window.localStorage.clear()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("public site creation dialog", () => {
  it("starts a site task with the selected local-open request and preserves the general draft", async () => {
    await i18n.changeLanguage("en-US")
    const onClose = vi.fn()
    const user = userEvent.setup()
    const client = new QueryClient()
    const taskId = "10000000-0000-4000-8000-000000000001"
    const turnId = "10000000-0000-4000-8000-000000000002"
    const draftKey = localConversationDraftStorageKey("user-1", "new")
    window.localStorage.setItem(draftKey, "existing draft")
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          success: true,
          data: {
            id: taskId,
            title: "New task",
            project_id: null,
            updated_at: "2026-11-13T00:00:00.000Z",
          },
        })
      )
      .mockResolvedValueOnce(
        Response.json({
          success: true,
          data: {
            turn_id: turnId,
            accepted: true,
            status: "starting",
          },
        })
      )
    vi.stubGlobal("fetch", request)
    render(
      <QueryClientProvider client={client}>
        <I18nextProvider i18n={i18n}>
          <MemoryRouter initialEntries={["/"]}>
            <Routes>
              <Route
                path="/"
                element={
                  <ApplicationPublicSiteCreateDialog onClose={onClose} />
                }
              />
              <Route
                path={`/conversations/${taskId}`}
                element={<div>site-task-route</div>}
              />
            </Routes>
          </MemoryRouter>
        </I18nextProvider>
      </QueryClientProvider>
    )

    const submit = screen.getByRole("button", {
      name: i18n.t("applications.publicSiteCreation.start"),
    })
    expect(submit).toBeDisabled()
    await user.type(screen.getByLabelText(/Site name/u), "Water Reminder")
    await user.click(
      screen.getByRole("checkbox", {
        name: i18n.t("applications.publicSiteCreation.openLocally"),
      })
    )
    await user.type(
      screen.getByLabelText(/What should the site do/u),
      "Remind me every 2 hours"
    )
    expect(submit).toBeEnabled()
    await user.click(submit)

    await waitFor(() =>
      expect(screen.getByText("site-task-route")).toBeVisible()
    )
    expect(onClose).toHaveBeenCalledOnce()
    expect(window.localStorage.getItem(draftKey)).toBe("existing draft")
    expect(request).toHaveBeenCalledTimes(2)
    expect(String(request.mock.calls[1]?.[0])).toContain(
      `/conversations/${taskId}/turns`
    )
    const body = JSON.parse(String(request.mock.calls[1]?.[1]?.body))
    expect(body.input_text).toContain("Water Reminder")
    expect(body.input_text).toContain("Remind me every 2 hours")
    expect(body.input_text).toContain(
      i18n.t("applications.publicSiteCreation.openInstruction")
    )
    expect(body.priority_capability_ids).toEqual([
      "builtin:capability:linksense-public-site",
    ])
    expect(body.idempotency_key).toMatch(/^[0-9a-f-]{36}$/u)
    client.clear()
  })
})
