import { useEffect, useRef } from "react"
import { useTranslation } from "react-i18next"

import { Spinner } from "@/components/ui/spinner"
import { createConversationAttachmentPreviewSource } from "@/features/conversations/conversation-attachment-preview-utils"

export function ConversationAttachmentUploadPreview({
  name,
  file,
}: Readonly<{ name: string; file?: File }>) {
  const { t } = useTranslation()
  const imageRef = useRef<HTMLImageElement>(null)
  const label = t("conversation.attachmentUploadingName", { name })

  useEffect(() => {
    const image = imageRef.current
    if (!file || !image) return
    const source = createConversationAttachmentPreviewSource(file)
    image.hidden = false
    image.src = source.url
    return () => {
      image.removeAttribute("src")
      source.release()
    }
  }, [file])

  return (
    <div className="image-preview-thumbnail">
      <div
        className="image-preview-thumbnail-trigger relative"
        role="status"
        aria-label={label}
      >
        <img
          ref={imageRef}
          alt=""
          width="68"
          height="68"
          hidden={!file}
          referrerPolicy="no-referrer"
          onError={(event) => {
            event.currentTarget.hidden = true
          }}
        />
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-background/20">
          <span className="flex size-7 items-center justify-center rounded-full bg-background/70 text-foreground/50">
            <Spinner className="size-4" />
          </span>
        </span>
        <span className="sr-only">{label}</span>
      </div>
    </div>
  )
}
