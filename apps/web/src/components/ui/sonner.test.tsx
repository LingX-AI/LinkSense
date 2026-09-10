import { render } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { createInstance } from "i18next"
import { I18nextProvider } from "react-i18next"

import i18n from "@/i18n"
import { zhCN } from "@/i18n/zh-CN"

const { sonnerSpy } = vi.hoisted(() => ({
  sonnerSpy: vi.fn(),
}))

vi.mock("sonner", () => ({
  Toaster: (props: unknown) => {
    sonnerSpy(props)
    return null
  },
}))

vi.mock("@/app/theme-state", () => ({
  useTheme: () => ({ theme: "light" }),
}))

import { Toaster } from "@/components/ui/sonner"

describe("Toaster", () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    await i18n.changeLanguage("zh-CN")
  })

  it("keeps short messages on one line and wraps only at a wider viewport-safe maximum", () => {
    render(<Toaster position="top-center" />)

    expect(sonnerSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        className: "toaster group",
        icons: {
          success: expect.objectContaining({
            props: expect.objectContaining({
              className: "size-4 text-success",
            }),
          }),
          info: expect.objectContaining({
            props: expect.objectContaining({ className: "size-4" }),
          }),
          warning: expect.objectContaining({
            props: expect.objectContaining({ className: "size-4" }),
          }),
          error: expect.objectContaining({
            props: expect.objectContaining({
              className: "size-4 text-destructive",
            }),
          }),
          loading: expect.objectContaining({
            props: expect.objectContaining({
              className: "size-4 motion-safe:animate-spin",
            }),
          }),
        },
        position: "top-center",
        style: expect.objectContaining({
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--app-border)",
          "--border-radius": "var(--radius)",
        }),
        theme: "light",
        toastOptions: {
          closeButtonAriaLabel: "关闭",
          classNames: {
            toast:
              "cn-toast left-1/2! right-auto! w-max! max-w-[min(40rem,calc(100vw-2rem))] -translate-x-1/2 py-3!",
            content: "min-w-0",
            closeButton: expect.stringContaining("border-0!"),
          },
        },
      })
    )
  })

  it.each([
    ["zh-CN", "通知", "关闭"],
    ["en-US", "Notifications", "Close"],
  ])(
    "localizes notification controls in %s",
    async (language, label, closeLabel) => {
      await i18n.changeLanguage(language)
      render(<Toaster />)
      expect(sonnerSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          containerAriaLabel: label,
          toastOptions: expect.objectContaining({
            closeButtonAriaLabel: closeLabel,
          }),
          icons: expect.objectContaining({
            error: expect.objectContaining({
              props: expect.objectContaining({ "aria-hidden": "true" }),
            }),
          }),
        })
      )
    }
  )

  it("falls back to Chinese when notification translations are missing", async () => {
    const instance = createInstance()
    await instance.init({
      lng: "en-US",
      fallbackLng: "zh-CN",
      resources: {
        "zh-CN": { translation: zhCN },
        "en-US": { translation: {} },
      },
    })
    render(
      <I18nextProvider i18n={instance}>
        <Toaster />
      </I18nextProvider>
    )
    expect(sonnerSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        containerAriaLabel: "通知",
        toastOptions: expect.objectContaining({ closeButtonAriaLabel: "关闭" }),
      })
    )
  })
})
