import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { ConversationFile } from "@/api/contracts"
import { AssistantMarkdownImage } from "@/features/conversations/assistant-markdown-image"
import i18n from "@/i18n"
import { createIntersectionObserverMock } from "@/test/intersection-observer"

const FILE_ID = "30000000-0000-4000-8000-000000000001"
const NOW = new Date("2026-09-03T00:00:00.000Z")
const decodeImage = vi.fn<() => Promise<void>>()
const originalDecode = Object.getOwnPropertyDescriptor(
  HTMLImageElement.prototype,
  "decode"
)

const imageFile: ConversationFile = {
  id: FILE_ID,
  name: "preview.png",
  mime_type: "image/png",
  size: 128,
  kind: "artifact",
  download_available: true,
}

function InlineImage({
  loadPreview,
}: {
  loadPreview: (
    file: ConversationFile,
    signal: AbortSignal
  ) => Promise<{ url: string; expiresAt: string }>
}) {
  return (
    <AssistantMarkdownImage
      source={`linksense-artifact:${FILE_ID}`}
      alt="preview.png"
      file={imageFile}
      loadPreview={loadPreview}
    />
  )
}

async function flushPreviewLoad() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe("assistant Markdown image preview cache", () => {
  beforeEach(async () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    decodeImage.mockReset().mockResolvedValue(undefined)
    Object.defineProperty(HTMLImageElement.prototype, "decode", {
      configurable: true,
      value: decodeImage,
    })
    await i18n.changeLanguage("zh-CN")
  })

  afterEach(() => {
    cleanup()
    vi.clearAllTimers()
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    if (originalDecode) {
      Object.defineProperty(
        HTMLImageElement.prototype,
        "decode",
        originalDecode
      )
    } else {
      Reflect.deleteProperty(HTMLImageElement.prototype, "decode")
    }
  })

  it("requests and decodes only the image that approaches the viewport", async () => {
    const visibility = createIntersectionObserverMock()
    vi.stubGlobal("IntersectionObserver", visibility.Observer)
    const loadPreview = vi.fn(async (file: ConversationFile) => ({
      url: `https://files.example.test/${file.id}.png`,
      expiresAt: new Date(NOW.getTime() + 120_000).toISOString(),
    }))
    const secondFile = {
      ...imageFile,
      id: "30000000-0000-4000-8000-000000000002",
      name: "second.png",
    }
    const view = render(
      <>
        <InlineImage loadPreview={loadPreview} />
        <AssistantMarkdownImage
          source={`linksense-artifact:${secondFile.id}`}
          file={secondFile}
          alt={secondFile.name}
          loadPreview={loadPreview}
          loading="eager"
        />
      </>
    )
    await flushPreviewLoad()
    expect(loadPreview).not.toHaveBeenCalled()
    expect(decodeImage).not.toHaveBeenCalled()
    expect(view.container.querySelector("img")).toBeNull()
    const surfaces = view.container.querySelectorAll(
      '[data-slot="assistant-image-surface"]'
    )
    expect(surfaces).toHaveLength(2)

    act(() => visibility.intersect(surfaces.item(1)))
    await flushPreviewLoad()
    expect(loadPreview).toHaveBeenCalledExactlyOnceWith(
      secondFile,
      expect.any(AbortSignal)
    )
    expect(screen.getByRole("img", { name: secondFile.name })).toBeVisible()
    expect(decodeImage).toHaveBeenCalledOnce()

    act(() => visibility.intersect(surfaces.item(1), false))
    act(() => visibility.intersect(surfaces.item(1)))
    await flushPreviewLoad()
    expect(loadPreview).toHaveBeenCalledOnce()

    act(() => visibility.intersect(surfaces.item(0)))
    await flushPreviewLoad()
    expect(loadPreview).toHaveBeenCalledTimes(2)
    expect(screen.getByRole("img", { name: imageFile.name })).toBeVisible()
  })

  it("aborts a shared pending preview only after its last visible consumer unmounts", async () => {
    const loadPreview = vi.fn<
      (
        file: ConversationFile,
        signal: AbortSignal
      ) => Promise<{ url: string; expiresAt: string }>
    >(() => new Promise(() => {}))
    const first = render(<InlineImage loadPreview={loadPreview} />)
    const second = render(<InlineImage loadPreview={loadPreview} />)
    await flushPreviewLoad()
    expect(loadPreview).toHaveBeenCalledOnce()
    const signal = loadPreview.mock.calls[0]?.[1]
    expect(signal?.aborted).toBe(false)
    first.unmount()
    expect(signal?.aborted).toBe(false)
    second.unmount()
    expect(signal?.aborted).toBe(true)
  })

  it.each(["attachment", "image_preview"] as const)(
    "previews a non-downloadable %s and releases its object URL after the last consumer",
    async (kind) => {
      const release = vi.fn()
      const loadPreview = vi.fn().mockResolvedValue({
        url: "blob:private-image",
        expiresAt: "9999-12-31T23:59:59.999Z",
        release,
      })
      const props = {
        source: `linksense-artifact:${FILE_ID}`,
        alt: "private.png",
        file: { ...imageFile, kind, download_available: false },
        loadPreview,
      }
      const first = render(<AssistantMarkdownImage {...props} />)
      const second = render(<AssistantMarkdownImage {...props} />)
      await flushPreviewLoad()
      expect(screen.getAllByRole("img", { name: "private.png" })).toHaveLength(
        2
      )
      expect(loadPreview).toHaveBeenCalledOnce()
      first.unmount()
      expect(release).not.toHaveBeenCalled()
      second.unmount()
      expect(release).toHaveBeenCalledOnce()
    }
  )

  it("releases image bytes that finish loading after the preview is unmounted", async () => {
    const release = vi.fn()
    let finish!: (source: {
      url: string
      expiresAt: string
      release: () => void
    }) => void
    const loadPreview = vi.fn(
      () =>
        new Promise<{ url: string; expiresAt: string; release: () => void }>(
          (resolve) => {
            finish = resolve
          }
        )
    )
    const preview = render(
      <AssistantMarkdownImage
        source={`linksense-artifact:${FILE_ID}`}
        alt="private.png"
        file={{
          ...imageFile,
          kind: "image_preview",
          download_available: false,
        }}
        loadPreview={loadPreview}
      />
    )
    await flushPreviewLoad()
    preview.unmount()
    finish({
      url: "blob:late-image",
      expiresAt: "9999-12-31T23:59:59.999Z",
      release,
    })
    await flushPreviewLoad()
    expect(release).toHaveBeenCalledOnce()
  })

  it("keeps the placeholder until the mounted lazy image finishes decoding", async () => {
    let finishDecoding!: () => void
    decodeImage.mockImplementationOnce(
      () => new Promise<void>((resolve) => (finishDecoding = resolve))
    )
    const loadPreview = vi.fn().mockResolvedValue({
      url: "https://files.example.test/slow.png",
      expiresAt: new Date(NOW.getTime() + 120_000).toISOString(),
    })
    const view = render(<InlineImage loadPreview={loadPreview} />)
    await flushPreviewLoad()

    expect(screen.getByRole("status")).toBeVisible()
    expect(screen.queryByRole("img", { name: "preview.png" })).toBeNull()
    const image = view.container.querySelector("img")
    expect(image).toHaveAttribute("loading", "lazy")
    expect(image).toHaveClass("opacity-0")
    expect(decodeImage).toHaveBeenCalledOnce()
    expect(decodeImage.mock.instances[0]).toBe(image)

    await act(async () => finishDecoding())

    expect(screen.queryByRole("status")).toBeNull()
    expect(screen.getByRole("img", { name: "preview.png" })).toBe(image)
    expect(image).toBeVisible()
  })

  it("reuses a decoded cached preview when a remounted virtual row becomes visible", async () => {
    const loadPreview = vi.fn().mockResolvedValue({
      url: "https://files.example.test/cached.png",
      expiresAt: new Date(NOW.getTime() + 120_000).toISOString(),
    })
    const view = render(<InlineImage loadPreview={loadPreview} />)
    await flushPreviewLoad()
    expect(screen.getByRole("img", { name: "preview.png" })).toBeVisible()
    view.unmount()

    render(<InlineImage loadPreview={loadPreview} />)
    await flushPreviewLoad()

    expect(screen.queryByRole("status")).toBeNull()
    expect(screen.getByRole("img", { name: "preview.png" })).toBeVisible()
    expect(loadPreview).toHaveBeenCalledOnce()
  })

  it("decodes a cached URL after a remounted image becomes visible even if its first decode was interrupted", async () => {
    const visibility = createIntersectionObserverMock()
    vi.stubGlobal("IntersectionObserver", visibility.Observer)
    decodeImage.mockImplementationOnce(() => new Promise(() => {}))
    const loadPreview = vi.fn().mockResolvedValue({
      url: "https://files.example.test/undecoded.png",
      expiresAt: new Date(NOW.getTime() + 120_000).toISOString(),
    })
    const first = render(<InlineImage loadPreview={loadPreview} />)
    const firstSurface = first.container.querySelector(
      '[data-slot="assistant-image-surface"]'
    )
    if (!firstSurface) throw new Error("Missing first image surface")
    act(() => visibility.intersect(firstSurface))
    await flushPreviewLoad()
    expect(decodeImage).toHaveBeenCalledOnce()
    first.unmount()

    const second = render(<InlineImage loadPreview={loadPreview} />)
    await flushPreviewLoad()
    expect(second.container.querySelector("img")).toBeNull()
    expect(decodeImage).toHaveBeenCalledOnce()
    const secondSurface = second.container.querySelector(
      '[data-slot="assistant-image-surface"]'
    )
    if (!secondSurface) throw new Error("Missing remounted image surface")
    act(() => visibility.intersect(secondSurface))
    await flushPreviewLoad()
    expect(screen.getByRole("img", { name: "preview.png" })).toBeVisible()
    expect(decodeImage).toHaveBeenCalledTimes(2)
    expect(loadPreview).toHaveBeenCalledOnce()
  })

  it("reports a decoding failure and loads a new preview when the user retries", async () => {
    decodeImage.mockRejectedValueOnce(new Error("invalid_image"))
    const loadPreview = vi.fn().mockResolvedValue({
      url: "https://files.example.test/retry.png",
      expiresAt: new Date(NOW.getTime() + 120_000).toISOString(),
    })
    render(<InlineImage loadPreview={loadPreview} />)
    await flushPreviewLoad()

    expect(screen.getByRole("button", { name: "重试" })).toBeVisible()
    expect(screen.queryByRole("img", { name: "preview.png" })).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: "重试" }))
    await flushPreviewLoad()

    expect(screen.getByRole("img", { name: "preview.png" })).toBeVisible()
    expect(loadPreview).toHaveBeenCalledTimes(2)
    expect(decodeImage).toHaveBeenCalledTimes(2)
  })

  it("shows an error instead of an endless placeholder when the preview URL is empty", async () => {
    const loadPreview = vi.fn().mockResolvedValue({
      url: "",
      expiresAt: new Date(NOW.getTime() + 120_000).toISOString(),
    })
    render(<InlineImage loadPreview={loadPreview} />)
    await flushPreviewLoad()

    expect(screen.queryByRole("status")).toBeNull()
    expect(screen.getByRole("button", { name: "重试" })).toBeVisible()
    expect(decodeImage).not.toHaveBeenCalled()
  })

  it("stops displaying a decoded preview when its file becomes unavailable", async () => {
    const loadPreview = vi.fn().mockResolvedValue({
      url: "https://files.example.test/available.png",
      expiresAt: new Date(NOW.getTime() + 120_000).toISOString(),
    })
    const view = render(<InlineImage loadPreview={loadPreview} />)
    await flushPreviewLoad()
    expect(screen.getByRole("img", { name: "preview.png" })).toBeVisible()

    view.rerender(
      <AssistantMarkdownImage
        source={`linksense-artifact:${FILE_ID}`}
        file={{ ...imageFile, download_available: false }}
        alt={imageFile.name}
        loadPreview={loadPreview}
      />
    )

    expect(screen.queryByRole("img", { name: "preview.png" })).toBeNull()
    expect(view.container.querySelector("img")).toBeNull()
    expect(loadPreview).toHaveBeenCalledOnce()
  })

  it("does not reveal a previous file when its decoding completes after the file changes", async () => {
    let finishDecoding!: () => void
    decodeImage.mockImplementationOnce(
      () => new Promise<void>((resolve) => (finishDecoding = resolve))
    )
    const loadPreview = vi.fn(async (file: ConversationFile) => ({
      url: `https://files.example.test/${file.id}.png`,
      expiresAt: new Date(NOW.getTime() + 120_000).toISOString(),
    }))
    const view = render(<InlineImage loadPreview={loadPreview} />)
    await flushPreviewLoad()
    const otherFile = {
      ...imageFile,
      id: "30000000-0000-4000-8000-000000000002",
      name: "other.png",
    }
    view.rerender(
      <AssistantMarkdownImage
        source={`linksense-artifact:${otherFile.id}`}
        file={otherFile}
        alt={otherFile.name}
        loadPreview={loadPreview}
      />
    )
    await flushPreviewLoad()
    await act(async () => finishDecoding())

    expect(screen.queryByRole("img", { name: "preview.png" })).toBeNull()
    expect(screen.getByRole("img", { name: "other.png" })).toHaveAttribute(
      "src",
      `https://files.example.test/${otherFile.id}.png`
    )
  })

  it("does not reuse a decoded preview after the file content version changes", async () => {
    const loadPreview = vi
      .fn()
      .mockResolvedValueOnce({
        url: "https://files.example.test/original.png",
        expiresAt: new Date(NOW.getTime() + 120_000).toISOString(),
      })
      .mockResolvedValueOnce({
        url: "https://files.example.test/updated.png",
        expiresAt: new Date(NOW.getTime() + 120_000).toISOString(),
      })
    const view = render(<InlineImage loadPreview={loadPreview} />)
    await flushPreviewLoad()
    view.rerender(
      <AssistantMarkdownImage
        source={`linksense-artifact:${FILE_ID}`}
        file={{ ...imageFile, checksum_sha256: "a".repeat(64) }}
        alt={imageFile.name}
        loadPreview={loadPreview}
      />
    )
    expect(screen.queryByRole("img", { name: "preview.png" })).toBeNull()
    await flushPreviewLoad()

    expect(screen.getByRole("img", { name: "preview.png" })).toHaveAttribute(
      "src",
      "https://files.example.test/updated.png"
    )
    expect(loadPreview).toHaveBeenCalledTimes(2)
  })

  it("keeps the displayed image mounted until its refreshed URL has decoded", async () => {
    const expiresAt = new Date(NOW.getTime() + 120_000).toISOString()
    let resolveRefresh!: (source: { url: string; expiresAt: string }) => void
    const loadPreview = vi
      .fn()
      .mockResolvedValueOnce({
        url: "https://files.example.test/before-refresh.png",
        expiresAt,
      })
      .mockImplementationOnce(
        () => new Promise((resolve) => (resolveRefresh = resolve))
      )
    const view = render(<InlineImage loadPreview={loadPreview} />)
    await flushPreviewLoad()
    const displayed = screen.getByRole("img", { name: "preview.png" })
    await act(async () => vi.advanceTimersByTime(90_000))

    expect(screen.getByRole("img", { name: "preview.png" })).toBe(displayed)
    expect(screen.queryByRole("status")).toBeNull()
    let finishDecoding!: () => void
    decodeImage.mockImplementationOnce(
      () => new Promise<void>((resolve) => (finishDecoding = resolve))
    )
    await act(async () =>
      resolveRefresh({
        url: "https://files.example.test/after-refresh.png",
        expiresAt: new Date(Date.now() + 120_000).toISOString(),
      })
    )
    expect(screen.getByRole("img", { name: "preview.png" })).toBe(displayed)
    expect(screen.queryByRole("status")).toBeNull()

    await act(async () => finishDecoding())
    expect(screen.getByRole("img", { name: "preview.png" })).toHaveAttribute(
      "src",
      "https://files.example.test/after-refresh.png"
    )
    expect(loadPreview).toHaveBeenCalledTimes(2)
    view.unmount()
    render(<InlineImage loadPreview={loadPreview} />)
    await flushPreviewLoad()
    expect(screen.getByRole("img", { name: "preview.png" })).toHaveAttribute(
      "src",
      "https://files.example.test/after-refresh.png"
    )
    expect(screen.queryByRole("status")).toBeNull()
    await flushPreviewLoad()
    expect(loadPreview).toHaveBeenCalledTimes(2)
  })

  it("reuses a successful preview only while its signed URL remains fresh", async () => {
    const firstExpiresAt = new Date(NOW.getTime() + 2 * 60 * 60 * 1_000)
    const refreshedExpiresAt = new Date(NOW.getTime() + 4 * 60 * 60 * 1_000)
    const loadPreview = vi
      .fn()
      .mockResolvedValueOnce({
        url: "https://files.example.test/first.png",
        expiresAt: firstExpiresAt.toISOString(),
      })
      .mockResolvedValueOnce({
        url: "https://files.example.test/refreshed.png",
        expiresAt: refreshedExpiresAt.toISOString(),
      })

    const first = render(<InlineImage loadPreview={loadPreview} />)
    await flushPreviewLoad()
    expect(screen.getByRole("img", { name: "preview.png" })).toHaveAttribute(
      "src",
      "https://files.example.test/first.png"
    )
    first.unmount()

    const beforeExpiry = render(<InlineImage loadPreview={loadPreview} />)
    await flushPreviewLoad()
    expect(screen.getByRole("img", { name: "preview.png" })).toHaveAttribute(
      "src",
      "https://files.example.test/first.png"
    )
    expect(loadPreview).toHaveBeenCalledOnce()
    beforeExpiry.unmount()

    await act(async () => {
      vi.advanceTimersByTime(2 * 60 * 60 * 1_000)
      await Promise.resolve()
    })

    render(<InlineImage loadPreview={loadPreview} />)
    await flushPreviewLoad()
    expect(screen.getByRole("img", { name: "preview.png" })).toHaveAttribute(
      "src",
      "https://files.example.test/refreshed.png"
    )
    expect(loadPreview).toHaveBeenCalledTimes(2)
  })
})
