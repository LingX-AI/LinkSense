import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import type { ComponentProps } from "react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import i18n from "@/i18n"

import type { ComputerPermissionResult } from "./computer-permission-adapter"
import { DesktopComputerPermissionGuide } from "./desktop-computer-permission-guide"
import { desktopComputerPermissionMessages } from "./messages"

const adapter = vi.hoisted(() => ({
  check: vi.fn(),
  guide: vi.fn(),
  openSettings: vi.fn(),
  subscribeWindowActive: vi.fn(),
}))

vi.mock("./computer-permission-adapter", () => ({
  checkComputerPermission: adapter.check,
  guideComputerPermission: adapter.guide,
  openComputerPermissionSettings: adapter.openSettings,
  subscribeDesktopWindowActive: adapter.subscribeWindowActive,
}))

const zh = desktopComputerPermissionMessages["zh-CN"]

const notGranted = (
  kind: ComputerPermissionResult["kind"] = "accessibility"
): ComputerPermissionResult => ({
  kind,
  status: "notGranted",
  reason: "checked",
})

const granted = (
  kind: ComputerPermissionResult["kind"] = "accessibility",
  reason: ComputerPermissionResult["reason"] = "granted"
): ComputerPermissionResult => ({ kind, status: "granted", reason })

const closed = (
  kind: ComputerPermissionResult["kind"] = "accessibility"
): ComputerPermissionResult => ({ kind, status: "notGranted", reason: "closed" })

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined
  const promise = new Promise<T>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

type GuideProps = ComponentProps<typeof DesktopComputerPermissionGuide>

function renderGuide(overrides: Partial<GuideProps> = {}) {
  const onOpenChange = vi.fn()
  const props: GuideProps = {
    kind: "accessibility",
    open: true,
    onOpenChange,
    ...overrides,
  }
  const view = render(<DesktopComputerPermissionGuide {...props} />)
  const rerenderGuide = (next: Partial<GuideProps>) =>
    view.rerender(<DesktopComputerPermissionGuide {...props} {...next} />)
  return { ...view, onOpenChange, rerenderGuide }
}

function pendingGuide() {
  const guide = deferred<ComputerPermissionResult>()
  adapter.guide.mockImplementation(
    (kind: ComputerPermissionResult["kind"], signal: AbortSignal) => {
      signal.addEventListener("abort", () =>
        guide.resolve({ kind, status: "unknown", reason: "canceled" })
      )
      return guide.promise
    }
  )
  return guide
}

beforeEach(async () => {
  adapter.check.mockReset().mockResolvedValue(notGranted())
  adapter.guide.mockReset()
  adapter.openSettings.mockReset()
  adapter.subscribeWindowActive.mockReset().mockReturnValue(() => undefined)
  await i18n.changeLanguage("zh-CN")
})

afterEach(cleanup)

describe("desktop computer permission guide", () => {
  it("does not check anything while the dialog is closed", async () => {
    renderGuide({ open: false })
    await Promise.resolve()
    expect(adapter.check).not.toHaveBeenCalled()
    expect(adapter.guide).not.toHaveBeenCalled()
    expect(adapter.subscribeWindowActive).not.toHaveBeenCalled()
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })

  it("does not offer Guide or settings before the initial Check settles", async () => {
    const first = deferred<ComputerPermissionResult>()
    adapter.check.mockReset().mockReturnValueOnce(first.promise)
    renderGuide()

    expect(
      await screen.findByText("正在检查辅助功能权限…")
    ).toBeVisible()
    expect(
      screen.queryByRole("button", { name: zh.guideAction })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: zh.manualAction })
    ).not.toBeInTheDocument()

    await act(async () => first.resolve(notGranted()))
    expect(await screen.findByText("尚未允许辅助功能。")).toBeVisible()
    expect(
      screen.getByRole("button", { name: zh.guideAction })
    ).toBeVisible()
    expect(
      screen.getByRole("button", { name: zh.manualAction })
    ).toBeVisible()
  })

  it("does not enable settings after a failed initial Check", async () => {
    adapter.check.mockResolvedValue({
      kind: "accessibility",
      status: "unknown",
      reason: "failed",
    })
    renderGuide()
    expect(await screen.findByText("无法检查辅助功能权限。")).toBeVisible()
    expect(
      screen.queryByRole("button", { name: zh.guideAction })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: zh.manualAction })
    ).not.toBeInTheDocument()
    expect(adapter.openSettings).not.toHaveBeenCalled()
  })

  it("runs a read-only Check on open and offers Guide as a separate action", async () => {
    renderGuide()
    expect(await screen.findByText("尚未允许辅助功能。")).toBeVisible()
    expect(adapter.check).toHaveBeenCalledOnce()
    expect(adapter.check.mock.calls[0]?.[0]).toBe("accessibility")
    expect(adapter.check.mock.calls[0]?.[1]).toBeInstanceOf(AbortSignal)
    expect(adapter.guide).not.toHaveBeenCalled()
    expect(
      screen.getByRole("button", { name: zh.guideAction })
    ).toBeVisible()
    expect(
      screen.getByRole("button", { name: zh.checkAgain })
    ).toBeVisible()
  })

  it("shows the native grant without offering or running the guide", async () => {
    adapter.check.mockResolvedValue(granted("accessibility", "checked"))
    renderGuide()
    expect(await screen.findByText("已允许辅助功能。")).toBeVisible()
    expect(
      screen.queryByRole("button", { name: zh.guideAction })
    ).not.toBeInTheDocument()
    expect(adapter.guide).not.toHaveBeenCalled()
  })

  it("reports a guide grant only from the native result", async () => {
    adapter.guide.mockResolvedValue(granted())
    renderGuide()
    await screen.findByText("尚未允许辅助功能。")
    await userEvent.click(
      screen.getByRole("button", { name: zh.guideAction })
    )
    expect(adapter.guide).toHaveBeenCalledOnce()
    expect(adapter.guide.mock.calls[0]?.[0]).toBe("accessibility")
    expect(adapter.guide.mock.calls[0]?.[1]).toBeInstanceOf(AbortSignal)
    expect(await screen.findByText("已允许辅助功能。")).toBeVisible()
    expect(
      screen.queryByRole("button", { name: zh.guideAction })
    ).not.toBeInTheDocument()
  })

  it("never renders a non-granted guide result as granted", async () => {
    adapter.guide.mockResolvedValue({
      kind: "accessibility",
      status: "notGranted",
      reason: "granted",
    })
    renderGuide()
    await screen.findByText("尚未允许辅助功能。")
    await userEvent.click(
      screen.getByRole("button", { name: zh.guideAction })
    )
    expect(await screen.findByText("无法确认辅助功能权限状态。")).toBeVisible()
    expect(screen.queryByText("已允许辅助功能。")).not.toBeInTheDocument()
  })

  it("keeps a dismissed guide as not granted and reopens only on a new click", async () => {
    adapter.guide.mockResolvedValue(closed())
    renderGuide()
    await screen.findByText("尚未允许辅助功能。")
    await userEvent.click(
      screen.getByRole("button", { name: zh.guideAction })
    )
    expect(await screen.findByText(zh.guideClosed)).toBeVisible()
    expect(adapter.guide).toHaveBeenCalledOnce()
    expect(screen.queryByText("已允许辅助功能。")).not.toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: zh.guideAction })
    ).toBeVisible()
    await userEvent.click(screen.getByRole("button", { name: zh.guideAction }))
    expect(adapter.guide).toHaveBeenCalledTimes(2)
  })

  it("does not offer a second settings flow while the guide is pending", async () => {
    pendingGuide()
    renderGuide()
    await screen.findByText("尚未允许辅助功能。")
    await userEvent.click(
      screen.getByRole("button", { name: zh.guideAction })
    )
    expect(await screen.findByText(zh.waiting)).toBeVisible()
    expect(
      screen.queryByRole("button", { name: zh.guideAction })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: zh.manualAction })
    ).not.toBeInTheDocument()
    expect(adapter.openSettings).not.toHaveBeenCalled()
  })

  it("cancels the native guide without leaving the dialog waiting", async () => {
    pendingGuide()
    renderGuide()
    await screen.findByText("尚未允许辅助功能。")
    await userEvent.click(
      screen.getByRole("button", { name: zh.guideAction })
    )
    expect(await screen.findByText(zh.waiting)).toBeVisible()
    const signal = adapter.guide.mock.calls[0]?.[1] as AbortSignal
    await userEvent.click(
      screen.getByRole("button", { name: zh.cancelGuide })
    )
    expect(signal.aborted).toBe(true)
    expect(await screen.findByText(zh.guideCanceled)).toBeVisible()
    expect(screen.queryByText(zh.waiting)).not.toBeInTheDocument()
    expect(screen.queryByText("已允许辅助功能。")).not.toBeInTheDocument()
    expect(adapter.guide).toHaveBeenCalledOnce()
    await userEvent.click(screen.getByRole("button", { name: zh.guideAction }))
    expect(adapter.guide).toHaveBeenCalledTimes(2)
  })

  it("keeps a newer focus Check when canceling a superseded guide", async () => {
    pendingGuide()
    const focus = deferred<ComputerPermissionResult>()
    adapter.check
      .mockReset()
      .mockResolvedValueOnce(notGranted())
      .mockImplementationOnce(() => focus.promise)
      .mockResolvedValue(notGranted())
    renderGuide()
    await screen.findByText("尚未允许辅助功能。")
    await userEvent.click(
      screen.getByRole("button", { name: zh.guideAction })
    )
    expect(await screen.findByText(zh.waiting)).toBeVisible()
    const guideSignal = adapter.guide.mock.calls[0]?.[1] as AbortSignal

    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"))
    })
    await waitFor(() => expect(adapter.check).toHaveBeenCalledTimes(2))
    const checkSignal = adapter.check.mock.calls[1]?.[1] as AbortSignal
    await userEvent.click(
      screen.getByRole("button", { name: zh.cancelGuide })
    )
    expect(guideSignal.aborted).toBe(true)
    expect(checkSignal.aborted).toBe(false)

    await act(async () => focus.resolve(granted()))
    expect(await screen.findByText("已允许辅助功能。")).toBeVisible()
    expect(screen.queryByText(zh.waiting)).not.toBeInTheDocument()
  })

  it("ends a pending guide when a newer Check grants", async () => {
    pendingGuide()
    const focus = deferred<ComputerPermissionResult>()
    adapter.check
      .mockReset()
      .mockResolvedValueOnce(notGranted())
      .mockImplementationOnce(() => focus.promise)
      .mockResolvedValue(notGranted())
    renderGuide()
    await screen.findByText("尚未允许辅助功能。")
    await userEvent.click(
      screen.getByRole("button", { name: zh.guideAction })
    )
    expect(await screen.findByText(zh.waiting)).toBeVisible()
    const guideSignal = adapter.guide.mock.calls[0]?.[1] as AbortSignal

    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"))
    })
    await waitFor(() => expect(adapter.check).toHaveBeenCalledTimes(2))
    await act(async () => focus.resolve(granted("accessibility", "checked")))

    expect(guideSignal.aborted).toBe(true)
    expect(await screen.findByText("已允许辅助功能。")).toBeVisible()
    expect(screen.queryByText(zh.waiting)).not.toBeInTheDocument()
  })

  it("aborts a pending guide when the parent closes and reopens fresh", async () => {
    pendingGuide()
    const { rerenderGuide } = renderGuide()
    await screen.findByText("尚未允许辅助功能。")
    await userEvent.click(
      screen.getByRole("button", { name: zh.guideAction })
    )
    expect(await screen.findByText(zh.waiting)).toBeVisible()
    const signal = adapter.guide.mock.calls[0]?.[1] as AbortSignal

    rerenderGuide({ open: false })
    expect(signal.aborted).toBe(true)

    rerenderGuide({ open: true })
    await waitFor(() => expect(adapter.check).toHaveBeenCalledTimes(2))
    expect(screen.queryByText(zh.waiting)).not.toBeInTheDocument()
    expect(adapter.guide).toHaveBeenCalledOnce()
    expect(await screen.findByText("尚未允许辅助功能。")).toBeVisible()
  })

  it("aborts a pending guide when the required kind changes", async () => {
    pendingGuide()
    adapter.check.mockImplementation(async (kind) => notGranted(kind))
    const { rerenderGuide } = renderGuide()
    await screen.findByText("尚未允许辅助功能。")
    await userEvent.click(
      screen.getByRole("button", { name: zh.guideAction })
    )
    expect(await screen.findByText(zh.waiting)).toBeVisible()
    const signal = adapter.guide.mock.calls[0]?.[1] as AbortSignal

    rerenderGuide({ kind: "screenRecording" })
    expect(signal.aborted).toBe(true)
    await waitFor(() => expect(adapter.check).toHaveBeenCalledTimes(2))
    expect(adapter.check.mock.calls[1]?.[0]).toBe("screenRecording")
    expect(screen.queryByText(zh.waiting)).not.toBeInTheDocument()
    expect(adapter.guide).toHaveBeenCalledOnce()
    expect(await screen.findByText("尚未允许屏幕录制。")).toBeVisible()
  })

  it("does not surface a stale manual settings rejection in a later opening", async () => {
    const settings = deferred<boolean>()
    adapter.openSettings.mockReturnValue(settings.promise)
    const { rerenderGuide } = renderGuide()
    await screen.findByText("尚未允许辅助功能。")
    await userEvent.click(
      screen.getByRole("button", { name: zh.manualAction })
    )
    expect(adapter.openSettings).toHaveBeenCalledOnce()

    rerenderGuide({ open: false })
    rerenderGuide({ open: true })
    await waitFor(() => expect(adapter.check).toHaveBeenCalledTimes(2))
    await act(async () => settings.resolve(false))
    expect(screen.queryByText(zh.manualFailed)).not.toBeInTheDocument()
  })

  it("does not let a late guide grant overwrite a newer check", async () => {
    const guide = deferred<ComputerPermissionResult>()
    adapter.guide.mockReturnValue(guide.promise)
    renderGuide()
    await screen.findByText("尚未允许辅助功能。")
    await userEvent.click(
      screen.getByRole("button", { name: zh.guideAction })
    )
    expect(await screen.findByText(zh.waiting)).toBeVisible()

    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"))
    })
    await waitFor(() => expect(adapter.check).toHaveBeenCalledTimes(2))
    await act(async () => {
      await Promise.resolve()
    })
    expect(screen.getByText("尚未允许辅助功能。")).toBeVisible()

    await act(async () => guide.resolve(granted()))
    expect(screen.queryByText("已允许辅助功能。")).not.toBeInTheDocument()
    expect(screen.getByText("尚未允许辅助功能。")).toBeVisible()
    expect(screen.queryByText(zh.waiting)).not.toBeInTheDocument()
  })

  it("does not let a late check overwrite a newer guide", async () => {
    const lateCheck = deferred<ComputerPermissionResult>()
    adapter.check
      .mockReset()
      .mockResolvedValueOnce(notGranted())
      .mockImplementationOnce(() => lateCheck.promise)
      .mockResolvedValue(notGranted())
    adapter.guide.mockResolvedValue(closed())
    renderGuide()
    await screen.findByText("尚未允许辅助功能。")

    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"))
    })
    await waitFor(() => expect(adapter.check).toHaveBeenCalledTimes(2))

    await userEvent.click(
      screen.getByRole("button", { name: zh.guideAction })
    )
    expect(await screen.findByText(zh.guideClosed)).toBeVisible()

    await act(async () => lateCheck.resolve(granted("accessibility", "checked")))
    expect(screen.queryByText("已允许辅助功能。")).not.toBeInTheDocument()
    expect(screen.getByText(zh.guideClosed)).toBeVisible()
  })

  it("keeps guide feedback and the manual fallback across a focus reread", async () => {
    adapter.guide.mockResolvedValue(closed())
    renderGuide()
    await screen.findByText("尚未允许辅助功能。")
    await userEvent.click(
      screen.getByRole("button", { name: zh.guideAction })
    )
    expect(await screen.findByText(zh.guideClosed)).toBeVisible()

    const reread = deferred<ComputerPermissionResult>()
    adapter.check.mockImplementationOnce(() => reread.promise)
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"))
    })
    await waitFor(() => expect(adapter.check).toHaveBeenCalledTimes(2))
    await act(async () => reread.resolve(notGranted()))
    expect(screen.getByText(zh.guideClosed)).toBeVisible()
    expect(
      screen.getByRole("button", { name: zh.manualAction })
    ).toBeVisible()
  })

  it("suppresses the previous guide outcome once a check reports granted", async () => {
    adapter.guide.mockResolvedValue(closed())
    renderGuide()
    await screen.findByText("尚未允许辅助功能。")
    await userEvent.click(
      screen.getByRole("button", { name: zh.guideAction })
    )
    expect(await screen.findByText(zh.guideClosed)).toBeVisible()

    adapter.check.mockResolvedValue(granted("accessibility", "checked"))
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"))
    })
    expect(await screen.findByText("已允许辅助功能。")).toBeVisible()
    expect(screen.queryByText(zh.guideClosed)).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: zh.guideAction })
    ).not.toBeInTheDocument()
  })

  it("shows a not-packaged Check without settings actions", async () => {
    adapter.check.mockResolvedValue({
      kind: "accessibility",
      status: "unknown",
      reason: "notPackaged",
    })
    renderGuide()
    expect(await screen.findByText(zh.statusNotPackaged)).toBeVisible()
    expect(
      screen.queryByRole("button", { name: zh.guideAction })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: zh.manualAction })
    ).not.toBeInTheDocument()
    expect(adapter.guide).not.toHaveBeenCalled()
    expect(adapter.openSettings).not.toHaveBeenCalled()
  })

  it("disables settings after a later Check fails", async () => {
    const later = deferred<ComputerPermissionResult>()
    adapter.check
      .mockReset()
      .mockResolvedValueOnce(notGranted())
      .mockImplementationOnce(() => later.promise)
      .mockResolvedValue(notGranted())
    renderGuide()
    await screen.findByText("尚未允许辅助功能。")
    expect(
      screen.getByRole("button", { name: zh.guideAction })
    ).toBeVisible()

    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"))
    })
    await waitFor(() => expect(adapter.check).toHaveBeenCalledTimes(2))
    await act(async () =>
      later.resolve({
        kind: "accessibility",
        status: "unknown",
        reason: "failed",
      })
    )
    expect(await screen.findByText("无法检查辅助功能权限。")).toBeVisible()
    expect(
      screen.queryByRole("button", { name: zh.guideAction })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: zh.manualAction })
    ).not.toBeInTheDocument()
  })

  it("enables settings again after a later successful Check", async () => {
    adapter.check
      .mockReset()
      .mockResolvedValueOnce({
        kind: "accessibility",
        status: "unknown",
        reason: "failed",
      })
      .mockResolvedValue(notGranted())
    renderGuide()
    expect(await screen.findByText("无法检查辅助功能权限。")).toBeVisible()
    expect(
      screen.queryByRole("button", { name: zh.guideAction })
    ).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole("button", { name: zh.checkAgain }))
    expect(await screen.findByText("尚未允许辅助功能。")).toBeVisible()
    expect(
      screen.getByRole("button", { name: zh.guideAction })
    ).toBeVisible()
  })

  it("rechecks on focus and visibility without reopening the guide", async () => {
    renderGuide()
    await screen.findByText("尚未允许辅助功能。")
    expect(adapter.check).toHaveBeenCalledOnce()

    document.dispatchEvent(new Event("visibilitychange"))
    await waitFor(() => expect(adapter.check).toHaveBeenCalledTimes(2))
    window.dispatchEvent(new Event("focus"))
    await waitFor(() => expect(adapter.check).toHaveBeenCalledTimes(3))
    expect(adapter.guide).not.toHaveBeenCalled()
  })

  it("refreshes when the native window becomes active", async () => {
    const native = {
      listener: null as null | ((active: boolean) => void),
    }
    const unsubscribe = vi.fn()
    adapter.subscribeWindowActive.mockImplementation((listener) => {
      native.listener = listener
      return unsubscribe
    })
    const { unmount } = renderGuide()
    await screen.findByText("尚未允许辅助功能。")
    expect(adapter.subscribeWindowActive).toHaveBeenCalledOnce()

    await act(async () => native.listener?.(false))
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(adapter.check).toHaveBeenCalledOnce()

    await act(async () => native.listener?.(true))
    await waitFor(() => expect(adapter.check).toHaveBeenCalledTimes(2))
    unmount()
    expect(unsubscribe).toHaveBeenCalledOnce()
  })

  it("coalesces native active and visible DOM refresh into one read", async () => {
    const native = {
      listener: null as null | ((active: boolean) => void),
    }
    adapter.subscribeWindowActive.mockImplementation((listener) => {
      native.listener = listener
      return () => undefined
    })
    renderGuide()
    await screen.findByText("尚未允许辅助功能。")

    await act(async () => {
      native.listener?.(true)
      document.dispatchEvent(new Event("visibilitychange"))
      window.dispatchEvent(new Event("focus"))
    })
    await new Promise((resolve) => setTimeout(resolve, 250))
    expect(adapter.check).toHaveBeenCalledTimes(2)
  })

  it("does not mention a restart until Screen Recording was enabled by the user", async () => {
    adapter.check.mockResolvedValue(notGranted("screenRecording"))
    renderGuide({ kind: "screenRecording" })
    expect(await screen.findByText("尚未允许屏幕录制。")).toBeVisible()
    expect(screen.queryByText(zh.restartHint)).not.toBeInTheDocument()
    const checks = adapter.check.mock.calls.length

    await userEvent.click(
      screen.getByRole("button", { name: zh.restartConfirm })
    )
    expect(await screen.findByText(zh.restartHint)).toBeVisible()
    expect(screen.getByText("尚未允许屏幕录制。")).toBeVisible()
    expect(adapter.check).toHaveBeenCalledTimes(checks)
    expect(adapter.guide).not.toHaveBeenCalled()
  })

  it("opens manual settings through the admitted fallback", async () => {
    adapter.guide.mockResolvedValue({
      kind: "accessibility",
      status: "unknown",
      reason: "failed",
    })
    adapter.openSettings.mockResolvedValue(true)
    renderGuide()
    await screen.findByText("尚未允许辅助功能。")
    await userEvent.click(
      screen.getByRole("button", { name: zh.guideAction })
    )
    expect(await screen.findByText(zh.guideFailed)).toBeVisible()
    await userEvent.click(
      screen.getByRole("button", { name: zh.manualAction })
    )
    expect(adapter.openSettings).toHaveBeenCalledWith("accessibility")
    expect(screen.queryByText(zh.manualFailed)).not.toBeInTheDocument()

    adapter.openSettings.mockResolvedValue(false)
    await userEvent.click(
      screen.getByRole("button", { name: zh.manualAction })
    )
    expect(await screen.findByText(zh.manualFailed)).toBeVisible()
  })

  it("disables both settings actions while a manual request is pending", async () => {
    const settings = deferred<boolean>()
    adapter.openSettings.mockReturnValue(settings.promise)
    renderGuide()
    await screen.findByText("尚未允许辅助功能。")
    const manual = screen.getByRole("button", { name: zh.manualAction })
    await userEvent.click(manual)
    expect(manual).toBeDisabled()
    expect(
      screen.getByRole("button", { name: zh.guideAction })
    ).toBeDisabled()
    expect(adapter.openSettings).toHaveBeenCalledOnce()
    await act(async () => settings.resolve(true))
    expect(
      screen.getByRole("button", { name: zh.manualAction })
    ).not.toBeDisabled()
  })

  it("fails closed without a settings action when the host is unsupported", async () => {
    adapter.check.mockResolvedValue({
      kind: "accessibility",
      status: "unknown",
      reason: "unsupported",
    })
    renderGuide()
    expect(await screen.findByText(zh.statusUnsupported)).toBeVisible()
    expect(
      screen.queryByRole("button", { name: zh.guideAction })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: zh.manualAction })
    ).not.toBeInTheDocument()
    expect(adapter.guide).not.toHaveBeenCalled()
    expect(adapter.openSettings).not.toHaveBeenCalled()
    expect(
      screen.getAllByRole("button", { name: zh.close }).length
    ).toBeGreaterThan(0)
  })

  it("continues without GUI only through the explicit callback", async () => {
    const onContinueWithoutGui = vi.fn()
    const { onOpenChange } = renderGuide({ onContinueWithoutGui })
    await screen.findByText("尚未允许辅助功能。")
    await userEvent.click(
      screen.getByRole("button", { name: zh.continueWithoutGui })
    )
    expect(onContinueWithoutGui).toHaveBeenCalledOnce()
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it("closes through the shared dialog control", async () => {
    const { onOpenChange } = renderGuide()
    await screen.findByText("尚未允许辅助功能。")
    const closeButton = screen.getAllByRole("button", { name: zh.close }).at(-1)
    if (!closeButton) throw new Error("Missing dialog close button")
    await userEvent.click(closeButton)
    expect(onOpenChange.mock.calls[0]?.[0]).toBe(false)
  })
})
