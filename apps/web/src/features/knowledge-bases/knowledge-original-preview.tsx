import { useCallback, useState } from "react"
import { DownloadIcon, ImageOffIcon, LoaderCircleIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import {
  downloadKnowledgeDocument,
  loadKnowledgeCitationOriginal,
  loadKnowledgeDocumentPreview,
} from "@/features/knowledge-bases/knowledge-base-api"
import type { KnowledgeDocument } from "@/features/knowledge-bases/knowledge-base-contracts"
import { KnowledgeFileViewer } from "@/features/knowledge-bases/knowledge-file-viewer"
import { getErrorMessage } from "@/api/error-message"
import { downloadBlob } from "@/lib/download-blob"

export function KnowledgeOriginalPreview({
  knowledgeBaseId,
  document,
  documentVersionId,
}: {
  knowledgeBaseId: string
  document: KnowledgeDocument
  documentVersionId?: string
}) {
  const loadFile = useCallback(
    (signal: AbortSignal) =>
      loadKnowledgeDocumentPreview(
        knowledgeBaseId,
        document.id,
        documentVersionId,
        signal
      ),
    [document.id, documentVersionId, knowledgeBaseId]
  )

  if (document.preview.renderer !== "file") return null

  return (
    <div className="knowledge-file-preview">
      <KnowledgeFileViewer
        filename={document.display_name}
        mimeType={document.mime_type}
        loadFile={loadFile}
        sourceKey={`${knowledgeBaseId}:${document.id}:${documentVersionId ?? document.current_version_id ?? "current"}`}
      />
    </div>
  )
}

export function KnowledgeCitationOriginalPreview({
  citationId,
  renderer,
  documentName,
}: {
  citationId: string
  renderer: "file"
  documentName: string
}) {
  const loadFile = useCallback(
    (signal: AbortSignal) => loadKnowledgeCitationOriginal(citationId, signal),
    [citationId]
  )

  if (renderer !== "file") return null

  return (
    <div className="knowledge-file-preview">
      <KnowledgeFileViewer
        filename={documentName}
        loadFile={loadFile}
        sourceKey={`citation:${citationId}`}
      />
    </div>
  )
}

export function KnowledgeDownloadButton({
  knowledgeBaseId,
  document,
  variant = "outline",
  documentVersionId,
  onDownloadErrorChange,
}: {
  knowledgeBaseId: string
  document: KnowledgeDocument
  variant?: "outline" | "secondary" | "ghost"
  documentVersionId?: string
  onDownloadErrorChange: (message: string | null) => void
}) {
  const { t } = useTranslation()
  const [downloading, setDownloading] = useState(false)

  return (
    <Button
      type="button"
      variant={variant}
      disabled={downloading}
      onClick={() => {
        setDownloading(true)
        onDownloadErrorChange(null)
        void downloadKnowledgeDocument(
          knowledgeBaseId,
          document.id,
          documentVersionId
        )
          .then((blob) => downloadBlob(blob, document.display_name))
          .catch((error) => onDownloadErrorChange(getErrorMessage(error, t)))
          .finally(() => setDownloading(false))
      }}
    >
      {downloading ? (
        <LoaderCircleIcon data-icon="inline-start" aria-hidden="true" />
      ) : (
        <DownloadIcon data-icon="inline-start" aria-hidden="true" />
      )}
      {t("knowledge.preview.downloadOriginal")}
    </Button>
  )
}

export function KnowledgeOriginalUnavailableIcon() {
  return <ImageOffIcon aria-hidden="true" />
}
