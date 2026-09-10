import { createRef, useRef } from "react"
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  ConversationMessageList,
  type ConversationMessageRow,
  type ConversationThreadNavigation,
} from "@/features/conversations/conversation-message-list"
import i18n from "@/i18n"
import { useConversationScroll } from "@/features/conversations/use-conversation-scroll"

function rows(start: number, count: number): ConversationMessageRow[] {
  return Array.from({ length: count }, (_, index) => {
    const id = `message-${start + index}`
    return { key: id, messageIds: [id], render: () => <p>{id}</p> }
  })
}

const originalScrollTo = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "scrollTo"
)

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(
    function (this: HTMLElement) {
      return this.hasAttribute("data-conversation-row") ? 100 : 600
    }
  )
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(900)
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(600)
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(
    function (this: HTMLElement) {
      const size = this.querySelector<HTMLElement>(
        '[data-testid="conversation-virtual-list"] > div'
      )?.style.height
      return Math.max(600, Number.parseFloat(size || "0"))
    }
  )
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      return DOMRect.fromRect({
        height: this.hasAttribute("data-conversation-row") ? 100 : 600,
        width: 900,
      })
    }
  )
  Object.defineProperty(HTMLElement.prototype, "scrollTo", {
    configurable: true,
    value: function (options: ScrollToOptions) {
      this.scrollTop = options.top ?? this.scrollTop
      queueMicrotask(() => this.dispatchEvent(new Event("scroll")))
    },
  })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  if (originalScrollTo)
    Object.defineProperty(HTMLElement.prototype, "scrollTo", originalScrollTo)
  else Reflect.deleteProperty(HTMLElement.prototype, "scrollTo")
})

describe("virtual conversation messages", () => {
  it("keeps the reading position inside a long streaming reply and resumes only at the bottom", async () => {
    let replyHeight = 1_000
    const observers: Array<{
      elements: Set<Element>
      notify: (target: Element) => void
    }> = []
    const originalResizeObserver = window.ResizeObserver
    window.ResizeObserver = class implements ResizeObserver {
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
        this.callback(
          [
            {
              target,
              borderBoxSize: [{ blockSize: replyHeight, inlineSize: 900 }],
              contentBoxSize: [],
              devicePixelContentBoxSize: [],
              contentRect: DOMRect.fromRect({
                height: replyHeight,
                width: 900,
              }),
            },
          ],
          this
        )
      }
    }
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(
      function (this: HTMLElement) {
        return this.dataset.conversationRow === "message-39"
          ? replyHeight
          : this.hasAttribute("data-conversation-row")
            ? 100
            : 600
      }
    )
    function Harness() {
      const navigationRef = useRef<ConversationThreadNavigation>(null)
      const scroll = useConversationScroll("streaming-task", { navigationRef })
      return (
        <div
          className="conversation-scroll"
          ref={scroll.scrollContainerRef}
          data-testid="scroller"
        >
          <div ref={scroll.contentRef} data-testid="stream-content">
            <ConversationMessageList
              rows={rows(0, 40)}
              navigationRef={navigationRef}
            />
          </div>
          <button onClick={() => scroll.scrollToBottom("auto")}>Latest</button>
        </div>
      )
    }
    try {
      render(<Harness />)
      const container = screen.getByTestId("scroller")
      await waitFor(() => {
        expect(screen.getByText("message-39")).toBeInTheDocument()
        expect(container.scrollTop).toBe(
          container.scrollHeight - container.clientHeight
        )
      })
      const resizeReply = async (delta = 200) => {
        replyHeight += delta
        const reply = screen
          .getByText("message-39")
          .closest("[data-conversation-row]")
        if (!reply) throw new Error("Missing streaming reply")
        const content = screen.getByTestId("stream-content")
        act(() => {
          for (const target of [reply, content])
            for (const observer of observers)
              if (observer.elements.has(target)) observer.notify(target)
        })
        await act(async () => {
          await new Promise<void>((resolve) =>
            window.requestAnimationFrame(() => resolve())
          )
        })
      }
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
      fireEvent.wheel(container, { deltaY: -120 })
      container.scrollTop -= 120
      fireEvent.scroll(container)
      const readingTop = container.scrollTop
      // The user can stop scrolling to read while streaming continues. Flush
      // the virtualizer's scroll-idle timer without waiting on wall-clock time.
      act(() => vi.advanceTimersByTime(200))
      vi.useRealTimers()
      await resizeReply()
      await resizeReply()
      expect(container.scrollTop).toBe(readingTop)

      // A layout shrink can put the paused viewport at the bottom without
      // any user navigation. Subsequent output must still leave it paused.
      await resizeReply(-520)
      expect(container.scrollHeight - container.clientHeight).toBe(readingTop)
      await resizeReply()
      expect(container.scrollTop).toBe(readingTop)

      fireEvent.wheel(container, { deltaY: 1_000 })
      container.scrollTop = container.scrollHeight - container.clientHeight
      fireEvent.scroll(container)
      await resizeReply()
      await waitFor(() =>
        expect(container.scrollTop).toBe(
          container.scrollHeight - container.clientHeight
        )
      )

      fireEvent.wheel(container, { deltaY: -120 })
      container.scrollTop -= 120
      fireEvent.scroll(container)
      fireEvent.click(screen.getByRole("button", { name: "Latest" }))
      // Interrupt the virtualizer before its pending bottom reconciliation settles.
      fireEvent.wheel(container, { deltaY: -120 })
      container.scrollTop -= 120
      fireEvent.scroll(container)
      const interruptedTop = container.scrollTop
      await resizeReply()
      expect(container.scrollTop).toBe(interruptedTop)

      fireEvent.click(screen.getByRole("button", { name: "Latest" }))
      await resizeReply()
      await waitFor(() =>
        expect(container.scrollTop).toBe(
          container.scrollHeight - container.clientHeight
        )
      )
    } finally {
      cleanup()
      window.ResizeObserver = originalResizeObserver
      vi.useRealTimers()
    }
  })

  it("positions a navigation target below the fixed conversation header", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        return this.classList.contains("conversation-top-bar")
          ? DOMRect.fromRect({ height: 64, width: 900 })
          : DOMRect.fromRect({
              height: this.hasAttribute("data-conversation-row") ? 100 : 600,
              width: 900,
            })
      }
    )
    const navigation = createRef<ConversationThreadNavigation>()
    render(
      <div className="conversation-workspace">
        <header className="conversation-top-bar" />
        <div className="conversation-scroll" data-testid="scroller">
          <ConversationMessageList
            rows={rows(0, 200)}
            navigationRef={navigation}
          />
        </div>
      </div>
    )
    act(() => {
      navigation.current?.scrollToMessage("message-100")
    })
    await waitFor(() => {
      const target = screen
        .getByText("message-100")
        .closest<HTMLElement>("[data-conversation-row]")
      expect(
        Number.parseFloat(target?.style.top ?? "NaN") -
          screen.getByTestId("scroller").scrollTop
      ).toBe(64)
    })
  })
  it("preserves the reading offset when a prepend exceeds the previous scrollable height", async () => {
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
    const history = {
      failedTurnIds: new Set<string>(),
      loadTurn: vi.fn(async () => undefined),
    }
    const view = render(
      <div className="conversation-scroll" data-testid="scroller">
        <ConversationMessageList rows={rows(20, 20)} history={history} />
      </div>
    )
    fireEvent.scroll(screen.getByTestId("scroller"))
    view.rerender(
      <div className="conversation-scroll" data-testid="scroller">
        <ConversationMessageList rows={rows(0, 40)} history={history} />
      </div>
    )
    await waitFor(() => {
      const target = screen
        .getByText("message-20")
        .closest<HTMLElement>("[data-conversation-row]")
      expect(target).not.toBeNull()
      expect(
        Number.parseFloat(target?.style.top ?? "NaN") -
          screen.getByTestId("scroller").scrollTop
      ).toBe(0)
    })
  })
  it("anchors the first message when older history is inserted at the very top", async () => {
    const history = {
      failedTurnIds: new Set<string>(),
      loadTurn: vi.fn(async () => undefined),
    }
    const view = render(
      <div className="conversation-scroll" data-testid="scroller">
        <ConversationMessageList rows={rows(20, 80)} history={history} />
      </div>
    )
    expect(screen.getByText("message-20")).toBeInTheDocument()
    view.rerender(
      <div className="conversation-scroll" data-testid="scroller">
        <ConversationMessageList rows={rows(0, 100)} history={history} />
      </div>
    )
    await waitFor(() =>
      expect(screen.getByTestId("scroller").scrollTop).toBeGreaterThan(0)
    )
    expect(screen.getByText("message-20")).toBeInTheDocument()
    expect(screen.queryByText("message-0")).not.toBeInTheDocument()
  })
  it("opens a long task at the latest message using the page scroll controller", async () => {
    function Harness() {
      const navigationRef = useRef<ConversationThreadNavigation>(null)
      const scroll = useConversationScroll("task", { navigationRef })
      return (
        <div className="conversation-scroll" ref={scroll.scrollContainerRef}>
          <div ref={scroll.contentRef}>
            <ConversationMessageList
              rows={rows(0, 200)}
              navigationRef={navigationRef}
            />
          </div>
        </div>
      )
    }
    render(<Harness />)
    await waitFor(() =>
      expect(screen.getByText("message-199")).toBeInTheDocument()
    )
    expect(screen.queryByText("message-0")).not.toBeInTheDocument()
  })

  it("keeps an edited message mounted when it scrolls outside the viewport", async () => {
    const navigation = createRef<ConversationThreadNavigation>()
    render(
      <div className="conversation-scroll">
        <ConversationMessageList
          rows={rows(0, 200)}
          navigationRef={navigation}
          pinnedMessageId="message-0"
        />
      </div>
    )
    act(() => {
      navigation.current?.scrollToMessage("message-100")
    })
    await waitFor(() =>
      expect(screen.getByText("message-100")).toBeInTheDocument()
    )
    expect(screen.getByText("message-0")).toBeInTheDocument()
    expect(
      document.querySelectorAll("[data-conversation-row]").length
    ).toBeLessThan(20)
  })
  it("keeps the same message visible after prepending history and appending a reply", async () => {
    const navigation = createRef<ConversationThreadNavigation>()
    const view = render(
      <div className="conversation-scroll" data-testid="scroller">
        <ConversationMessageList
          rows={rows(20, 80)}
          navigationRef={navigation}
        />
      </div>
    )
    act(() => {
      navigation.current?.scrollToMessage("message-60")
    })
    await waitFor(() =>
      expect(screen.getByText("message-60")).toBeInTheDocument()
    )
    const before = screen.getByTestId("scroller").scrollTop
    view.rerender(
      <div className="conversation-scroll" data-testid="scroller">
        <ConversationMessageList
          rows={rows(0, 100)}
          navigationRef={navigation}
        />
      </div>
    )
    await waitFor(() =>
      expect(screen.getByText("message-60")).toBeInTheDocument()
    )
    await waitFor(() =>
      expect(screen.getByTestId("scroller").scrollTop).toBeGreaterThan(before)
    )
    view.rerender(
      <div className="conversation-scroll" data-testid="scroller">
        <ConversationMessageList
          rows={rows(0, 101)}
          navigationRef={navigation}
        />
      </div>
    )
    expect(screen.getByText("message-60")).toBeInTheDocument()
    expect(screen.queryByText("message-100")).not.toBeInTheDocument()
  })

  it.each(["zh-CN", "en-US", "fr-FR"])(
    "provides localized loading feedback in %s including fallback",
    async (language) => {
      await i18n.changeLanguage(language)
      render(
        <div className="conversation-scroll">
          <ConversationMessageList
            rows={rows(20, 40).map((row) => ({
              ...row,
              turnId: row.key,
              loaded: false,
            }))}
            history={{
              failedTurnIds: new Set<string>(),
              loadTurn: vi.fn(async () => undefined),
            }}
          />
        </div>
      )
      const label = language === "en-US" ? "Loading messages…" : "正在加载消息…"
      expect(screen.getAllByRole("status")[0]).toHaveTextContent(label)
      await i18n.changeLanguage("zh-CN")
    }
  )
  it("mounts a bounded viewport for thousands of exchanges and navigates to an unmounted message", async () => {
    const navigation = createRef<ConversationThreadNavigation>()
    const onActive = vi.fn()
    render(
      <div className="conversation-scroll">
        <ConversationMessageList
          rows={rows(0, 2000)}
          navigationRef={navigation}
          onVisibleMessageChange={onActive}
        />
      </div>
    )
    expect(
      document.querySelectorAll("[data-conversation-row]").length
    ).toBeLessThan(20)
    expect(screen.queryByText("message-1500")).not.toBeInTheDocument()
    act(() => {
      expect(navigation.current?.scrollToMessage("message-1500")).toBe(true)
    })
    await waitFor(() =>
      expect(screen.getByText("message-1500")).toBeInTheDocument()
    )
    expect(
      document.querySelectorAll("[data-conversation-row]").length
    ).toBeLessThan(20)
    act(() => {
      navigation.current?.scrollToLatest("auto")
    })
    await waitFor(() =>
      expect(screen.getByText("message-1999")).toBeInTheDocument()
    )
  })

  it("shows an inline retry for a failed page", async () => {
    await i18n.changeLanguage("en-US")
    const loadTurn = vi.fn(async () => undefined)
    render(
      <div className="conversation-scroll">
        <ConversationMessageList
          rows={rows(0, 1).map((row) => ({
            ...row,
            turnId: row.key,
            loaded: false,
          }))}
          history={{ failedTurnIds: new Set(["message-0"]), loadTurn }}
        />
      </div>
    )
    fireEvent.click(
      screen.getByRole("button", { name: "Couldn’t load messages. Retry" })
    )
    expect(loadTurn).toHaveBeenCalledWith("message-0", true)
    await i18n.changeLanguage("zh-CN")
  })
})
