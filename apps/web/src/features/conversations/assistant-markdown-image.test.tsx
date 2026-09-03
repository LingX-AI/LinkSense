import { act, cleanup, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { ConversationFile } from "@/api/contracts"
import { AssistantMarkdownImage } from "@/features/conversations/assistant-markdown-image"
import i18n from "@/i18n"

const FILE_ID = "30000000-0000-4000-8000-000000000001"
const NOW = new Date("2026-09-03T00:00:00.000Z")

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
    await i18n.changeLanguage("zh-CN")
  })

  afterEach(() => {
    cleanup()
    vi.clearAllTimers()
    vi.useRealTimers()
    vi.restoreAllMocks()
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
