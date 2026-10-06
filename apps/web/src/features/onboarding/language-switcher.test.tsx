import { act, cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { userSchema } from "@/api/contracts"
import { AuthContext } from "@/app/auth-state"
import { notify } from "@/components/feedback/notification"
import i18n, { supportedLanguages } from "@/i18n"
import { LanguageSwitcher } from "./language-switcher"
import { languageLabelKey } from "./language-labels"

const account = userSchema.parse({
  id: "user",
  name: "User",
  email: "user@example.test",
  role: "user",
  status: "active",
  registration_source: "organization_invitation",
  preferred_locale: "zh-CN",
})
beforeEach(async () => {
  window.localStorage.clear()
  await i18n.changeLanguage("zh-CN")
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("language shortcuts", () => {
  it("uses a compact rounded rectangle for the shared language button", () => {
    render(<LanguageSwitcher />)
    const selector = screen.getByRole("combobox", { name: "界面语言" })
    expect(selector).toHaveClass("rounded-md")
    expect(selector).not.toHaveClass("rounded-lg", "rounded-full")
  })
  it.each(supportedLanguages)(
    "switches publicly to %s and persists the choice without an account request",
    async (locale) => {
      const fetch = vi.fn()
      vi.stubGlobal("fetch", fetch)
      render(<LanguageSwitcher />)
      const user = userEvent.setup()
      await user.click(screen.getByRole("combobox", { name: "界面语言" }))
      await user.click(
        await screen.findByRole("option", {
          name: i18n.t(languageLabelKey(locale)),
        })
      )
      await waitFor(() => expect(document.documentElement.lang).toBe(locale))
      if (locale !== "zh-CN")
        expect(window.localStorage.getItem("linksense.language")).toBe(locale)
      expect(fetch).not.toHaveBeenCalled()
    }
  )

  it.each(supportedLanguages)(
    "saves signed-in language %s and retains it when profile refresh fails",
    async (locale) => {
      if (locale === "zh-CN") await i18n.changeLanguage("en-US")
      const fetch = vi.fn<typeof globalThis.fetch>(
        async () =>
          new Response(
            JSON.stringify({
              success: true,
              data: { ...account, preferred_locale: locale, language: locale },
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          )
      )
      vi.stubGlobal("fetch", fetch)
      const refreshUser = vi.fn(async () => {
        throw new Error("offline")
      })
      render(
        <AuthContext.Provider
          value={{
            status: "authenticated",
            user: account,
            refreshUser,
            acceptSession: vi.fn(),
            signOut: vi.fn(),
          }}
        >
          <LanguageSwitcher />
        </AuthContext.Provider>
      )
      const user = userEvent.setup()
      await user.click(
        screen.getByRole("combobox", {
          name: i18n.t("settings.interfaceLanguage"),
        })
      )
      await user.click(
        await screen.findByRole("option", {
          name: i18n.t(languageLabelKey(locale)),
        })
      )
      await waitFor(() => expect(document.documentElement.lang).toBe(locale))
      expect(JSON.parse(fetch.mock.calls[0]?.[1]?.body as string)).toEqual({
        preferred_locale: locale,
      })
      expect(refreshUser).toHaveBeenCalledOnce()
      expect(window.localStorage.getItem("linksense.language")).toBe(locale)
    }
  )

  it("keeps the existing language when saving fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ success: false, error_code: "ACCESS_DENIED" }),
            { status: 403, headers: { "content-type": "application/json" } }
          )
      )
    )
    const notifyError = vi.spyOn(notify, "error").mockReturnValue("error")
    render(
      <AuthContext.Provider
        value={{
          status: "authenticated",
          user: account,
          refreshUser: vi.fn(),
          acceptSession: vi.fn(),
          signOut: vi.fn(),
        }}
      >
        <LanguageSwitcher />
      </AuthContext.Provider>
    )
    const user = userEvent.setup()
    await user.click(screen.getByRole("combobox", { name: "界面语言" }))
    await user.click(await screen.findByRole("option", { name: "English" }))
    await waitFor(() => expect(notifyError).toHaveBeenCalledOnce())
    expect(document.documentElement.lang).toBe("zh-CN")
    expect(window.localStorage.getItem("linksense.language")).toBeNull()
  })

  it.each(["switch-account", "unmount"])(
    "ignores a late language save after %s",
    async (action) => {
      let finish!: (response: Response) => void
      const response = new Promise<Response>((resolve) => {
        finish = resolve
      })
      const fetch = vi.fn<typeof globalThis.fetch>(async () => response)
      vi.stubGlobal("fetch", fetch)
      const refreshUser = vi.fn()
      const auth = {
        status: "authenticated" as const,
        user: account,
        refreshUser,
        acceptSession: vi.fn(),
        signOut: vi.fn(),
      }
      const view = render(
        <AuthContext.Provider value={auth}>
          <LanguageSwitcher />
        </AuthContext.Provider>
      )
      const user = userEvent.setup()
      await user.click(screen.getByRole("combobox", { name: "界面语言" }))
      await user.click(await screen.findByRole("option", { name: "English" }))
      expect(screen.getByRole("combobox", { name: "界面语言" })).toBeDisabled()
      if (action === "unmount") view.unmount()
      else
        view.rerender(
          <AuthContext.Provider
            value={{
              ...auth,
              user: { ...account, id: "other-user", language: "ja-JP" },
            }}
          >
            <LanguageSwitcher />
          </AuthContext.Provider>
        )
      await i18n.changeLanguage("ja-JP")
      await act(async () => {
        finish(
          new Response(
            JSON.stringify({
              success: true,
              data: { ...account, language: "en-US" },
            }),
            { headers: { "content-type": "application/json" } }
          )
        )
        await response
      })
      expect(document.documentElement.lang).toBe("ja-JP")
      expect(refreshUser).not.toHaveBeenCalled()
      expect(fetch.mock.calls[0]?.[1]?.signal?.aborted).toBe(true)
    }
  )
})
