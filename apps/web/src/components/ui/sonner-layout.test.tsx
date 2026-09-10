import { act, cleanup, render, screen } from "@testing-library/react"
import { compile } from "tailwindcss"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { notify } from "@/components/feedback/notification"
import { NotificationCenter } from "@/components/feedback/notification-toast"
import i18n from "@/i18n"

vi.mock("@/app/theme-state", () => ({
  useTheme: () => ({ theme: "light" }),
}))

describe("notification close button layout", () => {
  let stylesheet: HTMLStyleElement

  beforeEach(async () => {
    await i18n.changeLanguage("zh-CN")
    stylesheet = document.createElement("style")
    document.head.append(stylesheet)
  })

  afterEach(() => {
    act(() => {
      notify.dismiss()
    })
    cleanup()
    stylesheet.remove()
  })

  it.each([
    { name: "short messages", message: "保存失败。" },
    {
      name: "long messages",
      message:
        "当前应用暂时无法访问，请检查应用是否可用或联系管理员，然后重新提交你的任务。".repeat(
          4
        ),
    },
  ])(
    "keeps the close button after the content and vertically centered for $name",
    async ({ message }) => {
      render(<NotificationCenter />)
      act(() => {
        notify.error(message)
      })
      const closeButton = await screen.findByRole("button", { name: "关闭" })
      const toast = closeButton.closest("[data-sonner-toast]")
      if (!(toast instanceof HTMLElement))
        throw new Error("Expected notification")

      const compiler = await compile("@tailwind utilities;")
      const classes = [toast, ...toast.querySelectorAll("[class]")].flatMap(
        (element) => [...element.classList]
      )
      stylesheet.textContent = compiler.build(classes)

      const style = getComputedStyle(closeButton)
      expect(getComputedStyle(toast).display).toBe("flex")
      expect(style.position).toBe("static")
      expect(style.transform).toBe("none")
      expect(style.order).toBe("9999")
      expect(style.alignSelf).toBe("center")
      expect(style.marginLeft).toBe("auto")
      expect(style.flexShrink).toBe("0")
      expect(style.borderWidth).toBe("0px")
    }
  )
})
