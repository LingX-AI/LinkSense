import { useCallback, useEffect, useRef, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import {
  ArrowLeftIcon,
  BookOpenIcon,
  DownloadIcon,
  FileIcon,
  LoaderCircleIcon,
} from "lucide-react"
import { useTranslation } from "react-i18next"
import { useNavigate, useParams } from "react-router-dom"

import { ApiError } from "@/api/client"
import { getErrorMessage } from "@/api/error-message"
import { ErrorState, LoadingState } from "@/components/feedback/page-state"
import { StatusBanner } from "@/components/feedback/status-banner"
import { FileTypeIcon } from "@/components/media/file-type-icon"
import { PageLayout } from "@/components/shell/page-layout"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  downloadKnowledgeCitationOriginal,
  getKnowledgeCitationPreview,
  knowledgeBaseQueryKeys,
} from "@/features/knowledge-bases/knowledge-base-api"
import { connectKnowledgeCitationEvents } from "@/features/knowledge-bases/knowledge-citation-events"
import { useKnowledgeSearchCapability } from "@/features/knowledge-bases/knowledge-base-hooks"
import { KnowledgeCitationExcerpt } from "@/features/knowledge-bases/knowledge-markdown"
import { KnowledgeCitationOriginalPreview } from "@/features/knowledge-bases/knowledge-original-preview"
import { KnowledgeSearchStatusBanner } from "@/features/knowledge-bases/knowledge-search-status-banner"
import { downloadBlob } from "@/lib/download-blob"

export function KnowledgeCitationPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { citationId } = useParams<{ citationId: string }>()
  const [view, setView] = useState<"excerpt" | "original">("excerpt")
  const [downloading, setDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState<string | null>(null)
  const [accessLostError, setAccessLostError] = useState<unknown>(null)
  const downloadControllerRef = useRef<AbortController | null>(null)
  const reauthorizationRef = useRef<Promise<boolean> | null>(null)
  const queryClient = useQueryClient()
  const searchCapability = useKnowledgeSearchCapability()
  const citation = useQuery({
    queryKey: knowledgeBaseQueryKeys.citation(citationId ?? "missing"),
    queryFn: ({ signal }) =>
      getKnowledgeCitationPreview(citationId ?? "missing", signal),
    enabled: Boolean(citationId) && !accessLostError,
    retry: false,
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: "always",
  })

  const markAccessLost = useCallback(
    (error: unknown) => {
      downloadControllerRef.current?.abort()
      downloadControllerRef.current = null
      setDownloading(false)
      setDownloadError(null)
      setView("excerpt")
      setAccessLostError(error)
      if (citationId) {
        void queryClient.cancelQueries({
          queryKey: knowledgeBaseQueryKeys.citation(citationId),
          exact: true,
        })
        queryClient.removeQueries({
          queryKey: knowledgeBaseQueryKeys.citation(citationId),
          exact: true,
        })
      }
    },
    [citationId, queryClient]
  )

  const reauthorizeCitation = useCallback(
    (signal: AbortSignal): Promise<boolean> => {
      if (!citationId || signal.aborted) return Promise.resolve(false)
      if (reauthorizationRef.current) return reauthorizationRef.current
      const pending = getKnowledgeCitationPreview(citationId, signal)
        .then((preview) => {
          if (signal.aborted) return false
          if (preview.status === "historical_unavailable") {
            downloadControllerRef.current?.abort()
            downloadControllerRef.current = null
            setDownloading(false)
            setDownloadError(null)
            setView("excerpt")
          }
          queryClient.setQueryData(
            knowledgeBaseQueryKeys.citation(citationId),
            preview
          )
          return preview.status === "available"
        })
        .catch((error: unknown) => {
          if (signal.aborted) return false
          if (
            error instanceof ApiError &&
            (error.status === 401 ||
              error.status === 403 ||
              error.status === 404 ||
              error.status === 410)
          ) {
            markAccessLost(error)
            return false
          }
          return true
        })
        .finally(() => {
          if (reauthorizationRef.current === pending) {
            reauthorizationRef.current = null
          }
        })
      reauthorizationRef.current = pending
      return pending
    },
    [citationId, markAccessLost, queryClient]
  )

  useEffect(() => {
    if (
      !citationId ||
      !citation.isSuccess ||
      citation.data.status !== "available" ||
      accessLostError
    )
      return
    const disconnect = connectKnowledgeCitationEvents(citationId, {
      onSourceChanged: (signal) => {
        void reauthorizeCitation(signal)
      },
      shouldReconnect: reauthorizeCitation,
    })
    return disconnect
  }, [
    accessLostError,
    citation.data?.status,
    citation.isSuccess,
    citationId,
    reauthorizeCitation,
  ])

  useEffect(
    () => () => {
      downloadControllerRef.current?.abort()
      if (!citationId) return
      queryClient.removeQueries({
        queryKey: knowledgeBaseQueryKeys.citation(citationId),
        exact: true,
      })
    },
    [citationId, queryClient]
  )

  if (accessLostError) {
    return (
      <PageLayout title={t("knowledge.citation.title")}>
        <ErrorState
          message={getErrorMessage(accessLostError, t)}
          onRetry={() => {
            setAccessLostError(null)
            void citation.refetch()
          }}
        />
      </PageLayout>
    )
  }
  if (citation.isLoading || !citation.isFetchedAfterMount) {
    return <LoadingState label={t("knowledge.citation.loading")} />
  }
  if (citation.isError || !citation.data) {
    return (
      <PageLayout title={t("knowledge.citation.title")}>
        <ErrorState
          message={getErrorMessage(citation.error, t)}
          onRetry={() => void citation.refetch()}
        />
      </PageLayout>
    )
  }

  const preview = citation.data
  const location = formatCitationLocation(preview.summary, t)
  if (preview.status === "historical_unavailable") {
    return (
      <div className="management-scroll">
        <div className="knowledge-preview-page">
          <header className="knowledge-preview-header">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t("knowledge.citation.back")}
              onClick={() => navigate(-1)}
            >
              <ArrowLeftIcon aria-hidden="true" />
            </Button>
            <FileTypeIcon
              className="size-6"
              filename={preview.summary.document_name}
            />
            <div className="min-w-0 flex-1">
              <h1 className="truncate">{preview.summary.document_name}</h1>
              <p>
                {t("knowledge.citation.source", {
                  knowledgeBase: preview.summary.knowledge_base_name,
                  number: preview.citation_no,
                })}
              </p>
            </div>
          </header>

          <StatusBanner
            variant="warning"
            title={t("knowledge.citation.historicalUnavailableTitle")}
          >
            {t("knowledge.citation.historicalUnavailableDescription")}
          </StatusBanner>

          {location && (
            <StatusBanner variant="info">
              {t("knowledge.citation.location", { location })}
            </StatusBanner>
          )}
        </div>
      </div>
    )
  }
  const hasOriginal = preview.original.supported
  const activeView = hasOriginal ? view : "excerpt"
  return (
    <div className="management-scroll">
      <div className="knowledge-preview-page">
        <header className="knowledge-preview-header">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t("knowledge.citation.back")}
            onClick={() => navigate(-1)}
          >
            <ArrowLeftIcon aria-hidden="true" />
          </Button>
          <FileTypeIcon
            className="size-6"
            filename={preview.summary.document_name}
          />
          <div className="min-w-0 flex-1">
            <h1 className="truncate">{preview.summary.document_name}</h1>
            <p>
              {t("knowledge.citation.source", {
                knowledgeBase: preview.summary.knowledge_base_name,
                number: preview.citation_no,
              })}
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            disabled={downloading}
            onClick={() => {
              const controller = new AbortController()
              downloadControllerRef.current?.abort()
              downloadControllerRef.current = controller
              setDownloading(true)
              setDownloadError(null)
              void downloadKnowledgeCitationOriginal(
                preview.citation_id,
                controller.signal
              )
                .then((blob) =>
                  downloadBlob(blob, preview.summary.document_name)
                )
                .catch((error) => {
                  if (!controller.signal.aborted) {
                    setDownloadError(getErrorMessage(error, t))
                  }
                })
                .finally(() => {
                  if (downloadControllerRef.current === controller) {
                    downloadControllerRef.current = null
                    setDownloading(false)
                  }
                })
            }}
          >
            {downloading ? (
              <LoaderCircleIcon data-icon="inline-start" aria-hidden="true" />
            ) : (
              <DownloadIcon data-icon="inline-start" aria-hidden="true" />
            )}
            {t("knowledge.preview.downloadOriginal")}
          </Button>
        </header>

        <KnowledgeSearchStatusBanner capability={searchCapability.capability} />

        {downloadError && (
          <StatusBanner variant="error">{downloadError}</StatusBanner>
        )}

        {(location || !hasOriginal) && (
          <StatusBanner variant="info">
            <div className="flex flex-col gap-1">
              {location && (
                <span>{t("knowledge.citation.location", { location })}</span>
              )}
              {!hasOriginal && (
                <span>{t("knowledge.preview.unsupportedOriginal")}</span>
              )}
            </div>
          </StatusBanner>
        )}

        {hasOriginal ? (
          <Tabs
            value={activeView}
            onValueChange={(value) => {
              if (value === "excerpt" || value === "original") setView(value)
            }}
            className="knowledge-preview-tabs"
          >
            <TabsList aria-label={t("knowledge.preview.views")}>
              <TabsTrigger value="excerpt">
                <BookOpenIcon aria-hidden="true" />
                {t("knowledge.preview.citationExcerpt")}
              </TabsTrigger>
              <TabsTrigger value="original">
                <FileIcon aria-hidden="true" />
                {t("knowledge.preview.original")}
              </TabsTrigger>
            </TabsList>
            <TabsContent value="excerpt" className="knowledge-preview-panel">
              <KnowledgeCitationExcerpt excerpt={preview.parent_excerpt} />
            </TabsContent>
            <TabsContent value="original" className="knowledge-preview-panel">
              <KnowledgeCitationOriginalPreview
                citationId={preview.citation_id}
                renderer={preview.original.renderer}
                documentName={preview.summary.document_name}
              />
            </TabsContent>
          </Tabs>
        ) : (
          <div className="knowledge-preview-panel">
            <KnowledgeCitationExcerpt excerpt={preview.parent_excerpt} />
          </div>
        )}
      </div>
    </div>
  )
}

function formatCitationLocation(
  summary: {
    title_path: string[]
    page_numbers: number[]
  },
  t: ReturnType<typeof useTranslation>["t"]
): string {
  const parts: string[] = []
  if (summary.title_path.length > 0) {
    parts.push(summary.title_path.join(" / "))
  }
  if (summary.page_numbers.length > 0) {
    parts.push(
      t("knowledge.citation.pages", {
        values: summary.page_numbers.join(", "),
      })
    )
  } else {
    parts.push(t("knowledge.citation.documentLevel"))
  }
  return parts.join(" · ")
}
