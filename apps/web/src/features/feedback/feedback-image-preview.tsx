import { useEffect, useState } from "react"
import type { FeedbackImage } from "@linksense/shared"
import { FileImageIcon } from "lucide-react"
import { useTranslation } from "react-i18next"
import { downloadApiFile } from "@/api/client"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Spinner } from "@/components/ui/spinner"
import { formatFileSize } from "@/i18n/date"

export function FeedbackImagePreview({
  basePath,
  image,
  language,
}: {
  basePath: string
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
      `${basePath}/images/${image.id}`,
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
  }, [basePath, image.id])

  return (
    <li className="flex min-w-0 flex-col gap-1.5">
      <div className="h-32">
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
