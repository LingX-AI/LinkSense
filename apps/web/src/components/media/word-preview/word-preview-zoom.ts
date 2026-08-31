export const minimumWordPreviewZoom = 0.25
export const maximumWordPreviewZoom = 2

const fitWidthHorizontalPadding = 40

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
    availableWidth <= fitWidthHorizontalPadding ||
    pageWidth <= 0
  ) {
    return null
  }

  return clampWordPreviewZoom(
    Math.min(1, (availableWidth - fitWidthHorizontalPadding) / pageWidth)
  )
}
