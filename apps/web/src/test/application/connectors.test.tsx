import { screen, waitFor, within } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { connectionProviderSchema, supportedLocales } from "@linksense/shared"
import { setupApplicationTests, installApiMock, renderApp } from "./fixture"
import i18n from "@/i18n"

describe("connector management routing", () => {
  setupApplicationTests()

  it.each(supportedLocales)(
    "opens the independent administrator menu in %s",
    async (locale) => {
      installApiMock({ initialLanguage: locale })
      const originalFetch = globalThis.fetch
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
          if (String(input).includes("/admin/connection-settings"))
            return Response.json({
              success: true,
              data: connectionProviderSchema.options.map((provider) => ({
                provider,
                revision: 0,
                client_id: "",
                secret_configured: false,
                redirect_uri: `https://app.example.test/api/v1/connectors/${provider}/callback`,
                required_scopes: ["openid"],
                connected_account_count: 0,
              })),
            })
          return originalFetch(input, init)
        })
      )
      renderApp("/admin/connectors")
      const heading = await screen.findByRole("heading", {
        name: i18n.t("adminConnections.title", { lng: locale }),
        level: 1,
      })
      expect(heading).toBeVisible()
      const navigation = screen.getByRole("navigation", {
        name: i18n.t("settings.administrationGroup"),
      })
      const link = within(navigation).getByRole("link", {
        name: i18n.t("adminConnections.title"),
      })
      expect(link).toHaveAttribute("href", "/admin/connectors")
      expect(link).toHaveClass("settings-navigation-link-active")
      expect(
        await screen.findByRole("button", {
          name: i18n.t("adminConnections.configureProvider", {
            provider: "OneDrive",
          }),
        })
      ).toBeVisible()
    }
  )

  it("blocks ordinary users before requesting connector configuration", async () => {
    const api = installApiMock({ userOverride: { role: "user" } })
    renderApp("/admin/connectors")
    await waitFor(() =>
      expect(
        screen.getByRole("complementary", { name: "LinkSense 导航" })
      ).toBeVisible()
    )
    expect(
      screen.queryByRole("button", { name: "配置 OneDrive" })
    ).not.toBeInTheDocument()
    expect(
      api.requests.some((request) =>
        request.path.includes("/admin/connection-settings")
      )
    ).toBe(false)
    expect(
      screen.queryByRole("link", { name: "连接器" })
    ).not.toBeInTheDocument()
  })
})
