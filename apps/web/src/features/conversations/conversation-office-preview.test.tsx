import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ReactNode } from "react"

import type { ConversationFile } from "@/api/contracts"
import { OFFICE_PREVIEW_ENTER_CLASS } from "@/components/media/office-preview/office-preview-suspense-boundary"
import {
  ConversationHtmlCodePreview,
  ConversationImagePreview,
  ConversationOfficePreview,
} from "@/features/conversations/conversation-office-preview"
import i18n from "@/i18n"

const preview = vi.hoisted(() => ({
  kinds: [] as string[],
  disabled: [] as boolean[],
  spreadsheetClasses: [] as Array<string | undefined>,
  presentationMarkers: [] as number[][],
  wordMarkers: [] as number[][],
  spreadsheetMarkers: [] as number[][],
  htmlMarkers: [] as number[][],
  wordNavigation: [] as Array<
    Readonly<{ id: string; sequence: number }> | null | undefined
  >,
  htmlFileNames: [] as string[],
  htmlContents: [] as string[],
  generic: [] as Array<{
    kind: string
    status: string
    hasContent: boolean
    hasSource: boolean
  }>,
}))

vi.mock("@/components/media/presentation-preview/presentation-preview", () => ({
  default: (props: {
    annotationControls?: ReactNode
    annotationMarkers?: readonly { index: number }[]
    annotationNavigation?: Readonly<{ id: string; sequence: number }> | null
  }) => {
    preview.presentationMarkers.push(
      props.annotationMarkers?.map((marker) => marker.index) ?? []
    )
    return (
      <>
        {props.annotationControls}
        <div data-testid="presentation-preview">presentation</div>
      </>
    )
  },
}))

vi.mock("@/components/media/word-preview/word-preview", () => ({
  default: (props: {
    document: { status: string }
    annotationControls?: ReactNode
    annotationMarkers?: readonly { index: number }[]
    annotationNavigation?: Readonly<{ id: string; sequence: number }> | null
    selectionAction?: {
      disabled?: boolean
      onSubmit: (selection: object, description: string) => Promise<void>
    }
    onDownload?: () => void
    floatingContent?: ReactNode
  }) => {
    preview.kinds.push(`word:${props.document.status}`)
    preview.disabled.push(Boolean(props.selectionAction?.disabled))
    preview.wordMarkers.push(
      props.annotationMarkers?.map((marker) => marker.index) ?? []
    )
    preview.wordNavigation.push(props.annotationNavigation)
    return (
      <>
        {props.annotationControls}
        {props.selectionAction && (
          <button
            type="button"
            disabled={props.selectionAction.disabled}
            onClick={() =>
              void props.selectionAction?.onSubmit(
                {
                  type: "text",
                  selectedText: "季度目标",
                  paragraphText: "季度目标",
                  before: "",
                  after: "",
                  startParagraphIndex: 2,
                  endParagraphIndex: 2,
                  isMultiParagraph: false,
                },
                "改成年目标"
              )
            }
          >
            ask-word
          </button>
        )}
        {props.onDownload && (
          <button type="button" onClick={props.onDownload}>
            download-word
          </button>
        )}
        {props.floatingContent}
      </>
    )
  },
}))

vi.mock("@/components/media/spreadsheet-preview/spreadsheet-preview", () => ({
  default: (props: {
    document: { status: string }
    className?: string
    annotationControls?: ReactNode
    annotationMarkers?: readonly { index: number }[]
    selectionAction?: {
      disabled?: boolean
      onSubmit: (selection: object, description: string) => Promise<void>
    }
    floatingContent?: ReactNode
  }) => {
    preview.kinds.push(`spreadsheet:${props.document.status}`)
    preview.spreadsheetClasses.push(props.className)
    preview.spreadsheetMarkers.push(
      props.annotationMarkers?.map((marker) => marker.index) ?? []
    )
    return (
      <>
        {props.annotationControls}
        {props.selectionAction && (
          <button
            type="button"
            onClick={() =>
              void props.selectionAction?.onSubmit(
                {
                  type: "range",
                  sheetName: "预算",
                  sheetIndex: 0,
                  rangeAddress: "A1:B2",
                  startRow: 0,
                  startColumn: 0,
                  endRow: 1,
                  endColumn: 1,
                },
                "增加一列"
              )
            }
          >
            ask-spreadsheet
          </button>
        )}
        {props.floatingContent}
      </>
    )
  },
}))

vi.mock("@/components/media/html-preview/html-preview", () => ({
  default: (props: {
    document: { status: string; content?: Uint8Array }
    fileName: string
    selectionAction?: {
      onSubmit: (selection: object, description: string) => Promise<void>
    }
    annotationMarkers?: readonly { index: number }[]
    floatingContent?: ReactNode
  }) => {
    preview.kinds.push(`html:${props.document.status}`)
    preview.htmlFileNames.push(props.fileName)
    if (props.document.content) {
      preview.htmlContents.push(
        new TextDecoder().decode(props.document.content)
      )
    }
    preview.htmlMarkers.push(
      props.annotationMarkers?.map((marker) => marker.index) ?? []
    )
    return (
      <>
        <button
          type="button"
          onClick={() =>
            void props.selectionAction?.onSubmit(
              {
                elements: [
                  {
                    selector: "#hero",
                    domPath: [0, 0],
                    tagName: "h1",
                    classNames: ["title"],
                    text: "欢迎",
                    outerHtml: '<h1 id="hero">欢迎</h1>',
                    attributes: {},
                    bounds: { x: 10, y: 20, width: 100, height: 40 },
                  },
                ],
              },
              "改为英文"
            )
          }
        >
          ask-html
        </button>
        {props.floatingContent}
      </>
    )
  },
}))

vi.mock("@/components/media/archive-preview/archive-preview", () => ({
  default: (props: {
    document: { status: string }
    onDownload?: () => void
  }) => {
    preview.kinds.push(`archive:${props.document.status}`)
    return (
      <>
        <div data-testid="archive-preview">archive</div>
        {props.onDownload && (
          <button type="button" onClick={props.onDownload}>
            download-archive
          </button>
        )}
      </>
    )
  },
}))

vi.mock(
  "@/components/media/read-only-file-preview/read-only-file-preview",
  () => ({
    ReadOnlyFilePreview: (props: {
      kind: string
      document: {
        status: string
        content?: Uint8Array
        source?: { url: string }
      }
      onDownload?: () => void
      onRetry?: () => void
    }) => {
      preview.generic.push({
        kind: props.kind,
        status: props.document.status,
        hasContent: Boolean(props.document.content),
        hasSource: Boolean(props.document.source),
      })
      return (
        <div data-testid={`generic-${props.kind}`}>
          {props.kind}
          {props.onDownload && (
            <button type="button" onClick={props.onDownload}>
              download-generic
            </button>
          )}
          {props.document.source && props.onRetry && (
            <button type="button" onClick={props.onRetry}>
              retry-generic
            </button>
          )}
        </div>
      )
    },
  })
)

function officeFile(
  id: string,
  name: string,
  mimeType: string
): ConversationFile {
  return {
    id,
    name,
    mime_type: mimeType,
    size: 0,
    download_available: true,
  }
}

async function sendPendingAnnotations() {
  const interaction = userEvent.setup()
  await interaction.click(
    screen.getByRole("button", { name: /查看 \d+ 条待发送标注/u })
  )
  await interaction.click(
    await screen.findByRole("button", { name: "全部处理" })
  )
}

async function enableOfficeAnnotationMode() {
  const interaction = userEvent.setup()
  const toggle = await screen.findByRole("button", {
    name: "进入文件标注模式",
  })
  expect(toggle).toHaveTextContent("添加标注")
  expect(toggle).toHaveAttribute("aria-pressed", "false")
  await interaction.click(toggle)
  expect(toggle).toHaveAttribute("aria-pressed", "true")
  expect(toggle).toHaveTextContent("标注中")
}

describe("conversation Office preview", () => {
  beforeEach(async () => {
    preview.kinds = []
    preview.disabled = []
    preview.spreadsheetClasses = []
    preview.presentationMarkers = []
    preview.wordMarkers = []
    preview.spreadsheetMarkers = []
    preview.htmlMarkers = []
    preview.wordNavigation = []
    preview.htmlFileNames = []
    preview.htmlContents = []
    preview.generic = []
    await i18n.changeLanguage("zh-CN")
  })

  afterEach(() => cleanup())

  it("previews raw assistant HTML code with the shared HTML preview pane", async () => {
    const html =
      "<!doctype html><html><body><button>Continue</button></body></html>"

    render(
      <ConversationHtmlCodePreview
        html={html}
        fileName="HTML 代码预览.html"
        onClose={vi.fn()}
      />
    )

    await waitFor(() => expect(preview.kinds).toContain("html:ready"))
    expect(preview.htmlFileNames).toContain("HTML 代码预览.html")
    expect(preview.htmlContents).toContain(html)
  })

  it("previews a message image URL in the shared right preview pane", async () => {
    const { container } = render(
      <ConversationImagePreview
        item={{
          id: "assistant-markdown-image:https://images.example/logo.png",
          name: "logo.png",
          src: "https://images.example/logo.png",
          alt: "logo",
        }}
        onClose={vi.fn()}
      />
    )

    expect(await screen.findByRole("img", { name: "logo" })).toHaveAttribute(
      "src",
      "https://images.example/logo.png"
    )
    expect(screen.getByRole("button", { name: "缩小图片" })).toBeVisible()
    expect(screen.getByText("100%")).toBeVisible()
    expect(screen.getByRole("button", { name: "放大图片" })).toBeVisible()
    expect(
      container.querySelector(
        ".conversation-image-preview-viewer .image-preview-stage"
      )
    ).toHaveAttribute("data-pannable", "true")
  })

  it("loads a DOCX lazily and forwards its text selection with the file", async () => {
    const file = officeFile(
      "word-1",
      "proposal.docx",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    )
    const loadContent = vi.fn().mockResolvedValue(new Uint8Array([1, 2]))
    const onAskSelection = vi.fn().mockResolvedValue(undefined)

    render(
      <ConversationOfficePreview
        file={file}
        loadContent={loadContent}
        onAskSelection={onAskSelection}
        onClose={vi.fn()}
      />
    )

    await waitFor(() => expect(preview.kinds).toContain("word:ready"))
    expect(screen.queryByRole("button", { name: "ask-word" })).toBeNull()
    await enableOfficeAnnotationMode()
    await userEvent.click(screen.getByRole("button", { name: "ask-word" }))
    expect(preview.wordMarkers.at(-1)).toEqual([1])
    expect(onAskSelection).not.toHaveBeenCalled()
    await sendPendingAnnotations()
    expect(onAskSelection).toHaveBeenCalledWith(file, [
      {
        officeSelection: {
          kind: "word",
          selection: expect.objectContaining({
            type: "text",
            selectedText: "季度目标",
          }),
        },
        request: "改成年目标",
      },
    ])
  })

  it("accumulates multiple annotations, expands their list, and sends the remaining batch once", async () => {
    const file = officeFile(
      "word-batch",
      "proposal.docx",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    )
    const loadContent = vi.fn().mockResolvedValue(new Uint8Array([1, 2]))
    const onAskSelection = vi.fn().mockResolvedValue(undefined)

    render(
      <ConversationOfficePreview
        file={file}
        loadContent={loadContent}
        onAskSelection={onAskSelection}
        onClose={vi.fn()}
      />
    )

    await enableOfficeAnnotationMode()
    const askButton = await screen.findByRole("button", { name: "ask-word" })
    await userEvent.click(askButton)
    await userEvent.click(askButton)
    expect(preview.wordMarkers.at(-1)).toEqual([1, 2])
    expect(onAskSelection).not.toHaveBeenCalled()

    const batchTrigger = screen.getByRole("button", {
      name: "查看 2 条待发送标注",
    })
    expect(batchTrigger).toHaveClass(
      "office-annotation-batch-trigger",
      "rounded-full"
    )
    expect(
      batchTrigger.querySelector(".lucide-message-circle-plus")
    ).not.toBeNull()
    expect(batchTrigger.querySelector(".lucide-message-square-more")).toBeNull()
    await userEvent.hover(batchTrigger)
    const batchDialog = await screen.findByRole("dialog", {
      name: "待发送标注列表",
    })
    expect(within(batchDialog).getByRole("list")).toBeVisible()
    const processAllButton = within(batchDialog).getByRole("button", {
      name: "全部处理",
    })
    expect(processAllButton.querySelector(".lucide-arrow-up")).not.toBeNull()
    expect(processAllButton).toHaveClass(
      "office-annotation-batch-send",
      "size-8",
      "rounded-full",
      "bg-primary",
      "text-primary-foreground"
    )
    expect(processAllButton).toHaveTextContent("")
    expect(screen.getAllByText("改成年目标")).toHaveLength(2)
    expect(screen.getAllByText("改成年目标")[0]).toHaveClass(
      "office-annotation-batch-request"
    )

    await userEvent.click(
      within(batchDialog).getByRole("button", {
        name: "定位到第 2 条标注",
      })
    )
    await waitFor(() =>
      expect(preview.wordNavigation.at(-1)).toEqual({
        id: "word-batch:2",
        sequence: 1,
      })
    )
    expect(screen.queryByRole("dialog", { name: "待发送标注列表" })).toBeNull()

    await userEvent.click(batchTrigger)
    const reopenedBatchDialog = await screen.findByRole("dialog", {
      name: "待发送标注列表",
    })

    const removeButton = within(reopenedBatchDialog).getByRole("button", {
      name: "删除第 1 条标注",
    })
    expect(removeButton).toHaveClass("size-7", "text-muted-foreground/60")
    await userEvent.click(removeButton)
    await userEvent.click(screen.getByRole("button", { name: "全部处理" }))

    await waitFor(() => expect(onAskSelection).toHaveBeenCalledOnce())
    expect(onAskSelection).toHaveBeenCalledWith(file, [
      {
        officeSelection: {
          kind: "word",
          selection: expect.objectContaining({ selectedText: "季度目标" }),
        },
        request: "改成年目标",
      },
    ])
    expect(screen.queryByRole("button", { name: /待发送标注/u })).toBeNull()
  })

  it("keeps the annotation batch available when sending fails", async () => {
    const file = officeFile(
      "word-send-failure",
      "proposal.docx",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    )
    const onAskSelection = vi.fn().mockRejectedValue(new Error("offline"))

    render(
      <ConversationOfficePreview
        file={file}
        loadContent={vi.fn().mockResolvedValue(new Uint8Array([1]))}
        onAskSelection={onAskSelection}
        onClose={vi.fn()}
      />
    )

    await enableOfficeAnnotationMode()
    await userEvent.click(
      await screen.findByRole("button", { name: "ask-word" })
    )
    await sendPendingAnnotations()

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "批量标注发送失败，内容已保留，请重试。"
    )
    expect(onAskSelection).toHaveBeenCalledOnce()
    expect(
      screen.getByRole("button", { name: "查看 1 条待发送标注" })
    ).toBeVisible()
    expect(screen.getByText("改成年目标")).toBeVisible()
  })

  it("clears accumulated annotations without starting a turn", async () => {
    const file = officeFile(
      "word-clear-batch",
      "proposal.docx",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    )
    const onAskSelection = vi.fn()

    render(
      <ConversationOfficePreview
        file={file}
        loadContent={vi.fn().mockResolvedValue(new Uint8Array([1]))}
        onAskSelection={onAskSelection}
        onClose={vi.fn()}
      />
    )

    await enableOfficeAnnotationMode()
    const askButton = await screen.findByRole("button", { name: "ask-word" })
    await userEvent.click(askButton)
    await userEvent.click(askButton)
    await userEvent.click(
      screen.getByRole("button", { name: "查看 2 条待发送标注" })
    )
    await userEvent.click(await screen.findByRole("button", { name: "清空" }))

    expect(onAskSelection).not.toHaveBeenCalled()
    expect(screen.queryByRole("button", { name: /待发送标注/u })).toBeNull()
  })

  it("animates an XLSX pane only during its initial load", async () => {
    const warmup = render(
      <ConversationOfficePreview
        file={officeFile(
          "sheet-warmup",
          "warmup.xlsx",
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        )}
        loadContent={vi.fn().mockResolvedValue(new Uint8Array([1]))}
        onAskSelection={vi.fn().mockResolvedValue(undefined)}
        onClose={vi.fn()}
      />
    )
    await waitFor(() => expect(preview.kinds).toContain("spreadsheet:ready"))
    warmup.unmount()
    preview.kinds = []
    preview.spreadsheetClasses = []

    const file = officeFile(
      "sheet-1",
      "budget.xlsx",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )
    const onAskSelection = vi.fn().mockResolvedValue(undefined)

    render(
      <ConversationOfficePreview
        file={file}
        loadContent={vi.fn().mockResolvedValue(new Uint8Array([9]))}
        onAskSelection={onAskSelection}
        onClose={vi.fn()}
      />
    )

    await waitFor(() => expect(preview.kinds).toContain("spreadsheet:ready"))
    const loadingRender = preview.kinds.indexOf("spreadsheet:loading")
    const readyRender = preview.kinds.lastIndexOf("spreadsheet:ready")
    expect(preview.spreadsheetClasses[loadingRender]).toBe(
      OFFICE_PREVIEW_ENTER_CLASS
    )
    expect(preview.spreadsheetClasses[readyRender]).toBeUndefined()
    await enableOfficeAnnotationMode()
    await userEvent.click(
      screen.getByRole("button", { name: "ask-spreadsheet" })
    )
    expect(preview.spreadsheetMarkers.at(-1)).toEqual([1])
    expect(onAskSelection).not.toHaveBeenCalled()
    await sendPendingAnnotations()
    expect(onAskSelection).toHaveBeenCalledWith(file, [
      {
        officeSelection: {
          kind: "spreadsheet",
          selection: expect.objectContaining({
            type: "range",
            sheetName: "预算",
            rangeAddress: "A1:B2",
          }),
        },
        request: "增加一列",
      },
    ])
  })

  it("does not animate the pane again when switching XLSX files", async () => {
    const firstFile = officeFile(
      "sheet-first",
      "first.xlsx",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )
    const secondFile = officeFile(
      "sheet-second",
      "second.xlsx",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )
    let resolveSecondFile: ((content: Uint8Array) => void) | undefined
    const loadContent = vi.fn((file: ConversationFile) =>
      file.id === firstFile.id
        ? Promise.resolve(new Uint8Array([1]))
        : new Promise<Uint8Array>((resolve) => {
            resolveSecondFile = resolve
          })
    )
    const onAskSelection = vi.fn().mockResolvedValue(undefined)
    const view = render(
      <ConversationOfficePreview
        file={firstFile}
        loadContent={loadContent}
        onAskSelection={onAskSelection}
        onClose={vi.fn()}
        animateEntrance
      />
    )

    await waitFor(() => expect(preview.kinds).toContain("spreadsheet:ready"))
    preview.kinds = []
    preview.spreadsheetClasses = []

    view.rerender(
      <ConversationOfficePreview
        file={secondFile}
        loadContent={loadContent}
        onAskSelection={onAskSelection}
        onClose={vi.fn()}
        animateEntrance={false}
      />
    )

    await waitFor(() => expect(preview.kinds).toContain("spreadsheet:loading"))
    expect(preview.spreadsheetClasses).not.toContain(OFFICE_PREVIEW_ENTER_CLASS)

    resolveSecondFile?.(new Uint8Array([2]))
    await waitFor(() => expect(preview.kinds).toContain("spreadsheet:ready"))
    expect(preview.spreadsheetClasses).not.toContain(OFFICE_PREVIEW_ENTER_CLASS)
  })

  it("loads static HTML and forwards its element selection", async () => {
    const file = officeFile("html-1", "landing.html", "text/html")
    const onAskSelection = vi.fn().mockResolvedValue(undefined)

    render(
      <ConversationOfficePreview
        file={file}
        loadContent={vi
          .fn()
          .mockResolvedValue(new TextEncoder().encode("<h1>欢迎</h1>"))}
        onAskSelection={onAskSelection}
        onClose={vi.fn()}
      />
    )

    await waitFor(() => expect(preview.kinds).toContain("html:ready"))
    await userEvent.click(screen.getByRole("button", { name: "ask-html" }))
    expect(preview.htmlMarkers.at(-1)).toEqual([1])
    expect(onAskSelection).not.toHaveBeenCalled()
    await sendPendingAnnotations()
    expect(onAskSelection).toHaveBeenCalledWith(file, [
      {
        officeSelection: {
          kind: "html",
          selection: expect.objectContaining({
            elements: [expect.objectContaining({ selector: "#hero" })],
          }),
        },
        request: "改为英文",
      },
    ])
  })

  it("forwards the loaded Office bytes when the preview download action is used", async () => {
    const file = officeFile(
      "word-download",
      "proposal.docx",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    )
    const content = new Uint8Array([1, 2, 3])
    const onDownload = vi.fn()

    render(
      <ConversationOfficePreview
        file={file}
        loadContent={vi.fn().mockResolvedValue(content)}
        onAskSelection={vi.fn()}
        onDownload={onDownload}
        onClose={vi.fn()}
      />
    )

    await userEvent.click(
      await screen.findByRole("button", { name: "download-word" })
    )
    expect(onDownload).toHaveBeenCalledWith(file, content)
  })

  it("loads a ZIP into the archive preview without requesting a selection action", async () => {
    const file = officeFile("archive-1", "bundle.zip", "application/zip")
    const content = new Uint8Array([1, 2, 3])
    const onAskSelection = vi.fn().mockResolvedValue(undefined)
    const onDownload = vi.fn()

    render(
      <ConversationOfficePreview
        file={file}
        loadContent={vi.fn().mockResolvedValue(content)}
        onAskSelection={onAskSelection}
        onDownload={onDownload}
        onClose={vi.fn()}
      />
    )

    await waitFor(() => expect(preview.kinds).toContain("archive:ready"))
    await userEvent.click(
      screen.getByRole("button", { name: "download-archive" })
    )
    expect(onDownload).toHaveBeenCalledWith(file, content)
    expect(onAskSelection).not.toHaveBeenCalled()
  })

  it("aborts the shared content request when the pane unmounts", async () => {
    const file = officeFile(
      "word-2",
      "draft.docx",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    )
    let signal: AbortSignal | undefined
    const { unmount } = render(
      <ConversationOfficePreview
        file={file}
        loadContent={vi.fn((_file, nextSignal) => {
          signal = nextSignal
          return new Promise<Uint8Array>(() => undefined)
        })}
        onAskSelection={vi.fn()}
        onClose={vi.fn()}
      />
    )

    await waitFor(() => expect(signal).toBeInstanceOf(AbortSignal))
    unmount()
    expect(signal?.aborted).toBe(true)
  })

  it("disables selection submission while the task is busy", async () => {
    const file = officeFile(
      "word-3",
      "busy.docx",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    )

    render(
      <ConversationOfficePreview
        file={file}
        loadContent={vi.fn().mockResolvedValue(new Uint8Array([1]))}
        onAskSelection={vi.fn()}
        selectionDisabled
        onClose={vi.fn()}
      />
    )

    await enableOfficeAnnotationMode()
    const askButton = await screen.findByRole("button", { name: "ask-word" })
    expect(askButton).toBeDisabled()
    expect(preview.disabled).toContain(true)
  })

  it("loads code through content without exposing a LinkSense selection action", async () => {
    const file = officeFile("code-1", "server.ts", "text/plain")
    const loadContent = vi
      .fn()
      .mockResolvedValue(new TextEncoder().encode("export const ready = true"))
    const onAskSelection = vi.fn().mockResolvedValue(undefined)

    render(
      <ConversationOfficePreview
        file={file}
        loadContent={loadContent}
        onAskSelection={onAskSelection}
        onClose={vi.fn()}
      />
    )

    await waitFor(() =>
      expect(preview.generic).toContainEqual({
        kind: "code",
        status: "ready",
        hasContent: true,
        hasSource: false,
      })
    )
    expect(onAskSelection).not.toHaveBeenCalled()
    expect(screen.queryByRole("button", { name: /ask/i })).toBeNull()
  })

  it("loads media through a source URL and delegates its download callback", async () => {
    const file = officeFile("audio-1", "voice.mp3", "audio/mpeg")
    const loadContent = vi.fn()
    const loadPreviewSource = vi.fn().mockResolvedValue({
      url: "https://files.example/voice.mp3",
      expiresAt: "2999-01-01T00:00:00.000Z",
    })
    const onDownloadSource = vi.fn()

    render(
      <ConversationOfficePreview
        file={file}
        loadContent={loadContent}
        loadPreviewSource={loadPreviewSource}
        onAskSelection={vi.fn()}
        onDownloadSource={onDownloadSource}
        onClose={vi.fn()}
      />
    )

    await waitFor(() =>
      expect(preview.generic).toContainEqual({
        kind: "audio",
        status: "ready",
        hasContent: false,
        hasSource: true,
      })
    )
    expect(loadContent).not.toHaveBeenCalled()
    await userEvent.click(
      screen.getByRole("button", { name: "download-generic" })
    )
    expect(onDownloadSource).toHaveBeenCalledWith(file)
  })

  it("loads image files through the shared source preview", async () => {
    const file = officeFile("image-1", "cover.png", "image/png")
    const loadContent = vi.fn()
    const loadPreviewSource = vi.fn().mockResolvedValue({
      url: "https://files.example/cover.png",
      expiresAt: "2999-01-01T00:00:00.000Z",
    })

    render(
      <ConversationOfficePreview
        file={file}
        loadContent={loadContent}
        loadPreviewSource={loadPreviewSource}
        onAskSelection={vi.fn()}
        onClose={vi.fn()}
      />
    )

    await waitFor(() =>
      expect(preview.generic).toContainEqual({
        kind: "image",
        status: "ready",
        hasContent: false,
        hasSource: true,
      })
    )
    expect(loadContent).not.toHaveBeenCalled()
  })

  it("does not expose a source download action when no current-page handler is available", async () => {
    const file = officeFile("video-1", "demo.mp4", "video/mp4")

    render(
      <ConversationOfficePreview
        file={file}
        loadContent={vi.fn()}
        loadPreviewSource={vi.fn().mockResolvedValue({
          url: "https://files.example/demo.mp4",
          expiresAt: "2999-01-01T00:00:00.000Z",
        })}
        onAskSelection={vi.fn()}
        onClose={vi.fn()}
      />
    )

    await waitFor(() =>
      expect(preview.generic).toContainEqual({
        kind: "video",
        status: "ready",
        hasContent: false,
        hasSource: true,
      })
    )
    expect(
      screen.queryByRole("button", { name: "download-generic" })
    ).toBeNull()
  })

  it("discards accumulated annotations when the open file changes", async () => {
    const firstFile = officeFile(
      "word-first-batch",
      "first.docx",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    )
    const secondFile = officeFile(
      "word-second-batch",
      "second.docx",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    )
    const loadContent = vi.fn().mockResolvedValue(new Uint8Array([1]))
    const onAskSelection = vi.fn()
    const view = render(
      <ConversationOfficePreview
        file={firstFile}
        loadContent={loadContent}
        onAskSelection={onAskSelection}
        onClose={vi.fn()}
      />
    )

    await enableOfficeAnnotationMode()
    await userEvent.click(
      await screen.findByRole("button", { name: "ask-word" })
    )
    expect(
      screen.getByRole("button", { name: "查看 1 条待发送标注" })
    ).toBeVisible()

    view.rerender(
      <ConversationOfficePreview
        file={secondFile}
        loadContent={loadContent}
        onAskSelection={onAskSelection}
        onClose={vi.fn()}
      />
    )

    await waitFor(() => expect(loadContent).toHaveBeenCalledTimes(2))
    expect(screen.queryByRole("button", { name: /待发送标注/u })).toBeNull()
    expect(onAskSelection).not.toHaveBeenCalled()
  })

  it("reissues a short-lived media URL when the media preview retries", async () => {
    const file = officeFile("audio-retry", "voice.mp3", "audio/mpeg")
    const loadPreviewSource = vi
      .fn()
      .mockResolvedValueOnce({
        url: "https://files.example/expired.mp3",
        expiresAt: "2000-01-01T00:00:00.000Z",
      })
      .mockResolvedValueOnce({
        url: "https://files.example/fresh.mp3",
        expiresAt: "2999-01-01T00:00:00.000Z",
      })

    render(
      <ConversationOfficePreview
        file={file}
        loadContent={vi.fn()}
        loadPreviewSource={loadPreviewSource}
        onAskSelection={vi.fn()}
        onClose={vi.fn()}
      />
    )

    await screen.findByRole("button", { name: "retry-generic" })
    expect(loadPreviewSource).toHaveBeenCalledTimes(1)

    await userEvent.click(screen.getByRole("button", { name: "retry-generic" }))
    await waitFor(() => expect(loadPreviewSource).toHaveBeenCalledTimes(2))
  })

  it("releases managed attachment object URLs when retrying and unmounting", async () => {
    const file = officeFile("audio-managed", "voice.mp3", "audio/mpeg")
    const releaseExpired = vi.fn()
    const releaseFresh = vi.fn()
    const loadPreviewSource = vi
      .fn()
      .mockResolvedValueOnce({
        url: "blob:attachment-expired",
        expiresAt: "9999-12-31T23:59:59.999Z",
        release: releaseExpired,
      })
      .mockResolvedValueOnce({
        url: "blob:attachment-fresh",
        expiresAt: "9999-12-31T23:59:59.999Z",
        release: releaseFresh,
      })

    const { unmount } = render(
      <ConversationOfficePreview
        file={file}
        loadContent={vi.fn()}
        loadPreviewSource={loadPreviewSource}
        onClose={vi.fn()}
      />
    )

    await screen.findByRole("button", { name: "retry-generic" })
    await userEvent.click(screen.getByRole("button", { name: "retry-generic" }))

    await waitFor(() => expect(loadPreviewSource).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(releaseExpired).toHaveBeenCalledOnce())
    expect(releaseFresh).not.toHaveBeenCalled()

    unmount()
    expect(releaseFresh).toHaveBeenCalledOnce()
  })
})
