import { useRef } from "react"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { useAssistantHtmlPreviewViewport } from "./use-assistant-html-preview-viewport"

const heightProperty = "--assistant-html-preview-height"
const originalResizeObserver = window.ResizeObserver
const observers: ViewportObserver[] = []
const bounds = new Map<string, DOMRect>()

class ViewportObserver implements ResizeObserver {
  readonly observed = new Set<Element>()
  readonly callback: ResizeObserverCallback
  readonly disconnect = vi.fn(() => this.observed.clear())

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback
    observers.push(this)
  }

  observe(element: Element): void {
    this.observed.add(element)
  }

  unobserve(element: Element): void {
    this.observed.delete(element)
  }

  resize(): void {
    this.callback([], this)
  }
}

function Preview() {
  const ref = useRef<HTMLElement>(null)
  useAssistantHtmlPreviewViewport(ref)
  return <section ref={ref} data-testid="preview" />
}

function Workspace({ showComposer = true }: { showComposer?: boolean }) {
  return (
    <div className="conversation-workspace">
      <header className="conversation-top-bar" />
      <div className="conversation-scroll">
        <Preview />
      </div>
      <div className="conversation-bottom-stack">
        {showComposer && <div className="composer-shell" />}
      </div>
    </div>
  )
}

beforeEach(() => {
  observers.length = 0
  bounds.clear()
  window.ResizeObserver = ViewportObserver
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      for (const [className, rect] of bounds) {
        if (this.classList.contains(className)) return rect
      }
      return new DOMRect()
    }
  )
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  window.ResizeObserver = originalResizeObserver
})

describe("assistant HTML host viewport", () => {
  it("sizes embedded previews from the shared page's scrolling viewport", () => {
    bounds.set("shared-conversation-main", new DOMRect(0, 100, 900, 600))
    bounds.set("conversation-scroll", new DOMRect(0, 200, 900, 60_000))
    render(
      <main
        className="shared-conversation-main"
        data-conversation-scroll-viewport
      >
        <div className="conversation-scroll">
          <Preview />
        </div>
      </main>
    )
    expect(
      screen.getByTestId("preview").style.getPropertyValue(heightProperty)
    ).toBe("420px")
  })

  it("uses 70 percent of the conversation area below its header and above its composer", () => {
    bounds.set("conversation-scroll", new DOMRect(0, 0, 900, 1_000))
    bounds.set("conversation-top-bar", new DOMRect(0, 0, 900, 60))
    bounds.set("composer-shell", new DOMRect(0, 800, 900, 200))
    const { container } = render(<Workspace />)

    expect(
      screen.getByTestId("preview").style.getPropertyValue(heightProperty)
    ).toBe("518px")
    expect([...observers[0].observed]).toEqual([
      container.querySelector(".conversation-scroll"),
      container.querySelector(".conversation-top-bar"),
      container.querySelector(".conversation-bottom-stack"),
    ])
  })

  it("resizes with a smaller host viewport and an expanded composer", () => {
    bounds.set("conversation-scroll", new DOMRect(0, 0, 900, 1_000))
    bounds.set("conversation-top-bar", new DOMRect(0, 0, 900, 60))
    bounds.set("composer-shell", new DOMRect(0, 800, 900, 200))
    render(<Workspace />)

    bounds.set("conversation-scroll", new DOMRect(0, 0, 390, 600))
    bounds.set("composer-shell", new DOMRect(0, 420, 390, 180))
    act(() => observers[0].resize())
    expect(
      screen.getByTestId("preview").style.getPropertyValue(heightProperty)
    ).toBe("252px")

    bounds.set("composer-shell", new DOMRect(0, 340, 390, 260))
    act(() => observers[0].resize())
    expect(
      screen.getByTestId("preview").style.getPropertyValue(heightProperty)
    ).toBe("196px")
  })

  it("uses the actual embedded scroll viewport when there is no header or composer", () => {
    bounds.set("conversation-scroll", new DOMRect(0, 100, 900, 420))
    render(
      <div className="conversation-scroll">
        <Preview />
      </div>
    )
    expect(
      screen.getByTestId("preview").style.getPropertyValue(heightProperty)
    ).toBe("294px")
  })

  it("picks up a composer mounted later without rewriting unchanged viewport geometry", () => {
    bounds.set("conversation-scroll", new DOMRect(0, 0, 900, 800))
    const { rerender } = render(<Workspace showComposer={false} />)
    const preview = screen.getByTestId("preview")
    expect(preview.style.getPropertyValue(heightProperty)).toBe("560px")
    const setHeight = vi.spyOn(preview.style, "setProperty")
    act(() => observers[0].resize())
    expect(setHeight).not.toHaveBeenCalled()

    bounds.set("composer-shell", new DOMRect(0, 600, 900, 200))
    rerender(<Workspace />)
    act(() => observers[0].resize())
    expect(preview.style.getPropertyValue(heightProperty)).toBe("420px")
  })

  it("keeps the CSS viewport default until a hidden host receives a measurable size", () => {
    render(<Workspace />)
    expect(
      screen.getByTestId("preview").style.getPropertyValue(heightProperty)
    ).toBe("")
    bounds.set("conversation-scroll", new DOMRect(0, 0, 900, 800))
    act(() => observers[0].resize())
    expect(
      screen.getByTestId("preview").style.getPropertyValue(heightProperty)
    ).toBe("560px")
  })

  it("handles window resizing without ResizeObserver and removes its listener on unmount", () => {
    Reflect.set(window, "ResizeObserver", undefined)
    bounds.set("conversation-scroll", new DOMRect(0, 0, 900, 600))
    const { unmount } = render(<Workspace />)
    const preview = screen.getByTestId("preview")
    expect(preview.style.getPropertyValue(heightProperty)).toBe("420px")

    bounds.set("conversation-scroll", new DOMRect(0, 0, 390, 400))
    fireEvent(window, new Event("resize"))
    expect(preview.style.getPropertyValue(heightProperty)).toBe("280px")
    unmount()
    fireEvent(window, new Event("resize"))
    expect(preview.style.getPropertyValue(heightProperty)).toBe("")
  })

  it("disconnects host observation when a virtualized message unmounts", () => {
    const { unmount } = render(<Workspace />)
    unmount()
    expect(observers[0].disconnect).toHaveBeenCalledOnce()
  })
})
