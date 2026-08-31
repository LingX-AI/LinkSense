import { cleanup, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import i18n from "@/i18n"

const apiMocks = vi.hoisted(() => ({
  loadKnowledgeDocumentAsset: vi.fn(),
}))

vi.mock("@/features/knowledge-bases/knowledge-base-api", () => ({
  loadKnowledgeDocumentAsset: apiMocks.loadKnowledgeDocumentAsset,
}))

import {
  KnowledgeCitationExcerpt,
  KnowledgeMarkdown,
} from "@/features/knowledge-bases/knowledge-markdown"

describe("knowledge Markdown", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("zh-CN")
    apiMocks.loadKnowledgeDocumentAsset.mockReset()
    apiMocks.loadKnowledgeDocumentAsset.mockResolvedValue(
      new Blob(["safe-image"], { type: "image/png" })
    )
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn(() => "blob:safe-asset"),
      revokeObjectURL: vi.fn(),
    })
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it("loads only authenticated kb assets and strips unsafe content", async () => {
    const { container } = render(
      <KnowledgeMarkdown
        knowledgeBaseId="knowledge-1"
        documentId="document-1"
        documentVersionId="version-1"
        markdown={`<!-- linksense:page=1 -->
[safe](https://example.test/path)
[unsafe](javascript:alert(1))
![remote](https://images.example.test/remote.png)
![diagram](kb-asset://asset_1)
<script>alert("script")</script>
<table><tbody><tr><td rowspan="2" onclick="alert(1)">Merged</td></tr></tbody></table>`}
      />
    )

    const safeLink = screen.getByRole("link", { name: "safe" })
    expect(safeLink).toHaveAttribute("target", "_blank")
    expect(safeLink).toHaveAttribute("rel", "noopener noreferrer")
    expect(screen.getByText("unsafe").closest("a")).toBeNull()
    expect(container.textContent).not.toContain("linksense:page")
    expect(container.textContent).not.toContain('alert("script")')
    expect(container.querySelector("script")).toBeNull()
    expect(screen.getByText("Merged").closest("td")).toHaveAttribute(
      "rowspan",
      "2"
    )
    expect(screen.getByText("Merged").closest("td")).not.toHaveAttribute(
      "onclick"
    )

    await waitFor(() =>
      expect(apiMocks.loadKnowledgeDocumentAsset).toHaveBeenCalledWith(
        "knowledge-1",
        "document-1",
        "version-1",
        "asset_1",
        expect.any(AbortSignal)
      )
    )
    expect(apiMocks.loadKnowledgeDocumentAsset).toHaveBeenCalledTimes(1)
    expect(await screen.findByRole("img", { name: "diagram" })).toHaveAttribute(
      "src",
      "blob:safe-asset"
    )
    expect(screen.getByRole("img", { name: "remote" })).toHaveAttribute(
      "src",
      "https://images.example.test/remote.png"
    )
    expect(screen.getByRole("img", { name: "remote" })).toHaveAttribute(
      "referrerpolicy",
      "no-referrer"
    )
  })

  it.each([
    {
      language: "zh-CN",
      label: "文档图片“diagram”暂不可用",
    },
    {
      language: "en-US",
      label: "Document image “diagram” is unavailable",
    },
  ])(
    "renders a localized accessible asset placeholder in $language",
    async ({ language, label }) => {
      await i18n.changeLanguage(language)
      apiMocks.loadKnowledgeDocumentAsset.mockRejectedValue(
        new Error("private storage error")
      )

      render(
        <KnowledgeMarkdown
          knowledgeBaseId="knowledge-1"
          documentId="document-1"
          documentVersionId="version-1"
          markdown="![diagram](kb-asset://asset_1)"
        />
      )

      const placeholder = await screen.findByRole("img", { name: label })
      expect(placeholder).toHaveClass("knowledge-markdown-asset-state")
      expect(placeholder).toHaveTextContent(label)
      expect(placeholder).not.toHaveTextContent("private storage error")
    }
  )

  it("renders only the server-projected parent excerpt and strips unsafe content", () => {
    const { container } = render(
      <KnowledgeCitationExcerpt
        excerpt={`## 保修期限

整机保修一年。

[safe](https://example.test/policy)
[unsafe](javascript:alert(1))
![private asset](kb-asset://asset_1)
<script>alert("script")</script>`}
      />
    )

    expect(screen.getByRole("heading", { name: "保修期限" })).toBeVisible()
    expect(screen.getByText("整机保修一年。")).toBeVisible()
    expect(screen.getByRole("link", { name: "safe" })).toHaveAttribute(
      "target",
      "_blank"
    )
    expect(screen.getByText("unsafe").closest("a")).toBeNull()
    expect(screen.getByText("private asset").closest("img")).toBeNull()
    expect(container.querySelector("script")).toBeNull()
    expect(container.textContent).not.toContain('alert("script")')
    expect(apiMocks.loadKnowledgeDocumentAsset).not.toHaveBeenCalled()
  })
})
