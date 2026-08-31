import { MinusIcon, PlusIcon, RotateCcwIcon } from "lucide-react"
import type { ReactNode } from "react"

import { Button } from "@/components/ui/button"

type OfficePreviewZoomControlsProps = Readonly<{
  zoomPercent: number
  zoomOutLabel: string
  zoomInLabel: string
  resetZoomLabel: string
  onZoomOut: () => void
  onZoomIn: () => void
  onResetZoom: () => void
  canZoomOut?: boolean
  canZoomIn?: boolean
  trailing?: ReactNode
}>

/**
 * The viewer libraries expose different zoom APIs, while the preview chrome
 * deliberately stays identical for Excel, PowerPoint, and Word.
 */
export function OfficePreviewZoomControls({
  zoomPercent,
  zoomOutLabel,
  zoomInLabel,
  resetZoomLabel,
  onZoomOut,
  onZoomIn,
  onResetZoom,
  canZoomOut = true,
  canZoomIn = true,
  trailing,
}: OfficePreviewZoomControlsProps) {
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        className="office-preview-control-button"
        aria-label={zoomOutLabel}
        disabled={!canZoomOut}
        onClick={onZoomOut}
      >
        <MinusIcon aria-hidden="true" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="xs"
        className="office-preview-control-button office-preview-zoom-value"
        aria-label={resetZoomLabel}
        onClick={onResetZoom}
      >
        {zoomPercent}%
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        className="office-preview-control-button"
        aria-label={zoomInLabel}
        disabled={!canZoomIn}
        onClick={onZoomIn}
      >
        <PlusIcon aria-hidden="true" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        className="office-preview-control-button office-preview-reset-zoom-button"
        aria-label={resetZoomLabel}
        onClick={onResetZoom}
      >
        <RotateCcwIcon aria-hidden="true" />
      </Button>
      {trailing}
    </>
  )
}
