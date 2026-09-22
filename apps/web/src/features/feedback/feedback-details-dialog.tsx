import type { ReactNode } from "react"
import { useIsMutating } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import type { FeedbackImage } from "@linksense/shared"
import { getErrorMessage } from "@/api/error-message"
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from "@/components/feedback/page-state"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Separator } from "@/components/ui/separator"
import { normalizeLanguage, type SupportedLanguage } from "@/i18n"
import { formatDateTime } from "@/i18n/date"
import { FeedbackImagePreview } from "./feedback-image-preview"
import { FeedbackReplyForm } from "./feedback-reply-form"
import { FeedbackReplyStatus } from "./feedback-reply-status"
import {
  feedbackKeys,
  feedbackPath,
  useFeedbackDetails,
  type FeedbackScope,
} from "./queries"

export function FeedbackDetailsDialog({
  feedbackId,
  scope,
  description,
  onOpenChange,
}: {
  feedbackId: string | null
  scope: FeedbackScope
  description?: string
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const pending =
    useIsMutating({ mutationKey: feedbackKeys.reply(feedbackId ?? "") }) > 0
  return (
    <Dialog
      open={Boolean(feedbackId)}
      onOpenChange={(open) => {
        if (!pending) onOpenChange(open)
      }}
    >
      <DialogContent
        closeLabel={t("common.close")}
        className="flex max-h-[calc(100dvh-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl"
      >
        <DialogHeader className="shrink-0 px-6 pt-6 pr-14 pb-5">
          <DialogTitle>{t("adminFeedback.detailsTitle")}</DialogTitle>
          <DialogDescription>
            {description ?? t("myFeedback.detailsDescription")}
          </DialogDescription>
        </DialogHeader>
        {feedbackId && (
          <FeedbackDetails
            key={`${scope}:${feedbackId}`}
            feedbackId={feedbackId}
            scope={scope}
            onReplySent={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function FeedbackDetails({
  feedbackId,
  scope,
  onReplySent,
}: {
  feedbackId: string
  scope: FeedbackScope
  onReplySent: () => void
}) {
  const { t, i18n } = useTranslation()
  const language = normalizeLanguage(i18n.resolvedLanguage) ?? "zh-CN"
  const query = useFeedbackDetails(scope, feedbackId)
  if (query.isPending)
    return (
      <FeedbackReadOnlyBody>
        <LoadingState />
      </FeedbackReadOnlyBody>
    )
  if (query.isError)
    return (
      <FeedbackReadOnlyBody>
        <ErrorState
          message={getErrorMessage(query.error, t)}
          onRetry={() => void query.refetch()}
        />
      </FeedbackReadOnlyBody>
    )
  const feedback = query.data
  const basePath = `${feedbackPath(scope)}/${feedbackId}`
  const history = (
    <div className="flex min-w-0 flex-col gap-6">
      <section className="flex min-w-0 flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-medium">{t("adminFeedback.content")}</h3>
          <FeedbackReplyStatus count={feedback.reply_count} />
        </div>
        <p className="text-muted-foreground">
          {formatDateTime(feedback.created_at, language)}
        </p>
        <p className="wrap-anywhere whitespace-pre-wrap">{feedback.content}</p>
        <FeedbackImages
          images={feedback.images}
          basePath={basePath}
          language={language}
        />
      </section>
      <Separator />
      <section
        className="flex min-w-0 flex-col gap-4"
        aria-label={t("myFeedback.replies")}
      >
        <h3 className="font-medium">{t("myFeedback.replies")}</h3>
        {feedback.replies.length === 0 ? (
          <EmptyState title={t("myFeedback.noReplies")} />
        ) : (
          <ol
            className="divide-y divide-divider"
            aria-label={t("myFeedback.replies")}
          >
            {feedback.replies.map((reply) => (
              <li
                key={reply.id}
                className="flex min-w-0 flex-col gap-3 py-4 first:pt-0 last:pb-0"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{reply.author.name}</span>
                  <time
                    className="text-muted-foreground"
                    dateTime={reply.created_at}
                  >
                    {formatDateTime(reply.created_at, language)}
                  </time>
                </div>
                {reply.content && (
                  <p className="wrap-anywhere whitespace-pre-wrap">
                    {reply.content}
                  </p>
                )}
                <FeedbackImages
                  images={reply.images}
                  basePath={`${basePath}/replies/${reply.id}`}
                  language={language}
                />
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  )
  return scope === "admin" ? (
    <FeedbackReplyForm feedbackId={feedbackId} onReplySent={onReplySent}>
      {history}
    </FeedbackReplyForm>
  ) : (
    <FeedbackReadOnlyBody>{history}</FeedbackReadOnlyBody>
  )
}

function FeedbackImages({
  images,
  basePath,
  language,
}: {
  images: FeedbackImage[]
  basePath: string
  language: SupportedLanguage
}) {
  return (
    images.length > 0 && (
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {images.map((image) => (
          <FeedbackImagePreview
            key={image.id}
            basePath={basePath}
            image={image}
            language={language}
          />
        ))}
      </ul>
    )
  )
}

function FeedbackReadOnlyBody({ children }: { children: ReactNode }) {
  return (
    <div
      data-slot="feedback-dialog-body"
      className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 pb-6"
    >
      {children}
    </div>
  )
}
