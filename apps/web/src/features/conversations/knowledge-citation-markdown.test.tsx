import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { PublicKnowledgeCitation } from "@linksense/shared"
import { AssistantMarkdown } from "@/features/conversations/conversation-thread"
import i18n from "@/i18n"

const image = "![登录示意图](https://example.test/login.png)"

function citation(number: number, offset: number): PublicKnowledgeCitation {
  return {
    citation_id: `10000000-0000-4000-8000-${String(number).padStart(12, "0")}`,
    citation_no: number,
    summary: {
      knowledge_base_name: "操作指南",
      document_name: "登录指南.pdf",
      title_path: [],
      page_numbers: [1],
    },
    anchors: [{ occurrence_no: number, after_offset_utf16: offset }],
  }
}

describe("knowledge citations beside Markdown images", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("zh-CN")
  })
  afterEach(cleanup)

  it.each(["", "\n\n下一步", "\n\n![第二张图](https://example.test/next.png)"])(
    "keeps the image and citation together before %j without changing preview actions",
    (suffix) => {
      const onPreviewImage = vi.fn()
      render(
        <MemoryRouter>
          <AssistantMarkdown
            content={image + suffix}
            citations={[citation(1, image.length)]}
            onPreviewImage={onPreviewImage}
          />
        </MemoryRouter>
      )

      const link = screen.getByRole("link", { name: "打开知识库引用 1" })
      const group = link.closest("[data-image-citations]")
      expect(group).toHaveClass("inline-flex", "items-end", "max-w-full")
      if (!(group instanceof HTMLElement))
        throw new Error("Missing image group")
      expect(
        within(group).getByRole("img", { name: "登录示意图" })
      ).toBeVisible()
      expect(link).toHaveAttribute(
        "href",
        "/knowledge-citations/10000000-0000-4000-8000-000000000001"
      )
      expect(link.closest("button")).toBeNull()
      fireEvent.click(within(group).getByRole("button"))
      expect(onPreviewImage).toHaveBeenCalledWith(
        expect.objectContaining({ src: "https://example.test/login.png" })
      )
      fireEvent.error(within(group).getByRole("img"))
      expect(within(group).getByRole("link")).toBe(link)
    }
  )

  it("groups multiple citations with only the last image in a sequence", () => {
    const content = `![第一张图](https://example.test/first.png)\n${image}`
    const { container } = render(
      <MemoryRouter>
        <AssistantMarkdown
          content={content}
          citations={[citation(1, content.length), citation(2, content.length)]}
        />
      </MemoryRouter>
    )
    const group = container.querySelector("[data-image-citations]")
    expect(group?.querySelectorAll(".knowledge-citation-link")).toHaveLength(2)
    expect(group?.querySelectorAll("img")).toHaveLength(1)
    expect(
      screen
        .getByRole("img", { name: "第一张图" })
        .closest("[data-image-citations]")
    ).toBeNull()
  })

  it("preserves text citations and uncited images without image grouping", () => {
    const content = `说明文字。\n\n${image}`
    const { container } = render(
      <MemoryRouter>
        <AssistantMarkdown content={content} citations={[citation(1, 5)]} />
      </MemoryRouter>
    )
    expect(container.querySelector("[data-image-citations]")).toBeNull()
    expect(screen.getByRole("link").closest("p")).toHaveTextContent(
      "说明文字。1"
    )
    expect(screen.getByRole("img")).toBeVisible()
  })
})
