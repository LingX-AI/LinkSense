import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  CONVERSATION_SCROLL_BUTTON_THRESHOLD_PX,
  CONVERSATION_SCROLL_TO_BOTTOM_DURATION_MS,
  CONVERSATION_STREAM_FOLLOW_HALF_LIFE_MS,
  getConversationDistanceFromBottom,
  useConversationScroll,
} from "@/features/conversations/use-conversation-scroll"

const layout = {
  clientHeight: 500,
  scrollHeight: 2_000,
}

let scrollPositions = new WeakMap<Element, number>()
let scrollToMock = vi.fn()
let resizeObservers: ResizeObserverStub[] = []
let animationFrames = new Map<number, FrameRequestCallback>()
let nextAnimationFrameId = 1
let requestAnimationFrameMock = vi.fn()
let cancelAnimationFrameMock = vi.fn()

let originalScrollTop: PropertyDescriptor | undefined
let originalScrollHeight: PropertyDescriptor | undefined
let originalClientHeight: PropertyDescriptor | undefined
let originalScrollTo: PropertyDescriptor | undefined
let originalResizeObserver: typeof ResizeObserver
let originalRequestAnimationFrame: PropertyDescriptor | undefined
let originalCancelAnimationFrame: PropertyDescriptor | undefined
let originalMatchMedia: PropertyDescriptor | undefined

class ResizeObserverStub implements ResizeObserver {
  readonly observedElements = new Set<Element>()
  private readonly callback: ResizeObserverCallback

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback
    resizeObservers.push(this)
  }

  observe(target: Element) {
    this.observedElements.add(target)
  }

  unobserve(target: Element) {
    this.observedElements.delete(target)
  }

  disconnect() {
    this.observedElements.clear()
  }

  trigger() {
    this.callback([], this)
  }
}

function isScrollContainer(element: Element) {
  return (
    element instanceof HTMLElement && element.dataset.scrollContainer === "true"
  )
}

function restoreProperty(
  target: object,
  property: PropertyKey,
  descriptor: PropertyDescriptor | undefined
) {
  if (descriptor) {
    Object.defineProperty(target, property, descriptor)
  } else {
    Reflect.deleteProperty(target, property)
  }
}

function ScrollHarness({
  conversationId,
  preservePositionOnConversationChange = false,
}: {
  conversationId: string
  preservePositionOnConversationChange?: boolean
}) {
  const {
    scrollContainerRef,
    contentRef,
    showScrollToBottom,
    scrollToBottom,
    scrollToElement,
    pauseAutoFollow,
    preserveScrollPositionForInteraction,
  } = useConversationScroll(conversationId, {
    preservePositionOnConversationChange,
  })

  return (
    <>
      <div
        ref={scrollContainerRef}
        data-scroll-container="true"
        data-testid="scroll-container"
        tabIndex={0}
      >
        <div ref={contentRef} data-testid="scroll-content">
          <div id="target-message" data-testid="target-message" />
        </div>
        {showScrollToBottom && (
          <button type="button" onClick={() => scrollToBottom("smooth")}>
            回到底部
          </button>
        )}
      </div>
      <button type="button" onClick={pauseAutoFollow}>
        暂停自动跟随
      </button>
      <button
        type="button"
        onPointerDown={preserveScrollPositionForInteraction}
      >
        原地交互
      </button>
      <button type="button" onClick={() => scrollToBottom("auto")}>
        减少动态效果时回到底部
      </button>
      <button
        type="button"
        onClick={() => {
          const target = document.getElementById("target-message")
          if (target) scrollToElement(target, "smooth")
        }}
      >
        跳到消息
      </button>
    </>
  )
}

function setScrollTop(element: HTMLElement, value: number) {
  element.scrollTop = value
  fireEvent.scroll(element)
}

function triggerContentResize() {
  const content = screen.getByTestId("scroll-content")
  const observer = resizeObservers.find((candidate) =>
    candidate.observedElements.has(content)
  )
  expect(observer).toBeDefined()
  act(() => observer?.trigger())
  runAnimationFrame(16)
}

function runAnimationFrame(timestamp: number) {
  const callbacks = [...animationFrames.values()]
  animationFrames.clear()
  act(() => callbacks.forEach((callback) => callback(timestamp)))
}

function settleStreamingFollow(startTimestamp = 32) {
  let timestamp = startTimestamp
  for (let frame = 0; frame < 30 && animationFrames.size > 0; frame += 1) {
    runAnimationFrame(timestamp)
    timestamp += 16
  }
  expect(animationFrames.size).toBe(0)
}

describe("conversation scroll behavior", () => {
  beforeEach(() => {
    scrollPositions = new WeakMap<Element, number>()
    resizeObservers = []
    animationFrames = new Map<number, FrameRequestCallback>()
    nextAnimationFrameId = 1
    layout.clientHeight = 500
    layout.scrollHeight = 2_000

    originalScrollTop = Object.getOwnPropertyDescriptor(
      Element.prototype,
      "scrollTop"
    )
    originalScrollHeight = Object.getOwnPropertyDescriptor(
      Element.prototype,
      "scrollHeight"
    )
    originalClientHeight = Object.getOwnPropertyDescriptor(
      Element.prototype,
      "clientHeight"
    )
    originalScrollTo = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "scrollTo"
    )
    originalResizeObserver = window.ResizeObserver
    originalRequestAnimationFrame = Object.getOwnPropertyDescriptor(
      window,
      "requestAnimationFrame"
    )
    originalCancelAnimationFrame = Object.getOwnPropertyDescriptor(
      window,
      "cancelAnimationFrame"
    )
    originalMatchMedia = Object.getOwnPropertyDescriptor(window, "matchMedia")

    Object.defineProperty(Element.prototype, "scrollTop", {
      configurable: true,
      get: function (this: Element) {
        if (isScrollContainer(this)) return scrollPositions.get(this) ?? 0
        return originalScrollTop?.get?.call(this) ?? 0
      },
      set: function (this: Element, value: number) {
        if (isScrollContainer(this)) {
          scrollPositions.set(this, Number(value))
          return
        }
        originalScrollTop?.set?.call(this, value)
      },
    })
    Object.defineProperty(Element.prototype, "scrollHeight", {
      configurable: true,
      get: function (this: Element) {
        if (isScrollContainer(this)) return layout.scrollHeight
        return originalScrollHeight?.get?.call(this) ?? 0
      },
    })
    Object.defineProperty(Element.prototype, "clientHeight", {
      configurable: true,
      get: function (this: Element) {
        if (isScrollContainer(this)) return layout.clientHeight
        return originalClientHeight?.get?.call(this) ?? 0
      },
    })

    scrollToMock = vi.fn(function (
      this: HTMLElement,
      optionsOrX?: ScrollToOptions | number,
      y?: number
    ) {
      const requestedTop =
        typeof optionsOrX === "number"
          ? (y ?? this.scrollTop)
          : (optionsOrX?.top ?? this.scrollTop)
      this.scrollTop = Math.min(
        Math.max(requestedTop, 0),
        Math.max(0, this.scrollHeight - this.clientHeight)
      )
    })
    Object.defineProperty(HTMLElement.prototype, "scrollTo", {
      configurable: true,
      writable: true,
      value: scrollToMock,
    })
    requestAnimationFrameMock = vi.fn((callback: FrameRequestCallback) => {
      const frameId = nextAnimationFrameId
      nextAnimationFrameId += 1
      animationFrames.set(frameId, callback)
      return frameId
    })
    cancelAnimationFrameMock = vi.fn((frameId: number) => {
      animationFrames.delete(frameId)
    })
    Object.defineProperty(window, "requestAnimationFrame", {
      configurable: true,
      writable: true,
      value: requestAnimationFrameMock,
    })
    Object.defineProperty(window, "cancelAnimationFrame", {
      configurable: true,
      writable: true,
      value: cancelAnimationFrameMock,
    })
    window.ResizeObserver = ResizeObserverStub
  })

  afterEach(() => {
    cleanup()
    restoreProperty(Element.prototype, "scrollTop", originalScrollTop)
    restoreProperty(Element.prototype, "scrollHeight", originalScrollHeight)
    restoreProperty(Element.prototype, "clientHeight", originalClientHeight)
    restoreProperty(HTMLElement.prototype, "scrollTo", originalScrollTo)
    restoreProperty(
      window,
      "requestAnimationFrame",
      originalRequestAnimationFrame
    )
    restoreProperty(
      window,
      "cancelAnimationFrame",
      originalCancelAnimationFrame
    )
    restoreProperty(window, "matchMedia", originalMatchMedia)
    window.ResizeObserver = originalResizeObserver
  })

  it("calculates a non-negative distance from the bottom and exposes the 500px threshold", () => {
    expect(CONVERSATION_SCROLL_BUTTON_THRESHOLD_PX).toBe(500)
    expect(
      getConversationDistanceFromBottom({
        clientHeight: 500,
        scrollHeight: 2_000,
        scrollTop: 999,
      })
    ).toBe(501)
    expect(
      getConversationDistanceFromBottom({
        clientHeight: 500,
        scrollHeight: 2_000,
        scrollTop: 1_600,
      })
    ).toBe(0)
  })

  it("immediately scrolls to the bottom on first mount and after switching conversations", () => {
    const view = render(<ScrollHarness conversationId="conversation-1" />)
    const container = screen.getByTestId("scroll-container")

    expect(container.scrollTop).toBe(1_500)
    expect(scrollToMock).toHaveBeenLastCalledWith({
      top: 2_000,
      behavior: "auto",
    })

    fireEvent.click(screen.getByRole("button", { name: "暂停自动跟随" }))
    act(() => setScrollTop(container, 700))
    scrollToMock.mockClear()

    view.rerender(<ScrollHarness conversationId="conversation-2" />)

    expect(container.scrollTop).toBe(1_500)
    expect(scrollToMock).toHaveBeenCalledWith({
      top: 2_000,
      behavior: "auto",
    })
  })

  it("preserves position for a new-task promotion and resets on the next task switch", () => {
    const view = render(<ScrollHarness conversationId="new" />)
    const container = screen.getByTestId("scroll-container")

    fireEvent.click(screen.getByRole("button", { name: "暂停自动跟随" }))
    act(() => setScrollTop(container, 700))
    scrollToMock.mockClear()

    view.rerender(
      <ScrollHarness
        conversationId="conversation-1"
        preservePositionOnConversationChange
      />
    )

    expect(container.scrollTop).toBe(700)
    expect(scrollToMock).not.toHaveBeenCalled()

    view.rerender(<ScrollHarness conversationId="conversation-2" />)

    expect(container.scrollTop).toBe(1_500)
    expect(scrollToMock).toHaveBeenCalledWith({
      top: 2_000,
      behavior: "auto",
    })
  })

  it("shows the button only when the distance from the bottom exceeds 500px", () => {
    render(<ScrollHarness conversationId="conversation-1" />)
    const container = screen.getByTestId("scroll-container")

    act(() => setScrollTop(container, 1_000))
    expect(screen.queryByRole("button", { name: "回到底部" })).toBeNull()

    act(() => setScrollTop(container, 999))
    expect(screen.getByRole("button", { name: "回到底部" })).toBeVisible()
  })

  it("smoothly follows content growth while auto-follow remains enabled", () => {
    render(<ScrollHarness conversationId="conversation-1" />)
    const container = screen.getByTestId("scroll-container")
    scrollToMock.mockClear()

    layout.scrollHeight = 2_300
    triggerContentResize()

    expect(CONVERSATION_STREAM_FOLLOW_HALF_LIFE_MS).toBe(28)
    expect(container.scrollTop).toBeGreaterThan(1_500)
    expect(container.scrollTop).toBeLessThan(1_800)
    expect(scrollToMock).not.toHaveBeenCalled()
    expect(screen.queryByRole("button", { name: "回到底部" })).toBeNull()

    settleStreamingFollow()

    expect(container.scrollTop).toBe(1_800)
    expect(scrollToMock).not.toHaveBeenCalled()
    expect(screen.queryByRole("button", { name: "回到底部" })).toBeNull()
  })

  it("keeps the current position when a focused form control tries to scroll its container", () => {
    render(<ScrollHarness conversationId="conversation-1" />)
    const container = screen.getByTestId("scroll-container")

    fireEvent.pointerDown(screen.getByRole("button", { name: "原地交互" }))
    container.scrollTop = 0

    runAnimationFrame(16)

    expect(container.scrollTop).toBe(1_500)

    scrollToMock.mockClear()
    layout.scrollHeight = 2_300
    triggerContentResize()

    expect(container.scrollTop).toBe(1_500)
    expect(scrollToMock).not.toHaveBeenCalled()
  })

  it("coalesces repeated content resizes into one smooth follow loop", () => {
    render(<ScrollHarness conversationId="conversation-1" />)
    const container = screen.getByTestId("scroll-container")
    const content = screen.getByTestId("scroll-content")
    const observer = resizeObservers.find((candidate) =>
      candidate.observedElements.has(content)
    )
    expect(observer).toBeDefined()
    scrollToMock.mockClear()

    layout.scrollHeight = 2_300
    act(() => {
      observer?.trigger()
      observer?.trigger()
      observer?.trigger()
    })

    expect(scrollToMock).not.toHaveBeenCalled()
    expect(requestAnimationFrameMock).toHaveBeenCalledTimes(1)

    runAnimationFrame(16)

    expect(container.scrollTop).toBeGreaterThan(1_500)
    expect(container.scrollTop).toBeLessThan(1_800)
    expect(scrollToMock).not.toHaveBeenCalled()

    settleStreamingFollow()

    expect(container.scrollTop).toBe(1_800)
    expect(scrollToMock).not.toHaveBeenCalled()
  })

  it("chases a newer bottom target without restarting the active follow loop", () => {
    render(<ScrollHarness conversationId="conversation-1" />)
    const container = screen.getByTestId("scroll-container")
    const content = screen.getByTestId("scroll-content")
    const observer = resizeObservers.find((candidate) =>
      candidate.observedElements.has(content)
    )
    expect(observer).toBeDefined()

    layout.scrollHeight = 2_300
    act(() => observer?.trigger())
    runAnimationFrame(16)
    const firstStep = container.scrollTop

    requestAnimationFrameMock.mockClear()
    layout.scrollHeight = 2_500
    act(() => {
      observer?.trigger()
      observer?.trigger()
    })

    expect(requestAnimationFrameMock).not.toHaveBeenCalled()
    runAnimationFrame(32)
    expect(container.scrollTop).toBeGreaterThan(firstStep)
    expect(container.scrollTop).toBeLessThan(2_000)

    settleStreamingFollow(48)
    expect(container.scrollTop).toBe(2_000)
  })

  it("cancels a queued streaming follow as soon as the user scrolls upward", () => {
    render(<ScrollHarness conversationId="conversation-1" />)
    const container = screen.getByTestId("scroll-container")
    const content = screen.getByTestId("scroll-content")
    const observer = resizeObservers.find((candidate) =>
      candidate.observedElements.has(content)
    )
    expect(observer).toBeDefined()

    layout.scrollHeight = 2_300
    act(() => observer?.trigger())
    expect(animationFrames.size).toBe(1)

    fireEvent.wheel(container, { deltaY: -1 })

    expect(animationFrames.size).toBe(0)
    expect(container.scrollTop).toBe(1_500)
  })

  it("cancels a queued resize correction when the conversation unmounts", () => {
    const view = render(<ScrollHarness conversationId="conversation-1" />)
    const content = screen.getByTestId("scroll-content")
    const observer = resizeObservers.find((candidate) =>
      candidate.observedElements.has(content)
    )
    expect(observer).toBeDefined()
    scrollToMock.mockClear()

    act(() => observer?.trigger())
    expect(animationFrames.size).toBe(1)

    view.unmount()

    expect(cancelAnimationFrameMock).toHaveBeenCalledTimes(1)
    expect(animationFrames.size).toBe(0)
    expect(scrollToMock).not.toHaveBeenCalled()
  })

  it("pauses follow after a 200px user scroll without showing the button", () => {
    render(<ScrollHarness conversationId="conversation-1" />)
    const container = screen.getByTestId("scroll-container")

    fireEvent.wheel(container, { deltaY: -200 })
    act(() => setScrollTop(container, 1_300))
    expect(screen.queryByRole("button", { name: "回到底部" })).toBeNull()
    scrollToMock.mockClear()

    layout.scrollHeight = 2_200
    triggerContentResize()

    expect(container.scrollTop).toBe(1_300)
    expect(scrollToMock).not.toHaveBeenCalled()
    expect(screen.queryByRole("button", { name: "回到底部" })).toBeNull()
  })

  it.each([0.5, 1, 12, 24])(
    "keeps follow paused after the user scrolls up only %spx",
    (distance) => {
      render(<ScrollHarness conversationId="conversation-1" />)
      const container = screen.getByTestId("scroll-container")
      fireEvent.wheel(container, { deltaY: -distance })
      act(() => setScrollTop(container, 1_500 - distance))

      for (const height of [2_050, 2_100, 2_300]) {
        layout.scrollHeight = height
        triggerContentResize()
        settleStreamingFollow()
        expect(container.scrollTop).toBe(1_500 - distance)
      }
    }
  )

  it("does not resume from a delayed scroll event after an upward wheel gesture", () => {
    render(<ScrollHarness conversationId="conversation-1" />)
    const container = screen.getByTestId("scroll-container")
    fireEvent.wheel(container, { deltaY: -10 })
    fireEvent.scroll(container)
    layout.scrollHeight = 2_300
    triggerContentResize()
    settleStreamingFollow()
    expect(container.scrollTop).toBe(1_500)
  })

  it("does not resume when layout changes place the paused viewport at the bottom", () => {
    render(<ScrollHarness conversationId="conversation-1" />)
    const container = screen.getByTestId("scroll-container")
    fireEvent.wheel(container, { deltaY: -200 })
    act(() => setScrollTop(container, 1_300))
    layout.scrollHeight = 1_800
    fireEvent.scroll(container)
    triggerContentResize()

    layout.scrollHeight = 2_300
    triggerContentResize()
    settleStreamingFollow()
    expect(container.scrollTop).toBe(1_300)
  })

  it("keeps follow paused when scrolling downward stops short of the bottom", () => {
    render(<ScrollHarness conversationId="conversation-1" />)
    const container = screen.getByTestId("scroll-container")
    fireEvent.wheel(container, { deltaY: -200 })
    act(() => setScrollTop(container, 1_300))
    fireEvent.wheel(container, { deltaY: 190 })
    act(() => setScrollTop(container, 1_490))
    layout.scrollHeight = 2_300
    triggerContentResize()
    settleStreamingFollow()
    expect(container.scrollTop).toBe(1_490)
  })

  it("keeps the user's position and the button visible after scrolling up more than 500px", () => {
    render(<ScrollHarness conversationId="conversation-1" />)
    const container = screen.getByTestId("scroll-container")

    fireEvent.wheel(container, { deltaY: -601 })
    act(() => setScrollTop(container, 899))
    expect(screen.getByRole("button", { name: "回到底部" })).toBeVisible()
    scrollToMock.mockClear()

    layout.scrollHeight = 2_300
    triggerContentResize()

    expect(container.scrollTop).toBe(899)
    expect(scrollToMock).not.toHaveBeenCalled()
    expect(screen.getByRole("button", { name: "回到底部" })).toBeVisible()
  })

  it("resumes follow after the user manually returns to the bottom", () => {
    render(<ScrollHarness conversationId="conversation-1" />)
    const container = screen.getByTestId("scroll-container")

    fireEvent.wheel(container, { deltaY: -200 })
    act(() => setScrollTop(container, 1_300))
    fireEvent.wheel(container, { deltaY: 200 })
    act(() => setScrollTop(container, 1_500))
    scrollToMock.mockClear()

    layout.scrollHeight = 2_200
    triggerContentResize()

    expect(container.scrollTop).toBeGreaterThan(1_500)
    expect(container.scrollTop).toBeLessThan(1_700)
    settleStreamingFollow()

    expect(container.scrollTop).toBe(1_700)
    expect(scrollToMock).not.toHaveBeenCalled()
  })

  it("pauses and resumes when the user navigates with the keyboard", () => {
    render(<ScrollHarness conversationId="conversation-1" />)
    const container = screen.getByTestId("scroll-container")
    fireEvent.keyDown(container, { key: "ArrowUp" })
    act(() => setScrollTop(container, 1_490))
    layout.scrollHeight = 2_200
    triggerContentResize()
    settleStreamingFollow()
    expect(container.scrollTop).toBe(1_490)

    fireEvent.keyDown(container, { key: "End" })
    act(() => setScrollTop(container, 1_700))
    layout.scrollHeight = 2_300
    triggerContentResize()
    settleStreamingFollow()
    expect(container.scrollTop).toBe(1_800)
  })

  it("pauses while dragging the scrollbar and resumes after dragging it to the bottom", () => {
    render(<ScrollHarness conversationId="conversation-1" />)
    const container = screen.getByTestId("scroll-container")
    fireEvent.pointerDown(container, { isPrimary: true })
    act(() => setScrollTop(container, 1_490))
    fireEvent.pointerUp(window)
    layout.scrollHeight = 2_200
    triggerContentResize()
    settleStreamingFollow()
    expect(container.scrollTop).toBe(1_490)

    fireEvent.pointerDown(container, { isPrimary: true })
    act(() => setScrollTop(container, 1_700))
    fireEvent.pointerUp(window)
    layout.scrollHeight = 2_300
    triggerContentResize()
    settleStreamingFollow()
    expect(container.scrollTop).toBe(1_800)
  })

  it("keeps touch scrolling paused and resumes when downward momentum reaches the bottom", () => {
    render(<ScrollHarness conversationId="conversation-1" />)
    const container = screen.getByTestId("scroll-container")
    const dispatchTouch = (type: string, clientY: number) => {
      // JSDOM does not provide the Touch constructor or TouchList interface.
      const event = new Event(type, { bubbles: true })
      Object.defineProperty(event, "touches", {
        value: { item: () => ({ clientY }) },
      })
      fireEvent(container, event)
    }
    dispatchTouch("touchstart", 100)
    dispatchTouch("touchmove", 110)
    act(() => setScrollTop(container, 1_490))
    fireEvent.touchEnd(container)
    layout.scrollHeight = 2_200
    triggerContentResize()
    settleStreamingFollow()
    expect(container.scrollTop).toBe(1_490)

    dispatchTouch("touchstart", 200)
    dispatchTouch("touchmove", 100)
    act(() => setScrollTop(container, 1_600))
    fireEvent.touchEnd(container)
    act(() => setScrollTop(container, 1_700))
    layout.scrollHeight = 2_300
    triggerContentResize()
    settleStreamingFollow()
    expect(container.scrollTop).toBe(1_800)
  })

  it("does not reuse a completed gesture to resume after a later position adjustment", () => {
    render(<ScrollHarness conversationId="conversation-1" />)
    const container = screen.getByTestId("scroll-container")
    fireEvent.wheel(container, { deltaY: -200 })
    act(() => setScrollTop(container, 1_300))
    fireEvent.wheel(container, { deltaY: 100 })
    act(() => setScrollTop(container, 1_400))
    fireEvent(container, new Event("scrollend"))
    act(() => setScrollTop(container, 1_500))
    layout.scrollHeight = 2_300
    triggerContentResize()
    settleStreamingFollow()
    expect(container.scrollTop).toBe(1_500)
  })

  it("continues following new output after the user clicks back to the bottom", () => {
    render(<ScrollHarness conversationId="conversation-1" />)
    const container = screen.getByTestId("scroll-container")
    fireEvent.wheel(container, { deltaY: -700 })
    act(() => setScrollTop(container, 800))
    fireEvent.click(screen.getByRole("button", { name: "回到底部" }))
    runAnimationFrame(0)
    runAnimationFrame(CONVERSATION_SCROLL_TO_BOTTOM_DURATION_MS)
    expect(container.scrollTop).toBe(1_500)
    layout.scrollHeight = 2_300
    triggerContentResize()
    settleStreamingFollow()
    expect(container.scrollTop).toBe(1_800)
  })

  it("keeps streaming follow immediate when reduced motion is requested", () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn().mockReturnValue({
        matches: true,
        media: "(prefers-reduced-motion: reduce)",
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      } satisfies MediaQueryList),
    })
    render(<ScrollHarness conversationId="conversation-1" />)
    const container = screen.getByTestId("scroll-container")
    scrollToMock.mockClear()

    layout.scrollHeight = 2_300
    triggerContentResize()

    expect(container.scrollTop).toBe(1_800)
    expect(scrollToMock).toHaveBeenCalledWith({
      top: 2_300,
      behavior: "auto",
    })
    expect(animationFrames.size).toBe(0)
  })

  it("finishes the button scroll in 180ms and keeps reduced motion immediate", () => {
    render(<ScrollHarness conversationId="conversation-1" />)
    const container = screen.getByTestId("scroll-container")

    expect(CONVERSATION_SCROLL_TO_BOTTOM_DURATION_MS).toBe(180)

    fireEvent.click(screen.getByRole("button", { name: "暂停自动跟随" }))
    act(() => setScrollTop(container, 899))
    scrollToMock.mockClear()

    fireEvent.click(screen.getByRole("button", { name: "回到底部" }))
    expect(scrollToMock).not.toHaveBeenCalled()
    expect(requestAnimationFrameMock).toHaveBeenCalledTimes(1)
    expect(container.scrollTop).toBe(899)

    runAnimationFrame(0)
    expect(container.scrollTop).toBe(899)

    runAnimationFrame(90)
    expect(container.scrollTop).toBeGreaterThan(899)
    expect(container.scrollTop).toBeLessThan(1_500)

    runAnimationFrame(180)
    expect(container.scrollTop).toBe(1_500)
    expect(animationFrames.size).toBe(0)

    fireEvent.click(screen.getByRole("button", { name: "暂停自动跟随" }))
    act(() => setScrollTop(container, 899))
    scrollToMock.mockClear()
    fireEvent.click(
      screen.getByRole("button", { name: "减少动态效果时回到底部" })
    )

    expect(scrollToMock).toHaveBeenLastCalledWith({
      top: 2_000,
      behavior: "auto",
    })
    expect(screen.queryByRole("button", { name: "回到底部" })).toBeNull()
  })

  it("keeps a button-initiated scroll attached to a growing live bottom", () => {
    render(<ScrollHarness conversationId="conversation-1" />)
    const container = screen.getByTestId("scroll-container")
    const content = screen.getByTestId("scroll-content")
    const observer = resizeObservers.find((candidate) =>
      candidate.observedElements.has(content)
    )
    expect(observer).toBeDefined()

    fireEvent.click(screen.getByRole("button", { name: "暂停自动跟随" }))
    act(() => setScrollTop(container, 899))
    fireEvent.click(screen.getByRole("button", { name: "回到底部" }))
    runAnimationFrame(0)

    layout.scrollHeight = 2_200
    act(() => observer?.trigger())
    runAnimationFrame(90)

    expect(container.scrollTop).toBeGreaterThan(899)
    expect(container.scrollTop).toBeLessThan(1_700)

    runAnimationFrame(CONVERSATION_SCROLL_TO_BOTTOM_DURATION_MS)
    expect(container.scrollTop).toBe(1_700)
    expect(animationFrames.size).toBe(0)
  })

  it("scrolls to a selected message with the same 180ms animation", () => {
    render(<ScrollHarness conversationId="conversation-1" />)
    const container = screen.getByTestId("scroll-container")
    const target = screen.getByTestId("target-message")
    vi.spyOn(container, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 600,
      bottom: 500,
      width: 600,
      height: 500,
      toJSON: () => ({}),
    })
    vi.spyOn(target, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 900,
      top: 900,
      left: 0,
      right: 600,
      bottom: 1_000,
      width: 600,
      height: 100,
      toJSON: () => ({}),
    })

    act(() => setScrollTop(container, 100))
    requestAnimationFrameMock.mockClear()

    fireEvent.click(screen.getByRole("button", { name: "跳到消息" }))
    expect(requestAnimationFrameMock).toHaveBeenCalledTimes(1)
    expect(container.scrollTop).toBe(100)

    runAnimationFrame(0)
    expect(container.scrollTop).toBe(100)

    runAnimationFrame(CONVERSATION_SCROLL_TO_BOTTOM_DURATION_MS / 2)
    expect(container.scrollTop).toBeGreaterThan(100)
    expect(container.scrollTop).toBeLessThan(800)

    runAnimationFrame(CONVERSATION_SCROLL_TO_BOTTOM_DURATION_MS)
    expect(container.scrollTop).toBe(800)
    expect(animationFrames.size).toBe(0)
  })

  it("cancels the button animation when the user scrolls upward", () => {
    render(<ScrollHarness conversationId="conversation-1" />)
    const container = screen.getByTestId("scroll-container")

    fireEvent.click(screen.getByRole("button", { name: "暂停自动跟随" }))
    act(() => setScrollTop(container, 899))
    fireEvent.click(screen.getByRole("button", { name: "回到底部" }))

    runAnimationFrame(0)
    runAnimationFrame(30)
    const interruptedScrollTop = container.scrollTop

    fireEvent.wheel(container, { deltaY: -20 })
    expect(cancelAnimationFrameMock).toHaveBeenCalledTimes(1)
    expect(animationFrames.size).toBe(0)

    runAnimationFrame(180)
    expect(container.scrollTop).toBe(interruptedScrollTop)
  })
})
