export const htmlPreviewZoomMessageType = "linksense:html-preview:zoom"
export const htmlPreviewReadyMessageType = "linksense:html-preview:ready"

export type HtmlPreviewReadyResponse = Readonly<{
  type: typeof htmlPreviewReadyMessageType
  deferredFit: boolean
}>

const minimumHtmlPreviewZoom = 0.5
const maximumHtmlPreviewZoom = 2
const minimumHtmlPreviewViewportWidth = 32
const htmlPreviewMeasurementTolerance = 0.5
const minimumHtmlPreviewPageWidthRatio = 0.5

export const htmlPreviewCurrentPageSelector = [
  ".slide.active",
  ".slide.visible",
  "[data-slide].active",
  "[data-page].active",
  '[aria-current="page"]',
].join(",")

function intersectsHtmlPreviewViewport(
  bounds: DOMRect,
  rootBounds: DOMRect,
  viewportWidth: number,
  viewportHeight: number
) {
  return (
    bounds.right > rootBounds.left &&
    bounds.left < rootBounds.left + viewportWidth &&
    (viewportHeight <= 0 ||
      (bounds.bottom > rootBounds.top &&
        bounds.top < rootBounds.top + viewportHeight))
  )
}

function isVisibleHtmlPreviewElement(
  document: Document,
  element: Element,
  bounds: DOMRect,
  rootBounds: DOMRect,
  viewportWidth: number,
  viewportHeight: number
) {
  if (
    !Number.isFinite(bounds.left) ||
    !Number.isFinite(bounds.right) ||
    !Number.isFinite(bounds.top) ||
    !Number.isFinite(bounds.bottom) ||
    (bounds.width === 0 && bounds.height === 0) ||
    !intersectsHtmlPreviewViewport(
      bounds,
      rootBounds,
      viewportWidth,
      viewportHeight
    )
  ) {
    return false
  }

  const style = document.defaultView?.getComputedStyle(element)
  return (
    style?.display !== "none" &&
    style?.visibility !== "hidden" &&
    style?.visibility !== "collapse" &&
    style?.opacity !== "0"
  )
}

function visibleHtmlContentWidth(
  document: Document,
  viewportWidth: number,
  viewportHeight: number
) {
  const rootBounds = document.documentElement.getBoundingClientRect()

  for (const element of document.querySelectorAll(
    htmlPreviewCurrentPageSelector
  )) {
    const bounds = element.getBoundingClientRect()
    if (
      isVisibleHtmlPreviewElement(
        document,
        element,
        bounds,
        rootBounds,
        viewportWidth,
        viewportHeight
      ) &&
      bounds.width >= viewportWidth * minimumHtmlPreviewPageWidthRatio
    ) {
      return Math.max(viewportWidth, bounds.width)
    }
  }

  let hasVisibleContent = false
  let closestVisibleWidth = Number.POSITIVE_INFINITY

  for (const element of document.body?.querySelectorAll("*") ?? []) {
    if (element.closest("[data-linksense-overlay-root]")) continue
    const bounds = element.getBoundingClientRect()
    if (
      !isVisibleHtmlPreviewElement(
        document,
        element,
        bounds,
        rootBounds,
        viewportWidth,
        viewportHeight
      )
    ) {
      continue
    }
    hasVisibleContent = true
    if (bounds.width + htmlPreviewMeasurementTolerance >= viewportWidth) {
      closestVisibleWidth = Math.min(closestVisibleWidth, bounds.width)
    }
  }

  if (!hasVisibleContent) return null
  return Number.isFinite(closestVisibleWidth)
    ? Math.max(viewportWidth, closestVisibleWidth)
    : viewportWidth
}

export function boundHtmlPreviewZoom(zoom: number) {
  return Math.min(
    maximumHtmlPreviewZoom,
    Math.max(minimumHtmlPreviewZoom, zoom)
  )
}

/**
 * Treats 100% as fit-to-width. The user zoom is applied relative to that
 * fitted baseline, so fixed-width HTML remains fully visible at 100%.
 */
export function fitHtmlDocumentToViewport(document: Document, zoom: number) {
  const root = document.documentElement
  const body = document.body
  root.style.setProperty("zoom", "1")
  const viewportWidth = Math.max(
    0,
    root.clientWidth || document.defaultView?.innerWidth || 0
  )
  const viewportHeight = Math.max(
    0,
    root.clientHeight || document.defaultView?.innerHeight || 0
  )
  const boundedZoom = boundHtmlPreviewZoom(zoom)

  // An iframe can be mounted before its flex parent receives a real layout
  // width. Treating that as a 1px viewport would collapse fixed-width HTML
  // into an almost invisible canvas. The host retries after layout settles.
  if (viewportWidth < minimumHtmlPreviewViewportWidth) {
    root.style.setProperty("zoom", String(boundedZoom))
    root.dataset.linksenseFitScale = "1"
    root.dataset.linksenseAppliedScale = String(boundedZoom)
    return { fitScale: 1, appliedScale: boundedZoom }
  }

  const visibleContentWidth = visibleHtmlContentWidth(
    document,
    viewportWidth,
    viewportHeight
  )
  const contentWidth =
    visibleContentWidth ??
    Math.max(
      viewportWidth,
      root.scrollWidth,
      root.offsetWidth,
      body?.scrollWidth ?? 0,
      body?.offsetWidth ?? 0
    )
  const fitScale = Math.min(1, viewportWidth / contentWidth)
  const appliedScale = fitScale * boundedZoom

  root.style.setProperty("zoom", String(appliedScale))
  root.dataset.linksenseFitScale = String(fitScale)
  root.dataset.linksenseAppliedScale = String(appliedScale)

  return { fitScale, appliedScale }
}

export function postHtmlPreviewZoom(frame: HTMLIFrameElement, zoom: number) {
  frame.contentWindow?.postMessage(
    {
      type: htmlPreviewZoomMessageType,
      zoom: boundHtmlPreviewZoom(zoom),
    },
    "*"
  )
}

export function isHtmlPreviewReadyResponse(
  value: unknown
): value is HtmlPreviewReadyResponse {
  if (typeof value !== "object" || value === null) return false
  const candidate = value as Partial<HtmlPreviewReadyResponse>
  return (
    candidate.type === htmlPreviewReadyMessageType &&
    typeof candidate.deferredFit === "boolean"
  )
}
