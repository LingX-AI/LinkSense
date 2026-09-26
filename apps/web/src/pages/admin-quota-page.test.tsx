import { defaultQuotaSettings } from "@linksense/shared"
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

import { setAccessToken } from "@/api/session"
import { notify } from "@/components/feedback/notification"
import i18n from "@/i18n"
import { AdminQuotaPage, QuotaSettingsForm } from "@/pages/admin-quota-page"

const { refreshUser } = vi.hoisted(() => ({
  refreshUser: vi.fn(async () => undefined),
}))
vi.mock("@/app/auth-state", () => ({ useAuth: () => ({ refreshUser }) }))

function renderPage(form = false) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      {form ? (
        <QuotaSettingsForm
          settings={defaultQuotaSettings()}
          onUsersChanged={refreshUser}
        />
      ) : (
        <AdminQuotaPage />
      )}
    </QueryClientProvider>
  )
}

function envelope(data: unknown) {
  return new Response(JSON.stringify({ success: true, data }), {
    status: 200,
    headers: { "content-type": "application/json" },
  })
}

async function chooseMemberQuotaAction(
  user: ReturnType<typeof userEvent.setup>,
  name: "重置全员额度" | "应用限额到全员"
) {
  await user.click(screen.getByRole("button", { name: "成员额度操作" }))
  await user.click(await screen.findByRole("menuitem", { name }))
}

beforeEach(async () => {
  refreshUser.mockClear()
  setAccessToken("quota-settings-test")
  await i18n.changeLanguage("zh-CN")
})

afterEach(() => {
  cleanup()
  notify.dismiss()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("quota management", () => {
  it.each(["zh-CN", "en-US", "de-DE"])(
    "renders the unified member quota controls and fallback for %s",
    async (language) => {
      await i18n.changeLanguage(language)
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => envelope(defaultQuotaSettings()))
      )
      const user = userEvent.setup()

      renderPage()

      expect(
        await screen.findByText(
          language === "en-US" ? "Credit conversion" : "Credits 换算"
        )
      ).toBeVisible()
      expect(screen.getAllByRole("textbox")).toHaveLength(2)
      expect(
        screen.getAllByRole("button", {
          name: language === "en-US" ? "Save settings" : "保存设置",
        })
      ).toHaveLength(2)
      const actions = screen.getByRole("button", {
        name: language === "en-US" ? "Member quota actions" : "成员额度操作",
      })
      expect(
        actions.closest('[data-slot="settings-section-action"]')
      ).not.toBeNull()
      expect(actions.closest('[data-slot="card"]')).toBeNull()
      for (const input of screen.getAllByRole("textbox")) {
        expect(input.closest('[data-slot="card-content"]')).toHaveClass(
          "px-4",
          "sm:px-5"
        )
      }
      expect(
        screen.queryByRole("button", {
          name: language === "en-US" ? "Reset quotas for all" : "重置全员额度",
        })
      ).not.toBeInTheDocument()
      await user.click(actions)
      const resetAction = await screen.findByRole("menuitem", {
        name: language === "en-US" ? "Reset quotas for all" : "重置全员额度",
      })
      expect(resetAction).toBeVisible()
      expect(
        resetAction.closest('[data-slot="dropdown-menu-content"]')
      ).toHaveClass("w-max", "whitespace-nowrap")
      expect(
        screen.getByRole("menuitem", {
          name: language === "en-US" ? "Apply limit to all" : "应用限额到全员",
        })
      ).toBeVisible()
      expect(
        screen.queryByText(
          language === "en-US"
            ? "Self-registered user quota"
            : "开放注册用户额度"
        )
      ).not.toBeInTheDocument()
      expect(
        screen.queryByLabelText(/总额度|Total quota/u)
      ).not.toBeInTheDocument()
    }
  )

  it("saves conversion and unified weekly quota independently while preserving the other draft", async () => {
    const fetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) =>
      envelope({
        code: "SYSTEM_SETTINGS_UPDATED",
        settings: JSON.parse(String(init?.body)),
      })
    )
    vi.stubGlobal("fetch", fetch)
    const saved = vi.spyOn(notify, "success")
    const user = userEvent.setup()
    renderPage(true)
    const price = screen.getByLabelText("1 credit 对应金额（美元）")
    const weekly = screen.getByLabelText("周额度（credits）")

    await user.clear(price)
    await user.type(price, "0.02")
    await user.type(weekly, "100")
    const saves = screen.getAllByRole("button", { name: "保存设置" })
    await user.click(saves[0]!)

    await waitFor(() => expect(saved).toHaveBeenCalledTimes(1))
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toEqual({
      ...defaultQuotaSettings(),
      credit_price_usd: "0.02",
    })
    expect(weekly).toHaveValue("100")

    await user.click(saves[1]!)
    await waitFor(() => expect(saved).toHaveBeenCalledTimes(2))
    expect(JSON.parse(String(fetch.mock.calls[1]?.[1]?.body))).toEqual({
      credit_price_usd: "0.02",
      weekly_credit_limit: "100",
    })
  })

  it("submits the weekly quota on Enter even when the conversion draft is invalid", async () => {
    const fetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) =>
      envelope({
        code: "SYSTEM_SETTINGS_UPDATED",
        settings: JSON.parse(String(init?.body)),
      })
    )
    vi.stubGlobal("fetch", fetch)
    const user = userEvent.setup()
    renderPage(true)
    const price = screen.getByLabelText("1 credit 对应金额（美元）")
    const weekly = screen.getByLabelText("周额度（credits）")

    await user.clear(price)
    await user.type(price, "0")
    await user.type(weekly, "25{Enter}")

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toEqual({
      ...defaultQuotaSettings(),
      weekly_credit_limit: "25",
    })
    expect(price).toHaveValue("0")
    expect(price).toHaveAttribute("aria-invalid", "false")
  })

  it("validates conversion and weekly quota precision without submitting invalid values", async () => {
    const fetch = vi.fn()
    vi.stubGlobal("fetch", fetch)
    const user = userEvent.setup()
    renderPage(true)
    const price = screen.getByLabelText("1 credit 对应金额（美元）")
    const weekly = screen.getByLabelText("周额度（credits）")
    const saves = screen.getAllByRole("button", { name: "保存设置" })

    await user.clear(price)
    await user.type(price, "0")
    await user.type(weekly, "0.0000001")
    await user.click(saves[0]!)
    expect(price).toHaveAttribute("aria-invalid", "true")
    await user.click(saves[1]!)
    expect(weekly).toHaveAttribute("aria-invalid", "true")
    expect(fetch).not.toHaveBeenCalled()
  })

  it("disables controls during save, prevents duplicate requests, and retains the weekly draft on failure", async () => {
    let rejectRequest: (error: Error) => void = () => {
      throw new Error("request not started")
    }
    const fetch = vi.fn(
      () =>
        new Promise<Response>((_resolve, reject) => {
          rejectRequest = reject
        })
    )
    vi.stubGlobal("fetch", fetch)
    const user = userEvent.setup()
    renderPage(true)
    const weekly = screen.getByLabelText("周额度（credits）")
    await user.type(weekly, "123")
    const save = screen.getAllByRole("button", { name: "保存设置" })[1]!

    await user.dblClick(save)

    expect(save).toBeDisabled()
    expect(save).toHaveAttribute("aria-busy", "true")
    expect(weekly).toBeDisabled()
    expect(fetch).toHaveBeenCalledTimes(1)
    rejectRequest(new Error("Request failed"))
    await waitFor(() => expect(save).toBeEnabled())
    expect(weekly).toHaveValue("123")
    expect(screen.getByRole("alert")).toBeVisible()
  })

  it("shows a retry action after loading fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("Request failed")
      })
    )
    renderPage()

    expect(await screen.findByRole("button", { name: "重试" })).toBeVisible()
    expect(
      within(document.body).queryByRole("button", { name: "保存设置" })
    ).not.toBeInTheDocument()
  })

  it("confirms one all-member reset, posts an empty command, and preserves the unsaved draft", async () => {
    let finish: (response: Response) => void = () => {
      throw new Error("request not started")
    }
    const fetch = vi.fn<
      (url: RequestInfo | URL, init?: RequestInit) => Promise<Response>
    >(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve
        })
    )
    vi.stubGlobal("fetch", fetch)
    const saved = vi.spyOn(notify, "success")
    const user = userEvent.setup()
    renderPage(true)
    const weekly = screen.getByLabelText("周额度（credits）")
    await user.type(weekly, "123")

    await chooseMemberQuotaAction(user, "重置全员额度")
    let dialog = screen.getByRole("dialog", { name: "重置全员额度" })
    expect(dialog).toHaveTextContent("100%")
    expect(dialog).toHaveTextContent("未保存")
    await user.click(within(dialog).getByRole("button", { name: "取消" }))
    expect(fetch).not.toHaveBeenCalled()

    await chooseMemberQuotaAction(user, "重置全员额度")
    dialog = screen.getByRole("dialog", { name: "重置全员额度" })
    const confirm = within(dialog).getByRole("button", { name: "确认重置额度" })
    expect(confirm).toHaveClass("bg-destructive", "text-destructive-foreground")
    await user.dblClick(confirm)
    expect(confirm).toBeDisabled()
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(String(fetch.mock.calls[0]?.[0])).toContain(
      "/admin/quota-settings/reset"
    )
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toEqual({})
    finish(envelope({ updated_user_count: 4 }))
    await waitFor(() =>
      expect(saved).toHaveBeenCalledWith("已重置 4 位成员的额度。")
    )
    expect(refreshUser).toHaveBeenCalledTimes(1)
    expect(weekly).toHaveValue("123")
  })

  it("previews, saves, and applies the unified weekly limit to every member", async () => {
    const limits = { weekly_credit_limit: "150.5" }
    const fetch = vi.fn<
      (url: RequestInfo | URL, init?: RequestInit) => Promise<Response>
    >(async () =>
      envelope({
        updated_user_count: 3,
        settings: { ...defaultQuotaSettings(), ...limits },
      })
    )
    vi.stubGlobal("fetch", fetch)
    const saved = vi.spyOn(notify, "success")
    const user = userEvent.setup()
    renderPage(true)
    const price = screen.getByLabelText("1 credit 对应金额（美元）")
    const weekly = screen.getByLabelText("周额度（credits）")
    await user.clear(price)
    await user.type(price, "0.02")
    await user.type(weekly, "150.5")

    await chooseMemberQuotaAction(user, "应用限额到全员")
    const dialog = screen.getByRole("dialog", { name: "应用限额到全员" })
    expect(dialog).toHaveTextContent("150.5")
    expect(
      within(dialog).getByRole("button", { name: "确认保存并应用" })
    ).not.toHaveClass("bg-destructive")
    await user.click(
      within(dialog).getByRole("button", { name: "确认保存并应用" })
    )

    await waitFor(() =>
      expect(saved).toHaveBeenCalledWith("已保存新限额，并应用到 3 位成员。")
    )
    expect(String(fetch.mock.calls[0]?.[0])).toContain(
      "/admin/quota-settings/apply-member-limits"
    )
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toEqual({
      limits,
    })
    expect(price).toHaveValue("0.02")
    expect(refreshUser).toHaveBeenCalledTimes(1)
  })

  it("rejects an invalid weekly limit before opening apply confirmation", async () => {
    const fetch = vi.fn()
    vi.stubGlobal("fetch", fetch)
    const user = userEvent.setup()
    renderPage(true)
    const weekly = screen.getByLabelText("周额度（credits）")
    await user.type(weekly, "-1")

    await chooseMemberQuotaAction(user, "应用限额到全员")

    expect(weekly).toHaveAttribute("aria-invalid", "true")
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    expect(fetch).not.toHaveBeenCalled()
  })

  it("shows a failed reset and preserves the draft for retry", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("Request failed")
      })
    )
    const user = userEvent.setup()
    renderPage(true)
    const weekly = screen.getByLabelText("周额度（credits）")
    await user.type(weekly, "99")
    const trigger = screen.getByRole("button", { name: "成员额度操作" })

    await chooseMemberQuotaAction(user, "重置全员额度")
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "确认重置额度",
      })
    )

    await waitFor(() => expect(screen.getByRole("alert")).toBeVisible())
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    expect(trigger).toBeEnabled()
    expect(weekly).toHaveValue("99")
    expect(refreshUser).not.toHaveBeenCalled()
  })
})
