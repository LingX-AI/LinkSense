import { act, cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { userSchema } from "@/api/contracts"
import { AuthContext, type AuthContextValue } from "@/app/auth-state"
import {
  browserNotificationDeliveryStorageKey,
  browserNotificationStorageKey,
  persistBrowserNotificationPreference,
} from "@/features/browser-notifications/browser-notification-preference"
import i18n from "@/i18n"
import { DesktopUpdateNotice } from "./desktop-update-notice"
import { desktopUpdateMessages } from "@/features/desktop-update/messages"

const host = vi.hoisted(() => ({
  required: false,
  mac: true,
  supports: true,
  getState: vi.fn(),
  subscribeChanged: vi.fn(),
  showUpdate: vi.fn(),
}))
const check = vi.hoisted(() => vi.fn())
const notifications = vi.hoisted(() => ({
  info: vi.fn(),
  dismiss: vi.fn(),
}))
const navigate = vi.hoisted(() => vi.fn())
const stream = vi.hoisted((): { emit: (result: unknown) => void } => ({
  emit: () => undefined,
}))

vi.mock("@/adapters/desktop/desktop-adapter", async (original) => ({
  ...(await original<typeof import("@/adapters/desktop/desktop-adapter")>()),
  isDesktopHost: () => true,
  isMacDesktopHost: () => host.mac,
  supportsNativeDesktopNotifications: () => host.mac && host.supports,
  getDesktopServerUrl: () => "https://example.test",
  getDesktopUpdateRequired: () => host.required,
  subscribeDesktopUpdate: (listener: () => void) => {
    host.subscribeChanged(listener)
    return () => undefined
  },
  getDesktopUpdateState: host.getState,
  subscribeDesktopUpdateChanged: (listener: (value: unknown) => void) => {
    stream.emit = listener
    host.subscribeChanged(listener)
    return () => undefined
  },
  checkDesktopUpdate: check,
  installDesktopUpdate: vi.fn(),
  setDesktopUpdateChannel: vi.fn(),
  restartDesktopAfterUpdate: vi.fn(),
  openDesktopUpdateInstaller: vi.fn(),
  showDesktopUpdateNotification: host.showUpdate,
}))

vi.mock("@/components/feedback/notification", () => ({
  notify: notifications,
}))

vi.mock("react-router-dom", async (original) => ({
  ...(await original<typeof import("react-router-dom")>()),
  useNavigate: () => navigate,
}))

const zh = desktopUpdateMessages["zh-CN"]
const userId = "10000000-0000-4000-8000-000000000001"
const otherUserId = "10000000-0000-4000-8000-000000000002"

function notificationUser(id = userId) {
  return userSchema.parse({
    id,
    name: "Test user",
    email: "user@example.test",
    role: "user",
    status: "active",
    avatar_url: null,
    language: "zh-CN",
    login_method: "password",
    running_message_action: "queue",
    registration_source: "organization_invitation",
    user_groups: [],
  })
}

function noticeTree({
  status = "authenticated",
  id = userId,
}: {
  status?: AuthContextValue["status"]
  id?: string
} = {}) {
  const user = status === "authenticated" ? notificationUser(id) : null
  return (
    <AuthContext.Provider
      value={{
        status,
        user,
        acceptSession: vi.fn(),
        refreshUser: vi.fn(),
        signOut: vi.fn(),
      }}
    >
      <DesktopUpdateNotice />
    </AuthContext.Provider>
  )
}

function setDocumentActivity(
  visibilityState: DocumentVisibilityState,
  focused: boolean
) {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: visibilityState,
  })
  vi.spyOn(document, "hasFocus").mockReturnValue(focused)
}

beforeEach(async () => {
  host.required = false
  host.mac = true
  host.supports = true
  host.getState.mockReset().mockResolvedValue({ state: "idle" })
  host.subscribeChanged.mockReset()
  host.showUpdate.mockReset().mockResolvedValue("shown")
  stream.emit = () => undefined
  check.mockReset()
  notifications.info.mockReset()
  notifications.dismiss.mockReset()
  navigate.mockReset()
  window.localStorage.clear()
  setDocumentActivity("visible", true)
  await i18n.changeLanguage("zh-CN")
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  Reflect.deleteProperty(document, "visibilityState")
  window.localStorage.clear()
})

describe("desktop update notice", () => {
  it("uses one non-stacking toast with a Settings action and clears it on stage", async () => {
    host.getState.mockResolvedValue({
      state: "available",
      version: "0.2.0",
      notes: "Do not announce these notes",
      installAvailable: true,
      downloadAvailable: false,
      revision: 7,
    })
    render(noticeTree())
    await waitFor(() => expect(notifications.info).toHaveBeenCalledOnce())
    const [message, options] = notifications.info.mock.calls[0]
    expect(message).toBe(zh.noticeAction)
    expect(options.id).toBe("desktop-update-available")
    expect(options.description).toBe(
      zh.updateAvailable.replace("{{version}}", "0.2.0")
    )
    expect(JSON.stringify(options)).not.toContain("Do not announce these notes")
    expect(options.action.label).toBe(i18n.t("common.view"))
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    // The foreground toast is the only availability surface for a visible,
    // focused app.
    expect(host.showUpdate).not.toHaveBeenCalled()

    // The same version found again during a background cadence must not add
    // another notice.
    stream.emit({
      state: "available",
      version: "0.2.0",
      installAvailable: true,
      downloadAvailable: false,
      revision: 8,
    })
    await waitFor(() => expect(notifications.info).toHaveBeenCalledOnce())

    // A newer version replaces the same toast instead of stacking.
    stream.emit({
      state: "available",
      version: "0.2.1",
      installAvailable: true,
      downloadAvailable: false,
      revision: 9,
    })
    await waitFor(() => expect(notifications.info).toHaveBeenCalledTimes(2))
    expect(notifications.info.mock.calls[1][1].id).toBe(
      "desktop-update-available"
    )

    options.action.onClick()
    expect(notifications.dismiss).toHaveBeenCalledWith(
      "desktop-update-available"
    )
    expect(navigate).toHaveBeenCalledWith("/settings/general")

    // Staging is visible in Settings; the availability toast is removed.
    notifications.dismiss.mockClear()
    stream.emit({ state: "staged", version: "0.2.1", revision: 10 })
    await waitFor(() =>
      expect(notifications.dismiss).toHaveBeenCalledWith(
        "desktop-update-available"
      )
    )
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })

  it("keeps the required-update dialog and its check control", async () => {
    host.required = true
    host.mac = false
    check.mockResolvedValue({ state: "unavailable" })
    render(noticeTree())
    expect(screen.getByRole("dialog")).toBeVisible()
    await userEvent.click(screen.getByRole("button", { name: zh.check }))
    expect(await screen.findByText(zh.unavailable)).toBeVisible()
    expect(check).toHaveBeenCalledOnce()
    expect(notifications.info).not.toHaveBeenCalled()
    expect(notifications.dismiss).toHaveBeenCalledWith(
      "desktop-update-available"
    )
  })

  it("shows no toast in a browser or on Windows", () => {
    host.mac = false
    render(noticeTree())
    expect(notifications.info).not.toHaveBeenCalled()
    expect(host.getState).not.toHaveBeenCalled()
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })

  it("shows one quiet native notice for an opted-in background account and dedupes the candidate", async () => {
    setDocumentActivity("hidden", false)
    persistBrowserNotificationPreference(userId, true)
    host.getState.mockResolvedValue({
      state: "available",
      version: "0.2.0",
      notes: "Do not announce these notes",
      installAvailable: true,
      revision: 7,
    })

    render(noticeTree())
    await waitFor(() => expect(host.showUpdate).toHaveBeenCalledOnce())
    expect(host.showUpdate).toHaveBeenCalledWith(7, expect.any(AbortSignal))
    expect(
      window.localStorage.getItem(browserNotificationDeliveryStorageKey(userId))
    ).toContain("desktop-update:0.2.0")

    // Periodic checks with a new revision but the same candidate do not replay
    // the notice.
    stream.emit({
      state: "available",
      version: "0.2.0",
      installAvailable: true,
      revision: 8,
    })
    await Promise.resolve()
    expect(host.showUpdate).toHaveBeenCalledOnce()

    stream.emit({
      state: "available",
      version: "0.2.1",
      installAvailable: true,
      revision: 9,
    })
    await waitFor(() => expect(host.showUpdate).toHaveBeenCalledTimes(2))
    expect(host.showUpdate.mock.calls[1][0]).toBe(9)
  })

  it("does not notify after foreground availability or a later blur", async () => {
    persistBrowserNotificationPreference(userId, true)
    host.getState.mockResolvedValue({
      state: "available",
      version: "0.2.0",
      installAvailable: true,
      revision: 7,
    })
    render(noticeTree())
    await waitFor(() => expect(notifications.info).toHaveBeenCalledOnce())
    expect(host.showUpdate).not.toHaveBeenCalled()

    setDocumentActivity("hidden", false)
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"))
      window.dispatchEvent(new Event("blur"))
      stream.emit({
        state: "checking",
        version: "0.2.0",
        installAvailable: true,
        revision: 8,
      })
      stream.emit({
        state: "available",
        version: "0.2.0",
        installAvailable: true,
        revision: 9,
      })
    })
    await Promise.resolve()
    expect(host.showUpdate).not.toHaveBeenCalled()
  })

  it("waits for authentication and the saved opt-in before notifying", async () => {
    setDocumentActivity("hidden", false)
    persistBrowserNotificationPreference(userId, true)
    host.getState.mockResolvedValue({
      state: "available",
      version: "0.3.0",
      installAvailable: true,
      revision: 7,
    })
    const view = render(noticeTree({ status: "anonymous" }))
    await Promise.resolve()
    expect(host.showUpdate).not.toHaveBeenCalled()

    view.rerender(noticeTree())
    await waitFor(() => expect(host.showUpdate).toHaveBeenCalledOnce())
  })

  it("honors a later opt-in for an otherwise eligible candidate", async () => {
    setDocumentActivity("hidden", false)
    host.getState.mockResolvedValue({
      state: "available",
      version: "0.4.0",
      installAvailable: true,
      revision: 7,
    })
    render(noticeTree())
    await waitFor(() => expect(host.getState).toHaveBeenCalled())
    expect(host.showUpdate).not.toHaveBeenCalled()

    act(() => {
      persistBrowserNotificationPreference(userId, true)
    })
    await waitFor(() => expect(host.showUpdate).toHaveBeenCalledOnce())
  })

  it("aborts a pending revision and requests each newer eligible revision once", async () => {
    setDocumentActivity("hidden", false)
    persistBrowserNotificationPreference(userId, true)
    host.getState.mockResolvedValue({
      state: "available",
      version: "0.7.0",
      installAvailable: true,
      revision: 7,
    })
    const resolvers: Array<(result: string) => void> = []
    // Deliberately ignore the abort signal: this models a native result that
    // was already on its way when the newer revision aborted the old attempt.
    host.showUpdate.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvers.push(resolve)
        })
    )
    render(noticeTree())
    await waitFor(() => expect(host.showUpdate).toHaveBeenCalledOnce())
    expect(host.showUpdate.mock.calls[0][0]).toBe(7)

    stream.emit({
      state: "available",
      version: "0.7.0",
      installAvailable: true,
      revision: 8,
    })
    await waitFor(() => expect(host.showUpdate).toHaveBeenCalledTimes(2))
    expect(host.showUpdate.mock.calls[1][0]).toBe(8)
    expect((host.showUpdate.mock.calls[0][1] as AbortSignal).aborted).toBe(true)

    // A late old success must not claim delivery for the newer revision.
    await act(async () => resolvers[0]("shown"))
    expect(
      window.localStorage.getItem(browserNotificationDeliveryStorageKey(userId))
    ).toBeNull()

    await act(async () => resolvers[1]("shown"))
    await waitFor(() =>
      expect(
        window.localStorage.getItem(
          browserNotificationDeliveryStorageKey(userId)
        )
      ).toContain("desktop-update:0.7.0")
    )

    stream.emit({
      state: "available",
      version: "0.7.0",
      installAvailable: true,
      revision: 9,
    })
    await Promise.resolve()
    expect(host.showUpdate).toHaveBeenCalledTimes(2)
  })

  it("retries a native-stale revision but not a failed version on checking", async () => {
    setDocumentActivity("hidden", false)
    persistBrowserNotificationPreference(userId, true)
    host.getState.mockResolvedValue({
      state: "available",
      version: "0.8.0",
      installAvailable: true,
      revision: 7,
    })
    host.showUpdate.mockResolvedValueOnce("stale")
    host.showUpdate.mockResolvedValueOnce("failed")
    render(noticeTree())
    await waitFor(() => expect(host.showUpdate).toHaveBeenCalledOnce())
    await act(async () => undefined)

    // The old revision was dropped; a later revision of the same candidate
    // must still be delivered exactly once.
    stream.emit({
      state: "checking",
      version: "0.8.0",
      installAvailable: true,
      revision: 8,
    })
    stream.emit({
      state: "available",
      version: "0.8.0",
      installAvailable: true,
      revision: 9,
    })
    await waitFor(() => expect(host.showUpdate).toHaveBeenCalledTimes(2))
    expect(host.showUpdate.mock.calls[1][0]).toBe(9)
    await act(async () => undefined)

    stream.emit({
      state: "checking",
      version: "0.8.0",
      installAvailable: true,
      revision: 10,
    })
    stream.emit({
      state: "available",
      version: "0.8.0",
      installAvailable: true,
      revision: 11,
    })
    await Promise.resolve()
    expect(host.showUpdate).toHaveBeenCalledTimes(2)
  })

  it("allows a new account to retry a candidate a stale attempt deferred", async () => {
    setDocumentActivity("hidden", false)
    persistBrowserNotificationPreference(userId, true)
    persistBrowserNotificationPreference(otherUserId, true)
    host.getState.mockResolvedValue({
      state: "available",
      version: "0.8.55",
      installAvailable: true,
      revision: 7,
    })
    host.showUpdate
      .mockResolvedValueOnce("stale")
      .mockResolvedValueOnce("shown")
    const view = render(noticeTree())
    await waitFor(() => expect(host.showUpdate).toHaveBeenCalledOnce())
    await act(async () => undefined)
    expect(host.showUpdate).toHaveBeenCalledOnce()

    view.rerender(noticeTree({ id: otherUserId }))
    await waitFor(() => expect(host.showUpdate).toHaveBeenCalledTimes(2))
    expect(host.showUpdate.mock.calls[1][0]).toBe(7)
    await waitFor(() =>
      expect(
        window.localStorage.getItem(
          browserNotificationDeliveryStorageKey(otherUserId)
        )
      ).toContain("desktop-update:0.8.55")
    )
  })

  it.each([
    { firstOutcome: "shown", version: "0.8.56" },
    { firstOutcome: "failed", version: "0.8.57" },
  ] as const)(
    "lets another account receive the same version after a $firstOutcome outcome",
    async ({ firstOutcome, version }) => {
      setDocumentActivity("hidden", false)
      persistBrowserNotificationPreference(userId, true)
      persistBrowserNotificationPreference(otherUserId, true)
      host.getState.mockResolvedValue({
        state: "available",
        version,
        installAvailable: true,
        revision: 7,
      })
      host.showUpdate
        .mockResolvedValueOnce(firstOutcome)
        .mockResolvedValueOnce("shown")
      const view = render(noticeTree())
      await waitFor(() => expect(host.showUpdate).toHaveBeenCalledOnce())
      await act(async () => undefined)
      expect(host.showUpdate).toHaveBeenCalledOnce()

      view.rerender(noticeTree({ id: otherUserId }))
      await waitFor(() => expect(host.showUpdate).toHaveBeenCalledTimes(2))
      expect(host.showUpdate.mock.calls[1][0]).toBe(7)
      await waitFor(() =>
        expect(
          window.localStorage.getItem(
            browserNotificationDeliveryStorageKey(otherUserId)
          )
        ).toContain(`desktop-update:${version}`)
      )
    }
  )

  it("ignores a denied result from an aborted older attempt", async () => {
    setDocumentActivity("hidden", false)
    persistBrowserNotificationPreference(userId, true)
    host.getState.mockResolvedValue({
      state: "available",
      version: "0.8.5",
      installAvailable: true,
      revision: 7,
    })
    const resolvers: Array<(result: string) => void> = []
    // Deliberately ignore the abort signal: this models a native result that
    // was already on its way when the newer revision aborted the old attempt.
    host.showUpdate.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvers.push(resolve)
        })
    )
    render(noticeTree())
    await waitFor(() => expect(host.showUpdate).toHaveBeenCalledOnce())
    stream.emit({
      state: "available",
      version: "0.8.5",
      installAvailable: true,
      revision: 8,
    })
    await waitFor(() => expect(host.showUpdate).toHaveBeenCalledTimes(2))

    await act(async () => resolvers[0]("denied"))
    expect(
      window.localStorage.getItem(browserNotificationStorageKey(userId))
    ).toBe("true")
    expect((host.showUpdate.mock.calls[0][1] as AbortSignal).aborted).toBe(true)
    await act(async () => resolvers[1]("shown"))
    await waitFor(() => expect(host.showUpdate).toHaveBeenCalledTimes(2))
  })

  it("does not retry a failed revision on a checking cycle or blur", async () => {
    setDocumentActivity("hidden", false)
    persistBrowserNotificationPreference(userId, true)
    host.getState.mockResolvedValue({
      state: "available",
      version: "0.8.6",
      installAvailable: true,
      revision: 7,
    })
    host.showUpdate.mockResolvedValueOnce("failed")
    render(noticeTree())
    await waitFor(() => expect(host.showUpdate).toHaveBeenCalledOnce())
    await act(async () => undefined)

    stream.emit({
      state: "checking",
      version: "0.8.6",
      installAvailable: true,
      revision: 8,
    })
    stream.emit({
      state: "available",
      version: "0.8.6",
      installAvailable: true,
      revision: 9,
    })
    act(() => {
      window.dispatchEvent(new Event("blur"))
      document.dispatchEvent(new Event("visibilitychange"))
    })
    await Promise.resolve()
    expect(host.showUpdate).toHaveBeenCalledOnce()
  })

  it("rechecks the saved opt-in at dispatch instead of trusting a stale render", async () => {
    setDocumentActivity("hidden", false)
    persistBrowserNotificationPreference(userId, true)
    let resolveState: (value: unknown) => void = () => undefined
    host.getState.mockReturnValue(
      new Promise((resolve) => {
        resolveState = resolve
      })
    )
    render(noticeTree())
    await waitFor(() => expect(host.getState).toHaveBeenCalled())
    // Keep the hook's committed snapshot enabled while storage changes.
    window.localStorage.setItem(browserNotificationStorageKey(userId), "false")
    await act(async () => {
      resolveState({
        state: "available",
        version: "0.8.7",
        installAvailable: true,
        revision: 7,
      })
    })
    await Promise.resolve()
    expect(host.showUpdate).not.toHaveBeenCalled()
  })

  it("does not call a legacy unsupported host again for another candidate", async () => {
    setDocumentActivity("hidden", false)
    persistBrowserNotificationPreference(userId, true)
    host.getState.mockResolvedValue({
      state: "available",
      version: "0.8.8",
      installAvailable: true,
      revision: 7,
    })
    host.showUpdate.mockResolvedValueOnce("unsupported")
    render(noticeTree())
    await waitFor(() => expect(host.showUpdate).toHaveBeenCalledOnce())
    await act(async () => undefined)

    stream.emit({
      state: "available",
      version: "0.8.9",
      installAvailable: true,
      revision: 8,
    })
    await Promise.resolve()
    expect(host.showUpdate).toHaveBeenCalledOnce()

    act(() => {
      persistBrowserNotificationPreference(userId, false)
    })
    act(() => {
      persistBrowserNotificationPreference(userId, true)
    })
    await Promise.resolve()
    expect(host.showUpdate).toHaveBeenCalledOnce()
  })

  it("cancels the exact pending attempt when the account changes or the host unmounts", async () => {
    setDocumentActivity("hidden", false)
    persistBrowserNotificationPreference(userId, true)
    persistBrowserNotificationPreference(otherUserId, true)
    host.getState.mockResolvedValue({
      state: "available",
      version: "0.5.0",
      installAvailable: true,
      revision: 7,
    })
    host.showUpdate.mockImplementation(
      (_revision: number, signal: AbortSignal) =>
        new Promise((resolve) =>
          signal.addEventListener("abort", () => resolve("cancelled"), {
            once: true,
          })
        )
    )
    const view = render(noticeTree())
    await waitFor(() => expect(host.showUpdate).toHaveBeenCalledOnce())
    const accountSignal = host.showUpdate.mock.calls[0][1] as AbortSignal
    expect(accountSignal.aborted).toBe(false)

    view.rerender(noticeTree({ id: otherUserId }))
    expect(accountSignal.aborted).toBe(true)
    await waitFor(() => expect(host.showUpdate).toHaveBeenCalledTimes(2))
    const unmountSignal = host.showUpdate.mock.calls[1][1] as AbortSignal
    view.unmount()
    expect(unmountSignal.aborted).toBe(true)
  })

  it("cancels on opt-out and does not retry a failure without a new eligible event", async () => {
    setDocumentActivity("hidden", false)
    persistBrowserNotificationPreference(userId, true)
    host.getState.mockResolvedValue({
      state: "available",
      version: "0.6.0",
      installAvailable: true,
      revision: 7,
    })
    host.showUpdate.mockResolvedValueOnce("failed")
    render(noticeTree())
    await waitFor(() => expect(host.showUpdate).toHaveBeenCalledOnce())

    stream.emit({
      state: "available",
      version: "0.6.0",
      installAvailable: true,
      revision: 8,
    })
    await Promise.resolve()
    expect(host.showUpdate).toHaveBeenCalledOnce()

    act(() => {
      persistBrowserNotificationPreference(userId, false)
    })
    act(() => {
      persistBrowserNotificationPreference(userId, true)
    })
    await waitFor(() => expect(host.showUpdate).toHaveBeenCalledTimes(2))
  })
})
