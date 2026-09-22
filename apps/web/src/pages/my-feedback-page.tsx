import { RefreshButton } from "@/components/feedback/refresh-button"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { getErrorMessage } from "@/api/error-message"
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from "@/components/feedback/page-state"
import { PageLayout } from "@/components/shell/page-layout"
import { Button } from "@/components/ui/button"
import {
  Pagination,
  PaginationContent,
  PaginationItem,
} from "@/components/ui/pagination"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { FeedbackDetailsDialog } from "@/features/feedback/feedback-details-dialog"
import { FeedbackReplyStatus } from "@/features/feedback/feedback-reply-status"
import { useMyFeedback } from "@/features/feedback/queries"
import { normalizeLanguage } from "@/i18n"
import { formatDateTime } from "@/i18n/date"

export function MyFeedbackPage() {
  const { t, i18n } = useTranslation()
  const language = normalizeLanguage(i18n.resolvedLanguage) ?? "zh-CN"
  const [cursor, setCursor] = useState<string | undefined>()
  const [cursorStack, setCursorStack] = useState<(string | undefined)[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const query = useMyFeedback(cursor)
  const items = query.data?.items ?? []
  return (
    <PageLayout
      title={t("myFeedback.title")}
      description={t("myFeedback.description")}
      actions={
        <RefreshButton
          refreshing={query.isFetching}
          onRefresh={() => void query.refetch()}
        />
      }
    >
      {query.isPending ? (
        <LoadingState />
      ) : query.isError ? (
        <ErrorState
          message={getErrorMessage(query.error, t)}
          onRetry={() => void query.refetch()}
        />
      ) : items.length === 0 && cursorStack.length === 0 ? (
        <EmptyState
          title={t("myFeedback.empty")}
          description={t("myFeedback.emptyDescription")}
        />
      ) : (
        <>
          <Table appearance="card">
            <TableHeader>
              <TableRow>
                <TableHead>{t("adminFeedback.content")}</TableHead>
                <TableHead>{t("myFeedback.replyStatus")}</TableHead>
                <TableHead>{t("adminFeedback.submittedAt")}</TableHead>
                <TableHead className="text-center">
                  {t("common.actions")}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((feedback) => (
                <TableRow key={feedback.id}>
                  <TableCell className="max-w-sm min-w-40 whitespace-normal">
                    <p className="line-clamp-2 wrap-anywhere">
                      {feedback.content}
                    </p>
                  </TableCell>
                  <TableCell>
                    <FeedbackReplyStatus count={feedback.reply_count} />
                  </TableCell>
                  <TableCell>
                    {formatDateTime(feedback.created_at, language)}
                  </TableCell>
                  <TableCell className="text-center">
                    <Button
                      type="button"
                      variant="ghost"
                      size="default"
                      onClick={() => setSelectedId(feedback.id)}
                    >
                      {t("common.view")}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Pagination
            className="mt-6"
            aria-label={t("adminFeedback.pagination")}
          >
            <PaginationContent>
              <PaginationItem>
                <Button
                  variant="outline"
                  size="default"
                  disabled={!cursorStack.length || query.isFetching}
                  onClick={() => {
                    setCursor(cursorStack.at(-1))
                    setCursorStack((current) => current.slice(0, -1))
                  }}
                >
                  {t("common.previous")}
                </Button>
              </PaginationItem>
              <PaginationItem>
                <Button
                  variant="outline"
                  size="default"
                  disabled={!query.data?.next_cursor || query.isFetching}
                  onClick={() => {
                    if (query.data?.next_cursor) {
                      setCursorStack((current) => [...current, cursor])
                      setCursor(query.data.next_cursor)
                    }
                  }}
                >
                  {t("common.next")}
                </Button>
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        </>
      )}
      <FeedbackDetailsDialog
        feedbackId={selectedId}
        scope="personal"
        onOpenChange={(open) => {
          if (!open) setSelectedId(null)
        }}
      />
    </PageLayout>
  )
}
