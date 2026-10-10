import { createRandomUuid } from "@/lib/random-uuid"
import type {
  ArchivePreviewItem,
  ArchivePreviewManifest,
} from "@/components/media/archive-preview/archive-preview-utils"
import type {
  ArchivePreviewWorkerRequest,
  ArchivePreviewWorkerResponse,
} from "@/components/media/archive-preview/archive-preview-worker-protocol"

type ArchivePreviewWorkerAction =
  | Readonly<{ type: "parse" }>
  | Readonly<{ type: "extract"; item: ArchivePreviewItem }>

function createAbortError() {
  return new DOMException("Archive preview was cancelled", "AbortError")
}

function createWorkerError(code: string) {
  return new Error(code)
}

function createWorkerRequest(
  action: ArchivePreviewWorkerAction,
  requestId: string,
  content: Uint8Array
): ArchivePreviewWorkerRequest {
  const archive = new Blob([new Uint8Array(content)], {
    type: "application/zip",
  })
  return action.type === "parse"
    ? { type: "parse", requestId, archive }
    : { type: "extract", requestId, archive, item: action.item }
}

function loadArchivePreviewWorker(
  content: Uint8Array,
  action: ArchivePreviewWorkerAction,
  signal: AbortSignal
): Promise<ArchivePreviewWorkerResponse> {
  if (signal.aborted) return Promise.reject(createAbortError())

  return new Promise((resolve, reject) => {
    const requestId = createRandomUuid()
    let worker: Worker
    try {
      worker = new Worker(
        new URL("./archive-preview.worker.ts", import.meta.url),
        { type: "module" }
      )
    } catch {
      reject(createWorkerError("archive_preview_worker_failed"))
      return
    }
    let settled = false

    const cleanup = () => {
      worker.removeEventListener("message", onMessage)
      worker.removeEventListener("error", onError)
      signal.removeEventListener("abort", onAbort)
      worker.terminate()
    }
    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      cleanup()
      callback()
    }
    const onMessage = (event: MessageEvent<ArchivePreviewWorkerResponse>) => {
      const response = event.data
      if (response.requestId !== requestId) return
      if (response.type === "error") {
        finish(() => reject(createWorkerError(response.code)))
        return
      }
      const expectedResponseType =
        action.type === "parse" ? "success" : "entry"
      if (response.type !== expectedResponseType) {
        finish(() => reject(createWorkerError("archive_preview_worker_failed")))
        return
      }
      finish(() => resolve(response))
    }
    const onError = () =>
      finish(() => reject(createWorkerError("archive_preview_worker_failed")))
    const onAbort = () => finish(() => reject(createAbortError()))

    worker.addEventListener("message", onMessage)
    worker.addEventListener("error", onError)
    signal.addEventListener("abort", onAbort, { once: true })
    try {
      worker.postMessage(createWorkerRequest(action, requestId, content))
    } catch {
      finish(() => reject(createWorkerError("archive_preview_worker_failed")))
    }
  })
}

/**
 * Keeps ZIP central-directory parsing off the rendering thread. The Blob is
 * cloned by reference, so the original bytes remain available for download.
 */
export function loadArchivePreviewManifest(
  content: Uint8Array,
  signal: AbortSignal
): Promise<ArchivePreviewManifest> {
  return loadArchivePreviewWorker(content, { type: "parse" }, signal).then(
    (response) => {
      if (response.type !== "success") {
        throw createWorkerError("archive_preview_worker_failed")
      }
      return response.manifest
    }
  )
}

/**
 * Extracts a single manifest-backed ZIP entry in the archive worker. The
 * worker rebuilds the manifest before extraction and does not trust this item
 * alone for path, size, or encryption checks.
 */
export function loadArchivePreviewEntry(
  content: Uint8Array,
  item: ArchivePreviewItem,
  signal: AbortSignal
): Promise<Uint8Array> {
  return loadArchivePreviewWorker(content, { type: "extract", item }, signal).then(
    (response) => {
      if (response.type !== "entry") {
        throw createWorkerError("archive_preview_worker_failed")
      }
      return new Uint8Array(response.content)
    }
  )
}
