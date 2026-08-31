import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { AssistantHtmlPreviewLoading } from "@/features/conversations/assistant-html-preview-loading"

describe("AssistantHtmlPreviewLoading", () => {
  it("renders the interactive-generation dot canvas with accessible status", () => {
    const { container } = render(
      <AssistantHtmlPreviewLoading label="正在生成交互式内容" />
    )

    const status = screen.getByRole("status", {
      name: "正在生成交互式内容",
    })
    expect(status).toHaveAttribute("aria-busy", "true")
    expect(status).toHaveAttribute("aria-live", "polite")
    const canvas = container.querySelector(
      ".assistant-html-preview-loading-canvas"
    )
    expect(canvas).toHaveAttribute("aria-hidden", "true")
    expect(canvas).toBeVisible()
    expect(status).toHaveClass("w-full")
    expect(status).not.toHaveTextContent(/.+/u)
    expect(
      container.querySelector(".assistant-html-preview-loading-dots")
    ).toBeVisible()
    expect(
      container.querySelector(".assistant-html-preview-loading-glow")
    ).toBeVisible()
    expect(
      container.querySelector(".assistant-html-preview-loading-meta")
    ).toBeNull()
  })
})
