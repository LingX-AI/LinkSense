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

import type { User } from "@/api/contracts"
import { setAccessToken } from "@/api/session"
import { AuthContext } from "@/app/auth-state"
import { ThemeProvider } from "@/app/theme-context"
import { notify } from "@/components/feedback/notification"
import { NotificationCenter } from "@/components/feedback/notification-toast"
import { knowledgeBaseQueryKeys } from "@/features/knowledge-bases/knowledge-base-api"
import i18n from "@/i18n"
import {
  KnowledgeBaseDetailPage,
  KnowledgeBaseListPage,
} from "@/pages/knowledge-base-pages"

vi.mock("@/features/knowledge-bases/knowledge-base-events", () => ({
  connectKnowledgeBaseEvents: () => () => undefined,
}))

const knowledgeBaseId = "00000000-0000-4000-8000-000000000001"
const ownerId = "00000000-0000-4000-8000-000000000002"
const directGrantId = "00000000-0000-4000-8000-000000000003"
const groupId = "00000000-0000-4000-8000-000000000004"
const recipientId = "00000000-0000-4000-8000-000000000005"
const documentId = "00000000-0000-4000-8000-000000000011"
const documentVersionId = "00000000-0000-4000-8000-000000000031"
const candidateGenerationId = "00000000-0000-4000-8000-000000000021"

const adminUser = {
  id: ownerId,
  name: "林晓",
  email: "lin@example.test",
  role: "admin",
  status: "active",
  avatar_url: null,
  language: "zh-CN",
  login_method: null,
  running_message_action: "queue",
  registration_source: "organization_invitation",
  weekly_credit_limit: null,
  monthly_credit_limit: null,
  user_groups: [],
} satisfies User

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

function knowledgeBaseFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: knowledgeBaseId,
    name: "产品制度",
    description: "产品制度说明",
    lifecycle_status: "active",
    availability_status: "enabled",
    owner: { id: ownerId, name: "林晓" },
    is_owner: true,
    access_sources: [{ type: "owner" }],
    document_count: 1,
    ready_document_count: 1,
    storage_used_bytes: 4_096,
    storage_reserved_bytes: 0,
    storage_quota_bytes: 10 * 1024 * 1024,
    permissions: ownerPermissions,
    archived_at: null,
    disabled_reason: null,
    created_at: "2026-07-22T01:00:00.000Z",
    updated_at: "2026-07-22T01:01:00.000Z",
    ...overrides,
  }
}

function documentFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: documentId,
    knowledge_base_id: knowledgeBaseId,
    display_name: "方案 A.pdf",
    canonical_extension: "pdf",
    mime_type: "application/pdf",
    size_bytes: 4_096,
    status: "ready",
    current_version_id: documentVersionId,
    searchable: true,
    rebuild_required: false,
    processing: null,
    candidate_failure: null,
    preview: {
      parsed: true,
      original_supported: true,
      renderer: "file",
    },
    created_at: "2026-07-22T01:00:00.000Z",
    updated_at: "2026-07-22T01:01:00.000Z",
    ...overrides,
  }
}

function sourceFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: "00000000-0000-4000-8000-000000000041",
    knowledge_base_id: knowledgeBaseId,
    provider: "sharepoint",
    source_url:
      "https://contoso.sharepoint.com/sites/Finance/Shared%20Documents/Policies",
    site_name: "Finance",
    drive_name: "Documents",
    folder_name: "Policies",
    sync_schedule: {
      frequency: "daily",
      time: "09:00",
      time_zone: "Asia/Shanghai",
    },
    sync_status: "ready",
    retry_available: false,
    sync_progress: null,
    stable_error_code: null,
    last_synced_at: "2026-07-22T01:00:00.000Z",
    next_sync_at: "2026-07-22T02:00:00.000Z",
    created_at: "2026-07-22T00:00:00.000Z",
    updated_at: "2026-07-22T01:00:00.000Z",
    ...overrides,
  }
}

function envelope(data: unknown, status = 200) {
  return new Response(JSON.stringify({ success: true, data }), {
    status,
    headers: { "content-type": "application/json" },
  })
}

function renderDetailPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const renderResult = render(
    <ThemeProvider>
      <MemoryRouter initialEntries={[`/knowledge-bases/${knowledgeBaseId}`]}>
        <QueryClientProvider client={queryClient}>
          <Routes>
            <Route
              path="/knowledge-bases/:knowledgeBaseId"
              element={<KnowledgeBaseDetailPage />}
            />
            <Route path="/knowledge-bases" element={<div>知识库列表</div>} />
            <Route path="/capabilities" element={<div>应用中心</div>} />
          </Routes>
        </QueryClientProvider>
      </MemoryRouter>
      <NotificationCenter />
    </ThemeProvider>
  )
  return { ...renderResult, queryClient }
}

function renderListPage(currentUser: User | null = null) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <MemoryRouter initialEntries={["/knowledge-bases"]}>
      <AuthContext.Provider
        value={{
          status: "authenticated",
          user: currentUser,
          acceptSession: vi.fn(),
          refreshUser: vi.fn(),
          signOut: vi.fn(),
        }}
      >
        <QueryClientProvider client={queryClient}>
          <Routes>
            <Route
              path="/knowledge-bases"
              element={<KnowledgeBaseListPage />}
            />
            <Route
              path="/knowledge-bases/:knowledgeBaseId"
              element={<div>知识库详情</div>}
            />
          </Routes>
        </QueryClientProvider>
      </AuthContext.Provider>
    </MemoryRouter>
  )
}

function createFetchMock(options: {
  knowledgeBase?: ReturnType<typeof knowledgeBaseFixture>
  knowledgeBases?: ReturnType<typeof knowledgeBaseFixture>[]
  documents?: ReturnType<typeof documentFixture>[]
  entryPages?: Record<
    string,
    { breadcrumbs: Array<{ id: string; name: string }>; items: unknown[] }
  >
  flatEntries?: unknown[]
  source?: ReturnType<typeof sourceFixture>
  sharePointEnabled?: boolean
  creationCapability?: {
    status: "ready" | "unready" | "not_installed"
    checks: null | {
      object_storage: "available" | "unavailable"
      document_parsing: "available" | "unavailable"
      embedding_model: "available" | "not_configured" | "unavailable"
      search_and_indexing: "available" | "unavailable"
    }
    checked_at: string
  }
  creationCapabilityError?: boolean
  deleteBaseError?: {
    error_code: string
    params?: Record<string, unknown>
  }
}) {
  const knowledgeBase = options.knowledgeBase ?? knowledgeBaseFixture()
  const knowledgeBases = options.knowledgeBases ?? [knowledgeBase]
  const documents = options.documents ?? [documentFixture()]
  return vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), window.location.origin)
    const method = init?.method ?? "GET"
    if (
      url.pathname === "/api/v1/knowledge-bases/search-capability" &&
      method === "GET"
    ) {
      return Promise.resolve(
        envelope({
          status: "available",
          reason_code: null,
          checked_at: "2026-07-22T01:00:00.000Z",
        })
      )
    }
    if (
      url.pathname === "/api/v1/knowledge-bases/creation-capability" &&
      method === "GET"
    ) {
      if (options.creationCapabilityError) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              success: false,
              error_code: "INTERNAL_ERROR",
              message_key: "errors.internal",
              message: "failed",
            }),
            { status: 500, headers: { "content-type": "application/json" } }
          )
        )
      }
      return Promise.resolve(
        envelope(
          options.creationCapability ?? {
            status: "ready",
            checks: {
              object_storage: "available",
              document_parsing: "available",
              embedding_model: "available",
              search_and_indexing: "available",
            },
            checked_at: "2026-08-31T08:00:00.000Z",
          }
        )
      )
    }
    if (url.pathname === "/api/v1/knowledge-bases" && method === "GET") {
      return Promise.resolve(
        envelope({ items: knowledgeBases, next_cursor: null })
      )
    }
    if (url.pathname === "/api/v1/knowledge-bases" && method === "POST") {
      const body = JSON.parse(String(init?.body)) as {
        name: string
        description?: string
        source_type?: "local" | "sharepoint"
      }
      return Promise.resolve(
        envelope(
          knowledgeBaseFixture({
            name: body.name,
            description: body.description ?? null,
            source_type: body.source_type ?? "local",
          }),
          201
        )
      )
    }
    if (
      url.pathname === "/api/v1/admin/knowledge-source-settings/sharepoint" &&
      method === "GET"
    ) {
      return Promise.resolve(
        envelope({
          provider: "sharepoint",
          revision: 1,
          enabled: options.sharePointEnabled ?? true,
          tenant_id: "10000000-0000-4000-8000-000000000001",
          client_id: "10000000-0000-4000-8000-000000000002",
          tenant_domain: "contoso.sharepoint.com",
          client_secret_configured: true,
        })
      )
    }
    if (
      url.pathname === `/api/v1/knowledge-bases/${knowledgeBaseId}` &&
      method === "GET"
    ) {
      return Promise.resolve(envelope(knowledgeBase))
    }
    if (
      url.pathname === `/api/v1/knowledge-bases/${knowledgeBaseId}` &&
      method === "DELETE"
    ) {
      if (options.deleteBaseError) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ success: false, ...options.deleteBaseError }),
            {
              status: 409,
              headers: { "content-type": "application/json" },
            }
          )
        )
      }
      return Promise.resolve(envelope({}))
    }
    if (
      url.pathname === `/api/v1/knowledge-bases/${knowledgeBaseId}/documents` &&
      method === "GET"
    ) {
      return Promise.resolve(envelope({ items: documents, next_cursor: null }))
    }
    if (
      url.pathname === `/api/v1/knowledge-bases/${knowledgeBaseId}/entries` &&
      method === "GET"
    ) {
      const parentEntryId = url.searchParams.get("parent_entry_id") ?? "root"
      const configuredPage = options.entryPages?.[parentEntryId]
      const flat = url.searchParams.get("view") === "flat"
      return Promise.resolve(
        envelope({
          breadcrumbs: flat ? [] : (configuredPage?.breadcrumbs ?? []),
          items:
            (flat ? options.flatEntries : configuredPage?.items) ??
            documents.map((document) => ({
              id: document.id,
              knowledge_base_id: knowledgeBaseId,
              parent_entry_id: null,
              entry_type: "document",
              name: document.display_name,
              ...(flat ? { path: [document.display_name] } : {}),
              document,
              updated_at: document.updated_at,
            })),
          next_cursor: null,
        })
      )
    }
    if (
      (url.pathname === `/api/v1/knowledge-bases/${knowledgeBaseId}/source` ||
        url.pathname ===
          `/api/v1/knowledge-bases/${knowledgeBaseId}/source/sync`) &&
      (method === "GET" || method === "POST") &&
      options.source
    ) {
      return Promise.resolve(
        envelope(options.source, method === "POST" ? 202 : 200)
      )
    }
    if (
      url.pathname === `/api/v1/knowledge-bases/${knowledgeBaseId}/grants` &&
      method === "GET"
    ) {
      return Promise.resolve(
        envelope({
          items: [
            {
              id: directGrantId,
              knowledge_base_id: knowledgeBaseId,
              target_type: "user",
              target: {
                id: recipientId,
                name: "测试用户",
                email_hint: "t***@example.test",
              },
              status: "active",
              can_revoke: true,
              created_at: "2026-07-22T01:00:00.000Z",
              updated_at: "2026-07-22T01:00:00.000Z",
              revoked_at: null,
            },
          ],
          next_cursor: null,
        })
      )
    }
    if (
      url.pathname ===
        `/api/v1/knowledge-bases/${knowledgeBaseId}/documents/rebuild` &&
      method === "POST"
    ) {
      return Promise.resolve(
        envelope(
          {
            items: documents.map((document) => ({
              document_id: document.id,
              status: "accepted",
              document,
            })),
            next_cursor: null,
          },
          202
        )
      )
    }
    if (
      url.pathname ===
        `/api/v1/knowledge-bases/${knowledgeBaseId}/documents/${documentId}` &&
      method === "PATCH"
    ) {
      const body = JSON.parse(String(init?.body)) as { display_name: string }
      return Promise.resolve(
        envelope(documentFixture({ display_name: body.display_name }))
      )
    }
    if (
      url.pathname ===
        `/api/v1/knowledge-bases/${knowledgeBaseId}/documents/${documentId}/retry` &&
      method === "POST"
    ) {
      return Promise.resolve(envelope(documents[0], 202))
    }
    if (
      url.pathname ===
        `/api/v1/knowledge-bases/${knowledgeBaseId}/documents/${documentId}/rebuild` &&
      method === "POST"
    ) {
      return Promise.resolve(envelope(documents[0], 202))
    }
    if (
      url.pathname ===
        `/api/v1/knowledge-bases/${knowledgeBaseId}/grants/${directGrantId}` &&
      method === "DELETE"
    ) {
      return Promise.resolve(
        envelope({
          revoked_grant_id: directGrantId,
          target_type: "user",
          target_id: recipientId,
          remaining_access: {
            subject_type: "user",
            has_access: true,
            source_types: ["user_group"],
          },
        })
      )
    }
    return Promise.resolve(new Response(null, { status: 404 }))
  })
}

describe("knowledge-base document and access management", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("zh-CN")
    setAccessToken("knowledge-management-token")
  })

  afterEach(() => {
    notify.dismiss()
    cleanup()
    setAccessToken(null)
    vi.unstubAllGlobals()
  })

  it("uses only the flat tree and toggles a folder without directory requests", async () => {
    const folderId = "00000000-0000-4000-8000-000000000051"
    const document = documentFixture()
    const fetchMock = createFetchMock({
      documents: [document],
      flatEntries: [
        {
          id: folderId,
          knowledge_base_id: knowledgeBaseId,
          parent_entry_id: null,
          entry_type: "folder",
          name: "政策目录",
          path: ["政策目录"],
          document: null,
          updated_at: "2026-07-22T01:01:00.000Z",
        },
        {
          id: document.id,
          knowledge_base_id: knowledgeBaseId,
          parent_entry_id: folderId,
          entry_type: "document",
          name: document.display_name,
          path: ["政策目录", document.display_name],
          document,
          updated_at: document.updated_at,
        },
      ],
    })
    vi.stubGlobal("fetch", fetchMock)
    const interaction = userEvent.setup()
    renderDetailPage()

    const showFoldersSwitch = await screen.findByRole("switch", {
      name: "显示目录",
    })
    expect(showFoldersSwitch).toBeChecked()
    expect(showFoldersSwitch.parentElement?.parentElement).toHaveClass(
      "mb-4",
      "justify-between"
    )
    const collapseFolder = await screen.findByRole("button", {
      name: "收起目录 政策目录",
    })
    expect(collapseFolder).toHaveAttribute("aria-expanded", "true")
    expect(
      screen.getByRole("link", { name: "政策目录 / 方案 A.pdf" })
    ).toBeVisible()
    expect(
      screen.queryByRole("group", { name: "文档视图" })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "目录" })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "平铺" })
    ).not.toBeInTheDocument()
    expect(screen.getByRole("columnheader", { name: "操作" })).toHaveClass(
      "knowledge-document-actions-column"
    )
    const documentActionCell = screen
      .getByRole("button", { name: "预览文档 方案 A.pdf" })
      .closest("td")
    expect(documentActionCell).toHaveClass("knowledge-document-actions-column")

    await interaction.click(collapseFolder)
    expect(
      screen.getByRole("button", { name: "展开目录 政策目录" })
    ).toHaveAttribute("aria-expanded", "false")
    expect(
      screen.queryByRole("link", { name: "政策目录 / 方案 A.pdf" })
    ).not.toBeInTheDocument()

    await interaction.click(showFoldersSwitch)
    expect(showFoldersSwitch).not.toBeChecked()
    expect(
      screen.queryByRole("button", { name: "展开目录 政策目录" })
    ).not.toBeInTheDocument()
    const fileOnlyLink = screen.getByRole("link", {
      name: "政策目录 / 方案 A.pdf",
    })
    expect(fileOnlyLink).toBeVisible()
    expect(fileOnlyLink).toHaveAttribute("title", "政策目录 / 方案 A.pdf")
    const fileOnlyLeading = fileOnlyLink
      .closest("tr")
      ?.querySelector(".file-type-icon")?.parentElement
    expect(fileOnlyLeading?.childElementCount).toBe(1)
    expect(
      fileOnlyLink
        .closest("tr")
        ?.querySelector('[data-slot="knowledge-path-indent"]')
    ).not.toBeInTheDocument()

    await interaction.click(showFoldersSwitch)
    expect(showFoldersSwitch).toBeChecked()
    expect(
      screen.getByRole("button", { name: "展开目录 政策目录" })
    ).toBeVisible()
    expect(
      screen.queryByRole("link", { name: "政策目录 / 方案 A.pdf" })
    ).not.toBeInTheDocument()

    await interaction.click(
      screen.getByRole("button", { name: "展开目录 政策目录" })
    )
    expect(
      screen.getByRole("link", { name: "政策目录 / 方案 A.pdf" })
    ).toBeVisible()
    const entryRequests = fetchMock.mock.calls.filter(([input]) =>
      String(input).includes(`/knowledge-bases/${knowledgeBaseId}/entries`)
    )
    expect(entryRequests).not.toHaveLength(0)
    expect(
      entryRequests.every(
        ([input]) =>
          String(input).includes("view=flat") &&
          !String(input).includes("parent_entry_id=")
      )
    ).toBe(true)
  })

  it("renders an indented expanded tree and collapses one subtree", async () => {
    const folderId = "00000000-0000-4000-8000-000000000051"
    const nestedFolderId = "00000000-0000-4000-8000-000000000052"
    const siblingFolderId = "00000000-0000-4000-8000-000000000053"
    const document = documentFixture()
    const fetchMock = createFetchMock({
      documents: [document],
      entryPages: {
        root: {
          breadcrumbs: [],
          items: [
            {
              id: folderId,
              knowledge_base_id: knowledgeBaseId,
              parent_entry_id: null,
              entry_type: "folder",
              name: "政策目录",
              document: null,
              updated_at: "2026-07-22T01:01:00.000Z",
            },
          ],
        },
        [nestedFolderId]: {
          breadcrumbs: [
            { id: folderId, name: "政策目录" },
            { id: nestedFolderId, name: "A-人事" },
          ],
          items: [
            {
              id: document.id,
              knowledge_base_id: knowledgeBaseId,
              parent_entry_id: nestedFolderId,
              entry_type: "document",
              name: document.display_name,
              document,
              updated_at: document.updated_at,
            },
          ],
        },
      },
      flatEntries: [
        {
          id: document.id,
          knowledge_base_id: knowledgeBaseId,
          parent_entry_id: nestedFolderId,
          entry_type: "document",
          name: document.display_name,
          path: ["政策目录", "A-人事", document.display_name],
          document,
          updated_at: document.updated_at,
        },
        {
          id: siblingFolderId,
          knowledge_base_id: knowledgeBaseId,
          parent_entry_id: folderId,
          entry_type: "folder",
          name: "Z-归档",
          path: ["政策目录", "Z-归档"],
          document: null,
          updated_at: "2026-07-22T01:01:00.000Z",
        },
        {
          id: nestedFolderId,
          knowledge_base_id: knowledgeBaseId,
          parent_entry_id: folderId,
          entry_type: "folder",
          name: "A-人事",
          path: ["政策目录", "A-人事"],
          document: null,
          updated_at: "2026-07-22T01:01:00.000Z",
        },
        {
          id: folderId,
          knowledge_base_id: knowledgeBaseId,
          parent_entry_id: null,
          entry_type: "folder",
          name: "政策目录",
          path: ["政策目录"],
          document: null,
          updated_at: "2026-07-22T01:01:00.000Z",
        },
      ],
    })
    vi.stubGlobal("fetch", fetchMock)
    const interaction = userEvent.setup()
    renderDetailPage()

    const folderButton = await screen.findByRole("button", {
      name: "收起目录 政策目录",
    })
    expect(
      screen.queryByRole("button", { name: "打开" })
    ).not.toBeInTheDocument()
    expect(
      folderButton.querySelector('[data-slot="knowledge-folder-icon"]')
    ).toHaveClass("size-4")
    expect(
      folderButton.querySelector('[data-slot="knowledge-folder-icon"]')
    ).not.toHaveClass("size-6")
    expect(folderButton).toHaveAttribute("aria-expanded", "true")
    expect(
      screen.queryByRole("group", { name: "文档视图" })
    ).not.toBeInTheDocument()

    expect(
      screen.getByRole("button", { name: "收起目录 政策目录" })
    ).toBeVisible()
    const nestedFolder = screen.getByRole("button", {
      name: "收起目录 政策目录 / A-人事",
    })
    expect(nestedFolder).toBeVisible()
    const siblingFolder = screen.getByRole("button", {
      name: "收起目录 政策目录 / Z-归档",
    })
    const documentLink = screen.getByRole("link", {
      name: "政策目录 / A-人事 / 方案 A.pdf",
    })
    expect(documentLink).toBeVisible()
    expect(documentLink).toHaveTextContent("方案 A.pdf")
    expect(documentLink).not.toHaveTextContent("政策目录")
    expect(documentLink).toHaveAttribute(
      "title",
      "政策目录 / A-人事 / 方案 A.pdf"
    )
    expect(
      nestedFolder.querySelector('[data-slot="knowledge-path-indent"]')
        ?.childElementCount
    ).toBe(1)
    expect(
      documentLink
        .closest("tr")
        ?.querySelector('[data-slot="knowledge-path-indent"]')
        ?.childElementCount
    ).toBe(2)
    expect(
      documentLink
        .closest("tr")
        ?.querySelector('[data-slot="knowledge-path-guide"]')
    ).not.toBeInTheDocument()
    expect(
      screen
        .getByRole("table")
        .querySelector('[data-slot="knowledge-path-guide-layer"]')
    ).not.toBeInTheDocument()
    const rows = screen.getAllByRole("row")
    const rootRow = folderButton.closest("tr") as HTMLTableRowElement
    const nestedRow = nestedFolder.closest("tr") as HTMLTableRowElement
    const documentRow = documentLink.closest("tr") as HTMLTableRowElement
    const siblingRow = siblingFolder.closest("tr") as HTMLTableRowElement
    expect(rows.indexOf(rootRow)).toBeLessThan(rows.indexOf(nestedRow))
    expect(rows.indexOf(nestedRow)).toBeLessThan(rows.indexOf(documentRow))
    expect(rows.indexOf(documentRow)).toBeLessThan(rows.indexOf(siblingRow))
    expect(
      fetchMock.mock.calls.some(([input]) =>
        String(input).includes("view=flat")
      )
    ).toBe(true)

    await interaction.click(nestedFolder)
    expect(
      screen.getByRole("button", {
        name: "展开目录 政策目录 / A-人事",
      })
    ).toHaveAttribute("aria-expanded", "false")
    expect(
      screen.queryByRole("link", {
        name: "政策目录 / A-人事 / 方案 A.pdf",
      })
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole("button", {
        name: "收起目录 政策目录 / Z-归档",
      })
    ).toBeVisible()

    await interaction.click(
      screen.getByRole("button", {
        name: "展开目录 政策目录 / A-人事",
      })
    )
    expect(
      screen.getByRole("link", {
        name: "政策目录 / A-人事 / 方案 A.pdf",
      })
    ).toBeVisible()

    await interaction.click(folderButton)
    expect(
      screen.getByRole("button", { name: "展开目录 政策目录" })
    ).toHaveAttribute("aria-expanded", "false")
    expect(
      screen.queryByRole("button", {
        name: "收起目录 政策目录 / A-人事",
      })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", {
        name: "收起目录 政策目录 / Z-归档",
      })
    ).not.toBeInTheDocument()
    expect(
      fetchMock.mock.calls.some(([input]) =>
        String(input).includes("parent_entry_id=")
      )
    ).toBe(false)
  })

  it("opens details when any part of a knowledge-base card is selected", async () => {
    const interaction = userEvent.setup()
    vi.stubGlobal("fetch", createFetchMock({}))
    renderListPage()

    const knowledgeBaseLink = await screen.findByRole("link", {
      name: "产品制度",
    })
    expect(knowledgeBaseLink.closest("section")).toHaveClass(
      "knowledge-card-list",
      "rounded-[var(--radius-2xl)]"
    )
    const card = knowledgeBaseLink.querySelector('[data-slot="card"]')
    expect(knowledgeBaseLink).toHaveClass("knowledge-card-link")
    expect(knowledgeBaseLink).toHaveAttribute(
      "href",
      `/knowledge-bases/${knowledgeBaseId}`
    )
    expect(card).toHaveClass("knowledge-card", "border-0", "rounded-none")
    expect(
      knowledgeBaseLink.querySelector('[data-slot="knowledge-base-icon"]')
    ).toHaveClass("knowledge-card-icon")
    const sourceText = screen.getByText("来源：本地")
    const updatedAt = knowledgeBaseLink.querySelector<HTMLTimeElement>(
      'time[datetime="2026-07-22T01:01:00.000Z"]'
    )
    if (!updatedAt) {
      throw new Error("Expected the knowledge-base update timestamp")
    }
    const row = card?.querySelector('[data-slot="card-content"]')
    expect(row).toHaveClass("knowledge-card-row")
    expect(sourceText).toHaveClass("knowledge-card-source-text")
    expect(updatedAt).toHaveClass("knowledge-card-updated-at")
    expect(updatedAt).toHaveTextContent(/^更新于 /u)
    expect(row).toContainElement(sourceText)
    expect(row).toContainElement(updatedAt)
    expect(card?.querySelector('[data-slot="card-footer"]')).toBeNull()
    expect(
      within(knowledgeBaseLink).queryByText("我创建的")
    ).not.toBeInTheDocument()
    expect(screen.getByText("所有者：林晓（我）")).toBeVisible()
    expect(
      sourceText.compareDocumentPosition(updatedAt) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(screen.getByText("产品制度说明")).toHaveClass("truncate")
    expect(screen.getByText("产品制度说明")).toHaveAttribute(
      "title",
      "产品制度说明"
    )

    await interaction.click(screen.getByText("产品制度说明"))

    expect(await screen.findByText("知识库详情")).toBeInTheDocument()
  })

  it("opens knowledge-base card details with the keyboard", async () => {
    const interaction = userEvent.setup()
    vi.stubGlobal("fetch", createFetchMock({}))
    renderListPage()

    const knowledgeBaseLink = await screen.findByRole("link", {
      name: "产品制度",
    })
    knowledgeBaseLink.focus()
    await interaction.keyboard("{Enter}")

    expect(await screen.findByText("知识库详情")).toBeInTheDocument()
  })

  it("keeps only the header create action when the knowledge-base list is empty", async () => {
    vi.stubGlobal("fetch", createFetchMock({ knowledgeBases: [] }))
    renderListPage(adminUser)

    expect(await screen.findByText("暂无知识库")).toBeVisible()
    expect(screen.getAllByRole("button", { name: "创建知识库" })).toHaveLength(
      1
    )
  })

  it("disables creation and explains every unmet service requirement", async () => {
    const interaction = userEvent.setup()
    const fetchMock = createFetchMock({
      creationCapability: {
        status: "unready",
        checks: {
          object_storage: "unavailable",
          document_parsing: "available",
          embedding_model: "not_configured",
          search_and_indexing: "available",
        },
        checked_at: "2026-08-31T08:00:00.000Z",
      },
    })
    vi.stubGlobal("fetch", fetchMock)
    renderListPage(adminUser)

    expect(await screen.findByText("暂时无法创建知识库")).toBeVisible()
    expect(screen.getByText("文件存储服务暂不可用")).toBeVisible()
    expect(screen.getByText("管理员尚未配置嵌入模型")).toBeVisible()
    expect(screen.getByRole("button", { name: "创建知识库" })).toBeDisabled()

    await interaction.click(screen.getByRole("button", { name: "重新检测" }))
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining(
          "/api/v1/knowledge-bases/creation-capability?refresh=true"
        ),
        expect.anything()
      )
    )
  })

  it("fails closed when creation requirements cannot be checked", async () => {
    vi.stubGlobal("fetch", createFetchMock({ creationCapabilityError: true }))
    renderListPage(adminUser)

    expect(await screen.findByText("无法确认知识库创建条件")).toBeVisible()
    expect(screen.getByRole("button", { name: "创建知识库" })).toBeDisabled()
  })

  it("marks SharePoint sources on knowledge-base cards", async () => {
    vi.stubGlobal(
      "fetch",
      createFetchMock({
        knowledgeBase: knowledgeBaseFixture({ source_type: "sharepoint" }),
      })
    )
    renderListPage()

    expect(await screen.findByText("来源：SharePoint")).toHaveClass(
      "knowledge-card-source-text"
    )
  })

  it("keeps shared access labels and does not mark another owner as the current user", async () => {
    vi.stubGlobal(
      "fetch",
      createFetchMock({
        knowledgeBase: knowledgeBaseFixture({
          owner: { id: recipientId, name: "周宁" },
          is_owner: false,
          access_sources: [{ type: "direct", id: directGrantId }],
        }),
      })
    )
    renderListPage(adminUser)

    expect(await screen.findByText("直接共享给我")).toBeVisible()
    expect(screen.getByText("所有者：周宁")).toBeVisible()
    expect(screen.queryByText("所有者：周宁（我）")).not.toBeInTheDocument()
  })

  it("selects the knowledge source with cards and preserves the SharePoint create payload", async () => {
    const interaction = userEvent.setup()
    const fetchMock = createFetchMock({})
    vi.stubGlobal("fetch", fetchMock)
    renderListPage(adminUser)

    const createButton = await screen.findByRole("button", {
      name: "创建知识库",
    })
    await waitFor(() => expect(createButton).toBeEnabled())
    await interaction.click(createButton)

    const dialog = screen.getByRole("dialog", { name: "创建知识库" })
    const sourceGroup = within(dialog).getByRole("group", {
      name: "数据来源",
    })
    const localSource = within(sourceGroup).getByRole("button", {
      name: /本地上传/,
    })
    const sharePointSource = within(sourceGroup).getByRole("button", {
      name: /SharePoint 目录/,
    })

    expect(sourceGroup).toHaveAttribute("data-slot", "toggle-group")
    expect(
      within(dialog).queryByRole("combobox", { name: "数据来源" })
    ).not.toBeInTheDocument()
    expect(localSource).toHaveAttribute("aria-pressed", "true")
    expect(localSource).toHaveClass("shadow-none", "hover:bg-hover")
    expect(localSource).not.toHaveClass("data-pressed:shadow-sm")
    expect(localSource).toHaveTextContent("创建后手动上传并管理本地文档。")
    await waitFor(() => expect(sharePointSource).toBeEnabled())

    await interaction.click(sharePointSource)

    expect(sharePointSource).toHaveAttribute("aria-pressed", "true")
    expect(localSource).toHaveAttribute("aria-pressed", "false")
    expect(sharePointSource).toHaveTextContent(
      "连接 SharePoint 文件夹并按计划自动同步。"
    )

    await interaction.type(
      within(dialog).getByLabelText("知识库名称"),
      "SharePoint 政策库"
    )
    await interaction.type(
      within(dialog).getByLabelText("SharePoint 目录 URL"),
      "https://contoso.sharepoint.com/:f:/s/policy/share-token"
    )
    await interaction.click(
      within(dialog).getByRole("button", { name: "创建" })
    )

    await waitFor(() => {
      const request = fetchMock.mock.calls.find(([input, init]) => {
        const url = new URL(String(input), window.location.origin)
        return (
          url.pathname === "/api/v1/knowledge-bases" && init?.method === "POST"
        )
      })
      expect(request).toBeDefined()
      expect(JSON.parse(String(request?.[1]?.body))).toEqual({
        name: "SharePoint 政策库",
        source_type: "sharepoint",
        sharepoint_folder_url:
          "https://contoso.sharepoint.com/:f:/s/policy/share-token",
        sync_schedule: {
          frequency: "daily",
          time: "09:00",
          time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
        },
      })
    })
  })

  it("keeps the SharePoint source card unavailable when the source is not enabled", async () => {
    const interaction = userEvent.setup()
    vi.stubGlobal("fetch", createFetchMock({ sharePointEnabled: false }))
    renderListPage(adminUser)

    const createButton = await screen.findByRole("button", {
      name: "创建知识库",
    })
    await waitFor(() => expect(createButton).toBeEnabled())
    await interaction.click(createButton)

    const dialog = screen.getByRole("dialog", { name: "创建知识库" })
    const sharePointSource = within(dialog).getByRole("button", {
      name: /SharePoint 目录/,
    })

    await waitFor(() => expect(sharePointSource).toBeDisabled())
    expect(sharePointSource).toHaveTextContent("未启用")
    expect(
      within(dialog).queryByLabelText("SharePoint 目录 URL")
    ).not.toBeInTheDocument()
  })

  it("places compact knowledge metadata beside the truncated header description", async () => {
    const longDescription =
      "这是一段用于验证知识库详情头部描述会在有限宽度内显示省略号的较长描述。"
    vi.stubGlobal(
      "fetch",
      createFetchMock({
        knowledgeBase: knowledgeBaseFixture({ description: longDescription }),
      })
    )
    renderDetailPage()

    const page = await screen.findByRole("banner")
    const description = within(page).getByText(longDescription, {
      selector: "p",
    })
    const overviewMetadata = within(page)
      .getByText("所有者：林晓")
      .closest('[data-slot="knowledge-detail-overview-metadata"]')

    expect(description).toHaveClass("management-header-description")
    expect(description).toHaveAttribute("title", longDescription)
    expect(overviewMetadata).not.toBeNull()
    expect(
      description.compareDocumentPosition(overviewMetadata as Node) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(screen.queryByText(/当前版本、归档内容/)).not.toBeInTheDocument()
    expect(overviewMetadata).toHaveTextContent("所有者：林晓")
    expect(overviewMetadata).toHaveTextContent("1 个文档")
    expect(overviewMetadata).toHaveTextContent("1 个可检索")
    expect(overviewMetadata).not.toHaveTextContent("我创建的")
    expect(
      overviewMetadata?.querySelector('[data-slot="progress"]')
    ).not.toBeInTheDocument()
    expect(overviewMetadata).not.toHaveTextContent("0%")
    expect(screen.queryByText("知识库概览")).not.toBeInTheDocument()
    expect(
      page
        .closest(".knowledge-detail-page")
        ?.querySelector(".knowledge-overview")
    ).toBeNull()

    const header = page
    expect(header.nextElementSibling).toHaveClass("knowledge-document-section")
    expect(header.nextElementSibling).not.toHaveClass("mb-6")
    expect(
      header.nextElementSibling?.querySelector(".knowledge-section-heading")
    ).toBeNull()
    expect(
      screen.queryByRole("heading", { name: "文档" })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByText("上传文档并查看解析、分段、向量化与索引进度。")
    ).not.toBeInTheDocument()

    expect(screen.queryByText("已选择 0 个文档")).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "重建选中文档" })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "重建全部文档" })
    ).not.toBeInTheDocument()
  })

  it("shows SharePoint sync status without exposing the local upload action", async () => {
    const fetchMock = createFetchMock({
      knowledgeBase: knowledgeBaseFixture({ source_type: "sharepoint" }),
      source: sourceFixture({
        sync_status: "failed",
        retry_available: true,
        sync_progress: {
          run_id: "00000000-0000-4000-8000-000000000042",
          trigger: "manual",
          status: "partial",
          phase: "completed",
          failure_phase: "processing",
          retry_of_run_id: null,
          scanned_count: 1,
          total_count: 1,
          processed_count: 1,
          created_count: 0,
          updated_count: 0,
          deleted_count: 0,
          skipped_count: 0,
          retried_count: 0,
          failed_count: 1,
          progress_percent: 100,
          started_at: "2026-07-22T01:00:00.000Z",
          updated_at: "2026-07-22T01:01:00.000Z",
          completed_at: "2026-07-22T01:01:00.000Z",
        },
        stable_error_code: "KNOWLEDGE_SOURCE_ITEM_SYNC_FAILED",
      }),
    })
    vi.stubGlobal("fetch", fetchMock)
    renderDetailPage()

    expect(await screen.findByText("SharePoint 同步")).toBeInTheDocument()
    expect(
      screen.getByText("部分 SharePoint 文档同步失败，系统会按计划重试。")
    ).toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "上传文档" })
    ).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole("button", { name: "重试同步" }))
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining(
          `/api/v1/knowledge-bases/${knowledgeBaseId}/source/sync`
        ),
        expect.objectContaining({ method: "POST" })
      )
    )
  })

  it("shows live SharePoint scan progress and disables duplicate synchronization", async () => {
    vi.stubGlobal(
      "fetch",
      createFetchMock({
        knowledgeBase: knowledgeBaseFixture({ source_type: "sharepoint" }),
        source: sourceFixture({
          sync_status: "syncing",
          sync_progress: {
            run_id: "00000000-0000-4000-8000-000000000043",
            trigger: "scheduled",
            status: "running",
            phase: "scanning",
            failure_phase: null,
            retry_of_run_id: null,
            scanned_count: 18,
            total_count: null,
            processed_count: 0,
            created_count: 0,
            updated_count: 0,
            deleted_count: 0,
            skipped_count: 0,
            retried_count: 0,
            failed_count: 0,
            progress_percent: null,
            started_at: "2026-07-22T01:00:00.000Z",
            updated_at: "2026-07-22T01:01:00.000Z",
            completed_at: null,
          },
        }),
      })
    )
    renderDetailPage()

    expect(
      await screen.findByText("正在扫描目录，已发现 18 个条目")
    ).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "立即同步" })).toBeDisabled()
  })

  it("uses indeterminate progress for external parsing and child chunking only", async () => {
    const processingDocument = (
      id: string,
      displayName: string,
      generationId: string,
      stage: "parsing" | "chunking" | "parenting" | "embedding",
      progressPercent: number,
      retryAt: string | null = null,
      retryAttempt = 0
    ) =>
      documentFixture({
        id,
        display_name: displayName,
        status: "processing",
        current_version_id: null,
        searchable: false,
        processing: {
          operation: "upload",
          processing_generation: generationId,
          stage,
          progress_percent: progressPercent,
          revision: 2,
          stable_error_code: null,
          retry_at: retryAt,
          retry_attempt: retryAttempt,
          cancellable: true,
        },
      })
    const fetchMock = createFetchMock({
      documents: [
        processingDocument(
          documentId,
          "解析中.pdf",
          candidateGenerationId,
          "parsing",
          40,
          "2026-07-23T14:23:00.000Z",
          2
        ),
        processingDocument(
          "00000000-0000-4000-8000-000000000012",
          "子切片中.pdf",
          "00000000-0000-4000-8000-000000000022",
          "chunking",
          55
        ),
        processingDocument(
          "00000000-0000-4000-8000-000000000014",
          "父切片中.pdf",
          "00000000-0000-4000-8000-000000000024",
          "parenting",
          70
        ),
        processingDocument(
          "00000000-0000-4000-8000-000000000013",
          "向量化中.pdf",
          "00000000-0000-4000-8000-000000000023",
          "embedding",
          80
        ),
      ],
    })
    vi.stubGlobal("fetch", fetchMock)
    renderDetailPage()

    const parsingProgress = await screen.findByRole("progressbar", {
      name: "正在解析",
    })
    const chunkingProgress = screen.getByRole("progressbar", {
      name: "正在生成子切片",
    })
    const parentingProgress = screen.getByRole("progressbar", {
      name: "正在构建父切片",
    })
    const embeddingProgress = screen.getByRole("progressbar", {
      name: "正在生成向量",
    })

    expect(screen.queryByText("处理中")).not.toBeInTheDocument()
    for (const progress of [parsingProgress, chunkingProgress]) {
      expect(progress).toHaveAttribute("data-indeterminate")
      expect(progress).not.toHaveAttribute("aria-valuenow")
    }
    expect(screen.queryByText("40%")).not.toBeInTheDocument()
    expect(screen.queryByText("55%")).not.toBeInTheDocument()
    expect(parentingProgress).toHaveAttribute("aria-valuenow", "70")
    expect(screen.getByText("70%")).toBeVisible()
    expect(embeddingProgress).not.toHaveAttribute("data-indeterminate")
    expect(embeddingProgress).toHaveAttribute("aria-valuenow", "80")
    expect(screen.getByText("80%")).toBeVisible()
    expect(parsingProgress).toHaveClass("knowledge-document-progress")
    expect(screen.getByText(/第二次自动重试/u)).toHaveClass(
      "knowledge-document-retry-status",
      "text-muted-foreground"
    )
  })

  it("keeps the fixed processing region mounted across live progress updates", async () => {
    const processingDocument = (progressPercent: number, revision: number) =>
      documentFixture({
        status: "processing",
        current_version_id: null,
        searchable: false,
        processing: {
          operation: "upload",
          processing_generation: candidateGenerationId,
          stage: "embedding",
          progress_percent: progressPercent,
          revision,
          stable_error_code: null,
          retry_at: null,
          retry_attempt: 0,
          cancellable: true,
        },
      })
    const initialDocument = processingDocument(72, 2)
    vi.stubGlobal("fetch", createFetchMock({ documents: [initialDocument] }))
    const { queryClient } = renderDetailPage()

    const initialProgress = await screen.findByRole("progressbar", {
      name: "正在生成向量",
    })
    expect(initialProgress).toHaveAttribute("aria-valuenow", "72")
    expect(initialProgress.closest("td")).toHaveClass(
      "knowledge-document-status-column"
    )
    expect(initialProgress.parentElement).toHaveClass(
      "knowledge-document-status"
    )

    const refreshedDocument = processingDocument(84, 3)
    act(() => {
      queryClient.setQueryData(
        knowledgeBaseQueryKeys.entryDirectory(
          knowledgeBaseId,
          undefined,
          "flat"
        ),
        {
          pages: [
            {
              breadcrumbs: [],
              items: [
                {
                  id: refreshedDocument.id,
                  knowledge_base_id: knowledgeBaseId,
                  parent_entry_id: null,
                  entry_type: "document",
                  name: refreshedDocument.display_name,
                  path: [refreshedDocument.display_name],
                  document: refreshedDocument,
                  updated_at: refreshedDocument.updated_at,
                },
              ],
              next_cursor: null,
            },
          ],
          pageParams: [undefined],
        }
      )
    })

    await waitFor(() =>
      expect(initialProgress).toHaveAttribute("aria-valuenow", "84")
    )
    expect(screen.getByRole("progressbar", { name: "正在生成向量" })).toBe(
      initialProgress
    )
    expect(screen.getByText("84%")).toBeVisible()
  })

  it("submits selected rebuilds and renames through explicit controls", async () => {
    const fetchMock = createFetchMock({})
    vi.stubGlobal("fetch", fetchMock)
    const interaction = userEvent.setup()
    renderDetailPage()

    const documentName = await screen.findByRole("link", {
      name: "方案 A.pdf",
    })
    expect(documentName).toHaveClass(
      "knowledge-document-file-name",
      "knowledge-document-link"
    )
    expect(documentName).toHaveAttribute("title", "方案 A.pdf")
    expect(
      within(documentName.parentElement as HTMLElement).getByText("PDF")
    ).toHaveClass("knowledge-document-type")
    expect(document.querySelector('[data-file-icon-kind="pdf"]')).toHaveClass(
      "size-6"
    )
    await interaction.click(
      screen.getByRole("checkbox", { name: "选择文档 方案 A.pdf" })
    )
    const selectionToolbar = screen.getByRole("toolbar", {
      name: "已选择 1 个文档",
    })
    expect(selectionToolbar).toHaveClass(
      "knowledge-selection-toolbar",
      "fixed",
      "w-fit",
      "gap-1.5",
      "rounded-[var(--radius-xl)]",
      "p-2",
      "pl-4"
    )
    expect(selectionToolbar).not.toHaveClass("rounded-full")
    expect(screen.getByText("已选择 1 个文档")).toHaveClass("text-sm")
    await interaction.click(
      within(selectionToolbar).getByRole("button", {
        name: "重建选中文档",
      })
    )
    expect(
      await screen.findByRole("heading", { name: "重建选中文档的索引？" })
    ).toBeVisible()
    await interaction.click(screen.getByRole("button", { name: "重建索引" }))

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([input, init]) => {
        const url = new URL(String(input), window.location.origin)
        return (
          url.pathname.endsWith("/documents/rebuild") && init?.method === "POST"
        )
      })
      expect(call).toBeDefined()
      expect(JSON.parse(String(call?.[1]?.body))).toEqual({
        document_ids: [documentId],
      })
    })

    await interaction.click(
      screen.getByRole("button", { name: "管理文档 方案 A.pdf" })
    )
    await interaction.click(
      await screen.findByRole("menuitem", { name: "重命名" })
    )
    const renameDialog = await screen.findByRole("dialog", {
      name: "重命名文档",
    })
    const input = within(renameDialog).getByRole("textbox", {
      name: "文档名称",
    })
    await interaction.clear(input)
    await interaction.type(input, "新方案.pdf")
    await interaction.click(
      within(renameDialog).getByRole("button", { name: "重命名" })
    )

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([input, init]) => {
        const url = new URL(String(input), window.location.origin)
        return (
          url.pathname.endsWith(`/documents/${documentId}`) &&
          init?.method === "PATCH"
        )
      })
      expect(JSON.parse(String(call?.[1]?.body))).toEqual({
        display_name: "新方案.pdf",
      })
    })
  })

  it("shows failed candidate details from the full failure-status control", async () => {
    const failedCandidateDocument = documentFixture({
      candidate_failure: {
        operation: "replace",
        processing_generation: candidateGenerationId,
        revision: 7,
        stable_error_code: "KNOWLEDGE_DOCUMENT_ENCRYPTED",
        retryable: true,
      },
    })
    const fetchMock = createFetchMock({ documents: [failedCandidateDocument] })
    vi.stubGlobal("fetch", fetchMock)
    const interaction = userEvent.setup()
    renderDetailPage()

    const failureDetails = await screen.findByLabelText(
      "查看文档 方案 A.pdf 的处理失败详情"
    )
    expect(failureDetails).toHaveTextContent("处理失败")
    expect(failureDetails.tagName).toBe("SPAN")
    expect(failureDetails).toHaveAttribute("tabindex", "0")
    expect(failureDetails).toHaveClass("gap-1", "text-xs")
    expect(failureDetails).not.toHaveClass("gap-1.5", "text-sm")
    const failureIcon = failureDetails.querySelector<SVGSVGElement>(
      '[data-slot="knowledge-document-failure-icon"]'
    )
    expect(failureIcon).toBeInTheDocument()
    expect(failureIcon).toHaveAttribute("aria-hidden", "true")
    expect(failureIcon).toHaveClass("size-3")
    expect(failureIcon).not.toHaveClass("size-4")
    expect(failureDetails).toContainElement(failureIcon)
    expect(failureIcon?.closest('[data-slot="button"]')).toBeNull()
    expect(
      screen.queryByText("文档受密码保护或已加密，无法处理。")
    ).not.toBeInTheDocument()
    expect(
      screen.queryByText("本次候选处理失败，当前可用版本仍可正常使用。")
    ).not.toBeInTheDocument()

    await interaction.hover(failureIcon!)
    let failureTooltip = await screen.findByRole("tooltip")
    expect(
      within(failureTooltip).getByText(
        "本次候选处理失败，当前可用版本仍可正常使用。"
      )
    ).toBeVisible()
    expect(
      within(failureTooltip).getByText("文档受密码保护或已加密，无法处理。")
    ).toBeVisible()
    await interaction.unhover(failureIcon!)
    await waitFor(() =>
      expect(screen.queryByRole("tooltip")).not.toBeInTheDocument()
    )

    await interaction.hover(failureDetails)
    failureTooltip = await screen.findByRole("tooltip")
    expect(
      within(failureTooltip).getByText(
        "本次候选处理失败，当前可用版本仍可正常使用。"
      )
    ).toBeVisible()
    expect(
      within(failureTooltip).getByText("文档受密码保护或已加密，无法处理。")
    ).toBeVisible()
    await interaction.unhover(failureDetails)
    await waitFor(() =>
      expect(screen.queryByRole("tooltip")).not.toBeInTheDocument()
    )

    const reprocessButton = screen.getByRole("button", {
      name: "重新处理 方案 A.pdf",
    })
    const reprocessIcon = reprocessButton.querySelector<SVGSVGElement>(
      '[data-slot="knowledge-document-reprocess-icon"]'
    )
    expect(reprocessIcon).toBeInTheDocument()
    expect(reprocessIcon).toHaveAttribute("aria-hidden", "true")

    await interaction.hover(reprocessButton)
    const reprocessTooltip = await screen.findByRole("tooltip")
    expect(within(reprocessTooltip).getByText("重新处理")).toBeVisible()
    await interaction.unhover(reprocessButton)
    await waitFor(() =>
      expect(screen.queryByRole("tooltip")).not.toBeInTheDocument()
    )

    await interaction.click(
      screen.getByRole("button", { name: "管理文档 方案 A.pdf" })
    )
    expect(
      await screen.findByRole("menuitem", { name: "重新处理" })
    ).toBeEnabled()
    await interaction.keyboard("{Escape}")

    failureDetails.focus()
    failureTooltip = await screen.findByRole("tooltip")
    expect(
      within(failureTooltip).getByText("文档受密码保护或已加密，无法处理。")
    ).toBeVisible()

    await interaction.click(reprocessButton)
    const reprocessDialog = await screen.findByRole("dialog", {
      name: "重新处理文档？",
    })
    await interaction.click(
      within(reprocessDialog).getByRole("button", { name: "重新处理" })
    )
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([input, init]) =>
            String(input).endsWith(`/documents/${documentId}/reprocess`) &&
            init?.method === "POST"
        )
      ).toBe(true)
    )
    expect(
      fetchMock.mock.calls.some(([input]) =>
        String(input).endsWith(`/documents/${documentId}/retry`)
      )
    ).toBe(false)

    await interaction.click(
      screen.getByRole("button", { name: "管理文档 方案 A.pdf" })
    )
    expect(
      screen.queryByRole("menuitem", { name: "丢弃失败候选" })
    ).not.toBeInTheDocument()
    expect(
      fetchMock.mock.calls.some(([input]) =>
        String(input).endsWith(`/documents/${documentId}/failed-candidate`)
      )
    ).toBe(false)
  })

  it("allows failed documents to be selected individually and through select all", async () => {
    const failedDocument = documentFixture({
      id: "00000000-0000-4000-8000-000000000012",
      display_name: "失败制度.pdf",
      status: "failed",
      current_version_id: null,
      searchable: false,
      candidate_failure: {
        operation: "upload",
        processing_generation: candidateGenerationId,
        revision: 7,
        stable_error_code: "KNOWLEDGE_DOCUMENT_ENCRYPTED",
        retryable: true,
      },
    })
    const failedCandidateDocument = documentFixture({
      id: "00000000-0000-4000-8000-000000000013",
      display_name: "候选失败制度.pdf",
      candidate_failure: {
        operation: "replace",
        processing_generation: candidateGenerationId,
        revision: 8,
        stable_error_code: "KNOWLEDGE_DOCUMENT_ENCRYPTED",
        retryable: true,
      },
    })
    const fetchMock = createFetchMock({
      documents: [documentFixture(), failedDocument, failedCandidateDocument],
    })
    vi.stubGlobal("fetch", fetchMock)
    const interaction = userEvent.setup()
    renderDetailPage()

    const failedCheckbox = await screen.findByRole("checkbox", {
      name: "选择文档 失败制度.pdf",
    })
    const failedCandidateCheckbox = screen.getByRole("checkbox", {
      name: "选择文档 候选失败制度.pdf",
    })
    expect(screen.getByText("失败制度.pdf")).toHaveAttribute(
      "title",
      "失败制度.pdf"
    )
    expect(failedCheckbox).toBeEnabled()
    expect(failedCandidateCheckbox).toBeEnabled()

    await interaction.click(failedCheckbox)
    expect(screen.getByText("已选择 1 个文档")).toBeVisible()
    expect(
      screen.getByRole("toolbar", { name: "已选择 1 个文档" })
    ).toBeVisible()
    expect(screen.getByRole("button", { name: "重建选中文档" })).toBeEnabled()

    await interaction.click(failedCandidateCheckbox)
    expect(screen.getByText("已选择 2 个文档")).toBeVisible()

    await interaction.click(
      screen.getByRole("checkbox", {
        name: "选择当前已加载的全部文档",
      })
    )

    expect(
      screen.getByRole("checkbox", { name: "选择文档 方案 A.pdf" })
    ).toBeChecked()
    expect(failedCheckbox).toBeChecked()
    expect(failedCandidateCheckbox).toBeChecked()
    expect(screen.getByText("已选择 3 个文档")).toBeVisible()

    await interaction.click(
      screen.getByRole("button", { name: "重建选中文档" })
    )
    expect(
      await screen.findByRole("heading", { name: "重建选中文档的索引？" })
    ).toBeVisible()
    await interaction.click(screen.getByRole("button", { name: "重建索引" }))

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([input, init]) => {
        const url = new URL(String(input), window.location.origin)
        return (
          url.pathname.endsWith("/documents/rebuild") && init?.method === "POST"
        )
      })
      const body = JSON.parse(String(call?.[1]?.body)) as {
        document_ids: string[]
      }
      expect(body.document_ids).toHaveLength(3)
      expect(body.document_ids).toEqual(
        expect.arrayContaining([
          documentId,
          failedDocument.id,
          failedCandidateDocument.id,
        ])
      )
    })
    const notification = await screen.findByText(
      "已提交 3 个文档处理，0 个文档未能提交"
    )
    expect(notification.closest("[data-sonner-toast]")).not.toBeNull()
    expect(notification.closest('[data-slot="alert"]')).toBeNull()
  })

  it("keeps rebuild-all available when every document requires rebuilding", async () => {
    const rebuildRequiredDocument = documentFixture({
      searchable: false,
      rebuild_required: true,
    })
    const fetchMock = createFetchMock({
      knowledgeBase: knowledgeBaseFixture({
        document_count: 1,
        ready_document_count: 0,
      }),
      documents: [rebuildRequiredDocument],
    })
    vi.stubGlobal("fetch", fetchMock)
    const interaction = userEvent.setup()
    renderDetailPage()

    await interaction.click(
      await screen.findByRole("checkbox", {
        name: "选择文档 方案 A.pdf",
      })
    )

    expect(screen.getByRole("button", { name: "重建全部文档" })).toBeEnabled()

    await interaction.click(
      screen.getByRole("button", { name: "重建索引 方案 A.pdf" })
    )
    expect(
      await screen.findByRole("heading", { name: "重建文档索引？" })
    ).toBeVisible()
    await interaction.click(screen.getByRole("button", { name: "重建索引" }))

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([input, init]) => {
          const url = new URL(String(input), window.location.origin)
          return (
            url.pathname.endsWith(`/documents/${documentId}/rebuild`) &&
            init?.method === "POST"
          )
        })
      ).toBe(true)
      expect(
        fetchMock.mock.calls.some(([input]) =>
          String(input).endsWith(`/documents/${documentId}/reprocess`)
        )
      ).toBe(false)
    })
  })

  it("localizes the failed document detail trigger and tooltip in English", async () => {
    await i18n.changeLanguage("en-US")
    const failedDocument = documentFixture({
      status: "failed",
      current_version_id: null,
      searchable: false,
      candidate_failure: {
        operation: "upload",
        processing_generation: candidateGenerationId,
        revision: 7,
        stable_error_code: "KNOWLEDGE_DOCUMENT_ENCRYPTED",
        retryable: true,
      },
    })
    const fetchMock = createFetchMock({ documents: [failedDocument] })
    vi.stubGlobal("fetch", fetchMock)
    renderDetailPage()

    const failureDetails = await screen.findByLabelText(
      "View processing failure details for document 方案 A.pdf"
    )
    expect(failureDetails).toHaveTextContent("Processing failed")
    failureDetails.focus()
    const failureTooltip = await screen.findByRole("tooltip")

    expect(within(failureTooltip).getByText("Processing failed")).toBeVisible()
    expect(
      within(failureTooltip).getByText(
        "The document is password-protected or encrypted and cannot be processed."
      )
    ).toBeVisible()
  })

  it("shows every access source and removes only the direct personal grant", async () => {
    const recipientKnowledgeBase = knowledgeBaseFixture({
      is_owner: false,
      access_sources: [
        { type: "direct", id: directGrantId },
        { type: "user_group", id: groupId, name: "产品组" },
      ],
      permissions: {
        view_content: true,
        update: false,
        manage_documents: false,
        manage_grants: false,
        create_grants: false,
        revoke_grants: false,
        archive: false,
        restore: false,
        delete: false,
        remove_direct_share: true,
      },
    })
    const fetchMock = createFetchMock({ knowledgeBase: recipientKnowledgeBase })
    vi.stubGlobal("fetch", fetchMock)
    const interaction = userEvent.setup()
    renderDetailPage()

    await screen.findByRole("heading", { name: "产品制度" })
    await interaction.click(
      screen.getByRole("button", { name: "查看来源明细" })
    )
    const sourceDialog = await screen.findByRole("dialog", {
      name: "访问来源",
    })
    expect(within(sourceDialog).getByText("个人直接分享")).toBeVisible()
    expect(within(sourceDialog).getByText("用户组：产品组")).toBeVisible()
    await interaction.click(
      within(sourceDialog).getAllByRole("button", { name: "关闭" })[0]!
    )

    await interaction.click(
      screen.getByRole("button", { name: "移除我的直接分享" })
    )
    const removeDialog = await screen.findByRole("dialog", {
      name: "移除个人直接分享？",
    })
    expect(removeDialog).toHaveTextContent(
      "移除后仍可通过其他有效来源访问此知识库。"
    )
    await interaction.click(
      within(removeDialog).getByRole("button", {
        name: "移除我的直接分享",
      })
    )

    const notification = await screen.findByText(
      "个人直接分享已移除；你仍可通过其他有效来源访问此知识库"
    )
    expect(notification.closest("[data-sonner-toast]")).not.toBeNull()
    expect(notification.closest('[data-slot="alert"]')).toBeNull()
    expect(
      fetchMock.mock.calls.some(
        ([input, init]) =>
          String(input).endsWith(`/grants/${directGrantId}`) &&
          init?.method === "DELETE"
      )
    ).toBe(true)
  })

  it("allows archived owners to revoke shares without exposing share creation", async () => {
    const archivedKnowledgeBase = knowledgeBaseFixture({
      lifecycle_status: "archived",
      archived_at: "2026-07-22T02:00:00.000Z",
      permissions: {
        view_content: true,
        update: false,
        manage_documents: false,
        manage_grants: true,
        create_grants: false,
        revoke_grants: true,
        archive: false,
        restore: true,
        delete: true,
        remove_direct_share: false,
      },
    })
    const fetchMock = createFetchMock({ knowledgeBase: archivedKnowledgeBase })
    vi.stubGlobal("fetch", fetchMock)
    const interaction = userEvent.setup()
    renderDetailPage()

    await screen.findByRole("heading", { name: "产品制度" })
    await interaction.click(screen.getByRole("button", { name: "共享" }))
    expect(
      await screen.findByRole("heading", { name: "共享知识库" })
    ).toBeVisible()
    expect(screen.queryByRole("button", { name: "添加共享" })).toBeNull()
    expect(screen.queryByText("共享对象")).toBeNull()
    await interaction.click(
      await screen.findByRole("button", {
        name: "撤销对 测试用户 的共享",
      })
    )

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([input, init]) =>
            String(input).endsWith(`/grants/${directGrantId}`) &&
            init?.method === "DELETE"
        )
      ).toBe(true)
    )
  })

  it("shows every application using a knowledge base when deletion is blocked", async () => {
    const archivedKnowledgeBase = knowledgeBaseFixture({
      lifecycle_status: "archived",
      archived_at: "2026-07-22T02:00:00.000Z",
      permissions: {
        ...ownerPermissions,
        archive: false,
        restore: true,
        delete: true,
      },
    })
    vi.stubGlobal(
      "fetch",
      createFetchMock({
        knowledgeBase: archivedKnowledgeBase,
        deleteBaseError: {
          error_code: "KNOWLEDGE_BASE_IN_USE",
          params: {
            usages: [
              {
                type: "application",
                resource_id: "00000000-0000-4000-8000-000000000071",
                name: "制度问答助手",
                status: "active",
              },
              {
                type: "application",
                resource_id: "00000000-0000-4000-8000-000000000072",
                name: "归档资料助手",
                status: "disabled",
              },
            ],
          },
        },
      })
    )
    const interaction = userEvent.setup()
    renderDetailPage()

    await interaction.click(await screen.findByRole("button", { name: "删除" }))
    const confirmDialog = screen.getByRole("dialog", {
      name: "永久删除知识库？",
    })
    await interaction.click(
      within(confirmDialog).getByRole("button", { name: "删除" })
    )

    const blockedDialog = await screen.findByRole("dialog", {
      name: "暂时无法删除知识库",
    })
    expect(blockedDialog).toHaveTextContent(
      "该知识库仍被应用使用，请先从相关应用中移除。"
    )
    expect(blockedDialog).toHaveTextContent("正在使用此知识库的应用（2）")
    expect(blockedDialog).toHaveTextContent("制度问答助手")
    expect(blockedDialog).toHaveTextContent("启用")
    expect(blockedDialog).toHaveTextContent("归档资料助手")
    expect(blockedDialog).toHaveTextContent("停用")

    await interaction.click(
      within(blockedDialog).getByRole("button", { name: "前往应用中心" })
    )
    expect(await screen.findByText("应用中心")).toBeVisible()
  })
})
