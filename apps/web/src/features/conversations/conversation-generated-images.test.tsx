import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import userEvent from "@testing-library/user-event"

import type { ConversationFile, NativeCodexItem } from "@/api/contracts"
import { ConversationGeneratedImages } from "@/features/conversations/conversation-generated-images"
import i18n, { supportedLanguages } from "@/i18n"

const fileId = "30000000-0000-4000-8000-000000000011"
const secondFileId = "30000000-0000-4000-8000-000000000012"
const image: ConversationFile = {
  id: fileId,
  name: "草地上的柯基.png",
  kind: "artifact",
  turn_id: "turn-1",
  mime_type: "image/png",
  size: 1024,
  download_available: true,
}
const call = {
  id: "image-call",
  type: "mcpToolCall",
  server: "linksense_core",
  tool: "generate_image",
  status: "completed",
  generatedImageFileIds: [fileId],
} as const satisfies NativeCodexItem
const previewSource = {
  url: "https://files.example.test/corgi.png",
  expiresAt: "2099-01-01T00:00:00.000Z",
}

beforeEach(async () => {
  await i18n.changeLanguage("zh-CN")
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe("generated image cards", () => {
  it("reserves a separate scrollbar lane beside ten fixed-size thumbnails and keeps keyboard selection working", async () => {
    const files = Array.from({ length: 10 }, (_, index) => ({
      ...image,
      id: `30000000-0000-4000-8000-${String(index + 101).padStart(12, "0")}`,
      name: `image-${index + 1}.png`,
    }))
    const user = userEvent.setup()
    render(
      <ConversationGeneratedImages
        items={[]}
        registeredFileIds={files.map((file) => file.id)}
        turnId="turn-1"
        turnStatus="completed"
        running={false}
        filesById={new Map(files.map((file) => [file.id, file]))}
        loadPreview={vi.fn(() => new Promise<never>(() => undefined))}
        onDownload={vi.fn()}
      />
    )

    const list = screen.getByRole("tablist")
    expect(list.parentElement).toHaveAttribute(
      "data-slot",
      "generated-image-thumbnail-scroll"
    )
    expect(list.parentElement).toHaveClass(
      "w-20",
      "max-h-[32rem]",
      "overflow-x-hidden",
      "overflow-y-auto"
    )
    expect(list).toHaveClass("w-16", "overflow-visible")
    expect(list).not.toHaveClass("overflow-y-auto")
    const thumbnails = screen.getAllByRole("tab")
    expect(thumbnails).toHaveLength(10)
    for (const thumbnail of thumbnails) {
      expect(thumbnail).toHaveClass("size-14", "shrink-0")
    }

    await user.click(thumbnails[0]!)
    await user.keyboard("{End}")
    expect(thumbnails[9]).toHaveFocus()
    expect(thumbnails[9]).toHaveAttribute("aria-selected", "true")
  })

  it("keeps the main image placeholder and disables preview until decoding finishes", async () => {
    let finishDecoding!: () => void
    const decode = vi
      .spyOn(HTMLImageElement.prototype, "decode")
      .mockImplementationOnce(
        () => new Promise<void>((resolve) => (finishDecoding = resolve))
      )
    const onPreviewImage = vi.fn()
    const view = render(
      <ConversationGeneratedImages
        items={[call]}
        turnId="turn-1"
        turnStatus="completed"
        running={false}
        filesById={new Map([[fileId, image]])}
        loadPreview={vi.fn().mockResolvedValue(previewSource)}
        onPreviewImage={onPreviewImage}
        onDownload={vi.fn()}
      />
    )
    await waitFor(() => expect(decode).toHaveBeenCalledOnce())
    expect(screen.getByRole("status", { name: "正在生成图片…" })).toBeVisible()
    expect(
      screen.queryByRole("button", { name: `预览图片 ${image.name}` })
    ).toBeNull()
    expect(
      view.container.querySelector(".assistant-inline-image-preview-trigger")
    ).toBeDisabled()
    expect(view.container.querySelector("img")).toHaveAttribute(
      "loading",
      "eager"
    )

    await act(async () => finishDecoding())
    expect(screen.queryByRole("status")).toBeNull()
    fireEvent.click(
      screen.getByRole("button", { name: `预览图片 ${image.name}` })
    )
    expect(onPreviewImage).toHaveBeenCalledWith(
      expect.objectContaining({ src: previewSource.url })
    )
  })

  it("keeps the preview frame while generation, image loading, and a failure replace its content", async () => {
    const loadPreview = vi.fn().mockResolvedValue(previewSource)
    const props = {
      turnId: "turn-1",
      turnStatus: "running" as const,
      running: true,
      filesById: new Map([[fileId, image]]),
      loadPreview,
      onDownload: vi.fn(),
    }
    const view = render(
      <ConversationGeneratedImages
        {...props}
        items={[
          { ...call, status: "inProgress", generatedImageFileIds: undefined },
        ]}
      />
    )
    const frame = view.container.querySelector(
      '[data-slot="generated-image-frame"]'
    )
    expect(frame).toHaveClass("aspect-square", "w-full", "max-h-[32rem]")

    view.rerender(<ConversationGeneratedImages {...props} items={[call]} />)
    const preview = await screen.findByRole("img", { name: image.name })

    expect(
      view.container.querySelector('[data-slot="generated-image-frame"]')
    ).toBe(frame)
    expect(preview).toHaveClass("size-full", "object-contain")
    expect(preview).not.toHaveClass("h-auto")
    fireEvent.error(preview)

    expect(screen.getByRole("button", { name: "重试" })).toBeVisible()
    expect(
      view.container.querySelector('[data-slot="generated-image-frame"]')
    ).toBe(frame)
  })

  it("shows registered code-generated PNG and SVG outputs without a successful generation call", async () => {
    const vector = {
      ...image,
      id: secondFileId,
      name: "窗边的小狗.svg",
      mime_type: "image/svg+xml",
    }
    const foreign = { ...image, id: "foreign", turn_id: "another-turn" }
    const attachment = { ...image, id: "input", kind: "attachment" as const }
    const document = {
      ...image,
      id: "document",
      name: "report.pdf",
      mime_type: "application/pdf",
    }
    const onDownload = vi.fn()
    const onPreviewImage = vi.fn()
    render(
      <ConversationGeneratedImages
        items={[]}
        registeredFileIds={[
          fileId,
          fileId.toUpperCase(),
          secondFileId,
          "foreign",
          "input",
          "document",
        ]}
        turnId="turn-1"
        turnStatus="completed"
        running={false}
        filesById={
          new Map(
            [image, vector, foreign, attachment, document].map((file) => [
              file.id,
              file,
            ])
          )
        }
        loadPreview={vi.fn().mockResolvedValue(previewSource)}
        onDownload={onDownload}
        onPreviewImage={onPreviewImage}
      />
    )
    expect(screen.getAllByRole("tab")).toHaveLength(2)
    fireEvent.click(
      screen.getByRole("tab", { name: `选择图片 ${vector.name}` })
    )
    await waitFor(() =>
      expect(screen.getByRole("img", { name: vector.name })).toBeVisible()
    )
    fireEvent.click(screen.getByRole("button", { name: `下载 ${vector.name}` }))
    expect(onDownload).toHaveBeenCalledWith(vector)
    fireEvent.click(
      screen.getByRole("button", { name: `预览图片 ${vector.name}` })
    )
    expect(onPreviewImage).toHaveBeenCalledWith(
      expect.objectContaining({ id: vector.id })
    )
  })

  it("keeps the same card while generation and preview loading finish, and separates preview from download", async () => {
    let resolvePreview!: (value: typeof previewSource) => void
    const loadPreview = vi.fn(
      () =>
        new Promise<typeof previewSource>((resolve) => {
          resolvePreview = resolve
        })
    )
    const onDownload = vi.fn()
    const onPreviewImage = vi.fn()
    const props = {
      turnId: "turn-1",
      turnStatus: "running" as const,
      running: true,
      filesById: new Map([[fileId, image]]),
      loadPreview,
      onDownload,
      onPreviewImage,
    }
    const { container, rerender } = render(
      <ConversationGeneratedImages
        {...props}
        items={[
          { ...call, status: "inProgress", generatedImageFileIds: undefined },
        ]}
      />
    )
    const card = container.querySelector('[data-slot="generated-image-call"]')
    expect(card).toHaveClass("max-w-[15rem]")
    expect(screen.getByRole("status", { name: "正在生成图片…" })).toBeVisible()
    rerender(<ConversationGeneratedImages {...props} items={[call]} />)
    expect(container.querySelector('[data-slot="generated-image-call"]')).toBe(
      card
    )
    expect(screen.getByRole("status", { name: "正在生成图片…" })).toBeVisible()
    await act(async () => resolvePreview(previewSource))
    expect(screen.getByRole("img", { name: image.name })).toHaveAttribute(
      "src",
      previewSource.url
    )
    expect(screen.queryByRole("status", { name: "正在生成图片…" })).toBeNull()
    const download = screen.getByRole("button", { name: `下载 ${image.name}` })
    expect(download.className).toContain(
      "group-hover/generated-image:opacity-100"
    )
    expect(download.className).toContain(
      "group-focus-within/generated-image:opacity-100"
    )
    expect(download.className).toContain("hover:hover")
    fireEvent.click(download)
    expect(onDownload).toHaveBeenCalledWith(image)
    expect(onPreviewImage).not.toHaveBeenCalled()
    fireEvent.click(
      screen.getByRole("button", { name: `预览图片 ${image.name}` })
    )
    expect(onPreviewImage).toHaveBeenCalledWith(
      expect.objectContaining({
        id: fileId,
        src: previewSource.url,
        name: image.name,
      })
    )
    rerender(
      <ConversationGeneratedImages
        {...props}
        items={[call]}
        downloadingFileId={fileId}
      />
    )
    expect(download).toBeDisabled()
  })

  it("reconstructs a main image and right-hand thumbnails after reopening without sharing another turn's files", async () => {
    const second = { ...image, id: secondFileId, name: "午后窗台上的柯基.png" }
    const props = {
      items: [
        { ...call, generatedImageFileIds: [fileId, secondFileId] },
        {
          ...call,
          id: "next-call",
          generatedImageFileIds: ["30000000-0000-4000-8000-000000000013"],
        },
      ],
      turnId: "turn-1",
      turnStatus: "completed" as const,
      running: false,
      filesById: new Map([
        [fileId, image],
        [secondFileId, second],
        [
          "30000000-0000-4000-8000-000000000013",
          {
            ...image,
            id: "30000000-0000-4000-8000-000000000013",
            turn_id: "another-turn",
          },
        ],
      ]),
      loadPreview: vi.fn().mockResolvedValue(previewSource),
      onDownload: vi.fn(),
    }
    const first = render(<ConversationGeneratedImages {...props} />)
    await waitFor(() =>
      expect(screen.getByRole("tablist")).toHaveAttribute(
        "aria-orientation",
        "vertical"
      )
    )
    expect(screen.getAllByRole("tab")).toHaveLength(2)
    expect(screen.getByRole("tablist")).toHaveClass("flex-col")
    expect(screen.getAllByRole("tabpanel")).toHaveLength(1)
    expect(screen.getByText("图片暂时无法查看")).toBeVisible()
    first.unmount()
    render(<ConversationGeneratedImages {...props} />)
    await waitFor(() =>
      expect(screen.getByRole("img", { name: image.name })).toBeVisible()
    )
    fireEvent.click(
      screen.getByRole("button", { name: `预览图片 ${image.name}` })
    )
    expect(screen.getByRole("dialog")).toBeVisible()
  })

  it("switches the selected main image and its preview and download with thumbnails and vertical arrow keys", async () => {
    const second = { ...image, id: secondFileId, name: "午后窗台上的柯基.png" }
    const onDownload = vi.fn()
    const onPreviewImage = vi.fn()
    const loadPreview = vi.fn(async (file: ConversationFile) => ({
      ...previewSource,
      url: `https://files.example.test/${file.id}.png`,
    }))
    const user = userEvent.setup()
    render(
      <ConversationGeneratedImages
        items={[
          call,
          { ...call, id: "second-call", generatedImageFileIds: [secondFileId] },
        ]}
        turnId="turn-1"
        turnStatus="completed"
        running={false}
        filesById={
          new Map([
            [fileId, image],
            [secondFileId, second],
          ])
        }
        loadPreview={loadPreview}
        onDownload={onDownload}
        onPreviewImage={onPreviewImage}
      />
    )
    const tabs = await screen.findAllByRole("tab")
    expect(tabs[0]).toHaveAttribute("aria-selected", "true")
    await user.click(tabs[1]!)
    expect(tabs[1]).toHaveAttribute("aria-selected", "true")
    expect(screen.getAllByRole("tabpanel")).toHaveLength(1)
    await waitFor(() =>
      expect(screen.getByRole("img", { name: second.name })).toBeVisible()
    )
    await user.click(
      screen.getByRole("button", { name: `下载 ${second.name}` })
    )
    expect(onDownload).toHaveBeenLastCalledWith(second)
    await user.click(
      screen.getByRole("button", { name: `预览图片 ${second.name}` })
    )
    expect(onPreviewImage).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: secondFileId, name: second.name })
    )
    await user.click(tabs[0]!)
    await user.keyboard("{ArrowDown}")
    expect(tabs[1]).toHaveFocus()
    expect(tabs[1]).toHaveAttribute("aria-selected", "true")
    expect(loadPreview).toHaveBeenCalledTimes(2)
  })

  it("keeps the selected image when another generation finishes in the same turn", async () => {
    const thirdId = "30000000-0000-4000-8000-000000000013"
    const second = { ...image, id: secondFileId, name: "窗台上的柯基.png" }
    const third = { ...image, id: thirdId, name: "沙滩上的柯基.png" }
    const props = {
      turnId: "turn-1",
      turnStatus: "running" as const,
      running: true,
      loadPreview: vi.fn().mockResolvedValue(previewSource),
      onDownload: vi.fn(),
    }
    const ready = { ...call, generatedImageFileIds: [fileId, secondFileId] }
    const pending = {
      ...call,
      id: "later-call",
      status: "inProgress" as const,
      generatedImageFileIds: undefined,
    }
    const { rerender } = render(
      <ConversationGeneratedImages
        {...props}
        items={[ready, pending]}
        filesById={
          new Map([
            [fileId, image],
            [secondFileId, second],
          ])
        }
      />
    )
    fireEvent.click(screen.getAllByRole("tab")[1]!)
    await waitFor(() =>
      expect(screen.getByRole("img", { name: second.name })).toBeVisible()
    )
    expect(screen.getByRole("status", { name: "正在生成图片…" })).toBeVisible()
    rerender(
      <ConversationGeneratedImages
        {...props}
        items={[
          ready,
          { ...pending, status: "completed", generatedImageFileIds: [thirdId] },
        ]}
        filesById={
          new Map([
            [fileId, image],
            [secondFileId, second],
            [thirdId, third],
          ])
        }
      />
    )
    expect(screen.getAllByRole("tab")).toHaveLength(3)
    expect(screen.getAllByRole("tab")[1]).toHaveAttribute(
      "aria-selected",
      "true"
    )
    expect(screen.getByRole("img", { name: second.name })).toBeVisible()
    expect(screen.queryByRole("status", { name: "正在生成图片…" })).toBeNull()
  })

  it("keeps loading when tool completion arrives before the registered file details", async () => {
    const props = {
      items: [call],
      turnId: "turn-1",
      turnStatus: "running" as const,
      running: true,
      loadPreview: vi.fn().mockResolvedValue(previewSource),
      onDownload: vi.fn(),
    }
    const { rerender } = render(<ConversationGeneratedImages {...props} />)
    expect(screen.getByRole("status", { name: "正在生成图片…" })).toBeVisible()
    expect(screen.queryByRole("alert")).toBeNull()
    rerender(
      <ConversationGeneratedImages
        {...props}
        filesById={new Map([[fileId, image]])}
      />
    )
    await waitFor(() =>
      expect(screen.getByRole("img", { name: image.name })).toBeVisible()
    )
    expect(screen.queryByRole("status", { name: "正在生成图片…" })).toBeNull()
  })

  it("keeps download available when preview fails and retries only the preview", async () => {
    const loadPreview = vi
      .fn()
      .mockRejectedValueOnce(new Error("preview failed"))
      .mockResolvedValue(previewSource)
    const onDownload = vi.fn()
    render(
      <ConversationGeneratedImages
        items={[call]}
        turnId="turn-1"
        turnStatus="completed"
        running={false}
        filesById={new Map([[fileId, image]])}
        loadPreview={loadPreview}
        onDownload={onDownload}
      />
    )
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "重试" })).toBeVisible()
    )
    fireEvent.click(screen.getByRole("button", { name: `下载 ${image.name}` }))
    expect(onDownload).toHaveBeenCalledWith(image)
    fireEvent.click(screen.getByRole("button", { name: "重试" }))
    await waitFor(() =>
      expect(screen.getByRole("img", { name: image.name })).toHaveAttribute(
        "src",
        previewSource.url
      )
    )
    expect(loadPreview).toHaveBeenCalledTimes(2)
  })

  it("does not reserve an image surface for a failed generation without an image", () => {
    const { container } = render(
      <ConversationGeneratedImages
        items={[
          {
            ...call,
            generatedImageFileIds: undefined,
            imageGenerationFailureCode: "IMAGE_GENERATION_PROVIDER_REJECTED",
          },
        ]}
        turnId="turn-1"
        turnStatus="running"
        running
        onDownload={vi.fn()}
      />
    )
    expect(
      container.querySelector('[data-slot="generated-image-call"]')
    ).toBeNull()
    expect(screen.queryByRole("alert")).toBeNull()
    expect(screen.queryByRole("status")).toBeNull()
  })

  it("does not carry an earlier failure into a retry or its successful images", async () => {
    const failed = {
      ...call,
      generatedImageFileIds: undefined,
      imageGenerationFailureCode: "IMAGE_GENERATION_PROVIDER_REJECTED" as const,
    }
    const retry = {
      ...call,
      id: "retry-image-call",
      status: "inProgress" as const,
      generatedImageFileIds: undefined,
    }
    const props = {
      turnId: "turn-1",
      turnStatus: "running" as const,
      running: true,
      filesById: new Map([[fileId, image]]),
      loadPreview: vi.fn().mockResolvedValue(previewSource),
      onDownload: vi.fn(),
    }
    const { rerender } = render(
      <ConversationGeneratedImages {...props} items={[failed, retry]} />
    )
    expect(screen.getByRole("status", { name: "正在生成图片…" })).toBeVisible()
    expect(screen.queryByRole("alert")).toBeNull()

    rerender(
      <ConversationGeneratedImages
        {...props}
        items={[
          failed,
          { ...retry, status: "completed", generatedImageFileIds: [fileId] },
        ]}
      />
    )
    expect(await screen.findByRole("img", { name: image.name })).toBeVisible()
    expect(screen.queryByRole("alert")).toBeNull()
  })

  it.each(["failed", "interrupted"] as const)(
    "removes the unfinished image surface when the turn is %s, including a stale running flag",
    (turnStatus) => {
      const { container } = render(
        <ConversationGeneratedImages
          items={[
            { ...call, status: "inProgress", generatedImageFileIds: undefined },
          ]}
          turnId="turn-1"
          turnStatus={turnStatus}
          running
          onDownload={vi.fn()}
        />
      )
      expect(
        container.querySelector('[data-slot="generated-image-call"]')
      ).toBeNull()
      expect(screen.queryByRole("status")).toBeNull()
    }
  )

  it.each(supportedLanguages)(
    "keeps missing-image feedback compact and localized in %s",
    async (language) => {
      await i18n.changeLanguage(language)
      const props = {
        turnId: "turn-1",
        turnStatus: "failed" as const,
        running: false,
        onDownload: vi.fn(),
      }
      render(
        <ConversationGeneratedImages
          {...props}
          turnStatus="completed"
          items={[call]}
        />
      )
      expect(screen.getByRole("alert")).toHaveTextContent(
        i18n.t("conversation.imageGeneration.unavailable")
      )
      expect(screen.getByRole("alert")).not.toHaveClass("aspect-square")
    }
  )
})
