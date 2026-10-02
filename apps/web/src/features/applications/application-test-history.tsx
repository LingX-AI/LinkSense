import { useState } from "react"
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { FileTextIcon, Trash2Icon } from "lucide-react"
import { z } from "zod"
import {
  APPLICATION_DEVELOPMENT_POLL_MS,
  applicationTestSessionsSchema,
  type ApplicationDevelopment,
} from "@linksense/shared"
import { apiRequest } from "@/api/client"
import { getErrorMessage } from "@/api/error-message"
import { useAuth } from "@/app/auth-state"
import { normalizeLanguage } from "@/i18n"
import { formatDateTime } from "@/i18n/date"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Spinner } from "@/components/ui/spinner"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { ConfirmDialog } from "@/components/feedback/confirm-dialog"
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from "@/components/feedback/page-state"
import { ConversationPage } from "@/pages/conversation-pages"
import { applicationDevelopmentKeys } from "./application-development-api"

export function ApplicationTestHistory({
  project,
}: {
  project: ApplicationDevelopment
}) {
  const { t, i18n } = useTranslation()
  const language = normalizeLanguage(i18n.resolvedLanguage) ?? "zh-CN"
  const { user } = useAuth()
  const client = useQueryClient()
  const [selected, setSelected] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const queryKey = applicationDevelopmentKeys.tests(user?.id, project.id)
  const history = useInfiniteQuery({
    queryKey,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      apiRequest(`/application-developments/${project.id}/test-sessions`, {
        query: { cursor: pageParam },
        signal,
        schema: applicationTestSessionsSchema,
      }),
    getNextPageParam: (page) => page.next_cursor ?? undefined,
    refetchInterval: APPLICATION_DEVELOPMENT_POLL_MS,
    refetchIntervalInBackground: false,
  })
  const remove = useMutation({
    mutationFn: (id: string) =>
      apiRequest(
        `/application-developments/${project.id}/test-sessions/${id}`,
        { method: "DELETE", schema: z.object({ success: z.literal(true) }) }
      ),
    onSuccess: async () => {
      setDeleting(null)
      await client.invalidateQueries({ queryKey })
    },
  })
  const items = history.data?.pages.flatMap((page) => page.items) ?? []
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
      {history.isPending && <LoadingState />}
      {history.error && (
        <ErrorState
          message={getErrorMessage(history.error, t)}
          onRetry={() => void history.refetch()}
        />
      )}
      {remove.error && (
        <ErrorState message={getErrorMessage(remove.error, t)} />
      )}
      {history.data && items.length === 0 && (
        <EmptyState
          title={t("applicationDevelopment.tests.empty")}
          description={t("applicationDevelopment.tests.emptyHint")}
        />
      )}
      <ul className="flex flex-col gap-3">
        {items.map((item) => (
          <li
            key={item.id}
            className="flex flex-wrap items-center gap-3 rounded-lg border border-[color:var(--app-border)] p-3"
          >
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">
                  {formatDateTime(
                    item.last_run_at ?? item.created_at,
                    language
                  )}
                </span>
                {item.current && (
                  <Badge variant="secondary">
                    {t("applicationDevelopment.tests.current")}
                  </Badge>
                )}
                <Badge
                  variant={item.status === "failed" ? "destructive" : "outline"}
                >
                  {t(`applicationDevelopment.tests.status.${item.status}`)}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                {item.turn_count > 0
                  ? t("applicationDevelopment.tests.summary", {
                      count: item.turn_count,
                    })
                  : t("applicationDevelopment.tests.submitted")}
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setSelected(item.id)}
            >
              <FileTextIcon data-icon="inline-start" />
              {t("applicationDevelopment.tests.view")}
            </Button>
            {!item.current && (
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={t("applicationDevelopment.tests.delete")}
                disabled={item.busy || remove.isPending}
                onClick={() => {
                  remove.reset()
                  setDeleting(item.id)
                }}
              >
                <Trash2Icon />
              </Button>
            )}
          </li>
        ))}
      </ul>
      {history.hasNextPage && (
        <Button
          variant="outline"
          disabled={history.isFetchingNextPage}
          onClick={() => void history.fetchNextPage()}
        >
          {history.isFetchingNextPage && <Spinner data-icon="inline-start" />}
          {t("applicationDevelopment.tests.more")}
        </Button>
      )}
      <Dialog
        open={Boolean(selected)}
        onOpenChange={(open) => {
          if (!open) setSelected(null)
        }}
      >
        <DialogContent className="flex h-[85dvh] min-h-0 flex-col overflow-hidden sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>{t("applicationDevelopment.tests.title")}</DialogTitle>
            <DialogDescription>
              {t("applicationDevelopment.tests.detailHint")}
            </DialogDescription>
          </DialogHeader>
          {selected && (
            <div className="min-h-0 flex-1 [&_.conversation-office-layout]:h-full">
              <ConversationPage
                key={selected}
                conversationId={selected}
                embedded
                showConversationActions={false}
                showComposer={false}
                readOnly={selected !== project.preview_conversation_id}
              />
            </div>
          )}
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => {
          if (!open) setDeleting(null)
        }}
        title={t("applicationDevelopment.tests.delete")}
        description={t("applicationDevelopment.tests.deleteHint")}
        confirmLabel={t("common.delete")}
        destructive
        pending={remove.isPending}
        onConfirm={() => {
          if (deleting) remove.mutate(deleting)
        }}
      />
    </div>
  )
}
