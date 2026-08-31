import { LoaderCircleIcon, XIcon } from "lucide-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"

import type { ConversationFile } from "@/api/contracts"
import { FileTypeIcon } from "@/components/media/file-type-icon"
import { Button } from "@/components/ui/button"
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card"
import { cn } from "@/lib/utils"

export type ConversationAttachmentOverflowItem =
  | Readonly<{
      key: string
      status: "uploaded"
      name: string
      size?: number
      mimeType?: string | null
      file: ConversationFile
    }>
  | Readonly<{
      key: string
      status: "uploading"
      name: string
      size?: number
      mimeType?: string | null
    }>

export function ConversationAttachmentOverflow({
  items,
  hiddenCount,
  triggerClassName,
  side = "top",
  disabled = false,
  onRemove,
  onClearAll,
}: Readonly<{
  items: readonly ConversationAttachmentOverflowItem[]
  hiddenCount: number
  triggerClassName?: string
  side?: "top" | "bottom"
  disabled?: boolean
  onRemove?: (file: ConversationFile) => void
  onClearAll?: (files: readonly ConversationFile[]) => Promise<unknown> | void
}>) {
  const { t } = useTranslation()
  const [clearing, setClearing] = useState(false)
  const clearAllDisabled =
    disabled || clearing || items.some((item) => item.status === "uploading")

  const clearAll = async () => {
    if (!onClearAll || clearAllDisabled) return
    setClearing(true)
    try {
      await onClearAll(
        items.flatMap((item) => (item.status === "uploaded" ? [item.file] : []))
      )
    } catch {
      // The owning mutation reports the user-facing error.
    } finally {
      setClearing(false)
    }
  }

  if (hiddenCount <= 0) return null

  return (
    <HoverCard>
      <HoverCardTrigger
        render={
          <Button
            type="button"
            variant="secondary"
            size="default"
            className={cn("attachment-overflow-trigger", triggerClassName)}
            aria-label={t("conversation.attachmentOverflowLabel", {
              count: items.length,
            })}
          />
        }
      >
        {`+${hiddenCount}`}
      </HoverCardTrigger>
      <HoverCardContent
        side={side}
        align="end"
        sideOffset={10}
        className="attachment-overflow-content"
        aria-label={t("conversation.attachmentListTitle", {
          count: items.length,
        })}
      >
        <div className="attachment-overflow-header">
          <p className="attachment-overflow-title">
            {t("conversation.attachmentListTitle", { count: items.length })}
          </p>
          {onClearAll && (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              disabled={clearAllDisabled}
              onClick={() => void clearAll()}
            >
              {t("conversation.clearAllAttachments")}
            </Button>
          )}
        </div>
        <ul className="attachment-overflow-list">
          {items.map((item) => (
            <li key={item.key} className="attachment-overflow-item">
              <FileTypeIcon
                filename={item.name}
                mimeType={item.mimeType}
                className="attachment-overflow-icon"
              />
              <span className="attachment-overflow-name">{item.name}</span>
              {item.status === "uploading" && (
                <span className="attachment-overflow-loading" role="status">
                  <LoaderCircleIcon
                    className="animate-spin"
                    aria-hidden="true"
                  />
                  <span className="sr-only">
                    {t("conversation.attachmentUploadingShort")}
                  </span>
                </span>
              )}
              {item.status === "uploaded" && onRemove && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  className="chip-remove"
                  aria-label={t("conversation.removeAttachment", {
                    name: item.name,
                  })}
                  disabled={disabled}
                  onClick={() => onRemove(item.file)}
                >
                  <XIcon aria-hidden="true" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      </HoverCardContent>
    </HoverCard>
  )
}
