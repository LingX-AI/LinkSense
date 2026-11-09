import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { setAccessToken } from "@/api/session"
import { AuthContext } from "@/app/auth-state"
import { ThemeProvider } from "@/app/theme-context"
import { KnowledgeUploadSessionProvider } from "./knowledge-upload-session-provider"
import {
  archiveKnowledgeBase,
  createKnowledgeBase,
  deleteKnowledgeBase,
  getKnowledgeBase,
  getKnowledgeDocumentContent,
  getKnowledgeSearchCapability,
  knowledgeBaseQueryKeys,
  listKnowledgeBaseEntries,
  listKnowledgeBases,
  listKnowledgeDocuments,
  uploadKnowledgeDocument,
} from "./knowledge-base-api"
import { connectKnowledgeBaseEvents } from "./knowledge-base-events"
import {
  isKnowledgeUiDemoEnabled,
  rememberKnowledgeUiDemo,
} from "./knowledge-ui-demo-mode"
import {
  KnowledgeBaseDetailPage,
  KnowledgeBaseListPage,
  KnowledgeDocumentPreviewPage,
} from "@/pages/knowledge-base-pages"
import i18n, { supportedLanguages } from "@/i18n"

const demoUrl = "/knowledge-bases?knowledgeDemo=1"
const baseId = "d3e00000-0000-4000-8000-000000000001"

beforeEach(async () => {
  window.sessionStorage.clear()
  window.history.replaceState(null, "", demoUrl)
  setAccessToken(null)
  await i18n.changeLanguage("zh-CN")
})

afterEach(() => {
  cleanup()
  window.sessionStorage.clear()
  window.history.replaceState(null, "", "/")
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe("local knowledge UI samples", () => {
  it("requires development, a loopback knowledge route and explicit opt-in", () => {
    expect(isKnowledgeUiDemoEnabled()).toBe(true)
    window.history.replaceState(null, "", "/knowledge-bases")
    expect(isKnowledgeUiDemoEnabled()).toBe(false)
    window.history.replaceState(null, "", demoUrl)
    rememberKnowledgeUiDemo()
    window.history.replaceState(null, "", `/knowledge-bases/${baseId}`)
    expect(isKnowledgeUiDemoEnabled()).toBe(true)
    window.history.replaceState(null, "", "/conversations/new")
    expect(isKnowledgeUiDemoEnabled()).toBe(false)
    window.history.replaceState(null, "", demoUrl)
    vi.stubEnv("DEV", false)
    expect(isKnowledgeUiDemoEnabled()).toBe(false)
  })

  it("does not enable sample data on a remote host", () => {
    vi.stubGlobal("window", {
      location: new URL(
        "https://linksense.example/knowledge-bases?knowledgeDemo=1"
      ),
    })
    expect(isKnowledgeUiDemoEnabled()).toBe(false)
    vi.unstubAllGlobals()
  })

  it("keeps live list and capability cache keys separate from samples", () => {
    const filters = { lifecycle: "all", scope: "all", search: "" } as const
    const demoKeys = [
      knowledgeBaseQueryKeys.list(filters),
      knowledgeBaseQueryKeys.searchCapability(),
    ]
    window.history.replaceState(null, "", "/conversations/new")
    expect(knowledgeBaseQueryKeys.list(filters)).not.toEqual(demoKeys[0])
    expect(knowledgeBaseQueryKeys.searchCapability()).not.toEqual(demoKeys[1])
  })

  it("returns valid list, filters, pagination, document details and parsed content without fetch", async () => {
    const fetcher = vi.spyOn(globalThis, "fetch")
    const all = await listKnowledgeBases({ lifecycle: "all", scope: "all" })
    expect(all.items).toHaveLength(8)
    expect(all.items.some((base) => base.document_count === 0)).toBe(true)
    expect(
      all.items.some((base) => base.availability_status === "disabled")
    ).toBe(true)
    for (const base of all.items) {
      expect(
        Object.entries(base.permissions).every(
          ([permission, enabled]) => permission === "view_content" || !enabled
        )
      ).toBe(true)
    }
    const archived = await listKnowledgeBases({
      lifecycle: "archived",
      scope: "all",
    })
    expect(archived.items.map((base) => base.name)).toEqual([
      "2026 Q3 项目归档",
    ])
    const shared = await listKnowledgeBases({
      lifecycle: "all",
      scope: "shared",
    })
    expect(shared.items).toHaveLength(4)
    expect(shared.items.every((base) => !base.is_owner)).toBe(true)
    const search = await listKnowledgeBases({
      lifecycle: "all",
      scope: "all",
      search: "设计",
    })
    expect(search.items.map((base) => base.name)).toEqual(["品牌与设计规范"])
    const first = await listKnowledgeBases({
      lifecycle: "all",
      scope: "all",
      limit: 2,
    })
    const next = await listKnowledgeBases({
      lifecycle: "all",
      scope: "all",
      limit: 2,
      cursor: first.next_cursor ?? undefined,
    })
    expect(next.items[0].id).toBe(all.items[2].id)
    const base = await getKnowledgeBase(baseId)
    const documents = await listKnowledgeDocuments(baseId)
    const entries = await listKnowledgeBaseEntries(baseId, { view: "flat" })
    expect(documents.items).toHaveLength(base.document_count)
    expect(
      documents.items.filter((document) => document.status === "ready")
    ).toHaveLength(base.ready_document_count)
    expect(documents.items.map((document) => document.status)).toContain(
      "failed"
    )
    expect(documents.has_processing_documents).toBe(true)
    expect(entries.items).toHaveLength(documents.items.length)
    const content = await getKnowledgeDocumentContent(
      baseId,
      documents.items[0].id
    )
    expect(content.markdown).toContain("UI 测试示例")
    expect(content.document_version_id).toBe(
      documents.items[0].current_version_id
    )
    expect(fetcher).not.toHaveBeenCalled()
  })

  it("rejects writes, uploads and unknown IDs without contacting a backend or opening SSE", async () => {
    const fetcher = vi.spyOn(globalThis, "fetch")
    await expect(
      createKnowledgeBase({ name: "Do not create" })
    ).rejects.toMatchObject({ status: 403 })
    await expect(archiveKnowledgeBase(baseId)).rejects.toMatchObject({
      status: 403,
    })
    await expect(deleteKnowledgeBase(baseId)).rejects.toMatchObject({
      status: 403,
    })
    await expect(
      uploadKnowledgeDocument({
        knowledgeBaseId: baseId,
        file: new File(["sample"], "sample.txt"),
      })
    ).rejects.toMatchObject({ status: 403 })
    await expect(
      getKnowledgeBase("00000000-0000-4000-8000-000000000000")
    ).rejects.toMatchObject({ status: 404 })
    const dispose = connectKnowledgeBaseEvents(baseId, { onEvent: vi.fn() })
    dispose()
    expect(fetcher).not.toHaveBeenCalled()
  })

  it("uses the real capability API when the demo flag is absent or the build is production", async () => {
    const capability = {
      status: "not_installed",
      reason_code: "KNOWLEDGE_NOT_INSTALLED",
      checked_at: "2026-11-06T02:00:00.000Z",
    }
    const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      new Response(JSON.stringify({ success: true, data: capability }), {
        headers: { "content-type": "application/json" },
      })
    )
    window.history.replaceState(null, "", "/knowledge-bases")
    await expect(getKnowledgeSearchCapability()).resolves.toEqual(capability)
    window.history.replaceState(null, "", demoUrl)
    vi.stubEnv("DEV", false)
    await expect(getKnowledgeSearchCapability()).resolves.toEqual(capability)
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it("provides the demo notice in all six locales", () => {
    for (const language of supportedLanguages) {
      expect(i18n.exists("knowledge.uiDemo.readOnly", { lng: language })).toBe(
        true
      )
      expect(i18n.exists("knowledge.uiDemo.exit", { lng: language })).toBe(true)
    }
  })

  it("renders the existing library, search, detail and preview with read-only sample data", async () => {
    const fetcher = vi.spyOn(globalThis, "fetch")
    const user = userEvent.setup()
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })
    const result = render(
      <AuthContext.Provider
        value={{
          status: "authenticated",
          user: null,
          acceptSession: vi.fn(),
          refreshUser: vi.fn(),
          signOut: vi.fn(),
        }}
      >
        <ThemeProvider>
          <MemoryRouter initialEntries={[demoUrl]}>
            <QueryClientProvider client={client}>
              <KnowledgeUploadSessionProvider>
                <Routes>
                  <Route
                    path="/knowledge-bases"
                    element={<KnowledgeBaseListPage />}
                  />
                  <Route
                    path="/knowledge-bases/:knowledgeBaseId"
                    element={<KnowledgeBaseDetailPage />}
                  />
                  <Route
                    path="/knowledge-bases/:knowledgeBaseId/documents/:documentId/preview"
                    element={<KnowledgeDocumentPreviewPage />}
                  />
                </Routes>
              </KnowledgeUploadSessionProvider>
            </QueryClientProvider>
          </MemoryRouter>
        </ThemeProvider>
      </AuthContext.Provider>
    )
    expect(
      await screen.findByRole("link", { name: "产品与使用指南" })
    ).toBeVisible()
    expect(screen.getByText(i18n.t("knowledge.uiDemo.readOnly"))).toBeVisible()
    expect(
      screen.queryByRole("button", { name: i18n.t("knowledge.create.action") })
    ).not.toBeInTheDocument()
    const search = screen.getByRole("textbox", {
      name: i18n.t("knowledge.searchPlaceholder"),
    })
    await user.type(search, "设计")
    expect(
      await screen.findByRole("link", { name: "品牌与设计规范" })
    ).toBeVisible()
    expect(
      screen.queryByRole("link", { name: "产品与使用指南" })
    ).not.toBeInTheDocument()
    await user.clear(search)
    await user.click(
      await screen.findByRole("link", { name: "产品与使用指南" })
    )
    expect(
      await screen.findByRole("heading", { name: "产品与使用指南" })
    ).toBeVisible()
    const documentLink = await screen.findByRole("link", {
      name: /快速开始指南.pdf/u,
    })
    await user.click(documentLink)
    expect(
      await screen.findByRole("heading", { name: "快速开始指南" })
    ).toBeVisible()
    expect(
      screen.getByRole("button", {
        name: i18n.t("knowledge.preview.downloadOriginal"),
      })
    ).toBeDisabled()
    expect(fetcher).not.toHaveBeenCalled()
    result.unmount()
    client.clear()
  })
})
