import { useEffect, useMemo, useRef, useState } from "react"
import {
  CircleAlertIcon,
  FileCheckIcon,
  FileUpIcon,
  FilesIcon,
  FolderUpIcon,
  LoaderCircleIcon,
  LocateFixedIcon,
  ReplaceIcon,
  UploadIcon,
} from "lucide-react"
import { useTranslation } from "react-i18next"

import { getErrorMessage } from "@/api/error-message"
import { FieldShell } from "@/components/forms/form-field"
import { StatusBanner } from "@/components/feedback/status-banner"
import { FileTypeIcon } from "@/components/media/file-type-icon"
import { Badge } from "@/components/ui/badge"
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
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Progress,
  ProgressLabel,
  ProgressValue,
} from "@/components/ui/progress"
import { Switch } from "@/components/ui/switch"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import {
  uploadKnowledgeDocument,
  type KnowledgeUploadConflictOptions,
} from "@/features/knowledge-bases/knowledge-base-api"
import type { KnowledgeDocument } from "@/features/knowledge-bases/knowledge-base-contracts"
import { useKnowledgeUploadLimits } from "@/features/knowledge-bases/knowledge-base-hooks"
import {
  formatKnowledgeBytes,
  getKnowledgeStageLabel,
  getKnowledgeStableErrorLabel,
  isKnowledgeUploadImageFile,
  isKnowledgeStageIndeterminate,
  knowledgeUploadAccept,
  validateKnowledgeUploadFile,
} from "@/features/knowledge-bases/knowledge-base-utils"
import { normalizeLanguage } from "@/i18n"
import { formatDateTime } from "@/i18n/date"

type UploadQueueState =
  | "waiting"
  | "uploading"
  | "processing"
  | "ready"
  | "duplicate"
  | "conflict"
  | "skipped"
  | "failed"

type UploadQueueItem = {
  id: string
  file: File
  relativePath?: string
  ocrEnabled: boolean
  state: UploadQueueState
  progress: number
  error?: string
  document?: KnowledgeDocument
  existingDocument?: KnowledgeDocument
}

export function KnowledgeUploadDialog({
  open,
  onOpenChange,
  knowledgeBaseId,
  parentEntryId,
  documents,
  onUploaded,
  onLocateDocument,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  knowledgeBaseId: string
  parentEntryId?: string
  documents: KnowledgeDocument[]
  onUploaded: () => void | Promise<void>
  onLocateDocument: (documentId: string) => void
}) {
  const { t, i18n } = useTranslation()
  const locale = normalizeLanguage(i18n.resolvedLanguage) ?? "zh-CN"
  const [items, setItems] = useState<UploadQueueItem[]>([])
  const [batchError, setBatchError] = useState<string>()
  const [batchRunning, setBatchRunning] = useState(false)
  const [ocrEnabled, setOcrEnabled] = useState(false)
  const [uploadMode, setUploadMode] = useState<"files" | "folder">("files")
  const [activeRequestCount, setActiveRequestCount] = useState(0)
  const [conflictItemId, setConflictItemId] = useState<string>()
  const controllersRef = useRef(new Map<string, AbortController>())
  const fileInputRef = useRef<HTMLInputElement>(null)
  const limitsQuery = useKnowledgeUploadLimits(open)
  const limits = limitsQuery.data
  const maxFileSizeLabel = limits
    ? formatKnowledgeBytes(limits.max_file_size_bytes, locale)
    : undefined
  const waitingCount = items.filter((item) => item.state === "waiting").length
  const hasQueue = items.length > 0
  const queueSummary = useMemo(
    () =>
      t("knowledge.upload.queueSummary", {
        total: items.length,
        waiting: waitingCount,
      }),
    [items.length, t, waitingCount]
  )
  const conflictItem = items.find((item) => item.id === conflictItemId)
  const uploading = batchRunning || activeRequestCount > 0
  const shouldRecommendOcr = items.some(
    (item) =>
      item.state === "waiting" &&
      !item.ocrEnabled &&
      isKnowledgeUploadImageFile(item.file)
  )

  useEffect(() => {
    const input = fileInputRef.current
    if (!input) return
    if (uploadMode === "folder") {
      input.setAttribute("webkitdirectory", "")
    } else {
      input.removeAttribute("webkitdirectory")
    }
  }, [uploadMode])

  useEffect(() => {
    const documentsById = new Map(
      documents.map((document) => [document.id, document])
    )
    setItems((current) => {
      let changed = false
      const next = current.map((item) => {
        const documentId = item.document?.id
        const latest = documentId ? documentsById.get(documentId) : undefined
        if (!latest) return item
        const nextState: UploadQueueState = latest.candidate_failure
          ? "failed"
          : latest.status === "ready" && latest.processing === null
            ? "ready"
            : latest.status === "failed"
              ? "failed"
              : "processing"
        const errorCode =
          latest.candidate_failure?.stable_error_code ??
          latest.processing?.stable_error_code
        const nextError = errorCode
          ? getKnowledgeStableErrorLabel(errorCode, t)
          : undefined
        const nextProgress =
          nextState === "ready"
            ? 100
            : Math.max(
                item.progress,
                latest.processing?.progress_percent ?? item.progress
              )
        if (
          item.document === latest &&
          item.state === nextState &&
          item.progress === nextProgress &&
          item.error === nextError
        ) {
          return item
        }
        changed = true
        return {
          ...item,
          document: latest,
          state: nextState,
          progress: nextProgress,
          error: nextError,
        }
      })
      return changed ? next : current
    })
  }, [documents, t])

  const updateItem = (
    itemId: string,
    updater: (item: UploadQueueItem) => UploadQueueItem
  ) => {
    setItems((current) =>
      current.map((item) => (item.id === itemId ? updater(item) : item))
    )
  }

  const uploadItem = async (
    item: UploadQueueItem,
    conflictResolution?: "replace" | "keep_both"
  ) => {
    const conflictOptions = item.relativePath
      ? ({ conflictResolution: "replace_path" } as const)
      : resolveUploadConflictOptions(
          conflictResolution,
          item.existingDocument?.id
        )
    if (conflictOptions === null) return
    const controller = new AbortController()
    controllersRef.current.set(item.id, controller)
    setActiveRequestCount((current) => current + 1)
    updateItem(item.id, (current) => ({
      ...current,
      state: "uploading",
      error: undefined,
      progress: Math.max(0, Math.min(current.progress, 10)),
    }))
    try {
      const result = await uploadKnowledgeDocument({
        knowledgeBaseId,
        file: item.file,
        ...(item.relativePath === undefined
          ? {}
          : { relativePath: item.relativePath }),
        ...(parentEntryId === undefined ? {} : { parentEntryId }),
        ocrEnabled: item.ocrEnabled,
        ...conflictOptions,
        signal: controller.signal,
        onProgress: (progress) =>
          updateItem(item.id, (current) => ({
            ...current,
            progress: Math.max(current.progress, progress),
          })),
      })
      if (result.status === "duplicate") {
        updateItem(item.id, (current) => ({
          ...current,
          state: "duplicate",
          progress: 10,
          existingDocument: result.existing_document,
        }))
        return
      }
      if (result.status === "name_conflict") {
        updateItem(item.id, (current) => ({
          ...current,
          state: "conflict",
          progress: 10,
          existingDocument: result.existing_document,
        }))
        setConflictItemId((current) => current ?? item.id)
        return
      }
      const document = result.document
      const processingComplete =
        document.status === "ready" &&
        document.processing === null &&
        document.candidate_failure === null
      updateItem(item.id, (current) => ({
        ...current,
        state: processingComplete ? "ready" : "processing",
        progress: processingComplete
          ? 100
          : Math.max(
              current.progress,
              document.processing?.progress_percent ?? 15
            ),
        document,
      }))
      await onUploaded()
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return
      updateItem(item.id, (current) => ({
        ...current,
        state: "failed",
        error: getErrorMessage(error, t),
      }))
    } finally {
      controllersRef.current.delete(item.id)
      setActiveRequestCount((current) => Math.max(0, current - 1))
    }
  }

  const startWaitingUploads = async () => {
    const pendingItems = items.filter((item) => item.state === "waiting")
    if (pendingItems.length === 0) return
    setBatchRunning(true)
    let cursor = 0
    const workers = Array.from(
      { length: Math.min(3, pendingItems.length) },
      async () => {
        while (cursor < pendingItems.length) {
          const item = pendingItems[cursor]
          cursor += 1
          if (item) await uploadItem(item)
        }
      }
    )
    try {
      await Promise.all(workers)
    } finally {
      setBatchRunning(false)
    }
  }

  const handleFiles = (files: FileList | null) => {
    setBatchError(undefined)
    if (!files || files.length === 0) return
    if (!limits || !maxFileSizeLabel) return
    if (files.length > limits.max_files_per_batch) {
      setBatchError(
        t("knowledge.upload.errors.tooManyFiles", {
          maxFiles: limits.max_files_per_batch,
        })
      )
      return
    }
    const nextItems = Array.from(files, (file, index): UploadQueueItem => {
      const error = validateKnowledgeUploadFile(file, t, {
        maxFileSizeBytes: limits.max_file_size_bytes,
        maxFileSizeLabel,
      })
      return {
        id: `${crypto.randomUUID?.() ?? Date.now()}-${index}`,
        file,
        ...(uploadMode === "folder"
          ? {
              relativePath:
                (file as File & { webkitRelativePath?: string })
                  .webkitRelativePath || file.name,
            }
          : {}),
        ocrEnabled,
        state: error ? "skipped" : "waiting",
        progress: 0,
        error: error ?? undefined,
      }
    })
    setItems(nextItems)
  }

  const enableOcrForWaitingBatch = () => {
    if (uploading) return
    setOcrEnabled(true)
    setItems((current) =>
      current.map((item) =>
        item.state === "waiting" ? { ...item, ocrEnabled: true } : item
      )
    )
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        onOpenChange(nextOpen)
        if (!nextOpen && !uploading) {
          setItems([])
          setBatchError(undefined)
          setConflictItemId(undefined)
          setOcrEnabled(false)
          setUploadMode("files")
        }
      }}
    >
      <DialogContent
        closeLabel={t("common.close")}
        className="knowledge-upload-dialog sm:max-w-2xl"
      >
        <DialogHeader>
          <DialogTitle>{t("knowledge.upload.title")}</DialogTitle>
        </DialogHeader>

        <Field
          orientation="horizontal"
          data-disabled={hasQueue || uploading ? true : undefined}
          className="rounded-xl bg-muted/50 p-3"
        >
          <FieldContent>
            <FieldLabel htmlFor="knowledge-upload-ocr">
              {t("knowledge.upload.ocrLabel")}
            </FieldLabel>
            <FieldDescription>
              {t("knowledge.upload.ocrDescription")}
            </FieldDescription>
          </FieldContent>
          <Switch
            id="knowledge-upload-ocr"
            checked={ocrEnabled}
            disabled={hasQueue || uploading}
            onCheckedChange={setOcrEnabled}
          />
        </Field>

        {shouldRecommendOcr && (
          <StatusBanner
            variant="info"
            actions={
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={enableOcrForWaitingBatch}
              >
                {t("knowledge.upload.enableOcrForBatch")}
              </Button>
            }
          >
            {t("knowledge.upload.ocrRecommendedForImages")}
          </StatusBanner>
        )}

        <Field orientation="horizontal" className="items-center">
          <FieldContent>
            <FieldLabel>{t("knowledge.upload.sourceType")}</FieldLabel>
            <FieldDescription>
              {t("knowledge.upload.sourceTypeDescription")}
            </FieldDescription>
          </FieldContent>
          <ToggleGroup
            value={[uploadMode]}
            disabled={hasQueue || uploading}
            variant="outline"
            spacing={0}
            aria-label={t("knowledge.upload.sourceType")}
            onValueChange={(value) => {
              const nextMode = value[0]
              if (nextMode === "files" || nextMode === "folder") {
                setUploadMode(nextMode)
              }
            }}
          >
            <ToggleGroupItem value="files">
              <FileUpIcon data-icon="inline-start" aria-hidden="true" />
              {t("knowledge.upload.filesMode")}
            </ToggleGroupItem>
            <ToggleGroupItem value="folder">
              <FolderUpIcon data-icon="inline-start" aria-hidden="true" />
              {t("knowledge.upload.folderMode")}
            </ToggleGroupItem>
          </ToggleGroup>
        </Field>

        <FieldShell
          id="knowledge-upload-files"
          label={t(
            uploadMode === "folder"
              ? "knowledge.upload.chooseFolder"
              : "knowledge.upload.chooseFiles"
          )}
          hint={
            limits && maxFileSizeLabel
              ? t("knowledge.upload.limits", {
                  maxFileSize: maxFileSizeLabel,
                  maxFiles: limits.max_files_per_batch,
                })
              : t("knowledge.upload.loadingLimits")
          }
          error={
            batchError ??
            (limitsQuery.isError
              ? getErrorMessage(limitsQuery.error, t)
              : undefined)
          }
        >
          <Input
            ref={fileInputRef}
            id="knowledge-upload-files"
            type="file"
            accept={uploadMode === "folder" ? undefined : knowledgeUploadAccept}
            multiple
            disabled={uploading || !limits}
            aria-invalid={batchError ? true : undefined}
            onChange={(event) => handleFiles(event.currentTarget.files)}
          />
        </FieldShell>
        {limitsQuery.isError && (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => void limitsQuery.refetch()}
          >
            {t("common.retry")}
          </Button>
        )}

        {hasQueue && (
          <section
            className="knowledge-upload-queue"
            aria-labelledby="knowledge-upload-queue-title"
          >
            <div className="knowledge-upload-queue-header">
              <h3 id="knowledge-upload-queue-title">
                {t("knowledge.upload.queue")}
              </h3>
              <span>{queueSummary}</span>
            </div>
            <div className="knowledge-upload-items">
              {items.map((item) => (
                <article key={item.id} className="knowledge-upload-item">
                  <FileTypeIcon
                    className="size-6"
                    filename={item.document?.display_name ?? item.file.name}
                    mimeType={item.file.type}
                  />
                  <div className="knowledge-upload-item-content">
                    <div className="knowledge-upload-item-heading">
                      <span className="truncate">
                        {item.document?.display_name ??
                          item.relativePath ??
                          item.file.name}
                      </span>
                      <span>
                        {formatKnowledgeBytes(item.file.size, locale)}
                      </span>
                    </div>
                    <div className="knowledge-upload-item-progress-row">
                      <div
                        className="knowledge-upload-item-status"
                        role="status"
                        aria-live="polite"
                      >
                        <UploadItemStatus item={item} locale={locale} />
                      </div>
                      {item.state === "skipped" && item.error && (
                        <span className="knowledge-upload-error" role="alert">
                          {item.error}
                        </span>
                      )}
                      {item.state !== "failed" &&
                        item.state !== "skipped" &&
                        item.state !== "conflict" &&
                        item.state !== "duplicate" && (
                          <UploadItemProgress item={item} />
                        )}
                    </div>
                    {item.error && item.state !== "skipped" && (
                      <p className="knowledge-upload-error" role="alert">
                        {item.error}
                      </p>
                    )}
                    {item.document &&
                      item.document.display_name !== item.file.name && (
                        <p className="text-muted-foreground">
                          {t("knowledge.upload.confirmedName", {
                            name: item.document.display_name,
                          })}
                        </p>
                      )}
                    {item.state === "duplicate" &&
                      item.existingDocument &&
                      item.relativePath === undefined && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            onLocateDocument(item.existingDocument?.id ?? "")
                            onOpenChange(false)
                          }}
                        >
                          <LocateFixedIcon
                            data-icon="inline-start"
                            aria-hidden="true"
                          />
                          {t("knowledge.upload.locateExisting")}
                        </Button>
                      )}
                    {item.state === "conflict" && (
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => setConflictItemId(item.id)}
                      >
                        <CircleAlertIcon
                          data-icon="inline-start"
                          aria-hidden="true"
                        />
                        {t("knowledge.upload.resolveConflict")}
                      </Button>
                    )}
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}

        <DialogFooter>
          <DialogClose render={<Button type="button" variant="ghost" />}>
            {t("common.close")}
          </DialogClose>
          <Button
            type="button"
            disabled={uploading || waitingCount === 0}
            onClick={() => void startWaitingUploads()}
          >
            {uploading ? (
              <LoaderCircleIcon data-icon="inline-start" aria-hidden="true" />
            ) : (
              <UploadIcon data-icon="inline-start" aria-hidden="true" />
            )}
            {t("knowledge.upload.start", { count: waitingCount })}
          </Button>
        </DialogFooter>
      </DialogContent>
      <Dialog
        open={Boolean(conflictItem)}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setConflictItemId(undefined)
        }}
      >
        <DialogContent closeLabel={t("common.close")}>
          <DialogHeader>
            <DialogTitle>{t("knowledge.upload.conflictTitle")}</DialogTitle>
            <DialogDescription>
              {t("knowledge.upload.conflictDescription", {
                incoming: conflictItem?.file.name ?? "",
                existing: conflictItem?.existingDocument?.display_name ?? "",
              })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="ghost" />}>
              {t("common.cancel")}
            </DialogClose>
            <Button
              type="button"
              variant="secondary"
              disabled={!conflictItem}
              onClick={() => {
                if (!conflictItem) return
                setConflictItemId(undefined)
                void uploadItem(conflictItem, "replace")
              }}
            >
              <ReplaceIcon data-icon="inline-start" aria-hidden="true" />
              {t("knowledge.upload.replace")}
            </Button>
            <Button
              type="button"
              disabled={!conflictItem}
              onClick={() => {
                if (!conflictItem) return
                setConflictItemId(undefined)
                void uploadItem(conflictItem, "keep_both")
              }}
            >
              <FilesIcon data-icon="inline-start" aria-hidden="true" />
              {t("knowledge.upload.keepBoth")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Dialog>
  )
}

function resolveUploadConflictOptions(
  conflictResolution: "replace" | "keep_both" | undefined,
  replaceDocumentId: string | undefined
): KnowledgeUploadConflictOptions | null {
  if (conflictResolution === "replace") {
    return replaceDocumentId === undefined
      ? null
      : { conflictResolution, replaceDocumentId }
  }
  return conflictResolution === "keep_both" ? { conflictResolution } : {}
}

function UploadItemProgress({ item }: { item: UploadQueueItem }) {
  const progressIndeterminate = Boolean(
    item.state === "processing" &&
    item.document?.processing &&
    isKnowledgeStageIndeterminate(item.document.processing.stage)
  )
  return (
    <Progress
      inline
      className="knowledge-upload-progress"
      value={progressIndeterminate ? null : item.progress}
    >
      <ProgressLabel className="sr-only">{item.file.name}</ProgressLabel>
      {!progressIndeterminate && (
        <ProgressValue className="ml-0 min-w-[3ch] shrink-0 text-right">
          {item.progress}%
        </ProgressValue>
      )}
    </Progress>
  )
}

function UploadItemStatus({
  item,
  locale,
}: {
  item: UploadQueueItem
  locale: "zh-CN" | "en-US"
}) {
  const { t } = useTranslation()
  if (item.state === "failed") {
    return (
      <Badge variant="destructive">
        <CircleAlertIcon aria-hidden="true" />
        {t("knowledge.upload.state.failed")}
      </Badge>
    )
  }
  if (item.state === "skipped") {
    return (
      <Badge variant="secondary">
        <CircleAlertIcon aria-hidden="true" />
        {t("knowledge.upload.state.skipped")}
      </Badge>
    )
  }
  if (item.state === "duplicate") {
    return (
      <Badge variant="secondary">
        <FileCheckIcon aria-hidden="true" />
        {t("knowledge.upload.state.duplicate")}
      </Badge>
    )
  }
  if (item.state === "conflict") {
    return (
      <Badge variant="secondary">
        <CircleAlertIcon aria-hidden="true" />
        {t("knowledge.upload.state.conflict")}
      </Badge>
    )
  }
  if (item.state === "processing" && item.document?.processing) {
    const retryAt = item.document.processing.retry_at
    const retryAttempt = item.document.processing.retry_attempt
    return (
      <span className="flex flex-col gap-1">
        <span className="knowledge-upload-stage">
          {getKnowledgeStageLabel(item.document.processing.stage, t)}
        </span>
        {retryAt && (
          <span className="text-muted-foreground">
            {t(
              retryAttempt === 1
                ? "knowledge.document.retryWaitingFirst"
                : retryAttempt === 2
                  ? "knowledge.document.retryWaitingSecond"
                  : "knowledge.document.retryAt",
              { date: formatDateTime(retryAt, locale) }
            )}
          </span>
        )}
      </span>
    )
  }
  return (
    <span className="knowledge-upload-stage">
      {t(`knowledge.upload.state.${item.state}`)}
    </span>
  )
}
