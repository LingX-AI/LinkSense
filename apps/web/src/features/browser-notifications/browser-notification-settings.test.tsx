import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { I18nextProvider } from "react-i18next"

import { apiRequest } from "@/api/client"
import { BrowserNotificationSettings } from "@/features/browser-notifications/browser-notification-settings"
import { browserNotificationStorageKey } from "@/features/browser-notifications/browser-notification-preference"
import i18n from "@/i18n"

vi.mock("@/api/client", () => ({ apiRequest: vi.fn() }))

const USER_ID = "10000000-0000-4000-8000-000000000001"

function installNotificationApi(apiOptions: {
  permission?: NotificationPermission
  requestResult?: NotificationPermission
  requestError?: Error
  constructorError?: Error
  displayError?: boolean
}) {
  let permission: NotificationPermission = apiOptions.permission ?? "default"
  const instances: Array<{ title: string; options?: NotificationOptions }> = []
  const requestPermission = vi.fn(async () => {
    if (apiOptions.requestError) throw apiOptions.requestError
    permission = apiOptions.requestResult ?? permission
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

    constructor(title: string, options?: NotificationOptions) {
      if (apiOptions.constructorError) throw apiOptions.constructorError
      this.title = title
      this.options = options
      instances.push(this)
      queueMicrotask(() => {
        if (apiOptions.displayError) this.onerror?.(new Event("error"))
        else this.onshow?.(new Event("show"))
      })
    }
  }
  vi.stubGlobal(
    "Notification",
    TestNotification as unknown as typeof Notification
  )
  return { instances, requestPermission }
}

function renderSettings(userId = USER_ID) {
  return render(
    <I18nextProvider i18n={i18n}>
      <BrowserNotificationSettings userId={userId} />
    </I18nextProvider>
  )
}

describe("BrowserNotificationSettings", () => {
  beforeEach(async () => {
    window.localStorage.clear()
    vi.clearAllMocks()
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
  })

  it("requests permission only after the user enables the setting", async () => {
    const notificationApi = installNotificationApi({
      requestResult: "granted",
    })
    const interaction = userEvent.setup()
    renderSettings()
    const notificationSwitch = screen.getByRole("switch", {
      name: "启用浏览器通知",
    })
    const notificationHeading = screen.getByRole("heading", {
      name: "浏览器通知",
    })
    expect(
      notificationSwitch.closest('[data-slot="settings-section-title-row"]')
    ).toContainElement(notificationHeading)
    expect(
      notificationSwitch.closest('[data-slot="settings-section-title-action"]')
    ).not.toBeNull()

    expect(notificationSwitch).not.toBeChecked()
    expect(notificationApi.requestPermission).not.toHaveBeenCalled()

    await interaction.click(notificationSwitch)

    await waitFor(() => expect(notificationSwitch).toBeChecked())
    expect(notificationApi.requestPermission).toHaveBeenCalledTimes(1)
    expect(apiRequest).toHaveBeenCalledWith("/completion-notifications", {
      schema: expect.anything(),
      query: { limit: 100 },
    })
    expect(notificationApi.instances).toHaveLength(1)
    expect(notificationApi.instances[0]).toMatchObject({
      title: "LinkSense · 浏览器通知测试",
      options: {
        body: "通知已连接，任务或自动化产出结果后会在这里提醒你。",
      },
    })
    expect(await screen.findByText(/已请求系统显示测试通知/u)).toBeVisible()
    expect(
      screen.queryByRole("button", { name: "发送测试通知" })
    ).not.toBeInTheDocument()
    expect(
      window.localStorage.getItem(browserNotificationStorageKey(USER_ID))
    ).toBe("true")

    await interaction.click(notificationSwitch)
    expect(notificationSwitch).not.toBeChecked()
    expect(notificationApi.requestPermission).toHaveBeenCalledTimes(1)
  })

  it("keeps the settings panel compact without the removed inline content", () => {
    renderSettings()

    expect(screen.getByRole("heading", { name: "浏览器通知" })).toBeVisible()
    expect(
      screen.getByText(/通过当前浏览器通知普通任务或自动化/u)
    ).toBeVisible()
    expect(screen.getByRole("switch", { name: "启用浏览器通知" })).toBeVisible()
    expect(screen.queryByText(/^启用浏览器通知$/u)).not.toBeInTheDocument()
    expect(screen.queryByText(/仅在此浏览器中生效/u)).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: /测试通知/u })
    ).not.toBeInTheDocument()
  })

  it("does not show manual test buttons when browser notifications are enabled", () => {
    installNotificationApi({ permission: "granted" })
    window.localStorage.setItem(browserNotificationStorageKey(USER_ID), "true")

    renderSettings()

    expect(screen.getByRole("switch", { name: "启用浏览器通知" })).toBeChecked()
    expect(
      screen.queryByRole("button", { name: /测试通知/u })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: /重新授权/u })
    ).not.toBeInTheDocument()
    expect(screen.queryByText(/仅在此浏览器中生效/u)).not.toBeInTheDocument()
  })

  it("explains reset saved grants without rendering a recovery button", () => {
    installNotificationApi({})
    window.localStorage.setItem(browserNotificationStorageKey(USER_ID), "true")

    renderSettings()

    expect(screen.getByText(/请关闭后重新开启浏览器通知/u)).toBeVisible()
    expect(
      screen.queryByRole("button", { name: /重新授权/u })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: /测试通知/u })
    ).not.toBeInTheDocument()
  })

  it("keeps the reset recovery copy localized in English", async () => {
    await i18n.changeLanguage("en-US")
    installNotificationApi({})
    window.localStorage.setItem(browserNotificationStorageKey(USER_ID), "true")

    renderSettings()

    expect(
      screen.getByText(/Turn browser notifications off, then on again/u)
    ).toBeVisible()
    expect(
      screen.getByRole("switch", { name: "Enable browser notifications" })
    ).toBeChecked()
    expect(
      screen.queryByRole("button", { name: /test notification/iu })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: /Grant permission/iu })
    ).not.toBeInTheDocument()
  })

  it("stays off and explains how to recover when permission is denied", async () => {
    installNotificationApi({ requestResult: "denied" })
    const interaction = userEvent.setup()
    renderSettings()

    await interaction.click(
      screen.getByRole("switch", { name: "启用浏览器通知" })
    )

    expect(await screen.findByText(/浏览器已阻止通知/u)).toBeInTheDocument()
    expect(
      screen.getByRole("switch", { name: "启用浏览器通知" })
    ).not.toBeChecked()
    expect(
      screen.getByRole("switch", { name: "启用浏览器通知" })
    ).toHaveAttribute("aria-disabled", "true")
    expect(
      window.localStorage.getItem(browserNotificationStorageKey(USER_ID))
    ).toBeNull()
  })

  it("explains unsupported browsers without requesting permission", () => {
    renderSettings()

    expect(screen.getByText(/不支持浏览器通知/u)).toBeVisible()
    expect(
      screen.getByRole("switch", { name: "启用浏览器通知" })
    ).toHaveAttribute("aria-disabled", "true")
  })

  it("allows an unsupported browser to clear a previously enabled preference", async () => {
    window.localStorage.setItem(browserNotificationStorageKey(USER_ID), "true")
    const interaction = userEvent.setup()
    renderSettings()
    const notificationSwitch = screen.getByRole("switch", {
      name: "启用浏览器通知",
    })

    expect(notificationSwitch).toBeChecked()
    expect(notificationSwitch).not.toHaveAttribute("aria-disabled", "true")

    await interaction.click(notificationSwitch)

    expect(notificationSwitch).not.toBeChecked()
    expect(
      window.localStorage.getItem(browserNotificationStorageKey(USER_ID))
    ).toBe("false")
  })

  it("can request permission again when a saved grant was reset", async () => {
    const notificationApi = installNotificationApi({
      requestResult: "granted",
    })
    window.localStorage.setItem(browserNotificationStorageKey(USER_ID), "true")
    const interaction = userEvent.setup()
    renderSettings()
    const notificationSwitch = screen.getByRole("switch", {
      name: "启用浏览器通知",
    })

    expect(screen.getByText(/浏览器权限已被重置/u)).toBeVisible()
    expect(
      screen.queryByRole("button", { name: /重新授权/u })
    ).not.toBeInTheDocument()

    await interaction.click(notificationSwitch)

    expect(notificationSwitch).not.toBeChecked()
    expect(notificationApi.requestPermission).not.toHaveBeenCalled()

    await interaction.click(notificationSwitch)

    await waitFor(() => expect(notificationApi.instances).toHaveLength(1))
    expect(notificationApi.requestPermission).toHaveBeenCalledTimes(1)
    expect(await screen.findByText(/已请求系统显示测试通知/u)).toBeVisible()
  })

  it("keeps zh-CN browser notification settings text minimal", () => {
    renderSettings()

    expect(screen.queryByText(/开启后会立即发送/u)).not.toBeInTheDocument()
    expect(
      screen.queryByText(/重新授权并发送测试通知/u)
    ).not.toBeInTheDocument()
    expect(screen.queryByText(/发送测试通知/u)).not.toBeInTheDocument()
  })

  it("keeps the setting off when the permission prompt is dismissed", async () => {
    installNotificationApi({ requestResult: "default" })
    const interaction = userEvent.setup()
    renderSettings()

    await interaction.click(
      screen.getByRole("switch", { name: "启用浏览器通知" })
    )

    expect(await screen.findByText(/尚未允许通知/u)).toBeVisible()
    expect(
      screen.getByRole("switch", { name: "启用浏览器通知" })
    ).not.toBeChecked()
  })

  it("shows an error when requesting permission fails", async () => {
    installNotificationApi({ requestError: new Error("permission failed") })
    const interaction = userEvent.setup()
    renderSettings()

    await interaction.click(
      screen.getByRole("switch", { name: "启用浏览器通知" })
    )

    expect(await screen.findByText(/无法请求浏览器通知权限/u)).toBeVisible()
    expect(
      screen.getByRole("switch", { name: "启用浏览器通知" })
    ).not.toBeChecked()
  })

  it("turns the setting back off when the browser cannot create a notification", async () => {
    installNotificationApi({
      requestResult: "granted",
      constructorError: new TypeError("notification unavailable"),
    })
    const interaction = userEvent.setup()
    renderSettings()

    await interaction.click(
      screen.getByRole("switch", { name: "启用浏览器通知" })
    )

    expect(await screen.findByText(/未能创建系统通知/u)).toBeVisible()
    expect(
      screen.getByRole("switch", { name: "启用浏览器通知" })
    ).not.toBeChecked()
    expect(
      window.localStorage.getItem(browserNotificationStorageKey(USER_ID))
    ).toBeNull()
  })

  it("prioritizes a storage failure when clearing a denied saved preference", async () => {
    const deniedUserId = "10000000-0000-4000-8000-000000000009"
    installNotificationApi({ permission: "denied" })
    window.localStorage.setItem(
      browserNotificationStorageKey(deniedUserId),
      "true"
    )
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new DOMException("Storage unavailable", "QuotaExceededError")
    })
    vi.spyOn(window.localStorage, "removeItem").mockImplementation(() => {
      throw new DOMException("Storage unavailable", "QuotaExceededError")
    })
    const interaction = userEvent.setup()
    renderSettings(deniedUserId)

    await interaction.click(
      screen.getByRole("switch", { name: "启用浏览器通知" })
    )

    expect(await screen.findByText(/无法在当前浏览器中保存/u)).toBeVisible()
    expect(screen.queryByText(/浏览器已阻止通知/u)).not.toBeInTheDocument()
  })

  it("stays off when the browser cannot persist the setting", async () => {
    installNotificationApi({ requestResult: "granted" })
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new DOMException("Storage unavailable", "QuotaExceededError")
    })
    const interaction = userEvent.setup()
    renderSettings()

    await interaction.click(
      screen.getByRole("switch", { name: "启用浏览器通知" })
    )

    expect(await screen.findByText(/无法在当前浏览器中保存/u)).toBeVisible()
    expect(
      screen.getByRole("switch", { name: "启用浏览器通知" })
    ).not.toBeChecked()
  })

  it("stays off when the completion feed baseline cannot be established", async () => {
    installNotificationApi({ requestResult: "granted" })
    vi.mocked(apiRequest).mockRejectedValueOnce(new Error("API unavailable"))
    const interaction = userEvent.setup()
    renderSettings()

    await interaction.click(
      screen.getByRole("switch", { name: "启用浏览器通知" })
    )

    expect(await screen.findByText(/无法连接任务完成通知服务/u)).toBeVisible()
    expect(
      screen.getByRole("switch", { name: "启用浏览器通知" })
    ).not.toBeChecked()
    expect(
      window.localStorage.getItem(browserNotificationStorageKey(USER_ID))
    ).toBeNull()
  })
})
