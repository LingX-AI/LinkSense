import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { ConversationFile } from "@/api/contracts"
import {
  ConversationArtifactFiles,
  type ArtifactPreviewSource,
} from "@/features/conversations/conversation-artifact-files"
import i18n from "@/i18n"

const futureExpiry = "2999-01-01T00:00:00.000Z"

function artifact(
  id: string,
  name: string,
  mimeType: string,
  downloadAvailable = true
): ConversationFile {
  return {
    id,
    name,
    mime_type: mimeType,
    size: 2_048,
    kind: "artifact",
    created_at: "2026-07-14T02:44:00.000Z",
    download_available: downloadAvailable,
  }
}

function fallback(file: ConversationFile) {
  return <div data-testid={`fallback-${file.id}`}>{file.name}</div>
}

describe("conversation artifact files", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("zh-CN")
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it("loads only downloadable PNG, JPEG, and WebP artifacts", async () => {
    const previewable = artifact("png", "result.png", "image/png")
    const unavailable = artifact("jpeg", "private.jpg", "image/jpeg", false)
    const unsupported = artifact("pdf", "report.pdf", "application/pdf")
    const loadPreview = vi.fn(
      async (
        file: ConversationFile,
        signal: AbortSignal
      ): Promise<ArtifactPreviewSource> => {
        expect(signal).toBeInstanceOf(AbortSignal)
        return {
          url: `https://files.example/${file.id}`,
          expiresAt: futureExpiry,
        }
      }
    )

    render(
      <ConversationArtifactFiles
        files={[previewable, unavailable, unsupported]}
        loadPreview={loadPreview}
        renderFallback={fallback}
      />
    )

    expect(
      await screen.findByRole("button", { name: "预览图片 result.png" })
    ).toBeVisible()
    expect(loadPreview).toHaveBeenCalledOnce()
    expect(loadPreview.mock.calls[0]?.[0]).toBe(previewable)
    expect(loadPreview.mock.calls[0]?.[1]).toBeInstanceOf(AbortSignal)
    expect(screen.getByTestId("fallback-jpeg")).toHaveTextContent("private.jpg")
    expect(screen.getByTestId("fallback-pdf")).toHaveTextContent("report.pdf")
    expect(screen.queryByText(/2026-07-14/)).toBeNull()
    expect(document.querySelector("button button")).toBeNull()
  })

  it("opens the public preview and keeps an independent download action", async () => {
    const image = artifact("image", "result.png", "image/png")
    const onDownload = vi.fn()
    render(
      <ConversationArtifactFiles
        files={[image]}
        loadPreview={async () => ({
          url: "https://files.example/result.png",
          expiresAt: futureExpiry,
        })}
        onDownload={onDownload}
        renderFallback={fallback}
      />
    )

    await screen.findByRole("button", { name: "预览图片 result.png" })
    await userEvent.click(screen.getByText("result.png"))
    expect(
      await screen.findByRole("img", { name: "result.png" })
    ).toHaveAttribute("src", "https://files.example/result.png")

    await userEvent.click(screen.getByRole("button", { name: "下载" }))
    expect(onDownload).toHaveBeenCalledWith(image)

    await userEvent.click(screen.getByRole("button", { name: "关闭" }))
    await userEvent.click(
      screen.getByRole("button", { name: "下载 result.png" })
    )
    expect(onDownload).toHaveBeenCalledTimes(2)
    expect(onDownload).toHaveBeenLastCalledWith(image)
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })

  it("opens an image artifact from its keyboard-accessible tile action", async () => {
    const image = artifact("keyboard-image", "keyboard.png", "image/png")
    render(
      <ConversationArtifactFiles
        files={[image]}
        loadPreview={async () => ({
          url: "https://files.example/keyboard.png",
          expiresAt: futureExpiry,
        })}
        renderFallback={fallback}
      />
    )

    const previewButton = await screen.findByRole("button", {
      name: "预览图片 keyboard.png",
    })
    previewButton.focus()
    await userEvent.keyboard("{Enter}")

    expect(await screen.findByRole("dialog")).toBeVisible()
    expect(screen.getByRole("img", { name: "keyboard.png" })).toHaveAttribute(
      "src",
      "https://files.example/keyboard.png"
    )
  })

  it("previews an SVG artifact through the shared image thumbnail and dialog", async () => {
    const image = artifact("svg", "chart.svg", "image/svg+xml")
    const loadPreview = vi.fn(async () => ({
      url: "https://files.example/chart.svg",
      expiresAt: futureExpiry,
    }))

    render(
      <ConversationArtifactFiles
        files={[image]}
        loadPreview={loadPreview}
        renderFallback={fallback}
      />
    )

    await userEvent.click(
      await screen.findByRole("button", { name: "预览图片 chart.svg" })
    )

    const preview = await screen.findByRole("img", { name: "chart.svg" })
    expect(preview).toHaveAttribute("src", "https://files.example/chart.svg")
    expect(preview).toHaveAttribute("referrerpolicy", "no-referrer")
    expect(loadPreview).toHaveBeenCalledWith(image, expect.any(AbortSignal))
    expect(screen.queryByTestId("fallback-svg")).not.toBeInTheDocument()
  })

  it("opens a PPTX in the presentation preview without downloading it", async () => {
    const presentation = artifact(
      "slides",
      "ai-introduction.pptx",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation"
    )
    const onPreviewPresentation = vi.fn()
    const onDownload = vi.fn()

    render(
      <ConversationArtifactFiles
        files={[presentation]}
        loadPreview={vi.fn()}
        onPreviewPresentation={onPreviewPresentation}
        onDownload={onDownload}
        renderFallback={fallback}
      />
    )

    const previewButton = screen.getByRole("button", {
      name: "预览演示文稿 ai-introduction.pptx",
    })
    const presentationTile = previewButton.closest(
      ".artifact-presentation-tile"
    )
    expect(presentationTile).not.toBeNull()
    expect(presentationTile).toHaveClass("file-tile")
    expect(
      previewButton.querySelector(".artifact-presentation-size")
    ).toHaveTextContent("2 kB")
    const fileName = screen.getByText("ai-introduction.pptx")
    expect(fileName).toHaveClass("file-tile-name", "truncate")
    expect(fileName.parentElement).toHaveClass("min-w-0")
    const previewLabel = screen.getByText("打开预览")
    expect(previewLabel).toHaveClass("artifact-presentation-preview-label")
    expect(previewLabel).toHaveAttribute("aria-hidden", "true")

    await userEvent.click(previewButton)
    expect(onPreviewPresentation).toHaveBeenCalledWith(presentation)
    expect(onDownload).not.toHaveBeenCalled()

    await userEvent.click(
      screen.getByRole("button", {
        name: "下载 ai-introduction.pptx",
      })
    )
    expect(onDownload).toHaveBeenCalledWith(presentation)
    expect(document.querySelector("button button")).toBeNull()

    await i18n.changeLanguage("en-US")
    expect(await screen.findByText("Open preview")).toHaveClass(
      "artifact-presentation-preview-label"
    )
  })

  it("opens DOCX, XLSX, and HTML artifacts through the shared document preview action", async () => {
    const word = artifact(
      "word",
      "proposal.docx",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    )
    const spreadsheet = artifact(
      "sheet",
      "budget.xlsx",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )
    const html = artifact("html", "landing.html", "text/html")
    const onPreviewOfficeDocument = vi.fn()

    render(
      <ConversationArtifactFiles
        files={[word, spreadsheet, html]}
        onPreviewOfficeDocument={onPreviewOfficeDocument}
        renderFallback={fallback}
      />
    )

    await userEvent.click(
      screen.getByRole("button", { name: "预览文档 proposal.docx" })
    )
    await userEvent.click(
      screen.getByRole("button", { name: "预览文档 budget.xlsx" })
    )
    await userEvent.click(
      screen.getByRole("button", { name: "预览 HTML 文档 landing.html" })
    )

    expect(onPreviewOfficeDocument).toHaveBeenNthCalledWith(1, word)
    expect(onPreviewOfficeDocument).toHaveBeenNthCalledWith(2, spreadsheet)
    expect(onPreviewOfficeDocument).toHaveBeenNthCalledWith(3, html)
  })

  it("opens ZIP artifacts in the shared preview without triggering a download", async () => {
    const archive = artifact("archive", "deliverables.zip", "application/zip")
    const onPreviewOfficeDocument = vi.fn()
    const onDownload = vi.fn()

    render(
      <ConversationArtifactFiles
        files={[archive]}
        onPreviewOfficeDocument={onPreviewOfficeDocument}
        onDownload={onDownload}
        renderFallback={fallback}
      />
    )

    await userEvent.click(
      screen.getByRole("button", { name: "预览压缩包 deliverables.zip" })
    )
    expect(onPreviewOfficeDocument).toHaveBeenCalledWith(archive)
    expect(onDownload).not.toHaveBeenCalled()

    await userEvent.click(
      screen.getByRole("button", { name: "下载 deliverables.zip" })
    )
    expect(onDownload).toHaveBeenCalledWith(archive)

    await i18n.changeLanguage("en-US")
    expect(
      screen.getByRole("button", { name: "Preview archive deliverables.zip" })
    ).toBeVisible()
  })

  it("routes generic read-only previews through the right pane while retaining image thumbnails", async () => {
    const source = artifact("source", "server.ts", "text/plain")
    const pdf = artifact("pdf", "report.pdf", "application/pdf")
    const image = artifact("image", "cover.png", "image/png")
    const onPreviewOfficeDocument = vi.fn()

    render(
      <ConversationArtifactFiles
        files={[source, pdf, image]}
        loadPreview={vi.fn().mockResolvedValue({
          url: "https://files.example/cover.png",
          expiresAt: futureExpiry,
        })}
        onPreviewOfficeDocument={onPreviewOfficeDocument}
        renderFallback={fallback}
      />
    )

    await userEvent.click(
      screen.getByRole("button", { name: "预览文件 server.ts" })
    )
    await userEvent.click(
      screen.getByRole("button", { name: "预览文件 report.pdf" })
    )
    await userEvent.click(
      await screen.findByRole("button", { name: "预览图片 cover.png" })
    )
    expect(onPreviewOfficeDocument).toHaveBeenNthCalledWith(1, source)
    expect(onPreviewOfficeDocument).toHaveBeenNthCalledWith(2, pdf)
    expect(onPreviewOfficeDocument).toHaveBeenNthCalledWith(3, image)
    expect(onPreviewOfficeDocument).toHaveBeenCalledTimes(3)
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })

  it("switches between multiple previewable artifacts", async () => {
    const first = artifact("first", "first.png", "image/png")
    const second = artifact("second", "second.webp", "image/webp")
    render(
      <ConversationArtifactFiles
        files={[first, second]}
        loadPreview={async (file) => ({
          url: `https://files.example/${file.name}`,
          expiresAt: futureExpiry,
        })}
        renderFallback={fallback}
      />
    )

    await userEvent.click(
      await screen.findByRole("button", { name: "预览图片 first.png" })
    )
    expect(await screen.findByRole("img", { name: "first.png" })).toBeVisible()

    await userEvent.click(screen.getByRole("button", { name: "下一张图片" }))
    expect(
      await screen.findByRole("img", { name: "second.webp" })
    ).toHaveAttribute("src", "https://files.example/second.webp")
  })

  it("falls back to the generic renderer when preview loading fails", async () => {
    const image = artifact("broken", "broken.png", "image/png")
    render(
      <ConversationArtifactFiles
        files={[image]}
        loadPreview={async () => {
          throw new Error("preview unavailable")
        }}
        renderFallback={fallback}
      />
    )

    expect(await screen.findByTestId("fallback-broken")).toHaveTextContent(
      "broken.png"
    )
    expect(
      screen.queryByRole("button", { name: "预览图片 broken.png" })
    ).not.toBeInTheDocument()
  })

  it("refreshes an expired URL before opening the preview", async () => {
    const image = artifact("expiring", "expiring.png", "image/png")
    const loadPreview = vi
      .fn<
        (
          file: ConversationFile,
          signal: AbortSignal
        ) => Promise<ArtifactPreviewSource>
      >()
      .mockResolvedValueOnce({
        url: "https://files.example/expired.png",
        expiresAt: "2000-01-01T00:00:00.000Z",
      })
      .mockResolvedValueOnce({
        url: "https://files.example/fresh.png",
        expiresAt: futureExpiry,
      })

    render(
      <ConversationArtifactFiles
        files={[image]}
        loadPreview={loadPreview}
        renderFallback={fallback}
      />
    )

    await userEvent.click(
      await screen.findByRole("button", { name: "预览图片 expiring.png" })
    )
    await waitFor(() => expect(loadPreview).toHaveBeenCalledTimes(2))
    expect(
      await screen.findByRole("img", { name: "expiring.png" })
    ).toHaveAttribute("src", "https://files.example/fresh.png")
  })

  it("aborts an in-flight preview request on unmount", async () => {
    const image = artifact("pending", "pending.png", "image/png")
    let signal: AbortSignal | undefined
    const loadPreview = vi.fn(
      (_file: ConversationFile, currentSignal: AbortSignal) => {
        signal = currentSignal
        return new Promise<ArtifactPreviewSource>(() => undefined)
      }
    )
    const { unmount } = render(
      <ConversationArtifactFiles
        files={[image]}
        loadPreview={loadPreview}
        renderFallback={fallback}
      />
    )

    await waitFor(() => expect(loadPreview).toHaveBeenCalledOnce())
    expect(signal?.aborted).toBe(false)
    unmount()
    expect(signal?.aborted).toBe(true)
  })
})
