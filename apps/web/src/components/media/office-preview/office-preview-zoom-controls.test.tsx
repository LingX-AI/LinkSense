import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { OfficePreviewZoomControls } from "@/components/media/office-preview/office-preview-zoom-controls"
import i18n, { supportedLanguages } from "@/i18n"

describe("OfficePreviewZoomControls", () => {
  afterEach(() => cleanup())

  it.each(supportedLanguages)(
    "shows the gesture hint on hover and focus in %s",
    async (locale) => {
      const key = "officePreview.zoomGestureHint"
      const hint = i18n.t(key, { lng: locale })
      const fallback = i18n.cloneInstance({ forkResourceStore: true })
      if (locale !== "zh-CN")
        fallback.removeResourceBundle(locale, "translation")
      expect(i18n.getResource(locale, "translation", key)).toBe(hint)
      expect(hint).not.toBe(key)
      expect(hint).toContain("Ctrl")
      expect(hint).toContain("⌘")
      if (locale !== "zh-CN")
        expect(hint).not.toBe(i18n.t(key, { lng: "zh-CN" }))
      expect(fallback.t(key, { lng: locale })).toBe(
        i18n.t(key, { lng: "zh-CN" })
      )

      const onResetZoom = vi.fn()
      render(
        <OfficePreviewZoomControls
          zoomPercent={100}
          zoomOutLabel="Zoom out"
          zoomInLabel="Zoom in"
          resetZoomLabel="Reset zoom"
          gestureHint={hint}
          onZoomOut={vi.fn()}
          onZoomIn={vi.fn()}
          onResetZoom={onResetZoom}
        />
      )
      const user = userEvent.setup()
      await user.hover(screen.getByText("100%"))
      expect(await screen.findByRole("tooltip")).toHaveTextContent(hint)
      await user.unhover(screen.getByText("100%"))
      await user.tab()
      await user.tab()
      expect(screen.getByText("100%")).toHaveFocus()
      expect(await screen.findByRole("tooltip")).toHaveTextContent(hint)
      await user.keyboard("{Enter}")
      expect(onResetZoom).toHaveBeenCalledOnce()
    }
  )

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
