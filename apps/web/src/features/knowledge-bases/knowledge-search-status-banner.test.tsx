import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import { KnowledgeSearchStatusBanner } from "@/features/knowledge-bases/knowledge-search-status-banner"
import i18n from "@/i18n"

afterEach(() => cleanup())

describe("knowledge search status banner", () => {
  it.each([
    {
      language: "zh-CN",
      title: "知识库检索暂不可用",
      description:
        "当前无法使用知识库检索。你仍可继续使用插件、Skill、附件并正常提交任务，请稍后重试。",
    },
    {
      language: "en-US",
      title: "Knowledge search is unavailable",
      description:
        "Knowledge search cannot be used right now. You can still use plugins, Skills, attachments, and submit tasks normally. Try again later.",
    },
  ])("renders the stable generic warning in $language", async (example) => {
    await i18n.changeLanguage(example.language)
    render(
      <KnowledgeSearchStatusBanner
        capability={{
          status: "unavailable",
          reason_code: "KNOWLEDGE_SEARCH_UNAVAILABLE",
          checked_at: "2026-07-22T08:00:00.000Z",
        }}
      />
    )

    expect(screen.getByText(example.title)).toBeVisible()
    expect(screen.getByText(example.description)).toBeVisible()
    expect(document.body).not.toHaveTextContent("private-model")
    expect(document.body).not.toHaveTextContent("/v1/embeddings")
  })

  it("does not render a banner while search is available", () => {
    const { container } = render(
      <KnowledgeSearchStatusBanner
        capability={{
          status: "available",
          reason_code: null,
          checked_at: "2026-07-22T08:00:00.000Z",
        }}
      />
    )
    expect(container).toBeEmptyDOMElement()
  })

  it.each([
    {
      language: "zh-CN",
      title: "Core 版不包含知识库",
      description:
        "当前安装的是 LinkSense Core。如需文档解析和知识库检索，请安装完整版。",
    },
    {
      language: "en-US",
      title: "Knowledge bases are not included in Core",
      description:
        "This installation uses LinkSense Core. Install the Full edition to add document parsing and knowledge search.",
    },
  ])("explains the Core edition boundary in $language", async (example) => {
    await i18n.changeLanguage(example.language)
    render(
      <KnowledgeSearchStatusBanner
        capability={{
          status: "not_installed",
          reason_code: "KNOWLEDGE_NOT_INSTALLED",
          checked_at: "2026-07-22T08:00:00.000Z",
        }}
      />
    )

    expect(screen.getByText(example.title)).toBeVisible()
    expect(screen.getByText(example.description)).toBeVisible()
  })

  it("allows pages to add layout spacing without changing the banner content", async () => {
    await i18n.changeLanguage("zh-CN")
    render(
      <KnowledgeSearchStatusBanner
        capability={{
          status: "unavailable",
          reason_code: "KNOWLEDGE_SEARCH_UNAVAILABLE",
          checked_at: "2026-07-22T08:00:00.000Z",
        }}
        className="mt-3"
      />
    )

    expect(screen.getByRole("status")).toHaveClass("mt-3")
    expect(screen.getByText("知识库检索暂不可用")).toBeVisible()
  })

  it("renders a safe actionable warning for an index mismatch", async () => {
    await i18n.changeLanguage("zh-CN")
    render(
      <KnowledgeSearchStatusBanner
        capability={{
          status: "unavailable",
          reason_code: "EMBEDDING_DIMENSION_MISMATCH",
          checked_at: "2026-07-22T08:00:00.000Z",
        }}
      />
    )

    expect(
      screen.getByText(
        "知识库索引与当前部署配置不一致，需要管理员核对配置并手动执行全量重建。"
      )
    ).toBeVisible()
    expect(document.body).not.toHaveTextContent("private-model")
    expect(document.body).not.toHaveTextContent("api_key")
  })
})
