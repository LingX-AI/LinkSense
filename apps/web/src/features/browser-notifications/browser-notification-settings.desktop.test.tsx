import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { I18nextProvider } from "react-i18next"
import { supportedLocales } from "@linksense/shared"

import { apiRequest } from "@/api/client"
import { BrowserNotificationSettings } from "@/features/browser-notifications/browser-notification-settings"
import { browserNotificationStorageKey } from "@/features/browser-notifications/browser-notification-preference"
import i18n from "@/i18n"

const native = vi.hoisted(() => ({
  supported: true,
  showTestNotification: vi.fn(),
}))
vi.mock("@/adapters/desktop/desktop-adapter", () => ({
  isMacDesktopHost: () => true,
  getDesktopServerUrl: () => "https://example.test",
  supportsNativeDesktopNotifications: () => native.supported,
  showDesktopTestNotification: native.showTestNotification,
}))
vi.mock("@/api/client", () => ({ apiRequest: vi.fn() }))

const USER_ID = "10000000-0000-4000-8000-000000000001"

function settings(userId = USER_ID) {
  return (
    <I18nextProvider i18n={i18n}>
      <BrowserNotificationSettings key={userId} userId={userId} />
    </I18nextProvider>
  )
}

describe("BrowserNotificationSettings on macOS", () => {
  beforeEach(async () => {
    window.localStorage.clear()
    vi.clearAllMocks()
    native.supported = true
    native.showTestNotification.mockResolvedValue("shown")
    vi.mocked(apiRequest).mockResolvedValue({
      items: [],
      next_cursor: "completion-baseline-cursor",
    })
    await i18n.changeLanguage("en-US")
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    window.localStorage.clear()
  })

  it("uses an explicit test notification for the macOS prompt", async () => {
    const interaction = userEvent.setup()
    render(settings())
    const notificationSwitch = screen.getByRole("switch", {
      name: "Enable macOS notifications",
    })

    expect(native.showTestNotification).not.toHaveBeenCalled()
    await interaction.click(notificationSwitch)

    await waitFor(() => expect(notificationSwitch).toBeChecked())
    expect(native.showTestNotification).toHaveBeenCalledWith(
      "Notifications are connected. You will be notified here when a task or automation produces a result.",
      expect.any(AbortSignal)
    )
    expect(apiRequest).toHaveBeenCalledWith(
      "/completion-notifications",
      expect.objectContaining({
        schema: expect.anything(),
        query: { limit: 100 },
      })
    )
    expect(
      await screen.findByText(/A test notification was sent/u)
    ).toBeVisible()
    expect(
      window.localStorage.getItem(browserNotificationStorageKey(USER_ID))
    ).toBe("true")
  })

  it("stays off and explains how to recover when macOS denied notifications", async () => {
    native.showTestNotification.mockResolvedValue("denied")
    const interaction = userEvent.setup()
    render(settings())
    const notificationSwitch = screen.getByRole("switch", {
      name: "Enable macOS notifications",
    })

    await interaction.click(notificationSwitch)

    expect(
      await screen.findByText(/macOS has blocked notifications for LinkSense/u)
    ).toBeVisible()
    expect(notificationSwitch).not.toBeChecked()
    expect(
      window.localStorage.getItem(browserNotificationStorageKey(USER_ID))
    ).toBe("false")
    expect(apiRequest).not.toHaveBeenCalled()
    native.showTestNotification.mockResolvedValue("shown")
    await interaction.click(notificationSwitch)
    await waitFor(() => expect(notificationSwitch).toBeChecked())
  })

  it("cancels an opt-in still awaiting permission when the account changes", async () => {
    const interaction = userEvent.setup()
    native.showTestNotification.mockImplementation(
      (_body: string, signal: AbortSignal) =>
        new Promise((resolve) =>
          signal.addEventListener("abort", () => resolve("cancelled"), {
            once: true,
          })
        )
    )
    const view = render(settings())
    await interaction.click(screen.getByRole("switch"))
    const signal = native.showTestNotification.mock.calls[0]?.[1]
    expect(signal.aborted).toBe(false)
    view.rerender(settings("10000000-0000-4000-8000-000000000002"))
    expect(signal.aborted).toBe(true)
    expect(apiRequest).not.toHaveBeenCalled()
    expect(
      window.localStorage.getItem(browserNotificationStorageKey(USER_ID))
    ).toBeNull()
    expect(screen.getByRole("switch")).not.toBeChecked()
  })

  it("explains a build without native notification support", () => {
    native.supported = false
    render(settings())

    expect(
      screen.getByText(/Notifications are unavailable in this app build/u)
    ).toBeVisible()
    expect(
      screen.getByRole("switch", { name: "Enable macOS notifications" })
    ).toHaveAttribute("aria-disabled", "true")
  })

  it.each([...supportedLocales, "de-DE"])(
    "labels the macOS switch and description in %s",
    async (locale) => {
      await i18n.changeLanguage(locale)
      render(settings())
      expect(
        screen.getByRole("switch", {
          name: i18n.t("browserNotifications.desktopEnable"),
          description: i18n.t("browserNotifications.desktopDescription"),
        })
      ).toBeVisible()
    }
  )
})
