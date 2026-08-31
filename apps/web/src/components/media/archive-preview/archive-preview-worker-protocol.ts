import type {
  ArchivePreviewItem,
  ArchivePreviewManifest,
} from "@/components/media/archive-preview/archive-preview-utils"

export type ArchivePreviewWorkerRequest =
  | Readonly<{
      type: "parse"
      requestId: string
      archive: Blob
    }>
  | Readonly<{
      type: "extract"
      requestId: string
      archive: Blob
      item: ArchivePreviewItem
    }>

export type ArchivePreviewWorkerErrorCode =
  | "archive_entry_encrypted"
  | "archive_entry_not_found"
  | "archive_entry_unavailable"
  | "archive_preview_unavailable"

export type ArchivePreviewWorkerResponse =
  | Readonly<{
      type: "success"
      requestId: string
      manifest: ArchivePreviewManifest
    }>
  | Readonly<{
      type: "entry"
      requestId: string
      content: ArrayBuffer
    }>
  | Readonly<{
      type: "error"
      requestId: string
      code: ArchivePreviewWorkerErrorCode
    }>
