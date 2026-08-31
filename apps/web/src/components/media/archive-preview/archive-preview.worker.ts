import {
  readArchivePreviewEntry,
  readArchivePreviewManifest,
} from "@/components/media/archive-preview/archive-preview-reader"
import type {
  ArchivePreviewWorkerErrorCode,
  ArchivePreviewWorkerRequest,
  ArchivePreviewWorkerResponse,
} from "@/components/media/archive-preview/archive-preview-worker-protocol"

type WorkerPostMessage = (
  response: ArchivePreviewWorkerResponse,
  transfer?: Transferable[]
) => void

const workerScope = globalThis as unknown as {
  addEventListener: (
    type: "message",
    listener: (event: MessageEvent<unknown>) => void
  ) => void
  postMessage: WorkerPostMessage
}

function getErrorCode(
  error: unknown,
  request: ArchivePreviewWorkerRequest
): ArchivePreviewWorkerErrorCode {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    (error.code === "entry_encrypted" || error.code === "entry_not_found")
  ) {
    return `archive_${error.code}`
  }
  return request.type === "extract"
    ? "archive_entry_unavailable"
    : "archive_preview_unavailable"
}

function isArchivePreviewWorkerRequest(
  value: unknown
): value is ArchivePreviewWorkerRequest {
  if (!value || typeof value !== "object") return false
  const request = value as Partial<ArchivePreviewWorkerRequest>
  if (
    typeof request.requestId !== "string" ||
    !(request.archive instanceof Blob)
  ) {
    return false
  }
  return (
    request.type === "parse" ||
    (request.type === "extract" &&
      !!request.item &&
      typeof request.item === "object")
  )
}

export async function handleArchivePreviewWorkerRequest(
  request: ArchivePreviewWorkerRequest,
  postMessage: WorkerPostMessage
): Promise<void> {
  try {
    if (request.type === "parse") {
      const manifest = await readArchivePreviewManifest(request.archive)
      postMessage({
        type: "success",
        requestId: request.requestId,
        manifest,
      })
      return
    }

    const content = await readArchivePreviewEntry(
      request.archive,
      request.item
    )
    const transferableContent = content.buffer
    postMessage(
      {
        type: "entry",
        requestId: request.requestId,
        content: transferableContent,
      },
      [transferableContent]
    )
  } catch (error) {
    postMessage({
      type: "error",
      requestId: request.requestId,
      code: getErrorCode(error, request),
    })
  }
}

workerScope.addEventListener("message", (event) => {
  if (!isArchivePreviewWorkerRequest(event.data)) return
  void handleArchivePreviewWorkerRequest(event.data, (response, transfer) =>
    workerScope.postMessage(response, transfer)
  )
})
