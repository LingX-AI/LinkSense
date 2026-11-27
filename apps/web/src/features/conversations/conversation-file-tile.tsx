import { DownloadIcon, LoaderCircleIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import type { ConversationFile } from "@/api/contracts"
import { FileTypeIcon } from "@/components/media/file-type-icon"
import { Button } from "@/components/ui/button"
import { normalizeLanguage } from "@/i18n"
import { formatDateTime, formatFileSize } from "@/i18n/date"

export function FileTile({
  file,
  artifact,
  onDownload,
  downloading,
}: {
  file: ConversationFile
  artifact?: boolean
  onDownload?: (file: ConversationFile) => void
  downloading?: boolean
}) {
  const { t, i18n } = useTranslation()
  const language = normalizeLanguage(i18n.resolvedLanguage) ?? "zh-CN"
  const label = artifact
    ? t("conversation.downloadArtifact", { name: file.name })
    : file.name
  return (
    <Button
      type="button"
      variant="ghost"
      className={
        artifact ? "artifact-tile file-tile" : "attachment-tile file-tile"
      }
      aria-label={label}
      aria-busy={downloading || undefined}
      disabled={artifact && (!file.download_available || downloading)}
      onClick={() => artifact && onDownload?.(file)}
    >
      <span className="file-icon">
        <FileTypeIcon filename={file.name} mimeType={file.mime_type} />
      </span>
      <span className="min-w-0 flex-1 text-left">
        <span className="file-tile-name block truncate font-medium">
          {file.name}
        </span>
        <span className="file-tile-meta block pt-0.5 text-[var(--app-muted)]">
          {[
            formatFileSize(file.size, language),
            artifact ? null : formatDateTime(file.created_at, language),
          ]
            .filter((value) => value && value !== "—")
            .join(" · ")}
        </span>
      </span>
      {artifact &&
        (downloading ? (
          <LoaderCircleIcon
            className="size-4 animate-spin text-[var(--app-muted)]"
            aria-hidden="true"
          />
        ) : (
          <DownloadIcon
            className="size-4 text-[var(--app-muted)]"
            aria-hidden="true"
          />
        ))}
    </Button>
  )
}
