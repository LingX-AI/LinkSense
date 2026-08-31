import { buildApiUrl, downloadApiFile } from "@/api/client"
import type { ImagePreviewItem } from "@/components/media/image-preview.types"
import { downloadBlob } from "@/lib/download-blob"

export async function downloadImagePreviewItem(
  item: ImagePreviewItem,
  onDownload?: (item: ImagePreviewItem) => void | Promise<void>
) {
  if (onDownload) {
    await onDownload(item)
    return
  }

  if (shouldProxyImageDownload(item.src)) {
    const blob = await downloadApiFile("/external-images/download", {
      url: item.src,
    })
    downloadBlob(blob, item.name)
    return
  }

  const response = await fetch(item.src)
  if (!response.ok) throw new Error("image_download_failed")
  downloadBlob(await response.blob(), item.name)
}

function shouldProxyImageDownload(src: string): boolean {
  try {
    const sourceUrl = new URL(src, window.location.href)
    if (sourceUrl.protocol !== "http:" && sourceUrl.protocol !== "https:") {
      return false
    }
    const apiUrl = new URL(
      buildApiUrl("/external-images/download"),
      window.location.href
    )
    return (
      sourceUrl.origin !== window.location.origin &&
      sourceUrl.origin !== apiUrl.origin
    )
  } catch {
    return false
  }
}
