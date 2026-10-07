import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { setAccessToken } from "@/api/session"
import { AuthContext } from "@/app/auth-state"
import { expectRequiredLabel } from "@/features/admin/required-field-label.test-helper"
import i18n, { supportedLanguages } from "@/i18n"
import { AdminPages } from "./admin-pages"

beforeEach(() => {
  setAccessToken("required-field-test")
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        success: true,
        data: { items: [], total_count: 0, next_cursor: null },
      })
    )
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  setAccessToken(null)
})

function mount(page: "users" | "groups") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <AuthContext.Provider
          value={{
            status: "anonymous",
            user: null,
            acceptSession: vi.fn(async () => undefined),
            refreshUser: vi.fn(async () => undefined),
            signOut: vi.fn(async () => undefined),
          }}
        >
          <AdminPages page={page} />
        </AuthContext.Provider>
      </QueryClientProvider>
    </MemoryRouter>
  )
}

describe("administrator user and group required fields", () => {
  it.each(supportedLanguages)(
    "marks the user's required name and email in %s",
    async (locale) => {
      await i18n.changeLanguage(locale)
      const user = userEvent.setup()
      mount("users")
      await user.click(
        await screen.findByRole("button", { name: i18n.t("admin.createUser") })
      )
      const dialog = within(await screen.findByRole("dialog"))
      expectRequiredLabel(
        dialog.getByRole("textbox", { name: i18n.t("common.name") })
      )
      expectRequiredLabel(
        dialog.getByRole("textbox", { name: i18n.t("common.email") })
      )
      expectRequiredLabel(
        dialog.getByRole("combobox", { name: i18n.t("admin.role") }),
        false
      )
      expect(dialog.getAllByText("*")).toHaveLength(2)
    }
  )

  it("marks the group's name while leaving its description optional", async () => {
    await i18n.changeLanguage("zh-CN")
    const user = userEvent.setup()
    mount("groups")
    await user.click(
      await screen.findByRole("button", { name: i18n.t("admin.createGroup") })
    )
    const dialog = within(await screen.findByRole("dialog"))
    expectRequiredLabel(
      dialog.getByRole("textbox", { name: i18n.t("common.name") })
    )
    expectRequiredLabel(
      dialog.getByRole("textbox", {
        name: i18n.t("capability.descriptionLabel"),
      }),
      false
    )
    expect(dialog.getAllByText("*")).toHaveLength(1)
  })
})
