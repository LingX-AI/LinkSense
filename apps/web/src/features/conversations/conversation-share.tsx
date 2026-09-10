import { useEffect, useRef, useState } from "react"
import { useMutation } from "@tanstack/react-query"
import { CheckIcon, LinkIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import { apiRequest } from "@/api/client"
import type { Conversation } from "@/api/contracts"
import { getErrorMessage } from "@/api/error-message"
import { ErrorState } from "@/components/feedback/page-state"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  buildConversationShareUrl,
  conversationShareReceiptSchema,
  copyConversationShareUrl,
} from "@/features/conversations/conversation-share-contracts"
import {
  captureConversationShareSnapshot,
  projectConversationShareSnapshot,
} from "@/features/conversations/conversation-share-content"
import { ConversationThread } from "@/features/conversations/conversation-thread"

export function ConversationShareDialog({
  conversation,
  open,
  onOpenChange,
}: Readonly<{
  conversation: Conversation
  open: boolean
  onOpenChange: (open: boolean) => void
}>) {
  // Mount a fresh session on every opening, including externally controlled
  // closes. Late requests from an old session cannot replace its successor.
  if (!open) return null
  return (
    <ConversationShareSession
      key={conversation.id}
      conversation={conversation}
      onOpenChange={onOpenChange}
    />
  )
}

function ConversationShareSession({
  conversation,
  onOpenChange,
}: Readonly<{
  conversation: Conversation
  onOpenChange: (open: boolean) => void
}>) {
  const { t } = useTranslation()
  const [snapshot] = useState(() =>
    captureConversationShareSnapshot(conversation)
  )
  const [preview] = useState(() => projectConversationShareSnapshot(snapshot))
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState<string | null>(null)
  const [shareUrlPath, setShareUrlPath] = useState<string | null>(null)
  const active = useRef(true)
  useEffect(() => {
    active.current = true
    return () => {
      active.current = false
    }
  }, [])
  const createShareMutation = useMutation({
    mutationFn: () =>
      apiRequest(`/conversations/${snapshot.conversation.id}/share`, {
        method: "POST",
        body: { snapshot },
        schema: conversationShareReceiptSchema,
      }),
  })

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      onOpenChange(true)
      return
    }
    active.current = false
    onOpenChange(false)
  }

  const copyLink = async () => {
    setCopied(false)
    setCopyError(null)
    let urlPath = shareUrlPath
    if (!urlPath) {
      try {
        urlPath = (await createShareMutation.mutateAsync()).url_path
        if (!active.current) return
        setShareUrlPath(urlPath)
      } catch (error) {
        if (!active.current) return
        setCopyError(getErrorMessage(error, t))
        return
      }
    }
    try {
      await copyConversationShareUrl(buildConversationShareUrl(urlPath))
      if (!active.current) return
      setCopied(true)
    } catch {
      if (!active.current) return
      setCopied(false)
      setCopyError(t("conversation.share.copyFailed"))
    }
  }

  return (
    <Dialog open onOpenChange={handleOpenChange}>
      <DialogContent
        className="conversation-share-dialog"
        closeLabel={t("common.close")}
        overlayClassName="conversation-share-dialog-overlay"
      >
        <DialogHeader className="conversation-share-dialog-header">
          <DialogTitle className="conversation-share-dialog-title">
            {t("conversation.share.title", { title: preview.title })}
          </DialogTitle>
          <DialogDescription className="conversation-share-dialog-description">
            {t("conversation.share.description")}
          </DialogDescription>
        </DialogHeader>

        <div
          className="conversation-share-preview"
          aria-label={t("conversation.share.previewLabel")}
        >
          <ConversationThread
            conversation={preview}
            onDownload={() => undefined}
            editingDisabled
            embedded
            hideMessageActions
          />
        </div>

        <div className="conversation-share-dialog-footer">
          <p>{t("conversation.share.anyoneWithLink")}</p>
          <Button
            type="button"
            variant="outline"
            className="conversation-share-copy-button"
            disabled={
              createShareMutation.isPending || snapshot.messages.length === 0
            }
            onClick={() => void copyLink()}
          >
            {copied ? (
              <CheckIcon className="size-3" aria-hidden="true" />
            ) : (
              <LinkIcon className="size-3" aria-hidden="true" />
            )}
            {t(
              copied
                ? "conversation.share.copied"
                : "conversation.share.copyLink"
            )}
          </Button>
        </div>
        {copyError && (
          <div className="conversation-share-error">
            <ErrorState message={copyError} />
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
