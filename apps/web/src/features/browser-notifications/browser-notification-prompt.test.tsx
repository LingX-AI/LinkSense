import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { I18nextProvider } from "react-i18next"

import { apiRequest } from "@/api/client"
import { useAuth } from "@/app/auth-state"
import { browserNotificationPromptDismissedStorageKey } from "@/features/browser-notifications/browser-notification-prompt-preference"
import { BrowserNotificationPrompt } from "@/features/browser-notifications/browser-notification-prompt"
import { browserNotificationStorageKey } from "@/features/browser-notifications/browser-notification-preference"
import i18n from "@/i18n"

vi.mock("@/api/client", () => ({ apiRequest: vi.fn() }))
vi.mock("@/app/auth-state", () => ({ useAuth: vi.fn() }))

const USER_ID = "10000000-0000-4000-8000-000000000021"

function installNotificationApi(options: {
  permission?: NotificationPermission
  requestResult?: NotificationPermission
}) {
  let permission = options.permission ?? "default"
  const instances: Array<{ title: string; options?: NotificationOptions }> = []
  const requestPermission = vi.fn(async () => {
    permission = options.requestResult ?? permission
    return permission
  })

  class TestNotification {
    static get permission() {
      return permission
    }

    static requestPermission = requestPermission

    onclick: (() => void) | null = null
    onerror: ((event: Event) => void) | null = null
    onshow: ((event: Event) => void) | null = null
    close = vi.fn()
    title: string
    options: NotificationOptions | undefined

    constructor(title: string, notificationOptions?: NotificationOptions) {
      this.title = title
      this.options = notificationOptions
      instances.push(this)
      queueMicrotask(() => this.onshow?.(new Event("show")))
    }
  }

  vi.stubGlobal(
    "Notification",
    TestNotification as unknown as typeof Notification
  )
  return { instances, requestPermission }
}

function renderPrompt() {
  return render(
    <I18nextProvider i18n={i18n}>
      <BrowserNotificationPrompt />
    </I18nextProvider>
  )
}

describe("BrowserNotificationPrompt", () => {
  beforeEach(async () => {
    window.localStorage.clear()
    window.sessionStorage.clear()
    vi.clearAllMocks()
    vi.mocked(useAuth).mockReturnValue({
      status: "authenticated",
      user: { id: USER_ID },
    } as ReturnType<typeof useAuth>)
    vi.mocked(apiRequest).mockResolvedValue({
      items: [],
      next_cursor: "completion-baseline-cursor",
    })
    await i18n.changeLanguage("zh-CN")
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    window.localStorage.clear()
    window.sessionStorage.clear()
  })

  it("shows a LinkSense-styled prompt in the lower-right corner", () => {
    installNotificationApi({ permission: "default" })

    renderPrompt()

    const prompt = screen.getByRole("region", {
      name: "任务完成时接收浏览器通知和提示音。",
    })
    expect(prompt).toHaveClass(
      "browser-notification-prompt",
      "fixed",
      "bottom-[max(0.75rem,env(safe-area-inset-bottom))]",
      "left-3",
      "z-40",
      "md:right-6",
      "md:bottom-6",
      "md:left-auto",
      "md:w-[300px]"
    )
    expect(screen.getByRole("button", { name: "暂时不用" })).toHaveClass(
      "browser-notification-prompt-dismiss",
      "h-8"
    )
    expect(screen.getByRole("button", { name: "开启" })).toHaveClass("h-8")
  })

  it("hides the prompt for the rest of the current browser session", async () => {
    installNotificationApi({ permission: "default" })
    const interaction = userEvent.setup()
    const firstRender = renderPrompt()

    await interaction.click(screen.getByRole("button", { name: "暂时不用" }))

    expect(screen.queryByRole("region")).not.toBeInTheDocument()
    expect(
      window.sessionStorage.getItem(
        browserNotificationPromptDismissedStorageKey(USER_ID)
      )
    ).toBe("true")

    firstRender.unmount()
    renderPrompt()
    expect(screen.queryByRole("region")).not.toBeInTheDocument()
  })

  it("enables notifications through the same verified activation flow as settings", async () => {
    const notificationApi = installNotificationApi({
      permission: "default",
      requestResult: "granted",
    })
    const interaction = userEvent.setup()
    renderPrompt()

    await interaction.click(screen.getByRole("button", { name: "开启" }))

    await waitFor(() => expect(screen.queryByRole("region")).toBeNull())
    expect(notificationApi.requestPermission).toHaveBeenCalledTimes(1)
    expect(notificationApi.instances[0]).toMatchObject({
      title: "LinkSense · 浏览器通知测试",
      options: {
        body: "通知已连接，任务或自动化产出结果后会在这里提醒你。",
      },
    })
    expect(apiRequest).toHaveBeenCalledWith("/completion-notifications", {
      schema: expect.anything(),
      query: { limit: 100 },
    })
    expect(
      window.localStorage.getItem(browserNotificationStorageKey(USER_ID))
    ).toBe("true")
  })

  it("stays visible with recovery guidance when permission is dismissed", async () => {
    installNotificationApi({
      permission: "default",
      requestResult: "default",
    })
    const interaction = userEvent.setup()
    renderPrompt()

    await interaction.click(screen.getByRole("button", { name: "开启" }))

    expect(await screen.findByText(/尚未允许通知/u)).toBeVisible()
    expect(screen.getByRole("region")).toBeVisible()
  })

  it("does not show an unusable prompt when notifications are unsupported", () => {
    renderPrompt()

    expect(screen.queryByRole("region")).not.toBeInTheDocument()
  })

  it("does not show after notifications are already enabled", () => {
    installNotificationApi({ permission: "granted" })
    window.localStorage.setItem(browserNotificationStorageKey(USER_ID), "true")

    renderPrompt()

    expect(screen.queryByRole("region")).not.toBeInTheDocument()
  })
})
