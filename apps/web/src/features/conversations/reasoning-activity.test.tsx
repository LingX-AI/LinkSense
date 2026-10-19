import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ReasoningActivity } from "@/features/conversations/reasoning-activity"
import i18n, { supportedLanguages } from "@/i18n"

let contentHeight = 1_000
let viewportHeight = 200
let observers: ResizeObserverStub[] = []
const originalResizeObserver = window.ResizeObserver
const originalScrollTo = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "scrollTo"
)

class ResizeObserverStub implements ResizeObserver {
  readonly elements = new Set<Element>()
  private readonly callback: ResizeObserverCallback

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback
    observers.push(this)
  }

  observe(element: Element) {
    this.elements.add(element)
  }

  unobserve(element: Element) {
    this.elements.delete(element)
  }

  disconnect() {
    this.elements.clear()
  }

  notify() {
    this.callback([], this)
  }
}

function getViewport() {
  return screen.getByRole("region", { name: "思考内容" })
}

function getScrollableViewport() {
  const viewport = getViewport().querySelector<HTMLElement>(
    ".reasoning-activity-viewport"
  )
  if (!viewport) throw new Error("Missing reasoning viewport")
  return viewport
}

function notifyResize() {
  act(() => {
    observers.forEach((observer) => {
      if (observer.elements.size) observer.notify()
    })
  })
}

function scrollUp(viewport: HTMLElement) {
  fireEvent.wheel(viewport, { deltaY: -100 })
  viewport.scrollTop = 100
  fireEvent.scroll(viewport)
}

beforeEach(async () => {
  await i18n.changeLanguage("zh-CN")
  contentHeight = 1_000
  viewportHeight = 200
  observers = []
  window.ResizeObserver = ResizeObserverStub
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(
    () => viewportHeight
  )
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(
    () => Math.max(contentHeight, viewportHeight)
  )
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(600)
  vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(600)
  vi.spyOn(window, "matchMedia").mockImplementation((query) => ({
    matches: query === "(prefers-reduced-motion: reduce)",
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }))
  Object.defineProperty(HTMLElement.prototype, "scrollTo", {
    configurable: true,
    value: function (this: HTMLElement, options: ScrollToOptions) {
      this.scrollTop = Math.max(
        0,
        Math.min(options.top ?? 0, this.scrollHeight - this.clientHeight)
      )
    },
  })
})

afterEach(() => {
  cleanup()
  window.ResizeObserver = originalResizeObserver
  if (originalScrollTo) {
    Object.defineProperty(HTMLElement.prototype, "scrollTo", originalScrollTo)
  } else {
    Reflect.deleteProperty(HTMLElement.prototype, "scrollTo")
  }
  vi.restoreAllMocks()
})

describe("reasoning activity preview", () => {
  it("shows only one plain-text line with ellipsis styling and expands the full body", () => {
    const content = `**First thought**\n\n${"Detailed thought ".repeat(600)}\n\nLatest thought`
    render(<ReasoningActivity content={content} turnRunning={false} />)
    const region = getViewport()
    const preview = screen.getByText("First thought")
    expect(preview).toHaveClass("truncate")
    expect(preview.querySelector("strong")).toBeNull()
    expect(screen.queryByText("Latest thought")).toBeNull()
    expect(region.querySelector(".reasoning-activity-viewport")).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: "展开思考内容" }))
    expect(screen.getByText("Latest thought")).toBeVisible()
    expect(screen.getByText("First thought")).toBeVisible()
    expect(region.querySelector(".reasoning-activity-viewport")).toHaveClass(
      "max-h-[min(20rem,40dvh)]",
      "overflow-y-auto!"
    )
  })

  it("uses a full-size lightbulb on the left and an accessible disclosure on the right", () => {
    const { container } = render(
      <ReasoningActivity content="Thinking" turnRunning={false} />
    )
    const button = screen.getByRole("button", { name: "展开思考内容" })
    const icon = container.querySelector(".reasoning-activity-icon")
    expect(icon?.querySelector(".lucide-lightbulb")).toHaveClass("size-4")
    expect(icon?.nextElementSibling).toContainElement(getViewport())
    expect(button.previousElementSibling).toContainElement(getViewport())
    expect(button.nextElementSibling).toBeNull()
    expect(button).toHaveAttribute("aria-expanded", "false")
    expect(button).toHaveAttribute("aria-controls", getViewport().id)
  })

  it("keeps the disclosure column at the form summary's right edge when compact and expanded", () => {
    const { container } = render(
      <ReasoningActivity
        content={"First thought\n\n" + "Detailed thought ".repeat(100)}
        turnRunning={false}
      />
    )
    const row = container.querySelector(".reasoning-activity-row")
    const button = screen.getByRole("button", { name: "展开思考内容" })
    expect(row).toHaveClass("w-full", "min-w-0", "pr-2")
    expect(row).not.toHaveClass("max-w-3xl")
    expect(button).toHaveClass("size-6", "shrink-0")
    expect(button).toBe(row?.lastElementChild)
    fireEvent.click(button)
    expect(row).toHaveClass("w-full", "min-w-0", "pr-2")
    expect(button).toBe(row?.lastElementChild)
    expect(button).toHaveAttribute("aria-expanded", "true")
  })

  it("keeps the disclosure background transparent when collapsed and expanded", () => {
    render(<ReasoningActivity content="Thoughts" turnRunning={false} />)
    const button = screen.getByRole("button", { name: "展开思考内容" })
    expect(button).not.toHaveClass("aria-expanded:bg-muted")
    expect(button).not.toHaveClass("hover:bg-hover")
    fireEvent.click(button)
    expect(button).toHaveAttribute("aria-expanded", "true")
    expect(button).not.toHaveClass("aria-expanded:bg-muted")
    expect(button).not.toHaveClass("hover:bg-hover")
  })

  it("expands from the compact thought text and keeps expanded text clicks from collapsing it", () => {
    render(
      <ReasoningActivity
        content={"First thought\n\nDetailed reasoning paragraph"}
        turnRunning={false}
      />
    )
    const arrow = screen.getByRole("button", { name: "展开思考内容" })
    fireEvent.click(screen.getByText("First thought"))
    expect(arrow).toHaveAttribute("aria-expanded", "true")
    expect(screen.getByText("Detailed reasoning paragraph")).toBeVisible()
    fireEvent.click(screen.getByText("Detailed reasoning paragraph"))
    expect(arrow).toHaveAttribute("aria-expanded", "true")
    fireEvent.click(arrow)
    expect(arrow).toHaveAttribute("aria-expanded", "false")
    expect(screen.getByText("First thought")).toBeVisible()
    expect(screen.queryByText("Detailed reasoning paragraph")).toBeNull()
  })

  it("supports keyboard expansion from the thought text and preserves focus on the disclosure", async () => {
    const user = userEvent.setup()
    render(
      <ReasoningActivity
        content={"First thought\n\nDetailed reasoning paragraph"}
        turnRunning={false}
      />
    )
    const preview = screen.getByRole("button", { name: "First thought" })
    expect(preview).toHaveAttribute("aria-controls", getViewport().id)
    expect(preview).toHaveAttribute("aria-expanded", "false")
    preview.focus()
    await user.keyboard("{Enter}")
    expect(screen.getByText("Detailed reasoning paragraph")).toBeVisible()
    expect(screen.getByRole("button", { name: "收起思考内容" })).toHaveFocus()
    await user.keyboard(" ")
    expect(screen.getByRole("button", { name: "展开思考内容" })).toHaveFocus()
    expect(screen.getByRole("button", { name: "First thought" })).toBeVisible()
  })

  it.each([
    [true, true, "Latest thought"],
    [true, false, "Latest thought"],
    [false, false, "First thought"],
  ] as const)(
    "selects the correct line when turnRunning=%s and reasoningRunning=%s",
    (turnRunning, running, expected) => {
      render(
        <ReasoningActivity
          content={"First thought\n\nLatest thought"}
          turnRunning={turnRunning}
          running={running}
        />
      )
      expect(getViewport()).toHaveTextContent(expected)
      expect(getViewport()).not.toHaveTextContent(
        expected === "Latest thought" ? "First thought" : "Latest thought"
      )
    }
  )

  it("switches from the latest line to the earliest line when the task ends", () => {
    const content = "First thought\n\nLatest thought"
    const { rerender } = render(
      <ReasoningActivity content={content} turnRunning running streaming />
    )
    expect(getViewport()).toHaveTextContent("Latest thought")
    rerender(<ReasoningActivity content={content} turnRunning={false} />)
    expect(getViewport()).toHaveTextContent("First thought")
    expect(getViewport()).not.toHaveTextContent("Latest thought")
    rerender(
      <ReasoningActivity
        content={"Authoritative first thought\n\nFinal thought"}
        turnRunning={false}
      />
    )
    expect(getViewport()).toHaveTextContent("Authoritative first thought")
  })

  it.each([false, true])(
    "opens full reasoning at the correct edge when turnRunning=%s",
    (turnRunning) => {
      render(
        <ReasoningActivity
          content={"First thought\n\nLatest thought"}
          turnRunning={turnRunning}
        />
      )
      fireEvent.click(screen.getByRole("button", { name: "展开思考内容" }))
      expect(getScrollableViewport().scrollTop).toBe(turnRunning ? 800 : 0)
      contentHeight = 1_200
      notifyResize()
      expect(getScrollableViewport().scrollTop).toBe(turnRunning ? 1_000 : 0)
    }
  )

  it("follows live markdown growth and preserves a manually selected reading position", () => {
    const { rerender } = render(
      <ReasoningActivity
        content="First thought"
        turnRunning
        running
        streaming
      />
    )
    fireEvent.click(screen.getByRole("button", { name: "展开思考内容" }))
    const viewport = getScrollableViewport()
    contentHeight = 1_200
    rerender(
      <ReasoningActivity
        content={"First thought\n\nLatest thought"}
        turnRunning
        running
        streaming
      />
    )
    notifyResize()
    expect(getScrollableViewport()).toBe(viewport)
    expect(viewport.scrollTop).toBe(1_000)
    scrollUp(viewport)
    contentHeight = 1_400
    notifyResize()
    expect(viewport.scrollTop).toBe(100)

    fireEvent.wheel(viewport, { deltaY: 100 })
    viewport.scrollTop = 1_200
    fireEvent.scroll(viewport)
    contentHeight = 1_600
    notifyResize()
    expect(viewport.scrollTop).toBe(1_400)
  })

  it("pauses and resumes following when reading with the keyboard", () => {
    render(
      <ReasoningActivity content="Thoughts" turnRunning running streaming />
    )
    fireEvent.click(screen.getByRole("button", { name: "展开思考内容" }))
    const viewport = getScrollableViewport()
    fireEvent.keyDown(viewport, { key: "Home" })
    viewport.scrollTop = 0
    fireEvent.scroll(viewport)
    contentHeight = 1_200
    notifyResize()
    expect(viewport.scrollTop).toBe(0)
    fireEvent.keyDown(viewport, { key: "End" })
    viewport.scrollTop = 1_000
    fireEvent.scroll(viewport)
    contentHeight = 1_400
    notifyResize()
    expect(viewport.scrollTop).toBe(1_200)
  })

  it("pauses scrollbar dragging and resumes after dragging to the bottom", async () => {
    const { container } = render(
      <ReasoningActivity content="Thoughts" turnRunning running streaming />
    )
    fireEvent.click(screen.getByRole("button", { name: "展开思考内容" }))
    await act(async () => {})
    const viewport = getScrollableViewport()
    const scrollbar = container.querySelector('[data-orientation="vertical"]')
    const thumb = scrollbar?.firstElementChild
    if (!(thumb instanceof HTMLElement))
      throw new Error("Missing scrollbar thumb")
    Object.defineProperties(thumb, {
      setPointerCapture: { value: vi.fn() },
      hasPointerCapture: { value: vi.fn(() => true) },
      releasePointerCapture: { value: vi.fn() },
    })
    fireEvent.pointerDown(thumb, { isPrimary: true, button: 0 })
    viewport.scrollTop = 100
    fireEvent.scroll(viewport)
    fireEvent.pointerUp(thumb, { isPrimary: true, button: 0 })
    contentHeight = 1_200
    notifyResize()
    expect(viewport.scrollTop).toBe(100)
    fireEvent.pointerDown(thumb, { isPrimary: true, button: 0 })
    viewport.scrollTop = 1_000
    fireEvent.scroll(viewport)
    fireEvent.pointerUp(thumb, { isPrimary: true, button: 0 })
    contentHeight = 1_400
    notifyResize()
    expect(viewport.scrollTop).toBe(1_200)
  })

  it("returns expanded reasoning to the start on completion and keeps it expanded", () => {
    const content = "First thought\n\nLatest thought"
    const { rerender } = render(
      <ReasoningActivity content={content} turnRunning running streaming />
    )
    fireEvent.click(screen.getByRole("button", { name: "展开思考内容" }))
    const viewport = getScrollableViewport()
    expect(viewport.scrollTop).toBe(800)
    rerender(<ReasoningActivity content={content} turnRunning={false} />)
    expect(getScrollableViewport()).toBe(viewport)
    expect(viewport.scrollTop).toBe(0)
    contentHeight = 1_400
    notifyResize()
    expect(viewport.scrollTop).toBe(0)
    fireEvent.click(screen.getByRole("button", { name: "收起思考内容" }))
    expect(getViewport()).toHaveTextContent("First thought")
    expect(getViewport()).not.toHaveTextContent("Latest thought")
  })

  it("keeps keyboard focus on the disclosure while expanding and collapsing", async () => {
    const user = userEvent.setup()
    render(<ReasoningActivity content="Thoughts" turnRunning={false} />)
    screen.getByRole("button", { name: "展开思考内容" }).focus()
    await user.keyboard("{Enter}")
    expect(getScrollableViewport()).toBeVisible()
    expect(screen.getByRole("button", { name: "收起思考内容" })).toHaveFocus()
    await user.keyboard("{Enter}")
    expect(screen.getByText("Thoughts")).toHaveClass("truncate")
    expect(screen.getByRole("button", { name: "展开思考内容" })).toHaveFocus()
  })

  it.each(supportedLanguages)(
    "uses localized region and disclosure labels in %s",
    async (language) => {
      await i18n.changeLanguage(language)
      render(<ReasoningActivity content="Thoughts" turnRunning={false} />)
      const region = screen.getByRole("region", {
        name: i18n.t("conversation.reasoningActivity.label"),
      })
      expect(region).toBeVisible()
      fireEvent.click(
        screen.getByRole("button", {
          name: i18n.t("conversation.reasoningActivity.expand"),
        })
      )
      expect(
        screen.getByRole("button", {
          name: i18n.t("conversation.reasoningActivity.collapse"),
        })
      ).toHaveAttribute("aria-controls", region.id)
    }
  )

  it("keeps independent scroll positions for different reasoning stages", () => {
    render(
      <>
        <ReasoningActivity content="Earlier stage" turnRunning={false} />
        <ReasoningActivity
          content="Current stage"
          turnRunning
          running
          streaming
        />
      </>
    )
    screen
      .getAllByRole("button", { name: "展开思考内容" })
      .forEach((button) => {
        fireEvent.click(button)
      })
    const viewports = screen
      .getAllByRole("region", { name: "思考内容" })
      .map((region) =>
        region.querySelector<HTMLElement>(".reasoning-activity-viewport")
      )
    const [earlier, current] = viewports
    if (!earlier || !current) throw new Error("Missing viewports")
    earlier.scrollTop = 100
    fireEvent.scroll(earlier)
    contentHeight = 1_200
    notifyResize()
    expect(earlier.scrollTop).toBe(100)
    expect(current.scrollTop).toBe(1_000)
  })

  it("disconnects viewport observers when returning to the single-line preview", () => {
    render(<ReasoningActivity content="Thoughts" turnRunning={false} />)
    expect(observers).toHaveLength(0)
    fireEvent.click(screen.getByRole("button", { name: "展开思考内容" }))
    expect(observers.some((observer) => observer.elements.size)).toBe(true)
    fireEvent.click(screen.getByRole("button", { name: "收起思考内容" }))
    expect(observers.every((observer) => observer.elements.size === 0)).toBe(
      true
    )
  })
})
