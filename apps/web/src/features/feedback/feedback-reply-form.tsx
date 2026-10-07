import { useId, useRef, useState, type ReactNode } from "react"
import {
  FEEDBACK_MAX_CONTENT_LENGTH,
  FEEDBACK_MAX_IMAGES,
  FEEDBACK_MAX_IMAGE_SIZE_BYTES,
  feedbackImageMimeTypeSchema,
  feedbackReplyInputSchema,
} from "@linksense/shared"
import { ImagePlusIcon, SendIcon } from "lucide-react"
import { useTranslation } from "react-i18next"
import { getErrorMessage } from "@/api/error-message"
import { notify } from "@/components/feedback/notification"
import { StatusBanner } from "@/components/feedback/status-banner"
import { FieldShell } from "@/components/forms/form-field"
import { FieldGroup } from "@/components/ui/field"
import { DialogFooter } from "@/components/ui/dialog"
import { Separator } from "@/components/ui/separator"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Spinner } from "@/components/ui/spinner"
import { FeedbackImageSelection } from "./feedback-image-selection"
import { useReplyToFeedback } from "./queries"

export function FeedbackReplyForm({
  feedbackId,
  children,
  onReplySent,
}: {
  feedbackId: string
  children: ReactNode
  onReplySent: () => void
}) {
  const { t } = useTranslation()
  const contentId = useId()
  const imagesId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const nextImageId = useRef(0)
  const submitting = useRef(false)
  const [content, setContent] = useState("")
  const [images, setImages] = useState<{ id: number; file: File }[]>([])
  const [imageError, setImageError] = useState<string | null>(null)
  const reply = useReplyToFeedback(feedbackId)
  const valid = feedbackReplyInputSchema.safeParse({
    content,
    image_count: images.length,
  }).success
  const addImages = (files: readonly File[]) => {
    if (!files.length || reply.isPending) return
    if (images.length + files.length > FEEDBACK_MAX_IMAGES) {
      setImageError(
        t("support.feedbackImageCountError", { count: FEEDBACK_MAX_IMAGES })
      )
      return
    }
    if (
      files.some(
        (file) =>
          !feedbackImageMimeTypeSchema.safeParse(file.type).success ||
          file.size <= 0 ||
          file.size > FEEDBACK_MAX_IMAGE_SIZE_BYTES
      )
    ) {
      setImageError(t("support.feedbackImageInvalid"))
      return
    }
    setImages((current) => [
      ...current,
      ...files.map((file) => ({ id: nextImageId.current++, file })),
    ])
    setImageError(null)
  }
  return (
    <form
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
      onSubmit={async (event) => {
        event.preventDefault()
        if (!valid || submitting.current) return
        submitting.current = true
        try {
          await reply.mutateAsync({
            content: content.trim(),
            images: images.map((image) => image.file),
          })
          notify.success(t("myFeedback.replySuccess"))
          onReplySent()
        } catch {
          // Keep the draft available while the mutation error is displayed.
        } finally {
          submitting.current = false
        }
      }}
    >
      <div
        data-slot="feedback-dialog-body"
        className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto overscroll-contain px-6 pb-6"
      >
        {children}
        <Separator />
        <FieldGroup>
          <FieldShell
            id={contentId}
            required={images.length === 0}
            label={t("myFeedback.writeReply")}
            hint={t("myFeedback.replyHint")}
          >
            <Textarea
              id={contentId}
              aria-required={images.length === 0 || undefined}
              value={content}
              disabled={reply.isPending}
              maxLength={FEEDBACK_MAX_CONTENT_LENGTH}
              rows={4}
              placeholder={t("myFeedback.replyPlaceholder")}
              onChange={(event) => setContent(event.target.value)}
              onPaste={(event) => {
                const files = Array.from(event.clipboardData.files).filter(
                  (file) => file.type.startsWith("image/")
                )
                if (files.length) {
                  event.preventDefault()
                  addImages(files)
                }
              }}
            />
          </FieldShell>
          <FieldShell
            id={imagesId}
            label={t("myFeedback.replyImages")}
            hint={t("support.feedbackImagesHint", {
              count: FEEDBACK_MAX_IMAGES,
              size: 5,
            })}
          >
            <Input
              id={imagesId}
              ref={inputRef}
              type="file"
              className="sr-only"
              accept={feedbackImageMimeTypeSchema.options.join(",")}
              multiple
              disabled={reply.isPending}
              onChange={(event) => {
                addImages(Array.from(event.target.files ?? []))
                event.target.value = ""
              }}
            />
            <Button
              type="button"
              variant="outline"
              className="self-start"
              disabled={reply.isPending || images.length >= FEEDBACK_MAX_IMAGES}
              onClick={() => inputRef.current?.click()}
            >
              <ImagePlusIcon data-icon="inline-start" />
              {t("support.addFeedbackImages")}
            </Button>
            {images.length > 0 && (
              <ul
                className="grid grid-cols-3 gap-2 sm:grid-cols-5"
                aria-label={t("support.selectedFeedbackImages")}
              >
                {images.map((image) => (
                  <FeedbackImageSelection
                    key={image.id}
                    image={image}
                    disabled={reply.isPending}
                    removeLabel={t("support.removeFeedbackImage", {
                      name: image.file.name,
                    })}
                    onRemove={() => {
                      setImages((current) =>
                        current.filter((entry) => entry.id !== image.id)
                      )
                      setImageError(null)
                    }}
                  />
                ))}
              </ul>
            )}
          </FieldShell>
        </FieldGroup>
        {imageError && (
          <StatusBanner variant="error">{imageError}</StatusBanner>
        )}
        {reply.isError && (
          <StatusBanner variant="error">
            {getErrorMessage(reply.error, t)}
          </StatusBanner>
        )}
      </div>
      <DialogFooter className="shrink-0 border-t border-divider px-6 py-4">
        <Button type="submit" disabled={!valid || reply.isPending}>
          {reply.isPending ? (
            <Spinner data-icon="inline-start" />
          ) : (
            <SendIcon data-icon="inline-start" />
          )}
          {t(
            reply.isPending ? "myFeedback.sendingReply" : "myFeedback.sendReply"
          )}
        </Button>
      </DialogFooter>
    </form>
  )
}
