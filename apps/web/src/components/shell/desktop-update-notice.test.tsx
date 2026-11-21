import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import i18n from "@/i18n"
import { DesktopUpdateNotice } from "./desktop-update-notice"
import { desktopUpdateMessages } from "@/features/desktop-update/messages"

const host = vi.hoisted(() => ({
  required: false,
  mac: true,
  getState: vi.fn(),
  subscribeChanged: vi.fn(),
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
}))

vi.mock("@/components/feedback/notification", () => ({
  notify: notifications,
}))

vi.mock("react-router-dom", async (original) => ({
  ...(await original<typeof import("react-router-dom")>()),
  useNavigate: () => navigate,
}))

const zh = desktopUpdateMessages["zh-CN"]

beforeEach(async () => {
  host.required = false
  host.mac = true
  host.getState.mockReset().mockResolvedValue({ state: "idle" })
  host.subscribeChanged.mockReset()
  stream.emit = () => undefined
  check.mockReset()
  notifications.info.mockReset()
  notifications.dismiss.mockReset()
  navigate.mockReset()
  await i18n.changeLanguage("zh-CN")
})
afterEach(cleanup)

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
    render(<DesktopUpdateNotice />)
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
    render(<DesktopUpdateNotice />)
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
    render(<DesktopUpdateNotice />)
    expect(notifications.info).not.toHaveBeenCalled()
    expect(host.getState).not.toHaveBeenCalled()
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })
})
