import { useState } from "react"
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
import { projectConversationForSharing } from "@/features/conversations/conversation-share-content"
import { ConversationThread } from "@/features/conversations/conversation-thread"
import type { ConversationHistoryControl } from "@/features/conversations/conversation-message-list"

export function ConversationShareDialog({
  conversation,
  open,
  onOpenChange,
  history,
}: Readonly<{
  conversation: Conversation
  open: boolean
  onOpenChange: (open: boolean) => void
  history?: ConversationHistoryControl
}>) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState<string | null>(null)
  const [shareUrlPath, setShareUrlPath] = useState<string | null>(null)
  const createShareMutation = useMutation({
    mutationFn: () =>
      apiRequest(`/conversations/${conversation.id}/share`, {
        method: "POST",
        schema: conversationShareReceiptSchema,
      }),
  })

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      onOpenChange(true)
      return
    }
    setCopied(false)
    setCopyError(null)
    setShareUrlPath(null)
    createShareMutation.reset()
    onOpenChange(false)
  }

  const copyLink = async () => {
    setCopied(false)
    setCopyError(null)
    let urlPath = shareUrlPath
    if (!urlPath) {
      try {
        urlPath = (await createShareMutation.mutateAsync()).url_path
        setShareUrlPath(urlPath)
      } catch (error) {
        setCopyError(getErrorMessage(error, t))
        return
      }
    }
    try {
      await copyConversationShareUrl(buildConversationShareUrl(urlPath))
      setCopied(true)
    } catch {
      setCopied(false)
      setCopyError(t("conversation.share.copyFailed"))
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="conversation-share-dialog"
        closeLabel={t("common.close")}
        overlayClassName="conversation-share-dialog-overlay"
      >
        <DialogHeader className="conversation-share-dialog-header">
          <DialogTitle className="conversation-share-dialog-title">
            {t("conversation.share.title", { title: conversation.title })}
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
            history={history}
            conversation={projectConversationForSharing(conversation)}
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
            disabled={createShareMutation.isPending}
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
