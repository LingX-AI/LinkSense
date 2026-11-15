import { useId, useState } from "react"
import type { RichOutputProps } from "@linksense/shared"
import { DownloadIcon, LoaderCircleIcon } from "lucide-react"
import { useTranslation } from "react-i18next"
import type { ConversationFile } from "@/api/contracts"

import {
  ImagePreviewDialog,
  type ImagePreviewItem,
} from "@/components/media/image-preview"
import { Button } from "@/components/ui/button"
import { AssistantMarkdownImage } from "./assistant-markdown-image"
import { ConversationArtifactFiles } from "./conversation-artifact-files"
import { isPreviewableConversationImage } from "./conversation-attachment-preview-utils"
import { FileTile } from "./conversation-file-tile"
import {
  resolveRichOutputArtifact,
  useRenderedRichOutputFiles,
  useRichOutputResources,
} from "./rich-output-resource-context"

export function ResourceList({
  title,
  items,
}: RichOutputProps<"ResourceList">) {
  const { t } = useTranslation()
  const titleId = useId()
  const {
    filesById,
    loadPreview,
    onPreviewFile,
    onDownload,
    downloadingFileId,
  } = useRichOutputResources()
  const entries = items.map((item) => ({
    item,
    file: resolveRichOutputArtifact(item.fileId, filesById),
  }))
  useRenderedRichOutputFiles(
    entries.flatMap(({ file }) => (file ? [file] : []))
  )
  return (
    <section aria-labelledby={titleId} className="min-w-0 space-y-3">
      <h3 id={titleId} className="text-sm font-medium wrap-anywhere">
        {title}
      </h3>
      <ul role="list" className="space-y-3">
        {entries.map(({ item, file }) => (
          <li key={item.fileId} className="min-w-0 space-y-1">
            <p className="text-sm wrap-anywhere">{item.label}</p>
            {item.detail && (
              <p className="text-xs wrap-anywhere whitespace-pre-wrap text-muted-foreground">
                {item.detail}
              </p>
            )}
            {file && onDownload ? (
              <ConversationArtifactFiles
                files={[file]}
                loadPreview={loadPreview}
                onPreviewOfficeDocument={onPreviewFile}
                onDownload={onDownload}
                downloadingFileId={downloadingFileId}
                renderFallback={(file) => (
                  <FileTile
                    file={file}
                    artifact
                    onDownload={onDownload}
                    downloading={downloadingFileId === file.id}
                  />
                )}
              />
            ) : (
              <p className="text-xs text-muted-foreground">
                {t("richOutput.resourceUnavailable")}
              </p>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}

export function MediaGallery({
  title,
  items,
}: RichOutputProps<"MediaGallery">) {
  const { t } = useTranslation()
  const titleId = useId()
  const { filesById, onDownload } = useRichOutputResources()
  const entries = items.map((item) => {
    const file = resolveRichOutputArtifact(item.fileId, filesById)
    return {
      item,
      file: file && isPreviewableConversationImage(file) ? file : undefined,
    }
  })
  useRenderedRichOutputFiles(
    entries.flatMap(({ file }) => (file ? [file] : []))
  )
  return (
    <section aria-labelledby={titleId} className="@container min-w-0 space-y-3">
      <h3 id={titleId} className="text-sm font-medium wrap-anywhere">
        {title}
      </h3>
      <ul
        role="list"
        className="grid grid-cols-1 gap-3 @sm:grid-cols-2 @2xl:grid-cols-3"
      >
        {entries.map(({ item, file }) => (
          <li key={item.fileId} className="min-w-0">
            <figure className="space-y-2">
              {file && onDownload ? (
                <GalleryImage
                  file={file}
                  alt={item.alt}
                  onDownload={onDownload}
                />
              ) : (
                <div className="flex aspect-video items-center justify-center rounded-lg bg-muted/50 p-3 text-center text-xs text-muted-foreground">
                  {t("richOutput.resourceUnavailable")}
                </div>
              )}
              <figcaption className="space-y-1 text-sm wrap-anywhere">
                <p>{item.alt}</p>
                {item.caption && (
                  <p className="text-xs whitespace-pre-wrap text-muted-foreground">
                    {item.caption}
                  </p>
                )}
              </figcaption>
            </figure>
          </li>
        ))}
      </ul>
    </section>
  )
}

function GalleryImage({
  file,
  alt,
  onDownload,
}: {
  file: ConversationFile
  alt: string
  onDownload: (file: ConversationFile) => void
}) {
  const { t } = useTranslation()
  const { loadPreview, downloadingFileId } = useRichOutputResources()
  const [preview, setPreview] = useState<ImagePreviewItem | null>(null)
  const downloading = downloadingFileId === file.id
  return (
    <div className="relative min-w-0">
      <AssistantMarkdownImage
        source={`linksense-artifact:${file.id}`}
        file={file}
        alt={alt}
        loadPreview={loadPreview}
        className="h-full w-full object-contain"
        surfaceClassName="aspect-video w-full overflow-hidden rounded-lg bg-muted/50"
        previewTriggerClassName="h-full w-full rounded-lg p-0 focus-visible:ring-inset"
        onPreview={(source) =>
          setPreview({
            id: file.id,
            name: file.name,
            alt,
            src: source.url,
            downloadable: true,
            ...(source.retain ? { retainSource: source.retain } : {}),
          })
        }
      />
      <Button
        type="button"
        variant="floating"
        size="icon-sm"
        className="absolute top-2 right-2"
        aria-label={t("conversation.downloadArtifact", { name: file.name })}
        aria-busy={downloading || undefined}
        disabled={downloading}
        onClick={() => onDownload(file)}
      >
        {downloading ? (
          <LoaderCircleIcon
            className="animate-spin motion-reduce:animate-none"
            aria-hidden="true"
          />
        ) : (
          <DownloadIcon aria-hidden="true" />
        )}
      </Button>
      {preview && (
        <ImagePreviewDialog
          items={[preview]}
          activeId={preview.id}
          onActiveIdChange={(id) => {
            if (id === null) setPreview(null)
          }}
          onDownload={() => onDownload(file)}
          downloadingId={downloadingFileId}
        />
      )}
    </div>
  )
}
