import { forwardRef, useState, type ReactNode } from "react"
import {
  createLucideIcon,
  DownloadIcon,
  RefreshCwIcon,
  XIcon,
} from "lucide-react"
import { useTranslation } from "react-i18next"

import { FileTypeIcon } from "@/components/media/file-type-icon"
import { OfficePreviewFullscreenContext } from "@/components/media/office-preview/office-preview-fullscreen-context"
import { OfficePreviewLoadingState } from "@/components/media/office-preview/office-preview-loading-state"
import type {
  OfficeDocumentState,
  OfficePreviewUpdateAction,
} from "@/components/media/office-preview/office-preview.types"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

const EnterFullscreenIcon = createLucideIcon(
  "office-preview-enter-fullscreen",
  [
    ["path", { d: "M15 3h6v6", key: "enter-top-right" }],
    ["path", { d: "M9 21H3v-6", key: "enter-bottom-left" }],
  ]
)

const ExitFullscreenIcon = createLucideIcon("office-preview-exit-fullscreen", [
  ["path", { d: "M20 10h-6V4", key: "exit-top-right" }],
  ["path", { d: "M4 14h6v6", key: "exit-bottom-left" }],
])

type OfficePreviewShellDocument =
  OfficeDocumentState | Readonly<{ status: "loading" | "error" | "ready" }>

export const OfficePreviewShell = forwardRef<
  HTMLElement,
  Readonly<{
    document: OfficePreviewShellDocument
    fileName: string
    mimeType: string
    controls?: ReactNode
    floatingContent?: ReactNode
    children?: ReactNode
    onRetry?: () => void
    onDownload?: () => void
    loadingLabel?: string
    loadFailedLabel?: string
    updateAction?: OfficePreviewUpdateAction
    onClose?: () => void
    className?: string
    bodyClassName?: string
  }>
>(function OfficePreviewShell(
  {
    document,
    fileName,
    mimeType,
    controls,
    floatingContent,
    children,
    onRetry,
    onDownload,
    loadingLabel,
    loadFailedLabel,
    updateAction,
    onClose,
    className,
    bodyClassName,
  },
  ref
) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)

  return (
    <OfficePreviewFullscreenContext.Provider value={expanded}>
      <section
        ref={ref}
        className={cn(
          "office-preview-pane",
          expanded && "office-preview-pane-expanded",
          className
        )}
        data-document-status={document.status}
        aria-label={t("officePreview.previewTitle", { name: fileName })}
      >
        <header className="office-preview-header">
          <div className="office-preview-file-tab" title={fileName}>
            <FileTypeIcon filename={fileName} mimeType={mimeType} />
            <span className="office-preview-file-name">{fileName}</span>
          </div>

          <div className="office-preview-header-actions">
            <div className="office-preview-controls">
              {document.status === "ready" && controls}
            </div>
            <div className="office-preview-window-controls">
              {onDownload && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  className="office-preview-download-button"
                  aria-label={t("officePreview.downloadNamed", {
                    name: fileName,
                  })}
                  onClick={onDownload}
                >
                  <DownloadIcon aria-hidden="true" />
                </Button>
              )}
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className="office-preview-control-button"
                aria-label={t(
                  expanded
                    ? "officePreview.exitFullscreen"
                    : "officePreview.enterFullscreen"
                )}
                onClick={() => setExpanded((current) => !current)}
              >
                {expanded ? (
                  <ExitFullscreenIcon
                    data-icon="inline-start"
                    aria-hidden="true"
                  />
                ) : (
                  <EnterFullscreenIcon
                    data-icon="inline-start"
                    aria-hidden="true"
                  />
                )}
              </Button>
              {onClose && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  className="office-preview-control-button office-preview-close-button"
                  aria-label={t("officePreview.close")}
                  onClick={onClose}
                >
                  <XIcon aria-hidden="true" data-icon="inline-start" />
                </Button>
              )}
            </div>
          </div>
        </header>

        <div className={cn("office-preview-body", bodyClassName)}>
          {document.status === "loading" && (
            <OfficePreviewLoadingState
              label={loadingLabel ?? t("officePreview.loading")}
            />
          )}
          {document.status === "error" && (
            <div className="office-preview-state" role="alert">
              <p>{loadFailedLabel ?? t("officePreview.loadFailed")}</p>
              {onRetry && (
                <Button type="button" variant="secondary" onClick={onRetry}>
                  {t("common.retry")}
                </Button>
              )}
            </div>
          )}
          {document.status === "ready" && children}
          {document.status === "ready" && floatingContent}
          {document.status === "ready" && updateAction && (
            <div className="office-preview-update-notice" aria-live="polite">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="office-preview-update-button"
                aria-label={updateAction.actionLabel}
                onClick={updateAction.onUpdate}
              >
                <RefreshCwIcon data-icon="inline-start" aria-hidden="true" />
                {updateAction.statusLabel}
              </Button>
              {updateAction.onDismiss && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="office-preview-update-dismiss-button"
                  aria-label={updateAction.dismissLabel ?? t("common.close")}
                  onClick={updateAction.onDismiss}
                >
                  <XIcon aria-hidden="true" />
                </Button>
              )}
            </div>
          )}
        </div>
      </section>
    </OfficePreviewFullscreenContext.Provider>
  )
})
