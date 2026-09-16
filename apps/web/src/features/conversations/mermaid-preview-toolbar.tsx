import {
  CheckIcon,
  CopyIcon,
  DownloadIcon,
  LoaderCircleIcon,
  MinusIcon,
  PlusIcon,
} from "lucide-react"
import { useTranslation } from "react-i18next"
import type { ImagePreviewControls } from "@/components/media/image-preview"
import {
  ImagePreviewToolbar,
  ImagePreviewToolbarButton,
} from "@/components/media/image-preview-toolbar"

export function MermaidPreviewToolbar({
  controls,
  copied,
  copying,
  exporting,
  onCopy,
  onExport,
}: Readonly<{
  controls: ImagePreviewControls
  copied: boolean
  copying: boolean
  exporting: boolean
  onCopy: () => void
  onExport: () => void
}>) {
  const { t, i18n } = useTranslation()
  const copyLabel = t(
    copied ? "conversation.codeCopied" : "conversation.diagram.copy"
  )
  return (
    <ImagePreviewToolbar label={t("conversation.diagram.actions")}>
      <ImagePreviewToolbarButton
        aria-label={t("conversation.diagram.zoomOut")}
        title={t("conversation.diagram.zoomOut")}
        disabled={controls.zoom <= controls.minimumZoom}
        onClick={controls.zoomOut}
      >
        <MinusIcon aria-hidden="true" />
      </ImagePreviewToolbarButton>
      <ImagePreviewToolbarButton
        size="sm"
        className="image-preview-zoom-value"
        aria-label={t("conversation.diagram.resetZoom")}
        title={t("conversation.diagram.resetZoom")}
        onClick={controls.resetZoom}
      >
        {new Intl.NumberFormat(i18n.resolvedLanguage, {
          style: "percent",
        }).format(controls.zoom / 100)}
      </ImagePreviewToolbarButton>
      <ImagePreviewToolbarButton
        aria-label={t("conversation.diagram.zoomIn")}
        title={t("conversation.diagram.zoomIn")}
        disabled={controls.zoom >= controls.maximumZoom}
        onClick={controls.zoomIn}
      >
        <PlusIcon aria-hidden="true" />
      </ImagePreviewToolbarButton>
      <ImagePreviewToolbarButton
        aria-label={copyLabel}
        title={copyLabel}
        disabled={copying}
        onClick={onCopy}
      >
        {copied ? (
          <CheckIcon aria-hidden="true" />
        ) : (
          <CopyIcon aria-hidden="true" />
        )}
      </ImagePreviewToolbarButton>
      <ImagePreviewToolbarButton
        aria-label={t("conversation.diagram.export")}
        title={t("conversation.diagram.export")}
        disabled={exporting}
        onClick={onExport}
      >
        {exporting ? (
          <LoaderCircleIcon className="animate-spin" aria-hidden="true" />
        ) : (
          <DownloadIcon aria-hidden="true" />
        )}
      </ImagePreviewToolbarButton>
    </ImagePreviewToolbar>
  )
}
