import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
} from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  getTaskArtifactThumbnail,
  type TaskArtifact,
} from "./task-artifact-api"
import { TaskArtifactThumbnail } from "./task-artifact-thumbnail"

const file: TaskArtifact = {
  id: "30000000-0000-4000-8000-000000000001",
  conversation_id: "20000000-0000-4000-8000-000000000001",
  turn_id: null,
  kind: "artifact",
  source: "agent_generated",
  status: "registered",
  filename: "image.png",
  name: "image.png",
  mime_type: "image/png",
  size_bytes: 500_000,
  size: 500_000,
  storage_backend: "minio",
  downloadable: true,
  download_available: true,
  created_at: "2026-10-22T00:00:00.000Z",
  updated_at: "2026-10-22T00:00:00.000Z",
  task: {
    id: "20000000-0000-4000-8000-000000000001",
    title: "图片任务",
    archive_status: "active",
  },
}

let observers: Array<{
  enter: () => void
  disconnect: ReturnType<typeof vi.fn>
}>
let clients: QueryClient[]
const createObjectURL = vi.fn(() => "blob:thumbnail")
const revokeObjectURL = vi.fn()

beforeEach(() => {
  observers = []
  clients = []
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      disconnect = vi.fn()
      observe = vi.fn()
      constructor(callback: (entries: { isIntersecting: boolean }[]) => void) {
        observers.push({
          enter: () => callback([{ isIntersecting: true }]),
          disconnect: this.disconnect,
        })
      }
    }
  )
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL = createObjectURL
      static revokeObjectURL = revokeObjectURL
    }
  )
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response("small-webp", {
          headers: { "content-type": "image/webp" },
        })
    )
  )
})

afterEach(() => {
  cleanup()
  for (const client of clients) client.clear()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

describe("task artifact thumbnails", () => {
  it("requests only the thumbnail after approaching the viewport, with a fixed rounded footprint", async () => {
    const view = renderThumbnail()
    const target = view.container.querySelector(
      '[data-slot="task-artifact-thumbnail"]'
    )
    expect(target).toHaveClass("size-10", "rounded-lg", "overflow-hidden")
    expect(fetch).not.toHaveBeenCalled()
    expect(target?.querySelector('[data-slot="skeleton"]')).not.toBeNull()

    act(() => observers[0]?.enter())
    await waitFor(() =>
      expect(target?.querySelector('img[src="blob:thumbnail"]')).not.toBeNull()
    )
    expect(fetch).toHaveBeenCalledOnce()
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining(`/files/${file.id}/thumbnail?revision=`),
      expect.objectContaining({
        cache: "default",
        signal: expect.any(AbortSignal),
      })
    )
    const image = target?.querySelector("img")
    expect(image).toHaveAttribute("width", "40")
    expect(image).toHaveAttribute("height", "40")
    expect(image).toHaveAttribute("loading", "lazy")
    expect(image).toHaveClass("object-cover")
    expect(observers[0]?.disconnect).toHaveBeenCalled()
    view.unmount()
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:thumbnail")
  })

  it("deduplicates requests and reuses the cached small blob after remounting", async () => {
    const client = queryClient()
    const view = render(
      <QueryClientProvider client={client}>
        <TaskArtifactThumbnail file={file} />
        <TaskArtifactThumbnail file={file} />
      </QueryClientProvider>
    )
    act(() => {
      for (const observer of observers) observer.enter()
    })
    await waitFor(() =>
      expect(
        view.container.querySelectorAll('img[src="blob:thumbnail"]')
      ).toHaveLength(2)
    )
    expect(fetch).toHaveBeenCalledOnce()
    view.unmount()
    const next = renderThumbnail(client)
    act(() => observers.at(-1)?.enter())
    await waitFor(() =>
      expect(
        next.container.querySelector('img[src="blob:thumbnail"]')
      ).not.toBeNull()
    )
    expect(fetch).toHaveBeenCalledOnce()
  })

  it("keeps the placeholder until decoding completes without changing its size", async () => {
    let finish: (() => void) | undefined
    vi.spyOn(HTMLImageElement.prototype, "decode").mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        })
    )
    const view = renderThumbnail()
    act(() => observers[0]?.enter())
    await waitFor(() => expect(finish).toBeDefined())
    expect(
      view.container.querySelector('[data-slot="skeleton"]')
    ).not.toBeNull()
    await act(async () => finish?.())
    expect(
      view.container.querySelector('img[src="blob:thumbnail"]')
    ).not.toBeNull()
    expect(
      view.container.querySelector('[data-slot="task-artifact-thumbnail"]')
    ).toHaveClass("size-10")
  })

  it.each(["request", "decode", "image"])(
    "shows the file icon on %s failure without requesting the full image",
    async (reason) => {
      if (reason === "request")
        vi.mocked(fetch).mockResolvedValueOnce(
          Response.json(
            { success: false, error_code: "ARTIFACT_NOT_FOUND" },
            { status: 404 }
          )
        )
      if (reason === "decode")
        vi.spyOn(HTMLImageElement.prototype, "decode").mockRejectedValueOnce(
          new Error("decode failed")
        )
      const view = renderThumbnail()
      act(() => observers[0]?.enter())
      if (reason === "image") {
        await waitFor(() =>
          expect(
            view.container.querySelector('img[src="blob:thumbnail"]')
          ).not.toBeNull()
        )
        const image = view.container.querySelector('img[src="blob:thumbnail"]')
        if (image) fireEvent.error(image)
      }
      await waitFor(() =>
        expect(
          view.container.querySelector('[data-file-icon-kind="image"]')
        ).not.toBeNull()
      )
      expect(fetch).toHaveBeenCalledOnce()
      expect(
        view.container.querySelector('[data-slot="task-artifact-thumbnail"]')
      ).toHaveClass("size-10")
    }
  )

  it.each(["content-type", "oversized", "empty"])(
    "rejects an invalid %s thumbnail response",
    async (reason) => {
      vi.mocked(fetch).mockResolvedValueOnce(
        new Response(
          reason === "oversized"
            ? "a".repeat(10_241)
            : reason === "empty"
              ? ""
              : "file",
          {
            headers: {
              "content-type":
                reason === "content-type" ? "image/png" : "image/webp",
            },
          }
        )
      )
      await expect(
        getTaskArtifactThumbnail(file, new AbortController().signal)
      ).rejects.toMatchObject({ errorCode: "ARTIFACT_NOT_FOUND" })
    }
  )
})

function queryClient() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  clients.push(client)
  return client
}

function renderThumbnail(client = queryClient()) {
  return render(
    <QueryClientProvider client={client}>
      <TaskArtifactThumbnail file={file} />
    </QueryClientProvider>
  )
}
