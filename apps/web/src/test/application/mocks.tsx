import type { ReactNode } from "react"
import { vi } from "vitest"

vi.mock(
  "@/components/media/presentation-preview/presentation-preview",
  async () => {
    const React = await import("react")

    function MockPresentationPreview({
      document,
      annotationControls,
      selectionAction,
      onDownload,
      floatingContent,
    }: Readonly<{
      document: { status: "loading" | "error" | "ready" }
      annotationControls?: ReactNode
      onDownload?: () => void
      floatingContent?: ReactNode
      selectionAction?: {
        label: string
        promptLabel: string
        placeholder: string
        submitLabel: string
        onSubmit: (
          selection: {
            slideIndex: number
            slideNumber: number
            elementIds: string[]
            elements: Array<{
              elementId: string
              type: string
              text: string
              bounds: {
                x: number
                y: number
                width: number
                height: number
              }
            }>
          },
          description: string
        ) => Promise<void>
      }
    }>) {
      const [promptOpen, setPromptOpen] = React.useState(false)
      const [description, setDescription] = React.useState("")
      if (document.status !== "ready") {
        return React.createElement("div", null, document.status)
      }
      return React.createElement(
        React.Fragment,
        null,
        annotationControls,
        selectionAction
          ? React.createElement(
              "button",
              {
                type: "button",
                onClick: () => setPromptOpen(true),
              },
              selectionAction.label
            )
          : React.createElement("span", null, "模拟选中"),
        onDownload
          ? React.createElement(
              "button",
              {
                type: "button",
                onClick: onDownload,
              },
              "下载预览文档"
            )
          : null,
        promptOpen && selectionAction
          ? React.createElement(
              "form",
              {
                "aria-label": selectionAction.promptLabel,
                onSubmit: (event: React.FormEvent) => {
                  event.preventDefault()
                  const nextDescription = description.trim()
                  if (!nextDescription) return
                  setPromptOpen(false)
                  void selectionAction
                    .onSubmit(
                      {
                        slideIndex: 2,
                        slideNumber: 3,
                        elementIds: ["title-1"],
                        elements: [
                          {
                            elementId: "title-1",
                            type: "text",
                            text: "人工智能连接数据、算法与人类目标",
                            bounds: {
                              x: 120,
                              y: 80,
                              width: 520,
                              height: 90,
                            },
                          },
                        ],
                      },
                      nextDescription
                    )
                    .catch(() => {
                      setDescription(nextDescription)
                      setPromptOpen(true)
                    })
                },
              },
              React.createElement("input", {
                "aria-label": selectionAction.promptLabel,
                placeholder: selectionAction.placeholder,
                value: description,
                onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
                  setDescription(event.target.value),
              }),
              React.createElement(
                "button",
                {
                  type: "submit",
                  disabled: description.trim().length === 0,
                },
                selectionAction.submitLabel
              )
            )
          : null,
        floatingContent
      )
    }

    return {
      default: MockPresentationPreview,
      PresentationPreview: MockPresentationPreview,
    }
  }
)
