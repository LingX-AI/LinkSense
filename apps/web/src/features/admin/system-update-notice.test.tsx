import type { SystemUpdateStatus } from "@linksense/shared"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactNode } from "react"
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { SystemUpdateNotice } from "@/features/admin/system-update-notice"
import { systemUpdateQueryKey } from "@/features/admin/system-update-query"
import i18n, { supportedLanguages } from "@/i18n"
import { enUS } from "@/i18n/en-US"
import { esES } from "@/i18n/es-ES"
import { frFR } from "@/i18n/fr-FR"
import { jaJP } from "@/i18n/ja-JP"
import { ptBR } from "@/i18n/pt-BR"
import { zhCN } from "@/i18n/zh-CN"

const authState = vi.hoisted(() => ({
  user: {
    id: "01900000-0000-7000-8000-000000000099",
    role: "admin",
    status: "active",
  } as {
    id: string
    role: "admin" | "user"
    status: "active" | "disabled"
  } | null,
}))

const priorityState = vi.hoisted(() => ({
  clientUpdate: null as string | null,
  bootstrap: null as { maintenance: { active: boolean } } | null,
}))

vi.mock("@/app/auth-state", () => ({
  useAuth: () => authState,
}))

vi.mock("@/app/bootstrap-state", () => ({
  useBootstrap: () => priorityState,
}))

vi.mock("@/app/use-client-update", () => ({
  useClientUpdate: () => priorityState.clientUpdate,
}))

const userId = "01900000-0000-7000-8000-000000000099"
const storageKey = `linksense.system-update.dismissed.${userId}.v0.2.0`
const updateAvailable: SystemUpdateStatus = {
  status: "update_available",
  current_version: "v0.1.1",
  latest_release: {
    version: "v0.2.0",
    name: "LinkSense v0.2.0",
    published_at: "2026-09-01T08:00:00.000Z",
    url: "https://github.com/LingX-AI/linksense/releases/tag/v0.2.0",
    release_notes: "Update notifications.",
  },
  checked_at: "2026-09-01T09:00:00.000Z",
  error_code: null,
}
const checkFailed: SystemUpdateStatus = {
  status: "check_failed",
  current_version: "v0.1.1",
  latest_release: null,
  checked_at: "2026-09-01T09:00:00.000Z",
  error_code: "GITHUB_UNAVAILABLE",
}
const noticeResources = {
  "zh-CN": zhCN.systemUpdate.notice,
  "en-US": enUS.systemUpdate.notice,
  "es-ES": esES.systemUpdate.notice,
  "pt-BR": ptBR.systemUpdate.notice,
  "fr-FR": frFR.systemUpdate.notice,
  "ja-JP": jaJP.systemUpdate.notice,
}
const queryClients: QueryClient[] = []

function envelope(data: unknown): Response {
  return new Response(JSON.stringify({ success: true, data }), {
    status: 200,
    headers: { "content-type": "application/json" },
  })
}

function renderNotice(children: ReactNode = <SystemUpdateNotice />) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  queryClients.push(queryClient)
  const view = render(children, {
    wrapper: ({ children }) => (
      <MemoryRouter>
        <QueryClientProvider client={queryClient}>
          <Routes>
            <Route path="/" element={children} />
            <Route
              path="/admin/system-update"
              element={<h1>Update settings</h1>}
            />
          </Routes>
        </QueryClientProvider>
      </MemoryRouter>
    ),
  })
  return { ...view, queryClient }
}

describe("system update notice", () => {
  beforeEach(async () => {
    authState.user = { id: userId, role: "admin", status: "active" }
    priorityState.bootstrap = null
    priorityState.clientUpdate = null
    window.localStorage.clear()
    await i18n.changeLanguage("zh-CN")
  })

  afterEach(async () => {
    cleanup()
    for (const queryClient of queryClients) queryClient.clear()
    queryClients.length = 0
    vi.restoreAllMocks()
    await i18n.changeLanguage("zh-CN")
  })

  it("announces an available version in a named modal with a readable description and two actions", async () => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => envelope(updateAvailable))

    renderNotice(
      <>
        <input aria-label="Draft" />
        <SystemUpdateNotice />
      </>
    )

    const dialog = await screen.findByRole("dialog", {
      name: "LinkSense v0.2.0 已发布",
    })
    expect(dialog).toBeVisible()
    expect(dialog).toHaveAccessibleDescription(
      zhCN.systemUpdate.notice.description
    )
    expect(dialog).not.toHaveTextContent("管理员")
    expect(
      within(dialog).getByRole("button", { name: "稍后再说" })
    ).toBeVisible()
    expect(
      within(dialog).getByRole("link", { name: "查看更新" })
    ).toHaveAttribute("href", "/admin/system-update")
    expect(
      within(dialog).getByRole("button", {
        name: "暂时关闭此版本的更新提示",
      })
    ).toBeVisible()
    expect(
      screen.queryByRole("textbox", { name: "Draft" })
    ).not.toBeInTheDocument()
    await waitFor(() =>
      expect(
        within(dialog).getByRole("link", { name: "查看更新" })
      ).toHaveFocus()
    )
    expect(fetch).toHaveBeenCalledExactlyOnceWith(
      "/api/v1/admin/system-update",
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    )
  })

  it.each(["later", "close button", "escape", "backdrop"] as const)(
    "dismisses and remembers the current version after %s",
    async (action) => {
      vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
        envelope(updateAvailable)
      )
      const interaction = userEvent.setup()
      const view = renderNotice()
      await screen.findByRole("dialog")

      if (action === "escape") {
        await interaction.keyboard("{Escape}")
      } else if (action === "backdrop") {
        const backdrop = document.querySelector('[data-slot="dialog-overlay"]')
        expect(backdrop).toBeInstanceOf(HTMLElement)
        if (!(backdrop instanceof HTMLElement)) {
          throw new Error("The dialog backdrop is missing")
        }
        await interaction.click(backdrop)
      } else {
        await interaction.click(
          screen.getByRole("button", {
            name: action === "later" ? "稍后再说" : "暂时关闭此版本的更新提示",
          })
        )
      }

      await waitFor(() =>
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
      )
      expect(window.localStorage.getItem(storageKey)).toBe("true")
      view.unmount()
      const remounted = renderNotice()
      await waitFor(() =>
        expect(
          remounted.queryClient.getQueryState(systemUpdateQueryKey)?.status
        ).toBe("success")
      )
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    }
  )

  it("honors dismissal records created by the previous update notice", async () => {
    window.localStorage.setItem(storageKey, "true")
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      envelope(updateAvailable)
    )
    const view = renderNotice()

    await waitFor(() =>
      expect(view.queryClient.getQueryState(systemUpdateQueryKey)?.status).toBe(
        "success"
      )
    )

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })

  it("announces the next version after the previous version was dismissed", async () => {
    window.localStorage.setItem(storageKey, "true")
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      envelope({
        ...updateAvailable,
        latest_release: {
          ...updateAvailable.latest_release,
          version: "v0.3.0",
          name: "LinkSense v0.3.0",
          url: "https://github.com/LingX-AI/linksense/releases/tag/v0.3.0",
        },
      })
    )

    renderNotice()

    expect(
      await screen.findByRole("dialog", { name: "LinkSense v0.3.0 已发布" })
    ).toBeVisible()
  })

  it("does not apply another user's dismissal to the current user", async () => {
    window.localStorage.setItem(storageKey, "true")
    authState.user = {
      id: "01900000-0000-7000-8000-000000000100",
      role: "admin",
      status: "active",
    }
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      envelope(updateAvailable)
    )

    renderNotice()

    expect(await screen.findByRole("dialog")).toBeVisible()
    await userEvent.click(screen.getByRole("button", { name: "稍后再说" }))
    expect(
      window.localStorage.getItem(
        "linksense.system-update.dismissed.01900000-0000-7000-8000-000000000100.v0.2.0"
      )
    ).toBe("true")
  })

  it("shows the notice and dismisses it for the page when browser storage is unavailable", async () => {
    vi.spyOn(window.localStorage, "getItem").mockImplementation(() => {
      throw new Error("Storage unavailable")
    })
    const write = vi
      .spyOn(window.localStorage, "setItem")
      .mockImplementation(() => {
        throw new Error("Storage unavailable")
      })
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      envelope(updateAvailable)
    )
    const view = renderNotice()
    await screen.findByRole("dialog")

    await userEvent.click(screen.getByRole("button", { name: "稍后再说" }))

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    )
    await act(async () => {
      await view.queryClient.invalidateQueries({
        queryKey: systemUpdateQueryKey,
      })
    })
    expect(view.queryClient.getQueryState(systemUpdateQueryKey)?.status).toBe(
      "success"
    )
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    expect(write).toHaveBeenCalledExactlyOnceWith(storageKey, "true")
  })

  it("navigates to update settings without marking the release as dismissed", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(envelope(updateAvailable))
    const write = vi.spyOn(window.localStorage, "setItem")
    renderNotice()

    await userEvent.click(await screen.findByRole("link", { name: "查看更新" }))

    expect(
      await screen.findByRole("heading", { name: "Update settings" })
    ).toBeVisible()
    expect(window.localStorage.getItem(storageKey)).toBeNull()
    expect(write).not.toHaveBeenCalled()
  })

  it.each([
    { role: "user", status: "active" },
    { role: "admin", status: "disabled" },
    null,
  ] as const)(
    "does not request or display a notice for ineligible users, including cached update data (%j)",
    async (user) => {
      authState.user = user ? { id: userId, ...user } : null
      const fetch = vi.spyOn(globalThis, "fetch")
      const view = renderNotice()
      await act(async () => {
        view.queryClient.setQueryData(systemUpdateQueryKey, updateAvailable)
      })

      await waitFor(() =>
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
      )
      expect(fetch).not.toHaveBeenCalled()
    }
  )

  it.each([
    { role: "user", status: "active" },
    { role: "admin", status: "disabled" },
  ] as const)(
    "removes an open notice when the current user's eligibility changes to %j",
    async (user) => {
      vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
        envelope(updateAvailable)
      )
      const view = renderNotice()
      await screen.findByRole("dialog")

      authState.user = { id: userId, ...user }
      view.rerender(<SystemUpdateNotice />)

      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
      expect(window.localStorage.getItem(storageKey)).toBeNull()
    }
  )

  it.each(["client update", "maintenance"] as const)(
    "defers an available version until the %s notice is cleared without dismissing it",
    async (priority) => {
      if (priority === "client update")
        priorityState.clientUpdate = "a".repeat(64)
      else priorityState.bootstrap = { maintenance: { active: true } }
      const write = vi.spyOn(window.localStorage, "setItem")
      vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
        envelope(updateAvailable)
      )
      const view = renderNotice()
      await waitFor(() =>
        expect(
          view.queryClient.getQueryState(systemUpdateQueryKey)?.status
        ).toBe("success")
      )

      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
      priorityState.clientUpdate = null
      priorityState.bootstrap = { maintenance: { active: false } }
      view.rerender(<SystemUpdateNotice />)

      expect(
        await screen.findByRole("dialog", { name: "LinkSense v0.2.0 已发布" })
      ).toBeVisible()
      expect(write).not.toHaveBeenCalled()
      expect(window.localStorage.getItem(storageKey)).toBeNull()
    }
  )

  it("keeps a long version title readable within the shared dialog width", async () => {
    const version = `v${"1".repeat(50)}.2.0`
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      envelope({
        ...updateAvailable,
        latest_release: { ...updateAvailable.latest_release, version },
      })
    )
    renderNotice()

    const dialog = await screen.findByRole("dialog", {
      name: `LinkSense ${version} 已发布`,
    })
    const title = within(dialog).getByRole("heading", {
      name: `LinkSense ${version} 已发布`,
    })
    expect(title).toHaveClass("max-w-full", "break-words")
    expect(title.closest('[data-slot="dialog-header"]')).toHaveClass(
      "min-w-0",
      "w-full"
    )
  })

  it("does not display a notice while the version check is loading", async () => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockReturnValue(new Promise<Response>(() => {}))
    renderNotice()

    await waitFor(() => expect(fetch).toHaveBeenCalledOnce())

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })

  it.each([
    { ...updateAvailable, status: "up_to_date", current_version: "v0.2.0" },
    checkFailed,
  ] satisfies SystemUpdateStatus[])(
    "does not display a notice for update status $status",
    async (status) => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(envelope(status))
      const view = renderNotice()

      await waitFor(() =>
        expect(
          view.queryClient.getQueryState(systemUpdateQueryKey)?.status
        ).toBe("success")
      )

      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    }
  )

  it("does not display a notice when the update request fails", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new Error("Network unavailable")
    )
    const view = renderNotice()

    await waitFor(() =>
      expect(view.queryClient.getQueryState(systemUpdateQueryKey)?.status).toBe(
        "error"
      )
    )

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })

  it("preserves an unsent draft when the update appears and is dismissed", async () => {
    let resolveRequest: (response: Response) => void = () => {
      throw new Error("The pending update request has not been initialized")
    }
    vi.spyOn(globalThis, "fetch").mockReturnValue(
      new Promise<Response>((resolve) => {
        resolveRequest = resolve
      })
    )
    renderNotice(
      <>
        <input aria-label="Draft" />
        <SystemUpdateNotice />
      </>
    )
    const interaction = userEvent.setup()
    const draft = screen.getByRole("textbox", { name: "Draft" })
    await interaction.type(draft, "Unsent message")
    resolveRequest(envelope(updateAvailable))
    await screen.findByRole("dialog")

    await interaction.click(screen.getByRole("button", { name: "稍后再说" }))

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    )
    expect(screen.getByRole("textbox", { name: "Draft" })).toBe(draft)
    expect(draft).toHaveValue("Unsent message")
    await waitFor(() => expect(draft).toHaveFocus())
  })

  it.each(supportedLanguages)(
    "renders complete localized notice text without administrator wording in %s",
    async (locale) => {
      const resource = noticeResources[locale]
      expect(Object.keys(resource).sort()).toEqual(
        Object.keys(zhCN.systemUpdate.notice).sort()
      )
      for (const [key, value] of Object.entries(resource)) {
        const source = zhCN.systemUpdate.notice[key as keyof typeof resource]
        const tokens = (text: string) =>
          [...text.matchAll(/\{\{[^{}]+\}\}/gu)].map(([token]) => token).sort()
        expect(tokens(value)).toEqual(tokens(source))
        expect(value).not.toMatch(/管理员|administrat|管理者/iu)
        if (locale !== "zh-CN") expect(value).not.toBe(source)
      }
      await i18n.changeLanguage(locale)
      vi.spyOn(globalThis, "fetch").mockResolvedValue(envelope(updateAvailable))
      renderNotice()

      const dialog = await screen.findByRole("dialog", {
        name: i18n.t("systemUpdate.notice.title", { version: "v0.2.0" }),
      })
      expect(dialog).toHaveAccessibleDescription(resource.description)
      expect(dialog).toHaveTextContent("v0.2.0")
      expect(dialog).not.toHaveTextContent("{{version}}")
      expect(
        within(dialog).getByRole("button", { name: resource.later })
      ).toBeVisible()
      expect(
        within(dialog).getByRole("button", { name: resource.dismiss })
      ).toBeVisible()
      expect(
        within(dialog).getByRole("link", { name: resource.action })
      ).toBeVisible()
    }
  )

  it("falls back to Chinese for missing update notice translations", () => {
    const fallback = i18n.cloneInstance({ forkResourceStore: true })
    fallback.removeResourceBundle("en-US", "translation")

    for (const key of Object.keys(zhCN.systemUpdate.notice)) {
      expect(
        fallback.t(`systemUpdate.notice.${key}`, {
          lng: "en-US",
          version: "v0.2.0",
        })
      ).toBe(
        i18n.t(`systemUpdate.notice.${key}`, {
          lng: "zh-CN",
          version: "v0.2.0",
        })
      )
    }
  })
})
