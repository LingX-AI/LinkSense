// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  loadArchivePreviewEntry,
  loadArchivePreviewManifest,
} from "@/components/media/archive-preview/archive-preview-loader"
import {
  buildArchivePreviewManifest,
  type ArchivePreviewItem,
} from "@/components/media/archive-preview/archive-preview-utils"
import type {
  ArchivePreviewWorkerRequest,
  ArchivePreviewWorkerResponse,
} from "@/components/media/archive-preview/archive-preview-worker-protocol"

class ArchiveWorkerMock {
  static instances: ArchiveWorkerMock[] = []

  readonly postMessage = vi.fn()
  readonly terminate = vi.fn()
  readonly #listeners = new Map<string, Set<(event: Event) => void>>()

  constructor() {
    ArchiveWorkerMock.instances.push(this)
  }

  addEventListener(type: string, listener: (event: Event) => void) {
    const listeners = this.#listeners.get(type) ?? new Set()
    listeners.add(listener)
    this.#listeners.set(type, listeners)
  }

  removeEventListener(type: string, listener: (event: Event) => void) {
    this.#listeners.get(type)?.delete(listener)
  }

  emitMessage(response: ArchivePreviewWorkerResponse) {
    for (const listener of this.#listeners.get("message") ?? []) {
      listener(new MessageEvent("message", { data: response }))
    }
  }
}

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

function requestFor(
  worker: ArchiveWorkerMock
): ArchivePreviewWorkerRequest {
  return worker.postMessage.mock.calls[0]?.[0] as ArchivePreviewWorkerRequest
}

function latestWorker() {
  const worker = ArchiveWorkerMock.instances.at(-1)
  if (!worker) throw new Error("worker was not created")
  return worker
}

describe("archive preview loader", () => {
  const originalWorker = Object.getOwnPropertyDescriptor(globalThis, "Worker")

  beforeEach(() => {
    ArchiveWorkerMock.instances = []
    Object.defineProperty(globalThis, "Worker", {
      configurable: true,
      writable: true,
      value: ArchiveWorkerMock,
    })
  })

  afterEach(() => {
    if (originalWorker) {
      Object.defineProperty(globalThis, "Worker", originalWorker)
      return
    }
    Reflect.deleteProperty(globalThis, "Worker")
  })

  it("asks the worker to parse the archive and cleans it up after success", async () => {
    const controller = new AbortController()
    const expectedManifest = manifest()
    const pending = loadArchivePreviewManifest(
      new Uint8Array([1, 2, 3]),
      controller.signal
    )
    const worker = latestWorker()
    const request = requestFor(worker)

    expect(request).toMatchObject({ type: "parse" })
    worker.emitMessage({
      type: "success",
      requestId: request.requestId,
      manifest: expectedManifest,
    })

    await expect(pending).resolves.toBe(expectedManifest)
    expect(worker.terminate).toHaveBeenCalledOnce()
  })

  it("sends the complete manifest item when extracting one archive entry", async () => {
    const controller = new AbortController()
    const item = manifest().entries.find(
      (entry) => entry.kind === "file"
    ) as ArchivePreviewItem
    const pending = loadArchivePreviewEntry(
      new Uint8Array([1, 2, 3]),
      item,
      controller.signal
    )
    const worker = latestWorker()
    const request = requestFor(worker)

    expect(request).toMatchObject({ type: "extract", item })
    const entryContent = Uint8Array.of(9, 8, 7)
    worker.emitMessage({
      type: "entry",
      requestId: request.requestId,
      content: entryContent.buffer,
    })

    expect(Array.from(await pending)).toEqual(Array.from(entryContent))
    expect(worker.terminate).toHaveBeenCalledOnce()
  })

  it("preserves a safe entry-read error code from the worker", async () => {
    const controller = new AbortController()
    const item = manifest().entries.find(
      (entry) => entry.kind === "file"
    ) as ArchivePreviewItem
    const pending = loadArchivePreviewEntry(
      new Uint8Array([1, 2, 3]),
      item,
      controller.signal
    )
    const worker = latestWorker()
    const request = requestFor(worker)

    worker.emitMessage({
      type: "error",
      requestId: request.requestId,
      code: "archive_entry_not_found",
    })

    await expect(pending).rejects.toThrow("archive_entry_not_found")
    expect(worker.terminate).toHaveBeenCalledOnce()
  })

  it("terminates an in-flight entry extraction when cancelled", async () => {
    const controller = new AbortController()
    const item = manifest().entries.find(
      (entry) => entry.kind === "file"
    ) as ArchivePreviewItem
    const pending = loadArchivePreviewEntry(
      new Uint8Array([1, 2, 3]),
      item,
      controller.signal
    )
    const worker = latestWorker()

    controller.abort()

    await expect(pending).rejects.toMatchObject({ name: "AbortError" })
    expect(worker.terminate).toHaveBeenCalledOnce()
  })
})
