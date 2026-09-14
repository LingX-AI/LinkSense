import { RefreshButton } from "@/components/feedback/refresh-button"
import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  adminFeedbackPageSchema,
  type AdminFeedback,
  type AdminFeedbackPage,
} from "@linksense/shared"
import { Trash2Icon } from "lucide-react"
import { useTranslation } from "react-i18next"
import { z } from "zod"

import { apiRequest } from "@/api/client"
import { getErrorMessage } from "@/api/error-message"
import { ConfirmDialog } from "@/components/feedback/confirm-dialog"
import { notify } from "@/components/feedback/notification"
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
import { normalizeLanguage } from "@/i18n"
import { formatDateTime } from "@/i18n/date"

import { FeedbackDetailsDialog } from "@/features/feedback/feedback-details-dialog"
import { FeedbackReplyStatus } from "@/features/feedback/feedback-reply-status"
import { feedbackKeys } from "@/features/feedback/queries"

const PAGE_SIZE = 20

export function AdminFeedbackPage() {
  const { t, i18n } = useTranslation()
  const queryClient = useQueryClient()
  const language = normalizeLanguage(i18n.resolvedLanguage) ?? "zh-CN"
  const [cursor, setCursor] = useState<string | undefined>()
  const [cursorStack, setCursorStack] = useState<(string | undefined)[]>([])
  const [selected, setSelected] = useState<AdminFeedback | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<AdminFeedback | null>(null)
  const query = useQuery({
    queryKey: feedbackKeys.list("admin", cursor),
    queryFn: ({ signal }) =>
      apiRequest("/admin/feedback", {
        schema: adminFeedbackPageSchema,
        query: { cursor, limit: PAGE_SIZE },
        signal,
      }),
  })
  const items = query.data?.items ?? []
  const deleteMutation = useMutation({
    mutationFn: (feedback: AdminFeedback) =>
      apiRequest(`/admin/feedback/${feedback.id}`, {
        method: "DELETE",
        schema: z.null(),
      }),
    onSuccess: async (_, deletedFeedback) => {
      queryClient.setQueriesData<AdminFeedbackPage>(
        { queryKey: feedbackKeys.lists("admin") },
        (current) =>
          current
            ? {
                ...current,
                items: current.items.filter(
                  (feedback) => feedback.id !== deletedFeedback.id
                ),
              }
            : current
      )
      if (selected?.id === deletedFeedback.id) setSelected(null)
      setDeleteTarget(null)
      notify.success(t("adminFeedback.deleteSuccess"), {
        id: "admin-feedback-delete-success",
      })
      await queryClient.invalidateQueries({ queryKey: feedbackKeys.all })
    },
    onError: (error) => {
      notify.error(getErrorMessage(error, t), {
        id: "admin-feedback-delete-error",
      })
    },
  })

  return (
    <PageLayout
      title={t("adminFeedback.title")}
      description={t("adminFeedback.description")}
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
        <EmptyState title={t("adminFeedback.empty")} />
      ) : (
        <>
          <Table appearance="card">
            <TableHeader>
              <TableRow>
                <TableHead>{t("adminFeedback.submitter")}</TableHead>
                <TableHead>{t("adminFeedback.content")}</TableHead>
                <TableHead>{t("adminFeedback.images")}</TableHead>
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
                  <TableCell>
                    <div className="flex min-w-44 flex-col gap-0.5 whitespace-normal">
                      <span className="font-medium">
                        {feedback.submitter.name}
                      </span>
                      <span className="text-muted-foreground">
                        {feedback.submitter.email}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="max-w-xl whitespace-normal">
                    <p className="line-clamp-2">{feedback.content}</p>
                  </TableCell>
                  <TableCell>
                    {t("adminFeedback.imageCount", {
                      count: feedback.images.length,
                    })}
                  </TableCell>
                  <TableCell>
                    <FeedbackReplyStatus count={feedback.reply_count} />
                  </TableCell>
                  <TableCell>
                    {formatDateTime(feedback.created_at, language)}
                  </TableCell>
                  <TableCell className="text-center">
                    {/* Equal side tracks keep View centered beneath the heading. */}
                    <div className="inline-grid grid-cols-[1.75rem_auto_1.75rem] items-center gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="col-start-2"
                        onClick={() => setSelected(feedback)}
                      >
                        {t("common.view")}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className="text-muted-foreground hover:text-destructive"
                        aria-label={t("adminFeedback.deleteLabel", {
                          name: feedback.submitter.name,
                        })}
                        title={t("adminFeedback.deleteLabel", {
                          name: feedback.submitter.name,
                        })}
                        disabled={deleteMutation.isPending}
                        onClick={() => setDeleteTarget(feedback)}
                      >
                        <Trash2Icon aria-hidden="true" />
                      </Button>
                    </div>
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
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={cursorStack.length === 0 || query.isFetching}
                  onClick={() => {
                    const previous = cursorStack.at(-1)
                    setCursorStack((current) => current.slice(0, -1))
                    setCursor(previous)
                  }}
                >
                  {t("common.previous")}
                </Button>
              </PaginationItem>
              <PaginationItem>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!query.data?.next_cursor || query.isFetching}
                  onClick={() => {
                    if (!query.data?.next_cursor) return
                    setCursorStack((current) => [...current, cursor])
                    setCursor(query.data.next_cursor ?? undefined)
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
        feedbackId={selected?.id ?? null}
        scope="admin"
        description={
          selected
            ? t("adminFeedback.detailsDescription", {
                name: selected.submitter.name,
                time: formatDateTime(selected.created_at, language),
              })
            : ""
        }
        onOpenChange={(open) => {
          if (!open) setSelected(null)
        }}
      />
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
        title={t("adminFeedback.deleteTitle")}
        description={t("adminFeedback.deleteDescription", {
          name: deleteTarget?.submitter.name ?? "",
        })}
        confirmLabel={t("common.delete")}
        pendingLabel={t("adminFeedback.deleting")}
        destructive
        pending={deleteMutation.isPending}
        onConfirm={() => {
          if (deleteTarget) deleteMutation.mutate(deleteTarget)
        }}
      />
    </PageLayout>
  )
}
