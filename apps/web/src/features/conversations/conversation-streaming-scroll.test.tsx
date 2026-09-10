import { useRef } from "react"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  ConversationMessageList,
  type ConversationThreadNavigation,
} from "@/features/conversations/conversation-message-list"
import { useConversationScroll } from "@/features/conversations/use-conversation-scroll"

type StreamingListOptions = {
  count: number
  withHistory: boolean
  appendUser?: boolean
}

let replyHeight = 1_000
let nextTurnHeight = 100
let timestamp = 0
let nextFrameId = 0
let frames = new Map<number, FrameRequestCallback>()
let observers: ResizeObserverStub[] = []
let originalResizeObserver: typeof ResizeObserver
let originalScrollTo: PropertyDescriptor | undefined

class ResizeObserverStub implements ResizeObserver {
  readonly elements = new Set<Element>()
  private readonly callback: ResizeObserverCallback

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback
    observers.push(this)
  }

  observe(target: Element) {
    this.elements.add(target)
  }

  unobserve(target: Element) {
    this.elements.delete(target)
  }

  disconnect() {
    this.elements.clear()
  }

  notify(target: Element) {
    const contentRect = target.getBoundingClientRect()
    this.callback(
      [
        {
          target,
          borderBoxSize: [{ blockSize: contentRect.height, inlineSize: 900 }],
          contentBoxSize: [],
          devicePixelContentBoxSize: [],
          contentRect,
        },
      ],
      this
    )
  }
}

function StreamingList({
  count,
  withHistory,
  appendUser,
}: StreamingListOptions) {
  const navigationRef = useRef<ConversationThreadNavigation>(null)
  const { scrollContainerRef, contentRef, scrollToBottom } =
    useConversationScroll("streaming-task", { navigationRef })
  return (
    <>
      <div
        className="conversation-scroll"
        ref={scrollContainerRef}
        data-testid="scroller"
      >
        <div ref={contentRef} data-testid="content">
          <ConversationMessageList
            rows={[
              ...Array.from({ length: count }, (_, index) => ({
                key: index === count - 1 ? "reply" : `message-${index}`,
                messageIds: [`message-${index}`],
                render: () => (
                  <p>{index === count - 1 ? "Reply" : `Message ${index}`}</p>
                ),
              })),
              ...(appendUser
                ? [
                    {
                      key: "next-user",
                      messageIds: ["next-user"],
                      render: () => <p>Next user message</p>,
                    },
                  ]
                : []),
            ]}
            navigationRef={navigationRef}
            history={
              withHistory
                ? { failedTurnIds: new Set(), loadTurn: async () => {} }
                : undefined
            }
          />
        </div>
      </div>
      <button onClick={() => scrollToBottom("auto")}>Latest</button>
    </>
  )
}

async function advanceFrame(): Promise<void> {
  await act(async () => {
    timestamp += 16
    const scroller = screen.queryByTestId("scroller")
    const previousTop = scroller?.scrollTop
    const callbacks = [...frames.values()]
    frames.clear()
    for (const callback of callbacks) callback(timestamp)
    // JSDOM does not dispatch browser scroll events for scrollTop assignments.
    if (scroller && scroller.scrollTop !== previousTop)
      fireEvent.scroll(scroller)
  })
}

async function settleFrames(): Promise<void> {
  for (let index = 0; index < 60 && frames.size > 0; index++)
    await advanceFrame()
  expect(frames.size).toBe(0)
}

async function resizeReply(
  delta = 300,
  rowKey: "reply" | "next-user" = "reply"
): Promise<void> {
  if (rowKey === "reply") replyHeight += delta
  else nextTurnHeight += delta
  const reply = document.querySelector(`[data-conversation-row="${rowKey}"]`)
  if (!reply) throw new Error("Missing streaming reply")
  // Deliver the row measurement before its parent content resize, like the
  // virtualizer updating the list height after measuring a streamed reply.
  for (const target of [reply, screen.getByTestId("content")]) {
    await act(async () => {
      for (const observer of observers) {
        if (observer.elements.has(target)) observer.notify(target)
      }
    })
  }
}

async function renderStreamingList(
  options: StreamingListOptions
): Promise<HTMLElement> {
  render(<StreamingList {...options} />)
  await settleFrames()
  expect(Boolean(screen.queryByTestId("conversation-virtual-list"))).toBe(
    options.withHistory || options.count > 30
  )
  const scroller = screen.getByTestId("scroller")
  expect(scroller.scrollTop).toBe(scroller.scrollHeight - scroller.clientHeight)
  return scroller
}

beforeEach(() => {
  replyHeight = 1_000
  nextTurnHeight = 100
  timestamp = 0
  nextFrameId = 0
  frames = new Map()
  observers = []
  originalResizeObserver = window.ResizeObserver
  originalScrollTo = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "scrollTo"
  )
  window.ResizeObserver = ResizeObserverStub
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
  vi.spyOn(performance, "now").mockImplementation(() => timestamp)
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    frames.set(++nextFrameId, callback)
    return nextFrameId
  })
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
    frames.delete(id)
  })
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(
    function (this: HTMLElement) {
      return this.dataset.conversationRow === "reply"
        ? replyHeight
        : this.dataset.conversationRow === "next-user"
          ? nextTurnHeight
          : this.hasAttribute("data-conversation-row")
            ? 100
            : 600
    }
  )
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(900)
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(600)
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(
    function (this: HTMLElement) {
      const list = this.querySelector<HTMLElement>(
        '[data-testid="conversation-virtual-list"] > div'
      )
      const height = list
        ? Number.parseFloat(list.style.height || "0")
        : [
            ...this.querySelectorAll<HTMLElement>("[data-conversation-row]"),
          ].reduce((total, row) => total + row.offsetHeight, 0)
      // Include room occupied by the composer below the virtual list.
      return Math.max(600, height + 200)
    }
  )
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      const scroller = this.parentElement?.closest<HTMLElement>(
        ".conversation-scroll"
      )
      return DOMRect.fromRect({
        y:
          Number.parseFloat(this.style.top || "0") - (scroller?.scrollTop ?? 0),
        height: this.offsetHeight,
        width: 900,
      })
    }
  )
  Object.defineProperty(HTMLElement.prototype, "scrollTo", {
    configurable: true,
    value: function (this: HTMLElement, options: ScrollToOptions) {
      this.scrollTop = Math.max(
        0,
        Math.min(
          options.top ?? this.scrollTop,
          this.scrollHeight - this.clientHeight
        )
      )
      queueMicrotask(() => this.dispatchEvent(new Event("scroll")))
    },
  })
})

afterEach(() => {
  cleanup()
  window.ResizeObserver = originalResizeObserver
  vi.restoreAllMocks()
  vi.useRealTimers()
  if (originalScrollTo)
    Object.defineProperty(HTMLElement.prototype, "scrollTo", originalScrollTo)
  else Reflect.deleteProperty(HTMLElement.prototype, "scrollTo")
})

describe("streaming conversation scroll", () => {
  it("does not scroll backward after submitting a message in an overflowing task", async () => {
    const view = render(<StreamingList count={2} withHistory />)
    await settleFrames()
    const scroller = screen.getByTestId("scroller")
    const before = scroller.scrollTop
    // The page requests bottom navigation before committing its optimistic message.
    fireEvent.click(screen.getByRole("button", { name: "Latest" }))
    view.rerender(<StreamingList count={2} withHistory appendUser />)
    expect(screen.getByText("Next user message")).toBeInTheDocument()
    expect(scroller.scrollTop).toBe(
      scroller.scrollHeight - scroller.clientHeight
    )
    // Browsers run queued animation frames before delivering content resize.
    await advanceFrame()
    expect(scroller.scrollTop).toBeGreaterThanOrEqual(before)
    await settleFrames()
    expect(scroller.scrollTop).toBe(
      scroller.scrollHeight - scroller.clientHeight
    )
    const submittedTop = scroller.scrollTop
    await resizeReply(120, "next-user")
    expect(scroller.scrollTop).toBe(submittedTop)
    await advanceFrame()
    expect(scroller.scrollTop).toBeGreaterThan(submittedTop)
    expect(scroller.scrollTop).toBeLessThan(
      scroller.scrollHeight - scroller.clientHeight
    )
    await settleFrames()
    expect(scroller.scrollTop).toBe(
      scroller.scrollHeight - scroller.clientHeight
    )
  })

  it("does not retarget a submission after the user interrupts bottom navigation", async () => {
    const view = render(<StreamingList count={2} withHistory />)
    await settleFrames()
    const scroller = screen.getByTestId("scroller")
    fireEvent.click(screen.getByRole("button", { name: "Latest" }))
    fireEvent.wheel(scroller, { deltaY: -10 })
    scroller.scrollTop -= 10
    fireEvent.scroll(scroller)
    const readingTop = scroller.scrollTop
    view.rerender(<StreamingList count={2} withHistory appendUser />)
    await resizeReply(120, "next-user")
    for (let frame = 0; frame < 20; frame++) {
      await advanceFrame()
      expect(scroller.scrollTop).toBe(readingTop)
    }
  })

  it.each([
    { count: 2, withHistory: false },
    { count: 2, withHistory: true },
    { count: 40, withHistory: false },
  ])(
    "smoothly follows consecutive content growth with $count rows and history=$withHistory",
    async (options) => {
      const scroller = await renderStreamingList(options)
      const before = scroller.scrollTop
      await resizeReply()
      expect(scroller.scrollTop).toBe(before)
      await advanceFrame()
      expect(scroller.scrollTop).toBeGreaterThan(before)
      expect(scroller.scrollTop).toBeLessThan(
        scroller.scrollHeight - scroller.clientHeight
      )
      const intermediate = scroller.scrollTop
      await resizeReply(120)
      await resizeReply(120)
      expect(scroller.scrollTop).toBe(intermediate)
      await advanceFrame()
      expect(scroller.scrollTop).toBeGreaterThan(intermediate)
      expect(scroller.scrollTop).toBeLessThan(
        scroller.scrollHeight - scroller.clientHeight
      )
      await settleFrames()
      expect(scroller.scrollTop).toBe(
        scroller.scrollHeight - scroller.clientHeight
      )
    }
  )

  it("takes over pending virtual bottom navigation without snapping when output grows", async () => {
    const scroller = await renderStreamingList({ count: 2, withHistory: true })
    fireEvent.click(screen.getByRole("button", { name: "Latest" }))
    const before = scroller.scrollTop
    await resizeReply()
    expect(scroller.scrollTop).toBe(before)
    await advanceFrame()
    expect(scroller.scrollTop).toBeGreaterThan(before)
    expect(scroller.scrollTop).toBeLessThan(
      scroller.scrollHeight - scroller.clientHeight
    )
    await settleFrames()
    expect(scroller.scrollTop).toBe(
      scroller.scrollHeight - scroller.clientHeight
    )
  })

  it("stops the animation on upward scrolling and resumes only after returning to the bottom", async () => {
    const scroller = await renderStreamingList({ count: 2, withHistory: true })
    await resizeReply()
    await advanceFrame()
    fireEvent.wheel(scroller, { deltaY: -10 })
    scroller.scrollTop -= 10
    fireEvent.scroll(scroller)
    const readingTop = scroller.scrollTop
    await resizeReply()
    await settleFrames()
    expect(scroller.scrollTop).toBe(readingTop)
    fireEvent.wheel(scroller, { deltaY: 1_000 })
    scroller.scrollTop = scroller.scrollHeight - scroller.clientHeight
    fireEvent.scroll(scroller)
    const resumedTop = scroller.scrollTop
    await resizeReply()
    expect(scroller.scrollTop).toBe(resumedTop)
    await advanceFrame()
    expect(scroller.scrollTop).toBeGreaterThan(resumedTop)
    expect(scroller.scrollTop).toBeLessThan(
      scroller.scrollHeight - scroller.clientHeight
    )
    await settleFrames()
    expect(scroller.scrollTop).toBe(
      scroller.scrollHeight - scroller.clientHeight
    )
  })

  it("immediately follows virtual content when reduced motion is requested", async () => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)")
    vi.spyOn(window, "matchMedia").mockReturnValue({
      ...media,
      matches: true,
    })
    const scroller = await renderStreamingList({ count: 2, withHistory: true })
    const before = scroller.scrollTop
    await resizeReply()
    expect(scroller.scrollTop).toBe(before + 300)
    expect(scroller.scrollTop).toBe(
      scroller.scrollHeight - scroller.clientHeight
    )
    await settleFrames()
  })
})
