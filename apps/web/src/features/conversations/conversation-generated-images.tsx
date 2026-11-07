import { useState } from "react"
import { DownloadIcon, ImageOffIcon, LoaderCircleIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import type {
  ConversationFile,
  ConversationMessage,
  ConversationTurn,
  NativeCodexItem,
} from "@/api/contracts"
import {
  ImagePreviewDialog,
  type ImagePreviewItem,
} from "@/components/media/image-preview"
import { Alert, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { AssistantHtmlPreviewLoading } from "@/features/conversations/assistant-html-preview-loading"
import {
  AssistantMarkdownImage,
  type LoadArtifactPreview,
} from "@/features/conversations/assistant-markdown-image"
import { isPreviewableConversationImage } from "@/features/conversations/conversation-attachment-preview-utils"
import { selectConversationGeneratedImageIds } from "@/features/conversations/conversation-artifact-selection"

type ImageGenerationItem = Extract<NativeCodexItem, { type: "mcpToolCall" }>

export function ConversationGeneratedImages({
  items,
  registeredFileIds,
  finalMessage,
  turnId,
  turnStatus,
  running,
  filesById,
  loadPreview,
  onPreviewImage,
  onDownload,
  downloadingFileId,
}: Readonly<{
  items: readonly ImageGenerationItem[]
  registeredFileIds?: readonly string[]
  finalMessage?: ConversationMessage
  turnId: string
  turnStatus: ConversationTurn["status"]
  running: boolean
  filesById?: ReadonlyMap<string, ConversationFile>
  loadPreview?: LoadArtifactPreview
  onPreviewImage?: (item: ImagePreviewItem) => void
  onDownload: (file: ConversationFile) => void
  downloadingFileId?: string
}>) {
  const { t } = useTranslation()
  const [activePreview, setActivePreview] = useState<ImagePreviewItem | null>(
    null
  )
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const fileIds = selectConversationGeneratedImageIds({
    items,
    registeredFileIds,
    finalMessage,
    turnId,
    filesById,
  })
  const files = fileIds.flatMap((id) => {
    const file = filesById?.get(id)
    return file?.kind === "artifact" &&
      file.turn_id === turnId &&
      isPreviewableConversationImage(file)
      ? [file]
      : []
  })
  const generationActive = running && turnStatus === "running"
  const generating =
    generationActive && items.some((item) => item.status === "inProgress")
  // Artifact details refresh independently of the ordered tool events.
  const awaitingFiles = generationActive && fileIds.length > files.length
  const loadingImages = generating || awaitingFiles
  const unavailable = !awaitingFiles && fileIds.length > files.length
  const multiple = files.length > 1 || (files.length > 0 && loadingImages)
  const activeId =
    files.find((file) => file.id === selectedId)?.id ?? files[0]?.id ?? null
  const openPreview = (item: ImagePreviewItem) => {
    if (onPreviewImage) onPreviewImage(item)
    else setActivePreview(item)
  }
  const loading = () => (
    <AssistantHtmlPreviewLoading
      className="turn-image-generation-loading aspect-square min-h-0 w-full"
      label={t("conversation.imageGeneration.loading")}
    />
  )
  const frameClassName = "relative w-full overflow-hidden rounded-2xl"
  const renderImage = (file: ConversationFile) => {
    const downloading = downloadingFileId === file.id
    return (
      <div
        className="group/generated-image relative w-[32rem] max-w-full overflow-hidden rounded-2xl"
        data-slot="generated-image"
      >
        <div data-slot="generated-image-frame" className={frameClassName}>
          <AssistantMarkdownImage
            source={`linksense-artifact:${file.id}`}
            file={file}
            alt={file.name}
            loadPreview={loadPreview}
            className="block h-auto w-full object-contain"
            surfaceClassName="grid w-full"
            previewTriggerClassName="h-auto w-full overflow-hidden rounded-2xl border-0 p-0"
            loading="eager"
            loadingPlaceholder={loading()}
            onPreview={(source) =>
              openPreview({
                id: file.id,
                name: file.name,
                alt: file.name,
                src: source.url,
                downloadable: file.download_available,
                ...(source.retain ? { retainSource: source.retain } : {}),
              })
            }
          />
        </div>
        <Button
          type="button"
          variant="floating"
          size="icon"
          className="absolute top-2 right-2 transition-opacity [@media(hover:hover)_and_(pointer:fine)]:opacity-0 [@media(hover:hover)_and_(pointer:fine)]:group-focus-within/generated-image:opacity-100 [@media(hover:hover)_and_(pointer:fine)]:group-hover/generated-image:opacity-100"
          aria-label={t("conversation.downloadArtifact", { name: file.name })}
          aria-busy={downloading || undefined}
          disabled={!file.download_available || downloading}
          onClick={() => onDownload(file)}
        >
          {downloading ? (
            <LoaderCircleIcon className="animate-spin" aria-hidden="true" />
          ) : (
            <DownloadIcon aria-hidden="true" />
          )}
        </Button>
      </div>
    )
  }

  // Failures and stopped calls belong to their timeline activity. Reserve this
  // surface for pending or registered images, including unavailable artifacts.
  if (!files.length && !loadingImages && !unavailable) return null

  return (
    <div
      data-slot="generated-image-call"
      className="mt-4 flex w-fit max-w-full min-w-0 flex-col gap-3"
    >
      {multiple ? (
        <Tabs
          value={activeId}
          onValueChange={(value) => {
            if (typeof value === "string") setSelectedId(value)
          }}
          orientation="vertical"
          className="w-full min-w-0 flex-row items-start"
        >
          <div className="w-[32rem] min-w-0 shrink">
            {files.map((file) => (
              <TabsContent key={file.id} value={file.id}>
                {renderImage(file)}
              </TabsContent>
            ))}
          </div>
          <div
            data-slot="generated-image-thumbnail-scroll"
            className="max-h-[32rem] w-20 shrink-0 overflow-x-hidden overflow-y-auto"
          >
            <TabsList
              activateOnFocus
              aria-label={t("conversation.imageGeneration.images")}
              className="w-16 shrink-0 flex-col justify-start gap-2 overflow-visible p-1"
            >
              {files.map((file) => (
                <TabsTrigger
                  key={file.id}
                  value={file.id}
                  aria-label={t("conversation.imageGeneration.selectImage", {
                    name: file.name,
                  })}
                  className="size-14 min-h-0 flex-none shrink-0 overflow-hidden p-0.5 data-active:ring-2 data-active:ring-ring data-active:ring-offset-2 data-active:ring-offset-background"
                >
                  <AssistantMarkdownImage
                    source={`linksense-artifact:${file.id}`}
                    file={file}
                    alt=""
                    loadPreview={loadPreview}
                    className="size-full object-cover"
                    surfaceClassName="size-full"
                    loadingPlaceholder={
                      <Skeleton className="size-full rounded-none" />
                    }
                    errorPlaceholder={<ImageOffIcon aria-hidden="true" />}
                  />
                </TabsTrigger>
              ))}
              {loadingImages && (
                <div
                  className="size-14 shrink-0"
                  role="status"
                  aria-busy="true"
                  aria-label={t("conversation.imageGeneration.loading")}
                >
                  <Skeleton className="size-full rounded-xl" />
                </div>
              )}
            </TabsList>
          </div>
        </Tabs>
      ) : files[0] ? (
        renderImage(files[0])
      ) : loadingImages ? (
        <div
          className="relative w-[32rem] max-w-full overflow-hidden rounded-2xl"
          data-slot="generated-image"
        >
          <div data-slot="generated-image-frame" className={frameClassName}>
            {loading()}
          </div>
        </div>
      ) : null}
      {unavailable && (
        <Alert>
          <ImageOffIcon aria-hidden="true" />
          <AlertTitle>
            {t("conversation.imageGeneration.unavailable")}
          </AlertTitle>
        </Alert>
      )}
      {!onPreviewImage && (
        <ImagePreviewDialog
          items={activePreview ? [activePreview] : []}
          activeId={activePreview?.id ?? null}
          onActiveIdChange={(id) => {
            if (id === null) setActivePreview(null)
          }}
          onDownload={(item) => {
            const file = filesById?.get(item.id.toLowerCase())
            if (file) onDownload(file)
          }}
          downloadingId={downloadingFileId}
        />
      )}
    </div>
  )
}
