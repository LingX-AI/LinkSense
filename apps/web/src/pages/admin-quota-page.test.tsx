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
import { defaultQuotaSettings } from "@linksense/shared"
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
  it.each(["zh-CN", "en-US", "fr-FR"])(
    "renders translated controls and fallback for %s",
    async (language) => {
      await i18n.changeLanguage(language)
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => envelope(defaultQuotaSettings()))
      )
      renderPage()
      expect(
        await screen.findByText(
          language === "en-US" ? "Credit conversion" : "Credits 换算"
        )
      ).toBeVisible()
      expect(screen.getAllByRole("textbox")).toHaveLength(7)
      const saves = screen.getAllByRole("button", {
        name: language === "en-US" ? "Save settings" : "保存设置",
      })
      expect(saves).toHaveLength(3)
      for (const save of saves) {
        const footer = save.closest('[data-slot="card-footer"]')
        expect(footer).not.toBeNull()
        expect(save.parentElement?.lastElementChild).toBe(save)
        expect(save.parentElement).toHaveClass("justify-end")
        expect(footer?.parentElement?.lastElementChild).toBe(footer)
      }
      const save = saves[0]!
      const sharedButtonClasses = [
        "h-8",
        "gap-1.5",
        "px-3",
        "rounded-lg",
        "text-sm",
        "font-medium",
        "whitespace-nowrap",
      ]
      expect(save).toBeEnabled()
      expect(save).toHaveClass(...sharedButtonClasses)
      const resetButtons = screen.getAllByRole("button", {
        name: language === "en-US" ? "Reset quotas for all" : "重置全员额度",
      })
      expect(resetButtons).toHaveLength(2)
      const applyButton = screen.getByRole("button", {
        name: language === "en-US" ? "Apply limits to all" : "应用限额到全员",
      })
      for (const button of [...resetButtons, applyButton]) {
        expect(button).toBeEnabled()
        expect(button).toHaveClass("bg-secondary", "text-secondary-foreground")
        expect(button).toHaveClass(...sharedButtonClasses)
        expect(
          button.querySelector('svg[data-icon="inline-start"]')
        ).toHaveAttribute("aria-hidden", "true")
      }
    }
  )

  it("saves each card independently, preserves other drafts, and retains previously saved settings", async () => {
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
    const price = screen.getByLabelText("1 credit 对应金额（人民币元）")
    await user.clear(price)
    await user.type(price, "0.02")
    const weekly = screen.getAllByLabelText("周额度（credits）")
    const monthly = screen.getAllByLabelText("月额度（credits）")
    const total = screen.getAllByLabelText("总额度（credits）")
    await user.type(weekly[0]!, "100")
    await user.type(total[0]!, "1000")
    await user.type(monthly[1]!, "20.5")
    const saves = screen.getAllByRole("button", { name: "保存设置" })
    await user.click(saves[0]!)
    await waitFor(() => expect(saved).toHaveBeenCalledTimes(1))
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toEqual({
      ...defaultQuotaSettings(),
      credit_price_cny: "0.02",
    })
    expect(weekly[0]).toHaveValue("100")
    expect(monthly[1]).toHaveValue("20.5")
    await user.click(saves[1]!)
    await waitFor(() => expect(saved).toHaveBeenCalledTimes(2))
    expect(JSON.parse(String(fetch.mock.calls[1]?.[1]?.body))).toEqual({
      ...defaultQuotaSettings(),
      credit_price_cny: "0.02",
      organization_members: {
        weekly_credit_limit: "100",
        monthly_credit_limit: null,
        total_credit_limit: "1000",
      },
    })
    await user.click(saves[2]!)
    await waitFor(() => expect(saved).toHaveBeenCalledTimes(3))
    await waitFor(() => expect(saved).toHaveBeenCalledWith("额度设置已保存。"))
    expect(JSON.parse(String(fetch.mock.calls[2]?.[1]?.body))).toEqual({
      credit_price_cny: "0.02",
      organization_members: {
        weekly_credit_limit: "100",
        monthly_credit_limit: null,
        total_credit_limit: "1000",
      },
      self_registered_users: {
        weekly_credit_limit: null,
        monthly_credit_limit: "20.5",
        total_credit_limit: null,
      },
    })
  })

  it("submits only the focused card on Enter even when another card is invalid", async () => {
    const fetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) =>
      envelope({
        code: "SYSTEM_SETTINGS_UPDATED",
        settings: JSON.parse(String(init?.body)),
      })
    )
    vi.stubGlobal("fetch", fetch)
    const user = userEvent.setup()
    renderPage(true)
    const price = screen.getByLabelText("1 credit 对应金额（人民币元）")
    await user.clear(price)
    await user.type(price, "0")
    const weekly = screen.getAllByLabelText("周额度（credits）")[1]!
    await user.type(weekly, "25{Enter}")
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toEqual({
      ...defaultQuotaSettings(),
      self_registered_users: {
        weekly_credit_limit: "25",
        monthly_credit_limit: null,
        total_credit_limit: null,
      },
    })
    await waitFor(() => expect(weekly).toBeEnabled())
    expect(price).toHaveValue("0")
    expect(price).toHaveAttribute("aria-invalid", "false")
  })

  it("validates price and quota precision without submitting invalid values", async () => {
    const fetch = vi.fn()
    vi.stubGlobal("fetch", fetch)
    const user = userEvent.setup()
    renderPage(true)
    const price = screen.getByLabelText("1 credit 对应金额（人民币元）")
    await user.clear(price)
    await user.type(price, "0")
    await user.type(
      screen.getAllByLabelText("总额度（credits）")[1]!,
      "0.0000001"
    )
    await user.click(screen.getAllByRole("button", { name: "保存设置" })[0]!)
    expect(price).toHaveAttribute("aria-invalid", "true")
    expect(screen.getAllByText(/请输入大于 0、最多 6 位小数/u)).toHaveLength(1)
    await user.click(screen.getAllByRole("button", { name: "保存设置" })[2]!)
    expect(screen.getAllByLabelText("总额度（credits）")[1]).toHaveAttribute(
      "aria-invalid",
      "true"
    )
    expect(fetch).not.toHaveBeenCalled()
  })

  it("disables controls during save, prevents duplicate requests, and retains inputs on failure", async () => {
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
    const total = screen.getAllByLabelText("总额度（credits）")[0]!
    await user.type(total, "123")
    const save = screen.getAllByRole("button", { name: "保存设置" })[1]!
    await user.dblClick(save)
    expect(save).toBeDisabled()
    expect(save).toHaveAttribute("aria-busy", "true")
    for (const other of screen.getAllByRole("button", { name: "保存设置" })) {
      expect(other).toBeDisabled()
      if (other !== save) expect(other).not.toHaveAttribute("aria-busy")
    }
    expect(total).toBeDisabled()
    expect(fetch).toHaveBeenCalledTimes(1)
    rejectRequest(new Error("Request failed"))
    await waitFor(() => expect(save).toBeEnabled())
    expect(total).toHaveValue("123")
    expect(screen.getByRole("alert")).toBeVisible()
  })

  it("shows a loading state and a retry action after loading fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("Request failed")
      })
    )
    renderPage()
    const retry = await screen.findByRole("button", { name: "重试" })
    expect(retry).toBeVisible()
    expect(
      within(document.body).queryByRole("button", { name: "保存设置" })
    ).not.toBeInTheDocument()
  })

  it.each([
    ["organization_members", "组织成员初始额度"],
    ["self_registered_users", "开放注册用户额度"],
  ])(
    "confirms %s reset before posting immediately, supports cancellation, and prevents duplicate submissions",
    async (scope, formName) => {
      const label = "重置全员额度"
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
      const weekly = screen.getAllByLabelText("周额度（credits）")[0]!
      await user.type(weekly, "123")
      const trigger = within(
        screen.getByRole("form", { name: formName })
      ).getByRole("button", { name: label })
      await user.click(trigger)
      let dialog = screen.getByRole("dialog", { name: label })
      expect(dialog).toHaveTextContent("100%")
      expect(dialog).toHaveTextContent("未保存")
      expect(fetch).not.toHaveBeenCalled()
      await user.click(within(dialog).getByRole("button", { name: "取消" }))
      await waitFor(() =>
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
      )
      expect(fetch).not.toHaveBeenCalled()
      await user.click(trigger)
      dialog = screen.getByRole("dialog", { name: label })
      const confirm = within(dialog).getByRole("button", {
        name: "确认重置额度",
      })
      await user.dblClick(confirm)
      expect(confirm).toBeDisabled()
      expect(
        within(dialog).getByRole("button", { name: "取消" })
      ).toBeDisabled()
      expect(trigger).toBeDisabled()
      expect(weekly).toBeDisabled()
      expect(fetch).toHaveBeenCalledTimes(1)
      expect(String(fetch.mock.calls[0]?.[0])).toContain(
        "/admin/quota-settings/reset"
      )
      expect(fetch.mock.calls[0]?.[1]?.method).toBe("POST")
      expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toEqual({
        scope,
      })
      finish(envelope({ updated_user_count: 4 }))
      await waitFor(() =>
        expect(saved).toHaveBeenCalledWith("已重置 4 位成员的额度。")
      )
      await waitFor(() => expect(trigger).toBeEnabled())
      expect(refreshUser).toHaveBeenCalledTimes(1)
      expect(weekly).toHaveValue("123")
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    }
  )

  it("previews new organization limits before applying and retains other unsaved settings", async () => {
    const limits = {
      weekly_credit_limit: "150.5",
      monthly_credit_limit: null,
      total_credit_limit: "1000",
    }
    const fetch = vi.fn<
      (url: RequestInfo | URL, init?: RequestInit) => Promise<Response>
    >(async () =>
      envelope({
        updated_user_count: 3,
        settings: { ...defaultQuotaSettings(), organization_members: limits },
      })
    )
    vi.stubGlobal("fetch", fetch)
    const saved = vi.spyOn(notify, "success")
    const user = userEvent.setup()
    renderPage(true)
    const price = screen.getByLabelText("1 credit 对应金额（人民币元）")
    await user.clear(price)
    await user.type(price, "0.02")
    await user.type(screen.getAllByLabelText("周额度（credits）")[0]!, "150.5")
    await user.type(screen.getAllByLabelText("总额度（credits）")[0]!, "1000")
    const selfWeekly = screen.getAllByLabelText("周额度（credits）")[1]!
    await user.type(selfWeekly, "200")
    const apply = screen.getByRole("button", {
      name: "应用限额到全员",
    })
    await user.click(apply)
    let dialog = screen.getByRole("dialog", {
      name: "应用限额到全员",
    })
    expect(dialog).toHaveTextContent("150.5")
    expect(dialog).toHaveTextContent("1000")
    expect(dialog).toHaveTextContent("不限额")
    expect(fetch).not.toHaveBeenCalled()
    await user.click(within(dialog).getByRole("button", { name: "取消" }))
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    )
    expect(fetch).not.toHaveBeenCalled()
    await user.click(apply)
    dialog = screen.getByRole("dialog", {
      name: "应用限额到全员",
    })
    await user.click(
      within(dialog).getByRole("button", { name: "确认保存并应用" })
    )
    await waitFor(() =>
      expect(saved).toHaveBeenCalledWith(
        "已保存新限额，并应用到 3 位组织成员。"
      )
    )
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(String(fetch.mock.calls[0]?.[0])).toContain(
      "/admin/quota-settings/apply-organization-limits"
    )
    expect(fetch.mock.calls[0]?.[1]?.method).toBe("POST")
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toEqual({
      limits,
    })
    expect(price).toHaveValue("0.02")
    expect(selfWeekly).toHaveValue("200")
    expect(refreshUser).toHaveBeenCalledTimes(1)
  })

  it("rejects invalid organization limits before opening the apply confirmation", async () => {
    const fetch = vi.fn()
    vi.stubGlobal("fetch", fetch)
    const user = userEvent.setup()
    renderPage(true)
    const weekly = screen.getAllByLabelText("周额度（credits）")[0]!
    await user.type(weekly, "-1")
    await user.click(screen.getByRole("button", { name: "应用限额到全员" }))
    expect(weekly).toHaveAttribute("aria-invalid", "true")
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    expect(fetch).not.toHaveBeenCalled()
  })

  it("shows a failed batch operation and preserves the draft for retry", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("Request failed")
      })
    )
    const user = userEvent.setup()
    renderPage(true)
    const weekly = screen.getAllByLabelText("周额度（credits）")[0]!
    await user.type(weekly, "99")
    const trigger = within(
      screen.getByRole("form", { name: "组织成员初始额度" })
    ).getByRole("button", { name: "重置全员额度" })
    await user.click(trigger)
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
