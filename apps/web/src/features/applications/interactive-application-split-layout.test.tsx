import { act, cleanup, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { InteractiveApplicationSplitLayout } from "@/features/applications/interactive-application-split-layout"

let measuredLayoutWidth = 1_600
let resizeObserverCallback: ResizeObserverCallback | null = null
const originalResizeObserver = window.ResizeObserver

class ControlledResizeObserver implements ResizeObserver {
  constructor(callback: ResizeObserverCallback) {
    resizeObserverCallback = callback
  }

  observe() {}
  unobserve() {}
  disconnect() {}
}

const resizeObserverArgument: ResizeObserver = {
  observe() {},
  unobserve() {},
  disconnect() {},
}

function notifyLayoutResize() {
  if (!resizeObserverCallback) {
    throw new Error("Expected the split layout to observe its container")
  }
  resizeObserverCallback([], resizeObserverArgument)
}

describe("interactive application split layout resizing", () => {
  beforeEach(() => {
    measuredLayoutWidth = 1_600
    resizeObserverCallback = null
    window.ResizeObserver = ControlledResizeObserver
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function getBoundingClientRect(this: HTMLElement) {
        const width = this.classList.contains("interactive-application-layout")
          ? measuredLayoutWidth
          : 0
        return {
          x: 0,
          y: 0,
          top: 0,
          right: width,
          bottom: 800,
          left: 0,
          width,
          height: 800,
          toJSON: () => ({}),
        }
      }
    )
  })

  afterEach(() => {
    cleanup()
    window.ResizeObserver = originalResizeObserver
    vi.restoreAllMocks()
  })

  it("keeps one proportional grid target while an outer layout changes width", () => {
    render(
      <InteractiveApplicationSplitLayout
        application={<main>应用区域</main>}
        chat={<aside>聊天区域</aside>}
        chatOpen
        resizeLabel="调整聊天区域宽度"
      />
    )

    const layout = screen.getByText("应用区域").parentElement?.parentElement
    expect(layout).toHaveClass("interactive-application-layout")
    expect(layout).toHaveStyle(
      "--interactive-application-workspace-width: clamp(320px, 66.66666666666667%, calc(100% - 480px))"
    )
    expect(
      screen.getByRole("separator", { name: "调整聊天区域宽度" })
    ).toHaveAttribute("aria-valuenow", "1067")

    measuredLayoutWidth = 1_800
    act(notifyLayoutResize)

    expect(layout).toHaveStyle(
      "--interactive-application-workspace-width: clamp(320px, 66.66666666666667%, calc(100% - 480px))"
    )
    expect(
      screen.getByRole("separator", { name: "调整聊天区域宽度" })
    ).toHaveAttribute("aria-valuenow", "1200")
  })
})
