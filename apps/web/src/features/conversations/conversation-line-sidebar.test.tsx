import { StrictMode } from "react"
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  ConversationLineSidebar,
  type ConversationLineSidebarItem,
} from "@/features/conversations/conversation-line-sidebar"

const items: ConversationLineSidebarItem[] = [
  {
    id: "turn-1",
    userMessage: "分析登录失败的原因",
    assistantMessage: "已定位到会话过期，并给出了刷新令牌的处理方案。",
    createdAt: "2026-07-11T08:05:00",
  },
  {
    id: "turn-2",
    userMessage: "补充单元测试",
    assistantMessage: "相关边界用例已经补齐。",
  },
  {
    id: "turn-3",
    userMessage: "检查构建结果",
  },
]

function installMatchMedia(matches: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  })
}

describe("ConversationLineSidebar", () => {
  it("highlights every visible exchange and clears them when the viewport changes", () => {
    const view = render(
      <ConversationLineSidebar
        ariaLabel="任务消息导航"
        items={items}
        activeItemIds={["turn-1", "turn-2"]}
      />
    )
    expect(
      screen.getByRole("button", { name: "分析登录失败的原因" })
    ).toHaveAttribute("aria-current", "true")
    expect(
      screen.getByRole("button", { name: "补充单元测试" })
    ).toHaveAttribute("aria-current", "true")
    expect(
      screen.getByRole("button", { name: "检查构建结果" })
    ).not.toHaveAttribute("aria-current")
    view.rerender(
      <ConversationLineSidebar
        ariaLabel="任务消息导航"
        items={items}
        activeItemIds={["turn-3"]}
      />
    )
    expect(
      screen.getByRole("button", { name: "分析登录失败的原因" })
    ).not.toHaveAttribute("aria-current")
    expect(
      screen.getByRole("button", { name: "检查构建结果" })
    ).toHaveAttribute("aria-current", "true")
  })
  beforeEach(() => installMatchMedia(false))

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it("renders compact lines without showing message previews at rest", () => {
    render(<ConversationLineSidebar ariaLabel="任务消息导航" items={items} />)

    const navigation = screen.getByRole("navigation", {
      name: "任务消息导航",
    })
    expect(navigation).toBeInTheDocument()
    expect(navigation.style.getPropertyValue("--line-marker-length")).toBe(
      "26px"
    )
    expect(navigation.style.getPropertyValue("--line-item-gap")).toBe("0px")
    expect(screen.getAllByRole("button")).toHaveLength(items.length)
    expect(screen.queryByRole("dialog")).toBeNull()
    expect(screen.getByTestId("conversation-line-turn-1")).toHaveClass(
      "[--line-effect:0]",
      "h-2.5"
    )
    const firstButton = screen.getByRole("button", {
      name: "分析登录失败的原因",
    })
    expect(firstButton).toHaveAttribute("aria-expanded", "false")
    expect(firstButton).toHaveClass("h-2.5")
  })

  it("reveals both user and assistant content on hover", async () => {
    const interaction = userEvent.setup()
    render(<ConversationLineSidebar ariaLabel="任务消息导航" items={items} />)

    const firstItem = screen.getByRole("button", {
      name: "分析登录失败的原因",
    })
    const firstMarker = firstItem.querySelector("span")
    await interaction.hover(firstItem)

    const preview = screen.getByRole("dialog", {
      name: "分析登录失败的原因",
    })
    const userPreview = within(preview).getByText("分析登录失败的原因")
    const assistantPreview = within(preview).getByText(
      "已定位到会话过期，并给出了刷新令牌的处理方案。"
    )
    const previewTime = within(preview).getByText("2026-07-11 08:05")
    expect(preview).toHaveAttribute("data-slot", "hover-card-content")
    expect(preview).toHaveClass(
      "conversation-line-preview",
      "w-80",
      "max-w-[calc(100vw-2rem)]",
      "overflow-hidden",
      "data-closed:animate-none",
      "data-closed:opacity-0",
      "data-closed:duration-0"
    )
    expect(userPreview).toHaveAttribute("data-message-role", "user")
    expect(userPreview).toHaveClass(
      "line-clamp-2",
      "text-[length:var(--app-ui-font-size)]",
      "leading-[var(--app-ui-compact-line-height)]",
      "font-medium"
    )
    expect(userPreview).not.toHaveClass("text-[length:var(--app-font-16)]")
    expect(userPreview).not.toHaveClass("text-[length:var(--app-font-13)]")
    expect(userPreview).not.toHaveClass("truncate")
    expect(assistantPreview).toHaveAttribute("data-message-role", "assistant")
    expect(assistantPreview).toHaveClass(
      "line-clamp-2",
      "text-[length:var(--app-font-13)]",
      "font-medium"
    )
    expect(assistantPreview).not.toHaveClass("text-[length:var(--app-font-12)]")
    expect(previewTime.tagName).toBe("TIME")
    expect(previewTime).toHaveAttribute("datetime", "2026-07-11T08:05:00")
    expect(previewTime).toHaveAttribute("title", "2026-07-11 08:05")
    expect(previewTime).toHaveClass(
      "mt-2",
      "block",
      "text-[length:var(--app-font-12)]",
      "font-medium"
    )
    expect(firstItem).toHaveAttribute("aria-expanded", "true")
    expect(firstItem).toHaveAttribute("aria-controls", preview.id)
    expect(firstMarker).toHaveClass("[transform:scaleX(1)]", "opacity-100")

    await interaction.unhover(firstItem)
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    expect(firstMarker).toHaveClass(
      "[transform:scaleX(calc(var(--line-collapsed-scale)+(1-var(--line-collapsed-scale))*var(--line-effect)))]"
    )
  })

  it("switches line previews without keeping stale cards during pointer movement", () => {
    render(<ConversationLineSidebar ariaLabel="任务消息导航" items={items} />)

    const firstItem = screen.getByRole("button", {
      name: "分析登录失败的原因",
    })
    const secondItem = screen.getByRole("button", { name: "补充单元测试" })

    fireEvent.focus(firstItem)
    expect(screen.getByRole("dialog")).toHaveTextContent("分析登录失败的原因")

    fireEvent.blur(firstItem)
    fireEvent.focus(secondItem)

    const previews = document.body.querySelectorAll(
      '[data-slot="hover-card-content"]'
    )
    expect(previews).toHaveLength(1)
    expect(screen.getByRole("dialog")).toHaveTextContent("补充单元测试")
  })

  it("supports focus previews, arrow-key navigation, and selection", async () => {
    const interaction = userEvent.setup()
    const onItemSelect = vi.fn()
    render(
      <ConversationLineSidebar
        ariaLabel="任务消息导航"
        items={items}
        defaultActiveItemIds={["turn-1"]}
        onItemSelect={onItemSelect}
      />
    )

    const firstItem = screen.getByRole("button", {
      name: "分析登录失败的原因",
    })
    const secondItem = screen.getByRole("button", { name: "补充单元测试" })
    expect(firstItem).toHaveAttribute("aria-current", "true")

    await interaction.tab()
    expect(firstItem).toHaveFocus()
    expect(screen.getByRole("dialog")).toHaveTextContent("已定位到会话过期")

    await interaction.keyboard("{ArrowDown}")
    expect(secondItem).toHaveFocus()
    expect(screen.getByRole("dialog")).toHaveTextContent("相关边界用例已经补齐")

    await interaction.keyboard("{Enter}")
    expect(onItemSelect).toHaveBeenCalledWith(items[1], 1)
    expect(secondItem).toHaveAttribute("aria-current", "true")
  })

  it("closes and suppresses the hover preview while a clicked item jumps to its message", () => {
    installMatchMedia(true)
    vi.useFakeTimers()
    const onItemSelect = vi.fn()
    render(
      <ConversationLineSidebar
        ariaLabel="任务消息导航"
        items={items}
        onItemSelect={onItemSelect}
      />
    )

    const firstItem = screen.getByRole("button", {
      name: "分析登录失败的原因",
    })
    const list = screen.getByTestId("conversation-line-sidebar-list")
    const firstLine = screen.getByTestId("conversation-line-turn-1")
    vi.spyOn(firstLine, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 26,
      bottom: 10,
      width: 26,
      height: 10,
      toJSON: () => ({}),
    })

    fireEvent.focus(firstItem)
    expect(screen.getByRole("dialog")).toHaveTextContent("分析登录失败的原因")

    fireEvent.click(firstItem)

    expect(onItemSelect).toHaveBeenCalledWith(items[0], 0)
    expect(screen.queryByRole("dialog")).toBeNull()
    expect(firstItem).toHaveAttribute("aria-expanded", "false")

    fireEvent.blur(firstItem)
    fireEvent.focus(firstItem)
    expect(screen.queryByRole("dialog")).toBeNull()

    firstLine.style.setProperty("--line-effect", "0.0000")
    fireEvent.pointerMove(list, { clientY: 5, pointerType: "mouse" })
    expect(firstLine.style.getPropertyValue("--line-effect")).toBe("1.0000")
    expect(screen.queryByRole("dialog")).toBeNull()

    act(() => vi.advanceTimersByTime(200))
    fireEvent.pointerMove(firstItem, { clientY: 5, pointerType: "mouse" })
    expect(screen.getByRole("dialog")).toHaveTextContent("分析登录失败的原因")

    fireEvent.blur(firstItem)
    expect(screen.queryByRole("dialog")).toBeNull()
  })

  it("lets touch input pin a preview instead of depending on hover", () => {
    render(<ConversationLineSidebar ariaLabel="任务消息导航" items={items} />)

    const thirdItem = screen.getByRole("button", { name: "检查构建结果" })
    fireEvent.pointerDown(thirdItem, { pointerType: "touch" })
    fireEvent.pointerUp(thirdItem, { pointerType: "touch" })
    fireEvent.click(thirdItem)

    const preview = screen.getByRole("dialog", { name: "检查构建结果" })
    expect(preview).toHaveTextContent("检查构建结果")
    expect(preview.querySelector('[data-message-role="assistant"]')).toBeNull()
  })

  it("updates proximity effects immediately when reduced motion is preferred", () => {
    installMatchMedia(true)
    render(
      <ConversationLineSidebar
        ariaLabel="任务消息导航"
        items={items.slice(0, 2)}
        proximityRadius={80}
      />
    )

    const list = screen.getByTestId("conversation-line-sidebar-list")
    const firstLine = screen.getByTestId("conversation-line-turn-1")
    const secondLine = screen.getByTestId("conversation-line-turn-2")
    vi.spyOn(firstLine, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 26,
      bottom: 10,
      width: 26,
      height: 10,
      toJSON: () => ({}),
    })
    vi.spyOn(secondLine, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 10,
      top: 10,
      left: 0,
      right: 26,
      bottom: 20,
      width: 26,
      height: 10,
      toJSON: () => ({}),
    })

    fireEvent.pointerMove(list, { clientY: 5, pointerType: "mouse" })

    expect(firstLine.style.getPropertyValue("--line-effect")).toBe("1.0000")
    expect(
      Number(secondLine.style.getPropertyValue("--line-effect"))
    ).toBeGreaterThan(0)
    expect(
      Number(secondLine.style.getPropertyValue("--line-effect"))
    ).toBeLessThan(1)

    fireEvent.pointerLeave(list, { pointerType: "mouse" })
    expect(firstLine.style.getPropertyValue("--line-effect")).toBe("0.0000")
    expect(secondLine.style.getPropertyValue("--line-effect")).toBe("0.0000")
  })

  it("forms a monotonic arc around the hovered message", () => {
    installMatchMedia(true)
    const arcItems = Array.from({ length: 9 }, (_, index) => ({
      id: `arc-${index}`,
      userMessage: `消息 ${index}`,
    }))
    render(
      <ConversationLineSidebar ariaLabel="任务消息导航" items={arcItems} />
    )

    const list = screen.getByTestId("conversation-line-sidebar-list")
    const lines = arcItems.map((item, index) => {
      const line = screen.getByTestId(`conversation-line-${item.id}`)
      vi.spyOn(line, "getBoundingClientRect").mockReturnValue({
        x: 0,
        y: index * 10,
        top: index * 10,
        left: 0,
        right: 26,
        bottom: index * 10 + 10,
        width: 26,
        height: 10,
        toJSON: () => ({}),
      })
      return line
    })

    fireEvent.pointerMove(list, { clientY: 45, pointerType: "mouse" })

    const effects = lines.map((line) =>
      Number(line.style.getPropertyValue("--line-effect"))
    )
    expect(effects.slice(0, 5)).toEqual(
      [...effects.slice(0, 5)].sort((left, right) => left - right)
    )
    expect(effects.slice(4)).toEqual(
      [...effects.slice(4)].sort((left, right) => right - left)
    )
    expect(effects[0]).toBeLessThan(effects[1])
    expect(effects[1]).toBeLessThan(effects[2])
    expect(effects[2]).toBeLessThan(effects[3])
    expect(effects[3]).toBeLessThan(effects[4])
    expect(effects[4]).toBe(1)
    expect(effects).toEqual([0, 0.2, 0.4, 0.7, 1, 0.7, 0.4, 0.2, 0])
    expect(effects[3]).toBeCloseTo(effects[5], 4)
    expect(effects[2]).toBeCloseTo(effects[6], 4)
    expect(effects[1]).toBeCloseTo(effects[7], 4)
    expect(effects[0]).toBeCloseTo(effects[8], 4)
  })

  it("reschedules proximity animation after Strict Mode effect cleanup", () => {
    const callbacks = new Map<number, FrameRequestCallback>()
    let nextFrameId = 0
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn((callback: FrameRequestCallback) => {
        const frameId = ++nextFrameId
        callbacks.set(frameId, callback)
        return frameId
      })
    )
    vi.stubGlobal(
      "cancelAnimationFrame",
      vi.fn((frameId: number) => {
        callbacks.delete(frameId)
      })
    )

    render(
      <StrictMode>
        <ConversationLineSidebar
          ariaLabel="任务消息导航"
          items={items.slice(0, 2)}
          proximityRadius={80}
        />
      </StrictMode>
    )

    const list = screen.getByTestId("conversation-line-sidebar-list")
    const firstLine = screen.getByTestId("conversation-line-turn-1")
    const secondLine = screen.getByTestId("conversation-line-turn-2")
    vi.spyOn(firstLine, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 26,
      bottom: 10,
      width: 26,
      height: 10,
      toJSON: () => ({}),
    })
    vi.spyOn(secondLine, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 10,
      top: 10,
      left: 0,
      right: 26,
      bottom: 20,
      width: 26,
      height: 10,
      toJSON: () => ({}),
    })

    fireEvent.pointerMove(list, { clientY: 5, pointerType: "mouse" })
    act(() => {
      let now = performance.now()
      for (let index = 0; index < 60 && callbacks.size; index += 1) {
        now += 16
        const pendingCallbacks = [...callbacks.values()]
        callbacks.clear()
        pendingCallbacks.forEach((callback) => callback(now))
      }
    })

    expect(firstLine.style.getPropertyValue("--line-effect")).toBe("1.0000")
    expect(
      Number(secondLine.style.getPropertyValue("--line-effect"))
    ).toBeGreaterThan(0)
  })
})
