import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import type { FileViewerProps } from "@file-viewer/react"

import { setAccessToken } from "@/api/session"
import { knowledgeBaseQueryKeys } from "@/features/knowledge-bases/knowledge-base-api"
import i18n from "@/i18n"

const downloadBlob = vi.hoisted(() => vi.fn())
const fileViewerProps = vi.hoisted(() =>
  vi.fn<(props: FileViewerProps) => void>()
)

vi.mock("@/lib/download-blob", () => ({ downloadBlob }))
vi.mock("@/app/theme-state", () => ({
  useTheme: () => ({ theme: "light" }),
}))
vi.mock("virtual:file-viewer-renderers", () => ({
  configuredFileViewerRenderers: [],
}))
vi.mock("@file-viewer/react", () => ({
  default: (props: FileViewerProps) => {
    fileViewerProps(props)
    return <div aria-label={props["aria-label"]}>{props.filename}</div>
  },
}))

import { KnowledgeCitationPage } from "@/pages/knowledge-citation-page"

const citationId = "10000000-0000-4000-8000-000000000001"
const privateKnowledgeBaseId = "20000000-0000-4000-8000-000000000001"
const privateDocumentId = "30000000-0000-4000-8000-000000000001"
const privateDocumentVersionId = "40000000-0000-4000-8000-000000000001"

function envelope(data: unknown) {
  return new Response(JSON.stringify({ success: true, data }), {
    status: 200,
    headers: { "content-type": "application/json" },
  })
}

function pendingCitationEvents() {
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(": keepalive\n\n"))
      },
    }),
    {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    }
  )
}

function controlledCitationEvents() {
  let emitSourceChanged!: () => void
  const response = new Response(
    new ReadableStream({
      start(controller) {
        emitSourceChanged = () => {
          controller.enqueue(
            new TextEncoder().encode(
              `event: knowledge_citation_source_changed\ndata: {"type":"knowledge_citation_source_changed"}\n\n`
            )
          )
        }
      },
    }),
    {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    }
  )
  return { response, emitSourceChanged }
}

describe("knowledge citation preview", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("zh-CN")
    setAccessToken("knowledge-preview-token")
    downloadBlob.mockReset()
    fileViewerProps.mockReset()
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it("renders only the parent excerpt with an exact page citation and downloads the original", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith("/api/v1/knowledge-bases/search-capability")) {
        return Promise.resolve(
          envelope({
            status: "available",
            reason_code: null,
            checked_at: "2026-07-22T08:00:00.000Z",
          })
        )
      }
      if (url.endsWith(`/api/v1/knowledge-citations/${citationId}/events`)) {
        return Promise.resolve(pendingCitationEvents())
      }
      if (url.endsWith(`/api/v1/knowledge-citations/${citationId}/download`)) {
        return Promise.resolve(
          new Response(new Blob(["tiff"], { type: "image/tiff" }), {
            status: 200,
          })
        )
      }
      if (url.endsWith(`/api/v1/knowledge-citations/${citationId}/original`)) {
        return Promise.resolve(
          new Response(new Blob(["tiff"], { type: "image/tiff" }), {
            status: 200,
          })
        )
      }
      if (url.endsWith(`/api/v1/knowledge-citations/${citationId}`)) {
        return Promise.resolve(
          envelope({
            status: "available",
            citation_id: citationId,
            citation_no: 1,
            summary: {
              knowledge_base_name: "售后知识库",
              document_name: "扫描件.tiff",
              title_path: ["售后政策", "保修期限"],
              page_numbers: [2],
            },
            parent_excerpt: "# 保修期限\n\n整机保修一年。",
            original: { supported: true, renderer: "file" },
          })
        )
      }
      return Promise.resolve(new Response(null, { status: 404 }))
    })
    vi.stubGlobal("fetch", fetchMock)
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })

    render(
      <MemoryRouter initialEntries={[`/knowledge-citations/${citationId}`]}>
        <QueryClientProvider client={queryClient}>
          <Routes>
            <Route
              path="/knowledge-citations/:citationId"
              element={<KnowledgeCitationPage />}
            />
          </Routes>
        </QueryClientProvider>
      </MemoryRouter>
    )

    const user = userEvent.setup()
    expect(
      await screen.findByRole("heading", { name: "扫描件.tiff" })
    ).toBeVisible()
    expect(
      document.querySelector(
        '.knowledge-preview-header [data-file-icon-kind="image"]'
      )
    ).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "保修期限" })).toBeVisible()
    expect(screen.getByText("整机保修一年。")).toBeVisible()
    expect(screen.queryByText("不属于引用。")).not.toBeInTheDocument()
    expect(screen.getByText(/第 2 页/u)).toBeVisible()
    expect(
      screen.queryByText(/此文件格式暂不支持原文预览/u)
    ).not.toBeInTheDocument()
    await user.click(screen.getByRole("tab", { name: "原文预览" }))
    expect(await screen.findByLabelText("预览文档 扫描件.tiff")).toBeVisible()
    expect(fileViewerProps).toHaveBeenCalledWith(
      expect.objectContaining({ filename: "扫描件.tiff" })
    )
    expect(
      fetchMock.mock.calls.some(([input]) =>
        String(input).endsWith(
          `/api/v1/knowledge-citations/${citationId}/original`
        )
      )
    ).toBe(true)
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([input]) =>
          String(input).endsWith(`/api/v1/knowledge-citations/${citationId}`)
        )
      ).toBe(true)
    )
    const citationRequests = fetchMock.mock.calls.filter(([input]) =>
      String(input).endsWith(`/api/v1/knowledge-citations/${citationId}`)
    )
    expect(citationRequests).toHaveLength(1)
    const requestedUrl = String(citationRequests[0]?.[0])
    expect(requestedUrl).toContain(`/knowledge-citations/${citationId}`)
    expect(requestedUrl).not.toContain(privateKnowledgeBaseId)
    expect(requestedUrl).not.toContain(privateDocumentId)
    expect(requestedUrl).not.toContain(privateDocumentVersionId)
    expect(requestedUrl).not.toMatch(
      /document_version_id|parent_id|citation_start|citation_end/u
    )

    await user.click(screen.getByRole("button", { name: "下载原文件" }))
    await waitFor(() => expect(downloadBlob).toHaveBeenCalledOnce())
    expect(downloadBlob).toHaveBeenCalledWith(expect.any(Blob), "扫描件.tiff")
    expect(fetchMock).toHaveBeenLastCalledWith(
      `/api/v1/knowledge-citations/${citationId}/download`,
      expect.objectContaining({ credentials: "include" })
    )
  })

  it("reauthorizes every page entry before exposing any cached citation body", async () => {
    let resolveFirstRequest!: (response: Response) => void
    const firstRequest = new Promise<Response>((resolve) => {
      resolveFirstRequest = resolve
    })
    let citationRequestCount = 0
    const freshPreview = {
      status: "available" as const,
      citation_id: citationId,
      citation_no: 1,
      summary: {
        knowledge_base_name: "当前知识库",
        document_name: "当前制度.md",
        title_path: [],
        page_numbers: [],
      },
      parent_excerpt: "# 当前授权正文",
      original: { supported: true as const, renderer: "file" as const },
    }
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith("/api/v1/knowledge-bases/search-capability")) {
        return Promise.resolve(
          envelope({
            status: "available",
            reason_code: null,
            checked_at: "2026-07-22T08:00:00.000Z",
          })
        )
      }
      if (url.endsWith(`/api/v1/knowledge-citations/${citationId}/events`)) {
        return Promise.resolve(pendingCitationEvents())
      }
      if (url.endsWith(`/api/v1/knowledge-citations/${citationId}`)) {
        citationRequestCount += 1
        return citationRequestCount === 1
          ? firstRequest
          : Promise.resolve(envelope(freshPreview))
      }
      return Promise.resolve(new Response(null, { status: 404 }))
    })
    vi.stubGlobal("fetch", fetchMock)
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    queryClient.setQueryData(knowledgeBaseQueryKeys.citation(citationId), {
      ...freshPreview,
      summary: {
        ...freshPreview.summary,
        document_name: "旧缓存.md",
      },
      parent_excerpt: "# 不应显示的旧缓存",
    })
    const renderPage = () =>
      render(
        <MemoryRouter initialEntries={[`/knowledge-citations/${citationId}`]}>
          <QueryClientProvider client={queryClient}>
            <Routes>
              <Route
                path="/knowledge-citations/:citationId"
                element={<KnowledgeCitationPage />}
              />
            </Routes>
          </QueryClientProvider>
        </MemoryRouter>
      )

    const firstRender = renderPage()

    expect(await screen.findByText("正在解析知识库引用")).toBeVisible()
    expect(screen.queryByText("不应显示的旧缓存")).not.toBeInTheDocument()
    expect(
      screen.queryByRole("heading", { name: "旧缓存.md" })
    ).not.toBeInTheDocument()

    resolveFirstRequest(envelope(freshPreview))
    expect(
      await screen.findByRole("heading", { name: "当前制度.md" })
    ).toBeVisible()
    expect(screen.getByText(/文档级来源/u)).toBeVisible()
    expect(citationRequestCount).toBe(1)

    firstRender.unmount()
    await waitFor(() =>
      expect(
        queryClient.getQueryData(knowledgeBaseQueryKeys.citation(citationId))
      ).toBeUndefined()
    )

    renderPage()
    expect(
      await screen.findByRole("heading", { name: "当前制度.md" })
    ).toBeVisible()
    expect(citationRequestCount).toBe(2)
  })

  it("removes citation content immediately when the source is no longer authorized", async () => {
    let citationRequestCount = 0
    const citationEvents = controlledCitationEvents()
    const preview = {
      status: "available" as const,
      citation_id: citationId,
      citation_no: 1,
      summary: {
        knowledge_base_name: "临时共享知识库",
        document_name: "内部制度.md",
        title_path: [],
        page_numbers: [],
      },
      parent_excerpt: "# 应立即卸载的敏感正文",
      original: { supported: true as const, renderer: "file" as const },
    }
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith("/api/v1/knowledge-bases/search-capability")) {
        return Promise.resolve(
          envelope({
            status: "available",
            reason_code: null,
            checked_at: "2026-07-22T08:00:00.000Z",
          })
        )
      }
      if (url.endsWith(`/api/v1/knowledge-citations/${citationId}/events`)) {
        return Promise.resolve(citationEvents.response)
      }
      if (url.endsWith(`/api/v1/knowledge-citations/${citationId}`)) {
        citationRequestCount += 1
        if (citationRequestCount === 1)
          return Promise.resolve(envelope(preview))
        return Promise.resolve(
          new Response(
            JSON.stringify({
              success: false,
              error_code: "KNOWLEDGE_BASE_ACCESS_DENIED",
              message_key: "errors.knowledgeBase.accessDenied",
              message: "你无权访问该知识库。",
            }),
            {
              status: 403,
              headers: { "content-type": "application/json" },
            }
          )
        )
      }
      return Promise.resolve(new Response(null, { status: 404 }))
    })
    vi.stubGlobal("fetch", fetchMock)
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })

    render(
      <MemoryRouter initialEntries={[`/knowledge-citations/${citationId}`]}>
        <QueryClientProvider client={queryClient}>
          <Routes>
            <Route
              path="/knowledge-citations/:citationId"
              element={<KnowledgeCitationPage />}
            />
          </Routes>
        </QueryClientProvider>
      </MemoryRouter>
    )

    expect(
      await screen.findByRole("heading", { name: "内部制度.md" })
    ).toBeVisible()
    expect(screen.getByText("应立即卸载的敏感正文")).toBeVisible()

    citationEvents.emitSourceChanged()
    expect(await screen.findByText(/你没有权限执行此操作/u)).toBeVisible()
    expect(
      screen.queryByRole("heading", { name: "内部制度.md" })
    ).not.toBeInTheDocument()
    expect(screen.queryByText("应立即卸载的敏感正文")).not.toBeInTheDocument()
    expect(
      queryClient.getQueryData(knowledgeBaseQueryKeys.citation(citationId))
    ).toBeUndefined()
    expect(citationRequestCount).toBe(2)
  })

  it("shows only the persisted location summary for a physically deleted source", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith("/api/v1/knowledge-bases/search-capability")) {
        return Promise.resolve(
          envelope({
            status: "available",
            reason_code: null,
            checked_at: "2026-07-22T08:00:00.000Z",
          })
        )
      }
      if (url.endsWith(`/api/v1/knowledge-citations/${citationId}`)) {
        return Promise.resolve(
          envelope({
            status: "historical_unavailable",
            citation_id: citationId,
            citation_no: 1,
            summary: {
              knowledge_base_name: "历史售后知识库",
              document_name: "已删除政策.pdf",
              title_path: ["售后政策", "保修期限"],
              page_numbers: [2],
            },
          })
        )
      }
      return Promise.resolve(new Response(null, { status: 404 }))
    })
    vi.stubGlobal("fetch", fetchMock)
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })

    render(
      <MemoryRouter initialEntries={[`/knowledge-citations/${citationId}`]}>
        <QueryClientProvider client={queryClient}>
          <Routes>
            <Route
              path="/knowledge-citations/:citationId"
              element={<KnowledgeCitationPage />}
            />
          </Routes>
        </QueryClientProvider>
      </MemoryRouter>
    )

    expect(
      await screen.findByRole("heading", { name: "已删除政策.pdf" })
    ).toBeVisible()
    expect(
      document.querySelector(
        '.knowledge-preview-header [data-file-icon-kind="pdf"]'
      )
    ).toBeInTheDocument()
    expect(screen.getByText("历史引用内容已不可用")).toBeVisible()
    expect(screen.getByText(/来源知识库或文档已删除/u)).toBeVisible()
    expect(screen.getByText(/第 2 页/u)).toBeVisible()
    expect(screen.queryByRole("button", { name: "下载原文件" })).toBeNull()
    expect(screen.queryByText("正文内容")).toBeNull()
    expect(
      fetchMock.mock.calls.some(([input]) =>
        String(input).endsWith(
          `/api/v1/knowledge-citations/${citationId}/events`
        )
      )
    ).toBe(false)
    expect(
      fetchMock.mock.calls.some(([input]) =>
        String(input).endsWith(
          `/api/v1/knowledge-citations/${citationId}/download`
        )
      )
    ).toBe(false)
  })

  it("replaces authorized content with the historical summary after deletion converges", async () => {
    let citationRequestCount = 0
    const citationEvents = controlledCitationEvents()
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith("/api/v1/knowledge-bases/search-capability")) {
        return Promise.resolve(
          envelope({
            status: "available",
            reason_code: null,
            checked_at: "2026-07-22T08:00:00.000Z",
          })
        )
      }
      if (url.endsWith(`/api/v1/knowledge-citations/${citationId}/events`)) {
        return Promise.resolve(citationEvents.response)
      }
      if (url.endsWith(`/api/v1/knowledge-citations/${citationId}`)) {
        citationRequestCount += 1
        return Promise.resolve(
          envelope(
            citationRequestCount === 1
              ? {
                  status: "available",
                  citation_id: citationId,
                  citation_no: 1,
                  summary: {
                    knowledge_base_name: "售后知识库",
                    document_name: "售后政策.pdf",
                    title_path: ["保修期限"],
                    page_numbers: [2],
                  },
                  parent_excerpt: "# 删除后必须卸载的正文",
                  original: {
                    supported: true,
                    renderer: "file",
                  },
                }
              : {
                  status: "historical_unavailable",
                  citation_id: citationId,
                  citation_no: 1,
                  summary: {
                    knowledge_base_name: "历史售后知识库",
                    document_name: "历史售后政策.pdf",
                    title_path: ["保修期限"],
                    page_numbers: [2],
                  },
                }
          )
        )
      }
      return Promise.resolve(new Response(null, { status: 404 }))
    })
    vi.stubGlobal("fetch", fetchMock)
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })

    render(
      <MemoryRouter initialEntries={[`/knowledge-citations/${citationId}`]}>
        <QueryClientProvider client={queryClient}>
          <Routes>
            <Route
              path="/knowledge-citations/:citationId"
              element={<KnowledgeCitationPage />}
            />
          </Routes>
        </QueryClientProvider>
      </MemoryRouter>
    )

    expect(
      await screen.findByRole("heading", { name: "售后政策.pdf" })
    ).toBeVisible()
    expect(screen.getByText("删除后必须卸载的正文")).toBeVisible()

    citationEvents.emitSourceChanged()

    expect(await screen.findByText("历史引用内容已不可用")).toBeVisible()
    expect(screen.queryByText("删除后必须卸载的正文")).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "下载原文件" })
    ).not.toBeInTheDocument()
    expect(
      queryClient.getQueryData(knowledgeBaseQueryKeys.citation(citationId))
    ).toMatchObject({ status: "historical_unavailable" })
    expect(citationRequestCount).toBe(2)
    expect(
      fetchMock.mock.calls.filter(([input]) =>
        String(input).endsWith(
          `/api/v1/knowledge-citations/${citationId}/events`
        )
      )
    ).toHaveLength(1)
  })
})
