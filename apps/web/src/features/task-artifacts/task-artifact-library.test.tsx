import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { MemoryRouter, Route, Routes } from "react-router-dom"

import { downloadBlob } from "@/lib/download-blob"
import i18n from "@/i18n"
import { KnowledgeBaseListPage } from "@/pages/knowledge-base-pages"

vi.mock("@/lib/download-blob", () => ({
  downloadBlob: vi.fn(),
}))

vi.mock("@/features/task-artifacts/task-artifact-preview", () => ({
  TaskArtifactPreview: ({
    file,
    onClose,
  }: {
    file: { name: string }
    onClose: () => void
  }) => (
    <div aria-label={`产物预览 ${file.name}`}>
      <button type="button" onClick={onClose}>
        关闭预览
      </button>
    </div>
  ),
}))

const taskId = "20000000-0000-4000-8000-000000000001"
const archivedTaskId = "20000000-0000-4000-8000-000000000002"

describe("task artifact library", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("zh-CN")
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it("uses the global tabs and groups downloadable artifacts by task in time order", async () => {
    const interaction = userEvent.setup()
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = new URL(String(input), window.location.origin)
      if (url.pathname === "/api/v1/conversations/artifacts") {
        return Promise.resolve(
          Response.json({
            success: true,
            data: {
              items: [
                artifact({
                  id: "30000000-0000-4000-8000-000000000001",
                  filename: "季度总结.pdf",
                  mime_type: "application/pdf",
                }),
                artifact({
                  id: "30000000-0000-4000-8000-000000000002",
                  filename: "数据明细.xlsx",
                  mime_type:
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                  created_at: "2026-08-09T07:00:00.000Z",
                }),
                artifact({
                  id: "30000000-0000-4000-8000-000000000003",
                  conversation_id: archivedTaskId,
                  filename: "归档说明.txt",
                  mime_type: "text/plain",
                  task: {
                    id: archivedTaskId,
                    title: "历史资料整理",
                    archive_status: "archived",
                  },
                  created_at: "2026-08-08T06:00:00.000Z",
                }),
              ],
              next_cursor: null,
            },
          })
        )
      }
      if (url.pathname.endsWith("/download")) {
        return Promise.resolve(
          new Response(new Blob(["file"]), {
            status: 200,
            headers: { "content-type": "application/pdf" },
          })
        )
      }
      return Promise.reject(new Error(`Unexpected request: ${url.pathname}`))
    })
    vi.stubGlobal("fetch", fetchMock)
    renderLibrary()

    expect(screen.getByRole("heading", { name: "文件库" })).toBeVisible()
    const tabs = screen.getByRole("tablist", { name: "文件库内容" })
    expect(tabs).toHaveAttribute("data-variant", "default")
    expect(within(tabs).getByRole("tab", { name: "任务产物" })).toHaveAttribute(
      "data-active",
      ""
    )
    expect(
      within(tabs).getByRole("tab", { name: "知识库" })
    ).not.toHaveAttribute("data-active")

    const taskLink = await screen.findByRole("link", { name: "季度材料整理" })
    expect(taskLink).toHaveAttribute("href", `/conversations/${taskId}`)
    expect(taskLink.querySelector("svg")).toHaveAttribute("aria-hidden", "true")
    const taskGroup = taskLink.closest("section")
    expect(taskGroup).not.toBeNull()
    expect(taskGroup).not.toHaveClass("pl-7")
    expect(taskGroup?.className).not.toContain("before:")
    expect(screen.getByText("季度总结.pdf")).toBeVisible()
    expect(screen.getByText("数据明细.xlsx")).toBeVisible()
    for (const previewHint of screen.getAllByText("可预览")) {
      expect(previewHint).toHaveClass(
        "opacity-0",
        "group-hover:opacity-100",
        "group-focus-within:opacity-100"
      )
      expect(previewHint).toHaveAttribute("aria-hidden", "true")
    }
    const archivedTaskLink = screen.getByRole("link", {
      name: "历史资料整理",
    })
    expect(archivedTaskLink).toHaveAttribute(
      "href",
      `/conversations/${archivedTaskId}`
    )
    expect(archivedTaskLink.querySelector("svg")).toHaveAttribute(
      "aria-hidden",
      "true"
    )
    expect(screen.getByText("已归档")).toBeVisible()

    await interaction.click(
      screen.getByRole("button", { name: "预览文件 季度总结.pdf" })
    )
    expect(screen.getByLabelText("产物预览 季度总结.pdf")).toBeVisible()

    await interaction.click(
      screen.getByRole("button", { name: "下载 季度总结.pdf" })
    )
    await waitFor(() =>
      expect(downloadBlob).toHaveBeenCalledWith(
        expect.any(Blob),
        "季度总结.pdf"
      )
    )
  })

  it("shows the task-artifact empty state without loading knowledge-base data", async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL) => Promise<Response>>(
      () =>
        Promise.resolve(
          Response.json({
            success: true,
            data: { items: [], next_cursor: null },
          })
        )
    )
    vi.stubGlobal("fetch", fetchMock)
    renderLibrary()

    expect(await screen.findByText("暂无任务产物")).toBeVisible()
    expect(screen.getByText(/任务生成并登记可下载文件后/)).toBeVisible()
    expect(
      fetchMock.mock.calls.every(([input]) =>
        String(input).includes("/api/v1/conversations/artifacts")
      )
    ).toBe(true)
  })

  it("automatically loads the next page when the list end approaches the scroll viewport", async () => {
    let observerCallback: IntersectionObserverCallback | undefined
    let observedTarget: Element | undefined
    let observerOptions: IntersectionObserverInit | undefined
    const disconnect = vi.fn()
    class IntersectionObserverMock {
      constructor(
        callback: IntersectionObserverCallback,
        options?: IntersectionObserverInit
      ) {
        observerCallback = callback
        observerOptions = options
      }

      observe(target: Element) {
        observedTarget = target
      }

      unobserve() {}
      disconnect = disconnect
      takeRecords() {
        return []
      }
    }
    vi.stubGlobal("IntersectionObserver", IntersectionObserverMock)

    let resolveNextPage: ((response: Response) => void) | undefined
    const nextPageResponse = new Promise<Response>((resolve) => {
      resolveNextPage = resolve
    })
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = new URL(String(input), window.location.origin)
      if (url.pathname !== "/api/v1/conversations/artifacts") {
        return Promise.reject(new Error(`Unexpected request: ${url.pathname}`))
      }
      if (url.searchParams.get("cursor") === "next-page") {
        return nextPageResponse
      }
      return Promise.resolve(
        Response.json({
          success: true,
          data: {
            items: [artifact({ filename: "第一页产物.pdf" })],
            next_cursor: "next-page",
          },
        })
      )
    })
    vi.stubGlobal("fetch", fetchMock)
    renderLibrary()

    expect(await screen.findByText("第一页产物.pdf")).toBeVisible()
    await waitFor(() => expect(observedTarget).toBeDefined())
    expect(observerOptions).toMatchObject({
      rootMargin: "0px 0px 240px 0px",
    })
    expect(observerOptions?.root).toHaveClass("management-scroll")
    expect(
      screen.queryByRole("button", { name: "加载更多" })
    ).not.toBeInTheDocument()

    const triggerIntersection = (isIntersecting: boolean) => {
      if (!observerCallback || !observedTarget) {
        throw new Error(
          "Expected the task artifact load sentinel to be observed"
        )
      }
      observerCallback(
        [
          {
            isIntersecting,
            target: observedTarget,
          } as IntersectionObserverEntry,
        ],
        {} as IntersectionObserver
      )
    }
    act(() => triggerIntersection(false))
    expect(fetchMock).toHaveBeenCalledTimes(1)

    act(() => triggerIntersection(true))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(screen.getByRole("status")).toHaveTextContent("正在加载更多…")

    act(() => triggerIntersection(true))
    expect(fetchMock).toHaveBeenCalledTimes(2)

    await act(async () => {
      resolveNextPage?.(
        Response.json({
          success: true,
          data: {
            items: [
              artifact({
                id: "30000000-0000-4000-8000-000000000099",
                filename: "第二页产物.pdf",
              }),
            ],
            next_cursor: null,
          },
        })
      )
    })
    expect(await screen.findByText("第二页产物.pdf")).toBeVisible()
    expect(screen.queryByRole("status")).not.toBeInTheDocument()
    expect(disconnect).toHaveBeenCalled()
  })

  it("hydrates the artifact search field from the library URL", async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL) => Promise<Response>>(
      () =>
        Promise.resolve(
          Response.json({
            success: true,
            data: { items: [artifact()], next_cursor: null },
          })
        )
    )
    vi.stubGlobal("fetch", fetchMock)
    renderLibrary("/knowledge-bases?tab=artifacts&search=季度总结")

    expect(
      await screen.findByRole("textbox", { name: "搜索任务标题或文件名…" })
    ).toHaveValue("季度总结")
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("search=%E5%AD%A3%E5%BA%A6%E6%80%BB%E7%BB%93"),
        expect.anything()
      )
    )
  })
})

function renderLibrary(initialEntry = "/knowledge-bases?tab=artifacts") {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <QueryClientProvider client={queryClient}>
        <Routes>
          <Route path="/knowledge-bases" element={<KnowledgeBaseListPage />} />
        </Routes>
      </QueryClientProvider>
    </MemoryRouter>
  )
}

function artifact(overrides: Record<string, unknown> = {}) {
  return {
    id: "30000000-0000-4000-8000-000000000001",
    conversation_id: taskId,
    turn_id: "40000000-0000-4000-8000-000000000001",
    kind: "artifact",
    source: "agent_generated",
    status: "registered",
    filename: "季度总结.pdf",
    mime_type: "application/pdf",
    size_bytes: 4096,
    storage_backend: "minio",
    downloadable: true,
    created_at: "2026-08-10T08:30:00.000Z",
    updated_at: "2026-08-10T08:30:00.000Z",
    task: {
      id: taskId,
      title: "季度材料整理",
      archive_status: "active",
    },
    ...overrides,
  }
}
