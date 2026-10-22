import { useLayoutEffect, type RefObject } from "react"

export const assistantHtmlPreviewViewportClassName =
  "h-[min(560px,var(--assistant-html-preview-height,70dvh))]"

// Measure the host viewport, never the generated document or its animations.
// The CSS variable supplies geometry to the shared Tailwind height constraint.
export function useAssistantHtmlPreviewViewport(
  previewRef: RefObject<HTMLElement | null>
): void {
  useLayoutEffect(() => {
    const preview = previewRef.current
    const scroller = preview?.closest<HTMLElement>(".conversation-scroll")
    if (!preview || !scroller) return
    const workspace = scroller.closest(".conversation-workspace")
    const header = workspace?.querySelector(".conversation-top-bar")
    const bottomStack = workspace?.querySelector(".conversation-bottom-stack")
    const updateHeight = () => {
      const viewport = scroller.getBoundingClientRect()
      if (viewport.height <= 0) return
      const headerBounds = header?.getBoundingClientRect()
      const composerBounds = workspace
        ?.querySelector(".composer-shell")
        ?.getBoundingClientRect()
      const top = Math.max(
        viewport.top,
        headerBounds && headerBounds.height > 0
          ? headerBounds.bottom
          : viewport.top
      )
      const bottom = Math.min(
        viewport.bottom,
        composerBounds && composerBounds.height > 0
          ? composerBounds.top
          : viewport.bottom
      )
      const height = Math.max(1, Math.round((bottom - top) * 0.7))
      const value = `${height}px`
      if (
        preview.style.getPropertyValue("--assistant-html-preview-height") !==
        value
      ) {
        preview.style.setProperty("--assistant-html-preview-height", value)
      }
    }

    updateHeight()
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(updateHeight)
    observer?.observe(scroller)
    if (header) observer?.observe(header)
    if (bottomStack) observer?.observe(bottomStack)
    window.addEventListener("resize", updateHeight)
    return () => {
      observer?.disconnect()
      window.removeEventListener("resize", updateHeight)
      preview.style.removeProperty("--assistant-html-preview-height")
    }
  }, [previewRef])
}
