import { useState } from "react"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { SidebarResizer } from "@/components/shell/sidebar-resizer"
import {
  DEFAULT_SIDEBAR_WIDTH,
  clampSidebarWidth,
  MAX_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
  persistSidebarWidth,
  readStoredSidebarWidth,
  SIDEBAR_WIDTH_STORAGE_KEY,
} from "@/components/shell/sidebar-width"

function ResizerHarness({
  initialWidth = DEFAULT_SIDEBAR_WIDTH,
  minValue,
  maxValue,
  className,
}: Readonly<{
  initialWidth?: number
  minValue?: number
  maxValue?: number
  className?: string
}> = {}) {
  const [width, setWidth] = useState(initialWidth)
  const [committedWidth, setCommittedWidth] = useState<number>()

  return (
    <>
      <SidebarResizer
        label="调整侧边栏宽度"
        value={width}
        minValue={minValue}
        maxValue={maxValue}
        className={className}
        onResize={setWidth}
        onResizeEnd={setCommittedWidth}
      />
      <output data-testid="current-width">{width}</output>
      <output data-testid="committed-width">{committedWidth}</output>
    </>
  )
}

describe("SidebarResizer", () => {
  beforeEach(() => {
    window.localStorage.clear()
    vi.useFakeTimers()
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it("uses a 248px default width", () => {
    expect(DEFAULT_SIDEBAR_WIDTH).toBe(248)
    expect(readStoredSidebarWidth()).toBe(248)
  })

  it("resizes from the pointer start position and commits on release", () => {
    render(<ResizerHarness />)
    const handle = screen.getByRole("separator", {
      name: "调整侧边栏宽度",
    })

    fireEvent.pointerDown(handle, {
      button: 0,
      clientX: DEFAULT_SIDEBAR_WIDTH,
      pointerId: 7,
    })
    expect(handle).toHaveAttribute("data-resizing", "true")

    fireEvent.pointerMove(handle, { clientX: 328, pointerId: 7 })
    act(() => vi.advanceTimersToNextFrame())
    expect(screen.getByTestId("current-width")).toHaveTextContent("328")
    expect(handle).toHaveAttribute("aria-valuenow", "328")

    fireEvent.pointerUp(handle, { clientX: 328, pointerId: 7 })
    expect(handle).not.toHaveAttribute("data-resizing")
    expect(screen.getByTestId("committed-width")).toHaveTextContent("328")
  })

  it("coalesces pointer moves into one update per frame and skips unchanged widths", () => {
    const onResize = vi.fn()
    render(<SidebarResizer label="Resize" value={248} onResize={onResize} />)
    const handle = screen.getByRole("separator")
    fireEvent.pointerDown(handle, { button: 0, clientX: 248, pointerId: 7 })
    for (const clientX of [270, 300, 320]) {
      fireEvent.pointerMove(handle, { clientX, pointerId: 7 })
    }
    expect(onResize).not.toHaveBeenCalled()
    act(() => vi.advanceTimersToNextFrame())
    expect(onResize).toHaveBeenCalledExactlyOnceWith(320)
    fireEvent.pointerMove(handle, { clientX: 320, pointerId: 7 })
    act(() => vi.advanceTimersToNextFrame())
    expect(onResize).toHaveBeenCalledTimes(1)
  })

  it.each(["pointerUp", "pointerCancel", "lostPointerCapture"] as const)(
    "flushes the last pending width exactly once on %s",
    (eventName) => {
      const onResize = vi.fn()
      const onResizeEnd = vi.fn()
      render(
        <SidebarResizer
          label="Resize"
          value={248}
          onResize={onResize}
          onResizeEnd={onResizeEnd}
        />
      )
      const handle = screen.getByRole("separator")
      fireEvent.pointerDown(handle, { button: 0, clientX: 248, pointerId: 7 })
      fireEvent.pointerMove(handle, { clientX: 320, pointerId: 7 })
      fireEvent[eventName](handle, { pointerId: 8 })
      expect(onResizeEnd).not.toHaveBeenCalled()
      fireEvent[eventName](handle, { pointerId: 7 })
      act(() => vi.advanceTimersToNextFrame())
      expect(onResize).toHaveBeenCalledExactlyOnceWith(320)
      expect(onResizeEnd).toHaveBeenCalledExactlyOnceWith(320)
      expect(handle).not.toHaveAttribute("data-resizing")
    }
  )

  it("cancels scheduled resize work when unmounted", () => {
    const onResize = vi.fn()
    const { unmount } = render(
      <SidebarResizer label="Resize" value={248} onResize={onResize} />
    )
    const handle = screen.getByRole("separator")
    fireEvent.pointerDown(handle, { button: 0, clientX: 248, pointerId: 7 })
    fireEvent.pointerMove(handle, { clientX: 320, pointerId: 7 })
    unmount()
    act(() => vi.advanceTimersToNextFrame())
    expect(onResize).not.toHaveBeenCalled()
  })

  it("clamps pointer and keyboard resizing to the supported range", () => {
    render(<ResizerHarness />)
    const handle = screen.getByRole("separator", {
      name: "调整侧边栏宽度",
    })

    fireEvent.pointerDown(handle, {
      button: 0,
      clientX: DEFAULT_SIDEBAR_WIDTH,
      pointerId: 9,
    })
    fireEvent.pointerMove(handle, { clientX: 999, pointerId: 9 })
    fireEvent.pointerUp(handle, { clientX: 999, pointerId: 9 })
    expect(screen.getByTestId("current-width")).toHaveTextContent(
      String(MAX_SIDEBAR_WIDTH)
    )

    fireEvent.keyDown(handle, { key: "Home" })
    expect(screen.getByTestId("current-width")).toHaveTextContent(
      String(MIN_SIDEBAR_WIDTH)
    )

    fireEvent.keyDown(handle, { key: "ArrowRight", shiftKey: true })
    expect(screen.getByTestId("current-width")).toHaveTextContent("224")

    fireEvent.keyDown(handle, { key: "End" })
    expect(screen.getByTestId("current-width")).toHaveTextContent(
      String(MAX_SIDEBAR_WIDTH)
    )
  })

  it("normalizes and persists the browser width preference", () => {
    expect(clampSidebarWidth(Number.NaN)).toBe(DEFAULT_SIDEBAR_WIDTH)
    expect(readStoredSidebarWidth()).toBe(DEFAULT_SIDEBAR_WIDTH)

    window.localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, "999")
    expect(readStoredSidebarWidth()).toBe(MAX_SIDEBAR_WIDTH)

    persistSidebarWidth(301.6)
    expect(window.localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY)).toBe("302")
  })

  it("reuses the same interaction with custom panel bounds and styling", () => {
    render(
      <ResizerHarness
        initialWidth={600}
        minValue={320}
        maxValue={720}
        className="presentation-preview-resize-handle"
      />
    )
    const handle = screen.getByRole("separator", {
      name: "调整侧边栏宽度",
    })

    expect(handle).toHaveClass(
      "sidebar-resize-handle",
      "presentation-preview-resize-handle"
    )
    expect(handle).toHaveAttribute("aria-valuemin", "320")
    expect(handle).toHaveAttribute("aria-valuemax", "720")

    fireEvent.pointerDown(handle, {
      button: 0,
      clientX: 600,
      pointerId: 12,
    })
    fireEvent.pointerMove(handle, { clientX: 900, pointerId: 12 })
    fireEvent.pointerUp(handle, { clientX: 900, pointerId: 12 })
    expect(screen.getByTestId("current-width")).toHaveTextContent("720")

    fireEvent.keyDown(handle, { key: "Home" })
    expect(screen.getByTestId("current-width")).toHaveTextContent("320")
  })
})
