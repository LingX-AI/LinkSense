import {
  useCallback,
  useDeferredValue,
  useEffect,
  useRef,
  useState,
} from "react"
import { useInfiniteQuery } from "@tanstack/react-query"
import { LoaderCircleIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import { getErrorMessage } from "@/api/error-message"
import { ErrorState, LoadingState } from "@/components/feedback/page-state"
import { FileTypeIcon } from "@/components/media/file-type-icon"
import { Button } from "@/components/ui/button"
import {
  Command,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
} from "@/components/ui/popover"
import { normalizeLanguage } from "@/i18n"
import { formatDateTime, formatFileSize } from "@/i18n/date"

import {
  getReferenceableFiles,
  referenceFileKeys,
  type ReferenceableFile,
} from "./reference-file-api"

export function ReferenceFilePopover({
  anchor,
  open,
  onOpenChange,
  currentConversationId,
  disabled,
  onReference,
}: {
  anchor: React.ComponentProps<typeof PopoverContent>["anchor"]
  open: boolean
  onOpenChange: (open: boolean) => void
  currentConversationId?: string
  disabled: boolean
  onReference: (file: ReferenceableFile) => Promise<boolean>
}) {
  const { t, i18n } = useTranslation()
  const language = normalizeLanguage(i18n.resolvedLanguage) ?? "zh-CN"
  const [search, setSearch] = useState("")
  const [selectedFiles, setSelectedFiles] = useState(
    () => new Map<string, ReferenceableFile>()
  )
  const [submittingFileId, setSubmittingFileId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)
  const loadMoreRef = useRef<HTMLDivElement | null>(null)
  const loadMoreInFlightRef = useRef(false)
  const deferredSearch = useDeferredValue(search.trim())
  const query = useInfiniteQuery({
    queryKey: referenceFileKeys.list(currentConversationId, deferredSearch),
    enabled: open,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) =>
      getReferenceableFiles({
        search: deferredSearch || undefined,
        excludeConversationId: currentConversationId,
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
  const files = query.data?.pages.flatMap((page) => page.items) ?? []
  const loadNextPage = useCallback(() => {
    if (loadMoreInFlightRef.current) return
    loadMoreInFlightRef.current = true
    void fetchNextPage().finally(() => {
      loadMoreInFlightRef.current = false
    })
  }, [fetchNextPage])

  useEffect(() => {
    const target = loadMoreRef.current
    if (
      !open ||
      !target ||
      !hasNextPage ||
      isFetchingNextPage ||
      isFetchNextPageError ||
      submittingFileId
    ) {
      return
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) loadNextPage()
      },
      {
        root: listRef.current,
        rootMargin: "0px 0px 160px 0px",
      }
    )
    observer.observe(target)
    return () => observer.disconnect()
  }, [
    open,
    hasNextPage,
    isFetchingNextPage,
    isFetchNextPageError,
    submittingFileId,
    loadNextPage,
  ])

  const changeOpen = (nextOpen: boolean) => {
    if (submittingFileId) return
    onOpenChange(nextOpen)
    if (!nextOpen) {
      setSearch("")
      setSelectedFiles(new Map())
      setError(null)
    }
  }

  const toggleFile = (file: ReferenceableFile) => {
    if (disabled || submittingFileId) return
    setSelectedFiles((current) => {
      const next = new Map(current)
      if (next.has(file.id)) next.delete(file.id)
      else next.set(file.id, file)
      return next
    })
  }

  const addSelectedFiles = async () => {
    if (disabled || submittingFileId || selectedFiles.size === 0) return
    setError(null)
    for (const file of selectedFiles.values()) {
      setSubmittingFileId(file.id)
      try {
        if (!(await onReference(file))) {
          setError(t("conversation.referenceFile.addFailed"))
          return
        }
        setSelectedFiles((current) => {
          const next = new Map(current)
          next.delete(file.id)
          return next
        })
      } catch (nextError) {
        setError(getErrorMessage(nextError, t))
        return
      } finally {
        setSubmittingFileId(null)
      }
    }
    changeOpenAfterReference()
  }

  const changeOpenAfterReference = () => {
    onOpenChange(false)
    setSearch("")
    setSelectedFiles(new Map())
    setError(null)
  }

  return (
    <Popover open={open} onOpenChange={changeOpen}>
      <PopoverContent
        anchor={anchor}
        side="top"
        align="start"
        sideOffset={4}
        className="capability-popover capability-picker-popover max-h-[min(70vh,680px)] gap-2 overflow-hidden"
      >
        <PopoverHeader className="sr-only">
          <PopoverTitle>{t("conversation.referenceFile.title")}</PopoverTitle>
          <PopoverDescription>
            {t("conversation.referenceFile.description")}
          </PopoverDescription>
        </PopoverHeader>
        <Command
          className="min-h-0 bg-transparent"
          label={t("conversation.referenceFile.searchPlaceholder")}
          shouldFilter={false}
        >
          <CommandInput
            value={search}
            onValueChange={setSearch}
            aria-label={t("conversation.referenceFile.searchPlaceholder")}
            placeholder={t("conversation.referenceFile.searchPlaceholder")}
            disabled={Boolean(submittingFileId)}
            autoFocus
          />
          {error && <ErrorState message={error} />}
          <CommandList
            ref={listRef}
            className="max-h-[min(60vh,600px)] min-h-0 [&_[data-slot=command-item]]:rounded-md"
          >
            {query.isPending && <LoadingState />}
            {!query.isPending && query.isError && !isFetchNextPageError && (
              <ErrorState
                message={getErrorMessage(query.error, t)}
                onRetry={() => void query.refetch()}
              />
            )}
            {!query.isPending && !query.isError && files.length === 0 && (
              <p className="py-6 text-center text-sm text-muted-foreground">
                {t("conversation.referenceFile.empty")}
              </p>
            )}
            {files.map((file) => (
              <CommandItem
                key={file.id}
                value={file.id}
                className="min-h-9 gap-2 px-2 py-1.5 text-left whitespace-nowrap [&>svg:last-child]:ml-0"
                data-checked={selectedFiles.has(file.id) || undefined}
                aria-label={t(
                  selectedFiles.has(file.id)
                    ? "conversation.referenceFile.deselectFile"
                    : "conversation.referenceFile.selectFile",
                  {
                    filename: file.filename,
                    task: file.task.title,
                  }
                )}
                disabled={disabled || Boolean(submittingFileId)}
                onSelect={() => toggleFile(file)}
              >
                <FileTypeIcon
                  filename={file.filename}
                  mimeType={file.mime_type}
                  className="size-5 shrink-0"
                />
                <span
                  data-slot="reference-file-name"
                  className="max-w-80 min-w-0 truncate text-xs font-medium"
                  title={file.filename}
                >
                  {file.filename}
                </span>
                <span
                  data-slot="reference-file-size"
                  className="shrink-0 text-[length:var(--app-font-12)] text-muted-foreground"
                >
                  · {formatFileSize(file.size_bytes, language)}
                </span>
                <span
                  data-slot="reference-file-time"
                  className="ml-auto shrink-0 text-[length:var(--app-font-12)] text-muted-foreground"
                >
                  {formatDateTime(file.created_at, language)}
                </span>
              </CommandItem>
            ))}
            {isFetchNextPageError && (
              <ErrorState
                message={getErrorMessage(query.error, t)}
                onRetry={loadNextPage}
              />
            )}
            {isFetchingNextPage && <LoadingState />}
            {hasNextPage && !isFetchNextPageError && (
              <div ref={loadMoreRef} aria-hidden="true" className="h-1" />
            )}
          </CommandList>
        </Command>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="self-end"
          disabled={
            disabled || Boolean(submittingFileId) || selectedFiles.size === 0
          }
          onClick={() => void addSelectedFiles()}
        >
          {submittingFileId && (
            <LoaderCircleIcon
              className="size-4 animate-spin"
              aria-hidden="true"
            />
          )}
          {t("conversation.referenceFile.addSelected", {
            count: selectedFiles.size,
          })}
        </Button>
      </PopoverContent>
    </Popover>
  )
}
