import { useState } from "react"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

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
  })

  afterEach(() => {
    cleanup()
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
    expect(screen.getByTestId("current-width")).toHaveTextContent("328")
    expect(handle).toHaveAttribute("aria-valuenow", "328")

    fireEvent.pointerUp(handle, { clientX: 328, pointerId: 7 })
    expect(handle).not.toHaveAttribute("data-resizing")
    expect(screen.getByTestId("committed-width")).toHaveTextContent("328")
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
