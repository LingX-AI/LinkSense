import { StrictMode } from "react"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ConversationAttachmentUploadPreview } from "@/features/conversations/conversation-attachment-upload-preview"
import i18n from "@/i18n"

const createObjectURL = vi.fn<(blob: Blob) => string>()
const revokeObjectURL = vi.fn<(url: string) => void>()

describe("uploading image thumbnail", () => {
  beforeEach(async () => {
    let sequence = 0
    createObjectURL
      .mockReset()
      .mockImplementation(() => `blob:upload-${++sequence}`)
    revokeObjectURL.mockReset()
    vi.stubGlobal(
      "URL",
      class extends URL {
        static createObjectURL = createObjectURL
        static revokeObjectURL = revokeObjectURL
      }
    )
    await i18n.changeLanguage("zh-CN")
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it.each([
    ["zh-CN", "正在上传附件 photo.png"],
    ["en-US", "Uploading attachment photo.png"],
    ["fr-FR", "正在上传附件 photo.png"],
  ])(
    "shows the local image with a centered muted loading indicator in %s",
    async (language, label) => {
      await i18n.changeLanguage(language)
      const file = new File(["image"], "photo.png", { type: "image/png" })
      render(
        <ConversationAttachmentUploadPreview name={file.name} file={file} />
      )

      const status = screen.getByRole("status", { name: label })
      expect(status.closest(".image-preview-thumbnail")).not.toBeNull()
      expect(status).toHaveClass("image-preview-thumbnail-trigger")
      expect(status.querySelector("img")).toHaveAttribute(
        "src",
        "blob:upload-1"
      )
      expect(createObjectURL).toHaveBeenCalledWith(file)
      const spinner = status.querySelector('[data-slot="spinner"]')
      expect(spinner).toHaveAttribute("aria-hidden", "true")
      expect(spinner?.parentElement).toHaveClass("text-foreground/50")
      expect(spinner?.parentElement?.parentElement).toHaveClass(
        "absolute",
        "inset-0",
        "items-center",
        "justify-center"
      )
      expect(screen.queryByRole("button")).not.toBeInTheDocument()
    }
  )

  it("releases each local image URL on replacement and unmount", () => {
    const first = new File(["first"], "first.png", { type: "image/png" })
    const second = new File(["second"], "second.png", { type: "image/png" })
    const { rerender, unmount } = render(
      <ConversationAttachmentUploadPreview name={first.name} file={first} />
    )

    rerender(
      <ConversationAttachmentUploadPreview name={second.name} file={second} />
    )
    expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith("blob:upload-1")
    expect(screen.getByRole("status").querySelector("img")).toHaveAttribute(
      "src",
      "blob:upload-2"
    )
    unmount()
    expect(revokeObjectURL.mock.calls).toEqual([
      ["blob:upload-1"],
      ["blob:upload-2"],
    ])
  })

  it("keeps the thumbnail and upload indicator if the local image cannot be decoded", () => {
    const file = new File(["invalid image"], "photo.png", { type: "image/png" })
    render(<ConversationAttachmentUploadPreview name={file.name} file={file} />)
    const status = screen.getByRole("status")
    const image = status.querySelector("img")!
    fireEvent.error(image)
    expect(image).not.toBeVisible()
    expect(status).toBeVisible()
    expect(status.querySelector('[data-slot="spinner"]')).toBeVisible()
  })

  it("cleans up the probe URL when Strict Mode runs the effect twice", () => {
    const file = new File(["image"], "photo.png", { type: "image/png" })
    const { unmount } = render(
      <StrictMode>
        <ConversationAttachmentUploadPreview name={file.name} file={file} />
      </StrictMode>
    )
    expect(createObjectURL).toHaveBeenCalledTimes(2)
    expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith("blob:upload-1")
    expect(screen.getByRole("status").querySelector("img")).toHaveAttribute(
      "src",
      "blob:upload-2"
    )
    unmount()
    expect(revokeObjectURL).toHaveBeenCalledTimes(2)
  })
})
