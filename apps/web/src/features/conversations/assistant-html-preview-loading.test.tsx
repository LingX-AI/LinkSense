import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { I18nextProvider } from "react-i18next"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { AssistantHtmlPreviewLoading } from "@/features/conversations/assistant-html-preview-loading"
import {
  snakeRestartMs,
  snakeTickMs,
} from "@/features/conversations/waiting-snake-engine"
import i18n from "@/i18n"

class SizeObserver implements ResizeObserver {
  static instances: SizeObserver[] = []
  observe = vi.fn()
  unobserve = vi.fn()
  disconnect = vi.fn()
  readonly callback: ResizeObserverCallback
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback
    SizeObserver.instances.push(this)
  }
  resize() {
    this.callback([], this)
  }
}

const advance = (ticks: number) =>
  act(() => vi.advanceTimersByTime(snakeTickMs * ticks))
const snakeLength = (board: HTMLElement) =>
  board.querySelectorAll("svg rect").length

describe("AssistantHtmlPreviewLoading", () => {
  let originalResizeObserver: typeof ResizeObserver
  beforeEach(async () => {
    await i18n.changeLanguage("zh-CN")
    vi.useFakeTimers()
    vi.spyOn(Math, "random").mockReturnValue(0)
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 0, 384, 256)
    )
    SizeObserver.instances = []
    originalResizeObserver = window.ResizeObserver
    window.ResizeObserver = SizeObserver
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.restoreAllMocks()
    window.ResizeObserver = originalResizeObserver
  })

  function enterGame() {
    const rendered = render(
      <AssistantHtmlPreviewLoading label="正在生成图片…" />
    )
    const surface = screen.getByRole("status", { name: "正在生成图片…" })
    fireEvent.click(surface)
    return {
      ...rendered,
      surface,
      board: screen.getByRole("application", { name: "贪吃蛇" }),
    }
  }

  it("keeps loading free of text and buttons", () => {
    const { container } = render(
      <AssistantHtmlPreviewLoading label="正在生成图片…" />
    )
    const surface = screen.getByRole("status", { name: "正在生成图片…" })
    expect(surface).toHaveAttribute("aria-busy", "true")
    expect(surface).toHaveAttribute("aria-live", "polite")
    expect(surface).toHaveAccessibleDescription(
      "单击或按回车键开始贪吃蛇游戏。"
    )
    expect(surface.textContent).toBe("")
    expect(screen.queryByRole("button")).toBeNull()
    expect(screen.queryByRole("application")).toBeNull()
    expect(
      container.querySelector(".assistant-html-preview-loading-glow")
    ).toBeVisible()
  })

  it("clicks straight into a moving game with no panel, text, buttons or inner border", () => {
    const { surface, board, container } = enterGame()
    expect(board).toHaveFocus()
    expect(surface.textContent).toBe("")
    expect(screen.queryByRole("button")).toBeNull()
    expect(board).toHaveClass("absolute", "inset-0")
    expect(board.querySelector("svg")).toHaveAttribute(
      "preserveAspectRatio",
      "none"
    )
    expect(board.querySelector("rect[stroke]")).toBeNull()
    expect(
      container.querySelector(".assistant-html-preview-loading-dots")
    ).toBeVisible()
    expect(
      container.querySelector(".assistant-html-preview-loading-glow")
    ).toBeNull()
    expect(
      screen.getByRole("status", { name: "正在生成图片…" })
    ).toHaveAttribute("aria-busy", "true")
    expect(snakeLength(board)).toBe(4)
    advance(10)
    expect(snakeLength(board)).toBe(5)
  })

  it("does not reset the game on a single click and exits after the full double-click sequence", () => {
    const { board } = enterGame()
    advance(10)
    fireEvent.click(board)
    expect(screen.getByRole("application")).toBe(board)
    expect(snakeLength(board)).toBe(5)
    fireEvent.click(board, { detail: 1 })
    fireEvent.click(board, { detail: 2 })
    fireEvent.doubleClick(board)
    expect(screen.queryByRole("application")).toBeNull()
  })

  it("briefly stops on collision and restarts automatically without an overlay", () => {
    const { board, surface } = enterGame()
    advance(10)
    advance(6)
    expect(snakeLength(board)).toBe(5)
    act(() => vi.advanceTimersByTime(snakeRestartMs - 1))
    expect(snakeLength(board)).toBe(5)
    act(() => vi.advanceTimersByTime(1))
    expect(snakeLength(board)).toBe(4)
    advance(10)
    expect(snakeLength(board)).toBe(5)
    expect(surface.textContent).toBe("")
    expect(screen.queryByRole("button")).toBeNull()
  })

  it.each(["double-click", "escape"])(
    "exits via %s, restores loading and focus, then starts a fresh game",
    (exit) => {
      const { surface, board, container } = enterGame()
      advance(10)
      if (exit === "double-click")
        fireEvent.doubleClick(board.querySelector("svg") ?? board)
      else fireEvent.keyDown(board, { key: "Escape" })
      expect(screen.queryByRole("application")).toBeNull()
      expect(surface).toHaveFocus()
      expect(
        container.querySelector(".assistant-html-preview-loading-glow")
      ).toBeVisible()
      advance(20)
      expect(screen.queryByRole("application")).toBeNull()
      fireEvent.click(surface)
      expect(snakeLength(screen.getByRole("application"))).toBe(4)
    }
  )

  it.each([
    [960, 320, "0 0 960 320"],
    [320, 320, "0 0 320 320"],
    [320, 640, "0 0 320 640"],
  ])(
    "fills a %s by %s surface and follows container resizing",
    (width, height, viewBox) => {
      vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockReturnValue(
        new DOMRect(0, 0, Number(width), Number(height))
      )
      const { board } = enterGame()
      expect(board.querySelector("svg")).toHaveAttribute(
        "viewBox",
        String(viewBox)
      )
      vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockReturnValue(
        new DOMRect(0, 0, 640, 320)
      )
      act(() => SizeObserver.instances.forEach((observer) => observer.resize()))
      expect(
        screen.getByRole("application").querySelector("svg")
      ).toHaveAttribute("viewBox", "0 0 640 320")
    }
  )

  it("steers via touch gestures and keyboard without showing instructions", () => {
    const { board } = enterGame()
    const start = { identifier: 1, target: board, clientX: 50, clientY: 50 }
    const end = { ...start, clientY: 90 }
    fireEvent.touchStart(board, {
      touches: [start],
      targetTouches: [start],
      changedTouches: [start],
    })
    fireEvent.touchMove(board, {
      touches: [end],
      targetTouches: [end],
      changedTouches: [end],
    })
    fireEvent.touchEnd(board, {
      touches: [],
      targetTouches: [],
      changedTouches: [end],
    })
    advance(3)
    fireEvent.keyDown(board, { key: "d" })
    advance(10)
    fireEvent.keyDown(board, { key: "ArrowUp" })
    advance(3)
    expect(snakeLength(board)).toBe(5)
    expect(board.textContent).toBe("")
  })

  it("pauses on leaving and resumes on returning without capturing composer keys", () => {
    const { board } = enterGame()
    fireEvent.blur(board, { relatedTarget: document.body })
    fireEvent.keyDown(document.body, { key: "d" })
    advance(10)
    expect(snakeLength(board)).toBe(4)
    fireEvent.focus(board)
    advance(10)
    expect(snakeLength(board)).toBe(5)
    fireEvent(window, new Event("blur"))
    advance(30)
    expect(snakeLength(board)).toBe(5)
    fireEvent(window, new Event("focus"))
    advance(6)
    act(() => vi.advanceTimersByTime(snakeRestartMs))
    expect(snakeLength(board)).toBe(4)
  })

  it("releases observers and cancels pending restart when generation ends", () => {
    const clearTimeout = vi.spyOn(window, "clearTimeout")
    const timeout = vi.spyOn(window, "setTimeout")
    const { unmount } = enterGame()
    advance(16)
    const restartCall = timeout.mock.calls.findIndex(
      ([, delay]) => delay === snakeRestartMs
    )
    expect(restartCall).toBeGreaterThanOrEqual(0)
    unmount()
    expect(clearTimeout).toHaveBeenCalledWith(
      timeout.mock.results[restartCall]?.value
    )
    expect(SizeObserver.instances[0]?.disconnect).toHaveBeenCalled()
  })

  it("clears the movement interval when a running loading surface disappears", () => {
    const interval = vi.spyOn(window, "setInterval")
    const clearInterval = vi.spyOn(window, "clearInterval")
    const { unmount } = enterGame()
    const movementCall = interval.mock.calls.findIndex(
      ([, delay]) => delay === snakeTickMs
    )
    expect(movementCall).toBeGreaterThanOrEqual(0)
    unmount()
    expect(clearInterval).toHaveBeenCalledWith(
      interval.mock.results[movementCall]?.value
    )
  })

  it("keeps an automatic restart paused while the window is inactive", () => {
    const { board } = enterGame()
    advance(16)
    fireEvent(window, new Event("blur"))
    act(() => vi.advanceTimersByTime(snakeRestartMs))
    advance(10)
    expect(snakeLength(board)).toBe(4)
    fireEvent(window, new Event("focus"))
    advance(10)
    expect(snakeLength(board)).toBe(5)
  })

  it("resizes without taking focus from the composer or resuming in the background", () => {
    const { board } = enterGame()
    render(<input aria-label="composer" />)
    const composer = screen.getByRole("textbox", { name: "composer" })
    act(() => composer.focus())
    vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockReturnValue(
      new DOMRect(0, 0, 640, 320)
    )
    act(() => SizeObserver.instances.forEach((observer) => observer.resize()))
    expect(composer).toHaveFocus()
    advance(17)
    expect(snakeLength(board)).toBe(4)
    act(() => board.focus())
    advance(17)
    expect(snakeLength(board)).toBe(5)
  })

  it("offers a keyboard entry and localized screen-reader descriptions with Chinese fallback", async () => {
    await i18n.changeLanguage("en-US")
    const { unmount } = render(
      <AssistantHtmlPreviewLoading label="Generating image…" />
    )
    expect(screen.getByRole("status")).toHaveAccessibleDescription(
      "Click or press Enter to play Snake."
    )
    fireEvent.keyDown(screen.getByRole("status"), { key: "Enter" })
    expect(
      screen.getByRole("application", { name: "Snake" })
    ).toHaveAccessibleDescription(
      "Use arrow keys, WASD or swipe to steer. Double-click or press Escape to return to waiting."
    )
    unmount()
    const fallback = i18n.cloneInstance({ forkResourceStore: true })
    fallback.removeResourceBundle("en-US", "translation")
    render(
      <I18nextProvider i18n={fallback}>
        <AssistantHtmlPreviewLoading label="正在生成图片…" />
      </I18nextProvider>
    )
    expect(screen.getByRole("status")).toHaveAccessibleDescription(
      "单击或按回车键开始贪吃蛇游戏。"
    )
    fireEvent.click(screen.getByRole("status"))
    expect(
      screen.getByRole("application", { name: "贪吃蛇" })
    ).toHaveAccessibleDescription(
      "方向键、WASD 或滑动控制；双击或按 ESC 返回等待。"
    )
  })
})
