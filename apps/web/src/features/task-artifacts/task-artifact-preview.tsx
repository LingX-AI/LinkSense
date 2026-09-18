import { SiteShareButton } from "@/features/web-sites/site-share-button"

import { useRef } from "react"
import { useTranslation } from "react-i18next"

import { downloadApiFile } from "@/api/client"
import { getErrorMessage } from "@/api/error-message"
import { notify } from "@/components/feedback/notification"
import { ConversationFilePreview } from "@/features/conversations/conversation-office-preview"
import { downloadBlob } from "@/lib/download-blob"

import {
  getTaskArtifactPreviewLink,
  type TaskArtifact,
} from "./task-artifact-api"

export function TaskArtifactPreview({
  file,
  onClose,
}: {
  file: TaskArtifact
  onClose: () => void
}) {
  const { t } = useTranslation()
  const downloadInFlightRef = useRef(false)

  const download = async () => {
    if (downloadInFlightRef.current) return
    downloadInFlightRef.current = true
    try {
      const blob = await downloadApiFile(
        `/conversations/${file.conversation_id}/files/${file.id}/download`
      )
      downloadBlob(blob, file.name)
    } catch (error) {
      notify.error(getErrorMessage(error, t))
    } finally {
      downloadInFlightRef.current = false
    }
  }

  return (
    <ConversationFilePreview
      file={file}
      toolbarActions={
        <SiteShareButton file={file} conversationId={file.conversation_id} />
      }
      loadContent={async (candidate, signal) => {
        const blob = await downloadApiFile(
          `/conversations/${file.conversation_id}/files/${candidate.id}/content`,
          undefined,
          signal
        )
        return new Uint8Array(await blob.arrayBuffer())
      }}
      loadPreviewSource={async (_candidate, signal) => {
        const preview = await getTaskArtifactPreviewLink(file, signal)
        return {
          url: preview.url,
          expiresAt: preview.expires_at,
        }
      }}
      onDownload={(candidate, content) => {
        downloadBlob(
          new Blob([new Uint8Array(content)], {
            type: candidate.mime_type ?? "application/octet-stream",
          }),
          candidate.name
        )
      }}
      onDownloadSource={() => download()}
      onClose={onClose}
    />
  )
}
