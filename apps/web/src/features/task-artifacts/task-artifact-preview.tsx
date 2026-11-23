import { SiteShareButton } from "@/features/web-sites/site-share-button"
import { openHtmlPreview } from "@/features/conversations/html-preview-api"

import { useRef } from "react"
import { useTranslation } from "react-i18next"

import { isMacDesktopHost } from "@/adapters/desktop/desktop-adapter"
import { getErrorMessage } from "@/api/error-message"
import {
  getLoginSessionBoundary,
  isLoginSessionCurrent,
} from "@/api/session"
import { notify } from "@/components/feedback/notification"
import { ConversationFilePreview } from "@/features/conversations/conversation-office-preview"

import {
  getTaskArtifactPreviewLink,
  type TaskArtifact,
} from "./task-artifact-api"
import {
  downloadTaskArtifact,
  loadTaskArtifactContent,
  saveTaskArtifactBlob,
} from "./task-artifact-download"

export function TaskArtifactPreview({
  file,
  onClose,
}: {
  file: TaskArtifact
  onClose: () => void
}) {
  const { t } = useTranslation()
  const downloadInFlightRef = useRef(false)

  const runDownload = async (save: () => Promise<void>) => {
    if (downloadInFlightRef.current) return
    const boundary = isMacDesktopHost() ? getLoginSessionBoundary() : null
    downloadInFlightRef.current = true
    try {
      await save()
    } catch (error) {
      if (boundary === null || isLoginSessionCurrent(boundary)) {
        notify.error(getErrorMessage(error, t))
      }
    } finally {
      downloadInFlightRef.current = false
    }
  }

  return (
    <ConversationFilePreview
      file={file}
      loadHtmlPreview={(candidate, signal, sessionId) =>
        openHtmlPreview(file.conversation_id, candidate.id, signal, sessionId)
      }
      toolbarActions={
        <SiteShareButton file={file} conversationId={file.conversation_id} />
      }
      loadContent={(_candidate, signal) =>
        loadTaskArtifactContent(file, signal)
      }
      loadPreviewSource={async (_candidate, signal) => {
        const preview = await getTaskArtifactPreviewLink(file, signal)
        return {
          url: preview.url,
          expiresAt: preview.expires_at,
        }
      }}
      onDownload={(candidate, content) =>
        runDownload(() =>
          saveTaskArtifactBlob(
            new Blob([new Uint8Array(content)], {
              type: candidate.mime_type ?? "application/octet-stream",
            }),
            candidate.name,
            content
          )
        )
      }
      onDownloadSource={() => runDownload(() => downloadTaskArtifact(file))}
      onClose={onClose}
    />
  )
}
