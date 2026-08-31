import { useEffect, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  adminFeedbackPageSchema,
  type AdminFeedback,
  type AdminFeedbackPage,
  type FeedbackImage,
} from "@linksense/shared"
import { FileImageIcon, RefreshCwIcon, Trash2Icon } from "lucide-react"
import { useTranslation } from "react-i18next"
import { z } from "zod"

import { apiRequest, downloadApiFile } from "@/api/client"
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Pagination,
  PaginationContent,
  PaginationItem,
} from "@/components/ui/pagination"
import { Spinner } from "@/components/ui/spinner"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { normalizeLanguage } from "@/i18n"
import { formatDateTime, formatFileSize } from "@/i18n/date"

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
    queryKey: ["admin", "feedback", cursor],
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
        { queryKey: ["admin", "feedback"] },
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
      await queryClient.invalidateQueries({
        queryKey: ["admin", "feedback"],
      })
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
        <Button
          type="button"
          variant="secondary"
          disabled={query.isFetching}
          aria-busy={query.isFetching || undefined}
          onClick={() => void query.refetch()}
        >
          {query.isFetching ? (
            <Spinner data-icon="inline-start" />
          ) : (
            <RefreshCwIcon data-icon="inline-start" />
          )}
          {t("common.refresh")}
        </Button>
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
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("adminFeedback.submitter")}</TableHead>
                <TableHead>{t("adminFeedback.content")}</TableHead>
                <TableHead>{t("adminFeedback.images")}</TableHead>
                <TableHead>{t("adminFeedback.submittedAt")}</TableHead>
                <TableHead className="text-right">
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
                    {formatDateTime(feedback.created_at, language)}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
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
        feedback={selected}
        language={language}
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

function FeedbackDetailsDialog({
  feedback,
  language,
  onOpenChange,
}: {
  feedback: AdminFeedback | null
  language: "zh-CN" | "en-US"
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  return (
    <Dialog open={Boolean(feedback)} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t("adminFeedback.detailsTitle")}</DialogTitle>
          {feedback && (
            <DialogDescription>
              {t("adminFeedback.detailsDescription", {
                name: feedback.submitter.name,
                time: formatDateTime(feedback.created_at, language),
              })}
            </DialogDescription>
          )}
        </DialogHeader>
        {feedback && (
          <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-1.5">
              <h3 className="font-medium">{t("adminFeedback.content")}</h3>
              <p className="whitespace-pre-wrap">{feedback.content}</p>
            </div>
            {feedback.images.length > 0 && (
              <div className="flex flex-col gap-3">
                <h3 className="font-medium">{t("adminFeedback.imageList")}</h3>
                <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {feedback.images.map((image) => (
                    <AdminFeedbackImage
                      key={`${feedback.id}:${image.id}`}
                      feedbackId={feedback.id}
                      image={image}
                      language={language}
                    />
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function AdminFeedbackImage({
  feedbackId,
  image,
  language,
}: {
  feedbackId: string
  image: FeedbackImage
  language: "zh-CN" | "en-US"
}) {
  const { t } = useTranslation()
  const [source, setSource] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    let objectUrl: string | null = null
    void downloadApiFile(
      `/admin/feedback/${feedbackId}/images/${image.id}`,
      undefined,
      controller.signal
    )
      .then((blob) => {
        if (controller.signal.aborted) return
        objectUrl = URL.createObjectURL(blob)
        setSource(objectUrl)
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return
        setFailed(true)
      })
    return () => {
      controller.abort()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [feedbackId, image.id])

  return (
    <li className="flex min-w-0 flex-col gap-1.5">
      <div className="aspect-square">
        <Button
          type="button"
          variant="outline"
          className="size-full overflow-hidden p-0"
          disabled={!source}
          aria-label={t("adminFeedback.openImage", { name: image.filename })}
          onClick={() => setPreviewOpen(true)}
        >
          {source ? (
            <img
              src={source}
              alt={t("adminFeedback.imageAlt", { name: image.filename })}
              width="320"
              height="320"
              className="size-full object-contain"
            />
          ) : failed ? (
            <span className="flex flex-col items-center gap-2 px-3 text-muted-foreground">
              <FileImageIcon aria-hidden="true" />
              <span>{t("adminFeedback.imageUnavailable")}</span>
            </span>
          ) : (
            <span role="status" className="flex items-center gap-2">
              <Spinner />
              <span className="sr-only">{t("adminFeedback.imageLoading")}</span>
            </span>
          )}
        </Button>
      </div>
      <span className="truncate" title={image.filename}>
        {image.filename}
      </span>
      <span className="text-muted-foreground">
        {formatFileSize(image.size_bytes, language)}
      </span>

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>{t("adminFeedback.imagePreviewTitle")}</DialogTitle>
            <DialogDescription>
              {image.filename} · {formatFileSize(image.size_bytes, language)}
            </DialogDescription>
          </DialogHeader>
          {source && (
            <img
              src={source}
              alt={t("adminFeedback.imageAlt", { name: image.filename })}
              width="1280"
              height="720"
              className="max-h-[70dvh] w-full object-contain"
            />
          )}
        </DialogContent>
      </Dialog>
    </li>
  )
}
