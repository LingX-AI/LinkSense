import { act, cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { ConversationFile } from "@/api/contracts"
import { clearConversationAttachmentPreviewCacheForTests } from "@/features/conversations/conversation-attachment-preview-cache"
import {
  createConversationAttachmentPreviewSource,
  isPreviewableConversationImage,
} from "@/features/conversations/conversation-attachment-preview-utils"
import { ConversationAttachmentPreviews } from "@/features/conversations/conversation-attachment-previews"
import i18n from "@/i18n"

const originalCreateObjectUrl = Object.getOwnPropertyDescriptor(
  URL,
  "createObjectURL"
)
const originalRevokeObjectUrl = Object.getOwnPropertyDescriptor(
  URL,
  "revokeObjectURL"
)

const createObjectURL = vi.fn<(blob: Blob) => string>()
const revokeObjectURL = vi.fn<(url: string) => void>()

function file(
  id: string,
  name: string,
  mimeType: string | null
): ConversationFile {
  return {
    id,
    name,
    mime_type: mimeType,
    size: undefined,
    kind: "attachment",
    download_available: false,
  }
}

function restoreUrlMethod(
  name: "createObjectURL" | "revokeObjectURL",
  descriptor: PropertyDescriptor | undefined
) {
  if (descriptor) Object.defineProperty(URL, name, descriptor)
  else Reflect.deleteProperty(URL, name)
}

describe("conversation attachment image previews", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("zh-CN")
    let objectUrlSequence = 0
    createObjectURL.mockReset().mockImplementation(() => {
      objectUrlSequence += 1
      return `blob:conversation-preview-${objectUrlSequence}`
    })
    revokeObjectURL.mockReset()
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createObjectURL,
    })
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: revokeObjectURL,
    })
  })

  afterEach(() => {
    cleanup()
    clearConversationAttachmentPreviewCacheForTests()
    vi.useRealTimers()
    vi.restoreAllMocks()
    restoreUrlMethod("createObjectURL", originalCreateObjectUrl)
    restoreUrlMethod("revokeObjectURL", originalRevokeObjectUrl)
  })

  it.each([
    ["image/png", true],
    [" IMAGE/JPEG ", true],
    ["image/webp", true],
    ["image/svg+xml", false],
    ["application/pdf", false],
    [null, false],
  ])(
    "recognizes only the supported image MIME types: %s",
    (mimeType, expected) => {
      expect(
        isPreviewableConversationImage(file("file-1", "file", mimeType))
      ).toBe(expected)
    }
  )

  it("allows SVG image previews for artifacts without widening attachment previews", () => {
    expect(
      isPreviewableConversationImage({
        ...file("svg-artifact", "chart.svg", "image/svg+xml"),
        kind: "artifact",
        download_available: true,
      })
    ).toBe(true)
    expect(
      isPreviewableConversationImage(
        file("svg-attachment", "chart.svg", "image/svg+xml")
      )
    ).toBe(false)
  })

  it("creates an idempotently releasable object URL source for file previews", () => {
    const blob = new Blob(["media"], { type: "audio/mpeg" })
    const source = createConversationAttachmentPreviewSource(blob)

    expect(createObjectURL).toHaveBeenCalledWith(blob)
    expect(source).toMatchObject({
      url: "blob:conversation-preview-1",
      expiresAt: "9999-12-31T23:59:59.999Z",
    })

    source.release()
    source.release()
    expect(revokeObjectURL).toHaveBeenCalledOnce()
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:conversation-preview-1")
  })

  it("loads one object URL, keeps it across loader identity changes, and opens the thumbnail preview", async () => {
    const image = file("image-1", "preview.png", "image/png")
    const firstLoader = vi.fn<
      (file: ConversationFile, signal: AbortSignal) => Promise<Blob>
    >(async () => new Blob(["png"], { type: "image/png" }))
    const { rerender } = render(
      <ConversationAttachmentPreviews
        files={[image]}
        loadPreview={firstLoader}
        onRemove={vi.fn()}
      />
    )

    expect(
      screen.getByRole("status", { name: "正在加载图片 preview.png" })
    ).toBeVisible()
    const previewButton = await screen.findByRole("button", {
      name: "预览图片 preview.png",
    })
    expect(firstLoader).toHaveBeenCalledOnce()
    expect(firstLoader.mock.calls[0]?.[0]).toBe(image)
    expect(firstLoader.mock.calls[0]?.[1]).toBeInstanceOf(AbortSignal)
    expect(createObjectURL).toHaveBeenCalledOnce()

    const replacementLoader = vi.fn<
      (file: ConversationFile, signal: AbortSignal) => Promise<Blob>
    >(async () => new Blob(["replacement"], { type: "image/png" }))
    rerender(
      <ConversationAttachmentPreviews
        files={[{ ...image }]}
        loadPreview={replacementLoader}
        onRemove={vi.fn()}
      />
    )
    expect(firstLoader).toHaveBeenCalledOnce()
    expect(replacementLoader).not.toHaveBeenCalled()
    expect(createObjectURL).toHaveBeenCalledOnce()

    await userEvent.click(previewButton)
    expect(
      await screen.findByRole("img", { name: "preview.png" })
    ).toHaveAttribute("src", "blob:conversation-preview-1")
  })

  it("routes image thumbnail clicks to the shared file preview when provided", async () => {
    const image = file("image-1", "right-pane.png", "image/png")
    const loader = vi.fn<
      (file: ConversationFile, signal: AbortSignal) => Promise<Blob>
    >(async () => new Blob(["png"], { type: "image/png" }))
    const onPreviewFile = vi.fn()

    render(
      <ConversationAttachmentPreviews
        files={[image]}
        loadPreview={loader}
        onPreviewFile={onPreviewFile}
      />
    )

    await userEvent.click(
      await screen.findByRole("button", {
        name: "预览图片 right-pane.png",
      })
    )

    expect(onPreviewFile).toHaveBeenCalledWith(image)
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })

  it("prefers the shared image preview over the file preview for image thumbnails", async () => {
    const image = file("image-1", "right-pane-image.png", "image/png")
    const loader = vi.fn<
      (file: ConversationFile, signal: AbortSignal) => Promise<Blob>
    >(async () => new Blob(["png"], { type: "image/png" }))
    const onPreviewImage = vi.fn()
    const onPreviewFile = vi.fn()

    render(
      <ConversationAttachmentPreviews
        files={[image]}
        loadPreview={loader}
        onPreviewImage={onPreviewImage}
        onPreviewFile={onPreviewFile}
      />
    )

    await userEvent.click(
      await screen.findByRole("button", {
        name: "预览图片 right-pane-image.png",
      })
    )

    expect(onPreviewImage).toHaveBeenCalledWith({
      id: image.id,
      name: image.name,
      src: "blob:conversation-preview-1",
      alt: image.name,
      downloadable: true,
    })
    expect(onPreviewFile).not.toHaveBeenCalled()
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })

  it("reuses a recently loaded preview when the same sent attachment remounts", async () => {
    const image = file("image-1", "handoff.png", "image/png")
    const firstLoader = vi.fn<
      (file: ConversationFile, signal: AbortSignal) => Promise<Blob>
    >(async () => new Blob(["png"], { type: "image/png" }))
    const { unmount } = render(
      <ConversationAttachmentPreviews
        files={[image]}
        loadPreview={firstLoader}
        onRemove={vi.fn()}
      />
    )

    await screen.findByRole("button", { name: "预览图片 handoff.png" })
    expect(firstLoader).toHaveBeenCalledOnce()
    expect(createObjectURL).toHaveBeenCalledOnce()

    unmount()

    const secondLoader = vi.fn<
      (file: ConversationFile, signal: AbortSignal) => Promise<Blob>
    >(async () => new Blob(["replacement"], { type: "image/png" }))
    render(
      <ConversationAttachmentPreviews
        files={[{ ...image }]}
        loadPreview={secondLoader}
      />
    )

    expect(secondLoader).not.toHaveBeenCalled()
    expect(createObjectURL).toHaveBeenCalledOnce()
    expect(
      screen.queryByRole("status", {
        name: "正在加载图片 handoff.png",
      })
    ).not.toBeInTheDocument()

    await userEvent.click(
      screen.getByRole("button", { name: "预览图片 handoff.png" })
    )
    expect(
      await screen.findByRole("img", { name: "handoff.png" })
    ).toHaveAttribute("src", "blob:conversation-preview-1")
  })

  it("revokes removed and unmounted object URLs and aborts their loaders", async () => {
    const first = file("image-1", "first.png", "image/png")
    const second = file("image-2", "second.webp", "image/webp")
    const signals = new Map<string, AbortSignal>()
    const loader = vi.fn(
      async (current: ConversationFile, signal: AbortSignal) => {
        signals.set(current.id, signal)
        return new Blob([current.id], { type: current.mime_type ?? "" })
      }
    )
    const { rerender, unmount } = render(
      <ConversationAttachmentPreviews
        files={[first, second]}
        loadPreview={loader}
        onRemove={vi.fn()}
      />
    )

    await screen.findByRole("button", { name: "预览图片 first.png" })
    await screen.findByRole("button", { name: "预览图片 second.webp" })
    expect(createObjectURL).toHaveBeenCalledTimes(2)

    vi.useFakeTimers()
    rerender(
      <ConversationAttachmentPreviews
        files={[second]}
        loadPreview={loader}
        onRemove={vi.fn()}
      />
    )

    expect(signals.get(first.id)?.aborted).toBe(false)
    act(() => {
      vi.advanceTimersByTime(2_000)
    })
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:conversation-preview-1")
    expect(signals.get(first.id)?.aborted).toBe(true)
    expect(signals.get(second.id)?.aborted).toBe(false)

    unmount()
    expect(signals.get(second.id)?.aborted).toBe(false)
    act(() => {
      vi.advanceTimersByTime(2_000)
    })
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:conversation-preview-2")
    expect(signals.get(second.id)?.aborted).toBe(true)
  })

  it("does not create an object URL when a pending load finishes after unmount", async () => {
    vi.useFakeTimers()
    const image = file("image-1", "pending.png", "image/png")
    let resolvePreview: ((blob: Blob) => void) | undefined
    let previewSignal: AbortSignal | undefined
    const { unmount } = render(
      <ConversationAttachmentPreviews
        files={[image]}
        loadPreview={(_, signal) => {
          previewSignal = signal
          return new Promise<Blob>((resolve) => {
            resolvePreview = resolve
          })
        }}
        onRemove={vi.fn()}
      />
    )

    expect(
      screen.getByRole("status", { name: "正在加载图片 pending.png" })
    ).toBeVisible()
    unmount()
    expect(previewSignal?.aborted).toBe(false)
    act(() => {
      vi.advanceTimersByTime(2_000)
    })
    expect(previewSignal?.aborted).toBe(true)

    await act(async () => {
      resolvePreview?.(new Blob(["png"], { type: "image/png" }))
      await Promise.resolve()
    })
    expect(createObjectURL).not.toHaveBeenCalled()
  })

  it("removes an image without opening its preview", async () => {
    const image = file("image-1", "remove-me.png", "image/png")
    const onRemove = vi.fn()
    render(
      <ConversationAttachmentPreviews
        files={[image]}
        loadPreview={async () => new Blob(["png"], { type: "image/png" })}
        onRemove={onRemove}
      />
    )

    await screen.findByRole("button", {
      name: "预览图片 remove-me.png",
    })
    await userEvent.click(
      screen.getByRole("button", { name: "移除附件 remove-me.png" })
    )

    expect(onRemove).toHaveBeenCalledOnce()
    expect(onRemove).toHaveBeenCalledWith(image)
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })

  it("keeps preview available without rendering removal controls in read-only mode", async () => {
    const image = file("image-1", "sent.png", "image/png")
    render(
      <ConversationAttachmentPreviews
        files={[image]}
        loadPreview={async () => new Blob(["png"], { type: "image/png" })}
      />
    )

    const previewButton = await screen.findByRole("button", {
      name: "预览图片 sent.png",
    })
    expect(
      screen.queryByRole("button", { name: "移除附件 sent.png" })
    ).not.toBeInTheDocument()

    await userEvent.click(previewButton)
    expect(
      await screen.findByRole("img", { name: "sent.png" })
    ).toHaveAttribute("src", "blob:conversation-preview-1")
  })

  it("shows an accessible failure state without creating an object URL", async () => {
    const image = file("image-1", "broken.png", "image/png")
    render(
      <ConversationAttachmentPreviews
        files={[image]}
        loadPreview={async () => {
          throw new Error("preview unavailable")
        }}
        onRemove={vi.fn()}
      />
    )

    expect(
      await screen.findByRole("status", {
        name: "无法预览图片 broken.png",
      })
    ).toBeVisible()
    expect(createObjectURL).not.toHaveBeenCalled()
    expect(
      screen.queryByRole("button", { name: "预览图片 broken.png" })
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "移除附件 broken.png" })
    ).toBeEnabled()
  })

  it("downloads the active object URL with the original filename", async () => {
    const image = file("image-1", "download.png", "image/png")
    let downloadedHref = ""
    let downloadedName = ""
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement
    ) {
      downloadedHref = this.href
      downloadedName = this.download
    })
    render(
      <ConversationAttachmentPreviews
        files={[image]}
        loadPreview={async () => new Blob(["png"], { type: "image/png" })}
        onRemove={vi.fn()}
      />
    )

    await userEvent.click(
      await screen.findByRole("button", { name: "预览图片 download.png" })
    )
    await userEvent.click(screen.getByRole("button", { name: "下载" }))

    expect(downloadedHref).toBe("blob:conversation-preview-1")
    expect(downloadedName).toBe("download.png")
  })

  it("treats an unsupported loaded Blob MIME type as a preview failure", async () => {
    const image = file("image-1", "spoofed.png", "image/png")
    render(
      <ConversationAttachmentPreviews
        files={[image]}
        loadPreview={async () => new Blob(["html"], { type: "text/html" })}
        onRemove={vi.fn()}
      />
    )

    expect(
      await screen.findByRole("status", {
        name: "无法预览图片 spoofed.png",
      })
    ).toBeVisible()
    expect(createObjectURL).not.toHaveBeenCalled()
  })
})
