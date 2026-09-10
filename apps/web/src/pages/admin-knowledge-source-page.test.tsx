import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { MemoryRouter } from "react-router-dom"

import { setAccessToken } from "@/api/session"
import { ThemeProvider } from "@/app/theme-context"
import { notify } from "@/components/feedback/notification"
import { NotificationCenter } from "@/components/feedback/notification-toast"
import i18n from "@/i18n"
import { AdminKnowledgeSourcePage } from "@/pages/admin-knowledge-source-page"

const initialSettings = {
  provider: "sharepoint",
  revision: 2,
  enabled: true,
  tenant_id: "00000000-0000-4000-8000-000000000111",
  client_id: "00000000-0000-4000-8000-000000000222",
  tenant_domain: "contoso.sharepoint.com",
  client_secret_configured: true,
}

function envelope(data: unknown) {
  return new Response(JSON.stringify({ success: true, data }), {
    status: 200,
    headers: { "content-type": "application/json" },
  })
}

describe("AdminKnowledgeSourcePage", () => {
  beforeEach(async () => {
    setAccessToken("admin-token")
    await i18n.changeLanguage("zh-CN")
  })

  afterEach(() => {
    notify.dismiss()
    cleanup()
    vi.unstubAllGlobals()
  })

  it("shows only secret presence and saves an encrypted replacement contract", async () => {
    const requests: Array<{ path: string; method: string; body?: unknown }> = []
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = new URL(String(input), window.location.origin).pathname
        const method = init?.method ?? "GET"
        requests.push({
          path,
          method,
          ...(typeof init?.body === "string"
            ? { body: JSON.parse(init.body) as unknown }
            : {}),
        })
        if (method === "PUT") {
          return envelope({
            code: "SYSTEM_SETTINGS_UPDATED",
            settings: { ...initialSettings, revision: 3 },
          })
        }
        return envelope(initialSettings)
      })
    )

    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })
    render(
      <ThemeProvider>
        <MemoryRouter>
          <QueryClientProvider client={client}>
            <AdminKnowledgeSourcePage />
          </QueryClientProvider>
        </MemoryRouter>
        <NotificationCenter />
      </ThemeProvider>
    )
    const interaction = userEvent.setup()
    expect(await screen.findByRole("heading", { name: "知识库" })).toBeVisible()
    const tabs = screen.getByRole("tablist", { name: "知识库分类" })
    expect(tabs).toHaveClass("max-w-full", "justify-start", "overflow-x-auto")
    expect(
      within(tabs).getByRole("tab", { name: "知识库数据源" })
    ).toHaveAttribute("aria-selected", "true")
    expect(within(tabs).getByRole("tab", { name: "知识库" })).toHaveAttribute(
      "aria-selected",
      "false"
    )
    const clientSecretInput = await screen.findByLabelText("Client secret")
    expect(clientSecretInput).toHaveValue("")
    expect(clientSecretInput).toHaveAttribute("autocomplete", "new-password")
    expect(
      screen.getByPlaceholderText("密钥已配置；留空表示不更换")
    ).toBeVisible()
    expect(document.body).not.toHaveTextContent("sharepoint-secret")

    await interaction.type(clientSecretInput, "  new-secret  ")
    await interaction.click(screen.getByRole("button", { name: "保存" }))

    const notification = await screen.findByText(
      "SharePoint 数据源设置已保存并通过身份验证"
    )
    expect(notification.closest("[data-sonner-toast]")).not.toBeNull()
    expect(notification.closest('[data-slot="alert"]')).toBeNull()
    expect(requests.at(-1)).toMatchObject({
      path: "/api/v1/admin/knowledge-source-settings/sharepoint",
      method: "PUT",
      body: expect.objectContaining({
        expected_revision: 2,
        client_secret: "new-secret",
      }),
    })
  })
})
