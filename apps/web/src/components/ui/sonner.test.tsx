import { render } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

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
  beforeEach(() => {
    vi.clearAllMocks()
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
              className: "size-4 animate-spin",
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
          classNames: {
            toast:
              "cn-toast left-1/2! right-auto! w-max! max-w-[min(40rem,calc(100vw-2rem))] -translate-x-1/2 py-3!",
            content: "min-w-0",
          },
        },
      })
    )
  })
})
