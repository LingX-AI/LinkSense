import { useState } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { MemoryRouter, useLocation } from "react-router-dom"

import { setAccessToken } from "@/api/session"
import { ConversationSearchDialog } from "@/components/shell/conversation-search-dialog"
import i18n from "@/i18n"

const now = "2026-07-14T08:00:00.000Z"
const ownerPermissions = {
  view_content: true,
  update: true,
  manage_documents: true,
  manage_grants: true,
  create_grants: true,
  revoke_grants: true,
  archive: true,
  restore: false,
  delete: false,
  remove_direct_share: false,
}

const searchResults = [
  {
    project_id: null,
    id: "conversation-1",
    title: "活动风险评估",
    archived: false,
    updated_at: now,
    execution_status: "running",
  },
  {
    project_id: null,
    id: "conversation-2",
    title: "整理项目会议纪要",
    archived: false,
    updated_at: "2026-07-13T08:00:00.000Z",
    execution_status: "completed",
  },
]

function envelope(data: unknown) {
  return new Response(JSON.stringify({ success: true, data }), {
    status: 200,
    headers: { "content-type": "application/json" },
  })
}

function SearchDialogHarness() {
  const [open, setOpen] = useState(true)
  const location = useLocation()

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        重新打开搜索
      </button>
      <output data-testid="location">
        {location.pathname}
        {location.search}
      </output>
      <ConversationSearchDialog open={open} onOpenChange={setOpen} />
    </>
  )
}

function renderSearchDialog() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })

  return render(
    <MemoryRouter initialEntries={["/conversations/conversation-1"]}>
      <QueryClientProvider client={queryClient}>
        <SearchDialogHarness />
      </QueryClientProvider>
    </MemoryRouter>
  )
}

describe("conversation search dialog", () => {
  it("keeps development task indicators in search results", async () => {
    vi.stubGlobal(
      "fetch",
      createSearchFetchMock({
        conversations: [
          { ...searchResults[0], application_development_role: "development" },
          { ...searchResults[1], application_development_role: "preview" },
        ],
      })
    )
    renderSearchDialog()
    for (const [index, label] of [
      [0, "应用开发任务"],
      [1, "应用调试对话"],
    ] as const) {
      const icon = await screen.findByRole("img", { name: label })
      const option = icon.closest('[role="option"]')
      if (!(option instanceof HTMLElement))
        throw new Error("Missing task search result")
      expect(option).toHaveTextContent(searchResults[index]!.title)
      expect(
        icon.compareDocumentPosition(
          within(option).getByText(searchResults[index]!.title)
        ) & Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy()
    }
  })

  it("preserves Chinese text and does not select a result with the IME confirmation Enter", async () => {
    renderSearchDialog()
    const input = await screen.findByRole("combobox")
    await screen.findByText("活动风险评估")
    fireEvent.compositionStart(input)
    fireEvent.input(input, { target: { value: "hui" }, isComposing: true })
    expect(input).toHaveValue("hui")
    fireEvent.keyDown(input, { key: "Enter", isComposing: true, keyCode: 229 })
    expect(screen.getByRole("dialog", { name: "搜索" })).toBeVisible()
    fireEvent.input(input, { target: { value: "会议" }, isComposing: true })
    fireEvent.compositionEnd(input, { data: "会议" })
    expect(input).toHaveValue("会议")
    await waitFor(() =>
      expect(
        vi.mocked(fetch).mock.calls.some(([url]) => {
          return (
            new URL(String(url), window.location.origin).searchParams.get(
              "search"
            ) === "会议"
          )
        })
      ).toBe(true)
    )
  })

  beforeEach(async () => {
    setAccessToken("conversation-search-access-token")
    await i18n.changeLanguage("zh-CN")
    vi.stubGlobal(
      "matchMedia",
      vi.fn((query: string) => ({
        matches: query === "(min-width: 768px)",
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }))
    )
    vi.stubGlobal("fetch", createSearchFetchMock())
  })

  afterEach(() => {
    cleanup()
    setAccessToken(null)
    vi.unstubAllGlobals()
  })

  it("uses the wider grouped palette layout with localized metadata", async () => {
    renderSearchDialog()

    const dialog = await screen.findByRole("dialog", { name: "搜索" })
    expect(dialog).toHaveClass(
      "conversation-search-dialog",
      "max-w-[640px]!",
      "top-1/2",
      "-translate-y-1/2",
      "rounded-[20px]!"
    )
    expect(
      dialog.querySelector(".conversation-search-command")?.className
    ).toContain("[&_[data-slot=command-input-wrapper]]:px-5")
    expect(dialog.querySelector('[data-slot="command-list"]')).toHaveClass(
      "h-[min(76svh,34rem)]",
      "max-h-[min(76svh,34rem)]!"
    )

    const input = within(dialog).getByPlaceholderText(
      "搜索标题、消息、附件、产物、插件或 Skill…"
    )
    await waitFor(() => expect(input).toHaveFocus())
    for (const heading of ["任务", "知识库", "任务产物", "插件", "技能"]) {
      expect(
        await within(dialog).findByText(heading, {
          selector: "[cmdk-group-heading]",
        })
      ).toBeVisible()
    }

    const firstResult = (
      await within(dialog).findByText("活动风险评估")
    ).closest('[data-slot="command-item"]')
    expect(firstResult).toHaveClass(
      "conversation-search-result",
      "rounded-xl!",
      "gap-3"
    )
    expect(firstResult?.querySelector(".lucide-message-square")).toHaveClass(
      "ml-3",
      "size-3.5",
      "opacity-60"
    )
    expect(firstResult?.querySelector("time")).toHaveAttribute("datetime", now)
    expect(firstResult?.querySelector("time")?.parentElement).toHaveClass(
      "text-[length:var(--app-font-12)]"
    )
    const knowledgeBaseResult = within(dialog)
      .getByText("多目录知识库")
      .closest('[data-slot="command-item"]')
    expect(knowledgeBaseResult).not.toBeNull()
    expect(knowledgeBaseResult?.querySelector(".lucide-book-open")).toHaveClass(
      "ml-3",
      "size-3.5",
      "opacity-60"
    )
    const knowledgeBaseTitleRow = within(
      knowledgeBaseResult as HTMLElement
    ).getByText("多目录知识库").parentElement
    expect(knowledgeBaseTitleRow).toHaveClass("flex", "items-baseline")
    expect(
      within(knowledgeBaseResult as HTMLElement).getByText(
        "按目录管理的内部资料"
      ).parentElement
    ).toBe(knowledgeBaseTitleRow)
    expect(within(dialog).getByText("季度总结.pdf")).toBeVisible()
    expect(within(dialog).getByText("网页抓取插件")).toBeVisible()
    expect(within(dialog).getByText("PPT 生成技能")).toBeVisible()
  })

  it("searches every supported source and navigates to the selected result", async () => {
    const interaction = userEvent.setup()
    renderSearchDialog()

    const input = await screen.findByPlaceholderText(
      "搜索标题、消息、附件、产物、插件或 Skill…"
    )
    await interaction.type(input, "总结")

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/v1/conversations?"),
        expect.anything()
      )
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/v1/knowledge-bases?"),
        expect.anything()
      )
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/v1/conversations/artifacts?"),
        expect.anything()
      )
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining("type=plugin"),
        expect.anything()
      )
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining("type=skill"),
        expect.anything()
      )
    })
    expect(
      vi
        .mocked(fetch)
        .mock.calls.some(([input]) =>
          String(input).includes("search=%E6%80%BB%E7%BB%93")
        )
    ).toBe(true)

    await interaction.click(screen.getByText("季度总结.pdf"))
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/knowledge-bases?tab=artifacts&search="
    )
    expect(
      screen.queryByRole("dialog", { name: "搜索" })
    ).not.toBeInTheDocument()

    await interaction.click(
      screen.getByRole("button", { name: "重新打开搜索" })
    )
    expect(
      await screen.findByPlaceholderText(
        "搜索标题、消息、附件、产物、插件或 Skill…"
      )
    ).toHaveValue("")

    await interaction.click(await screen.findByText("PPT 生成技能"))
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/capabilities?section=skill&scope=personal&search="
    )
  })

  it("keeps the empty result message visible outside hidden groups", async () => {
    vi.stubGlobal(
      "fetch",
      createSearchFetchMock({
        conversations: [],
        knowledgeBases: [],
        artifacts: [],
        plugins: [],
        skills: [],
      })
    )

    renderSearchDialog()

    const dialog = await screen.findByRole("dialog", { name: "搜索" })
    expect(await within(dialog).findByText("没有找到结果")).toBeVisible()
    expect(
      within(dialog).queryByText("任务", { selector: "[cmdk-group-heading]" })
    ).not.toBeInTheDocument()
  })
})

function createSearchFetchMock(
  overrides: Partial<{
    conversations: unknown[]
    knowledgeBases: unknown[]
    artifacts: unknown[]
    plugins: unknown[]
    skills: unknown[]
  }> = {}
) {
  const conversations = overrides.conversations ?? searchResults
  const knowledgeBases = overrides.knowledgeBases ?? [knowledgeBaseFixture()]
  const artifacts = overrides.artifacts ?? [artifactFixture()]
  const plugins = overrides.plugins ?? [
    capabilityFixture({
      id: "50000000-0000-4000-8000-000000000001",
      name: "网页抓取插件",
      slug: "web-fetch-plugin",
      type: "plugin",
      description: "抓取网页内容并整理摘要",
    }),
  ]
  const skills = overrides.skills ?? [
    capabilityFixture({
      id: "50000000-0000-4000-8000-000000000002",
      name: "ppt-generation",
      display_name: "PPT 生成技能",
      slug: "ppt-generator",
      type: "skill",
      description: "生成可演示的 PPT 文稿",
    }),
  ]

  return vi.fn((input: RequestInfo | URL) => {
    const url = new URL(String(input), window.location.origin)
    if (url.pathname === "/api/v1/conversations") {
      return Promise.resolve(
        envelope({ items: conversations, next_cursor: null })
      )
    }
    if (url.pathname === "/api/v1/knowledge-bases") {
      return Promise.resolve(
        envelope({ items: knowledgeBases, next_cursor: null })
      )
    }
    if (url.pathname === "/api/v1/conversations/artifacts") {
      return Promise.resolve(envelope({ items: artifacts, next_cursor: null }))
    }
    if (url.pathname === "/api/v1/capabilities") {
      return Promise.resolve(
        envelope({
          items: url.searchParams.get("type") === "skill" ? skills : plugins,
          next_cursor: null,
        })
      )
    }
    return Promise.reject(new Error(`Unexpected request: ${url.pathname}`))
  })
}

function knowledgeBaseFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: "10000000-0000-4000-8000-000000000001",
    name: "多目录知识库",
    description: "按目录管理的内部资料",
    source_type: "local",
    source_sync: null,
    lifecycle_status: "active",
    availability_status: "enabled",
    owner: { id: "20000000-0000-4000-8000-000000000001", name: "林晓" },
    is_owner: true,
    access_sources: [{ type: "owner" }],
    document_count: 9,
    ready_document_count: 9,
    storage_used_bytes: 4096,
    storage_reserved_bytes: 0,
    storage_quota_bytes: 10 * 1024 * 1024,
    permissions: ownerPermissions,
    archived_at: null,
    disabled_reason: null,
    created_at: now,
    updated_at: now,
    ...overrides,
  }
}

function artifactFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: "30000000-0000-4000-8000-000000000001",
    conversation_id: "conversation-2",
    turn_id: "40000000-0000-4000-8000-000000000001",
    kind: "artifact",
    source: "agent_generated",
    status: "registered",
    filename: "季度总结.pdf",
    mime_type: "application/pdf",
    size_bytes: 4096,
    storage_backend: "minio",
    downloadable: true,
    created_at: now,
    updated_at: now,
    task: {
      id: "conversation-2",
      title: "整理项目会议纪要",
      archive_status: "active",
    },
    ...overrides,
  }
}

function capabilityFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: "50000000-0000-4000-8000-000000000001",
    name: "网页抓取插件",
    slug: "web-fetch-plugin",
    type: "plugin",
    description: "抓取网页内容并整理摘要",
    status: "active",
    source_type: "local",
    marketplace_listing_id: null,
    marketplace_release_id: null,
    logo_url: null,
    is_owner: true,
    can_manage: true,
    can_govern: true,
    can_select: true,
    can_delete: true,
    has_logo: false,
    preference_status: "enabled",
    manifest: {},
    risk_summary: {},
    created_at: now,
    updated_at: now,
    ...overrides,
  }
}
