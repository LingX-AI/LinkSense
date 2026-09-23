export const minimumWordPreviewZoom = 0.25
export const maximumWordPreviewZoom = 2

export const wordPreviewHorizontalPadding = 40

export function getWordPreviewPageWidth(
  surface: HTMLElement,
  zoom: number
): number {
  return Math.max(
    0,
    ...Array.from(surface.querySelectorAll<HTMLElement>(".layout-page")).map(
      (page) => page.offsetWidth || page.getBoundingClientRect().width / zoom
    )
  )
}

export function clampWordPreviewZoom(value: number) {
  return Math.min(
    maximumWordPreviewZoom,
    Math.max(minimumWordPreviewZoom, value)
  )
}

export function calculateWordPreviewFitZoom(
  availableWidth: number,
  pageWidth: number
) {
  if (
    !Number.isFinite(availableWidth) ||
    !Number.isFinite(pageWidth) ||
    availableWidth <= wordPreviewHorizontalPadding ||
    pageWidth <= 0
  ) {
    return null
  }

  return clampWordPreviewZoom(
    Math.min(1, (availableWidth - wordPreviewHorizontalPadding) / pageWidth)
  )
}
