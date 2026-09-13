import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { I18nextProvider } from "react-i18next"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { AssistantHtmlPreviewLoading } from "@/features/conversations/assistant-html-preview-loading"
import { snakeTickMs } from "@/features/conversations/waiting-snake-engine"
import i18n from "@/i18n"

describe("AssistantHtmlPreviewLoading", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("zh-CN")
    vi.useFakeTimers()
    vi.spyOn(Math, "random").mockReturnValue(0)
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it("renders the interactive-generation dot canvas with accessible status", () => {
    const { container } = render(
      <AssistantHtmlPreviewLoading label="正在生成交互式内容" />
    )

    const status = screen.getByRole("status", {
      name: "正在生成交互式内容",
    })
    expect(status).toHaveAttribute("aria-busy", "true")
    expect(status).toHaveAttribute("aria-live", "polite")
    const canvas = container.querySelector(
      ".assistant-html-preview-loading-canvas"
    )
    expect(canvas).toHaveAttribute("aria-hidden", "true")
    expect(canvas).toBeVisible()
    expect(status).toHaveClass("w-full")
    expect(screen.getByRole("button", { name: "玩着等待" })).toHaveClass(
      "absolute",
      "right-3",
      "bottom-3"
    )
    expect(
      container.querySelector(".assistant-html-preview-loading-dots")
    ).toBeVisible()
    expect(
      container.querySelector(".assistant-html-preview-loading-glow")
    ).toBeVisible()
    expect(
      container.querySelector(".assistant-html-preview-loading-meta")
    ).toBeNull()
  })

  function enterGame() {
    const rendered = render(
      <AssistantHtmlPreviewLoading label="正在生成图片…" />
    )
    fireEvent.click(screen.getByRole("button", { name: "玩着等待" }))
    return {
      ...rendered,
      board: screen.getByRole("application", { name: "贪吃蛇" }),
    }
  }

  it("keeps the dot background and loading status while replacing the animation with a focused game", () => {
    const { container, board } = enterGame()
    expect(board).toHaveFocus()
    expect(board).toHaveAccessibleDescription("方向键 / WASD · 滑动控制")
    expect(
      container.querySelector(".assistant-html-preview-loading-dots")
    ).toBeVisible()
    expect(
      container.querySelector(".assistant-html-preview-loading-glow")
    ).toBeNull()
    expect(
      screen.getByRole("status", { name: "正在生成图片…" })
    ).toHaveAttribute("aria-busy", "true")
    expect(
      screen.getByRole("group", { name: "正在生成图片…" })
    ).not.toHaveAttribute("aria-busy")
    expect(screen.getByText("得分 0")).toBeVisible()
  })

  it("starts with a direction key, scores, pauses and resumes with Space, then supports restarting", () => {
    const { board } = enterGame()
    fireEvent.keyDown(board, { key: "d" })
    act(() => vi.advanceTimersByTime(snakeTickMs * 10))
    expect(screen.getByText("得分 1")).toBeVisible()
    fireEvent.keyDown(board, { key: " " })
    act(() => vi.advanceTimersByTime(snakeTickMs * 50))
    expect(screen.getByText("已暂停")).toBeVisible()
    expect(screen.getByText("得分 1")).toBeVisible()
    fireEvent.keyDown(board, { key: " " })
    act(() => vi.advanceTimersByTime(snakeTickMs * 7))
    expect(screen.getByText("差一点，再来一局？")).toBeVisible()
    fireEvent.click(screen.getByRole("button", { name: "再玩一次" }))
    expect(screen.getByText("得分 0")).toBeVisible()
    expect(board).toHaveFocus()
    expect(screen.getByRole("button", { name: "暂停游戏" })).toBeEnabled()
  })

  it("starts and turns via actual touch gestures", () => {
    const { board } = enterGame()
    const start = { identifier: 1, target: board, clientX: 50, clientY: 50 }
    const end = { ...start, clientX: 90 }
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
    expect(screen.queryByText("让等待有点乐趣")).toBeNull()
    act(() => vi.advanceTimersByTime(snakeTickMs * 10))
    expect(screen.getByText("得分 1")).toBeVisible()
  })

  it("pauses when focus leaves the game or the tab is hidden, and never captures composer keys", () => {
    const { board } = enterGame()
    fireEvent.click(screen.getByRole("button", { name: "开始游戏" }))
    fireEvent.blur(board, { relatedTarget: document.body })
    expect(screen.getByText("已暂停")).toBeVisible()
    fireEvent.keyDown(document.body, { key: "d" })
    expect(screen.getByText("已暂停")).toBeVisible()
    fireEvent.keyDown(board, { key: " " })
    fireEvent(window, new Event("blur"))
    expect(screen.getByText("已暂停")).toBeVisible()
    fireEvent.keyDown(board, { key: " " })
    vi.spyOn(document, "hidden", "get").mockReturnValue(true)
    fireEvent(document, new Event("visibilitychange"))
    expect(screen.getByText("已暂停")).toBeVisible()
  })

  it.each(["button", "escape"])(
    "returns to loading via %s, restores focus, and resets the next game",
    (exit) => {
      const { board, container } = enterGame()
      fireEvent.keyDown(board, { key: "d" })
      act(() => vi.advanceTimersByTime(snakeTickMs * 10))
      if (exit === "button")
        fireEvent.click(screen.getByRole("button", { name: "返回等待" }))
      else fireEvent.keyDown(board, { key: "Escape" })
      act(() => vi.advanceTimersByTime(20))
      expect(screen.queryByRole("application")).toBeNull()
      expect(screen.getByRole("button", { name: "玩着等待" })).toHaveFocus()
      expect(
        container.querySelector(".assistant-html-preview-loading-glow")
      ).toBeVisible()
      fireEvent.click(screen.getByRole("button", { name: "玩着等待" }))
      expect(screen.getByText("得分 0")).toBeVisible()
    }
  )

  it("clears the game interval when the loading surface disappears", () => {
    const interval = vi.spyOn(window, "setInterval")
    const clearInterval = vi.spyOn(window, "clearInterval")
    const { board, unmount } = enterGame()
    fireEvent.keyDown(board, { key: "d" })
    const tickCall = interval.mock.calls.findIndex(
      ([, duration]) => duration === snakeTickMs
    )
    expect(tickCall).toBeGreaterThanOrEqual(0)
    const timer = interval.mock.results[tickCall]?.value
    unmount()
    expect(clearInterval).toHaveBeenCalledWith(timer)
  })

  it("provides English controls and falls back to Chinese for missing game translations", async () => {
    await i18n.changeLanguage("en-US")
    const { unmount } = render(
      <AssistantHtmlPreviewLoading label="Generating image…" />
    )
    fireEvent.click(screen.getByRole("button", { name: "Play while you wait" }))
    expect(
      screen.getByRole("application", { name: "Snake" })
    ).toHaveAccessibleDescription("Arrow keys / WASD · Swipe to steer")
    expect(screen.getByRole("button", { name: "Start game" })).toBeVisible()
    expect(
      screen.getByRole("button", { name: "Back to waiting" })
    ).toBeVisible()
    unmount()
    const fallback = i18n.cloneInstance({ forkResourceStore: true })
    fallback.removeResourceBundle("en-US", "translation")
    render(
      <I18nextProvider i18n={fallback}>
        <AssistantHtmlPreviewLoading label="正在生成图片…" />
      </I18nextProvider>
    )
    fireEvent.click(screen.getByRole("button", { name: "玩着等待" }))
    expect(screen.getByRole("application", { name: "贪吃蛇" })).toBeVisible()
    expect(screen.getByRole("button", { name: "开始游戏" })).toBeVisible()
  })
})
