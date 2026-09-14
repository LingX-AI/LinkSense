import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { useInfiniteQuery } from "@tanstack/react-query"
import { taskArtifactFileTypeSchema } from "@linksense/shared"
import {
  ArrowUpRightIcon,
  DownloadIcon,
  EyeIcon,
  LoaderCircleIcon,
  SearchIcon,
} from "lucide-react"
import { useTranslation } from "react-i18next"
import { Link, useSearchParams } from "react-router-dom"

import { downloadApiFile } from "@/api/client"
import { getErrorMessage } from "@/api/error-message"
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from "@/components/feedback/page-state"
import { notify } from "@/components/feedback/notification"
import { FileTypeIcon } from "@/components/media/file-type-icon"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { InputGroup, InputGroupAddon } from "@/components/ui/input-group"
import { SearchInput } from "@/components/ui/search-input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import {
  getConversationFilePreviewKind,
  getConversationFilePreviewLabelKey,
} from "@/features/conversations/conversation-file-preview"
import { normalizeLanguage } from "@/i18n"
import { formatDateTime, formatFileSize } from "@/i18n/date"
import { downloadBlob } from "@/lib/download-blob"
import { readUrlEnum, updateUrlSearchParams } from "@/lib/url-search-params"

import { getTaskArtifacts, type TaskArtifact } from "./task-artifact-api"

const fileTypes = ["all", ...taskArtifactFileTypeSchema.options] as const

type TaskArtifactGroup = {
  task: TaskArtifact["task"]
  latestCreatedAt: string
  files: TaskArtifact[]
}

export function TaskArtifactLibrary({
  onPreview,
}: {
  onPreview: (file: TaskArtifact) => void
}) {
  const { t, i18n } = useTranslation()
  const language = normalizeLanguage(i18n.resolvedLanguage) ?? "zh-CN"
  const [searchParams, setSearchParams] = useSearchParams()
  const search = searchParams.get("search") ?? ""
  const deferredSearch = useDeferredValue(search.trim())
  const fileType = readUrlEnum(searchParams, "file_type", fileTypes, "all")
  const fileTypeItems = fileTypes.map((value) => ({
    value,
    label: t(`library.artifacts.fileTypes.${value}`),
  }))
  const hasFilters = Boolean(deferredSearch) || fileType !== "all"
  const [downloadingFileId, setDownloadingFileId] = useState<string>()
  const downloadInFlightRef = useRef(false)
  const loadMoreRef = useRef<HTMLDivElement>(null)
  const loadMoreInFlightRef = useRef(false)

  const updateSearch = (value: string) => {
    setSearchParams(
      (current) => updateUrlSearchParams(current, { search: value }),
      { replace: true }
    )
  }

  const updateFileType = (value: (typeof fileTypes)[number] | null) => {
    if (value === null) return
    setSearchParams(
      (current) =>
        updateUrlSearchParams(current, {
          file_type: value === "all" ? null : value,
        }),
      { replace: true }
    )
  }

  const query = useInfiniteQuery({
    queryKey: ["task-artifacts", deferredSearch, fileType],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) =>
      getTaskArtifacts({
        search: deferredSearch || undefined,
        fileType: fileType === "all" ? undefined : fileType,
        cursor: pageParam,
        signal,
      }),
    getNextPageParam: (page) => page.next_cursor ?? undefined,
  })
  const {
    fetchNextPage,
    hasNextPage,
    isFetchNextPageError,
    isFetchingNextPage,
  } = query
  const files = useMemo(
    () => query.data?.pages.flatMap((page) => page.items) ?? [],
    [query.data]
  )
  const groups = useMemo(() => groupTaskArtifacts(files), [files])
  const loadNextPage = useCallback(() => {
    if (loadMoreInFlightRef.current) return
    loadMoreInFlightRef.current = true
    void fetchNextPage().finally(() => {
      loadMoreInFlightRef.current = false
    })
  }, [fetchNextPage])

  useEffect(() => {
    const target = loadMoreRef.current
    if (!target || !hasNextPage || isFetchingNextPage || isFetchNextPageError) {
      return
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) loadNextPage()
      },
      {
        root: target.closest(".management-scroll"),
        rootMargin: "0px 0px 240px 0px",
      }
    )
    observer.observe(target)
    return () => observer.disconnect()
  }, [hasNextPage, isFetchNextPageError, isFetchingNextPage, loadNextPage])

  const download = async (file: TaskArtifact) => {
    if (downloadInFlightRef.current) return
    downloadInFlightRef.current = true
    setDownloadingFileId(file.id)
    try {
      const blob = await downloadApiFile(
        `/conversations/${file.conversation_id}/files/${file.id}/download`
      )
      downloadBlob(blob, file.name)
    } catch (error) {
      notify.error(getErrorMessage(error, t))
    } finally {
      downloadInFlightRef.current = false
      setDownloadingFileId(undefined)
    }
  }

  return (
    <section aria-labelledby="task-artifacts-title">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-4">
        <div>
          <h2
            id="task-artifacts-title"
            className="text-[length:var(--app-font-15)] leading-[var(--app-line-24)] font-semibold"
          >
            {t("library.artifacts.title")}
          </h2>
          <p className="mt-1 max-w-[70ch] text-[length:var(--app-font-13)] leading-[var(--app-line-20)] text-[var(--app-muted)]">
            {t("library.artifacts.description")}
          </p>
        </div>
      </div>

      <div className="mt-5 flex flex-col items-start gap-3 sm:flex-row sm:items-center">
        <InputGroup className="w-full max-w-[520px]">
          <InputGroupAddon>
            <SearchIcon aria-hidden="true" />
          </InputGroupAddon>
          <SearchInput
            value={search}
            onValueChange={updateSearch}
            placeholder={t("library.artifacts.searchPlaceholder")}
            aria-label={t("library.artifacts.searchPlaceholder")}
          />
        </InputGroup>
        <Select
          items={fileTypeItems}
          value={fileType}
          onValueChange={updateFileType}
        >
          <SelectTrigger
            className="w-36 shrink-0"
            aria-label={t("library.artifacts.fileTypeLabel")}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="start" alignItemWithTrigger={false}>
            <SelectGroup>
              {fileTypeItems.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>

      {query.isLoading ? (
        <LoadingState />
      ) : query.error ? (
        <ErrorState
          message={getErrorMessage(query.error, t)}
          onRetry={() => void query.refetch()}
        />
      ) : groups.length === 0 ? (
        <EmptyState
          title={t(
            hasFilters
              ? "library.artifacts.searchEmpty"
              : "library.artifacts.empty"
          )}
          description={
            hasFilters ? undefined : t("library.artifacts.emptyDescription")
          }
        />
      ) : (
        <div
          className="mt-7 space-y-8"
          aria-label={t("library.artifacts.listLabel")}
        >
          {groups.map((group) => (
            <section
              key={group.task.id}
              aria-labelledby={`task-artifact-group-${group.task.id}`}
            >
              <header className="flex min-w-0 items-start justify-between gap-4 pb-2">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <Link
                    id={`task-artifact-group-${group.task.id}`}
                    to={`/conversations/${group.task.id}`}
                    className="inline-flex min-w-0 items-center gap-1 text-[length:var(--app-ui-font-size)] font-semibold text-[var(--app-text)] no-underline hover:underline focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
                  >
                    <span className="truncate">{group.task.title}</span>
                    <ArrowUpRightIcon
                      className="size-3.5 shrink-0 text-[var(--app-muted)]"
                      aria-hidden="true"
                    />
                  </Link>
                  {group.task.archive_status === "archived" && (
                    <Badge variant="outline">
                      {t("library.artifacts.archivedTask")}
                    </Badge>
                  )}
                </div>
                <time
                  dateTime={group.latestCreatedAt}
                  className="shrink-0 text-[length:var(--app-font-12)] leading-[var(--app-line-20)] text-[var(--app-muted)]"
                >
                  {formatDateTime(group.latestCreatedAt, language)}
                </time>
              </header>

              <div className="overflow-hidden rounded-[var(--radius-3xl)] border border-[var(--app-divider)] bg-[var(--app-canvas)]">
                {group.files.map((file) => {
                  const previewKind = getConversationFilePreviewKind(file)
                  const downloading = downloadingFileId === file.id
                  const content = (
                    <>
                      <FileTypeIcon
                        filename={file.name}
                        mimeType={file.mime_type}
                        className="size-7 shrink-0"
                      />
                      <span className="min-w-0 flex-1 text-left">
                        <span className="block truncate font-medium text-[var(--app-text)]">
                          {file.name}
                        </span>
                        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[length:var(--app-font-12)] leading-[var(--app-line-20)] text-[var(--app-muted)]">
                          <span>{formatFileSize(file.size, language)}</span>
                          <time dateTime={file.created_at}>
                            {formatDateTime(file.created_at, language)}
                          </time>
                        </span>
                      </span>
                    </>
                  )
                  return (
                    <div
                      key={file.id}
                      className="group flex min-w-0 items-center gap-2 border-b border-[var(--app-divider)] px-3 py-2.5 last:border-b-0 hover:bg-[var(--app-hover)]"
                    >
                      {previewKind ? (
                        <Button
                          type="button"
                          variant="ghost"
                          className="h-auto min-h-0 min-w-0 flex-1 justify-start gap-3 rounded-lg p-0 text-left hover:bg-transparent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
                          aria-label={t(
                            getConversationFilePreviewLabelKey(file),
                            { name: file.name }
                          )}
                          onClick={() => onPreview(file)}
                        >
                          {content}
                        </Button>
                      ) : (
                        <div className="flex min-w-0 flex-1 items-center gap-3">
                          {content}
                        </div>
                      )}
                      {previewKind && (
                        <span
                          className="pointer-events-none inline-flex shrink-0 items-center gap-1 text-[length:var(--app-font-12)] leading-[var(--app-line-20)] text-[var(--app-muted)] opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100"
                          aria-hidden="true"
                        >
                          <EyeIcon className="size-3" />
                          {t("library.artifacts.previewAvailable")}
                        </span>
                      )}
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className="shrink-0 text-[var(--app-muted)]"
                        aria-label={t("library.artifacts.downloadNamed", {
                          name: file.name,
                        })}
                        aria-busy={downloading || undefined}
                        disabled={downloadingFileId !== undefined}
                        onClick={() => void download(file)}
                      >
                        {downloading ? (
                          <LoaderCircleIcon
                            className="animate-spin"
                            aria-hidden="true"
                          />
                        ) : (
                          <DownloadIcon aria-hidden="true" />
                        )}
                      </Button>
                    </div>
                  )
                })}
              </div>
            </section>
          ))}
          {hasNextPage && (
            <div
              ref={loadMoreRef}
              className="flex min-h-8 items-center justify-center gap-2 pt-1 text-[length:var(--app-font-12)] text-[var(--app-muted)]"
              role="status"
              aria-live="polite"
              aria-busy={isFetchingNextPage || undefined}
            >
              {isFetchingNextPage && (
                <>
                  <Spinner />
                  <span>{t("library.artifacts.loadingMore")}</span>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  )
}

function groupTaskArtifacts(files: readonly TaskArtifact[]) {
  const groups = new Map<string, TaskArtifactGroup>()
  for (const file of files) {
    const current = groups.get(file.task.id)
    if (current) {
      current.files.push(file)
      continue
    }
    groups.set(file.task.id, {
      task: file.task,
      latestCreatedAt: file.created_at,
      files: [file],
    })
  }
  return [...groups.values()]
}
