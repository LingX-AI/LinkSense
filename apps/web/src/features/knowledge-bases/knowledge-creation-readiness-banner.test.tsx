import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { KnowledgeCreationReadinessBanner } from "@/features/knowledge-bases/knowledge-creation-readiness-banner"
import i18n from "@/i18n"

afterEach(() => cleanup())

describe("knowledge creation readiness banner", () => {
  it.each(["zh-CN", "en-US"])(
    "silently checks initial and healthy states in %s",
    async (language) => {
      await i18n.changeLanguage(language)
      const props = { checking: true, requestFailed: false, onRetry: vi.fn() }
      const { container, rerender } = render(
        <KnowledgeCreationReadinessBanner {...props} capability={undefined} />
      )
      expect(container).toBeEmptyDOMElement()
      rerender(
        <KnowledgeCreationReadinessBanner
          {...props}
          checking={false}
          capability={undefined}
        />
      )
      expect(container).toBeEmptyDOMElement()
      rerender(
        <KnowledgeCreationReadinessBanner
          {...props}
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
        />
      )
      expect(container).toBeEmptyDOMElement()
    }
  )

  it.each(["zh-CN", "en-US"])(
    "keeps confirmed issues visible while silently rechecking in %s",
    async (language) => {
      await i18n.changeLanguage(language)
      const props = {
        capability: {
          status: "unready" as const,
          checks: {
            object_storage: "unavailable" as const,
            document_parsing: "available" as const,
            embedding_model: "available" as const,
            search_and_indexing: "available" as const,
          },
          checked_at: "2026-08-31T08:00:00.000Z",
        },
        checking: false,
        requestFailed: false,
        onRetry: vi.fn(),
      }
      const { container, rerender } = render(
        <KnowledgeCreationReadinessBanner {...props} />
      )
      const retryLabel = i18n.t("knowledge.creationCapability.retry")
      fireEvent.click(screen.getByRole("button", { name: retryLabel }))
      expect(props.onRetry).toHaveBeenCalledOnce()
      rerender(<KnowledgeCreationReadinessBanner {...props} checking />)
      expect(
        screen.getByText(i18n.t("knowledge.creationCapability.unreadyTitle"))
      ).toBeVisible()
      expect(
        screen.getByText(
          i18n.t("knowledge.creationCapability.checks.objectStorageUnavailable")
        )
      ).toBeVisible()
      expect(screen.getByRole("button", { name: retryLabel })).toBeDisabled()
      expect(container.querySelector('[data-slot="spinner"]')).toBeNull()
      rerender(
        <KnowledgeCreationReadinessBanner
          {...props}
          capability={{
            ...props.capability,
            status: "ready",
            checks: { ...props.capability.checks, object_storage: "available" },
          }}
        />
      )
      expect(container).toBeEmptyDOMElement()
    }
  )

  it.each(["zh-CN", "en-US"])(
    "shows failed checks and unavailable editions in %s",
    async (language) => {
      await i18n.changeLanguage(language)
      const props = {
        capability: undefined,
        checking: false,
        requestFailed: true,
        onRetry: vi.fn(),
      }
      const { rerender } = render(
        <KnowledgeCreationReadinessBanner {...props} />
      )
      expect(
        screen.getByText(
          i18n.t("knowledge.creationCapability.requestFailedTitle")
        )
      ).toBeVisible()
      expect(
        screen.getByRole("button", {
          name: i18n.t("knowledge.creationCapability.retry"),
        })
      ).toBeEnabled()
      rerender(
        <KnowledgeCreationReadinessBanner
          {...props}
          requestFailed={false}
          capability={{
            status: "not_installed",
            checks: null,
            checked_at: "2026-08-31T08:00:00.000Z",
          }}
        />
      )
      expect(
        screen.getByText(
          i18n.t("knowledge.creationCapability.notInstalledTitle")
        )
      ).toBeVisible()
      expect(screen.queryByRole("button")).not.toBeInTheDocument()
    }
  )

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
