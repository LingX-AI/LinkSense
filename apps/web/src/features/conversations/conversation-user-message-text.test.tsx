import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import i18n from "@/i18n"
import { ConversationUserMessageText } from "./conversation-user-message-text"

let contentHeight = 144
let onResize: (() => void) | undefined
const originalResizeObserver = window.ResizeObserver

beforeEach(async () => {
  await i18n.changeLanguage("zh-CN")
  contentHeight = 144
  const getComputedStyle = window.getComputedStyle
  vi.spyOn(window, "getComputedStyle").mockImplementation((element) => {
    const style = getComputedStyle(element)
    style.lineHeight = "24px"
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

describe("application message text", () => {
  it("clips more than five rendered lines with a fade and an icon-only toggle", async () => {
    const content = "一段没有手动换行、但在窄聊天区自动换成六行的完整研究要求"
    render(<ConversationUserMessageText content={content} collapsible />)
    const button = screen.getByRole("button", { name: "展开消息" })
    const text = screen.getByText(content).closest("p")!
    expect(button).toHaveAttribute("aria-expanded", "false")
    expect(button).toHaveAttribute("aria-controls", text.id)
    expect(button.textContent).toBe("")
    expect(button.querySelector("svg")).not.toBeNull()
    expect(button).toHaveClass(
      "size-6",
      "text-muted-foreground",
      "aria-expanded:text-muted-foreground"
    )
    expect(button.parentElement).toHaveClass("-my-1")
    expect(text.parentElement).toHaveClass(
      "max-h-[5lh]",
      "mask-b-from-70%",
      "mask-b-to-100%"
    )
    await userEvent.click(button)
    expect(screen.getByRole("button", { name: "收起消息" })).toHaveAttribute(
      "aria-expanded",
      "true"
    )
    expect(text.parentElement).not.toHaveClass("max-h-[5lh]")
    expect(text).toHaveTextContent(content)
    fireEvent.click(screen.getByRole("button", { name: "收起消息" }))
    expect(text.parentElement).toHaveClass("max-h-[5lh]")
  })

  it.each([0, 24, 120])(
    "does not collapse content with a rendered height of %i pixels",
    (height) => {
      contentHeight = height
      render(<ConversationUserMessageText content="短消息" collapsible />)
      expect(screen.queryByRole("button")).not.toBeInTheDocument()
      expect(
        screen.getByText("短消息").closest("p")?.parentElement
      ).not.toHaveClass("mask-b-from-70%")
    }
  )

  it("keeps manually typed messages fully visible even when they exceed five lines", () => {
    render(<ConversationUserMessageText content="普通聊天长消息" />)
    expect(screen.queryByRole("button")).not.toBeInTheDocument()
    expect(
      screen.getByText("普通聊天长消息").closest("p")?.parentElement
    ).not.toHaveClass("max-h-[5lh]")
  })

  it("rechecks wrapping on resize without resetting a user's expanded choice on refresh", () => {
    contentHeight = 120
    const view = render(
      <ConversationUserMessageText content="研究要求" collapsible />
    )
    expect(screen.queryByRole("button")).not.toBeInTheDocument()
    contentHeight = 144
    act(() => onResize?.())
    fireEvent.click(screen.getByRole("button", { name: "展开消息" }))
    view.rerender(
      <ConversationUserMessageText content="研究要求" collapsible />
    )
    expect(screen.getByRole("button", { name: "收起消息" })).toHaveAttribute(
      "aria-expanded",
      "true"
    )
    contentHeight = 96
    act(() => onResize?.())
    expect(screen.queryByRole("button")).not.toBeInTheDocument()
    contentHeight = 168
    act(() => onResize?.())
    expect(screen.getByRole("button", { name: "收起消息" })).toHaveAttribute(
      "aria-expanded",
      "true"
    )
  })

  it.each([
    ["zh-CN", "展开消息", "收起消息"],
    ["en-US", "Expand message", "Collapse message"],
    ["fr-FR", "展开消息", "收起消息"],
  ])(
    "supports keyboard controls and localized accessible labels in %s",
    async (language, expand, collapse) => {
      await i18n.changeLanguage(language)
      render(
        <ConversationUserMessageText
          content="研究要求 https://example.test/report"
          collapsible
        />
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
