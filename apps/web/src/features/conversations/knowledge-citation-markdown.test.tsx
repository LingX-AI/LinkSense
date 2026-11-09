import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  supportedLocales,
  type PublicKnowledgeCitation,
} from "@linksense/shared"
import {
  AssistantMarkdown,
  ConversationContentPolicyProvider,
} from "@/features/conversations/conversation-thread"
import { getKnowledgeSourceAnchorId } from "./knowledge-citation-markdown"
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
    async (suffix) => {
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
        await within(group).findByRole("img", { name: "登录示意图" })
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

  it("groups multiple citations with only the last image in a sequence", async () => {
    const content = `![第一张图](https://example.test/first.png)\n${image}`
    const { container } = render(
      <MemoryRouter>
        <AssistantMarkdown
          content={content}
          citations={[citation(1, content.length), citation(2, content.length)]}
        />
      </MemoryRouter>
    )
    await screen.findByRole("img", { name: "登录示意图" })
    const group = container.querySelector("[data-image-citations]")
    expect(group?.querySelectorAll(".knowledge-citation-link")).toHaveLength(2)
    expect(group?.querySelectorAll("img")).toHaveLength(1)
    expect(
      screen
        .getByRole("img", { name: "第一张图" })
        .closest("[data-image-citations]")
    ).toBeNull()
  })

  it("preserves text citations and uncited images without image grouping", async () => {
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
    expect(await screen.findByRole("img")).toBeVisible()
  })
})

describe("text citation policy in the shared chat renderer", () => {
  afterEach(cleanup)
  const turnId = "public-turn"
  const sourcesByTurn = new Map([
    [
      turnId,
      [
        {
          number: 1,
          title: "Password guide.pdf",
          href: `#${getKnowledgeSourceAnchorId(turnId, 1)}`,
        },
      ],
    ],
    [
      "other-turn",
      [{ number: 1, title: "Other guide.pdf", href: "#other-source" }],
    ],
  ])
  function reply(
    content: string,
    visible: boolean,
    streaming = false,
    sourceTurn = turnId
  ) {
    return (
      <ConversationContentPolicyProvider
        textOnly
        textCitations={{ visible, sourcesByTurn }}
      >
        <AssistantMarkdown
          content={content}
          streaming={streaming}
          knowledgeAssetScope={{
            conversationId: "public-conversation",
            turnId: sourceTurn,
          }}
        />
      </ConversationContentPolicyProvider>
    )
  }

  it.each(supportedLocales)(
    "uses the regular citation badge styles and accessible label in %s",
    async (locale) => {
      await i18n.changeLanguage(locale)
      const { container } = render(reply("Open your account.[1]", true))
      const marker = screen.getByRole("link", {
        name: i18n.t("conversation.openKnowledgeCitation", { number: 1 }),
      })
      expect(marker).toHaveClass("knowledge-citation-link")
      expect(marker.closest(".knowledge-citation-inline")).not.toBeNull()
      expect(marker).toHaveTextContent(/^1$/u)
      expect(marker).toHaveAttribute("title", "Password guide.pdf")
      expect(marker).toHaveAttribute(
        "href",
        `#${getKnowledgeSourceAnchorId(turnId, 1)}`
      )
      expect(container).not.toHaveTextContent("[1]")
    }
  )

  it.each([false, true])(
    "hides references in paragraphs, lists, emphasis and tables while preserving code and external links when streaming=%s",
    (streaming) => {
      const { container } = render(
        reply(
          [
            "Answer.[1][2] **Details.[1]**",
            "",
            "- Step.[1, 2]",
            "",
            "| Field | Value |",
            "| --- | --- |",
            "| Account | Name.[1] |",
            "",
            "`array[1]` and [1](https://example.test/docs).",
            "",
            "```js",
            "array[1]",
            "```",
          ].join("\n"),
          false,
          streaming
        )
      )
      expect(
        container.querySelectorAll(".knowledge-citation-inline")
      ).toHaveLength(0)
      expect(
        screen.getByText("Answer.", { exact: false }).closest("p")
      ).not.toHaveTextContent("[1]")
      expect(screen.getByText("Details.", { selector: "strong" })).toBeVisible()
      expect(screen.getByText("Step.", { selector: "li" })).toBeVisible()
      expect(screen.getByRole("cell", { name: "Name." })).toBeVisible()
      expect(
        screen.getAllByText("array[1]", { selector: "code" })
      ).toHaveLength(2)
      expect(screen.getByRole("link", { name: "1" })).toHaveAttribute(
        "href",
        "https://example.test/docs"
      )
    }
  )

  it("does not flash an incomplete reference while streaming and updates existing messages when visibility changes", () => {
    const view = render(reply("Answer.[", false, true))
    expect(view.container).toHaveTextContent("Answer.")
    expect(view.container).not.toHaveTextContent("[")
    view.rerender(reply("Answer.[1", false, true))
    expect(view.container).not.toHaveTextContent("[1")
    view.rerender(reply("Answer.[1]", false, true))
    expect(view.container).toHaveTextContent(/^Answer\.$/u)
    view.rerender(reply("Answer.[1]", true))
    expect(
      view.container.querySelector(".knowledge-citation-link")
    ).toHaveTextContent("1")
    view.rerender(reply("Answer.[1]", false))
    expect(view.container).toHaveTextContent(/^Answer\.$/u)
    expect(view.container.querySelector(".knowledge-citation-link")).toBeNull()
  })

  it("resolves citations only within the current turn and removes unknown markers", () => {
    const view = render(reply("Answer.[1][99]", true, false, "other-turn"))
    expect(screen.getByRole("link")).toHaveAttribute("title", "Other guide.pdf")
    expect(screen.getByRole("link")).toHaveAttribute("href", "#other-source")
    expect(view.container).not.toHaveTextContent("[99]")
    view.rerender(reply("Answer.[1]", false, false, "missing-turn"))
    expect(view.container).toHaveTextContent(/^Answer\.$/u)
  })

  it("leaves regular chat numeric text unchanged when no text citation policy is provided", () => {
    const { container } = render(
      <AssistantMarkdown content="Keep [1] and [99]." />
    )
    expect(container).toHaveTextContent("Keep [1] and [99].")
    expect(container.querySelector(".knowledge-citation-link")).toBeNull()
  })
})
