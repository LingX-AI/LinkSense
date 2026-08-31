import { beforeEach, describe, expect, it, vi } from "vitest"

import type {
  ArchivePreviewWorkerRequest,
  ArchivePreviewWorkerResponse,
} from "@/components/media/archive-preview/archive-preview-worker-protocol"
import {
  buildArchivePreviewManifest,
  type ArchivePreviewItem,
} from "@/components/media/archive-preview/archive-preview-utils"

const archiveReader = vi.hoisted(() => ({
  readEntry: vi.fn(),
  readManifest: vi.fn(),
}))

vi.mock(
  "@/components/media/archive-preview/archive-preview-reader",
  () => ({
    readArchivePreviewEntry: archiveReader.readEntry,
    readArchivePreviewManifest: archiveReader.readManifest,
  })
)

import { handleArchivePreviewWorkerRequest } from "@/components/media/archive-preview/archive-preview.worker"

function manifest() {
  return buildArchivePreviewManifest([
    {
      filename: "docs/guide.md",
      directory: false,
      encrypted: false,
      compressedSize: 10,
      uncompressedSize: 12,
      modifiedAt: "2026-07-19T00:00:00.000Z",
      externalFileAttributes: 0,
    },
  ])
}

function fileItem() {
  return manifest().entries.find(
    (entry) => entry.kind === "file"
  ) as ArchivePreviewItem
}

function request(
  overrides: Partial<ArchivePreviewWorkerRequest> = {}
): ArchivePreviewWorkerRequest {
  return {
    type: "parse",
    requestId: "request-1",
    archive: new Blob([Uint8Array.of(1)], { type: "application/zip" }),
    ...overrides,
  } as ArchivePreviewWorkerRequest
}

function createPostMessageCapture() {
  const calls: Array<{
    response: ArchivePreviewWorkerResponse
    transfer: Transferable[] | undefined
  }> = []
  return {
    calls,
    postMessage: (
      response: ArchivePreviewWorkerResponse,
      transfer?: Transferable[]
    ) => calls.push({ response, transfer }),
  }
}

describe("archive preview worker", () => {
  beforeEach(() => {
    archiveReader.readEntry.mockReset()
    archiveReader.readManifest.mockReset()
  })

  it("returns the metadata manifest for a parse request", async () => {
    const expectedManifest = manifest()
    archiveReader.readManifest.mockResolvedValue(expectedManifest)
    const capture = createPostMessageCapture()
    const parseRequest = request()

    await handleArchivePreviewWorkerRequest(parseRequest, capture.postMessage)

    expect(archiveReader.readManifest).toHaveBeenCalledWith(parseRequest.archive)
    expect(capture.calls).toEqual([
      {
        response: {
          type: "success",
          requestId: "request-1",
          manifest: expectedManifest,
        },
        transfer: undefined,
      },
    ])
  })

  it("extracts only the requested item and transfers its bytes", async () => {
    const item = fileItem()
    const content = Uint8Array.of(9, 8, 7)
    archiveReader.readEntry.mockResolvedValue(content)
    const capture = createPostMessageCapture()
    const extractRequest = request({ type: "extract", item })

    await handleArchivePreviewWorkerRequest(extractRequest, capture.postMessage)

    expect(archiveReader.readEntry).toHaveBeenCalledWith(
      extractRequest.archive,
      item
    )
    expect(capture.calls).toHaveLength(1)
    const [call] = capture.calls
    expect(call?.response).toMatchObject({
      type: "entry",
      requestId: "request-1",
    })
    if (call?.response.type !== "entry") throw new Error("entry expected")
    expect(Array.from(new Uint8Array(call.response.content))).toEqual([9, 8, 7])
    expect(call.transfer).toEqual([call.response.content])
  })

  it("returns a safe encrypted-entry error code", async () => {
    archiveReader.readEntry.mockRejectedValue({ code: "entry_encrypted" })
    const capture = createPostMessageCapture()
    const extractRequest = request({ type: "extract", item: fileItem() })

    await handleArchivePreviewWorkerRequest(extractRequest, capture.postMessage)

    expect(capture.calls).toEqual([
      {
        response: {
          type: "error",
          requestId: "request-1",
          code: "archive_entry_encrypted",
        },
        transfer: undefined,
      },
    ])
  })
})
