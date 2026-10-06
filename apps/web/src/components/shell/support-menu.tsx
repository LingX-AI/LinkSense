import {
  useId,
  useRef,
  useState,
  type ClipboardEvent,
  type FormEvent,
} from "react"
import { FeedbackImageSelection } from "@/features/feedback/feedback-image-selection"
import { feedbackKeys } from "@/features/feedback/queries"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import {
  FEEDBACK_MAX_IMAGES,
  FEEDBACK_MAX_IMAGE_SIZE_BYTES,
  feedbackSubmissionResultSchema,
} from "@linksense/shared"
import {
  ImagePlusIcon,
  LifeBuoyIcon,
  MessageSquareTextIcon,
} from "lucide-react"
import { useTranslation } from "react-i18next"
import { useLocation } from "react-router-dom"

import { notify } from "@/components/feedback/notification"
import { StatusBanner } from "@/components/feedback/status-banner"
import { FieldShell } from "@/components/forms/form-field"
import { apiRequest } from "@/api/client"
import { getErrorMessage } from "@/api/error-message"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { DropdownMenuItem } from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Spinner } from "@/components/ui/spinner"
import { normalizeLanguage } from "@/i18n"
import { buildHelpCenterHref } from "@/lib/help-center"
import { shouldAutoFocusOnDesktop } from "@/lib/responsive"

type SupportMenuItemsProps = {
  onFeedback: () => void
}

type FeedbackDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

type SelectedFeedbackImage = {
  id: number
  file: File
}

const acceptedFeedbackImageTypes = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
])

export function SupportMenuItems({ onFeedback }: SupportMenuItemsProps) {
  const { t, i18n } = useTranslation()
  const location = useLocation()
  const language = normalizeLanguage(i18n.resolvedLanguage) ?? "zh-CN"
  const helpCenterHref = buildHelpCenterHref(
    location.pathname,
    language,
    location.search
  )

  return (
    <>
      <DropdownMenuItem
        className="text-[length:var(--app-ui-font-size)]"
        render={
          <a
            href={helpCenterHref}
            target="_blank"
            rel="noreferrer noopener"
            aria-label={t("nav.helpCenterNewTab")}
          />
        }
      >
        <LifeBuoyIcon aria-hidden="true" />
        {t("support.help")}
      </DropdownMenuItem>
      <DropdownMenuItem
        className="text-[length:var(--app-ui-font-size)]"
        onClick={onFeedback}
      >
        <MessageSquareTextIcon aria-hidden="true" />
        {t("support.feedback")}
      </DropdownMenuItem>
    </>
  )
}

export function FeedbackDialog({ open, onOpenChange }: FeedbackDialogProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const feedbackId = useId()
  const feedbackImagesId = useId()
  const imageInputRef = useRef<HTMLInputElement | null>(null)
  const nextImageIdRef = useRef(0)
  const [feedback, setFeedback] = useState("")
  const [images, setImages] = useState<SelectedFeedbackImage[]>([])
  const [imageError, setImageError] = useState<string | null>(null)
  const normalizedFeedback = feedback.trim()
  const submission = useMutation({
    mutationFn: async () => {
      const body = new FormData()
      body.append("content", normalizedFeedback)
      for (const image of images) body.append("images", image.file)
      return apiRequest("/feedback", {
        method: "POST",
        body,
        schema: feedbackSubmissionResultSchema,
      })
    },
  })

  const resetFeedback = () => {
    setFeedback("")
    setImages([])
    setImageError(null)
    submission.reset()
    if (imageInputRef.current) imageInputRef.current.value = ""
  }

  const handleFeedbackSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!normalizedFeedback || submission.isPending) return

    try {
      await submission.mutateAsync()
      await queryClient.invalidateQueries({ queryKey: feedbackKeys.all })
      resetFeedback()
      onOpenChange(false)
      notify.success(t("support.feedbackSubmitted"), {
        id: "support-feedback-submitted",
      })
    } catch {
      // The mutation error is rendered below while preserving the draft.
    }
  }

  const addImages = (files: FileList | readonly File[] | null) => {
    if (!files || files.length === 0) return
    const additions = Array.from(files)
    if (images.length + additions.length > FEEDBACK_MAX_IMAGES) {
      setImageError(
        t("support.feedbackImageCountError", { count: FEEDBACK_MAX_IMAGES })
      )
      if (imageInputRef.current) imageInputRef.current.value = ""
      return
    }
    if (
      additions.some(
        (file) =>
          !acceptedFeedbackImageTypes.has(file.type) ||
          file.size <= 0 ||
          file.size > FEEDBACK_MAX_IMAGE_SIZE_BYTES
      )
    ) {
      setImageError(t("support.feedbackImageInvalid"))
      if (imageInputRef.current) imageInputRef.current.value = ""
      return
    }
    setImages((current) => [
      ...current,
      ...additions.map((file) => ({
        id: nextImageIdRef.current++,
        file,
      })),
    ])
    setImageError(null)
    submission.reset()
    if (imageInputRef.current) imageInputRef.current.value = ""
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(open) => {
        if (!open && submission.isPending) return
        onOpenChange(open)
        if (!open) resetFeedback()
      }}
    >
      <DialogContent
        closeLabel={t("common.close")}
        className="flex max-h-[calc(100dvh-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-xl"
      >
        <DialogHeader className="shrink-0 px-6 pt-6 pr-14 pb-5">
          <DialogTitle>{t("support.feedbackTitle")}</DialogTitle>
          <DialogDescription>
            {t("support.feedbackDescription")}
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex min-h-0 flex-1 flex-col overflow-hidden"
          onSubmit={(event) => void handleFeedbackSubmit(event)}
        >
          <div
            data-slot="feedback-dialog-body"
            className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto overscroll-contain px-6 pb-6"
          >
            <FieldShell id={feedbackId} label={t("support.feedbackLabel")}>
              <Textarea
                id={feedbackId}
                value={feedback}
                rows={6}
                maxLength={2_000}
                autoFocus={shouldAutoFocusOnDesktop()}
                placeholder={t("support.feedbackPlaceholder")}
                aria-invalid={submission.isError || undefined}
                disabled={submission.isPending}
                onChange={(event) => {
                  setFeedback(event.target.value)
                  submission.reset()
                }}
                onPaste={(event) => {
                  const clipboardImages = getClipboardImages(event)
                  if (clipboardImages.length === 0) return

                  addImages(clipboardImages)
                  const includesText = Array.from(
                    event.clipboardData.items
                  ).some(
                    (item) =>
                      item.kind === "string" && item.type === "text/plain"
                  )
                  if (!includesText) event.preventDefault()
                }}
              />
            </FieldShell>
            <FieldShell
              id={feedbackImagesId}
              label={t("support.feedbackImagesLabel")}
              hint={t("support.feedbackImagesHint", {
                count: FEEDBACK_MAX_IMAGES,
                size: FEEDBACK_MAX_IMAGE_SIZE_BYTES / 1024 / 1024,
              })}
              error={imageError ?? undefined}
            >
              <Input
                ref={imageInputRef}
                id={feedbackImagesId}
                className="sr-only"
                type="file"
                multiple
                accept="image/png,image/jpeg,image/webp,image/gif"
                disabled={
                  submission.isPending || images.length >= FEEDBACK_MAX_IMAGES
                }
                onChange={(event) => addImages(event.target.files)}
              />
              <Button
                type="button"
                variant="outline"
                className="w-fit"
                disabled={
                  submission.isPending || images.length >= FEEDBACK_MAX_IMAGES
                }
                onClick={() => imageInputRef.current?.click()}
              >
                <ImagePlusIcon data-icon="inline-start" />
                {t("support.addFeedbackImages")}
              </Button>
              {images.length > 0 && (
                <ul
                  className="grid grid-cols-3 gap-3 sm:grid-cols-5"
                  aria-label={t("support.selectedFeedbackImages")}
                >
                  {images.map((image) => (
                    <FeedbackImageSelection
                      key={image.id}
                      image={image}
                      disabled={submission.isPending}
                      removeLabel={t("support.removeFeedbackImage", {
                        name: image.file.name,
                      })}
                      onRemove={() => {
                        setImages((current) =>
                          current.filter(
                            (candidate) => candidate.id !== image.id
                          )
                        )
                        setImageError(null)
                        submission.reset()
                      }}
                    />
                  ))}
                </ul>
              )}
            </FieldShell>
            {submission.isError && (
              <StatusBanner variant="error">
                {getErrorMessage(submission.error, t)}
              </StatusBanner>
            )}
          </div>
          <DialogFooter className="shrink-0 border-t border-divider px-6 py-4">
            <DialogClose
              render={
                <Button
                  type="button"
                  variant="ghost"
                  disabled={submission.isPending}
                />
              }
            >
              {t("common.cancel")}
            </DialogClose>
            <Button
              type="submit"
              disabled={!normalizedFeedback || submission.isPending}
              aria-busy={submission.isPending || undefined}
            >
              {submission.isPending && <Spinner data-icon="inline-start" />}
              {t(
                submission.isPending
                  ? "support.submittingFeedback"
                  : "support.submitFeedback"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function getClipboardImages(event: ClipboardEvent<HTMLTextAreaElement>) {
  const itemImages = Array.from(event.clipboardData.items)
    .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
    .map((item) => item.getAsFile())
    .filter((file): file is File => file !== null)

  if (itemImages.length > 0) return itemImages

  return Array.from(event.clipboardData.files).filter((file) =>
    file.type.startsWith("image/")
  )
}
