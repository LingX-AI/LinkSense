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
  it.each(
    supportedLanguages.flatMap((locale) =>
      (["users", "groups"] as const).map((page) => [locale, page] as const)
    )
  )(
    "keeps %s %s submission errors inside the active dialog",
    async (locale, page) => {
      await i18n.changeLanguage(locale)
      vi.stubGlobal(
        "fetch",
        vi.fn<typeof fetch>(async (_input, init) =>
          init?.method === "POST"
            ? Response.json(
                {
                  success: false,
                  error_code: "VALIDATION_ERROR",
                  message_key: "errors.validation",
                },
                { status: 400 }
              )
            : Response.json({
                success: true,
                data: { items: [], total_count: 0, next_cursor: null },
              })
        )
      )
      const user = userEvent.setup()
      mount(page)
      const title = i18n.t(
        page === "users" ? "admin.createUser" : "admin.createGroup"
      )
      await user.click(await screen.findByRole("button", { name: title }))
      const dialog = within(await screen.findByRole("dialog"))
      await user.type(
        dialog.getByRole("textbox", {
          name: i18n.t("common.name"),
        }),
        "Support"
      )
      if (page === "users") {
        await user.type(
          dialog.getByRole("textbox", {
            name: i18n.t("common.email"),
          }),
          "support@example.invalid"
        )
      }
      await user.click(
        dialog.getByRole("button", { name: i18n.t("common.save") })
      )
      expect(await dialog.findByRole("alert")).toHaveTextContent(
        i18n.t("errors.validation")
      )
      expect(
        dialog.getByRole("textbox", {
          name: i18n.t("common.name"),
        })
      ).toHaveValue("Support")
      expect(
        dialog.getByRole("button", { name: i18n.t("common.save") })
      ).toBeEnabled()
      await user.click(
        dialog.getByRole("button", {
          name: i18n.t("common.cancel"),
        })
      )
      await user.click(screen.getByRole("button", { name: title }))
      expect(
        within(await screen.findByRole("dialog")).queryByRole("alert")
      ).not.toBeInTheDocument()
    }
  )

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
