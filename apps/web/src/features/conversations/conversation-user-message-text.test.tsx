import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import i18n from "@/i18n"
import { ConversationUserMessageText } from "./conversation-user-message-text"

let contentHeight = 384
let onResize: (() => void) | undefined
const originalResizeObserver = window.ResizeObserver

beforeEach(async () => {
  await i18n.changeLanguage("zh-CN")
  contentHeight = 384
  const getComputedStyle = window.getComputedStyle.bind(window)
  vi.spyOn(window, "getComputedStyle").mockImplementation((element) => {
    const style = getComputedStyle(element)
    Object.defineProperty(style, "lineHeight", {
      configurable: true,
      value: "24px",
    })
    return style
  })
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function () {
      return DOMRect.fromRect({ width: 300, height: contentHeight })
    }
  )
  window.ResizeObserver = class implements ResizeObserver {
    constructor(callback: ResizeObserverCallback) {
      onResize = () => callback([], this)
    }
    observe() {}
    unobserve() {}
    disconnect() {}
  }
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  window.ResizeObserver = originalResizeObserver
  onResize = undefined
})

describe("user message text", () => {
  it("clips more than fifteen rendered lines with a fade and a left-aligned labeled toggle", async () => {
    const content = "一段没有手动换行、但在窄聊天区自动换成十六行的完整研究要求"
    render(<ConversationUserMessageText content={content} />)
    const button = screen.getByRole("button", { name: "显示更多" })
    const text = screen.getByText(content).closest("p")!
    expect(button).toHaveAttribute("aria-expanded", "false")
    expect(button).toHaveAttribute("aria-controls", text.id)
    expect(button).toHaveTextContent("显示更多")
    expect(button.querySelector(".lucide-chevron-down")).not.toBeNull()
    expect(button).toHaveClass(
      "h-6",
      "-ml-2",
      "text-muted-foreground",
      "aria-expanded:text-muted-foreground"
    )
    expect(button.parentElement).toHaveClass("justify-start", "pt-1")
    expect(text.parentElement).toHaveClass(
      "max-h-[15lh]",
      "mask-b-from-80%",
      "mask-b-to-100%"
    )
    await userEvent.click(button)
    const collapseButton = screen.getByRole("button", { name: "收起" })
    expect(collapseButton).toHaveAttribute("aria-expanded", "true")
    expect(collapseButton.querySelector(".lucide-chevron-up")).not.toBeNull()
    expect(text.parentElement).not.toHaveClass("max-h-[15lh]")
    expect(text).toHaveTextContent(content)
    fireEvent.click(collapseButton)
    expect(text.parentElement).toHaveClass("max-h-[15lh]")
  })

  it.each([0, 24, 360])(
    "does not collapse content with a rendered height of %i pixels",
    (height) => {
      contentHeight = height
      render(<ConversationUserMessageText content="短消息" />)
      expect(screen.queryByRole("button")).not.toBeInTheDocument()
      expect(
        screen.getByText("短消息").closest("p")?.parentElement
      ).not.toHaveClass("max-h-[15lh]", "mask-b-from-80%")
    }
  )

  it("rechecks wrapping on resize without resetting a user's expanded choice on refresh", () => {
    contentHeight = 360
    const view = render(<ConversationUserMessageText content="研究要求" />)
    expect(screen.queryByRole("button")).not.toBeInTheDocument()
    contentHeight = 384
    act(() => onResize?.())
    fireEvent.click(screen.getByRole("button", { name: "显示更多" }))
    view.rerender(<ConversationUserMessageText content="研究要求" />)
    expect(screen.getByRole("button", { name: "收起" })).toHaveAttribute(
      "aria-expanded",
      "true"
    )
    contentHeight = 336
    act(() => onResize?.())
    expect(screen.queryByRole("button")).not.toBeInTheDocument()
    contentHeight = 408
    act(() => onResize?.())
    expect(screen.getByRole("button", { name: "收起" })).toHaveAttribute(
      "aria-expanded",
      "true"
    )
  })

  it.each([
    ["zh-CN", "显示更多", "收起"],
    ["en-US", "Show more", "Show less"],
    ["de-DE", "显示更多", "收起"],
  ])(
    "supports keyboard controls and localized accessible labels in %s",
    async (language, expand, collapse) => {
      await i18n.changeLanguage(language)
      render(
        <ConversationUserMessageText content="研究要求 https://example.test/report" />
      )
      const button = screen.getByRole("button", { name: expand })
      button.focus()
      await userEvent.keyboard("{Enter}")
      expect(screen.getByRole("button", { name: collapse })).toHaveFocus()
      expect(document.querySelector("[data-user-message-url]")).toHaveAttribute(
        "data-user-message-url",
        "https://example.test/report"
      )
    }
  )
})
