import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { OfficePreviewZoomControls } from "@/components/media/office-preview/office-preview-zoom-controls"

describe("OfficePreviewZoomControls", () => {
  afterEach(() => cleanup())

  it("keeps the common zoom action order and forwards every action", async () => {
    const onZoomOut = vi.fn()
    const onZoomIn = vi.fn()
    const onResetZoom = vi.fn()

    render(
      <OfficePreviewZoomControls
        zoomPercent={110}
        zoomOutLabel="Zoom out"
        zoomInLabel="Zoom in"
        resetZoomLabel="Reset zoom"
        onZoomOut={onZoomOut}
        onZoomIn={onZoomIn}
        onResetZoom={onResetZoom}
        trailing={<span>Page 2 of 4</span>}
      />
    )

    expect(screen.getByRole("button", { name: "Zoom out" })).toBeEnabled()
    expect(screen.getByRole("button", { name: "Zoom in" })).toBeEnabled()
    expect(screen.getAllByRole("button", { name: "Reset zoom" })).toHaveLength(
      2
    )
    expect(screen.getByText("110%")).toBeVisible()
    expect(screen.getByText("Page 2 of 4")).toBeVisible()

    await userEvent.click(screen.getByRole("button", { name: "Zoom out" }))
    await userEvent.click(screen.getByRole("button", { name: "Zoom in" }))
    await userEvent.click(
      screen.getAllByRole("button", { name: "Reset zoom" })[1]!
    )

    expect(onZoomOut).toHaveBeenCalledOnce()
    expect(onZoomIn).toHaveBeenCalledOnce()
    expect(onResetZoom).toHaveBeenCalledOnce()
  })

  it("disables only unavailable zoom directions", () => {
    render(
      <OfficePreviewZoomControls
        zoomPercent={50}
        zoomOutLabel="Zoom out"
        zoomInLabel="Zoom in"
        resetZoomLabel="Reset zoom"
        onZoomOut={vi.fn()}
        onZoomIn={vi.fn()}
        onResetZoom={vi.fn()}
        canZoomOut={false}
      />
    )

    expect(screen.getByRole("button", { name: "Zoom out" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "Zoom in" })).toBeEnabled()
  })
})
