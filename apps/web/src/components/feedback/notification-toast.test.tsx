import { render } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const { toasterSpy, toastSpies } = vi.hoisted(() => ({
  toasterSpy: vi.fn(),
  toastSpies: {
    loading: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    dismiss: vi.fn(),
  },
}))

vi.mock("sonner", () => ({ toast: toastSpies }))
vi.mock("@/components/ui/sonner", () => ({
  Toaster: (props: unknown) => {
    toasterSpy(props)
    return null
  },
}))

import {
  notificationDuration,
  notify,
} from "@/components/feedback/notification"
import {
  NotificationCenter,
  NotificationToast,
} from "@/components/feedback/notification-toast"

describe("notification toast", () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it("uses a 1.5 second global display duration", () => {
    expect(notificationDuration).toBe(1_500)
  })

  it("configures one reusable, auto-dismiss notification center", () => {
    render(<NotificationCenter />)

    expect(toasterSpy).toHaveBeenCalledWith({
      duration: notificationDuration,
      position: "top-center",
    })
  })

  it("shows declarative feedback outside the page layout", () => {
    const { container, rerender } = render(
      <NotificationToast
        id="profile-saved"
        message="资料已保存。"
        description="修改已生效。"
      />
    )

    expect(container).toBeEmptyDOMElement()
    expect(toastSpies.success).toHaveBeenCalledWith("资料已保存", {
      description: "修改已生效",
      duration: notificationDuration,
      id: "profile-saved",
    })

    rerender(
      <NotificationToast
        id="profile-saved"
        message="保存失败。"
        variant="error"
      />
    )
    expect(toastSpies.error).toHaveBeenCalledWith("保存失败", {
      closeButton: true,
      description: undefined,
      duration: notificationDuration,
      id: "profile-saved",
    })
  })

  it("shares the same duration through the imperative notification API", () => {
    notify.loading("正在处理。", { id: "connection-warning" })
    notify.success("Saved.", { id: "saved" })
    notify.info("请稍候…", { id: "waiting" })
    notify.warning("连接不稳定。", { id: "connection-warning" })
    notify.error("下载失败。", { id: "file-download-error" })
    notify.dismiss("connection-warning")

    expect(toastSpies.loading).toHaveBeenCalledWith("正在处理", {
      duration: Infinity,
      id: "connection-warning",
    })
    expect(toastSpies.success).toHaveBeenCalledWith("Saved", {
      duration: notificationDuration,
      id: "saved",
    })
    expect(toastSpies.info).toHaveBeenCalledWith("请稍候…", {
      duration: notificationDuration,
      id: "waiting",
    })
    expect(toastSpies.warning).toHaveBeenCalledWith("连接不稳定", {
      duration: notificationDuration,
      id: "connection-warning",
    })
    expect(toastSpies.error).toHaveBeenCalledWith("下载失败", {
      closeButton: true,
      duration: notificationDuration,
      id: "file-download-error",
    })
    expect(toastSpies.dismiss).toHaveBeenCalledWith("connection-warning")
  })

  it.each(["onAutoClose", "onDismiss"] as const)(
    "reports %s once so callers can clear an error and show it again",
    (eventName) => {
      toastSpies.error.mockReturnValue("error-toast")
      const onDismiss = vi.fn()
      const { rerender } = render(
        <NotificationToast
          message="保存失败。"
          variant="error"
          onDismiss={onDismiss}
        />
      )
      const options = toastSpies.error.mock.calls[0]?.[1]
      expect(options).toEqual(
        expect.objectContaining({
          onAutoClose: expect.any(Function),
          onDismiss: expect.any(Function),
        })
      )
      options[eventName]()
      options[eventName]()
      expect(onDismiss).toHaveBeenCalledExactlyOnceWith("保存失败。")

      rerender(
        <NotificationToast
          message={null}
          variant="error"
          onDismiss={onDismiss}
        />
      )
      rerender(
        <NotificationToast
          message="保存失败。"
          variant="error"
          onDismiss={onDismiss}
        />
      )
      expect(toastSpies.error).toHaveBeenCalledTimes(2)
    }
  )

  it("dismisses a resolved error and ignores its stale dismissal callback", () => {
    toastSpies.error
      .mockReturnValueOnce("first-error")
      .mockReturnValueOnce("second-error")
    const onDismiss = vi.fn()
    const { rerender } = render(
      <NotificationToast
        message="保存失败。"
        variant="error"
        onDismiss={onDismiss}
      />
    )
    const firstOptions = toastSpies.error.mock.calls[0]?.[1]
    rerender(
      <NotificationToast message={null} variant="error" onDismiss={onDismiss} />
    )
    expect(toastSpies.dismiss).toHaveBeenCalledWith("first-error")

    rerender(
      <NotificationToast
        message="保存失败。"
        variant="error"
        onDismiss={onDismiss}
      />
    )
    firstOptions.onAutoClose()
    expect(onDismiss).not.toHaveBeenCalled()
    toastSpies.error.mock.calls[1]?.[1].onDismiss()
    expect(onDismiss).toHaveBeenCalledExactlyOnceWith("保存失败。")
  })

  it("does not repeat an unchanged error when the page rerenders", () => {
    const onDismiss = vi.fn()
    const { rerender } = render(
      <NotificationToast
        message="保存失败。"
        variant="error"
        onDismiss={onDismiss}
      />
    )
    rerender(
      <NotificationToast
        message="保存失败。"
        variant="error"
        onDismiss={onDismiss}
      />
    )
    expect(toastSpies.error).toHaveBeenCalledTimes(1)
  })
})
