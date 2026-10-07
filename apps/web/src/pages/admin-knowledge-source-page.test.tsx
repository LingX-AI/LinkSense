import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { MemoryRouter } from "react-router-dom"
import { supportedLocales } from "@linksense/shared"

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

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <ThemeProvider>
      <MemoryRouter>
        <QueryClientProvider client={client}>
          <AdminKnowledgeSourcePage />
        </QueryClientProvider>
      </MemoryRouter>
      <NotificationCenter />
    </ThemeProvider>
  )
}

function labelFor(control: HTMLElement) {
  return control
    .closest('[data-slot="field"]')
    ?.querySelector('[data-slot="field-label"]')
}

function secretInput() {
  return screen.getByLabelText(
    new RegExp(
      `^${i18n.t("knowledgeSources.sharepoint.clientSecret")}\\s*\\*?$`
    )
  )
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

  it.each([...supportedLocales, "de-DE"])(
    "requires connection fields and a first secret only while SharePoint is enabled in %s",
    async (locale) => {
      await i18n.changeLanguage(locale)
      vi.stubGlobal(
        "fetch",
        vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) =>
          (init?.method ?? "GET") === "PUT"
            ? envelope({
                code: "SYSTEM_SETTINGS_UPDATED",
                settings: { ...initialSettings, revision: 3 },
              })
            : envelope({
                ...initialSettings,
                enabled: false,
                client_secret_configured: false,
              })
        )
      )
      renderPage()
      const enabled = await screen.findByRole("switch", {
        name: i18n.t("knowledgeSources.sharepoint.enable"),
      })
      const connectionFields = ["tenantId", "clientId", "tenantDomain"].map(
        (field) =>
          screen.getByRole("textbox", {
            name: i18n.t(`knowledgeSources.sharepoint.${field}`),
          })
      )
      for (const field of [...connectionFields, secretInput()]) {
        expect(labelFor(field)).not.toHaveTextContent("*")
        expect(field).not.toHaveAttribute("aria-required", "true")
      }
      const user = userEvent.setup()
      await user.click(enabled)
      for (const field of [...connectionFields, secretInput()]) {
        const indicator = labelFor(field)?.querySelector(
          'span[aria-hidden="true"]'
        )
        expect(indicator).toHaveTextContent("*")
        expect(indicator).toHaveClass("text-destructive")
        expect(field).toHaveAttribute("aria-required", "true")
      }
      const save = screen.getByRole("button", { name: i18n.t("common.save") })
      expect(save).toBeDisabled()
      await user.click(enabled)
      for (const field of [...connectionFields, secretInput()]) {
        expect(labelFor(field)).not.toHaveTextContent("*")
        expect(field).not.toHaveAttribute("aria-required", "true")
      }
      expect(save).toBeEnabled()
      await user.click(enabled)
      await user.type(secretInput(), "first-secret")
      await user.click(save)
      await waitFor(() => {
        expect(labelFor(secretInput())).not.toHaveTextContent("*")
        expect(secretInput()).not.toHaveAttribute("aria-required", "true")
      })
    }
  )

  it.each([...supportedLocales, "de-DE"])(
    "requires a replacement secret only after changing the saved tenant or client identity in %s",
    async (locale) => {
      await i18n.changeLanguage(locale)
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => envelope(initialSettings))
      )
      renderPage()
      await screen.findByRole("switch", {
        name: i18n.t("knowledgeSources.sharepoint.enable"),
      })
      const secret = secretInput()
      expect(labelFor(secret)).not.toHaveTextContent("*")
      expect(secret).not.toHaveAttribute("aria-required", "true")
      const user = userEvent.setup()
      for (const [key, original] of [
        ["tenantId", initialSettings.tenant_id],
        ["clientId", initialSettings.client_id],
      ]) {
        const field = screen.getByRole("textbox", {
          name: i18n.t(`knowledgeSources.sharepoint.${key}`),
        })
        await user.clear(field)
        await user.type(field, "00000000-0000-4000-8000-000000000333")
        const indicator = labelFor(secret)?.querySelector(
          'span[aria-hidden="true"]'
        )
        expect(indicator).toHaveTextContent("*")
        expect(indicator).toHaveClass("text-destructive")
        expect(secret).toHaveAttribute("aria-required", "true")
        await user.clear(field)
        await user.type(field, original)
        expect(labelFor(secret)).not.toHaveTextContent("*")
        expect(secret).not.toHaveAttribute("aria-required", "true")
      }
    }
  )

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
