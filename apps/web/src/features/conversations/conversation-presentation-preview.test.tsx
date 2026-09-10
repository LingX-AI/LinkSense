import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ReactNode } from "react"

import type { ConversationFile } from "@/api/contracts"
import { ConversationPresentationPreview } from "@/features/conversations/conversation-presentation-preview"
import i18n from "@/i18n"

const preview = vi.hoisted(() => ({
  documents: [] as Array<{ status: string; content?: Uint8Array }>,
  selectionActions: [] as Array<{
    promptLabel: string
    placeholder: string
    submitLabel: string
    errorMessage: string
  }>,
}))

vi.mock("@/components/media/presentation-preview/presentation-preview", () => ({
  default: (props: {
    document: { status: string; content?: Uint8Array }
    selectionAction?: {
      promptLabel: string
      placeholder: string
      submitLabel: string
      errorMessage: string
      onSubmit: (
        selection: {
          slideIndex: number
          slideNumber: number
          elementIds: string[]
          elements: Array<{ elementId: string; type: string; bounds: object }>
        },
        description: string
      ) => Promise<void>
    }
    onRetry?: () => void
    annotationControls?: ReactNode
    floatingContent?: ReactNode
  }) => {
    preview.documents.push(props.document)
    if (props.selectionAction) {
      preview.selectionActions.push(props.selectionAction)
    }
    return (
      <>
        <div data-testid="mock-presentation-preview">
          <span>{props.document.status}</span>
          {props.annotationControls}
          <button
            type="button"
            onClick={() => {
              if (!props.selectionAction) return
              void props.selectionAction.onSubmit(
                {
                  slideIndex: 1,
                  slideNumber: 2,
                  elementIds: ["shape-1"],
                  elements: [
                    {
                      elementId: "shape-1",
                      type: "text",
                      bounds: {},
                    },
                  ],
                },
                "改为英文"
              )
            }}
          >
            ask-selection
          </button>
          <button type="button" onClick={props.onRetry}>
            retry-load
          </button>
        </div>
        {props.floatingContent}
      </>
    )
  },
}))

const file: ConversationFile = {
  id: "presentation-1",
  name: "ai-introduction.pptx",
  mime_type:
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  size: 1024,
  kind: "artifact",
  created_at: "2026-07-14T00:00:00.000Z",
  download_available: true,
}

describe("conversation presentation preview", () => {
  beforeEach(async () => {
    preview.documents = []
    preview.selectionActions = []
    await i18n.changeLanguage("zh-CN")
  })

  afterEach(() => cleanup())

  it("loads bytes on demand and forwards the selection description with the file", async () => {
    const content = new Uint8Array([1, 2, 3])
    const loadContent = vi
      .fn<
        (file: ConversationFile, signal: AbortSignal) => Promise<Uint8Array>
      >()
      .mockResolvedValue(content)
    const onAskSelection = vi.fn().mockResolvedValue(undefined)

    render(
      <ConversationPresentationPreview
        file={file}
        loadContent={loadContent}
        onAskSelection={onAskSelection}
        onClose={vi.fn()}
      />
    )

    expect(await screen.findByTestId("mock-presentation-preview")).toBeVisible()
    await waitFor(() => expect(screen.getByText("ready")).toBeVisible())
    expect(loadContent).toHaveBeenCalledOnce()
    expect(loadContent.mock.calls[0]?.[0]).toBe(file)
    expect(loadContent.mock.calls[0]?.[1]).toBeInstanceOf(AbortSignal)
    await userEvent.click(
      screen.getByRole("button", { name: "进入文件标注模式" })
    )
    expect(preview.selectionActions.at(-1)).toMatchObject({
      promptLabel: "针对所选元素询问 LinkSense",
      placeholder: "描述要修改的内容或提出问题",
      submitLabel: "添加标注",
      errorMessage: "添加标注失败，请重试。",
    })

    await userEvent.click(screen.getByRole("button", { name: "ask-selection" }))
    expect(onAskSelection).not.toHaveBeenCalled()
    await userEvent.click(
      screen.getByRole("button", { name: "查看 1 条待发送标注" })
    )
    await userEvent.click(
      await screen.findByRole("button", { name: "发送" })
    )
    expect(onAskSelection).toHaveBeenCalledWith(file, [
      {
        selection: expect.objectContaining({
          slideNumber: 2,
          elementIds: ["shape-1"],
        }),
        description: "改为英文",
      },
    ])
  })

  it("passes the localized English labels to the selection prompt", async () => {
    await i18n.changeLanguage("en-US")

    render(
      <ConversationPresentationPreview
        file={file}
        loadContent={vi.fn().mockResolvedValue(new Uint8Array([1]))}
        onAskSelection={vi.fn().mockResolvedValue(undefined)}
        onClose={vi.fn()}
      />
    )

    await waitFor(() => expect(screen.getByText("ready")).toBeVisible())
    await userEvent.click(
      screen.getByRole("button", { name: "Enter file annotation mode" })
    )
    expect(preview.selectionActions.at(-1)).toMatchObject({
      promptLabel: "Ask LinkSense about the selected elements",
      placeholder: "Describe a change or ask a question",
      submitLabel: "Add annotation",
      errorMessage: "Unable to add the annotation. Try again.",
    })
  })

  it("shows an error for empty content and retries with a fresh request", async () => {
    const loadContent = vi
      .fn<
        (file: ConversationFile, signal: AbortSignal) => Promise<Uint8Array>
      >()
      .mockResolvedValueOnce(new Uint8Array())
      .mockResolvedValueOnce(new Uint8Array([9]))

    render(
      <ConversationPresentationPreview
        file={file}
        loadContent={loadContent}
        onAskSelection={vi.fn()}
        onClose={vi.fn()}
      />
    )

    await waitFor(() => expect(screen.getByText("error")).toBeVisible())
    await userEvent.click(screen.getByRole("button", { name: "retry-load" }))
    await waitFor(() => expect(screen.getByText("ready")).toBeVisible())
    expect(loadContent).toHaveBeenCalledTimes(2)
  })

  it("aborts an in-flight content request when the pane closes", async () => {
    let signal: AbortSignal | undefined
    const loadContent = vi.fn(
      (_file: ConversationFile, currentSignal: AbortSignal) => {
        signal = currentSignal
        return new Promise<Uint8Array>(() => undefined)
      }
    )
    const { unmount } = render(
      <ConversationPresentationPreview
        file={file}
        loadContent={loadContent}
        onAskSelection={vi.fn()}
        onClose={vi.fn()}
      />
    )

    await waitFor(() => expect(loadContent).toHaveBeenCalledOnce())
    expect(signal?.aborted).toBe(false)
    unmount()
    expect(signal?.aborted).toBe(true)
  })
})
