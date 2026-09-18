import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { SidebarTaskScrollArea } from "./sidebar-task-scroll-area"

let contentHeight = 600
let viewportHeight = 200
const resizeCallbacks = new Set<() => void>()
const originalResizeObserver = window.ResizeObserver

async function renderList() {
  const result = render(
    <SidebarTaskScrollArea>
      <button type="button">Task</button>
    </SidebarTaskScrollArea>
  )
  await act(async () => {})
  const viewport = result.container.querySelector(
    ".sidebar-conversation-scroll"
  )
  if (!(viewport instanceof HTMLElement)) throw new Error("Missing viewport")
  return { ...result, viewport }
}

function expectFade(viewport: HTMLElement, top: number, bottom: number) {
  expect(
    viewport.style.getPropertyValue("--scroll-area-overflow-y-start")
  ).toBe(`${top}px`)
  expect(viewport.style.getPropertyValue("--scroll-area-overflow-y-end")).toBe(
    `${bottom}px`
  )
}

describe("sidebar task scroll fade", () => {
  beforeEach(() => {
    contentHeight = 600
    viewportHeight = 200
    resizeCallbacks.clear()
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(
      () => viewportHeight
    )
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(
      () => contentHeight
    )
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(240)
    vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(240)
    window.ResizeObserver = class implements ResizeObserver {
      private notify: () => void
      constructor(callback: ResizeObserverCallback) {
        this.notify = () => callback([], this)
      }
      observe() {
        resizeCallbacks.add(this.notify)
        this.notify()
      }
      unobserve() {}
      disconnect() {
        resizeCallbacks.delete(this.notify)
      }
    }
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    window.ResizeObserver = originalResizeObserver
  })

  it("fades only the bottom initially, both edges in the middle, and only the top at the end", async () => {
    const { viewport } = await renderList()
    expectFade(viewport, 0, 400)
    viewport.scrollTop = 12
    fireEvent.scroll(viewport)
    expectFade(viewport, 12, 388)
    viewport.scrollTop = 400
    fireEvent.scroll(viewport)
    expectFade(viewport, 400, 0)
    viewport.scrollTop = 0
    fireEvent.scroll(viewport)
    expectFade(viewport, 0, 400)
  })

  it("shows a fixed gray divider above the fade only when content has scrolled past the top", async () => {
    const { viewport } = await renderList()
    const region = viewport.closest(".sidebar-conversation-region")
    expect(region).toHaveClass(
      "before:absolute",
      "before:inset-x-0",
      "before:top-0",
      "before:h-px",
      "before:bg-[var(--app-divider)]",
      "before:pointer-events-none",
      "before:opacity-0",
      "data-[overflow-y-start]:before:opacity-100",
      "motion-reduce:before:transition-none"
    )
    expect(region).not.toHaveAttribute("data-overflow-y-start")
    viewport.scrollTop = 24
    fireEvent.scroll(viewport)
    expect(region).toHaveAttribute("data-overflow-y-start")
    expectFade(viewport, 24, 376)
    viewport.scrollTop = 400
    fireEvent.scroll(viewport)
    expect(region).toHaveAttribute("data-overflow-y-start")
    viewport.scrollTop = 0
    fireEvent.scroll(viewport)
    expect(region).not.toHaveAttribute("data-overflow-y-start")
  })

  it.each([0, 120, 200])(
    "keeps content clear when its height is %ipx and does not overflow",
    async (height) => {
      contentHeight = height
      const { viewport } = await renderList()
      expect(viewport).not.toHaveAttribute("data-overflow-y-start")
      expect(viewport).not.toHaveAttribute("data-overflow-y-end")
      if (height > 0) expectFade(viewport, 0, 0)
      expect(viewport).toHaveClass(
        "[mask-image:linear-gradient(to_bottom,transparent,black_min(24px,var(--scroll-area-overflow-y-start,0px)),black_calc(100%_-_min(24px,var(--scroll-area-overflow-y-end,0px))),transparent)]"
      )
    }
  )

  it("updates fading after asynchronous content changes, group collapse, and viewport resizing", async () => {
    contentHeight = 120
    const { viewport } = await renderList()
    expectFade(viewport, 0, 0)
    contentHeight = 600
    act(() => resizeCallbacks.forEach((callback) => callback()))
    expectFade(viewport, 0, 400)
    viewportHeight = 700
    act(() => resizeCallbacks.forEach((callback) => callback()))
    expectFade(viewport, 0, 0)
    viewportHeight = 200
    act(() => resizeCallbacks.forEach((callback) => callback()))
    expectFade(viewport, 0, 400)
    contentHeight = 120
    act(() => resizeCallbacks.forEach((callback) => callback()))
    expectFade(viewport, 0, 0)
  })

  it("keeps independent scroll positions for desktop and mobile lists and disconnects observers", async () => {
    const first = await renderList()
    const second = await renderList()
    first.viewport.scrollTop = 150
    fireEvent.scroll(first.viewport)
    expectFade(first.viewport, 150, 250)
    expectFade(second.viewport, 0, 400)
    first.unmount()
    second.unmount()
    expect(resizeCallbacks.size).toBe(0)
  })

  it("preserves task interaction and keeps the subtle scrollbar outside the fading viewport", async () => {
    const onClick = vi.fn()
    const { container } = render(
      <SidebarTaskScrollArea>
        <button type="button" onClick={onClick}>
          Open task
        </button>
      </SidebarTaskScrollArea>
    )
    await act(async () => {})
    fireEvent.click(screen.getByRole("button", { name: "Open task" }))
    expect(onClick).toHaveBeenCalledOnce()
    const scrollbar = container.querySelector('[data-orientation="vertical"]')
    expect(scrollbar).toHaveClass("w-[7px]")
    expect(scrollbar?.closest(".sidebar-conversation-scroll")).toBeNull()
    expect(scrollbar?.firstElementChild).toHaveClass(
      "rounded-full",
      "bg-[color-mix(in_srgb,var(--app-sidebar-muted)_22%,transparent)]",
      "hover:bg-[color-mix(in_srgb,var(--app-sidebar-muted)_34%,transparent)]"
    )
  })
})
