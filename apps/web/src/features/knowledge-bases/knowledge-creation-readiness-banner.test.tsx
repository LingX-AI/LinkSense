import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { KnowledgeCreationReadinessBanner } from "@/features/knowledge-bases/knowledge-creation-readiness-banner"
import i18n from "@/i18n"

afterEach(() => cleanup())

describe("knowledge creation readiness banner", () => {
  it.each([
    {
      language: "zh-CN",
      title: "暂时无法创建知识库",
      storage: "文件存储服务暂不可用",
      embedding: "管理员尚未配置嵌入模型",
      retry: "重新检测",
    },
    {
      language: "en-US",
      title: "A knowledge base cannot be created yet",
      storage: "File storage is temporarily unavailable",
      embedding: "An administrator has not configured an embedding model",
      retry: "Check again",
    },
  ])("shows safe unmet requirements in $language", async (example) => {
    await i18n.changeLanguage(example.language)
    render(
      <KnowledgeCreationReadinessBanner
        capability={{
          status: "unready",
          checks: {
            object_storage: "unavailable",
            document_parsing: "available",
            embedding_model: "not_configured",
            search_and_indexing: "available",
          },
          checked_at: "2026-08-31T08:00:00.000Z",
        }}
        checking={false}
        requestFailed={false}
        onRetry={vi.fn()}
      />
    )

    expect(screen.getByText(example.title)).toBeVisible()
    expect(screen.getByText(example.storage)).toBeVisible()
    expect(screen.getByText(example.embedding)).toBeVisible()
    expect(screen.getByRole("button", { name: example.retry })).toBeEnabled()
    expect(document.body).not.toHaveTextContent("private-model")
  })

  it("does not render after all requirements are ready", () => {
    const { container } = render(
      <KnowledgeCreationReadinessBanner
        capability={{
          status: "ready",
          checks: {
            object_storage: "available",
            document_parsing: "available",
            embedding_model: "available",
            search_and_indexing: "available",
          },
          checked_at: "2026-08-31T08:00:00.000Z",
        }}
        checking={false}
        requestFailed={false}
        onRetry={vi.fn()}
      />
    )

    expect(container).toBeEmptyDOMElement()
  })
})
